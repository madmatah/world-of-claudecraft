// What the race preparation compiles of the circuits (realm_racers_prepare.ts
// is the seam, realm_racers_track.ts the views).
//
// `rallyCommon` links, at the commitment trigger and before any circuit is
// drawn, one representative draw per procedural program the authored circuits
// carry (ground, road, kerb, grid, start lights, flowers, blade grass, water,
// pickups, slicks, lamps): a program depends on the material and the mesh
// shape, not on the circuit, so every circuit's own copy is a cache hit once
// its representative linked. A representative is a proxy node sharing the real
// node's material and geometry, of the same program variant (instancing and
// its colour buffer, the geometry attributes), grouped by the material's
// program signature plus that variant. Theme dressing models are not in it:
// their materials depend on the model (the world's converted prop material,
// or the file's own; realm_racers_dressing_material.ts).
//
// `rallyCircuit:<id>` prepares the drawn circuit once it is known: it waits
// for the circuit's fetch-and-fill models to land (realm_racers_fills.ts),
// then gates the circuit's view, textures included, and re-gates if a fill was
// started meanwhile, while its theme sky prepares beside it on the GPU queue
// (realm_racers_sky.ts). Its linked view is then released to the reveal hold
// and the verdict waits for its first visible frame on the viewer's lane, the
// frame that uploads its vertex and instance buffers, so that too lands under
// the curtain. A cover that ends first (the curtain falls, the arrival cover
// lifts) settles it on what exists: a fetch that never lands never holds a
// verdict. Its steps (each fill, the gate, the first draw, the sky) are the
// lobby bar's units, and its verdict joins the seam's settle, so the lobby's
// ready waits for it.

import * as THREE from 'three';
import { programVariantOf } from './compile_gate_pieces';
import { materialProgramSignature } from './prewarm_policy';
import { type RealmRacersFills, realmRacersFills } from './realm_racers_fills';
import type {
  RealmRacersCircuitClients,
  RealmRacersPrepare,
  RealmRacersPrepareClient,
  RealmRacersPrepareUnits,
} from './realm_racers_prepare';
import {
  REALM_RACERS_COMMON_PREPARE_ID,
  realmRacersCircuitPrepareId,
  realmRacersCircuitUnits,
} from './realm_racers_prepare_core';
import type { RealmRacersSky } from './realm_racers_sky';
import type { RealmRacersCircuitView, RealmRacersTracksView } from './realm_racers_track';

