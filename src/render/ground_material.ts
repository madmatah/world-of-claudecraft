// THE ground material: the PBR splat shading every walkable surface in the
// world wears, plus the Lambert tier that stands in for it on low.
//
// It lived inside `terrain.ts` and was therefore only reachable by the world's
// own chunks. Instanced bands (the rally circuit, and any activity that follows
// it) sit far past `DUNGEON_X_THRESHOLD`, outside every terrain chunk, so they
// had to hand-roll a lookalike out of one canvas texture: same maps, none of
// the shading, and visibly not the same ground. The material now lives here and
// both callers build it (`terrain.ts` for the world, `instance_surface.ts` for
// a band), which is what makes "the same ground" true rather than aspirational.
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
import { WATER_LEVEL } from '../sim/world';
import { loadTexture } from './assets/loader';
import { GFX, type GfxSettings, SUN_DIR } from './gfx';
import { renderLayerDisabled } from './render_dev_flags';
import { groundDetailTexture, groundSplatMaps, macroNoiseTexture } from './textures';

// The terrain relief ladder (GFX.terrainRelief, one source for the tier
// ladder and the Advanced Terrain Detail dial): 0 none (medium and below),
// 1 cavity shading only (high), 2 adds the parallax walk (Advanced), 3 adds
// the parallax walk plus micro sun-shadow (ultra/insane). ?trelief=off is the
// dev perf-attribution kill switch (render_dev_flags.ts).
const terrainReliefLevel = (): number => (renderLayerDisabled('trelief') ? 0 : GFX.terrainRelief);

// The rich splat-albedo profile (multi-octave grass/dirt/rock, wall plate
// mixes, fine detail-normal octaves) rides the relief gate: together they are
// what doubled the terrain fragment's tap count over the merge base, and the
// round-10 medium ladder measured that as -15..-33% on the tier with the
// least PBR frame budget. The no-relief tiers keep a single-octave splat
// close to the pre-overhaul look. ?talbedo=off forces the simple profile at
// any tier (dev perf attribution).
const richTerrainSplat = (): boolean =>
  terrainReliefLevel() >= 1 && !renderLayerDisabled('talbedo');
// ---------------------------------------------------------------------------
// Real PBR splat layers (ambientCG 1K, shipped under public/textures/terrain).
// Registered with the deferred preload gate at module import, so the launcher
// does not fetch them before world entry and consumers still see resolved
// textures when they build their materials.
// ---------------------------------------------------------------------------

const TERRAIN_TEX: Record<string, THREE.Texture> = {};
const terrainTexTasks = new Map<string, Promise<void>>();
const ALBEDO_ANISOTROPY = 8;
/** Shared with terrain.ts's macro-relief atlas: one normal-map anisotropy. */
export const GROUND_NORMAL_ANISOTROPY = 4;
const NORMAL_ANISOTROPY = GROUND_NORMAL_ANISOTROPY;

function prepareTerrainTex(key: string, file: string, srgb: boolean): Promise<void> {
  if (TERRAIN_TEX[key]) return Promise.resolve();
  const existing = terrainTexTasks.get(key);
  if (existing) return existing;
  const task = loadTexture(`/textures/terrain/${file}`, { srgb, repeat: true })
    .then((tex) => {
      tex.anisotropy = srgb ? ALBEDO_ANISOTROPY : NORMAL_ANISOTROPY;
      TERRAIN_TEX[key] = tex;
    })
    .catch((err) => {
      terrainTexTasks.delete(key);
      throw err;
    });
  terrainTexTasks.set(key, task);
  return task;
}

/**
 * Prepare the terrain texture channel selected by an explicit target profile.
 * ~15MB of JPEGs, so it is skipped whenever the target is a Lambert tier.
 * terrain.ts owns the deferred registration (it is the module the preload
 * gate names); this module owns the textures the ground material samples.
 */
export function prepareTerrainProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  if (!target.terrainSplat) return Promise.resolve();
  const tasks = [
    prepareTerrainTex('grassC', 'Grass001_Color.jpg', true),
    prepareTerrainTex('grassN', 'Grass001_NormalGL.jpg', false),
    // Ground023 (leaf-littered packed earth), not Ground048: at the splat tile
    // scale 048 is one uniform high-frequency crumble (measured large/fine
    // luminance-std ratio 0.21, saturation 0.39, R/G 1.35) and paths read as
    // pink carpet. 023 carries real medium-scale features (ratio 0.47), an
    // earthier desaturated hue (R/G 1.15, saturation 0.26), a clean row/col
    // variance ratio (1.34, no corduroy) and a usable AO map (sd 0.117).
    prepareTerrainTex('dirtC', 'Ground023_Color.jpg', true),
    prepareTerrainTex('dirtN', 'Ground023_NormalGL.jpg', false),
    // Rock026 (fractured cliff plates), not Rock051: Rock051's striations are
    // directional (anisotropy 2.57), and wall-projecting them at one scale is
    // what gave mountainsides the vertical corduroy. Rock051 stays on disk for
    // voxel_terrain.
    prepareTerrainTex('rockC', 'Rock026_Color.jpg', true),
    prepareTerrainTex('rockN', 'Rock026_NormalGL.jpg', false),
    prepareTerrainTex('sandC', 'Ground080_Color.jpg', true),
    prepareTerrainTex('sandN', 'Ground080_NormalGL.jpg', false),
    prepareTerrainTex('mudC', 'Ground071_Color.jpg', true),
    prepareTerrainTex('snowC', 'Snow010A_Color.jpg', true),
    // The packs' relief channels, packed offline into one RGBA texture by
    // scripts/assets/pack_ground_ao.mjs (R grass AO, G dirt AO, B rock height,
    // A sand AO): one sampler instead of four keeps the splat material under
    // the 16-sampler fragment limit. B is a Rock026+Rock060 displacement blend,
    // not an AO map: Rock026's authored AO is near-white, and displacement is
    // the honest cavity signal for the new rocks. Linear data: cavity = dark,
    // open surface = bright.
    prepareTerrainTex('groundAO', 'GroundAO_Packed.png', false),
  ];
  return Promise.all(tasks).then(() => undefined);
}

export function hasGroundSplatAssets(): boolean {
  return Boolean(
    TERRAIN_TEX.grassC &&
      TERRAIN_TEX.grassN &&
      TERRAIN_TEX.dirtC &&
      TERRAIN_TEX.dirtN &&
      TERRAIN_TEX.rockC &&
      TERRAIN_TEX.rockN &&
      TERRAIN_TEX.sandC &&
      TERRAIN_TEX.sandN &&
      TERRAIN_TEX.mudC &&
      TERRAIN_TEX.snowC &&
      TERRAIN_TEX.groundAO,
  );
}

/** Narrow read of the loaded grass splat layers for interiors that reuse the
 *  overworld ground look (the Wildheart Basin floor). Undefined until the
 *  boot preload resolves; callers must fall back to their own material. */
export function terrainSplatTexture(key: 'grassC' | 'grassN'): THREE.Texture | undefined {
  return TERRAIN_TEX[key];
}

// Per-layer constant roughness, eyeballed from the packs' roughness-map means
// (saves four samplers vs. real roughness maps; terrain is never glossy
// enough for the difference to read at gameplay camera distance).
// ROUGH_GRASS is exported for interiors sharing the grass albedo.
export const ROUGH_GRASS = 0.8;
const ROUGH_DIRT = 0.95; // raised with the gravel blend: packed trail grit, not smooth paint
const ROUGH_ROCK = 0.75;
const ROUGH_SAND = 0.85;
const ROUGH_MUD = 0.62; // wet sheen
const ROUGH_SNOW = 0.72;

