import * as THREE from 'three';
import {
  COLUMN_ZONES,
  columnBlendAt,
  STRIP_MAX_X,
  STRIP_MIN_X,
  STRIP_ZONES,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_Z,
  ZONES,
} from '../sim/data';
import { fbm2 } from '../sim/rng';
import type { BiomeId, ZoneDef } from '../sim/types';
import { roadDistance, WATER_LEVEL, zoneBiomeAt } from '../sim/world';
import { registerDeferredPreload } from './assets/preload';
import { type ChunkGrid, type GroundPendingAt, orderCellsForEntry } from './chunk_residency_core';
import { GFX } from './gfx';
import {
  type BrushUniforms,
  buildGroundLambertMaterial,
  buildGroundSplatMaterial,
  GROUND_NORMAL_ANISOTROPY,
  hasGroundSplatAssets,
  makeBrushUniforms,
  prepareTerrainProfileAssets,
} from './ground_material';

export { prepareTerrainProfileAssets } from './ground_material';

// The ground material lives in ground_material.ts, but the boot preload gate
// names THIS module, so the registration stays here.
registerDeferredPreload(() => prepareTerrainProfileAssets(GFX));

import { idleSlot } from './idle_queue';
import { impactCraterTerrainBlend } from './impact_terrain';
import {
  beginChunkGeometry,
  type ChunkGeometryArrays,
  type ChunkGeometryBuildState,
  fillChunkIndexRow,
  fillChunkVertexRow,
} from './terrain_chunk_build';
import { terrainChunkPool } from './terrain_chunk_pool';
import { meshTerrainHeight } from './terrain_mesh_height';
import {
  chunkIntersectsRegion,
  normalTexelBounds,
  owningRectIndex,
  type TexelBounds,
  type WorldRect,
} from './terrain_region_core';
import { terrainSplatPresence, terrainSplatPresenceMask } from './terrain_splat_presence_core';

// Chunked terrain across the whole 360x1080 zone strip.
//
// - ~60u chunks with their own bounding volumes so frustum culling actually
//   works (the old single-plane-per-zone terrain was always fully submitted).
// - LOD by distance from the nearest hub at build time: settlements (where
//   the camera lingers) get dense vertices, the wilderness gets coarse ones.
//   Chunks carrying the impassable mountain walls (inter-zone ridges, world
//   rim) are promoted to the densest band regardless: the terraced walls hold
//   the heightfield's highest frequencies and the far band smears them into
//   ragged shards.
// - Skirts hang from every chunk edge to hide LOD cracks: a 0.3u base drop
//   plus the vertex slope times the coarsest band spacing, since a T-junction
//   hole grows with both the neighbor's chord span and the local gradient
//   (terraced cliffs open multi-yard holes that a flat drop cannot cover).
// - High tier: MeshStandardMaterial + splat shading (grass/dirt/rock/sand
//   weights precomputed per vertex from slope/height/roadDistance into a vec4
//   attribute) over the biome vertex-color tint, plus a world-space macro
//   normal map baked from the mesh height view (terrain_mesh_height.ts).
// - Low tier: the legacy vertex-color Lambert look, still chunked for culling.

const CHUNK_SIZE = 60;
// An 'idle'-paced zone build waits for a browser idle slot between batches;
// this timeout forces one batch through anyway under sustained frame load.
const IDLE_BUILD_TIMEOUT_MS = 200;

// vertex spacing by distance from the nearest hub centre
const LOD_BANDS = {
  high: [
    { maxHubDist: 95, spacing: 1.2 },
    { maxHubDist: 185, spacing: 1.6 },
    { maxHubDist: Infinity, spacing: 2.6 },
  ],
  low: [
    { maxHubDist: 95, spacing: 3.0 },
    { maxHubDist: 185, spacing: 4.4 },
    { maxHubDist: Infinity, spacing: 6.5 },
  ],
} as const;

// Mountain-wall chunks are promoted to the densest LOD band. Half-widths
// mirror sim/world.ts: the ridge contribution lives within RIDGE_SIGMA*3
// (30yd) of each inter-zone ridge line, and the rim rise starts 30yd inside
// the world edge (plus crest-noise margin).
const WALL_LOD_RIDGE_HALF = 30;
const WALL_LOD_RIM_MARGIN = 40;

