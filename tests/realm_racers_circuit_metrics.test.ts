// The circuit readout: the checks that decide whether an authored circuit is
// geometry the sim can actually drive.
//
// The fixtures are deliberately of two kinds. The RINGS isolate one check each,
// because a circle's radius and width are known before the spline runs on it.
// The PINCHED draft is the real abandoned Competition A shape from the first
// authoring attempt, and every number pinned against it here was measured off
// that draft while it was being rejected: it is evidence that the readout finds
// the defects a hand-drawn sketch could not show, not a snapshot of whatever
// this code happens to compute.

import { describe, expect, it } from 'vitest';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_MIN_STRETCH_SEPARATION,
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_BAND_X_MAX,
  REALM_RACERS_BAND_X_MIN,
  REALM_RACERS_LANE_CLEARANCE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
} from '../src/sim/realm_racers_layout';
import { REALM_RACERS_PROJECTION_ENVELOPE } from '../src/sim/realm_racers_spline';

/** Everything a record needs that is not the shape under test. Roomy enough
 *  that no fixture trips the containment checks by accident. */
const DRAFT_BASE = {
  regionHalfX: 260,
  // At the lane depth budget, not past it: the fixture must not carry a defect
  // of its own into every case built on it.
  regionHalfZ: 150,
  perimeter: { halfX: 240, halfZ: 140, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6, wadeYards: 4 },
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 4,
  timeLimitSeconds: 420,
  musicTrack: 'realm_racers',
  roles: ['competition'],
  practiceCopies: 0,
} satisfies Omit<RealmRacersCircuit, 'id' | 'controlPoints' | 'widthBands'>;

function draft(
  id: string,
  controlPoints: readonly { x: number; z: number }[],
  halfWidth: number,
  extra: Partial<RealmRacersCircuit> = {},
): RealmRacersCircuit {
  return {
    ...DRAFT_BASE,
    id,
    controlPoints,
    widthBands: [
      { s: 0, halfWidth },
      { s: 1, halfWidth },
    ],
    ...extra,
  };
}

/** A counter-clockwise circle: the one shape whose corner radius is known
 *  before the spline measures it. */
function ring(radius: number, points = 12): { x: number; z: number }[] {
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  });
}

/**
 * The abandoned Competition A draft: a 1094 yard lap whose two long stretches
 * run 47 yards apart, head on, for 160 yards of lap.
 */
const PINCHED_CONTROL_POINTS = [
  { x: -150, z: -95 },
  { x: -70, z: -97 },
  { x: 10, z: -98 },
  { x: 88, z: -94 },
  { x: 140, z: -84 },
  { x: 176, z: -54 },
  { x: 184, z: -10 },
  { x: 172, z: 30 },
  { x: 138, z: 60 },
  { x: 96, z: 66 },
  { x: 66, z: 44 },
  { x: 52, z: 6 },
  { x: 56, z: -30 },
  { x: 34, z: -48 },
  { x: 0, z: -51 },
  { x: -34, z: -48 },
  { x: -54, z: -26 },
  { x: -44, z: 4 },
  { x: -62, z: 32 },
  { x: -96, z: 42 },
  { x: -128, z: 62 },
  { x: -166, z: 44 },
  { x: -182, z: 4 },
  { x: -176, z: -42 },
  { x: -164, z: -80 },
];

const codesOf = (circuit: RealmRacersCircuit): string[] =>
  realmRacersCircuitMetrics(circuit).problems.map((problem) => problem.code);

