// A circuit's build as pieces (src/render/mortar_overdrive/track.ts
// `mortarOverdriveTrackBuild`): stepped one piece at a time it comes out exactly
// as the one-shot build does, the flower field walked in bands equals the
// one-shot walk, the pieces share one ground material through the renderer's
// palette (mortar_overdrive/track_palette.ts), and a build paints nothing from the
// shared texture random sequence, so when a circuit is built never shifts a
// texture painted after it.

import * as THREE from 'three';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { threeProgramKeys } from './helpers/three_program_keys';

afterAll(gfxProfileRestorer());

type Drawable = THREE.Object3D & {
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  isSprite?: boolean;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
  count?: number;
  instanceMatrix?: THREE.InstancedBufferAttribute;
  instanceColor?: THREE.InstancedBufferAttribute | null;
};

function arrayOf(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null) {
  return attribute ? Array.from(attribute.array as ArrayLike<number>) : null;
}

/** Everything a draw of `root` depends on, node by node in traversal order. */
function fingerprint(root: THREE.Object3D) {
  const out: unknown[] = [];
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    const node = object as Drawable;
    const entry: Record<string, unknown> = {
      type: node.type,
      name: node.name,
      visible: node.visible,
      matrix: Array.from(node.matrixWorld.elements),
      castShadow: node.castShadow,
      receiveShadow: node.receiveShadow,
    };
    if (node.geometry) {
      const attributes: Record<string, unknown> = {};
      for (const [name, attribute] of Object.entries(node.geometry.attributes)) {
        attributes[name] = arrayOf(attribute);
      }
      entry.attributes = attributes;
      entry.index = arrayOf(node.geometry.index);
    }
    if (node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      entry.materials = materials.map((material) => ({
        name: material.name,
        key: threeProgramKeys(material, node),
      }));
    }
    if (node.isInstancedMesh) {
      entry.count = node.count;
      entry.instanceMatrix = arrayOf(node.instanceMatrix ?? null);
      entry.instanceColor = arrayOf(node.instanceColor ?? null);
    }
    out.push(entry);
  });
  return out;
}

/** Every numeric argument of every draw call a canvas painter made: a
 *  fingerprint of the random draws a paint took, without a real canvas. */
let log: number[] = [];

function recordingContext() {
  const record = (args: unknown[]) => {
    for (const arg of args) if (typeof arg === 'number') log.push(arg);
  };
  const gradient = { addColorStop: (...args: unknown[]) => record(args) };
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'createImageData') {
          return (w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
          });
        }
        if (prop === 'getImageData') {
          return (_x: number, _y: number, w: number, h: number) => ({
            data: new Uint8ClampedArray(Math.max(1, w * h) * 4),
          });
        }
        if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
          return (...args: unknown[]) => {
            record(args);
            return gradient;
          };
        }
        return (...args: unknown[]) => record(args);
      },
      set() {
        return true;
      },
    },
  );
}

function stubCanvas(): void {
  vi.stubGlobal('document', {
    createElement: () => ({ width: 1, height: 1, getContext: () => recordingContext() }),
  });
}

