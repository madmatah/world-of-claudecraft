// THE water surface: the shader every body of water in the world wears, and the
// one material that drives them all.
//
// It lived inside `water.ts`, whose surfaces come from `waterBodies()`, i.e.
// from the lakes declared on the active content's ZONES. An instanced band is
// not a zone, so it declares no lake and `waterLevelAt` is -Infinity across it:
// the rally's basin had to be a flat translucent plane, next to an Evergarden
// lake with ripples, shore foam, sun glints and wakes. The shader now lives
// here and a band builds the same material.
//
// What a consumer owes it, since the shader reads all of it:
//   - `aShoreDepth`  yards of water under this vertex, clamped at the seabed
//   - `aShoreSlope`  the depth gradient, which is what turns depth into a
//                    distance-to-shore and therefore into the foam band
// The wave field (`water_simulation.ts`) is optional: pass `zeroWaveUniforms()`
// and the shader's `uWaveEnabled` branch costs one comparison.

import * as THREE from 'three';
import { loadTexture } from './assets/loader';
import { type GfxSettings, SUN_DIR, sharedUniforms } from './gfx';
import {
  WATER_FIELD_EDGE_FEATHER_UV,
  WATER_FOAM_WIDTH_YARDS,
  WATER_SEABED_CLAMP_YARDS,
} from './water_core';
import type { WaterWaveUniforms } from './water_simulation';

// Surface look, tuned against a 30 sample survey of the real coastline
// (tests/water_shore_shape.test.ts pins the geometry these assume).
/** Foam is an analytic sine with no mip chain, so fade it out with range. */
const WATER_FOAM_DISTANCE_FADE = 0.0055;
/**
 * Opacity rises far faster than colour does. Colour has to spread across the
 * whole 6 yard seabed range, but water stops showing its bottom within a couple
 * of yards, and the surface MUST reach full opacity by the seabed clamp: a zone
 * plane rect edge has the apron alone on one side and apron-under-zone-plane on
 * the other, and two stacked semi-transparent sheets do not composite to the
 * same colour as one. At full opacity both sides resolve identically and the
 * rect edge stops being visible.
 */
const WATER_OPACITY_EXTINCTION_PER_YARD = 0.9;
const WATER_SHALLOW_ALPHA = 0.84;
const WATER_DEEP_ALPHA = 1;
/**
 * How much of the palette the SEABED is allowed to drive. Bathymetry is not
 * smooth: the measured shelf off Eastbrook runs flat at ~1.5 yards for 40
 * yards, then breaks and drops to the 6 yard clamp within 30. Letting depth
 * drive the whole palette spends it across that break, and 30 yards of ground
 * at a grazing camera angle is a handful of pixels, so a real and correct piece
 * of terrain reads as a hard painted line out at sea. Handing most of the range
 * to VIEW DISTANCE instead is both softer and truer: open water gets its colour
 * from the depth of atmosphere in front of it, not from the rock underneath.
 */
const WATER_DEPTH_COLOR_AUTHORITY = 0.55;
/** View distance over which the sea grades to open-ocean colour. */
const WATER_DEEP_NEAR_YARDS = 25;
const WATER_DEEP_FAR_YARDS = 240;
// Carries what the seabed no longer does, so the far sea still reads as ocean.
const WATER_DEEP_DISTANCE_STRENGTH = 0.92;
/** GLSL needs a decimal point on every float literal. */
const glsl = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));
// Real water normal maps, fetched at module import and gated by the boot
// preload only for the shader tier. Low/mobile uses generated canvas water
// so it does not pay network/decode/upload cost for water detail.
const WATER_TEX: Record<string, THREE.Texture> = {};
const waterTexTasks = new Map<string, Promise<void>>();
function prepareWaterTex(key: string, file: string): Promise<void> {
  if (WATER_TEX[key]) return Promise.resolve();
  const existing = waterTexTasks.get(key);
  if (existing) return existing;
  const task = loadTexture(`/textures/water/${file}`, { repeat: true })
    .then((tex) => {
      tex.anisotropy = 4;
      WATER_TEX[key] = tex;
    })
    .catch((err) => {
      waterTexTasks.delete(key);
      throw err;
    });
  waterTexTasks.set(key, task);
  return task;
}

/**
 * Prepare the water texture channel selected by an explicit target profile.
 * water.ts owns the deferred registration (it is the module the preload gate
 * names); this module owns the textures the surface shader samples.
 */
