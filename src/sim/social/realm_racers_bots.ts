// The Realm Racers house pilots: lore-named player bots that make the
// minigame playable alone. Two entry points, ONE body of code (the retired
// Vale Cup bots' model, whose contract this follows literally):
//
//   - Practice: the player presses Play and races a full grid of house pilots
//     immediately, with no queue and no wait. Works offline AND online, because
//     the same sim runs on the server.
//   - Backfill: online, a short queue whose oldest waiter has been there past
//     REALM_RACERS_BACKFILL_TICKS is topped up to a full grid with house pilots
//     rather than waiting for rivals who may never come.
//
// Both are driven INSIDE the sim tick (Sim.updateRealmRacers calls
// updateRealmRacersBots right after the match module), so the offline button
// and the online backfill cannot drift apart.
//
// The functions take the `Sim` directly (type-only import, no runtime cycle)
// because bot lifecycle needs Sim-only affordances (addPlayer/removePlayer);
// everything match-scoped routes through the extracted rally module.
//
// A bot holds the SAME controls a human holds, written into `meta.moveInput`,
// so it flows through `stepPlayerMotion` and therefore through the same vehicle
// kernel, the same collision, and the same surface penalties. A bot that
// steered its own position would be a different game running beside the
// player's.
//
// Deterministic with ZERO rng: every decision is a pure function of sim state,
// the tier, the bot's pid and the tick count. These run on the live server, so
// a single draw here would shift the shared stream's draw order for every other
// system in the world.

import { REALM_RACERS_BOT_CLASSES, REALM_RACERS_BOT_NAMES } from '../content/realm_racers';
import { realmRacersCircuitById } from '../content/realm_racers_circuits';
import { vehicleProfile } from '../content/vehicles';
import { auraSpeedMult } from '../player_motion';
import {
  driveRealmRacers,
  type RallyDriverBlast,
  type RallyDriverTier,
} from '../realm_racers_driver';
import { REALM_RACERS_GRID_SIZE } from '../realm_racers_layout';
import { realmRacersTrack } from '../realm_racers_spline';
import type { Sim } from '../sim';
import { emptyMoveInput, TICK_RATE } from '../types';
import { vehicleTopSpeedFor, vehicleVelocityX, vehicleVelocityZ } from '../vehicle_motion';
import {
  type RealmRacersMatch,
  realmRacersCircuitOf,
  realmRacersEligible,
  realmRacersFreePracticeSlot,
  realmRacersInCombat,
  realmRacersMatchOf,
  realmRacersQueueRemove,
  realmRacersStartMatch,
  realmRacersStillRunning,
  realmRacersToCanonical,
  realmRacersToWorld,
} from './realm_racers';

/**
 * How long the oldest waiter in the queue sits before the Society sends house
 * pilots out to fill the grid. Long enough that four humans who all walked up
 * still get a real race, short enough that the minigame is never a dead end:
 * measured on the OLDEST waiter, so a lone queuer gets a race in 45 s and a
 * queue of three never waits on a fourth human forever.
 */
export const REALM_RACERS_BACKFILL_TICKS = 45 * TICK_RATE;

/** The tier the online backfill sends. The middle one: a lone queuer asked for
 *  a race, not for a lesson, and never chose a difficulty. */
export const REALM_RACERS_BACKFILL_TIER: RallyDriverTier = 'driver';

/** A lore name nobody in the world is already using. */
function nextBotName(sim: Sim): string {
  const taken = new Set<string>();
  for (const meta of sim.players.values()) taken.add(meta.name.toLowerCase());
  for (const name of REALM_RACERS_BOT_NAMES) {
    if (!taken.has(name.toLowerCase())) return name;
  }
  // Every house name is in use (a full grid of them races at a time, so a
  // clash with a real player is what lands here): suffix deterministically.
  for (let i = 2; ; i++) {
    for (const base of REALM_RACERS_BOT_NAMES) {
      const name = `${base} ${i}`;
      if (!taken.has(name.toLowerCase())) return name;
    }
  }
}

/**
 * Add a house pilot to the world and mark it as one. The cosmetic class rotates
 * on the match counter PLUS the pilot's own grid offset, so the three rivals in
 * one practice race are three different faces rather than triplets, and
 * consecutive races do not all field the same three.
 */
function spawnRallyBot(sim: Sim, tier: RallyDriverTier, offset: number): number {
  const cls =
    REALM_RACERS_BOT_CLASSES[
      (sim.realmRacers.nextMatchId + offset) % REALM_RACERS_BOT_CLASSES.length
    ];
  const pid = sim.addPlayer(cls, nextBotName(sim), { bot: true });
  sim.realmRacers.bots.set(pid, tier);
  return pid;
}

