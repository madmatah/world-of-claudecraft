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

/** Reads a band table the way the spline reads it: piecewise linear, wrapping.
 *  A local re-read for editing, not a second home for the rule: the authority
 *  is `bandValueAtFraction` in `realm_racers_spline.ts`, which is what the game
 *  runs. */
function valueAt(bands: readonly CircuitBand[], fraction: number): number {
  if (bands.length === 0) return 0;
  const f = ((fraction % 1) + 1) % 1;
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1];
    const b = bands[i];
    if (f > b.s) continue;
    const span = b.s - a.s;
    const t = span <= 0 ? 0 : (f - a.s) / span;
    return a.value + (b.value - a.value) * t;
  }
  return bands[bands.length - 1].value;
}

/**
 * Paints a value over the stretch of lap a STROKE touched, leaving the rest of
 * the profile alone.
 *
 * A band table is read piecewise LINEARLY, so setting one breakpoint is never a
 * local edit: a single point painted at 30 percent of the lap re-slopes the
 * road all the way round it, and 452 of a 454 yard lap come back changed. What
 * makes an edit local is a plateau with SHOULDERS, which is exactly how the
 * hand-authored profiles are shaped (the garden holds 8.5 across two
 * breakpoints, bracketed by 10.0 before and 9.0 after).
 *
 * So this takes the whole stroke rather than a point: `fractions` is every lap
 * fraction the pointer visited, and `bands` is the table as it stood BEFORE the
 * stroke began. Passing the pre-stroke table is what keeps a drag from denting
 * against its own earlier points; re-applying with a longer list is how a live
 * drag extends. Cells the stroke never reached keep their original breakpoints
 * untouched, so a stroke cannot flatten a profile it did not paint over.
 *
 * Reversals, a stroke crossing the start line, and the gaps a fast pointer
 * leaves between its samples all fall out of working in snapped CELLS rather
 * than in a start and an end.
 */
export function paintSpan(
  bands: readonly CircuitBand[],
  fractions: readonly number[],
  value: number,
  options: PaintBandOptions,
): CircuitBand[] {
  const snap = options.snap ?? FRACTION_SNAP;
  const cells = Math.max(4, Math.round(1 / snap));
  const held = clamp(value, options.min, options.max);
  const wrap = (cell: number): number => ((cell % cells) + cells) % cells;

  const cellOf = (fraction: number): number => wrap(Math.floor((((fraction % 1) + 1) % 1) * cells));
  const visited = fractions.filter((fraction) => Number.isFinite(fraction)).map(cellOf);
  const painted = new Set<number>(visited);
  // A pointer emits samples, not a path: a quick drag across the canvas lands
  // four cells apart and would otherwise paint a comb of separate plateaus with
  // the gaps between them untouched. The cells BETWEEN two consecutive samples
  // were dragged over, so they are painted too, the short way round the lap.
  for (let i = 1; i < visited.length; i++) {
    const from = visited[i - 1];
    const to = visited[i];
    const forward = wrap(to - from);
    const step = forward <= cells - forward ? 1 : -1;
    for (let cell = from; cell !== to; cell = wrap(cell + step)) painted.add(cell);
  }
  if (painted.size === 0) return bands.map((band) => ({ ...band }));

  // One cell of ramp on each side of what was painted. Everything outside this
  // is left exactly as the operator authored it.
  const touched = new Set<number>();
  for (const cell of painted) {
    touched.add(wrap(cell - 1));
    touched.add(cell);
    touched.add(wrap(cell + 1));
  }
  const boundaryTouched = (k: number): boolean => touched.has(wrap(k - 1)) || touched.has(wrap(k));
  const boundaryValue = (k: number): number =>
    painted.has(wrap(k - 1)) || painted.has(wrap(k)) ? held : valueAt(bands, k / cells);

  const out: CircuitBand[] = [];
  for (const band of bands) {
    const cell = Math.min(cells - 1, Math.floor(band.s * cells));
    // A breakpoint sitting exactly on a boundary the stroke rewrites is
    // replaced by it, never kept beside it.
    const onEdge = Math.abs(band.s * cells - Math.round(band.s * cells)) < 1e-9;
    const boundary = Math.round(band.s * cells);
    if (onEdge ? boundaryTouched(boundary) : touched.has(cell)) continue;
    out.push({ ...band });
  }
  for (let k = 0; k <= cells; k++) {
    if (!boundaryTouched(k)) continue;
    out.push({ s: Number((k / cells).toFixed(6)), value: round2(boundaryValue(k)) });
  }
  out.sort((a, b) => a.s - b.s);

  // The table always spans the whole lap, and its two ends are the same yard of
  // road, so they carry the same value.
  if (out.length === 0 || out[0].s !== 0) out.unshift({ s: 0, value: round2(boundaryValue(0)) });
  if (out[out.length - 1].s !== 1) out.push({ s: 1, value: out[0].value });
  else out[out.length - 1] = { s: 1, value: out[0].value };
  return dropRedundant(out);
}

/** Drops a breakpoint the straight line between its neighbours already
 *  explains, so a stroke does not leave a hundred collinear rows behind. */
function dropRedundant(bands: readonly CircuitBand[]): CircuitBand[] {
  const out: CircuitBand[] = [];
  for (let i = 0; i < bands.length; i++) {
    const previous = out[out.length - 1];
    const next = bands[i + 1];
    if (previous && next) {
      const span = next.s - previous.s;
      const t = span <= 0 ? 0 : (bands[i].s - previous.s) / span;
      const straight = previous.value + (next.value - previous.value) * t;
      if (Math.abs(bands[i].value - straight) < 1e-6) continue;
    }
    out.push({ ...bands[i] });
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const toWidthBands = (bands: readonly CircuitBand[]): { s: number; halfWidth: number }[] =>
  bands.map((band) => ({ s: band.s, halfWidth: band.value }));

export const fromWidthBands = (bands: readonly { s: number; halfWidth: number }[]): CircuitBand[] =>
  bands.map((band) => ({ s: band.s, value: band.halfWidth }));

export const toApronBands = (bands: readonly CircuitBand[]): { s: number; maxApron: number }[] =>
  bands.map((band) => ({ s: band.s, maxApron: band.value }));

export const fromApronBands = (bands: readonly { s: number; maxApron: number }[]): CircuitBand[] =>
  bands.map((band) => ({ s: band.s, value: band.maxApron }));
