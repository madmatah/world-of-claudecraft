import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
} from '../src/sim/content/mortar_overdrive/circuits';
import { MORTAR_OVERDRIVE_MAX_GATE_STEP } from '../src/sim/mortar_overdrive/layout';
import {
  forwardArcDelta,
  MORTAR_OVERDRIVE_MIN_LAP_FRACTION,
  MORTAR_OVERDRIVE_WRAP_OVERSHOOT_YD,
  stepMortarOverdriveProgress,
  travelledFromArc,
} from '../src/sim/mortar_overdrive/progress';
import { mortarOverdriveGates, mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';

const L = 100;

describe('Mortar Overdrive arc progress', () => {
  it('credits a forward wrap only after enough lap distance', () => {
    const short = stepMortarOverdriveProgress({
      lap: 1,
      lastS: 98,
      s: 2,
      distanceSinceWrap: 10,
      lapLength: L,
      totalLaps: 3,
    });
    expect(short).toMatchObject({
      lap: 1,
      wrapped: false,
      finished: false,
      distanceSinceWrap: 14,
    });

    const full = stepMortarOverdriveProgress({
      lap: 1,
      lastS: 98,
      s: 2,
      distanceSinceWrap: L * MORTAR_OVERDRIVE_MIN_LAP_FRACTION,
      lapLength: L,
      totalLaps: 3,
    });
    expect(full).toMatchObject({
      lap: 2,
      wrapped: true,
      finished: false,
      distanceSinceWrap: 0,
      finishFraction: 0.5,
    });
  });

  it('does not farm laps by oscillating over the start line', () => {
    let step = stepMortarOverdriveProgress({
      lap: 1,
      lastS: 99,
      s: 1,
      distanceSinceWrap: 0,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(false);
    expect(step.lap).toBe(1);

    step = stepMortarOverdriveProgress({
      lap: step.lap,
      lastS: step.lastS,
      s: 99,
      distanceSinceWrap: step.distanceSinceWrap,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(false);
    expect(step.lap).toBe(1);

    step = stepMortarOverdriveProgress({
      lap: step.lap,
      lastS: step.lastS,
      s: 1,
      distanceSinceWrap: step.distanceSinceWrap,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(false);
    expect(step.distanceSinceWrap).toBe(4);
  });

  it('ignores backward distance when accumulating toward a wrap', () => {
    expect(forwardArcDelta(20, 15, L)).toBe(-5);
    const step = stepMortarOverdriveProgress({
      lap: 1,
      lastS: 20,
      s: 15,
      distanceSinceWrap: 30,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.distanceSinceWrap).toBe(30);
    expect(step.travelled).toBe(15);
  });

  it('finishes on the third credited wrap and keeps the earlier wrap fraction', () => {
    const step = stepMortarOverdriveProgress({
      lap: 3,
      lastS: 95,
      s: 5,
      distanceSinceWrap: 90,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step).toMatchObject({
      lap: 3,
      wrapped: true,
      finished: true,
      finishFraction: 0.5,
    });
  });

  it('ranks racers by travelled arc without checkpoint state', () => {
    // The grid zone: barely any ground covered, second-half arc = behind the line.
    expect(travelledFromArc(1, 95, L, 0)).toBe(-5);
    expect(travelledFromArc(1, 5, L, 5)).toBe(5);
    expect(travelledFromArc(2, 5, L, 5)).toBe(105);
  });

  it('does not read a racer who DROVE into the second half of lap one as behind the line', () => {
    // The lap counter deliberately stays at one through the whole first loop
    // (the grid crossing is lap-neutral), so the arc alone cannot tell the
    // grid zone from an honest second-half racer. The odometer can: a machine
    // that covered most of a lap of ground did not reverse there.
    expect(travelledFromArc(1, 70, L, 77)).toBe(70);
    // And the honest racer outranks a first-half rival, not the other way round.
    expect(travelledFromArc(1, 70, L, 77)).toBeGreaterThan(travelledFromArc(1, 30, L, 37));
  });

  it('reads a racer behind the line on a later lap as behind it, not a lap ahead', () => {
    // Lap two starts AT the line (the wrap zeroes the odometer), so a machine
    // a yard short of it on lap two has covered one lap, never two.
    expect(travelledFromArc(2, 99, L, 0)).toBe(99);
    expect(travelledFromArc(3, 99, L, 1)).toBe(199);
    // Honest second-half driving on a later lap still reads as itself, even a
    // yard past halfway: that lap's odometer started at the wrap tick, a few
    // yards past the line, so it trails the arc by that overshoot.
    expect(travelledFromArc(2, 70, L, 70)).toBe(170);
    expect(travelledFromArc(2, 51, L, 48)).toBe(151);
  });

  it('keeps a racer who drove on and then backed far over the line behind it', () => {
    // Forty yards on from the line, then eighty back: the arc reads sixty with
    // forty of forward odometer, which no forward driving can produce. Behind
    // the line on lap one (still lap one's grid side) and on a later lap.
    expect(travelledFromArc(1, 60, L, 40)).toBe(-40);
    expect(travelledFromArc(2, 60, L, 40)).toBe(60);
    // The odometer counts forward ground only, so a reverse never lowers it.
    let step = stepMortarOverdriveProgress({
      lap: 2,
      lastS: 1,
      s: 40,
      distanceSinceWrap: 1,
      lapLength: L,
      totalLaps: 3,
    });
    for (const s of [20, 1, L - 20, 60]) {
      step = stepMortarOverdriveProgress({
        lap: step.lap,
        lastS: step.lastS,
        s,
        distanceSinceWrap: step.distanceSinceWrap,
        lapLength: L,
        totalLaps: 3,
      });
    }
    expect(step.lap).toBe(2);
    expect(step.travelled).toBe(60);
  });

  it('allows the wrap overshoot a whole tick of travel can leave', () => {
    expect(MORTAR_OVERDRIVE_WRAP_OVERSHOOT_YD).toBeGreaterThanOrEqual(
      MORTAR_OVERDRIVE_MAX_GATE_STEP,
    );
  });

  it('keeps travelled monotone over several laps, through every wrap and halfway', () => {
    // Seven-yard ticks never land on the line, so every wrap overshoots it and
    // every later lap's odometer trails its arc: no tick may fall back a lap.
    let lap = 1;
    let lastS = L - 7;
    let distanceSinceWrap = 0;
    let previous = Number.NEGATIVE_INFINITY;
    for (let driven = 7; driven <= 2.6 * L; driven += 7) {
      const step = stepMortarOverdriveProgress({
        lap,
        lastS,
        s: (L - 7 + driven) % L,
        distanceSinceWrap,
        lapLength: L,
        totalLaps: 4,
      });
      expect(step.travelled, `after ${driven} yd`).toBeGreaterThan(previous);
      previous = step.travelled;
      lap = step.lap;
      lastS = step.lastS;
      distanceSinceWrap = step.distanceSinceWrap;
    }
    expect(lap).toBe(3);
  });

  it.each(MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s: a lap-two recovery onto gate 0, or a reverse over the line, never ranks a lap ahead',
    (_id, circuit) => {
      const track = mortarOverdriveTrack(circuit);
      const lapLength = track.length;
      // The recovery: the gate-0 crossing that wrapped hands back lap two with
      // a zeroed odometer, at the gate's own arc (a hair short of the line on
      // most circuits).
      const anchor = track.pointAt(mortarOverdriveGates(circuit)[0].s);
      const recovered = travelledFromArc(2, anchor.s, lapLength, 0);
      expect(recovered).toBeLessThanOrEqual(lapLength + 1e-6);
      expect(recovered).toBeGreaterThan(lapLength - 10);
      // The reverse: just over the line on lap two, then backing up over it.
      let step = stepMortarOverdriveProgress({
        lap: 2,
        lastS: 0,
        s: 4,
        distanceSinceWrap: 0,
        lapLength,
        totalLaps: 3,
      });
      const ahead = step.travelled;
      for (const s of [1, lapLength - 2, lapLength - 5]) {
        step = stepMortarOverdriveProgress({
          lap: step.lap,
          lastS: step.lastS,
          s,
          distanceSinceWrap: step.distanceSinceWrap,
          lapLength,
          totalLaps: 3,
        });
        expect(step.lap).toBe(2);
        expect(step.travelled, `at s ${s}`).toBeLessThanOrEqual(ahead);
      }
      expect(step.travelled).toBeCloseTo(lapLength - 5, 6);
    },
  );

  it('keeps travelled monotone for a racer driving honestly from the grid', () => {
    // Step-driven through the whole first lap from 7 yd behind the line, the
    // ranking key must never fall: a drop of a full lap length between two
    // ticks is what inverted the live standings at halfway.
    let lap = 1;
    let lastS = L - 7;
    let distanceSinceWrap = 0;
    let previous = Number.NEGATIVE_INFINITY;
    for (let driven = 5; driven <= L + 20; driven += 5) {
      const s = (L - 7 + driven) % L;
      const step = stepMortarOverdriveProgress({
        lap,
        lastS,
        s,
        distanceSinceWrap,
        lapLength: L,
        totalLaps: 3,
      });
      expect(step.travelled, `after ${driven} yd`).toBeGreaterThan(previous);
      previous = step.travelled;
      lap = step.lap;
      lastS = step.lastS;
      distanceSinceWrap = step.distanceSinceWrap;
    }
  });

  it('advances a shell-thrown racer projected outside the old gate band', () => {
    const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
    const before = track.pointAt(track.length - 8);
    const after = track.pointAt(6);
    const lateral = before.halfWidth + 6;
    const beforeProjection = track.project(
      before.x - before.tz * lateral,
      before.z + before.tx * lateral,
    );
    const afterProjection = track.project(
      after.x - after.tz * lateral,
      after.z + after.tx * lateral,
      beforeProjection.index,
    );
    const step = stepMortarOverdriveProgress({
      lap: 1,
      lastS: beforeProjection.s,
      s: afterProjection.s,
      distanceSinceWrap: track.length * MORTAR_OVERDRIVE_MIN_LAP_FRACTION,
      lapLength: track.length,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(true);
    expect(step.lap).toBe(2);
  });
});
