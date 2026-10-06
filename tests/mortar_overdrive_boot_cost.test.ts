// What the Mortar Overdrive presentation costs a player who never races: nothing fetched
// and nothing minted at boot. A circuit's kit (its theme's start arch, grid banner and shore reed,
// and the barrier kits its record authors) is fetched when THAT circuit's build
// starts, which is the race preparation's commitment to it
// (mortar_overdrive/circuit_prepare.ts asks the build of the drawn circuit only),
// and a login mid-race, which builds at once, still rides the circuit's fill
// ledger so its preparation waits for the kit under the cover. The Ground Blast
// and oil-spray pools mint their geometries, materials and marker texture in
// their own `prepare()`, which the race preparation seam calls at the same
// commitment; importing or constructing them mints nothing.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { asked, mortarOverdriveRegistrations } = vi.hoisted(() => ({
  asked: [] as string[],
  mortarOverdriveRegistrations: [] as string[],
}));

// The world's own deferred lane fetches several of the same files (a reed bed,
// an iron fence), so a boot ask is attributed by WHO registered it: no Mortar Overdrive
// module may put anything in either preload lane.
vi.mock('../src/render/assets/preload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/preload')>();
  // The registering CALLER is the first frame outside this file: a module
  // evaluated through the Mortar Overdrive import chain carries Mortar Overdrive frames further down.
  const fromMortarOverdrive = (): void => {
    const frames = (new Error().stack ?? '').split('\n').slice(1);
    const caller = frames.find((frame) => !frame.includes('mortar_overdrive_boot_cost.test')) ?? '';
    if (/src\/render\/mortar_overdrive_/.test(caller))
      mortarOverdriveRegistrations.push(caller.trim());
  };
  return {
    ...actual,
    registerPreload: (task: Promise<unknown>) => {
      fromMortarOverdrive();
      actual.registerPreload(task);
    },
    registerDeferredPreload: (start: () => Promise<unknown>) => {
      fromMortarOverdrive();
      actual.registerDeferredPreload(start);
    },
  };
});

vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  mortarOverdriveGroundBlastMarkerTexture: vi.fn(
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
import { MORTAR_OVERDRIVE_BARRIER_ASSET_URLS } from '../src/render/mortar_overdrive/barrier_visuals';
import { mortarOverdriveFills } from '../src/render/mortar_overdrive/fills';
import { MORTAR_OVERDRIVE_THEME_ASSET_URLS } from '../src/render/mortar_overdrive/themes';
import { mortarOverdriveGroundBlastMarkerTexture } from '../src/render/textures';
// What the two pool modules import, evaluated here first, so the window below
// sees only what the pool modules themselves mint.
import '../src/render/compile_exclusion';
import '../src/render/floor_vfx_layer';
import '../src/render/own_shot_launch_core';
import '../src/render/mortar_overdrive/oil_spray_core';
import '../src/render/mortar_overdrive/prepare_core';
import '../src/render/mortar_overdrive/slicks_core';
import '../src/render/renderer_diagnostics';
import '../src/sim/mortar_overdrive/ground_blast';
import { MORTAR_OVERDRIVE_CIRCUIT_LIST } from '../src/sim/content/mortar_overdrive/circuits';

const EVERY_KIT = new Set([
  ...MORTAR_OVERDRIVE_THEME_ASSET_URLS,
  ...MORTAR_OVERDRIVE_BARRIER_ASSET_URLS,
]);

describe('the Mortar Overdrive circuit kits', () => {
  beforeEach(() => {
    // The fetch only runs where a window exists.
    vi.stubGlobal('window', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests no kit at boot, and exactly the drawn circuit kit when its build starts', async () => {
    const track = await import('../src/render/mortar_overdrive/track');
    // Boot: the module is loaded, the deferred lane opens, the pool is made and
    // ticked by a player walking elsewhere.
    expect(mortarOverdriveRegistrations).toEqual([]);
    beginDeferredPreloads();
    const before = asked.length;
    const tracks = track.buildMortarOverdriveTracks();
    for (let frame = 0; frame < 60; frame++) tracks.update(0, frame, frame / 20, null);
    expect(asked.slice(before)).toEqual([]);

    // The commitment: the drawn circuit's build starts (its loading lobby, a
    // practice seat, a login on its lane). The circuit with the widest kit is
    // drawn, so the set compared is never trivially small.
    const drawn = [...MORTAR_OVERDRIVE_CIRCUIT_LIST].sort(
      (a, b) =>
        track.mortarOverdriveCircuitKitUrls(b).length -
        track.mortarOverdriveCircuitKitUrls(a).length,
    )[0];
    const kit = track.mortarOverdriveCircuitKitUrls(drawn);
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
    const fills = mortarOverdriveFills(view.group);
    expect(fills.done).toBe(0);
    expect(fills.total).toBeGreaterThanOrEqual(kit.length);
    // ...and no other circuit's banner was asked for along the way.
    const own = new Set(kit);
    const otherBanners = MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.id !== drawn.id)
      .flatMap((c) => track.mortarOverdriveCircuitKitUrls(c))
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
    const { MortarOverdriveGroundBlastVisuals } = await import(
      '../src/render/mortar_overdrive/ground_blast'
    );
    const { MortarOverdriveOilSprayVisuals } = await import(
      '../src/render/mortar_overdrive/oil_spray'
    );
    const blasts = new MortarOverdriveGroundBlastVisuals();
    const sprays = new MortarOverdriveOilSprayVisuals();
    const constructed = nextIds();
    // Only the probes themselves were minted in between.
    expect(constructed.material - before.material).toBe(1);
    expect(constructed.geometry - before.geometry).toBe(1);
    expect(mortarOverdriveGroundBlastMarkerTexture).not.toHaveBeenCalled();
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
    expect(mortarOverdriveGroundBlastMarkerTexture).toHaveBeenCalledTimes(1);
    expect(blasts.group.children.length).toBeGreaterThan(0);
    expect(sprays.group.children.length).toBeGreaterThan(0);
    // A second pool of each shares the spray's one module material and
    // geometry: only the blast pool's own set is minted again.
    const second = new MortarOverdriveOilSprayVisuals();
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