// Editor brush cursor: a soft additive ring projected onto the ground in world
// XZ space, injected into BOTH terrain materials so it reads identically on the
// splat and Lambert tiers. One shared uniform-value set per terrain view; the
// uniform objects are installed once at material build (onBeforeCompile) and
// per-frame updates only write .value, never rebuild a material. Radius 0
// disables (the default), so the shipped game pays one uniform branch and
// nothing else.
export interface BrushUniforms {
  uBrushCenter: { value: THREE.Vector2 };
  uBrushRadius: { value: number };
  uBrushColor: { value: THREE.Color };
}

export function makeBrushUniforms(): BrushUniforms {
  return {
    uBrushCenter: { value: new THREE.Vector2(0, 0) },
    uBrushRadius: { value: 0 },
    uBrushColor: { value: new THREE.Color(0x6fd2ff) },
  };
}

// Two smoothsteps: a feathered rise to the radius and a feathered fall past it.
const BRUSH_RING_GLSL = /* glsl */ `
uniform vec2 uBrushCenter;
uniform float uBrushRadius;
uniform vec3 uBrushColor;
vec3 wocBrushRing(vec2 p) {
  if (uBrushRadius <= 0.0) return vec3(0.0);
  float d = distance(p, uBrushCenter);
  float w = max(0.28, uBrushRadius * 0.055);
  float ring = smoothstep(uBrushRadius - w, uBrushRadius, d)
             * (1.0 - smoothstep(uBrushRadius, uBrushRadius + w, d));
  return uBrushColor * ring * 1.35;
}
`;

// Fragment-only relief for the splat ground: offset parallax plus a cavity
// shading term, both driven by the packs' authored AO maps (packed offline
// into one RGBA texture: R grass, G dirt, B rock, A sand). Vertex
// displacement is deliberately not an option here, at any amplitude: selection
// rings, feet placement and water shorelines all sample the analytic height
// field in src/sim, and moving the visual mesh off it breaks them.
//
// The previous proxy used splat albedo luminance centred on 0.45, but the
// albedo samplers are sRGB, so the shader receives LINEAR values whose real
// means are 0.06-0.18. The 0.28-0.39 DC bias ate the whole parallax clamp:
// at the default chase-camera pitch, dirt and rock produced a constant UV
// slide with zero relief modulation. The AO channels below are centred on
// their measured means instead, so the signal is zero-mean by construction.
// and mip averaging returns it to zero with distance, fading both parallax
// and cavity out for free.
// One clod-scale step toward the sun in ground-UV space, inlined into the
// micro-shadow branch at material build (tuv = xz * 0.22 maps +uv straight
// onto +world-xz, so the sun azimuth needs no basis change).
const SUN_UV_STEP = (() => {
  const h = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1;
  return {
    x: ((SUN_DIR.x / h) * 0.016).toFixed(5),
    y: ((SUN_DIR.z / h) * 0.016).toFixed(5),
  };
})();

const GROUND_RELIEF_GLSL = /* glsl */ `
// Per-layer parallax amplitudes (replacing the one global WOC_PARALLAX_SCALE
// 0.16): one amplitude across height fields with different contrast means the
// weak layers show nothing, because effective depth = amplitude x channel sd.
// Measured sds of GroundAO_Packed (remeasured from the shipped 512px file):
// R grass 0.0775, G dirt 0.1168, B rock 0.1136, A sand 0.0559. Each
// amplitude below = target depth / sd, so one sd of a layer's height signal
// walks the projection by that layer's TARGET depth (UV units): grass 0.010
// (soft turf, gentle tussocks), dirt 0.022 (clods and stones stand up),
// rock 0.026 (strongest), sand 0.006 (subtle). The old global scale handed
// grass 0.007 effective and dirt 0.019, so "height maps on grass" read flat.
const vec4 WOC_PARALLAX_AMP = vec4(0.129, 0.188, 0.229, 0.107);
const float WOC_PARALLAX_CLAMP = 0.04;   // UV units, ~0.18 world (radial, see pOff)
float wocGroundHeight(vec2 uv, vec4 sw) {
  // The presence varyings are constant for the entire chunk draw. Skipping a
  // projection is therefore coherent, and only happens when every source
  // vertex for that layer is exactly zero.
  vec4 aoBase = vec4(0.812, 0.0, 0.0, 0.883);
  float aoDirt = 0.897;
  float aoRock = 0.623;
  if ( vTerrainSplatPresence.x > 0.5 || vTerrainSplatPresence.w > 0.5 )
    aoBase = texture2D(uGroundAO, uv);      // grass + sand share the base tiling
  if ( vTerrainSplatPresence.y > 0.5 )
    aoDirt = texture2D(uGroundAO, uv * 0.55).g;
  if ( vTerrainSplatPresence.z > 0.5 )
    aoRock = texture2D(uGroundAO, uv * 0.6).b;
  // means measured by scripts/assets/pack_ground_ao.mjs; B (rock) is the
  // Rock026/Rock060 displacement blend, centred like the AO channels so the
  // signal stays zero-mean and mips fade it out with distance
  return (aoBase.r - 0.812) * sw.x
       + (aoDirt - 0.897) * sw.y
       + (aoRock - 0.623) * sw.z
       + (aoBase.a - 0.883) * sw.w;
}
// The PARALLAX height field, distinct from the shading field above: sampled
// at a forced-coarse mip so the offset varies smoothly across neighbouring
// fragments. Full-resolution height made each pixel walk its UVs by a
// different amount, and that incoherent warp is exactly the "melted /
// blurry ground" artifact: the eye needs nearby offsets to agree before it
// reads them as one clod standing up. ~lod 2.5 of the 512px field keeps
// clod-scale lumps (~14px features) and discards the per-texel jitter.
const float WOC_PARALLAX_LOD = 2.5;
float wocGroundHeightSmooth(vec2 uv, vec4 sw) {
  vec4 aoBase = vec4(0.812, 0.0, 0.0, 0.883);
  float aoDirt = 0.897;
  float aoRock = 0.623;
  if ( vTerrainSplatPresence.x > 0.5 || vTerrainSplatPresence.w > 0.5 )
    aoBase = textureLod(uGroundAO, uv, WOC_PARALLAX_LOD);
  if ( vTerrainSplatPresence.y > 0.5 )
    aoDirt = textureLod(uGroundAO, uv * 0.55, WOC_PARALLAX_LOD).g;
  if ( vTerrainSplatPresence.z > 0.5 )
    aoRock = textureLod(uGroundAO, uv * 0.6, WOC_PARALLAX_LOD).b;
  return (aoBase.r - 0.812) * sw.x
       + (aoDirt - 0.897) * sw.y
       + (aoRock - 0.623) * sw.z
       + (aoBase.a - 0.883) * sw.w;
}
// Coarse soil-clump octave, one repeat per ~28 yards. The fine cavity above
// lives at the texture's native tiling, where mip averaging pulls it to zero
// within chase-camera distance. This octave's features are ~6x larger, so
// they keep shading the mid-field where the player actually looks. Uses the
// dirt channel for every layer: grass's own AO is the weakest of the pack
// (measured sd 0.078 vs dirt 0.117), and BSL-style ground reads come from
// soil structure under the grass, not from the grass sheet itself.
float wocGroundMacroRelief(vec2 uv) {
  return texture2D(uGroundAO, uv * 0.16).g - 0.897;
}
// --- ground-variety tuning knobs (smoother patches, more uncorrelated octaves)
// WOC_MACRO_SHADE_AMP: amplitude of the ~28yd soil-clump shade octave in the
// groundShade term. Grass takes it at (0.5 + grassWeight * 0.5), so full
// amplitude on meadows and half elsewhere. 2.4 (was 4.2): roughly halves the
// dark lush-patch swing that read as harsh blotches from above.
const float WOC_MACRO_SHADE_AMP = 2.4;
// WOC_MACRO_SHADE_KNEE: rational soft-knee divisor applied to that macro term
// (x / (1 + |x| * knee)). 0 is linear; higher compresses deep troughs sooner.
// This replaces the old hard clamp rails as the patch-edge shaper: the clamp
// turned every deep trough into a flat near-black plateau with a hard edge,
// the knee feathers the same patch over yards instead.
const float WOC_MACRO_SHADE_KNEE = 1.2;
// WOC_GRASS_SCALE_JITTER: ground-UV amplitude of the ~36yd two-channel drift
// field applied per grass octave (fine +1.0x, coarse -0.6x, mid +0.8x). Each
// octave slides a different amount and sign, so their tiling repeats de-phase
// across the map and never settle into one fixed cadence.
const float WOC_GRASS_SCALE_JITTER = 0.6;
// WOC_GRASS_MID_OCTAVE: blend weight of the third grass octave (0.57x scale,
// rotated 23 degrees, own seed offset). 0.22 (was 0.14): the de-spot pass
// moved tonal contrast off the fine octave onto the mid/coarse pair, so the
// mid voice earns real weight now. Still the smallest of the three, it must
// never form patches of its own.
const float WOC_GRASS_MID_OCTAVE = 0.22;
// WOC_GRASS_HUE_DRIFT_FREQ and the endpoints: ~42yd meadow hue rotation
// between warm yellow-green and cool blue-green, a few percent either way.
// Both endpoints average ~1.0 so the drift is value-neutral: it can never
// read as light/dark patching, only as hue you feel across a field.
const float WOC_GRASS_HUE_DRIFT_FREQ = 0.024;
const vec3 WOC_GRASS_HUE_WARM = vec3(1.035, 1.012, 0.955);
const vec3 WOC_GRASS_HUE_COOL = vec3(0.968, 0.995, 1.042);
// WOC_COMB_*: combed-turf anisotropy. The finest grass detail (the fine
// albedo octave, the blade normal, the 3x fine-soft grain) samples through a
// locally-rotating anisotropic transform: features stretch 1/COMPRESS
// (~2.4x) along a direction whose angle swings with the existing macro noise
// (~17yd field, SWING radians across its range). Close-up grass reads as
// brushed growth with directional grain, patchy streaks, instead of the
// isotropic dot-scale stipple that read as spots.
const float WOC_COMB_FREQ = 0.058;
const float WOC_COMB_SWING = 3.4;
const float WOC_COMB_COMPRESS = 0.42;
// Grass height-shade (the worn_stone round-7 idiom): the packed R channel's
// sd-normalized tussock height, clamped at +-1.5 sd, darkens and slightly
// saturates recesses so turf relief reads head-on where a grazing-angle
// parallax offset does nothing. Sampled through the comb transform so the
// shading grain runs with the growth direction, not as dots.
const float WOC_GRASS_H_MEAN = 0.812;   // measured R-channel mean
const float WOC_GRASS_H_INV_SD = 12.9;  // 1 / measured R-channel sd 0.0775
const float WOC_GRASS_HEIGHT_SHADE = 0.10;
const float WOC_GRASS_RECESS_SAT = 0.12;
`;

