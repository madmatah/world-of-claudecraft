// A circuit's models wear what the world gives the same file
// (src/render/realm_racers_dressing_material.ts): a world prop url the world's
// own converted material, the garden maze hedge its raw glTF material as
// garden_features.ts draws it, and a model the world never draws its raw
// material under a race-only name. The oracle is three's program cache key
// (tests/helpers/three_program_keys.ts) plus `materialProgramSignature`, taken
// on the world's own extraction (`propAsset`), per tier; the models are
// mirrored from each shipped GLB's own material slots
// (tests/helpers/gltf_material_mirror.ts).

import * as THREE from 'three';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { mirrorGltfScene } from './helpers/gltf_material_mirror';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

vi.mock('../src/render/textures', () => {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  return {
    rallyKerbTexture: vi.fn(texture),
    rallyGroundBlastMarkerTexture: vi.fn(texture),
    rallyStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    grassTuftTexture: vi.fn(texture),
    sparkleTexture: vi.fn(texture),
    groundDetailTexture: vi.fn(texture),
    macroNoiseTexture: vi.fn(texture),
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
    groundSplatMaps: vi.fn(() => ({
      grass: { map: texture(), normalMap: texture() },
      dirt: { map: texture(), normalMap: texture() },
      rock: { map: texture(), normalMap: texture() },
      sand: { map: texture(), normalMap: texture() },
    })),
  };
});

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  loadGltf: vi.fn((url: string) =>
    url.startsWith('/models/')
      ? Promise.resolve({ scene: mirrorGltfScene(url, 'public') })
      : new Promise(() => undefined),
  ),
}));

import { attachBiomeHaze } from '../src/render/biome_haze_field';
import { EMBER_PROP_URLS } from '../src/render/ember_prop_urls';
import { GFX_TIER_RANK, type GfxSettings, type GfxTier } from '../src/render/gfx';
import {
  ignivarEnvPropCastsShadow,
  ignivarEnvPropKeyOfUrl,
  ignivarEnvPropTemplate,
  prepareIgnivarEnvProps,
} from '../src/render/ignivar_env_props';
import { JUNGLE_PALM_URLS, JUNGLE_PROP_URLS } from '../src/render/jungle_prop_urls';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import {
  PROP_ASSET_DEFS,
  preparePropProfileAssets,
  propMaterialInternalsForTest,
  propPreloadInternalsForTest,
  worldPropKey,
} from '../src/render/props';
import { REALM_RACERS_BARRIER_VISUALS } from '../src/render/realm_racers_barrier_visuals';
import {
  realmRacersDressingPart,
  realmRacersDressingRoute,
  realmRacersWorldKitPart,
} from '../src/render/realm_racers_dressing_material';
import { realmRacersFills } from '../src/render/realm_racers_fills';
import { REALM_RACERS_PROP_VISUALS } from '../src/render/realm_racers_prop_visuals';
import { CIRCUIT_THEMES } from '../src/render/realm_racers_themes';
import { buildRealmRacersTrack, buildRealmRacersTracks } from '../src/render/realm_racers_track';
import { disposeRealmRacersTrackGroup } from '../src/render/realm_racers_track_dispose_core';
import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';

afterAll(gfxProfileRestorer());

