// The oil slicks, drawn: a dark patch on the road wherever a drawn `slick`
// pickup put one, with a slow sheen turning on it so it reads as wet rather
// than as a shadow.
//
// A sibling of the pickup boxes and composed the same way, by the track builder
// rather than by the renderer: a slick only exists on a lane of its own circuit,
// and the track view already resolves which lane the viewer stands on, moves
// itself onto it and hides itself off it (`mortar_overdrive/pickups.ts` has the long
// version of that argument).
//
// Positions come off the match readout (`MortarOverdriveMatchInfo.slicks`), in the
// circuit's own frame, which is the frame this group is already built in. Offline
// Sim and online ClientWorld hand over the same field, so both drive the same
// animation.
//
// Three things about how the per-frame half works:
//
//  - WRITE ELISION covers `visible` and `scale`. The sheen turns with the clock,
//    so guarding it would cost a comparison to save nothing. A patch that is
//    simply there writes no scale at all: it is drawn at full radius from its
//    first frame (see the core), so the only scale that ever moves is the
//    soak-away of a patch the race has already removed.
//  - The pool is FIXED (`MORTAR_OVERDRIVE_SLICK_POOL`) and minted once per build, geometry
//    shared across it; the two materials are shared by every circuit, like the
//    pickup sparkle, and never disposed. That keeps the track group's dispose
//    contract intact (no material per piece), lets the race preparation's
//    representative draw the very material a circuit draws, and is why a patch
//    spreads and soaks by SCALE rather than by opacity.
//  - FAIRNESS: no tier, no governor, no distance cull. A slick is a thing a pilot
//    steers around, so every preset draws every patch. The only cap is the pool,
//    which is the race's own patch cap (`MORTAR_OVERDRIVE_SLICK_CAP`), so a patch
//    the race still holds always has a slot.

import * as THREE from 'three';
import { MORTAR_OVERDRIVE_SLICK_RADIUS } from '../../sim/mortar_overdrive/slicks';
import type {
  MortarOverdriveLaneView,
  MortarOverdriveSlickInfo,
} from '../../world_api/mortar_overdrive';
import {
  MORTAR_OVERDRIVE_PROVISIONAL_SLICK_FADE_SEC,
  MORTAR_OVERDRIVE_SLICK_COLOR,
  MORTAR_OVERDRIVE_SLICK_OPACITY,
  MORTAR_OVERDRIVE_SLICK_POOL,
  MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR,
  type MortarOverdriveSlickVisual,
  mortarOverdriveProvisionalSlickState,
  mortarOverdriveSlickInitialVisual,
  mortarOverdriveSlickListSame,
  mortarOverdriveSlickScale,
  mortarOverdriveSlickSheenSpin,
  mortarOverdriveSlickVisible,
  stepMortarOverdriveSlickVisual,
} from './slicks_core';

/** How far over the road the patch is laid, yards. Enough to beat the road's own
 *  z-fighting margin, low enough that a machine drives over it rather than
 *  through a plate. */
const LIFT = 0.05;
/** Scale differences under this are not worth a matrix write. */
const SCALE_EPSILON = 0.002;
/** The longest frame the animation will honour, seconds: a backgrounded tab must
 *  not fast-forward a spread into nothing. */
const MAX_FRAME_SECONDS = 0.1;

export interface MortarOverdriveSlicksView {
  group: THREE.Group;
  /** `time` is the renderer's own clock, seconds. `match` is the viewer's live
   *  race on THIS circuit, or null when they are not racing (a circuit with no
   *  race on it carries no oil: the slicks belong to a race). */
  update(time: number, match: MortarOverdriveLaneView | null): void;
  /**
   * Paint the LOCAL pilot's own drop immediately, in this group's own frame,
   * instead of waiting the round trip for the readout: online, the patch used
   * to appear 9 to 15 yards behind the machine that dropped it. The
   * provisional patch shows until the readout's real one lands nearby (the
   * handoff is invisible: same look, same frame) or until a timeout says the
   * cast was refused. Display-only, the local screen only: the hazard every
   * OTHER pilot steers around is still the readout's patch.
   */
  dropProvisional(localX: number, localZ: number, time: number): void;
}

