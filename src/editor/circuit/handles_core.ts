// The editing rules for everything a circuit record holds as an ORDERED list:
// the control-point ring and the two band tables (road width, apron ceiling).
//
// They are together because they are one problem twice: pick the thing under
// the cursor, move it without breaking the order the record depends on, and
// refuse the edit that would leave the record unauthorable rather than letting
// the operator discover it in a readout afterwards.
//
// The recovery anchors used to live here too, as an authored list of lap
// fractions. They are derived from the curve now (`realmRacersGates`), because
// nothing about where one sits is a design decision.
//
// Pure core: DOM-free, deterministic, no clock, no rng. Every function returns
// a NEW list; nothing here mutates its input, so the page's undo stack is just
// the previous value.

import type { RallyPoint } from '../../sim/realm_racers_layout';

/** A closed loop needs this many control points to have a shape at all; it is
 *  the same floor `tests/realm_racers_circuits.test.ts` holds every record to. */
export const MIN_CONTROL_POINTS = 8;

/** Lap fractions are snapped to this grid, which is what stops a drag from
 *  leaving a hundred breakpoints a yard apart behind it. */
export const FRACTION_SNAP = 0.005;

export interface CircuitBand {
  s: number;
  value: number;
}

export interface SegmentHit {
  /** Index of the control point OPENING the nearest segment. */
  index: number;
  distance: number;
  point: RallyPoint;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function snapFraction(s: number, snap = FRACTION_SNAP): number {
  const wrapped = ((s % 1) + 1) % 1;
  return Math.round(wrapped / snap) * snap;
}

/** Which control point is under (x, z), or -1. Nearest wins, so overlapping
 *  handles resolve the way the operator sees them. */
export function hitTestControlPoint(
  points: readonly RallyPoint[],
  x: number,
  z: number,
  radius: number,
): number {
  let best = -1;
  let bestDistance = radius;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance <= bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** The closed-loop segment nearest (x, z), and where on it the point lands.
 *  What an insert-a-handle click reads, so the new point starts on the line. */
export function nearestSegment(points: readonly RallyPoint[], x: number, z: number): SegmentHit {
  let best: SegmentHit = { index: 0, distance: Number.POSITIVE_INFINITY, point: { x, z } };
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    const t = length2 <= 0 ? 0 : clamp(((x - a.x) * dx + (z - a.z) * dz) / length2, 0, 1);
    const point = { x: a.x + dx * t, z: a.z + dz * t };
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < best.distance) best = { index: i, distance, point };
  }
  return best;
}

export function moveControlPoint(
  points: readonly RallyPoint[],
  index: number,
  to: RallyPoint,
): RallyPoint[] {
  if (index < 0 || index >= points.length) return [...points];
  return points.map((point, i) => (i === index ? { x: to.x, z: to.z } : point));
}

/** Inserts a point INTO the segment opening at `index`, which is where
 *  `nearestSegment` reports a click on the line. */
export function insertControlPoint(
  points: readonly RallyPoint[],
  index: number,
  at: RallyPoint,
): RallyPoint[] {
  if (points.length === 0) return [{ x: at.x, z: at.z }];
  const opening = ((index % points.length) + points.length) % points.length;
  const out = [...points];
  out.splice(opening + 1, 0, { x: at.x, z: at.z });
  return out;
}

/** Refuses below the record's own floor: a loop with too few points is not a
 *  shape the spline can read, and finding that out in a readout afterwards is
 *  exactly what this tool exists to stop. */
export function deleteControlPoint(points: readonly RallyPoint[], index: number): RallyPoint[] {
  if (points.length <= MIN_CONTROL_POINTS) return [...points];
  if (index < 0 || index >= points.length) return [...points];
  return points.filter((_, i) => i !== index);
}

export interface PaintBandOptions {
  /** Floor and ceiling the painted value is held to, in yards. */
  min: number;
  max: number;
  snap?: number;
}

/**
 * Paints one breakpoint of a band table: the width brush and the apron brush
 * are the same gesture over two tables of the same shape.
 *
 * The table always spans the whole lap (a breakpoint at 0 and one at 1), and
 * those two carry the SAME value, because s = 0 and s = 1 are the same yard of
 * road: letting them differ puts a step across the start/finish line.
 */
export function paintBand(
  bands: readonly CircuitBand[],
  s: number,
  value: number,
  options: PaintBandOptions,
): CircuitBand[] {
  const snap = options.snap ?? FRACTION_SNAP;
  const held = clamp(value, options.min, options.max);
  const at = s >= 1 - snap / 2 ? 1 : snapFraction(s, snap);
  const wrapping = at === 0 || at === 1;
  const kept = bands.filter((band) => {
    if (wrapping) return band.s !== 0 && band.s !== 1;
    return Math.abs(band.s - at) >= snap / 2;
  });
  const painted = wrapping
    ? [
        { s: 0, value: held },
        { s: 1, value: held },
      ]
    : [{ s: at, value: held }];
  const out = [...kept, ...painted].sort((a, b) => a.s - b.s);
  // A table that lost an end to the filter above still has to span the lap.
  if (out.length === 0 || out[0].s !== 0) out.unshift({ s: 0, value: held });
  if (out[out.length - 1].s !== 1) out.push({ s: 1, value: out[0].value });
  return out;
}

export const toWidthBands = (bands: readonly CircuitBand[]): { s: number; halfWidth: number }[] =>
  bands.map((band) => ({ s: band.s, halfWidth: band.value }));

export const fromWidthBands = (bands: readonly { s: number; halfWidth: number }[]): CircuitBand[] =>
  bands.map((band) => ({ s: band.s, value: band.halfWidth }));

export const toApronBands = (bands: readonly CircuitBand[]): { s: number; maxApron: number }[] =>
  bands.map((band) => ({ s: band.s, maxApron: band.value }));

export const fromApronBands = (bands: readonly { s: number; maxApron: number }[]): CircuitBand[] =>
  bands.map((band) => ({ s: band.s, value: band.maxApron }));