/**
 * Where the material's texture and noise frame is anchored, in world xz.
 *
 * Every sampling coordinate is taken RELATIVE to this, and the subtraction runs
 * in the vertex shader, because an instanced band sits around x = 113_700 and a
 * highp float only resolves about 7mm there. Feeding that straight into
 * `worldXZ * 0.22` quantizes the albedo lookup to well over a texel and the
 * ground reads as stair-stepped; feeding it into the foam's `sin(x * 1.2)`
 * loses the argument entirely.
 *
 * The world's own terrain passes (0, 0), where the subtraction is exact and the
 * shader is the one it has always been.
 */
export interface SurfaceOrigin {
  x: number;
  z: number;
}

const WORLD_SURFACE_ORIGIN: SurfaceOrigin = { x: 0, z: 0 };

export interface GroundMaterialOptions {
  /** Macro relief. The world bakes a per-zone atlas; a flat band passes a flat
   *  1x1 map, which still keeps USE_NORMALMAP (and so the shader's `tbn`) alive
   *  for the per-layer detail normals the patch below adds. */
  normalMap: THREE.Texture;
  brush: BrushUniforms;
  surfaceOrigin?: SurfaceOrigin;
}

/**
 * Yards per uv unit on the Lambert tier. Its detail map is strip-planar: the
 * uv is the world strip normalized to 0..1 and the repeat below lands the map
 * on its authored period. A surface outside the strip sets its own uv to
 * `surfaceLocal / this` and gets the same period rather than a smear.
 */
