// The shape of the LAND a circuit sits on.
//
// Two behaviours carry the whole packet. The DEFAULT is the rectangle the ground
// has always been, which is what makes both shipped circuits byte-identical to
// what they were before the field existed; and an AUTHORED outline is read as
// the circuit's own curve class, the closed centripetal Catmull-Rom, so a shape
// drawn with the centerline's gesture is cut where it was drawn.
//
// Everything downstream (the lawn geometry, the sea, the shore dressing, the
// `road_outside_ground_outline` rule) reads what this returns, so a defect here
// is a circuit judged against one shape and drawn as another.

import { describe, expect, it } from 'vitest';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  REALM_RACERS_GROUND_SAMPLES_PER_SPAN,
  realmRacersGroundRectangle,
  realmRacersGroundShape,
  realmRacersGroundSpansAt,
  realmRacersOnGround,
} from '../src/sim/realm_racers_ground';
import { type RallyPoint, REALM_RACERS_LAWN_OVERSHOOT } from '../src/sim/realm_racers_layout';

/** A hand-written diamond, so every assertion below is against numbers a reader
 *  can check by eye rather than against whatever the fit happened to produce. */
const DIAMOND: RallyPoint[] = [
  { x: 0, z: -120 },
  { x: 150, z: 0 },
  { x: 0, z: 120 },
  { x: -150, z: 0 },
];

const island = (id: string, groundOutline: readonly RallyPoint[]): RealmRacersCircuit => ({
  ...GARDEN,
  id,
  groundOutline,
});

describe('the ground shape: what a circuit that authors none gets', () => {
  it('is exactly the rectangle the lawn has always been', () => {
    const shape = realmRacersGroundShape(GARDEN);
    expect(shape.authored).toBe(false);
    // The literal numbers, not the constants read back at themselves: the whole
    // promise of the default is that it is the rectangle the renderer builds
    // from `regionHalf*` plus its own overshoot, and nothing derived from the
    // shape a later author draws.
    expect(GARDEN.regionHalfX).toBe(300);
    expect(GARDEN.regionHalfZ).toBe(150);
    expect(REALM_RACERS_LAWN_OVERSHOOT).toBe(160);
    expect([...shape.outline]).toEqual([
      { x: -460, z: -310 },
      { x: 460, z: -310 },
      { x: 460, z: 310 },
      { x: -460, z: 310 },
    ]);
  });

  it('falls back to it rather than throwing on a ring too small to enclose anything', () => {
    // Two points is a hand edit, not a drawing: the resolver has to answer a
    // malformed draft with a shape rather than with an exception, the way the
    // barrier resolver skips a zero-length run.
    for (const points of [[], [DIAMOND[0]], [DIAMOND[0], DIAMOND[1]]]) {
      const shape = realmRacersGroundShape(island(`ground_short_${points.length}`, points));
      expect(shape.authored).toBe(false);
      expect([...shape.outline]).toEqual(realmRacersGroundRectangle(GARDEN));
    }
  });

  it('falls back on a handle that is not a NUMBER, which reaches further than it looks', () => {
    // One non-finite handle used to sail through the arity guard and be read as
    // a drawing. What it does from there is out of proportion to a typo: the
    // clearance walk takes a `Math.min` over every edge, so a single NaN
    // endpoint makes `distanceToOutline` NaN for EVERY point on the land and
    // empties the derived fills; and the span reader sorts its crossings with a
    // subtraction comparator, which a NaN turns into an implementation-defined
    // ordering, in `src/sim`, where three hosts have to agree.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const points = DIAMOND.map((point, i) => (i === 1 ? { x: bad, z: point.z } : point));
      const circuit = island(`ground_nonfinite_${bad}`, points);
      const shape = realmRacersGroundShape(circuit);
      expect(shape.authored, String(bad)).toBe(false);
      expect([...shape.outline]).toEqual(realmRacersGroundRectangle(GARDEN));
      // ...so nothing downstream can read a NaN out of it.
      expect(realmRacersOnGround(circuit, 0, 0, 5)).toBe(true);
      expect(realmRacersGroundSpansAt(circuit, 0)).toBeNull();
    }
  });
});

describe('the ground shape: what an authored outline resolves to', () => {
  it('samples the curve and reports itself as authored', () => {
    const shape = realmRacersGroundShape(island('ground_diamond', DIAMOND));
    expect(shape.authored).toBe(true);
    // The density is written down rather than read back at itself.
    expect(REALM_RACERS_GROUND_SAMPLES_PER_SPAN).toBe(8);
    expect(shape.outline).toHaveLength(DIAMOND.length * 8);
    // Closed by wrapping rather than by a repeated point: a duplicate would give
    // the curve a zero-length span to read a tangent from, which is the rule the
    // stroke fit already keeps for the centerline.
    const first = shape.outline[0];
    const last = shape.outline[shape.outline.length - 1];
    expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeGreaterThan(1);
  });

  it('passes through every authored handle, and bulges between them', () => {
    const shape = realmRacersGroundShape(island('ground_diamond_pass', DIAMOND));
    for (const point of DIAMOND) {
      const on = shape.outline.some(
        (sample) => Math.abs(sample.x - point.x) < 1e-6 && Math.abs(sample.z - point.z) < 1e-6,
      );
      expect(on, `${point.x},${point.z} is on the curve`).toBe(true);
    }
    // A smoothed diamond is not the polygon: the midpoint of an edge sits OUTSIDE
    // the straight chord between its two handles. That is the difference between
    // this and a fence, and it is why the plan draws the sampled curve rather
    // than the record's own points.
    const chord = { x: (DIAMOND[0].x + DIAMOND[1].x) / 2, z: (DIAMOND[0].z + DIAMOND[1].z) / 2 };
    expect(polygonContainsPoint(shape.outline, chord.x, chord.z)).toBe(true);
    const beyond = { x: chord.x * 1.06, z: chord.z * 1.06 };
    expect(polygonContainsPoint(shape.outline, beyond.x, beyond.z)).toBe(true);
  });

  it('is memoized per RECORD identity, so a redrawn draft gets its own shape', () => {
    const drawn = island('ground_draft', DIAMOND);
    expect(realmRacersGroundShape(drawn)).toBe(realmRacersGroundShape(drawn));
    // The same id with a different record behind it: the discipline every derived
    // cache in the rally runs on, and what lets the editor redraw on every drag.
    const redrawn = island(
      'ground_draft',
      DIAMOND.map((point) => ({ x: point.x * 2, z: point.z * 2 })),
    );
    const before = realmRacersGroundShape(drawn).outline;
    const after = realmRacersGroundShape(redrawn).outline;
    expect(after).not.toBe(before);
    expect(after[0].z).toBeCloseTo(before[0].z * 2, 6);
  });
});