describe('Realm Racers circuit metrics: the loop is a loop', () => {
  it('measures a full turn on the garden circuit, counter-clockwise', () => {
    const metrics = realmRacersCircuitMetrics(GARDEN);
    expect(metrics.turningDegrees).toBeCloseTo(360, 6);
    expect(metrics.winding).toBe(1);
    // Nothing on the shipped practice circuit is unshippable, and it carries
    // exactly ONE warning: the tiered fountain out in its lake stands about 30
    // yards clear of the centerline, inside the roughly 35 the chase camera can
    // swing to at full zoom. That is the dressing check earning its keep on the
    // first content it ever looked at rather than a fault, and it is a warning
    // precisely so the call stays the operator's: the piece has stood exactly
    // there since the circuit shipped.
    expect(realmRacersCircuitErrors(metrics)).toEqual([]);
    expect(codesOf(GARDEN)).toEqual(['prop_in_camera_reach']);
  });

  it('reports a self-crossing loop, which measures no turn at all', () => {
    // A figure of eight turns one way then the other, and the two halves cancel:
    // nothing about a hand-drawn sketch says so, which is why this check exists.
    const eight = draft(
      'metrics_figure_eight',
      [
        { x: -100, z: -50 },
        { x: -60, z: -80 },
        { x: -20, z: -50 },
        { x: 20, z: 50 },
        { x: 60, z: 80 },
        { x: 100, z: 50 },
        { x: 60, z: -20 },
        { x: 20, z: -80 },
        { x: -20, z: 80 },
        { x: -60, z: 20 },
      ],
      10,
    );
    const metrics = realmRacersCircuitMetrics(eight);
    expect(Math.abs(metrics.turningDegrees)).toBeLessThan(1);
    expect(metrics.problems.map((p) => p.code)).toContain('self_crossing');
  });

  it('flips the winding when the control points are listed backwards', () => {
    const forward = draft('metrics_wind_forward', ring(60, 16), 10);
    const reversed = draft('metrics_wind_reversed', [...ring(60, 16)].reverse(), 10);
    expect(realmRacersCircuitMetrics(forward).winding).toBe(1);
    expect(realmRacersCircuitMetrics(forward).turningDegrees).toBeCloseTo(360, 6);
    expect(realmRacersCircuitMetrics(reversed).winding).toBe(-1);
    expect(realmRacersCircuitMetrics(reversed).turningDegrees).toBeCloseTo(-360, 6);
    // A clockwise loop is not merely mirrored: the apron, the basin shore and
    // the racing line all read the sign of `turnRadius`, so it is rejected.
    expect(codesOf(reversed)).toContain('reversed_winding');
    expect(codesOf(forward)).not.toContain('reversed_winding');
  });
});

describe('Realm Racers circuit metrics: a corner against its own road', () => {
  it('rejects a corner tighter than the road it carries, and clears when the road narrows', () => {
    // A ring of radius 9 measures about 8.8 through the spline's curvature
    // window, so a 10 yard half-width folds the ribbon's inner edge through the
    // centre of curvature and an 8 yard one does not.
    const wide = draft('metrics_ring_wide_road', ring(9), 10);
    const narrow = draft('metrics_ring_narrow_road', ring(9), 8);
    expect(realmRacersCircuitMetrics(wide).minRadiusOverWidth).toBeLessThan(1);
    expect(codesOf(wide)).toContain('corner_folds_road');
    expect(realmRacersCircuitMetrics(narrow).minRadiusOverWidth).toBeGreaterThan(1);
    expect(codesOf(narrow)).not.toContain('corner_folds_road');
    // Still tight enough to say so, which is the warning tier doing its job.
    expect(codesOf(narrow)).toContain('corner_near_road_width');
  });

  it('reports EVERY failing corner at once, not just the worst one', () => {
    // The defect this replaces: the readout named the single tightest corner on
    // the lap, so fixing it surfaced the next one somewhere else, with nothing
    // on screen ever saying there were four.
    const lobes = 4;
    const flower = Array.from({ length: 48 }, (_, i) => {
      const angle = (i / 48) * Math.PI * 2;
      const radius = 90 + 34 * Math.cos(lobes * angle);
      return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
    });
    const metrics = realmRacersCircuitMetrics(draft('metrics_four_corners', flower, 10));
    const folded = metrics.problems.filter((p) => p.code === 'corner_folds_road');
    expect(folded).toHaveLength(lobes);
    // Four DISTINCT places, spread around the lap rather than four readings of
    // the same corner.
    const places = folded.map((p) => p.s).sort((a, b) => a - b);
    for (let i = 1; i < places.length; i++) {
      expect(places[i] - places[i - 1]).toBeGreaterThan(metrics.lapLength / 10);
    }
  });

  it('does not also warn about a corner it has already called an error', () => {
    // A corner under the floor is wrapped in a band that is merely tight, so
    // without the overlap check every bad corner would be named twice.
    const tight = draft('metrics_no_double_report', ring(9), 10);
    const codes = codesOf(tight);
    expect(codes).toContain('corner_folds_road');
    expect(codes).not.toContain('corner_near_road_width');
  });

  it('walks a run crossing the start line as one corner, not two', () => {
    // The start line is an index boundary, not a feature: a corner sitting on it
    // must not be reported once on each side of s = 0.
    const oval = Array.from({ length: 24 }, (_, i) => {
      // A long thin ellipse whose MAJOR axis runs along x, so its two tight
      // ends sit at angle 0 and angle pi. The first control point is angle 0,
      // which is where the lap starts: one of the two tight runs straddles it.
      const angle = (i / 24) * Math.PI * 2;
      return { x: 90 * Math.cos(angle), z: 25 * Math.sin(angle) };
    });
    const folded = realmRacersCircuitMetrics(draft('metrics_wrap_run', oval, 10)).problems.filter(
      (p) => p.code === 'corner_folds_road',
    );
    // The two ends of an ellipse are its two tight spots: exactly two, and the
    // one on the start line is not split in half.
    expect(folded).toHaveLength(2);
  });

  it('leaves a corner with real room clear of both tiers', () => {
    const roomy = draft('metrics_ring_roomy', ring(60, 16), 10);
    const metrics = realmRacersCircuitMetrics(roomy);
    expect(metrics.minRadiusOverWidth).toBeGreaterThan(1.5);
    expect(metrics.problems).toEqual([]);
  });
});

