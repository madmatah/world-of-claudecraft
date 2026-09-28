// What the race preparation compiles of the circuits
// (src/render/realm_racers_circuit_prepare.ts): the common client's
// representatives, made from the circuit records with no circuit built, cover
// every procedural program any shipped circuit draws, the per-circuit client
// builds its circuit first and gates its view only once the theme dressing has
// filled in, and the seam asks for the drawn circuit from the lobby on (and on
// a reconnect or a login at the fence), holding its reveal only under a cover. The oracle is
// three's own program cache key (tests/helpers/three_program_keys.ts); the
// dressing models are mirrored from each shipped GLB's own material slots
// (tests/helpers/gltf_material_mirror.ts).

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, desktopTierProfile, gfxProfileRestorer } from './helpers/gfx_tier';
import { mirrorGltfScene } from './helpers/gltf_material_mirror';
import { stripComments } from './helpers/strip_comments';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const loaderControl = vi.hoisted(() => ({
  deferred: false,
  pending: [] as { url: string; resolve: () => void; reject: () => void }[],
  calls: [] as string[],
}));

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
    // The low-tier water is the world's own Phong plane material.
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
    // The water normal maps resolve, so the tiers that draw the water shader do.
    loadTexture: vi.fn((url: string, opts?: Parameters<typeof actual.loadTexture>[1]) =>
      url.startsWith('/textures/water/')
        ? Promise.resolve(new THREE.Texture())
        : actual.loadTexture(url, opts),
    ),
    loadGltf: vi.fn((url: string) => {
      // Only a circuit build's own fetches are mirrored: the render stack also
      // loads character models at import, which no circuit draws.
      if (!url.startsWith('/models/')) return new Promise(() => undefined);
      loaderControl.calls.push(url);
      const gltf = () => ({ scene: mirrorGltfScene(url, 'public') });
      if (!loaderControl.deferred) return Promise.resolve(gltf());
      return new Promise((resolve, reject) => {
        loaderControl.pending.push({
          url,
          resolve: () => resolve(gltf()),
          reject: () => reject(new Error('fetch failed')),
        });
      });
    }),
  };
});

import { arrivalRevealSettleMaxMs } from '../src/game/arrival_warmup';
import {
  arrivalCoverActive,
  arrivalHeldImminentKeys,
  awaitArrivalReveals,
  resetArrivalCoverForTest,
  setArrivalCover,
} from '../src/render/arrival_cover';
import { GPU_WORK_PRIORITY } from '../src/render/background_gpu_queue';
import { GFX_TIER_RANK, type GfxSettings, type GfxTier } from '../src/render/gfx';
import { markProgramReady } from '../src/render/linked_program_readiness';
import {
  buildRealmRacersCommonRoot,
  prepareRealmRacersCircuits,
  RealmRacersCircuitPrepare,
  realmRacersCircuitClients,
} from '../src/render/realm_racers_circuit_prepare';
import { realmRacersCommonBuild } from '../src/render/realm_racers_common_pieces';
import { realmRacersFills, recordRealmRacersFill } from '../src/render/realm_racers_fills';
import {
  RealmRacersPrepare,
  type RealmRacersPrepareClient,
  type RealmRacersPrepareHost,
} from '../src/render/realm_racers_prepare';
import {
  REALM_RACERS_COMMON_PREPARE_ID,
  realmRacersCircuitPrepareId,
  realmRacersCircuitUnits,
  realmRacersRevealHeld,
} from '../src/render/realm_racers_prepare_core';
import { RealmRacersSky, type RealmRacersSkyAssets } from '../src/render/realm_racers_sky';
import type {
  RealmRacersCircuitView,
  RealmRacersTracksView,
} from '../src/render/realm_racers_track';
import { prepareWaterProfileAssets } from '../src/render/water';
import {
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_LANES,
  REALM_RACERS_LANE_DZ as REALM_RACERS_LANES_DZ_FOR_TEST,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOrigin,
} from '../src/sim/realm_racers_layout';
import type { RealmRacersLaneView } from '../src/world_api/realm_racers';

type TrackModule = typeof import('../src/render/realm_racers_track');

/** A lane the circuit stands on: its public one, else its first practice copy. */
function laneOf(circuit: RealmRacersCircuit): number {
  const lane = REALM_RACERS_LANES.find((candidate) => candidate.circuit.id === circuit.id);
  if (!lane) throw new Error(`no lane for ${circuit.id}`);
  return lane.index;
}

let track: TrackModule;

beforeAll(async () => {
  track = await import('../src/render/realm_racers_track');
  await prepareWaterProfileAssets({ standardMaterials: true } as GfxSettings);
});

afterAll(gfxProfileRestorer());

beforeEach(() => {
  resetArrivalCoverForTest();
  loaderControl.deferred = false;
  loaderControl.pending.length = 0;
  loaderControl.calls.length = 0;
  // The fetch-and-fill arm only runs where a window exists.
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flush = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

/** The keys a draw links: one, or the back and front passes of a transparent
 *  DoubleSide material. Split in half rather than on every newline: a hooked
 *  material's key carries its hook source, newlines included. */
function keysOf(object: THREE.Object3D, material: THREE.Material): string[] {
  const joined = threeProgramKeys(material, object);
  const twoPass =
    material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
  if (!twoPass) return [joined];
  const lines = joined.split('\n');
  const half = lines.length / 2;
  return [lines.slice(0, half).join('\n'), lines.slice(half).join('\n')];
}

/** What three does as it draws `root` in a frame: every visible drawable's
 *  `onAfterRender` runs (the proof a circuit's upload frame waits on). */
function renderDraws(root: THREE.Object3D): void {
  root.traverseVisible((object) => {
    const node = object as THREE.Mesh;
    if (!node.isMesh && !(object as THREE.Sprite).isSprite) return;
    node.onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
  });
}

/** Every program a draw under `root` links, split by whether its node is a
 *  theme dressing fill. */
function programSplit(root: THREE.Object3D): { procedural: Set<string>; dressing: Set<string> } {
  const procedural = new Set<string>();
  const dressing = new Set<string>();
  for (const { object, material } of drawsUnder(root)) {
    const into = object.userData.realmRacersDressing ? dressing : procedural;
    for (const key of keysOf(object, material)) into.add(key);
  }
  return { procedural, dressing };
}

function programKeys(root: THREE.Object3D): Set<string> {
  const keys = new Set<string>();
  for (const { object, material } of drawsUnder(root)) {
    for (const key of keysOf(object, material)) keys.add(key);
  }
  return keys;
}

/** A lane view of this circuit's race at `phase`, for the start lights. */
function laneMatch(circuit: RealmRacersCircuit, over: Partial<RealmRacersLaneView>) {
  return {
    circuitId: circuit.id,
    phase: 'countdown',
    countdownTicks: 60,
    elapsed: 0,
    pickupsTaken: [],
    slicks: [],
    ...over,
  } as unknown as RealmRacersLaneView;
}

/** Drive the whole tracks view on a circuit's public lane through its
 *  countdown and start, collecting what each step draws under that circuit. */
function drawnThroughStart(
  tracks: RealmRacersTracksView,
  circuit: RealmRacersCircuit,
  view: RealmRacersCircuitView,
): Set<string> {
  const origin = realmRacersLaneOrigin(laneOf(circuit));
  const steps = [
    laneMatch(circuit, { phase: 'countdown', countdownTicks: 200 }),
    laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }),
    laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }),
  ];
  const drawn = new Set<string>();
  steps.forEach((match, i) => {
    tracks.update(origin.x, origin.z, i, match);
    for (const { object, material } of drawsUnder(view.group)) {
      if (object.userData.realmRacersDressing) continue;
      for (const key of keysOf(object, material)) drawn.add(key);
    }
  });
  return drawn;
}

/** The pool with every circuit built, as races would build them, fills landed. */
async function builtTracks(): Promise<RealmRacersTracksView> {
  const tracks = track.buildRealmRacersTracks();
  for (const view of tracks.circuits) view.build().finish();
  await Promise.all(tracks.circuits.map((view) => realmRacersFills(view.group).landed()));
  return tracks;
}

/** The common client's root over `tracks`' palette, from the records alone. */
function commonRootOf(tracks: RealmRacersTracksView): THREE.Group {
  const build = realmRacersCommonBuild(REALM_RACERS_CIRCUIT_LIST, tracks.palette);
  for (const piece of build.pieces) piece.run();
  return buildRealmRacersCommonRoot([build.sampler]);
}

