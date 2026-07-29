// Ground for an INSTANCED BAND: the flat plane an activity is built on, far
// past DUNGEON_X_THRESHOLD, where no terrain chunk is ever built.
//
// Such a band cannot use `terrain.ts`, which chunks a fixed world rectangle and
// samples the heightfield. What it CAN use, and what this module hands it, is
// the world's own ground material (`ground_material.ts`), so a lawn out here
// wears the same six-layer PBR splat, the same detail normals and the same
// macro breakup as a lawn in the Evergarden. Before this, a band painted one
// canvas albedo on a plane: identical textures, none of the shading, and
// visibly not the same ground.
//
// The contract a caller signs, and the reason for it:
//
//   **Ground geometry is authored in WORLD coordinates on the XZ plane, and its
//   mesh sits at identity.**
//
// The material's shader takes the world position through `modelMatrix` and
// reads the object normal as the world normal (the terrain mesh is untransformed
// and the shader says so). A surface built in some local frame and rotated into
// place at draw time would hand it a normal pointing sideways. Building the
// geometry already placed costs nothing and keeps one assumption for both
// callers.

import * as THREE from 'three';
import { GFX } from './gfx';
import {
  buildGroundLambertMaterial,
  buildGroundSplatMaterial,
  flatNormalTexture,
  GROUND_DETAIL_UV_YARDS,
  hasGroundSplatAssets,
  makeBrushUniforms,
  type SurfaceOrigin,
} from './ground_material';
import { BIOME_PALETTE } from './terrain_palette';
import { terrainSplatPresence, terrainSplatPresenceMask } from './terrain_splat_presence_core';

/** Which splat layer a surface is made of. The weights are constant per
 *  surface: a band is flat, so there is no slope or height to blend from. */
export type GroundLayer = 'grass' | 'dirt' | 'rock' | 'sand';

const LAYER_INDEX: Record<GroundLayer, number> = { grass: 0, dirt: 1, rock: 2, sand: 3 };

/**
 * The ground material for one instanced band, on the same tier arm the world's
 * terrain takes. The macro-relief atlas is world-baked and means nothing out
 * here, so the band passes a flat normal map: it contributes nothing while
 * keeping USE_NORMALMAP (and with it the shader's `tbn`) alive for the per-layer
 * detail normals, which are the half of the look that actually reads on a flat
 * surface.
 */
export function buildInstanceGroundMaterial(origin: SurfaceOrigin): THREE.Material {
  const brush = makeBrushUniforms();
  return GFX.terrainSplat && hasGroundSplatAssets()
    ? buildGroundSplatMaterial({ normalMap: flatNormalTexture(), brush, surfaceOrigin: origin })
    : buildGroundLambertMaterial(brush);
}

/**
 * Gives a world-space XZ surface everything the ground material reads: the
 * splat weights, the (all-zero) extras, the biome tint, and a strip-planar uv
 * so the Lambert tier's detail map lands on its authored period out here too.
 *
 * Mutates and returns `geo`, the way three.js's own geometry helpers do.
 */
export function paintInstanceGround(
  geo: THREE.BufferGeometry,
  origin: SurfaceOrigin,
  layer: GroundLayer,
  tint: number,
): THREE.BufferGeometry {
  const position = geo.getAttribute('position');
  const count = position.count;
  const splat = new Float32Array(count * 4);
  // No mud, no snow, no impact crater. Left explicit rather than absent: an
  // unset attribute is (0, 0, 0, 1) to WebGL, and that last 1 is the crater.
  const extra = new Float32Array(count * 4);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const index = LAYER_INDEX[layer];
  const colour = new THREE.Color(tint);
  for (let i = 0; i < count; i++) {
    splat[i * 4 + index] = 1;
    colors[i * 3] = colour.r;
    colors[i * 3 + 1] = colour.g;
    colors[i * 3 + 2] = colour.b;
    uvs[i * 2] = (position.getX(i) - origin.x) / GROUND_DETAIL_UV_YARDS.x;
    uvs[i * 2 + 1] = (position.getZ(i) - origin.z) / GROUND_DETAIL_UV_YARDS.z;
  }
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.setAttribute('aExtra', new THREE.BufferAttribute(extra, 4));
  // Layer presence, derived from the weights just written rather than from the
  // layer name, so the two can never disagree. The shader skips a layer whose
  // bit is 0, and an unsupplied attribute reads as 0: leaving this out culls
  // the one layer the surface HAS and the band draws as a bare brown plane.
  const presence = new Uint8Array(count);
  presence.fill(terrainSplatPresenceMask(terrainSplatPresence(splat, extra)));
  geo.setAttribute('aTerrainPresenceMask', new THREE.BufferAttribute(presence, 1));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return geo;
}

/** A biome's ground tint, for a band dressing itself as somewhere real. */
export function biomeGroundTint(biome: keyof typeof BIOME_PALETTE): {
  grass: number;
  dirt: number;
  sand: number;
} {
  const palette = BIOME_PALETTE[biome];
  return { grass: palette.grass, dirt: palette.dirt, sand: palette.sand };
}