describe('Realm Racers circuit metrics: two stretches running alongside', () => {
  it('ignores neighbours on the same stretch and finds the real far-apart approach', () => {
    // On a circle the genuinely nearest sample to any point is its immediate
    // neighbour, one step away. Reporting that would make the whole measurement
    // useless, so the guard has to skip everything within 80 samples of the lap.
    const roomy = draft('metrics_far_apart_guard', ring(60, 16), 10);
    const metrics = realmRacersCircuitMetrics(roomy);
    expect(metrics.nearestApproach.distance).toBeGreaterThan(60);
    expect(metrics.nearestApproach.distance).toBeLessThan(metrics.lapLength / 4);
  });

  it('finds the pinch in the abandoned draft at the distance it was measured at', () => {
    const pinched = draft('metrics_pinched', PINCHED_CONTROL_POINTS, 10);
    const metrics = realmRacersCircuitMetrics(pinched);
    expect(metrics.lapLength).toBeCloseTo(1094.25, 1);
    expect(metrics.turningDegrees).toBeCloseTo(360, 6);
    // 46.8 yards apart, head on: measured off this shape in the session that
    // rejected it.
    expect(metrics.nearestApproach.distance).toBeCloseTo(46.84, 1);
    expect(metrics.nearestApproach.tangentDot).toBeCloseTo(-1, 3);
    expect(codesOf(pinched)).toContain('stretches_too_close');
  });

  it('bounds the separation on the spline projection rather than a remembered number', () => {
    // The rule is "a racer between the two stretches must not sit inside both
    // projection envelopes at once". If the envelope moves, this moves with it.
    expect(REALM_RACERS_MIN_STRETCH_SEPARATION).toBe(2 * REALM_RACERS_PROJECTION_ENVELOPE);
  });
});

describe('Realm Racers circuit metrics: the shooting corridor', () => {
  it('is zero where no two stretches oppose each other', () => {
    // Every pair on a circle at least 80 samples apart is angled, never head on,
    // so a fixed forward cone can never point down another stretch.
    const roomy = draft('metrics_corridor_none', ring(60, 16), 10);
    expect(realmRacersCircuitMetrics(roomy).shootingCorridorYards).toBe(0);
  });

  it('measures the opposed stretches of the pinched draft', () => {
    const pinched = draft('metrics_corridor_pinched', PINCHED_CONTROL_POINTS, 10);
    const metrics = realmRacersCircuitMetrics(pinched);
    expect(metrics.shootingCorridorYards).toBeGreaterThan(150);
    expect(metrics.shootingCorridorYards).toBeLessThan(metrics.lapLength / 2);
    // It is a FEATURE, not a fault: nothing about it is reported as a problem.
    expect(codesOf(pinched)).not.toContain('shooting_corridor');
  });
});