describe.each(Object.keys(GFX_TIER_RANK) as GfxTier[])(
  'the common client (rallyCommon) on %s',
  (tier) => {
    beforeEach(() => {
      activateTier(tier);
    });

    it('prepares every procedural program any shipped circuit draws, and leaves only dressing to the circuit', async () => {
      const tracks = await builtTracks();
      expect(tracks.circuits.map((view) => view.circuitId)).toEqual(
        REALM_RACERS_CIRCUIT_LIST.map((circuit) => circuit.id),
      );
      const common = commonRootOf(tracks);
      const prepared = programKeys(common);
      const union = new Set<string>();
      for (const [i, view] of tracks.circuits.entries()) {
        const circuit = REALM_RACERS_CIRCUIT_LIST[i];
        const split = programSplit(view.group);
        const drawn = drawnThroughStart(tracks, circuit, view);
        for (const key of split.procedural) drawn.add(key);
        expect(
          [...drawn].filter((key) => !prepared.has(key)),
          circuit.id,
        ).toEqual([]);
        for (const key of drawn) union.add(key);
        // What is left for the circuit is its dressing, and every circuit wears some.
        expect(split.dressing.size, circuit.id).toBeGreaterThan(0);
      }
      // Exactly what some circuit draws: no program is linked for nothing.
      expect(prepared).toEqual(union);
      // Blade grass grows on the Nightbloom alone and water sits on every
      // circuit: both are in the common set whatever circuit is drawn. The
      // water is the world's own low-tier plane material where the world
      // draws no water shader.
      const names = new Set(drawsUnder(common).map((draw) => draw.material.name));
      const bladeTier = desktopTierProfile(tier).settings.bladeCarpetRadius > 0;
      expect(names.has('realmRacersTrack:grass')).toBe(bladeTier);
      const shaderWater = desktopTierProfile(tier).settings.standardMaterials;
      expect(names.has('realmRacersTrack:water')).toBe(shaderWater);
      expect(names.has('water:lowTier')).toBe(!shaderWater);
      for (const name of [
        'realmRacersTrack:ground',
        'realmRacersTrack:kerb',
        'realmRacersTrack:startGrid',
        'realmRacersTrack:startLightHousing',
        'realmRacersTrack:startLightOff',
        'realmRacersTrack:flower',
        'realmRacersSlicks:oil',
        'realmRacersPickups:sparkle',
      ]) {
        expect(names.has(name), name).toBe(true);
      }
    });

    it('adds no material of its own: every proxy draws a real circuit material', async () => {
      const tracks = await builtTracks();
      const real = new Set<THREE.Material>();
      for (const view of tracks.circuits) {
        for (const { material } of drawsUnder(view.group)) real.add(material);
      }
      const common = commonRootOf(tracks);
      const proxies = drawsUnder(common);
      expect(proxies.length).toBeGreaterThan(0);
      for (const { material, object } of proxies) {
        expect(real.has(material), material.name).toBe(true);
        expect(object.userData.realmRacersDressing).toBeUndefined();
      }
      // One proxy per program key: two proxies never link the same programs.
      const perProxy = proxies.map(({ object, material }) => keysOf(object, material).join('\n'));
      expect(new Set(perProxy).size).toBe(perProxy.length);
    });

    it('keeps the drawn instanced variants (instancing, and its colour buffer on the flowers)', async () => {
      const tracks = await builtTracks();
      const common = commonRootOf(tracks);
      const variants = new Set<string>();
      common.traverse((object) => {
        const mesh = object as THREE.InstancedMesh;
        if (mesh.isInstancedMesh)
          variants.add(
            `${mesh.material && (mesh.material as THREE.Material).name}:${mesh.instanceColor ? 'ic' : 'i'}`,
          );
      });
      expect(variants.has('realmRacersTrack:flower:ic')).toBe(true);
      const bladeTier = desktopTierProfile(tier).settings.bladeCarpetRadius > 0;
      expect(variants.has('realmRacersTrack:grass:i')).toBe(bladeTier);
    });
  },
);

interface GateCall {
  target: THREE.Object3D;
  children: number;
  /** The programs under the target when the gate ran. */
  keys: Set<string>;
  resolve: () => void;
  reject: () => void;
}

function fakeGate() {
  const calls: GateCall[] = [];
  const gate = vi.fn(
    (target: THREE.Object3D) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          target,
          children: target.children.length,
          keys: programKeys(target),
          resolve,
          reject: () => reject(new Error('gate failed')),
        });
      }),
  );
  return { gate, calls };
}