const NO_SLICKS: readonly MortarOverdriveSlickInfo[] = [];

interface SlickSlot {
  group: THREE.Group;
  /** Which slick this slot is showing, or null when it is free. */
  id: number | null;
  visual: MortarOverdriveSlickVisual;
  drawnScale: number;
}

let sharedSlickMaterials: {
  oilMaterial: THREE.MeshBasicMaterial;
  sheenMaterial: THREE.MeshBasicMaterial;
} | null = null;

function slickMaterials(): NonNullable<typeof sharedSlickMaterials> {
  if (sharedSlickMaterials) return sharedSlickMaterials;
  const oilMaterial = new THREE.MeshBasicMaterial({
    color: MORTAR_OVERDRIVE_SLICK_COLOR,
    transparent: true,
    opacity: MORTAR_OVERDRIVE_SLICK_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sheenMaterial = new THREE.MeshBasicMaterial({
    color: MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  oilMaterial.name = 'mortarOverdriveSlicks:oil';
  sheenMaterial.name = 'mortarOverdriveSlicks:sheen';
  sharedSlickMaterials = { oilMaterial, sheenMaterial };
  return sharedSlickMaterials;
}

/** The slicks of one circuit: a fixed pool of patches, parked until a race puts
 *  one somewhere. */
export function buildMortarOverdriveSlicks(): MortarOverdriveSlicksView {
  const group = new THREE.Group();
  // Named so a headless suite finds this sub-tree the way it finds the start
  // lights and the pickup boxes, rather than by counting children.
  group.name = 'mortar-overdrive-slicks';
  // One geometry and one material per BUILD, shared across the pool: see the
  // header, and `mortar_overdrive/track_dispose_core.ts` for why multiplicity here
  // would be the problem rather than the count.
  const oilGeometry = new THREE.CircleGeometry(MORTAR_OVERDRIVE_SLICK_RADIUS, 20);
  oilGeometry.rotateX(-Math.PI / 2);
  const sheenGeometry = new THREE.RingGeometry(
    MORTAR_OVERDRIVE_SLICK_RADIUS * 0.42,
    MORTAR_OVERDRIVE_SLICK_RADIUS * 0.74,
    20,
    1,
    0,
    Math.PI * 1.15,
  );
  sheenGeometry.rotateX(-Math.PI / 2);
  const { oilMaterial, sheenMaterial } = slickMaterials();

  const slots: SlickSlot[] = [];
  for (let i = 0; i < MORTAR_OVERDRIVE_SLICK_POOL; i++) {
    const slot = new THREE.Group();
    slot.visible = false;
    const oil = new THREE.Mesh(oilGeometry, oilMaterial);
    const sheen = new THREE.Mesh(sheenGeometry, sheenMaterial);
    sheen.position.y = 0.01;
    slot.add(oil);
    slot.add(sheen);
    group.add(slot);
    slots.push({
      group: slot,
      id: null,
      visual: mortarOverdriveSlickInitialVisual(),
      drawnScale: 1,
    });
  }

  // The provisional patch: one extra slot off the pool, same shared geometry
  // and materials (the dispose contract stays one-material-per-build).
  const provisionalGroup = new THREE.Group();
  provisionalGroup.visible = false;
  provisionalGroup.add(new THREE.Mesh(oilGeometry, oilMaterial));
  const provisionalSheen = new THREE.Mesh(sheenGeometry, sheenMaterial);
  provisionalSheen.position.y = 0.01;
  provisionalGroup.add(provisionalSheen);
  group.add(provisionalGroup);
  let provisionalAt: number | null = null;
  // Once the handoff (or the timeout) starts, the provisional shrinks away
  // over this window instead of vanishing in one frame: the server lays the
  // real patch under ITS pose, a yard or two from the painted one, and an
  // instant swap read as the patch teleporting.
  let provisionalFadeAt: number | null = null;
  // The patch ids already on the road when the drop was painted: only an id
  // ARRIVING after it may adopt it (see mortarOverdriveProvisionalSlickState).
  let provisionalKnownIds: ReadonlySet<number> = new Set();

  let lastTime = 0;
  let started = false;
  let lastList: readonly MortarOverdriveSlickInfo[] = NO_SLICKS;
  const live = new Map<number, MortarOverdriveSlickInfo>();

  return {
    group,
    dropProvisional(localX, localZ, time) {
      provisionalAt = time;
      provisionalFadeAt = null;
      provisionalKnownIds = new Set(live.keys());
      provisionalGroup.position.set(localX, LIFT, localZ);
      provisionalGroup.scale.setScalar(1);
      provisionalGroup.visible = true;
    },
    update(time, match) {
      const dt = started ? Math.min(MAX_FRAME_SECONDS, Math.max(0, time - lastTime)) : 0;
      lastTime = time;
      started = true;
      // The membership map is rebuilt only when the readout's own list changed,
      // which is a handful of times a lap rather than every frame.
      const list = match?.slicks ?? NO_SLICKS;
      if (!mortarOverdriveSlickListSame(list, lastList)) {
        // A COPY, like the sibling pickups painter: the readout hands back its own
        // array and a by-reference cache against one that is ever mutated in
        // place would compare equal forever and stop adopting new patches.
        lastList = list.slice();
        live.clear();
        for (const slick of list) live.set(slick.id, slick);
        // Adopt every patch nothing is showing yet, into whatever slots are
        // free. A slot is free once its own patch has finished soaking away;
        // with none free, a slot still soaking away a patch the race removed
        // gives its soak up. At the cap the race evicts the oldest patch in
        // the same readout that adds the newest, and the pool is the cap, so
        // waiting for the soak would leave a live hazard undrawn until the
        // readout next changed.
        for (const slick of list) {
          if (slots.some((slot) => slot.id === slick.id)) continue;
          const free =
            slots.find((slot) => slot.id === null) ??
            slots.find((slot) => slot.id !== null && !live.has(slot.id));
          if (!free) break;
          free.id = slick.id;
          free.visual = mortarOverdriveSlickInitialVisual();
          free.drawnScale = 1;
          free.group.position.set(slick.x, LIFT, slick.z);
          free.group.scale.setScalar(1);
        }
      }
      if (provisionalAt !== null) {
        if (provisionalFadeAt === null) {
          const state = mortarOverdriveProvisionalSlickState(
            list,
            provisionalKnownIds,
            provisionalGroup.position.x,
            provisionalGroup.position.z,
            time - provisionalAt,
          );
          if (state === 'shown') {
            provisionalGroup.rotation.y = mortarOverdriveSlickSheenSpin(time, -1);
          } else {
            provisionalFadeAt = time;
          }
        }
        if (provisionalFadeAt !== null) {
          const k = (time - provisionalFadeAt) / MORTAR_OVERDRIVE_PROVISIONAL_SLICK_FADE_SEC;
          if (k >= 1) {
            provisionalAt = null;
            provisionalFadeAt = null;
            provisionalGroup.visible = false;
          } else {
            provisionalGroup.scale.setScalar(1 - k);
          }
        }
      }
      for (const slot of slots) {
        if (slot.id === null) continue;
        const visual = stepMortarOverdriveSlickVisual(slot.visual, live.has(slot.id), dt);
        slot.visual = visual;
        const visible = mortarOverdriveSlickVisible(visual);
        if (slot.group.visible !== visible) slot.group.visible = visible;
        if (!visible) {
          // Soaked away: the slot goes back to the pool for the next patch.
          slot.id = null;
          continue;
        }
        const scale = mortarOverdriveSlickScale(visual);
        if (Math.abs(scale - slot.drawnScale) > SCALE_EPSILON) {
          slot.drawnScale = scale;
          slot.group.scale.setScalar(scale);
        }
        slot.group.rotation.y = mortarOverdriveSlickSheenSpin(time, slot.id);
      }
    },
  };
}
