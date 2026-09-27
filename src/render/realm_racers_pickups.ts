// The pickup boxes, drawn: one small floating crate per box, spinning where the
// circuit's authored rows put it.
//
// The crate is the WORLD's own supply crate (`supply_crate`, the model the
// q_supplies ground objects wear), built through `buildGroundQuestObject` so it
// arrives with the same material treatment and wearing the same gold sparkle.
// That is the point of reusing it rather than drawing a box: a player has
// already learned what a sparkling crate on the ground means, and a pickup box
// has to read at race speed on the first lap of a circuit they have never seen.
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
//    leaks by however many boxes a circuit carries. The crate's geometry is
//    CLONED off the quest object's for exactly that rule: the template
//    `buildGroundQuestObject` hands back is a shared cache every ground crate in
//    the world clones, and the track disposer frees the geometry of every plain
//    mesh it walks, so a draft rebuild would otherwise take the world's quest
//    crates down with it.
//  - With NO match on this circuit (a spectator, or anyone standing on the band
//    between races) every box is drawn STANDING. The boxes belong to a race, so
//    with no race there is nothing taken; a circuit that looked half looted to a
//    passer-by would be showing them somebody else's state.
//  - The drawn crate is 1.8 yards across and the catch radius is 2.3, so a box
//    is collected from a little outside what it looks like. That is deliberate
//    (a box has to be takeable by driving at it, not by threading it) and it is
//    a seat-tuning knob: `REALM_RACERS_PICKUP_REACH` and `_BOX_HALF` are the two
//    numbers, and closing the gap means growing the crate, never shrinking the
//    reach into something a machine at race speed can miss by a hand's width.
//  - A box is drawn even when the crate model is NOT resolved (a fetch that
//    failed, or a headless suite with no loader at all): it falls back to the
//    solid cube this module drew before the crate, because a box is something a
//    pilot steers at and an invisible one is a fairness bug, not a missing
//    decoration.

import * as THREE from 'three';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import { REALM_RACERS_PICKUP_BOX_HALF, realmRacersPickupBoxes } from '../sim/realm_racers_pickups';
import type { RealmRacersLaneView } from '../world_api/realm_racers';
import { surfaceMat } from './gfx';
import { buildGroundQuestObject } from './quest_objects';
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
import { sparkleSpriteMaterial } from './sparkle_sprite';

/** How high the box's centre floats over the road, yards, before the bob. */
const REST_HEIGHT = 1.05;
/** The world item whose model a box wears: the q_supplies supply crate. */
const PICKUP_CRATE_ITEM_ID = 'supply_crate';
/** How far over the crate's own top the sparkle sits, yards. */
const SPARKLE_LIFT = 0.28;
/** The sparkle's size, matching the one the renderer hangs over a ground quest
 *  object so the two read as the same glint. */
const SPARKLE_SCALE = 0.9;
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
  update(time: number, match: RealmRacersLaneView | null): void;
}

const NO_TAKEN: readonly number[] = [];

/**
 * The one sparkle material every box of every circuit shares.
 *
 * Minted on first use and never disposed, like `surfaceMat`'s own cache: it
 * holds a canvas texture, and the circuit editor rebuilds a whole track per
 * edit, so one per build would mint a canvas per edit for the life of the page.
 */
let sharedSparkleMaterial: THREE.SpriteMaterial | null = null;

function pickupSparkleMaterial(): THREE.SpriteMaterial {
  // Always boosted: the glint is how a box announces itself down the road, so
  // no preset gets a say in how brightly it does it.
  if (!sharedSparkleMaterial) {
    sharedSparkleMaterial = sparkleSpriteMaterial(true);
    sharedSparkleMaterial.name = 'realmRacersPickups:sparkle';
  }
  return sharedSparkleMaterial;
}

/**
 * The crate ONE build's boxes are cut from, sized and centred on the box's own
 * point, or null when the model is not resolved and the caller has to fall back
 * to the cube.
 *
 * The returned group has an identity transform of its own: the fitting lives on
 * the child, so the animation may write the parent's scale, spin and bob
 * without unpicking it.
 */
