// The Realm Racers circuit, drawn. Every surface here is swept along the
// SHARED sim spline (src/sim/realm_racers_spline.ts), so the road a racer
// sees, the recovery gates the sim tests against, and the off-track bands
// that cost them time are all one piece of geometry. Placement decisions
// (which corners get kerbs, how the arch is scaled and turned, where the
// garden is sown) live in the Three-free core beside this file; this module
// only builds meshes from them.
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
  type RallySample,
  realmRacersTrack,
  realmRacersWaterOutlines,
} from '../sim/realm_racers_spline';
import type { RealmRacersMatchInfo } from '../world_api/realm_racers';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { buildTieredFountain, gardenStatueGeo, gardenStatueMaterial } from './garden_stonework';
import { configureMaskedDoubleSidedVegetationMaterial, GFX, surfaceMat } from './gfx';
import {
  biomeGroundTint,
  buildInstanceGroundMaterial,
  type GroundBlend,
  type GroundLayer,
  paintInstanceGround,
} from './instance_surface';
import { buildRealmRacersDraftTracks } from './realm_racers_draft_track';
import {
  RALLY_FLOWER_COLOURS,
  rallyBasinMeshes,
  rallyBorderFlowerSpots,
  rallyDressingSpots,
  rallyFlowerSpots,
  rallyFountainSpot,
  rallyKerbRuns,
  rallyPerimeterPieces,
  rallyReedSpots,
  rallyStartArchPlacement,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from './realm_racers_track_core';
import {
  type FlowerKind,
  flowerTuftTexture,
  rallyKerbTexture,
  rallyStartGridTexture,
} from './textures';
import { buildWaterSurfaceMaterial, zeroWaveUniforms } from './water_surface_material';

export interface RealmRacersTrackView {
  group: THREE.Group;
  update(px: number, pz: number, time: number, match: RealmRacersMatchInfo | null): void;
}

/** The whole pool under one group, plus the dev arm that puts a circuit drawn
 *  in the editor into the band beside the authored ones. */
export interface RealmRacersTracksView extends RealmRacersTrackView {
  registerDraft(circuit: RealmRacersCircuit): void;
}

// Surface heights, all relative to the instance band's flat floor (y = 0, the
// height groundHeight returns inside the region), stacked so nothing z-fights.
const GRASS_Y = -0.12;
const RUNOFF_Y = -0.03;
const ROAD_Y = 0;
const KERB_Y = 0.03;
const START_LINE_Y = 0.02;

const KERB_WIDTH = 1.1;
/** Yards of road covered by the chequered start/finish band. */
const START_LINE_LENGTH = 3;
/** Panel run of the wrought-iron perimeter set at scale 1. */
const IRON_PANEL = 3.5;
/** How far the lawn runs past the region envelope, yards. */
const LAWN_OVERSHOOT = 160;
/** A flower card's size at scale 1, yards. */
const FLOWER_WIDTH = 0.95;
const FLOWER_HEIGHT = 0.7;
/** The Evergarden's own flower card: near-white petals, butter centre. */
const RALLY_FLOWER_CARD: FlowerKind[] = [{ p: [244, 242, 240], c: [252, 226, 140] }];

// The bed, tree, reed and ironwork models are already shipped and manifested
// (props.ts and garden_features.ts place the same files elsewhere); loadGltf
// caches per URL, so registering them here costs one extra promise, not one
// extra parse.
const TREE_URL = '/models/foliage/twisted_1.glb';
// The game's own race arch: props.ts already places this exact model as the
// Highwatch show-jumping start gate, so the rally's start line inherits a
// fixture the world has established rather than inventing one.
const ARCH_URL = '/models/props/course_arch.glb';
const BANNER_URL = '/models/dungeon/banner_patterna_white.glb';
const BED_URLS: Record<string, string> = {
  bedRound: '/models/props/flower_bed_round.glb',
  bedSquareA: '/models/props/flower_bed_square_a.glb',
  bedSquareB: '/models/props/flower_bed_square_b.glb',
};
const IRON_FENCE_URL = '/models/props/garden_iron_fence.glb';
const IRON_PILLAR_URL = '/models/props/garden_iron_pillar.glb';
const REED_URL = '/models/props/reeds.glb';
/** Authored half-extent of the flower-bed models (see EVERGARDEN_PROPS scales). */
const BED_SOURCE_RADIUS = 0.47;
/** The specimen elders use the Evergarden's own radius-to-scale ratio. */
const TREE_SCALE_PER_RADIUS = 2.6;

const loaded = new Map<string, THREE.Group>();

function preload(url: string): void {
  registerDeferredPreload(() =>
    loadGltf(url).then((gltf) => {
      loaded.set(url, gltf.scene);
    }),
  );
}

const ASSET_URLS = [
  TREE_URL,
  ARCH_URL,
  BANNER_URL,
  IRON_FENCE_URL,
  IRON_PILLAR_URL,
  REED_URL,
  ...Object.values(BED_URLS),
];
for (const url of ASSET_URLS) preload(url);

/** Test-only window onto the asset set (see tests/render_glb_replacement_assets). */
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

/** One InstancedMesh per source mesh of a loaded model. A missing model (a
 *  headless host that never awaited the preload) simply draws nothing. */
function instanceModel(group: THREE.Group, url: string, spots: readonly ModelSpot[]): void {
  const scene = loaded.get(url);
  if (!scene || spots.length === 0) return;
  scene.updateMatrixWorld(true);
  scene.traverse((obj) => {
    const src = obj as THREE.Mesh;
    if (!src.isMesh) return;
    const mesh = new THREE.InstancedMesh(src.geometry, src.material, spots.length);
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
function buildStartArch(circuit: RealmRacersCircuit, group: THREE.Group): void {
  const place = rallyStartArchPlacement(circuit);
  instanceModel(group, ARCH_URL, [
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
    BANNER_URL,
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

function buildStartLights(circuit: RealmRacersCircuit, group: THREE.Group): THREE.Mesh[] {
  const fixture = new THREE.Group();
  fixture.name = 'realm-racers-start-lights';
  const housingGeo = new THREE.BoxGeometry(0.72, 0.68, 0.48);
  const lensGeo = new THREE.CircleGeometry(0.24, 16);
  const housingMat = surfaceMat({ color: 0x171816, roughness: 0.72 });
  const offMat = new THREE.MeshBasicMaterial({ color: 0x241c12 });
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

/**
 * The garden's flowers: one near-white card, coloured PER INSTANCE from the
 * patch palette, which is how the Evergarden paints its beds (a coloured
 * texture would multiply against the tint and muddy every hue).
 *
 * MeshStandardMaterial where the tier has it, for the same reason the world's
 * own meadow uses it: a vertical card lit only by a zenith sun through Lambert
 * comes out nearly black, which is exactly how these first shipped.
 */
function buildFlowers(circuit: RealmRacersCircuit, group: THREE.Group): void {
  const spots = [
    ...rallyBorderFlowerSpots(circuit),
    ...rallyFlowerSpots(circuit, GFX.leanFoliage ? 0.45 : 1),
  ];
  if (spots.length === 0) return;
  const geo = rallyFlowerCardGeo();
  const map = flowerTuftTexture(RALLY_FLOWER_CARD);
  const mat = configureMaskedDoubleSidedVegetationMaterial(
    GFX.standardMaterials
      ? new THREE.MeshStandardMaterial({ map, alphaTest: 0.3, roughness: 0.85 })
      : new THREE.MeshLambertMaterial({ map, alphaTest: 0.35 }),
  );
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
    mesh.setColorAt(i, tint.setHex(RALLY_FLOWER_COLOURS[spot.colour]));
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
 * The water outlines as flat shapes, region-local, one per shore span. A
 * ShapeGeometry rotated -PI/2 about X maps the shape's y to world -z, so the
 * points go in with z negated; the lawn is cut with the SAME shapes as holes,
 * which is what makes the water read as a sunken basin rather than a puddle on
 * the grass. A circuit with no shore span punches no hole at all, and its whole
 * infield is lawn.
 */
function basinShapes(circuit: RealmRacersCircuit): THREE.Shape[] {
  return realmRacersWaterOutlines(circuit).map(
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
 * The infield basin: the world's OWN water shader, not a flat translucent
 * plane. It carries the same scrolling ripple normals, fresnel sky tint, sun
 * glints and shoreline foam as the Evergarden's ponds, because it is the same
 * material (`water_surface_material.ts`).
 *
 * The wave field is left off: `water_simulation.ts` anchors ONE camera-local
 * window in the world, and the band is nowhere near it. The shader's
 * `uWaveEnabled` branch costs a comparison and the broad swell still moves the
 * surface.
 */
function buildBasin(circuit: RealmRacersCircuit, group: THREE.Group): void {
  const basin = circuit.basin;
  if (!basin) return;
  const meshes = rallyBasinMeshes(circuit);
  if (meshes.length === 0) return;
  // ONE material for every lobe of this build. It is a ShaderMaterial with its
  // own uniform block and its own compiled program, and the two callers that
  // rebuild a circuit over and over (the editor preview per edit, a dev draft
  // per re-registration) are exactly the ones a per-lobe material multiplies
  // against. The lobes differ by geometry alone; nothing about the water's
  // surface is per lobe.
  const material = buildWaterSurfaceMaterial({
    wave: zeroWaveUniforms(),
    surfaceOrigin: REALM_RACERS_ORIGIN,
  });
  for (const mesh of meshes) {
    const count = mesh.depths.length;
    const positions = new Float32Array(count * 3);
    const shoreDepth = new Float32Array(count);
    const shoreSlope = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = mesh.positions[i * 2];
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = mesh.positions[i * 2 + 1];
      shoreDepth[i] = mesh.depths[i];
      // Foam is depth over slope, i.e. distance to the waterline. The basin's
      // bank has ONE authored slope, so hand the shader that rather than a
      // finite difference of a profile we already know in closed form.
      shoreSlope[i] = basin.bankSlope;
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
    water.position.y = basin.waterY;
    group.add(water);
  }

  // Reeds around the shore, so the water's edge is planted rather than kerbed.
  instanceModel(
    group,
    REED_URL,
    rallyReedSpots(circuit).map((spot) => ({
      x: spot.x,
      y: basin.waterY,
      z: spot.z,
      yaw: spot.rot,
      sx: spot.scale,
      sy: spot.scale,
      sz: spot.scale,
    })),
  );
}

export function buildRealmRacersTrack(circuit: RealmRacersCircuit): RealmRacersTrackView {
  const group = new THREE.Group();
  group.name = 'realm-racers-track';
  const track = realmRacersTrack(circuit);
  const samples = track.samples;
  const count = samples.length;

  // --- the lawn the whole circuit sits on. It runs well past the region so the
  // horizon beyond the perimeter fence stays lawn instead of the empty instance
  // band's void; nothing else is drawn out there, so there is nothing to fight.
  const lawnX = (circuit.regionHalfX + LAWN_OVERSHOOT) * 2;
  const lawnZ = (circuit.regionHalfZ + LAWN_OVERSHOOT) * 2;
  // The world's OWN ground material, not a lookalike: six-layer PBR splat,
  // detail normals, macro breakup, the lot. One material serves every ground
  // surface here, because which layer a surface is made of is a per-vertex
  // weight, not a material (see instance_surface.ts).
  const ground = buildInstanceGroundMaterial(REALM_RACERS_ORIGIN);
  const tint = biomeGroundTint('garden');
  // The lawn is a rectangle with the basin punched out of it, so the water sits
  // in a hole in the ground instead of floating over it. Rotated and placed at
  // BUILD time: the ground material reads object space as world space, so a
  // surface rotated at draw time would hand it a sideways normal.
  const lawnShape = new THREE.Shape([
    new THREE.Vector2(-lawnX / 2, -lawnZ / 2),
    new THREE.Vector2(lawnX / 2, -lawnZ / 2),
    new THREE.Vector2(lawnX / 2, lawnZ / 2),
    new THREE.Vector2(-lawnX / 2, lawnZ / 2),
  ]);
  for (const hole of basinShapes(circuit)) lawnShape.holes.push(hole);
  const lawnGeo = new THREE.ShapeGeometry(lawnShape)
    .rotateX(-Math.PI / 2)
    .translate(REALM_RACERS_ORIGIN.x, GRASS_Y, REALM_RACERS_ORIGIN.z);
  group.add(surface(paintGround(lawnGeo, 'grass', tint.grass), ground));

  // --- runoff, road, kerbs: one continuous swept surface each, so corners have
  // no seams and nothing crosses the racing line ---
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
        ground,
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
      ground,
    ),
  );

  const kerbMat = surfaceMat({ map: rallyKerbTexture(), roughness: 0.7 });
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
  const gridTexture = rallyStartGridTexture();
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
      new THREE.MeshBasicMaterial({ map: gridTexture }),
    ),
  );

  buildBasin(circuit, group);
  buildStartArch(circuit, group);
  const startLightLenses = buildStartLights(circuit, group);
  const startLightOff = startLightLenses[0]?.material as THREE.Material;
  const startLightRed = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
  const startLightGreen = new THREE.MeshBasicMaterial({ color: 0x45e06f });
  let lastStartLightSignal = '';
  buildFlowers(circuit, group);

  // --- the infield landmark, on its island out in the water, where the circuit
  // authored one. A circuit with no room for it simply has none.
  const fountainSpot = rallyFountainSpot(circuit);
  const fountainScale = fountainSpot?.scale ?? 1;
  const fountain = fountainSpot
    ? buildTieredFountain(fountainSpot.x, fountainSpot.z, GRASS_Y, fountainScale)
    : null;
  if (fountain) group.add(fountain);

  // --- the dressing ring, every piece outside the perimeter by construction ---
  const dressing = rallyDressingSpots(circuit);
  for (const [kind, url] of Object.entries(BED_URLS)) {
    instanceModel(
      group,
      url,
      dressing
        .filter((spot) => spot.kind === kind)
        .map((spot) => {
          const scale = spot.radius / BED_SOURCE_RADIUS;
          return {
            x: spot.x,
            y: GRASS_Y,
            z: spot.z,
            yaw: spot.rot,
            sx: scale,
            sy: scale,
            sz: scale,
          };
        }),
    );
  }
  instanceModel(
    group,
    TREE_URL,
    dressing
      .filter((spot) => spot.kind === 'tree')
      .map((spot) => {
        const scale = spot.radius * TREE_SCALE_PER_RADIUS;
        return {
          x: spot.x,
          y: GRASS_Y,
          z: spot.z,
          yaw: spot.rot,
          sx: scale,
          sy: scale,
          sz: scale,
        };
      }),
  );
  const gardenStatues = dressing.filter((spot) => spot.kind === 'statue');
  if (gardenStatues.length > 0) {
    const mesh = new THREE.InstancedMesh(
      gardenStatueGeo(),
      gardenStatueMaterial(),
      gardenStatues.length,
    );
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3(1, 1, 1);
    gardenStatues.forEach((spot, i) => {
      q.setFromAxisAngle(up, spot.rot);
      v.set(spot.x, GRASS_Y, spot.z);
      mesh.setMatrixAt(i, m.compose(v, q, sc));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // --- the wrought-iron perimeter, so the circuit sits in a walled garden ---
  const perimeter = rallyPerimeterPieces(circuit, IRON_PANEL);
  const ironSpot = (piece: (typeof perimeter)[number]): ModelSpot => ({
    x: piece.x,
    y: GRASS_Y,
    z: piece.z,
    yaw: piece.yaw,
    sx: 1,
    sy: 1,
    sz: 1,
  });
  instanceModel(group, IRON_FENCE_URL, perimeter.filter((p) => !p.pillar).map(ironSpot));
  instanceModel(group, IRON_PILLAR_URL, perimeter.filter((p) => p.pillar).map(ironSpot));

  group.visible = false;

  return {
    group,
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
      group.visible = mine;
      if (!lane || !mine) return;
      const offset = realmRacersLaneOffset(lane.index);
      if (group.position.z !== offset.z) group.position.set(offset.x, 0, offset.z);
      const signal = realmRacersStartLightSignal(
        match?.phase ?? null,
        match?.countdownTicks ?? 0,
        match?.elapsed ?? 0,
      );
      const signalKey = `${signal.colour}:${signal.litCount}`;
      if (signalKey !== lastStartLightSignal) {
        lastStartLightSignal = signalKey;
        const on = signal.colour === 'green' ? startLightGreen : startLightRed;
        for (let i = 0; i < startLightLenses.length; i++)
          startLightLenses[i].material = i < signal.litCount ? on : startLightOff;
      }
      // The fountain's tiny breath is cosmetic and frame-time based.
      fountain?.scale.setScalar(fountainScale + Math.sin(time * 1.7) * 0.006);
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
 * eager wins on the pool as it stands. Per circuit, three builds each, in Node
 * with the procedural textures stubbed (so the numbers are the CPU cost of
 * generating and packing geometry, not of uploading it):
 *
 *   evergarden_practice      29 to 47 ms    28 geometries    6 166 vertices    369 KiB
 *   evergarden_express_tour  109 to 110 ms  27 geometries   10 421 vertices    642 KiB
 *
 * So the whole pool is about 140 ms and 1.0 MiB of attribute data, paid once
 * during world build, behind the loading screen. Three things decided it:
 *
 *  - Lazy moves the LARGER of those two (110 ms) onto the frame a viewer
 *    arrives at a circuit, and that frame is the countdown. A tenth of a second
 *    of hitch as the lights come on is the one place this cost must not land.
 *  - Eviction has nothing to evict. The policy worth having is "keep at most
 *    two", and the pool IS two, so the whole mechanism would be inert code with
 *    no reachable path, which is exactly what 13a-1 declined to write blind.
 *  - 1.0 MiB resident is not a budget anyone is fighting over out here.
 *
 * Where the time goes, so the next circuit can be judged before it is drawn:
 * the road ribbons are cheap and the cost tracks the SCATTER, which follows the
 * area inside the perimeter rather than the lap. On the Express Tour,
 * `rallyFlowerSpots` is 72 ms for 4 984 tufts and `rallyBasinMeshes` 29 ms for
 * its two water lobes; everything else together is under 4 ms. That is
 * superlinear in circuit size (1.8x the lap, 3.7x the build), so revisit this
 * decision when the pool reaches roughly four circuits of this size, where the
 * eager cost approaches half a second and lazy starts paying for itself.
 */
export function buildRealmRacersTracks(): RealmRacersTracksView {
  const group = new THREE.Group();
  const views = REALM_RACERS_CIRCUIT_LIST.map((circuit) => buildRealmRacersTrack(circuit));
  for (const view of views) group.add(view.group);
  // Dev drafts get their own lifecycle beside the authored ones (built on
  // registration, replaced on re-registration); the map stays empty in every
  // session where no dev command filled it.
  const drafts = buildRealmRacersDraftTracks(group, buildRealmRacersTrack);
  return {
    group,
    registerDraft: (circuit) => drafts.register(circuit),
    update(px, pz, time, match) {
      for (const view of views) view.update(px, pz, time, match);
      drafts.update(px, pz, time, match);
    },
  };
}
