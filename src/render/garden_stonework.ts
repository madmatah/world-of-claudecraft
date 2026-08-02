// The formal garden's stonework, shared by every place that needs it: the
// tiered fountain and the weathered statue. Lifted out of garden_features.ts
// unchanged when the Realm Racers's infield needed the same two pieces, so
// the Evergarden's Fountain Court and the circuit's landmark cannot drift into
// two different fountains.
import * as THREE from 'three';
import { GFX } from './gfx';

export const GARDEN_MARBLE = 0xcfcdc2;

function mat(color: number, rough = 0.85): THREE.MeshStandardMaterial | THREE.MeshLambertMaterial {
  return GFX.standardMaterials
    ? new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true })
    : new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function mergeGeos(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of parts) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const norm = new Float32Array(total * 3);
  let off = 0;
  for (const g of parts) {
    pos.set(g.getAttribute('position').array as Float32Array, off);
    norm.set(g.getAttribute('normal').array as Float32Array, off);
    off += g.getAttribute('position').count * 3;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  return out;
}

/** Built once. Both callers hand it straight to an `InstancedMesh` and neither
 *  mutates it, so one merged geometry serves every statue in the world; minting
 *  a fresh one per call leaked one per rebuilt Realm Racers track. */
let statueGeo: THREE.BufferGeometry | null = null;

// A weathered garden statue: a plinth, a robed figure, a bowed head. Kept
// abstract on purpose: at game distance it reads as statuary, not a person.
export function gardenStatueGeo(): THREE.BufferGeometry {
  if (statueGeo) return statueGeo;
  const parts: THREE.BufferGeometry[] = [];
  const plinth = new THREE.BoxGeometry(1.5, 0.9, 1.5);
  plinth.translate(0, 0.45, 0);
  parts.push(plinth.toNonIndexed());
  const robe = new THREE.CylinderGeometry(0.28, 0.52, 2.1, 6);
  robe.translate(0, 0.9 + 1.05, 0);
  parts.push(robe.toNonIndexed());
  const shoulders = new THREE.SphereGeometry(0.34, 6, 5);
  shoulders.scale(1.2, 0.7, 0.9);
  shoulders.translate(0, 3.0, 0);
  parts.push(shoulders.toNonIndexed());
  const head = new THREE.SphereGeometry(0.2, 6, 5);
  head.translate(0.05, 3.32, 0.08); // bowed, a little forward
  parts.push(head.toNonIndexed());
  statueGeo = mergeGeos(parts);
  return statueGeo;
}

export function gardenStatueMaterial(): THREE.Material {
  return mat(GARDEN_MARBLE, 0.75);
}

/**
 * A two-tier stone fountain with a still water disc in each basin (the shimmer
 * is the water shader's job elsewhere; here a gentle blue reads as water at
 * court scale). `scale` grows the whole piece about its base.
 */
export function buildTieredFountain(x: number, z: number, y: number, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const stone = mat(0xb8b4a6, 0.9);
  const water = new THREE.MeshBasicMaterial({ color: 0x69b8c4, transparent: true, opacity: 0.85 });
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.3, 0.9, 14), stone);
  basin.position.set(x, y + 0.45, z);
  g.add(basin);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(2.85, 14), water);
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, y + 0.82, z);
  g.add(pool);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.7, 8), stone);
  column.position.set(x, y + 1.7, z);
  g.add(column);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 0.9, 0.5, 12), stone);
  bowl.position.set(x, y + 2.6, z);
  g.add(bowl);
  const bowlPool = new THREE.Mesh(new THREE.CircleGeometry(1.05, 12), water);
  bowlPool.rotation.x = -Math.PI / 2;
  bowlPool.position.set(x, y + 2.82, z);
  g.add(bowlPool);
  const finial = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.8, 6), stone);
  finial.position.set(x, y + 3.4, z);
  g.add(finial);
  g.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  if (scale !== 1) {
    // Grow about the piece's own base so a bigger fountain still seats on the
    // ground it was placed on.
    g.position.set(x, y, z);
    for (const child of g.children) child.position.sub(g.position);
    g.scale.setScalar(scale);
  }
  return g;
}
