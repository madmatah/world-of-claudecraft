import { describe, expect, it } from 'vitest';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';

/** The circuit a QUEUED race runs on, which is what every case here seats.
 *  Resolved from the pool rather than named, so these suites follow the
 *  competition circuit instead of silently measuring the practice one. */
const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersGates, realmRacersTrack } from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_LOITER_TICKS,
  REALM_RACERS_LOITER_WARN_TICKS,
} from '../src/sim/realm_racers_track_limits';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS,
  REALM_RACERS_RESET_LOCK_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WRONG_WAY_TICKS,
  type RealmRacersMatch,
  realmRacersMovementLocked,
  realmRacersStartMatch,
  realmRacersToCanonical,
  realmRacersToWorld,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { type Entity, TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './vale_cup_util';

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function staged(): {
  sim: Sim;
  a: number;
  b: number;
  pids: number[];
  match: RealmRacersMatch;
  racer: Entity;
} {
  const sim = makeWorld();
  const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40),
  );
  // Seated on the NAMED circuit rather than through the queue's draw: the pool
  // holds more than one competition circuit, and every arc below is measured
  // on this one's road.
  realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id);
  sim.tick();
  const match = required(sim.realmRacers.match, 'race');
  if (match.circuitId !== RACE_CIRCUIT.id) throw new Error('race seated on another circuit');
  const racer = required(sim.entities.get(pids[0]), 'racer');
  return { sim, a: pids[0], b: pids[1], pids, match, racer };
}

/**
 * A canonical spline point placed on the race's OWN lane, keeping the sample's
 * frame-independent fields (arc length, tangent, width) as they are.
 *
 * Every case here seats a PUBLIC race, and a public race stopped standing on
 * lane 0 the day the practice circuit lost its public lane: a canonical point is
 * no longer a world one, and comparing a racer's world position against one
 * silently measures the lane offset instead of the recovery.
 */
function onLane(match: RealmRacersMatch, s: number) {
  const point = realmRacersTrack(RACE_CIRCUIT).pointAt(s);
  const world = realmRacersToWorld(match, point.x, point.z);
  return { ...point, x: world.x, z: world.z };
}

/**
 * Parks a machine off the road at a chosen arc position, with the lap
 * bookkeeping a machine that DROVE there would have left behind.
 *
 * A bare teleport is not a drive, and the track-limits referee is written in
 * exactly that difference: it measures arc gained against ground covered, so a
 * fixture that jumps a machine a third of a lap forward reads as a cut and is
 * returned before the case under test gets a tick. Stamping `lastS` at the
 * destination is what makes the jump a premise rather than an event.
 */
