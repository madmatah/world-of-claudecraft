// What a Realm Racers circuit draws one part of a model with.
//
// A circuit instances each model's own glTF geometry (realm_racers_track.ts),
// and three routes decide what that part wears:
//
//  - `worldProp`: the url is one of the world's props (`PROP_ASSET_DEFS`), so
//    the part wears the world's converted material for it (`worldPropMaterial`
//    in props.ts): the same cached object, hence the same programs the world
//    links, with the tier's Lambert substitution, the kit overrides and the
//    worn-detail layer. Its geometry keeps only the attributes the world's
//    extraction keeps, since three keys a program on some of the rest (a
//    four-component colour, tangents, a second uv set). A part the world strips
//    is not drawn.
//  - `worldRaw`: the world draws the model with its raw glTF material too (the
//    garden maze's hedge pieces, garden_features.ts), so the circuit does the
//    same and shares those programs.
//  - `raceOnly`: nothing in the world draws the model. It keeps its raw
//    material, under a name that says it is the circuit's alone, so a live
//    program report can tell it from the world's.
//
// Everything handed out belongs to a shared cache, never disposed by a caller:
// the dispose core frees neither an instanced geometry nor a material.

import * as THREE from 'three';
import { GARDEN_MAZE_ARCH_URL, GARDEN_MAZE_WALL_URL } from './garden_maze_core';
import { PROP_ASSET_DEFS, worldPropMaterial } from './props';

export type RealmRacersDressingRoute = 'worldProp' | 'worldRaw' | 'raceOnly';

const WORLD_RAW_URLS: ReadonlySet<string> = new Set([GARDEN_MAZE_WALL_URL, GARDEN_MAZE_ARCH_URL]);

let worldPropUrls: ReadonlySet<string> | null = null;

export function realmRacersDressingRoute(url: string): RealmRacersDressingRoute {
  worldPropUrls ??= new Set(Object.values(PROP_ASSET_DEFS).map((def) => def.url));
  if (worldPropUrls.has(url)) return 'worldProp';
  if (WORLD_RAW_URLS.has(url)) return 'worldRaw';
  return 'raceOnly';
}

const raceOnlyMaterials = new WeakMap<THREE.Material, THREE.Material>();

function raceOnlyMaterial(url: string, src: THREE.Material): THREE.Material {
  const known = raceOnlyMaterials.get(src);
  if (known) return known;
  const named = src.clone();
  const file = url.slice(url.lastIndexOf('/') + 1).replace(/\.glb$/, '');
  named.name = `realmRacersRaceOnly:${file}:${src.name}`;
  raceOnlyMaterials.set(src, named);
  return named;
}

/** The attribute set the world's prop extraction keeps (props.ts `propAsset`). */
function worldShaped(geometry: THREE.BufferGeometry): boolean {
  const color = geometry.getAttribute('color');
  if (color && color.itemSize !== 3) return false;
  if (Object.keys(geometry.morphAttributes).length > 0) return false;
  return Object.keys(geometry.attributes).every((name) =>
    ['position', 'normal', 'uv', 'color'].includes(name),
  );
}

const worldShapedGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

function worldShapedGeometry(src: THREE.BufferGeometry): THREE.BufferGeometry {
  if (worldShaped(src)) return src;
  const known = worldShapedGeometries.get(src);
  if (known) return known;
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const attribute = src.getAttribute(name);
    if (attribute) out.setAttribute(name, attribute);
  }
  const color = src.getAttribute('color');
  if (color) {
    const rgb = new Float32Array(color.count * 3);
    for (let i = 0; i < color.count; i++) {
      rgb[i * 3] = color.getX(i);
      rgb[i * 3 + 1] = color.getY(i);
      rgb[i * 3 + 2] = color.getZ(i);
    }
    out.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  }
  out.setIndex(src.getIndex());
  for (const group of src.groups) out.addGroup(group.start, group.count, group.materialIndex);
  out.boundingBox = src.boundingBox;
  out.boundingSphere = src.boundingSphere;
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
  if (route === 'worldRaw') return { geometry, material };
  if (route === 'raceOnly') return { geometry, material: raceOnlyMaterial(url, material) };
  const converted = worldPropMaterial(url, material, geometry.getAttribute('color') !== undefined);
  return converted ? { geometry: worldShapedGeometry(geometry), material: converted } : null;
}
