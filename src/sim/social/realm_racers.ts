// The Realm Racers: a deterministic four-pilot vehicle race. This module owns
// the FIFO queue, the single instanced match, arc-length lap progress, finish
// arbitration (public and practice races may run different lap counts),
// straight-line Ground Blast projectiles, and the complete gameplay parenthesis
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
import {
  type RallyHeldSlot,
  REALM_RACERS_EFFECT_ABILITIES,
  realmRacersWeaponCharges,
  resolveRealmRacersKit,
} from '../content/realm_racers';
import {
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersCircuit,
  realmRacersCircuitById,
  realmRacersCompetitionCircuits,
} from '../content/realm_racers_circuits';
import { vehicleProfile } from '../content/vehicles';
import { abilitiesKnownAt, DUNGEON_X_THRESHOLD } from '../data';
import * as deedsMod from '../deeds';
import { restorePetFromDelveStash, stowPetForDelve } from '../pet/pet_commands';
import type { RallyDriverTier } from '../realm_racers_driver';
import {
  GROUND_BLAST_CONTROL_SECONDS,
  GROUND_BLAST_CONTROL_SPEED_MULT,
  GROUND_BLAST_SHOCK_GRIP,
  GROUND_BLAST_SHOCK_TICKS,
  groundBlastFalloff,
  resolveGroundBlastAim,
  resolveGroundBlastImpact,
} from '../realm_racers_ground_blast';
import {
  type RallyPoint,
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
  rallyGateCrossingFraction,
  realmRacersLaneOffset,
  realmRacersPracticeLanes,
  realmRacersPublicLane,
} from '../realm_racers_layout';
import {
  drawRallyPickupEffect,
  isRallyHeldEffect,
  type RallyHeldEffect,
  type RallyPickupEffect,
  REALM_RACERS_NITRO_KICK,
  REALM_RACERS_NITRO_SPEED_MULT,
  REALM_RACERS_NITRO_TICKS,
  rallyPickupBand,
} from '../realm_racers_pickup_effects';
import {
  createRealmRacersPickupState,
  type RallyPickupRacer,
  type RallyPickupState,
  REALM_RACERS_PICKUP_CHARGE_GRANT,
  REALM_RACERS_PICKUP_COOLDOWN_TICKS,
  realmRacersPickupBoxes,
  realmRacersPickupTakenIndices,
  stepRealmRacersPickups,
} from '../realm_racers_pickups';
import {
  forwardArcDelta,
  stepRealmRacersProgress,
  travelledFromArc,
} from '../realm_racers_progress';
import {
  type RallySlick,
  type RallySlickRacer,
  REALM_RACERS_SLICK_CAP,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_LIFETIME_TICKS,
  REALM_RACERS_SLICK_SLIP_CAP,
  realmRacersSlickThrow,
  stepRealmRacersSlicks,
} from '../realm_racers_slicks';
import {
  type RallyProjection,
  rallyForwardDot,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../realm_racers_spline';
import {
  type RallyStandingEntry,
  rallyClassification,
  rallyLeadIsDeadHeat,
} from '../realm_racers_standings';
import {
  noRallyExcursion,
  type RallyExcursion,
  REALM_RACERS_CUT_LOCK_TICKS,
  REALM_RACERS_CUT_NOTICE_TICKS,
  rallyLoiterCountdownTicks,
  stepRealmRacersTrackLimits,
} from '../realm_racers_track_limits';
import type { ArenaReturnPools, PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { type Entity, TICK_RATE, type VehicleDrive } from '../types';
import { type ContactBody, resolveVehicleContact } from '../vehicle_contact';
import {
  addVehicleSlip,
  createVehicleDrive,
  resetVehicleDrive,
  vehicleMaxSlip,
} from '../vehicle_motion';
import { cloneAbilityCharges, cloneCcDr, isArenaQueued, snapshotArenaReturnPools } from './arena';

/** The machine every pilot is loaned, as a VEHICLE_PROFILES key. A roster of
 *  machines is a later workstream. */
export const REALM_RACERS_VEHICLE_KEY = 'rally_loaner';

/** The mount visual that machine wears, mirrored onto Entity.mountKey. It is
 *  read off the profile rather than written here because the two are separate
 *  namespaces: Entity.mountKey is a bare string, so a stale literal would not
 *  fail to compile, it would just render a pilot with no machine under them. */
export const REALM_RACERS_MOUNT_KEY: string = vehicleProfile(REALM_RACERS_VEHICLE_KEY).key;
export const REALM_RACERS_COUNTDOWN_TICKS = 9 * TICK_RATE;
/**
 * How long the rest of the field has to get home once the WINNER is home.
 *
 * Without it the race runs to the 180 s limit whenever one pilot stops driving,
 * and three players who finished in forty seconds watch a result screen that
 * will not arrive for another two minutes. Thirty seconds is about a lap of
 * struggling off the racing line, so a real straggler still crosses the line
 * and takes their placing; only a machine nobody is driving runs the clock out.
 */
export const REALM_RACERS_CHASE_TICKS = 30 * TICK_RATE;
export const REALM_RACERS_RETURN_TICKS = 6 * TICK_RATE;
export const REALM_RACERS_RESET_LOCK_TICKS = 2 * TICK_RATE;
/**
 * The lock an AUTOMATIC recovery carries (the wedged-machine arm and the
 * referee's loiter verdict), ticks.
 *
 * One tick, not two seconds: automatic recovery has already charged its stop and
 * hands control straight back, so this is not a settle window. It exists because
 * every "was this driven into or teleported onto" guard in the rally is written
 * as `tickCount >= resetLockedUntilTick`, and a zero-tick lock leaves that field
 * at 0, which is the guard reading TRUE. A machine dropped on a pickup box or in
 * a patch of oil by a recovery would otherwise take it (or suffer it) on the next
 * tick, which is the reward-for-going-off-road shape the manual arm already
 * refuses.
 */
export const REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS = 1;
export const REALM_RACERS_STUCK_TICKS = 3 * TICK_RATE;
export const REALM_RACERS_WRONG_WAY_TICKS = Math.ceil(TICK_RATE / 2);
export const REALM_RACERS_STUCK_SPEED = 0.75;
/** The debuff an Ground Blast hit leaves in the victim's HUD aura row. */
export const REALM_RACERS_GROUND_BLAST_AURA = 'realm_racers_ground_blast_control';
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
 * The WARD a pickup box can grant, as a real aura on the racer.
 *
 * It is an aura and not a flag on the race's own bookkeeping (operator call,
 * 2026-08-04) for consistency with everything else the rally does to a machine:
 * the off-track bands and the Ground Blast control are auras, so a pilot reads
 * every state the race put on them in the same row of the same frame, a rival who
 * TARGETS them sees it there too, and it rides the ordinary entity aura wire with
 * no new field. `AuraKind` gains its own `rally_ward` marker rather than borrowing
 * one, because every existing kind carries mechanics a race must not inherit.
 *
 * The aura is the SOURCE OF TRUTH: the readout's `warded` flag is derived from
 * it, so the two can never disagree.
 */
export const REALM_RACERS_WARD_AURA = 'rally_ward';
const REALM_RACERS_WARD_AURA_NAME = 'Racing Ward';
/**
 * How long the ward is written for, seconds.
 *
 * The permanent-until-removed arm the aura system already supports (the Drowned
 * Litany's cantor shield is the precedent): the per-tick pass decrements
 * `remaining` and drops an aura at zero, so "until something spends it" is spelled
 * as a duration no race can outlive. The buff bar hides the countdown for this id
 * (`TOGGLE_IDS` in `src/ui/auras_view.ts`), so nobody is shown a three-hour clock
 * that decides nothing.
 */
export const REALM_RACERS_WARD_AURA_SECONDS = 9999;

/** Is this machine carrying a ward right now? The one question every ward site
 *  asks, so nothing re-implements the lookup. */
export function realmRacersWarded(racer: Entity | undefined | null): boolean {
  return !!racer?.auras.some((aura) => aura.id === REALM_RACERS_WARD_AURA);
}

/** Grant the ward. Refreshing an existing one is a no-op by construction: the
 *  draw that would have granted a second falls back to the refill instead. */
function applyRealmRacersWard(ctx: SimContext, racer: Entity): void {
  ctx.applyAura(racer, {
    id: REALM_RACERS_WARD_AURA,
    name: REALM_RACERS_WARD_AURA_NAME,
    kind: 'rally_ward',
    remaining: REALM_RACERS_WARD_AURA_SECONDS,
    duration: REALM_RACERS_WARD_AURA_SECONDS,
    // No stat effect at all: the value is unread, and the kind is a marker.
    value: 0,
    sourceId: racer.id,
    // Physical, so no dispel in the game can strip it (`isDispellableAura`
    // refuses a physical aura outright) and nothing treats it as magic.
    school: 'physical',
  });
}

/**
 * Spend the ward, if there is one. Returns whether it was there, which is the
 * whole of "did this absorb happen": the caller emits the announcement.
 */
function consumeRealmRacersWard(ctx: SimContext, racer: Entity): boolean {
  const index = racer.auras.findIndex((aura) => aura.id === REALM_RACERS_WARD_AURA);
  if (index < 0) return false;
  const name = racer.auras[index].name;
  racer.auras.splice(index, 1);
  // The fade event the buff bar and the aura log listen for, exactly as every
  // other removed aura emits it.
  ctx.emit({ type: 'aura', targetId: racer.id, name, gained: false });
  return true;
}

/**
 * The off-track bands. Leaving the circuit costs time, in proportion to how far
 * out you are: the mown verge is a nudge and the garden beyond it is a real
 * price. Two knobs, and pure FEEL: they were the only thing making a cut across
 * the infield slower than the road, back when a third (the basin's wading
 * margin) stood behind them, and the referee in `realm_racers_track_limits.ts`
 * does that job now. What they still have to hold is the ORDER, since further
 * out being slower is what makes running wide legible.
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
  /**
   * Where inside the crossing tick's segment this racer cut the line, 0 to 1.
   * Only read against another racer finishing on the SAME tick; 1 until then.
   */
  finishFraction: number;
  /**
   * Tick this racer quit under its own steam, a forfeit or a disconnect, or
   * null while they are still in the race. A quitter no longer hands anyone a
   * win: they are classified LAST and the race goes on without them.
   */
  retiredTick: number | null;
  /**
   * True once the gameplay parenthesis has been closed for this racer and they
   * stand back in the Evergarden. They stay on `match.pids`, because the grid a
   * race started with is the grid it is classified on, but nothing per-racer
   * resolves to this race for them any more.
   */
  returned: boolean;
  /** Last projected centerline sample: the search hint for the next tick. */
  trackIndex: number;
  lastS: number;
  distanceSinceWrap: number;
  /** Yards down the circuit, monotonic across laps; the live ranking key. */
  travelled: number;
  /** Ordered recovery-anchor state. It never replaces spline lap validation. */
  nextResetGate: number;
  resetS: number;
  resetLap: number;
  resetDistanceSinceWrap: number;
  /** Automatic recovery counter and manual post-teleport control lock. */
  stuckTicks: number;
  resetLockedUntilTick: number;
  /**
   * The live TRACK-LIMITS excursion (see `realm_racers_track_limits.ts`): where
   * this racer left the racing surface, how long ago, and how much ground they
   * have driven since. `exitS` null for the whole race until they leave it.
   */
  excursion: RallyExcursion;
  /** The lap bookkeeping AT that exit, restored verbatim when the referee sends
   *  a cutter back: a return must undo the gain, not bank it. */
  excursionLap: number;
  excursionDistanceSinceWrap: number;
  /** Tick the "you rejoin where you left" banner stands until; 0 when there is
   *  nothing to say. */
  cutReturnUntilTick: number;
  /** Sustained direction state exposed to the HUD. */
  wrongWayTicks: number;
  wrongWay: boolean;
  heldWeapon: RealmRacersWeaponSlot | null;
  /**
   * Tick this racer may take another pickup box on; 0 before the first one.
   *
   * The whole of the "one box per pass" rule: a row is crossed in well under a
   * second, so a machine that just took one cannot reach a second box of the
   * same row (`realm_racers_pickups.ts`).
   */
  pickupCooldownUntilTick: number;
  /**
   * Tick this racer's nitro burst expires on; 0 when they are not boosting.
   *
   * It rides the vehicle kernel's OWN speed ceiling (`VehicleDrive.speedCap`,
   * rewritten every tick by `applyVehicleSurface` like every other surface
   * fact), so a burst is simply a run of ticks where the ceiling stands above
   * the profile's maximum instead of on it.
   */
  nitroUntilTick: number;
  /**
   * The pickup effect this racer is HOLDING, or null with an empty slot.
   *
   * It is an ability on their action bar for as long as it sits here (the kit is
   * republished whenever this moves), and casting it is what spends it. While it
   * is full a box that draws another held effect falls back to the refill: no
   * overwrite, no double stock.
   */
  heldEffect: RallyHeldEffect | null;
  /**
   * The two halves of driving through oil, both ticks, both 0 before the first
   * patch. `slickContactUntilTick` is how long this racer's CONTACT is already
   * resolved for (a machine takes two or three ticks to cross a patch and that
   * is one event, one ward, one grip loss); `slickGripUntilTick` is how long the
   * grip is actually gone for, which a ward can leave at 0 by absorbing the
   * contact.
   */
  slickContactUntilTick: number;
  /** WHICH patch that contact deadline belongs to, or null before the first
   *  one. Keyed per patch rather than per racer so lingering in one slick can
   *  never buy immunity to a DIFFERENT one further down the road. */
  slickContactId: number | null;
  slickGripUntilTick: number;
  /**
   * DEV ONLY, and inert without `ctx.devCommands`: a stack of each held effect,
   * standing in for the one-charge slot above while it lasts.
   *
   * A pickup grants one charge, which is right for a race and useless for tuning
   * one: feeling a weapon means spending it lap after lap, and re-typing a chat
   * command between two crossings is not a thing anyone can do at 45 yd/s. Both
   * effects at once, because the bar reserves a key for each anyway, so a tuning
   * session never has to choose which half of the kit it is judging.
   *
   * Read at the ONE spend site behind the same gate that let it be set, so a
   * saved race can never carry it into a real one.
   */
  devHeldCharges: Record<RallyHeldEffect, number> | null;
  /** Tick the shell shock's grip loss expires on; 0 when the machine has not
   *  been hit. */
  groundBlastShockUntilTick: number;
  /** Tick the current lap began (reset to GO, and to every later lap wrap).
   *  Feeds the fast-lap deed; nothing else reads it. */
  lapStartTick: number;
  /** Deed-tracking state only, evaluated once at race end (docs/design/deeds.md):
   *  whether this racer ever left the racing surface (verge excepted) or
   *  traded a real bump with a rival, was ever hit by a Ground Blast, and was
   *  ever classified dead last while still driving. Draws no rng. */
  hadOffTrackContact: boolean;
  hadRivalContact: boolean;
  hitByShell: boolean;
  wasLastPlace: boolean;
}

