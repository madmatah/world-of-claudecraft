// The oil slicks, drawn: a dark patch on the road wherever a drawn `slick`
// pickup put one, with a slow sheen turning on it so it reads as wet rather
// than as a shadow.
//
// A sibling of the pickup boxes and composed the same way, by the track builder
// rather than by the renderer: a slick only exists on a lane of its own circuit,
// and the track view already resolves which lane the viewer stands on, moves
// itself onto it and hides itself off it (`realm_racers_pickups.ts` has the long
// version of that argument).
//
// Positions come off the match readout (`RealmRacersMatchInfo.slicks`), in the
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
//  - The pool is FIXED (`RALLY_SLICK_POOL`) and minted once per build, geometry
//    and material shared across it. That is what keeps the track group's dispose
//    contract intact (one material per build, never one per piece), and it is why
//    a patch spreads and soaks by SCALE rather than by opacity.
//  - FAIRNESS: no tier, no governor, no distance cull. A slick is a thing a pilot
//    steers around, so every preset draws every patch. The only cap is the pool,
//    which sits far above what a race can produce.

import * as THREE from 'three';
import { REALM_RACERS_SLICK_RADIUS } from '../sim/realm_racers_slicks';
import type { RealmRacersLaneView, RealmRacersSlickInfo } from '../world_api/realm_racers';
import {
  RALLY_SLICK_OPACITY,
  RALLY_SLICK_POOL,
  type RallySlickVisual,
  REALM_RACERS_SLICK_COLOR,
  REALM_RACERS_SLICK_SHEEN_COLOR,
  rallySlickInitialVisual,
  rallySlickListSame,
  rallySlickScale,
  rallySlickSheenSpin,
  rallySlickVisible,
  stepRallySlickVisual,
} from './realm_racers_slicks_core';

/** How far over the road the patch is laid, yards. Enough to beat the road's own
 *  z-fighting margin, low enough that a machine drives over it rather than
 *  through a plate. */
const LIFT = 0.05;
/** Scale differences under this are not worth a matrix write. */
const SCALE_EPSILON = 0.002;
/** The longest frame the animation will honour, seconds: a backgrounded tab must
 *  not fast-forward a spread into nothing. */
const MAX_FRAME_SECONDS = 0.1;

export interface RealmRacersSlicksView {
  group: THREE.Group;
  /** `time` is the renderer's own clock, seconds. `match` is the viewer's live
   *  race on THIS circuit, or null when they are not racing (a circuit with no
   *  race on it carries no oil: the slicks belong to a race). */
  update(time: number, match: RealmRacersLaneView | null): void;
}

const NO_SLICKS: readonly RealmRacersSlickInfo[] = [];

interface SlickSlot {
  group: THREE.Group;
  /** Which slick this slot is showing, or null when it is free. */
  id: number | null;
  visual: RallySlickVisual;
  drawnScale: number;
}

/** The slicks of one circuit: a fixed pool of patches, parked until a race puts
 *  one somewhere. */
export function buildRealmRacersSlicks(): RealmRacersSlicksView {
  const group = new THREE.Group();
  // Named so a headless suite finds this sub-tree the way it finds the start
  // lights and the pickup boxes, rather than by counting children.
  group.name = 'realm-racers-slicks';
  // One geometry and one material per BUILD, shared across the pool: see the
  // header, and `realm_racers_track_dispose_core.ts` for why multiplicity here
  // would be the problem rather than the count.
  const oilGeometry = new THREE.CircleGeometry(REALM_RACERS_SLICK_RADIUS, 20);
  oilGeometry.rotateX(-Math.PI / 2);
  const sheenGeometry = new THREE.RingGeometry(
    REALM_RACERS_SLICK_RADIUS * 0.42,
    REALM_RACERS_SLICK_RADIUS * 0.74,
    20,
    1,
    0,
    Math.PI * 1.15,
  );
  sheenGeometry.rotateX(-Math.PI / 2);
  const oilMaterial = new THREE.MeshBasicMaterial({
    color: REALM_RACERS_SLICK_COLOR,
    transparent: true,
    opacity: RALLY_SLICK_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sheenMaterial = new THREE.MeshBasicMaterial({
    color: REALM_RACERS_SLICK_SHEEN_COLOR,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const slots: SlickSlot[] = [];
  for (let i = 0; i < RALLY_SLICK_POOL; i++) {
    const slot = new THREE.Group();
    slot.visible = false;
    const oil = new THREE.Mesh(oilGeometry, oilMaterial);
    const sheen = new THREE.Mesh(sheenGeometry, sheenMaterial);
    sheen.position.y = 0.01;
    slot.add(oil);
    slot.add(sheen);
    group.add(slot);
    slots.push({ group: slot, id: null, visual: rallySlickInitialVisual(), drawnScale: 1 });
  }

  let lastTime = 0;
  let started = false;
  let lastList: readonly RealmRacersSlickInfo[] = NO_SLICKS;
  const live = new Map<number, RealmRacersSlickInfo>();

  return {
    group,
    update(time, match) {
      const dt = started ? Math.min(MAX_FRAME_SECONDS, Math.max(0, time - lastTime)) : 0;
      lastTime = time;
      started = true;
      // The membership map is rebuilt only when the readout's own list changed,
      // which is a handful of times a lap rather than every frame.
      const list = match?.slicks ?? NO_SLICKS;
      if (!rallySlickListSame(list, lastList)) {
        // A COPY, like the sibling pickups painter: the readout hands back its own
        // array and a by-reference cache against one that is ever mutated in
        // place would compare equal forever and stop adopting new patches.
        lastList = list.slice();
        live.clear();
        for (const slick of list) live.set(slick.id, slick);
        // Adopt every patch nothing is showing yet, into whatever slots are
        // free. A slot is free once its own patch has finished soaking away.
        for (const slick of list) {
          if (slots.some((slot) => slot.id === slick.id)) continue;
          const free = slots.find((slot) => slot.id === null);
          if (!free) break;
          free.id = slick.id;
          free.visual = rallySlickInitialVisual();
          free.drawnScale = 1;
          free.group.position.set(slick.x, LIFT, slick.z);
          free.group.scale.setScalar(1);
        }
      }
      for (const slot of slots) {
        if (slot.id === null) continue;
        const visual = stepRallySlickVisual(slot.visual, live.has(slot.id), dt);
        slot.visual = visual;
        const visible = rallySlickVisible(visual);
        if (slot.group.visible !== visible) slot.group.visible = visible;
        if (!visible) {
          // Soaked away: the slot goes back to the pool for the next patch.
          slot.id = null;
          continue;
        }
        const scale = rallySlickScale(visual);
        if (Math.abs(scale - slot.drawnScale) > SCALE_EPSILON) {
          slot.drawnScale = scale;
          slot.group.scale.setScalar(scale);
        }
        slot.group.rotation.y = rallySlickSheenSpin(time, slot.id);
      }
    },
  };
}
