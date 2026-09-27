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

import { GFX_TIER_RANK, type GfxSettings, type GfxTier } from '../src/render/gfx';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import {
  PROP_ASSET_DEFS,
  preparePropProfileAssets,
  propMaterialInternalsForTest,
} from '../src/render/props';
import {
  realmRacersDressingPart,
  realmRacersDressingRoute,
} from '../src/render/realm_racers_dressing_material';
import { realmRacersFills } from '../src/render/realm_racers_fills';
import { buildRealmRacersTrack, buildRealmRacersTracks } from '../src/render/realm_racers_track';
import { disposeRealmRacersTrackGroup } from '../src/render/realm_racers_track_dispose_core';
import { REALM_RACERS_CIRCUIT_LIST } from '../src/sim/content/realm_racers_circuits';

afterAll(gfxProfileRestorer());

beforeEach(() => {
  // The fetch-and-fill arm only runs where a window exists.
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const PREFIX = 'realm-racers-dressing:';

/** The models the shipped circuits place that nothing in the world draws. */
const RACE_ONLY_URLS = [
  '/models/biome/city_fence_wood.glb',
  '/models/dungeon/banner_patterna_white.glb',
  '/models/dungeon/banner_patterna_yellow.glb',
];

type Draw = { object: THREE.Object3D; material: THREE.Material };

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

  it('keeps the maze hedge raw as the world draws it, and names every race-only model', async () => {
    const byUrl = await rallyDrawsByUrl();
    const routes = new Map<string, string[]>();
    for (const url of byUrl.keys()) {
      const route = realmRacersDressingRoute(url);
      routes.set(route, [...(routes.get(route) ?? []), url]);
    }
    expect(routes.get('worldRaw')).toEqual(['/models/props/maze_hedge_wall.glb']);
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
