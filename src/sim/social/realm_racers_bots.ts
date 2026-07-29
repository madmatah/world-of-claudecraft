// The Realm Racers house pilots: lore-named player bots that make the
// minigame playable alone. Two entry points, ONE body of code (the
// vale_cup_bots.ts model, whose contract this follows literally):
//
//   - Practice: the player presses a tier button and races a house pilot
//     immediately, with no queue and no wait. Works offline AND online, because
//     the same sim runs on the server.
//   - Backfill: online, a player left alone in the queue past
//     REALM_RACERS_BACKFILL_TICKS is paired with a house pilot rather than
//     waiting for a rival who may never come.
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

import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_BOT_CLASSES,
  REALM_RACERS_BOT_NAMES,
} from '../content/realm_racers';
import { auraSpeedMult } from '../player_motion';
import {
  driveRealmRacers,
  type RallyDriverShell,
  type RallyDriverTier,
} from '../realm_racers_driver';
import { realmRacersTrack } from '../realm_racers_spline';
import type { Sim } from '../sim';
import { emptyMoveInput, TICK_RATE } from '../types';
import { vehicleTopSpeedFor, vehicleVelocityX, vehicleVelocityZ } from '../vehicle_motion';
import {
  type RealmRacersMatch,
  realmRacersFreePracticeSlot,
  realmRacersMatches,
  realmRacersMatchOf,
  realmRacersQueueRemove,
  realmRacersStartMatch,
  realmRacersToCanonical,
  realmRacersToWorld,
} from './realm_racers';

/**
 * How long a lone racer waits before the Society sends a house pilot out to
 * meet them. Long enough that two humans who both walked up still get a real
 * race, short enough that the minigame is never a dead end.
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
  // Every house name is in use (one bot races at a time, so only a clash with
  // real players lands here): suffix deterministically.
  for (let i = 2; ; i++) {
    const name = `${REALM_RACERS_BOT_NAMES[0]} ${i}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Add a house pilot to the world and mark it as one. Class rotates on the
 *  match counter, so consecutive practice laps do not all face the same face. */
function spawnRallyBot(sim: Sim, tier: RallyDriverTier): number {
  const cls =
    REALM_RACERS_BOT_CLASSES[sim.realmRacers.nextMatchId % REALM_RACERS_BOT_CLASSES.length];
  const pid = sim.addPlayer(cls, nextBotName(sim));
  sim.realmRacers.bots.set(pid, tier);
  return pid;
}

/** Take a house pilot back out of the world. */
function despawnRallyBot(sim: Sim, pid: number): void {
  sim.realmRacers.bots.delete(pid);
  if (sim.entities.has(pid)) sim.removePlayer(pid);
}

/**
 * Put `humanPid` on the grid against a freshly spawned house pilot. Cleans the
 * bot back up if the match refuses to start, so a failed attempt can never leak
 * a stray player into the world.
 *
 * `practiceSlot` picks the copy of the circuit: -1 races on the one PUBLIC
 * circuit (the online backfill, which is finishing a queued race the ordinary
 * way), anything else is a private practice copy.
 */
function seatAgainstBot(
  sim: Sim,
  humanPid: number,
  tier: RallyDriverTier,
  practiceSlot: number,
): boolean {
  const botPid = spawnRallyBot(sim, tier);
  // Out of the queue first: startMatch does not dequeue (the queue's own caller
  // shifts before it), so a seated racer left in the queue would be matched a
  // second time the moment another player joined.
  realmRacersQueueRemove(sim.ctx, humanPid);
  const seat = practiceSlot > 0 ? { ownerPid: humanPid, slot: practiceSlot } : undefined;
  if (realmRacersStartMatch(sim.ctx, humanPid, botPid, seat)) return true;
  despawnRallyBot(sim, botPid);
  return false;
}

/**
 * The Practice affordance: race a house pilot right now. No queue, no wait, no
 * second player, and no waiting on ANYONE else either: it takes a private copy
 * of the whole circuit, so a race already running (or five) is irrelevant to it.
 *
 * Refuses silently when it cannot, exactly as the queue join does: the window
 * already shows the player why (they are racing, or the realm has handed out
 * every copy it has), so there is nothing for the sim to say.
 */
export function startRealmRacersPractice(sim: Sim, tier: RallyDriverTier, pid?: number): boolean {
  const resolved = sim.ctx.resolve(pid);
  if (!resolved) return false;
  const id = resolved.meta.entityId;
  // Already racing, here or on someone else's grid: one machine per pilot.
  // Being QUEUED is not a refusal, though: pressing Practice is a clear "race
  // now", and seatAgainstBot takes them out of the queue. Everything else a
  // racer can be doing (dead, in a duel, inside an instance) is re-checked by
  // the match module's own eligibility test, the one every entry point shares.
  if (realmRacersMatchOf(sim.ctx, id)) return false;
  const slot = realmRacersFreePracticeSlot(sim.ctx);
  if (slot < 0) return false;
  return seatAgainstBot(sim, id, tier, slot);
}

/** Online: a lone racer who has waited long enough gets a house pilot. */
function maybeBackfill(sim: Sim): void {
  if (!sim.cfg.realmRacersBackfill) return;
  const rally = sim.realmRacers;
  if (rally.match || rally.queue.length !== 1) return;
  const pid = rally.queue[0];
  const joinedAt = rally.queuedAtTick.get(pid);
  if (joinedAt === undefined || sim.tickCount - joinedAt < REALM_RACERS_BACKFILL_TICKS) return;
  // The PUBLIC circuit: this player queued for a real race and is getting one,
  // just with a house pilot in the other seat.
  seatAgainstBot(sim, pid, REALM_RACERS_BACKFILL_TIER, -1);
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
  if (!drive || !progress || progress.finishedTick !== null) return;

  // The brain reasons entirely in the CANONICAL frame the circuit is authored
  // in, so everything it is handed is shifted off this race's own copy first.
  // Headings and speeds are frame-invariant (the shift is a pure translation),
  // which is why only positions are converted.
  const here = realmRacersToCanonical(match, e.pos.x, e.pos.z);
  // The match module reprojected this racer earlier in the same tick, so its
  // search hint is current and this costs a local window scan, not a lap scan.
  const projection = realmRacersTrack().project(here.x, here.z, progress.trackIndex);
  const incoming: RallyDriverShell[] = [];
  for (const shell of match.shells) {
    if (shell.ownerPid === pid) continue;
    const at = realmRacersToCanonical(match, shell.x, shell.z);
    incoming.push({ x: at.x, z: at.z, ticksToImpact: shell.impactTick - sim.tickCount });
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
    projection,
    topSpeed: vehicleTopSpeedFor(drive, auraSpeedMult(e)),
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
  const live = realmRacersMatches(sim.ctx);
  // Reap first, and by one rule: a house pilot seated in NO live race (public or
  // practice) has had its race torn down, whatever ended it (the finish, a
  // forfeit, the time limit, the human disconnecting). One rule means no exit
  // path can be the one that leaks a pilot into the world forever.
  if (rally.bots.size > 0) {
    const seated = new Set<number>();
    for (const match of live) for (const pid of match.pids) seated.add(pid);
    for (const pid of [...rally.bots.keys()]) {
      if (!seated.has(pid)) despawnRallyBot(sim, pid);
    }
  }
  if (!rally.match) maybeBackfill(sim);
  // Steer every seated pilot in its OWN race: the public one and each private
  // practice copy run side by side and never see each other.
  for (const match of live) {
    for (const pid of match.pids) {
      const tier = rally.bots.get(pid);
      if (tier) driveRallyBot(sim, pid, tier, match);
    }
  }
}
