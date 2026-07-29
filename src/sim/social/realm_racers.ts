// The Realm Racers: a deterministic two-player vehicle race. This module owns
// the FIFO queue, the single instanced match, arc-length lap progress, finish
// arbitration (public and practice races may run different lap counts),
// straight-line Arc Shell projectiles, and the complete gameplay parenthesis
// (temporary kit/mount in, exact return state out).
//
// It is also what puts a racer BEHIND THE WHEEL: seating a pilot hands them a
// `drive` state (src/sim/types.ts) and the movement kernel switches to the
// vehicle model for as long as they carry it. The surface a racer is on
// (`gripMult`/`dragMult` on that state) is written from their projection onto
// the circuit here, at the END of the tick, while movement runs EARLIER in the
// same tick: the surface written on tick N is therefore driven on tick N+1, one
// tick of lag. That is deliberate and deterministic. The alternative, moving
// this phase before the per-player loop, would reorder the tick phases, and
// phase order is rng-draw-order load bearing (src/sim/CLAUDE.md); 50 ms of lag
// on how slippery the grass is buys nothing worth that risk.

import type {
  RealmRacersInfo,
  RealmRacersMatchInfo,
  RealmRacersPhase,
  RealmRacersRacerInfo,
} from '../../world_api/realm_racers';
import { realmRacersWeaponCharges, resolveRealmRacersKit } from '../content/realm_racers';
import { vehicleProfile } from '../content/vehicles';
import { abilitiesKnownAt, DUNGEON_X_THRESHOLD } from '../data';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import type { RallyDriverTier } from '../realm_racers_driver';
import {
  type RallyPoint,
  REALM_RACERS_LAPS,
  REALM_RACERS_PRACTICE_LAPS,
  REALM_RACERS_PRACTICE_SLOTS,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
  realmRacersSlotOffset,
} from '../realm_racers_layout';
import { stepRealmRacersProgress, travelledFromArc } from '../realm_racers_progress';
import {
  resolveShellAim,
  resolveShellBlast,
  SHELL_CONTROL_SECONDS,
  SHELL_CONTROL_SPEED_MULT,
  SHELL_SHOCK_GRIP,
  SHELL_SHOCK_TICKS,
} from '../realm_racers_shell';
import {
  type RallyProjection,
  rallyBasinEdgeOffsetAt,
  realmRacersStarts,
  realmRacersTrack,
} from '../realm_racers_spline';
import type { ArenaReturnPools, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, TICK_RATE, type VehicleDrive } from '../types';
import { type ContactBody, resolveVehicleContact } from '../vehicle_contact';
import { createVehicleDrive, resetVehicleDrive } from '../vehicle_motion';
import { cloneAbilityCharges, cloneCcDr, isArenaQueued, snapshotArenaReturnPools } from './arena';

/** The machine every pilot is loaned, as a VEHICLE_PROFILES key. A roster of
 *  machines is a later workstream. */
export const REALM_RACERS_VEHICLE_KEY = 'rally_loaner';

/** The mount visual that machine wears, mirrored onto Entity.mountKey. It is
 *  read off the profile rather than written here because the two are separate
 *  namespaces: Entity.mountKey is a bare string, so a stale literal would not
 *  fail to compile, it would just render a pilot with no machine under them. */
export const REALM_RACERS_MOUNT_KEY: string = vehicleProfile(REALM_RACERS_VEHICLE_KEY).key;
export const REALM_RACERS_COUNTDOWN_TICKS = 5 * TICK_RATE;
export const REALM_RACERS_TIME_LIMIT_TICKS = 180 * TICK_RATE;
export const REALM_RACERS_RETURN_TICKS = 6 * TICK_RATE;
/** The debuff an Arc Shell hit leaves in the victim's HUD aura row. */
export const REALM_RACERS_SHELL_AURA = 'realm_racers_arc_shell_control';
export interface RealmRacersSlowBand {
  /** Player-visible aura name, localized at the client boundary. */
  name: string;
  /**
   * The aura's `value`, which `moveSpeedMult` uses as a MULTIPLIER (it returns
   * `slow * speed`), not as the fraction lost. 0.75 keeps three quarters of the
   * racer's speed. Reading it the other way round is how the verge first
   * shipped harsher than the garden it is supposed to be gentler than.
   */
  speedMult: number;
  /**
   * What the surface does to a VEHICLE beyond costing it speed: less grip means
   * the machine slides where the road would have held it, more drag means it
   * bleeds off rather than coasting across. The aura above still owns the top
   * speed (it is what the anti-cut arithmetic is written in), so these two never
   * double-count it.
   */
  gripMult: number;
  dragMult: number;
}

/** The fraction of speed a band actually costs, which is what the anti-cut
 *  arithmetic is written in. */
export function realmRacersSpeedLoss(band: RealmRacersSlowBand): number {
  return 1 - band.speedMult;
}

/** One aura id for every band, so deepening the penalty re-tunes the aura in
 *  place instead of stacking a second slow on top of the first. */
export const REALM_RACERS_OFF_TRACK_AURA = 'realm_racers_soft_verge';

/**
 * The off-track bands. Leaving the circuit costs time, in proportion to how far
 * out you are: the mown verge is a nudge, the garden beyond it is a real price,
 * and the basin's wading margin is the wall's replacement. All three are tuning
 * knobs, and all three are LOAD BEARING: together they are the only thing
 * making a cut across the infield slower than driving the road, so the sweep in
 * `tests/realm_racers_colliders.test.ts` pins every one of them against
 * `REALM_RACERS_APRON_RADIUS_FRACTION` and the wading margin.
 */
export const REALM_RACERS_VERGE_BAND: RealmRacersSlowBand = {
  name: 'Soft Verge',
  speedMult: 0.75,
  gripMult: 0.7,
  dragMult: 3,
};
export const REALM_RACERS_GARDEN_BAND: RealmRacersSlowBand = {
  name: 'Garden Lawn',
  speedMult: 0.6,
  gripMult: 0.5,
  dragMult: 6,
};
/**
 * The third band: the basin's wading margin, the only water a racer can enter
 * at all. It is the harshest by a distance because it is the LAST thing between
 * the circuit and the shortcut across the middle, now that no wall is.
 */