describe('the ground shape: what may stand on it', () => {
  const ISLAND = island('ground_standing', DIAMOND);

  it('says yes to everything on a circuit that authored no shape', () => {
    // The cheap arm, and the one that keeps both shipped circuits exactly as
    // they were: the derived rectangle covers the whole region, so every derived
    // fill goes on filling the box it always filled.
    for (const [x, z] of [
      [0, 0],
      [GARDEN.regionHalfX + 500, 0],
      [0, -(GARDEN.regionHalfZ + 500)],
    ]) {
      expect(realmRacersOnGround(GARDEN, x, z), `${x}, ${z}`).toBe(true);
      expect(realmRacersOnGround(GARDEN, x, z, 40), `${x}, ${z} with margin`).toBe(true);
    }
    expect(realmRacersGroundSpansAt(GARDEN, 0)).toBeNull();
  });

  it('answers for the shape, not for its bounding box', () => {
    // The corner of the diamond's box is comfortably outside the diamond, which
    // is the whole difference between a shape and a box and the reason the
    // meadow needed clipping at all.
    expect(realmRacersOnGround(ISLAND, 0, 0)).toBe(true);
    expect(realmRacersOnGround(ISLAND, 140, 110)).toBe(false);
    expect(realmRacersOnGround(ISLAND, 0, -300)).toBe(false);
  });

  it('keeps a piece off the shore by its own size', () => {
    // A bench whose footprint hangs over the water is standing on water. The
    // point is inside either way; what the margin decides is whether the piece
    // FITS.
    const nearShore = { x: 0, z: 118 };
    expect(realmRacersOnGround(ISLAND, nearShore.x, nearShore.z)).toBe(true);
    expect(realmRacersOnGround(ISLAND, nearShore.x, nearShore.z, 1)).toBe(true);
    expect(realmRacersOnGround(ISLAND, nearShore.x, nearShore.z, 12)).toBe(false);
    // ...and deep inland the same margin changes nothing.
    expect(realmRacersOnGround(ISLAND, 0, 0, 12)).toBe(true);
  });

  it('answers a whole ROW with spans that agree with the point test', () => {
    // The grid fills read spans rather than testing every cell, so the two
    // readings have to be the same reading: a mask built from one and a readout
    // built from the other is exactly the drift the one resolver exists to stop.
    for (const z of [-100, -40, 0, 55, 119]) {
      const spans = realmRacersGroundSpansAt(ISLAND, z);
      if (!spans) throw new Error('an authored shape answers with spans');
      let inside = 0;
      for (let x = -170; x <= 170; x += 2.5) {
        // A probe sitting exactly ON a span end is on the waterline, where the
        // two rules are allowed to answer differently: the even-odd point test
        // counts one end of an edge and not the other, and a span carries both.
        // The diamond's own vertex at x = 150 is such a point. Everything a
        // finger's width off the line has to agree.
        if (spans.some((span) => Math.abs(x - span.x0) < 0.05 || Math.abs(x - span.x1) < 0.05)) {
          continue;
        }
        const inSpan = spans.some((span) => x >= span.x0 && x <= span.x1);
        expect(inSpan, `${x}, ${z}`).toBe(realmRacersOnGround(ISLAND, x, z));
        if (inSpan) inside++;
      }
      // Not vacuous: the row really did cross the island rather than missing it.
      expect(inside, `row ${z}`).toBeGreaterThan(3);
    }
  });

  it('reports no span at all for a line that misses the island', () => {
    // An empty list rather than null, and the difference is load bearing: the
    // grass mask reads null as "no shape authored, fill everything" and an empty
    // list as "this row is all water".
    const spans = realmRacersGroundSpansAt(ISLAND, 400);
    expect(spans).toEqual([]);
    expect(spans).not.toBeNull();
  });

  it('reports both spans of a line that crosses two lobes of land', () => {
    // A shape with a bay in it is one row with TWO stretches of land, and a
    // caller that took the first and the last crossing would plant the bay.
    const bowtie = island('ground_bay', [
      { x: -120, z: -80 },
      { x: 120, z: -80 },
      { x: 120, z: 80 },
      { x: 20, z: 80 },
      { x: 12, z: -30 },
      { x: -12, z: -30 },
      { x: -20, z: 80 },
      { x: -120, z: 80 },
    ]);
    const spans = realmRacersGroundSpansAt(bowtie, 60);
    expect(spans?.length).toBe(2);
    expect(realmRacersOnGround(bowtie, 0, 60)).toBe(false);
    expect(realmRacersOnGround(bowtie, -60, 60)).toBe(true);
    expect(realmRacersOnGround(bowtie, 60, 60)).toBe(true);
  });
});
