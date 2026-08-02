// The enclosure suggester: what perimeter wall and collision region fit a road
// of a given size. It exists so a big circuit can be DRAWN at all, rather than
// the operator meeting the previous circuit's wall as a complaint.
//
// The property that matters is that it never suggests an envelope the readout
// would then reject: the two ceilings it clamps to are the same ones
// `realmRacersCircuitMetrics` checks against.

import { describe, expect, it } from 'vitest';
import { suggestEnvelope } from '../src/editor/circuit/envelope_core';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
} from '../src/sim/realm_racers_layout';

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