export const REALM_RACERS_WATER_BAND: RealmRacersSlowBand = {
  name: 'Wading',
  speedMult: 0.4,
  gripMult: 0.35,
  dragMult: 8,
};
/** Two racers within this many yards of each other are a dead heat. */
export const REALM_RACERS_DEAD_HEAT_YARDS = 0.5;

/**
 * Closing speed under which a contact is a rub rather than an impact: the
 * bodies are still separated, but nothing is announced. Without it a pair
 * leaning on each other through a long corner would emit at 20 Hz and every
 * client would machine-gun the spark, the sound and the shake.
 */
export const REALM_RACERS_BUMP_EVENT_MIN_IMPACT = 3;
/** And even above that threshold, one event per pair per half second. */
export const REALM_RACERS_BUMP_EVENT_TICKS = TICK_RATE / 2;

/** The weapon a racer is holding, and what is left of it. A SLOT rather than a
 *  hardcoded kit: pickups write a different value into it, and a roster of
 *  machines writes the id off the vehicle profile. */
export interface RealmRacersWeaponSlot {
  abilityId: string;
  /** Uses left this race, never refilled. Null is unlimited fire. */
  charges: number | null;
}

export interface RealmRacersProgress {
  lap: number;
  finishedTick: number | null;
  /** Last projected centerline sample: the search hint for the next tick. */
  trackIndex: number;
  lastS: number;
  distanceSinceWrap: number;
  /** Yards down the circuit, monotonic across laps; the live ranking key. */
  travelled: number;
  heldWeapon: RealmRacersWeaponSlot | null;
  /** Tick the shell shock's grip loss expires on; 0 when the machine has not
   *  been hit. */
  shellShockUntilTick: number;
}

/**
 * A shell in flight. It is not a moving point: the impact is decided at fire
 * time and the sim only has to know where and when. That is cheaper, it is what
 * lets one event carry the whole ground marker, and it removes the tunnelling
 * a straight-line stepper has against a machine covering three yards a tick.
 */
export interface RealmRacersShell {
  ownerPid: number;
  /** Impact point, world coordinates on this race's copy of the circuit. */
  x: number;
  z: number;
  impactTick: number;
}

interface RealmRacersReturn {
  x: number;
  z: number;
  facing: number;
  mountKey: string;
}

export interface RealmRacersMatch {
  id: number;
  pids: [number, number];
  phase: RealmRacersPhase;
  goTick: number;
  deadlineTick: number;
  finishTick: number | null;
  winnerPid: number | null;
  forfeiterPid: number | null;
  returns: Map<number, RealmRacersReturn>;
  preMatchPools: Map<number, ArenaReturnPools>;
  progress: Map<number, RealmRacersProgress>;
  shells: RealmRacersShell[];
  /** Last tick each racer PAIR announced a bump, keyed by pair index, so the
   *  throttle is per pair rather than per match and a bigger grid keeps one
   *  duel from silencing another. */
  bumpTicks: Map<number, number>;
  /**
   * Which COPY of the circuit this race runs on, as the offset every geometry
   * read adds: {0, 0} for the one public circuit, a far z offset for a private
   * practice copy (see `realmRacersSlotOffset`). Carrying it on the match
   * rather than reading a module constant is what lets practice laps run in
   * parallel with the public race and with each other.
   */
  origin: RallyPoint;
  /** Set for a private practice race: whose it is, and which copy it holds. */
  practice: { ownerPid: number; slot: number } | null;
  /** How many laps this race runs. Practice is longer than the public race. */
  totalLaps: number;
}

export interface RealmRacersState {
  queue: number[];
  /** The one PUBLIC race, on circuit copy 0: what the queue pairs into. */
  match: RealmRacersMatch | null;
  /**
   * Private practice races, each on its own copy of the whole circuit. They are
   * independent of the public slot in both directions: a queued race never
   * blocks a practice lap, and a practice lap never blocks a queued race.
   */
  practices: RealmRacersMatch[];
  nextMatchId: number;
  /**
   * The house pilots currently in the world, and the tier each drives at. ONE
   * marker for "this player is a bot" (the Vale Cup's `botPids` with the tier
   * carried alongside, so no second structure has to be kept in step), read by
   * the bot module to steer and reap them, by `racerInfo` to label the
   * opponent, and by every social surface that must exclude them.
   */
  bots: Map<number, RallyDriverTier>;
  /** Tick each queued pid joined, so a lone racer can be backfilled after a
   *  wait. Kept beside the queue rather than in it: the queue is a plain FIFO
   *  of pids and every reader of it depends on that. */
  queuedAtTick: Map<number, number>;
}

export function createRealmRacersState(): RealmRacersState {
  return {
    queue: [],
    match: null,
    practices: [],
    nextMatchId: 1,
    bots: new Map(),
    queuedAtTick: new Map(),
  };
}

function matchHas(match: RealmRacersMatch | null, pid: number): boolean {
  return !!match && (match.pids[0] === pid || match.pids[1] === pid);
}

/** Every live race, public first. The order is the tick order and the search
 *  order; nothing else depends on it. */
export function realmRacersMatches(ctx: SimContext): RealmRacersMatch[] {
  const rally = ctx.realmRacers;
  return rally.match ? [rally.match, ...rally.practices] : [...rally.practices];
}

/**
 * The race this pid is seated in, public or practice. Every per-racer surface
 * (the HUD readout, the shell, forfeiting, the return position, the countdown
 * lock) resolves through this, so a practice lap plays exactly like the real
 * race rather than like a second, lesser mode.
 */
export function realmRacersMatchOf(ctx: SimContext, pid: number): RealmRacersMatch | null {
  const rally = ctx.realmRacers;
  if (matchHas(rally.match, pid)) return rally.match;
  return rally.practices.find((m) => matchHas(m, pid)) ?? null;
}