function parkOffRoad(sim: Sim, match: RealmRacersMatch, pid: number, x: number, z: number): void {
  teleport(sim, pid, x, z);
  const progress = required(match.progress.get(pid), `progress ${pid}`);
  const local = realmRacersToCanonical(match, x, z);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(local.x, local.z);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function racing() {
  const stagedRace = staged();
  stagedRace.match.phase = 'racing';
  stagedRace.sim.tick();
  return stagedRace;
}

describe('Realm Racers recovery', () => {
  it('pins a two-second manual lock and three-second automatic recovery wait', () => {
    expect(REALM_RACERS_RESET_LOCK_TICKS).toBe(40);
    expect(REALM_RACERS_STUCK_TICKS).toBe(60);
  });

  it('advances the silent recovery anchor after crossing the next ordered spline gate', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const gate = required(realmRacersGates(RACE_CIRCUIT)[1], 'recovery gate');
    progress.nextResetGate = gate.index;
    const before = realmRacersToWorld(match, gate.x - gate.dirX * 1.5, gate.z - gate.dirZ * 1.5);
    const after = realmRacersToWorld(match, gate.x + gate.dirX * 1.5, gate.z + gate.dirZ * 1.5);
    racer.prevPos.x = before.x;
    racer.prevPos.z = before.z;
    racer.pos.x = after.x;
    racer.pos.z = after.z;
    sim.drainEvents();

    updateRealmRacers(sim.ctx);

    expect(progress).toMatchObject({ nextResetGate: 2, resetS: gate.s });
    expect(progress.resetDistanceSinceWrap).toBeLessThan(progress.distanceSinceWrap);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('resets to the recovery-anchor pose and restores its progress snapshot', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const track = realmRacersTrack(RACE_CIRCUIT);
    const anchor = onLane(match, track.length * 0.25);
    progress.resetS = anchor.s;
    progress.resetLap = 2;
    progress.resetDistanceSinceWrap = track.length * 0.25;
    progress.lap = 3;
    progress.distanceSinceWrap = track.length * 0.9;
    required(racer.drive, 'drive').speed = 38;
    teleport(sim, a, anchor.x + 30, anchor.z + 30);
    sim.drainEvents();

    sim.realmRacersResetPosition(a);

    expect(racer.pos.x).toBeCloseTo(anchor.x, 6);
    expect(racer.pos.z).toBeCloseTo(anchor.z, 6);
    expect(racer.facing).toBeCloseTo(Math.atan2(anchor.tx, anchor.tz), 6);
    expect(racer.drive).toMatchObject({ speed: 0, slip: 0, controlsLocked: true });
    expect(progress).toMatchObject({
      lap: 2,
      lastS: anchor.s,
      distanceSinceWrap: track.length * 0.25,
      wrongWay: false,
      stuckTicks: 0,
    });
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(true);
    expect(sim.drainEvents()).toContainEqual({ type: 'realmRacersReset', pid: a });
  });

  it('ignores reset requests outside a live racing phase', () => {
    const { sim, a, match, racer } = staged();
    const countdownX = racer.pos.x;
    sim.realmRacersResetPosition(a);
    expect(racer.pos.x).toBe(countdownX);

    match.phase = 'finished';
    racer.pos.x += 7;
    const finishedX = racer.pos.x;
    sim.realmRacersResetPosition(a);
    expect(racer.pos.x).toBe(finishedX);
  });

  it('holds movement for two seconds after a reset, then returns control', () => {
    const { sim, a, match, pids, racer } = racing();
    // Clear the rest of the grid off the centerline: recovery drops a machine
    // on the racing line, and a neighbour parked on it would legitimately be
    // shoved aside by the contact pass, which is a different test.
    const track = realmRacersTrack(RACE_CIRCUIT);
    pids.slice(1).forEach((pid, i) => {
      const away = onLane(match, track.length * (0.3 + i * 0.15));
      teleport(sim, pid, away.x, away.z);
    });
    sim.realmRacersResetPosition(a);
    const startX = racer.pos.x;
    const startZ = racer.pos.z;
    required(sim.players.get(a), 'player').moveInput.forward = true;

    for (let i = 0; i < REALM_RACERS_RESET_LOCK_TICKS; i++) sim.tick();
    expect(Math.hypot(racer.pos.x - startX, racer.pos.z - startZ)).toBeLessThan(0.01);
    expect(racer.drive?.speed).toBe(0);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(true);

    sim.tick();
    expect(racer.drive?.speed).toBeGreaterThan(0);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(false);
  });

  it('automatically recovers after three seconds stopped off track with only the one-tick lock', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const track = realmRacersTrack(RACE_CIRCUIT);
    const road = onLane(match, track.length * 0.4);
    progress.resetS = road.s;
    const lateral = road.halfWidth + 8;
    parkOffRoad(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.resetLockedUntilTick).toBe(0);
    sim.tick();

    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
    // Since 22b the automatic recovery takes a ONE-TICK lock, just long enough
    // for the pickup and slick eligibility guard to refuse the landing tick,
    // nothing like the manual reset's full control lock. The pilot is free on
    // the next tick.
    expect(REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS).toBe(1);
    expect(progress.resetLockedUntilTick).toBe(
      sim.ctx.tickCount + REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS + 1,
    );
    expect(racer.drive?.controlsLocked).toBe(true);
    while (sim.ctx.tickCount < progress.resetLockedUntilTick) sim.tick();
    expect(racer.drive?.controlsLocked).toBe(false);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(false);
    expect(racer.auras.some((aura) => aura.name === REALM_RACERS_VERGE_BAND.name)).toBe(false);
  });

  it('never auto-recovers a machine parked on the road', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.4);
    teleport(sim, a, road.x, road.z);

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) sim.tick();

    expect(progress.resetLockedUntilTick).toBe(0);
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
  });

  it('never auto-recovers an off-road machine that is still moving', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.4);
    const lateral = road.halfWidth + 8;
    parkOffRoad(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    const offRoadX = racer.pos.x;
    const offRoadZ = racer.pos.z;

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) {
      required(racer.drive, 'drive').speed = 2;
      updateRealmRacers(sim.ctx);
    }

    expect(progress.stuckTicks).toBe(0);
    expect(racer.pos.x).toBeCloseTo(offRoadX, 5);
    expect(racer.pos.z).toBeCloseTo(offRoadZ, 5);
  });

  it('never advances the recovery anchor past the next UNCROSSED gate, so reset never gains ground', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const gates = realmRacersGates(RACE_CIRCUIT);
    const gate2 = required(gates[2], 'gate 2');
    const gate3 = required(gates[3], 'gate 3');

    // Cross gates 1 and 2 in order, exactly like the single-gate case above,
    // so the anchor legitimately advances twice before the probe.
    for (const gate of [required(gates[1], 'gate 1'), gate2]) {
      progress.nextResetGate = gate.index;
      const before = realmRacersToWorld(match, gate.x - gate.dirX * 1.5, gate.z - gate.dirZ * 1.5);
      const after = realmRacersToWorld(match, gate.x + gate.dirX * 1.5, gate.z + gate.dirZ * 1.5);
      racer.prevPos.x = before.x;
      racer.prevPos.z = before.z;
      racer.pos.x = after.x;
      racer.pos.z = after.z;
      updateRealmRacers(sim.ctx);
    }
    expect(progress).toMatchObject({ nextResetGate: gate3.index, resetS: gate2.s });
    const anchorAfterGate2 = { resetS: progress.resetS, resetLap: progress.resetLap };

    // Approach gate 3 but stop just short of its plane: both prevPos and pos
    // stay on the near side, so this tick crosses nothing.
    const short = realmRacersToWorld(match, gate3.x - gate3.dirX * 1.5, gate3.z - gate3.dirZ * 1.5);
    racer.prevPos.x = short.x;
    racer.prevPos.z = short.z;
    racer.pos.x = short.x + gate3.dirX * 0.2;
    racer.pos.z = short.z + gate3.dirZ * 0.2;
    updateRealmRacers(sim.ctx);

    expect(progress).toMatchObject({ nextResetGate: gate3.index, ...anchorAfterGate2 });

    sim.drainEvents();
    sim.realmRacersResetPosition(a);
    const anchor = onLane(match, anchorAfterGate2.resetS);
    expect(racer.pos.x).toBeCloseTo(anchor.x, 6);
    expect(racer.pos.z).toBeCloseTo(anchor.z, 6);
  });

  it('requires the full stuck window WITHOUT interruption, not an accumulated total', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.4);
    progress.resetS = road.s;
    const lateral = road.halfWidth + 8;
    const offRoadX = road.x - road.tz * lateral;
    const offRoadZ = road.z + road.tx * lateral;
    parkOffRoad(sim, match, a, offRoadX, offRoadZ);

    // Stopped off track for most, but not all, of the window.
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.stuckTicks).toBe(REALM_RACERS_STUCK_TICKS - 1);

    // One tick back on the road interrupts the count...
    teleport(sim, a, road.x, road.z);
    sim.tick();
    expect(progress.stuckTicks).toBe(0);

    // ...so returning off track resets the wait: the two nearly-full bouts
    // never sum past the threshold, only a single unbroken window does.
    parkOffRoad(sim, match, a, offRoadX, offRoadZ);
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.resetLockedUntilTick).toBe(0);
    expect(racer.pos.x).toBeCloseTo(offRoadX, 5);

    sim.tick();
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
  });

  it('never counts an off-road stopped machine while its manual reset lock is active', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.4);
    const lateral = road.halfWidth + 8;
    parkOffRoad(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    const lockedX = racer.pos.x;
    const lockedZ = racer.pos.z;
    progress.resetLockedUntilTick = sim.ctx.tickCount + REALM_RACERS_RESET_LOCK_TICKS;

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) updateRealmRacers(sim.ctx);

    expect(progress.stuckTicks).toBe(0);
    expect(racer.pos.x).toBeCloseTo(lockedX, 5);
    expect(racer.pos.z).toBeCloseTo(lockedZ, 5);
  });
});