export function prepareWaterProfileAssets(target: Readonly<GfxSettings>): Promise<void> {
  if (!target.standardMaterials) return Promise.resolve();
  return Promise.all([
    prepareWaterTex('n1', 'water_1_normal.jpg'),
    prepareWaterTex('n2', 'water_2_normal.jpg'),
    prepareWaterTex('broad', 'waternormals.jpg'),
  ]).then(() => undefined);
}

export function hasWaterShaderAssets(): boolean {
  return Boolean(WATER_TEX.n1 && WATER_TEX.n2 && WATER_TEX.broad);
}

export const DEEP_COLOR = new THREE.Color(0x0d3a52);
/** Canonical shallow-water tint, exported for surfaces that must match the
 *  sea palette without the full shader (the Wildheart waterfall ribbons). */
export const SHALLOW_COLOR = new THREE.Color(0x2d8077);
const SKY_TINT = new THREE.Color(0x7fb2e0); // matches the sky horizon band
const SUN_COLOR = new THREE.Color(0xfff0d4);

// Shared by the vertex and fragment stages: map a world xz onto the anchored
// height-field window, and report whether the sample actually lands inside it.
// Outside the window there is no state to read, and clamping to the rim would
// smear the border texel across the entire distant sea.
const WAVE_SAMPLE_GLSL = /* glsl */ `
  float waveSampleAt(vec2 worldXZ, out vec4 wave) {
    vec2 waveUv = (worldXZ - uWaveOrigin) / uWaveSize;
    if (any(lessThan(waveUv, vec2(0.0))) || any(greaterThan(waveUv, vec2(1.0)))) {
      wave = vec4(0.0);
      return 0.0;
    }
    wave = texture2D(uWaveState, waveUv);
    // Ramp to nothing at the border. A hard cut steps the surface normal, and
    // the window is a camera-anchored SQUARE, so that step is a straight seam.
    vec2 toEdge = min(waveUv, vec2(1.0) - waveUv);
    return smoothstep(0.0, ${glsl(WATER_FIELD_EDGE_FEATHER_UV)}, min(toEdge.x, toEdge.y));
  }
`;