/** Take a house pilot back out of the world. */
function despawnRallyBot(sim: Sim, pid: number): void {
  sim.realmRacers.bots.delete(pid);
  if (sim.entities.has(pid)) sim.removePlayer(pid);
}

/**
 * Fill the grid out to `REALM_RACERS_GRID_SIZE` with freshly spawned house
 * pilots and drop the flag. Cleans every bot back up if the match refuses to
 * start, so a failed attempt can never leak a stray player into the world.
 *
 * `humanPids` take the leading grid slots in the order given; the house pilots
 * take the rest. `practiceSlot` picks the lane: **negative** races on the PUBLIC
 * lane of a competition circuit (the online backfill, which is finishing a
 * queued race the ordinary way), and any lane index at all, INCLUDING ZERO, is a
 * private practice copy. Zero is a real practice lane the day the practice
 * circuit stops serving competition and loses its public lane, so the sentinel
 * has to be the sign, never falsiness.
 */
function seatWithBots(
  sim: Sim,
  humanPids: readonly number[],
  tier: RallyDriverTier,
  practiceSlot: number,
  circuitId?: string,
): boolean {
  const seats = REALM_RACERS_GRID_SIZE - humanPids.length;
  if (seats < 0) return false;
  const bots: number[] = [];
  for (let i = 0; i < seats; i++) bots.push(spawnRallyBot(sim, tier, i));
  const seat = practiceSlot >= 0 ? { ownerPid: humanPids[0], slot: practiceSlot } : undefined;
  if (!realmRacersStartMatch(sim.ctx, [...humanPids, ...bots], seat, circuitId)) {
    for (const pid of bots) despawnRallyBot(sim, pid);
    return false;
  }
  // Out of the queue now that they are seated: startMatch does not dequeue (the
  // queue's own caller splices before it), so a seated racer left in the queue
  // would be matched a second time the moment the grid filled again.
  for (const pid of humanPids) realmRacersQueueRemove(sim.ctx, pid);
  return true;
}

/**
 * The Practice affordance: race a full grid of house pilots right now. No queue,
 * no wait, no other players, and no waiting on ANYONE else either: it takes a
 * private copy of the whole circuit, so a race already running (or five) is
 * irrelevant to it.
 *
 * Refuses silently when it cannot, exactly as the queue join does: the window
 * already shows the player why (they are racing, or the realm has handed out
 * every copy it has), so there is nothing for the sim to say. Combat is the
 * one refusal it voices, as the queue join does, because the window cannot
 * show it. Runs identically offline and on the server (via realm_racers_practice).
 */
export function startRealmRacersPractice(sim: Sim, tier: RallyDriverTier, pid?: number): boolean {
  const resolved = sim.ctx.resolve(pid);
  if (!resolved) return false;
  const id = resolved.meta.entityId;
  // Already racing, here or on someone else's grid: one machine per pilot.
  // Being QUEUED is not a refusal, though: pressing Play is a clear "race
  // now", and seatWithBots takes them out of the queue. Everything else a
  // racer can be doing (dead, in a duel, inside an instance) is the match
  // module's own eligibility test, the one every entry point shares, asked
  // here before any house pilot is spawned: the seat would refuse it anyway,
  // but only after spawning and despawning three of them.
  if (realmRacersMatchOf(sim.ctx, id)) return false;
  if (realmRacersInCombat(sim.ctx, id)) {
    sim.ctx.error(id, "You can't do that while in combat.");
    return false;
  }
  if (!realmRacersEligible(sim.ctx, id)) return false;
  const slot = realmRacersFreePracticeSlot(sim.ctx);
  if (slot < 0) return false;
  return seatWithBots(sim, [id], tier, slot);
}

/**
 * Dev only: race a full grid of house pilots on a NAMED circuit, right now.
 *
 * It exists because the ordinary way onto a competition circuit is to queue and
 * wait out the backfill, which is minutes per attempt while a circuit is being
 * tuned. It takes the circuit's PUBLIC lane rather than a private copy, since
 * that is the lane a real race drives and the one worth testing, so it refuses
 * while a public race is already running. Gated by `ctx.devCommands` at its
 * caller and again here, never reachable in production.
 */