describe('Realm Racers circuit metrics: the basin shores', () => {
  it('is clear on the garden circuit and overlapping on the pinched draft', () => {
    expect(realmRacersCircuitMetrics(GARDEN).shoreOverlapYards).toBe(0);
    const pinched = draft('metrics_shore_pinched', PINCHED_CONTROL_POINTS, 10);
    const metrics = realmRacersCircuitMetrics(pinched);
    // Two shores 25 yards off each centerline, 47 yards apart: they meet over
    // 160 yards of lap, and the water polygon self-crosses there.
    expect(metrics.shoreOverlapYards).toBeCloseTo(160, 0);
    expect(codesOf(pinched)).toContain('shore_overlap');
  });

  it('clears the overlap when the apron is narrowed over the pinch', () => {
    const pinched = draft('metrics_shore_narrowed', PINCHED_CONTROL_POINTS, 10, {
      apronBands: [
        { s: 0, maxApron: 15 },
        { s: 0.09, maxApron: 15 },
        { s: 0.12, maxApron: 10 },
        { s: 0.2, maxApron: 10 },
        { s: 0.23, maxApron: 15 },
        { s: 0.55, maxApron: 15 },
        { s: 0.58, maxApron: 10 },
        { s: 0.665, maxApron: 10 },
        { s: 0.695, maxApron: 15 },
        { s: 1, maxApron: 15 },
      ],
    });
    const metrics = realmRacersCircuitMetrics(pinched);
    expect(metrics.shoreOverlapYards).toBe(0);
    expect(codesOf(pinched)).not.toContain('shore_overlap');
    // Narrowing the apron closes the water, not the racing: the two stretches
    // still face each other and are still shootable across.
    expect(metrics.shootingCorridorYards).toBeGreaterThan(150);
  });
});

