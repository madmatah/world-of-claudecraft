// The Mortar Overdrive circuit, drawn. Every surface here is swept along the
// SHARED sim spline (src/sim/mortar_overdrive/spline.ts), so the road a racer
// sees, the recovery gates the sim tests against, and the off-track bands
// that cost them time are all one piece of geometry. Placement decisions
// (which corners get kerbs, how the arch is scaled and turned, where the
// garden is sown) live in the Three-free core beside this file; this module
// only builds meshes from them.
//
// WHAT each piece is made of (which model, which colours, which ground) is the
// circuit's THEME (`mortar_overdrive/themes.ts`), resolved once at the top of the
// build. Nothing here names an Evergarden asset: that is what makes one themed
// circuit per zone a data exercise rather than a second copy of this file.
//
// One view per authored circuit, each built once and visibility gated by which
// LANE the local player stands on: a circuit draws only on its own lanes, and
// moves to whichever copy of itself the viewer is standing on.

import * as THREE from 'three';
import {
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  type MortarOverdriveCircuit,
} from '../../sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_ORIGIN,
  MORTAR_OVERDRIVE_RUNOFF_WIDTH,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOffset,
} from '../../sim/mortar_overdrive/layout';
import {
  type MortarOverdrivePlacedProp,
  mortarOverdrivePlacedPonds,
  mortarOverdrivePlacedProps,
} from '../../sim/mortar_overdrive/props_resolve';
import {
  type MortarOverdriveSample,
  mortarOverdriveTrack,
} from '../../sim/mortar_overdrive/spline';
import type { MortarOverdriveLaneView } from '../../world_api/mortar_overdrive';
import { loadGltf } from '../assets/loader';
import { createStaticBladeCluster } from '../blade_grass';
import { excludeFromParentCompile } from '../compile_exclusion';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import {
  ignivarEnvPropCastsShadow,
  ignivarEnvPropKeyOfUrl,
  whenIgnivarEnvPropsSettled,
} from '../ignivar_env_props';
import {
  biomeGroundTint,
  type GroundBlend,
  type GroundLayer,
  paintInstanceGround,
} from '../instance_surface';
import { renderLayerDisabled } from '../render_dev_flags';
import { textureRandomStream, withTextureRandomStream } from '../texture_random_stream';
import { layLowTierWaterUv, usesShaderWater } from '../water';
import { mortarOverdriveBarrierKitUrls, mortarOverdriveBarrierVisual } from './barrier_visuals';
import { buildMortarOverdriveDraftTracks } from './draft_track';
import {
  mortarOverdriveDressingPart,
  mortarOverdriveDressingRoute,
  mortarOverdriveWorldKitPart,
} from './dressing_material';
import { recordMortarOverdriveFill } from './fills';
import {
  MORTAR_OVERDRIVE_GRASS_TILE_RADIUS,
  MORTAR_OVERDRIVE_GRASS_Y,
  type MortarOverdriveGrassTile,
  mortarOverdriveGrassPieces,
  mortarOverdriveGrassTiles,
  mortarOverdriveGrassTint,
} from './grass_core';
import {
  buildMortarOverdriveLamps,
  type MortarOverdriveLampPlacement,
  type MortarOverdriveLampsView,
} from './lamps';
import { buildMortarOverdrivePickups } from './pickups';
import { MORTAR_OVERDRIVE_COMPILE_OWNER } from './prepare_core';
import { MORTAR_OVERDRIVE_PROP_VISUALS } from './prop_visuals';
import { buildMortarOverdriveSlicks } from './slicks';
import {
  type MortarOverdriveCircuitTheme,
  type MortarOverdriveSkyKey,
  mortarOverdriveTheme,
  mortarOverdriveThemeKitUrls,
} from './themes';
import {
  type MortarOverdriveBasinMesh,
  type MortarOverdriveFlowerSpot,
  mortarOverdriveBorderFlowerSpots,
  mortarOverdriveFencePieces,
  mortarOverdriveFlowerFieldWalk,
  mortarOverdriveKerbRuns,
  mortarOverdriveLawnContour,
  mortarOverdrivePondMeshes,
  mortarOverdrivePondReedSpots,
  mortarOverdriveSeaBasin,
  mortarOverdriveSeaMesh,
  mortarOverdriveShoreSpots,
  mortarOverdriveStartArchPlacement,
  mortarOverdriveStartLightPlacements,
  mortarOverdriveStartLightSignal,
} from './track_core';
import { disposeMortarOverdriveTrackGroup } from './track_dispose_core';
import {
  createMortarOverdriveTrackPalette,
  type MortarOverdriveStartLightMaterials,
  type MortarOverdriveTrackPalette,
} from './track_palette';
import {
  prepareUploadFrame,
  restoreAfterUploadFrame,
  type UploadFrameNode,
} from './upload_frame_core';

export interface MortarOverdriveTrackView {
  group: THREE.Group;
  update(px: number, pz: number, time: number, match: MortarOverdriveLaneView | null): void;
  /** Paint the local pilot's own oil drop immediately on the named circuit's
   *  slick layer (world coordinates in, the view resolves its own lane frame);
   *  a no-op for every other circuit. See MortarOverdriveSlicksView.dropProvisional. */
  dropProvisionalSlick(circuitId: string, worldX: number, worldZ: number, time: number): void;
}

/** The whole pool under one group, plus the dev arm that puts a circuit drawn
 *  in the editor into the band beside the authored ones. */
export interface MortarOverdriveTracksView extends MortarOverdriveTrackView {
  registerDraft(circuit: MortarOverdriveCircuit): void;
  /** One LAZY view per authored circuit, never a draft: built only when the
   *  race preparation asks it (mortar_overdrive/circuit_prepare.ts). */
  readonly circuits: readonly MortarOverdriveLazyCircuitView[];
  /** The materials every circuit of this pool shares, and the race
   *  preparation's representatives link (mortar_overdrive/common_pieces.ts). */
  readonly palette: MortarOverdriveTrackPalette;
  /** Hold an authored circuit hidden on its own lane while `held` says so
   *  (mortar_overdrive/prepare.ts decides: only under a cover). */
  holdReveal(held: (circuitId: string) => boolean): void;
  /** The compile gate a model fill landing on an authored circuit attaches
   *  through (hidden until linked), or undefined to add it plainly. */
  gateFills(gate: () => FillGate | undefined): void;
  /** Give back every built circuit's owned geometry and the palette's
   *  materials, and stop any build still in flight. Idempotent. */
  dispose(): void;
}

type FillGate = (target: THREE.Object3D) => Promise<unknown>;

/** An authored circuit's view, as the race preparation reads it. */
export interface MortarOverdriveCircuitView {
  readonly circuitId: string;
  readonly group: THREE.Group;
  /** The theme sky it flies. */
  readonly skyBiome: MortarOverdriveSkyKey;
  /** Resolves once the view has been drawn visible for a frame (one-shot). */
  drawnOnce(): Promise<void>;
  /** Whether the view stood on the viewer's lane at its last update. */
  onViewerLane(): boolean;
}

/** The pool's view of an authored circuit: nothing built until asked. */
export interface MortarOverdriveLazyCircuitView extends MortarOverdriveCircuitView {
  /** Empty and hidden until the circuit is built; the build fills it. */
  readonly group: THREE.Group;
  /** Whether its build has run to the end. */
  readonly built: boolean;
  /** Its build: one per circuit per pool, minted on the first ask. */
  build(): MortarOverdriveTrackBuild;
  /**
   * Resolves after the first frame that DRAWS the built view on the viewer's
   * lane since the first call (a render, not an update: a frame loop may skip
   * the present): that frame draws every mesh unculled and casting no shadow,
   * so every vertex and instance buffer a visible mesh holds uploads there,
   * then each mesh's own flags come back (mortar_overdrive/upload_frame_core.ts).
   */
  uploadFrame(): Promise<void>;
  /** Withdraw the upload frame (its cover ended first): any node it holds gets
   *  its own flags back now, and no later frame is drawn unculled. */
  cancelUploadFrame(): void;
}

/** The authored view plus what the race preparation reads of it. */
type AuthoredTrackView = MortarOverdriveTrackView &
  Pick<MortarOverdriveCircuitView, 'drawnOnce' | 'onViewerLane'> &
  Pick<MortarOverdriveLazyCircuitView, 'uploadFrame' | 'cancelUploadFrame'>;

/** The reveal hold a view consults when it is on the viewer's lane. */
interface RevealHold {
  held(circuitId: string): boolean;
}