/** A free practice copy of the circuit, or -1 when every one is in use. Copy 0
 *  is the public circuit and is never handed out. */
export function realmRacersFreePracticeSlot(ctx: SimContext): number {
  const used = new Set(ctx.realmRacers.practices.map((m) => m.practice?.slot));
  for (let slot = 1; slot <= REALM_RACERS_PRACTICE_SLOTS; slot++) {
    if (!used.has(slot)) return slot;
  }
  return -1;
}

function eligible(ctx: SimContext, pid: number): boolean {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (!meta || !e || meta.leaving || e.dead || e.ghost) return false;
  if (e.pos.x > DUNGEON_X_THRESHOLD) return false;
  if (ctx.arenaMatches.has(pid) || isArenaQueued(ctx, pid)) return false;
  if (ctx.vcupSeatedOrQueued(pid)) return false;
  if (ctx.duels.has(pid) || ctx.trades.has(pid)) return false;
  if (ctx.cardDuelQueue.includes(pid) || ctx.cardDuels.has(pid)) return false;
  return realmRacersMatchOf(ctx, pid) === null;
}

export function realmRacersSeatedOrQueued(ctx: SimContext, pid: number): boolean {
  return ctx.realmRacers.queue.includes(pid) || realmRacersMatchOf(ctx, pid) !== null;
}

export function realmRacersQueueJoin(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const id = r.meta.entityId;
  if (realmRacersSeatedOrQueued(ctx, id)) return;
  if (!eligible(ctx, id)) return;
  ctx.realmRacers.queue.push(id);
  ctx.realmRacers.queuedAtTick.set(id, ctx.tickCount);
  ctx.emit({
    type: 'realmRacersQueued',
    position: ctx.realmRacers.queue.length,
    pid: id,
  });
}

export function realmRacersQueueLeave(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  const id = r?.meta.entityId ?? pid;
  if (id === undefined) return;
  const index = ctx.realmRacers.queue.indexOf(id);
  if (index < 0) return;
  ctx.realmRacers.queue.splice(index, 1);
  ctx.realmRacers.queuedAtTick.delete(id);
  ctx.emit({ type: 'realmRacersUnqueued', pid: id });
}

/**
 * Take a pid out of the queue WITHOUT announcing it. The bot module uses it on
 * the two paths that seat a waiting racer rather than dropping them: the online
 * backfill and a Practice start from the queue. Announcing "you left the queue"
 * to someone who is being put on the grid this same tick would be a lie.
 */
export function realmRacersQueueRemove(ctx: SimContext, pid: number): void {
  const index = ctx.realmRacers.queue.indexOf(pid);
  if (index >= 0) ctx.realmRacers.queue.splice(index, 1);
  ctx.realmRacers.queuedAtTick.delete(pid);
}

/**
 * A world point on this race's copy of the circuit, expressed in the CANONICAL
 * frame the spline and the gates are authored in. Every geometry read in this
 * module goes through here (or its inverse below), which is the whole of what
 * makes a practice copy work.
 */
export function realmRacersToCanonical(match: RealmRacersMatch, x: number, z: number) {
  return { x: x - match.origin.x, z: z - match.origin.z };
}

/** The inverse: a canonical point placed on this race's copy. */
export function realmRacersToWorld(match: RealmRacersMatch, x: number, z: number) {
  return { x: x + match.origin.x, z: z + match.origin.z };
}

/** Reprojects a racer onto the circuit, refreshing the search hint and returning
 *  the projection for the caller's own use. */
function reproject(match: RealmRacersMatch, pid: number, e: Entity) {
  const progress = match.progress.get(pid) as RealmRacersProgress;
  const local = realmRacersToCanonical(match, e.pos.x, e.pos.z);
  const projection = realmRacersTrack().project(local.x, local.z, progress.trackIndex);
  progress.trackIndex = projection.index;
  return projection;
}

function seedProgress(match: RealmRacersMatch, pid: number, e: Entity): void {
  const progress = match.progress.get(pid) as RealmRacersProgress;
  const projection = reproject(match, pid, e);
  const lapLength = realmRacersTrack().length;
  progress.lastS = projection.s;
  progress.travelled = travelledFromArc(progress.lap, projection.s, lapLength);
}

function placeRacer(ctx: SimContext, match: RealmRacersMatch, e: Entity, slot: number): void {
  const start = realmRacersStarts()[slot];
  const grid = realmRacersToWorld(match, start.x, start.z);
  e.pos = ctx.groundPos(grid.x, grid.z);
  e.prevPos = { ...e.pos };
  e.facing = start.facing;
  e.mountKey = REALM_RACERS_MOUNT_KEY;
  e.mountCastKey = '';
  e.mountCastRemaining = 0;
  ctx.recalcPlayer(e);
  ctx.rebucket(e);
}

/**
 * Publish the weapon slot's remaining uses onto the entity's shared charge pool,
 * which is what the action bar draws the badge from and what the wire already
 * ships (`achg`). `fixed` is the whole point of the record: it marks the pool a
 * per-race BUDGET, so the recharge tick leaves it alone and the cast gate can
 * tell "spent out" from "cooling down".
 */
function publishWeaponCharges(e: Entity, held: RealmRacersWeaponSlot | null): void {
  if (!held || held.charges === null) return;
  e.abilityCharges ??= {};
  e.abilityCharges[held.abilityId] = {
    charges: held.charges,
    maxCharges: realmRacersWeaponCharges(held.abilityId) ?? held.charges,
    recharge: 0,
    rechargeLength: 0,
    fixed: true,
  };
}