// Macro relief only needs to carry broad slopes: vertex normals and the four
// tiled material normals own close detail. The atlas spans the whole expanded
// world but is baked sparsely by zone, so keep it compact enough that entering
// a new region never turns tens of thousands of height samples into a
// second boot. At the current bounds this is roughly 3yd/texel.
const NORMAL_TEX_W = 320;
const NORMAL_TEX_H = 960;
// nudged up from 1.35: at 3yd/texel the macro relief was reading flat next
// to the strengthened per-material detail normals
const NORMAL_TEX_STRENGTH = 1.55;

// Ground colors per biome; boundaries blend across the same window as the
// heightfield's shape blend. This is the tint layer the splat albedo
// multiplies into (splat textures are authored near mid-gray).
function finishChunkGeometry(state: ChunkGeometryArrays): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(state.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(state.normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(state.colors, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(state.uvs, 2));
  if (state.splats) geo.setAttribute('aSplat', new THREE.BufferAttribute(state.splats, 4));
  if (state.extras) geo.setAttribute('aExtra', new THREE.BufferAttribute(state.extras, 4));
  if (state.splats) {
    const presence = terrainSplatPresence(state.splats, state.extras);
    const packedPresence = new Uint8Array(state.positions.length / 3);
    packedPresence.fill(terrainSplatPresenceMask(presence));
    geo.setAttribute('aTerrainPresenceMask', new THREE.BufferAttribute(packedPresence, 1));
  }
  geo.setIndex(new THREE.BufferAttribute(state.indices, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

function buildChunkGeometry(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
  lowShade: boolean,
): THREE.BufferGeometry {
  const state = beginChunkGeometry(x0, z0, size, spacing, seed, withSplat, skirtSpan, lowShade);
  for (let row = 0; row < state.gh; row++) fillChunkVertexRow(state, row);
  for (let row = 0; row < state.gh - 1; row++) fillChunkIndexRow(state, row);
  return finishChunkGeometry(state);
}

const IDLE_GEOMETRY_SLICE_MS = 6;

async function buildChunkGeometryIdle(
  x0: number,
  z0: number,
  size: number,
  spacing: number,
  seed: number,
  withSplat: boolean,
  skirtSpan: number,
  lowShade: boolean,
  yieldSlice: () => Promise<void>,
  cancelled: () => boolean,
): Promise<THREE.BufferGeometry | null> {
  const state = beginChunkGeometry(x0, z0, size, spacing, seed, withSplat, skirtSpan, lowShade);
  const drainRows = async (rows: number, fill: (row: number) => void): Promise<boolean> => {
    let row = 0;
    while (row < rows) {
      await yieldSlice();
      if (cancelled()) return false;
      const started = performance.now();
      do fill(row++);
      while (row < rows && performance.now() - started < IDLE_GEOMETRY_SLICE_MS);
    }
    return true;
  };
  if (!(await drainRows(state.gh, (row) => fillChunkVertexRow(state, row)))) return null;
  if (!(await drainRows(state.gh - 1, (row) => fillChunkIndexRow(state, row)))) return null;
  return finishChunkGeometry(state);
}

// ---------------------------------------------------------------------------
// Macro relief: a DataTexture normal map baked from the mesh height view in
// strip-planar UV space — cliffs and ridges get per-pixel light response far
// beyond the vertex density.
// ---------------------------------------------------------------------------

// Bake the normal texels [i0..i1] x [j0..j1] (inclusive) into `data`, sampling
// the CURRENT mesh height. The full build and the editor's partial rebake
// share this one path so a partial rebake is byte-identical to a full one:
// heights are sampled one texel beyond the baked rect (clamped at the texture
// border, exactly like the full bake's clamped derivative stencil).
function bakeNormalRegion(
  data: Uint8Array,
  seed: number,
  i0: number,
  i1: number,
  j0: number,
  j1: number,
): void {
  const w = NORMAL_TEX_W,
    h = NORMAL_TEX_H;
  const worldW = WORLD_MAX_X * 2;
  const worldD = WORLD_MAX_Z - WORLD_MIN_Z;
  const stepX = worldW / w;
  const stepZ = worldD / h;
  // height window: the baked rect plus the 1-texel derivative stencil
  const hi0 = Math.max(0, i0 - 1),
    hi1 = Math.min(w - 1, i1 + 1);
  const hj0 = Math.max(0, j0 - 1),
    hj1 = Math.min(h - 1, j1 + 1);
  const hw = hi1 - hi0 + 1;
  const heights = new Float32Array(hw * (hj1 - hj0 + 1));
  for (let j = hj0; j <= hj1; j++) {
    const z = WORLD_MIN_Z + (j + 0.5) * stepZ;
    for (let i = hi0; i <= hi1; i++) {
      heights[(j - hj0) * hw + (i - hi0)] = meshTerrainHeight(
        -WORLD_MAX_X + (i + 0.5) * stepX,
        z,
        seed,
      );
    }
  }
  const hAt = (i: number, j: number): number => heights[(j - hj0) * hw + (i - hi0)];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const iw = Math.max(0, i - 1),
        ie = Math.min(w - 1, i + 1);
      const jn = Math.max(0, j - 1),
        js = Math.min(h - 1, j + 1);
      const dhdx = (hAt(ie, j) - hAt(iw, j)) / ((ie - iw) * stepX);
      const dhdz = (hAt(i, js) - hAt(i, jn)) / ((js - jn) * stepZ);
      const nx = -dhdx * NORMAL_TEX_STRENGTH;
      const nz = -dhdz * NORMAL_TEX_STRENGTH;
      const inv = 1 / Math.hypot(nx, 1, nz);
      const o = (j * w + i) * 4;
      data[o] = (nx * inv * 0.5 + 0.5) * 255;
      data[o + 1] = (nz * inv * 0.5 + 0.5) * 255; // green follows +v (+z)
      data[o + 2] = (inv * 0.5 + 0.5) * 255;
      data[o + 3] = 255;
    }
  }
}

function terrainNormalTexture(): THREE.DataTexture {
  const data = new Uint8Array(NORMAL_TEX_W * NORMAL_TEX_H * 4);
  // Zone texels are baked on demand. Unloaded areas remain a flat normal and
  // have no geometry, so they cannot be sampled on screen.
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 128;
    data[i + 1] = 128;
    data[i + 2] = 255;
    data[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, NORMAL_TEX_W, NORMAL_TEX_H, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  // Mipmapped minification (DataTexture defaults it off): the bake packs the
  // terraces' near-vertical risers next to flat treads at 0.56u/texel, and
  // sampling that unfiltered from a distant camera aliases the lighting into
  // shimmering checker patterns. Mips average the relief away smoothly with
  // distance instead. WebGL2 handles the NPOT mip chain; the editor's
  // rebakeNormalRegion re-upload regenerates it automatically.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = GROUND_NORMAL_ANISOTROPY;
  tex.needsUpdate = true;
  return tex;
}

export const terrainInternalsForTest = {
  createSplatMaterial(): THREE.MeshStandardMaterial {
    const normal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    return buildGroundSplatMaterial({ normalMap: normal, brush: makeBrushUniforms() });
  },
  finishChunkGeometry,
};
// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface EnsureZoneOptions {
  /** Build the cells nearest this point first (e.g. the entry position).
   *  Falls back to buildTerrain's priorityPoint when omitted. */
  priority?: { x: number; z: number };
  /** 'fast' (default): the caller is gating on the result (boot, a teleport
   *  behind the loading screen), so yield only between small batches.
   *  'idle': a background prepare; every batch waits for a browser idle slot
   *  (requestIdleCallback with a forced-progress timeout) so the build never
   *  steals time an interactive frame needs. */
  pace?: 'fast' | 'idle';
}

export interface TerrainView {
  group: THREE.Group;
  /** Materialize one overworld zone. Repeated calls share the cached task. */
  ensureZone(
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void>;
  isZoneLoaded(zoneId: string): boolean;
  /**
   * The chunk lattice this view builds on, plus whether a given cell still owes
   * geometry. The outdoor fog clamp reads ground residency through this narrow
   * accessor (never through the renderer's zone-level `preparedZones`), so it
   * stops at the nearest UNBUILT CHUNK rather than the nearest unprepared zone
   * rectangle, and so retiring zone residency later is one implementation swap.
   * The returned object is stable across calls: it is read every frame.
   */
  groundResidency(): { grid: ChunkGrid; isPending: GroundPendingAt };
  /** hides chunks that sit entirely past the fog far plane */
  update(camX: number, camZ: number, fogFar: number): void;
  /**
   * Editor-only: re-mesh ONLY the chunks intersecting the world-space region
   * (a sculpt brush footprint), swapping each geometry in place on the existing
   * mesh (old geometry disposed, shared material kept). Cheap enough to run
   * several times per second during a brush drag; the stale macro normal
   * texture is NOT touched here (see rebakeNormalRegion, for stroke end).
   */
  rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: rebake the region's texels of the macro normal DataTexture
   * from the current mesh height and flag it for re-upload. Byte-identical
   * to a full bake over those texels. Call at stroke end, never per drag
   * sample. No-op on the Lambert tier (it has no normal map).
   */
  rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void;
  /**
   * Editor-only: project the brush ring at world (x, z) with the given radius
   * (yards) onto both terrain materials. Writes uniform values only (no
   * material rebuild). Radius <= 0 hides the ring, as does clearBrush().
   */
  setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void;
  /** Editor-only: hide the brush ring. */
  clearBrush(): void;
  /**
   * Stops any in-flight ensureZone build from adding further chunks. Call
   * before discarding this view (see renderer rebuildTerrain), or the
   * abandoned zone builds keep running on a setTimeout chain.
   */
  cancelStreaming(): void;
}

export function buildTerrain(seed: number, priorityPoint?: { x: number; z: number }): TerrainView {
  const lowGfx = !GFX.terrainSplat || !hasGroundSplatAssets();
  // Resolved here, not inside the generator: gfx.ts reads document/navigator, so
  // a worker running the same generator would resolve a different tier.
  const lowShade = GFX.lowPlus && !GFX.terrainSplat;
  const brush = makeBrushUniforms();
  const normalTex = lowGfx ? null : terrainNormalTexture();
  const mat = normalTex
    ? buildGroundSplatMaterial({ normalMap: normalTex, brush })
    : buildGroundLambertMaterial(brush);
  const bands = lowGfx ? LOD_BANDS.low : LOD_BANDS.high;
  const group = new THREE.Group();
  group.name = 'terrain';
  const worldDepth = WORLD_MAX_Z - WORLD_MIN_Z;
  const chunksX = Math.ceil((WORLD_MAX_X * 2) / CHUNK_SIZE);
  const chunksZ = Math.ceil(worldDepth / CHUNK_SIZE);
  const grid: ChunkGrid = {
    size: CHUNK_SIZE,
    countX: chunksX,
    countZ: chunksZ,
    originX: -WORLD_MAX_X,
    originZ: WORLD_MIN_Z,
  };
  // 1 = this cell is owed terrain geometry and has not attached it yet, which
  // is the only state that may clamp the outdoor fog. Ownership is TOTAL
  // since the gap-cell fill (cellOwnerId assigns every cell its containing
  // zone, else the nearest rectangle), so ALL 792 cells seed pending and each
  // one is genuinely buildable by its owner: pending-until-attach is the
  // correct state everywhere, and the old carve-out for unowned cells (the
  // rects do not tile; 96 cells used to be permanently unbuildable) is gone.
  const groundPending = new Uint8Array(chunksX * chunksZ);
  // x/z/half feed the per-frame fog cull; x0/z0/size/spacing are the exact
  // buildChunkGeometry inputs, kept so an editor rebuild re-runs the same build.
  const chunks: {
    mesh: THREE.Mesh;
    x: number;
    z: number;
    half: number;
    x0: number;
    z0: number;
    size: number;
    spacing: number;
  }[] = [];

  // True when the chunk cell overlaps a mountain-wall band: an inter-zone
  // ridge line (ZONES[i].zMax) or the world rim. Those chunks always take the
  // densest band; the walls sit far from every hub, so hub-distance LOD alone
  // hands the steepest, most looked-at cliffs the coarsest grid.
  const wallChunkAt = (x0: number, z0: number, size: number): boolean => {
    if (x0 < -WORLD_MAX_X + WALL_LOD_RIM_MARGIN || x0 + size > WORLD_MAX_X - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    if (z0 < WORLD_MIN_Z + WALL_LOD_RIM_MARGIN || z0 + size > WORLD_MAX_Z - WALL_LOD_RIM_MARGIN) {
      return true;
    }
    for (let i = 0; i + 1 < ZONES.length; i++) {
      const ridgeZ = ZONES[i].zMax;
      if (z0 - WALL_LOD_RIDGE_HALF < ridgeZ && z0 + size + WALL_LOD_RIDGE_HALF > ridgeZ) {
        return true;
      }
    }
    return false;
  };

  // The zone rectangles do NOT tile the world box. Three kinds of cell fall
  // outside every one of them: the whole quadrant west of Eastbrook Vale (no
  // realm sits at x < -180 for z -180..180), the centre column north of
  // Frostveil, and the grid's last row, which overhangs WORLD_MAX_Z and so
  // carries the northern 20yd of the Drakelands rim. Those cells still hold
  // ground a player reaches on foot: the tongue of land running south out of
  // the Willowfen border around (-195, 161) sits 1.6yd ABOVE the waterline.
  // Leaving them unowned meant no zone's build ever meshed them, so that
  // ground rendered as a hole you could see (and fall) through.
  const zoneRects: WorldRect[] = ZONES.map((zone) => ({
    minX: zone.xMin ?? STRIP_MIN_X,
    maxX: zone.xMax ?? STRIP_MAX_X,
    minZ: zone.zMin,
    maxZ: zone.zMax,
  }));
  const insideAnyZone = (x: number, z: number): boolean =>
    zoneRects.some((r) => x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ);

  const bandIndexAt = (cx: number, cz: number): number => {
    const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
    const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
    const centerX = x0 + CHUNK_SIZE / 2;
    const centerZ = z0 + CHUNK_SIZE / 2;
    // Cells outside every realm (see zoneRects) are open sea floor and the
    // outer face of the rim: no quest, camp, or road ever lands there, and the
    // sim drowns a player who swims out. They take the coarsest band whatever
    // wallChunkAt says, so the gap fill costs a handful of merged super-chunks
    // instead of a dense grid over water nobody stands on. Checked BEFORE the
    // wall promotion, which would otherwise hand the empty south-west quadrant
    // the 1.2u spacing meant for the terraced inter-zone walls.
    if (!insideAnyZone(centerX, centerZ)) return bands.length - 1;
    if (wallChunkAt(x0, z0, CHUNK_SIZE)) return 0;
    let hubDist = Infinity;
    for (const zn of ZONES) {
      hubDist = Math.min(hubDist, Math.hypot(centerX - zn.hub.x, centerZ - zn.hub.z));
    }
    const idx = bands.findIndex((b) => hubDist <= b.maxHubDist);
    return idx === -1 ? bands.length - 1 : idx;
  };

  // the coarsest spacing any neighbor chunk can have; sizes the slope-aware
  // skirt drop so a fine chunk's skirt always reaches past the coarsest
  // neighbor's chord (and vice versa)
  const skirtSpan = bands[bands.length - 1].spacing;

  const attachChunk = (
    geo: THREE.BufferGeometry,
    x0: number,
    z0: number,
    size: number,
    spacing: number,
  ): void => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    // Terrain casts too: without this no hill can shade its own lee side or
    // the valley under it, and open country reads shadow-flat however the
    // rig is tuned. Form shadows are the difference between painted dunes
    // and lit ones. Chunks outside the 105u shadow frustum are culled from
    // the depth pass, so the cost is a dozen static meshes re-drawn there.
    // GFX.terrainCastShadows follows dynamicShadows on the tier ladder; the
    // Advanced Shadow Quality dial sheds it below its High level.
    mesh.castShadow = GFX.terrainCastShadows;
    group.add(mesh);
    // A chunk's transform never changes after this point (its shape lives in
    // the geometry, not the mesh matrix), so it can freeze immediately rather
    // than waiting for the caller's group-wide freezeStaticMatrices pass.
    // That pass only runs once, right after the synchronous near ring returns,
    // so every chunk streamed in afterward (the majority, on the far bands)
    // would otherwise keep matrixAutoUpdate = true and recompose every frame
    // for the rest of the session.
    mesh.updateMatrixWorld(true);
    mesh.matrixAutoUpdate = false;
    // Ground residency flips HERE, where the mesh actually joins the scene, and
    // never at the point the cell is claimed for building: `built` below is set
    // BEFORE the (idle-paced, possibly multi-second) geometry build is awaited,
    // so keying the fog off it would open the view over ground that has not
    // arrived. A far-band super-chunk covers a 2x2 block, hence the span.
    const span = Math.max(1, Math.round(size / CHUNK_SIZE));
    const cx0 = Math.round((x0 + WORLD_MAX_X) / CHUNK_SIZE);
    const cz0 = Math.round((z0 - WORLD_MIN_Z) / CHUNK_SIZE);
    for (let dz = 0; dz < span; dz++) {
      for (let dx = 0; dx < span; dx++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cx >= chunksX || cz < 0 || cz >= chunksZ) continue;
        groundPending[cz * chunksX + cx] = 0;
      }
    }
    chunks.push({
      mesh,
      x: x0 + size / 2,
      z: z0 + size / 2,
      half: size / 2,
      x0,
      z0,
      size,
      spacing,
    });
  };
  const addChunk = (x0: number, z0: number, size: number, spacing: number): void => {
    attachChunk(
      buildChunkGeometry(x0, z0, size, spacing, seed, !lowGfx, skirtSpan, lowShade),
      x0,
      z0,
      size,
      spacing,
    );
  };
  // One pool per view, torn down with it. Null wherever module workers are
  // unavailable (Vitest under Node, an old WebView, a blocked CSP), in which
  // case every build below takes the main-thread path exactly as before.
  let pool: ReturnType<typeof terrainChunkPool> | null | undefined;
  const chunkPool = (): ReturnType<typeof terrainChunkPool> => {
    if (pool === undefined) pool = terrainChunkPool();
    return pool;
  };
  // A background chunk built OFF-THREAD. Generation is pure arithmetic, so the
  // only reason the idle path yields constantly is to protect frames; with no
  // frame to protect it runs flat out. Returns false only when the caller
  // should fall back, never on cancellation, which the caller checks itself.
  const addChunkInWorker = async (
    x0: number,
    z0: number,
    size: number,
    spacing: number,
  ): Promise<boolean> => {
    const active = chunkPool();
    if (!active) return false;
    const arrays = await active.build({
      x0,
      z0,
      size,
      spacing,
      seed,
      withSplat: !lowGfx,
      skirtSpan,
      lowShade,
    });
    if (!arrays) return false;
    if (cancelled) return true; // discarded view: drop the result, do not attach
    attachChunk(finishChunkGeometry(arrays), x0, z0, size, spacing);
    return true;
  };
  const addChunkIdle = async (
    x0: number,
    z0: number,
    size: number,
    spacing: number,
    yieldSlice: () => Promise<void>,
  ): Promise<boolean> => {
    if (await addChunkInWorker(x0, z0, size, spacing)) return !cancelled;
    const geo = await buildChunkGeometryIdle(
      x0,
      z0,
      size,
      spacing,
      seed,
      !lowGfx,
      skirtSpan,
      lowShade,
      yieldSlice,
      () => cancelled,
    );
    if (!geo) return false;
    attachChunk(geo, x0, z0, size, spacing);
    return true;
  };

  // far-LOD cells merge 2x2 into super-chunks: the far field is where draw
  // count hurts and culling granularity matters least
  const farBand = bands.length - 1;
  const built = new Set<number>();
  const loadedZones = new Set<string>();
  const pendingZones = new Map<string, Promise<void>>();
  // Set by cancelStreaming(): every in-flight ensureZone loop bails at its next
  // yield point without marking its zone loaded, so a discarded view (see
  // renderer rebuildTerrain) stops adding chunks instead of building on a
  // setTimeout chain for the rest of the session.
  let cancelled = false;
  // Every cell of the grid gets exactly one owner: the zone containing it,
  // else (the gap cells described at zoneRects) the nearest zone rectangle.
  // See owningRectIndex for why nearest-rect and not zoneAt's z-band clamp.
  const cellOwnerId = (cx: number, cz: number): string => {
    const x = -WORLD_MAX_X + (cx + 0.5) * CHUNK_SIZE;
    const z = WORLD_MIN_Z + (cz + 0.5) * CHUNK_SIZE;
    return ZONES[owningRectIndex(x, z, zoneRects)].id;
  };
  groundPending.fill(1);
  const residency = {
    grid,
    isPending: (cx: number, cz: number): boolean => groundPending[cz * chunksX + cx] === 1,
  };
  const zoneCells = (zone: ZoneDef): [number, number][] => {
    const out: [number, number][] = [];
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        if (cellOwnerId(cx, cz) === zone.id) out.push([cx, cz]);
      }
    }
    return out;
  };
  const yieldBuild = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  // Background ('idle') builds advance one batch per idle slot instead: the
  // timeout still forces progress under sustained load, so a later gating
  // caller awaiting the same shared task is never starved indefinitely.
  const yieldIdle = (): Promise<void> => idleSlot(IDLE_BUILD_TIMEOUT_MS);
  const normalTexelsOver = (minX: number, minZ: number, maxX: number, maxZ: number) =>
    normalTexelBounds(
      minX,
      minZ,
      maxX,
      maxZ,
      -WORLD_MAX_X,
      WORLD_MIN_Z,
      WORLD_MAX_X * 2,
      WORLD_MAX_Z - WORLD_MIN_Z,
      NORMAL_TEX_W,
      NORMAL_TEX_H,
      1,
    );
  // The macro normal texels this zone's build must bake: its own rectangle,
  // plus one region per owned cell lying outside it (the gap cells above).
  // An unbaked texel stays flat, so without the extra regions the macro relief
  // would stop dead at the realm border. Region-per-cell rather than one
  // bounding box over rect + cells: the gap west of Eastbrook Vale is as wide
  // as the realm itself, and a bbox would re-bake that whole empty quadrant.
  const normalRegionsFor = (zone: ZoneDef, cells: readonly [number, number][]): TexelBounds[] => {
    const minX = zone.xMin ?? STRIP_MIN_X;
    const maxX = zone.xMax ?? STRIP_MAX_X;
    const regions: TexelBounds[] = [];
    const zoneBounds = normalTexelsOver(minX, zone.zMin, maxX, zone.zMax);
    if (zoneBounds) regions.push(zoneBounds);
    for (const [cx, cz] of cells) {
      const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
      const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
      const inside =
        x0 >= minX && x0 + CHUNK_SIZE <= maxX && z0 >= zone.zMin && z0 + CHUNK_SIZE <= zone.zMax;
      if (inside) continue; // already covered by zoneBounds
      const cellBounds = normalTexelsOver(x0, z0, x0 + CHUNK_SIZE, z0 + CHUNK_SIZE);
      if (cellBounds) regions.push(cellBounds);
    }
    return regions;
  };
  const ensureZone = (
    zone: ZoneDef,
    onProgress?: (done: number, total: number) => void,
    opts?: EnsureZoneOptions,
  ): Promise<void> => {
    if (loadedZones.has(zone.id)) {
      onProgress?.(1, 1);
      return Promise.resolve();
    }
    const pending = pendingZones.get(zone.id);
    if (pending) return pending;
    const idlePace = opts?.pace === 'idle';
    const yieldSlice = idlePace ? yieldIdle : yieldBuild;
    // Gating builds race in batches of four. Idle geometry has its own
    // row/time-sliced builder, preserving one mesh per cell without a blocking
    // 60 yd build or the old four-mesh subdivision workaround.
    const cellsPerSlice = 4;
    const task = (async () => {
      // Build order is the "which chunk next" seam, and it lives in the pure
      // core so a later globally nearest-first queue replaces one function
      // instead of the zone lane around it.
      const cells = orderCellsForEntry(
        zoneCells(zone),
        grid,
        opts?.priority ?? priorityPoint,
        CHUNK_SIZE * 3,
      );
      const normalRegions = normalTex ? normalRegionsFor(zone, cells) : [];
      const rowsPerSlice = 12;
      const normalSlices = normalRegions.reduce(
        (slices, region) => slices + Math.ceil((region.j1 - region.j0 + 1) / rowsPerSlice),
        0,
      );
      const total = Math.max(1, normalSlices + cells.length);
      let done = 0;
      if (normalTex && normalRegions.length > 0) {
        for (const region of normalRegions) {
          for (let j = region.j0; j <= region.j1; j += rowsPerSlice) {
            if (cancelled) return;
            bakeNormalRegion(
              normalTex.image.data as Uint8Array,
              seed,
              region.i0,
              region.i1,
              j,
              Math.min(region.j1, j + rowsPerSlice - 1),
            );
            onProgress?.(++done, total);
            await yieldSlice();
          }
        }
        normalTex.needsUpdate = true;
      }
      for (const [cx, cz] of cells) {
        if (cancelled) return;
        const cell = cz * chunksX + cx;
        if (!built.has(cell)) {
          const superCells = [
            [cx, cz],
            [cx + 1, cz],
            [cx, cz + 1],
            [cx + 1, cz + 1],
          ] as const;
          const superOk =
            cx % 2 === 0 &&
            cz % 2 === 0 &&
            cx + 1 < chunksX &&
            cz + 1 < chunksZ &&
            superCells.every(
              ([sx, sz]) =>
                cellOwnerId(sx, sz) === zone.id &&
                !built.has(sz * chunksX + sx) &&
                bandIndexAt(sx, sz) === farBand,
            );
          if (superOk) {
            for (const [sx, sz] of superCells) built.add(sz * chunksX + sx);
            const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
            const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
            if (idlePace) {
              if (!(await addChunkIdle(x0, z0, CHUNK_SIZE * 2, bands[farBand].spacing, yieldSlice)))
                return;
            } else {
              addChunk(x0, z0, CHUNK_SIZE * 2, bands[farBand].spacing);
            }
          } else {
            built.add(cell);
            const x0 = -WORLD_MAX_X + cx * CHUNK_SIZE;
            const z0 = WORLD_MIN_Z + cz * CHUNK_SIZE;
            const spacing = bands[bandIndexAt(cx, cz)].spacing;
            if (idlePace) {
              if (!(await addChunkIdle(x0, z0, CHUNK_SIZE, spacing, yieldSlice))) return;
            } else {
              addChunk(x0, z0, CHUNK_SIZE, spacing);
            }
          }
        }
        onProgress?.(++done, total);
        if (!idlePace && done % cellsPerSlice === 0) await yieldSlice();
      }
      loadedZones.add(zone.id);
      onProgress?.(total, total);
    })().finally(() => pendingZones.delete(zone.id));
    pendingZones.set(zone.id, task);
    return task;
  };
  return {
    group,
    ensureZone,
    isZoneLoaded: (zoneId: string) => loadedZones.has(zoneId),
    groundResidency: () => residency,
    cancelStreaming(): void {
      cancelled = true;
      pool?.dispose();
    },
    update(camX: number, camZ: number, fogFar: number): void {
      // fully-fogged chunks are pure overdraw; drop them before the frustum
      for (const chunk of chunks) {
        const dx = Math.max(Math.abs(camX - chunk.x) - chunk.half, 0);
        const dz = Math.max(Math.abs(camZ - chunk.z) - chunk.half, 0);
        chunk.mesh.visible = Math.hypot(dx, dz) < fogFar;
      }
    },
    rebuildRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      // No allocation beyond the replacement geometries: the chunk list is
      // scanned in place and only intersecting chunks re-mesh.
      for (const chunk of chunks) {
        if (!chunkIntersectsRegion(chunk.x0, chunk.z0, chunk.size, minX, minZ, maxX, maxZ)) {
          continue;
        }
        const geo = buildChunkGeometry(
          chunk.x0,
          chunk.z0,
          chunk.size,
          chunk.spacing,
          seed,
          !lowGfx,
          skirtSpan,
          lowShade,
        );
        chunk.mesh.geometry.dispose();
        chunk.mesh.geometry = geo; // bounding box/sphere already computed by the build
      }
    },
    rebakeNormalRegion(minX: number, minZ: number, maxX: number, maxZ: number): void {
      if (!normalTex) return; // Lambert tier: no macro normal map
      // margin 1: texels just outside the region read sculpted heights through
      // the derivative stencil, so they go stale too.
      const bounds = normalTexelBounds(
        minX,
        minZ,
        maxX,
        maxZ,
        -WORLD_MAX_X,
        WORLD_MIN_Z,
        WORLD_MAX_X * 2,
        WORLD_MAX_Z - WORLD_MIN_Z,
        NORMAL_TEX_W,
        NORMAL_TEX_H,
        1,
      );
      if (!bounds) return;
      bakeNormalRegion(
        normalTex.image.data as Uint8Array,
        seed,
        bounds.i0,
        bounds.i1,
        bounds.j0,
        bounds.j1,
      );
      normalTex.needsUpdate = true;
    },
    setBrush(x: number, z: number, radius: number, color?: THREE.ColorRepresentation): void {
      brush.uBrushCenter.value.set(x, z);
      brush.uBrushRadius.value = Math.max(0, radius);
      if (color !== undefined) brush.uBrushColor.value.set(color);
    },
    clearBrush(): void {
      brush.uBrushRadius.value = 0;
    },
  };
}
