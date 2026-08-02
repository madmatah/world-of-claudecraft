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
// Pure leaf: the geometry is static content, so one module-level build per
// CIRCUIT serves every Sim in the process (the yumiMazeColliders /
// ARENA_COLLIDERS pattern). Coordinates are LANE-LOCAL, so colliders.ts offsets
// by the lane origin the way it does for the other instanced bands.
import type { Collider } from './colliders';
import type { RealmRacersCircuit } from './content/realm_racers_circuits';
import { DUNGEON_FLOOR_Y } from './data';

const cached = new Map<string, Collider[]>();

/**
 * One circuit's instance-local collision set: four slabs closing its garden
 * wall, each reaching a half thickness past the corner so the rectangle has no
 * gap to squeeze through. Every collider carries its visual top as `cameraTopY`
 * so the chase camera rides over the wall instead of being pulled inside it, and
 * none is `standable`: a racer cannot mantle out of the garden.
 */
export function realmRacersColliders(circuit: RealmRacersCircuit): Collider[] {
  const hit = cached.get(circuit.id);
  if (hit) return hit;
  const { halfX: px, halfZ: pz, halfThickness: t, height } = circuit.perimeter;
  const top = DUNGEON_FLOOR_Y + height;
  const built: Collider[] = [
    { type: 'obb', x: 0, z: -pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: 0, z: pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: -px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
    { type: 'obb', x: px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
  ];
  cached.set(circuit.id, built);
  return built;
}
