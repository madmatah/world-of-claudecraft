// The TERRAIN tool's gestures on the LAND: what a click on the ground shape
// landed on, and what removing one of its handles does to the ring.
//
// It is the ground's half of what `fences_core.ts` is for the barriers, and it
// exists for the same reason: the decisions a gesture makes have to be somewhere
// a Vitest can reach, or the only thing holding them is the page.
//
// The RING itself is not re-implemented here. A ground outline is a closed ring
// of control points read as a smoothed curve, which is exactly what the
// centerline is, so hit testing a handle, finding the nearest segment and
// inserting all come from `handles_core.ts`. What this module owns is the ORDER
// those are asked in, what each answer means, and the one number the two rings
// do NOT share: how few handles a shape may be left with.
//
// Pure core: DOM-free, deterministic, no clock, no rng. Every function returns a
// NEW list; nothing here mutates its input.

import { REALM_RACERS_MIN_GROUND_POINTS } from '../../sim/realm_racers_ground';
import type { RallyPoint } from '../../sim/realm_racers_layout';
import { hitTestControlPoint, nearestSegment } from './handles_core';

/**
 * What a click on the ground shape means.
 *
 * `handle` is a grab, `insert` is a click on the CURVE between two handles,
 * which adds one there and hands it straight to the same drag. Null is a miss,
 * and the caller goes on to whatever else a click can mean.
 */
export type GroundHit =
  | { kind: 'handle'; index: number }
  | { kind: 'insert'; index: number; at: RallyPoint };

/**
 * Which of the two, or neither.
 *
 * A HANDLE beats the curve, always, and the two tolerances are separate numbers
 * because they are two different gestures: grabbing a dot drawn a few pixels
 * across, and hitting the line between two of them. Testing the curve first
 * would make a handle ungrabbable at any zoom where the tolerances overlap,
 * which is every working zoom.
 */
export function groundHitAt(
  outline: readonly RallyPoint[],
  x: number,
  z: number,
  handleTolerance: number,
  segmentTolerance: number,
): GroundHit | null {
  if (outline.length === 0) return null;
  const handle = hitTestControlPoint(outline, x, z, handleTolerance);
  if (handle >= 0) return { kind: 'handle', index: handle };
  const segment = nearestSegment(outline, x, z);
  if (segment.distance > segmentTolerance) return null;
  return { kind: 'insert', index: segment.index, at: segment.point };
}

/**
 * The ring with one handle gone, or null when it refuses.
 *
 * It refuses at the same floor the centerline keeps, and the floor is the whole
 * of the decision: a closed loop with fewer handles than that is not a shape the
 * curve can be read from. The way to be rid of a ground shape is to discard the
 * whole thing from the mode's action bar, which is why whittling it down to
 * nothing is not an alternative route to the same place.
 */
export function groundPointRemoved(
  outline: readonly RallyPoint[],
  index: number,
): readonly RallyPoint[] | null {
  if (index < 0 || index >= outline.length) return null;
  if (outline.length <= MIN_GROUND_POINTS) return null;
  return outline.filter((_, i) => i !== index);
}

/**
 * The floor, which is the SIM's rather than the control ring's.
 *
 * The centerline keeps a floor of eight because a road has to be a road; a
 * ground shape is a triangle at worst, and the resolver and the save endpoint
 * both accept three. Borrowing the road's number here made a nine-handle
 * proposal deletable exactly once and refused a shape the record allows.
 */
export const MIN_GROUND_POINTS = REALM_RACERS_MIN_GROUND_POINTS;
