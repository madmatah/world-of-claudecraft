// What a Realm Racers circuit draws one part of a model with.
//
// A circuit instances each model's own glTF geometry (realm_racers_track.ts),
// and four routes decide what that part wears:
//
//  - `worldProp`: the url is one of the world's props (`PROP_ASSET_DEFS`), so
//    the part wears the world's converted material for it (`worldPropMaterial`
//    in props.ts), the same cached object, with the tier's Lambert
//    substitution, the kit overrides and the worn-detail layer. Its geometry is
//    shaped as the world's extraction shapes it (the attribute set three keys a
//    program on, normals where the file has none, the atlas cell fix). That
//    shares the world's programs only where the world draws the key at the
//    current tier: on low it draws, and prewarms, `LOW_TIER_PROP_KEYS` alone.
//    A part the world strips is not drawn.
//  - `worldKit`: the url is baked into one of the world's env-prop templates
//    (`IGNIVAR_ENV_PROP_URLS`: the Forgefather fortress kit and the Drakelands
//    rebuild kit), so the circuit draws that template itself, geometry and
//    material, instead of the file: the same objects the Wyrmwatch, Last Keep
//    and fortress draws instance, graded, re-seated and turned as the world has
//    them (`realmRacersWorldKitPart`). The street lamp is the one entry left out,
//    because the world lights its instances through streetlamps.ts.
//  - `worldRaw`: the world draws the model with its raw glTF material too (the
//    garden maze's hedge pieces, garden_features.ts, and the ember zone's lava,
//    hoard, clutch and lily, ember_features.ts), so the circuit does the same
//    and shares those programs.
//  - `raceOnly`: nothing in the world draws the model as a circuit can, either
//    because no world module draws it or because the world splits its parts per
//    UV family (`worldPropSplitsBySurface`). It keeps its raw material, under a
//    name that says it is the circuit's alone, so a live program report can
//    tell it from the world's.
//
// Everything handed out belongs to a shared cache, never disposed by a caller:
// the dispose core frees neither an instanced geometry nor a material.

import * as THREE from 'three';
import { EMBER_PROP_URLS } from './ember_prop_urls';
import { GARDEN_MAZE_ARCH_URL, GARDEN_MAZE_WALL_URL } from './garden_maze_core';
import {
  type IgnivarEnvPropTemplate,
  ignivarEnvPropKeyOfUrl,
  ignivarEnvPropTemplate,
} from './ignivar_env_props';
import { cloneMaterialWithHooks } from './material_clone_hooks';
import {
  applyUvCellFix,
  type PropKey,
  worldPropHasUvCellFix,
  worldPropKey,
  worldPropMaterial,
  worldPropSplitsBySurface,
} from './props';

export type RealmRacersDressingRoute = 'worldProp' | 'worldKit' | 'worldRaw' | 'raceOnly';

const WORLD_RAW_URLS: ReadonlySet<string> = new Set([
  GARDEN_MAZE_WALL_URL,
  GARDEN_MAZE_ARCH_URL,
  ...Object.values(EMBER_PROP_URLS),
]);

function worldKitKey(url: string) {
  const key = ignivarEnvPropKeyOfUrl(url);
  return key === 'street_lamp' ? undefined : key;
}

export function realmRacersDressingRoute(url: string): RealmRacersDressingRoute {
  const key = worldPropKey(url);
  if (key !== undefined && !worldPropSplitsBySurface(key)) return 'worldProp';
  if (worldKitKey(url) !== undefined) return 'worldKit';
  if (WORLD_RAW_URLS.has(url)) return 'worldRaw';
  return 'raceOnly';
}

/**
 * The world's own template for a `worldKit` url, or null while it has not
 * landed (it loads in the deferred lane at world entry, so only a host that
 * never opened that lane, or a failed file, asks before it has).
 */
export function realmRacersWorldKitPart(url: string): IgnivarEnvPropTemplate | null {
  const key = worldKitKey(url);
  return key === undefined ? null : ignivarEnvPropTemplate(key);
}

const raceOnlyMaterials = new WeakMap<THREE.Material, THREE.Material>();

function raceOnlyMaterial(url: string, src: THREE.Material): THREE.Material {
  const known = raceOnlyMaterials.get(src);
  if (known) return known;
  const named = cloneMaterialWithHooks(src);
  const file = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
  named.name = `realmRacersRaceOnly:${file}:${src.name}`;
  raceOnlyMaterials.set(src, named);
  return named;
}

/** Already the shape the world's extraction would give (props.ts `propAsset`). */
function worldShaped(geometry: THREE.BufferGeometry, key: PropKey): boolean {
  if (worldPropHasUvCellFix(key)) return false;
  if (!geometry.getAttribute('normal') || !geometry.getAttribute('uv')) return false;
  const color = geometry.getAttribute('color');
  if (color && color.itemSize !== 3) return false;
  if (Object.keys(geometry.morphAttributes).length > 0) return false;
  return Object.keys(geometry.attributes).every((name) =>
    ['position', 'normal', 'uv', 'color'].includes(name),
  );
}

function floatCopy(
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  itemSize: number,
): THREE.BufferAttribute {
  const out = new Float32Array(attribute.count * itemSize);
  for (let i = 0; i < attribute.count; i++) {
    out[i * itemSize] = attribute.getX(i);
    if (itemSize > 1) out[i * itemSize + 1] = attribute.getY(i);
    if (itemSize > 2) out[i * itemSize + 2] = attribute.getZ(i);
  }
  return new THREE.BufferAttribute(out, itemSize);
}

const worldShapedGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function worldShapedGeometry(src: THREE.BufferGeometry, key: PropKey): THREE.BufferGeometry {
  if (worldShaped(src, key)) return src;
  const known = worldShapedGeometries.get(src);
  if (known) return known;
  const out = new THREE.BufferGeometry();
  const position = src.getAttribute('position');
  out.setAttribute('position', position);
  const normal = src.getAttribute('normal');
  if (normal) out.setAttribute('normal', normal);
  const uv = src.getAttribute('uv');
  if (uv && !worldPropHasUvCellFix(key)) out.setAttribute('uv', uv);
  else
    out.setAttribute(
      'uv',
      uv ? floatCopy(uv, 2) : new THREE.BufferAttribute(new Float32Array(position.count * 2), 2),
    );
  const color = src.getAttribute('color');
  if (color) out.setAttribute('color', floatCopy(color, 3));
  out.setIndex(src.getIndex());
  for (const group of src.groups) out.addGroup(group.start, group.count, group.materialIndex);
  applyUvCellFix(out, key);
  if (!normal) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  worldShapedGeometries.set(src, out);
  return out;
}

/**
 * What one part of the model at `url` draws with, resolved through the route
 * above, or null for a part the world strips.
 */
export function realmRacersDressingPart(
  url: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  const route = realmRacersDressingRoute(url);
  // A kit file's own parts are never drawn: the template replaces the model.
  if (route === 'worldKit') return null;
  if (route === 'worldRaw') return { geometry, material };
  if (route === 'raceOnly') return { geometry, material: raceOnlyMaterial(url, material) };
  const key = worldPropKey(url) as PropKey;
  const converted = worldPropMaterial(key, material, geometry.getAttribute('color') !== undefined);
  return converted ? { geometry: worldShapedGeometry(geometry, key), material: converted } : null;
}