function standardizeRacer(
  ctx: SimContext,
  match: RealmRacersMatch,
  meta: PlayerMeta,
  e: Entity,
): void {
  stowPetForDelve(ctx, meta.entityId);
  meta.realmRacersMatchId = match.id;
  const held = match.progress.get(meta.entityId)?.heldWeapon ?? null;
  meta.known = held ? resolveRealmRacersKit(held.abilityId, held.charges) : [];
  meta.wireRev++;
  // Behind the wheel: the movement kernel drives anyone carrying this, so it is
  // handed out exactly here and taken back in restoreRacer.
  e.drive = createVehicleDrive(REALM_RACERS_VEHICLE_KEY);
  // After the reset, never before: it clears the charge pools outright.
  ctx.resetForArena(e);
  publishWeaponCharges(e, held);
}

function restoreRacer(ctx: SimContext, match: RealmRacersMatch, meta: PlayerMeta, e: Entity): void {
  const ret = match.returns.get(meta.entityId);
  meta.realmRacersMatchId = null;
  meta.known = abilitiesKnownAt(meta.cls, e.level, ctx.playerMods(meta));
  meta.wireRev++;
  e.mountKey = ret?.mountKey ?? '';
  e.drive = null;
  e.mountCastKey = '';
  e.mountCastRemaining = 0;
  ctx.resetForArena(e);
  const pools = match.preMatchPools.get(meta.entityId);
  if (pools) {
    e.cooldowns = new Map(pools.cooldowns);
    e.abilityCharges =
      Object.keys(pools.abilityCharges).length > 0
        ? cloneAbilityCharges(pools.abilityCharges)
        : undefined;
    e.ccDr = cloneCcDr(pools.ccDr);
    e.hp = Math.max(0, Math.min(pools.hp, e.maxHp));
    e.resource = Math.max(0, Math.min(pools.resource, e.maxResource));
  }
  restorePetFromDelveStash(ctx, meta.entityId);
  if (ret) {
    e.pos = ctx.groundPos(ret.x, ret.z);
    e.prevPos = { ...e.pos };
    e.facing = ret.facing;
    ctx.rebucket(e);
    ctx.emit({ type: 'respawn', pid: meta.entityId });
  }
}

/** A private practice race's identity: whose it is, and which copy of the
 *  circuit it holds for the duration. */
export interface RealmRacersPracticeSeat {
  ownerPid: number;
  slot: number;
}

/**
 * Seat two pilots and drop the flag. Exported because the bot module starts a
 * match without going through the queue at all (the Practice button races you
 * immediately, and the online backfill pairs a lone waiter with a house pilot);
 * `tryMatch` below is the queue's own caller.
 *
 * With no `practice` seat this claims the ONE public circuit and refuses if it
 * is taken; with one it runs on that private copy and refuses nothing, which is
 * what keeps a practice lap independent of everyone else's race.
 *
 * Returns false and changes nothing when it cannot seat them, so the caller can
 * put them back.
 */
export function realmRacersStartMatch(
  ctx: SimContext,
  aPid: number,
  bPid: number,
  practice?: RealmRacersPracticeSeat,
): boolean {
  return startMatch(ctx, aPid, bPid, practice);
}

function startMatch(
  ctx: SimContext,
  aPid: number,
  bPid: number,
  practice?: RealmRacersPracticeSeat,
): boolean {
  // The public circuit is a single slot; a practice copy is claimed by its
  // caller and is nobody else's to take.
  if (!practice && ctx.realmRacers.match) return false;
  if (!eligible(ctx, aPid) || !eligible(ctx, bPid)) return false;
  const a = ctx.entities.get(aPid);
  const b = ctx.entities.get(bPid);
  const aMeta = ctx.players.get(aPid);
  const bMeta = ctx.players.get(bPid);
  if (!a || !b || !aMeta || !bMeta) return false;
  const profile = vehicleProfile(REALM_RACERS_VEHICLE_KEY);
  const id = ctx.realmRacers.nextMatchId++;
  const returns = new Map<number, RealmRacersReturn>();
  const pools = new Map<number, ArenaReturnPools>();
  for (const pid of [aPid, bPid]) {
    const e = ctx.entities.get(pid) as Entity;
    returns.set(pid, {
      x: e.pos.x,
      z: e.pos.z,
      facing: e.facing,
      mountKey: e.mountKey,
    });
    pools.set(pid, snapshotArenaReturnPools(e));
  }
  const match: RealmRacersMatch = {
    id,
    pids: [aPid, bPid],
    phase: 'countdown',
    goTick: ctx.tickCount + REALM_RACERS_COUNTDOWN_TICKS,
    deadlineTick: ctx.tickCount + REALM_RACERS_COUNTDOWN_TICKS + REALM_RACERS_TIME_LIMIT_TICKS,
    finishTick: null,
    winnerPid: null,
    forfeiterPid: null,
    returns,
    preMatchPools: pools,
    progress: new Map(
      [aPid, bPid].map((pid) => [
        pid,
        {
          lap: 1,
          finishedTick: null,
          trackIndex: 0,
          lastS: 0,
          distanceSinceWrap: 0,
          travelled: 0,
          heldWeapon: {
            abilityId: profile.weaponAbilityId,
            charges: realmRacersWeaponCharges(profile.weaponAbilityId),
          },
          shellShockUntilTick: 0,
        },
      ]),
    ),
    shells: [],
    bumpTicks: new Map(),
    origin: practice ? realmRacersSlotOffset(practice.slot) : { x: 0, z: 0 },
    practice: practice ? { ownerPid: practice.ownerPid, slot: practice.slot } : null,
    totalLaps: practice ? REALM_RACERS_PRACTICE_LAPS : REALM_RACERS_LAPS,
  };
  if (practice) ctx.realmRacers.practices.push(match);
  else ctx.realmRacers.match = match;
  standardizeRacer(ctx, match, aMeta, a);
  standardizeRacer(ctx, match, bMeta, b);
  placeRacer(ctx, match, a, 0);
  placeRacer(ctx, match, b, 1);
  // Seed the ranking key from the grid so the HUD reads the right order during
  // the countdown, before the first racing tick reprojects anyone.
  seedProgress(match, aPid, a);
  seedProgress(match, bPid, b);
  for (const [pid, opponentPid] of [
    [aPid, bPid],
    [bPid, aPid],
  ] as const) {
    ctx.emit({
      type: 'realmRacersFound',
      matchId: id,
      opponentName: ctx.players.get(opponentPid)?.name ?? '',
      countdownTicks: REALM_RACERS_COUNTDOWN_TICKS,
      pid,
    });
  }
  return true;
}