const NEVER_HELD: RevealHold = { held: () => false };

// Surface heights, all relative to the instance band's flat floor (y = 0, the
// height groundHeight returns inside the region), stacked so nothing z-fights.
// The lawn's own height, out of the core the grass mask reads it from: two
// copies of one ground height is how a meadow ends up floating over the grass
// it is supposed to grow out of.
const GRASS_Y = MORTAR_OVERDRIVE_GRASS_Y;
const RUNOFF_Y = -0.03;
const ROAD_Y = 0;
const KERB_Y = 0.03;
const START_LINE_Y = 0.02;

const KERB_WIDTH = 1.1;
/** Yards of road covered by the chequered start/finish band. */
const START_LINE_LENGTH = 3;
/** A flower card's size at scale 1, yards. */
const FLOWER_WIDTH = 0.95;
const FLOWER_HEIGHT = 0.7;

const loaded = new Map<string, THREE.Group>();

/** The gate source of each authored circuit's group, read when a fill lands. */
const fillGates = new WeakMap<THREE.Object3D, () => FillGate | undefined>();

/**
 * What one circuit WEARS: its theme's start arch, grid banner and shore reed,
 * and the barrier kits its record authors. Structure rather than dressing, so a
 * circuit that drew them a second late would be a circuit whose start line or
 * wall appeared after the lights.
 */
export function mortarOverdriveCircuitKitUrls(circuit: MortarOverdriveCircuit): readonly string[] {
  return [
    ...new Set([
      ...mortarOverdriveThemeKitUrls(circuit),
      ...mortarOverdriveBarrierKitUrls([circuit]),
    ]),
  ];
}

// The kit is fetched when the circuit's build STARTS, which is the race
// preparation's commitment to that circuit (its loading lobby, a practice
// seat, a login or a step onto its lane), never at boot: a boot preload of
// every worn kit pinned parsed scenes on the never-clearing map above, for the
// whole session, for a player who may never race. The fetch starts here rather
// than when a piece places the model, so the build's pieces usually find it
// landed; a piece that gets there first takes `instanceModel`'s fetch-and-fill
// arm on the same in-flight load, which records it on the circuit's fill
// ledger, and the circuit's preparation waits for that ledger under the lobby
// or arrival cover (mortar_overdrive/circuit_prepare.ts). A circuit drawn in the
// open (a walker on a lane, no cover) shows the kit when it lands, through the
// same gated fill.
//
// THE DRESSING CATALOG IS DELIBERATELY NOT HERE, and that is the resident half
// of the catalog's zero-overhead promise. This map never clears, so every url
// fed to it pins a parsed scene for the whole session; the catalog is now the
// better part of two hundred models, against `props.ts`, which goes out of its
// way to release each parse once its geometry is extracted (and eagerly so on
// the iOS memory profile that has already killed a session once). Since every
// dressing url is BY CONSTRUCTION one the world already fetches, fetching it
// ahead bought nothing but retention. `instanceModel` fetches a dressing model
// when a circuit's piece places it instead, so what stays resident is what an
// authored circuit places rather than what the catalog could offer.
function fetchCircuitKit(circuit: MortarOverdriveCircuit): void {
  if (typeof window === 'undefined') return;
  for (const url of mortarOverdriveCircuitKitUrls(circuit)) {
    if (loaded.has(url) || mortarOverdriveDressingRoute(url) === 'worldKit') continue;
    loadGltf(url).then(
      (gltf) => {
        loaded.set(url, gltf.scene);
      },
      // The piece that places it fetches through the same load and names the
      // failure (`instanceModel`).
      () => undefined,
    );
  }
}

interface ModelSpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

/**
 * Draw a model at every spot, or fetch it and draw when it lands.
 *
 * The cached arm is what a theme or barrier kit usually takes, since its fetch
 * started with the build (`fetchCircuitKit`). The DRESSING is not fetched ahead
 * (see the comment above it), so the first circuit to place a model pays for
 * it: on a desktop client `loadGltf` usually answers off its own cache, and
 * where it does not this is one bounded fetch at circuit build, for racers
 * only, rather than a parse every player carries all session.
 *
 * A fill landing on a group a rebuild already gave back is harmless and
 * deliberately unguarded: `disposeMortarOverdriveTrackGroup` detaches and clears
 * the group, so the meshes added afterwards hang off an orphan nothing draws,
 * upload no GPU buffer and are collected with it.
 *
 * Every fetch is recorded on the group's fill ledger (mortar_overdrive/fills.ts):
 * the race preparation gates the group only once its fills have landed, since
 * a gate covers only what exists when it runs. Once the race preparation has
 * started, a fill landing on an authored circuit attaches through the world
 * gate (hidden until linked) whenever it lands, even after the reveal.
 *
 * A headless host (a Vitest importing the render stack) never fetches: the
 * dressing simply draws nothing, exactly as it did when the lane was empty.
 */
function instanceModel(group: THREE.Group, url: string, spots: readonly ModelSpot[]): void {
  if (spots.length === 0) return;
  if (mortarOverdriveDressingRoute(url) === 'worldKit') {
    instanceWorldKit(group, url, spots);
    return;
  }
  const scene = loaded.get(url);
  if (!scene) {
    if (typeof window === 'undefined') return;
    const fill = loadGltf(url)
      .then((gltf) => {
        loaded.set(url, gltf.scene);
        landFill(group, (target) => drawInstances(target, url, gltf.scene, spots));
      })
      .catch((err) => {
        // Named rather than swallowed: this arm carries the walls, the start
        // arch and the grid banner as well as optional DRESSING, and a circuit
        // drawn with no wall and no start gate needs a reason given.
        // Dev-channel English, per the render i18n carve-out.
        console.warn('Mortar Overdrive: circuit model failed to load', url, err);
      });
    recordMortarOverdriveFill(group, fill);
    return;
  }
  drawInstances(group, url, scene, spots);
}

/** Draw a fill that has just landed: straight onto the group, or through the
 *  world gate (hidden until linked) once the race preparation has started. */
function landFill(group: THREE.Group, draw: (target: THREE.Object3D) => void): void {
  const gate = fillGates.get(group)?.();
  if (!gate) {
    draw(group);
    return;
  }
  const piece = new THREE.Group();
  piece.name = 'mortar-overdrive-dressing-fill';
  draw(piece);
  void attachSceneGroupGated(group, piece, gate);
}

/**
 * A model the world draws from one of its env-prop templates (the fortress and
 * the Drakelands rebuild kits): the circuit instances the template itself, so
 * it wears exactly the material the world's own instances link, and adds no
 * fetch or parse of its own. The templates load in the deferred lane at world
 * entry, so the wait arm below is for a host that has not opened it yet, and
 * it never starts a second load once one has settled; it rides the fill ledger
 * like a fetch, so the race preparation gates only once it has landed. Shadow
 * casting follows the world's own instances of the key.
 */
function instanceWorldKit(group: THREE.Group, url: string, spots: readonly ModelSpot[]): void {
  if (mortarOverdriveWorldKitPart(url)) {
    drawWorldKit(group, url, spots);
    return;
  }
  if (typeof window === 'undefined') return;
  const fill = whenIgnivarEnvPropsSettled().then(() => {
    if (mortarOverdriveWorldKitPart(url))
      landFill(group, (target) => drawWorldKit(target, url, spots));
    // Dev-channel English, per the render i18n carve-out.
    else console.warn('Mortar Overdrive: world kit template missing', url);
  });
  recordMortarOverdriveFill(group, fill);
}

function drawWorldKit(group: THREE.Object3D, url: string, spots: readonly ModelSpot[]): void {
  const template = mortarOverdriveWorldKitPart(url);
  if (!template) return;
  const mesh = new THREE.InstancedMesh(template.geometry, template.material, spots.length);
  mesh.name = `mortar-overdrive-dressing:${url}`;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  spots.forEach((spot, i) => {
    q.setFromAxisAngle(up, spot.yaw);
    v.set(spot.x, spot.y, spot.z);
    sc.set(spot.sx, spot.sy, spot.sz);
    mesh.setMatrixAt(i, m.compose(v, q, sc));
  });
  mesh.instanceMatrix.needsUpdate = true;
  const key = ignivarEnvPropKeyOfUrl(url);
  mesh.castShadow = key !== undefined && ignivarEnvPropCastsShadow(key);
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  mesh.userData.mortarOverdriveDressing = true;
  group.add(mesh);
}

