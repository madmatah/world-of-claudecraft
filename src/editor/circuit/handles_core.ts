// The editing rules for everything a circuit record holds as an ORDERED list:
// the control-point ring and the road-width band table.
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

/**
 * How far a dropped breakpoint may move the profile, yards. Five centimetres of
 * road half-width, which is well under a percent of the narrowest road the
 * record may carry and invisible at any zoom: it buys a transition described in
 * ten rows instead of twenty-six, at no shape anyone can see.
 */
const THINNING_TOLERANCE = 0.05;

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
  /**
   * How much lap the transition into and out of the painted stretch runs over,
   * as a fraction of the lap. The caller owns it because the length that reads
   * well is a length in YARDS, and only the caller knows how long the lap is.
   * Defaults to one snap cell, which is a step rather than a transition.
   */
  ramp?: number;
}

/** Smooth Hermite step: flat at both ends, so a transition has no kink where it
 *  meets the road either side of it. */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
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
  // How far each boundary sits from the painted stretch, in cells, measured the
  // short way round the lap. The ramp is a distance, so the transition runs the
  // same length whichever side of the stroke it is on and however the stroke
  // wandered.
  const distance = new Array<number>(cells).fill(Number.POSITIVE_INFINITY);
  for (let k = 0; k < cells; k++) {
    if (painted.has(wrap(k - 1)) || painted.has(k)) distance[k] = 0;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 0; k < cells; k++) {
      distance[k] = Math.min(distance[k], distance[wrap(k - 1)] + 1);
    }
    for (let k = cells - 1; k >= 0; k--) {
      distance[k] = Math.min(distance[k], distance[wrap(k + 1)] + 1);
    }
  }

  const rampCells = Math.max(1, Math.round((options.ramp ?? snap) * cells));
  // Out to rampCells + 1, where the blend is exactly zero: the transition has
  // to END on the original value, or the profile leans back toward it over
  // whatever distance separates it from the next authored breakpoint and the
  // stroke stops being local again.
  const boundaryTouched = (k: number): boolean => distance[wrap(k)] <= rampCells + 1;
  const boundaryValue = (k: number): number => {
    const blend = smoothstep(1 - distance[wrap(k)] / (rampCells + 1));
    const original = valueAt(bands, k / cells);
    return original + (held - original) * blend;
  };

  const out: { band: CircuitBand; emitted: boolean }[] = [];
  for (const band of bands) {
    // A breakpoint inside the stroke or its ramps is part of the transition
    // now, so the stroke replaces it rather than fighting it.
    const cell = Math.min(cells - 1, Math.floor(band.s * cells));
    const onEdge = Math.abs(band.s * cells - Math.round(band.s * cells)) < 1e-9;
    if (onEdge ? boundaryTouched(Math.round(band.s * cells)) : distance[cell] <= rampCells + 1) {
      continue;
    }
    out.push({ band: { ...band }, emitted: false });
  }
  for (let k = 0; k <= cells; k++) {
    if (!boundaryTouched(k)) continue;
    // The outermost boundary of each ramp is where the transition MEETS the
    // profile it interrupted, so it is never thinned away: dropping it lets the
    // road lean toward the stroke from arbitrarily far off, which is the
    // globality this whole function exists to remove.
    const anchor = distance[wrap(k)] === rampCells + 1;
    out.push({
      band: { s: Number((k / cells).toFixed(6)), value: round2(boundaryValue(k)) },
      emitted: !anchor,
    });
  }
  out.sort((a, b) => a.band.s - b.band.s);

  // The table always spans the whole lap, and its two ends are the same yard of
  // road, so they carry the same value.
  if (out.length === 0 || out[0].band.s !== 0) {
    out.unshift({ band: { s: 0, value: round2(boundaryValue(0)) }, emitted: true });
  }
  const last = out[out.length - 1];
  if (last.band.s !== 1) out.push({ band: { s: 1, value: out[0].band.value }, emitted: true });
  else last.band = { s: 1, value: out[0].band.value };
  return thin(out);
}

/**
 * Drops a breakpoint the straight line between its neighbours already explains
 * to within a fraction of a yard, so a smooth transition costs a handful of
 * rows rather than one per cell.
 *
 * Only ever drops rows this stroke EMITTED. An authored breakpoint the stroke
 * never reached is kept whatever the arithmetic says about it: thinning
 * somebody's profile is not a stroke's business.
 */
function thin(rows: readonly { band: CircuitBand; emitted: boolean }[]): CircuitBand[] {
  const out: { band: CircuitBand; emitted: boolean }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const previous = out[out.length - 1];
    const next = rows[i + 1];
    if (rows[i].emitted && previous && next) {
      const span = next.band.s - previous.band.s;
      const t = span <= 0 ? 0 : (rows[i].band.s - previous.band.s) / span;
      const straight = previous.band.value + (next.band.value - previous.band.value) * t;
      if (Math.abs(rows[i].band.value - straight) < THINNING_TOLERANCE) continue;
    }
    out.push(rows[i]);
  }
  return out.map((row) => row.band);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export const toWidthBands = (bands: readonly CircuitBand[]): { s: number; halfWidth: number }[] =>
  bands.map((band) => ({ s: band.s, halfWidth: band.value }));

export const fromWidthBands = (bands: readonly { s: number; halfWidth: number }[]): CircuitBand[] =>
  bands.map((band) => ({ s: band.s, value: band.halfWidth }));