function fakeSky() {
  const asked: string[] = [];
  let finish: (ok: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const ensure = (biome: string): Promise<boolean> => {
    asked.push(biome);
    return ready;
  };
  return { asked, finish, sky: { ensure } };
}

const NEVER = new Promise<void>(() => undefined);

/** A cover the test ends when it says so. */
function cover() {
  let end: () => void = () => undefined;
  const uncovered = new Promise<void>((resolve) => {
    end = resolve;
  });
  return { uncovered, end };
}

/** A circuit view over `group`, whose lane and first draw the test drives. */
function probeView(group: THREE.Group = probeGroup()) {
  let markDrawn: () => void = () => undefined;
  const drawn = new Promise<void>((resolve) => {
    markDrawn = resolve;
  });
  const lane = { on: false };
  const view: RealmRacersCircuitView = {
    circuitId: 'probe',
    group,
    skyBiome: 'vale',
    drawnOnce: () => drawn,
    onViewerLane: () => lane.on,
  };
  return { view, lane, markDrawn };
}

function probeGroup(): THREE.Group {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  return group;
}

function pendingFill(group: THREE.Object3D): () => void {
  let land: () => void = () => undefined;
  recordRealmRacersFill(
    group,
    new Promise<void>((resolve) => {
      land = resolve;
    }),
  );
  return land;
}

describe('the circuit client (rallyCircuit:<id>)', () => {
  it('gates its view once every dressing fill landed, counts each step, and waits for its first visible draw', async () => {
    loaderControl.deferred = true;
    // Fresh modules: the track keeps every model it fetched, so a build in a
    // module that already fetched them would fill nothing.
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
    const { RealmRacersCircuitPrepare: FreshClient } = await import(
      '../src/render/realm_racers_circuit_prepare'
    );
    const circuit = REALM_RACERS_CIRCUIT_LIST[0];
    const view = fresh.buildRealmRacersTrack(circuit);
    const fills = freshFills(view.group);
    expect(fills.total).toBe(loaderControl.pending.length);
    expect(fills.total).toBeGreaterThan(1);
    const sky = fakeSky();
    const client = new FreshClient(
      {
        circuitId: circuit.id,
        group: view.group,
        skyBiome: 'vale',
        drawnOnce: view.drawnOnce,
        onViewerLane: view.onViewerLane,
      },
      sky.sky,
    );
    expect(client.prepareId).toBe(realmRacersCircuitPrepareId(circuit.id));
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    const total = fills.total + 3;
    expect(client.units()).toEqual({ done: 0, total });
    const beforeFill = view.group.children.length;
    for (const [n, fill] of [...loaderControl.pending].entries()) {
      await flush();
      expect(gate).not.toHaveBeenCalled();
      fill.resolve();
      await flush();
      expect(client.units().done).toBe(n + 1);
    }
    await flush();
    expect(gate).toHaveBeenCalledTimes(1);
    expect(calls[0].target).toBe(view.group);
    expect(calls[0].children).toBeGreaterThan(beforeFill);
    let dressing = 0;
    view.group.traverse((object) => {
      if (object.userData.realmRacersDressing) dressing++;
    });
    expect(dressing).toBeGreaterThan(0);
    expect(client.revealReady()).toBe(false);
    // The viewer stands on the lane through its countdown and start: every
    // program the view draws, the lit start lights included, was under the
    // gate when it ran.
    const origin = realmRacersLaneOrigin(laneOf(circuit));
    const drawn = new Set<string>();
    const drawOn = (time: number, match: RealmRacersLaneView) => {
      view.update(origin.x, origin.z, time, match);
      for (const { object, material } of drawsUnder(view.group)) {
        if (!object.visible) continue;
        for (const key of keysOf(object, material)) drawn.add(key);
      }
    };
    drawOn(0, laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }));
    calls[0].resolve();
    await flush();
    expect(client.revealReady()).toBe(true);
    sky.finish(true);
    await flush();
    // Linked and lit, but the frame that uploads its buffers has not come.
    expect(verdict).toBeNull();
    expect(client.units()).toEqual({ done: total - 1, total });
    drawOn(1, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }));
    await flush();
    expect(verdict).toBe(true);
    expect(client.units()).toEqual({ done: total, total });
    expect(drawn.size).toBeGreaterThan(0);
    expect([...drawn].filter((key) => !calls[0].keys.has(key))).toEqual([]);
    expect(sky.asked).toEqual(['vale']);
  });

  // The whole Drakelands vocabulary: every piece its theme offers placed and
  // both of its walls run, raced from a draft lane through the same client. The
  // kit pieces are the world's env-prop templates, whose load is a fill like
  // any fetch, so the gate must wait for it and must then see them. The shipped
  // Drakelands circuit is proved on its own record in the case after it.
  it('prepares a Drakelands circuit exactly: every program it draws was under its gate, kit templates included', async () => {
    loaderControl.deferred = true;
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
    const { RealmRacersCircuitPrepare: FreshClient } = await import(
      '../src/render/realm_racers_circuit_prepare'
    );
    const env = await import('../src/render/ignivar_env_props');
    const route = await import('../src/render/realm_racers_dressing_material');
    const { CIRCUIT_THEMES } = await import('../src/render/realm_racers_themes');
    const { REALM_RACERS_PROP_VISUALS } = await import('../src/render/realm_racers_prop_visuals');
    const { REALM_RACERS_BARRIER_VISUALS } = await import(
      '../src/render/realm_racers_barrier_visuals'
    );
    const registry = await import('../src/sim/realm_racers_draft_registry');
    const layout = await import('../src/sim/realm_racers_layout');
    const theme = CIRCUIT_THEMES.drakelands;
    const circuit: RealmRacersCircuit = {
      ...REALM_RACERS_CIRCUIT_LIST[0],
      id: 'drakelands_prepare_probe',
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
    registry.putRealmRacersDraftCircuit(circuit);
    try {
      expect(env.ignivarEnvPropTemplateCount()).toBe(0);
      const view = fresh.buildRealmRacersTrack(circuit);
      const fills = freshFills(view.group);
      expect(fills.total).toBeGreaterThan(1);
      const sky = fakeSky();
      const client = new FreshClient(
        {
          circuitId: circuit.id,
          group: view.group,
          skyBiome: theme.sky.biome,
          drawnOnce: view.drawnOnce,
          onViewerLane: view.onViewerLane,
        },
        sky.sky,
      );
      const { gate, calls } = fakeGate();
      let verdict: boolean | null = null;
      void client.run(gate, NEVER).then((ok) => {
        verdict = ok;
      });
      // Land every fetch but the kit templates' files: the circuit is not
      // gated while the templates it draws are still loading.
      const kitFile = (url: string): boolean => env.ignivarEnvPropKeyOfUrl(url) !== undefined;
      const land = async (which: (url: string) => boolean): Promise<void> => {
        for (let round = 0; round < 8; round++) {
          const ready = loaderControl.pending.filter((fill) => which(fill.url));
          if (ready.length === 0) break;
          loaderControl.pending = loaderControl.pending.filter((fill) => !which(fill.url));
          for (const fill of ready) fill.resolve();
          await flush();
        }
      };
      await land((url) => !kitFile(url));
      await flush();
      expect(loaderControl.pending.some((fill) => kitFile(fill.url))).toBe(true);
      expect(gate).not.toHaveBeenCalled();
      await land(kitFile);
      await flush();
      expect(fills.done).toBe(fills.total);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(calls[0].target).toBe(view.group);
      // The kit pieces stood under the group when it was gated, and they are
      // the world's own templates: the program linked is the one the zone links.
      let kit = 0;
      for (const { object, material } of drawsUnder(view.group)) {
        if (!object.userData.realmRacersDressing) continue;
        const url = object.name.slice('realm-racers-dressing:'.length);
        if (route.realmRacersDressingRoute(url) !== 'worldKit') continue;
        const key = env.ignivarEnvPropKeyOfUrl(url);
        const template = key ? env.ignivarEnvPropTemplate(key) : null;
        expect(material, url).toBe(template?.material);
        for (const programKey of keysOf(object, material)) {
          expect(calls[0].keys.has(programKey), url).toBe(true);
        }
        kit++;
      }
      // One draw per offered kit piece and per barrier module kind, none lost.
      const expectedKit =
        theme.props.filter((asset) => REALM_RACERS_PROP_VISUALS[asset].kind === 'worldKit').length +
        theme.barriers.reduce(
          (n, kitId) => n + (REALM_RACERS_BARRIER_VISUALS[kitId].corner === 'none' ? 1 : 2),
          0,
        );
      expect(kit).toBe(expectedKit);
      // Through the countdown and the start on its own lane: every program the
      // view draws, the lit start lights included, was under the gate.
      const origin = layout.realmRacersLaneOrigin(layout.realmRacersPublicLane(circuit));
      const drawn = new Set<string>();
      const drawOn = (time: number, match: RealmRacersLaneView) => {
        view.update(origin.x, origin.z, time, match);
        for (const { object, material } of drawsUnder(view.group)) {
          if (!object.visible) continue;
          for (const key of keysOf(object, material)) drawn.add(key);
        }
      };
      drawOn(0, laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }));
      calls[0].resolve();
      sky.finish(true);
      await flush();
      drawOn(1, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }));
      await flush();
      expect(verdict).toBe(true);
      expect(sky.asked).toEqual(['ember']);
      expect(drawn.size).toBeGreaterThan(0);
      expect([...drawn].filter((key) => !calls[0].keys.has(key))).toEqual([]);
    } finally {
      registry.clearRealmRacersDraftCircuits();
    }
  });

  // The whole Palmreach vocabulary, on every tier: every piece its theme
  // offers placed and both of its rails run, raced from a draft lane through the
  // same client. The palms and the coconuts are the jungle build's own files,
  // fetched and filled like any model, so the gate must wait for them and must
  // then see them.
  it.each(Object.keys(GFX_TIER_RANK) as GfxTier[])(
    'prepares a Palmreach circuit exactly on %s: every program it draws was under its gate, the strand included',
    async (tier) => {
      loaderControl.deferred = true;
      vi.resetModules();
      const { activateTier: activateFresh } = await import('./helpers/gfx_tier');
      activateFresh(tier);
      // The fresh modules below read the tier just activated, not the suite's.
      expect((await import('../src/render/gfx')).GFX.tier).toBe(tier);
      const fresh = await import('../src/render/realm_racers_track');
      const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
      const { RealmRacersCircuitPrepare: FreshClient } = await import(
        '../src/render/realm_racers_circuit_prepare'
      );
      const route = await import('../src/render/realm_racers_dressing_material');
      const { JUNGLE_PALM_URLS, JUNGLE_PROP_URLS } = await import('../src/render/jungle_prop_urls');
      const { CIRCUIT_THEMES } = await import('../src/render/realm_racers_themes');
      const registry = await import('../src/sim/realm_racers_draft_registry');
      const layout = await import('../src/sim/realm_racers_layout');
      const theme = CIRCUIT_THEMES.palmreach;
      const circuit: RealmRacersCircuit = {
        ...REALM_RACERS_CIRCUIT_LIST[0],
        id: 'palmreach_prepare_probe',
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
      registry.putRealmRacersDraftCircuit(circuit);
      try {
        const view = fresh.buildRealmRacersTrack(circuit);
        const fills = freshFills(view.group);
        expect(fills.total).toBeGreaterThan(1);
        const sky = fakeSky();
        const client = new FreshClient(
          {
            circuitId: circuit.id,
            group: view.group,
            skyBiome: theme.sky.biome,
            drawnOnce: view.drawnOnce,
            onViewerLane: view.onViewerLane,
          },
          sky.sky,
        );
        const { gate, calls } = fakeGate();
        let verdict: boolean | null = null;
        void client.run(gate, NEVER).then((ok) => {
          verdict = ok;
        });
        // Land every fetch but the strand's: the circuit is not gated while the
        // palms and the coconuts are still loading.
        const strand = new Set<string>([...JUNGLE_PALM_URLS, JUNGLE_PROP_URLS.coconuts]);
        const land = async (which: (url: string) => boolean): Promise<void> => {
          for (let round = 0; round < 8; round++) {
            const ready = loaderControl.pending.filter((fill) => which(fill.url));
            if (ready.length === 0) break;
            loaderControl.pending = loaderControl.pending.filter((fill) => !which(fill.url));
            for (const fill of ready) fill.resolve();
            await flush();
          }
        };
        await land((url) => !strand.has(url));
        await flush();
        expect(loaderControl.pending.some((fill) => strand.has(fill.url))).toBe(true);
        expect(gate).not.toHaveBeenCalled();
        await land((url) => strand.has(url));
        await flush();
        expect(fills.done).toBe(fills.total);
        expect(gate).toHaveBeenCalledTimes(1);
        expect(calls[0].target).toBe(view.group);
        // Every strand model stood under the group when it was gated.
        const seen = new Set<string>();
        for (const { object, material } of drawsUnder(view.group)) {
          if (!object.userData.realmRacersDressing) continue;
          const url = object.name.slice('realm-racers-dressing:'.length);
          if (route.realmRacersDressingRoute(url) !== 'worldRaw') continue;
          for (const programKey of keysOf(object, material)) {
            expect(calls[0].keys.has(programKey), url).toBe(true);
          }
          seen.add(url);
        }
        expect(seen).toEqual(strand);
        // Through the countdown and the start on its own lane: every program the
        // view draws, dressing and procedural pieces alike, was under the gate.
        const origin = layout.realmRacersLaneOrigin(layout.realmRacersPublicLane(circuit));
        const drawn = new Set<string>();
        const drawOn = (time: number, match: RealmRacersLaneView) => {
          view.update(origin.x, origin.z, time, match);
          for (const { object, material } of drawsUnder(view.group)) {
            if (!object.visible) continue;
            for (const key of keysOf(object, material)) drawn.add(key);
          }
        };
        drawOn(0, laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }));
        calls[0].resolve();
        sky.finish(true);
        await flush();
        drawOn(1, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }));
        await flush();
        expect(verdict).toBe(true);
        expect(sky.asked).toEqual(['jungle']);
        expect(drawn.size).toBeGreaterThan(0);
        expect([...drawn].filter((key) => !calls[0].keys.has(key))).toEqual([]);
      } finally {
        registry.clearRealmRacersDraftCircuits();
      }
    },
  );

  it('prepares the shipped Rampart Run exactly on its public lane, kit templates included', async () => {
    loaderControl.deferred = true;
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
    const { RealmRacersCircuitPrepare: FreshClient } = await import(
      '../src/render/realm_racers_circuit_prepare'
    );
    const env = await import('../src/render/ignivar_env_props');
    const route = await import('../src/render/realm_racers_dressing_material');
    const { CIRCUIT_THEMES } = await import('../src/render/realm_racers_themes');
    const { REALM_RACERS_PROP_VISUALS } = await import('../src/render/realm_racers_prop_visuals');
    const { REALM_RACERS_BARRIER_VISUALS } = await import(
      '../src/render/realm_racers_barrier_visuals'
    );
    const records = await import('../src/sim/content/realm_racers_circuits');
    const layout = await import('../src/sim/realm_racers_layout');
    const circuit = records.realmRacersCircuitById('drakelands_rampart_run');
    if (!circuit) throw new Error('the Rampart Run ships');
    const theme = CIRCUIT_THEMES.drakelands;
    expect(env.ignivarEnvPropTemplateCount()).toBe(0);
    const view = fresh.buildRealmRacersTrack(circuit);
    const fills = freshFills(view.group);
    expect(fills.total).toBeGreaterThan(1);
    const sky = fakeSky();
    const client = new FreshClient(
      {
        circuitId: circuit.id,
        group: view.group,
        skyBiome: theme.sky.biome,
        drawnOnce: view.drawnOnce,
        onViewerLane: view.onViewerLane,
      },
      sky.sky,
    );
    expect(client.prepareId).toBe(realmRacersCircuitPrepareId('drakelands_rampart_run'));
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    for (let round = 0; round < 8 && loaderControl.pending.length > 0; round++) {
      const ready = loaderControl.pending;
      loaderControl.pending = [];
      for (const fill of ready) fill.resolve();
      await flush();
    }
    await flush();
    expect(fills.done).toBe(fills.total);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(calls[0].target).toBe(view.group);
    // Every kit url the record places or walls with stood under the group when
    // it was gated, drawn with the world's own template material.
    const expectedKit = new Set<string>();
    for (const prop of circuit.props ?? []) {
      const visual = REALM_RACERS_PROP_VISUALS[prop.asset];
      if (visual.kind === 'worldKit') expectedKit.add(visual.url);
    }
    for (const fence of circuit.fences ?? []) {
      const visual = REALM_RACERS_BARRIER_VISUALS[fence.kit];
      for (const url of [
        visual.panelUrl,
        ...(visual.corner === 'none' ? [] : [visual.corner.url]),
      ]) {
        if (route.realmRacersDressingRoute(url) === 'worldKit') expectedKit.add(url);
      }
    }
    expect(expectedKit.size).toBeGreaterThan(0);
    const kitSeen = new Set<string>();
    for (const { object, material } of drawsUnder(view.group)) {
      if (!object.userData.realmRacersDressing) continue;
      const url = object.name.slice('realm-racers-dressing:'.length);
      if (route.realmRacersDressingRoute(url) !== 'worldKit') continue;
      const key = env.ignivarEnvPropKeyOfUrl(url);
      const template = key ? env.ignivarEnvPropTemplate(key) : null;
      expect(material, url).toBe(template?.material);
      for (const programKey of keysOf(object, material)) {
        expect(calls[0].keys.has(programKey), url).toBe(true);
      }
      kitSeen.add(url);
    }
    expect(kitSeen).toEqual(expectedKit);
    // Through the countdown and the start on its public lane: every program the
    // view draws was under the gate, dressing and procedural pieces alike.
    const origin = layout.realmRacersLaneOrigin(layout.realmRacersPublicLane(circuit));
    const drawn = new Set<string>();
    const drawOn = (time: number, match: RealmRacersLaneView) => {
      view.update(origin.x, origin.z, time, match);
      for (const { object, material } of drawsUnder(view.group)) {
        if (!object.visible) continue;
        for (const key of keysOf(object, material)) drawn.add(key);
      }
    };
    drawOn(0, laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }));
    calls[0].resolve();
    sky.finish(true);
    await flush();
    drawOn(1, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }));
    await flush();
    expect(verdict).toBe(true);
    expect(sky.asked).toEqual(['ember']);
    expect(drawn.size).toBeGreaterThan(0);
    expect([...drawn].filter((key) => !calls[0].keys.has(key))).toEqual([]);
  });

  it.each(Object.keys(GFX_TIER_RANK) as GfxTier[])(
    'builds the shipped Lagoon Run in its lobby, then prepares it exactly on its public lane on %s, the strand and the sea included',
    async (tier) => {
      loaderControl.deferred = true;
      vi.resetModules();
      const { activateTier: activateFresh } = await import('./helpers/gfx_tier');
      activateFresh(tier);
      expect((await import('../src/render/gfx')).GFX.tier).toBe(tier);
      const fresh = await import('../src/render/realm_racers_track');
      const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
      const { RealmRacersCircuitPrepare: FreshClient } = await import(
        '../src/render/realm_racers_circuit_prepare'
      );
      const route = await import('../src/render/realm_racers_dressing_material');
      const { JUNGLE_PALM_URLS, JUNGLE_PROP_URLS } = await import('../src/render/jungle_prop_urls');
      const { CIRCUIT_THEMES } = await import('../src/render/realm_racers_themes');
      const records = await import('../src/sim/content/realm_racers_circuits');
      const layout = await import('../src/sim/realm_racers_layout');
      const circuit = records.realmRacersCircuitById('palmreach_lagoon_run');
      if (!circuit) throw new Error('the Lagoon Run ships');
      const theme = CIRCUIT_THEMES.palmreach;
      // The pool's own lazy view, built by its client in the lobby (a piece at
      // a time: the lobby's cover is up), then prepared.
      const tracks = fresh.buildRealmRacersTracks();
      const view = tracks.circuits.find((candidate) => candidate.circuitId === circuit.id);
      if (!view) throw new Error('the Lagoon Run has a view');
      expect(view.skyBiome).toBe(theme.sky.biome);
      expect(view.group.children).toEqual([]);
      const fills = freshFills(view.group);
      const sky = fakeSky();
      const client = new FreshClient(view, sky.sky, undefined, () => false);
      expect(client.prepareId).toBe(realmRacersCircuitPrepareId('palmreach_lagoon_run'));
      const { gate, calls } = fakeGate();
      let verdict: boolean | null = null;
      void client.run(gate, NEVER).then((ok) => {
        verdict = ok;
      });
      expect(view.built).toBe(false);
      for (let round = 0; round < 200 && !view.built; round++) await flush(1);
      expect(view.built).toBe(true);
      expect(gate).not.toHaveBeenCalled();
      expect(fills.total).toBeGreaterThan(1);
      for (let round = 0; round < 8 && loaderControl.pending.length > 0; round++) {
        const ready = loaderControl.pending;
        loaderControl.pending = [];
        for (const fill of ready) fill.resolve();
        await flush();
      }
      await flush();
      expect(fills.done).toBe(fills.total);
      expect(gate).toHaveBeenCalledTimes(1);
      expect(calls[0].target).toBe(view.group);
      // Every strand model the record places stood under the group when it was
      // gated, and so did the sea around the island.
      const strand = new Set<string>([...JUNGLE_PALM_URLS, JUNGLE_PROP_URLS.coconuts]);
      const seen = new Set<string>();
      let water = 0;
      for (const { object, material } of drawsUnder(view.group)) {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry?.getAttribute('aShoreDepth') !== undefined) {
          for (const key of keysOf(object, material)) expect(calls[0].keys.has(key)).toBe(true);
          water++;
        }
        if (!object.userData.realmRacersDressing) continue;
        const url = object.name.slice('realm-racers-dressing:'.length);
        if (route.realmRacersDressingRoute(url) !== 'worldRaw') continue;
        for (const key of keysOf(object, material)) expect(calls[0].keys.has(key), url).toBe(true);
        seen.add(url);
      }
      expect(seen).toEqual(strand);
      // Three ponds and the sea.
      expect(water).toBe(4);
      const origin = layout.realmRacersLaneOrigin(layout.realmRacersPublicLane(circuit));
      const drawn = new Set<string>();
      const drawOn = (time: number, match: RealmRacersLaneView) => {
        tracks.update(origin.x, origin.z, time, match);
        renderDraws(tracks.group);
        for (const { object, material } of drawsUnder(view.group)) {
          if (!object.visible) continue;
          for (const key of keysOf(object, material)) drawn.add(key);
        }
      };
      drawOn(0, laneMatch(circuit, { phase: 'countdown', countdownTicks: 20 }));
      calls[0].resolve();
      sky.finish(true);
      await flush();
      // The upload frame: the first frame drawn on the lane since the gate,
      // unculled, then the verdict at the update after it.
      drawOn(1, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.1 }));
      await flush();
      expect(verdict).toBeNull();
      drawOn(2, laneMatch(circuit, { phase: 'racing', countdownTicks: 0, elapsed: 0.2 }));
      await flush();
      expect(verdict).toBe(true);
      expect(sky.asked).toEqual(['jungle']);
      expect(drawn.size).toBeGreaterThan(0);
      expect([...drawn].filter((key) => !calls[0].keys.has(key))).toEqual([]);
    },
  );

  it('lands a kit fill whose template never bakes, draws the rest, and never loads the kit twice', async () => {
    loaderControl.deferred = true;
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
    const env = await import('../src/render/ignivar_env_props');
    const failing = env.IGNIVAR_ENV_PROP_URLS.dragon_statue;
    const circuit: RealmRacersCircuit = {
      ...REALM_RACERS_CIRCUIT_LIST[0],
      id: 'drakelands_missing_kit_probe',
      theme: 'drakelands',
      props: [
        { asset: 'dkDragonStatue', at: { x: -260, z: 120 }, scale: 4 },
        { asset: 'dkChurch', at: { x: -230, z: 120 }, scale: 10 },
      ],
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const view = fresh.buildRealmRacersTrack(circuit);
      const fills = freshFills(view.group);
      for (let round = 0; round < 8 && loaderControl.pending.length > 0; round++) {
        for (const fill of loaderControl.pending.splice(0)) {
          if (fill.url === failing) fill.reject();
          else fill.resolve();
        }
        await flush();
      }
      await fills.landed();
      expect(fills.done).toBe(fills.total);
      const drawn = new Set<string>();
      view.group.traverse((object) => {
        if (object.userData.realmRacersDressing) drawn.add(object.name);
      });
      expect(drawn.has(`realm-racers-dressing:${env.IGNIVAR_ENV_PROP_URLS.church}`)).toBe(true);
      expect(drawn.has(`realm-racers-dressing:${failing}`)).toBe(false);
      // The wait arm never starts a second load after the first has settled,
      // however many builds ask for the missing piece.
      const calls = loaderControl.calls.filter((url) => url === failing).length;
      fresh.buildRealmRacersTrack({ ...circuit, id: 'drakelands_missing_kit_probe_2' });
      await flush();
      expect(loaderControl.calls.filter((url) => url === failing).length).toBe(calls);
      expect(loaderControl.pending).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it('counts a model fetch that fails as landed, gates once, and settles', async () => {
    loaderControl.deferred = true;
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const { realmRacersFills: freshFills } = await import('../src/render/realm_racers_fills');
    const { RealmRacersCircuitPrepare: FreshClient } = await import(
      '../src/render/realm_racers_circuit_prepare'
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const view = fresh.buildRealmRacersTrack(REALM_RACERS_CIRCUIT_LIST[0]);
    const fills = freshFills(view.group);
    const sky = fakeSky();
    sky.finish(true);
    const client = new FreshClient(
      {
        circuitId: 'probe',
        group: view.group,
        skyBiome: 'vale',
        drawnOnce: view.drawnOnce,
        onViewerLane: view.onViewerLane,
      },
      sky.sky,
    );
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    const [first, ...rest] = loaderControl.pending;
    first.reject();
    await flush();
    expect(fills.done).toBe(1);
    expect(gate).not.toHaveBeenCalled();
    for (const fill of rest) fill.resolve();
    await flush();
    expect(fills.done).toBe(fills.total);
    expect(gate).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await flush();
    expect(verdict).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('gates again for a fill recorded while it was waiting on the first', async () => {
    const { view } = probeView();
    const landFirst = pendingFill(view.group);
    const sky = fakeSky();
    sky.finish(true);
    const client = new RealmRacersCircuitPrepare(view, sky.sky);
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    await flush();
    const landSecond = pendingFill(view.group);
    landFirst();
    await flush();
    expect(gate).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await flush();
    // The second fill has not landed: no gate may run over a group missing it.
    expect(gate).toHaveBeenCalledTimes(1);
    expect(verdict).toBeNull();
    landSecond();
    await flush();
    expect(gate).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await flush();
    expect(verdict).toBe(true);
  });

  it('still gates again after a late fill when its first gate rejected', async () => {
    const { view } = probeView();
    const sky = fakeSky();
    sky.finish(true);
    const client = new RealmRacersCircuitPrepare(view, sky.sky);
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    await flush();
    expect(gate).toHaveBeenCalledTimes(1);
    const land = pendingFill(view.group);
    calls[0].reject();
    await flush();
    expect(gate).toHaveBeenCalledTimes(1);
    land();
    await flush();
    expect(gate).toHaveBeenCalledTimes(2);
    calls[1].resolve();
    await flush();
    expect(verdict).toBe(true);
  });

  it('settles on what exists when its cover ends before a fetch lands', async () => {
    const { view, lane } = probeView();
    lane.on = true;
    pendingFill(view.group);
    const sky = fakeSky();
    const client = new RealmRacersCircuitPrepare(view, sky.sky);
    const { gate, calls } = fakeGate();
    const { uncovered, end } = cover();
    let verdict: boolean | null = null;
    void client.run(gate, uncovered).then((ok) => {
      verdict = ok;
    });
    await flush();
    expect(gate).not.toHaveBeenCalled();
    end();
    await flush();
    expect(gate).toHaveBeenCalledTimes(1);
    calls[0].resolve();
    await flush();
    // No wait on the first draw nor on a sky still fetching: a verdict now.
    expect(verdict).toBe(false);
    expect(client.revealReady()).toBe(true);
  });

  it('reads a failed sky as a failed verdict, with every step counted', async () => {
    const { view } = probeView();
    const sky = fakeSky();
    const client = new RealmRacersCircuitPrepare(view, sky.sky);
    const { gate, calls } = fakeGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    await flush();
    calls[0].resolve();
    sky.finish(false);
    await flush();
    expect(verdict).toBe(false);
    expect(client.units()).toEqual({ done: 3, total: 3 });
  });

  it('mints one client per authored circuit, and none for a draft', () => {
    const { view } = probeView();
    const clients = realmRacersCircuitClients([view], fakeSky().sky);
    const probe = clients.circuitClient('probe');
    expect(probe?.prepareId).toBe('rallyCircuit:probe');
    expect(clients.circuitClient('probe')).toBe(probe);
    expect(clients.circuitClient('draft_probe')).toBeNull();
  });
});

describe('the pure circuit steps', () => {
  it('pins the common client id and clamps a circuit client step count', () => {
    expect(REALM_RACERS_COMMON_PREPARE_ID).toBe('rallyCommon');
    expect(realmRacersCircuitPrepareId('evergarden_practice')).toBe(
      'rallyCircuit:evergarden_practice',
    );
    const out = { done: 0, total: 0 };
    expect(realmRacersCircuitUnits(out, 9, 3, true, true, true)).toEqual({ done: 6, total: 6 });
    expect(realmRacersCircuitUnits(out, -2, -1, false, false, false)).toEqual({
      done: 0,
      total: 3,
    });
    expect(realmRacersCircuitUnits(out, 1, 4, false, true, false)).toEqual({ done: 2, total: 7 });
  });
});

interface FakeHost extends RealmRacersPrepareHost {
  gate: ReturnType<typeof vi.fn>;
  release(): void;
  /** Write what a settled gate leaves behind under `root`. */
  settle(root: THREE.Object3D): void;
}

function fakeHost(withGate = true): FakeHost {
  const pending: (() => void)[] = [];
  const records = new Map<object, unknown>();
  const gate = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  );
  return {
    gate,
    worldCompileGate: () => (withGate ? gate : undefined),
    webgl: { properties: { get: (object: object) => records.get(object) } },
    release() {
      for (const resolve of pending.splice(0)) resolve();
    },
    settle(root) {
      root.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const program = { getUniforms: () => ({}), getAttributes: () => ({}) };
        markProgramReady(program);
        records.set(material, { programs: new Map([['key', program]]) });
      });
    },
  };
}

/** A circuit client that settles when the test says so. */
function stagedCircuitClient(circuitId: string, runs: string[] = []) {
  let finish: (ok?: boolean) => void = () => undefined;
  const done = new Promise<boolean>((resolve) => {
    finish = (ok = true) => resolve(ok);
  });
  const root = probeGroup();
  const staged = {
    uncovered: false,
    gates: [] as ((target: THREE.Object3D) => Promise<unknown>)[],
  };
  const client: RealmRacersPrepareClient & { runs: number } = {
    prepareId: realmRacersCircuitPrepareId(circuitId),
    built: false,
    runs: 0,
    prepare: () => root,
    units: () => ({ done: 1, total: 4 }),
    run: (gate, uncovered) => {
      client.runs++;
      runs.push(circuitId);
      staged.gates.push(gate);
      void uncovered.then(() => {
        staged.uncovered = true;
      });
      return done;
    },
  };
  return { client, finish, root, staged };
}

const CIRCUIT = REALM_RACERS_CIRCUIT_LIST[1];
const LANE = realmRacersLaneOrigin(laneOf(CIRCUIT));
const TOWN = { x: 0, z: 0 };

function loading(phase = 'loading') {
  return { queued: false, match: { practice: false, circuitId: CIRCUIT.id, phase } };
}

function seamWithCircuit() {
  const staged = stagedCircuitClient(CIRCUIT.id);
  const seam = new RealmRacersPrepare();
  seam.useCircuits({
    circuitClient: (id) => (id === CIRCUIT.id ? staged.client : null),
  });
  return { seam, ...staged };
}

describe('the seam asks for the drawn circuit', () => {
  it('adds the circuit client when the match reaches loading, and settles only with it', async () => {
    const host = fakeHost();
    const { seam, client, finish } = seamWithCircuit();
    const out = { done: 0, total: 0, settled: false };
    seam.frame(host, { queued: true, match: null }, TOWN.x, TOWN.z);
    expect(seam.reason).toBe('queue');
    expect(seam.progress(out)).toEqual({ done: 0, total: 0, settled: true });
    // The lobby reads before the renderer ran this frame: still one unit short.
    expect(seam.progress(out, CIRCUIT.id)).toEqual({ done: 0, total: 1, settled: false });
    expect(seam.progress(out, 'draft_probe')).toEqual({ done: 0, total: 0, settled: true });
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(client.runs).toBe(1);
    expect(seam.stateOf(client.prepareId)).toBe('preparing');
    expect(seam.progress(out, CIRCUIT.id)).toEqual({ done: 1, total: 4, settled: false });
    expect(seam.heldImminentKeys()).toBe(1);
    for (let i = 0; i < 5; i++) seam.frame(host, loading(), LANE.x, LANE.z);
    expect(client.runs).toBe(1);
    finish();
    await flush();
    expect(seam.stateOf(client.prepareId)).toBe('unproven');
    expect(seam.progress(out, CIRCUIT.id)).toEqual({ done: 4, total: 4, settled: true });
    expect(seam.heldImminentKeys()).toBe(0);
  });

  it('reads the verdict as the run proof AND the settle record', async () => {
    const host = fakeHost();
    const linkedButFailed = stagedCircuitClient('a');
    const linkedAndProven = stagedCircuitClient('b');
    const seam = new RealmRacersPrepare([linkedButFailed.client, linkedAndProven.client]);
    seam.frame(host, loading(), LANE.x, LANE.z);
    host.settle(linkedButFailed.root);
    host.settle(linkedAndProven.root);
    linkedButFailed.finish(false);
    linkedAndProven.finish(true);
    await flush();
    expect(seam.stateOf(linkedButFailed.client.prepareId)).toBe('unproven');
    expect(seam.stateOf(linkedAndProven.client.prepareId)).toBe('proven');
  });

  for (const [label, viewer, where] of [
    ['a mid-race reconnect (no lobby)', loading('racing'), LANE],
    ['a login at the fence (no match)', { queued: false, match: null }, LANE],
  ] as const) {
    it(`prepares the circuit on ${label} under the arrival hold`, async () => {
      const host = fakeHost();
      const { seam, client, finish } = seamWithCircuit();
      seam.frame(host, viewer, where.x, where.z);
      expect(client.runs).toBe(1);
      expect(seam.heldImminentKeys()).toBe(1);
      expect(arrivalHeldImminentKeys()).toBe(1);
      finish();
      await flush();
      expect(arrivalHeldImminentKeys()).toBe(0);
    });
  }

  it('asks a walker in the band for the lane underfoot only, and builds it at once', () => {
    const host = fakeHost();
    const runs: string[] = [];
    const staged = new Map(
      REALM_RACERS_CIRCUIT_LIST.map((circuit) => [
        circuit.id,
        stagedCircuitClient(circuit.id, runs).client,
      ]),
    );
    const seam = new RealmRacersPrepare();
    seam.useCircuits({
      circuitClient: (id) => staged.get(id) ?? null,
    });
    const walker = { queued: false, match: null };
    seam.frame(host, walker, LANE.x, LANE.z);
    expect(runs).toEqual([CIRCUIT.id]);
    // Standing on it: nothing covers a lane a walker stands on, so its build
    // runs to the end at once rather than leave a hedge undrawn.
    expect(seam.buildNow(CIRCUIT.id)).toBe(true);
    for (let i = 0; i < 3; i++) seam.frame(host, walker, LANE.x, LANE.z);
    expect(runs).toEqual([CIRCUIT.id]);
    // Between two lanes is not the band: nothing more is asked there.
    const onward = REALM_RACERS_LANES.find(
      (lane) => lane.index > laneOf(CIRCUIT) && lane.circuit.id !== CIRCUIT.id,
    );
    if (!onward) throw new Error('no lane of another circuit after the probe circuit');
    const target = realmRacersLaneOrigin(onward.index);
    const between = target.z - REALM_RACERS_LANES_DZ_FOR_TEST / 2;
    expect(realmRacersLaneAt(LANE.x, between)).toBeNull();
    seam.frame(host, walker, LANE.x, between);
    expect(runs).toEqual([CIRCUIT.id]);
    expect(seam.buildNow(CIRCUIT.id)).toBe(false);
    // Stepping onto the next circuit's lane asks it, and builds it at once.
    seam.frame(host, walker, target.x, target.z);
    expect(runs).toEqual([CIRCUIT.id, onward.circuit.id]);
    expect(seam.buildNow(onward.circuit.id)).toBe(true);
  });

  it('asks only the drawn circuit for a seated pilot', () => {
    const host = fakeHost();
    const runs: string[] = [];
    const staged = new Map(
      REALM_RACERS_CIRCUIT_LIST.map((circuit) => [
        circuit.id,
        stagedCircuitClient(circuit.id, runs).client,
      ]),
    );
    const seam = new RealmRacersPrepare();
    seam.useCircuits({
      circuitClient: (id) => staged.get(id) ?? null,
    });
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(runs).toEqual([CIRCUIT.id]);
  });

  it('holds the reveal only under a cover: its own lobby, or the arrival cover', async () => {
    const host = fakeHost();
    const { seam, client, finish } = seamWithCircuit();
    expect(seam.revealHeld(CIRCUIT.id)).toBe(false);
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(seam.stateOf(client.prepareId)).toBe('preparing');
    expect(seam.revealHeld(CIRCUIT.id)).toBe(true);
    expect(seam.revealHeld('other_circuit')).toBe(false);
    seam.frame(host, loading('racing'), LANE.x, LANE.z);
    expect(seam.revealHeld(CIRCUIT.id)).toBe(false);
    setArrivalCover(true);
    expect(seam.revealHeld(CIRCUIT.id)).toBe(true);
    finish();
    await flush();
    expect(seam.revealHeld(CIRCUIT.id)).toBe(false);
    setArrivalCover(false);
  });

  it('uncovers the circuit when the lobby curtain falls while the phase still reads loading', () => {
    const host = fakeHost();
    const { seam, staged } = seamWithCircuit();
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(seam.revealHeld(CIRCUIT.id)).toBe(true);
    // The curtain's cover depth, as the lobby painter holds it.
    setArrivalCover(true);
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(seam.revealHeld(CIRCUIT.id)).toBe(true);
    expect(staged.uncovered).toBe(false);
    // A lost connection takes the curtain down; the mirror still says loading.
    setArrivalCover(false);
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(seam.revealHeld(CIRCUIT.id)).toBe(false);
    return flush().then(() => {
      expect(staged.uncovered).toBe(true);
    });
  });

  it('lets later arrivals go when a fetch never lands and its cover lifts', async () => {
    const host = fakeHost();
    const { view, lane } = probeView();
    lane.on = true;
    pendingFill(view.group);
    const sky = fakeSky();
    sky.finish(true);
    const client = new RealmRacersCircuitPrepare(view, sky.sky);
    const seam = new RealmRacersPrepare();
    seam.useCircuits({
      circuitClient: (id) => (id === CIRCUIT.id ? client : null),
    });
    setArrivalCover(true);
    seam.frame(host, { queued: false, match: null }, LANE.x, LANE.z);
    expect(seam.heldImminentKeys()).toBe(1);
    setArrivalCover(false);
    seam.frame(host, { queued: false, match: null }, LANE.x, LANE.z);
    await flush();
    expect(host.gate).toHaveBeenCalledTimes(1);
    host.release();
    await flush();
    expect(seam.stateOf(client.prepareId)).toBe('unproven');
    expect(seam.heldImminentKeys()).toBe(0);
    setArrivalCover(true);
    expect(arrivalHeldImminentKeys()).toBe(0);
    setArrivalCover(false);
  });

  it('still runs a circuit client without a parallel compile, and builds no stand-ins', async () => {
    const host = fakeHost(false);
    const { seam, client, staged, finish } = seamWithCircuit();
    const pool = { prepareId: 'pool', built: false, prepare: vi.fn(() => probeGroup()) };
    const standIns = {
      prepareId: 'standIns',
      built: false,
      gateOnly: true,
      prepare: vi.fn(() => probeGroup()),
    };
    seam.addClient(pool);
    seam.addClient(standIns);
    seam.frame(host, loading(), LANE.x, LANE.z);
    expect(client.runs).toBe(1);
    expect(await staged.gates[0](new THREE.Group())).toBeUndefined();
    expect(pool.prepare).toHaveBeenCalledTimes(1);
    expect(standIns.prepare).not.toHaveBeenCalled();
    expect(seam.stateOf('standIns')).toBe('unproven');
    expect(seam.stateOf(client.prepareId)).toBe('preparing');
    finish();
    await flush();
    expect(seam.stateOf(client.prepareId)).toBe('unproven');
  });

  it('names the hold rule: covered and without a verdict', () => {
    expect(realmRacersRevealHeld('preparing', true)).toBe(true);
    expect(realmRacersRevealHeld('idle', true)).toBe(true);
    expect(realmRacersRevealHeld('preparing', false)).toBe(false);
    expect(realmRacersRevealHeld('proven', true)).toBe(false);
    expect(realmRacersRevealHeld('unproven', true)).toBe(false);
  });
});

describe('the tracks view consults the reveal hold on its own lane', () => {
  it('stays hidden while held and shows the moment the hold lets go', () => {
    const tracks = track.buildRealmRacersTracks();
    const index = REALM_RACERS_CIRCUIT_LIST.indexOf(CIRCUIT);
    const view = tracks.circuits[index];
    view.build().finish();
    let held = true;
    const asked: string[] = [];
    tracks.holdReveal((id) => {
      asked.push(id);
      return held;
    });
    tracks.update(LANE.x, LANE.z, 0, null);
    expect(view.group.visible).toBe(false);
    expect(view.onViewerLane()).toBe(true);
    expect(asked).toEqual([CIRCUIT.id]);
    held = false;
    tracks.update(LANE.x, LANE.z, 1, null);
    expect(view.group.visible).toBe(true);
    tracks.update(REALM_RACERS_ORIGIN.x - 10_000, 0, 2, null);
    expect(view.group.visible).toBe(false);
    expect(view.onViewerLane()).toBe(false);
  });

  it('releases the linked circuit under the curtain and settles after its first visible frame', async () => {
    const seam = new RealmRacersPrepare();
    const tracks = track.buildRealmRacersTracks();
    const sky = fakeSky();
    sky.finish(true);
    prepareRealmRacersCircuits(seam, tracks, sky.sky);
    expect(seam.stateOf(REALM_RACERS_COMMON_PREPARE_ID)).toBe('idle');
    const host = fakeHost();
    const id = realmRacersCircuitPrepareId(CIRCUIT.id);
    const view = tracks.circuits[REALM_RACERS_CIRCUIT_LIST.indexOf(CIRCUIT)];
    const frame = () => {
      seam.frame(host, loading(), LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
      renderDraws(tracks.group);
    };
    frame();
    expect(seam.stateOf(REALM_RACERS_COMMON_PREPARE_ID)).toBe('preparing');
    expect(seam.stateOf(id)).toBe('preparing');
    expect(view.group.visible).toBe(false);
    await flush();
    host.release();
    await flush();
    // Linked: the hold lets go while the client still waits for the draw.
    frame();
    expect(view.group.visible).toBe(true);
    expect(seam.stateOf(id)).toBe('preparing');
    frame();
    await flush();
    expect(seam.stateOf(id)).toBe('unproven');
    expect(seam.progress({ done: 0, total: 0, settled: false }, CIRCUIT.id).settled).toBe(true);
  });

  // A blocking arrival (a rift exit, a teleport) that lands a walker in the
  // band with no race: the whole-scene prewarm under its loading screen skips
  // the circuits (compile_exclusion.ts), so the seam alone links them. The
  // arrival raises the cover before the landing frame (arrival_warmup.ts), the
  // seam's in-flight preparation is what the curtain's wait reads, and the
  // circuit shows only once its own gate linked it.
  it('prepares the circuit before revealing it on a blocking arrival into the band, no race', async () => {
    const seam = new RealmRacersPrepare();
    const tracks = track.buildRealmRacersTracks();
    const sky = fakeSky();
    sky.finish(true);
    prepareRealmRacersCircuits(seam, tracks, sky.sky);
    const view = tracks.circuits[REALM_RACERS_CIRCUIT_LIST.indexOf(CIRCUIT)];
    const linked = new Set<THREE.Object3D>();
    const pending: (() => void)[] = [];
    const gate = vi.fn(
      (target: THREE.Object3D) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            linked.add(target);
            resolve();
          });
        }),
    );
    const host: RealmRacersPrepareHost = {
      worldCompileGate: () => gate,
      webgl: { properties: { get: () => undefined } },
    };
    const walker = { queued: false, match: null };
    let shownLinked: boolean | null = null;
    const frame = () => {
      seam.frame(host, walker, LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
      renderDraws(tracks.group);
      if (view.group.visible && shownLinked === null) shownLinked = linked.has(view.group);
    };
    const polls: (() => void)[] = [];
    let lifted = false;
    setArrivalCover(true);
    expect(arrivalCoverActive()).toBe(true);
    void awaitArrivalReveals(arrivalRevealSettleMaxMs(false), {
      now: () => 0,
      schedule: (poll) => polls.push(poll),
    }).then(() => {
      lifted = true;
    });
    const step = async () => {
      frame();
      await flush();
      for (const poll of polls.splice(0)) poll();
      await flush();
    };
    for (let i = 0; i < 4; i++) await step();
    expect(seam.reason).toBe('band');
    expect(gate).toHaveBeenCalledWith(view.group);
    expect(view.group.visible).toBe(false);
    expect(arrivalHeldImminentKeys()).toBeGreaterThan(0);
    expect(lifted).toBe(false);
    for (let i = 0; i < 12 && !lifted; i++) {
      for (const release of pending.splice(0)) release();
      await step();
    }
    // The arrival lifts once the circuit is linked and its sky ready: the
    // upload frame it still waits on needs a presented frame, which the
    // arrival's own world-draw hold would keep back.
    expect(lifted).toBe(true);
    expect(view.group.visible).toBe(false);
    await step();
    expect(shownLinked).toBe(true);
    expect(view.group.visible).toBe(true);
    setArrivalCover(false);
  });

  it('attaches a model that lands after the preparation started through the world gate', async () => {
    loaderControl.deferred = true;
    vi.resetModules();
    const fresh = await import('../src/render/realm_racers_track');
    const tracks = fresh.buildRealmRacersTracks();
    const { gate, calls } = fakeGate();
    tracks.gateFills(() => gate);
    const view = tracks.circuits[0];
    view.build().finish();
    const before = view.group.children.length;
    loaderControl.pending[0].resolve();
    await flush();
    const piece = view.group.children[before];
    expect(view.group.children.length).toBe(before + 1);
    expect(piece.name).toBe('realm-racers-dressing-fill');
    expect(piece.visible).toBe(false);
    expect(gate).toHaveBeenCalledWith(piece);
    let dressing = 0;
    piece.traverse((object) => {
      if (object.userData.realmRacersDressing) dressing++;
    });
    expect(dressing).toBeGreaterThan(0);
    calls[0].resolve();
    await flush();
    expect(piece.visible).toBe(true);
    tracks.gateFills(() => undefined);
    const plain = view.group.children.length;
    loaderControl.pending[1].resolve();
    await flush();
    expect(view.group.children.length).toBeGreaterThan(plain);
    expect(view.group.children.at(-1)?.name).not.toBe('realm-racers-dressing-fill');
  });
});

