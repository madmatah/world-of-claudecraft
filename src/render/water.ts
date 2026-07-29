import * as THREE from 'three';
import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_Z, WORLD_SIZE } from '../sim/data';
import type { ZoneDef } from '../sim/types';
import { waterLevel } from '../sim/world';
import { registerDeferredPreload } from './assets/preload';
import { activeFarFieldPolicy } from './foliage_impostor';
import { GFX } from './gfx';
import { idleSlot, runIdleQueue } from './idle_queue';
import { waterNormalish, waterNormalMaps } from './textures';
import { shoreDepthAt, shoreSlopeAt, WATER_SEABED_CLAMP_YARDS } from './water_core';
import { WaterSimulation } from './water_simulation';
import {
  buildWaterSurfaceMaterial,
  hasWaterShaderAssets,
  prepareWaterProfileAssets,
  zeroWaveUniforms,
} from './water_surface_material';

export { hasWaterShaderAssets, prepareWaterProfileAssets } from './water_surface_material';

// The surface shader lives in water_surface_material.ts, but the boot preload
// gate names THIS module, so the registration stays here.
registerDeferredPreload(() => prepareWaterProfileAssets(GFX));

// Water for the whole zone strip.
//
// High tier: one ShaderMaterial plane per zone (so off-screen zones frustum
// cull away) with a CPU-precomputed per-vertex shore depth. Dual scrolling
// real normal maps (three.js r165 water set, MIT) + a broad ocean-swell map
// at range, fresnel sky tint, HDR sun glints (>1 so bloom catches them), a
// shoreline foam band and a subtle wave displacement.
//
// On top of that static surface sits the interactive height field
// (water_simulation.ts): ONE camera-anchored window, not one field per lake,
// because this world's water is continuous (zone strips plus the horizon
// apron) and has no lake list to key fields off. Every water mesh shares one
// material, so the field's uniforms drive all of them by reference. The broad
// swell maps stay: the field is camera-local and contributes nothing at range,
// where an open sea still has to read as moving water.
//
// Low tier keeps the legacy scrolling Phong plane, upgraded with the real
// swell normal map for textured speculars.

const SEGMENTS_PER_ZONE = 180; // ~2u vertex spacing, enough for the foam band
// terrainHeight is deliberately rich and sampling all 32k water vertices in
// one timer was a measured 170-260ms live-play freeze. Background zone loads
// fill a handful of rows per idle callback instead; four rows stay around the
// 6ms cooperative-work budget on the profiling machine.
const WATER_ROWS_PER_IDLE_SLICE = 4;
const WATER_IDLE_TIMEOUT_MS = 200;
const WATER_VERTEX_ROWS = Array.from({ length: SEGMENTS_PER_ZONE + 1 }, (_, row) => row);
// The apron runs UNDER every zone plane and both ride one transparent material
// with depthWrite off, so the depth buffer cannot arbitrate between them: the
// surface that paints LAST wins the blend outright. Left to three.js's
// transparent sort that order comes from each object's bounding-sphere centre,
// and the apron's is a world-scale sheet near the origin, so merely orbiting
// the camera reorders them and swaps the sea between the apron's constant deep
// colour and the zone plane's shallow tint plus foam band. Pin the order so it
// can never depend on where the camera happens to be. The sky dome holds -10,
// so the apron sits between the sky and the default 0 band.
const WATER_APRON_RENDER_ORDER = -1;
const WATER_SURFACE_RENDER_ORDER = 0;

/**
 * Seabed slope the horizon apron falls back to once it is far enough out that
 * terrain sampling is no longer trustworthy. Foam is depth/slope, so a small
 * slope against a deep reading puts it far past the surf band: open water,
 * never foam.
 */
const APRON_SHORE_SLOPE = 1;
/**
 * The apron is NOT a featureless sheet. It begins exactly where the zone planes
 * stop (the world is only WORLD_SIZE yards across, so that edge is a few dozen
 * yards offshore and squarely in view), and a constant deep reading there steps
 * against whatever the zone plane actually has, which is usually still shelf.
 * Measured off Eastbrook: 1.51 yards on the plane's last vertex against the
 * apron's 6, drawn as a ruler-straight line because a rectangle edge IS
 * straight. So the apron samples the SAME terrain function the zone planes do
 * and the two agree at the seam by construction rather than by tuning.
 */
const APRON_SEGMENTS = 192;
/**
 * How far outside the world the apron keeps trusting terrainHeight. It stays
 * sensible well past the edge (6 yards, the clamp, by 70 yards out) but turns
 * into another landmass eventually (-38 yards at 720 out), which would paint
 * dry land across the horizon. Fade to the constant deep sea before that.
 */