function buildCrateTemplate(size: number): THREE.Group | null {
  const model = buildGroundQuestObject(PICKUP_CRATE_ITEM_ID, 0).group;
  // One clone per SOURCE geometry, so a crate built of several meshes sharing
  // one buffer still costs one copy. See the header for why a copy at all.
  const owned = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
  model.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    let mine = owned.get(mesh.geometry);
    if (!mine) {
      mine = mesh.geometry.clone();
      owned.set(mesh.geometry, mine);
    }
    mesh.geometry = mine;
    // A floating crate casts nothing and takes nothing: it is a yard over the
    // road and there are a dozen of them on a circuit.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
  if (owned.size === 0) return null;

  // The model arrives normalized to the ground-object height and standing on
  // y = 0. A box is a thing a machine drives THROUGH, so it is refitted to the
  // cube the catch radius is tuned against and centred on the box's point.
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const span = bounds.getSize(new THREE.Vector3());
  const fit = size / Math.max(span.x, span.y, span.z, 0.001);
  const centre = bounds.getCenter(new THREE.Vector3()).multiplyScalar(fit);
  model.scale.multiplyScalar(fit);
  model.position.set(-centre.x, -centre.y, -centre.z);

  const template = new THREE.Group();
  template.add(model);
  return template;
}

/**
 * The boxes of one circuit.
 *
 * The geometry is minted per build (a clone of the crate's, or the fallback
 * cube's) and shared across this circuit's own boxes, which is what
 * `realm_racers_track_dispose_core.ts` expects of a plain mesh: disposing a
 * rebuilt draft's group frees this geometry and touches no authored circuit's,
 * and no world quest object's either. The materials are shared caches (the
 * quest object's own, `surfaceMat`, the sparkle above) and are deliberately
 * never disposed.
 */
export function buildRealmRacersPickups(circuit: RealmRacersCircuit): RealmRacersPickupsView {
  const group = new THREE.Group();
  // Named so a headless suite can find this sub-tree the way it finds the start
  // lights, rather than by counting children of the track group.
  group.name = 'realm-racers-pickups';
  const boxes = realmRacersPickupBoxes(circuit);
  const size = REALM_RACERS_PICKUP_BOX_HALF * 2;
  const bodies: THREE.Object3D[] = [];
  const visuals: RallyPickupVisual[] = [];
  const drawnScale: number[] = [];
  if (boxes.length > 0) {
    const crate = buildCrateTemplate(size);
    // Both minted ONCE per build and shared across this build's boxes, which is
    // the multiplicity rule `realm_racers_track_dispose_core.ts` rests on.
    const fallbackGeometry = crate ? null : new THREE.BoxGeometry(size, size, size);
    const fallbackMaterial = crate
      ? null
      : surfaceMat({
          color: REALM_RACERS_PICKUP_COLOR,
          emissive: 0x6a4a08,
          emissiveIntensity: 0.7,
          roughness: 0.4,
          metalness: 0.1,
          flatShading: true,
        });
    if (fallbackMaterial) fallbackMaterial.name = 'realmRacersPickups:fallback';
    const sparkleMaterial = pickupSparkleMaterial();
    for (const box of boxes) {
      const body = new THREE.Group();
      if (crate) {
        body.add(crate.clone(true));
      } else {
        const mesh = new THREE.Mesh(
          fallbackGeometry as THREE.BoxGeometry,
          fallbackMaterial as THREE.Material,
        );
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        body.add(mesh);
      }
      const sparkle = new THREE.Sprite(sparkleMaterial);
      sparkle.scale.set(SPARKLE_SCALE, SPARKLE_SCALE, 1);
      sparkle.position.y = size * 0.5 + SPARKLE_LIFT;
      body.add(sparkle);
      body.position.set(box.x, REST_HEIGHT, box.z);
      group.add(body);
      bodies.push(body);
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
      if (bodies.length === 0) return;
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
      for (let i = 0; i < bodies.length; i++) {
        const body = bodies[i];
        const visual = stepRallyPickupVisual(visuals[i], taken.has(i), dt);
        visuals[i] = visual;
        const visible = rallyPickupVisible(visual);
        if (body.visible !== visible) body.visible = visible;
        if (!visible) continue;
        const scale = rallyPickupScale(visual);
        if (Math.abs(scale - drawnScale[i]) > SCALE_EPSILON) {
          drawnScale[i] = scale;
          body.scale.setScalar(scale);
        }
        body.rotation.y = rallyPickupSpin(time, i);
        body.position.y = REST_HEIGHT + rallyPickupLift(time, i);
      }
    },
  };
}