describe('Realm Racers wrong-way state', () => {
  it('requires sustained reverse heading and clears on a forward heading', () => {
    const { sim, a, match, racer } = racing();
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.3);
    teleport(sim, a, road.x, road.z);
    racer.facing = Math.atan2(-road.tx, -road.tz);

    for (let i = 0; i < REALM_RACERS_WRONG_WAY_TICKS - 1; i++) sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(true);

    racer.facing = Math.atan2(road.tx, road.tz);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
  });

  it('never raises on an isolated blip followed by neutral driving', () => {
    const { sim, a, match, racer } = racing();
    const road = onLane(match, realmRacersTrack(RACE_CIRCUIT).length * 0.3);
    teleport(sim, a, road.x, road.z);

    // One tick pointed backward: far short of the debounce window.
    racer.facing = Math.atan2(-road.tx, -road.tz);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);

    // Then drive with a heading perpendicular to the track (forwardDot ~ 0,
    // inside the dead zone) for well over the debounce window. A regression
    // that dropped the debounce entirely would have already tripped above;
    // this proves the blip alone never surfaces as wrongWay to the player.
    racer.facing = Math.atan2(-road.tz, road.tx);
    for (let i = 0; i < REALM_RACERS_WRONG_WAY_TICKS * 2; i++) {
      sim.tick();
      expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
    }
  });
});