const APRON_TERRAIN_FADE_YARDS = 240;

export interface WaterView {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * Advances the legacy texture scroll (low tier; high tier uses uTime) and
   * the interactive height field. Returns the simulation passes drawn this
   * frame, which the renderer folds into its draw-call accounting.
   */
  update(time: number, cameraX: number, cameraZ: number, visibleRange: number): number;
  /** Adds a local entry, landing, fish, or bobber disturbance. */
  addSplash(x: number, z: number, radius: number, strength?: number): void;
  /** Presses a facing-aligned body footprint into the surface. */
  enterContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Moves submerged volume from the previous footprint to the current one. */
  moveContact(
    oldX: number,
    oldZ: number,
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /** Refills the final submerged footprint when a contact exits. */
  releaseContact(
    x: number,
    z: number,
    radius: number,
    halfLength: number,
    axisX: number,
    axisZ: number,
    strength?: number,
  ): void;
  /**
   * Editor-only: re-seat the surface at the ACTIVE waterLevel() and recompute
   * the per-vertex shore depth from the CURRENT terrainHeight (after a
   * water-level change or a sculpt near the shoreline). Updates the existing
   * geometry in place (no geometry is replaced, so nothing leaks); the low
   * Phong tier has no shore attribute and only repositions its one plane.
   */
  setLevel(): void;
  /** Releases view-owned geometry, materials, and simulation targets. */
  dispose(): void;
}

function disposeOwned(meshes: THREE.Mesh[]): void {
  const materials = new Set<THREE.Material>();
  for (const mesh of meshes) {
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const entry of material) materials.add(entry);
    else materials.add(material);
  }
  for (const material of materials) material.dispose();
}

function buildShaderWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  // legacy procedural maps still get generated (unused) to preserve the
  // shared-LCG call order in textures.ts for everything generated after
  waterNormalMaps();
  const simulation = renderer ? new WaterSimulation(renderer) : null;
  const wave = simulation ? simulation.uniforms : zeroWaveUniforms();
  // ONE material for every zone plane and the apron, so the field's uniform
  // objects (shared by reference, like uTime) drive the whole surface.
  const material = buildWaterSurfaceMaterial({ wave });

  const meshes: THREE.Mesh[] = [];
  const group = new THREE.Group();
  group.name = 'water';
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<THREE.Mesh[]>>();
  // Per-mesh in-place refit closures: re-seat y and recompute the shore-depth
  // attribute from the CURRENT terrain (build and setLevel share them). The
  // vertices never move (only the attribute + the mesh transform change), so
  // the baked bounding volumes stay valid.
  const refits: (() => void)[] = [];
  // The apron: one huge deep-sea sheet running far past every map edge, so
  // looking off the world's side reads as open ocean to the horizon, never
  // a water plane ending in mid-air. It sits a hair below the zone planes
  // (no z-fight) and carries a constant deep shore attribute. Its reach must
  // beat the view envelope from ANY camera position or its rim shows as a
  // line against the sky; the vista tiers (whose outdoor fog is gone) open
  // that envelope well past the classic view, so the apron grows with the
  // tier plan, with extra segments so coastal cells stay fade-band sized.
  {
    const vista = activeFarFieldPolicy().vista;
    const reach = vista.enabled ? WORLD_MAX_X + vista.envelopeFar + 400 : 0;
    const width = vista.enabled ? reach * 2 : 3000;
    const span = WORLD_MAX_Z - WORLD_MIN_Z + (vista.enabled ? reach * 2 : 2400);
    const apronSegments = vista.enabled ? 288 : APRON_SEGMENTS;
    const geo = new THREE.PlaneGeometry(width, span, apronSegments, apronSegments).rotateX(
      -Math.PI / 2,
    );
    geo.translate(0, 0, (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const deep = new Float32Array(pos.count);
    const apronSlope = new Float32Array(pos.count);
    const half = WORLD_SIZE / 2;
    const edgeDepthCache = new Map<string, number>();
    const fillApron = (): void => {
      edgeDepthCache.clear();
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const z = pos.getZ(i);
        // Distance OUTSIDE the world rect: 0 anywhere the zone planes cover.
        const outside = Math.max(0, Math.abs(x) - half, z - WORLD_MAX_Z, WORLD_MIN_Z - z);
        // The apron is thousands of yards across and the world is 360, so the
        // vast majority of vertices are far outside and need no sampling at
        // all. Skipping them is what keeps this bake cheap enough to run
        // inline: terrainHeight is deliberately rich and shoreSlopeAt costs
        // four samples of it.
        if (outside >= APRON_TERRAIN_FADE_YARDS) {
          deep[i] = WATER_SEABED_CLAMP_YARDS;
          apronSlope[i] = APRON_SHORE_SLOPE;
          continue;
        }
        const t = outside / APRON_TERRAIN_FADE_YARDS;
        const toConstant = t * t * (3 - 2 * t); // smoothstep, flat at both ends
        // Sample the nearest point INSIDE the world, never past it. Inside, that
        // is the vertex itself, so the apron reads the exact function the zone
        // planes read and the seam closes by construction. Outside, it extends
        // the coast's own depth and fades to open sea. Sampling the real
        // terrain out there instead looks tempting and is wrong: it is another
        // landmass (measured -518 yards, i.e. dry ground), so it would paint
        // land and surf across the open horizon.
        // Every vertex on a ray heading straight out of one edge clamps to the
        // SAME boundary point, so the samples collapse heavily. Memoize them.
        const cx = Math.min(half, Math.max(-half, x));
        const cz = Math.min(WORLD_MAX_Z, Math.max(WORLD_MIN_Z, z));
        const key = `${cx},${cz}`;
        let edgeDepth = edgeDepthCache.get(key);
        if (edgeDepth === undefined) {
          edgeDepth = shoreDepthAt(cx, cz, seed);
          edgeDepthCache.set(key, edgeDepth);
        }
        const carried = outside > 0 ? Math.max(edgeDepth, 0) : edgeDepth;
        deep[i] = carried * (1 - toConstant) + WATER_SEABED_CLAMP_YARDS * toConstant;
      }
      // Slope is the GRADIENT of the depth just filled, so take it by finite
      // difference on the grid instead of calling shoreSlopeAt: that costs four
      // more terrainHeight samples per vertex and terrainHeight is the
      // expensive part. It cannot be dropped for a constant either: the shader
      // reads foam as depth/slope, and a constant slope of 1 against the real
      // shelf depths out here (~1.5 yards) lands inside the surf band and would
      // paint foam across open water.
      const columns = apronSegments + 1;
      const dx = (2 * width) / apronSegments;
      const dz = (2 * span) / apronSegments;
      for (let i = 0; i < pos.count; i++) {
        const row = Math.floor(i / columns);
        const col = i % columns;
        const west = col > 0 ? deep[i - 1] : deep[i];
        const east = col < columns - 1 ? deep[i + 1] : deep[i];
        const north = row > 0 ? deep[i - columns] : deep[i];
        const south = row < columns - 1 ? deep[i + columns] : deep[i];
        // Never zero: the shader divides by this.
        apronSlope[i] = Math.max(Math.hypot((east - west) / dx, (south - north) / dz), 1e-4);
      }
    };
    fillApron();
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(deep, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(apronSlope, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const apron = new THREE.Mesh(geo, material);
    apron.position.y = waterLevel() - 0.06;
    apron.renderOrder = WATER_APRON_RENDER_ORDER;
    meshes.push(apron);
    group.add(apron);
    refits.push(() => {
      fillApron();
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
      apron.position.y = waterLevel() - 0.06;
    });
  }
  const buildZone = async (zone: ZoneDef, idlePace: boolean): Promise<THREE.Mesh> => {
    const depth = zone.zMax - zone.zMin;
    // each plane covers its zone's own rect: the side columns live at
    // x beyond the strip, and a strip-centered plane would leave their
    // shores (and the border meres straddling the column line) on the
    // featureless apron with no foam or shallow grading
    const x0 = zone.xMin ?? -WORLD_SIZE / 2;
    const x1 = zone.xMax ?? WORLD_SIZE / 2;
    const geo = new THREE.PlaneGeometry(
      x1 - x0,
      depth,
      SEGMENTS_PER_ZONE,
      SEGMENTS_PER_ZONE,
    ).rotateX(-Math.PI / 2);
    geo.translate((x0 + x1) / 2, 0, (zone.zMin + zone.zMax) / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const shoreDepth = new Float32Array(pos.count);
    const shoreSlope = new Float32Array(pos.count);
    const columns = SEGMENTS_PER_ZONE + 1;
    const fillRow = (row: number): void => {
      const start = row * columns;
      const end = Math.min(pos.count, start + columns);
      for (let i = start; i < end; i++) {
        shoreDepth[i] = shoreDepthAt(pos.getX(i), pos.getZ(i), seed);
        shoreSlope[i] = shoreSlopeAt(pos.getX(i), pos.getZ(i), seed);
      }
    };
    const fill = (): void => {
      for (const row of WATER_VERTEX_ROWS) fillRow(row);
    };
    if (idlePace) {
      await runIdleQueue(WATER_VERTEX_ROWS, fillRow, {
        batchSize: WATER_ROWS_PER_IDLE_SLICE,
        timeoutMs: WATER_IDLE_TIMEOUT_MS,
      });
    } else {
      fill();
    }
    geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(shoreDepth, 1));
    geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(shoreSlope, 1));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = waterLevel();
    mesh.renderOrder = WATER_SURFACE_RENDER_ORDER;
    // The renderer compiles a background zone's material while this mesh is
    // hidden, then reveals it. Adding it visible here lets the next rAF draw
    // (and synchronously upload/link) it before prepareZoneAt can prewarm it.
    mesh.visible = !idlePace;
    meshes.push(mesh);
    group.add(mesh);
    refits.push(() => {
      fill();
      (geo.attributes.aShoreDepth as THREE.BufferAttribute).needsUpdate = true;
      (geo.attributes.aShoreSlope as THREE.BufferAttribute).needsUpdate = true;
      mesh.position.y = waterLevel();
    });
    return mesh;
  };
  return {
    group,
    meshes,
    ensureZone(zone: ZoneDef, opts?: { pace?: 'fast' | 'idle' }): Promise<THREE.Mesh[]> {
      if (loadedZones.has(zone.id)) return Promise.resolve([]);
      const pending = pendingZones.get(zone.id);
      if (pending) return pending;
      const idlePace = opts?.pace === 'idle';
      const scheduled = idlePace
        ? idleSlot(WATER_IDLE_TIMEOUT_MS)
        : new Promise<void>((resolve) => setTimeout(resolve, 0));
      const task = scheduled
        .then(async () => {
          const mesh = await buildZone(zone, idlePace);
          loadedZones.add(zone.id);
          return [mesh];
        })
        .finally(() => pendingZones.delete(zone.id));
      pendingZones.set(zone.id, task);
      return task;
    },
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    update(_time: number, cameraX: number, cameraZ: number): number {
      return simulation?.update(_time, cameraX, cameraZ) ?? 0;
    },
    addSplash(x: number, z: number, radius: number, strength = 1): void {
      simulation?.addSplash(x, z, radius, strength);
    },
    enterContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.enterContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    moveContact(
      oldX: number,
      oldZ: number,
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.moveContact(oldX, oldZ, x, z, radius, halfLength, axisX, axisZ, strength);
    },
    releaseContact(
      x: number,
      z: number,
      radius: number,
      halfLength: number,
      axisX: number,
      axisZ: number,
      strength = 1,
    ): void {
      simulation?.releaseContact(x, z, radius, halfLength, axisX, axisZ, strength);
    },
    setLevel(): void {
      simulation?.reset();
      for (const refit of refits) refit();
    },
    dispose(): void {
      simulation?.dispose();
      disposeOwned(meshes);
    },
  };
}

function buildPhongWater(): WaterView {
  const tex = waterNormalish();
  const [norm] = waterNormalMaps();
  const mat = new THREE.MeshPhongMaterial({
    color: 0x2a6a96,
    transparent: true,
    opacity: 0.8,
    shininess: 140,
    specular: 0xd8ecff,
    map: tex,
    normalMap: norm,
    normalScale: new THREE.Vector2(0.8, 0.8),
  });
  // low tier gets the same to-the-horizon apron by simply oversizing the
  // one plane (the tiled texture keeps its density via the repeat bump)
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z + 2400;
  tex.repeat.set(240, 240);
  norm.repeat.set(210, 620);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3000, worldDepth).rotateX(-Math.PI / 2), mat);
  mesh.position.set(0, waterLevel(), (WORLD_MIN_Z + WORLD_MAX_Z) / 2);
  const meshes = [mesh];
  const group = new THREE.Group();
  group.name = 'water';
  group.add(mesh);
  return {
    group,
    meshes,
    ensureZone: async () => [],
    isZoneLoaded: () => true,
    // The low tier has no height field at all: a Phong plane cannot sample one,
    // and the tier exists precisely to skip that GPU work.
    update(time: number): number {
      tex.offset.x = time * 0.008;
      tex.offset.y = time * 0.011;
      norm.offset.x = time * 0.006;
      norm.offset.y = time * 0.009;
      return 0;
    },
    addSplash: () => {},
    enterContact: () => {},
    moveContact: () => {},
    releaseContact: () => {},
    setLevel(): void {
      for (const m of meshes) m.position.y = waterLevel();
    },
    dispose(): void {
      disposeOwned(meshes);
    },
  };
}

export function buildWater(seed: number, renderer?: THREE.WebGLRenderer): WaterView {
  return GFX.standardMaterials && hasWaterShaderAssets()
    ? buildShaderWater(seed, renderer)
    : buildPhongWater();
}
