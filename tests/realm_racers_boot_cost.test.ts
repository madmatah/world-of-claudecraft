// What the rally presentation costs a player who never races: nothing fetched
// and nothing minted at boot. A circuit's kit (its theme's start arch, grid banner and shore reed,
// and the barrier kits its record authors) is fetched when THAT circuit's build
// starts, which is the race preparation's commitment to it
// (realm_racers_circuit_prepare.ts asks the build of the drawn circuit only),
// and a login mid-race, which builds at once, still rides the circuit's fill
// ledger so its preparation waits for the kit under the cover. The Ground Blast
// and oil-spray pools mint their geometries, materials and marker texture in
// their own `prepare()`, which the race preparation seam calls at the same
// commitment; importing or constructing them mints nothing.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asked, rallyRegistrations } = vi.hoisted(() => ({
  asked: [] as string[],
  rallyRegistrations: [] as string[],
}));

// The world's own deferred lane fetches several of the same files (a reed bed,
// an iron fence), so a boot ask is attributed by WHO registered it: no rally
// module may put anything in either preload lane.
vi.mock('../src/render/assets/preload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/preload')>();
  // The registering CALLER is the first frame outside this file: a module
  // evaluated through the rally import chain carries rally frames further down.
  const fromRally = (): void => {
    const frames = (new Error().stack ?? '').split('\n').slice(1);
    const caller = frames.find((frame) => !frame.includes('realm_racers_boot_cost.test')) ?? '';
    if (/src\/render\/realm_racers_/.test(caller)) rallyRegistrations.push(caller.trim());
  };
  return {
    ...actual,
    registerPreload: (task: Promise<unknown>) => {
      fromRally();
      actual.registerPreload(task);
    },
    registerDeferredPreload: (start: () => Promise<unknown>) => {
      fromRally();
      actual.registerDeferredPreload(start);
    },
  };
});

vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  rallyGroundBlastMarkerTexture: vi.fn(
    () => new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat),
  ),
}));

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  // Never settles: what is under test is the ASK.
  loadGltf: vi.fn((url: string) => {
    asked.push(url);
    return new Promise(() => undefined);
  }),
}));

import { beginDeferredPreloads } from '../src/render/assets/preload';
import { REALM_RACERS_BARRIER_ASSET_URLS } from '../src/render/realm_racers_barrier_visuals';
import { realmRacersFills } from '../src/render/realm_racers_fills';
import { REALM_RACERS_THEME_ASSET_URLS } from '../src/render/realm_racers_themes';
import { rallyGroundBlastMarkerTexture } from '../src/render/textures';
// What the two pool modules import, evaluated here first, so the window below
// sees only what the pool modules themselves mint.
import '../src/render/compile_exclusion';
import '../src/render/floor_vfx_layer';
import '../src/render/own_shot_launch_core';
import '../src/render/realm_racers_oil_spray_core';
import '../src/render/realm_racers_prepare_core';
import '../src/render/realm_racers_slicks_core';
import '../src/render/renderer_diagnostics';
import '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_CIRCUIT_LIST } from '../src/sim/content/realm_racers_circuits';

const EVERY_KIT = new Set([...REALM_RACERS_THEME_ASSET_URLS, ...REALM_RACERS_BARRIER_ASSET_URLS]);

