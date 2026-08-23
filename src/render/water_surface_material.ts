// THE water surface, as an instanced band sees it.
//
// The shader itself lives in `water.ts`, whose surfaces come from
// `waterBodies()`, i.e. from the lakes declared on the active content's ZONES.
// An instanced band is not a zone, so it declares no lake and `waterLevelAt` is
// -Infinity across it: the rally's basin would be a flat translucent plane next
// to an Evergarden lake with ripples, shore foam, sun glints and wakes. This
// module is the THIN ADAPTER that hands a band the same material, with its own
// surface origin and, when its circuit theme asks, its own depth palette.
//
// What a consumer owes it, since the shader reads all of it:
//   - `aShoreDepth`  yards of water under this vertex, clamped at the seabed
//   - `aShoreSlope`  the depth gradient, which is what turns depth into a
//                    distance-to-shore and therefore into the foam band
// The wave field (`water_simulation.ts`) is optional: pass `zeroWaveUniforms()`
// and the shader's `uWaveEnabled` branch costs one comparison.

import type * as THREE from 'three';
import { createWaterSurfaceMaterial, type WaterSurfaceOrigin } from './water';
import type { WaterWaveUniforms } from './water_simulation';

export {
  DEEP_COLOR,
  hasWaterShaderAssets,
  prepareWaterProfileAssets,
  SHALLOW_COLOR,
  zeroWaveUniforms,
} from './water';
export type { WaterSurfaceOrigin };

export interface WaterSurfaceMaterialOptions {
  wave: WaterWaveUniforms;
  surfaceOrigin?: WaterSurfaceOrigin;
  /**
   * Fades the surface to nothing where the baked depth reaches zero, so the
   * WATERLINE follows the terrain contour instead of the geometry boundary.
   * The overworld planes leave it off (their rect edges hide under carved
   * bathymetry and the apron); an interior strip or pool laid over its own
   * heightfield turns it on so a rectangular mesh cannot read as a hard-edged
   * sheet.
   */
  shoreEdgeFade?: boolean;
  /**
   * The two ends of the depth ramp, if this surface wants its own.
   *
   * Absent leaves the world's shipped pair, which every overworld body and the
   * shipped rally pools use, so this is invisible until something asks. What
   * asks is a Realm Racers circuit THEME: a coastal circuit's pools have to read
   * as its own sea rather than as the Evergarden's pond, and the colour ramp is
   * the whole of that difference (the ripples, the fresnel and the foam are the
   * same water everywhere, deliberately).
   */
  deep?: THREE.Color;
  shallow?: THREE.Color;
}

/**
 * ONE material per water view, shared by every surface in it, so the wave
 * field's uniform objects (held by reference, like uTime) drive all of them.
 */
export function buildWaterSurfaceMaterial(
  options: WaterSurfaceMaterialOptions,
): THREE.ShaderMaterial {
  return createWaterSurfaceMaterial(options.wave, {
    shoreEdgeFade: options.shoreEdgeFade,
    surfaceOrigin: options.surfaceOrigin,
    deep: options.deep,
    shallow: options.shallow,
  });
}
