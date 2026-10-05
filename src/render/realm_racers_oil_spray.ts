// The oil spray, drawn: a short burst of droplets from a rival's drawn tail to
// the patch the server laid (the decisions are in realm_racers_oil_spray_core.ts).
//
// A GPU producer, prepared like the Ground Blast pool beside it: `prepare()`
// builds every slot the pool will ever draw, hidden, and the race preparation
// seam (realm_racers_prepare.ts) links and uploads exactly that set when the
// viewer commits to racing, so a drop never links a program on a live frame.
// Every slot wears ONE module-level material and ONE geometry, shared by every
// pool and never disposed: a material minted per drop and freed when the spray
// ends would relink its program on the next one. Both are minted by the first
// `prepare()`, never at import, so a player who never races holds neither.
// Teardown gives back only the per-slot instance buffers.
//
// Cosmetic, and drawn the same on every preset: the hazard is the patch, which
// the slick layer draws whatever the spray does.

import * as THREE from 'three';
import { excludeFromParentCompile } from './compile_exclusion';
import {
  RALLY_OIL_SPRAY_DROPLETS,
  RALLY_OIL_SPRAY_SECONDS,
  type RallyOilDroplet,
  type RallyOilSprayPath,
  rallyOilDropletAt,
} from './realm_racers_oil_spray_core';
import { REALM_RACERS_COMPILE_OWNER } from './realm_racers_prepare_core';
import { REALM_RACERS_SLICK_COLOR } from './realm_racers_slicks_core';
import { tagVfxSubtree } from './renderer_diagnostics';

/** Sprays in the air at once; past that the oldest slot is recycled. */
const POOL_SIZE = 4;
const DROPLET_RADIUS = 0.18;

let dropletGeometry: THREE.IcosahedronGeometry | null = null;
let dropletMaterial: THREE.MeshBasicMaterial | null = null;

/** The pool's one material, shared by every pool, minted on first use and
 *  never disposed (see the header). */
export function realmRacersOilSprayMaterial(): THREE.MeshBasicMaterial {
  dropletMaterial ??= new THREE.MeshBasicMaterial({
    name: 'realmRacersOilSpray:droplet',
    color: REALM_RACERS_SLICK_COLOR,
  });
  return dropletMaterial;
}

function realmRacersOilSprayGeometry(): THREE.IcosahedronGeometry {
  dropletGeometry ??= new THREE.IcosahedronGeometry(DROPLET_RADIUS, 0);
  return dropletGeometry;
}

interface SpraySlot {
  droplets: THREE.InstancedMesh;
  path: RallyOilSprayPath;
  fromY: number;
  toY: number;
  elapsed: number;
  live: boolean;
}

export class RealmRacersOilSprayVisuals {
  readonly prepareId = 'oilSpray';
  readonly group = new THREE.Group();
  private slots: SpraySlot[] = [];
  private nextSlot = 0;
  private prepared = false;
  private disposed = false;
  private readonly scratch = new THREE.Object3D();
  private readonly droplet: RallyOilDroplet = { x: 0, y: 0, z: 0, scale: 0 };

  constructor() {
    this.group.name = 'realmRacersOilSpray';
    tagVfxSubtree(this.group);
    // Linked by the race preparation seam alone, never by a whole-scene compile
    // it happens to sit under (compile_exclusion.ts).
    excludeFromParentCompile(this.group, REALM_RACERS_COMPILE_OWNER);
  }

  /** Build every slot, hidden, and return the root holding them. Idempotent,
   *  and a no-op once disposed. */
  prepare(): THREE.Object3D {
    if (this.prepared || this.disposed) return this.group;
    this.prepared = true;
    const geometry = realmRacersOilSprayGeometry();
    const material = realmRacersOilSprayMaterial();
    for (let i = 0; i < POOL_SIZE; i++) {
      const droplets = new THREE.InstancedMesh(geometry, material, RALLY_OIL_SPRAY_DROPLETS);
      droplets.name = `oilSpray${i}`;
      droplets.frustumCulled = false;
      droplets.castShadow = false;
      droplets.visible = false;
      this.group.add(droplets);
      this.slots.push({
        droplets,
        path: { fromX: 0, fromZ: 0, toX: 0, toZ: 0 },
        fromY: 0,
        toY: 0,
        elapsed: 0,
        live: false,
      });
    }
    tagVfxSubtree(this.group);
    return this.group;
  }

  /** Built, by `prepare()` or by a drop that came first. */
  get built(): boolean {
    return this.prepared;
  }

  /** Start one spray along `path`; `fromY` and `toY` are the heights at its
   *  two ends. */
  spray(path: RallyOilSprayPath, fromY: number, toY: number): void {
    if (this.disposed) return;
    this.prepare();
    const slot = this.slots[this.nextSlot % POOL_SIZE];
    this.nextSlot++;
    slot.path.fromX = path.fromX;
    slot.path.fromZ = path.fromZ;
    slot.path.toX = path.toX;
    slot.path.toZ = path.toZ;
    slot.fromY = fromY;
    slot.toY = toY;
    slot.elapsed = 0;
    slot.live = true;
    slot.droplets.visible = true;
    this.step(slot, 0);
  }

  update(dt: number): void {
    if (this.disposed) return;
    for (const slot of this.slots) {
      if (slot.live) this.step(slot, dt);
    }
  }

  private step(slot: SpraySlot, dt: number): void {
    slot.elapsed += dt;
    if (slot.elapsed >= RALLY_OIL_SPRAY_SECONDS) {
      slot.live = false;
      slot.droplets.visible = false;
      return;
    }
    for (let i = 0; i < RALLY_OIL_SPRAY_DROPLETS; i++) {
      const d = rallyOilDropletAt(slot.path, slot.fromY, slot.toY, i, slot.elapsed, this.droplet);
      this.scratch.position.set(d.x, d.y, d.z);
      this.scratch.scale.setScalar(d.scale);
      this.scratch.updateMatrix();
      slot.droplets.setMatrixAt(i, this.scratch.matrix);
    }
    slot.droplets.instanceMatrix.needsUpdate = true;
  }

  /** Sprays in the air, for tests. */
  get inFlight(): number {
    return this.slots.reduce((n, slot) => n + (slot.live ? 1 : 0), 0);
  }

  /** Terminal release on renderer teardown: the per-slot instance buffers. The
   *  shared geometry and material stay (see the header). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) slot.droplets.dispose();
    this.slots.length = 0;
    this.group.clear();
  }
}
