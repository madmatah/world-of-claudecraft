import { describe, expect, it } from 'vitest';
import {
  RALLY_PICKUP_POP_SECONDS,
  RALLY_PICKUP_SPAWN_SECONDS,
  rallyPickupInitialVisual,
  rallyPickupLift,
  rallyPickupScale,
  rallyPickupSpin,
  rallyPickupTakenSame,
  rallyPickupVisible,
  stepRallyPickupVisual,
} from '../src/render/realm_racers_pickups_core';
import { REALM_RACERS_ABILITY_ID, realmRacersWeaponCharges } from '../src/sim/content/realm_racers';
import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersCircuit,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import {
  createRealmRacersPickupState,
  REALM_RACERS_PICKUP_CHARGE_GRANT,
  REALM_RACERS_PICKUP_COOLDOWN_TICKS,
  REALM_RACERS_PICKUP_LANES,
  REALM_RACERS_PICKUP_REACH,
  REALM_RACERS_PICKUP_SPREAD,
  realmRacersPickupBoxes,
  realmRacersPickupLaneGap,
  realmRacersPickupTakenIndices,
  stepRealmRacersPickups,
} from '../src/sim/realm_racers_pickups';
import { travelledFromArc } from '../src/sim/realm_racers_progress';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_RESET_LOCK_TICKS,
  realmRacersForfeit,
  realmRacersResetPosition,
  realmRacersStartMatch,
  realmRacersToWorld,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { startRealmRacersPractice } from '../src/sim/social/realm_racers_bots';
import { TICK_RATE } from '../src/sim/types';
import { installScriptedRng, type ScriptedRng } from './helpers/realm_racers_rng';
import { addAt, makeWorld, teleport } from './realm_racers_util';

/** The circuit a QUEUED race runs on, which is what every live case here seats. */
const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

const GRID = [
  { cls: 'warrior', name: 'Aster', x: -5, z: -40 },
  { cls: 'mage', name: 'Briar', x: 7, z: -42 },
  { cls: 'rogue', name: 'Cass', x: -9, z: -38 },
  { cls: 'priest', name: 'Dell', x: 11, z: -44 },
] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function match(sim: Sim): NonNullable<Sim['realmRacers']['match']> {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

/** Four humans on the grid, past the lights, with nobody driving: every machine
 *  stands exactly where a case puts it. */
function racingGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  // Seated on the NAMED circuit rather than through the queue's draw: the pool
  // holds more than one competition circuit, and every box below is resolved
  // off this one's road.
  expect(realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id)).toBe(true);
  sim.tick();
  expect(sim.realmRacers.match).not.toBeNull();
  expect(match(sim).circuitId).toBe(RACE_CIRCUIT.id);
  for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
  expect(match(sim).phase).toBe('racing');
  return { sim, pids };
}

/**
 * Parks a machine on one box, with the lap bookkeeping a machine that DROVE
 * there would carry.
 *
 * Stamping `lastS` at the destination is what makes the jump a premise rather
 * than an event: the progress step reads the arc travelled since the last tick,
 * and a teleport across a circuit would otherwise read as a lap.
 *
 * `distanceSinceWrap` is stamped for the same reason and was missed, which is
 * `placeAt`'s rule applied here: a machine standing at that arc has driven that
 * far since the line. Left at zero it made every case's premise depend on WHERE
 * the circuit's rows happen to sit, since a lap only wraps on
 * `REALM_RACERS_MIN_LAP_FRACTION` of accumulated ground: a row at 12 percent of
 * the lap left enough road to the line to wrap and a row at 42 percent did not,
 * so moving a row turned three cases about lap bookkeeping red without anything
 * about lap bookkeeping having changed.
 */
