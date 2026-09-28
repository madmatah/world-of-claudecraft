// @vitest-environment happy-dom
// The Realm Racers machine wears its pilot's racer veil, the whole kart, on
// the shared spirit veil and nothing else: prepared against drawn.
//
// The kart is a mount rig (the machine's mount key, never a skin while
// driving), built here through the real mount factory over the shipped GLB.
// Veiled in the ward's and the recovery ghost's palettes, every program it can
// draw (each part's colour arm, its depth pre-pass, the baked far mesh the rig
// carries) is a tuple the boot family prewarm links (spirit_veil_prewarm.ts).
// With that family linked the veil commits on the frame the aura lands; with
// it unlinked it stages behind the renderer's effect gate, never a live link.
// The real-driver proof of the same (zero programs) is the racer kart leg of
// tests/browser/spirit_veil_programs.browser.test.ts.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AnimState } from '../src/render/characters/anim_state';
import type { SpiritVeilPalette } from '../src/render/characters/spirit_veil_palette_core';
import type { CharacterVisual, FarBakeGate } from '../src/render/characters/visual';
import { mountVisualSpecFor } from '../src/render/mount_visuals';
import { REALM_RACERS_MOUNT_KEY } from '../src/sim/social/realm_racers';

const FRAME = 1 / 60;
const IDLE: AnimState = {
  speed: 0,
  moving: false,
  running: false,
  airborne: false,
  backwards: false,
  dead: false,
  casting: false,
  swimming: false,
  submerged: false,
  swimPitch: 0,
  wading: false,
  sitting: false,
};

