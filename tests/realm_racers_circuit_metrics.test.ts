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
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUIT_LIST,
} from '../src/sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  REALM_RACERS_MIN_STRETCH_SEPARATION,
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
  realmRacersPickupRowFit,
  realmRacersPropStanding,
} from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersGroundReach, realmRacersGroundShape } from '../src/sim/realm_racers_ground';
import {
  REALM_RACERS_BAND_X_MAX,
  REALM_RACERS_BAND_X_MIN,
  REALM_RACERS_LANE_CLEARANCE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
} from '../src/sim/realm_racers_layout';
import {
  REALM_RACERS_PICKUP_BOX_HALF,
  REALM_RACERS_PICKUP_REACH,
  realmRacersPickupBoxes,
  realmRacersPickupLaneGap,
} from '../src/sim/realm_racers_pickups';
import { rallyFootprintRadius, realmRacersPlacements } from '../src/sim/realm_racers_props_resolve';
import {
  REALM_RACERS_PROJECTION_ENVELOPE,
  rallyGardenEdgeOffsetAt,
  realmRacersTrack,
} from '../src/sim/realm_racers_spline';

/** Everything a record needs that is not the shape under test. Roomy enough
 *  that no fixture trips the containment checks by accident. */
const DRAFT_BASE = {
  regionHalfX: 260,
  // At the lane depth budget, not past it: the fixture must not carry a defect
  // of its own into every case built on it.
  regionHalfZ: 150,
  perimeter: { halfX: 240, halfZ: 140, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6 },
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 4,
  timeLimitSeconds: 420,
  musicTrack: 'realm_racers',
  theme: 'evergarden',
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

/** An ellipse, for the cases where the two axes have to be told apart: a circle
 *  fires both at once and would let one arm of a per-axis rule read as two. */
function ellipse(radiusX: number, radiusZ: number, points = 12): { x: number; z: number }[] {
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    return { x: radiusX * Math.cos(angle), z: radiusZ * Math.sin(angle) };
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

describe('Realm Racers circuit metrics: the theme', () => {
  it('calls a theme no registry authors an error, by name', () => {
    // The readout is what a DRAFT is admitted by, so a theme id typed one
    // letter wrong has to be reported rather than swallowed. The value/limit
    // pair is checked too, because the editor renders it as "value against
    // limit" and a swapped pair reads backwards on screen.
    const typo = draft('theme_typo', ring(120), 10, { theme: 'evergardn' });
    const problem = realmRacersCircuitErrors(realmRacersCircuitMetrics(typo)).find(
      (p) => p.code === 'unknown_theme',
    );
    expect(problem).toBeDefined();
    expect([problem?.value, problem?.limit]).toEqual([1, 0]);
    // ...and a circuit on a theme the game DOES author is not reported, or the
    // readout is just noise.
    const clean = draft('theme_ok', ring(120), 10, { theme: 'evergarden' });
    expect(
      realmRacersCircuitErrors(realmRacersCircuitMetrics(clean)).map((p) => p.code),
    ).not.toContain('unknown_theme');
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

describe('Realm Racers circuit metrics: the water a circuit places', () => {
  it('refuses a pond on a circuit that authors no basin', () => {
    const dry = draft('metrics_water_dry_ok', ring(60, 16), 10, {
      ponds: undefined,
      basin: undefined,
    });
    expect(codesOf(dry)).not.toContain('pond_requires_basin');
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(dry))).toEqual([]);

    const thirsty = draft('metrics_water_dry_shore', ring(60, 16), 10, {
      ponds: [{ x: 0, z: 0, rx: 8, rz: 6, seed: 1 }],
      basin: undefined,
    });
    expect(codesOf(thirsty)).toContain('pond_requires_basin');
    // ...and the same pond WITH a basin is not reported, so the check is about
    // the pairing rather than about ponds.
    const proper = draft('metrics_water_proper', ring(60, 16), 10, {
      ponds: [{ x: 0, z: 0, rx: 8, rz: 6, seed: 1 }],
    });
    expect(codesOf(proper)).not.toContain('pond_requires_basin');
  });
});

describe('Realm Racers circuit metrics: the ground the road stands on', () => {
  // A ring road of radius 60 with a 10 yard half-width: its garden edge reaches
  // about 74 yards out, so a ground outline at 90 clears it and one at 50 is
  // under it. Both are hand-written rings rather than fitted shapes, so the
  // margins in play are readable rather than whatever a fit produced.
  const ROAD = ring(60, 16);

  it('says nothing at all about a circuit that authors no ground shape', () => {
    // The default is the rectangle covering the whole region, so this rule can
    // never fire on either shipped circuit: the case is here because a rule that
    // fired on the default would have been caught in the seat, not in a readout.
    const plain = draft('metrics_ground_default', ROAD, 10);
    expect(plain.groundOutline).toBeUndefined();
    expect(codesOf(plain)).not.toContain('road_outside_ground_outline');
  });

  it('passes a road that stays on its island, garden edge and all', () => {
    const island = draft('metrics_ground_island', ROAD, 10, { groundOutline: ring(90, 12) });
    expect(codesOf(island)).not.toContain('road_outside_ground_outline');
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(island))).toEqual([]);
  });

  it('reports a road running off the ground, as an error, at the lap position', () => {
    const drowned = draft('metrics_ground_drowned', ROAD, 10, { groundOutline: ring(50, 12) });
    const problems = realmRacersCircuitMetrics(drowned).problems.filter(
      (problem) => problem.code === 'road_outside_ground_outline',
    );
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.severity).toBe('error');
      // The value is how much LAP the run covers, against a limit of zero: a
      // yard of road over water is the whole fault.
      expect(problem.limit).toBe(0);
      expect(problem.value).toBeGreaterThan(0);
      expect(problem.s).toBeGreaterThanOrEqual(0);
    }
    // The whole lap is off this island, so it is reported as ONE run rather than
    // as one callout per sample: the corner checks' own rule, and what keeps a
    // shore drawn a yard too tight from filling the plan with markers.
    expect(problems).toHaveLength(1);
    expect(problems[0].value).toBeCloseTo(realmRacersCircuitMetrics(drowned).lapLength, 0);
    expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(drowned)).length).toBeGreaterThan(0);
  });

  it('catches a shore cut across ONE side, and leaves the rest of the lap alone', () => {
    // The island covers the road everywhere except a bite taken out of the +x
    // side, which is the case an endpoint test or a whole-lap verdict would both
    // miss: most of the circuit is perfectly fine.
    const bitten = ring(90, 24).map((point) =>
      point.x > 40 ? { x: point.x * 0.55, z: point.z * 0.55 } : point,
    );
    const circuit = draft('metrics_ground_bite', ROAD, 10, { groundOutline: bitten });
    const problems = realmRacersCircuitMetrics(circuit).problems.filter(
      (problem) => problem.code === 'road_outside_ground_outline',
    );
    expect(problems).toHaveLength(1);
    // A bite, not the lap: comfortably under a quarter of a 380 yard ring.
    const lap = realmRacersCircuitMetrics(circuit).lapLength;
    expect(problems[0].value).toBeGreaterThan(10);
    expect(problems[0].value).toBeLessThan(lap / 2);
  });

  it('reports one problem per RUN, at the lap position each one starts at', () => {
    // The rule says runS, and one bite cannot tell a per-run report from a
    // per-circuit verdict: an implementation that collapsed every off-ground
    // sample into a single problem passes the case above. Two bites, on
    // opposite sides, is the case that cannot.
    const bitten = ring(90, 24).map((point) =>
      Math.abs(point.x) > 40 ? { x: point.x * 0.5, z: point.z * 0.5 } : point,
    );
    const circuit = draft('metrics_ground_two_bites', ROAD, 10, { groundOutline: bitten });
    const metrics = realmRacersCircuitMetrics(circuit);
    const problems = metrics.problems.filter(
      (problem) => problem.code === 'road_outside_ground_outline',
    );
    expect(problems).toHaveLength(2);
    // Half a lap apart, which is where the two bites are: a pair reported at the
    // same place would be one fault counted twice.
    const [first, second] = problems.map((problem) => problem.s).sort((a, b) => a - b);
    expect(second - first).toBeGreaterThan(metrics.lapLength / 4);
    for (const problem of problems) {
      expect(problem.value).toBeGreaterThan(10);
      expect(problem.value).toBeLessThan(metrics.lapLength / 2);
    }
  });

  it('calls a ground outline that crosses itself an error', () => {
    // Even-odd is what every reader of this shape uses, so a fold is not a
    // cosmetic tangle: the loop reads as a HOLE, and the meadow, the beds and
    // the scatters are punched out over ground the lawn is drawn on.
    const bowtie = draft('metrics_ground_bowtie', ROAD, 10, {
      // Deliberately ASYMMETRIC: a perfectly balanced bowtie crosses exactly on
      // a sampled vertex, and a segment-pair test that (rightly) wants a strict
      // interior crossing misses that one measure-zero case.
      groundOutline: [
        { x: -140, z: -110 },
        { x: 120, z: 96 },
        { x: 150, z: -104 },
        { x: -128, z: 118 },
      ],
    });
    const problem = realmRacersCircuitMetrics(bowtie).problems.find(
      (entry) => entry.code === 'ground_outline_folds',
    );
    expect(problem).toBeDefined();
    expect(problem?.severity).toBe('error');
    expect([problem?.value, problem?.limit]).toEqual([1, 0]);
    // ...and a simple ring of the same size is not reported, so the check is
    // about the crossing rather than about authoring a shape at all.
    const clean = draft('metrics_ground_simple', ROAD, 10, { groundOutline: ring(90, 12) });
    expect(codesOf(clean)).not.toContain('ground_outline_folds');
  });

  it('warns when a ground outline runs past where the WATER follows it, per axis', () => {
    // What this rule learned. It shipped as an ERROR saying an outline past the
    // collision region stood over unflattened world terrain with the world's
    // rocks live under it, and that was measurably false: the whole instance
    // band sits past the dungeon threshold, so the floor is the flat interior
    // one inside the region and outside it alike. What IS different out there is
    // the SEA, which is cast from the island's centroid out to the land's own
    // reach and collapses along any coast that overran it.
    //
    // So the limit comes from the resolver, not from the region, and that fixed
    // the second fault too: at the region it was 160 yards STRICTER than the
    // rectangle the same module hands a circuit that draws nothing, and an error
    // there refuses the draft outright.
    const reach = realmRacersGroundReach(draft('metrics_ground_reach_probe', ROAD, 10));
    expect(reach.halfZ).toBeGreaterThan(DRAFT_BASE.regionHalfZ);

    // A SIX-handle ring, and that is the whole point of the fixture: every
    // handle sits 24 yards inside the reach (285.8 against 310) and the smoothed
    // curve bulges 11 yards OUTSIDE it (321.5), because a centripetal
    // Catmull-Rom leaves its control points on the outside of a bend. A rule
    // reading the authored handles would bless this shape.
    const deep = draft('metrics_ground_reach_z', ROAD, 10, { groundOutline: ellipse(330, 330, 6) });
    const handles = deep.groundOutline ?? [];
    expect(Math.max(...handles.map((point) => Math.abs(point.z)))).toBeLessThan(reach.halfZ);
    const onZ = realmRacersCircuitMetrics(deep).problems.filter(
      (entry) => entry.code === 'ground_beyond_water_reach',
    );
    expect(onZ).toHaveLength(1);
    // A WARNING, not an error, and that is load-bearing rather than a taste: an
    // error here is a draft the dev command refuses to race, and a dry stretch
    // of coast is a look, not a circuit the sim cannot drive.
    expect(onZ[0].severity).toBe('warning');
    expect(onZ[0].axis).toBe('z');
    expect(onZ[0].limit).toBe(reach.halfZ);
    expect(onZ[0].value).toBeCloseTo(321.5, 1);
    // The x axis stays silent on this one, so the two are separate verdicts
    // rather than one about the shape.
    expect(Math.max(...handles.map((point) => Math.abs(point.x)))).toBeLessThan(reach.halfX);

    // ...and the OTHER axis fires on its own, which the z fixture cannot show:
    // an outline wide and shallow reports x and nothing else.
    const wide = draft('metrics_ground_reach_x', ROAD, 10, { groundOutline: ellipse(440, 200, 6) });
    const onX = realmRacersCircuitMetrics(wide).problems.filter(
      (entry) => entry.code === 'ground_beyond_water_reach',
    );
    expect(onX).toHaveLength(1);
    expect(onX[0].axis).toBe('x');
    expect(onX[0].limit).toBe(reach.halfX);
    expect(onX[0].value).toBeCloseTo(440, 1);

    // An island inside the reach is not reported, so the rule is about running
    // past the water rather than about authoring a shape at all.
    const inside = draft('metrics_ground_reach_ok', ROAD, 10, {
      groundOutline: ellipse(240, 240, 6),
    });
    expect(codesOf(inside)).not.toContain('ground_beyond_water_reach');
    // Nor is a circuit that authors nothing, whose land IS the reach exactly and
    // would otherwise report itself on every axis.
    expect(codesOf(draft('metrics_ground_reach_none', ROAD, 10))).not.toContain(
      'ground_beyond_water_reach',
    );
  });

  it('measures the GARDEN EDGE, not the centerline', () => {
    // An outline drawn between the two: it holds every centerline sample and
    // cuts into the run-off either side of it. A centerline test would bless it,
    // which is the whole reason the probes are taken at the road's own edge.
    const centerlineOnly = draft('metrics_ground_edge', ROAD, 10, {
      groundOutline: ring(66, 16),
    });
    const track = realmRacersTrack(centerlineOnly);
    const outline = realmRacersGroundShape(centerlineOnly).outline;
    for (const sample of track.samples) {
      const inside = polygonContainsPoint(
        outline,
        sample.x - REALM_RACERS_ORIGIN.x,
        sample.z - REALM_RACERS_ORIGIN.z,
      );
      expect(inside, `centerline at ${sample.s.toFixed(0)} is on the island`).toBe(true);
    }
    expect(codesOf(centerlineOnly)).toContain('road_outside_ground_outline');
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

describe('where one placed piece stands', () => {
  // `realmRacersPropStanding` was extracted out of the loop below so the circuit
  // editor's placement ghost could tint from the SAME rule the readout raises
  // `prop_blocks_racing_surface` from. A predicate with two readers earns a test
  // of its own: the one thing a behaviour-preserving extraction cannot prove
  // about itself is its boundary.

  let fixtures = 0;
  const withProp = (asset: string, x: number, z: number): RealmRacersCircuit => ({
    ...GARDEN,
    id: `standing_${fixtures++}`,
    props: [{ asset, at: { x, z } }],
    scatters: undefined,
  });

  /** The piece as the ONE resolver places it, which is what the predicate reads. */
  const placedOn = (circuit: RealmRacersCircuit) => realmRacersPlacements(circuit).props[0];

  it('measures the footprint against the garden edge at its own lap position', () => {
    const circuit = withProp('bench', -60, -40);
    const placed = placedOn(circuit);
    const standing = realmRacersPropStanding(circuit, placed);
    const track = realmRacersTrack(circuit);
    const projection = track.project(
      placed.x + REALM_RACERS_ORIGIN.x,
      placed.z + REALM_RACERS_ORIGIN.z,
    );
    expect(standing.s).toBeCloseTo(projection.s, 6);
    expect(standing.surface).toBeCloseTo(rallyGardenEdgeOffsetAt(circuit, projection.s), 6);
    // The footprint's own radius comes off the clearance: a wide bench is closer
    // to the surface than its centre is.
    expect(standing.clear).toBeCloseTo(
      Math.abs(projection.lateral) - rallyFootprintRadius(placed.footprint),
      6,
    );
  });

  it('puts the verdict exactly on the edge, and one hair either side of it', () => {
    // The arm an extraction cannot prove about itself: flipping `>=` to `>`, or
    // the sign of `clear`, passes every behavioural test in the suite.
    const probe = withProp('bench', -60, -40);
    const placed = placedOn(probe);
    const track = realmRacersTrack(probe);
    const projection = track.project(
      placed.x + REALM_RACERS_ORIGIN.x,
      placed.z + REALM_RACERS_ORIGIN.z,
    );
    const point = track.pointAt(projection.s);
    const radius = rallyFootprintRadius(placed.footprint);
    const side = projection.lateral >= 0 ? 1 : -1;
    /** A bench whose near face sits exactly `slack` yards outside the edge. */
    const at = (slack: number): RealmRacersCircuit => {
      const offset = (rallyGardenEdgeOffsetAt(probe, projection.s) + radius + slack) * side;
      return withProp(
        'bench',
        point.x - REALM_RACERS_ORIGIN.x - point.tz * offset,
        point.z - REALM_RACERS_ORIGIN.z + point.tx * offset,
      );
    };
    const verdict = (circuit: RealmRacersCircuit): boolean =>
      realmRacersPropStanding(circuit, placedOn(circuit)).clearOfSurface;
    expect(verdict(at(0.02))).toBe(true);
    expect(verdict(at(-0.02))).toBe(false);
    expect(verdict(at(4))).toBe(true);
    expect(verdict(at(-4))).toBe(false);
  });

  it('cannot disagree with the problem the readout raises for the same record', () => {
    // The whole reason it is one function. Both ways, over the same two records,
    // so a predicate that drifted from the loop fails here rather than showing
    // an editor ghost in a colour the panel contradicts.
    //
    // ON the road, taken off the curve rather than guessed: the garden's origin
    // is its INFIELD, so (0, 0) is clear of everything.
    const centre = realmRacersTrack(GARDEN).pointAt(100);
    const onSurface = withProp(
      'bench',
      centre.x - REALM_RACERS_ORIGIN.x,
      centre.z - REALM_RACERS_ORIGIN.z,
    );
    const raised = realmRacersCircuitMetrics(onSurface).problems.filter(
      (problem) => problem.code === 'prop_blocks_racing_surface',
    );
    const standing = realmRacersPropStanding(onSurface, placedOn(onSurface));
    expect(standing.clearOfSurface).toBe(false);
    expect(raised).toHaveLength(1);
    // The numbers the panel prints ARE the predicate's own.
    expect(raised[0].value).toBeCloseTo(standing.clear, 6);
    expect(raised[0].limit).toBeCloseTo(standing.surface, 6);
    expect(raised[0].s).toBeCloseTo(standing.s, 6);

    // ...and well OFF it: the garden's origin is the middle of its infield.
    const clear = withProp('bench', 0, 0);
    expect(realmRacersPropStanding(clear, placedOn(clear)).clearOfSurface).toBe(true);
    expect(
      realmRacersCircuitMetrics(clear).problems.some(
        (problem) => problem.code === 'prop_blocks_racing_surface',
      ),
    ).toBe(false);
  });
});

describe('Realm Racers circuit metrics: the pickup rows', () => {
  // A row is DERIVED from the road at its own lap position, so the only thing
  // it can get wrong is not fitting on the road it was derived from. The ring
  // fixtures are what make that reachable: a circle's width is one number, so
  // the check has a road narrow enough to fail and a road wide enough to pass
  // with nothing else about the two circuits different.
  const rowed = (id: string, halfWidth: number): RealmRacersCircuit =>
    draft(id, ring(60), halfWidth, { pickupRows: [{ s: 0.25 }] });

  it('counts the authored rows rather than the boxes they resolve to', () => {
    const metrics = realmRacersCircuitMetrics(rowed('metrics_pickup_count', 10));
    expect(metrics.pickupRowCount).toBe(1);
    expect(
      realmRacersCircuitMetrics(draft('metrics_pickup_none', ring(60), 10)).pickupRowCount,
    ).toBe(0);
  });

  it('passes a row the road has room for', () => {
    expect(codesOf(rowed('metrics_pickup_wide', 10))).not.toContain('pickup_row_off_road');
  });

  it('answers for ONE row, so a tool can judge a placement before it is on the record', () => {
    // `realmRacersPickupRowFit` is the predicate `pickup_row_off_road` is raised
    // from, extracted for the reason `realmRacersPropStanding` was: the circuit
    // editor tints a row's ghost before the click, and a tint derived from the
    // tool's own arithmetic would be free to say green about a row the readout
    // then refuses.
    for (const [id, halfWidth, fits] of [
      ['metrics_pickup_fit_wide', 10, true],
      ['metrics_pickup_fit_narrow', 2, false],
    ] as const) {
      const circuit = rowed(id, halfWidth);
      const fit = realmRacersPickupRowFit(circuit, realmRacersPickupBoxes(circuit));
      expect(fit.fitsRoad, id).toBe(fits);
      // And it agrees with the readout it was taken out of, which is the whole
      // contract: one rule, one reader, both directions.
      expect(codesOf(circuit).includes('pickup_row_off_road'), id).toBe(!fits);
      // The numbers are the ones the panel prints, not a bare boolean.
      expect(fit.road, id).toBeCloseTo(halfWidth, 6);
      expect(fit.reach > fit.road, id).toBe(!fits);
    }
  });

  it('judges the row it is HANDED rather than looking one up on the record', () => {
    // What makes it usable on a pending row: the boxes come in, so a ghost can
    // resolve a throwaway record and ask about a row the circuit does not carry.
    const wide = rowed('metrics_pickup_fit_handed', 10);
    const pending = { ...wide, pickupRows: [{ s: 0.6 }] };
    const fit = realmRacersPickupRowFit(wide, realmRacersPickupBoxes(pending));
    expect(fit.fitsRoad).toBe(true);
    expect(fit.s).toBeGreaterThan(0);
  });

  it('calls an empty row fitting rather than throwing on it', () => {
    // Unreachable through the resolver, which always emits four boxes. A
    // predicate that threw here would turn a caller's empty list into a crash in
    // a tool that is only ever asking a question.
    expect(realmRacersPickupRowFit(rowed('metrics_pickup_fit_empty', 10), []).fitsRoad).toBe(true);
  });

  it('fails a row on a road too narrow to carry it', () => {
    // At a 2 yard half-width the outermost box sits 1.6 yd off the centerline
    // and is 0.6 yd across, so it reaches past the road edge: the row would
    // stand where a machine holding the racing line does not go.
    const circuit = rowed('metrics_pickup_narrow', 2);
    const problems = realmRacersCircuitMetrics(circuit).problems.filter(
      (problem) => problem.code === 'pickup_row_off_road',
    );
    // ONE problem, for a row of four boxes: the row is what is authored, and
    // four callouts on one lap position is one unreadable callout.
    expect(problems).toHaveLength(1);
    expect(problems[0].severity).toBe('error');
    expect(problems[0].limit).toBeCloseTo(2, 6);
    // The VALUE is the worst corner's own reach, recomputed here off the
    // resolver rather than copied off the readout: without this the assertion
    // above would pass for a rule that reported the box CENTRE (1.6), which is
    // a number that never fails on any road the tool can author.
    const track = realmRacersTrack(circuit);
    const worst = Math.max(
      ...realmRacersPickupBoxes(circuit).flatMap((box) => {
        const tx = Math.sin(box.yaw);
        const tz = Math.cos(box.yaw);
        const half = REALM_RACERS_PICKUP_BOX_HALF;
        return [
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ].map(([along, across]) =>
          Math.abs(
            track.project(
              box.x + tx * half * along - tz * half * across,
              box.z + tz * half * along + tx * half * across,
            ).lateral,
          ),
        );
      }),
    );
    expect(worst).toBeGreaterThan(1.6);
    expect(problems[0].value).toBeCloseTo(worst, 6);
    // Located, so the plan can pin a callout on the row rather than on the loop.
    expect(problems[0].s).toBeGreaterThan(0);
  });

  it('says nothing about a circuit that authors no rows at all', () => {
    const bare = codesOf(draft('metrics_pickup_bare', ring(60), 2));
    expect(bare).not.toContain('pickup_row_off_road');
    expect(bare).not.toContain('pickup_row_lanes_overlap');
  });

  it('pins the pickup catch reach to its shipped literal', () => {
    // The overlap warning below judges a row against this reach, so a retune
    // would silently move what the readout warns about. The literal is what
    // says the shipped number is the shipped number.
    expect(REALM_RACERS_PICKUP_REACH).toBe(2.3);
  });

  it('warns where a row is narrow enough that its own boxes overlap', () => {
    // A WARNING rather than an error, and it fires on shipped content: what it
    // says is that a pass down the middle of two boxes is inside both, which
    // the take rule resolves (nearest, lowest index) but the operator should
    // see. The roomy ring is the other arm, so the check is not vacuous.
    const tight = realmRacersCircuitMetrics(rowed('metrics_pickup_tight', 8)).problems.filter(
      (problem) => problem.code === 'pickup_row_lanes_overlap',
    );
    expect(tight).toHaveLength(1);
    expect(tight[0].severity).toBe('warning');
    expect(tight[0].value).toBeCloseTo(realmRacersPickupLaneGap(8) / 2, 6);
    expect(tight[0].limit).toBe(REALM_RACERS_PICKUP_REACH);
    expect(tight[0].value).toBeLessThan(tight[0].limit);
    expect(codesOf(rowed('metrics_pickup_roomy', 12))).not.toContain('pickup_row_lanes_overlap');
  });

  it.each(REALM_RACERS_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s authors pickup rows and the readout accepts every one of them',
    (_id, circuit) => {
      // The content criterion, self-enforcing: a circuit shipped without rows is
      // a circuit whose races have no ammunition on them, and nothing else in
      // the tree would say so.
      expect(circuit.pickupRows?.length ?? 0).toBeGreaterThan(0);
      const metrics = realmRacersCircuitMetrics(circuit);
      expect(metrics.pickupRowCount).toBe(circuit.pickupRows?.length ?? 0);
      expect(metrics.problems.filter((problem) => problem.code === 'pickup_row_off_road')).toEqual(
        [],
      );
    },
  );
});
