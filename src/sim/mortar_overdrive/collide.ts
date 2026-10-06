import type { Collider } from '../colliders';
import { mortarOverdriveColliders } from './colliders';
import {
  MORTAR_OVERDRIVE_ORIGIN,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOffset,
} from './layout';

/** The band test colliders.ts routes its support, slope-glue and interior arms on. */
export { isAtMortarOverdriveXZ } from './layout';

type ResolveAgainst = (
  list: Collider[],
  x: number,
  z: number,
  r: number,
) => { x: number; z: number };

type OverlapsAny = (
  list: Collider[],
  x: number,
  z: number,
  r: number,
  sightY: number,
  skipLow: boolean,
) => boolean;

/**
 * The Mortar Overdrive arm of colliders.ts resolvePosition: null off the band, so
 * the coordinator falls through to its other instanced regions. The solver is
 * the coordinator's own, passed in, so the arithmetic is the same expression.
 */
export function resolveMortarOverdrivePosition(
  x: number,
  z: number,
  r: number,
  resolveAgainst: ResolveAgainst,
): { x: number; z: number } | null {
  const mortarOverdriveLane = mortarOverdriveLaneAt(x, z);
  if (mortarOverdriveLane === null) return null;
  // Every lane holds ONE circuit's geometry at its own origin, so the whole
  // story is: shift into that circuit's CANONICAL frame (which is the one its
  // spline and collider set are authored in), solve there, shift back. Lane
  // 0's offset is zero, so its path is unchanged.
  const off = mortarOverdriveLaneOffset(mortarOverdriveLane.index);
  const o = MORTAR_OVERDRIVE_ORIGIN;
  // The garden wall is the ONLY thing on a circuit that stops anyone. The
  // infield used to be clamped too (a containment line derived from the
  // racing line, wearing water or a hedge), and that whole family is retired:
  // leaving the road is refereed by a rule now
  // (`mortar_overdrive/track_limits.ts`), so the garden is open and drivable all
  // the way to the perimeter on both sides.
  const local = resolveAgainst(
    mortarOverdriveColliders(mortarOverdriveLane.circuit),
    x - off.x - o.x,
    z - off.z - o.z,
    r,
  );
  return { x: local.x + off.x + o.x, z: local.z + off.z + o.z };
}

/**
 * The Mortar Overdrive arm of colliders.ts sightBlockedAt: null off the band.
 */
export function mortarOverdriveSightBlocked(
  x: number,
  z: number,
  r: number,
  sightY: number,
  overlapsAny: OverlapsAny,
): boolean | null {
  const mortarOverdriveOverlapLane = mortarOverdriveLaneAt(x, z);
  if (mortarOverdriveOverlapLane === null) return null;
  const off = mortarOverdriveLaneOffset(mortarOverdriveOverlapLane.index);
  const o = MORTAR_OVERDRIVE_ORIGIN;
  return overlapsAny(
    mortarOverdriveColliders(mortarOverdriveOverlapLane.circuit),
    x - off.x - o.x,
    z - off.z - o.z,
    r,
    sightY,
    false,
  );
}