// happy-dom replaces the global URL, which node:fs does not read as a path.
const publicPath = (url: string): string =>
  resolve(process.cwd(), 'public', url.replace(/^\//, ''));

async function parseGlb(url: string) {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  // A program is keyed by the map's presence, not its texels.
  loader.setKTX2Loader({
    load(_url: string, onLoad: (texture: THREE.Texture) => void) {
      onLoad(new THREE.DataTexture(new Uint8Array([200, 200, 200, 255]), 1, 1));
    },
  } as never);
  const buffer = readFileSync(publicPath(url));
  const glb = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  return loader.parseAsync(glb as ArrayBuffer, '');
}

/** The kart the racer's machine presents as while driving (riderSkin is null
 *  under a drive state, so no mount skin can stand in for it). */
const KART = (() => {
  const spec = mountVisualSpecFor(REALM_RACERS_MOUNT_KEY, null);
  if (!spec) throw new Error('the racer machine has no mount visual');
  return spec.visualKey;
})();

type Modules = {
  visual: CharacterVisual;
  another: () => CharacterVisual;
  veil: typeof import('../src/render/characters/ghost_veil');
  family: typeof import('../src/render/characters/spirit_veil_family_core');
  palettes: typeof import('../src/render/characters/spirit_veil_palette_core');
  effects: typeof import('../src/render/character_effects');
  prewarm: typeof import('../src/render/spirit_veil_prewarm');
};

async function buildKart(
  tier: 'standard' | 'low' = 'standard',
  key: string = KART,
): Promise<Modules> {
  vi.resetModules();
  vi.doMock('../src/render/assets/loader', () => ({
    loadGltf: vi.fn((url: string) => parseGlb(url)),
    loadHdr: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn(() => new Promise(() => undefined)),
    loadKtx2Texture: vi.fn(() => new Promise(() => undefined)),
    releaseGltf: vi.fn(),
  }));
  const gfx = await import('../src/render/gfx');
  if (tier === 'low') {
    restore = gfx.gfxInternalsForTest.overrideSettings(gfx.gfxInternalsForTest.settingsFor('low'));
  }
  const assets = await import('../src/render/characters/assets');
  await assets.preloadMountAssets(key);
  const { createMountVisual } = await import('../src/render/characters/index');
  const visual = createMountVisual(key);
  visual.update(FRAME, IDLE, true);
  return {
    visual,
    another: () => createMountVisual(key),
    veil: await import('../src/render/characters/ghost_veil'),
    family: await import('../src/render/characters/spirit_veil_family_core'),
    palettes: await import('../src/render/characters/spirit_veil_palette_core'),
    effects: await import('../src/render/character_effects'),
    prewarm: await import('../src/render/spirit_veil_prewarm'),
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

/** Every mesh the kart can draw: its parts and its baked far mesh, never a
 *  depth sibling (those are keyed through their body). */
function kartBodies(visual: CharacterVisual): THREE.Mesh[] {
  const priv = visual as unknown as {
    originalMaterials: Map<THREE.Mesh, unknown>;
    farMesh: THREE.Mesh | null;
  };
  const out = [...priv.originalMaterials.keys()];
  if (priv.farMesh) out.push(priv.farMesh);
  return out;
}

function farMeshOf(visual: CharacterVisual): THREE.Mesh | null {
  return (visual as unknown as { farMesh: THREE.Mesh | null }).farMesh;
}

/** The tuple keys the boot entry links: one stand-in unit per key. */
function preparedKeys(m: Modules): Set<string> {
  const host = {
    arms: {} as never,
    properties: { get: () => undefined },
    queue: { run: <T>(work: () => T | Promise<T>) => Promise.resolve().then(work) },
    link: () => Promise.resolve(),
  };
  const units = m.prewarm.spiritVeilProgramUnits(host, () => {});
  return new Set(units.map((unit) => unit.id.replace(/^spirit-veil:/, '')));
}

/** The tuple keys the veiled kart draws, and the palettes it wears. */
function drawnKeys(m: Modules): { keys: Set<string>; palettes: Set<string | null> } {
  const keys = new Set<string>();
  const palettes = new Set<string | null>();
  for (const mesh of kartBodies(m.visual)) {
    for (const material of [mesh.material].flat()) {
      palettes.add(m.veil.spiritVeilPaletteOf(material));
      for (const key of m.veil.spiritVeilKeysFor(material, mesh) ?? []) keys.add(key);
    }
  }
  return { keys, palettes };
}

function linkFamily(m: Modules): void {
  const owner = {};
  m.veil.bindSpiritVeilLedger(owner);
  for (const key of preparedKeys(m)) m.veil.noteSpiritVeilTupleLinked(key, owner);
}

function racerPalettes(m: Modules): [string, SpiritVeilPalette][] {
  const ward = m.effects.rallyVeilLook('ward');
  const ghost = m.effects.rallyVeilLook('ghost');
  if (!ward || !ghost) throw new Error('a racer veil wears no palette');
  return [
    ['ward', ward],
    ['ghost', ghost],
  ];
}

beforeAll(async () => {
  await MeshoptDecoder.ready;
}, 60_000);

describe('the racer kart wears its veil on the family the boot entry prepares', () => {
  for (const tier of ['standard', 'low'] as const) {
    it(`draws only prepared tuples for the ward and the ghost, every part and the far mesh, ${tier}`, async () => {
      const m = await buildKart(tier);
      const bodies = kartBodies(m.visual);
      // the real machine: a rigid, mapped multi-part rig with a baked far mesh
      expect(bodies.length).toBeGreaterThan(10);
      expect(farMeshOf(m.visual)).not.toBeNull();
      expect(bodies.every((mesh) => (mesh as THREE.SkinnedMesh).isSkinnedMesh !== true)).toBe(true);
      // the tier's own living set: the Low preset rebuilds every part as Lambert
      const living = bodies.flatMap((mesh) => [mesh.material].flat());
      const lambert = living.filter(
        (mat) => (mat as THREE.MeshLambertMaterial).isMeshLambertMaterial,
      );
      expect(lambert.length > 0, tier).toBe(tier === 'low');
      const prepared = preparedKeys(m);
      expect(prepared).toEqual(m.family.SPIRIT_VEIL_FAMILY_KEYS);
      linkFamily(m);
      const gateCalls: Parameters<FarBakeGate>[] = [];
      m.visual.setFarBakeGate((...args) => gateCalls.push(args));
      for (const [state, palette] of racerPalettes(m)) {
        m.visual.setGhost(true, palette);
        const { keys, palettes } = drawnKeys(m);
        // every body wears the racer palette, the far mesh included
        expect(palettes, state).toEqual(new Set([palette]));
        expect(keys.size, state).toBeGreaterThan(0);
        expect(
          [...keys].filter((key) => !prepared.has(key)),
          state,
        ).toEqual([]);
        expect([...keys].sort(), state).toEqual(['color:r+map:0', 'depth:r:0']);
        m.visual.setGhost(false);
      }
      // prepared means immediate: nothing waited on the gate
      expect(gateCalls).toHaveLength(0);
      m.veil.resetSpiritVeilLedger();
      m.visual.dispose();
    });
  }

  it('stages behind the effect gate, the kart drawing on, while the family is unlinked', async () => {
    const m = await buildKart();
    m.veil.resetSpiritVeilLedger();
    const gateCalls: Parameters<FarBakeGate>[] = [];
    m.visual.setFarBakeGate((...args) => gateCalls.push(args));
    const living = kartBodies(m.visual).map((mesh) => mesh.material);
    const ghost = m.effects.rallyVeilLook('ghost') as SpiritVeilPalette;
    m.visual.setGhost(true, ghost);
    expect(gateCalls).toHaveLength(1);
    expect(kartBodies(m.visual).map((mesh) => mesh.material)).toEqual(living);
    gateCalls[0][1]();
    m.visual.update(FRAME, IDLE, true);
    expect(drawnKeys(m).palettes).toEqual(new Set([ghost]));
    m.visual.dispose();
  });
});

describe('the racer kart keeps what its palette says', () => {
  it('drops its shadow under the ghost and gets it back when the ghost ends', async () => {
    const m = await buildKart();
    linkFamily(m);
    m.visual.setShadow(true);
    const casters = (): number =>
      kartBodies(m.visual).filter((mesh) => mesh.castShadow && mesh.visible).length;
    const living = casters();
    expect(living).toBeGreaterThan(5);
    const ghost = m.effects.rallyVeilLook('ghost') as SpiritVeilPalette;
    expect(m.palettes.SPIRIT_VEIL_POLICY[ghost].castsShadow).toBe(false);
    m.visual.setGhost(true, ghost);
    expect(casters()).toBe(0);
    m.visual.setGhost(false);
    expect(casters()).toBe(living);
    const ward = m.effects.rallyVeilLook('ward') as SpiritVeilPalette;
    m.visual.setGhost(true, ward);
    expect(casters()).toBe(m.palettes.SPIRIT_VEIL_POLICY[ward].castsShadow ? living : 0);
    m.veil.resetSpiritVeilLedger();
    m.visual.dispose();
  });
});

describe('the kart and its pilot draw as one veiled body', () => {
  it('sorts the kart in the rider unit, so every depth pre-pass draws before either body', async () => {
    const m = await buildKart();
    linkFamily(m);
    const { SPIRIT_VEIL_UNIT_KEY } = m.family;
    // Any real rig stands in for the pilot: the share is between two visuals.
    const rider = m.another();
    const unitsOf = (visual: CharacterVisual): Set<unknown> => {
      const out = new Set<unknown>();
      visual.root.traverse((object) => {
        const unit = object.userData[SPIRIT_VEIL_UNIT_KEY];
        if (unit) out.add(unit);
      });
      return out;
    };
    const racer = {
      id: 2,
      kind: 'player',
      ghost: false,
      templateId: 'player',
      auras: [{ id: 'rally_ghost', kind: 'rally_ghost' }],
    } as never;
    m.effects.syncCharacterVeils(1, racer, false, 'ghost', rider, m.visual);
    const riderUnits = unitsOf(rider);
    expect(riderUnits.size).toBe(1);
    expect(unitsOf(m.visual)).toEqual(riderUnits);
    // Its own again once the share is released, so a later rider never
    // inherits this one's unit.
    m.visual.shareVeilUnit(null);
    const own = unitsOf(m.visual);
    expect(own.size).toBe(1);
    expect([...own][0]).not.toBe([...riderUnits][0]);
    m.veil.resetSpiritVeilLedger();
    rider.dispose();
    m.visual.dispose();
  });
});

describe('an ordinary mount under the effect gate draws exactly as before', () => {
  // mount_lifecycle.ts hands EVERY mount the renderer's effect gate. A mount
  // wears a veil only under a racer, so for every other ride the gate is never
  // consulted: no material, shadow flag or node changes, under no rider state.
  const HORSE = (() => {
    const spec = mountVisualSpecFor('valorsteed', null);
    if (!spec) throw new Error('the horse has no mount visual');
    return spec.visualKey;
  })();

  it('keeps every material, shadow flag and node of a horse, under a plain or a March rider', async () => {
    const m = await buildKart('standard', HORSE);
    const snapshot = (visual: CharacterVisual) => {
      const out: string[] = [];
      visual.root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const mats = mesh.isMesh ? [mesh.material].flat().map((mat) => mat.uuid) : [];
        out.push(`${object.name}|${object.visible}|${mesh.castShadow}|${mats.join(',')}`);
      });
      return out;
    };
    // The same rig with no gate, the way every mount was built before.
    const ungated = m.another();
    ungated.setShadow(true);
    m.visual.setShadow(true);
    const before = snapshot(m.visual);
    expect(before).toEqual(snapshot(ungated));
    expect(before.length).toBeGreaterThan(3);
    const gateCalls: Parameters<FarBakeGate>[] = [];
    m.visual.setFarBakeGate((...args) => gateCalls.push(args));
    const march = { id: 'veilbound_march', kind: 'buff_speed' };
    const riders = [
      { auras: [], state: 'none' },
      { auras: [march], state: 'march' },
    ] as const;
    // A real rig stands in for the pilot.
    const pilot = m.another();
    for (const { auras, state } of riders) {
      const e = { id: 2, kind: 'player', ghost: false, templateId: 'player', auras } as never;
      for (let frame = 0; frame < 3; frame++) {
        m.effects.syncCharacterVeils(1, e, false, state, pilot, m.visual);
        m.visual.update(FRAME, IDLE, true);
        ungated.update(FRAME, IDLE, true);
      }
      expect(snapshot(m.visual), state).toEqual(before);
      expect(snapshot(m.visual), state).toEqual(snapshot(ungated));
    }
    expect(gateCalls).toHaveLength(0);
    pilot.dispose();
    ungated.dispose();
    m.visual.dispose();
  });
});
