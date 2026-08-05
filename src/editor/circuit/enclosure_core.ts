// The TERRAIN tool's gestures on the WALL: which grip a click landed on, and
// what dragging one does to the perimeter.
//
// It is the third of the mode's three objects (the land, the barriers, the wall)
// and the only one that was numbers-only until packet 28: the wall could be
// sized by typing in a form or by pressing `Fit wall`, and by nothing else, on a
// canvas where a pond has had draggable handles since the water was placeable.
//
// The one fact that shapes everything here: **a wall is authored as half-extents
// around the origin, and the record carries no position for it.** So there are
// two consequences a tool must not pretend away.
//
// - A resize is SYMMETRIC. Dragging the east edge moves the west one too,
//   because the record holds one number for both. The plan draws the whole box
//   through the drag, so the mirror is seen rather than explained.
// - The wall cannot be MOVED. What an operator means by moving it is changing
//   where the circuit sits inside it, so the centre grip slides the circuit's own
//   contents the other way, which is `Center circuit` done by hand.
//
// Pure core: DOM-free, deterministic, no clock, no rng. Nothing here mutates its
// input, and nothing here decides whether the result is a GOOD wall: the readout
// owns that (`road_outside_perimeter`), as it does for every other placement in
// this tool.

import type { RealmRacersPerimeter } from '../../sim/content/realm_racers_circuits';
import { MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z } from './envelope_core';

/**
 * The eight box grips, by compass point, plus the centre.
 *
 * Corners and edge midpoints both, because they answer different intentions: a
 * corner is "make the whole thing bigger" and an edge is "make it deeper without
 * making it wider", and offering only corners would force an operator to
 * re-drag the axis they did not mean to change.
 */
export type EnclosureGripId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface EnclosureGrip {
  id: EnclosureGripId;
  /** Where it is drawn, circuit-local yards. */
  x: number;
  z: number;
  /** Which half-extents a drag writes. A corner writes both; an edge midpoint
   *  writes only the one its edge is about. */
  axis: 'x' | 'z' | 'both';
}

/** Which way each grip sits on the box, and what it writes. The signs are what
 *  place it; the ABSOLUTE value is what a drag reads, since the box is
 *  symmetric. */
const GRIP_LAYOUT: readonly {
  id: EnclosureGripId;
  sx: number;
  sz: number;
  axis: EnclosureGrip['axis'];
}[] = [
  { id: 'nw', sx: -1, sz: -1, axis: 'both' },
  { id: 'n', sx: 0, sz: -1, axis: 'z' },
  { id: 'ne', sx: 1, sz: -1, axis: 'both' },
  { id: 'e', sx: 1, sz: 0, axis: 'x' },
  { id: 'se', sx: 1, sz: 1, axis: 'both' },
  { id: 's', sx: 0, sz: 1, axis: 'z' },
  { id: 'sw', sx: -1, sz: 1, axis: 'both' },
  { id: 'w', sx: -1, sz: 0, axis: 'x' },
];

export function enclosureGrips(halfX: number, halfZ: number): EnclosureGrip[] {
  return GRIP_LAYOUT.map((grip) => ({
    id: grip.id,
    x: grip.sx * halfX,
    z: grip.sz * halfZ,
    axis: grip.axis,
  }));
}

/**
 * What a click on the wall meant.
 *
 * `move` is the centre grip, and it is a different verb from the other eight: it
 * does not touch the wall at all, it slides everything the circuit is made of.
 */
export type EnclosureHit = { kind: 'grip'; grip: EnclosureGrip } | { kind: 'move' };

/**
 * Which grip is under the pointer, or none.
 *
 * NEAREST first rather than first-declared, the rule the prop grips already
 * keep: at a zoom where a whole circuit is on screen the click tolerance in
 * yards is large, and on a shallow wall the north edge grip and the two corners
 * beside it are all within it at once. Declaration order would make one of the
 * three unreachable, and which one would depend on where the operator clicked.
 */
export function enclosureHitAt(
  halfX: number,
  halfZ: number,
  x: number,
  z: number,
  tolerance: number,
): EnclosureHit | null {
  let best: EnclosureGrip | null = null;
  let bestDistance = tolerance;
  for (const grip of enclosureGrips(halfX, halfZ)) {
    const distance = Math.hypot(grip.x - x, grip.z - z);
    if (distance <= bestDistance) {
      best = grip;
      bestDistance = distance;
    }
  }
  if (best) return { kind: 'grip', grip: best };
  // The centre is tested LAST, so a wall shallow enough for the origin and an
  // edge grip to be in reach together resizes rather than picking the circuit
  // up: a resize is what the eight visible dots on the box promise, and a move
  // that happened when a resize was meant would take the whole circuit with it.
  if (Math.hypot(x, z) <= tolerance) return { kind: 'move' };
  return null;
}

/**
 * How thin a wall may be dragged, yards.
 *
 * A floor rather than the road's own half-extent, and the difference is which
 * question this module answers. Whether a wall CONTAINS its road is a design
 * verdict, and the readout gives it (`road_outside_perimeter`) exactly as it
 * does for a bench standing on the racing surface; refusing the drag would be
 * the tool overruling the panel. What is not a design verdict is a box with no
 * inside: at zero the perimeter builder raises four slabs on top of each other
 * and the plan draws a dot.
 */
export const MIN_PERIMETER_HALF = 6;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * The wall this drag leaves behind.
 *
 * `Math.abs`, and that is the symmetry made honest rather than a defence: the
 * record holds ONE number per axis, so dragging the east grip through the origin
 * and out the far side goes on growing the box rather than inverting it. There
 * is no other reading of a half-extent.
 *
 * Whole yards, like every wall a fit ever wrote. A perimeter carrying fifteen
 * decimals is not a number anybody authored, and the two ways of sizing this box
 * would disagree in the export.
 */
export function enclosureResized(
  perimeter: RealmRacersPerimeter,
  grip: EnclosureGrip,
  x: number,
  z: number,
): RealmRacersPerimeter {
  return {
    ...perimeter,
    halfX:
      grip.axis === 'z'
        ? perimeter.halfX
        : Math.round(clamp(Math.abs(x), MIN_PERIMETER_HALF, MAX_PERIMETER_HALF_X)),
    halfZ:
      grip.axis === 'x'
        ? perimeter.halfZ
        : Math.round(clamp(Math.abs(z), MIN_PERIMETER_HALF, MAX_PERIMETER_HALF_Z)),
  };
}