function endMatch(
  ctx: SimContext,
  match: RealmRacersMatch,
  winnerPid: number | null,
  forfeiterPid: number | null,
): void {
  if (match.phase === 'finished') return;
  match.phase = 'finished';
  match.finishTick = ctx.tickCount;
  match.winnerPid = winnerPid;
  match.forfeiterPid = forfeiterPid;
  match.shells.length = 0;
  const winnerName = winnerPid === null ? '' : (ctx.players.get(winnerPid)?.name ?? '');
  for (const pid of match.pids) {
    ctx.emit({
      type: 'realmRacersResult',
      won: winnerPid === pid,
      forfeited: forfeiterPid === pid,
      winnerName,
      returnTicks: REALM_RACERS_RETURN_TICKS,
      pid,
    });
  }
}

function teardownMatch(ctx: SimContext, match: RealmRacersMatch): void {
  for (const pid of match.pids) {
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (meta && e) restoreRacer(ctx, match, meta, e);
  }
  if (ctx.realmRacers.match === match) ctx.realmRacers.match = null;
  // Free the practice copy for the next player. Its house pilot is reaped by
  // the bot module on the same tick, by its own "not seated anywhere" rule.
  const practiceIndex = ctx.realmRacers.practices.indexOf(match);
  if (practiceIndex >= 0) ctx.realmRacers.practices.splice(practiceIndex, 1);
}

export function realmRacersForfeit(
  ctx: SimContext,
  pid?: number,
  restoreImmediately = false,
): void {
  const id = ctx.resolve(pid)?.meta.entityId ?? pid;
  if (id === undefined) return;
  realmRacersQueueLeave(ctx, id);
  const match = realmRacersMatchOf(ctx, id);
  if (!match) return;
  const winnerPid = match.pids[0] === id ? match.pids[1] : match.pids[0];
  endMatch(ctx, match, ctx.players.has(winnerPid) ? winnerPid : null, id);
  // A disconnect must restore the persisted character before the host saves
  // it. A voluntary forfeit keeps the result tableau visible for the normal
  // six-second victory lap before returning both pilots.
  if (restoreImmediately) teardownMatch(ctx, match);
}

export function realmRacersReturnFor(
  ctx: SimContext,
  pid: number,
): { x: number; z: number; facing: number } | null {
  const ret = realmRacersMatchOf(ctx, pid)?.returns.get(pid);
  return ret ? { x: ret.x, z: ret.z, facing: ret.facing } : null;
}

/**
 * Fire the held weapon at the ground point the pilot aimed at. The cast that got
 * here has already paid its cooldown, so a shot the PHASE gate refuses (a
 * trigger pull on the grid, or after the flag) costs no charge; the empty-slot
 * refusal happens earlier, in the cast gate, where it can be told apart from a
 * cooldown.
 *
 * `castAim` is where the client's reticle was, already clamped to the ability's
 * range by the shared cast path and clamped AGAIN here to the shell's own cone
 * and range band. The second clamp is the load-bearing one: the aim is a wire
 * value, so a cheat client could otherwise drop a shell anywhere on the circuit.
 */
export function realmRacersFireShell(ctx: SimContext, caster: Entity): void {
  const match = realmRacersMatchOf(ctx, caster.id);
  if (!match || match.phase !== 'racing' || caster.dead) return;
  const progress = match.progress.get(caster.id);
  const held = progress?.heldWeapon;
  if (!held || held.charges === 0) return;
  const aim = resolveShellAim(
    { x: caster.pos.x, z: caster.pos.z, facing: caster.facing },
    caster.castAim,
  );
  if (held.charges !== null) {
    held.charges--;
    publishWeaponCharges(caster, held);
  }
  match.shells.push({
    ownerPid: caster.id,
    x: aim.x,
    z: aim.z,
    impactTick: ctx.tickCount + aim.flightTicks,
  });
  ctx.emit({
    type: 'realmRacersShellFired',
    sourceId: caster.id,
    x: caster.pos.x + Math.sin(caster.facing) * 2,
    z: caster.pos.z + Math.cos(caster.facing) * 2,
    targetX: aim.x,
    targetZ: aim.z,
    flightSeconds: aim.flightTicks / TICK_RATE,
  });
}

/**
 * Land every shell whose tick has come. The blast catches EVERY racer inside it,
 * not one nominated target, so a shell dropped between two machines fighting
 * over a corner throws both.
 *
 * The caster is the one exclusion. The geometric argument for including them
 * (the minimum range is wider than the blast) only holds for a caster standing
 * still: at 58 yd/s a pilot drives through their own impact point long before it
 * lands, and shooting yourself in the back is frustration, not a mechanic.
 */
