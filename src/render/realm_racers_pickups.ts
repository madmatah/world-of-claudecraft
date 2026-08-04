// The pickup boxes, drawn: one small floating crate per box, spinning where the
// circuit's authored rows put it.
//
// It is a sibling of the track builder rather than a section inside it, and it
// is composed BY that builder rather than by the renderer, for one reason: a
// box only ever exists on a lane of its own circuit, and the track view already
// resolves which lane the viewer stands on, moves itself onto it and hides
// itself off it. Hanging the boxes under that group gets all three for free and
// keeps `renderer.ts` untouched.
//
// Positions come from the sim's resolver (`src/sim/realm_racers_pickups.ts`),
// never from arithmetic of this module's own: what is drawn has to be what a
// machine can drive into. Which boxes are STANDING comes off the match readout
// (`RealmRacersMatchInfo.pickupsTaken`), so offline Sim and online ClientWorld
// drive the same animation through the same field.
//
// Every decision (the phase machine, the scale, the spin, the bob) is in the
// Three-free core beside this file; this owns the meshes and the per-frame
// writes. Four things about how it does that, so none of them reads as an
// oversight later:
//
//  - WRITE ELISION covers `visible` and `scale` only. The spin and the bob are
//    functions of the clock, so they change every frame by definition and
//    guarding them would cost a comparison to save nothing; what elision is for
//    here is the resting state, where a dozen boxes would otherwise re-stamp an
//    identical scale forever.
//  - The geometry is minted PER BUILD and shared across that build's boxes, so
//    `disposeRealmRacersTrackGroup` disposes the same `BufferGeometry` once per
//    box. That is expected: `dispose()` only dispatches an event, and the
//    alternative (one geometry per box) would multiply what a draft rebuild
//    leaks by however many boxes a circuit carries.
//  - With NO match on this circuit (a spectator, or anyone standing on the band
//    between races) every box is drawn STANDING. The boxes belong to a race, so
//    with no race there is nothing taken; a circuit that looked half looted to a
//    passer-by would be showing them somebody else's state.
//  - The drawn cube is 1.2 yards across and the catch radius is 2.3, so a box is
//    collected from a little outside what it looks like. That is deliberate (a
//    box has to be takeable by driving at it, not by threading it) and it is a
//    seat-tuning knob: `REALM_RACERS_PICKUP_REACH` and `_BOX_HALF` are the two
//    numbers, and closing the gap means growing the cube, never shrinking the
//    reach into something a machine at race speed can miss by a hand's width.

import * as THREE from 'three';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import { REALM_RACERS_PICKUP_BOX_HALF, realmRacersPickupBoxes } from '../sim/realm_racers_pickups';
import type { RealmRacersMatchInfo } from '../world_api/realm_racers';
import { surfaceMat } from './gfx';
import {
  type RallyPickupVisual,
  REALM_RACERS_PICKUP_COLOR,
  rallyPickupInitialVisual,
  rallyPickupLift,
  rallyPickupScale,
  rallyPickupSpin,
  rallyPickupTakenSame,
  rallyPickupVisible,
  stepRallyPickupVisual,
} from './realm_racers_pickups_core';

/** How high the box's centre floats over the road, yards, before the bob. */
const REST_HEIGHT = 1.05;
/** Scale differences under this are not worth a matrix write. */
const SCALE_EPSILON = 0.002;
/** The longest frame the animation will honour, seconds: a tab that was in the
 *  background for a minute must not fast-forward a pop into nothing. */
const MAX_FRAME_SECONDS = 0.1;

export interface RealmRacersPickupsView {
  group: THREE.Group;
  /** `time` is the renderer's own clock, seconds. `match` is the viewer's live
   *  race on THIS circuit, or null when they are not racing (every box then
   *  stands, which is what a circuit with nobody on it looks like). */
  update(time: number, match: RealmRacersMatchInfo | null): void;
}

const NO_TAKEN: readonly number[] = [];

/**
 * The boxes of one circuit.
 *
 * The geometry is minted per build and shared across this circuit's own boxes,
 * which is what `realm_racers_track_dispose_core.ts` expects of a plain mesh:
 * disposing a rebuilt draft's group frees this geometry and touches no authored
 * circuit's. The material comes from `surfaceMat`, which dedupes and is
 * deliberately never disposed.
 */
export function buildRealmRacersPickups(circuit: RealmRacersCircuit): RealmRacersPickupsView {
  const group = new THREE.Group();
  // Named so a headless suite can find this sub-tree the way it finds the start
  // lights, rather than by counting children of the track group.
  group.name = 'realm-racers-pickups';
  const boxes = realmRacersPickupBoxes(circuit);
  const size = REALM_RACERS_PICKUP_BOX_HALF * 2;
  const meshes: THREE.Mesh[] = [];
  const visuals: RallyPickupVisual[] = [];
  const drawnScale: number[] = [];
  if (boxes.length > 0) {
    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = surfaceMat({
      color: REALM_RACERS_PICKUP_COLOR,
      emissive: 0x6a4a08,
      emissiveIntensity: 0.7,
      roughness: 0.4,
      metalness: 0.1,
      flatShading: true,
    });
    for (const box of boxes) {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(box.x, REST_HEIGHT, box.z);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
      meshes.push(mesh);
      visuals.push(rallyPickupInitialVisual(false));
      drawnScale.push(1);
    }
  }

  let lastTime = 0;
  let started = false;
  let lastTaken: readonly number[] = NO_TAKEN;
  const taken = new Set<number>();

  return {
    group,
    update(time, match) {
      if (meshes.length === 0) return;
      const dt = started ? Math.min(MAX_FRAME_SECONDS, Math.max(0, time - lastTime)) : 0;
      lastTime = time;
      started = true;
      // The membership set is rebuilt only when the readout's own list changed,
      // which is a handful of times a lap rather than every frame.
      const list = match?.pickupsTaken ?? NO_TAKEN;
      if (!rallyPickupTakenSame(list, lastTaken)) {
        lastTaken = list.slice();
        taken.clear();
        for (const index of list) taken.add(index);
      }
      for (let i = 0; i < meshes.length; i++) {
        const mesh = meshes[i];
        const visual = stepRallyPickupVisual(visuals[i], taken.has(i), dt);
        visuals[i] = visual;
        const visible = rallyPickupVisible(visual);
        if (mesh.visible !== visible) mesh.visible = visible;
        if (!visible) continue;
        const scale = rallyPickupScale(visual);
        if (Math.abs(scale - drawnScale[i]) > SCALE_EPSILON) {
          drawnScale[i] = scale;
          mesh.scale.setScalar(scale);
        }
        mesh.rotation.y = rallyPickupSpin(time, i);
        mesh.position.y = REST_HEIGHT + rallyPickupLift(time, i);
      }
    },
  };
}
