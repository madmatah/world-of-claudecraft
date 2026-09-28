// The Realm Racers circuit, drawn. Every surface here is swept along the
// SHARED sim spline (src/sim/realm_racers_spline.ts), so the road a racer
// sees, the recovery gates the sim tests against, and the off-track bands
// that cost them time are all one piece of geometry. Placement decisions
// (which corners get kerbs, how the arch is scaled and turned, where the
// garden is sown) live in the Three-free core beside this file; this module
// only builds meshes from them.
//
// WHAT each piece is made of (which model, which colours, which ground) is the
// circuit's THEME (`realm_racers_themes.ts`), resolved once at the top of the
// build. Nothing here names an Evergarden asset: that is what makes one themed
// circuit per zone a data exercise rather than a second copy of this file.
//
// One view per authored circuit, each built once and visibility gated by which
// LANE the local player stands on: a circuit draws only on its own lanes, and
// moves to whichever copy of itself the viewer is standing on.

import * as THREE from 'three';
import {
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
} from '../sim/content/realm_racers_circuits';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  realmRacersLaneAt,
  realmRacersLaneOffset,
} from '../sim/realm_racers_layout';
import {
  type RallyPlacedProp,
  realmRacersPlacedPonds,
  realmRacersPlacedProps,
} from '../sim/realm_racers_props_resolve';
import { type RallySample, realmRacersTrack } from '../sim/realm_racers_spline';
import type { RealmRacersLaneView } from '../world_api/realm_racers';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { createStaticBladeCluster } from './blade_grass';
import { excludeFromParentCompile } from './compile_exclusion';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, surfaceMat } from './gfx';
import {
  ignivarEnvPropCastsShadow,
  ignivarEnvPropKeyOfUrl,
  whenIgnivarEnvPropsSettled,
} from './ignivar_env_props';
import {
  biomeGroundTint,
  type GroundBlend,
  type GroundLayer,
  paintInstanceGround,
} from './instance_surface';
import {
  REALM_RACERS_BARRIER_BOOT_URLS,
  realmRacersBarrierVisual,
} from './realm_racers_barrier_visuals';
import { buildRealmRacersDraftTracks } from './realm_racers_draft_track';
import {
  realmRacersDressingPart,
  realmRacersDressingRoute,
  realmRacersWorldKitPart,
} from './realm_racers_dressing_material';
import { recordRealmRacersFill } from './realm_racers_fills';
import {
  REALM_RACERS_GRASS_TILE_RADIUS,
  REALM_RACERS_GRASS_Y,
  type RealmRacersGrassTile,
  realmRacersGrassTiles,
  realmRacersGrassTint,
} from './realm_racers_grass_core';
import {
  buildRealmRacersLamps,
  type RallyLampPlacement,
  type RallyLampsView,
} from './realm_racers_lamps';
import { buildRealmRacersPickups } from './realm_racers_pickups';
import { REALM_RACERS_COMPILE_OWNER } from './realm_racers_prepare_core';
import { REALM_RACERS_PROP_VISUALS } from './realm_racers_prop_visuals';
import { buildRealmRacersSlicks } from './realm_racers_slicks';
import {
  type RallyCircuitTheme,
  type RallySkyKey,
  REALM_RACERS_THEME_BOOT_URLS,
  realmRacersTheme,
} from './realm_racers_themes';
import {
  type RallyBasinMesh,
  type RallyFlowerSpot,
  rallyBorderFlowerSpots,
  rallyFencePieces,
  rallyFlowerFieldWalk,
  rallyKerbRuns,
  rallyLawnContour,
  rallyPondMeshes,
  rallyPondReedSpots,
  rallySeaBasin,
  rallySeaMesh,
  rallyShoreSpots,
  rallyStartArchPlacement,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from './realm_racers_track_core';
import {
  createRealmRacersTrackPalette,
  type RallyStartLightMaterials,
  type RealmRacersTrackPalette,
} from './realm_racers_track_palette';
import { renderLayerDisabled } from './render_dev_flags';
import { textureRandomStream, withTextureRandomStream } from './texture_random_stream';
import { rallyKerbTexture } from './textures';
import { layLowTierWaterUv, usesShaderWater } from './water';

export interface RealmRacersTrackView {
  group: THREE.Group;
  update(px: number, pz: number, time: number, match: RealmRacersLaneView | null): void;
  /** Paint the local pilot's own oil drop immediately on the named circuit's
   *  slick layer (world coordinates in, the view resolves its own lane frame);
   *  a no-op for every other circuit. See RealmRacersSlicksView.dropProvisional. */
  dropProvisionalSlick(circuitId: string, worldX: number, worldZ: number, time: number): void;
}

/** The whole pool under one group, plus the dev arm that puts a circuit drawn
 *  in the editor into the band beside the authored ones. */
export interface RealmRacersTracksView extends RealmRacersTrackView {
  registerDraft(circuit: RealmRacersCircuit): void;
  /** One view per authored circuit, never a draft: what the race preparation
   *  compiles. */
  readonly circuits: readonly RealmRacersCircuitView[];
  /** Hold an authored circuit hidden on its own lane while `held` says so
   *  (realm_racers_prepare.ts decides: only under a cover). */
  holdReveal(held: (circuitId: string) => boolean): void;
  /** The compile gate a model fill landing on an authored circuit attaches
   *  through (hidden until linked), or undefined to add it plainly. */
  gateFills(gate: () => FillGate | undefined): void;
}

type FillGate = (target: THREE.Object3D) => Promise<unknown>;

/** An authored circuit's view, as the race preparation reads it. */
export interface RealmRacersCircuitView {
  readonly circuitId: string;
  readonly group: THREE.Group;
  /** The theme sky it flies. */
  readonly skyBiome: RallySkyKey;
  /** Resolves once the view has been drawn visible for a frame (one-shot). */
  drawnOnce(): Promise<void>;
  /** Whether the view stood on the viewer's lane at its last update. */
  onViewerLane(): boolean;
}

/** The authored view plus what the race preparation reads of it. */
type AuthoredTrackView = RealmRacersTrackView &
  Pick<RealmRacersCircuitView, 'drawnOnce' | 'onViewerLane'>;

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
const GRASS_Y = REALM_RACERS_GRASS_Y;
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

function preload(url: string): void {
  registerDeferredPreload(() =>
    loadGltf(url).then((gltf) => {
      loaded.set(url, gltf.scene);
    }),
  );
}

// What a SHIPPED circuit actually wears rides the boot lane: the start arch and
// the grid banner are structure rather than dressing, and a circuit that drew
// them a second late would be a circuit whose start line appeared after the
// lights. The authored BARRIERS are structure by the same argument, and they
// come from the records rather than from the themes
// (`REALM_RACERS_BARRIER_BOOT_URLS`), because a circuit's edge is placed by hand
// now rather than derived from a rectangle.
//
// It used to be every theme's kit, worn or not. That stopped being tenable at
// one theme per world zone: fourteen kits is about forty parsed scenes pinned
// on the never-clearing map below, for the whole session, for a player who may
// never race at all, which is the same retention the dressing catalog is kept
// out of this lane to avoid. The two BOOT lists decide the scope; a kit no
// shipped circuit wears takes `instanceModel`'s fetch-and-fill arm instead,
// which is what the dev preview and `/dev rallydraft` already rely on for every
// piece of dressing.
//
// THE DRESSING CATALOG IS DELIBERATELY NOT HERE, and that is the resident half
// of the catalog's zero-overhead promise. This map never clears, so every url
// fed to it pins a parsed scene for the whole session; the catalog is now the
// better part of two hundred models, against `props.ts`, which goes out of its
// way to release each parse once its geometry is extracted (and eagerly so on
// the iOS memory profile that has already killed a session once). Since every
// dressing url is BY CONSTRUCTION one the world already fetches, preloading it
// here bought nothing but retention. `instanceModel` fetches a dressing model
// when a circuit is actually built instead, so what stays resident is what an
// authored circuit places rather than what the catalog could offer.
const ASSET_URLS = [
  ...new Set([...REALM_RACERS_THEME_BOOT_URLS, ...REALM_RACERS_BARRIER_BOOT_URLS]),
];
for (const url of ASSET_URLS) preload(url);

/** Test-only window onto the boot-lane asset set (see
 *  tests/render_glb_replacement_assets and tests/realm_racers_props). */
export const realmRacersPreloadInternalsForTest = {
  assetUrls: ASSET_URLS,
};

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
 * The cached arm is what every theme kit takes, since those rode the boot lane.
 * The DRESSING does not (see the lane comment above), so the first circuit to
 * place a model pays for it: on a desktop client `loadGltf` usually answers off
 * its own cache, and where it does not this is one bounded fetch at circuit
 * build, for racers only, rather than a parse every player carries all session.
 *
 * A fill landing on a group a rebuild already gave back is harmless and
 * deliberately unguarded: `disposeRealmRacersTrackGroup` detaches and clears
 * the group, so the meshes added afterwards hang off an orphan nothing draws,
 * upload no GPU buffer and are collected with it.
 *
 * Every fetch is recorded on the group's fill ledger (realm_racers_fills.ts):
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
  if (realmRacersDressingRoute(url) === 'worldKit') {
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
        // Named rather than swallowed, and that changed with the boot lane's
        // scoping: this arm used to carry only optional DRESSING, where a
        // missing piece is a thinner lawn. It now also carries the perimeter
        // wall, the start arch and the grid banner of any theme no shipped
        // circuit wears, which is exactly what the editor preview and
        // `/dev rallydraft` exist to look at. Silent there means a circuit
        // drawn with no wall and no start gate and no reason given.
        // Dev-channel English, per the render i18n carve-out.
        console.warn('Realm Racers: circuit model failed to load', url, err);
      });
    recordRealmRacersFill(group, fill);
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
  piece.name = 'realm-racers-dressing-fill';
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
  if (realmRacersWorldKitPart(url)) {
    drawWorldKit(group, url, spots);
    return;
  }
  if (typeof window === 'undefined') return;
  const fill = whenIgnivarEnvPropsSettled().then(() => {
    if (realmRacersWorldKitPart(url)) landFill(group, (target) => drawWorldKit(target, url, spots));
    // Dev-channel English, per the render i18n carve-out.
    else console.warn('Realm Racers: world kit template missing', url);
  });
  recordRealmRacersFill(group, fill);
}