describe('the Realm Racers circuit kits', () => {
  beforeEach(() => {
    // The fetch only runs where a window exists.
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests no kit at boot, and exactly the drawn circuit kit when its build starts', async () => {
    const track = await import('../src/render/realm_racers_track');
    // Boot: the module is loaded, the deferred lane opens, the pool is made and
    // ticked by a player walking elsewhere.
    expect(rallyRegistrations).toEqual([]);
    beginDeferredPreloads();
    const before = asked.length;
    const tracks = track.buildRealmRacersTracks();
    for (let frame = 0; frame < 60; frame++) tracks.update(0, frame, frame / 20, null);
    expect(asked.slice(before)).toEqual([]);

    // The commitment: the drawn circuit's build starts (its loading lobby, a
    // practice seat, a login on its lane). The circuit with the widest kit is
    // drawn, so the set compared is never trivially small.
    const drawn = [...REALM_RACERS_CIRCUIT_LIST].sort(
      (a, b) =>
        track.realmRacersCircuitKitUrls(b).length - track.realmRacersCircuitKitUrls(a).length,
    )[0];
    const kit = track.realmRacersCircuitKitUrls(drawn);
    expect(kit.length).toBeGreaterThan(2);
    for (const url of kit) expect(EVERY_KIT.has(url), url).toBe(true);
    const view = tracks.circuits.find((candidate) => candidate.circuitId === drawn.id);
    if (!view) throw new Error(`no pool view for ${drawn.id}`);
    const atCommit = asked.length;
    view.build();
    expect([...asked.slice(atCommit)].sort()).toEqual([...kit].sort());

    // A login mid-race builds at once with the kit still in flight: every kit
    // model rides the circuit's fill ledger, which its preparation waits on
    // under the cover.
    view.build().finish();
    const fills = realmRacersFills(view.group);
    expect(fills.done).toBe(0);
    expect(fills.total).toBeGreaterThanOrEqual(kit.length);
    // ...and no other circuit's banner was asked for along the way.
    const own = new Set(kit);
    const otherBanners = REALM_RACERS_CIRCUIT_LIST.filter((c) => c.id !== drawn.id)
      .flatMap((c) => track.realmRacersCircuitKitUrls(c))
      .filter((url) => url.includes('banner') && !own.has(url));
    expect(otherBanners.length).toBeGreaterThan(0);
    for (const url of otherBanners) expect(asked.slice(atCommit), url).not.toContain(url);
    tracks.dispose();
  });
});

/** Three gives every material and every geometry an id off its own counter:
 *  the next id of each, read by minting one probe of each. */
function nextIds(): { material: number; geometry: number } {
  const material = new THREE.MeshBasicMaterial() as THREE.MeshBasicMaterial & {
    readonly id: number;
  };
  return { material: material.id, geometry: new THREE.BufferGeometry().id };
}

describe('the race pools', () => {
  it('mint no geometry, material or texture at import or construction, only at prepare', async () => {
    const before = nextIds();
    const { RealmRacersGroundBlastVisuals } = await import(
      '../src/render/realm_racers_ground_blast'
    );
    const { RealmRacersOilSprayVisuals } = await import('../src/render/realm_racers_oil_spray');
    const blasts = new RealmRacersGroundBlastVisuals();
    const sprays = new RealmRacersOilSprayVisuals();
    const constructed = nextIds();
    // Only the probes themselves were minted in between.
    expect(constructed.material - before.material).toBe(1);
    expect(constructed.geometry - before.geometry).toBe(1);
    expect(rallyGroundBlastMarkerTexture).not.toHaveBeenCalled();
    expect(blasts.group.children).toEqual([]);
    expect(sprays.group.children).toEqual([]);
    // A frame of a session that never races mints nothing either.
    blasts.update(1 / 20);
    sprays.update(1 / 20);
    const ticked = nextIds();
    expect(ticked.material - constructed.material).toBe(1);
    expect(ticked.geometry - constructed.geometry).toBe(1);

    // The commitment: both pools mint their whole set at once.
    blasts.prepare();
    sprays.prepare();
    const prepared = nextIds();
    expect(prepared.material - ticked.material).toBeGreaterThan(1);
    expect(prepared.geometry - ticked.geometry).toBeGreaterThan(1);
    expect(rallyGroundBlastMarkerTexture).toHaveBeenCalledTimes(1);
    expect(blasts.group.children.length).toBeGreaterThan(0);
    expect(sprays.group.children.length).toBeGreaterThan(0);
    // A second pool of each shares the spray's one module material and
    // geometry: only the blast pool's own set is minted again.
    const second = new RealmRacersOilSprayVisuals();
    const beforeSecond = nextIds();
    second.prepare();
    const afterSecond = nextIds();
    expect(afterSecond.material - beforeSecond.material).toBe(1);
    expect(afterSecond.geometry - beforeSecond.geometry).toBe(1);
    blasts.dispose();
    sprays.dispose();
    second.dispose();
  });
});