describe('Realm Racers circuit metrics: which spans of the shore carry water', () => {
  it('scopes the shore overlap to WATER, and reports two dry lines as a corridor', () => {
    // The distinction this readout turns on. Two ponds meeting is one lake drawn
    // twice, which is a defect; two DRY stretches facing each other across the
    // same gap is the corridor a circuit is authored FOR, so it is reported and
    // never faulted.
    const water = draft('metrics_water_water_pinch', PINCHED_CONTROL_POINTS, 10);
    expect(realmRacersCircuitMetrics(water).shoreOverlapYards).toBeCloseTo(160, 0);
    expect(realmRacersCircuitMetrics(water).sharedDryYards).toBe(0);

    // The same shape with both pinched stretches painted dry. The fractions come
    // off the water case: its overlap runs over the two long stretches that face
    // each other.
    const drained = draft('metrics_water_dry_pinch', PINCHED_CONTROL_POINTS, 10, {
      waterBands: [
        { s: 0, kind: 'water' },
        { s: 0.08, kind: 'dry' },
        { s: 0.26, kind: 'water' },
        { s: 0.55, kind: 'dry' },
        { s: 0.72, kind: 'water' },
      ],
    });
    const metrics = realmRacersCircuitMetrics(drained);
    expect(metrics.shoreOverlapYards).toBe(0);
    expect(codesOf(drained)).not.toContain('shore_overlap');
    // ...and the corridor is measured instead: real yardage, and less than the
    // whole flipped span, so it is the FACING part rather than a span count.
    expect(metrics.sharedDryYards).toBeGreaterThan(100);
    expect(metrics.sharedDryYards).toBeLessThan(metrics.lapLength / 2);
    // The circuit still faces itself: draining the pinch closed the water, not
    // the racing.
    expect(metrics.shootingCorridorYards).toBeGreaterThan(150);
  });

  it('scopes each measurement by BOTH sides of the pair, not either', () => {
    // The two operators that decide which pair counts where. `shore_overlap`
    // skips a pair where EITHER side is dry (only two ponds can draw one lake
    // twice); `sharedDryYards` counts a pair where BOTH are dry (one dry shore
    // facing open water is not a corridor). A fixture dry on both sides
    // satisfies either operator, so the deciding case is a pair dry on ONE
    // side, which must report zero for both.
    const oneSided = draft('metrics_water_one_sided', PINCHED_CONTROL_POINTS, 10, {
      waterBands: [
        { s: 0, kind: 'water' },
        { s: 0.08, kind: 'dry' },
        { s: 0.26, kind: 'water' },
      ],
    });
    const metrics = realmRacersCircuitMetrics(oneSided);
    // Water on one side of the pinch, lawn on the other: no two ponds meet, so
    // nothing self-crosses...
    expect(metrics.shoreOverlapYards).toBe(0);
    expect(codesOf(oneSided)).not.toContain('shore_overlap');
    // ...and no two dry shores flank one strip, so there is no corridor either.
    expect(metrics.sharedDryYards).toBe(0);
    // Not vacuous: the same shape all-water really does overlap, and dry on
    // BOTH sides really does report a corridor.
    expect(
      realmRacersCircuitMetrics(draft('metrics_one_sided_control', PINCHED_CONTROL_POINTS, 10))
        .shoreOverlapYards,
    ).toBeGreaterThan(100);
    expect(
      realmRacersCircuitMetrics(
        draft('metrics_one_sided_both', PINCHED_CONTROL_POINTS, 10, {
          waterBands: [
            { s: 0, kind: 'water' },
            { s: 0.08, kind: 'dry' },
            { s: 0.26, kind: 'water' },
            { s: 0.55, kind: 'dry' },
            { s: 0.72, kind: 'water' },
          ],
        }),
      ).sharedDryYards,
    ).toBeGreaterThan(100);
  });

  it('refuses a WATER span on a circuit that authors no basin', () => {
    const dry = draft('metrics_water_dry_ok', ring(60, 16), 10, {
      waterBands: [{ s: 0, kind: 'dry' }],
      basin: undefined,
    });
    expect(codesOf(dry)).not.toContain('shore_requires_basin');
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(dry))).toEqual([]);

    const thirsty = draft('metrics_water_dry_shore', ring(60, 16), 10, {
      waterBands: [
        { s: 0, kind: 'dry' },
        { s: 0.5, kind: 'water' },
      ],
      basin: undefined,
    });
    expect(codesOf(thirsty)).toContain('shore_requires_basin');
    // The default (no table at all) is a whole lap of water, so a basinless
    // record with no bands is refused too rather than read as dry.
    const bandless = draft('metrics_water_bandless_dry', ring(60, 16), 10, { basin: undefined });
    expect(codesOf(bandless)).toContain('shore_requires_basin');
  });

  it.each([
    ['not starting at zero', [{ s: 0.2, kind: 'dry' }]],
    [
      'unsorted',
      [
        { s: 0, kind: 'water' },
        { s: 0.6, kind: 'dry' },
        { s: 0.3, kind: 'water' },
      ],
    ],
    [
      'an entry at the end of the lap',
      [
        { s: 0, kind: 'water' },
        { s: 1, kind: 'dry' },
      ],
    ],
    [
      'a kind the spline does not know',
      [
        { s: 0, kind: 'water' },
        { s: 0.4, kind: 'swamp' },
      ],
    ],
    ['empty', []],
    ['a negative fraction', [{ s: -0.1, kind: 'dry' }]],
    [
      'a fraction that is not a number',
      [
        { s: 0, kind: 'water' },
        { s: Number.NaN, kind: 'dry' },
      ],
    ],
  ])('reports a water table %s', (label, bands) => {
    const broken = draft(`metrics_water_bad_${label.replace(/\W+/g, '_')}`, ring(60, 16), 10, {
      waterBands: bands as RealmRacersCircuit['waterBands'],
    });
    expect(codesOf(broken)).toContain('water_bands_malformed');
    // ...and a well formed table of the same shape is not reported.
    const fine = draft('metrics_water_good_table', ring(60, 16), 10, {
      waterBands: [
        { s: 0, kind: 'water' },
        { s: 0.4, kind: 'dry' },
        { s: 0.5, kind: 'water' },
      ],
    });
    expect(codesOf(fine)).not.toContain('water_bands_malformed');
  });
});