function drawInstances(
  group: THREE.Object3D,
  url: string,
  scene: THREE.Group,
  spots: readonly ModelSpot[],
): void {
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const src = obj as THREE.Mesh;
    if (!src.isMesh) return;
    const part = mortarOverdriveDressingPart(url, src.geometry, src.material as THREE.Material);
    if (!part) return;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
    mesh.name = `mortar-overdrive-dressing:${url}`;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    spots.forEach((spot, i) => {
      q.setFromAxisAngle(up, spot.yaw);
      v.set(spot.x, spot.y, spot.z);
      sc.set(spot.sx, spot.sy, spot.sz);
      mesh.setMatrixAt(i, m.compose(v, q, sc).multiply(src.matrixWorld));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    mesh.userData.mortarOverdriveDressing = true;
    group.add(mesh);
  });
}

/**
 * A surface swept along the centerline between two lateral offsets, in WORLD
 * coordinates. `u` runs along the lap's arc length and `v` across the surface at
 * the same yards-per-repeat, so a texture keeps its scale however the road
 * widens or narrows. A ribbon that goes on to be a GROUND surface has its uv
 * replaced by `paintGround`, which lays a strip-planar one instead, so those
 * callers leave `repeatPerYard` alone.
 */
function ribbon(
  circuit: MortarOverdriveCircuit,
  samples: readonly MortarOverdriveSample[],
  from: number,
  sections: number,
  inner: (sample: MortarOverdriveSample) => number,
  outer: (sample: MortarOverdriveSample) => number,
  y: number,
  repeatPerYard = 1,
): THREE.BufferGeometry {
  const count = samples.length;
  const step = mortarOverdriveTrack(circuit).step;
  const positions = new Float32Array((sections + 1) * 2 * 3);
  const uvs = new Float32Array((sections + 1) * 2 * 2);
  const index: number[] = [];
  // A ribbon whose `outer` offset sits on the NEGATIVE normal side is mirrored,
  // which reverses its triangle winding: the surface then faces DOWN and
  // FrontSide culling drops it entirely. That is how the right-hand runoff
  // strip and every kerb on that side of the road came to be built and never
  // drawn (they hid behind the lawn, which is the same grass).
  const first = samples[from % count];
  const mirrored = outer(first) < inner(first);
  for (let i = 0; i <= sections; i++) {
    const sample = samples[(from + i) % count];
    const nx = -sample.tz;
    const nz = sample.tx;
    const a = inner(sample);
    const b = outer(sample);
    const u = i * step * repeatPerYard;
    const vi = i * 2;
    positions.set([sample.x + nx * a, y, sample.z + nz * a], vi * 3);
    positions.set([sample.x + nx * b, y, sample.z + nz * b], (vi + 1) * 3);
    uvs.set([u, 0], vi * 2);
    uvs.set([u, Math.abs(b - a) * repeatPerYard], (vi + 1) * 2);
    if (i > 0) {
      if (mirrored) index.push(vi - 1, vi - 2, vi, vi + 1, vi - 1, vi);
      else index.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

function surface(geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/** Dresses a world-space XZ surface for the shared ground material. */
function paintGround(
  geo: THREE.BufferGeometry,
  layer: GroundLayer,
  tint: number,
  blend?: GroundBlend,
): THREE.BufferGeometry {
  return paintInstanceGround(geo, MORTAR_OVERDRIVE_ORIGIN, layer, tint, blend);
}

/**
 * The grass share the ROAD itself keeps, matching the world's road core
 * (terrain_chunk_build.ts lays 0.85 dirt over the biome grass, never 1.0).
 * Nothing on the circuit is ever a pure layer, so no surface can read as a
 * decal laid on another.
 */
const ROAD_GRASS_MIX = 0.15;

/**
 * The runoff's grass share per vertex. A `ribbon` row is exactly two vertices,
 * inner then outer (see `ribbon`), so an even index is the road edge and an
 * odd one the lawn edge: the strip carries the road's own mix where it meets
 * the road and full grass where it meets the lawn, and the rasterizer ramps
 * between them across the 3.5 yard width. Both seams therefore match on both
 * sides, which is the whole point: a hard edge is a mismatch, not a width.
 */
function runoffGrassWeight(vertexIndex: number): number {
  return vertexIndex % 2 === 0 ? ROAD_GRASS_MIX : 1;
}

/**
 * The start/finish arch, the circuit's one visible fixture. Every other
 * recovery gate stays invisible: it is a reset anchor, not race progress:
 * the shipped version built a 31-yard gantry over all eight, which read as
 * scaffolding rather than a garden.
 *
 * Every number here (both yaws, both scales, where each banner hangs) comes
 * from the core, because each one of them has shipped wrong at least once and
 * an eye cannot check them; `tests/mortar_overdrive_render.test.ts` can.
 */
function buildStartArch(
  circuit: MortarOverdriveCircuit,
  theme: MortarOverdriveCircuitTheme,
  group: THREE.Group,
): void {
  const place = mortarOverdriveStartArchPlacement(circuit);
  instanceModel(group, theme.startFixture.archUrl, [
    {
      x: place.x,
      y: GRASS_Y,
      z: place.z,
      yaw: place.yaw,
      sx: place.uprightScale,
      sy: place.uprightScale,
      sz: place.spanScale,
    },
  ]);
  instanceModel(
    group,
    theme.startFixture.bannerUrl,
    place.banners.map((banner) => ({
      x: banner.x,
      y: GRASS_Y + banner.lift,
      z: banner.z,
      yaw: banner.yaw,
      sx: banner.scale,
      sy: banner.scale,
      sz: banner.scale,
    })),
  );
}

function buildStartLights(
  circuit: MortarOverdriveCircuit,
  group: THREE.Group,
  palette: MortarOverdriveTrackPalette,
): THREE.Mesh[] {
  const fixture = new THREE.Group();
  fixture.name = 'mortar-overdrive-start-lights';
  const housingGeo = new THREE.BoxGeometry(0.72, 0.68, 0.48);
  const lensGeo = new THREE.CircleGeometry(0.24, 16);
  const { housing: housingMat, off: offMat } = palette.startLights();
  const lenses: THREE.Mesh[] = [];
  for (const [index, place] of mortarOverdriveStartLightPlacements(circuit).entries()) {
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(place.x, GRASS_Y + place.lift, place.z);
    housing.rotation.y = place.yaw;
    housing.name = `mortar-overdrive-start-light-housing-${index + 1}`;
    fixture.add(housing);

    const lens = new THREE.Mesh(lensGeo, offMat);
    lens.position.set(
      place.x + Math.sin(place.yaw) * 0.25,
      GRASS_Y + place.lift,
      place.z + Math.cos(place.yaw) * 0.25,
    );
    lens.rotation.y = place.yaw;
    lens.name = `mortar-overdrive-start-light-${index + 1}`;
    fixture.add(lens);
    lenses.push(lens);
  }
  group.add(fixture);
  return lenses;
}

/** The flower field's density on this tier: a cosmetic knob that only thins
 *  the same patches (`mortarOverdriveFlowerSpots`). */
function mortarOverdriveFlowerDensity(): number {
  return GFX.leanFoliage ? 0.45 : 1;
}

/**
 * The garden's flowers: one near-white card, coloured PER INSTANCE from the
 * patch palette, which is how the Evergarden paints its beds (a coloured
 * texture would multiply against the tint and muddy every hue). The card's
 * material is the palette's (mortar_overdrive/track_palette.ts).
 */
function drawFlowers(
  spots: readonly MortarOverdriveFlowerSpot[],
  theme: MortarOverdriveCircuitTheme,
  group: THREE.Group,
  palette: MortarOverdriveTrackPalette,
): void {
  if (spots.length === 0) return;
  const geo = mortarOverdriveFlowerCardGeo();
  const mat = palette.flower(theme.flowers.card);
  const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const tint = new THREE.Color();
  spots.forEach((spot, i) => {
    q.setFromAxisAngle(up, spot.rot);
    v.set(spot.x, GRASS_Y, spot.z);
    sc.setScalar(spot.scale);
    mesh.setMatrixAt(i, m.compose(v, q, sc));
    mesh.setColorAt(i, tint.setHex(theme.flowers.colours[spot.colour]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.computeBoundingSphere();
  group.add(mesh);
}

/**
 * The border flower's crossed card, built once.
 *
 * Every track build used to mint its own, which is invisible while a circuit is
 * built once and a leak the moment one is REBUILT (the editor preview
 * on every edit, a dev draft on every `/dev overdrivedraft`). It is also what makes
 * the group's shared-vs-owned split true: `mortar_overdrive/track_dispose_core.ts`
 * frees a plain mesh's geometry and never an `InstancedMesh`'s, on the promise
 * that every instanced geometry is a shared one.
 */
let flowerCardGeo: THREE.BufferGeometry | null = null;

export function mortarOverdriveFlowerCardGeo(): THREE.BufferGeometry {
  if (flowerCardGeo) return flowerCardGeo;
  const card = new THREE.PlaneGeometry(FLOWER_WIDTH, FLOWER_HEIGHT);
  card.translate(0, FLOWER_HEIGHT / 2, 0);
  flowerCardGeo = mergeCrossedCards(card);
  return flowerCardGeo;
}

/** Two copies of a card at right angles, so a tuft reads from any heading. */
function mergeCrossedCards(card: THREE.BufferGeometry): THREE.BufferGeometry {
  const crossed = card.clone().rotateY(Math.PI / 2);
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = card.getAttribute(name);
    const b = crossed.getAttribute(name);
    const merged = new Float32Array(a.array.length + b.array.length);
    merged.set(a.array as Float32Array, 0);
    merged.set(b.array as Float32Array, a.array.length);
    out.setAttribute(name, new THREE.BufferAttribute(merged, a.itemSize));
  }
  const index = card.getIndex();
  if (index) {
    const offset = card.getAttribute('position').count;
    const merged: number[] = [];
    for (const i of index.array) merged.push(i);
    for (const i of index.array) merged.push(i + offset);
    out.setIndex(merged);
  }
  return out;
}

/**
 * The pond outlines as flat shapes, region-local, one per pond. A ShapeGeometry
 * rotated -PI/2 about X maps the shape's y to world -z, so the points go in
 * with z negated; the lawn is cut with the SAME shapes as holes, which is what
 * makes the water read as a sunken basin rather than a puddle on the grass. A
 * circuit that places no pond punches no hole at all, and its whole infield is
 * lawn.
 */
function basinShapes(circuit: MortarOverdriveCircuit): THREE.Shape[] {
  if (!circuit.basin) return [];
  const outlines = mortarOverdrivePlacedPonds(circuit).map((pond) =>
    pond.outline.map((point) => ({
      x: point.x + MORTAR_OVERDRIVE_ORIGIN.x,
      z: point.z + MORTAR_OVERDRIVE_ORIGIN.z,
    })),
  );
  return outlines.map(
    (outline) =>
      new THREE.Shape(
        outline.map(
          (point) =>
            new THREE.Vector2(
              point.x - MORTAR_OVERDRIVE_ORIGIN.x,
              -(point.z - MORTAR_OVERDRIVE_ORIGIN.z),
            ),
        ),
      ),
  );
}

/**
 * One water surface: a triangulated ring mesh, its per-vertex shore depth, and
 * the height it sits at.
 *
 * Shared by the ponds and the sea because they are the same water: a shore is a
 * shore whether the land is inside it or outside it, and two builders would be
 * two answers to how deep the water is a yard off the bank.
 */
export function waterSheet(
  mesh: MortarOverdriveBasinMesh,
  waterY: number,
  bankSlope: number,
  material: THREE.Material,
): THREE.Mesh {
  const count = mesh.depths.length;
  const positions = new Float32Array(count * 3);
  const shoreDepth = new Float32Array(count);
  const shoreSlope = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = mesh.positions[i * 2];
    positions[i * 3 + 1] = 0;
    positions[i * 3 + 2] = mesh.positions[i * 2 + 1];
    shoreDepth[i] = mesh.depths[i];
    // Foam is depth over slope, i.e. distance to the waterline. The bank has
    // ONE authored slope, so hand the shader that rather than a finite
    // difference of a profile we already know in closed form.
    shoreSlope[i] = bankSlope;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aShoreDepth', new THREE.BufferAttribute(shoreDepth, 1));
  geo.setAttribute('aShoreSlope', new THREE.BufferAttribute(shoreSlope, 1));
  geo.setIndex(mesh.index);
  // The shader derives its own normal from the ripple maps and never reads
  // this one. It is here so the surface is COVERED by the face-down guard: a
  // water sheet wound the wrong way is culled exactly as silently as a kerb.
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const water = new THREE.Mesh(geo, material);
  water.position.y = waterY;
  return water;
}

/**
 * The circuit's water: the placed ponds, and the sea around an authored island.
 *
 * The world's OWN water shader, not a flat translucent plane. It carries the
 * same scrolling ripple normals, fresnel sky tint, sun glints and shoreline foam
 * as the Evergarden's ponds, because it is the same material
 * (`water_surface_material.ts`), on the tiers where the world draws it; the
 * others wear the world's own low-tier plane material (`lowTierWaterMaterial`).
 *
 * The wave field is left off: `water_simulation.ts` anchors ONE camera-local
 * window in the world, and the band is nowhere near it. The shader's
 * `uWaveEnabled` branch costs a comparison and the broad swell still moves the
 * surface.
 */
function buildBasin(
  circuit: MortarOverdriveCircuit,
  theme: MortarOverdriveCircuitTheme,
  group: THREE.Group,
  palette: MortarOverdriveTrackPalette,
): void {
  const basin = circuit.basin;
  const meshes = basin ? mortarOverdrivePondMeshes(circuit) : [];
  const sea = mortarOverdriveSeaMesh(circuit);
  if (meshes.length === 0 && !sea) return;
  // ONE material for every pond and every circuit of this theme: it is a
  // ShaderMaterial with its own uniform block, and the ponds differ by
  // geometry alone; nothing about the water's surface is per pond. The palette
  // decides the tier arm (mortar_overdrive/track_palette.ts).
  const shader = usesShaderWater();
  const material = palette.water(theme);
  const sheet = (mesh: MortarOverdriveBasinMesh, waterY: number, bankSlope: number): THREE.Mesh => {
    const water = waterSheet(mesh, waterY, bankSlope, material);
    if (!shader)
      layLowTierWaterUv(water.geometry, MORTAR_OVERDRIVE_ORIGIN.x, MORTAR_OVERDRIVE_ORIGIN.z);
    return water;
  };
  if (basin) {
    for (const mesh of meshes) group.add(sheet(mesh, basin.waterY, basin.bankSlope));
  }
  const seaBasin = mortarOverdriveSeaBasin(circuit);
  if (sea) group.add(sheet(sea, seaBasin.waterY, seaBasin.bankSlope));

  // Reeds around the rim, so the water's edge is planted rather than kerbed,
  // and the same clumps scattered along an authored shore. One instanced draw
  // for both: it is one model, and a shore and a pond rim are the same waterline
  // seen from opposite sides.
  if (!theme.reedUrl) return;
  const planted = [
    ...(basin
      ? mortarOverdrivePondReedSpots(circuit).map((spot) => ({ ...spot, y: basin.waterY }))
      : []),
    ...mortarOverdriveShoreSpots(circuit).map((spot) => ({ ...spot, y: seaBasin.waterY })),
  ];
  instanceModel(
    group,
    theme.reedUrl,
    planted.map((spot) => ({
      x: spot.x,
      y: spot.y,
      z: spot.z,
      yaw: spot.rot,
      sx: spot.scale,
      sy: spot.scale,
      sz: spot.scale,
    })),
  );
}

/** A prop under gentle motion: the tiered fountain's breath, the one animated
 *  piece the dressing has. Held with the scale it was built at, so the sine is
 *  a wobble around a size rather than a size of its own. */
interface BreathingProp {
  group: THREE.Group;
  scale: number;
}

/**
 * The circuit's HAND-PLACED dressing, drawn from the one resolver both the
 * collision set and the readout measure. Nothing here works out a position: a
 * renderer deriving its own placement is exactly how the tiered fountain came
 * to stand in the middle of a road nothing collided with.
 *
 * Grouped by catalog key so a key with fifty pieces on it is one instanced
 * draw. A key no visual knows draws nothing at all, deliberately: the readout
 * calls it an error by name, and a missing model is not worth a crash inside a
 * world build.
 */
/**
 * The authored barriers, instanced kit by kit.
 *
 * One `instanceModel` call per (kit, piece kind), not per fence: two hedges on
 * one circuit are one draw of hedge panels. A kit whose corner takes the same
 * model as its panel still gets two calls, because the two carry different yaws
 * and merging them would mean interleaving spots by hand for one saved draw.
 */
function buildFences(circuit: MortarOverdriveCircuit, group: THREE.Group): void {
  const panelSpots = new Map<string, ModelSpot[]>();
  const cornerSpots = new Map<string, ModelSpot[]>();
  const push = (into: Map<string, ModelSpot[]>, url: string, spot: ModelSpot): void => {
    const held = into.get(url);
    if (held) held.push(spot);
    else into.set(url, [spot]);
  };
  for (const drawing of mortarOverdriveFencePieces(circuit)) {
    const visual = mortarOverdriveBarrierVisual(drawing.kit);
    if (!visual) continue;
    const spotOf = (piece: { x: number; z: number; yaw: number }): ModelSpot => ({
      x: piece.x,
      y: GRASS_Y,
      z: piece.z,
      yaw: piece.yaw,
      sx: drawing.scale,
      sy: drawing.scale,
      sz: drawing.scale,
    });
    for (const panel of drawing.panels) push(panelSpots, visual.panelUrl, spotOf(panel));
    if (visual.corner === 'none') continue;
    for (const corner of drawing.corners) push(cornerSpots, visual.corner.url, spotOf(corner));
  }
  for (const [url, spots] of panelSpots) instanceModel(group, url, spots);
  for (const [url, spots] of cornerSpots) instanceModel(group, url, spots);
}

/** What the dressing pass hands back: the pieces that breathe, and the lamps,
 *  whose lights the view has to move onto the viewer's lane. */
interface DressingProps {
  breathing: BreathingProp[];
  lamps: MortarOverdriveLampsView | null;
}

function buildDressingProps(circuit: MortarOverdriveCircuit, group: THREE.Group): DressingProps {
  const byAsset = new Map<string, MortarOverdrivePlacedProp[]>();
  for (const prop of mortarOverdrivePlacedProps(circuit)) {
    const list = byAsset.get(prop.asset);
    if (list) list.push(prop);
    else byAsset.set(prop.asset, [prop]);
  }
  const breathing: BreathingProp[] = [];
  // Every lamp of every style goes to ONE view: it owns a single night-light
  // owner slot for the circuit, and a slot per style would have each style's
  // re-registration wipe the last one's.
  const lampPlacements: MortarOverdriveLampPlacement[] = [];
  for (const [asset, props] of byAsset) {
    const visual = MORTAR_OVERDRIVE_PROP_VISUALS[asset];
    if (!visual) continue;
    if (visual.kind === 'streetlamp') {
      // A fixture is authored at its own shipped height and is not a piece a
      // record may resize: `scale` is ignored here on purpose, because the sim
      // catalog's collider radius and the socket the light leaves from are both
      // measured at that one size, and a scaled lamp would light from somewhere
      // its post no longer reaches.
      for (const prop of props) {
        lampPlacements.push({
          x: prop.x + MORTAR_OVERDRIVE_ORIGIN.x,
          y: GRASS_Y,
          z: prop.z + MORTAR_OVERDRIVE_ORIGIN.z,
          yaw: prop.yaw,
          style: visual.style,
        });
      }
      continue;
    }
    if (visual.kind === 'gltf' || visual.kind === 'worldKit') {
      instanceModel(
        group,
        visual.url,
        props.map((prop) => ({
          x: prop.x + MORTAR_OVERDRIVE_ORIGIN.x,
          y: GRASS_Y,
          z: prop.z + MORTAR_OVERDRIVE_ORIGIN.z,
          yaw: prop.yaw,
          sx: prop.scale,
          sy: prop.scale,
          sz: prop.scale,
        })),
      );
      continue;
    }
    if (visual.kind === 'instanced') {
      // A SHARED geometry, so it may only ever be drawn instanced: the dispose
      // core frees a plain mesh's geometry, and freeing this one would take
      // every other circuit's statues down with a rebuilt draft.
      const mesh = new THREE.InstancedMesh(visual.geometry(), visual.material(), props.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const v = new THREE.Vector3();
      const sc = new THREE.Vector3();
      props.forEach((prop, i) => {
        q.setFromAxisAngle(up, prop.yaw);
        v.set(prop.x + MORTAR_OVERDRIVE_ORIGIN.x, GRASS_Y, prop.z + MORTAR_OVERDRIVE_ORIGIN.z);
        sc.setScalar(prop.scale);
        mesh.setMatrixAt(i, m.compose(v, q, sc));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
      continue;
    }
    for (const prop of props) {
      // A `group` visual seats itself at the world point it is handed and mints
      // its own geometry there, so the yaw has nowhere to go: the one piece
      // built this way is radially symmetric, and a kind that is not belongs in
      // one of the two arms above.
      const built = visual.build(
        prop.x + MORTAR_OVERDRIVE_ORIGIN.x,
        GRASS_Y,
        prop.z + MORTAR_OVERDRIVE_ORIGIN.z,
        prop.scale,
      );
      group.add(built);
      // Only a piece the builder actually SCALED carries its own transform; one
      // at scale 1 holds its position in its children, where touching the
      // group's scale would swing it about the world origin.
      if (prop.scale !== 1) breathing.push({ group: built, scale: prop.scale });
    }
  }
  const lamps = buildMortarOverdriveLamps(`mortarOverdriveLamps:${circuit.id}`, lampPlacements);
  if (lamps) group.add(lamps.group);
  return { breathing, lamps };
}

/**
 * The circuit's grass: the world's OWN blade clusters, placed once over every
 * free square yard of the garden.
 *
 * Fixed rather than following the player, which is the difference from the
 * overworld's carpet and the reason this exists at all: the pool that follows a
 * player is what lets a zone be dense, and out here it read as a disc of grass
 * moving with the camera, because the band has no card-tuft layer beyond it to
 * hide the rim the way a zone does.
 *
 * One InstancedMesh per tile so the frustum can throw away what is behind the
 * camera; the cluster geometry and its material are shared across every tile
 * and every build.
 */
/**
 * The tiles of the circuit's grass on this tier: none where the tier keeps no
 * blades, which is the same gate the overworld carpet takes and for the same
 * reason: blades are a close-camera detail layer, they are the heaviest thing a
 * circuit draws (a Nightbloom Express Tour is 75 000 clusters and about 1.9 M
 * triangles resident), and tiers below high keep neither them nor the world's.
 * `?bladegrass=off` is the dev perf-attribution switch.
 */
function mortarOverdriveGrassTilesOnTier(
  circuit: MortarOverdriveCircuit,
): readonly MortarOverdriveGrassTile[] {
  if (!mortarOverdriveBladeGrassOnTier()) return [];
  return mortarOverdriveGrassTiles(circuit);
}

/** Whether this tier keeps blade grass at all (the gate above). */
export function mortarOverdriveBladeGrassOnTier(): boolean {
  return GFX.bladeCarpetRadius > 0 && !renderLayerDisabled('bladegrass');
}

function drawGrassTiles(
  circuit: MortarOverdriveCircuit,
  tiles: readonly MortarOverdriveGrassTile[],
  group: THREE.Group,
): void {
  // One material per TINT, not one colour per instance. The colour is a
  // property of the circuit, so writing it into an `instanceColor` would carry
  // one repeated value in about 900 KB of per-instance buffer at the cluster
  // counts a full meadow reaches. A cached material is still shared, so the
  // dispose core's borrowing rule is untouched.
  const { geometry, material } = mortarOverdriveGrassCluster(mortarOverdriveGrassTint(circuit));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const lean = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  for (const tile of tiles) {
    const mesh = new THREE.InstancedMesh(geometry, material, tile.clusters.length);
    mesh.userData.renderCategory = 'grass';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    tile.clusters.forEach((cluster, i) => {
      q.setFromAxisAngle(up, cluster.rot);
      axis.set(cluster.leanAxisX, 0, cluster.leanAxisZ);
      q.premultiply(lean.setFromAxisAngle(axis, cluster.lean));
      v.set(cluster.x + MORTAR_OVERDRIVE_ORIGIN.x, GRASS_Y, cluster.z + MORTAR_OVERDRIVE_ORIGIN.z);
      sc.setScalar(cluster.scale);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    // The tile's own centre and reach, rather than `computeBoundingSphere`
    // walking a thousand instance matrices per tile: the core already knows
    // where the tile is, and the sphere is what the frustum culls against.
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(
        tile.x + MORTAR_OVERDRIVE_ORIGIN.x,
        GRASS_Y,
        tile.z + MORTAR_OVERDRIVE_ORIGIN.z,
      ),
      MORTAR_OVERDRIVE_GRASS_TILE_RADIUS,
    );
    group.add(mesh);
  }
}

/**
 * The blade cluster, minted once and SHARED, for the same reason the flower
 * card is: the editor preview rebuilds a whole track on every edit, and the
 * dispose core frees only what a build MINTS.
 *
 * The geometry is one for every circuit; the material is one per TINT, since
 * the blades carry a base-to-tip vertex gradient the colour multiplies into.
 * Bounded by the theme registry, which is the only thing that names a tint.
 */
let grassGeometry: THREE.BufferGeometry | null = null;
const grassMaterials = new Map<number, THREE.Material>();

export function mortarOverdriveGrassCluster(tint: number): {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
} {
  const cached = grassMaterials.get(tint);
  if (grassGeometry && cached) return { geometry: grassGeometry, material: cached };
  // Minted only for a tint nobody has asked for yet. The factory hands back a
  // pair; the FIRST geometry it makes is the one every tile of every circuit
  // then shares, and a later tint's copy is dropped unbuilt-upon rather than
  // becoming a second geometry the dispose core would have to reason about.
  const built = createStaticBladeCluster(0x5eed);
  grassGeometry ??= built.geometry;
  // The same lift the world gives its blades over the raw ground tint: they
  // catch more sky than the soil they stand on.
  (built.material as THREE.MeshStandardMaterial).color.setHex(tint).multiplyScalar(1.18);
  built.material.name = 'mortarOverdriveTrack:grass';
  grassMaterials.set(tint, built.material);
  return { geometry: grassGeometry, material: built.material };
}

/**
 * One circuit's build, run a piece at a time (the race lobby, through the race
 * preparation: mortar_overdrive/circuit_prepare.ts) or all at once
 * (`buildMortarOverdriveTrack`). The pieces add to `group` in the order a one-shot
 * build always has, so the two come out identical; a piece that plans a loop
 * (the flower field, the grass) adds its bands right after itself. Every piece
 * paints from the circuit's own random stream (textures.ts), so when and in
 * which order circuits are built never shifts a texture painted after them.
 */
/** What a build piece does: its build-ledger kind (`zone:mortar-overdrive-<kind>`) and
 *  the tail of its queue label. A piece that throws costs its own part only
 *  (`MortarOverdriveTrackBuild.step`), so each separate thing a pilot reads (the
 *  start lights, the boxes, the oil, the walls) is a piece of its own. */
export type MortarOverdriveBuildPieceKind =
  | 'spline'
  | 'ground'
  | 'placements'
  | 'surfaces'
  | 'basin'
  | 'arch'
  | 'lights'
  | 'flowers'
  | 'grass'
  | 'props'
  | 'pickups'
  | 'slicks'
  | 'fences';

interface MortarOverdriveBuildPiece {
  kind: MortarOverdriveBuildPieceKind;
  run: () => void;
}

export interface MortarOverdriveTrackBuild {
  readonly group: THREE.Group;
  /** The kind of the piece `step` runs next, null once finished. */
  readonly nextKind: MortarOverdriveBuildPieceKind | null;
  /** Pieces run so far. */
  readonly done: number;
  /** Pieces known so far, run or planned. */
  readonly total: number;
  readonly finished: boolean;
  /** Run the next piece; a no-op once finished. */
  step(): void;
  /** Run every piece left and return the view. */
  finish(): AuthoredTrackView;
  /** Pieces that threw (each warned): the view is made of what the others built. */
  readonly failures: number;
  /** Stop: no piece runs any more (the pool was given back). */
  cancel(): void;
}

export function mortarOverdriveTrackBuild(
  circuit: MortarOverdriveCircuit,
  reveal: RevealHold = NEVER_HELD,
  palette: MortarOverdriveTrackPalette = createMortarOverdriveTrackPalette(),
  group: THREE.Group = new THREE.Group(),
): MortarOverdriveTrackBuild {
  group.name = 'mortar-overdrive-track';
  group.visible = false;
  fetchCircuitKit(circuit);
  const stream = textureRandomStream(`mortar-overdrive:circuit:${circuit.id}`);
  // Everything below that is a colour, a model or a size comes from the THEME.
  // The geometry is the same on every circuit in every zone; the skin is not.
  const theme = mortarOverdriveTheme(circuit);
  const tint = biomeGroundTint(theme.ground);
  // What the pieces hand each other, each set by the piece that computes it.
  let samples: readonly MortarOverdriveSample[] = [];
  let count = 0;
  let ground: THREE.Material | null = null;
  let startLightLenses: THREE.Mesh[] = [];
  let dressing: DressingProps = { breathing: [], lamps: null };
  let pickups: ReturnType<typeof buildMortarOverdrivePickups> | null = null;
  let slicks: ReturnType<typeof buildMortarOverdriveSlicks> | null = null;
  let view: AuthoredTrackView | null = null;
  let failures = 0;
  let cancelled = false;

  const pieces: MortarOverdriveBuildPiece[] = [];
  let next = 0;
  const piece = (
    kind: MortarOverdriveBuildPieceKind,
    run: () => void,
  ): MortarOverdriveBuildPiece => ({ kind, run });
  /** Queue pieces to run right after the one running now. */
  const plan = (more: MortarOverdriveBuildPiece[]): void => {
    pieces.splice(next, 0, ...more);
  };

  pieces.push(
    piece('spline', () => {
      samples = mortarOverdriveTrack(circuit).samples;
      count = samples.length;
    }),
    piece('ground', () => {
      // The world's OWN ground material, not a lookalike: six-layer PBR splat,
      // detail normals, macro breakup, the lot. One material serves every
      // ground surface of every circuit, because which layer a surface is made
      // of is a per-vertex weight, not a material (see instance_surface.ts).
      ground = palette.ground();
    }),
    piece('placements', () => {
      // The resolver's placements (the ponds, the props, the scatters) are a
      // sim memo, first asked here. The one piece that cannot be cut.
      mortarOverdrivePlacedProps(circuit);
    }),
    piece('surfaces', () => {
      // --- the lawn the whole circuit sits on: the SHAPE of the land, off the
      // one resolver. A circuit that authors no outline gets the rectangle it
      // has always had, running well past the region so the horizon stays lawn
      // instead of the empty instance band's void; one that authors an island
      // gets its own edge, with the theme's water outside it.
      //
      // The ponds are punched out of it as holes, so a pool sits in a hole in
      // the ground instead of floating over it: an island is the same mechanism
      // with a different outer path. Rotated and placed at BUILD time: the
      // ground material reads object space as world space, so a surface rotated
      // at draw time would hand it a sideways normal.
      //
      // The z is negated for the same reason the pond holes' is: a
      // ShapeGeometry rotated -PI/2 about X maps the shape's y to world -z.
      const lawnShape = new THREE.Shape(
        mortarOverdriveLawnContour(circuit).map((point) => new THREE.Vector2(point.x, point.y)),
      );
      for (const hole of basinShapes(circuit)) lawnShape.holes.push(hole);
      const lawnGeo = new THREE.ShapeGeometry(lawnShape)
        .rotateX(-Math.PI / 2)
        .translate(MORTAR_OVERDRIVE_ORIGIN.x, GRASS_Y, MORTAR_OVERDRIVE_ORIGIN.z);
      group.add(surface(paintGround(lawnGeo, 'grass', tint.grass), groundOf()));
    }),
    piece('surfaces', () => {
      // --- runoff, road, kerbs: one continuous swept surface each, so corners
      // have no seams and nothing crosses the racing line ---
      for (const side of [1, -1]) {
        group.add(
          surface(
            paintGround(
              ribbon(
                circuit,
                samples,
                0,
                count,
                (s) => side * s.halfWidth,
                (s) => side * (s.halfWidth + MORTAR_OVERDRIVE_RUNOFF_WIDTH),
                RUNOFF_Y,
              ),
              'dirt',
              tint.dirt,
              { layer: 'grass', tint: tint.grass, weightAt: runoffGrassWeight },
            ),
            groundOf(),
          ),
        );
      }
      group.add(
        surface(
          paintGround(
            ribbon(
              circuit,
              samples,
              0,
              count,
              (s) => -s.halfWidth,
              (s) => s.halfWidth,
              ROAD_Y,
            ),
            'dirt',
            tint.dirt,
            { layer: 'grass', tint: tint.grass, weightAt: () => ROAD_GRASS_MIX },
          ),
          groundOf(),
        ),
      );

      const kerbMat = palette.kerb(theme.kerb);
      for (const run of mortarOverdriveKerbRuns(circuit)) {
        for (const side of [1, -1]) {
          group.add(
            surface(
              ribbon(
                circuit,
                samples,
                run.from,
                run.to - run.from,
                (s) => side * s.halfWidth,
                (s) => side * (s.halfWidth + KERB_WIDTH),
                KERB_Y,
                1 / 2,
              ),
              kerbMat,
            ),
          );
        }
      }

      // --- the start/finish band, straddling s = 0 ---
      group.add(
        surface(
          ribbon(
            circuit,
            samples,
            count - Math.round(START_LINE_LENGTH / 2),
            START_LINE_LENGTH,
            (s) => -s.halfWidth,
            (s) => s.halfWidth,
            START_LINE_Y,
            1 / 6,
          ),
          palette.startGrid(theme.startGrid),
        ),
      );
    }),
    piece('basin', () => buildBasin(circuit, theme, group, palette)),
    piece('arch', () => buildStartArch(circuit, theme, group)),
    piece('lights', () => {
      startLightLenses = buildStartLights(circuit, group, palette);
    }),
    piece('flowers', () => {
      // The border, then the field walked in bands of rows (the largest term
      // of a build: a spline projection per candidate), then one draw.
      const border = mortarOverdriveBorderFlowerSpots(circuit);
      const field = mortarOverdriveFlowerFieldWalk(circuit, mortarOverdriveFlowerDensity());
      const bands: MortarOverdriveBuildPiece[] = [];
      for (let row = 0; row < field.rows; row += field.rowsPerPiece) {
        bands.push(piece('flowers', () => field.walkRows(field.rowsPerPiece)));
      }
      bands.push(
        piece('flowers', () => drawFlowers(border.concat(field.spots), theme, group, palette)),
      );
      plan(bands);
    }),
    piece('grass', () => {
      const tiles = mortarOverdriveGrassTilesOnTier(circuit);
      plan(
        mortarOverdriveGrassPieces(tiles).map((band) =>
          piece('grass', () => drawGrassTiles(circuit, band, group)),
        ),
      );
    }),
    piece('props', () => {
      // --- the AUTHORED dressing: every piece a designer placed by hand, plus
      // the seeded fills, from the one resolver the collision set reads too ---
      dressing = buildDressingProps(circuit, group);
    }),
    piece('pickups', () => {
      // --- the pickup boxes, under THIS circuit's group so they inherit the
      // lane transform and the "not my lane" hide the view already resolves ---
      pickups = buildMortarOverdrivePickups(circuit);
      group.add(pickups.group);
    }),
    piece('slicks', () => {
      // --- and the oil a drawn pickup leaves behind, on the same group for the
      // same reasons. It takes no circuit: where the patches are is a live fact
      // of the race, not of the geometry ---
      slicks = buildMortarOverdriveSlicks();
      group.add(slicks.group);
    }),
    piece('fences', () => {
      // --- the AUTHORED barriers: what a circuit's visible edge is made of ---
      //
      // The perimeter box used to be drawn here, from four derived corners
      // wearing one kit from the theme. It was the last derived thing standing
      // on a circuit and it is why every one of them read as a rectangle; it
      // survives as collision (`mortar_overdrive/colliders.ts`) and draws nothing.
      // What stands at a circuit's edge is placed by hand now, from the same
      // resolver the collision set reads, so a hedge is where a machine hits one.
      buildFences(circuit, group);
    }),
  );

  const groundOf = (): THREE.Material => ground ?? palette.ground();

  const job: MortarOverdriveTrackBuild = {
    group,
    get done() {
      return next;
    },
    get total() {
      return pieces.length;
    },
    get finished() {
      return next >= pieces.length;
    },
    get nextKind() {
      return pieces[next]?.kind ?? null;
    },
    get failures() {
      return failures;
    },
    step() {
      if (next >= pieces.length) return;
      const piece = pieces[next++];
      try {
        withTextureRandomStream(stream, piece.run);
      } catch (error) {
        // A piece that throws costs its own part of the circuit, never the
        // rest: the lane still gets its road, walls and boxes, which the sim
        // races on whether they are drawn or not. Dev-channel English.
        failures++;
        console.warn('Mortar Overdrive: circuit build piece failed', circuit.id, piece.kind, error);
      }
    },
    finish() {
      while (next < pieces.length) job.step();
      if (cancelled)
        throw new Error(`Mortar Overdrive: circuit build ${circuit.id} was given back`);
      // Made here, out of every piece, so no failed piece can leave the lane
      // without a view.
      view ??= authoredTrackView(circuit, group, reveal, {
        startLightLenses,
        startLights: palette.startLights(),
        breathingProps: dressing.breathing,
        lamps: dressing.lamps,
        pickups,
        slicks,
      });
      return view;
    },
    cancel() {
      cancelled = true;
      next = pieces.length;
    },
  };
  return job;
}

export function buildMortarOverdriveTrack(
  circuit: MortarOverdriveCircuit,
  reveal: RevealHold = NEVER_HELD,
  palette: MortarOverdriveTrackPalette = createMortarOverdriveTrackPalette(),
): AuthoredTrackView {
  return mortarOverdriveTrackBuild(circuit, reveal, palette).finish();
}

/** What the live view of a built circuit drives each frame. */
interface AuthoredTrackParts {
  startLightLenses: THREE.Mesh[];
  startLights: MortarOverdriveStartLightMaterials;
  breathingProps: BreathingProp[];
  lamps: MortarOverdriveLampsView | null;
  pickups: ReturnType<typeof buildMortarOverdrivePickups> | null;
  slicks: ReturnType<typeof buildMortarOverdriveSlicks> | null;
}

function authoredTrackView(
  circuit: MortarOverdriveCircuit,
  group: THREE.Group,
  reveal: RevealHold,
  parts: AuthoredTrackParts,
): AuthoredTrackView {
  const { startLightLenses, startLights, breathingProps, lamps, pickups, slicks } = parts;
  let lastStartLightSignal = '';
  const provisionalTmp = new THREE.Vector3();
  let onLane = false;
  let shownLastUpdate = false;
  let markDrawn: (() => void) | null = null;
  const drawn = new Promise<void>((resolve) => {
    markDrawn = resolve;
  });
  let uploadAsked: Promise<void> | null = null;
  let markUploaded: (() => void) | null = null;
  let unculled: UploadFrameNode[] | null = null;
  let uploadDrawn = false;
  const noteUploadDrawn = (): void => {
    uploadDrawn = true;
  };
  return {
    group,
    drawnOnce: () => drawn,
    uploadFrame() {
      uploadAsked ??= new Promise<void>((resolve) => {
        markUploaded = resolve;
      });
      return uploadAsked;
    },
    cancelUploadFrame() {
      // Withdrawn for good: a later ask starts a fresh upload frame rather
      // than returning the withdrawn one's promise, which would never resolve.
      markUploaded = null;
      uploadAsked = null;
      uploadDrawn = false;
      if (unculled) restoreAfterUploadFrame(unculled);
      unculled = null;
    },
    onViewerLane: () => onLane,
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      if (circuitId !== circuit.id || !slicks) return;
      // The slick layer lives in the lane frame this group was moved onto;
      // resolve the world point into it through the live transform.
      slicks.group.updateWorldMatrix(true, false);
      provisionalTmp.set(worldX, 0, worldZ);
      slicks.group.worldToLocal(provisionalTmp);
      slicks.dropProvisional(provisionalTmp.x, provisionalTmp.z, time);
    },
    update(px, pz, time, match) {
      // This circuit exists in several identical COPIES stacked along the band
      // (the public lane plus the private practice copies), and a viewer can
      // only ever be on one of them. Rather than build the same half-megabyte
      // of geometry per copy, the one group is MOVED to whichever lane the
      // viewer is standing on. A rigid translation is all it takes: the copies
      // differ by nothing else.
      //
      // A lane belonging to a DIFFERENT circuit hides this one: its own view
      // owns that lane, and the two must never be drawn on top of each other.
      // Compared by ID, never by record identity: a suite that re-imports this
      // module (the texture mocks do) gets a second copy of the circuit records,
      // and an identity test would silently hide every circuit.
      const lane = mortarOverdriveLaneAt(px, pz);
      const mine = lane?.circuit.id === circuit.id;
      onLane = mine;
      // Visible at the last update means drawn by the frame between the two.
      if (markDrawn && shownLastUpdate) {
        markDrawn();
        markDrawn = null;
      }
      // The upload frame ends on a real draw of it, whatever the updates did.
      if (unculled && uploadDrawn) {
        restoreAfterUploadFrame(unculled);
        unculled = null;
        markUploaded?.();
        markUploaded = null;
      }
      group.visible = mine && !reveal.held(circuit.id);
      shownLastUpdate = group.visible;
      if (markUploaded && !unculled && group.visible) {
        // A draw of an earlier upload frame is not this one's.
        uploadDrawn = false;
        unculled = prepareUploadFrame(group, noteUploadDrawn);
      }
      if (!lane || !mine) {
        // The lights are WORLD positions, so a copy that is not being drawn has
        // to give its slots back: left registered, this circuit's lamps would go
        // on lighting the ground of whichever lane it was last moved onto.
        lamps?.clearLights();
        return;
      }
      const offset = mortarOverdriveLaneOffset(lane.index);
      if (group.position.x !== offset.x || group.position.z !== offset.z)
        group.position.set(offset.x, 0, offset.z);
      // ...and the lamps follow the same rigid translation, which is the one
      // thing the field cannot infer from the scene graph.
      lamps?.setLaneOffset(offset.x, offset.z);
      // Same gate as the boxes and the oil below: a match on another circuit is
      // another lane's, and its countdown must not run this lane's lamps.
      const laneMatch = match?.circuitId === circuit.id ? match : null;
      const signal = mortarOverdriveStartLightSignal(
        laneMatch?.phase ?? null,
        laneMatch?.countdownTicks ?? 0,
        laneMatch?.elapsed ?? 0,
      );
      const signalKey = `${signal.colour}:${signal.litCount}`;
      if (signalKey !== lastStartLightSignal) {
        lastStartLightSignal = signalKey;
        const on = signal.colour === 'green' ? startLights.green : startLights.red;
        for (let i = 0; i < startLightLenses.length; i++)
          startLightLenses[i].material = i < signal.litCount ? on : startLights.off;
      }
      // The fountain's tiny breath is cosmetic and frame-time based.
      const breath = Math.sin(time * 1.7) * 0.006;
      for (const prop of breathingProps) prop.group.scale.setScalar(prop.scale + breath);
      // The boxes: only ever ticked on the lane the viewer is standing on, and
      // only against a race on THIS circuit. A match on another circuit is
      // another lane's, so its taken set says nothing about these boxes.
      pickups?.update(time, match?.circuitId === circuit.id ? match : null);
      // Same gate for the oil: a race on another circuit is another lane's, and
      // its hazards are not standing on this road.
      slicks?.update(time, match?.circuitId === circuit.id ? match : null);
    },
  };
}

/**
 * Every authored circuit, one LAZY view per circuit under one parent group,
 * each hiding itself unless the viewer stands on a lane of its own circuit.
 *
 * NOTHING is built here. A circuit is built only when a pilot commits to it,
 * as the first step of its race preparation (`mortarOverdriveCircuit:<id>`,
 * mortar_overdrive/circuit_prepare.ts): in the race lobby while the other pilots
 * load, on the first frame of a login or a graphics rebuild mid-race, or for a
 * walker standing on its lane. It used to be the other way round, every
 * circuit at renderer construction, which by four circuits cost 0.7 to 0.9 s
 * of main thread per boot on a fast desktop and some 40 MB for a player who
 * never races, both growing with every circuit added. A built circuit stays
 * for the life of the pool: disposing its last material would free its
 * programs, and the next race there would link them again.
 *
 * Where a build's time goes, so the next circuit can be judged before it is
 * drawn: the flower FIELD (one spline projection per candidate, about half of
 * a build, walked in bands), the resolver's placements (a sim memo, the one
 * piece that cannot be cut: about 67 ms on the Moonspring Run on a fast desktop),
 * the grass on a grassy zone (a stamped mask, then the instancing in bands),
 * the dressing. The cheapest levers are the record's scatter `spacing`,
 * `MORTAR_OVERDRIVE_GRASS_YARDS_PER_CLUSTER` and the flower patch pitch;
 * `tests/mortar_overdrive_circuits.test.ts` pins the largest circuits' scatter
 * counts as the lobby-build budget.
 */
export function buildMortarOverdriveTracks(): MortarOverdriveTracksView {
  const group = new THREE.Group();
  // The circuits sit hidden under this group once built, and three's compile
  // walks hidden children: a whole-scene compile (the blocking arrival's zone
  // prewarm) would link a built circuit's programs for a player done racing.
  // The race preparation seam (mortar_overdrive/prepare.ts) is their owner; only a
  // blocking arrival that lands in the band lifts this (`mortarOverdriveArrivalLifts`).
  excludeFromParentCompile(group, MORTAR_OVERDRIVE_COMPILE_OWNER);
  const reveal: RevealHold = { held: NEVER_HELD.held };
  let fillGate: () => FillGate | undefined = () => undefined;
  const palette = createMortarOverdriveTrackPalette();
  let disposed = false;
  const circuits = MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) =>
    lazyCircuitView(
      circuit,
      reveal,
      palette,
      () => fillGate(),
      () => disposed,
    ),
  );
  for (const view of circuits) group.add(view.group);
  // Dev drafts get their own lifecycle beside the authored ones (built on
  // registration, replaced on re-registration); the map stays empty in every
  // session where no dev command filled it.
  const drafts = buildMortarOverdriveDraftTracks(group, (circuit) =>
    buildMortarOverdriveTrack(circuit, NEVER_HELD, palette),
  );
  return {
    group,
    circuits,
    palette,
    holdReveal(held) {
      reveal.held = held;
    },
    gateFills(gate) {
      fillGate = gate;
    },
    registerDraft: (circuit) => drafts.register(circuit),
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      for (const view of circuits) view.dropProvisionalSlick(circuitId, worldX, worldZ, time);
      drafts.dropProvisionalSlick(circuitId, worldX, worldZ, time);
    },
    update(px, pz, time, match) {
      for (const view of circuits) view.update(px, pz, time, match);
      drafts.update(px, pz, time, match);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const view of circuits) view.cancel();
      disposeMortarOverdriveTrackGroup(group);
      palette.dispose();
    },
  };
}

type LazyPoolView = MortarOverdriveLazyCircuitView &
  Pick<MortarOverdriveTrackView, 'update' | 'dropProvisionalSlick'> & { cancel(): void };

/** One authored circuit in the pool: an empty hidden group until its build
 *  finishes, then the built view drives it. */
function lazyCircuitView(
  circuit: MortarOverdriveCircuit,
  reveal: RevealHold,
  palette: MortarOverdriveTrackPalette,
  fillGate: () => FillGate | undefined,
  disposed: () => boolean,
): LazyPoolView {
  const group = new THREE.Group();
  group.name = 'mortar-overdrive-track';
  group.visible = false;
  fillGates.set(group, fillGate);
  let job: MortarOverdriveTrackBuild | null = null;
  let view: AuthoredTrackView | null = null;
  let onLane = false;
  const builtView = (): AuthoredTrackView | null => {
    if (!view && job?.finished && !disposed()) view = job.finish();
    return view;
  };
  return {
    circuitId: circuit.id,
    group,
    skyBiome: mortarOverdriveTheme(circuit).sky.biome,
    get built() {
      return builtView() !== null;
    },
    build() {
      if (!job) {
        job = mortarOverdriveTrackBuild(circuit, reveal, palette, group);
        if (disposed()) job.cancel();
      }
      return job;
    },
    cancel() {
      job?.cancel();
    },
    drawnOnce() {
      return builtView()?.drawnOnce() ?? NEVER_UPLOADED;
    },
    uploadFrame() {
      return builtView()?.uploadFrame() ?? NEVER_UPLOADED;
    },
    cancelUploadFrame() {
      builtView()?.cancelUploadFrame();
    },
    onViewerLane: () => onLane,
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      builtView()?.dropProvisionalSlick(circuitId, worldX, worldZ, time);
    },
    update(px, pz, time, match) {
      // Tracked here, built or not: the race preparation reads it to decide
      // when to build, and a view built since the last frame has not been
      // updated yet.
      onLane = mortarOverdriveLaneAt(px, pz)?.circuit.id === circuit.id;
      // Unbuilt, or still building: nothing is drawn.
      builtView()?.update(px, pz, time, match);
    },
  };
}

/** What `drawnOnce` and `uploadFrame` answer for a circuit not built yet. */
const NEVER_UPLOADED: Promise<void> = new Promise<void>(() => undefined);