beforeEach(() => {
  // The fetch-and-fill arm only runs where a window exists.
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PREFIX = 'realm-racers-dressing:';

/** Every model url a circuit record can place, shipped or not. */
const PLACEABLE_URLS = [
  ...new Set([
    ...Object.values(REALM_RACERS_PROP_VISUALS).flatMap((visual) =>
      visual.kind === 'gltf' ? [visual.url] : [],
    ),
    ...Object.values(REALM_RACERS_BARRIER_VISUALS).flatMap((visual) => [
      visual.panelUrl,
      ...(visual.corner === 'none' ? [] : [visual.corner.url]),
    ]),
  ]),
].sort();

/** The models the world splits per UV family: no single world material to share. */
const SURFACE_SPLIT_URLS = ['hexShipBlue', 'hexShipRed', 'hexShipGreen', 'hexBoat', 'hexWatchtower']
  .map((key) => PROP_ASSET_DEFS[key].url)
  .sort();

/** The world props the shipped circuits place that the world leaves out on low
 *  (`LOW_TIER_PROP_KEYS`): their Lambert programs are the circuit's to link there. */
const OUTSIDE_LOW_TIER_URLS = [
  '/models/biome/hex_cannon.glb',
  '/models/biome/hex_cannonballs.glb',
  '/models/biome/hex_crate_big.glb',
  '/models/biome/hex_flag.glb',
  '/models/biome/hex_sack.glb',
  '/models/biome/hex_tower.glb',
  '/models/biome/hexr_blacksmith.glb',
  '/models/biome/kcas_bench.glb',
  '/models/biome/kcas_torch.glb',
  '/models/dungeon/crates_stacked.glb',
  '/models/dungeon/pillar.glb',
  '/models/foliage/oak_4.glb',
  '/models/props/crystal_amethyst_cluster.glb',
  '/models/props/crystal_mound_cave.glb',
  '/models/props/fen_lilies.glb',
  '/models/props/flower_bed_square_a.glb',
  '/models/props/flower_glow.glb',
  '/models/props/garden_arch.glb',
  '/models/props/kmed_church_hollow.glb',
  '/models/props/kmed_home_A_hollow.glb',
  '/models/props/kmed_home_B_hollow.glb',
  '/models/props/kmed_tavern_hollow.glb',
  '/models/props/leafy_fox_statue.glb',
  '/models/props/mushroom_giant_purple.glb',
  '/models/props/mushroom_glow_cluster.glb',
  '/models/props/mushroom_tan.glb',
  '/models/props/pixie_mushroom_house.glb',
  '/models/props/shrub_flowering.glb',
  '/models/props/star_heart_crystal.glb',
  '/models/props/statue_head.glb',
];

/** The models the shipped circuits place that nothing in the world draws. */
const RACE_ONLY_URLS = [
  '/models/biome/city_fence_wood.glb',
  '/models/dungeon/banner_patterna_red.glb',
  '/models/dungeon/banner_patterna_white.glb',
  '/models/dungeon/banner_patterna_yellow.glb',
];

type Draw = { object: THREE.Object3D; material: THREE.Material };

/** The kit draws a Drakelands circuit makes: one per offered kit piece, one
 *  per barrier module kind, and the url each instances. */
function drakelandsKitDraws(): { urls: Set<string>; draws: number } {
  const theme = CIRCUIT_THEMES.drakelands;
  const urls: string[] = [];
  for (const asset of theme.props) {
    const visual = REALM_RACERS_PROP_VISUALS[asset];
    if (visual.kind === 'worldKit') urls.push(visual.url);
  }
  for (const kit of theme.barriers) {
    const visual = REALM_RACERS_BARRIER_VISUALS[kit];
    urls.push(visual.panelUrl, ...(visual.corner === 'none' ? [] : [visual.corner.url]));
  }
  return { urls: new Set(urls), draws: urls.length };
}

/**
 * A Drakelands circuit: the garden's curve wearing the drakelands theme, with
 * EVERY piece its vocabulary offers placed once and both of its walls run. The
 * shipped Rampart Run places a subset of it; this probe covers the whole set.
 */
function drakelandsCircuit(): RealmRacersCircuit {
  const theme = CIRCUIT_THEMES.drakelands;
  return {
    ...REALM_RACERS_PRACTICE_CIRCUIT,
    id: 'drakelands_dressing_probe',
    theme: 'drakelands',
    props: theme.props.map((asset, i) => ({
      asset,
      at: { x: -260 + (i % 12) * 20, z: 120 + Math.floor(i / 12) * 10 },
      scale: 4,
    })),
    fences: theme.barriers.map((kit, i) => ({
      kit,
      points: [
        { x: -280, z: -120 + i * 20 },
        { x: -240, z: -120 + i * 20 },
        { x: -240, z: -90 + i * 20 },
      ],
    })),
  };
}

/**
 * A Palmreach circuit: the garden's curve wearing the palmreach theme, with
 * EVERY piece its vocabulary offers placed once and both of its rails run.
 */
function palmreachCircuit(): RealmRacersCircuit {
  const theme = CIRCUIT_THEMES.palmreach;
  return {
    ...REALM_RACERS_PRACTICE_CIRCUIT,
    id: 'palmreach_dressing_probe',
    theme: 'palmreach',
    props: theme.props.map((asset, i) => ({
      asset,
      at: { x: -260 + (i % 12) * 20, z: 120 + Math.floor(i / 12) * 10 },
      scale: 3,
    })),
    fences: theme.barriers.map((kit, i) => ({
      kit,
      points: [
        { x: -280, z: -120 + i * 20 },
        { x: -240, z: -120 + i * 20 },
      ],
    })),
  };
}

/** Every model draw under a view, by the url it instances. */
function dressingDrawsByUrl(root: THREE.Object3D): Map<string, Draw[]> {
  const byUrl = new Map<string, Draw[]>();
  for (const draw of drawsUnder(root)) {
    if (!draw.object.userData.realmRacersDressing) continue;
    const url = draw.object.name.slice(PREFIX.length);
    byUrl.set(url, [...(byUrl.get(url) ?? []), draw]);
  }
  return byUrl;
}

/** Every model draw of the shipped circuits, by the url it instances. */
async function rallyDrawsByUrl(): Promise<Map<string, Draw[]>> {
  const tracks = buildRealmRacersTracks();
  await Promise.all(tracks.circuits.map((view) => realmRacersFills(view.group).landed()));
  const byUrl = new Map<string, Draw[]>();
  for (const view of tracks.circuits) {
    for (const draw of drawsUnder(view.group)) {
      if (!draw.object.userData.realmRacersDressing) continue;
      expect(draw.object.name.startsWith(PREFIX), draw.object.name).toBe(true);
      const url = draw.object.name.slice(PREFIX.length);
      byUrl.set(url, [...(byUrl.get(url) ?? []), draw]);
    }
  }
  return byUrl;
}

const keysOf = (draws: readonly Draw[]): Set<string> =>
  new Set(draws.map(({ object, material }) => threeProgramKeys(material, object)));

const signaturesOf = (draws: readonly Draw[]): Set<string> =>
  new Set(draws.map(({ material }) => materialProgramSignature(material)));

/** What the world's props draw for `url`: its extracted parts, instanced. */
function worldPropDraws(url: string): Draw[] {
  const draws: Draw[] = [];
  for (const [key, def] of Object.entries(PROP_ASSET_DEFS)) {
    if (def.url !== url) continue;
    for (const part of propMaterialInternalsForTest.propAsset(key).parts) {
      draws.push({ object: new THREE.InstancedMesh(part.geo, part.mat, 1), material: part.mat });
    }
  }
  return draws;
}

/** How a module drawing the raw glTF draws `url` (garden_features.ts). */
function rawDraws(url: string): Draw[] {
  const draws: Draw[] = [];
  mirrorGltfScene(url, 'public').traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const material = mesh.material as THREE.Material;
    draws.push({ object: new THREE.InstancedMesh(mesh.geometry, material, 1), material });
  });
  return draws;
}