describe('the circuit sky rides the GPU work queue', () => {
  function skyHost() {
    const order: string[] = [];
    const resident = new Set<string>();
    const pins = new Map<string, number>();
    const pinnedAt = (biome: string) => pins.get(biome) ?? 0;
    const view = {
      envTexture: () => new THREE.Texture(),
      domeTexture: () => new THREE.Texture(),
      skyBiomeAssetsResident: (biome: string) => resident.has(biome),
    };
    const host = {
      sky: () => view,
      run: vi.fn(async (work: () => unknown, priority: number, label: string) => {
        order.push(`run:${label}:${priority}:pinned=${pinnedAt(label.slice(6))}`);
        return work();
      }),
      upload: vi.fn(async (_texture: THREE.Texture | null) => {
        order.push('upload');
      }),
      environment: vi.fn((biome: string): unknown => {
        order.push(`pmrem:${biome}`);
        return {};
      }),
      needsEnvironment: vi.fn(() => true),
    };
    const assets: RealmRacersSkyAssets = {
      fetch: vi.fn(async (biome: string) => {
        order.push(`fetch:${biome}:pinned=${pinnedAt(biome)}`);
        resident.add(biome);
      }),
      pin: vi.fn((biome: string) => {
        pins.set(biome, pinnedAt(biome) + 1);
        return () => {
          order.push(`unpin:${biome}`);
          pins.set(biome, pinnedAt(biome) - 1);
        };
      }),
    };
    return { host, assets, order, resident, pinnedAt };
  }

  it('pins the key, uploads the source, builds the PMREM in one queue unit, then the dome', async () => {
    const { host, assets, order, pinnedAt } = skyHost();
    const sky = new RealmRacersSky(host, assets);
    const first = sky.ensure('night');
    expect(sky.ensure('night')).toBe(first);
    expect(await first).toBe(true);
    expect(order).toEqual([
      'fetch:night:pinned=1',
      'upload',
      `run:pmrem:night:${GPU_WORK_PRIORITY.VISIBLE_PREWARM}:pinned=1`,
      'pmrem:night',
      'upload',
      'unpin:night',
    ]);
    expect(pinnedAt('night')).toBe(0);
    expect(host.environment).toHaveBeenCalledTimes(1);
    expect(sky.ensure('night')).toBe(first);
  });

  it('prepares an evicted key again on the next ask', async () => {
    const { host, assets, resident } = skyHost();
    const sky = new RealmRacersSky(host, assets);
    expect(await sky.ensure('jungle')).toBe(true);
    resident.delete('jungle');
    const again = sky.ensure('jungle');
    expect(await again).toBe(true);
    expect(assets.fetch).toHaveBeenCalledTimes(2);
    expect(host.run).toHaveBeenCalledTimes(2);
    expect(host.environment).toHaveBeenCalledTimes(2);
    expect(sky.ensure('jungle')).toBe(again);
  });

  it('fails on a missing environment only where the tier builds one', async () => {
    const needs = skyHost();
    needs.host.environment.mockReturnValue(null);
    expect(await new RealmRacersSky(needs.host, needs.assets).ensure('amber')).toBe(false);
    const skips = skyHost();
    skips.host.environment.mockReturnValue(null);
    skips.host.needsEnvironment.mockReturnValue(false);
    expect(await new RealmRacersSky(skips.host, skips.assets).ensure('amber')).toBe(true);
  });

  for (const [label, arrange] of [
    ['its fetch', (h: ReturnType<typeof skyHost>) => h.assets.fetch as ReturnType<typeof vi.fn>],
    ['its PMREM unit', (h: ReturnType<typeof skyHost>) => h.host.run],
    ['its dome upload', (h: ReturnType<typeof skyHost>) => h.host.upload],
  ] as const) {
    it(`reports a sky whose ${label} rejects as failed once, unpinned, never asked again`, async () => {
      const h = skyHost();
      const step = arrange(h);
      if (step === h.host.upload) {
        h.host.upload.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('upload'));
      } else {
        step.mockRejectedValueOnce(new Error('step'));
      }
      const sky = new RealmRacersSky(h.host, h.assets);
      expect(await sky.ensure('marsh')).toBe(false);
      expect(await sky.ensure('marsh')).toBe(false);
      expect(h.assets.fetch).toHaveBeenCalledTimes(1);
      expect(h.pinnedAt('marsh')).toBe(0);
    });
  }

  it('is the renderer path: no bare PMREM continuation left on the renderer', () => {
    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    // The sky is the rally scene's, built over the renderer's own lanes (the
    // renderer passes itself as the scene's host).
    const scene = stripComments(
      readFileSync(new URL('../src/render/realm_racers_scene.ts', import.meta.url), 'utf8'),
    );
    const count = (text: string, needle: string) => text.split(needle).length - 1;
    expect(count(renderer, 'ensureRealmRacersSky')).toBe(0);
    expect(count(renderer, 'new RealmRacersSky(')).toBe(0);
    expect(count(renderer, 'readonly realmRacers = new RealmRacersScene(this);')).toBe(1);
    expect(count(scene, 'new RealmRacersSky({')).toBe(1);
    expect(scene).toMatch(
      /new RealmRacersSky\(\{\s*sky: \(\) => h\.skyView,\s*run: \(work, priority, label\) => h\.backgroundGpuWork\.run\(work, priority, label\),\s*upload: \(texture\) => h\.prewarmTextureInIdle\(texture\),\s*environment: \(biome\) => h\.ensureEnvironmentBiome\(biome\),\s*needsEnvironment: \(\) => !h\.lowGfx && !\(GFX\.constrainedMemory && h\.envRTs\.size > 0\),\s*\}\);/,
    );
    // The band asks for its theme's sky from the ambience pass, once a frame.
    expect(count(scene, 'if (out.theme) void this.sky.ensure(out.theme.sky.biome);')).toBe(1);
    expect(count(renderer, 'this.realmRacers.ambienceAt(px, pz, this.sim.player.pos.x);')).toBe(1);
    const skySource = stripComments(
      readFileSync(new URL('../src/render/realm_racers_sky.ts', import.meta.url), 'utf8'),
    );
    expect(skySource.split('host.environment(').length - 1).toBe(1);
    expect(skySource).toMatch(/host\.run\(\s*\(\) => \{[^}]*host\.environment\(biome\)/);
  });
});