type Drawable = THREE.Object3D & {
  isMesh?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  instanceColor?: THREE.InstancedBufferAttribute | null;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

function proxyOf(node: Drawable): THREE.Object3D {
  if (node.isSprite) return new THREE.Sprite(node.material as THREE.SpriteMaterial);
  if (node.isInstancedMesh) {
    const proxy = new THREE.InstancedMesh(node.geometry, node.material, 1);
    if (node.instanceColor) {
      proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    }
    return proxy;
  }
  return new THREE.Mesh(node.geometry, node.material);
}

/** One proxy per procedural program key under `groups`, dressing excluded. */
export function buildRealmRacersCommonRoot(groups: readonly THREE.Object3D[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'realmRacersCommon';
  const seen = new Set<string>();
  for (const group of groups) {
    group.traverse((object) => {
      const node = object as Drawable;
      if (!(node.isMesh || node.isSprite) || !node.material) return;
      if (node.userData.realmRacersDressing) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const key = `${materials.map(materialProgramSignature).join('+')}#${programVariantOf(node)}`;
      if (seen.has(key)) return;
      seen.add(key);
      root.add(proxyOf(node));
    });
  }
  return root;
}

export class RealmRacersCommonPrepare implements RealmRacersPrepareClient {
  readonly prepareId = REALM_RACERS_COMMON_PREPARE_ID;
  readonly built = false;
  readonly gateOnly = true;
  private root: THREE.Group | null = null;

  constructor(private readonly groups: readonly THREE.Object3D[]) {}

  prepare(): THREE.Object3D {
    this.root ??= buildRealmRacersCommonRoot(this.groups);
    return this.root;
  }
}

export class RealmRacersCircuitPrepare implements RealmRacersPrepareClient {
  readonly prepareId: string;
  readonly built = false;
  private readonly fills: RealmRacersFills;
  private readonly steps: RealmRacersPrepareUnits = { done: 0, total: 0 };
  private gated = false;
  private drawn = false;
  private skyReady = false;

  constructor(
    private readonly view: RealmRacersCircuitView,
    private readonly sky: Pick<RealmRacersSky, 'ensure'>,
  ) {
    this.prepareId = realmRacersCircuitPrepareId(view.circuitId);
    this.fills = realmRacersFills(view.group);
  }

  prepare(): THREE.Object3D {
    return this.view.group;
  }

  units(): RealmRacersPrepareUnits {
    return realmRacersCircuitUnits(
      this.steps,
      this.fills.done,
      this.fills.total,
      this.gated,
      this.drawn,
      this.skyReady,
    );
  }

  revealReady(): boolean {
    return this.gated;
  }

  async run(
    gate: (target: THREE.Object3D) => Promise<unknown>,
    uncovered: Promise<void>,
  ): Promise<boolean> {
    let covered = true;
    const lifted = uncovered.then(() => {
      covered = false;
      return false;
    });
    const sky = this.sky.ensure(this.view.skyBiome).then((ok) => {
      this.skyReady = true;
      return ok;
    });
    // `want` is read before the wait, so a fill started during it is gated by
    // the next round. Once the cover is gone, what exists is gated and a fill
    // landing later rides its own gated attach (realm_racers_track.ts).
    for (;;) {
      const want = this.fills.total;
      if (covered && this.fills.done < want) await Promise.race([this.fills.landed(), lifted]);
      await gate(this.view.group).catch(() => undefined);
      if (!covered || (this.fills.total === want && this.fills.done === want)) break;
    }
    this.gated = true;
    // The linked view's first visible frame uploads its vertex and instance
    // buffers: held until it happened, so that lands under the curtain too.
    if (covered && this.view.onViewerLane()) {
      await Promise.race([this.view.drawnOnce(), lifted]);
    }
    this.drawn = true;
    return Promise.race([sky, lifted]);
  }
}

/** One client per authored circuit, minted on first ask; null for any other id. */
export function realmRacersCircuitClients(
  views: readonly RealmRacersCircuitView[],
  sky: Pick<RealmRacersSky, 'ensure'>,
): RealmRacersCircuitClients {
  const clients = new Map<string, RealmRacersCircuitPrepare>();
  const ids = views.map((view) => view.circuitId);
  return {
    circuitIds: () => ids,
    circuitClient(circuitId) {
      const known = clients.get(circuitId);
      if (known) return known;
      const view = views.find((candidate) => candidate.circuitId === circuitId);
      if (!view) return null;
      const client = new RealmRacersCircuitPrepare(view, sky);
      clients.set(circuitId, client);
      return client;
    },
  };
}

/** The renderer's one call: the common client, the circuit clients, the
 *  reveal hold the tracks consult, and the gate a late model fill rides. */
export function prepareRealmRacersCircuits(
  seam: Pick<RealmRacersPrepare, 'addClient' | 'useCircuits' | 'revealHeld' | 'worldGate'>,
  tracks: Pick<RealmRacersTracksView, 'circuits' | 'holdReveal' | 'gateFills'>,
  sky: Pick<RealmRacersSky, 'ensure'>,
): void {
  seam.addClient(new RealmRacersCommonPrepare(tracks.circuits.map((view) => view.group)));
  seam.useCircuits(realmRacersCircuitClients(tracks.circuits, sky));
  tracks.holdReveal((circuitId) => seam.revealHeld(circuitId));
  tracks.gateFills(() => seam.worldGate());
}