it('names one kit per world prop url, the key the converter is looked up by', () => {
  const kits = new Map<string, Set<string>>();
  for (const def of Object.values(PROP_ASSET_DEFS)) {
    kits.set(def.url, (kits.get(def.url) ?? new Set()).add(def.kit));
  }
  for (const [url, set] of kits) expect(set.size, url).toBe(1);
});

it('leaves out a part the world strips from the same model', () => {
  const url = PROP_ASSET_DEFS.cart.url;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
  const part = (name: string) =>
    realmRacersDressingPart(
      url,
      geometry,
      Object.assign(new THREE.MeshStandardMaterial(), { name }),
    );
  expect(PROP_ASSET_DEFS.cart.strip?.test('Red')).toBe(true);
  expect(part('Red')).toBeNull();
  expect(part('Wood')?.material.name).toBe(`${PROP_ASSET_DEFS.cart.kit}:Wood`);
});

it('names a race-only material through the hook-preserving clone', () => {
  const source = new THREE.MeshStandardMaterial();
  source.name = 'MI_WoodTrim';
  attachBiomeHaze(source);
  const geometry = new THREE.BufferGeometry();
  const part = realmRacersDressingPart(RACE_ONLY_URLS[0], geometry, source);
  expect(part?.material).not.toBe(source);
  expect(part?.material.name).toBe('realmRacersRaceOnly:city_fence_wood:MI_WoodTrim');
  expect(part?.material.customProgramCacheKey()).toBe(source.customProgramCacheKey());
});

it('sends a model the world splits per UV family to the race-only route', () => {
  const placeable = PLACEABLE_URLS.filter((url) => SURFACE_SPLIT_URLS.includes(url));
  expect(placeable).toEqual(SURFACE_SPLIT_URLS);
  for (const url of SURFACE_SPLIT_URLS) expect(realmRacersDressingRoute(url), url).toBe('raceOnly');
  expect(realmRacersDressingRoute(PROP_ASSET_DEFS.hexBoatrack.url)).toBe('worldProp');
});

