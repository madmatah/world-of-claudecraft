// The Evergarden's dressing, render-only: the four marble watchers in the
// Fountain Court, the tiered fountain itself at the maze's heart, the Great
// Maze's modeled hedge walls and arches (planned by garden_maze_core over
// the wall grid world.ts owns, the same cells movement blocking reads), and
// the specimen elders at the greatTrees spots (the same records the sim's
// trunk colliders use). Same contract as the sibling realm modules: build
// once, update(time) animates.
import * as THREE from 'three';
import { EVERGARDEN_PROPS } from '../sim/content/evergarden';
import { hash2 } from '../sim/rng';
import { terrainHeight, WATER_LEVEL } from '../sim/world';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import {
  GARDEN_MAZE_ARCH_URL,
  GARDEN_MAZE_WALL_URL,
  MAZE_ARCH_SCALE,
  MAZE_WALL_SCALE,
  MAZE_Z1,
  type MazePieceSpot,
  planGardenMazePieces,
} from './garden_maze_core';
import { buildTieredFountain, gardenStatueGeo, gardenStatueMaterial } from './garden_stonework';
import { applySurfaceDetail, GREAT_TREE_BARK_DETAIL, isBarkMaterialName } from './worn_stone';

export interface GardenFeaturesView {
  group: THREE.Group;
  update(time: number): void;
}

const GARDEN_ZMIN = 700;
const GARDEN_ZMAX = 1260;

// The specimen elders reuse the twisted-elder model the Hollow, the
// Wraithwood, and the Palmreach already preload, regrown into clipped
// evergreen giants.
const GREAT_TREE_URL = '/models/foliage/twisted_1.glb';
let greatTreeScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(GREAT_TREE_URL).then((gltf) => {
    greatTreeScene = gltf.scene;
  }),
);

// The Great Maze's modeled hedge walls and entry arches (user-authored
// models). The wall grid, cell geometry, and the movement-blocking bands
// all live in sim/world.ts; this module only DRAWS that same data.
const MAZE_WALL_URL = GARDEN_MAZE_WALL_URL;
const MAZE_ARCH_URL = GARDEN_MAZE_ARCH_URL;
let mazeWallScene: THREE.Group | null = null;
let mazeArchScene: THREE.Group | null = null;
registerDeferredPreload(() =>
  loadGltf(MAZE_WALL_URL).then((gltf) => {
    mazeWallScene = gltf.scene;
  }),
);
registerDeferredPreload(() =>
  loadGltf(MAZE_ARCH_URL).then((gltf) => {
    mazeArchScene = gltf.scene;
  }),
);

// (The modeled flower beds render and collide as decorProps through the
// props system now: PROP_ASSET_DEFS flowerBed* keys, placed by
// content/evergarden with world.ts GARDEN_BED_PADS leveling their ground.)

export const gardenFeaturesPreloadInternalsForTest = {
  mazeAssetUrl: { wall: MAZE_WALL_URL, arch: MAZE_ARCH_URL },
};