function standOnBox(sim: Sim, pid: number, index: number): void {
  const live = match(sim);
  const box = realmRacersPickupBoxes(RACE_CIRCUIT)[index];
  const world = realmRacersToWorld(live, box.x, box.z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  const track = realmRacersTrack(RACE_CIRCUIT);
  const projection = track.project(box.x, box.z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
  progress.distanceSinceWrap = projection.s;
}

/**
 * Drives a machine THROUGH a box in one tick: twenty yards before it to twenty
 * past, along the road there.
 *
 * `teleport` collapses `prevPos` onto `pos`, so every other case in this file
 * hands the take rule a degenerate point and the swept segment goes unexercised.
 * This one writes `prevPos` after the jump, which is what a tick of real driving
 * leaves behind.
 */
function sweepThroughBox(sim: Sim, pid: number, index: number): void {
  const live = match(sim);
  const box = realmRacersPickupBoxes(RACE_CIRCUIT)[index];
  const point = realmRacersTrack(RACE_CIRCUIT).pointAt(box.s);
  const to = realmRacersToWorld(live, box.x + point.tx * 20, box.z + point.tz * 20);
  const from = realmRacersToWorld(live, box.x - point.tx * 20, box.z - point.tz * 20);
  teleport(sim, pid, to.x, to.z);
  const e = required(sim.entities.get(pid), `entity ${pid}`);
  e.prevPos = { ...e.pos, x: from.x, z: from.z };
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(box.x, box.z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

/**
 * Puts a machine on the centerline at a lap position, on a chosen lap, with the
 * bookkeeping a machine that DROVE there would carry: the arc is stamped so the
 * jump is not an event, and `distanceSinceWrap` is set to the arc itself, which
 * is exactly how far a machine at that position has driven since the line.
 */
function placeAt(sim: Sim, pid: number, s: number, lap?: number): void {
  const live = match(sim);
  const track = realmRacersTrack(RACE_CIRCUIT);
  const point = track.pointAt(s);
  const world = realmRacersToWorld(live, point.x, point.z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  progress.lastS = point.s;
  progress.trackIndex = Math.round(point.s / track.step);
  progress.distanceSinceWrap = point.s;
  if (lap !== undefined) progress.lap = lap;
  // Through the sim's OWN rule rather than left to the next tick to recompute:
  // a racer who has pulled off is skipped by the progress pass, so a premise
  // that relied on that tick would leave a retired machine holding whatever
  // ranking key it had at the flag.
  progress.travelled = travelledFromArc(progress.lap, point.s, track.length, point.s);
}

/**
 * Drives one racer the rest of the way round and over the start line, really
 * accumulating the lap: the wrap needs the distance behind it, so a jump to the
 * line is not a lap and the progress step correctly refuses it.
 */
function driveToTheLine(sim: Sim, pid: number): void {
  const track = realmRacersTrack(RACE_CIRCUIT);
  const live = match(sim);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  for (let s = progress.lastS + 40; s < track.length - 20; s += 40) {
    const point = track.pointAt(s);
    const world = realmRacersToWorld(live, point.x, point.z);
    teleport(sim, pid, world.x, world.z);
    updateRealmRacers(sim.ctx);
  }
  const start = track.pointAt(6);
  const world = realmRacersToWorld(live, start.x, start.z);
  teleport(sim, pid, world.x, world.z);
  updateRealmRacers(sim.ctx);
}

function chargesOf(sim: Sim, pid: number): number {
  const e = required(sim.entities.get(pid), `entity ${pid}`);
  return required(e.abilityCharges?.[REALM_RACERS_ABILITY_ID], 'charge pool').charges;
}

function takenOf(sim: Sim): number[] {
  return realmRacersPickupTakenIndices(match(sim).pickups);
}

/**
 * Force the next `count` takes to draw the REFILL, whatever band the taker is
 * running in.
 *
 * 22b turned the take into one weighted draw (`realm_racers_pickup_effects.ts`),
 * so every case below that is about the CHARGE has to own the value the stream
 * hands back or it is asserting about whichever effect the seed happened to
 * pick. A roll of 0 is the refill in all three tables (`charge` is the first row
 * of each, pinned in `realm_racers_pickup_effects.test.ts`), so one number
 * covers a leader, a midfielder and a backmarker alike.
 *
 * Safe against the rest of the tick: this rig's world has no camps, npcs or
 * ground objects, so a racing tick draws NOTHING outside the pickups, and the
 * scripted values can only be consumed by the take.
 */
function forceRefills(sim: Sim, count: number): ScriptedRng {
  const rng = installScriptedRng(sim);
  rng.script(...Array.from({ length: count }, () => 0));
  return rng;
}

describe('the pickup numbers themselves', () => {
  it('locks the refill to a full reload', () => {
    // A LITERAL, for the same reason the cooldown below is one: every other
    // assertion about a refill is written in terms of this constant and would
    // follow it anywhere. The operator raised it from 1 to 3 mid-review
    // (2026-08-04): one shell was a rounding error next to a race budget of 3.
    expect(REALM_RACERS_PICKUP_CHARGE_GRANT).toBe(3);
  });

  it('locks the cooldown to one second of ticks', () => {
    // A LITERAL, because every other assertion about the cooldown is written in
    // terms of this constant and would follow it anywhere: at 2 ticks the whole
    // "one box per pass" rule is gone and this suite would stay green.
    expect(REALM_RACERS_PICKUP_COOLDOWN_TICKS).toBe(20);
    expect(REALM_RACERS_PICKUP_COOLDOWN_TICKS).toBe(TICK_RATE);
  });

  it('measures the reach against the lane gap every shipped row really has', () => {
    // The reach is NOT under half the gap: at the minimum shipped road the two
    // catch zones overlap, which is the whole reason the take rule is "nearest
    // box, lowest index on a tie" rather than "the one box you are in". This
    // walks the shipped content so the day a row is authored on narrower road,
    // the number in that comment is the number here.
    const measured = REALM_RACERS_CIRCUIT_LIST.flatMap((circuit) => {
      const rows = new Map<number, number>();
      for (const box of realmRacersPickupBoxes(circuit)) {
        const gap = realmRacersPickupLaneGap(realmRacersTrack(circuit).halfWidthAt(box.s));
        rows.set(box.row, gap / 2);
      }
      return [...rows.values()];
    });
    expect(measured.length).toBeGreaterThanOrEqual(4);
    const tightest = Math.min(...measured);
    expect(tightest).toBeCloseTo(2.1333, 3);
    expect(tightest).toBeLessThan(REALM_RACERS_PICKUP_REACH);
    // And the readout says so, on exactly the rows where it is true: the
    // warning is what carries this into a circuit being drawn.
    const warned = REALM_RACERS_CIRCUIT_LIST.flatMap((circuit) =>
      realmRacersCircuitMetrics(circuit).problems.filter(
        (problem) => problem.code === 'pickup_row_lanes_overlap',
      ),
    );
    expect(warned).toHaveLength(measured.filter((half) => half < REALM_RACERS_PICKUP_REACH).length);
    for (const problem of warned) expect(problem.severity).toBe('warning');
  });

  it('derives the lane gap from the road, not from a table', () => {
    // Four boxes over 80 percent of the width means three gaps: at a 10 yard
    // half-width the span is 16 and the gap is 16/3.
    expect(realmRacersPickupLaneGap(10)).toBeCloseTo(16 / 3, 9);
    expect(realmRacersPickupLaneGap(8)).toBeCloseTo(12.8 / 3, 9);
  });
});

describe('Realm Racers pickup rows, resolved', () => {
  it('turns one authored row into four boxes spread over 80 percent of the road', () => {
    const circuit = REALM_RACERS_PRACTICE_CIRCUIT;
    const rows = required(circuit.pickupRows, 'authored rows');
    const boxes = realmRacersPickupBoxes(circuit);
    expect(boxes).toHaveLength(rows.length * REALM_RACERS_PICKUP_LANES);

    const track = realmRacersTrack(circuit);
    const first = boxes.filter((box) => box.row === 0);
    expect(first.map((box) => box.lane)).toEqual([0, 1, 2, 3]);
    const point = track.pointAt(rows[0].s * track.length);
    const outermost = REALM_RACERS_PICKUP_SPREAD * point.halfWidth;
    // The span is 80 percent of the ROAD's width, centred: a tenth of the road
    // stays clear on each side, which is the strip a pilot has to aim at to
    // miss the row on purpose.
    expect(first[0].lateral).toBeCloseTo(-outermost, 6);
    expect(first[3].lateral).toBeCloseTo(outermost, 6);
    expect(first[1].lateral).toBeCloseTo(-outermost / 3, 6);
    expect(first[2].lateral).toBeCloseTo(outermost / 3, 6);
    expect(Math.abs(first[0].lateral) / point.halfWidth).toBeCloseTo(0.8, 6);
  });

  it('lays every box of a row on the perpendicular at that arc', () => {
    const circuit = REALM_RACERS_PRACTICE_CIRCUIT;
    const track = realmRacersTrack(circuit);
    for (const box of realmRacersPickupBoxes(circuit)) {
      const point = track.pointAt(box.s);
      const alongX = box.x - point.x;
      const alongZ = box.z - point.z;
      // Zero component along the tangent: the row crosses the road, it does not
      // run down it.
      expect(alongX * point.tx + alongZ * point.tz).toBeCloseTo(0, 6);
      // And the offset is the left normal's, at the lateral the row claims.
      expect(alongX * -point.tz + alongZ * point.tx).toBeCloseTo(box.lateral, 6);
      expect(Math.hypot(alongX, alongZ)).toBeCloseTo(Math.abs(box.lateral), 6);
    }
  });

  it('resolves nothing for a circuit that authors no rows', () => {
    const bare: RealmRacersCircuit = { ...REALM_RACERS_PRACTICE_CIRCUIT, pickupRows: undefined };
    expect(realmRacersPickupBoxes(bare)).toEqual([]);
    expect(createRealmRacersPickupState(bare).taken).toEqual([]);
  });
});

describe('Realm Racers pickup boxes, in a race', () => {
  it('grants a full reload and arms the cooldown', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const before = chargesOf(sim, a);
    // The PREMISE, pinned: a machine at the flag is holding its race budget, so
    // "one more" below is one more than a number this suite did not invent.
    expect(before).toBe(realmRacersWeaponCharges(REALM_RACERS_ABILITY_ID));
    standOnBox(sim, a, 0);
    const rng = forceRefills(sim, 1);
    updateRealmRacers(sim.ctx);
    // The scripted roll really went to the take: a value stolen by another
    // system would leave this asserting about whatever the stream drew instead.
    expect(rng.consumed).toBe(1);
    expect(chargesOf(sim, a)).toBe(before + REALM_RACERS_PICKUP_CHARGE_GRANT);
    expect(takenOf(sim)).toEqual([0]);
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progress.pickupCooldownUntilTick).toBe(
      sim.tickCount + REALM_RACERS_PICKUP_COOLDOWN_TICKS,
    );
    // The pool tracks it exactly rather than merely allowing it: a count above
    // its own max is a shape every reader would have to special-case.
    const pool = required(
      sim.entities.get(a)?.abilityCharges?.[REALM_RACERS_ABILITY_ID],
      'charge pool',
    );
    expect(pool.charges).toBe(before + REALM_RACERS_PICKUP_CHARGE_GRANT);
    expect(pool.maxCharges).toBe(before + REALM_RACERS_PICKUP_CHARGE_GRANT);
    expect(pool.fixed).toBe(true);
  });

  it('leaves the pool at the race budget while the machine is still under it', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const budget = required(realmRacersWeaponCharges(REALM_RACERS_ABILITY_ID), 'budget');
    // Spent OUT, so the reload below lands exactly on the race budget rather
    // than past it: this is the arm where `maxCharges` is the RACE's number.
    const held = required(match(sim).progress.get(a)?.heldWeapon, 'weapon slot');
    held.charges = budget - REALM_RACERS_PICKUP_CHARGE_GRANT;
    standOnBox(sim, a, 0);
    forceRefills(sim, 1);
    updateRealmRacers(sim.ctx);
    const pool = required(
      sim.entities.get(a)?.abilityCharges?.[REALM_RACERS_ABILITY_ID],
      'charge pool',
    );
    expect(pool.charges).toBe(budget);
    expect(pool.maxCharges).toBe(budget);
  });

  it('takes the box for a machine with nothing to put the charge in', () => {
    const { sim, pids } = racingGrid();
    const [a, b] = pids;
    // Two arms that grant nothing and must still COLLECT: a machine with no
    // weapon slot at all, and one whose weapon fires without a budget. 22b
    // hands out more than charges, so neither may become a refusal.
    required(match(sim).progress.get(a), `progress ${a}`).heldWeapon = null;
    required(match(sim).progress.get(b), `progress ${b}`).heldWeapon = {
      abilityId: REALM_RACERS_ABILITY_ID,
      charges: null,
    };
    standOnBox(sim, a, 0);
    standOnBox(sim, b, 1);
    forceRefills(sim, 2);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toEqual([0, 1]);
    for (const pid of [a, b]) {
      expect(
        required(match(sim).progress.get(pid), `progress ${pid}`).pickupCooldownUntilTick,
      ).toBe(sim.tickCount + REALM_RACERS_PICKUP_COOLDOWN_TICKS);
    }
    expect(required(match(sim).progress.get(b), 'slot').heldWeapon?.charges).toBeNull();
  });

  it('takes a box the machine drove THROUGH between two ticks', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const before = chargesOf(sim, a);
    // Forty yards of travel in one tick, with neither endpoint inside the catch
    // radius: only the swept segment can see this box.
    sweepThroughBox(sim, a, 0);
    forceRefills(sim, 1);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toEqual([0]);
    expect(chargesOf(sim, a)).toBe(before + REALM_RACERS_PICKUP_CHARGE_GRANT);
  });

  it('draws exactly one value per box that changes hands, and none otherwise', () => {
    const { sim, pids } = racingGrid();
    // A racing tick with NOBODY on a box: the phase is still free, which is what
    // lets the boxes sit in the tick at all. (22a asserted this over a tick WITH
    // takes; 22b moved the claim, and the zero arm is what is left of it.)
    const quiet: number[] = [];
    sim.rng.setObserver((value) => quiet.push(value));
    try {
      updateRealmRacers(sim.ctx);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(takenOf(sim)).toEqual([]);
    expect(quiet).toEqual([]);

    pids.forEach((pid, lane) => {
      standOnBox(sim, pid, lane);
    });
    const seen: number[] = [];
    sim.rng.setObserver((value) => seen.push(value));
    try {
      updateRealmRacers(sim.ctx);
    } finally {
      sim.rng.setObserver(null);
    }
    // Four boxes, four takes, FOUR draws: one per take, and the count is a
    // function of what happened on the circuit rather than of how many racers
    // were offered a box. A second draw per take (or one per racer offered)
    // would fork every world downstream of a race.
    expect(takenOf(sim)).toEqual([0, 1, 2, 3]);
    expect(seen).toHaveLength(4);
  });

  it('refuses a second box of the same row until the cooldown expires', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    // Two takes over the whole case, a tick apart at least: both refills, so the
    // charge count is the thing under test rather than the draw.
    forceRefills(sim, 2);
    standOnBox(sim, a, 0);
    updateRealmRacers(sim.ctx);
    const afterFirst = chargesOf(sim, a);
    expect(takenOf(sim)).toEqual([0]);

    // Straight onto its neighbour in the same row, which is what driving
    // through a row at race speed looks like from the boxes' side.
    standOnBox(sim, a, 1);
    for (let i = 1; i < REALM_RACERS_PICKUP_COOLDOWN_TICKS; i++) {
      sim.tick();
      expect(takenOf(sim)).toEqual([0]);
      expect(chargesOf(sim, a)).toBe(afterFirst);
    }
    // And the tick the cooldown runs out, the box it has been sitting on goes.
    sim.tick();
    expect(takenOf(sim)).toEqual([0, 1]);
    expect(chargesOf(sim, a)).toBe(afterFirst + REALM_RACERS_PICKUP_CHARGE_GRANT);
  });

  it('gives four machines crossing together four different boxes', () => {
    const { sim, pids } = racingGrid();
    const before = pids.map((pid) => chargesOf(sim, pid));
    pids.forEach((pid, lane) => {
      standOnBox(sim, pid, lane);
    });
    const rng = forceRefills(sim, 4);
    updateRealmRacers(sim.ctx);
    expect(rng.consumed).toBe(4);
    expect(takenOf(sim)).toEqual([0, 1, 2, 3]);
    pids.forEach((pid, i) => {
      expect(chargesOf(sim, pid)).toBe(before[i] + REALM_RACERS_PICKUP_CHARGE_GRANT);
    });
  });

  it('puts every taken box back when the leader crosses the line, and not before', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    // The OUTER box of the first row: nothing that drives the centerline can
    // reach it, so the sweep round the lap below cannot take it by accident.
    standOnBox(sim, a, 3);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toContain(3);

    const live = match(sim);
    const progress = required(live.progress.get(a), `progress ${a}`);
    const lapAtTake = progress.lap;
    // Round the lap on the centerline, stopping short of the line. The arc is
    // NOT stamped here: the racer really drives it, so the lap bookkeeping
    // accumulates the way it does in a race and the wrap below is a real one.
    for (let s = progress.lastS + 40; s < track.length - 20; s += 40) {
      const point = track.pointAt(s);
      const world = realmRacersToWorld(live, point.x, point.z);
      teleport(sim, a, world.x, world.z);
      updateRealmRacers(sim.ctx);
      expect(progress.lap).toBe(lapAtTake);
      expect(takenOf(sim)).toContain(3);
    }
    // Over the line, which is the leader's lap going up.
    const start = track.pointAt(6);
    const world = realmRacersToWorld(live, start.x, start.z);
    teleport(sim, a, world.x, world.z);
    updateRealmRacers(sim.ctx);
    expect(progress.lap).toBe(lapAtTake + 1);
    expect(takenOf(sim)).toEqual([]);
  });

  it('keys the respawn on the LEADER, not on whoever crosses the line', () => {
    const { sim, pids } = racingGrid();
    const [leader, back] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const live = match(sim);
    const leaderProgress = required(live.progress.get(leader), 'leader progress');
    const backProgress = required(live.progress.get(back), 'backmarker progress');

    // A LAP up and parked: the leader holds the biggest travelled without
    // moving again, so every crossing below is somebody else's.
    placeAt(sim, leader, track.length * 0.3, 2);
    updateRealmRacers(sim.ctx);
    expect(leaderProgress.travelled).toBeGreaterThan(backProgress.travelled);

    standOnBox(sim, back, 3);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toContain(3);

    // The backmarker crosses the line. The leader did not, so nothing comes
    // back: a rule that fired on ANY racer's wrap would empty this here.
    driveToTheLine(sim, back);
    expect(backProgress.lap).toBe(2);
    expect(leaderProgress.lap).toBe(2);
    expect(leaderProgress.travelled).toBeGreaterThan(backProgress.travelled);
    expect(takenOf(sim)).toContain(3);

    // And the leader's own crossing empties it.
    driveToTheLine(sim, leader);
    expect(leaderProgress.lap).toBe(3);
    expect(takenOf(sim)).toEqual([]);
  });

  it('follows the leadership to whoever is still driving when the leader quits', () => {
    const { sim, pids } = racingGrid();
    const [leader, back] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const live = match(sim);
    const leaderProgress = required(live.progress.get(leader), 'leader progress');
    const backProgress = required(live.progress.get(back), 'backmarker progress');

    // TWO laps up, then gone. A retired racer keeps their travelled and their
    // lap for the rest of the race, so a leader read off the whole grid would
    // hold the boxes at a lap number nobody left can reach, and the field would
    // race the remaining laps on an empty circuit.
    placeAt(sim, leader, track.length * 0.3, 3);
    realmRacersForfeit(sim.ctx, leader);
    expect(leaderProgress.retiredTick).not.toBeNull();

    standOnBox(sim, back, 3);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toContain(3);
    expect(leaderProgress.travelled).toBeGreaterThan(backProgress.travelled);

    driveToTheLine(sim, back);
    expect(backProgress.lap).toBe(2);
    expect(takenOf(sim)).toEqual([]);
  });

  it('hands no free charge to a machine the referee just put somewhere', () => {
    const { sim, pids } = racingGrid();
    const [a] = pids;
    const before = chargesOf(sim, a);
    const live = match(sim);
    const progress = required(live.progress.get(a), `progress ${a}`);
    // A recovery anchor standing inside a box's catch radius is not a stunt: an
    // anchor is a point ON the centerline, the two inner boxes of a row sit
    // 2.13 yd off it on the narrowest shipped road, and the reach is 2.3. The
    // Express Tour's own gate 6 is 2.28 yd from a box. The premise here is that
    // shape, forced: the anchor is a row's own lap position. Its own arithmetic
    // is asserted, so a wider road would fail this as a premise rather than
    // quietly making the case vacuous.
    const inner = realmRacersPickupBoxes(RACE_CIRCUIT).find(
      (box) => Math.abs(box.lateral) < REALM_RACERS_PICKUP_REACH,
    );
    const anchored = required(inner, 'a box within reach of the centerline');
    progress.resetS = anchored.s;
    progress.resetLap = progress.lap;
    progress.resetDistanceSinceWrap = progress.distanceSinceWrap;
    realmRacersResetPosition(sim.ctx, a);
    expect(progress.resetLockedUntilTick).toBeGreaterThan(sim.tickCount);

    updateRealmRacers(sim.ctx);
    // Standing on a box it was TELEPORTED onto, and collecting nothing: a box
    // is taken by driving into it.
    expect(chargesOf(sim, a)).toBe(before);
    expect(takenOf(sim)).toEqual([]);

    // The moment the control lock ends it is driving again, and the box under it
    // is a box it is entitled to.
    forceRefills(sim, 1);
    for (let i = 0; i < REALM_RACERS_RESET_LOCK_TICKS + 1; i++) sim.tick();
    expect(sim.tickCount).toBeGreaterThanOrEqual(progress.resetLockedUntilTick);
    expect(chargesOf(sim, a)).toBe(before + REALM_RACERS_PICKUP_CHARGE_GRANT);
    expect(takenOf(sim).length).toBe(1);
  });

  it('collects nothing outside the racing phase', () => {
    const sim = makeWorld();
    const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    const [a] = pids;
    expect(match(sim).phase).toBe('countdown');
    const before = chargesOf(sim, a);
    standOnBox(sim, a, 0);
    sim.tick();
    // Held on the grid: a machine parked over a box before the lights is not
    // collecting a lap's ammunition for free.
    expect(takenOf(sim)).toEqual([]);
    expect(chargesOf(sim, a)).toBe(before);

    match(sim).phase = 'finished';
    standOnBox(sim, a, 0);
    updateRealmRacers(sim.ctx);
    expect(takenOf(sim)).toEqual([]);
    expect(chargesOf(sim, a)).toBe(before);
  });

  it('stops collecting for a racer who has finished or pulled off', () => {
    const { sim, pids } = racingGrid();
    const [a, b] = pids;
    const beforeA = chargesOf(sim, a);
    const beforeB = chargesOf(sim, b);
    required(match(sim).progress.get(a), `progress ${a}`).finishedTick = sim.tickCount;
    realmRacersForfeit(sim.ctx, b);
    standOnBox(sim, a, 0);
    standOnBox(sim, b, 1);
    updateRealmRacers(sim.ctx);
    // Both keep their machine and may drive it anywhere; neither is collecting
    // ammunition for a race they are no longer in.
    expect(takenOf(sim)).toEqual([]);
    expect(chargesOf(sim, a)).toBe(beforeA);
    expect(chargesOf(sim, b)).toBe(beforeB);
  });

  it('reports the taken boxes on the readout both worlds mirror', () => {
    const { sim, pids } = racingGrid();
    const [a, b] = pids;
    expect(sim.realmRacersInfoFor(a).match?.pickupsTaken).toEqual([]);
    standOnBox(sim, a, 2);
    // A full tick, not the surgical phase call: the shared readout is built
    // once per tick, so the take is read on the tick that ran it.
    sim.tick();
    // The whole grid sees the same set: the boxes belong to the race, not to the
    // pilot who took one.
    expect(sim.realmRacersInfoFor(a).match?.pickupsTaken).toEqual([2]);
    expect(sim.realmRacersInfoFor(b).match?.pickupsTaken).toEqual([2]);
  });

  it('keeps every practice lane on its own set of boxes', () => {
    const sim = makeWorld();
    const one = addAt(sim, 'warrior', 'Aster', -5, -40);
    const two = addAt(sim, 'mage', 'Briar', 7, -42);
    expect(startRealmRacersPractice(sim, 'driver', one)).toBe(true);
    expect(startRealmRacersPractice(sim, 'driver', two)).toBe(true);
    const [first, second] = sim.realmRacers.practices;
    expect(first.origin.z).not.toBe(second.origin.z);
    expect(first.pickups).not.toBe(second.pickups);

    const boxes = realmRacersPickupBoxes(REALM_RACERS_PRACTICE_CIRCUIT);
    const box = boxes[0];
    // The SAME box, on the first lane's copy of the circuit. It is a different
    // world point from the second lane's, which is the whole of what a lane is.
    const world = realmRacersToWorld(first, box.x, box.z);
    teleport(sim, one, world.x, world.z);
    const progress = required(first.progress.get(one), `progress ${one}`);
    const projection = realmRacersTrack(REALM_RACERS_PRACTICE_CIRCUIT).project(box.x, box.z);
    progress.lastS = projection.s;
    progress.trackIndex = projection.index;
    first.phase = 'racing';
    second.phase = 'racing';
    updateRealmRacers(sim.ctx);
    expect(realmRacersPickupTakenIndices(first.pickups)).toContain(0);
    expect(realmRacersPickupTakenIndices(second.pickups)).not.toContain(0);
  });
});

