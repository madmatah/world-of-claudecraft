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
import type { RealmRacersMatchInfo } from '../world_api/realm_racers';
import { loadGltf } from './assets/loader';
import { registerDeferredPreload } from './assets/preload';
import { createStaticBladeCluster } from './blade_grass';
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
  REALM_RACERS_GRASS_TILE_RADIUS,
  REALM_RACERS_GRASS_Y,
  realmRacersGrassTiles,
  realmRacersGrassTint,
} from './realm_racers_grass_core';
import { buildRealmRacersPickups } from './realm_racers_pickups';
import { REALM_RACERS_PROP_URLS, REALM_RACERS_PROP_VISUALS } from './realm_racers_prop_visuals';
import { buildRealmRacersSlicks } from './realm_racers_slicks';
import {
  type RallyCircuitTheme,
  REALM_RACERS_THEME_ASSET_URLS,
  realmRacersTheme,
} from './realm_racers_themes';
import {
  rallyBorderFlowerSpots,
  rallyFlowerSpots,
  rallyKerbRuns,
  rallyPerimeterPieces,
  rallyPondMeshes,
  rallyPondReedSpots,
  rallyStartArchPlacement,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from './realm_racers_track_core';
import { renderLayerDisabled } from './render_dev_flags';
import { flowerTuftTexture, rallyKerbTexture, rallyStartGridTexture } from './textures';
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
/** How far the lawn runs past the region envelope, yards. */
const LAWN_OVERSHOOT = 160;
/** A flower card's size at scale 1, yards. */
const FLOWER_WIDTH = 0.95;
const FLOWER_HEIGHT = 0.7;

const loaded = new Map<string, THREE.Group>();

function preload(url: string): void {
  registerDeferredPreload(() =>
    loadGltf(url).then((gltf) => {
      loaded.set(url, gltf.scene);
    }),
  );
}

// EVERY theme's kit and the authored dressing's whole catalog ride in the same
// lane, whether or not a shipped circuit uses them today. A model that is not
// preloaded draws from nothing on a cold client, which is a failure no test
// that does not check the lane can see; `tests/realm_racers_props.test.ts` and
// `tests/realm_racers_themes.test.ts` check it. The models themselves are
// already shipped and manifested (props.ts and garden_features.ts place the
// same files elsewhere) and loadGltf caches per URL, so registering them here
// costs one extra promise each, not one extra parse.
const ASSET_URLS = [...new Set([...REALM_RACERS_THEME_ASSET_URLS, ...REALM_RACERS_PROP_URLS])];
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
function buildFlowers(
  circuit: RealmRacersCircuit,
  theme: RallyCircuitTheme,
  group: THREE.Group,
): void {
  const spots = [
    ...rallyBorderFlowerSpots(circuit),
    ...rallyFlowerSpots(circuit, GFX.leanFoliage ? 0.45 : 1),
  ];
  if (spots.length === 0) return;
  const geo = rallyFlowerCardGeo();
  const map = flowerTuftTexture(theme.flowers.card);
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
function buildBasin(
  circuit: RealmRacersCircuit,
  theme: RallyCircuitTheme,
  group: THREE.Group,
): void {
  const basin = circuit.basin;
  if (!basin) return;
  const meshes = rallyPondMeshes(circuit);
  if (meshes.length === 0) return;
  // ONE material for every pond of this build. It is a ShaderMaterial with its
  // own uniform block and its own compiled program, and the two callers that
  // rebuild a circuit over and over (the editor preview per edit, a dev draft
  // per re-registration) are exactly the ones a per-pond material multiplies
  // against. The ponds differ by geometry alone; nothing about the water's
  // surface is per pond.
  // The colour ramp is the theme's, and it is the ONLY thing about the water a
  // theme moves: the ripples, the fresnel sky tint, the sun glints and the foam
  // are the world's own water everywhere, deliberately.
  const material = buildWaterSurfaceMaterial({
    wave: zeroWaveUniforms(),
    surfaceOrigin: REALM_RACERS_ORIGIN,
    ...(theme.water
      ? {
          shallow: new THREE.Color(theme.water.shallow),
          deep: new THREE.Color(theme.water.deep),
        }
      : {}),
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

  // Reeds around the rim, so the water's edge is planted rather than kerbed.
  instanceModel(
    group,
    theme.reedUrl,
    rallyPondReedSpots(circuit).map((spot) => ({
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
function buildDressingProps(circuit: RealmRacersCircuit, group: THREE.Group): BreathingProp[] {
  const byAsset = new Map<string, RallyPlacedProp[]>();
  for (const prop of realmRacersPlacedProps(circuit)) {
    const list = byAsset.get(prop.asset);
    if (list) list.push(prop);
    else byAsset.set(prop.asset, [prop]);
  }
  const breathing: BreathingProp[] = [];
  for (const [asset, props] of byAsset) {
    const visual = REALM_RACERS_PROP_VISUALS[asset];
    if (!visual) continue;
    if (visual.kind === 'gltf') {
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
  return breathing;
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
function buildGrass(circuit: RealmRacersCircuit, group: THREE.Group): void {
  // The same gate the overworld carpet takes, and for the same reason: blades
  // are a close-camera detail layer, they are the heaviest thing a circuit
  // draws (a Nightbloom Express Tour is 75 000 clusters and about 1.9 M
  // triangles resident), and tiers below high keep neither them nor the
  // world's. `?bladegrass=off` is the dev perf-attribution switch.
  if (GFX.bladeCarpetRadius <= 0 || renderLayerDisabled('bladegrass')) return;
  const tiles = realmRacersGrassTiles(circuit);
  if (tiles.length === 0) return;
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
  grassMaterials.set(tint, built.material);
  return { geometry: grassGeometry, material: built.material };
}

export function buildRealmRacersTrack(circuit: RealmRacersCircuit): RealmRacersTrackView {
  const group = new THREE.Group();
  group.name = 'realm-racers-track';
  const track = realmRacersTrack(circuit);
  const samples = track.samples;
  const count = samples.length;
  // Everything below that is a colour, a model or a size comes from HERE. The
  // geometry is the same on every circuit in every zone; the skin is not.
  const theme = realmRacersTheme(circuit);

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
  const tint = biomeGroundTint(theme.ground);
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

  const kerbMat = surfaceMat({ map: rallyKerbTexture(theme.kerb), roughness: 0.7 });
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
  const gridTexture = rallyStartGridTexture(theme.startGrid);
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

  buildBasin(circuit, theme, group);
  buildStartArch(circuit, theme, group);
  const startLightLenses = buildStartLights(circuit, group);
  const startLightOff = startLightLenses[0]?.material as THREE.Material;
  const startLightRed = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
  const startLightGreen = new THREE.MeshBasicMaterial({ color: 0x45e06f });
  let lastStartLightSignal = '';
  buildFlowers(circuit, theme, group);
  buildGrass(circuit, group);

  // --- the AUTHORED dressing: every piece a designer placed by hand, plus the
  // seeded fills, from the one resolver the collision set reads too ---
  const breathingProps = buildDressingProps(circuit, group);

  // --- the pickup boxes, under THIS circuit's group so they inherit the lane
  // transform and the "not my lane" hide the view already resolves ---
  const pickups = buildRealmRacersPickups(circuit);
  group.add(pickups.group);

  // --- and the oil a drawn pickup leaves behind, on the same group for the
  // same reasons. It takes no circuit: where the patches are is a live fact of
  // the race, not of the geometry ---
  const slicks = buildRealmRacersSlicks();
  group.add(slicks.group);

  // --- the perimeter, so the circuit sits in a walled garden ---
  const perimeter = rallyPerimeterPieces(circuit);
  const wallScale = theme.perimeter.scale;
  const wallSpot = (piece: (typeof perimeter)[number]): ModelSpot => ({
    x: piece.x,
    y: GRASS_Y,
    z: piece.z,
    yaw: piece.yaw,
    sx: wallScale,
    sy: wallScale,
    sz: wallScale,
  });
  const { fenceUrl, pillarUrl } = theme.perimeter;
  instanceModel(group, fenceUrl, perimeter.filter((p) => !p.pillar).map(wallSpot));
  instanceModel(group, pillarUrl, perimeter.filter((p) => p.pillar).map(wallSpot));

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
 * eager wins on the pool as it stands. Per circuit, three builds each, in Node
 * with the procedural textures stubbed (so the numbers are the CPU cost of
 * generating and packing geometry, not of uploading it):
 *
 *   evergarden_practice       21 to 47 ms
 *   evergarden_express_tour   75 to 76 ms
 *
 * So the whole pool is about 120 ms, paid once during world build, behind the
 * loading screen. Three things decided it:
 *
 *  - Lazy moves the LARGER of those two onto the frame a viewer arrives at a
 *    circuit, and that frame is the countdown. A tenth of a second of hitch as
 *    the lights come on is the one place this cost must not land.
 *  - Eviction has nothing to evict. The policy worth having is "keep at most
 *    two", and the pool IS two, so the whole mechanism would be inert code with
 *    no reachable path, which is exactly what 13a-1 declined to write blind.
 *  - A megabyte of resident attribute data is not a budget anyone is fighting
 *    over out here.
 *
 * Where the time goes, so the next circuit can be judged before it is drawn:
 * the road ribbons are cheap and the cost tracks the SCATTER, which follows the
 * area inside the perimeter rather than the lap. On the Express Tour,
 * `rallyFlowerSpots` is 72 ms for 4 984 tufts (one spline projection per
 * candidate point, which is the whole of it) and the water surfaces are 29 ms
 * for two pools; everything else together is under 4 ms.
 *
 * The GRASS is not in those numbers, because neither shipped circuit grows any:
 * both wear the Evergarden, which is mown lawn (`GRASS_BIOME_DENSITY.garden` is
 * 0). A circuit whose zone DOES grow blades pays about 25 ms more on a lap this
 * size, measured on a Nightbloom probe of the same two curves: 4 ms to bake the
 * mask, 11 ms to place 74 057 clusters over 96 tiles, and the rest in the
 * instancing. The mask is a grid stamped off the centerline rather than a
 * projection per candidate, which is why that half is cheap.
 *
 * The build is superlinear in circuit size (1.8x the lap, 3.6x the build), so
 * revisit this decision at roughly four more circuits of this size, where the
 * eager cost approaches half a second and lazy starts paying for itself. The
 * cheapest levers, in order: `REALM_RACERS_GRASS_YARDS_PER_CLUSTER` for a
 * grassy zone, then the flower patch pitch.
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