export function startRealmRacersDevRace(
  sim: Sim,
  circuitId: string,
  tier: RallyDriverTier,
  pid?: number,
): boolean {
  if (!sim.ctx.devCommands) return false;
  const resolved = sim.ctx.resolve(pid);
  if (!resolved) return false;
  const id = resolved.meta.entityId;
  if (realmRacersMatchOf(sim.ctx, id)) return false;
  if (!realmRacersCircuitById(circuitId)) return false;
  if (!realmRacersEligible(sim.ctx, id) || realmRacersInCombat(sim.ctx, id)) return false;
  return seatWithBots(sim, [id], tier, -1, circuitId);
}

/** Online: a queue whose oldest waiter has been there long enough gets house
 *  pilots in every seat no human turned up for. */
function maybeBackfill(sim: Sim): void {
  if (!sim.cfg.realmRacersBackfill) return;
  const rally = sim.realmRacers;
  if (rally.match) return;
  const waiting = rally.queue.slice(0, REALM_RACERS_GRID_SIZE);
  // An empty queue has nobody to race, and a full one is the match module's
  // business: it seats four humans without any help from here.
  if (waiting.length === 0 || waiting.length >= REALM_RACERS_GRID_SIZE) return;
  // The clock is the OLDEST waiter's. Anyone who joined behind them is racing
  // sooner than their own 45 s, which is the right way round: nobody at the head
  // of the queue is ever made to wait longer because the queue grew.
  let oldest = sim.tickCount;
  for (const pid of waiting) {
    const joinedAt = rally.queuedAtTick.get(pid);
    if (joinedAt !== undefined && joinedAt < oldest) oldest = joinedAt;
  }
  if (sim.tickCount - oldest < REALM_RACERS_BACKFILL_TICKS) return;
  // A waiter still in a fight holds the backfill until it ends: the seat would
  // refuse them, after spawning and despawning a pilot per empty seat per tick.
  for (const pid of waiting) if (realmRacersInCombat(sim.ctx, pid)) return;
  // The PUBLIC circuit: these players queued for a real race and are getting
  // one, just with house pilots in the seats nobody claimed.
  seatWithBots(sim, waiting, REALM_RACERS_BACKFILL_TIER, -1);
}

/** The rival a bot shoots at and races: the nearest other racer still running,
 *  with the world velocity the brain leads its shot along. */
function nearestRival(
  sim: Sim,
  match: RealmRacersMatch,
  pid: number,
): { x: number; z: number; vx: number; vz: number } | null {
  let best: { x: number; z: number; vx: number; vz: number } | null = null;
  let bestD2 = Number.POSITIVE_INFINITY;
  const self = sim.entities.get(pid);
  if (!self) return null;
  for (const other of match.pids) {
    if (other === pid) continue;
    // A rival whose own race is over is not a rival: they are parked waiting to
    // be returned, or already back in the Evergarden with a stale position.
    if (!realmRacersStillRunning(match, other)) continue;
    const e = sim.entities.get(other);
    if (!e || e.dead) continue;
    const dx = e.pos.x - self.pos.x;
    const dz = e.pos.z - self.pos.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = {
        x: e.pos.x,
        z: e.pos.z,
        vx: e.drive ? vehicleVelocityX(e.drive, e.facing) : 0,
        vz: e.drive ? vehicleVelocityZ(e.drive, e.facing) : 0,
      };
    }
  }
  return best;
}

/** One tick of one house pilot: build the brain's snapshot, hold what it asks
 *  for, and pull the trigger when it says to. */
