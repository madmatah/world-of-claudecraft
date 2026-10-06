// The bounding box of a shipped GLB, read out of its JSON chunk alone.
//
// It exists because the two things that want a model's real size cannot get it
// from the loader: `GLTFLoader` refuses these files headless (their KTX2
// textures need a WebGL context to transcode), and both callers only need
// numbers. Every glTF POSITION accessor is REQUIRED to carry min and max, so
// the box is the eight corners of each primitive's own extremes pushed through
// the node transforms composed on the way down the scene graph.
//
// NORMALIZED accessors are the one trap, and it cost a wrong answer before this
// was shared: a meshopt- or quantization-compressed model stores positions as
// normalized SHORTs, whose min/max come back in the integer domain and are
// 32767 times too large until divided out (the node's own scale carries the
// dequantization the other way, so skipping this yields a box tens of thousands
// of yards across). The first caller only ever compared one axis against
// another, so the error cancelled and nothing noticed.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

interface GlbNode {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  mesh?: number;
  children?: number[];
}

interface GlbJson {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GlbNode[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min: number[]; max: number[]; componentType: number; normalized?: boolean }[];
}

/** What one unit of a normalized component is worth, by glTF component type. */
const NORMALIZED_SCALE: Record<number, number> = {
  5120: 127, // BYTE
  5121: 255, // UNSIGNED_BYTE
  5122: 32767, // SHORT
  5123: 65535, // UNSIGNED_SHORT
};

function readJsonChunk(url: string): GlbJson {
  const buf = readFileSync(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let off = 12; off < buf.byteLength; ) {
    const length = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    if (type === 0x4e4f534a) {
      return JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + length)));
    }
    off += 8 + length;
  }
  throw new Error(`no JSON chunk in ${url}`);
}

/** The model's axis-aligned bounding box, in its own authored frame at scale 1. */
export function glbBounds(url: string): THREE.Box3 {
  const document = readJsonChunk(url);
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const walk = (nodeIndex: number, parent: THREE.Matrix4): void => {
    const node = document.nodes[nodeIndex];
    const local = new THREE.Matrix4();
    if (node.matrix) local.fromArray(node.matrix);
    else {
      local.compose(
        new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
    }
    const world = new THREE.Matrix4().multiplyMatrices(parent, local);
    if (node.mesh !== undefined) {
      for (const primitive of document.meshes[node.mesh].primitives) {
        const accessor = document.accessors[primitive.attributes.POSITION];
        const divisor = accessor.normalized ? (NORMALIZED_SCALE[accessor.componentType] ?? 1) : 1;
        // A normalized signed component clamps at -1, which is the one place
        // the integer domain and the real one disagree by more than a division.
        const de = (v: number): number => (divisor === 1 ? v : Math.max(v / divisor, -1));
        for (const x of [de(accessor.min[0]), de(accessor.max[0])]) {
          for (const y of [de(accessor.min[1]), de(accessor.max[1])]) {
            for (const z of [de(accessor.min[2]), de(accessor.max[2])]) {
              box.expandByPoint(point.set(x, y, z).applyMatrix4(world));
            }
          }
        }
      }
    }
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const root of document.scenes[document.scene ?? 0].nodes) {
    walk(root, new THREE.Matrix4());
  }
  return box;
}

/** The model's extent on each axis, in its own authored frame at scale 1. */
export function glbSize(url: string): THREE.Vector3 {
  return glbBounds(url).getSize(new THREE.Vector3());
}

/**
 * A fingerprint of the model's GEOMETRY: the SHA-1 of its glTF binary chunk.
 *
 * What a url comparison cannot see. The world ships models that are the same
 * asset under two filenames (`hex_wall.glb` and `hexn_palisade.glb` are byte for
 * byte identical), and a catalog that offers both as separate choices is
 * offering one thing twice, which is what Mortar Overdrive's barrier kits did until a
 * seat test caught three of them drawing one wall.
 */
export function glbBinarySha1(url: string): string {
  const buf = readFileSync(path.join(process.cwd(), 'public', url.replace(/^\//, '')));
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let off = 12; off < buf.byteLength; ) {
    const length = view.getUint32(off, true);
    const type = view.getUint32(off + 4, true);
    if (type === 0x004e4942) {
      return createHash('sha1')
        .update(buf.subarray(off + 8, off + 8 + length))
        .digest('hex');
    }
    off += 8 + length;
  }
  throw new Error(`no binary chunk in ${url}`);
}
