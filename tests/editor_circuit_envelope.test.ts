// The enclosure suggester: what perimeter wall and collision region fit a road
// of a given size. It exists so a big circuit can be DRAWN at all, rather than
// the operator meeting the previous circuit's wall as a complaint.
//
// The property that matters is that it never suggests an envelope the readout
// would then reject: the two ceilings it clamps to are the same ones
// `realmRacersCircuitMetrics` checks against.

import { describe, expect, it } from 'vitest';
import { suggestEnvelope, suggestGroundOutline } from '../src/editor/circuit/envelope_core';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUIT_LIST,
} from '../src/sim/content/realm_racers_circuits';
import { polygonSelfIntersects } from '../src/sim/geometry2d';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersGroundShape } from '../src/sim/realm_racers_ground';
import {
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
} from '../src/sim/realm_racers_layout';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

/** The abandoned Competition A shape: a 1094 yard lap, which is the size the
 *  competition pool is being authored at and the one the garden's inherited
 *  enclosure cannot hold. */
const BIG_LAP_CONTROL_POINTS = [
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

function fitted(id: string, controlPoints: readonly { x: number; z: number }[]) {
  const drawn: RealmRacersCircuit = {
    ...GARDEN,
    id: `${id}_drawn`,
    controlPoints,
    widthBands: [
      { s: 0, halfWidth: 10 },
      { s: 1, halfWidth: 10 },
    ],
  };
  const before = realmRacersCircuitMetrics(drawn);
  const suggestion = suggestEnvelope(before.roadHalfX, before.roadHalfZ, drawn.perimeter);
  const after: RealmRacersCircuit = {
    ...drawn,
    id,
    perimeter: suggestion.perimeter,
    regionHalfX: suggestion.regionHalfX,
    regionHalfZ: suggestion.regionHalfZ,
  };
  return { before, suggestion, after, metrics: realmRacersCircuitMetrics(after) };
}

describe('circuit editor enclosure', () => {
  it('makes a 1000 yard lap authorable, which the inherited enclosure did not', () => {
    // The complaint this exists for: a big loop drawn inside the garden's own
    // 118 x 92 wall reports a road running outside it, with nothing in the tool
    // able to change the number.
    const { before, metrics, after } = fitted('envelope_big_lap', BIG_LAP_CONTROL_POINTS);
    expect(before.lapLength).toBeGreaterThan(1000);
    expect(before.problems.map((p) => p.code)).toContain('road_outside_perimeter');
    expect(metrics.problems.map((p) => p.code)).not.toContain('road_outside_perimeter');
    expect(metrics.problems.map((p) => p.code)).not.toContain('perimeter_outside_region');
    expect(metrics.problems.map((p) => p.code)).not.toContain('region_outside_band');
    expect(metrics.problems.map((p) => p.code)).not.toContain('region_deeper_than_lane_budget');
    // ...and the enclosure really did have to grow past the garden's.
    expect(after.perimeter.halfX).toBeGreaterThan(GARDEN.perimeter.halfX);
    expect(after.regionHalfX).toBeGreaterThan(GARDEN.regionHalfX);
  });

  it('leaves room for the wall and then for the dressing beyond it', () => {
    const { before, after } = fitted('envelope_ordering', BIG_LAP_CONTROL_POINTS);
    expect(after.perimeter.halfX).toBeGreaterThan(before.roadHalfX);
    expect(after.regionHalfX).toBeGreaterThan(after.perimeter.halfX);
    expect(after.perimeter.halfZ).toBeGreaterThan(before.roadHalfZ);
    expect(after.regionHalfZ).toBeGreaterThan(after.perimeter.halfZ);
  });

  it('keeps the wall dressing the circuit already authored', () => {
    const suggestion = suggestEnvelope(80, 60, {
      halfX: 1,
      halfZ: 1,
      halfThickness: 0.9,
      height: 3.5,
    });
    expect(suggestion.perimeter.halfThickness).toBe(0.9);
    expect(suggestion.perimeter.height).toBe(3.5);
  });

  it('clamps to the band rather than stretching past it, and says which limit bit', () => {
    // A road wider than the whole instance band cannot be enclosed. Suggesting
    // an envelope that fits it anyway would be the tool blessing a circuit the
    // sim's own region test rejects.
    const suggestion = suggestEnvelope(2000, 20);
    expect(suggestion.regionHalfX).toBe(REALM_RACERS_MAX_REGION_HALF_X);
    expect(suggestion.clampedBy).toContain('band');
    expect(suggestion.clampedBy).not.toContain('lane');
  });

  it('clamps to the lane depth budget on the other axis', () => {
    const suggestion = suggestEnvelope(20, 2000);
    expect(suggestion.regionHalfZ).toBe(REALM_RACERS_MAX_REGION_HALF_Z);
    expect(suggestion.clampedBy).toContain('lane');
    expect(suggestion.clampedBy).not.toContain('band');
  });

  it('never suggests an envelope its own readout would reject', () => {
    for (const [halfX, halfZ] of [
      [40, 30],
      [99, 69],
      [198, 113],
      [400, 400],
    ]) {
      const suggestion = suggestEnvelope(halfX, halfZ);
      expect(suggestion.regionHalfX, `x at ${halfX}`).toBeLessThanOrEqual(
        REALM_RACERS_MAX_REGION_HALF_X,
      );
      expect(suggestion.regionHalfZ, `z at ${halfZ}`).toBeLessThanOrEqual(
        REALM_RACERS_MAX_REGION_HALF_Z,
      );
      expect(suggestion.regionHalfX).toBeGreaterThan(suggestion.perimeter.halfX);
      expect(suggestion.regionHalfZ).toBeGreaterThan(suggestion.perimeter.halfZ);
    }
  });

  it('is deterministic and idempotent, so re-fitting settles', () => {
    const first = suggestEnvelope(99, 69);
    expect(suggestEnvelope(99, 69)).toEqual(first);
    expect(suggestEnvelope(99, 69, first.perimeter)).toEqual(first);
  });
});

describe('the ground outline suggester', () => {
  /** A circuit wearing the proposal, so the readout can judge it. */
  const fitted = (circuit: RealmRacersCircuit, id: string): RealmRacersCircuit => ({
    ...circuit,
    id,
    groundOutline: suggestGroundOutline(circuit),
  });

  it('proposes a shape the readout accepts, on both shipped circuits', () => {
    // The property that matters, and the same one `suggestEnvelope` is held to:
    // a repair must never hand back something the panel then refuses. Here that
    // is `road_outside_ground_outline`, measured at the garden edge either side.
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      const island = fitted(circuit, `ground_fit_${circuit.id}`);
      const codes = realmRacersCircuitMetrics(island).problems.map((problem) => problem.code);
      expect(codes, circuit.id).not.toContain('road_outside_ground_outline');
    }
  });

  it('leaves the road real lawn on both sides rather than tracing its edge', () => {
    const island = fitted(GARDEN, 'ground_fit_margin');
    const outline = realmRacersGroundShape(island).outline;
    const track = realmRacersTrack(island);
    let tightest = Number.POSITIVE_INFINITY;
    for (const sample of track.samples) {
      const x = sample.x - REALM_RACERS_ORIGIN.x;
      const z = sample.z - REALM_RACERS_ORIGIN.z;
      let nearest = Number.POSITIVE_INFINITY;
      for (const point of outline)
        nearest = Math.min(nearest, Math.hypot(point.x - x, point.z - z));
      tightest = Math.min(tightest, nearest - rallyGardenEdgeOffsetAt(island, sample.s));
    }
    // Room for what stands between a road and a shore: a barrier run, a bench,
    // the clumps the shore is planted with.
    expect(tightest).toBeGreaterThan(10);
  });

  it('takes the OUTER side of the loop, whichever way the circuit was drawn', () => {
    // The inner offset folds through itself at any corner tighter than the
    // offset, so the side is picked by area rather than by winding. A circuit
    // listed backwards has to get the same island, not its infield.
    const backwards: RealmRacersCircuit = {
      ...GARDEN,
      id: 'ground_fit_backwards',
      controlPoints: [...GARDEN.controlPoints].reverse(),
    };
    const area = (ring: readonly { x: number; z: number }[]): number => {
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        sum += a.x * b.z - b.x * a.z;
      }
      return Math.abs(sum) / 2;
    };
    const forward = area(suggestGroundOutline(GARDEN));
    const reversed = area(suggestGroundOutline(backwards));
    // Both arms held to the SAME absolute floor, not to each other: the inner
    // offset of this loop is about a fortieth of the outer one, so a
    // winding-only implementation would hand back the infield on one arm and
    // the island on the other, and a relative bound between the two passes
    // whichever way round that fell.
    const metrics = realmRacersCircuitMetrics(GARDEN);
    const floor = metrics.roadHalfX * metrics.roadHalfZ;
    expect(forward).toBeGreaterThan(floor);
    expect(reversed).toBeGreaterThan(floor);
    // ...and the reversed proposal is one the readout accepts, which is the
    // whole point of taking the outer side.
    const codes = realmRacersCircuitMetrics(
      fitted(backwards, 'ground_fit_backwards_island'),
    ).problems.map((problem) => problem.code);
    expect(codes).not.toContain('road_outside_ground_outline');
  });

  it('never proposes a shape that crosses itself, on either shipped circuit', () => {
    // The defect this closes, measured on both records before it was fixed: an
    // offset curve folds through itself at every corner tighter than the offset,
    // and the garden's hairpin is tighter than the 26 yard margin. Even-odd
    // reads that loop as a HOLE, so the repair was handing an operator an island
    // with bald patches in the middle of its own lawn.
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      const outline = suggestGroundOutline(circuit);
      expect(polygonSelfIntersects(outline), `${circuit.id} handles`).toBe(false);
      // The SAMPLED curve too, which is what every consumer actually reads: a
      // simple control ring can still be smoothed into a crossing one.
      const sampled = realmRacersGroundShape(fitted(circuit, `ground_fold_${circuit.id}`)).outline;
      expect(polygonSelfIntersects([...sampled]), `${circuit.id} sampled`).toBe(false);
      // ...and the readout agrees, which is the rule an operator meets.
      const codes = realmRacersCircuitMetrics(
        fitted(circuit, `ground_fold_read_${circuit.id}`),
      ).problems.map((problem) => problem.code);
      expect(codes, circuit.id).not.toContain('ground_outline_folds');
    }
  });

  it('hands back a handful of draggable handles, not a thousand samples', () => {
    // It goes through the CIRCUIT's own stroke fit, so a proposed outline is the
    // same kind of object a drawn one is.
    const outline = suggestGroundOutline(GARDEN);
    expect(outline.length).toBeGreaterThanOrEqual(8);
    expect(outline.length).toBeLessThanOrEqual(40);
    expect(realmRacersTrack(GARDEN).samples.length).toBeGreaterThan(400);
  });

  it('is deterministic, so re-fitting settles rather than wandering', () => {
    expect(suggestGroundOutline(GARDEN)).toEqual(suggestGroundOutline(GARDEN));
  });
});
