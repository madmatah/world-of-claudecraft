// Fitting a freehand gesture into the handful of control points a circuit
// record holds. The fit has to be deterministic (an operator undoes, redraws
// and compares), it has to close the loop without repeating a point, and the
// CURVE it implies has to stay near the line that was drawn: a closed
// centripetal Catmull-Rom does not pass through the stroke, and discovering how
// far off it sits after the circuit is in the game is the expensive way.

import { describe, expect, it } from 'vitest';
import {
  fitStrokeToControlPoints,
  perpendicularDistance,
  resampleClosed,
} from '../src/editor/circuit/stroke_fit_core';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/realm_racers_circuits';
import { type RallyPoint, REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

/** A hand-drawn circle: 300 points, an uneven hand, no duplicate close. */
function circleStroke(radius: number, points = 300): RallyPoint[] {
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    // A deterministic wobble standing in for a pointer's jitter.
    const jitter = 0.6 * Math.sin(i * 2.399963);
    return { x: (radius + jitter) * Math.cos(angle), z: (radius + jitter) * Math.sin(angle) };
  });
}

/** A square-ish stroke: four straights and four hard corners. */
function squareStroke(half: number, perSide = 60): RallyPoint[] {
  const corners = [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ];
  const out: RallyPoint[] = [];
  corners.forEach((corner, i) => {
    const next = corners[(i + 1) % corners.length];
    for (let k = 0; k < perSide; k++) {
      const t = k / perSide;
      out.push({ x: corner.x + (next.x - corner.x) * t, z: corner.z + (next.z - corner.z) * t });
    }
  });
  return out;
}

/** The fitted points as a circuit, so the REAL spline says where the curve goes. */
function candidate(id: string, controlPoints: readonly RallyPoint[]): RealmRacersCircuit {
  return { ...GARDEN, id, controlPoints };
}

describe('Realm Racers stroke fitting', () => {
  it('is deterministic: the same gesture always fits the same way', () => {
    const stroke = circleStroke(100);
    expect(fitStrokeToControlPoints(stroke)).toEqual(fitStrokeToControlPoints(stroke));
  });

  it('closes the loop without repeating a point at the end', () => {
    // The spline reads the ring as closed and wraps on its own; a duplicate
    // point would hand it a zero-length span to read a tangent from.
    const fitted = fitStrokeToControlPoints([...circleStroke(100), { x: 100, z: 0 }]);
    const first = fitted[0];
    const last = fitted[fitted.length - 1];
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeGreaterThan(1);
  });

  it('lands inside the editable band of control points', () => {
    // Below the floor a loop has no shape; above the ceiling the handles stop
    // being editable by hand, which is the whole reason to fit rather than paste.
    for (const stroke of [circleStroke(100), squareStroke(80), circleStroke(30, 900)]) {
      const fitted = fitStrokeToControlPoints(stroke);
      expect(fitted.length).toBeGreaterThanOrEqual(8);
      expect(fitted.length).toBeLessThanOrEqual(40);
    }
  });

  it('keeps the derived CURVE within a stated tolerance of the stroke', () => {
    // Measured against the real spline, not against the fitted polyline: the
    // curve is what the sim drives, and it bulges between control points.
    const fitted = fitStrokeToControlPoints(circleStroke(100));
    const track = realmRacersTrack(candidate('stroke_fit_circle', fitted));
    const radii = track.samples.map((sample) =>
      Math.hypot(sample.x - REALM_RACERS_ORIGIN.x, sample.z - REALM_RACERS_ORIGIN.z),
    );
    // The stroke itself wobbles by 0.6 yd, so a tolerance of 1.5 leaves the fit
    // under a yard of slack: enough that a regression in either pass shows.
    expect(Math.max(...radii)).toBeLessThan(101.5);
    expect(Math.min(...radii)).toBeGreaterThan(98.5);
  });

  it('keeps the corners of a stroke that has them', () => {
    // RDP keeps original points, so the four hard corners of a square survive
    // even at a tolerance that flattens the straights between them.
    const fitted = fitStrokeToControlPoints(squareStroke(80));
    for (const corner of [
      { x: -80, z: -80 },
      { x: 80, z: -80 },
      { x: 80, z: 80 },
      { x: -80, z: 80 },
    ]) {
      const nearest = Math.min(
        ...fitted.map((point) => Math.hypot(point.x - corner.x, point.z - corner.z)),
      );
      expect(nearest, `corner ${corner.x},${corner.z}`).toBeLessThan(6);
    }
  });

  it('resamples a closed polyline at a uniform arc length', () => {
    const resampled = resampleClosed(squareStroke(80, 4), 5);
    const gaps = resampled.map((point, i) => {
      const next = resampled[(i + 1) % resampled.length];
      return Math.hypot(next.x - point.x, next.z - point.z);
    });
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.5);
    expect(resampled.length).toBeGreaterThan(100);
  });

  it('drops duplicate points a pointer emitted in the same place', () => {
    const doubled = squareStroke(80, 4).flatMap((point) => [point, { ...point }]);
    expect(resampleClosed(doubled, 5)).toEqual(resampleClosed(squareStroke(80, 4), 5));
  });

  it('refuses to invent a loop out of a stroke too small to be one', () => {
    // Two points is a line, not a circuit, and returning eight points around it
    // would be the tool guessing at what the operator meant.
    expect(fitStrokeToControlPoints([{ x: 0, z: 0 }]).length).toBeLessThan(8);
    expect(fitStrokeToControlPoints([]).length).toBe(0);
  });

  it('measures the offset of a point from the line between two others', () => {
    expect(perpendicularDistance({ x: 0, z: 5 }, { x: -10, z: 0 }, { x: 10, z: 0 })).toBeCloseTo(5);
    // A degenerate segment falls back on the distance to its own start.
    expect(perpendicularDistance({ x: 3, z: 4 }, { x: 0, z: 0 }, { x: 0, z: 0 })).toBeCloseTo(5);
  });
});