describe('Realm Racers circuit metrics: what has to contain what', () => {
  it('reports a road that runs outside its own perimeter wall, per axis', () => {
    const spilling = draft('metrics_spilling', ring(60, 16), 10, {
      perimeter: { halfX: 40, halfZ: 40, halfThickness: 0.4, height: 2.2 },
    });
    expect(codesOf(spilling)).toContain('road_outside_perimeter');
    // Both axes fail here, and each says which: two identical sentences would
    // leave the operator guessing which box to widen.
    expect(
      realmRacersCircuitMetrics(spilling)
        .problems.filter((p) => p.code === 'road_outside_perimeter')
        .map((p) => p.axis),
    ).toEqual(['x', 'z']);
    // A wall short on ONE axis reports that axis alone.
    const narrowZ = draft('metrics_spilling_z', ring(60, 16), 10, {
      perimeter: { halfX: 200, halfZ: 40, halfThickness: 0.4, height: 2.2 },
    });
    expect(
      realmRacersCircuitMetrics(narrowZ)
        .problems.filter((p) => p.code === 'road_outside_perimeter')
        .map((p) => p.axis),
    ).toEqual(['z']);
    expect(codesOf(draft('metrics_contained', ring(60, 16), 10))).not.toContain(
      'road_outside_perimeter',
    );
  });

  it('reports a perimeter the collision region does not cover', () => {
    const oversized = draft('metrics_region_short', ring(60, 16), 10, {
      regionHalfX: 100,
      regionHalfZ: 100,
    });
    expect(codesOf(oversized)).toContain('perimeter_outside_region');
  });

  it('reports a region wider than the instance band the circuits stack in', () => {
    const huge = draft('metrics_band_overrun', ring(60, 16), 10, {
      regionHalfX: REALM_RACERS_MAX_REGION_HALF_X + 1,
      regionHalfZ: 100,
      perimeter: { halfX: 200, halfZ: 90, halfThickness: 0.4, height: 2.2 },
    });
    expect(codesOf(huge)).toContain('region_outside_band');
    expect(codesOf(draft('metrics_band_ok', ring(60, 16), 10))).not.toContain(
      'region_outside_band',
    );
  });

  it('reports a region deeper than the gap between two lanes', () => {
    // Two copies of a circuit sit `REALM_RACERS_LANE_DZ` apart, so a region
    // deeper than half that gap (less the interest clearance) puts a racer on
    // one copy inside interest range of the next. The lane test in
    // `realm_racers_circuits.test.ts` fails on it after the fact; this is what
    // says so while the circuit is still being drawn.
    const deep = draft('metrics_lane_overrun', ring(60, 16), 10, {
      regionHalfZ: REALM_RACERS_MAX_REGION_HALF_Z + 1,
      perimeter: { halfX: 200, halfZ: 140, halfThickness: 0.4, height: 2.2 },
    });
    expect(codesOf(deep)).toContain('region_deeper_than_lane_budget');
    const atLimit = draft('metrics_lane_limit', ring(60, 16), 10, {
      regionHalfZ: REALM_RACERS_MAX_REGION_HALF_Z,
      perimeter: { halfX: 200, halfZ: 140, halfThickness: 0.4, height: 2.2 },
    });
    expect(codesOf(atLimit)).not.toContain('region_deeper_than_lane_budget');
  });

  it('derives both region ceilings from the band and the lane table', () => {
    // Neither is a literal: move a neighbouring band or the lane spacing and
    // what the editor allows moves with it.
    expect(REALM_RACERS_MAX_REGION_HALF_X).toBe(
      Math.min(
        REALM_RACERS_ORIGIN.x - REALM_RACERS_BAND_X_MIN,
        REALM_RACERS_BAND_X_MAX - REALM_RACERS_ORIGIN.x,
      ),
    );
    expect(REALM_RACERS_MAX_REGION_HALF_Z).toBe(
      (REALM_RACERS_LANE_DZ - REALM_RACERS_LANE_CLEARANCE) / 2,
    );
  });
});

describe('Realm Racers circuit metrics: the errors are the shippable gate', () => {
  it('separates what cannot be driven from what is merely tight', () => {
    const narrow = draft('metrics_errors_warning_only', ring(9), 8);
    const metrics = realmRacersCircuitMetrics(narrow);
    expect(metrics.problems.map((p) => p.severity)).toEqual(['warning']);
    expect(realmRacersCircuitErrors(metrics)).toEqual([]);
    const folded = draft('metrics_errors_real', ring(9), 10);
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(folded))).not.toEqual([]);
  });
});