/**
 * A shell in flight. It is not a moving point: the impact is decided at fire
 * time and the sim only has to know where and when. That is cheaper, it is what
 * lets one event carry the whole ground marker, and it removes the tunnelling
 * a straight-line stepper has against a machine covering three yards a tick.
 */
export interface RealmRacersGroundBlast {
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
  /**
   * Every pilot in frozen GRID order. Never mutated after seating: a pilot who
   * quits is marked retired in `progress` instead, so a disconnect cannot
   * renumber the grid and retroactively change what "Position 3/4" meant.
   */
  pids: number[];
  /** `pids.length` at seat time, frozen for the same reason. */
  gridSize: number;
  phase: RealmRacersPhase;
  goTick: number;
  deadlineTick: number;
  finishTick: number | null;
  winnerPid: number | null;
  /**
   * When the chase window shuts, or null until the winner is home. Armed once,
   * by the first racer to cross the line, so the rest of the field is racing a
   * clock that starts the moment there is something left to race for.
   */
  chaseUntilTick: number | null;
  /** Final classification, first to last. Empty until the race is decided. */
  finishOrder: number[];
  returns: Map<number, RealmRacersReturn>;
  preMatchPools: Map<number, ArenaReturnPools>;
  progress: Map<number, RealmRacersProgress>;
  groundBlasts: RealmRacersGroundBlast[];
  /**
   * The pickup boxes on THIS copy of the circuit: which of them have been taken
   * and which lap the leader was on when they were last put back.
   *
   * Per match rather than per circuit, which is what makes a practice lane's
   * boxes its own: two races on two copies of the same circuit share the
   * geometry (it is memoized content) and share nothing else.
   */
  pickups: RallyPickupState;
  /**
   * The oil slicks standing on THIS copy of the circuit, in the order they were
   * dropped (which is id order), plus the counter that names the next one.
   *
   * Per match for the same reason the boxes are: two practice lanes race two
   * copies of one circuit and share nothing but its geometry. Cleared when the
   * race ends, like the shells in flight.
   */
  slicks: RallySlick[];
  nextSlickId: number;
  /** Last tick each racer PAIR announced a bump, keyed by pair index, so the
   *  throttle is per pair rather than per match and a bigger grid keeps one
   *  duel from silencing another. */
  bumpTicks: Map<number, number>;
  /**
   * WHICH circuit this race is on, as a `REALM_RACERS_CIRCUITS` id. Every
   * geometry read resolves through it, so two races on different circuits can
   * run side by side in the same realm.
   */
  circuitId: string;
  /**
   * WHERE that circuit's copy sits, as the offset every geometry read adds:
   * {0, 0} for lane 0, a far z offset for any other lane (see
   * `realmRacersLaneOffset`). Carrying it on the match rather than reading a
   * module constant is what lets practice laps run in parallel with the public
   * race and with each other.
   */
  origin: RallyPoint;
  /** Set for a private practice race: whose it is, and which lane it holds. */
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

/** Roster membership: is this pid on that race's frozen grid at all? */
function matchHas(match: RealmRacersMatch | null, pid: number): boolean {
  return !!match && match.pids.includes(pid);
}

/**
 * Roster membership AND still inside the gameplay parenthesis. A racer who has
 * been returned to the Evergarden (they quit, or the race ended and their six
 * seconds of tableau are up) is still on `pids` for classification but must not
 * resolve to this race for anything per-racer: not the HUD readout, not the
 * mount re-forcing, not their eligibility to queue again.
 */
function matchSeats(match: RealmRacersMatch | null, pid: number): boolean {
  return matchHas(match, pid) && match?.progress.get(pid)?.returned === false;
}

/**
 * Is this racer still driving: neither across the line nor pulled off it.
 * Exported because the bot module asks it too, and a second copy of the rule in
 * the brain is a rule the race does not share.
 */
export function realmRacersStillRunning(match: RealmRacersMatch, pid: number): boolean {
  const progress = match.progress.get(pid);
  return !!progress && progress.finishedTick === null && progress.retiredTick === null;
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
  if (matchSeats(rally.match, pid)) return rally.match;
  return rally.practices.find((m) => matchSeats(m, pid)) ?? null;
}

/**
 * The circuit a race is on. Falls back to the practice circuit for an id no
 * longer authored, which is a shape a live realm can hit exactly once: a race
 * seated before a deploy that dropped its circuit.
 */
export function realmRacersCircuitOf(match: RealmRacersMatch): RealmRacersCircuit {
  return realmRacersCircuitById(match.circuitId) ?? REALM_RACERS_PRACTICE_CIRCUIT;
}

/** A free private lane of the practice circuit, or -1 when every one is in use.
 *  The public lane is never handed out. */
export function realmRacersFreePracticeSlot(ctx: SimContext): number {
  const used = new Set(ctx.realmRacers.practices.map((m) => m.practice?.slot));
  for (const lane of realmRacersPracticeLanes()) {
    if (!used.has(lane.index)) return lane.index;
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
  const projection = realmRacersTrack(realmRacersCircuitOf(match)).project(
    local.x,
    local.z,
    progress.trackIndex,
  );
  progress.trackIndex = projection.index;
  return projection;
}

function seedProgress(match: RealmRacersMatch, pid: number, e: Entity): void {
  const progress = match.progress.get(pid) as RealmRacersProgress;
  const projection = reproject(match, pid, e);
  const lapLength = realmRacersTrack(realmRacersCircuitOf(match)).length;
  progress.lastS = projection.s;
  progress.travelled = travelledFromArc(progress.lap, projection.s, lapLength);
  progress.resetS = projection.s;
  progress.resetLap = progress.lap;
  progress.resetDistanceSinceWrap = progress.distanceSinceWrap;
}

function placeRacer(ctx: SimContext, match: RealmRacersMatch, e: Entity, slot: number): void {
  const start = realmRacersStarts(realmRacersCircuitOf(match))[slot];
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
    // The pool's own ceiling, which nothing renders: the action bar draws its
    // denominator off the `KnownAbility` the kit resolver built, never off this
    // field. It is kept honest anyway (a pickup box adds charges with no cap, so
    // the race's budget can be exceeded) because a pool whose count sits above
    // its own max is a shape every future reader would have to special-case.
    maxCharges: Math.max(realmRacersWeaponCharges(held.abilityId) ?? held.charges, held.charges),
    recharge: 0,
    rechargeLength: 0,
    fixed: true,
  };
}

/**
 * Publish the HELD pickup effect as a one-charge ability, or take it away again.
 *
 * The whole of what makes a held effect castable: it rides the ordinary kit, so
 * the action bar places it, the keybinds reach it, the gamepad and the mobile
 * bar follow, and the cast goes down the same path the signature weapon's does.
 * Spending it removes the ability from `meta.known` rather than leaving a spent
 * button on the bar.
 */
function republishKit(ctx: SimContext, match: RealmRacersMatch, pid: number): void {
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  const progress = match.progress.get(pid);
  if (!meta || !e || !progress) return;
  const held = progress.heldWeapon;
  const slots = realmRacersHeldSlots(ctx, progress);
  meta.known = held ? resolveRealmRacersKit(held.abilityId, held.charges, slots) : [];
  meta.wireRev++;
  publishWeaponCharges(e, held);
  publishHeldEffectCharge(e, slots);
}

/** Every held effect there is, derived from the ability table rather than
 *  written out again: that record is keyed by the union, so its keys cannot fall
 *  out of step with it. */
const RALLY_HELD_EFFECTS = Object.keys(REALM_RACERS_EFFECT_ABILITIES) as RallyHeldEffect[];

/**
 * What this pilot is holding, as the kit and the charge badges see it: the one
 * charge a pickup granted, or the dev stack standing in for it.
 *
 * The ONE place the two are reconciled, so every reader downstream (the kit, the
 * bar badges, the spend gate) is looking at the same answer.
 */
function realmRacersHeldSlots(
  ctx: SimContext,
  progress: RealmRacersProgress,
): readonly RallyHeldSlot[] {
  const stock = ctx.devCommands ? progress.devHeldCharges : null;
  const stocked = stock
    ? RALLY_HELD_EFFECTS.map((effect) => ({ effect, charges: stock[effect] })).filter(
        (slot) => slot.charges > 0,
      )
    : [];
  // A DRAINED stack stands aside rather than shadowing the slot: the record is
  // still there once every entry hits zero, and a stack tested by existence
  // left a pilot who then took an ordinary box holding an effect with no button
  // and no way to re-acquire it (a full slot turns every later box into a
  // refill). The spend site falls through the same way, on the same test.
  if (stocked.length > 0) return stocked;
  return progress.heldEffect ? [{ effect: progress.heldEffect, charges: 1 }] : [];
}

/**
 * The held effects' own charge pools: what the pilot is holding, `fixed` so the
 * recharge tick never refills them, and REMOVED the moment a slot empties, so a
 * spent effect cannot be cast a second time even if a stale bar still points at
 * it.
 */
function publishHeldEffectCharge(e: Entity, slots: readonly RallyHeldSlot[]): void {
  for (const abilityId of Object.values(REALM_RACERS_EFFECT_ABILITIES)) {
    if (slots.some((slot) => REALM_RACERS_EFFECT_ABILITIES[slot.effect] === abilityId)) continue;
    if (e.abilityCharges) delete e.abilityCharges[abilityId];
  }
  for (const slot of slots) {
    e.abilityCharges ??= {};
    e.abilityCharges[REALM_RACERS_EFFECT_ABILITIES[slot.effect]] = {
      charges: slot.charges,
      maxCharges: slot.charges,
      recharge: 0,
      rechargeLength: 0,
      fixed: true,
    };
  }
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
 * Seat a full grid and drop the flag. Exported because the bot module starts a
 * match without going through the queue at all (the Practice button races you
 * immediately, and the online backfill fills a short queue with house pilots);
 * `tryMatch` below is the queue's own caller.
 *
 * `pids` is the grid, in slot order, and must be exactly
 * `REALM_RACERS_GRID_SIZE` distinct eligible pilots: a race is four abreast or
 * it does not start.
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
  pids: readonly number[],
  practice?: RealmRacersPracticeSeat,
  circuitId?: string,
): boolean {
  return startMatch(ctx, pids, practice, circuitId);
}

/**
 * The circuit a queued race runs on: ONE draw from the competition pool.
 *
 * This is the only rng site in the rally's OWN modules (a race in progress
 * still reaches the shared stream indirectly, the way any combat does: a
 * Ground Blast goes through the ordinary `castAbility` path and whatever that
 * draws for the pilot's gear is the combat system's, not the rally's). Where it
 * sits in the tick is load bearing (src/sim/CLAUDE.md). It happens at SEAT
 * time, inside the caller that has already committed to starting, so all four
 * pilots learn the circuit on the same tick, and it happens exactly once per
 * public race: a start the caller can still refuse must not perturb the shared
 * stream, which is why every refusal in `startMatch` runs above the call.
 *
 * A pool of one still draws. The site must not appear and disappear with the
 * pool size, or adding the second circuit would silently re-order every draw
 * that follows it in the world.
 */
function drawCompetitionCircuit(ctx: SimContext): RealmRacersCircuit {
  const pool = realmRacersCompetitionCircuits();
  return pool[ctx.rng.int(0, pool.length - 1)];
}

/**
 * `circuitId` FORCES the circuit instead of resolving it from the seat, which is
 * how a caller races a specific one: an unauthored id falls through to the
 * ordinary resolution rather than refusing, so a stale id can never wedge a
 * caller into starting nothing. A circuit forced AND RESOLVED never draws, so
 * `/dev rally` cannot move the world's draw order; an id that does not resolve
 * falls through to the ordinary resolution and therefore DOES draw, which is
 * the same fallthrough this comment documents, seen from the stream's side.
 */
function startMatch(
  ctx: SimContext,
  pids: readonly number[],
  practice?: RealmRacersPracticeSeat,
  circuitId?: string,
): boolean {
  // The public circuit is a single slot; a practice copy is claimed by its
  // caller and is nobody else's to take.
  if (!practice && ctx.realmRacers.match) return false;
  if (pids.length !== REALM_RACERS_GRID_SIZE) return false;
  if (new Set(pids).size !== pids.length) return false;
  if (!pids.every((pid) => eligible(ctx, pid))) return false;
  const grid = pids.map((pid) => ({
    pid,
    e: ctx.entities.get(pid) as Entity,
    meta: ctx.players.get(pid) as PlayerMeta,
  }));
  const profile = vehicleProfile(REALM_RACERS_VEHICLE_KEY);
  // Practice always takes the practice circuit OUTRIGHT, never a draw: every
  // offline practice session would otherwise perturb the global draw order. A
  // queued race draws one from the competition pool, and only reaches the draw
  // once nothing above can still refuse the start.
  const forced = circuitId === undefined ? undefined : realmRacersCircuitById(circuitId);
  const circuit =
    forced ?? (practice ? REALM_RACERS_PRACTICE_CIRCUIT : drawCompetitionCircuit(ctx));
  const id = ctx.realmRacers.nextMatchId++;
  const returns = new Map<number, RealmRacersReturn>();
  const pools = new Map<number, ArenaReturnPools>();
  for (const { pid, e } of grid) {
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
    pids: pids.slice(),
    gridSize: pids.length,
    phase: 'countdown',
    goTick: ctx.tickCount + REALM_RACERS_COUNTDOWN_TICKS,
    deadlineTick:
      ctx.tickCount + REALM_RACERS_COUNTDOWN_TICKS + circuit.timeLimitSeconds * TICK_RATE,
    finishTick: null,
    winnerPid: null,
    chaseUntilTick: null,
    finishOrder: [],
    returns,
    preMatchPools: pools,
    progress: new Map(
      pids.map((pid) => [
        pid,
        {
          lap: 1,
          finishedTick: null,
          finishFraction: 1,
          retiredTick: null,
          returned: false,
          trackIndex: 0,
          lastS: 0,
          distanceSinceWrap: 0,
          travelled: 0,
          nextResetGate: 0,
          resetS: 0,
          resetLap: 1,
          resetDistanceSinceWrap: 0,
          stuckTicks: 0,
          resetLockedUntilTick: 0,
          excursion: noRallyExcursion(),
          excursionLap: 1,
          excursionDistanceSinceWrap: 0,
          cutReturnUntilTick: 0,
          wrongWayTicks: 0,
          wrongWay: false,
          heldWeapon: {
            abilityId: profile.weaponAbilityId,
            charges: realmRacersWeaponCharges(profile.weaponAbilityId),
          },
          pickupCooldownUntilTick: 0,
          nitroUntilTick: 0,
          heldEffect: null,
          slickContactUntilTick: 0,
          slickContactId: null,
          slickGripUntilTick: 0,
          devHeldCharges: null,
          groundBlastShockUntilTick: 0,
          lapStartTick: ctx.tickCount,
          hadOffTrackContact: false,
          hadRivalContact: false,
          hitByShell: false,
          wasLastPlace: false,
        },
      ]),
    ),
    groundBlasts: [],
    bumpTicks: new Map(),
    // Every box present at the flag, on every copy of the circuit, and a clean
    // circuit: no oil is down until somebody draws some.
    pickups: createRealmRacersPickupState(circuit),
    slicks: [],
    nextSlickId: 1,
    circuitId: circuit.id,
    // A practice race holds the private lane its caller claimed; a queued race
    // stands on its circuit's PUBLIC lane, which is lane 0 only while the
    // garden circuit is the one being raced.
    origin: realmRacersLaneOffset(practice ? practice.slot : realmRacersPublicLane(circuit)),
    practice: practice ? { ownerPid: practice.ownerPid, slot: practice.slot } : null,
    totalLaps: practice ? circuit.practiceLaps : circuit.laps,
  };
  if (practice) ctx.realmRacers.practices.push(match);
  else ctx.realmRacers.match = match;
  for (const { meta, e } of grid) standardizeRacer(ctx, match, meta, e);
  // Slot order IS seat order, so the grid row reads left to right in `pids`.
  for (let slot = 0; slot < grid.length; slot++) {
    placeRacer(ctx, match, grid[slot].e, slot);
  }
  // Seed the ranking key from the grid so the HUD reads the right order during
  // the countdown, before the first racing tick reprojects anyone.
  for (const { pid, e } of grid) seedProgress(match, pid, e);
  for (const pid of pids) {
    ctx.emit({
      type: 'realmRacersFound',
      matchId: id,
      // Everyone else on the grid, in slot order. The banner names the field a
      // pilot is up against, which at four is a list rather than one rival.
      rivalNames: pids
        .filter((other) => other !== pid)
        .map((other) => ctx.players.get(other)?.name ?? ''),
      countdownTicks: REALM_RACERS_COUNTDOWN_TICKS,
      pid,
    });
  }
  return true;
}

/** One racer's row for the shared comparator, live or final. */
function standingEntry(match: RealmRacersMatch, pid: number, slot: number): RallyStandingEntry {
  const p = match.progress.get(pid) as RealmRacersProgress;
  return {
    pid,
    travelled: p.travelled,
    finishedTick: p.finishedTick,
    finishFraction: p.finishFraction,
    retiredTick: p.retiredTick,
    slot,
  };
}

/** The whole grid, ordered first to last. The live standings strip and the
 *  final classification are this same call at different moments. */
function classify(match: RealmRacersMatch): RallyStandingEntry[] {
  return rallyClassification(match.pids.map((pid, slot) => standingEntry(match, pid, slot)));
}

/**
 * Is there still a race to run? Three ways there is not, and only the last one
 * is a judgement call:
 *
 *  - nobody is still driving (they all finished, quit, or both);
 *  - the only pilots still driving are house pilots, so the human who called
 *    for the race has gone and nobody is watching;
 *  - one lone survivor is left because everyone else QUIT. Three lonely laps is
 *    not a race. A survivor left alone because the others FINISHED still gets to
 *    cross the line for their placing, which is why the finished case is tested.
 */
function raceIsDecided(ctx: SimContext, match: RealmRacersMatch): boolean {
  const running = match.pids.filter((pid) => realmRacersStillRunning(match, pid));
  if (running.length === 0) return true;
  if (!running.some((pid) => !ctx.realmRacers.bots.has(pid))) return true;
  const anyFinished = match.pids.some((pid) => match.progress.get(pid)?.finishedTick !== null);
  return running.length === 1 && !anyFinished;
}

/**
 * The result tableau for ONE pilot: what they scored, and how long until the
 * Society puts them back where it found them.
 *
 * The classification is passed in rather than read off the match, because a
 * quitter is told their result while the race is still running and the match
 * has no final order yet.
 */
function emitResult(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  ranked: readonly RallyStandingEntry[],
  winnerPid: number | null,
): void {
  const placing = Math.max(1, ranked.findIndex((entry) => entry.pid === pid) + 1);
  const winnerName = winnerPid === null ? '' : (ctx.players.get(winnerPid)?.name ?? '');
  ctx.emit({
    type: 'realmRacersResult',
    won: winnerPid === pid,
    forfeited: match.progress.get(pid)?.retiredTick !== null,
    winnerName,
    placing,
    gridSize: match.gridSize,
    returnTicks: REALM_RACERS_RETURN_TICKS,
    pid,
  });
}

function endMatch(ctx: SimContext, match: RealmRacersMatch): void {
  if (match.phase === 'finished') return;
  match.phase = 'finished';
  match.finishTick = ctx.tickCount;
  match.groundBlasts.length = 0;
  // The circuit is swept with the flag: no shell in the air, no oil on the road,
  // and nobody carrying a ward into a tableau where nothing can hit them. The
  // whole rally kit belongs to the race, not to the six seconds after it.
  match.slicks.length = 0;
  for (const pid of match.pids) {
    const progress = match.progress.get(pid);
    if (!progress) continue;
    progress.nitroUntilTick = 0;
    progress.slickGripUntilTick = 0;
    progress.slickContactUntilTick = 0;
    progress.slickContactId = null;
    // The ward goes with the flag: it is a race effect, and a shield standing
    // through a tableau where nothing can hit anyone is chrome.
    const racer = ctx.entities.get(pid);
    if (racer) consumeRealmRacersWard(ctx, racer);
    // The kit goes with it too: an effect held at the flag is spent on nothing,
    // and a button that stays on the bar through the tableau is a button that lies.
    // The dev stack goes with the race that granted it, so a second race never
    // inherits an armoury nobody asked it for.
    //
    // The republish is gated on EITHER emptying, not on the slot alone: a dev
    // grant fills the stack and leaves `heldEffect` null, so a slot-only test
    // skipped the republish and left the whole granted kit on the bar for the
    // tableau, which is the exact thing the sentence above forbids.
    const heldSomething = progress.heldEffect !== null || progress.devHeldCharges !== null;
    progress.devHeldCharges = null;
    progress.heldEffect = null;
    if (heldSomething) republishKit(ctx, match, pid);
    // The surface pass stops running the moment the phase leaves `racing`, so a
    // ceiling raised by a nitro would stand for the whole tableau (and be the
    // state a `resetVehicleDrive` below does NOT clear: it zeroes the motion,
    // never the multipliers).
    const drive = ctx.entities.get(pid)?.drive;
    if (drive) {
      drive.speedCap = 1;
      // And the slide ceiling with it, for the same reason and on the same
      // clock: it is written by that same surface pass, it rides the wire, and
      // a mirror would otherwise show a machine free to slide twice as far for
      // the whole tableau.
      drive.slipCap = 1;
    }
  }
  const ranked = classify(match);
  match.finishOrder = ranked.map((entry) => entry.pid);
  // A dead heat is only ever for the LEAD, and only between two machines that
  // never crossed the line: the race ran out of time with them level. A tie for
  // third is a placing, not a draw.
  match.winnerPid = rallyLeadIsDeadHeat(ranked, REALM_RACERS_DEAD_HEAT_YARDS)
    ? null
    : (ranked[0]?.pid ?? null);
  for (const pid of match.pids) {
    const progress = match.progress.get(pid);
    // A pilot already back in the Evergarden (they quit and their tableau ran
    // out, or they disconnected) has had their result and is gone.
    if (progress?.returned) continue;
    const drive = ctx.entities.get(pid)?.drive;
    if (drive) {
      resetVehicleDrive(drive);
      drive.controlsLocked = true;
    }
    // A quitter already saw their own tableau the moment they pulled off; the
    // race ending later does not owe them a second one.
    if (progress?.retiredTick !== null) continue;
    emitResult(ctx, match, pid, ranked, match.winnerPid);
  }
  // Book of Deeds (docs/design/deeds.md): placing-based, since a four-pilot
  // heat has a whole finishing order rather than a win/lose pair. A house
  // pilot never banks a win or earns a deed; only a rated (non-practice) heat
  // counts (see onRallyRaceEndForDeeds). The practice gate matters here too,
  // independently of that call: without it a private practice win would
  // permanently inflate the persisted meter and unlock the win deeds at the
  // next full deeds pass, the same bug class the Vale Cup's `rated` gate on
  // `applyStanding` exists to prevent.
  //
  // Deliberately NOT excluded: a QUEUED heat backfilled with house pilots. A
  // human who wins a bot-backfilled public race still banks the win and the
  // deed credit, unlike the Vale Cup's bot-backfilled-bout exclusion, because
  // house pilots ARE the ordinary field here (every queued heat seats three
  // of them until the grid fills with humans), not a friendly-only mode.
  if (
    match.practice === null &&
    match.winnerPid !== null &&
    !ctx.realmRacers.bots.has(match.winnerPid)
  ) {
    const winnerMeta = ctx.players.get(match.winnerPid);
    if (winnerMeta) winnerMeta.rrWins++;
  }
  const deedEntries: deedsMod.RallyRaceDeedEntry[] = match.pids.map((pid) => {
    const progress = match.progress.get(pid) as RealmRacersProgress;
    return {
      pid,
      bot: ctx.realmRacers.bots.has(pid),
      retired: progress.retiredTick !== null,
      finished: progress.finishedTick !== null,
      clean: !progress.hadRivalContact && !progress.hadOffTrackContact,
      won: match.winnerPid === pid,
      comeback: progress.wasLastPlace && progress.hitByShell,
    };
  });
  deedsMod.onRallyRaceEndForDeeds(ctx, match.practice !== null, deedEntries);
}

/** Close the gameplay parenthesis for ONE racer: kit, mount, pools, position.
 *  They stay on the frozen grid so the classification still names them. */
function returnRacer(ctx: SimContext, match: RealmRacersMatch, pid: number): void {
  const progress = match.progress.get(pid);
  if (!progress || progress.returned) return;
  progress.returned = true;
  const meta = ctx.players.get(pid);
  const e = ctx.entities.get(pid);
  if (meta && e) restoreRacer(ctx, match, meta, e);
}

function teardownMatch(ctx: SimContext, match: RealmRacersMatch): void {
  for (const pid of match.pids) returnRacer(ctx, match, pid);
  if (ctx.realmRacers.match === match) ctx.realmRacers.match = null;
  // Free the practice copy for the next player. Its house pilots are reaped by
  // the bot module on the same tick, by its own "not seated anywhere" rule.
  const practiceIndex = ctx.realmRacers.practices.indexOf(match);
  if (practiceIndex >= 0) ctx.realmRacers.practices.splice(practiceIndex, 1);
}

/**
 * Pull one pilot off the circuit. A forfeit and a disconnect are the same act
 * and take the same arm: the racer is classified LAST and the race carries on
 * for everyone else. With four on the grid, one player quitting must not end
 * three other people's race, which is the one place this module deliberately
 * does more than generalize its two-pilot self.
 */
function retireRacer(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  restoreImmediately: boolean,
): void {
  const progress = match.progress.get(pid);
  if (!progress || progress.returned || progress.retiredTick !== null) return;
  progress.retiredTick = ctx.tickCount;
  progress.finishedTick = null;
  const drive = ctx.entities.get(pid)?.drive;
  if (drive) {
    resetVehicleDrive(drive);
    drive.controlsLocked = true;
  }
  if (raceIsDecided(ctx, match)) {
    endMatch(ctx, match);
    emitResult(ctx, match, pid, classify(match), match.winnerPid);
  } else {
    // The race goes on. This pilot alone gets the tableau, off the
    // classification as it stands right now: they are last, and nobody has won
    // anything yet.
    emitResult(ctx, match, pid, classify(match), null);
  }
  // A disconnect must restore the persisted character before the host saves it.
  // A voluntary forfeit keeps the tableau up for the normal six seconds first.
  if (restoreImmediately) returnRacer(ctx, match, pid);
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
  retireRacer(ctx, match, id, restoreImmediately);
}

/** Where a reset puts a racer, and what it hands back to them. */
interface RallyResetTarget {
  /** Arc position on the centerline, yards. */
  s: number;
  /** The lap bookkeeping to restore with it, so no reset can bank distance. */
  lap: number;
  distanceSinceWrap: number;
  /** Ticks of settle lock after the teleport; 0 hands control straight back. */
  lockTicks: number;
}

/**
 * Put a racer back on the centerline at `target.s`, at a standstill facing
 * along the track, with their lap bookkeeping rewound to what it was there.
 *
 * ONE body for all three resets on the circuit, because the difference between
 * them is only WHERE and how long the lock is: manual recovery and the stuck
 * arm go back to the last ordered anchor, and the referee's cut return goes
 * back to the point the racer left the road.
 */
function resetRacerTo(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  target: RallyResetTarget,
): boolean {
  const racer = ctx.entities.get(pid);
  const progress = match.progress.get(pid);
  if (
    match.phase !== 'racing' ||
    !racer?.drive ||
    !progress ||
    !realmRacersStillRunning(match, pid) ||
    ctx.tickCount < progress.resetLockedUntilTick
  )
    return false;

  const track = realmRacersTrack(realmRacersCircuitOf(match));
  const anchor = track.pointAt(target.s);
  const world = realmRacersToWorld(match, anchor.x, anchor.z);
  racer.pos = ctx.groundPos(world.x, world.z);
  racer.prevPos = { ...racer.pos };
  racer.facing = Math.atan2(anchor.tx, anchor.tz);
  resetVehicleDrive(racer.drive);
  racer.drive.controlsLocked = target.lockTicks > 0;
  racer.drive.gripMult = 1;
  racer.drive.dragMult = 1;
  racer.drive.speedCap = 1;
  racer.drive.slipCap = 1;

  progress.lap = target.lap;
  progress.lastS = anchor.s;
  progress.distanceSinceWrap = target.distanceSinceWrap;
  progress.travelled = travelledFromArc(target.lap, anchor.s, track.length);
  progress.trackIndex = track.project(anchor.x, anchor.z, progress.trackIndex).index;
  progress.stuckTicks = 0;
  progress.wrongWayTicks = 0;
  progress.wrongWay = false;
  // A machine put back on the racing line is put back CLEAN: whatever surface
  // it was fighting is behind it, and a burst it can no longer spend (the
  // recovery stopped it dead) is not a burst it keeps. The ward is untouched:
  // it is a thing the pilot won, not a state of the ground under them.
  progress.nitroUntilTick = 0;
  progress.slickGripUntilTick = 0;
  progress.slickContactUntilTick = 0;
  progress.slickContactId = null;
  // A racer put back on the racing line is on it: whatever excursion carried
  // them here is over, and the odometer starts again from the next one.
  progress.excursion = noRallyExcursion();
  // Commands land between fixed ticks. The first movement pass observes N+1,
  // so an exclusive bound needs the extra tick to hold exactly `lockTicks`
  // passes.
  progress.resetLockedUntilTick = target.lockTicks > 0 ? ctx.tickCount + target.lockTicks + 1 : 0;
  racer.auras = racer.auras.filter((aura) => aura.id !== REALM_RACERS_OFF_TRACK_AURA);
  ctx.rebucket(racer);
  // Recovery is a position discontinuity for the online predictor, but it is
  // not a resurrection: a dedicated silent event avoids the generic respawn
  // message while still making a short rewind snap on the owning client.
  ctx.emit({ type: 'realmRacersReset', pid });
  return true;
}

/** Put a racer back on the last ordered recovery anchor. Manual recovery adds a
 * settle lock; automatic recovery has already charged its three-second stop and
 * returns control immediately. */
function resetRacerToRecoveryAnchor(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  manual: boolean,
): boolean {
  const progress = match.progress.get(pid);
  if (!progress) return false;
  return resetRacerTo(ctx, match, pid, {
    s: progress.resetS,
    lap: progress.resetLap,
    distanceSinceWrap: progress.resetDistanceSinceWrap,
    lockTicks: manual ? REALM_RACERS_RESET_LOCK_TICKS : REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS,
  });
}

/** Authoritative manual recovery entry point, shared by offline and online worlds. */
export function realmRacersResetPosition(ctx: SimContext, pid?: number): void {
  const id = ctx.resolve(pid)?.meta.entityId ?? pid;
  if (id === undefined) return;
  const match = realmRacersMatchOf(ctx, id);
  if (match) resetRacerToRecoveryAnchor(ctx, match, id, true);
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
export function realmRacersFireGroundBlast(ctx: SimContext, caster: Entity): void {
  const match = realmRacersMatchOf(ctx, caster.id);
  if (!match || match.phase !== 'racing' || caster.dead) return;
  const progress = match.progress.get(caster.id);
  // A pilot whose own race is over keeps their machine and can drive it off the
  // circuit, but they are done shooting: shelling a field you have already
  // beaten (or quit) is griefing, not racing.
  if (!progress || !realmRacersStillRunning(match, caster.id)) return;
  const held = progress.heldWeapon;
  if (!held || held.charges === 0) return;
  const aim = resolveGroundBlastAim(
    { x: caster.pos.x, z: caster.pos.z, facing: caster.facing },
    caster.castAim,
  );
  if (held.charges !== null) {
    held.charges--;
    publishWeaponCharges(caster, held);
  }
  match.groundBlasts.push({
    ownerPid: caster.id,
    x: aim.x,
    z: aim.z,
    impactTick: ctx.tickCount + aim.flightTicks,
  });
  ctx.emit({
    type: 'realmRacersGroundBlastFired',
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
function tickGroundBlasts(ctx: SimContext, match: RealmRacersMatch): void {
  for (let i = match.groundBlasts.length - 1; i >= 0; i--) {
    const shot = match.groundBlasts[i];
    if (ctx.tickCount < shot.impactTick) continue;
    match.groundBlasts.splice(i, 1);
    let nearestPid: number | null = null;
    let nearestImpact = 0;
    for (const pid of match.pids) {
      if (pid === shot.ownerPid) continue;
      // A pilot whose race is over is not a target: they are parked, waiting to
      // be returned, and cannot dodge what they cannot drive away from.
      if (!realmRacersStillRunning(match, pid)) continue;
      const racer = ctx.entities.get(pid);
      if (!racer?.drive || racer.dead) continue;
      // Asked BEFORE the impact is resolved, because resolving it already shoves
      // the machine: a ward has to be able to say no while there is still
      // nothing to undo. It costs the shot its victim outright, so this racer is
      // not the shell's nearest hit either.
      if (
        groundBlastFalloff(racer.pos.x, racer.pos.z, shot.x, shot.z) > 0 &&
        consumeRealmRacersWard(ctx, racer)
      ) {
        ctx.emit({ type: 'realmRacersWardBroken', pid });
        continue;
      }
      const blast = resolveGroundBlastImpact(
        { x: racer.pos.x, z: racer.pos.z, facing: racer.facing, drive: racer.drive },
        shot.x,
        shot.z,
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
      if (progress) {
        progress.groundBlastShockUntilTick = ctx.tickCount + GROUND_BLAST_SHOCK_TICKS;
        progress.hitByShell = true; // deed-tracking only (docs/design/deeds.md)
      }
      ctx.applyAura(racer, {
        id: REALM_RACERS_GROUND_BLAST_AURA,
        name: 'Ground Blast',
        kind: 'slow',
        remaining: GROUND_BLAST_CONTROL_SECONDS,
        duration: GROUND_BLAST_CONTROL_SECONDS,
        value: GROUND_BLAST_CONTROL_SPEED_MULT,
        sourceId: shot.ownerPid,
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
      type: 'realmRacersGroundBlastHit',
      sourceId: shot.ownerPid,
      targetId: nearestPid,
      x: shot.x,
      z: shot.z,
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
 * phase there is no reordering: this pass itself draws zero rng. (The MODULE no
 * longer does: since 22b a pickup take draws exactly one value, in
 * `tickPickups`. This pass is upstream of it and unaffected.)
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
      // Deed-tracking only (docs/design/deeds.md): a real, announced bump
      // (the same floor the event above uses) disqualifies a clean race for
      // BOTH cars, not just the one that gets the announce credit. Gated on
      // still racing: a pilot who already crossed the line clean keeps that
      // outcome through the post-finish tableau, a rival's business no
      // longer touches theirs.
      const progressA = match.progress.get(match.pids[i]);
      const progressB = match.progress.get(match.pids[j]);
      if (progressA?.finishedTick === null) progressA.hadRivalContact = true;
      if (progressB?.finishedTick === null) progressB.hadRivalContact = true;
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
 * There were three bands and there are two: the wading margin was the last
 * thing between the circuit and a shortcut across the middle, the referee
 * (`realm_racers_track_limits.ts`) does that job now, and water is decoration a
 * machine drives straight through. Both bands are therefore pure FEEL: no
 * fairness argument rests on their values any more, only the ordering (further
 * out is slower) that makes running wide legible.
 */
export function realmRacersOffTrackBand(
  circuit: RealmRacersCircuit,
  projection: RallyProjection,
): RealmRacersSlowBand | null {
  const track = realmRacersTrack(circuit);
  // The road narrows and widens around the lap, so track limits follow the
  // LOCAL half-width rather than one fixed distance.
  const over = Math.abs(projection.lateral) - track.halfWidthAt(projection.s);
  if (over <= REALM_RACERS_VERGE_MARGIN) return null;
  if (over <= REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH) {
    return REALM_RACERS_VERGE_BAND;
  }
  // Garden all the way to the wall, both ways. A pond is decoration a machine
  // drives through: it used to be a third, harsher band, back when how deep the
  // water got was the only thing keeping anyone out of the infield.
  return REALM_RACERS_GARDEN_BAND;
}

/**
 * Is a machine on the RACING SURFACE, which is the road plus its verge?
 *
 * The referee's on/off test, and the verge counts because every apex clips it:
 * an excursion that armed on the ordinary racing line would arm on every corner
 * of every lap. Exported because the bot brain and the tests ask the same
 * question, and a second copy of the rule is a rule the race does not share.
 */
export function realmRacersOnTrack(band: RealmRacersSlowBand | null): boolean {
  return band === null || band === REALM_RACERS_VERGE_BAND;
}

/**
 * Hand the driving model the surface under the machine. The road is the neutral
 * 1/1; every off-track band is looser and draggier than it, and a shell shock or
 * a patch of oil cuts whatever grip is left on top of that.
 *
 * Both grip losses ride the SURFACE seam rather than a mechanism of their own
 * precisely because this is already rewritten every tick: a shocked machine
 * sliding through oil on the grass is simply all three, they multiply, and each
 * expires by the tick clock with nothing to clean up.
 *
 * `speedBoost` is the same seam seen from the other side, and it is the whole of
 * the nitro: the knob was already documented as the one for a surface that caps
 * speed without a visible debuff, and a burst is that knob standing ABOVE 1.
 */
function applyVehicleSurface(
  racer: Entity,
  band: RealmRacersSlowBand | null,
  gripPenalty: number,
  speedBoost: number,
  slipCeiling: number,
): void {
  if (!racer.drive) return;
  racer.drive.gripMult = (band ? band.gripMult : 1) * gripPenalty;
  racer.drive.dragMult = band ? band.dragMult : 1;
  // How far sideways this surface lets the machine travel at all. Oil is the
  // only thing that raises it: a shove has nowhere to put a machine that is
  // already at its ceiling, which is where a pilot attacking a corner lives.
  racer.drive.slipCap = slipCeiling;
  // The band's speed loss rides its slow AURA, which the kernel already folds
  // into the top speed, so the surface cap stays neutral off a nitro and nothing
  // is charged twice.
  racer.drive.speedCap = speedBoost;
}

/**
 * The track-limits REFEREE, applied to one racer.
 *
 * Runs only for a racer still in the race: a pilot who has crossed the line or
 * pulled off keeps their machine and may drive it wherever they like.
 */
function refereeTrackLimits(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  racer: Entity,
  progress: RealmRacersProgress,
  projection: RallyProjection,
  onTrack: boolean,
): boolean {
  if (!realmRacersStillRunning(match, pid)) return false;
  if (ctx.tickCount < progress.resetLockedUntilTick) return false;
  const started = progress.excursion.exitS === null;
  const step = stepRealmRacersTrackLimits(progress.excursion, {
    onTrack,
    s: projection.s,
    // Where the machine stood at the end of the LAST tick, which is the last
    // place it held on the road and the position `lap` / `distanceSinceWrap`
    // are in step with (the referee runs before `tickProgress` advances them).
    previousS: progress.lastS,
    moved: Math.hypot(racer.pos.x - racer.prevPos.x, racer.pos.z - racer.prevPos.z),
    lapLength: realmRacersTrack(realmRacersCircuitOf(match)).length,
  });
  if (started && step.excursion.exitS !== null) {
    progress.excursionLap = progress.lap;
    progress.excursionDistanceSinceWrap = progress.distanceSinceWrap;
  }
  progress.excursion = step.excursion;
  if (step.verdict === 'cutReturn' && step.returnS !== null) {
    const returned = resetRacerTo(ctx, match, pid, {
      s: step.returnS,
      lap: progress.excursionLap,
      distanceSinceWrap: progress.excursionDistanceSinceWrap,
      lockTicks: REALM_RACERS_CUT_LOCK_TICKS,
    });
    if (returned) progress.cutReturnUntilTick = ctx.tickCount + REALM_RACERS_CUT_NOTICE_TICKS;
    return returned;
  }
  // Loitering off the road, moving or not: back to the last ordered anchor,
  // which is the same recovery the stuck arm and the manual control use.
  if (step.verdict === 'loiter') return resetRacerToRecoveryAnchor(ctx, match, pid, false);
  return false;
}

function tickTrackLimits(ctx: SimContext, match: RealmRacersMatch): void {
  const circuit = realmRacersCircuitOf(match);
  for (const pid of match.pids) {
    const racer = ctx.entities.get(pid);
    const progress = match.progress.get(pid);
    if (!racer || !progress) continue;
    const projection = reproject(match, pid, racer);
    const band = realmRacersOffTrackBand(circuit, projection);
    // Deed-tracking only: the soft verge is a normal racing-line overshoot
    // (every apex clips it), so only the garden beyond it counts as really
    // leaving the circuit. Gated on still racing, same as the rival-contact
    // flag above: a finished pilot wandering the post-race tableau does not
    // retroactively lose a clean run.
    if (progress.finishedTick === null && band === REALM_RACERS_GARDEN_BAND) {
      progress.hadOffTrackContact = true;
    }
    const forwardDot = rallyForwardDot(projection, Math.sin(racer.facing), Math.cos(racer.facing));
    if (forwardDot < -0.2) {
      progress.wrongWayTicks++;
      progress.wrongWay = progress.wrongWayTicks >= REALM_RACERS_WRONG_WAY_TICKS;
    } else if (forwardDot > 0.2) {
      progress.wrongWayTicks = 0;
      progress.wrongWay = false;
    }

    const resetLocked = ctx.tickCount < progress.resetLockedUntilTick;
    if (band && !resetLocked && Math.abs(racer.drive?.speed ?? 0) <= REALM_RACERS_STUCK_SPEED) {
      progress.stuckTicks++;
      if (progress.stuckTicks >= REALM_RACERS_STUCK_TICKS) {
        resetRacerToRecoveryAnchor(ctx, match, pid, false);
        continue;
      }
    } else {
      progress.stuckTicks = 0;
    }

    // The referee, AFTER the wedged arm above: a machine that has been sitting
    // still off the road for three seconds is stuck, not cutting, and the
    // shorter recovery is the better answer for it.
    if (
      refereeTrackLimits(ctx, match, pid, racer, progress, projection, realmRacersOnTrack(band))
    ) {
      continue;
    }

    const shocked = ctx.tickCount < progress.groundBlastShockUntilTick;
    const slicked = ctx.tickCount < progress.slickGripUntilTick;
    applyVehicleSurface(
      racer,
      band,
      (shocked ? GROUND_BLAST_SHOCK_GRIP : 1) * (slicked ? REALM_RACERS_SLICK_GRIP : 1),
      ctx.tickCount < progress.nitroUntilTick ? REALM_RACERS_NITRO_SPEED_MULT : 1,
      slicked ? REALM_RACERS_SLICK_SLIP_CAP : 1,
    );
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

function tickProgress(ctx: SimContext, match: RealmRacersMatch): void {
  const circuit = realmRacersCircuitOf(match);
  const lapLength = realmRacersTrack(circuit).length;
  const gates = realmRacersGates(circuit);
  let anyFinished = false;
  for (let slot = 0; slot < match.pids.length; slot++) {
    const pid = match.pids[slot];
    const e = ctx.entities.get(pid);
    const progress = match.progress.get(pid);
    if (!e || !progress || !realmRacersStillRunning(match, pid)) continue;
    const previousLap = progress.lap;
    const previousLastS = progress.lastS;
    const previousDistanceSinceWrap = progress.distanceSinceWrap;
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
    const from = realmRacersToCanonical(match, e.prevPos.x, e.prevPos.z);
    const to = realmRacersToCanonical(match, e.pos.x, e.pos.z);
    const gate = gates[progress.nextResetGate];
    const crossing = gate ? rallyGateCrossingFraction(from, to, gate) : null;
    if (gate && crossing !== null) {
      // Snapshot progress AT the recovery plane, not at the end of this tick's
      // segment. Otherwise the piece after the gate is retained by a reset and
      // counted a second time when the racer drives it again.
      const forwardThisTick = Math.max(0, forwardArcDelta(previousLastS, projection.s, lapLength));
      progress.resetS = gate.s;
      progress.resetLap = previousLap;
      progress.resetDistanceSinceWrap = previousDistanceSinceWrap + forwardThisTick * crossing;
      // A valid start-line wrap begins the next lap exactly on the line. The
      // finish case is terminal, so keeping the prior lap there is harmless;
      // this branch matters for ordinary lap transitions.
      if (gate.index === 0 && step.wrapped && !step.finished) {
        progress.resetLap = step.lap;
        progress.resetDistanceSinceWrap = 0;
      }
      progress.nextResetGate = (progress.nextResetGate + 1) % gates.length;
    }
    if (!step.wrapped) continue;
    // Deed-tracking only (docs/design/deeds.md): the lap that just closed,
    // timed off this racer's OWN lap clock rather than the race clock, so a
    // pit stop for someone else never counts against a fast one here.
    deedsMod.onRallyLapForDeeds(
      ctx,
      match.practice !== null,
      ctx.realmRacers.bots.has(pid),
      match.circuitId,
      pid,
      (ctx.tickCount - progress.lapStartTick) / TICK_RATE,
    );
    progress.lapStartTick = ctx.tickCount;
    if (step.finished) {
      progress.finishedTick = ctx.tickCount;
      progress.finishFraction = step.finishFraction ?? 1;
      anyFinished = true;
      // The winner starts everyone else's clock, and only the winner: a second
      // crossing must not push the window back and let the field wait again.
      match.chaseUntilTick ??= ctx.tickCount + REALM_RACERS_CHASE_TICKS;
    } else {
      ctx.emit({
        type: 'realmRacersLap',
        lap: progress.lap,
        totalLaps: match.totalLaps,
        pid,
      });
    }
  }
  // Deed-tracking only: whichever STILL-RUNNING racer trails the field this
  // tick was, for at least this moment, dead last. A cheap argmin over
  // travelled rather than classify(), which sorts and allocates a fresh array
  // every tick for tracking that only ever needs the minimum. Restricted to
  // racers still driving, for two reasons: the frozen-grid-slot tie-break
  // that ranks a finished classification must not decide this (every racer
  // is still tied on the exact same travelled at the green light, and
  // flagging one of them dead last before anybody has actually fallen behind
  // is not the comeback story this tracks), and a retired quitter sorts last
  // in the FINAL classification forever after, which would otherwise steal
  // the flag from whichever driving racer is really trailing.
  let trailingPid: number | null = null;
  let trailingTravelled = Number.POSITIVE_INFINITY;
  for (const pid of match.pids) {
    if (!realmRacersStillRunning(match, pid)) continue;
    const runnerProgress = match.progress.get(pid);
    if (!runnerProgress) continue;
    if (runnerProgress.travelled < trailingTravelled) {
      trailingTravelled = runnerProgress.travelled;
      trailingPid = pid;
    }
  }
  if (trailingPid !== null) {
    const trailingProgress = match.progress.get(trailingPid);
    if (trailingProgress) trailingProgress.wasLastPlace = true;
  }
  // Crossing the line no longer ends the race: with four on the grid the fight
  // for the last podium step is the race, for everyone not leading it. The
  // classification closes when nobody is left driving (or on the deadline).
  if (anyFinished && raceIsDecided(ctx, match)) endMatch(ctx, match);
}

/** Hundredths of a yard: the precision the readout ships anything positional at.
 *  See the note at the slick list in `matchInfoFor`. */
function roundReadout(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The path a machine covered this tick, in the circuit's canonical frame. */
function segmentOf(
  match: RealmRacersMatch,
  e: Entity,
): { fromX: number; fromZ: number; toX: number; toZ: number } {
  const from = realmRacersToCanonical(match, e.prevPos.x, e.prevPos.z);
  const to = realmRacersToCanonical(match, e.pos.x, e.pos.z);
  return { fromX: from.x, fromZ: from.z, toX: to.x, toZ: to.z };
}

/**
 * The pickup boxes, one tick.
 *
 * Everything it decides is in `realm_racers_pickups.ts`; what lives here is the
 * three facts only a race knows: which machines are allowed to take (the ones
 * still driving), which lap the LEADER is on, and what a take does to the
 * weapon slot.
 *
 * The leader is the most TRAVELLED racer STILL DRIVING, the same monotonic key
 * and the same restriction the dead-last tracking above uses, and their lap
 * going up is the crossing that puts every taken box back. Reading the lap
 * rather than watching for a line crossing is what makes the rule survive a
 * leader change: the number only ever goes up, so a new leader on the same lap
 * respawns nothing. Restricting it to racers still driving is what makes the
 * rule survive a leader LEAVING: a pilot who forfeits from the front keeps the
 * biggest `travelled` for the rest of the race, so an unfiltered argmin would
 * freeze the boxes on a lap number nobody can advance any more.
 *
 * THE PHASE draws EXACTLY ONE value off the shared stream per box that changes
 * hands (22b): what the box gives is a weighted draw, and it is taken here, at
 * the take, so the count is a plain function of what happened on the circuit
 * rather than of how many racers were offered a box. A tick with no take draws
 * nothing, which is what keeps the boxes appendable to the tick at all.
 */
function tickPickups(ctx: SimContext, match: RealmRacersMatch): void {
  const boxes = realmRacersPickupBoxes(realmRacersCircuitOf(match));
  if (boxes.length === 0) return;
  let leaderLap = 0;
  let leaderTravelled = Number.NEGATIVE_INFINITY;
  const racers: RallyPickupRacer[] = [];
  // How far every racer STILL DRIVING has come. It is what a take is ranked
  // against, and it is deliberately not `classify()`: the catch-up weighting is
  // about the race still being run, and a classification sorts finishers and
  // quitters into the order too.
  const runningTravelled: number[] = [];
  for (const pid of match.pids) {
    const progress = match.progress.get(pid);
    if (!progress) continue;
    const stillRunning = realmRacersStillRunning(match, pid);
    if (stillRunning) {
      runningTravelled.push(progress.travelled);
      if (progress.travelled > leaderTravelled) {
        leaderTravelled = progress.travelled;
        leaderLap = progress.lap;
      }
    }
    const e = ctx.entities.get(pid);
    if (!e) continue;
    racers.push({
      pid,
      // The whole SEGMENT this machine covered, so a box is taken by the path
      // rather than by the two endpoints: at race speed a tick is about three
      // yards, which steps clean over a catch zone.
      ...segmentOf(match, e),
      cooldownUntilTick: progress.pickupCooldownUntilTick,
      // A pilot who has crossed the line or pulled off keeps their machine and
      // may drive it anywhere; they are not collecting ammunition for a race
      // they are no longer in. Nor is a machine under the control lock, which
      // is the tick or two after the referee or the recovery control PUT it
      // somewhere: a recovery anchor can stand inside a box's catch radius (the
      // Express Tour's own gate 6 sits 2.28 yd from a box, against a 2.3 yd
      // reach), and a box collected by being teleported onto it is a free
      // charge for driving off the road.
      eligible: stillRunning && ctx.tickCount >= progress.resetLockedUntilTick,
    });
  }
  const step = stepRealmRacersPickups(boxes, match.pickups, {
    tick: ctx.tickCount,
    leaderLap,
    racers,
  });
  for (const take of step.takes) {
    const progress = match.progress.get(take.pid);
    if (!progress) continue;
    progress.pickupCooldownUntilTick = ctx.tickCount + REALM_RACERS_PICKUP_COOLDOWN_TICKS;
    // ONE draw per take, here, and nowhere else in the phase. The rank is how
    // many still-driving machines are ahead of this one, so the leader is 0 and
    // the field's tail draws the catch-up table.
    let ahead = 0;
    for (const travelled of runningTravelled) {
      if (travelled > progress.travelled) ahead++;
    }
    const band = rallyPickupBand(ahead, runningTravelled.length);
    const effect = resolvePickupEffect(
      drawRallyPickupEffect(band, ctx.rng.next()),
      progress,
      realmRacersWarded(ctx.entities.get(take.pid)),
    );
    applyPickupEffect(ctx, match, take.pid, progress, effect);
    // Named to the taker, in their own language: the event carries the EFFECT
    // the box actually gave, never a sentence (`realm_racers_pickup_i18n.ts`
    // owns the words, and whether that effect was applied or is now HELD is
    // presentation's business).
    ctx.emit({ type: 'realmRacersPickup', effect, pid: take.pid });
  }
}

/**
 * The stacking rule, applied AFTER the draw and never instead of it.
 *
 * A racer already holding an unused effect (or already warded) falls back to the
 * refill rather than overwriting what they have or stocking a second one. It is
 * deliberately a second step: the draw itself must stay one value off the shared
 * stream from the band's own table, or the tables would silently mean something
 * different for a racer whose slot happened to be full.
 */
function resolvePickupEffect(
  drawn: RallyPickupEffect,
  progress: RealmRacersProgress,
  warded: boolean,
): RallyPickupEffect {
  if (isRallyHeldEffect(drawn)) return progress.heldEffect === null ? drawn : 'charge';
  // `warded` is read off the AURA by the caller, which is the source of truth:
  // a second ward would be a shield nobody could see they had two of.
  if (drawn === 'ward') return warded ? 'charge' : drawn;
  return drawn;
}

/** Compile-time exhaustiveness: a fifth effect is an error here (and in the
 *  i18n `Record` that gives it words) until it has been handled. */
function assertNever(value: never): never {
  throw new Error(`unhandled pickup effect: ${String(value)}`);
}

/**
 * What a resolved effect does at the moment the box is taken.
 *
 * Two of the four are INSTANT: the refill is ammunition (there is nothing to
 * decide) and the ward is a shield a pilot would arm immediately anyway. The
 * other two are HELD (the operator's mid-review override): they land in the
 * racer's kit as a one-charge ability and happen when the pilot casts them.
 */
function applyPickupEffect(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  progress: RealmRacersProgress,
  effect: RallyPickupEffect,
): void {
  switch (effect) {
    case 'charge': {
      const held = progress.heldWeapon;
      // Unlimited fire (a null budget) has nothing to add to, and a machine with
      // no weapon slot at all has nowhere to put it. Both still took the box and
      // still armed the cooldown: what a box gives is the slot's business.
      if (!held || held.charges === null) return;
      held.charges += REALM_RACERS_PICKUP_CHARGE_GRANT;
      const racer = ctx.entities.get(pid);
      if (racer) publishWeaponCharges(racer, held);
      return;
    }
    case 'ward': {
      const racer = ctx.entities.get(pid);
      if (racer) applyRealmRacersWard(ctx, racer);
      return;
    }
    case 'nitro':
    case 'slick':
      // Into the pilot's hands, not onto the machine: the kit republish is what
      // puts the button on the bar (and the keybind, the gamepad and the mobile
      // control behind it).
      progress.heldEffect = effect;
      republishKit(ctx, match, pid);
      return;
    default:
      assertNever(effect);
  }
}

/**
 * Spend the held effect a pilot just cast.
 *
 * Reached through the ordinary ability path (`castAbility` -> the effect
 * dispatcher -> `ctx.realmRacersSpendPickupEffect`), so the cost, the phase gate
 * and the charge accounting are the ones every rally cast already obeys. It
 * draws ZERO rng: the randomness was spent at the box.
 */
export function realmRacersSpendPickupEffect(
  ctx: SimContext,
  caster: Entity,
  effect: RallyHeldEffect,
): void {
  const match = realmRacersMatchOf(ctx, caster.id);
  if (!match || match.phase !== 'racing' || caster.dead) return;
  const progress = match.progress.get(caster.id);
  // The same gate the weapon takes: a pilot whose own race is over keeps their
  // machine, but they are done spending anything on the field.
  if (!progress || !realmRacersStillRunning(match, caster.id)) return;
  // The slot is the authority, never the button: a stale bar (or a cheat client
  // casting an id it no longer holds) spends nothing.
  // The dev stack stands in for the slot while it lasts, so a weapon under
  // tuning can be felt lap after lap without a chat command between crossings.
  // Gated here as well as at the grant, so a stack is inert in production even
  // if some future load path resurrected one.
  const stock = ctx.devCommands ? progress.devHeldCharges : null;
  if (stock && stock[effect] > 0) {
    stock[effect] -= 1;
  } else if (progress.heldEffect !== effect) {
    return;
  } else {
    progress.heldEffect = null;
  }
  if (effect === 'nitro') {
    progress.nitroUntilTick = ctx.tickCount + REALM_RACERS_NITRO_TICKS;
    const drive = caster.drive;
    if (drive) {
      // The ceiling is rewritten by the surface pass at the END of every tick,
      // so it is raised here too rather than waited for: a burst felt a tick
      // after the button is a burst a pilot cannot place.
      drive.speedCap = REALM_RACERS_NITRO_SPEED_MULT;
      // Forward, whichever way the machine is travelling: a nitro spent in
      // reverse is a shove toward where the nose points, not a faster crash.
      drive.speed += REALM_RACERS_NITRO_KICK;
    }
  } else {
    // Under the machine, in the circuit's own frame. Dropping it where the pilot
    // IS (rather than at the row the box stood on) is what makes it a decision:
    // the oil goes into the corner they choose, and the machine that laid it is
    // already past it.
    const here = realmRacersToCanonical(match, caster.pos.x, caster.pos.z);
    dropRealmRacersSlick(ctx, match, caster.id, here.x, here.z);
  }
  republishKit(ctx, match, caster.id);
}

/**
 * DEV ONLY: hand the seated pilot a full armoury, so a weapon can be felt over
 * and over while it is being tuned.
 *
 * Gated by `ctx.devCommands` at the call site, exactly like `realmRacersDevRace`
 * beside it. It grants what a race can actually hold: the signature weapon's
 * budget is a real count and is set outright, while a pickup effect is a
 * one-charge slot by design, so "a stack of them" is expressed as the refill
 * latch rather than by inventing a second counter the rest of the code would
 * have to learn. `ward` is neither: it is an aura, granted once.
 *
 * Returns false when the pilot is not in a race, which is the only way to fail.
 */
export function realmRacersDevGrantKit(ctx: SimContext, pid: number, charges: number): boolean {
  const match = realmRacersMatchOf(ctx, pid);
  const racer = ctx.entities.get(pid);
  const progress = match?.progress.get(pid);
  if (!match || !racer || !progress) return false;
  const held = progress.heldWeapon;
  // Zero hands the race back its own rules, which is what a tuning session needs
  // at the end of one: the ordinary budget and the one-charge pickup are the
  // things being judged. So the weapon goes back to what a race grants it,
  // rather than to nothing: `0` is "stop cheating", never "leave me empty".
  // A null budget is unlimited fire already and has nothing to be topped up to.
  if (held && held.charges !== null) {
    held.charges = charges > 0 ? charges : (realmRacersWeaponCharges(held.abilityId) ?? 0);
  }
  progress.devHeldCharges =
    charges > 0
      ? (Object.fromEntries(RALLY_HELD_EFFECTS.map((effect) => [effect, charges])) as Record<
          RallyHeldEffect,
          number
        >)
      : null;
  // The ward is NOT granted, deliberately: it eats the next hostile effect, so a
  // kit that included one would silently swallow the first hit of whatever the
  // session was convened to feel.
  republishKit(ctx, match, pid);
  return true;
}

/**
 * Put one patch of oil on this race's circuit, holding the field to the cap the
 * renderer can actually draw.
 *
 * Past the cap the OLDEST patch is evicted, which is both the least surprising
 * rule (the one that has been there longest goes first) and the one that keeps
 * what bites identical to what is drawn: a slick nobody can see is a trap.
 */
function dropRealmRacersSlick(
  ctx: SimContext,
  match: RealmRacersMatch,
  ownerPid: number,
  x: number,
  z: number,
): void {
  match.slicks.push({
    id: match.nextSlickId++,
    x,
    z,
    ownerPid,
    // The oil goes down under the machine, so the pilot is standing in it: it
    // arms against them the moment they drive out (`stepRealmRacersSlicks`).
    ownerClear: false,
    expiresTick: ctx.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
  });
  while (match.slicks.length > REALM_RACERS_SLICK_CAP) match.slicks.shift();
}

/**
 * The oil slicks, one tick: sweep the expired patches, then hand the grip loss
 * to whoever drove through one.
 *
 * Runs BEFORE the boxes, so a slick dropped this tick cannot catch a rival on
 * the same tick it appears: the oil is down where the taker just was, and a
 * machine level with them has already driven that ground. It draws no rng.
 */
function tickSlicks(ctx: SimContext, match: RealmRacersMatch): void {
  if (match.slicks.length === 0) return;
  const racers: RallySlickRacer[] = [];
  for (const pid of match.pids) {
    const progress = match.progress.get(pid);
    const e = ctx.entities.get(pid);
    if (!progress || !e) continue;
    racers.push({
      pid,
      ...segmentOf(match, e),
      // The same eligibility the boxes use, and for the same reason: a pilot
      // whose race is over is not racing through anyone's hazard, and a machine
      // the referee has just PUT somewhere did not drive into what it landed on.
      eligible:
        realmRacersStillRunning(match, pid) && ctx.tickCount >= progress.resetLockedUntilTick,
    });
  }
  const step = stepRealmRacersSlicks(match.slicks, { tick: ctx.tickCount, racers });
  for (const hit of step.hits) {
    const progress = match.progress.get(hit.pid);
    if (!progress) continue;
    // Contact with the oil is resolved ONCE per crossing, not once per tick
    // spent in the puddle: a machine crosses a patch over two or three ticks,
    // and re-resolving it every one of them would announce twenty times a second
    // and eat a ward the tick after it had already saved the pilot.
    // The deadline follows THIS patch's contact, resolved or not, so it can only
    // lapse once the machine is out of THAT oil. Two halves, both load-bearing:
    // letting it lapse underneath a machine still sitting in a patch threw a
    // stopped pilot again every window for the whole twelve seconds the patch
    // lives (harmless while a crossing only cost grip, a fresh shove once one
    // moved the machine), and keying it to the patch rather than to the racer is
    // what stops lingering in one slick from buying a free pass through the next
    // one down the road. The GRIP window deliberately does NOT follow the
    // contact: it expires on its own clock, or a machine that stopped in the oil
    // would never get the grip back to drive out of it.
    const resolves =
      progress.slickContactId !== hit.slick || ctx.tickCount >= progress.slickContactUntilTick;
    progress.slickContactId = hit.slick;
    progress.slickContactUntilTick = ctx.tickCount + REALM_RACERS_SLICK_GRIP_TICKS;
    if (!resolves) continue;
    const racer = ctx.entities.get(hit.pid);
    if (racer && consumeRealmRacersWard(ctx, racer)) {
      ctx.emit({ type: 'realmRacersWardBroken', pid: hit.pid });
      continue;
    }
    progress.slickGripUntilTick = ctx.tickCount + REALM_RACERS_SLICK_GRIP_TICKS;
    // The shove, which is the half of a slick that does not depend on what the
    // machine was doing when it arrived. The grip loss above is the other half
    // and they are written to work together: this takes the machine off the line
    // it was on, and the missing grip is why it cannot gather it back up. The
    // ward above absorbs both, as one contact, which is why this sits after it.
    const drive = racer?.drive;
    if (!racer || !drive) continue;
    const profile = vehicleProfile(drive.profileKey);
    const local = realmRacersToCanonical(match, racer.pos.x, racer.pos.z);
    const thrown = realmRacersSlickThrow({
      slip: drive.slip,
      forwardSpeed: drive.speed,
      topSpeed: profile.maxSpeed,
      facing: racer.facing,
      x: local.x,
      z: local.z,
      slickX: hit.x,
      slickZ: hit.z,
      slickId: hit.slick,
      pid: hit.pid,
    });
    // A machine that is not moving is not thrown by a puddle, and must not
    // ANNOUNCE being thrown either: the event re-seeds the online predictor's
    // whole drive state (`hasAuthoritativeDriveImpulse`), so firing one for a
    // shove of zero would pay that cost, and play the noise, for nothing.
    if (thrown.strength <= 0) continue;
    // The ceiling is raised HERE rather than waited for, exactly as the nitro
    // raises its own: the surface pass runs earlier in this same tick, so a
    // shove that clamped against the tarmac ceiling first would be cut to what
    // the road allows and the raise would arrive a tick after the moment it was
    // granted for.
    drive.slipCap = REALM_RACERS_SLICK_SLIP_CAP;
    addVehicleSlip(drive, thrown.push, vehicleMaxSlip(profile, drive));
    // World coordinates, and the MACHINE's rather than the patch's: the noise
    // and the smoke come off the tyres that lost, not off the ground.
    ctx.emit({
      type: 'realmRacersSlicked',
      targetId: hit.pid,
      x: racer.pos.x,
      z: racer.pos.z,
      impact: thrown.strength,
    });
  }
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
  const rally = ctx.realmRacers;
  if (rally.match || rally.queue.length < REALM_RACERS_GRID_SIZE) return;
  const grid = rally.queue.splice(0, REALM_RACERS_GRID_SIZE);
  if (startMatch(ctx, grid)) return;
  // Put the eligible ones back at the FRONT in their original order. The old
  // two-pilot code unshifted them one at a time, which reverses the pair; at
  // four that silently reorders the head of the queue on every refusal.
  rally.queue.unshift(...grid.filter((pid) => eligible(ctx, pid)));
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
  // Anyone who quit and has watched their six seconds of tableau goes home,
  // while the race carries on for the rest. Before the roster loop, so a
  // returned racer is not re-seated on the machine it just got out of.
  for (const pid of match.pids) {
    const progress = match.progress.get(pid);
    if (!progress || progress.returned || progress.retiredTick === null) continue;
    if (ctx.tickCount - progress.retiredTick >= REALM_RACERS_RETURN_TICKS) {
      returnRacer(ctx, match, pid);
    }
  }
  for (const pid of match.pids) {
    if (!matchSeats(match, pid)) continue;
    const meta = ctx.players.get(pid);
    const e = ctx.entities.get(pid);
    if (!meta || !e || meta.leaving || e.dead || e.ghost) {
      // A disconnect is a forfeit: this pilot is classified last and returned
      // at once, and three other people's race is not ended by it.
      retireRacer(ctx, match, pid, true);
      continue;
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
    const progress = match.progress.get(pid) as RealmRacersProgress;
    const resetLocked = ctx.tickCount < progress.resetLockedUntilTick;
    // A pilot who quit is a passenger until the Society returns them; a pilot
    // who FINISHED keeps the wheel and can drive off the circuit under their
    // own steam, which is what every real race lets you do.
    e.drive.controlsLocked =
      match.phase !== 'racing' || resetLocked || progress.retiredTick !== null;
    if (resetLocked) resetVehicleDrive(e.drive);
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
      for (const pid of match.pids) {
        ctx.emit({ type: 'realmRacersGo', pid });
        const progress = match.progress.get(pid);
        if (progress) progress.lapStartTick = ctx.tickCount;
      }
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
  // Two clocks close a race nobody is finishing: the 180 s limit, and the much
  // shorter chase window the winner started. Whichever comes first.
  if (
    ctx.tickCount >= match.deadlineTick ||
    (match.chaseUntilTick !== null && ctx.tickCount >= match.chaseUntilTick)
  ) {
    endMatch(ctx, match);
    return;
  }
  // Contact FIRST: the progress test reads the segment from where a racer was
  // to where it ended the tick, so the shove has to be part of that segment
  // rather than an unrecorded correction applied after the line was judged.
  // (Only the racing phase reaches here: the countdown and finished arms return
  // above, which is also what keeps a nudge on the grid from doing anything.)
  tickContacts(ctx, match);
  // Track limits BEFORE progress, which is what makes the referee's guarantee
  // structural rather than nearly true. A cut is a position the racer must not
  // be credited for, and `tickProgress` is what credits it: judged afterwards,
  // a machine that cut across the infield and crossed the line would already
  // have FINISHED by the time the referee had anything to say, and the return
  // would have to unpick a classification. Judged first, the racer is back at
  // the point they left the road (at a standstill, with `prevPos` collapsed
  // onto `pos`) before progress reads the tick at all, so the tick it cheated
  // on is worth exactly zero arc and no gate.
  //
  // Neither pass draws rng, so the shared stream is unmoved by the order.
  tickTrackLimits(ctx, match);
  tickProgress(ctx, match);
  // `tickProgress` can END the race (the last racer home), and neither a shell
  // nor a pickup may land into a classification that is already closed. The
  // boxes go AFTER progress for the same reason the referee goes before it: the
  // leader's lap is what puts them back, and that number is written there.
  //
  // For the BOXES this guard is belt and braces rather than a rule with a test
  // behind it: the countdown and finished arms return above, and a race decided
  // inside `tickProgress` leaves every racer either finished or retired, so the
  // eligibility test already refuses all of them. It is kept because the shell's
  // own guard beside it is not defensive, and one of the two silently not
  // applying to the other would be the next reader's trap.
  if (match.phase === 'racing') {
    // Oil BEFORE the boxes, which is what stops a slick from catching a rival on
    // the tick it is dropped (see `tickSlicks`), and neither pass may draw rng
    // ahead of the take: the boxes' one draw per take is the whole of this
    // phase's contribution to the shared stream.
    tickSlicks(ctx, match);
    tickPickups(ctx, match);
    tickGroundBlasts(ctx, match);
  }
}

function racerInfo(
  ctx: SimContext,
  match: RealmRacersMatch,
  pid: number,
  position: number,
): RealmRacersRacerInfo {
  const p = match.progress.get(pid) as RealmRacersProgress;
  const meta = ctx.players.get(pid);
  return {
    pid,
    name: meta?.name ?? '',
    // The class the standings row draws its portrait from, exactly as a party
    // frame does. A racer's class has no effect on the machine: it is who is in
    // the seat, which is the whole job of an avatar.
    cls: meta?.cls ?? 'warrior',
    lap: Math.min(match.totalLaps, p.lap),
    finished: p.finishedTick !== null,
    // Null for a human. A racer is told which they are up against: a practice
    // lap against house pilots is not the same result as beating players.
    botTier: ctx.realmRacers.bots.get(pid) ?? null,
    position,
    // The crossing happened somewhere inside the tick that detected it: the
    // segment it was judged on runs from the previous tick to this one, so the
    // real moment is `finishedTick - 1 + fraction`. Folding it in is what makes
    // two machines finishing on the same tick two different times.
    finishSeconds:
      p.finishedTick === null
        ? null
        : Math.max(0, (p.finishedTick - 1 + p.finishFraction - match.goTick) / TICK_RATE),
    retired: p.retiredTick !== null,
  };
}

function matchInfoFor(ctx: SimContext, match: RealmRacersMatch, pid: number): RealmRacersMatchInfo {
  const me = match.progress.get(pid) as RealmRacersProgress;
  const ranked = classify(match);
  const standings = ranked.map((entry, index) => racerInfo(ctx, match, entry.pid, index + 1));
  const mine = standings.find((racer) => racer.pid === pid) as RealmRacersRacerInfo;
  const countdownTicks =
    match.phase === 'countdown' ? Math.max(0, match.goTick - ctx.tickCount) : 0;
  const countdown = countdownTicks > 3 * TICK_RATE ? 0 : Math.ceil(countdownTicks / TICK_RATE);
  // A pilot who quit is finished as far as THEY are concerned, even while the
  // rest of the field is still racing: their tableau and their return clock run
  // off the tick they pulled off, not off the tick the race is decided.
  const myEndTick = me.retiredTick ?? (match.phase === 'finished' ? match.finishTick : null);
  const returnIn =
    myEndTick === null
      ? 0
      : Math.max(
          0,
          Math.ceil((REALM_RACERS_RETURN_TICKS - (ctx.tickCount - myEndTick)) / TICK_RATE),
        );
  // Only shown to a pilot who is still driving: the racers already home are
  // waiting on this clock, not racing it.
  const chaseIn =
    match.chaseUntilTick === null ||
    match.phase !== 'racing' ||
    !realmRacersStillRunning(match, pid)
      ? 0
      : Math.max(0, Math.ceil((match.chaseUntilTick - ctx.tickCount) / TICK_RATE));
  const elapsedTicks =
    match.phase === 'countdown'
      ? 0
      : Math.max(0, Math.min(ctx.tickCount, match.deadlineTick) - match.goTick);
  return {
    id: match.id,
    circuitId: match.circuitId,
    participantIds: [...match.pids],
    phase: myEndTick !== null ? 'finished' : match.phase,
    countdown,
    countdownTicks,
    elapsed: Math.floor(elapsedTicks / TICK_RATE),
    elapsedTicks,
    chaseIn,
    returnIn,
    me: mine,
    standings,
    gridSize: match.gridSize,
    decided: match.phase === 'finished',
    speed: Math.abs(ctx.entities.get(pid)?.drive?.speed ?? 0),
    wrongWay: me.wrongWay,
    // The referee's two banners, both derived rather than stored: how long this
    // pilot has left off the road before they are put back, and whether they
    // were JUST put back for cutting. Neither needs a wire field of its own,
    // because the whole info object already rides `rr`.
    offTrackIn: Math.ceil(rallyLoiterCountdownTicks(me.excursion) / TICK_RATE),
    cutReturned: ctx.tickCount < me.cutReturnUntilTick,
    // Which boxes are GONE, never which are there: on a full circuit this is an
    // empty array, and it is the shorter list at every moment of a race.
    pickupsTaken: realmRacersPickupTakenIndices(match.pickups),
    // The oil on the road, in the circuit's own frame like the boxes. Every
    // pilot in the race sees every patch, whoever dropped it: a hazard nobody
    // could see coming would not be a decision, and hiding one from the machine
    // that is about to hit it is exactly what the graphics-fairness rule forbids.
    slicks: match.slicks.map((slick) => ({
      id: slick.id,
      // Rounded HERE, in the readout both hosts build, rather than at the wire:
      // a patch is a fixed point on a 2.6 yard disk, so a hundredth of a yard is
      // far below anything a player or the renderer can tell apart, and doing it
      // in the shared builder halves the per-tick `rr` payload with no chance of
      // the two hosts disagreeing about where the oil is.
      x: roundReadout(slick.x),
      z: roundReadout(slick.z),
    })),
    // Whether this pilot is carrying a ward, DERIVED from the aura that is the
    // source of truth rather than tracked twice. The strip's pip reads this; the
    // buff bar under the portrait (and a rival's target frame) get the aura
    // itself off the ordinary entity wire.
    warded: realmRacersWarded(ctx.entities.get(pid)),
    resetLocked: ctx.tickCount < me.resetLockedUntilTick,
    totalLaps: match.totalLaps,
    // A practice lap is a real race on a private copy of the circuit, and the
    // readout says which it is rather than dressing one up as the other.
    practice: match.practice !== null,
    result:
      me.retiredTick !== null
        ? 'forfeit'
        : match.phase !== 'finished'
          ? null
          : match.winnerPid === pid
            ? 'won'
            : // A null winner is a dead heat for the LEAD, so it is a draw for
              // the two machines that tied and a loss for everyone behind them.
              // Reading it as a draw for the whole field would tell a pilot who
              // came fourth that the stewards could not separate them.
              match.winnerPid === null && mine.position <= 2
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
    // `>= 0`, never truthiness: lane 0 is a real private copy the moment the
    // practice circuit stops serving competition and loses its public lane.
    practiceAvailable: match === null && realmRacersFreePracticeSlot(ctx) >= 0,
  };
}

/**
 * Is this racer held on the grid by the start countdown? The coordinator's
 * movement gate asks; keeping the answer here means the gate never has to know
 * which of the live races the racer is in.
 */
export function realmRacersMovementLocked(ctx: SimContext, pid: number): boolean {
  const match = realmRacersMatchOf(ctx, pid);
  if (!match) return false;
  if (match.phase !== 'racing') return true;
  const progress = match.progress.get(pid);
  // A pilot who quit is held where they stopped until the Society returns them,
  // even though the race around them is still live.
  if (progress?.retiredTick !== null) return true;
  return ctx.tickCount < (progress?.resetLockedUntilTick ?? 0);
}