export function buildGardenFeatures(seed: number): GardenFeaturesView {
  const group = new THREE.Group();
  group.name = 'garden-features';

  const instance = (
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    spots: { x: number; z: number; y: number; s: number; rot: number; tint?: number }[],
    tinted = false,
  ) => {
    if (spots.length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((sp, i) => {
      q.setFromAxisAngle(up, sp.rot);
      v.set(sp.x, sp.y, sp.z);
      sc.set(sp.s, sp.s, sp.s);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
      if (tinted && sp.tint !== undefined) mesh.setColorAt(i, new THREE.Color(sp.tint));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  };

  // --- the four marble watchers inside the Fountain Court (the old paired
  // walk statues came down: the white figures read as rubble pillars among
  // the new hedge and flower borders) ---
  {
    const spots: { x: number; z: number; y: number; s: number; rot: number }[] = [];
    for (const [x, z] of [
      [350, 1008],
      [370, 1008],
      [350, 1025],
      [370, 1025],
    ]) {
      const y = terrainHeight(x, z, seed);
      spots.push({
        x,
        z,
        y: y - 0.1,
        s: 1.05,
        rot: Math.atan2(360 - x, 1016.5 - z), // all four face the fountain
      });
    }
    instance(gardenStatueGeo(), gardenStatueMaterial(), spots);
  }

  // --- the fountain at the heart of the Great Maze ---
  {
    const y = terrainHeight(360, 1016.5, seed);
    if (y > WATER_LEVEL) group.add(buildTieredFountain(360, 1016.5, y - 0.1));
  }

  // --- the Great Maze's modeled hedge walls and entry arches ---
  // The plan comes from garden_maze_core (which reads the sim's wall grid),
  // so the drawn hedges, the movement-blocking boxes, and the map painter
  // all derive from the same cells. Instances split into north-south bands
  // so the far half of the maze frustum-culls from inside it.
  {
    const instanceModel = (scene: THREE.Group | null, spots: MazePieceSpot[], s: number) => {
      if (!scene || spots.length === 0) return;
      scene.updateMatrixWorld(true);
      const bandOf = (sp: MazePieceSpot) => Math.min(3, Math.floor((MAZE_Z1 - sp.z) / 40));
      const bands: MazePieceSpot[][] = [[], [], [], []];
      for (const sp of spots) bands[bandOf(sp)].push(sp);
      scene.traverse((obj) => {
        const src = obj as THREE.Mesh;
        if (!src.isMesh) return;
        for (const band of bands) {
          if (band.length === 0) continue;
          const mesh = new THREE.InstancedMesh(src.geometry, src.material, band.length);
          const m = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          const up = new THREE.Vector3(0, 1, 0);
          const v = new THREE.Vector3();
          const sc = new THREE.Vector3(s, s, s);
          band.forEach((sp, i) => {
            // sunk a quarter yard so overlapped piece ends seat into the
            // lawn together on the garden's gentle slopes
            q.setFromAxisAngle(up, sp.rot);
            v.set(sp.x, terrainHeight(sp.x, sp.z, seed) - 0.25, sp.z);
            mesh.setMatrixAt(i, m.compose(v, q, sc).multiply(src.matrixWorld));
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.computeBoundingSphere();
          group.add(mesh);
        }
      });
    };
    const plan = planGardenMazePieces();
    instanceModel(mazeWallScene, plan.walls, MAZE_WALL_SCALE);
    instanceModel(mazeArchScene, plan.arches, MAZE_ARCH_SCALE);
  }

  // (The topiary forms retired entirely: even the clipped ball read as a
  // lollipop tree beside the walks. The garden's greenery is now the hedge
  // lines, the oaks, and the specimen elders below.)

  // --- the specimen elders: the twisted giant regrown clipped and green ---
  {
    const clipped = new Map<string, THREE.Material>();
    const clip = (source: THREE.Material): THREE.Material => {
      let m2 = clipped.get(source.uuid);
      if (!m2) {
        m2 = source.clone();
        const c = (m2 as THREE.MeshStandardMaterial).color;
        if (c) c.multiply(new THREE.Color(0.62, 0.98, 0.64));
        // giant specimen trunks take the coarse landmark bark grain
        if (isBarkMaterialName(source.name))
          applySurfaceDetail(m2 as THREE.MeshStandardMaterial, 'bark', GREAT_TREE_BARK_DETAIL);
        clipped.set(source.uuid, m2);
      }
      return m2;
    };
    const trees = EVERGARDEN_PROPS.greatTrees ?? [];
    if (greatTreeScene) {
      for (const t of trees) {
        const y = terrainHeight(t.x, t.z, seed);
        if (y < WATER_LEVEL) continue;
        const tree = greatTreeScene.clone(true);
        const scale = t.r * (2.4 + hash2(t.x, t.z, seed + 6301) * 0.5);
        tree.position.set(t.x, y - 0.2, t.z);
        tree.scale.setScalar(scale);
        tree.rotation.y = hash2(t.z, t.x, seed + 6311) * Math.PI * 2;
        tree.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.material = Array.isArray(mesh.material)
              ? mesh.material.map(clip)
              : clip(mesh.material);
          }
        });
        group.add(tree);
      }
    }
  }

  return {
    group,
    update(): void {
      // still air over still water: the fountain holds its pose, the global
      // wind shader sways the modeled foliage
    },
  };
}