it('places every world prop at the world orientation: no placeable key bakes a yaw', () => {
  for (const url of PLACEABLE_URLS) {
    const key = worldPropKey(url);
    if (key !== undefined) expect(PROP_ASSET_DEFS[key].yaw, url).toBeUndefined();
  }
});

it('shapes a world prop part as the extraction does: normals, and the atlas cell fix', () => {
  const url = PROP_ASSET_DEFS.seaBoatFishing.url;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), 3),
  );
  const authored = [0.71868, 0.8, 0.1, 0.1, 0.71868, 0.5];
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(authored), 2));
  const part = realmRacersDressingPart(url, geometry, new THREE.MeshStandardMaterial());
  if (!part) throw new Error('the part was stripped');
  expect(part.geometry).not.toBe(geometry);
  expect(part.geometry.getAttribute('normal').getY(0)).toBeCloseTo(-1);
  const uv = Array.from(part.geometry.getAttribute('uv').array as Float32Array);
  expect(uv[0]).toBeCloseTo(0.71868 + 0.125, 5);
  expect(uv.slice(1)).toEqual(Array.from(new Float32Array(authored)).slice(1));
  // The loader's own geometry is never touched.
  expect(geometry.getAttribute('normal')).toBeUndefined();
  expect(Array.from(geometry.getAttribute('uv').array)).toEqual(
    Array.from(new Float32Array(authored)),
  );
});