function driveRallyBot(
  sim: Sim,
  pid: number,
  tier: RallyDriverTier,
  match: RealmRacersMatch,
): void {
  const e = sim.entities.get(pid);
  const meta = sim.players.get(pid);
  if (!e || !meta) return;
  // Released every tick, so a bot whose race ends mid-corner stops holding the
  // throttle rather than driving off into the garden.
  meta.moveInput = emptyMoveInput();
  if (match.phase !== 'racing' || e.dead) return;
  const drive = e.drive;
  const progress = match.progress.get(pid);
  if (!drive || !progress || !realmRacersStillRunning(match, pid)) return;

  // The brain reasons entirely in the CANONICAL frame the circuit is authored
  // in, so everything it is handed is shifted off this race's own copy first.
  // Headings and speeds are frame-invariant (the shift is a pure translation),
  // which is why only positions are converted.
  const here = realmRacersToCanonical(match, e.pos.x, e.pos.z);
  const track = realmRacersTrack(realmRacersCircuitOf(match));
  // The match module reprojected this racer earlier in the same tick, so its
  // search hint is current and this costs a local window scan, not a lap scan.
  const projection = track.project(here.x, here.z, progress.trackIndex);
  const incoming: RallyDriverBlast[] = [];
  for (const blast of match.groundBlasts) {
    if (blast.ownerPid === pid) continue;
    const at = realmRacersToCanonical(match, blast.x, blast.z);
    incoming.push({ x: at.x, z: at.z, ticksToImpact: blast.impactTick - sim.tickCount });
  }
  const rival = nearestRival(sim, match, pid);
  // The slot, never a hardcoded id: a bot handed a different weapon by a pickup
  // or by its machine's profile pulls the trigger on that one.
  const weapon = progress.heldWeapon;
  const out = driveRealmRacers({
    pid,
    x: here.x,
    z: here.z,
    facing: e.facing,
    speed: drive.speed,
    slip: drive.slip,
    // The carried contact spin rides with it: to the brain, being shoved
    // sideways and steering into it are the same rotation to anticipate.
    yawRate: drive.yawRate + drive.spin,
    track,
    projection,
    topSpeed: vehicleTopSpeedFor(drive, auraSpeedMult(e)),
    steerAngle: drive.steerAngle,
    steerLockSeconds: 1 / vehicleProfile(drive.profileKey).steerRate,
    // Positions shift into the canonical frame; velocities are frame-invariant
    // under a pure translation and pass through untouched.
    rival: rival
      ? { ...realmRacersToCanonical(match, rival.x, rival.z), vx: rival.vx, vz: rival.vz }
      : null,
    incoming,
    weaponReady:
      weapon !== null && weapon.charges !== 0 && !e.cooldowns.has(weapon?.abilityId ?? ''),
    tier,
    tick: sim.tickCount,
  });
  meta.moveInput.forward = out.forward;
  meta.moveInput.back = out.back;
  meta.moveInput.turnLeft = out.turnLeft;
  meta.moveInput.turnRight = out.turnRight;
  // Space is the handbrake while driving; the kernel reads it off the same flag
  // a human's jump key sets, so nothing bot-specific reaches the movement path.
  meta.moveInput.jump = out.handbrake;
  // The bot aims the same ground point a player does, so the shot goes down the
  // same aimed-cast path and through the same authoritative clamp. Its aim comes
  // back in the canonical frame the brain reasons in and shifts onto this race's
  // own copy of the circuit before it is cast.
  if (out.fireAt && weapon) {
    sim.castAbility(weapon.abilityId, pid, realmRacersToWorld(match, out.fireAt.x, out.fireAt.z));
  }
}

/**
 * Called once per tick from Sim.updateRealmRacers, right after the match
 * module: reap finished pilots, top up the online backfill, and steer whoever
 * is still racing.
 */
export function updateRealmRacersBots(sim: Sim): void {
  const rally = sim.realmRacers;
  // The public race as it stood BEFORE the backfill below can seat one: a grid
  // seated on this tick is steered from the next, as it always has been.
  const publicRace = rally.match;
  // Reap first, and by one rule: a house pilot seated in NO live race (public or
  // practice) has had its race torn down, whatever ended it (the finish, a
  // forfeit, the time limit, the human disconnecting). One rule means no exit
  // path can be the one that leaks a pilot into the world forever. Deleting the
  // entry being visited is safe in a Map walk, so no copy of the keys is made.
  if (rally.bots.size > 0) {
    for (const pid of rally.bots.keys()) {
      if (!onAnyLiveGrid(rally, pid)) despawnRallyBot(sim, pid);
    }
  }
  if (!rally.match) maybeBackfill(sim);
  // Steer every seated pilot in its OWN race: the public one and each private
  // practice copy run side by side and never see each other.
  if (publicRace) steerHousePilots(sim, publicRace);
  for (let i = 0; i < rally.practices.length; i++) steerHousePilots(sim, rally.practices[i]);
}

/** Is this pid on the frozen grid of any live race, public or practice? */
function onAnyLiveGrid(rally: Sim['realmRacers'], pid: number): boolean {
  if (rally.match?.pids.includes(pid)) return true;
  for (let i = 0; i < rally.practices.length; i++) {
    if (rally.practices[i].pids.includes(pid)) return true;
  }
  return false;
}

/** One tick of every house pilot on one race's grid. */
function steerHousePilots(sim: Sim, match: RealmRacersMatch): void {
  for (const pid of match.pids) {
    const tier = sim.realmRacers.bots.get(pid);
    if (tier) driveRallyBot(sim, pid, tier, match);
  }
}