describe('the pickup step, on its own', () => {
  const circuit = REALM_RACERS_PRACTICE_CIRCUIT;
  const boxes = realmRacersPickupBoxes(circuit);

  const racer = (pid: number, index: number, overrides = {}) => ({
    pid,
    fromX: boxes[index].x,
    fromZ: boxes[index].z,
    toX: boxes[index].x,
    toZ: boxes[index].z,
    cooldownUntilTick: 0,
    eligible: true,
    ...overrides,
  });

  it('takes a box a machine drove THROUGH between two ticks', () => {
    const state = createRealmRacersPickupState(circuit);
    const box = boxes[0];
    // A segment that steps clean over the box: forty yards of travel in one
    // tick, with neither end inside the catch radius.
    const step = stepRealmRacersPickups(boxes, state, {
      tick: 0,
      leaderLap: 1,
      racers: [
        {
          pid: 1,
          fromX: box.x - 20,
          fromZ: box.z,
          toX: box.x + 20,
          toZ: box.z,
          cooldownUntilTick: 0,
          eligible: true,
        },
      ],
    });
    expect(step.takes).toEqual([{ pid: 1, box: 0 }]);
  });

  it('hands over the NEAREST box when a pass reaches two at once', () => {
    // The two catch zones overlap on a narrow road (a row's boxes are a shade
    // over four yards apart at the minimum half-width, and a box is taken from
    // 2.3 yards away), so a pass down the middle really can be inside both.
    const state = createRealmRacersPickupState(circuit);
    const [left, right] = boxes;
    const axisX = right.x - left.x;
    const axisZ = right.z - left.z;
    const span = Math.hypot(axisX, axisZ);
    const ux = axisX / span;
    const uz = axisZ / span;
    // A segment lying between them: 2.2 yards clear of the left box and 2.0 of
    // the right one, so both are in reach and the right one is nearer.
    const step = stepRealmRacersPickups(boxes, state, {
      tick: 0,
      leaderLap: 1,
      racers: [
        {
          pid: 1,
          fromX: left.x + ux * 2.2,
          fromZ: left.z + uz * 2.2,
          toX: right.x - ux * 2,
          toZ: right.z - uz * 2,
          cooldownUntilTick: 0,
          eligible: true,
        },
      ],
    });
    expect(step.takes).toEqual([{ pid: 1, box: right.index }]);
  });

  it('offers nothing to a racer who is no longer in the race', () => {
    const state = createRealmRacersPickupState(circuit);
    const step = stepRealmRacersPickups(boxes, state, {
      tick: 0,
      leaderLap: 1,
      racers: [racer(1, 0, { eligible: false })],
    });
    expect(step.takes).toEqual([]);
    expect(state.taken.some(Boolean)).toBe(false);
  });

  it('hands one box to one machine when two arrive on the same tick', () => {
    const state = createRealmRacersPickupState(circuit);
    const step = stepRealmRacersPickups(boxes, state, {
      tick: 0,
      leaderLap: 1,
      racers: [racer(1, 0), racer(2, 0)],
    });
    // The second machine finds the box gone and takes nothing: there is no box
    // of its own within reach, and the first one is decided by the caller's
    // stable grid order rather than by whichever was iterated first.
    expect(step.takes).toEqual([{ pid: 1, box: 0 }]);
  });

  it('respawns only when the leader lap goes UP', () => {
    const state = createRealmRacersPickupState(circuit);
    stepRealmRacersPickups(boxes, state, { tick: 0, leaderLap: 1, racers: [racer(1, 0)] });
    expect(realmRacersPickupTakenIndices(state)).toEqual([0]);
    // A new leader on the same lap is not a crossing.
    expect(
      stepRealmRacersPickups(boxes, state, { tick: 1, leaderLap: 1, racers: [] }).respawned,
    ).toBe(false);
    expect(realmRacersPickupTakenIndices(state)).toEqual([0]);
    const crossed = stepRealmRacersPickups(boxes, state, { tick: 2, leaderLap: 2, racers: [] });
    expect(crossed.respawned).toBe(true);
    expect(realmRacersPickupTakenIndices(state)).toEqual([]);
    // And a lap that does not advance again does nothing, so a full set of
    // boxes never reports a respawn it did not perform.
    expect(
      stepRealmRacersPickups(boxes, state, { tick: 3, leaderLap: 2, racers: [] }).respawned,
    ).toBe(false);
  });
});

