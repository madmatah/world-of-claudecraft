// Freehand stroke to control points: what turns one gesture over the canvas
// into the handful of points a circuit record actually holds.
//
// Two passes, in this order. RESAMPLE the raw stroke at a uniform arc length,
// because a pointer emits points at whatever rate the hardware feels like and a
// slow corner would otherwise carry ten times the weight of a fast straight.
// Then SIMPLIFY (Ramer-Douglas-Peucker), which keeps original stroke points and
// drops the ones the line between their neighbours already explains.
//
// The result is read as a CLOSED loop: the last point joins the first, and the
// caller never appends a duplicate to close it.
//
// Pure core: DOM-free, deterministic, no clock, no rng.

import type { MortarOverdrivePoint } from '../../sim/mortar_overdrive';

export interface StrokeFitOptions {
  /** Uniform spacing the raw stroke is resampled at, yards. */
  resampleStep?: number;
  /** How far the simplified polyline may sit off the resampled stroke, yards.
   *  Raised automatically while the fit is over `maxPoints`. */
  tolerance?: number;
  /** A closed loop needs enough points to have a shape; the record's own floor. */
  minPoints?: number;
  /** Above this the handles stop being editable by hand, which is the whole
   *  point of fitting rather than pasting the stroke. */
  maxPoints?: number;
}

const DEFAULTS = {
  resampleStep: 4,
  tolerance: 2.5,
  minPoints: 8,
  maxPoints: 40,
} as const;

/** How far the tolerance grows per attempt while the fit is still too dense. */
const TOLERANCE_GROWTH = 1.6;
/** Attempts before the fit falls back on a plain uniform decimation. */
const TOLERANCE_ATTEMPTS = 12;

function distance(a: MortarOverdrivePoint, b: MortarOverdrivePoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Distance from `p` to the infinite line through `a` and `b`, or to `a` when
 *  the two are the same point. */
export function perpendicularDistance(
  p: MortarOverdrivePoint,
  a: MortarOverdrivePoint,
  b: MortarOverdrivePoint,
): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-9) return distance(p, a);
  return Math.abs((p.x - a.x) * dz - (p.z - a.z) * dx) / length;
}

/** Ramer-Douglas-Peucker over an OPEN polyline: both ends are kept. */
function simplifyOpen(
  points: readonly MortarOverdrivePoint[],
  tolerance: number,
): MortarOverdrivePoint[] {
  if (points.length <= 2) return [...points];
  let worst = 0;
  let worstIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const offset = perpendicularDistance(points[i], first, last);
    if (offset > worst) {
      worst = offset;
      worstIndex = i;
    }
  }
  if (worst <= tolerance) return [first, last];
  const head = simplifyOpen(points.slice(0, worstIndex + 1), tolerance);
  const tail = simplifyOpen(points.slice(worstIndex), tolerance);
  return [...head.slice(0, -1), ...tail];
}

/**
 * Uniform arc-length resample of a CLOSED polyline. The returned ring never
 * repeats its first point at the end: a closed centripetal Catmull-Rom wraps on
 * its own, and a duplicate point would give it a zero-length span to read a
 * tangent from.
 */
export function resampleClosed(
  points: readonly MortarOverdrivePoint[],
  step: number,
): MortarOverdrivePoint[] {
  const ring = dedupe(points);
  if (ring.length < 3 || step <= 0) return ring;
  const spans: number[] = [];
  let total = 0;
  for (let i = 0; i < ring.length; i++) {
    const length = distance(ring[i], ring[(i + 1) % ring.length]);
    spans.push(length);
    total += length;
  }
  if (total < step) return ring;
  const count = Math.max(3, Math.round(total / step));
  const spacing = total / count;
  const out: MortarOverdrivePoint[] = [];
  let cursor = 0;
  let walked = 0;
  for (let i = 0; i < count; i++) {
    const target = i * spacing;
    while (cursor < spans.length - 1 && walked + spans[cursor] < target) {
      walked += spans[cursor];
      cursor++;
    }
    const a = ring[cursor];
    const b = ring[(cursor + 1) % ring.length];
    const t = spans[cursor] <= 0 ? 0 : (target - walked) / spans[cursor];
    out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

/** Drops points a pointer emitted twice in the same place, and a trailing point
 *  that only closes the ring the caller is about to close anyway. */
function dedupe(points: readonly MortarOverdrivePoint[]): MortarOverdrivePoint[] {
  const out: MortarOverdrivePoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) continue;
    const last = out[out.length - 1];
    if (last && distance(last, point) < 1e-6) continue;
    out.push({ x: point.x, z: point.z });
  }
  while (out.length > 2 && distance(out[0], out[out.length - 1]) < 1e-6) out.pop();
  return out;
}

/** Keeps every `stride`th point, which is what a stroke with no corners at all
 *  (a circle) leaves behind once RDP has nothing to drop. */
function decimate(points: readonly MortarOverdrivePoint[], target: number): MortarOverdrivePoint[] {
  if (points.length <= target) return [...points];
  const out: MortarOverdrivePoint[] = [];
  for (let i = 0; i < target; i++) out.push(points[Math.floor((i * points.length) / target)]);
  return out;
}

/**
 * The whole fit: a freehand stroke in circuit-local yards to the control points
 * of a closed loop. Deterministic, so the same gesture always fits the same way
 * and an operator can undo, redo and compare.
 */
export function fitStrokeToControlPoints(
  stroke: readonly MortarOverdrivePoint[],
  options: StrokeFitOptions = {},
): MortarOverdrivePoint[] {
  const resampleStep = options.resampleStep ?? DEFAULTS.resampleStep;
  const minPoints = options.minPoints ?? DEFAULTS.minPoints;
  const maxPoints = options.maxPoints ?? DEFAULTS.maxPoints;
  const resampled = resampleClosed(stroke, resampleStep);
  if (resampled.length < minPoints) return decimate(resampled, resampled.length);

  // RDP wants two fixed ends, and a ring has none. Anchoring on the stroke's
  // start and on the point furthest from it splits the loop into two open
  // halves, which is the standard closed-curve treatment and keeps the two most
  // characteristic points of the shape whatever the tolerance does.
  let far = 0;
  for (let i = 1; i < resampled.length; i++) {
    if (distance(resampled[0], resampled[i]) > distance(resampled[0], resampled[far])) far = i;
  }
  const head = resampled.slice(0, far + 1);
  const tail = [...resampled.slice(far), resampled[0]];

  let tolerance = options.tolerance ?? DEFAULTS.tolerance;
  let fitted: MortarOverdrivePoint[] = [];
  for (let attempt = 0; attempt < TOLERANCE_ATTEMPTS; attempt++) {
    const a = simplifyOpen(head, tolerance);
    const b = simplifyOpen(tail, tolerance);
    fitted = [...a.slice(0, -1), ...b.slice(0, -1)];
    if (fitted.length <= maxPoints) break;
    tolerance *= TOLERANCE_GROWTH;
  }
  if (fitted.length > maxPoints) fitted = decimate(fitted, maxPoints);
  if (fitted.length < minPoints) fitted = decimate(resampled, minPoints);
  return fitted;
}