describe('a circuit built in pieces', () => {
  beforeEach(() => {
    vi.resetModules();
    const texture = (): THREE.DataTexture => {
      const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
      tex.needsUpdate = true;
      return tex;
    };
    vi.doMock('../src/render/textures', () => ({
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
    }));
  });

  afterEach(() => {
    vi.doUnmock('../src/render/textures');
  });

  for (const tier of ['low', 'high'] as const) {
    it(`comes out exactly as the one-shot build, piece by piece, on ${tier}`, async () => {
      activateTier(tier);
      const track = await import('../src/render/mortar_overdrive/track');
      const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
        '../src/sim/content/mortar_overdrive/circuits'
      );
      for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
        const oneShot = track.buildMortarOverdriveTrack(circuit);
        const job = track.mortarOverdriveTrackBuild(circuit);
        expect(job.finished, circuit.id).toBe(false);
        expect(job.group.children, circuit.id).toEqual([]);
        const kinds: string[] = [];
        let steps = 0;
        while (!job.finished) {
          const before = job.done;
          kinds.push(job.nextKind ?? 'none');
          job.step();
          steps++;
          expect(job.done, circuit.id).toBe(before + 1);
          expect(job.total, circuit.id).toBeGreaterThanOrEqual(job.done);
        }
        expect(job.nextKind).toBeNull();
        expect(steps, circuit.id).toBe(job.total);
        // The field and the grass were planned as bands, not one piece each.
        expect(kinds.filter((kind) => kind === 'flowers').length, circuit.id).toBeGreaterThan(2);
        const view = job.finish();
        expect(view.group).toBe(job.group);
        expect(fingerprint(job.group), circuit.id).toEqual(fingerprint(oneShot.group));
      }
    });
  }

  it('builds into the group it is handed, hidden, and only when stepped', async () => {
    activateTier('high');
    const track = await import('../src/render/mortar_overdrive/track');
    const { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT } = await import(
      '../src/sim/content/mortar_overdrive/circuits'
    );
    const group = new THREE.Group();
    const job = track.mortarOverdriveTrackBuild(
      MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
      undefined,
      undefined,
      group,
    );
    expect(job.group).toBe(group);
    expect(group.children).toEqual([]);
    expect(group.visible).toBe(false);
    job.finish();
    expect(group.children.length).toBeGreaterThan(0);
    expect(group.visible).toBe(false);
    // Finishing twice is the same view, and a step past the end is a no-op.
    const count = group.children.length;
    job.step();
    job.finish();
    expect(group.children.length).toBe(count);
  });

  it('shares one ground material, one set of start-light lenses and a card per palette across circuits', async () => {
    activateTier('high');
    const track = await import('../src/render/mortar_overdrive/track');
    const { createMortarOverdriveTrackPalette } = await import(
      '../src/render/mortar_overdrive/track_palette'
    );
    const { mortarOverdriveTheme } = await import('../src/render/mortar_overdrive/themes');
    const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
      '../src/sim/content/mortar_overdrive/circuits'
    );
    const palette = createMortarOverdriveTrackPalette();
    const byName = new Map<string, Set<THREE.Material>>();
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      const view = track.buildMortarOverdriveTrack(circuit, undefined, palette);
      view.group.traverse((object) => {
        const material = (object as Drawable).material;
        if (!material || Array.isArray(material)) return;
        const set = byName.get(material.name) ?? new Set<THREE.Material>();
        set.add(material);
        byName.set(material.name, set);
      });
    }
    expect(byName.get('mortarOverdriveTrack:ground')?.size).toBe(1);
    expect(byName.get('mortarOverdriveTrack:ground')).toEqual(new Set([palette.ground()]));
    expect(byName.get('mortarOverdriveTrack:startLightOff')).toEqual(
      new Set([palette.startLights().off]),
    );
    const cards = new Set(
      MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) =>
        JSON.stringify(mortarOverdriveTheme(circuit).flowers.card),
      ),
    );
    expect(byName.get('mortarOverdriveTrack:flower')?.size).toBe(cards.size);
  });
});

describe('the ground material without the legacy splat draws', () => {
  it('is the same program, and paints no legacy splat canvas', async () => {
    vi.resetModules();
    stubCanvas();
    const texture = (): THREE.DataTexture => new THREE.DataTexture(new Uint8Array(4), 1, 1);
    const groundSplatMaps = vi.fn(() => ({
      grass: { map: texture(), normalMap: texture() },
      dirt: { map: texture(), normalMap: texture() },
      rock: { map: texture(), normalMap: texture() },
      sand: { map: texture(), normalMap: texture() },
    }));
    vi.doMock('../src/render/textures', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/render/textures')>()),
      groundSplatMaps,
      macroNoiseTexture: vi.fn(texture),
    }));
    try {
      activateTier('high');
      const terrain = await import('../src/render/terrain');
      const { flatNormalTexture } = await import('../src/render/ground_material');
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
      const origin = { x: 113_700, z: 0 };
      const legacy = terrain.buildSplatMaterial(
        flatNormalTexture(),
        terrain.makeBrushUniforms(),
        origin,
      );
      expect(groundSplatMaps).toHaveBeenCalledTimes(1);
      const skipped = terrain.buildSplatMaterial(
        flatNormalTexture(),
        terrain.makeBrushUniforms(),
        origin,
        false,
      );
      expect(groundSplatMaps).toHaveBeenCalledTimes(1);
      expect(threeProgramKeys(skipped, mesh)).toBe(threeProgramKeys(legacy, mesh));
    } finally {
      vi.doUnmock('../src/render/textures');
      vi.unstubAllGlobals();
    }
  });
});