describe('the pickup box visual core', () => {
  it('pops a taken box out and grows a respawned one back', () => {
    let visual = rallyPickupInitialVisual(false);
    expect(rallyPickupScale(visual)).toBe(1);

    visual = stepRallyPickupVisual(visual, true, 0);
    expect(visual.phase).toBe('popping');
    // It SWELLS before it goes, which is what makes a take read as an event.
    expect(rallyPickupScale(stepRallyPickupVisual(visual, true, 0.08))).toBeGreaterThan(1);
    for (let i = 0; i < 10; i++) visual = stepRallyPickupVisual(visual, true, 0.05);
    expect(visual.phase).toBe('gone');
    expect(rallyPickupVisible(visual)).toBe(false);
    expect(rallyPickupScale(visual)).toBe(0);

    visual = stepRallyPickupVisual(visual, false, 0.05);
    expect(visual.phase).toBe('spawning');
    expect(rallyPickupVisible(visual)).toBe(true);
    for (let i = 0; i < 20; i++) visual = stepRallyPickupVisual(visual, false, 0.05);
    expect(visual.phase).toBe('present');
    expect(rallyPickupScale(visual)).toBe(1);
  });

  it('turns a respawn mid pop straight into the spawn', () => {
    let visual = stepRallyPickupVisual(rallyPickupInitialVisual(false), true, 0);
    visual = stepRallyPickupVisual(visual, true, RALLY_PICKUP_POP_SECONDS / 2);
    expect(visual.phase).toBe('popping');
    visual = stepRallyPickupVisual(visual, false, 0.01);
    expect(visual.phase).toBe('spawning');
    expect(visual.t).toBe(0);
  });

  it('starts a box that is already taken with no animation to play', () => {
    const visual = rallyPickupInitialVisual(true);
    expect(visual).toEqual({ phase: 'gone', t: 0 });
    // A box that has been gone the whole time must not spawn itself in on the
    // first frame a viewer sees it.
    expect(stepRallyPickupVisual(visual, true, RALLY_PICKUP_SPAWN_SECONDS)).toEqual(visual);
  });

  it('hands back the SAME state object in either resting phase', () => {
    // Identity, not equality: the painter decides whether anything has to be
    // written by comparing what came back with what it held, and a fresh object
    // per frame per box would make that comparison useless (and allocate through
    // a whole race for a dozen boxes that are not doing anything).
    const present = rallyPickupInitialVisual(false);
    expect(stepRallyPickupVisual(present, false, 0.016)).toBe(present);
    const gone = rallyPickupInitialVisual(true);
    expect(stepRallyPickupVisual(gone, true, 0.016)).toBe(gone);
  });

  it('desynchronizes the boxes of a row from each other', () => {
    // A row that spun and bobbed as one object reads as one object. The offset
    // is per box index, so two neighbours are never at the same phase.
    const time = 3.2;
    expect(rallyPickupSpin(time, 0)).not.toBeCloseTo(rallyPickupSpin(time, 1), 3);
    expect(rallyPickupLift(time, 0)).not.toBeCloseTo(rallyPickupLift(time, 1), 3);
    // And the offset is a constant per index rather than noise: the same box at
    // the same moment is always in the same place.
    expect(rallyPickupSpin(time, 2)).toBe(rallyPickupSpin(time, 2));
    expect(rallyPickupSpin(time + 1, 0) - rallyPickupSpin(time, 0)).toBeCloseTo(
      rallyPickupSpin(time + 1, 1) - rallyPickupSpin(time, 1),
      9,
    );
  });

  it('reads two taken lists as the same only when they are', () => {
    expect(rallyPickupTakenSame([], [])).toBe(true);
    expect(rallyPickupTakenSame([1, 4], [1, 4])).toBe(true);
    expect(rallyPickupTakenSame([1, 4], [1, 5])).toBe(false);
    expect(rallyPickupTakenSame([1], [1, 5])).toBe(false);
    expect(rallyPickupTakenSame([4, 1], [1, 4])).toBe(false);
  });
});
