// THE ground material, as an instanced band sees it.
//
// The material itself lives in `terrain.ts`, where the world's own chunks build
// it and where the release keeps evolving it. This module is the THIN ADAPTER
// that lets a surface which is not a terrain chunk wear the same one: the Mortar Overdrive
// circuit's lawn, and any activity band that follows it, sits far past
// `DUNGEON_X_THRESHOLD` where no chunk is ever built. Before it existed such a
// band hand-rolled a lookalike out of one canvas texture: same maps, none of the
// shading, and visibly not the same ground.
//
// Two things here are the band's own, because terrain has no use for either: a
// flat 1x1 normal map (a band has no macro-relief atlas) and the yards-per-uv
// figure a band needs to reproduce the Lambert tier's detail period off the
// strip-planar uv it does not have.
//
// What a consumer owes the material, since the shader reads all of it:
//   - `aSplat`   vec4 grass/dirt/rock/sand weights, summing to 1
//   - `aExtra`   vec4 marsh mud / snow / impact / impact-core weights
//   - `aTerrainPresenceMask` the packed per-chunk layer-presence mask
//   - `color`    the biome ground tint (authored as a full sRGB colour)
//   - `uv`       for `normalMap`, the macro relief
// A missing attribute is not a soft failure: WebGL hands the shader (0,0,0,1),
// which reads as pure sand under an impact crater.

import * as THREE from 'three';
import {
  type BrushUniforms,
  buildLambertMaterial,
  buildSplatMaterial,
  hasTerrainSplatAssets,
  type SurfaceOrigin,
  TERRAIN_DETAIL_REPEAT,
} from './terrain';

export {
  makeBrushUniforms,
  prepareTerrainProfileAssets,
  ROUGH_GRASS,
  terrainSplatTexture,
} from './terrain';
export type { BrushUniforms, SurfaceOrigin };

/** Whether the real PBR splat photo set resolved. Named for the material rather
 *  than for terrain, because a band gates on it without owning a chunk. */
export function hasGroundSplatAssets(): boolean {
  return hasTerrainSplatAssets();
}

export interface GroundMaterialOptions {
  /** Macro relief. The world bakes a per-zone atlas; a flat band passes a flat
   *  1x1 map, which still keeps USE_NORMALMAP (and so the shader's `tbn`) alive
   *  for the per-layer detail normals. */
  normalMap: THREE.Texture;
  brush: BrushUniforms;
  surfaceOrigin?: SurfaceOrigin;
  /** False skips the unused legacy canvas splats `buildSplatMaterial` paints
   *  only to keep the shared texture random sequence in place: for a caller
   *  painting from its own stream. The material is the same either way. */
  legacySplatDraws?: boolean;
}

/**
 * Yards per uv unit on the Lambert tier. Its detail map is strip-planar: the
 * uv is the world strip normalized to 0..1 and terrain's own repeat lands the
 * map on its authored period. A surface outside the strip sets its own uv to
 * `surfaceLocal / this` and gets the same period rather than a smear.
 *
 * Derived from terrain's exported repeat rather than restating 160/480, so the
 * two cannot drift apart.
 */
const GROUND_DETAIL_PERIOD_YARDS = 2.25;
export const GROUND_DETAIL_UV_YARDS = {
  x: GROUND_DETAIL_PERIOD_YARDS * TERRAIN_DETAIL_REPEAT.x,
  z: GROUND_DETAIL_PERIOD_YARDS * TERRAIN_DETAIL_REPEAT.z,
};

/** A 1x1 flat-normal map, for a surface with no macro relief of its own. */
export function flatNormalTexture(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/**
 * ONE ground material per surface. The world's chunks and an instanced band
 * both build it in terrain.ts, which is what makes "the same ground" true
 * rather than aspirational.
 */
export function buildGroundSplatMaterial(
  options: GroundMaterialOptions,
): THREE.MeshStandardMaterial {
  return buildSplatMaterial(
    options.normalMap,
    options.brush,
    options.surfaceOrigin,
    options.legacySplatDraws ?? true,
  );
}

/** The Lambert tier the same surface takes when the splat set is unavailable. */
export function buildGroundLambertMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  return buildLambertMaterial(brush);
}