const GROUND_DETAIL_PERIOD_YARDS = 2.25;
const GROUND_DETAIL_REPEAT_X = 160;
const GROUND_DETAIL_REPEAT_Z = 480;
export const GROUND_DETAIL_UV_YARDS = {
  x: GROUND_DETAIL_PERIOD_YARDS * GROUND_DETAIL_REPEAT_X,
  z: GROUND_DETAIL_PERIOD_YARDS * GROUND_DETAIL_REPEAT_Z,
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
 * both build it here, which is what makes "the same ground" true rather than
 * aspirational.
 */
export function buildGroundSplatMaterial(
  options: GroundMaterialOptions,
): THREE.MeshStandardMaterial {
  const brush = options.brush;
  const origin = options.surfaceOrigin ?? WORLD_SURFACE_ORIGIN;
  // Legacy canvas splats are still generated (result unused): textures.ts
  // shares one LCG across all generators, so dropping this call would shift
  // the look of every texture generated after it (foliage, props, ...).
  groundSplatMaps();
  const macro = macroNoiseTexture();
  const t = TERRAIN_TEX;
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0,
    normalMap: options.normalMap,
    normalScale: new THREE.Vector2(1.15, 1.15),
  });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    Object.assign(sh.uniforms, {
      uSurfaceOrigin: { value: new THREE.Vector2(origin.x, origin.z) },
    });
    Object.assign(sh.uniforms, {
      uGrass: { value: t.grassC },
      uGrassN: { value: t.grassN },
      uDirt: { value: t.dirtC },
      uDirtN: { value: t.dirtN },
      uRock: { value: t.rockC },
      uRockN: { value: t.rockN },
      uSand: { value: t.sandC },
      uSandN: { value: t.sandN },
      uMud: { value: t.mudC },
      uSnow: { value: t.snowC },
      uMacro: { value: macro },
      uGroundAO: { value: t.groundAO },
    });
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec4 aSplat;
        attribute vec4 aExtra;
        attribute float aTerrainPresenceMask;
        varying vec4 vSplat;
        varying vec4 vExtra;
        flat varying vec4 vTerrainSplatPresence;
        flat varying vec2 vTerrainExtraPresence;
        varying vec3 vWPos;
        varying vec2 vSurf;
        varying vec3 vWNorm;
        uniform vec2 uSurfaceOrigin;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vSplat = aSplat;
        vExtra = aExtra;
        vTerrainSplatPresence = mod(
          floor(vec4(aTerrainPresenceMask) / vec4(1.0, 2.0, 4.0, 8.0)), 2.0);
        vTerrainExtraPresence = mod(
          floor(vec2(aTerrainPresenceMask) / vec2(16.0, 32.0)), 2.0);
        vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
        // Anchored HERE, not in the fragment stage: see SurfaceOrigin.
        vSurf = vWPos.xz - uSurfaceOrigin;
        vWNorm = objectNormal; // terrain mesh is untransformed: object == world`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec4 vSplat;
        varying vec4 vExtra;
        flat varying vec4 vTerrainSplatPresence;
        flat varying vec2 vTerrainExtraPresence;
        varying vec3 vWPos;
        varying vec2 vSurf;
        varying vec3 vWNorm;
        uniform sampler2D uGrass, uGrassN, uDirt, uDirtN, uRock, uRockN, uSand, uSandN, uMud, uSnow, uMacro, uGroundAO;
        ${GROUND_RELIEF_GLSL}
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWPos.xz);`,
      )
      .replace(
        '#include <map_fragment>',
        `
        vec2 tuv = vSurf * 0.22;
        bool wocHasGrass = vTerrainSplatPresence.x > 0.5;
        bool wocHasDirt = vTerrainSplatPresence.y > 0.5;
        bool wocHasRock = vTerrainSplatPresence.z > 0.5;
        bool wocHasSand = vTerrainSplatPresence.w > 0.5;
        bool wocHasMud = vTerrainExtraPresence.x > 0.5;
        bool wocHasSnow = vTerrainExtraPresence.y > 0.5;
        // Fragment-side splat reshape: the vertex-interpolated dirt weight
        // crosses triangles linearly, so a path edge is a chain of straight
        // segments that reads as sawtooth triangles the moment shading
        // contrast lands on it. Re-thresholding against AO noise moves the
        // boundary at texel scale instead: crisper, and it wanders like a
        // real worn margin instead of tracing the mesh. The other layers
        // give up weight pro rata so the four still sum to one.
        vec4 vSplatR = vSplat;
        // bn is hoisted out of the reshape block: the path-wear bands below
        // reuse it so their margins wander with the same worn-edge noise.
        float bn = 0.0;
        if ( wocHasDirt ) {
          bn = texture2D(uGroundAO, tuv * 0.5).g - 0.897;
          float shaped = smoothstep(0.32, 0.68, vSplat.y + bn * 1.1);
          float rest = max(1.0 - vSplat.y, 1e-4);
          float restScale = (1.0 - shaped) / rest;
          vSplatR = vec4(vSplat.x * restScale, shaped, vSplat.z * restScale, vSplat.w * restScale);
        }
        // Offset parallax: slide the ground UVs along the view ray by the
        // AO height proxy, so the painted clods and stones stand up at
        // grazing angles instead of reading as a decal on flat ground. Each
        // layer takes its sd-normalized amplitude (WOC_PARALLAX_AMP), so rock
        // and dirt walk deep while grass and sand stay gentle BY TARGET, not
        // by accident of channel contrast. Faded by slope (planar-XZ UVs
        // stretch on cliffs, the same reason the detail normals fade below),
        // by incidence, and by distance, where mips have averaged the relief
        // away and an offset would only shimmer. Everything below reuses tuv,
        // so the detail normals follow the same height proxy and lighting
        // agrees with the displacement. Derived octave UVs (the rotated dirt/
        // rock second octaves, the grass coarse/mid/comb taps) all transform
        // the post-offset tuv, which preserves the same WORLD-space shift per
        // tap: the octaves move together and cannot ghost against each other.
        // Camera distance, UNCONDITIONAL: the snow-sparkle fade in the
        // roughness chunk reads it on every relief level (level 0 used to
        // leave it undeclared, which broke the whole terrain program).
        ${
          terrainReliefLevel() >= 2
            ? `vec3 pRay = cameraPosition - vWPos;
        float wocCamDist = length(pRay);`
            : 'float wocCamDist = length(cameraPosition - vWPos);'
        }
        ${
          // upW feeds both the parallax fade and the cavity slope fade; emit
          // it once whenever any relief level is active.
          terrainReliefLevel() >= 2
            ? `vec3 wocReliefUnitN = normalize(vWNorm);
        float upW = wocReliefUnitN.y;`
            : terrainReliefLevel() >= 1
              ? 'float upW = normalize(vWNorm).y;'
              : ''
        }
        ${
          // The parallax walk is relief level 2+: the standard ladder reaches
          // it at ultra, while Advanced Terrain Detail exposes level 2. High
          // keeps cavity-only relief and medium keeps flat-lit ground.
          terrainReliefLevel() >= 2
            ? `float pDist = wocCamDist;
        // Outside either smoothstep support the fade is exactly zero. Keep
        // incidence and every dependent relief tap out of those fragments.
        if (upW > 0.55 && pDist < 36.0) {
        // Grazing fade: at low N dot V the view-ray offset grows past what a
        // 1-2 tap parallax can refine and the texture smears into a liquid
        // blur, exactly where the depth cue is weakest anyway. Fade the whole
        // effect out as N dot V drops below ~0.38.
        float pNdv = dot(wocReliefUnitN, pRay) / max(pDist, 1e-3);
        // Distance fade tightened (was 16..44yd): past ~36yd mip selection
        // has blurred the 512px packed height field, and offsetting UVs by a
        // blurry height signal reads as smear, not relief.
        float pFade = (1.0 - vExtra.y)
          * smoothstep(0.55, 0.85, upW)
          * smoothstep(0.15, 0.38, pNdv)
          * (1.0 - smoothstep(14.0, 36.0, pDist));
        if (pFade > 0.015) {
          // planar-XZ UVs put the tangent frame on world x/z with world y as
          // the surface normal, so the ray projects without a TBN. Offset
          // limiting: the divisor floor 0.45 (was 0.3) caps |pDir| near 2.2
          // so a grazing ray cannot stretch the UVs into a smear; the radial
          // renormalization below replaces the old per-component box clamp,
          // which distorted the offset DIRECTION exactly at the diagonal
          // grazing angles where it engaged most.
          vec2 pDir = pRay.xz / max(pRay.y, pDist * 0.45);
          vec4 pAmp = vSplatR * WOC_PARALLAX_AMP;
          vec2 pOff = pDir * wocGroundHeightSmooth(tuv, pAmp) * pFade;
          pOff /= max(1.0, length(pOff) / WOC_PARALLAX_CLAMP);
          // second iteration: re-read the height where the first offset
          // landed, which keeps steep clod edges from overshooting and
          // swimming at grazing view angles (three more taps of the 512^2
          // packed AO texture; every parallax tier affords it)
          pOff = pDir * wocGroundHeightSmooth(tuv + pOff, pAmp) * pFade;
          pOff /= max(1.0, length(pOff) / WOC_PARALLAX_CLAMP);
          tuv += pOff;
        }
        }`
            : ''
        }
        ${
          // Cavity/turf-lip shading is relief level 1+. The fallback keeps
          // the names later stages read (cavH seeds the sparkle speckle hash,
          // groundShade takes the cliff-cavity multiply), at compile-time
          // constants the GLSL compiler folds so every relief tap disappears
          // from the no-relief tiers.
          terrainReliefLevel() >= 1
            ? `// Cavity shading: the same zero-mean AO signal, applied to the diffuse
        // directly. Unlike the parallax it is view-independent, so the clods
        // and stones still read from the high pitched-down chase camera where
        // a grazing-angle offset does nothing. Mip averaging pulls the signal
        // to zero with distance, so the far field keeps its painted colour.
        // Grass is demoted to 0.35x here: its fine-tiling AO stipple is
        // isotropic dots, half of the "spotty ground" read; the combed
        // height-shade on grassAlb below carries the tussock shading with
        // directional grain instead. The ultra micro-shadow taps reuse
        // swShade so their height differences stay DC-free.
        vec4 swShade = vSplatR * vec4(0.35, 0.8, 1.0, 1.0);
        float cavH = wocGroundHeight(tuv, swShade);
        // tighter slope fade than before: the AO/relief signal lives in the
        // planar-XZ projection, which stretches on banks. Full-strength
        // cavity there amplified the stretch into vertical streaking
        float cavW = (1.0 - vExtra.y) * smoothstep(0.62, 0.88, upW);
        // fine pores + coarse soil clumps: the macro octave carries the read
        // out past the distance where mips flatten the fine one, and grass
        // (whose own AO sheet is near-uniform) takes it at full weight so
        // meadows undulate instead of rendering as one green wash. The macro
        // term runs through a rational soft knee before it joins the fine
        // cavity: at the old 4.2 amplitude with hard clamp rails, every deep
        // trough of the ~28yd octave saturated into a flat near-black blotch
        // with a hard edge from above. The knee keeps the same patch
        // STRUCTURE (and so stays in step with the tuft-density coupling)
        // while halving the visual swing and feathering edges over yards.
        float reliefMacro = wocGroundMacroRelief(tuv) * (0.5 + vSplatR.x * 0.5) * WOC_MACRO_SHADE_AMP;
        reliefMacro /= 1.0 + abs(reliefMacro) * WOC_MACRO_SHADE_KNEE;
        float relief = cavH * 3.8 + reliefMacro;
        // turf lip: where grass feathers into bare soil (roads, patches),
        // shade the transition band so paths sit INTO the meadow as worn
        // hollows instead of lying on it as paint. Broken up by the fine AO
        // signal so the lip reads as crumbled soil edge, not a drawn contour
        // (a clean contour also traces the coarse vertex splat into visible
        // triangle steps. The earlier derivative-based normal tilt made the
        // same triangulation read as hard facets and is gone for that reason).
        float rim = vSplatR.y * (1.0 - vSplatR.y) * 4.0 * clamp(0.55 + cavH * 4.0, 0.2, 1.2);
        // floor 0.52 (was 0.38): with the macro knee above, the clamp is a
        // rare safety rail for stacked fine cavity, not the patch shaper
        float groundShade = mix(1.0, clamp(1.0 + relief, 0.52, 1.28) * (1.0 - rim * 0.17), cavW);
        ${
          // relief level 3 (ultra/insane); ?tmicroshadow=off is the dev
          // perf-attribution kill switch (render_dev_flags.ts)
          terrainReliefLevel() >= 3 && !renderLayerDisabled('tmicroshadow')
            ? `// micro sun-shadow: terrain never casts real shadows at any
        // scale, so march the height proxy two steps toward the sun and shade
        // texels whose sunward neighbourhood sits higher, creating clod-scale
        // self-shadowing that gives the relief a lit and a shade side.
        {
          vec2 sunStep = vec2(${SUN_UV_STEP.x}, ${SUN_UV_STEP.y});
          float occl = max(
            wocGroundHeight(tuv + sunStep, swShade) - cavH - 0.02,
            (wocGroundHeight(tuv + sunStep * 2.2, swShade) - cavH) * 0.55 - 0.02);
          groundShade *= 1.0 - min(max(occl, 0.0) * 4.5, 0.42) * cavW;
        }`
            : ''
        }`
            : `float cavH = 0.0;
        float cavW = 0.0;
        float groundShade = 1.0;`
        }
        // hill-scale macro noise, hoisted above the grass blend so the grass
        // octave balance, the rock wall blend, and the hue drift below all
        // share one tap
        float macro2 = 0.5;
        if ( wocHasGrass || wocHasRock )
          macro2 = texture2D(uMacro, vSurf * 0.0045 + 0.37).r;
        // grass blends two scales so the 1K photo source never reads as tile.
        // The second octave samples with swapped/negated components (a 90
        // degree rotation), so the two scales can never phase-align into a
        // shared repeat; the blend weight wanders with the hill-scale macro
        // noise so different hills favor different octaves instead of every
        // meadow sharing one fixed balance. Base weight 0.50 (was 0.42):
        // leaning toward the coarse octave softens the uniform blade stipple
        // that read as repeating noise underfoot, without losing the lush
        // and dark patch structure the macro terms carry.
        ${
          // The rich grass stack (scale jitter, combed anisotropy, mid
          // octave, hue drift: 5 extra taps on the fragments that cover most
          // of a meadow frame) rides the relief gate: it exists to give the
          // relief-lit turf its directional grain, and the round-10 medium
          // bench measured the meadow tier gap with relief already off, so
          // the no-relief tiers keep the plain two-octave anti-tiling mix.
          // ?talbedo=off is the dev perf-attribution kill switch.
          richTerrainSplat()
            ? `vec2 grassJitter = vec2(0.0);
        if ( wocHasGrass ) {
          // Per-octave scale jitter: a slow (~36yd) two-channel drift field
        // nudges each octave's sample position a different amount and sign,
        // so the tilings slide against each other across the map and their
        // repeats never line up into one fixed cadence. The warp gradient is
        // tiny (well under a yard of drift over ~36yd) so nothing smears.
          grassJitter = (vec2(
            texture2D(uMacro, vSurf * 0.028 + 0.07).r,
            texture2D(uMacro, vSurf * 0.028 + 0.63).r) - 0.5) * WOC_GRASS_SCALE_JITTER;
        }
        // Combed growth direction: the finest grass detail samples through a
        // locally-rotating ANISOTROPIC transform (comb frame: compressed
        // WOC_COMB_COMPRESS along combDir, unit across), so its features
        // stretch ~2.4x along a direction that wanders with the macro noise.
        // This is what turns the residual dot-scale stipple into streaky
        // brushed turf: the dots elongate into grain that follows a local
        // growth direction. Built on the post-parallax tuv so the combed taps
        // shift with the same world-space offset as every other layer.
        vec2 combDir = vec2(1.0, 0.0);
        if ( wocHasGrass || wocHasSand ) {
          float combA = (texture2D(uMacro, vSurf * WOC_COMB_FREQ + 0.19).r - 0.5) * WOC_COMB_SWING;
          combDir = vec2(cos(combA), sin(combA));
        }
        vec2 combPerp = vec2(-combDir.y, combDir.x);
        vec2 combT = vec2(dot(tuv, combDir) * WOC_COMB_COMPRESS, dot(tuv, combPerp));
        // fine octave combed; blend base 0.56 (was 0.50): with the fine
        // octave's job reduced to directional grain, the coarse and mid
        // octaves carry more of the tonal variation (patchy turf, not dots)
        vec3 grassAlb = vec3(0.0);
        if ( wocHasGrass ) {
          grassAlb = mix(
            texture2D(uGrass, combT + grassJitter).rgb,
            texture2D(uGrass, vec2(-tuv.y, tuv.x) * 0.31 - grassJitter * 0.6).rgb,
            0.56 + (macro2 - 0.5) * 0.3);
        // Third, LOW-amplitude mid octave between the fine (1.0x) and coarse
        // (0.31x) tilings: 0.57x scale rotated 23 degrees (cos 0.9205 and
        // sin 0.3907 folded into the constants), with its own seed offset so
        // it shares no phase with either neighbour. Variety without
        // amplitude: a third uncorrelated voice against the pair's residual
        // shared repeat, too faint to form patches of its own.
        vec2 grassUvMid = vec2(tuv.x * 0.525 - tuv.y * 0.223, tuv.x * 0.223 + tuv.y * 0.525);
        grassAlb = mix(grassAlb,
          texture2D(uGrass, grassUvMid + vec2(0.41, 0.87) + grassJitter * 0.8).rgb,
          WOC_GRASS_MID_OCTAVE);
        // ~42yd hue rotation: meadows drift a few percent between warm
        // yellow-green and cool blue-green. Value-neutral endpoints, so it
        // adds randomness you feel across a field without a patch to point at.
          float grassHueT = texture2D(uMacro, vSurf * WOC_GRASS_HUE_DRIFT_FREQ + 0.53).r;
          grassAlb *= mix(WOC_GRASS_HUE_WARM, WOC_GRASS_HUE_COOL, grassHueT);
        }`
            : `// No-relief tiers: the plain two-octave anti-tiling mix (the
        // 90-degree-rotated coarse octave still kills the shared repeat).
        // The comb-frame locals stay declared at IDENTITY for the detail
        // normal chunk (which samples the grass normal through them on every
        // tier) and the compile-time-disabled tussock shade.
        vec2 combT = tuv;
        vec2 grassJitter = vec2(0.0);
        vec2 combDir = vec2(1.0, 0.0);
        vec2 combPerp = vec2(0.0, 1.0);
        vec3 grassAlb = vec3(0.0);
        if ( wocHasGrass ) {
          grassAlb = mix(
            texture2D(uGrass, tuv).rgb,
            texture2D(uGrass, vec2(-tuv.y, tuv.x) * 0.31).rgb,
            0.56 + (macro2 - 0.5) * 0.3);
        }`
        }
        // Tussock height-shade (the worn_stone round-7 idiom): sd-normalized
        // R-channel height, clamped at 1.5 sd; recesses darken and saturate a
        // touch (shaded turf reads damp), crests lift, so the grass height
        // field reads from the pitched-down chase camera where the parallax
        // walk does nothing. Sampled through the comb frame so the shading is
        // directional streaks, never the isotropic dots this pass removes;
        // cavW gates it off banks with the rest of the planar relief.
        if ( wocHasGrass ) {
          float grassH = clamp(
            (texture2D(uGroundAO, combT).r - WOC_GRASS_H_MEAN) * WOC_GRASS_H_INV_SD, -1.5, 1.5);
          grassAlb *= 1.0 + grassH * WOC_GRASS_HEIGHT_SHADE * cavW;
          grassAlb = mix(vec3(dot(grassAlb, vec3(0.299, 0.587, 0.114))), grassAlb,
            1.0 + max(-grassH, 0.0) * WOC_GRASS_RECESS_SAT * cavW);
        }
        // rock: top-down projection smears into vertical streaks on cliffs,
        // so steep faces blend toward wall-planar (world XY/ZY) samples
        vec3 an = abs(normalize(vWNorm));
        float wallW = clamp(1.0 - an.y * 1.45, 0.0, 1.0);
        float axisW = an.x / max(1e-4, an.x + an.z);
        // dirt smears the same way and shows it sooner (paths climb banks the
        // player stands right next to), so it takes its own wall blend with a
        // gentler onset than rock's cliff threshold
        float dirtWallW = smoothstep(0.1, 0.42, 1.0 - an.y);
        vec3 dirtAlb = vec3(0.0);
        float pathCore = 0.0;
        float pathEdge = 0.0;
        float gravelW = 0.0;
        if ( wocHasDirt ) {
        ${
          richTerrainSplat()
            ? `// --- de-carpeted dirt: multi-scale soil instead of one speckle ---
        // A rotated second dirt octave (0.63x the base 0.8 scale, 37 degrees:
        // cos 0.799 and sin 0.601 folded into the constants), lerped by a
        // ~9yd macro mask: the two scales can never phase-align into one
        // repeat, and patches of coarse and fine soil mottle into each other
        // instead of averaging to mush (same idiom as the grass octave pair).
        vec2 dirtUv2 = vec2(tuv.x * 0.277 - tuv.y * 0.208, tuv.x * 0.208 + tuv.y * 0.277);
        float dirtOctMask = texture2D(uMacro, vSurf * 0.11 + 0.29).r;
        vec3 dirtFlat = mix(
          texture2D(uDirt, tuv * 0.55).rgb,
          texture2D(uDirt, dirtUv2).rgb,
          0.22 + dirtOctMask * 0.5);
        // Micro-soften: pull the pebble-scale speckle toward its own local
        // mean (a forced-coarse mip of the same tap) so the path reads as
        // packed earth with embedded stones, not carpet pile. The macro
        // octaves below run on the softened base, so patch structure stays.
        dirtFlat = mix(dirtFlat, textureLod(uDirt, tuv * 0.55, 2.0).rgb, 0.30);
        // Two macro octaves hand the soil the low-frequency structure a photo
        // tile cannot carry: ~6yd value mottling (footworn patches) and ~20yd
        // value plus grey-brown hue drift (damp hollows). Both reuse uMacro;
        // combined value swing tops out near +-9% (weights 0.11/0.15, were
        // 0.16/0.22: the +-13% swing jumped too hard across a few yards).
        float dirtMac6 = texture2D(uMacro, vSurf * 0.17 + 0.61).r - 0.5;
        float dirtMac20 = texture2D(uMacro, vSurf * 0.052 + 0.13).r - 0.5;
        dirtFlat *= 1.0 + dirtMac6 * 0.11 + dirtMac20 * 0.15;
        vec3 dirtGrey = vec3(dot(dirtFlat, vec3(0.35, 0.45, 0.2))) * vec3(1.0, 0.97, 0.9);
        dirtFlat = mix(dirtFlat, dirtGrey, clamp(0.24 + dirtMac20 * 0.4, 0.0, 0.65));`
            : `// Simple-splat tiers: one dirt tap; the wear bands below still
        // apply so trails keep their compacted-core read.
        vec3 dirtFlat = texture2D(uDirt, tuv * 0.55).rgb;`
        }
        // Path wear across the trail: the vertex dirt weight sits near 0.85
        // at a trail's core and feathers out over ~1.4yd at the margin, so it
        // doubles as a smooth cross-path coordinate. The core reads compacted
        // (a touch lighter, smoother, tighter), the margin reads kicked-up
        // (slightly darker, rougher); bn wanders both bands at texel scale so
        // neither traces the vertex mesh into sawteeth. Faded by the marsh
        // mud swap: wet mud does not wear like packed earth. The roughness
        // and detail-normal chunks below reuse pathCore/pathEdge.
        pathCore = smoothstep(0.55, 0.92, vSplat.y + bn * 0.6) * (1.0 - vExtra.x);
        pathEdge = vSplatR.y * (1.0 - pathCore) * (1.0 - vExtra.x);
        dirtFlat *= 1.0 + pathCore * 0.07 - pathEdge * 0.05;
        if ( wocHasMud )
          dirtFlat = mix(dirtFlat, texture2D(uMud, tuv * 0.8).rgb, vExtra.x);
        ${
          richTerrainSplat()
            ? `// Trails read as packed grit, not smooth brown paint: fold a
        // high-frequency rock tap into the dry dirt (no new sampler, the
        // material sits at 15 of 16). The weight fades with the marsh mud
        // swap so wet mud keeps its smooth sheen. 0.10 (was 0.16): with the
        // macro soil structure above, the old weight let single-scale
        // micro-grain dominate the read again, the exact carpet failure.
        gravelW = 0.07 * (1.0 - vExtra.x);
        dirtFlat = mix(dirtFlat, texture2D(uRock, tuv * 1.8).rgb, gravelW);`
            : ''
        }
        vec3 dirtWall = mix(
          texture2D(uDirt, vec2(vSurf.x, vWPos.y) * 0.176).rgb,
          texture2D(uDirt, vec2(vSurf.y, vWPos.y) * 0.176).rgb,
          axisW);
        // marsh swaps packed dirt for wet mud (roads, hub discs included)
        dirtAlb = mix(dirtFlat, dirtWall, dirtWallW);
        }
        vec3 rockAlb = vec3(0.0);
        float wallCav = 0.0;
        if ( wocHasRock ) {
        ${
          richTerrainSplat()
            ? `// Flat rock (scree, summits, outcrops) mottles between two scales the
        // way grass and dirt do: a second tap of the same rock at 0.55x the
        // base 0.6 scale, rotated 52 degrees (cos 0.616 and sin 0.788 folded
        // into the constants), lerped by a ~30yd macro mask so no two
        // outcrops share one tiling period.
        vec2 rockUv2 = vec2(tuv.x * 0.203 - tuv.y * 0.260, tuv.x * 0.260 + tuv.y * 0.203);
        float rockOctMask = texture2D(uMacro, vSurf * 0.033 + 0.83).r;
        vec3 rockFlat = mix(
          texture2D(uRock, tuv * 0.6).rgb,
          texture2D(uRock, rockUv2).rgb,
          0.2 + rockOctMask * 0.5);`
            : 'vec3 rockFlat = texture2D(uRock, tuv * 0.6).rgb;'
        }
        // macro2 (hoisted above the grass blend) also drives the wall plate
        // mix, so plate zones vary across a mountainside without spending a
        // second uMacro tap on cliff fragments
        // Anti-corduroy wall projection. A single-scale planar projection
        // hands every cliff the same tiling period, and any directional bias
        // in the source repeats in lockstep down the whole face, and that is
        // the corduroy. Two breaks: each plane folds a ~3x coarser octave over the
        // base scale (no single period survives at mountain distance), and the
        // ZY plane samples with its axes swapped, a 90-degree rotation, so the
        // two wall planes can never share stripe alignment even where they
        // meet at a corner. The octave ratio wanders with the hill-scale
        // macro noise so plate zones read as geology, not wallpaper.
        // rockDrift (~25yd) varies the plate-octave ratio span by span on top
        // of macro2's hill-scale wander, and drives the stone hue drift after
        // the wall blend, so adjacent cliff spans stop reading as copies.
        ${
          richTerrainSplat()
            ? `float rockDrift = texture2D(uMacro, vSurf * 0.041 + 0.47).r;
        float plateMix = 0.58 + (macro2 - 0.5) * 0.55 + (rockDrift - 0.5) * 0.3;
        vec3 rockWall = mix(
          mix(texture2D(uRock, vec2(vSurf.x, vWPos.y) * 0.132).rgb,
              texture2D(uRock, vec2(vSurf.x, vWPos.y) * 0.043).rgb, plateMix),
          mix(texture2D(uRock, vec2(vWPos.y, vSurf.y) * 0.132).rgb,
              texture2D(uRock, vec2(vWPos.y, vSurf.y) * 0.043).rgb, plateMix),
          axisW);
        rockAlb = mix(rockFlat, rockWall, wallW);
        // Macro stone drift: cooler grey patches against warmer tan ones,
        // +-6% value folded into the tint. XZ-keyed so it varies along a
        // wall's run rather than repeating down its height.
        rockAlb *= mix(vec3(0.94, 0.97, 1.04), vec3(1.06, 1.0, 0.92), rockDrift);
        // Cliff cavity: groundShade's planar AO fades out by slope on purpose
        // (its XZ projection streaks on banks), which left steep faces
        // shadeless. Re-sample the packed B channel (the Rock026/Rock060
        // displacement blend) through the same wall-planar frames as the
        // projected rock albedo, at the coarse octave only, so it shades
        // whole fracture plates rather than re-tracing the fine tiling the
        // albedo mix just broke up. Centred on the channel's measured mean
        // like wocGroundHeight, so mip averaging fades it out with distance
        // for free.
        wallCav = mix(
          texture2D(uGroundAO, vec2(vSurf.x, vWPos.y) * 0.043).b,
          texture2D(uGroundAO, vec2(vWPos.y, vSurf.y) * 0.043).b,
          axisW) - 0.623;
        groundShade *= mix(
          1.0, clamp(1.0 + wallCav * 2.6, 0.58, 1.18),
          vSplatR.z * wallW * (1.0 - vExtra.y));`
            : `// Simple-splat tiers: one wall tap per plane (the swapped-axis
        // ZY sample still breaks corner stripe alignment), no plate mix, no
        // cliff cavity resample (wallCav stays declared for the roughness
        // plate term, folded to zero).
        vec3 rockWall = mix(
          texture2D(uRock, vec2(vSurf.x, vWPos.y) * 0.132).rgb,
          texture2D(uRock, vec2(vWPos.y, vSurf.y) * 0.132).rgb,
          axisW);
        rockAlb = mix(rockFlat, rockWall, wallW);`
        }
        }
        vec3 sandAlb = vec3(0.0);
        if ( wocHasSand )
          sandAlb = texture2D(uSand, tuv).rgb;
        vec3 alb = grassAlb * vSplatR.x
                 + dirtAlb * vSplatR.y
                 + rockAlb * vSplatR.z
                 + sandAlb * vSplatR.w;
        // snow cover on the peaks/rim, by baked per-vertex weight
        if ( wocHasSnow )
          alb = mix(alb, texture2D(uSnow, tuv * 0.7).rgb, vExtra.y);
        // Wet shoreline: within ~1.6u above the waterline (WATER_LEVEL is
        // inlined from src/sim/world.ts at material build), sand and dirt
        // darken and tighten as if soaked, so every shore carries a wet
        // margin instead of dry ground meeting water at a hard line. Pure
        // math on values already sampled: no extra tap. The roughness chunk
        // below reuses wetW for the damp sheen.
        float shoreWet = (1.0 - smoothstep(${(WATER_LEVEL + 0.1).toFixed(2)},
          ${(WATER_LEVEL + 1.6).toFixed(2)}, vWPos.y)) * (1.0 - vExtra.y);
        float wetW = shoreWet * clamp(vSplatR.w + vSplatR.y * 0.85, 0.0, 1.0);
        alb *= 1.0 - wetW * 0.22;
        // Third, very-low-frequency ground variety (~300u wavelength): a
        // subtle warm/cool hue swing so far-apart regions stop sharing one
        // identical tone. Applied before the impact mix so authored crater
        // colours stay exact; damped under snow so peaks stay clean.
        float macro3 = texture2D(uMacro, vSurf * 0.003 + 0.71).r;
        vec3 hue3 = mix(vec3(1.04, 1.005, 0.96), vec3(0.96, 0.995, 1.04), macro3);
        alb *= mix(vec3(1.0), hue3, 1.0 - vExtra.y * 0.5);
        // macro brightness swing breaks distant tiling
        float macro = mix(0.88, 1.12, texture2D(uMacro, vSurf * 0.012).r);
        // Meteor impact terrain is authored by the same crater profile as the
        // heightfield. Apply it in albedo space so the PBR textures do not wash
        // the crater floor back toward marsh sand.
        vec3 impactAlb = mix(vec3(0.20, 0.08, 0.035), vec3(0.055, 0.040, 0.032), vExtra.w);
        alb = mix(alb, impactAlb, clamp(vExtra.z * 0.86 + vExtra.w * 0.18, 0.0, 0.96));
        // very-low-frequency hue drift (~100u wavelength) keeps distant
        // hills from flattening into one uniform lawn green (macro2 itself is
        // sampled up by the rock wall blend, which shares it)
        alb = mix(alb, alb * vec3(1.07, 1.03, 0.86), (macro2 - 0.5) * 0.75 * vSplat.x);
        // real albedo carries the hue now; vertex color only modulates gently
        // so the biome painting (roads, hub discs, snowline) still reads.
        // (vColor was authored as a full sRGB ground color, so re-centre it
        // around 1.0 before using it as a multiplier.)
        vec3 vtint = clamp(vColor.rgb * 2.0, 0.0, 2.0);
        diffuseColor.rgb *= alb * mix(vec3(1.0), vtint, 0.35) * macro * groundShade;`,
      )
      .replace(
        '#include <color_fragment>',
        `
        // vertex color already folded into the splat albedo above (gently);
        // the stock full multiply would re-tint the real textures to mush`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `
        // The macro swing doubles as a per-material surface break-up: loose
        // layers (dirt, sand) take it strongly so they read as damp/dry
        // patches, rock takes little so stone stays tight and specular.
        float roughBreak = (macro - 1.0) * (vSplatR.y * 1.4 + vSplatR.z * 0.4 + vSplatR.w * 0.9);
        float roughnessFactor = roughness * clamp(mix(
          dot(vSplatR, vec4(${ROUGH_GRASS}, mix(${ROUGH_DIRT}, ${ROUGH_MUD}, vExtra.x), ${ROUGH_ROCK}, ${ROUGH_SAND})),
          ${ROUGH_SNOW}, vExtra.y) + roughBreak, 0.35, 1.0);
        // path wear (pathCore/pathEdge from the albedo chunk): compacted
        // trail cores tighten a touch, kicked-up margins scatter more
        roughnessFactor += (pathEdge * 0.05 - pathCore * 0.06) * vSplatR.y;
        // Cliff faces at ROUGH_ROCK read sheeny under the low sun: weathered
        // stone scatters, so steepness pushes rock toward full matte (snow
        // keeps its own response via the vExtra.y damp). A uniform 0.95 made
        // big faces read as one flat sheet, though: raised plate centres
        // (positive wallCav, the coarse displacement blend already sampled for
        // cavity) ease back toward 0.8 so a mountainside reads faceted, each
        // plate catching the light a little differently.
        float plateHi = smoothstep(0.02, 0.14, wallCav);
        roughnessFactor = mix(roughnessFactor, mix(0.95, 0.8, plateHi),
          vSplatR.z * wallW * (1.0 - vExtra.y));
        // wet shoreline (wetW from the albedo chunk): soaked sand and dirt
        // tighten toward a damp sheen instead of staying bone-dry matte
        roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.55), wetW);
        // Snow sparkle: tiny speckle cells pull toward glossy so sun-facing
        // snow glints. The hash folds in the fine AO height already sampled
        // (cavH), so speckles sit on the texture grain rather than a bare
        // grid: no new texture tap. Distance-faded so far snow stays matte
        // and never shimmers; overall snow keeps its matte ROUGH_SNOW base.
        float sparkCell = fract(sin(dot(floor(vSurf * 12.0),
          vec2(127.1, 311.7)) + cavH * 41.0) * 43758.5453);
        float snowSpark = step(0.94, sparkCell)
          * smoothstep(0.45, 0.85, vExtra.y)
          * (1.0 - smoothstep(18.0, 55.0, wocCamDist));
        roughnessFactor = mix(roughnessFactor, 0.55, snowSpark * 0.8);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // per-layer detail normals (GL-convention), weighted by splat: rock
        // carries the hardest relief, then dirt, grass moderate, sand soft.
        // The blade normal follows the combed fine albedo tap (combT, same
        // jitter), and its comb-frame perturbation rotates back into ground-UV
        // space; the chain rule scales the along-comb slope by the
        // compression, which IS the combed look: smooth along the growth
        // direction, ridged across it.
        vec2 gNxy = vec2(0.0);
        if ( wocHasGrass ) {
          vec3 gN = texture2D(uGrassN, combT + grassJitter).xyz * 2.0 - 1.0;
          gNxy = gN.x * WOC_COMB_COMPRESS * combDir + gN.y * combPerp;
        }
        vec3 dN = vec3(0.0);
        if ( wocHasDirt )
          dN = texture2D(uDirtN, tuv * 0.55).xyz * 2.0 - 1.0;
        vec3 rN = vec3(0.0);
        if ( wocHasRock )
          rN = texture2D(uRockN, tuv * 0.6).xyz * 2.0 - 1.0;
        vec3 sN = vec3(0.0);
        if ( wocHasSand )
          sN = texture2D(uSandN, tuv).xyz * 2.0 - 1.0;
        ${
          richTerrainSplat()
            ? `// A second octave at 4x the base tiling: without it the ground is one
        // blurred frequency underfoot and reads as plastic. Two taps rather
        // than one per layer, since the octave only supplies grain and its
        // source map is indistinguishable once summed into a layer's normal:
        // the hard layers share the crisp tap, the soft layers the gentle one.
        vec2 fineHard = vec2(0.0);
        if ( wocHasDirt || wocHasRock )
          fineHard = texture2D(uRockN, tuv * 2.4).xy * 2.0 - 1.0;
        // The fine-soft grain is combed like the blade normal (the 3x tiling
        // was the single loudest dot-scale voice): elongated micro-grain for
        // grass, and on sand it reads as wind-swept ripple rather than dots.
        vec2 fineSoft = vec2(0.0);
        if ( wocHasGrass || wocHasSand ) {
          vec2 fineSoftRaw = texture2D(uGrassN, combT * 3.0).xy * 2.0 - 1.0;
          fineSoft = fineSoftRaw.x * WOC_COMB_COMPRESS * combDir + fineSoftRaw.y * combPerp;
        }
        // gravel grain at the trail albedo's own tap scale, so the grit a
        // path shows is lit rather than painted (gravelW already fades it
        // with the marsh mud swap)
        vec2 gvN = vec2(0.0);
        if ( wocHasDirt )
          gvN = texture2D(uRockN, tuv * 1.8).xy * 2.0 - 1.0;`
            : `// Simple-splat tiers: base-scale detail normals only (the
        // merge-base budget); the fine octaves fold to zero and every term
        // below compiles out.
        vec2 fineHard = vec2(0.0);
        vec2 fineSoft = vec2(0.0);
        vec2 gvN = vec2(0.0);`
        }
        // wet mud lumps smoothly where dry dirt crumbles; footworn trail
        // cores are packed smoother than their kicked-up margins (pathCore
        // from the albedo chunk)
        float dirtDetail = (1.0 - vExtra.x * 0.35) * (1.0 - pathCore * 0.3);
        // dirt micro-grain eased (1.55/0.7/0.5, were 1.8/0.9/0.7): the macro
        // soil octaves own the mid-scale read now, and the old weights let
        // single-frequency speckle dominate again; grass fine grain down to
        // 0.45 (was 0.65): with the comb stretch it supplies direction, not
        // contrast, and the combed blade normal gNxy keeps full weight
        vec2 detN = (gNxy + fineSoft * 0.45) * vSplatR.x * 1.5
                  + (dN.xy + fineHard * 0.7 + gvN * gravelW * 0.5) * vSplatR.y * 1.55 * dirtDetail
                  + (rN.xy + fineHard * 0.9) * vSplatR.z * 1.5 * (1.0 - wallW)
                  + (sN.xy + fineSoft * 0.9) * vSplatR.w * 1.1;
        detN *= 1.0 - vExtra.y * 0.7; // snow softens the relief beneath it
        // Planar-XZ UVs stretch on steep faces and the detail normals smear
        // into vertical streaks there; fade them out by slope and let the
        // wall projection below own the cliff relief.
        detN *= smoothstep(0.5, 0.82, vWNorm.y);
        normal = normalize(normal + tbn * vec3(detN, 0.0));
        // cliffs: wall-projected rock normal so steep faces get real relief
        // (approximate world-space tangent frames per projection plane; the
        // handedness flip on back faces is invisible on noisy rock). The
        // +-x plane samples axes-swapped (yz, the same 90-degree rotation as
        // the albedo/cavity taps above) so whatever directional bias survives
        // in the normal map can never line up across the two wall planes
        // (matching stripe phase on adjacent planes is what read as corduroy).
        if (vSplat.z * wallW > 0.01) {
          vec3 rNx = texture2D(uRockN, vec2(vWPos.y, vSurf.y) * 0.132).xyz * 2.0 - 1.0; // +-x faces, rotated
          vec3 rNz = texture2D(uRockN, vec2(vSurf.x, vWPos.y) * 0.132).xyz * 2.0 - 1.0; // +-z faces
          // rotated frame: the yz sample's tangent u runs along world y and
          // v along world z, so its xy perturbation lands on (0, n.x, n.y)
          vec3 wallPerturb = mix(vec3(rNz.x, rNz.y, 0.0), vec3(0.0, rNx.x, rNx.y), axisW);
          // 1.1 (was 0.8): the projected relief flattened against the
          // strengthened planar detail normals and cliffs read smooth
          normal = normalize(normal + mat3(viewMatrix) * wallPerturb * (vSplat.z * wallW * 1.1));
        }`,
      );
  };
  return mat;
}

export function buildGroundLambertMaterial(brush: BrushUniforms): THREE.MeshLambertMaterial {
  const detail = groundDetailTexture();
  // strip-planar uv: keep the legacy ~2.25u texture period in both axes
  detail.repeat.set(GROUND_DETAIL_REPEAT_X, GROUND_DETAIL_REPEAT_Z);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: detail,
    emissive: GFX.lowPlus ? 0x182014 : 0x000000,
    emissiveIntensity: GFX.lowPlus ? 0.08 : 1,
  });
  // The Lambert tier has no world-position varying of its own, so the brush
  // patch carries one (r165 chunk names; same idiom as the splat patch above).
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, brush);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vWocWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWocWPos;
        ${BRUSH_RING_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += wocBrushRing(vWocWPos.xz);`,
      );
  };
  return mat;
}