function drawWorldKit(group: THREE.Object3D, url: string, spots: readonly ModelSpot[]): void {
  const template = realmRacersWorldKitPart(url);
  if (!template) return;
  const mesh = new THREE.InstancedMesh(template.geometry, template.material, spots.length);
  mesh.name = `realm-racers-dressing:${url}`;
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
  mesh.userData.realmRacersDressing = true;
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
    const part = realmRacersDressingPart(url, src.geometry, src.material as THREE.Material);
    if (!part) return;
    const mesh = new THREE.InstancedMesh(part.geometry, part.material, spots.length);
    mesh.name = `realm-racers-dressing:${url}`;
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
    mesh.userData.realmRacersDressing = true;
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
  circuit: RealmRacersCircuit,
  samples: readonly RallySample[],
  from: number,
  sections: number,
  inner: (sample: RallySample) => number,
  outer: (sample: RallySample) => number,
  y: number,
  repeatPerYard = 1,
): THREE.BufferGeometry {
  const count = samples.length;
  const step = realmRacersTrack(circuit).step;
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
  return paintInstanceGround(geo, REALM_RACERS_ORIGIN, layer, tint, blend);
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
 * an eye cannot check them; `tests/realm_racers_render.test.ts` can.
 */
function buildStartArch(
  circuit: RealmRacersCircuit,
  theme: RallyCircuitTheme,
  group: THREE.Group,
): void {
  const place = rallyStartArchPlacement(circuit);
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
  circuit: RealmRacersCircuit,
  group: THREE.Group,
  palette: RealmRacersTrackPalette,
): THREE.Mesh[] {
  const fixture = new THREE.Group();
  fixture.name = 'realm-racers-start-lights';
  const housingGeo = new THREE.BoxGeometry(0.72, 0.68, 0.48);
  const lensGeo = new THREE.CircleGeometry(0.24, 16);
  const housingMat = surfaceMat({ color: 0x171816, roughness: 0.72 });
  housingMat.name = 'realmRacersTrack:startLightHousing';
  const offMat = palette.startLights().off;
  const lenses: THREE.Mesh[] = [];
  for (const [index, place] of rallyStartLightPlacements(circuit).entries()) {
    const housing = new THREE.Mesh(housingGeo, housingMat);
    housing.position.set(place.x, GRASS_Y + place.lift, place.z);
    housing.rotation.y = place.yaw;
    housing.name = `realm-racers-start-light-housing-${index + 1}`;
    fixture.add(housing);

    const lens = new THREE.Mesh(lensGeo, offMat);
    lens.position.set(
      place.x + Math.sin(place.yaw) * 0.25,
      GRASS_Y + place.lift,
      place.z + Math.cos(place.yaw) * 0.25,
    );
    lens.rotation.y = place.yaw;
    lens.name = `realm-racers-start-light-${index + 1}`;
    fixture.add(lens);
    lenses.push(lens);
  }
  group.add(fixture);
  return lenses;
}

/** The flower field's density on this tier: a cosmetic knob that only thins
 *  the same patches (`rallyFlowerSpots`). */
function rallyFlowerDensity(): number {
  return GFX.leanFoliage ? 0.45 : 1;
}

/**
 * The garden's flowers: one near-white card, coloured PER INSTANCE from the
 * patch palette, which is how the Evergarden paints its beds (a coloured
 * texture would multiply against the tint and muddy every hue). The card's
 * material is the palette's (realm_racers_track_palette.ts).
 */
function drawFlowers(
  spots: readonly RallyFlowerSpot[],
  theme: RallyCircuitTheme,
  group: THREE.Group,
  palette: RealmRacersTrackPalette,
): void {
  if (spots.length === 0) return;
  const geo = rallyFlowerCardGeo();
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
 * Every track build used to mint its own, which is invisible while circuits are
 * built once at boot and a leak the moment one is REBUILT (the editor preview
 * on every edit, a dev draft on every `/dev rallydraft`). It is also what makes
 * the group's shared-vs-owned split true: `realm_racers_track_dispose_core.ts`
 * frees a plain mesh's geometry and never an `InstancedMesh`'s, on the promise
 * that every instanced geometry is a shared one.
 */
let flowerCardGeo: THREE.BufferGeometry | null = null;

function rallyFlowerCardGeo(): THREE.BufferGeometry {
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
function basinShapes(circuit: RealmRacersCircuit): THREE.Shape[] {
  if (!circuit.basin) return [];
  const outlines = realmRacersPlacedPonds(circuit).map((pond) =>
    pond.outline.map((point) => ({
      x: point.x + REALM_RACERS_ORIGIN.x,
      z: point.z + REALM_RACERS_ORIGIN.z,
    })),
  );
  return outlines.map(
    (outline) =>
      new THREE.Shape(
        outline.map(
          (point) =>
            new THREE.Vector2(point.x - REALM_RACERS_ORIGIN.x, -(point.z - REALM_RACERS_ORIGIN.z)),
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
function waterSheet(
  mesh: RallyBasinMesh,
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
  circuit: RealmRacersCircuit,
  theme: RallyCircuitTheme,
  group: THREE.Group,
  palette: RealmRacersTrackPalette,
): void {
  const basin = circuit.basin;
  const meshes = basin ? rallyPondMeshes(circuit) : [];
  const sea = rallySeaMesh(circuit);
  if (meshes.length === 0 && !sea) return;
  // ONE material for every pond and every circuit of this theme: it is a
  // ShaderMaterial with its own uniform block, and the ponds differ by
  // geometry alone; nothing about the water's surface is per pond. The palette
  // decides the tier arm (realm_racers_track_palette.ts).
  const shader = usesShaderWater();
  const material = palette.water(theme);
  const sheet = (mesh: RallyBasinMesh, waterY: number, bankSlope: number): THREE.Mesh => {
    const water = waterSheet(mesh, waterY, bankSlope, material);
    if (!shader) layLowTierWaterUv(water.geometry, REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z);
    return water;
  };
  if (basin) {
    for (const mesh of meshes) group.add(sheet(mesh, basin.waterY, basin.bankSlope));
  }
  const seaBasin = rallySeaBasin(circuit);
  if (sea) group.add(sheet(sea, seaBasin.waterY, seaBasin.bankSlope));

  // Reeds around the rim, so the water's edge is planted rather than kerbed,
  // and the same clumps scattered along an authored shore. One instanced draw
  // for both: it is one model, and a shore and a pond rim are the same waterline
  // seen from opposite sides.
  if (!theme.reedUrl) return;
  const planted = [
    ...(basin ? rallyPondReedSpots(circuit).map((spot) => ({ ...spot, y: basin.waterY })) : []),
    ...rallyShoreSpots(circuit).map((spot) => ({ ...spot, y: seaBasin.waterY })),
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
function buildFences(circuit: RealmRacersCircuit, group: THREE.Group): void {
  const panelSpots = new Map<string, ModelSpot[]>();
  const cornerSpots = new Map<string, ModelSpot[]>();
  const push = (into: Map<string, ModelSpot[]>, url: string, spot: ModelSpot): void => {
    const held = into.get(url);
    if (held) held.push(spot);
    else into.set(url, [spot]);
  };
  for (const drawing of rallyFencePieces(circuit)) {
    const visual = realmRacersBarrierVisual(drawing.kit);
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
  lamps: RallyLampsView | null;
}

function buildDressingProps(circuit: RealmRacersCircuit, group: THREE.Group): DressingProps {
  const byAsset = new Map<string, RallyPlacedProp[]>();
  for (const prop of realmRacersPlacedProps(circuit)) {
    const list = byAsset.get(prop.asset);
    if (list) list.push(prop);
    else byAsset.set(prop.asset, [prop]);
  }
  const breathing: BreathingProp[] = [];
  // Every lamp of every style goes to ONE view: it owns a single night-light
  // owner slot for the circuit, and a slot per style would have each style's
  // re-registration wipe the last one's.
  const lampPlacements: RallyLampPlacement[] = [];
  for (const [asset, props] of byAsset) {
    const visual = REALM_RACERS_PROP_VISUALS[asset];
    if (!visual) continue;
    if (visual.kind === 'streetlamp') {
      // A fixture is authored at its own shipped height and is not a piece a
      // record may resize: `scale` is ignored here on purpose, because the sim
      // catalog's collider radius and the socket the light leaves from are both
      // measured at that one size, and a scaled lamp would light from somewhere
      // its post no longer reaches.
      for (const prop of props) {
        lampPlacements.push({
          x: prop.x + REALM_RACERS_ORIGIN.x,
          y: GRASS_Y,
          z: prop.z + REALM_RACERS_ORIGIN.z,
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
          x: prop.x + REALM_RACERS_ORIGIN.x,
          y: GRASS_Y,
          z: prop.z + REALM_RACERS_ORIGIN.z,
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
        v.set(prop.x + REALM_RACERS_ORIGIN.x, GRASS_Y, prop.z + REALM_RACERS_ORIGIN.z);
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
        prop.x + REALM_RACERS_ORIGIN.x,
        GRASS_Y,
        prop.z + REALM_RACERS_ORIGIN.z,
        prop.scale,
      );
      group.add(built);
      // Only a piece the builder actually SCALED carries its own transform; one
      // at scale 1 holds its position in its children, where touching the
      // group's scale would swing it about the world origin.
      if (prop.scale !== 1) breathing.push({ group: built, scale: prop.scale });
    }
  }
  const lamps = buildRealmRacersLamps(`realmRacersLamps:${circuit.id}`, lampPlacements);
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
function rallyGrassTilesOnTier(circuit: RealmRacersCircuit): readonly RealmRacersGrassTile[] {
  if (GFX.bladeCarpetRadius <= 0 || renderLayerDisabled('bladegrass')) return [];
  return realmRacersGrassTiles(circuit);
}

/** Blade clusters one piece of the lobby build instances. */
const RALLY_GRASS_CLUSTERS_PER_PIECE = 20_000;

/** The grass tiles cut into build pieces of about `RALLY_GRASS_CLUSTERS_PER_PIECE`
 *  clusters each, a tile never split, in tile order. */
function rallyGrassPieces(tiles: readonly RealmRacersGrassTile[]): RealmRacersGrassTile[][] {
  const pieces: RealmRacersGrassTile[][] = [];
  let piece: RealmRacersGrassTile[] = [];
  let clusters = 0;
  for (const tile of tiles) {
    piece.push(tile);
    clusters += tile.clusters.length;
    if (clusters >= RALLY_GRASS_CLUSTERS_PER_PIECE) {
      pieces.push(piece);
      piece = [];
      clusters = 0;
    }
  }
  if (piece.length > 0) pieces.push(piece);
  return pieces;
}

function drawGrassTiles(
  circuit: RealmRacersCircuit,
  tiles: readonly RealmRacersGrassTile[],
  group: THREE.Group,
): void {
  // One material per TINT, not one colour per instance. The colour is a
  // property of the circuit, so writing it into an `instanceColor` would carry
  // one repeated value in about 900 KB of per-instance buffer at the cluster
  // counts a full meadow reaches. A cached material is still shared, so the
  // dispose core's borrowing rule is untouched.
  const { geometry, material } = rallyGrassCluster(realmRacersGrassTint(circuit));
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
      v.set(cluster.x + REALM_RACERS_ORIGIN.x, GRASS_Y, cluster.z + REALM_RACERS_ORIGIN.z);
      sc.setScalar(cluster.scale);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    // The tile's own centre and reach, rather than `computeBoundingSphere`
    // walking a thousand instance matrices per tile: the core already knows
    // where the tile is, and the sphere is what the frustum culls against.
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(tile.x + REALM_RACERS_ORIGIN.x, GRASS_Y, tile.z + REALM_RACERS_ORIGIN.z),
      REALM_RACERS_GRASS_TILE_RADIUS,
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

function rallyGrassCluster(tint: number): {
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
  built.material.name = 'realmRacersTrack:grass';
  grassMaterials.set(tint, built.material);
  return { geometry: grassGeometry, material: built.material };
}

/**
 * One circuit's build, run a piece at a time (the race lobby, through the race
 * preparation: realm_racers_circuit_prepare.ts) or all at once
 * (`buildRealmRacersTrack`). The pieces add to `group` in the order a one-shot
 * build always has, so the two come out identical; a piece that plans a loop
 * (the flower field, the grass) adds its bands right after itself. Every piece
 * paints from the circuit's own random stream (textures.ts), so when and in
 * which order circuits are built never shifts a texture painted after them.
 */
/** What a build piece does, for its queue label and its build-ledger kind: the
 *  budget prices a 67 ms memo and a 10 ms band apart. */
export type RallyBuildPieceKind =
  | 'spline'
  | 'ground'
  | 'placements'
  | 'surfaces'
  | 'basin'
  | 'fixtures'
  | 'flowers'
  | 'grass'
  | 'props'
  | 'finish';

interface RallyBuildPiece {
  kind: RallyBuildPieceKind;
  run: () => void;
}

export interface RealmRacersTrackBuild {
  readonly group: THREE.Group;
  /** The kind of the piece `step` runs next, null once finished. */
  readonly nextKind: RallyBuildPieceKind | null;
  /** Pieces run so far. */
  readonly done: number;
  /** Pieces known so far, run or planned. */
  readonly total: number;
  readonly finished: boolean;
  /** Run the next piece; a no-op once finished. */
  step(): void;
  /** Run every piece left and return the view. */
  finish(): AuthoredTrackView;
}

export function realmRacersTrackBuild(
  circuit: RealmRacersCircuit,
  reveal: RevealHold = NEVER_HELD,
  palette: RealmRacersTrackPalette = createRealmRacersTrackPalette(),
  group: THREE.Group = new THREE.Group(),
): RealmRacersTrackBuild {
  group.name = 'realm-racers-track';
  group.visible = false;
  const stream = textureRandomStream(`realm-racers:circuit:${circuit.id}`);
  // Everything below that is a colour, a model or a size comes from the THEME.
  // The geometry is the same on every circuit in every zone; the skin is not.
  const theme = realmRacersTheme(circuit);
  const tint = biomeGroundTint(theme.ground);
  // What the pieces hand each other, each set by the piece that computes it.
  let samples: readonly RallySample[] = [];
  let count = 0;
  let ground: THREE.Material | null = null;
  let startLightLenses: THREE.Mesh[] = [];
  let dressing: DressingProps = { breathing: [], lamps: null };
  let view: AuthoredTrackView | null = null;

  const pieces: RallyBuildPiece[] = [];
  let next = 0;
  const piece = (kind: RallyBuildPieceKind, run: () => void): RallyBuildPiece => ({ kind, run });
  /** Queue pieces to run right after the one running now. */
  const plan = (more: RallyBuildPiece[]): void => {
    pieces.splice(next, 0, ...more);
  };

  pieces.push(
    piece('spline', () => {
      samples = realmRacersTrack(circuit).samples;
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
      realmRacersPlacedProps(circuit);
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
        rallyLawnContour(circuit).map((point) => new THREE.Vector2(point.x, point.y)),
      );
      for (const hole of basinShapes(circuit)) lawnShape.holes.push(hole);
      const lawnGeo = new THREE.ShapeGeometry(lawnShape)
        .rotateX(-Math.PI / 2)
        .translate(REALM_RACERS_ORIGIN.x, GRASS_Y, REALM_RACERS_ORIGIN.z);
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
                (s) => side * (s.halfWidth + REALM_RACERS_RUNOFF_WIDTH),
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

      const kerbMat = surfaceMat({ map: rallyKerbTexture(theme.kerb), roughness: 0.7 });
      kerbMat.name = 'realmRacersTrack:kerb';
      for (const run of rallyKerbRuns(circuit)) {
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
    piece('fixtures', () => {
      buildStartArch(circuit, theme, group);
      startLightLenses = buildStartLights(circuit, group, palette);
    }),
    piece('flowers', () => {
      // The border, then the field walked in bands of rows (the largest term
      // of a build: a spline projection per candidate), then one draw.
      const border = rallyBorderFlowerSpots(circuit);
      const field = rallyFlowerFieldWalk(circuit, rallyFlowerDensity());
      const bands: RallyBuildPiece[] = [];
      for (let row = 0; row < field.rows; row += field.rowsPerPiece) {
        bands.push(piece('flowers', () => field.walkRows(field.rowsPerPiece)));
      }
      bands.push(
        piece('flowers', () => drawFlowers(border.concat(field.spots), theme, group, palette)),
      );
      plan(bands);
    }),
    piece('grass', () => {
      const tiles = rallyGrassTilesOnTier(circuit);
      plan(
        rallyGrassPieces(tiles).map((band) =>
          piece('grass', () => drawGrassTiles(circuit, band, group)),
        ),
      );
    }),
    piece('props', () => {
      // --- the AUTHORED dressing: every piece a designer placed by hand, plus
      // the seeded fills, from the one resolver the collision set reads too ---
      dressing = buildDressingProps(circuit, group);
    }),
    piece('finish', () => {
      // --- the pickup boxes, under THIS circuit's group so they inherit the
      // lane transform and the "not my lane" hide the view already resolves ---
      const pickups = buildRealmRacersPickups(circuit);
      group.add(pickups.group);

      // --- and the oil a drawn pickup leaves behind, on the same group for the
      // same reasons. It takes no circuit: where the patches are is a live fact
      // of the race, not of the geometry ---
      const slicks = buildRealmRacersSlicks();
      group.add(slicks.group);

      // --- the AUTHORED barriers: what a circuit's visible edge is made of ---
      //
      // The perimeter box used to be drawn here, from four derived corners
      // wearing one kit from the theme. It was the last derived thing standing
      // on a circuit and it is why every one of them read as a rectangle; it
      // survives as collision (`realm_racers_colliders.ts`) and draws nothing.
      // What stands at a circuit's edge is placed by hand now, from the same
      // resolver the collision set reads, so a hedge is where a machine hits one.
      buildFences(circuit, group);

      view = authoredTrackView(circuit, group, reveal, {
        startLightLenses,
        startLights: palette.startLights(),
        breathingProps: dressing.breathing,
        lamps: dressing.lamps,
        pickups,
        slicks,
      });
    }),
  );

  const groundOf = (): THREE.Material => ground ?? palette.ground();

  const job: RealmRacersTrackBuild = {
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
    step() {
      if (next >= pieces.length) return;
      withTextureRandomStream(stream, pieces[next++].run);
    },
    finish() {
      while (next < pieces.length) job.step();
      if (!view) throw new Error(`Realm Racers: circuit build ${circuit.id} ended without a view`);
      return view;
    },
  };
  return job;
}

export function buildRealmRacersTrack(
  circuit: RealmRacersCircuit,
  reveal: RevealHold = NEVER_HELD,
  palette: RealmRacersTrackPalette = createRealmRacersTrackPalette(),
): AuthoredTrackView {
  return realmRacersTrackBuild(circuit, reveal, palette).finish();
}

/** What the live view of a built circuit drives each frame. */
interface AuthoredTrackParts {
  startLightLenses: THREE.Mesh[];
  startLights: RallyStartLightMaterials;
  breathingProps: BreathingProp[];
  lamps: RallyLampsView | null;
  pickups: ReturnType<typeof buildRealmRacersPickups>;
  slicks: ReturnType<typeof buildRealmRacersSlicks>;
}

function authoredTrackView(
  circuit: RealmRacersCircuit,
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
  return {
    group,
    drawnOnce: () => drawn,
    onViewerLane: () => onLane,
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      if (circuitId !== circuit.id) return;
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
      const lane = realmRacersLaneAt(px, pz);
      const mine = lane?.circuit.id === circuit.id;
      onLane = mine;
      // Visible at the last update means drawn by the frame between the two.
      if (markDrawn && shownLastUpdate) {
        markDrawn();
        markDrawn = null;
      }
      group.visible = mine && !reveal.held(circuit.id);
      shownLastUpdate = group.visible;
      if (!lane || !mine) {
        // The lights are WORLD positions, so a copy that is not being drawn has
        // to give its slots back: left registered, this circuit's lamps would go
        // on lighting the ground of whichever lane it was last moved onto.
        lamps?.clearLights();
        return;
      }
      const offset = realmRacersLaneOffset(lane.index);
      if (group.position.x !== offset.x || group.position.z !== offset.z)
        group.position.set(offset.x, 0, offset.z);
      // ...and the lamps follow the same rigid translation, which is the one
      // thing the field cannot infer from the scene graph.
      lamps?.setLaneOffset(offset.x, offset.z);
      // Same gate as the boxes and the oil below: a match on another circuit is
      // another lane's, and its countdown must not run this lane's lamps.
      const laneMatch = match?.circuitId === circuit.id ? match : null;
      const signal = realmRacersStartLightSignal(
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
      pickups.update(time, match?.circuitId === circuit.id ? match : null);
      // Same gate for the oil: a race on another circuit is another lane's, and
      // its hazards are not standing on this road.
      slicks.update(time, match?.circuitId === circuit.id ? match : null);
    },
  };
}

/**
 * Every authored circuit, drawn: one view per circuit under one parent group,
 * each hiding itself unless the viewer stands on a lane of its own circuit.
 *
 * Built EAGERLY, all of them, which is what the single-circuit band did before
 * lanes existed. The lazy build plus LRU eviction the multi-circuit plan
 * reserved for the second circuit was MEASURED here rather than assumed, and
 * eager still wins on the pool as it stands. Per circuit, three builds each, in
 * Node with the procedural textures stubbed (so the numbers are the CPU cost of
 * generating and packing geometry, not of uploading it), re-measured when the
 * third circuit landed (the first build of each also pays the spline memo),
 * and again with the fourth and the fifth, on another host:
 *
 *   evergarden_practice        20 to 49 ms    (18 to 41 at four, 16 to 41 at five)
 *   evergarden_express_tour   163 to 179 ms   (144 to 152, 145 to 188)
 *   nightbloom_moonwell_run   195 to 304 ms   (158 to 263, 161 to 303)
 *   drakelands_rampart_run                   (158 to 192, 159 to 213)
 *   palmreach_lagoon_run                                 (163 to 206)
 *
 * So the whole pool is over half a second (480 to 650 ms at four, 640 to 950
 * at five), paid once during world build, behind the loading screen, for every
 * player whether or not they ever race. The fourth and fifth circuits were
 * added without revisiting the eager decision. Three things decided eager when
 * the pool was two, and two of them still hold:
 *
 *  - Lazy moves the LARGEST of those onto the frame a viewer arrives at a
 *    circuit, and that frame is the countdown. A fifth of a second of hitch as
 *    the lights come on is the one place this cost must not land.
 *  - Eviction has little to evict. The policy worth having is "keep at most
 *    two", and a pool of three keeps one out; that mechanism is still not
 *    worth its reachable-path count at three.
 *  - A few megabytes of resident attribute data is not a budget anyone is
 *    fighting over out here.
 *
 * Where the time goes, so the next circuit can be judged before it is drawn:
 * the road ribbons are cheap and the cost tracks TWO fills, both priced by the
 * spline projection they pay per candidate point. The border flowers follow
 * the area inside the perimeter rather than the lap: `rallyFlowerSpots` is
 * 113 ms for 10 424 tufts on the Express Tour and 138 ms for 7 475 on the
 * Moonwell Run. The authored SCATTERS (`RallyScatter`, resolved sim-side in
 * `realm_racers_props_resolve.ts`) walk a grid of the perimeter box at their
 * own spacing and project every cell, whether or not a piece lands: the
 * Moonwell Run's six scatters are about 6 700 projections for 1 599 pieces,
 * 86 ms, and the Evergarden circuits author none. The water surfaces are
 * about 15 ms a pool; everything else together is under 10 ms.
 *
 * The GRASS is in the Moonwell Run's number and not in the Evergarden's: the
 * garden is mown lawn (`GRASS_BIOME_DENSITY.garden` is 0) while the Nightbloom
 * grows blades. The Moonwell Run resolves about 131 000 clusters over 128
 * tiles (`realmRacersGrassTiles`), 1.8x the 74 000 the two-circuit probe of
 * this zone was priced at (about 25 ms then: 4 ms to bake the mask, 11 ms to
 * place the clusters, the rest in the instancing), and at 64 bytes of instance
 * matrix a cluster it is also the largest RESIDENT term on the circuit, about
 * 8 MB on the tiers that draw it. The mask is a grid stamped off the
 * centerline rather than a projection per candidate, which is why the placing
 * half is cheap.
 *
 * The build is superlinear in circuit size, so the half-second line the
 * two-circuit revision set for revisiting this decision is now ONE more
 * circuit of the Moonwell Run's size away. The next circuit of that size
 * should either bring the lazy build with it or shrink its fills. The cheapest
 * levers, in order: the record's own scatter `spacing` (each scatter costs its
 * grid, not its pieces; a span-limited scatter still projects the whole box,
 * so it should be sparse), `REALM_RACERS_GRASS_YARDS_PER_CLUSTER` for a grassy
 * zone, then the flower patch pitch. `tests/realm_racers_circuits.test.ts`
 * pins the Moonwell Run's scatter count as a ceiling for the same reason.
 */
export function buildRealmRacersTracks(): RealmRacersTracksView {
  const group = new THREE.Group();
  // Every circuit sits hidden under this group from boot, and three's compile
  // walks hidden children: a whole-scene compile (the blocking arrival's zone
  // prewarm) would link every circuit's programs for a player who never races.
  // The race preparation seam (realm_racers_prepare.ts) is their owner; only a
  // blocking arrival that lands in the band lifts this (`rallyArrivalLifts`).
  excludeFromParentCompile(group, REALM_RACERS_COMPILE_OWNER);
  const reveal: RevealHold = { held: NEVER_HELD.held };
  let fillGate: () => FillGate | undefined = () => undefined;
  const palette = createRealmRacersTrackPalette();
  const views = REALM_RACERS_CIRCUIT_LIST.map((circuit) =>
    buildRealmRacersTrack(circuit, reveal, palette),
  );
  const circuits = REALM_RACERS_CIRCUIT_LIST.map(
    (circuit, i): RealmRacersCircuitView => ({
      circuitId: circuit.id,
      group: views[i].group,
      skyBiome: realmRacersTheme(circuit).sky.biome,
      drawnOnce: views[i].drawnOnce,
      onViewerLane: views[i].onViewerLane,
    }),
  );
  for (const view of views) fillGates.set(view.group, () => fillGate());
  for (const view of views) group.add(view.group);
  // Dev drafts get their own lifecycle beside the authored ones (built on
  // registration, replaced on re-registration); the map stays empty in every
  // session where no dev command filled it.
  const drafts = buildRealmRacersDraftTracks(group, (circuit) =>
    buildRealmRacersTrack(circuit, NEVER_HELD, palette),
  );
  return {
    group,
    circuits,
    holdReveal(held) {
      reveal.held = held;
    },
    gateFills(gate) {
      fillGate = gate;
    },
    registerDraft: (circuit) => drafts.register(circuit),
    dropProvisionalSlick(circuitId, worldX, worldZ, time) {
      for (const view of views) view.dropProvisionalSlick(circuitId, worldX, worldZ, time);
      drafts.dropProvisionalSlick(circuitId, worldX, worldZ, time);
    },
    update(px, pz, time, match) {
      for (const view of views) view.update(px, pz, time, match);
      drafts.update(px, pz, time, match);
    },
  };
}
