// The Realm Racers's static collision. There is exactly ONE wall, the
// garden's own iron perimeter, and everything inside it is drivable:
//
//   [ basin ] ..apron.. |road| ..verge.. ..garden.. ##PERIMETER##
//
// Verge and garden alike cost time rather than stopping you (see the slow bands
// in social/realm_racers.ts), and the basin is open water a racer currently
// drives straight over. The circuit has now had three shapes: no collision at
// all (racers drove through every hedge), a wall hugging both road edges (no
// room to make a mistake in), and a stone rim around the basin, which read as a
// line of blocks standing in the lake. Making the WATER itself the hazard is
// the pass after this one; until then the infield is scenery.
//
// Pure leaf: the geometry is static content, so a single module-level build
// serves every Sim in the process (the yumiMazeColliders / ARENA_COLLIDERS
// pattern). Coordinates are INSTANCE-LOCAL, so colliders.ts offsets by
// REALM_RACERS_ORIGIN the way it does for the other instanced bands.
import type { Collider } from './colliders';
import { DUNGEON_FLOOR_Y } from './data';
import {
  REALM_RACERS_PERIMETER_HALF_THICKNESS,
  REALM_RACERS_PERIMETER_HALF_X,
  REALM_RACERS_PERIMETER_HALF_Z,
  REALM_RACERS_PERIMETER_HEIGHT,
} from './realm_racers_layout';

let cached: Collider[] | null = null;

/**
 * The instance-local collision set: four slabs closing the garden wall, each
 * reaching a half thickness past the corner so the rectangle has no gap to
 * squeeze through. Every collider carries its visual top as `cameraTopY` so the
 * chase camera rides over the wall instead of being pulled inside it, and none
 * is `standable`: a racer cannot mantle out of the garden.
 */
export function realmRacersColliders(): Collider[] {
  if (cached) return cached;
  const px = REALM_RACERS_PERIMETER_HALF_X;
  const pz = REALM_RACERS_PERIMETER_HALF_Z;
  const t = REALM_RACERS_PERIMETER_HALF_THICKNESS;
  const top = DUNGEON_FLOOR_Y + REALM_RACERS_PERIMETER_HEIGHT;
  cached = [
    { type: 'obb', x: 0, z: -pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: 0, z: pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: -px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
    { type: 'obb', x: px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
  ];
  return cached;
}
