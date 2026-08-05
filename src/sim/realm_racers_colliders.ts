// The Realm Racers's static collision. There is exactly one DERIVED wall, the
// perimeter box, and everything inside it is drivable:
//
//   ..garden.. [ pond ] ..garden.. |road| ..verge.. ..garden.. ##PERIMETER##
//
// That box is INVISIBLE. Nothing draws it any more: it was the last derived
// thing standing on a circuit, so it wore one kit for its whole rectangular
// length and made every circuit read as a box. It stayed as collision because a
// band still needs an outer stop, and what a circuit's edge LOOKS like is
// authored on top of it now, as barriers (`realm_racers_fences.ts`).
//
// Verge and garden cost time rather than stopping you (see the slow bands in
// social/realm_racers.ts); a pond costs nothing at all, being decoration a
// machine drives through. The circuit has now had four shapes:
// no collision at all (racers drove through every hedge), a wall hugging both
// road edges (no room to make a mistake in), a stone rim around the basin
// (which read as a line of blocks standing in the lake), and a containment line
// derived from the racing line wearing water or a hedge. All four were the same
// idea, and the operator's verdict on the last one retired the whole family:
// track limits are a RULE now (`realm_racers_track_limits.ts`), so the garden
// is open on both sides and nothing DERIVED inside the perimeter stops anyone.
//
// What can stop someone in there is a piece of scenery a designer placed by
// hand and marked solid: a statue at the end of a straight, a run of ironwork
// along a corner. That is furniture, not containment. It carries no track-limits
// duty of any kind (a gap in it is a view, never a shortcut), the readout warns
// on every one of them so it is always a deliberate call, and the racing surface
// itself stays inviolate by a metrics ERROR.
//
// Pure leaf: the geometry is static content, so one module-level build per
// CIRCUIT serves every Sim in the process (the yumiMazeColliders /
// ARENA_COLLIDERS pattern). Coordinates are LANE-LOCAL, so colliders.ts offsets
// by the lane origin the way it does for the other instanced bands.
import type { Collider } from './colliders';
import type { RealmRacersCircuit } from './content/realm_racers_circuits';
import { DUNGEON_FLOOR_Y } from './data';
import { realmRacersFenceRuns } from './realm_racers_fences';
import { realmRacersPlacedProps } from './realm_racers_props_resolve';

/**
 * Keyed by circuit id AND held only while the RECORD behind that id is the same
 * object, the discipline `memoizePerCircuit` in `realm_racers_spline.ts` already
 * runs on. The shipped records are module singletons, so every game and test
 * caller hits the cache exactly as before.
 *
 * The identity half is what makes a redrawn draft safe. A dev session
 * re-registers a circuit under the same id with a new record
 * (`realm_racers_drafts.ts`); the spline and the rendered view both rebuild off
 * record identity, and an id-only cache here would keep serving the PREVIOUS
 * perimeter: an invisible wall standing where the new one is wider, and a
 * drive-through gap where it is narrower.
 */
const cached = new Map<string, { circuit: RealmRacersCircuit; value: Collider[] }>();

/**
 * One circuit's instance-local collision set: four slabs closing its garden
 * wall, each reaching a half thickness past the corner so the rectangle has no
 * gap to squeeze through, plus whatever the circuit AUTHORED, which is its
 * barrier runs and its solid dressing. Every collider carries its visual top as
 * `cameraTopY` so the chase camera rides over it instead of being pulled inside
 * it, and none is `standable`: a racer cannot mantle out of the garden, over a
 * hedge, or onto a statue.
 *
 * The perimeter slabs are the only DERIVED colliders left, and they are the only
 * ones a player cannot see: since the barriers arrived, nothing draws that box.
 * It is a backstop against wandering off the band, not a boundary anyone is
 * meant to meet, and what a circuit's edge LOOKS like is authored beside it.
 *
 * The rest comes out of `realm_racers_fences.ts` and
 * `realm_racers_props_resolve.ts` and is never derived here, so what the
 * renderer draws and what a machine hits are one set of positions. Nothing
 * seeded by a SCATTER is ever solid, so this set stays as short as the authored
 * lists.
 */
export function realmRacersColliders(circuit: RealmRacersCircuit): Collider[] {
  const hit = cached.get(circuit.id);
  if (hit && hit.circuit === circuit) return hit.value;
  const { halfX: px, halfZ: pz, halfThickness: t, height } = circuit.perimeter;
  const top = DUNGEON_FLOOR_Y + height;
  const built: Collider[] = [
    { type: 'obb', x: 0, z: -pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: 0, z: pz, hw: px + t, hd: t, rot: 0, cameraTopY: top },
    { type: 'obb', x: -px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
    { type: 'obb', x: px, z: 0, hw: t, hd: pz + t, rot: 0, cameraTopY: top },
  ];
  // The authored barriers: ONE box per straight run, never one per module. A run
  // is straight, so a single OBB covers it exactly, and its `hw` already reaches
  // past any joint (see `realm_racers_fences.ts`), so a corner has no wedge to
  // squeeze through. Solid always: a fence exists to be in the way.
  for (const { run, height } of realmRacersFenceRuns(circuit)) {
    built.push({
      type: 'obb',
      x: run.x,
      z: run.z,
      hw: run.hw,
      hd: run.hd,
      rot: run.rot,
      cameraTopY: DUNGEON_FLOOR_Y + height,
    });
  }
  for (const prop of realmRacersPlacedProps(circuit)) {
    if (!prop.solid) continue;
    const propTop = DUNGEON_FLOOR_Y + prop.height;
    built.push(
      prop.footprint.kind === 'circle'
        ? { type: 'circle', x: prop.x, z: prop.z, r: prop.footprint.r, cameraTopY: propTop }
        : {
            type: 'obb',
            x: prop.x,
            z: prop.z,
            hw: prop.footprint.hw,
            hd: prop.footprint.hd,
            rot: prop.footprint.rot,
            cameraTopY: propTop,
          },
    );
  }
  cached.set(circuit.id, { circuit, value: built });
  return built;
}