function tickShells(ctx: SimContext, match: RealmRacersMatch): void {
  for (let i = match.shells.length - 1; i >= 0; i--) {
    const shell = match.shells[i];
    if (ctx.tickCount < shell.impactTick) continue;
    match.shells.splice(i, 1);
    let nearestPid: number | null = null;
    let nearestImpact = 0;
    for (const pid of match.pids) {
      if (pid === shell.ownerPid) continue;
      const racer = ctx.entities.get(pid);
      if (!racer?.drive || racer.dead) continue;
      const blast = resolveShellBlast(
        { x: racer.pos.x, z: racer.pos.z, facing: racer.facing, drive: racer.drive },
        shell.x,
        shell.z,
      );
      if (blast.falloff <= 0) continue;
      // The pop rides the entity's own air pass, so the machine really leaves
      // the ground and comes back down under the same gravity a jump uses. The
      // fall origin is re-anchored here or a stale one would bill the landing
      // for a drop the shell never caused.
      racer.vy += blast.pop;
      racer.onGround = false;
      racer.fallStartY = racer.pos.y;
      const progress = match.progress.get(pid);
      if (progress) progress.shellShockUntilTick = ctx.tickCount + SHELL_SHOCK_TICKS;
      ctx.applyAura(racer, {
        id: REALM_RACERS_SHELL_AURA,
        name: 'Arc Shell',
        kind: 'slow',
        remaining: SHELL_CONTROL_SECONDS,
        duration: SHELL_CONTROL_SECONDS,
        value: SHELL_CONTROL_SPEED_MULT,
        sourceId: shell.ownerPid,
        school: 'physical',
      });
      if (blast.falloff > nearestImpact) {
        nearestImpact = blast.falloff;
        nearestPid = pid;
      }
    }
    // Announced whether or not it caught anyone: a shot that lands on empty
    // track still craters, and that crater is most of the feedback the first
    // version was missing.
    ctx.emit({
      type: 'realmRacersShellHit',
      sourceId: shell.ownerPid,
      targetId: nearestPid,
      x: shell.x,
      z: shell.z,
      impact: nearestImpact,
    });
  }
}

/** The contact body behind a seated racer: its live pose plus the two numbers
 *  the profile owns (the SAME radius the movement kernel sweeps, and the mass
 *  the shove is split by). */
function contactBodyFor(racer: Entity, drive: VehicleDrive): ContactBody {
  const profile = vehicleProfile(drive.profileKey);
  return {
    x: racer.pos.x,
    z: racer.pos.z,
    facing: racer.facing,
    drive,
    radius: profile.bodyRadius,
    mass: profile.mass,
  };
}

/** Move a bumped racer to where the contact put it, THROUGH static collision:
 *  a shove into the garden wall has to slide along the wall, never through it,
 *  and the swept resolve from the pre-bump position is what guarantees it. */
function settleContact(ctx: SimContext, racer: Entity, body: ContactBody): void {
  const settled = ctx.resolveMove(racer.pos.x, racer.pos.z, body.x, body.z, body.radius, racer);
  racer.pos.x = settled.x;
  racer.pos.z = settled.z;
  // The spatial grid is bucketed by position and read for the rest of the tick.
  ctx.rebucket(racer);
}

/**
 * Wheel-to-wheel contact between racers. Written as a loop over every unordered
 * PAIR rather than as "A versus B", so a four-pilot grid is a longer `pids`
 * array and nothing else.
 *
 * It runs at the END of the tick, which is exactly where it has to: the
 * per-player movement loop ran earlier in this same tick, so both machines have
 * already moved and this pass corrects their final positions. Unlike the
 * surface multipliers above there is no tick of lag, and unlike a new tick
 * phase there is no reordering: this draws zero rng, like the rest of the
 * module.
 *
 * The test is a discrete overlap, not a swept one, which is the right trade for
 * racers travelling the same way around a circuit (their closing speed is a few
 * yards per second, far under the body width one tick covers). Two machines
 * meeting head-on at full speed can still pass through each other in the 50 ms
 * between ticks; a wrong-way racer is workstream 07's problem, not a reason to
 * sweep every pair every tick.
 */
function tickContacts(ctx: SimContext, match: RealmRacersMatch): void {
  for (let i = 0; i < match.pids.length; i++) {
    for (let j = i + 1; j < match.pids.length; j++) {
      const a = ctx.entities.get(match.pids[i]);
      const b = ctx.entities.get(match.pids[j]);
      if (!a?.drive || !b?.drive || a.dead || b.dead) continue;
      const bodyA = contactBodyFor(a, a.drive);
      const bodyB = contactBodyFor(b, b.drive);
      const contact = resolveVehicleContact(bodyA, bodyB);
      if (!contact.contacted) continue;
      settleContact(ctx, a, bodyA);
      settleContact(ctx, b, bodyB);
      if (contact.impact < REALM_RACERS_BUMP_EVENT_MIN_IMPACT) continue;
      const pair = i * match.pids.length + j;
      const last = match.bumpTicks.get(pair);
      if (last !== undefined && ctx.tickCount - last < REALM_RACERS_BUMP_EVENT_TICKS) continue;
      match.bumpTicks.set(pair, ctx.tickCount);
      ctx.emit({
        type: 'realmRacersBump',
        aId: a.id,
        bId: b.id,
        x: contact.x,
        z: contact.z,
        impact: contact.impact,
      });
    }
  }
}

/**
 * How far past the road edge a racer is, and therefore what it costs. Leaving
 * the circuit is a PENALTY, not a wall: the garden's perimeter is the only hard
 * stop on the whole circuit, and everything inside it is drivable at a price.
 * Returns null while the racer is still on the road.
 *
 * Water is the exception in degree, not in kind: it is another band, just the
 * harshest one, and the racer cannot get more than a wading margin into it
 * because `resolveRealmRacersWade` holds them out of the rest.
 */
function offTrackBand(projection: RallyProjection): RealmRacersSlowBand | null {
  const track = realmRacersTrack();
  // The road narrows and widens around the lap, so track limits follow the
  // LOCAL half-width rather than one fixed distance.
  const over = Math.abs(projection.lateral) - track.halfWidthAt(projection.s);
  if (over <= REALM_RACERS_VERGE_MARGIN) return null;
  if (over <= REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH) {
    return REALM_RACERS_VERGE_BAND;
  }
  // Only the infield side has water; outward is garden all the way to the wall.
  return projection.lateral > rallyBasinEdgeOffsetAt(projection.s)
    ? REALM_RACERS_WATER_BAND
    : REALM_RACERS_GARDEN_BAND;
}

/**
 * Hand the driving model the surface under the machine. The road is the neutral
 * 1/1; every off-track band is looser and draggier than it, and a shell shock
 * cuts whatever grip is left on top of that.
 *
 * The shock rides the SURFACE seam rather than a mechanism of its own precisely
 * because this is already rewritten every tick: a shocked machine on the grass
 * is simply both, and the shock expires by the tick clock with nothing to clean
 * up.
 */