const WATER_VERT = /* glsl */ `
  attribute float aShoreDepth;
  attribute float aShoreSlope;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  uniform vec2 uSurfaceOrigin;
  varying vec3 vWPos;
  varying vec2 vSurf;
  varying float vShoreDepth;
  varying float vShoreSlope;
  #include <fog_pars_vertex>
  ${WAVE_SAMPLE_GLSL}
  void main() {
    vec3 pos = position;
    pos.y += (sin(uTime * 1.1 + pos.x * 0.35) + sin(uTime * 0.7 + pos.z * 0.28)) * 0.05;
    if (uWaveEnabled > 0.001) {
      // waveSampleAt WRITES wave, so it has to complete before wave is read:
      // operand evaluation order is unspecified in GLSL.
      vec4 wave;
      float waveW = uWaveEnabled * waveSampleAt(pos.xz, wave);
      pos.y += wave.r * waveW;
    }
    vShoreDepth = aShoreDepth;
    vShoreSlope = aShoreSlope;
    vec4 wp = modelMatrix * vec4(pos, 1.0);
    vWPos = wp.xyz;
    // Anchored HERE, not in the fragment stage: see WaterSurfaceOrigin.
    vSurf = wp.xz - uSurfaceOrigin;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const WATER_FRAG = /* glsl */ `
  uniform sampler2D uNorm1;
  uniform sampler2D uNorm2;
  uniform sampler2D uNorm3;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform float uTime;
  uniform sampler2D uWaveState;
  uniform float uWaveEnabled;
  uniform vec2 uWaveOrigin;
  uniform float uWaveSize;
  uniform float uShoreEdgeFade;
  varying vec3 vWPos;
  varying vec2 vSurf;
  varying float vShoreDepth;
  varying float vShoreSlope;
  #include <common>
  #include <fog_pars_fragment>
  ${WAVE_SAMPLE_GLSL}
  void main() {
    float camDist = length(cameraPosition - vWPos);
    // dual-scroll detail ripples (real three.js water normal maps)
    vec3 n1 = texture2D(uNorm1, vSurf * 0.055 + uTime * vec2(0.013, 0.019)).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(uNorm2, vSurf * 0.115 - uTime * vec2(0.021, 0.011)).xyz * 2.0 - 1.0;
    // broad slow ocean swell that survives at range, where the detail maps
    // average out to a mirror, keeps big water surfaces alive from above
    vec3 n3 = texture2D(uNorm3, vSurf * 0.016 + uTime * vec2(0.005, -0.004)).xyz * 2.0 - 1.0;
    float farW = smoothstep(24.0, 140.0, camDist);
    // rippled up close -> glassy at distance: detail fades out, swell stays
    vec2 nm = mix(n1.xy * 0.85 + n2.xy * 0.6, n3.xy * 1.5, farW * 0.78);
    // interactive wakes ride on top of the static maps, near the camera only
    vec2 waveSlope = vec2(0.0);
    float waveEnergy = 0.0;
    if (uWaveEnabled > 0.001) {
      vec4 wave;
      float waveW = uWaveEnabled * waveSampleAt(vWPos.xz, wave);
      waveSlope = wave.ba * waveW;
      waveEnergy = (abs(wave.g) * 0.9 + length(wave.ba) * 0.4) * waveW;
    }
    vec3 N = normalize(vec3(nm + waveSlope * 9.5, 3.1).xzy);
    vec3 V = normalize(cameraPosition - vWPos);
    // clamp(), not max(): max() leaves the upper bound open, and a normalized
    // dot product that overshoots 1.0 by an ulp makes the pow() base negative,
    // which is NaN. One NaN pixel becomes a black rectangle after the bloom blur.
    float fresnel = 0.05 + 0.95 * pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
    // The seabed is hard clamped at ${WATER_SEABED_CLAMP_YARDS} yards. A linear ramp spends the
    // whole palette in the shallows, and an exponential is still climbing when
    // it reaches the clamp, which creases the colour field along the clamp
    // contour. smoothstep spans the full range AND arrives with zero slope, so
    // the gradient is already flat where the geometry goes flat. The apron
    // carries exactly WATER_SEABED_CLAMP_YARDS and runs the same ramp, so the
    // two land on the same colour and rect boundaries stay invisible.
    float depth = smoothstep(0.0, ${glsl(WATER_SEABED_CLAMP_YARDS)}, vShoreDepth);
    vec3 col = mix(uShallow, uDeep, depth * ${glsl(WATER_DEPTH_COLOR_AUTHORITY)});
    // A 6 yard seabed cannot supply open-ocean depth, so grade toward deep with
    // VIEW DISTANCE the way real water does. This is what makes the far sea read
    // as ocean rather than as an endless shallow, and it hides the apron seam.
    col = mix(col, uDeep, smoothstep(${glsl(WATER_DEEP_NEAR_YARDS)}, ${glsl(WATER_DEEP_FAR_YARDS)}, camDist) * ${glsl(WATER_DEEP_DISTANCE_STRENGTH)});
    // dappled shimmer that fades with distance so it never reads as speckle
    float shimmer = max(n1.x * 0.7 + n2.y * 0.55, 0.0) * exp(-camDist * 0.022);
    col *= 0.92 + 0.4 * shimmer;
    // reflection tracks the live fog/horizon color so each biome's water
    // belongs to its sky instead of a constant pasted-on tint
    vec3 skyRef = mix(uSkyColor, fogColor, 0.5);
    col = mix(col, skyRef, min(fresnel * 0.65, 0.42));
    float sunAlign = max(dot(reflect(-uSunDir, N), V), 0.0);
    col += uSunColor * pow(sunAlign, 130.0) * 2.6;                   // sparkle glints (>1 -> bloom)
    col += uSunColor * pow(sunAlign, 28.0) * 0.30;                   // wider lobe: survives steep cameras
    col += uSunColor * pow(sunAlign, 6.0) * 0.05;                    // faint warm sheen sunward
    // Shoreline foam keyed on HORIZONTAL distance to the waterline, recovered
    // as depth / seabed slope, NOT on depth. Measured shelves range from 3.2
    // yards of depth in 4 yards of run to 0.2 yards of depth sustained over 40,
    // so any depth threshold either floods a flat bay or vanishes on a steep
    // one. Distance to shore is the same signal on both.
    float shoreDist = vShoreDepth / vShoreSlope;
    float foamBand = smoothstep(${glsl(WATER_FOAM_WIDTH_YARDS)}, 0.0, shoreDist + n1.x * 0.6);
    foamBand *= foamBand;
    // Two decorrelated sines so the band stops reading as one set of wallpaper
    // stripes, faded with range because it is an analytic function with no mip
    // chain and aliases hard at grazing angles.
    float foamWave = 0.55
      + 0.25 * sin(uTime * 1.7 + vSurf.x * 1.2 + vSurf.y * 0.95 + n2.y * 6.0)
      + 0.20 * sin(uTime * 0.9 - vSurf.x * 0.41 + vSurf.y * 0.63 + n1.y * 4.0);
    float foam = foamBand * foamWave * exp(-camDist * ${glsl(WATER_FOAM_DISTANCE_FADE)});
    // disturbed water reads brighter and skyward, the way a real wake does
    float contactSheen = smoothstep(0.025, 0.13, waveEnergy) * exp(-camDist * 0.022);
    col = mix(col, mix(uShallow, uSkyColor, 0.52), contactSheen * 0.24);
    col = mix(col, vec3(1.05), clamp(foam, 0.0, 0.9));
    float surfaceAccent = clamp(foam + contactSheen * 0.12, 0.0, 0.92);
    float opacityDepth = 1.0 - exp(-vShoreDepth * ${glsl(WATER_OPACITY_EXTINCTION_PER_YARD)});
    float alpha = max(
      mix(${glsl(WATER_SHALLOW_ALPHA)}, ${glsl(WATER_DEEP_ALPHA)}, opacityDepth),
      surfaceAccent * 0.95
    );
    // Contour waterline (uShoreEdgeFade, interior strips/pools only): the
    // surface dissolves where the baked depth reaches zero, so the visible
    // bank is the terrain's own wet line, never the mesh rectangle. The noise
    // term wobbles the line so it reads as a shore, not a clip path. Off (0)
    // collapses the mix to 1.0: the overworld shader is byte-identical.
    float edgeWobble = 0.18 * sin(vWPos.x * 1.7 + vWPos.z * 2.3) + 0.12 * sin(vWPos.z * 4.1 - vWPos.x * 3.3);
    alpha *= mix(1.0, smoothstep(0.12, 0.85, vShoreDepth + edgeWobble * uShoreEdgeFade), uShoreEdgeFade);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Inert wave uniforms for surfaces with no interactive height field (no
 *  renderer to run the simulation, or an interior pool outside its window). */
export function zeroWaveUniforms(): WaterWaveUniforms {
  return {
    uWaveState: { value: WATER_TEX.n1 },
    uWaveEnabled: { value: 0 },
    uWaveOrigin: { value: new THREE.Vector2() },
    uWaveSize: { value: 1 },
  };
}

/**
 * Where the shader's texture and analytic frame is anchored, in world xz.
 *
 * Taken RELATIVE to this, and subtracted in the vertex stage, because an
 * instanced band sits around x = 113_700 where a highp float resolves about
 * 7mm: the ripple lookups quantize past a texel, and the foam's
 * `sin(x * 1.2)` loses its argument outright. The world's own water passes
 * (0, 0), where the subtraction is exact and the shader is unchanged.
 *
 * Camera distance, the view vector and the wave-field lookup stay in WORLD
 * space: they are about where the surface is, not about what is painted on it.
 */
export interface WaterSurfaceOrigin {
  x: number;
  z: number;
}

export interface WaterSurfaceMaterialOptions {
  wave: WaterWaveUniforms;
  surfaceOrigin?: WaterSurfaceOrigin;
  /**
   * Fades the surface to nothing where the baked depth reaches zero, so the
   * WATERLINE follows the terrain contour instead of the geometry boundary.
   * The overworld planes leave it off (their rect edges hide under carved
   * bathymetry and the apron); an interior strip or pool laid over its own
   * heightfield turns it on so a rectangular mesh cannot read as a hard-edged
   * sheet. Off is the exact pre-option shader (the mix collapses to 1.0), so
   * overworld output is unchanged.
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
  const origin = options.surfaceOrigin ?? { x: 0, z: 0 };
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      uNorm1: { value: WATER_TEX.n1 },
      uNorm2: { value: WATER_TEX.n2 },
      uNorm3: { value: WATER_TEX.broad },
      uSunDir: { value: SUN_DIR.clone() }, // the one shared sun (gfx.ts)
      uSunColor: { value: SUN_COLOR },
      uSkyColor: { value: SKY_TINT },
      uDeep: { value: options.deep ?? DEEP_COLOR },
      uShallow: { value: options.shallow ?? SHALLOW_COLOR },
      uTime: sharedUniforms.uTime,
      uSurfaceOrigin: { value: new THREE.Vector2(origin.x, origin.z) },
      uWaveState: options.wave.uWaveState,
      uWaveEnabled: options.wave.uWaveEnabled,
      uWaveOrigin: options.wave.uWaveOrigin,
      uWaveSize: options.wave.uWaveSize,
      uShoreEdgeFade: { value: options.shoreEdgeFade ? 1 : 0 },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
}