describe('the flower field walked in bands', () => {
  it('equals the one-shot walk on every authored circuit and density', async () => {
    const core = await import('../src/render/mortar_overdrive/track_core');
    const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
      '../src/sim/content/mortar_overdrive/circuits'
    );
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      for (const density of [1, 0.45]) {
        const walk = core.mortarOverdriveFlowerFieldWalk(circuit, density);
        expect(walk.rowsPerPiece).toBeGreaterThan(0);
        let bands = 0;
        while (walk.rowsDone < walk.rows) {
          walk.walkRows(walk.rowsPerPiece);
          bands++;
        }
        expect(bands).toBe(Math.ceil(walk.rows / walk.rowsPerPiece));
        expect(walk.spots, `${circuit.id} at ${density}`).toEqual(
          core.mortarOverdriveFlowerSpots(circuit, density),
        );
      }
    }
  });

  it('sizes a band in candidate projections, not in time', async () => {
    const core = await import('../src/render/mortar_overdrive/track_core');
    const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
      '../src/sim/content/mortar_overdrive/circuits'
    );
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      const walk = core.mortarOverdriveFlowerFieldWalk(circuit);
      const perRow = Math.floor((circuit.perimeter.halfX * 2) / 11) * 9;
      expect(walk.rowsPerPiece * perRow, circuit.id).toBeLessThanOrEqual(
        Math.max(perRow, core.MORTAR_OVERDRIVE_FLOWER_CANDIDATES_PER_PIECE),
      );
    }
  });
});

describe('a circuit build and the shared texture random sequence', () => {
  beforeEach(() => {
    vi.resetModules();
    stubCanvas();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const painted = (paint: () => unknown): number[] => {
    log = [];
    paint();
    const drawn = log;
    log = [];
    return drawn;
  };

  for (const tier of ['low', 'high'] as const) {
    it(`draws nothing from it, on ${tier}`, async () => {
      activateTier(tier);
      const control = await import('../src/render/textures');
      const first = painted(() => control.macroNoiseTexture());
      const second = painted(() => control.macroNoiseTexture());

      vi.resetModules();
      const textures = await import('../src/render/textures');
      const track = await import('../src/render/mortar_overdrive/track');
      const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
        '../src/sim/content/mortar_overdrive/circuits'
      );
      expect(painted(() => textures.macroNoiseTexture())).toEqual(first);
      // A whole pool of circuits, ground material and flower cards included.
      const drawnByBuilds = painted(() => {
        for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST)
          track.buildMortarOverdriveTrack(circuit);
      });
      expect(drawnByBuilds.length).toBeGreaterThan(0);
      expect(painted(() => textures.macroNoiseTexture())).toEqual(second);
    });

    it(`draws nothing from it when the race preparation makes its representatives, on ${tier}`, async () => {
      activateTier(tier);
      const control = await import('../src/render/textures');
      const first = painted(() => control.macroNoiseTexture());
      const second = painted(() => control.macroNoiseTexture());

      vi.resetModules();
      const textures = await import('../src/render/textures');
      const { MortarOverdriveCommonPrepare } = await import(
        '../src/render/mortar_overdrive/circuit_prepare'
      );
      const { mortarOverdriveCommonBuild } = await import(
        '../src/render/mortar_overdrive/common_pieces'
      );
      const { createMortarOverdriveTrackPalette } = await import(
        '../src/render/mortar_overdrive/track_palette'
      );
      const { MORTAR_OVERDRIVE_CIRCUIT_LIST } = await import(
        '../src/sim/content/mortar_overdrive/circuits'
      );
      expect(painted(() => textures.macroNoiseTexture())).toEqual(first);
      // The queue join's representatives, on a fresh palette: its ground
      // material, a flower card, the pickups' sparkle, the lamps' glow.
      const palette = createMortarOverdriveTrackPalette();
      const client = new MortarOverdriveCommonPrepare(() =>
        mortarOverdriveCommonBuild(MORTAR_OVERDRIVE_CIRCUIT_LIST, palette),
      );
      log = [];
      expect(await client.run(() => Promise.resolve())).toBe(true);
      expect(log.length).toBeGreaterThan(0);
      expect(client.prepare().children.length).toBeGreaterThan(0);
      expect(painted(() => textures.macroNoiseTexture())).toEqual(second);
    });
  }
});