describe('Realm Racers track limits in a live race', () => {
  /**
   * Moves a machine as if it had DRIVEN there this tick: `prevPos` is where it
   * stood, `pos` is where it ends up, and the referee reads the distance
   * between them as the ground it covered. That is the whole difference between
   * this and `teleport`, which collapses the two and looks like a cut.
   */
  function glide(sim: Sim, pid: number, x: number, z: number): void {
    const e = required(sim.entities.get(pid), `entity ${pid}`);
    e.prevPos = { ...e.pos };
    e.pos.x = x;
    e.pos.z = z;
    sim.ctx.rebucket(e);
    updateRealmRacers(sim.ctx);
  }

  /** Puts a machine ON the road at `s`, with the bookkeeping to match. */
  function startFrom(sim: Sim, match: RealmRacersMatch, pid: number, s: number) {
    const point = onLane(match, s);
    parkOffRoad(sim, match, pid, point.x, point.z);
    return point;
  }

  /** The first pair of samples on the lap whose straight chord saves more than
   *  `minSaving` yards of arc: the shortest path a cheater can actually take. */
  function findCut(minSaving: number): { from: number; to: number } {
    const track = realmRacersTrack(RACE_CIRCUIT);
    const count = track.samples.length;
    for (let from = 0; from < count; from += 3) {
      for (let ahead = 40; ahead < count / 2; ahead += 5) {
        const to = (from + ahead) % count;
        const a = track.samples[from];
        const b = track.samples[to];
        if (ahead * track.step - Math.hypot(b.x - a.x, b.z - a.z) > minSaving) {
          return { from, to };
        }
      }
    }
    throw new Error('this circuit offers no cut worth taking, so nothing here is under test');
  }

  it('returns a machine that cuts a corner to the point it left the road', () => {
    const { sim, a, match } = racing();
    const track = realmRacersTrack(RACE_CIRCUIT);
    const progress = required(match.progress.get(a), 'progress');
    const cut = findCut(40);
    // Advance the ordered anchor for real before the cut: DRIVE across the
    // start line, so `resetS` sits at gate 0 by an honest crossing. The old
    // fixture parked the machine exactly ON the gate plane and the anchor
    // advance rested on a 1e-13 floating-point coincidence that flipped with
    // the gate band's width.
    const approach = onLane(match, track.length - 2);
    parkOffRoad(sim, match, a, approach.x, approach.z);
    const past = onLane(match, 2);
    glide(sim, a, past.x, past.z);
    expect(progress.resetS).toBe(0);
    // Start the cut clear of the gate plane, not on it.
    const exit = startFrom(sim, match, a, track.samples[Math.max(cut.from, 3)].s);
    const lapBefore = progress.lap;
    const target = onLane(match, track.samples[cut.to].s);

    // Drive the chord in racing-sized steps until the referee steps in,
    // remembering how far down the lap the cut had got by then.
    const span = Math.hypot(target.x - exit.x, target.z - exit.z);
    const steps = Math.ceil(span / 3);
    let reachedS = progress.lastS;
    for (let i = 1; i <= steps && progress.cutReturnUntilTick === 0; i++) {
      const t = i / steps;
      reachedS = progress.lastS;
      glide(sim, a, exit.x + (target.x - exit.x) * t, exit.z + (target.z - exit.z) * t);
    }

    // Caught partway across rather than credited on arrival.
    expect(progress.cutReturnUntilTick).toBeGreaterThan(sim.ctx.tickCount);
    const racer = required(sim.entities.get(a), 'racer');
    // Put back ON the racing line, which is where a reset leaves a machine, and
    // BEHIND the arc the cut had reached: the gain is undone, not banked.
    const back = onLane(match, progress.lastS);
    expect(Math.hypot(racer.pos.x - back.x, racer.pos.z - back.z)).toBeLessThan(0.5);
    expect(reachedS - progress.lastS).toBeGreaterThan(20);
    // ...and the return is to the point the road was LEFT, not to a gate: the
    // last ordered anchor is a long way further back than this.
    expect(progress.lastS).toBeGreaterThan(progress.resetS);
    expect(progress.lap).toBe(lapBefore);
    // A short control lock, not a stop-go penalty: the point is to undo a gain.
    expect(progress.resetLockedUntilTick).toBeGreaterThan(sim.ctx.tickCount);
    expect(progress.resetLockedUntilTick - sim.ctx.tickCount).toBeLessThan(
      REALM_RACERS_RESET_LOCK_TICKS,
    );
    // ...and the pilot is told why, in one line, for a few seconds.
    expect(sim.realmRacersInfoFor(a).match?.cutReturned).toBe(true);
  });

  it('leaves a machine that ran wide and rejoined ahead completely alone', () => {
    // The defect the whole containment family had, and the reason this design
    // replaced it: an excursion that DROVE its yards is racing, whichever side
    // of the road it happened on.
    const { sim, a, match } = racing();
    const track = realmRacersTrack(RACE_CIRCUIT);
    const progress = required(match.progress.get(a), 'progress');
    const start = track.length * 0.5;
    startFrom(sim, match, a, start);
    for (let i = 1; i <= 20; i++) {
      const point = onLane(match, start + i * 3);
      // Nine yards OUTSIDE the road: past the verge, well into the garden.
      const wide = point.halfWidth + 9;
      glide(sim, a, point.x + point.tz * wide, point.z - point.tx * wide);
    }
    expect(progress.cutReturnUntilTick).toBe(0);
    expect(progress.lastS).toBeGreaterThan(start + 50);
    expect(sim.realmRacersInfoFor(a).match?.cutReturned).toBe(false);
  });

  it('counts a machine loitering off the road down, then returns it to the last anchor', () => {
    const { sim, a, match, racer } = racing();
    const track = realmRacersTrack(RACE_CIRCUIT);
    const progress = required(match.progress.get(a), 'progress');
    const road = onLane(match, track.length * 0.4);
    progress.resetS = road.s;
    // Parked in the infield, moving just enough that the STUCK arm (three
    // seconds under 0.75 yd/s) never fires: this is the camper, not the wedged
    // machine, and only the loiter clock catches it.
    const lateral = road.halfWidth + 10;
    parkOffRoad(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    const countdowns: number[] = [];
    for (let i = 0; i < REALM_RACERS_LOITER_TICKS; i++) {
      required(racer.drive, 'drive').speed = 4;
      // A yard of circling, so the odometer runs and the arc does not.
      const wobble = i % 2 === 0 ? 1 : -1;
      glide(sim, a, racer.pos.x + road.tz * wobble, racer.pos.z - road.tx * wobble);
      countdowns.push(sim.realmRacersInfoFor(a).match?.offTrackIn ?? 0);
    }
    // Warned first, counting down in whole seconds, and silent before that.
    expect(countdowns[0]).toBe(0);
    expect(Math.max(...countdowns)).toBe(REALM_RACERS_LOITER_WARN_TICKS / TICK_RATE);
    expect(countdowns.filter((seconds) => seconds > 0).length).toBeGreaterThan(TICK_RATE);
    // ...then put back on the last ordered anchor, which is the recovery every
    // other arm uses rather than a second machine of its own.
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
    expect(sim.realmRacersInfoFor(a).match?.offTrackIn).toBe(0);
  });
});