function applyVehicleSurface(
  racer: Entity,
  band: RealmRacersSlowBand | null,
  shocked: boolean,
): void {
  if (!racer.drive) return;
  racer.drive.gripMult = (band ? band.gripMult : 1) * (shocked ? SHELL_SHOCK_GRIP : 1);
  racer.drive.dragMult = band ? band.dragMult : 1;
  // The band's speed loss rides its slow AURA, which the kernel already folds
  // into the top speed, so the surface cap stays neutral and nothing is charged
  // twice. The knob exists for a surface that should cap speed WITHOUT a
  // visible debuff.
  racer.drive.speedCap = 1;
}

function tickTrackLimits(ctx: SimContext, match: RealmRacersMatch): void {
  for (const pid of match.pids) {
    const racer = ctx.entities.get(pid);
    if (!racer) continue;
    const band = offTrackBand(reproject(match, pid, racer));
    const shockUntil = match.progress.get(pid)?.shellShockUntilTick ?? 0;
    applyVehicleSurface(racer, band, ctx.tickCount < shockUntil);
    const existing = racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);
    if (!band) {
      if (existing) racer.auras = racer.auras.filter((aura) => aura !== existing);
      continue;
    }
    // Deeper is slower, and stepping back toward the road relaxes it again on
    // the same tick, so the penalty tracks where the racer actually is.
    if (existing) {
      existing.remaining = existing.duration;
      existing.value = band.speedMult;
      existing.name = band.name;
      continue;
    }
    ctx.applyAura(racer, {
      id: REALM_RACERS_OFF_TRACK_AURA,
      name: band.name,
      kind: 'slow',
      remaining: 0.2,
      duration: 0.2,
      value: band.speedMult,
      sourceId: racer.id,
      school: 'physical',
    });
  }
}

interface FinishCandidate {
  pid: number;
  fraction: number;
  slot: number;
}

function tickProgress(ctx: SimContext, match: RealmRacersMatch): void {
  const lapLength = realmRacersTrack().length;
  const finishers: FinishCandidate[] = [];
  for (let slot = 0; slot < match.pids.length; slot++) {
    const pid = match.pids[slot];
    const e = ctx.entities.get(pid);
    const progress = match.progress.get(pid);
    if (!e || !progress || progress.finishedTick !== null) continue;
    const projection = reproject(match, pid, e);
    const step = stepRealmRacersProgress({
      lap: progress.lap,
      lastS: progress.lastS,
      s: projection.s,
      distanceSinceWrap: progress.distanceSinceWrap,
      lapLength,
      totalLaps: match.totalLaps,
    });
    progress.lap = step.lap;
    progress.lastS = step.lastS;
    progress.distanceSinceWrap = step.distanceSinceWrap;
    progress.travelled = step.travelled;
    if (!step.wrapped) continue;
    if (step.finished) {
      progress.finishedTick = ctx.tickCount;
      finishers.push({ pid, fraction: step.finishFraction ?? 1, slot });
    } else {
      ctx.emit({
        type: 'realmRacersLap',
        lap: progress.lap,
        totalLaps: match.totalLaps,
        pid,
      });
    }
  }
  if (finishers.length === 0) return;
  finishers.sort((a, b) => a.fraction - b.fraction || a.slot - b.slot);
  endMatch(ctx, match, finishers[0].pid, null);
}

function pruneQueue(ctx: SimContext): void {
  const seen = new Set<number>();
  ctx.realmRacers.queue = ctx.realmRacers.queue.filter((pid) => {
    if (seen.has(pid) || !eligible(ctx, pid)) return false;
    seen.add(pid);
    return true;
  });
  // The wait clock follows the queue exactly, or a pid pruned out and re-queued
  // later would inherit its old join tick and be backfilled instantly.
  for (const pid of ctx.realmRacers.queuedAtTick.keys()) {
    if (!seen.has(pid)) ctx.realmRacers.queuedAtTick.delete(pid);
  }
}

function tryMatch(ctx: SimContext): void {
  if (ctx.realmRacers.match || ctx.realmRacers.queue.length < 2) return;
  const a = ctx.realmRacers.queue.shift() as number;
  const b = ctx.realmRacers.queue.shift() as number;
  if (!startMatch(ctx, a, b)) {
    if (eligible(ctx, a)) ctx.realmRacers.queue.unshift(a);
    if (eligible(ctx, b)) ctx.realmRacers.queue.unshift(b);
  }
}

export function updateRealmRacers(ctx: SimContext): void {
  pruneQueue(ctx);
  tryMatch(ctx);
  // The public race first, then each private practice copy. Every race runs the
  // SAME body: a practice lap is not a lesser mode with its own rules, it is the
  // race on a different copy of the circuit.
  for (const match of realmRacersMatches(ctx)) tickMatch(ctx, match);
}

