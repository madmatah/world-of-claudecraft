// A headless stand-in for GLTFLoader's scene of a shipped GLB: one mesh per
// primitive, with the material KIND and SLOTS GLTFLoader would build from the
// file's own JSON (texture presence per slot and its uv channel, alpha mode,
// double-sidedness, vertex colours, unlit and physical extensions, flat
// shading without normals; a KHR_texture_transform texCoord override is not
// mirrored), and one-triangle geometries carrying the primitive's attribute
// set. Textures are 1x1 stand-ins: a program key reads slot presence, never
// pixels, so the keys three would give the real scene come out the same where
// it matters for a prepared-vs-drawn comparison. KTX2 payloads never decode in
// Node, which is why a mirror rather than the real loader.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';

interface GltfTextureRef {
  index: number;
  texCoord?: number;
}

interface GltfMaterial {
  pbrMetallicRoughness?: {
    baseColorTexture?: GltfTextureRef;
    metallicRoughnessTexture?: GltfTextureRef;
  };
  normalTexture?: GltfTextureRef;
  occlusionTexture?: GltfTextureRef;
  emissiveTexture?: GltfTextureRef;
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided?: boolean;
  extensions?: Record<string, unknown>;
}

interface GltfJson {
  meshes?: { primitives: { attributes: Record<string, number>; material?: number }[] }[];
  materials?: GltfMaterial[];
  accessors?: { type: string }[];
}

const PHYSICAL_EXTENSIONS = [
  'KHR_materials_clearcoat',
  'KHR_materials_sheen',
  'KHR_materials_transmission',
  'KHR_materials_volume',
  'KHR_materials_ior',
  'KHR_materials_specular',
  'KHR_materials_iridescence',
  'KHR_materials_anisotropy',
  'KHR_materials_dispersion',
];

function readGlbJson(path: string): GltfJson {
  const bytes = readFileSync(path);
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')) as GltfJson;
}

/** A stand-in on the slot's uv channel: GLTFLoader.assignTexture moves a
 *  texture with `texCoord > 0` onto that channel, which three keys. */
const stubTexture = (ref?: GltfTextureRef): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  if (ref?.texCoord !== undefined && ref.texCoord > 0) texture.channel = ref.texCoord;
  texture.needsUpdate = true;
  return texture;
};

function mirrorMaterial(def: GltfMaterial | undefined, vertexColors: boolean, flat: boolean) {
  const extensions = def?.extensions ?? {};
  const material: THREE.MeshStandardMaterial | THREE.MeshBasicMaterial =
    'KHR_materials_unlit' in extensions
      ? new THREE.MeshBasicMaterial()
      : PHYSICAL_EXTENSIONS.some((name) => name in extensions)
        ? new THREE.MeshPhysicalMaterial()
        : new THREE.MeshStandardMaterial();
  const pbr = def?.pbrMetallicRoughness;
  if (pbr?.baseColorTexture) material.map = stubTexture(pbr.baseColorTexture);
  // GLTFLoader gives an unlit (MeshBasicMaterial) glTF material its base
  // colour alone: no metal-rough, normal, occlusion or emissive slot.
  if (material instanceof THREE.MeshStandardMaterial) {
    if (pbr?.metallicRoughnessTexture) {
      const texture = stubTexture(pbr.metallicRoughnessTexture);
      material.roughnessMap = texture;
      material.metalnessMap = texture;
    }
    if (def?.normalTexture) material.normalMap = stubTexture(def.normalTexture);
    if (def?.occlusionTexture) material.aoMap = stubTexture(def.occlusionTexture);
    if (def?.emissiveTexture) material.emissiveMap = stubTexture(def.emissiveTexture);
    material.flatShading = flat;
  }
  if (def?.alphaMode === 'BLEND') {
    material.transparent = true;
    material.depthWrite = false;
  } else if (def?.alphaMode === 'MASK') {
    material.alphaTest = def.alphaCutoff ?? 0.5;
  }
  if (def?.doubleSided) material.side = THREE.DoubleSide;
  material.vertexColors = vertexColors;
  return material;
}

/** The mirrored scene of the GLB served at `url` (a `/models/...` path). */
export function mirrorGltfScene(url: string, publicDir: string): THREE.Group {
  const json = readGlbJson(`${publicDir}${url}`);
  const scene = new THREE.Group();
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives) {
      const geometry = new THREE.BufferGeometry();
      const attributes = primitive.attributes;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3),
      );
      if ('NORMAL' in attributes) {
        geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(9), 3));
      }
      for (const [channel, name] of ['uv', 'uv1', 'uv2', 'uv3'].entries()) {
        if (`TEXCOORD_${channel}` in attributes) {
          geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(6), 2));
        }
      }
      if ('TANGENT' in attributes) {
        geometry.setAttribute('tangent', new THREE.BufferAttribute(new Float32Array(12), 4));
      }
      const colorAccessor = attributes.COLOR_0;
      if (colorAccessor !== undefined) {
        const size = json.accessors?.[colorAccessor]?.type === 'VEC4' ? 4 : 3;
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * size), size));
      }
      const def =
        primitive.material === undefined ? undefined : json.materials?.[primitive.material];
      scene.add(
        new THREE.Mesh(
          geometry,
          mirrorMaterial(def, colorAccessor !== undefined, !('NORMAL' in attributes)),
        ),
      );
    }
  }
  return scene;
}