describe.each(Object.keys(GFX_TIER_RANK) as GfxTier[])('the circuit dressing on %s', (tier) => {
  beforeEach(async () => {
    activateTier(tier);
    await preparePropProfileAssets({ standardMaterials: true } as GfxSettings);
  });

  it('draws every world prop a shipped circuit places with the world material and programs', async () => {
    const byUrl = await rallyDrawsByUrl();
    const worldUrls = [...byUrl.keys()].filter(
      (url) => realmRacersDressingRoute(url) === 'worldProp',
    );
    expect(worldUrls.length).toBeGreaterThan(20);
    const lambert = tier === 'low';
    for (const url of worldUrls) {
      const rally = byUrl.get(url) ?? [];
      const world = worldPropDraws(url);
      expect(world.length, url).toBeGreaterThan(0);
      const worldMaterials = new Set(world.map(({ material }) => material));
      for (const { material } of rally) {
        expect(worldMaterials.has(material), `${url} ${material.name}`).toBe(true);
        expect(material.type, url).toBe(lambert ? 'MeshLambertMaterial' : 'MeshStandardMaterial');
      }
      expect(keysOf(rally), url).toEqual(keysOf(world));
      expect(signaturesOf(rally), url).toEqual(signaturesOf(world));
    }
  });

  it('gives every placeable world prop part a material the world extraction makes', () => {
    for (const url of PLACEABLE_URLS) {
      const route = realmRacersDressingRoute(url);
      if (route !== 'worldProp') continue;
      const world = worldPropDraws(url);
      const materials = new Set(world.map(({ material }) => material));
      const keys = keysOf(world);
      mirrorGltfScene(url, 'public').traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const part = realmRacersDressingPart(url, mesh.geometry, mesh.material as THREE.Material);
        if (!part) return;
        expect(materials.has(part.material), `${url} ${part.material.name}`).toBe(true);
        const object = new THREE.InstancedMesh(part.geometry, part.material, 1);
        expect(keys.has(threeProgramKeys(part.material, object)), url).toBe(true);
      });
    }
  });

  it('lists the placed world props the world itself leaves out on low', async () => {
    const low = new Set<string>(propPreloadInternalsForTest.lowTierPropKeys);
    const placed = [...(await rallyDrawsByUrl()).keys()].filter(
      (url) => realmRacersDressingRoute(url) === 'worldProp',
    );
    const outside = placed.filter((url) => !low.has(worldPropKey(url) as string)).sort();
    expect(outside).toEqual(OUTSIDE_LOW_TIER_URLS);
  });

  it('keeps the hedge and the ember set raw as the world draws them, and names every race-only model', async () => {
    const byUrl = await rallyDrawsByUrl();
    const routes = new Map<string, string[]>();
    for (const url of byUrl.keys()) {
      const route = realmRacersDressingRoute(url);
      routes.set(route, [...(routes.get(route) ?? []), url]);
    }
    // The hedge, and the ember set the Drakelands Rampart Run places, which
    // rides the parse ember_features keeps.
    expect([...(routes.get('worldRaw') ?? [])].sort()).toEqual([
      '/models/props/dragon_eggs.glb',
      '/models/props/dragon_hoard.glb',
      '/models/props/ember_lily.glb',
      '/models/props/lava_pool.glb',
      '/models/props/maze_hedge_wall.glb',
    ]);
    expect([...(routes.get('raceOnly') ?? [])].sort()).toEqual(RACE_ONLY_URLS);
    for (const url of routes.get('worldRaw') ?? []) {
      const rally = byUrl.get(url) ?? [];
      const raw = rawDraws(url);
      expect(rally.map(({ material }) => material.name)).toEqual(
        raw.map(({ material }) => material.name),
      );
      expect(keysOf(rally), url).toEqual(keysOf(raw));
    }
    for (const url of RACE_ONLY_URLS) {
      const rally = byUrl.get(url) ?? [];
      expect(rally.length, url).toBeGreaterThan(0);
      const file = url.slice(url.lastIndexOf('/') + 1, -'.glb'.length);
      for (const { material } of rally) {
        expect(material.name.startsWith(`realmRacersRaceOnly:${file}:`), material.name).toBe(true);
      }
      expect(keysOf(rally), url).toEqual(keysOf(rawDraws(url)));
    }
  });

  it('draws a Drakelands circuit with the zone own templates, raw ember parse and world props', async () => {
    // The world's env-prop templates load in the deferred lane at world entry;
    // headless, the lane is this call, on the same mirrored files.
    await prepareIgnivarEnvProps();
    const view = buildRealmRacersTrack(drakelandsCircuit());
    await realmRacersFills(view.group).landed();
    const byUrl = new Map<string, Draw[]>();
    for (const draw of drawsUnder(view.group)) {
      if (!draw.object.userData.realmRacersDressing) continue;
      const url = draw.object.name.slice(PREFIX.length);
      byUrl.set(url, [...(byUrl.get(url) ?? []), draw]);
    }
    const routes = new Map<string, string[]>();
    for (const url of byUrl.keys()) {
      const route = realmRacersDressingRoute(url);
      routes.set(route, [...(routes.get(route) ?? []), url]);
    }
    // Every kit piece and both walls, through the template: exactly the set
    // the theme offers, one draw per piece and per barrier module.
    const expected = drakelandsKitDraws();
    const kitUrls = routes.get('worldKit') ?? [];
    expect(new Set(kitUrls)).toEqual(expected.urls);
    expect(kitUrls.reduce((n, url) => n + (byUrl.get(url)?.length ?? 0), 0)).toBe(expected.draws);
    const placed = new Map<string, number>();
    for (const placement of FORGEFATHER_FORTRESS_PLACEMENTS) {
      placed.set(placement.key, (placed.get(placement.key) ?? 0) + 1);
    }
    for (const url of kitUrls) {
      const key = ignivarEnvPropKeyOfUrl(url);
      const template = key ? ignivarEnvPropTemplate(key) : null;
      expect(template, url).not.toBeNull();
      if (!key || !template) continue;
      expect(realmRacersWorldKitPart(url)).toBe(template);
      // The world draws the key INSTANCED (appendIgnivarEnvProps instances a
      // key placed twice or more, on every tier the fortress is built at), so
      // the circuit's instanced draw of the very same objects is its program.
      expect(placed.get(key) ?? 0, `${url} is instanced by the world`).toBeGreaterThan(1);
      const world = new THREE.InstancedMesh(template.geometry, template.material, 2);
      for (const { object, material } of byUrl.get(url) ?? []) {
        expect(material, url).toBe(template.material);
        expect((object as THREE.Mesh).geometry, url).toBe(template.geometry);
        expect(threeProgramKeys(material, object), url).toBe(
          threeProgramKeys(template.material, world),
        );
        // ...and it casts where the world's instances cast, no more.
        expect(object.castShadow, url).toBe(ignivarEnvPropCastsShadow(key));
      }
    }
    // The ember set wears its own raw materials, as ember_features draws it.
    const ember = new Set<string>(Object.values(EMBER_PROP_URLS));
    const raw = (routes.get('worldRaw') ?? []).filter((url) => ember.has(url)).sort();
    expect(raw).toEqual(
      [
        EMBER_PROP_URLS.pool,
        EMBER_PROP_URLS.hoard,
        EMBER_PROP_URLS.eggs,
        EMBER_PROP_URLS.lily,
      ].sort(),
    );
    for (const url of raw) expect(keysOf(byUrl.get(url) ?? []), url).toEqual(keysOf(rawDraws(url)));
    // The rest are world props on the world's own converted material...
    for (const url of routes.get('worldProp') ?? []) {
      const worldMaterials = new Set(worldPropDraws(url).map(({ material }) => material));
      for (const { material } of byUrl.get(url) ?? []) {
        expect(worldMaterials.has(material), `${url} ${material.name}`).toBe(true);
      }
    }
    // ...and the one model the circuit alone draws is its start banner, like
    // every shipped circuit's.
    expect(routes.get('raceOnly')).toEqual([CIRCUIT_THEMES.drakelands.startFixture.bannerUrl]);
    // No rim planting, as the zone's own lakes have none, on a curve that has
    // ponds for it to be a claim about.
    expect(REALM_RACERS_PRACTICE_CIRCUIT.ponds?.length ?? 0).toBeGreaterThan(0);
    expect(byUrl.has('/models/props/reeds.glb')).toBe(false);
  });

  it('draws a Palmreach circuit with the jungle own parse, the world props and two race-only models', async () => {
    const view = buildRealmRacersTrack(palmreachCircuit());
    await realmRacersFills(view.group).landed();
    const byUrl = dressingDrawsByUrl(view.group);
    const routes = new Map<string, string[]>();
    for (const url of byUrl.keys()) {
      const route = realmRacersDressingRoute(url);
      routes.set(route, [...(routes.get(route) ?? []), url]);
    }
    // The palms and the coconuts wear their own raw materials, as
    // jungle_features draws them, and nothing else rides that route here.
    const strand = [...JUNGLE_PALM_URLS, JUNGLE_PROP_URLS.coconuts].sort();
    expect([...(routes.get('worldRaw') ?? [])].sort()).toEqual(strand);
    for (const url of strand) {
      expect(keysOf(byUrl.get(url) ?? []), url).toEqual(keysOf(rawDraws(url)));
    }
    // The world bakes a palm down to its position, normal and uv before it
    // instances it (`bakePalmParts`), which is the whole attribute set the file
    // carries, so the raw draw's program is the baked one's.
    for (const url of JUNGLE_PALM_URLS) {
      mirrorGltfScene(url, 'public').traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        expect(Object.keys(mesh.geometry.attributes).sort(), url).toEqual([
          'normal',
          'position',
          'uv',
        ]);
      });
    }
    // The rest are world props on the world's own converted material...
    expect((routes.get('worldProp') ?? []).length).toBeGreaterThan(15);
    for (const url of routes.get('worldProp') ?? []) {
      const worldMaterials = new Set(worldPropDraws(url).map(({ material }) => material));
      for (const { material } of byUrl.get(url) ?? []) {
        expect(worldMaterials.has(material), `${url} ${material.name}`).toBe(true);
      }
    }
    // ...and what the circuit alone draws is its start banner and the paling
    // panel, which no zone of the world builds with.
    expect([...(routes.get('raceOnly') ?? [])].sort()).toEqual(
      [
        CIRCUIT_THEMES.palmreach.startFixture.bannerUrl,
        REALM_RACERS_BARRIER_VISUALS.woodPaling.panelUrl,
      ].sort(),
    );
    expect(routes.has('worldKit')).toBe(false);
  });

  it('survives the editor preview rebuild: the dispose core frees no shared material or geometry', async () => {
    const dressing = async (circuitIndex: number) => {
      const view = buildRealmRacersTrack(REALM_RACERS_CIRCUIT_LIST[circuitIndex]);
      await realmRacersFills(view.group).landed();
      const draws = drawsUnder(view.group).filter(
        ({ object }) => object.userData.realmRacersDressing,
      );
      return { group: view.group, draws };
    };
    for (const index of REALM_RACERS_CIRCUIT_LIST.keys()) {
      const first = await dressing(index);
      expect(first.draws.length).toBeGreaterThan(0);
      const spies = first.draws.flatMap(({ object, material }) => [
        vi.spyOn(material, 'dispose'),
        vi.spyOn((object as THREE.Mesh).geometry, 'dispose'),
      ]);
      disposeRealmRacersTrackGroup(first.group);
      const second = await dressing(index);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(second.draws.map(({ material }) => material)).toEqual(
        first.draws.map(({ material }) => material),
      );
      vi.restoreAllMocks();
    }
  });
});