function tickMatch(ctx: SimContext, match: RealmRacersMatch): void {
  for (const pid of match.pids) {
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (!meta || !e || meta.leaving || e.dead || e.ghost) {
      const winnerPid = match.pids[0] === pid ? match.pids[1] : match.pids[0];
      endMatch(ctx, match, ctx.players.has(winnerPid) ? winnerPid : null, pid);
      teardownMatch(ctx, match);
      return;
    }
    if (e.mountKey !== REALM_RACERS_MOUNT_KEY) {
      e.mountKey = REALM_RACERS_MOUNT_KEY;
      e.mountCastKey = '';
      e.mountCastRemaining = 0;
      ctx.recalcPlayer(e);
    }
    // Anything that can strip a mount can strip the wheel with it (a death, a
    // forced dismount); a racer without a drive state would silently revert to
    // running, so re-seat it the same way the mount is re-forced.
    if (!e.drive) e.drive = createVehicleDrive(REALM_RACERS_VEHICLE_KEY);
    // Held on the grid before the flag, and again in the finished tableau: the
    // controls are the Society's, not the pilot's. Written every tick and read
    // by the CAST gate, so a trigger pull outside the race arms no cooldown and
    // the action bar can grey the slot rather than pretending it is ready.
    e.drive.controlsLocked = match.phase !== 'racing';
  }

  if (match.phase === 'countdown') {
    // The start lock is real: Sim.updatePlayerMovement returns before the
    // kernel runs. Zero the machine anyway, every countdown tick, so nothing
    // (a queued input, a bump on the grid) can bank speed before GO.
    for (const pid of match.pids) {
      const drive = ctx.entities.get(pid)?.drive;
      if (drive) resetVehicleDrive(drive);
    }
    if (ctx.tickCount >= match.goTick) {
      match.phase = 'racing';
      for (const pid of match.pids) ctx.emit({ type: 'realmRacersGo', pid });
    }
    return;
  }
  if (match.phase === 'finished') {
    if (
      match.finishTick !== null &&
      ctx.tickCount - match.finishTick >= REALM_RACERS_RETURN_TICKS
    ) {
      teardownMatch(ctx, match);
    }
    return;
  }
  if (ctx.tickCount >= match.deadlineTick) {
    const ranked = [...match.pids].sort((a, b) => {
      const pa = match.progress.get(a) as RealmRacersProgress;
      const pb = match.progress.get(b) as RealmRacersProgress;
      return pb.travelled - pa.travelled || match.pids.indexOf(a) - match.pids.indexOf(b);
    });
    const first = match.progress.get(ranked[0]) as RealmRacersProgress;
    const second = match.progress.get(ranked[1]) as RealmRacersProgress;
    const winner =
      first.travelled - second.travelled < REALM_RACERS_DEAD_HEAT_YARDS ? null : ranked[0];
    endMatch(ctx, match, winner, null);
    return;
  }
  // Contact FIRST: the progress test reads the segment from where a racer was
  // to where it ended the tick, so the shove has to be part of that segment
  // rather than an unrecorded correction applied after the line was judged.
  // (Only the racing phase reaches here: the countdown and finished arms return
  // above, which is also what keeps a nudge on the grid from doing anything.)
  tickContacts(ctx, match);
  tickProgress(ctx, match);
  if (match.phase === 'racing') {
    tickTrackLimits(ctx, match);
    tickShells(ctx, match);
  }
}

function racerInfo(ctx: SimContext, match: RealmRacersMatch, pid: number): RealmRacersRacerInfo {
  const p = match.progress.get(pid) as RealmRacersProgress;
  return {
    pid,
    name: ctx.players.get(pid)?.name ?? '',
    lap: Math.min(match.totalLaps, p.lap),
    finished: p.finishedTick !== null,
    // Null for a human. A racer is told which they are up against: a practice
    // lap against a house pilot is not the same result as beating a player.
    botTier: ctx.realmRacers.bots.get(pid) ?? null,
  };
}

function matchInfoFor(ctx: SimContext, match: RealmRacersMatch, pid: number): RealmRacersMatchInfo {
  const opponentPid = match.pids[0] === pid ? match.pids[1] : match.pids[0];
  const me = match.progress.get(pid) as RealmRacersProgress;
  const opponent = match.progress.get(opponentPid) as RealmRacersProgress;
  const position: 1 | 2 =
    me.travelled > opponent.travelled ||
    (me.travelled === opponent.travelled &&
      match.pids.indexOf(pid) < match.pids.indexOf(opponentPid))
      ? 1
      : 2;
  const countdown =
    match.phase === 'countdown'
      ? Math.max(0, Math.ceil((match.goTick - ctx.tickCount) / TICK_RATE))
      : 0;
  const returnIn =
    match.phase === 'finished' && match.finishTick !== null
      ? Math.max(
          0,
          Math.ceil((REALM_RACERS_RETURN_TICKS - (ctx.tickCount - match.finishTick)) / TICK_RATE),
        )
      : 0;
  return {
    id: match.id,
    phase: match.phase,
    countdown,
    elapsed:
      match.phase === 'countdown'
        ? 0
        : Math.max(
            0,
            Math.floor((Math.min(ctx.tickCount, match.deadlineTick) - match.goTick) / TICK_RATE),
          ),
    returnIn,
    me: racerInfo(ctx, match, pid),
    opponent: racerInfo(ctx, match, opponentPid),
    position,
    totalLaps: match.totalLaps,
    // A practice lap is a real race on a private copy of the circuit, and the
    // readout says which it is rather than dressing one up as the other.
    practice: match.practice !== null,
    result:
      match.phase !== 'finished'
        ? null
        : match.forfeiterPid === pid
          ? 'forfeit'
          : match.winnerPid === pid
            ? 'won'
            : match.winnerPid === null
              ? 'draw'
              : 'lost',
  };
}

export function realmRacersInfoFor(ctx: SimContext, pid: number): RealmRacersInfo {
  const match = realmRacersMatchOf(ctx, pid);
  const queueIndex = ctx.realmRacers.queue.indexOf(pid);
  return {
    queued: queueIndex >= 0,
    queuePosition: queueIndex >= 0 ? queueIndex + 1 : 0,
    queueSize: ctx.realmRacers.queue.length,
    match: match ? matchInfoFor(ctx, match, pid) : null,
    // Practice runs on its own copy of the circuit, so nobody else's race can
    // ever block it. The only thing that can is the realm running out of copies,
    // and the client needs to be able to say so without the sim emitting a
    // sentence for it to re-localize.
    practiceAvailable: match === null && realmRacersFreePracticeSlot(ctx) > 0,
  };
}

/**
 * Is this racer held on the grid by the start countdown? The coordinator's
 * movement gate asks; keeping the answer here means the gate never has to know
 * which of the live races the racer is in.
 */
export function realmRacersCountdownLocked(ctx: SimContext, pid: number): boolean {
  return realmRacersMatchOf(ctx, pid)?.phase === 'countdown';
}
