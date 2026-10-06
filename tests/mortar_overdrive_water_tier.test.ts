// The Mortar Overdrive water honours the world's water tier gate (`usesShaderWater` in
// src/render/water.ts): where the world lays its Phong plane, a circuit's
// ponds and sea wear that very material, and where the world draws the water
// shader, the circuit's surface links the world's shader program. The oracle is
// three's own program cache key (tests/helpers/three_program_keys.ts) plus
// `materialProgramSignature`, taken on the world's own `buildWater` view.

import * as THREE from 'three';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const waterMaps = vi.hoisted(() => ({ ready: false }));

vi.mock('../src/render/textures', () => {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  return {
    mortarOverdriveKerbTexture: vi.fn(texture),
    mortarOverdriveGroundBlastMarkerTexture: vi.fn(texture),
    mortarOverdriveStartGridTexture: vi.fn(texture),
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

vi.mock('../src/render/assets/loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/assets/loader')>();
  return {
    ...actual,
    loadGltf: vi.fn(() => new Promise(() => undefined)),
    loadTexture: vi.fn((url: string, opts?: Parameters<typeof actual.loadTexture>[1]) => {
      if (!url.startsWith('/textures/water/')) return actual.loadTexture(url, opts);
      return waterMaps.ready
        ? Promise.resolve(new THREE.Texture())
        : Promise.reject(new Error('water normal map missing'));
    }),
  };
});

import type { GfxSettings, GfxTier } from '../src/render/gfx';
import { buildMortarOverdriveTrack } from '../src/render/mortar_overdrive/track';
import { materialProgramSignature } from '../src/render/prewarm_policy';
import {
  buildWater,
  hasWaterShaderAssets,
  lowTierWaterMaterial,
  prepareWaterProfileAssets,
  usesShaderWater,
} from '../src/render/water';
import { MORTAR_OVERDRIVE_CIRCUIT_LIST } from '../src/sim/content/mortar_overdrive/circuits';

afterAll(gfxProfileRestorer());

const TIERS: readonly GfxTier[] = ['low', 'medium', 'ultra'];

/** The water sheets of a draw root: the only surfaces carrying a shore depth. */
function waterDraws(root: THREE.Object3D) {
  return drawsUnder(root).filter(
    ({ object }) => (object as THREE.Mesh).geometry?.getAttribute('aShoreDepth') !== undefined,
  );
}

/** The world water's program keys and signatures for the active tier. */
function worldWater(): { keys: Set<string>; signatures: Set<string> } {
  const view = buildWater(20061);
  const draws = drawsUnder(view.group);
  expect(draws.length).toBeGreaterThan(0);
  return {
    keys: new Set(draws.map(({ object, material }) => threeProgramKeys(material, object))),
    signatures: new Set(draws.map(({ material }) => materialProgramSignature(material))),
  };
}

/** Every Mortar Overdrive water draw on every shipped circuit links a world water program. */
function expectMortarOverdriveWaterIsWorldWater(): void {
  const world = worldWater();
  let sheets = 0;
  for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
    for (const { object, material } of waterDraws(buildMortarOverdriveTrack(circuit).group)) {
      sheets++;
      expect(world.keys.has(threeProgramKeys(material, object)), circuit.id).toBe(true);
      expect(world.signatures.has(materialProgramSignature(material)), circuit.id).toBe(true);
    }
  }
  expect(sheets).toBeGreaterThan(0);
}

describe('the Mortar Overdrive water on the world water tier', () => {
  beforeEach(() => {
    waterMaps.ready = false;
  });

  it.each(TIERS)(
    'wears the world low-tier plane material while the water maps are missing (%s)',
    (tier) => {
      activateTier(tier);
      expect(hasWaterShaderAssets()).toBe(false);
      expect(usesShaderWater()).toBe(false);
      expectMortarOverdriveWaterIsWorldWater();
      for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
        for (const { object, material } of waterDraws(buildMortarOverdriveTrack(circuit).group)) {
          expect(material).toBe(lowTierWaterMaterial());
          // The plane's texel density, laid off the band origin.
          expect((object as THREE.Mesh).geometry.getAttribute('uv')).toBeDefined();
        }
      }
    },
  );

  it('links the world water program on every tier once the maps land', async () => {
    waterMaps.ready = true;
    await prepareWaterProfileAssets({ standardMaterials: true } as GfxSettings);
    expect(hasWaterShaderAssets()).toBe(true);
    for (const tier of TIERS) {
      activateTier(tier);
      const shader = tier !== 'low';
      expect(usesShaderWater(), tier).toBe(shader);
      expectMortarOverdriveWaterIsWorldWater();
      const [sheet] = waterDraws(buildMortarOverdriveTrack(MORTAR_OVERDRIVE_CIRCUIT_LIST[0]).group);
      expect(sheet.material.name, tier).toBe(
        shader ? 'mortarOverdriveTrack:water' : 'water:lowTier',
      );
      expect(sheet.material.type, tier).toBe(shader ? 'ShaderMaterial' : 'MeshPhongMaterial');
    }
  });
});
