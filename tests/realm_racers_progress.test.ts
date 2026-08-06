import { describe, expect, it } from 'vitest';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import {
  forwardArcDelta,
  REALM_RACERS_MIN_LAP_FRACTION,
  stepRealmRacersProgress,
  travelledFromArc,
} from '../src/sim/realm_racers_progress';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

const L = 100;

describe('Realm Racers arc progress', () => {
  it('credits a forward wrap only after enough lap distance', () => {
    const short = stepRealmRacersProgress({
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

    const full = stepRealmRacersProgress({
      lap: 1,
      lastS: 98,
      s: 2,
      distanceSinceWrap: L * REALM_RACERS_MIN_LAP_FRACTION,
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
    let step = stepRealmRacersProgress({
      lap: 1,
      lastS: 99,
      s: 1,
      distanceSinceWrap: 0,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(false);
    expect(step.lap).toBe(1);

    step = stepRealmRacersProgress({
      lap: step.lap,
      lastS: step.lastS,
      s: 99,
      distanceSinceWrap: step.distanceSinceWrap,
      lapLength: L,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(false);
    expect(step.lap).toBe(1);

    step = stepRealmRacersProgress({
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
    const step = stepRealmRacersProgress({
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
    const step = stepRealmRacersProgress({
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
      const step = stepRealmRacersProgress({
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
    const track = realmRacersTrack(GARDEN_CIRCUIT);
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
    const step = stepRealmRacersProgress({
      lap: 1,
      lastS: beforeProjection.s,
      s: afterProjection.s,
      distanceSinceWrap: track.length * REALM_RACERS_MIN_LAP_FRACTION,
      lapLength: track.length,
      totalLaps: 3,
    });
    expect(step.wrapped).toBe(true);
    expect(step.lap).toBe(2);
  });
});
