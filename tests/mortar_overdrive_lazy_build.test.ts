// A circuit is built when a pilot commits to it, never at boot
// (src/render/mortar_overdrive/track.ts `buildMortarOverdriveTracks`), and building it
// is the FIRST step of its race preparation client
// (src/render/mortar_overdrive/circuit_prepare.ts `MortarOverdriveCircuitPrepare`):
//
//  - in the viewer's own race lobby, while its curtain covers the world, the
//    build is a piece per GPU-queue unit with a task turn between two, so the
//    lobby paints between them; the gate runs over what the build made;
//  - everywhere else (a login, a reconnect or a graphics rebuild mid-race, a
//    lobby whose curtain fell, a walker standing on the lane) it runs to the
//    end at once, inside the seam's first frame for a pilot already racing;
//  - a queue shut down under a renderer teardown stops it, and a given-back
//    pool never finishes a build;
//  - the circuit's upload frame draws every mesh unculled and casting no
//    shadow once, then gives each mesh its own flags back;
//  - the common client's representatives (`mortarOverdriveCommon`) are built in queue
//    pieces from the records, and never register a light.

import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { mirrorGltfScene } from './helpers/gltf_material_mirror';
import { drawsUnder } from './helpers/three_program_keys';

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
    radialGlowTexture: vi.fn(texture),
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
  loadGltf: vi.fn((url: string) => {
    if (!url.startsWith('/models/')) return new Promise(() => undefined);
    return Promise.resolve({ scene: mirrorGltfScene(url, 'public') });
  }),
}));

// A build piece that throws: the pickup boxes, on demand.
const pickupControl = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/render/mortar_overdrive/pickups', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/mortar_overdrive/pickups')>();
  return {
    ...actual,
    buildMortarOverdrivePickups: (
      circuit: Parameters<typeof actual.buildMortarOverdrivePickups>[0],
    ) => {
      if (pickupControl.fail) throw new Error('pickups failed');
      return actual.buildMortarOverdrivePickups(circuit);
    },
  };
});

// A build piece that throws: the start arch, on demand. Only the track's import
// is replaced; the start lights' own placement reads the core's real one.
const archControl = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/render/mortar_overdrive/track_core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/mortar_overdrive/track_core')>();
  return {
    ...actual,
    mortarOverdriveStartArchPlacement: (
      circuit: Parameters<typeof actual.mortarOverdriveStartArchPlacement>[0],
    ) => {
      if (archControl.fail) throw new Error('arch failed');
      return actual.mortarOverdriveStartArchPlacement(circuit);
    },
  };
});

// A representative must never register a light site.
vi.mock('../src/render/night_light_field', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/render/night_light_field')>();
  return { ...actual, registerStaticNightLights: vi.fn(actual.registerStaticNightLights) };
});

import { resetArrivalCoverForTest, setArrivalCover } from '../src/render/arrival_cover';
import {
  GPU_QUEUE_SHUTDOWN_ERROR_NAME,
  GPU_WORK_PRIORITY,
} from '../src/render/background_gpu_queue';
import { gpuPrepKindOfLabel } from '../src/render/gpu_prep_budget_core';
import {
  type MortarOverdriveBuildHost,
  MortarOverdriveCircuitPrepare,
  MortarOverdriveCommonPrepare,
  prepareMortarOverdriveCircuits,
} from '../src/render/mortar_overdrive/circuit_prepare';
import { mortarOverdriveCommonBuild } from '../src/render/mortar_overdrive/common_pieces';
import { mortarOverdriveFills } from '../src/render/mortar_overdrive/fills';
import { mortarOverdriveGrassPieces } from '../src/render/mortar_overdrive/grass_core';
import {
  MortarOverdrivePrepare,
  type MortarOverdrivePrepareHost,
} from '../src/render/mortar_overdrive/prepare';
import {
  addMortarOverdriveBuildUnits,
  MORTAR_OVERDRIVE_COMMON_PREPARE_ID,
  mortarOverdriveBuildNow,
  mortarOverdriveCircuitPrepareId,
} from '../src/render/mortar_overdrive/prepare_core';
import {
  prepareUploadFrame,
  restoreAfterUploadFrame,
} from '../src/render/mortar_overdrive/upload_frame_core';
import { registerStaticNightLights } from '../src/render/night_light_field';
import { MORTAR_OVERDRIVE_CIRCUIT_LIST } from '../src/sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneOrigin,
} from '../src/sim/mortar_overdrive/layout';

type TrackModule = typeof import('../src/render/mortar_overdrive/track');
let track: TrackModule;

beforeAll(async () => {
  track = await import('../src/render/mortar_overdrive/track');
});

afterAll(gfxProfileRestorer());

beforeEach(() => {
  pickupControl.fail = false;
  archControl.fail = false;
  activateTier('high');
  resetArrivalCoverForTest();
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetArrivalCoverForTest();
});

const flush = async (rounds = 4) => {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const NEVER = new Promise<void>(() => undefined);

const CIRCUIT = MORTAR_OVERDRIVE_CIRCUIT_LIST[1];
const LANE = (() => {
  const lane = MORTAR_OVERDRIVE_LANES.find((candidate) => candidate.circuit.id === CIRCUIT.id);
  if (!lane) throw new Error(`no lane for ${CIRCUIT.id}`);
  return mortarOverdriveLaneOrigin(lane.index);
})();

interface QueuedUnit {
  label: string;
  priority: number;
  work: () => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

/** A build host whose queue runs a unit only when the test drains it. */
function manualHost() {
  const queued: QueuedUnit[] = [];
  const labels: string[] = [];
  const records: string[] = [];
  let yields = 0;
  let clock = 0;
  const host: MortarOverdriveBuildHost = {
    run: (work, priority, label) =>
      new Promise((resolve, reject) => {
        labels.push(label);
        queued.push({ label, priority, work, resolve, reject });
      }),
    yieldTask: () => {
      yields++;
      return Promise.resolve();
    },
    record: (kind) => {
      records.push(kind);
    },
    now: () => clock++,
  };
  const drainOne = async (): Promise<boolean> => {
    const unit = queued.shift();
    if (!unit) return false;
    try {
      unit.resolve(unit.work());
    } catch (error) {
      unit.reject(error);
    }
    await flush(2);
    return true;
  };
  return {
    host,
    queued,
    labels,
    records,
    yields: () => yields,
    drainOne,
    async drain(filter = (_unit: QueuedUnit) => true) {
      for (;;) {
        const index = queued.findIndex(filter);
        if (index < 0) return;
        queued.unshift(...queued.splice(index, 1));
        await drainOne();
      }
    },
    shutdown() {
      for (const unit of queued.splice(0)) {
        const error = new Error('queue shut down');
        error.name = GPU_QUEUE_SHUTDOWN_ERROR_NAME;
        unit.reject(error);
      }
    },
  };
}

function fakeSky() {
  return { ensure: vi.fn(() => Promise.resolve(true)) };
}

function immediateGate() {
  const calls: { target: THREE.Object3D; children: number }[] = [];
  const gate = vi.fn((target: THREE.Object3D) => {
    calls.push({ target, children: target.children.length });
    return Promise.resolve();
  });
  return { gate, calls };
}

function seamHost(withGate = true): MortarOverdrivePrepareHost {
  return {
    worldCompileGate: () => (withGate ? () => Promise.resolve() : undefined),
    webgl: { properties: { get: () => undefined } },
  };
}

function viewOf(tracks: ReturnType<TrackModule['buildMortarOverdriveTracks']>) {
  const view = tracks.circuits.find((candidate) => candidate.circuitId === CIRCUIT.id);
  if (!view) throw new Error(`no view for ${CIRCUIT.id}`);
  return view;
}

const lobby = (phase = 'loading') => ({
  queued: false,
  match: { practice: false, circuitId: CIRCUIT.id, phase },
});

describe('the circuit client builds its circuit first', () => {
  it('builds a piece per queue unit with a task turn between two, then gates what it built', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    const q = manualHost();
    const client = new MortarOverdriveCircuitPrepare(view, fakeSky(), q.host, () => false);
    const { gate, calls } = immediateGate();
    expect(client.prepareId).toBe(mortarOverdriveCircuitPrepareId(CIRCUIT.id));
    // Nothing exists before the client runs, and the root it hands the seam is
    // the group the build fills.
    expect(client.prepare()).toBe(view.group);
    expect(view.group.children).toEqual([]);
    expect(view.built).toBe(false);
    // A build not started yet is one piece of the bar.
    expect(client.units()).toEqual({ done: 0, total: 1 + 3 });
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    await flush();
    let pieces = 0;
    while (q.queued.length > 0) {
      // One unit in flight at a time, each the next piece, at the live-view
      // priority, one label kind for the whole build (the text before the
      // first colon is what the admission budget prices).
      expect(q.queued).toHaveLength(1);
      expect(q.queued[0].priority).toBe(GPU_WORK_PRIORITY.LIVE_VIEW);
      expect(q.queued[0].label).toMatch(
        new RegExp(`^mortar-overdrive-build:[a-z]+:${CIRCUIT.id}$`),
      );
      expect(gate).not.toHaveBeenCalled();
      await q.drainOne();
      pieces++;
    }
    const job = view.build();
    expect(job.finished).toBe(true);
    expect(view.built).toBe(true);
    expect(pieces).toBe(job.total);
    expect(pieces).toBeGreaterThan(8);
    expect(q.yields()).toBe(pieces - 1);
    // One queue label kind for every piece; the pieces stay apart in the
    // label's tail and in the build ledger, which is not the admission ledger.
    expect(new Set(q.labels.map(gpuPrepKindOfLabel))).toEqual(new Set(['mortar-overdrive-build']));
    const pieceNames = new Set(q.labels.map((label) => label.split(':')[1]));
    for (const piece of ['spline', 'ground', 'placements', 'surfaces', 'flowers', 'fences']) {
      expect(pieceNames.has(piece), piece).toBe(true);
    }
    expect(q.records).toHaveLength(pieces);
    for (const kind of q.records) expect(kind).toMatch(/^zone:mortar-overdrive-[a-z]+$/);
    for (const piece of ['placements', 'flowers', 'pickups', 'slicks', 'fences']) {
      expect(q.records, piece).toContain(`zone:mortar-overdrive-${piece}`);
    }
    // The gate ran once, over the built group.
    await flush();
    expect(gate).toHaveBeenCalled();
    expect(calls[0].target).toBe(view.group);
    expect(calls[0].children).toBeGreaterThan(0);
    expect(client.buildMs).not.toBeNull();
    expect(client.buildWallMs).not.toBeNull();
    // The bar counts every build piece beside the steps after it.
    const fills = mortarOverdriveFills(view.group);
    expect(fills.total).toBeGreaterThan(0);
    expect(client.units().total).toBe(job.total + fills.total + 3);
    // Not on the viewer's lane, so no upload frame to wait for: the verdict is in.
    expect(verdict).toBe(true);
    expect(client.units()).toEqual({ done: client.units().total, total: client.units().total });
  });

  it('runs the build to the end at once, before its first await, when the seam says so', () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    const q = manualHost();
    const client = new MortarOverdriveCircuitPrepare(view, fakeSky(), q.host, () => true);
    void client.run(immediateGate().gate, NEVER);
    // Synchronously: the seam's frame that asked is the frame it is built in.
    expect(view.built).toBe(true);
    expect(view.group.children.length).toBeGreaterThan(0);
    expect(q.queued).toEqual([]);
    expect(q.records.length).toBe(view.build().total);
  });

  it('finishes at once when the cover ends in the middle of a sliced build', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    const q = manualHost();
    let now = false;
    const client = new MortarOverdriveCircuitPrepare(view, fakeSky(), q.host, () => now);
    void client.run(immediateGate().gate, NEVER);
    await flush();
    await q.drainOne();
    await q.drainOne();
    expect(view.built).toBe(false);
    now = true;
    await q.drainOne();
    expect(view.built).toBe(true);
    expect(q.queued).toEqual([]);
  });

  it('stops a build its queue shut down, and a given-back pool never finishes one', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    const q = manualHost();
    const client = new MortarOverdriveCircuitPrepare(view, fakeSky(), q.host, () => false);
    const { gate } = immediateGate();
    let verdict: boolean | null = null;
    void client.run(gate, NEVER).then((ok) => {
      verdict = ok;
    });
    await flush();
    await q.drainOne();
    await q.drainOne();
    tracks.dispose();
    q.shutdown();
    await flush();
    expect(verdict).toBe(false);
    expect(gate).not.toHaveBeenCalled();
    expect(view.built).toBe(false);
    // The job is over: nothing runs into the given-back group any more.
    const job = view.build();
    expect(job.finished).toBe(true);
    job.step();
    expect(view.group.children).toEqual([]);
    expect(view.built).toBe(false);
  });

  it('builds a circuit once per pool, whatever asks it', () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    const job = view.build();
    expect(view.build()).toBe(job);
    job.finish();
    const children = view.group.children.length;
    const client = new MortarOverdriveCircuitPrepare(
      view,
      fakeSky(),
      manualHost().host,
      () => true,
    );
    void client.run(immediateGate().gate, NEVER);
    expect(view.group.children.length).toBe(children);
  });
});

describe('when something goes wrong', () => {
  it('builds the rest of the circuit when a piece throws, and reads unproven', async () => {
    pickupControl.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const tracks = track.buildMortarOverdriveTracks();
      const view = viewOf(tracks);
      const client = new MortarOverdriveCircuitPrepare(
        view,
        fakeSky(),
        manualHost().host,
        () => true,
      );
      const { gate } = immediateGate();
      let verdict: boolean | null = null;
      void client.run(gate, NEVER).then((ok) => {
        verdict = ok;
      });
      // The road, the walls and the lights are there, and the view drives them.
      expect(view.built).toBe(true);
      expect(view.build().failures).toBe(1);
      expect(view.group.getObjectByName('mortar-overdrive-start-lights')).toBeDefined();
      expect(view.group.getObjectByName('mortar-overdrive-pickups')).toBeUndefined();
      tracks.update(LANE.x, LANE.z, 0, null);
      expect(view.group.visible).toBe(true);
      await flush();
      expect(gate).toHaveBeenCalled();
      // Drawn (the upload frame), then the verdict.
      tracks.update(LANE.x, LANE.z, 1, null);
      view.group.traverseVisible((object) => {
        if ((object as THREE.Mesh).isMesh) {
          object.onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
        }
      });
      tracks.update(LANE.x, LANE.z, 2, null);
      await flush();
      expect(verdict).toBe(false);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the slicks and every authored fence when the pickup boxes throw', async () => {
    const reference = track.buildMortarOverdriveTracks();
    viewOf(reference).build().finish();
    const fences = mortarOverdriveFills(viewOf(reference).group).total;
    pickupControl.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const tracks = track.buildMortarOverdriveTracks();
      const view = viewOf(tracks);
      view.build().finish();
      expect(view.build().failures).toBe(1);
      expect(view.group.getObjectByName('mortar-overdrive-pickups')).toBeUndefined();
      expect(view.group.getObjectByName('mortar-overdrive-slicks')).toBeDefined();
      // Every fence (and every other model fill) was still asked for.
      expect(mortarOverdriveFills(view.group).total).toBe(fences);
      await mortarOverdriveFills(view.group).landed();
      const fenceDraws = drawsUnder(view.group).filter((draw) =>
        draw.object.name.startsWith('mortar-overdrive-dressing:'),
      );
      expect(fenceDraws.length).toBeGreaterThan(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('keeps the start lights when the start arch throws', () => {
    archControl.fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const tracks = track.buildMortarOverdriveTracks();
      const view = viewOf(tracks);
      view.build().finish();
      expect(view.build().failures).toBe(1);
      expect(view.group.getObjectByName('mortar-overdrive-start-lights')).toBeDefined();
      expect(view.group.getObjectByName('mortar-overdrive-slicks')).toBeDefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('withdraws the upload frame when its cover ends first: nothing is ever drawn unculled in the open', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    let uncover: () => void = () => undefined;
    const uncovered = new Promise<void>((resolve) => {
      uncover = resolve;
    });
    const client = new MortarOverdriveCircuitPrepare(
      view,
      fakeSky(),
      manualHost().host,
      () => true,
    );
    let verdict: boolean | null = null;
    tracks.update(LANE.x, LANE.z, 0, null);
    void client.run(immediateGate().gate, uncovered).then((ok) => {
      verdict = ok;
    });
    await flush();
    // Gated and asked; the next frame on the lane readies the upload frame.
    tracks.update(LANE.x, LANE.z, 1, null);
    const meshes: THREE.Object3D[] = [];
    view.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object);
    });
    expect(meshes.some((mesh) => !mesh.frustumCulled)).toBe(true);
    // The cover ends before any render drew it.
    uncover();
    await flush();
    expect(verdict).toBe(true);
    expect(meshes.every((mesh) => mesh.frustumCulled)).toBe(true);
    for (let frame = 2; frame < 5; frame++) {
      tracks.update(LANE.x, LANE.z, frame, null);
      expect(meshes.every((mesh) => mesh.frustumCulled)).toBe(true);
    }
  });
});

describe('the seam builds where the pilot needs it', () => {
  for (const cover of [false, true]) {
    it(`builds the pilot's circuit inside the seam's first frame of a login mid-race${cover ? ', covered for that frame' : ''}`, () => {
      const seam = new MortarOverdrivePrepare();
      const tracks = track.buildMortarOverdriveTracks();
      const q = manualHost();
      prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), q.host);
      const view = viewOf(tracks);
      if (cover) setArrivalCover(true);
      seam.frame(seamHost(), lobby('racing'), LANE.x, LANE.z);
      if (cover) setArrivalCover(false);
      // Built before any frame the cover no longer hides, on the first frame.
      expect(seam.reason).toBe('seated');
      expect(view.built).toBe(true);
      expect(q.labels.filter((label) => label.startsWith('mortar-overdrive-build:'))).toEqual([]);
      tracks.update(LANE.x, LANE.z, 0, null);
      expect(view.group.children.length).toBeGreaterThan(0);
    });
  }

  it('spreads the lobby build over the queue while its curtain covers the world', async () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    const q = manualHost();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), q.host);
    const view = viewOf(tracks);
    const frame = () => {
      seam.frame(seamHost(), lobby(), LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
    };
    frame();
    expect(view.built).toBe(false);
    await flush();
    expect(q.queued.some((unit) => unit.label.startsWith('mortar-overdrive-build:'))).toBe(true);
    const out = { done: 0, total: 0, settled: false };
    seam.progress(out, CIRCUIT.id);
    expect(out.settled).toBe(false);
    expect(out.total).toBeGreaterThan(4);
    // The lobby curtain rises (its arrival-cover depth), then the build runs.
    setArrivalCover(true);
    for (let i = 0; i < 3; i++) {
      frame();
      await q.drainOne();
    }
    expect(view.built).toBe(false);
    // The curtain falls with the phase still loading (a lost connection): the
    // road is on screen now, so the rest of the build runs at once.
    setArrivalCover(false);
    frame();
    await q.drain((unit) => unit.label.startsWith('mortar-overdrive-build:'));
    expect(view.built).toBe(true);
    expect(seam.buildNow(CIRCUIT.id)).toBe(true);
  });

  it('stops holding a blocking arrival once linked with its sky, before its upload frame draws', async () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky());
    const view = viewOf(tracks);
    const id = mortarOverdriveCircuitPrepareId(CIRCUIT.id);
    const walker = { queued: false, match: null };
    setArrivalCover(true);
    const frame = async () => {
      seam.frame(seamHost(), walker, LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
      await flush();
    };
    await frame();
    // A walker standing on the lane: built on that frame.
    expect(view.built).toBe(true);
    for (let i = 0; i < 4; i++) await frame();
    // Linked, sky ready, shown under the cover, but no frame PRESENTED it (the
    // arrival holds the world draw): the arrival no longer waits on it...
    expect(seam.stateOf(id)).toBe('preparing');
    expect(view.group.visible).toBe(true);
    expect(seam.heldImminentKeys()).toBe(0);
    // ...and the verdict comes with the first drawn frame.
    view.group.traverseVisible((object) => {
      if ((object as THREE.Mesh).isMesh) {
        object.onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
      }
    });
    await frame();
    await frame();
    expect(seam.stateOf(id)).not.toBe('preparing');
    setArrivalCover(false);
  });

  it('finishes a queued lobby build on the frame its curtain falls, without waiting on the queue', async () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    const q = manualHost();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), q.host);
    const view = viewOf(tracks);
    const frame = () => seam.frame(seamHost(), lobby(), LANE.x, LANE.z);
    frame();
    setArrivalCover(true);
    frame();
    await flush();
    await q.drainOne();
    // A piece waits in the queue (the budget refusing it, say) when the lobby
    // curtain falls on a lost connection, the phase still loading.
    expect(q.queued.some((unit) => unit.label.startsWith('mortar-overdrive-build:'))).toBe(true);
    expect(view.built).toBe(false);
    setArrivalCover(false);
    frame();
    expect(view.built).toBe(true);
    // The unit still in the queue then runs nothing, and records no sample
    // that would teach the budget a near-zero cost for its kind.
    const children = view.group.children.length;
    const records = q.records.length;
    await q.drain((unit) => unit.label.startsWith('mortar-overdrive-build:'));
    expect(view.group.children.length).toBe(children);
    expect(q.records.length).toBe(records);
  });

  it('builds the lane underfoot too when the viewer walks off onto another circuit with a match on', () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), manualHost().host);
    const other = MORTAR_OVERDRIVE_LANES.find((lane) => lane.circuit.id !== CIRCUIT.id);
    if (!other) throw new Error('one circuit only');
    const at = mortarOverdriveLaneOrigin(other.index);
    seam.frame(seamHost(), lobby('finished'), at.x, at.z);
    const underfoot = tracks.circuits.find((view) => view.circuitId === other.circuit.id);
    expect(underfoot?.built).toBe(true);
    expect(seam.buildNow(other.circuit.id)).toBe(true);
  });

  it('names the rule: the own lobby under its cover is the only wait a build spreads over', () => {
    const racing = { circuitId: 'a', phase: 'racing' };
    const loading = { circuitId: 'a', phase: 'loading' };
    expect(mortarOverdriveBuildNow('a', loading, 'a', true)).toBe(false);
    expect(mortarOverdriveBuildNow('a', loading, 'a', false)).toBe(true);
    expect(mortarOverdriveBuildNow('a', racing, 'a', true)).toBe(true);
    expect(mortarOverdriveBuildNow('a', { circuitId: 'a', phase: 'countdown' }, null, true)).toBe(
      true,
    );
    // A walker: standing on the lane, at once; anywhere else, never asked here.
    expect(mortarOverdriveBuildNow('a', null, 'a', false)).toBe(true);
    expect(mortarOverdriveBuildNow('a', null, 'a', true)).toBe(true);
    expect(mortarOverdriveBuildNow('a', null, 'b', false)).toBe(false);
    // Another circuit's race says nothing about this one.
    expect(mortarOverdriveBuildNow('a', { circuitId: 'b', phase: 'racing' }, null, false)).toBe(
      false,
    );
  });

  it('adds a build to a client step count, one piece before it starts', () => {
    const out = { done: 2, total: 5 };
    expect(addMortarOverdriveBuildUnits(out, 0, 0)).toEqual({ done: 2, total: 6 });
    expect(addMortarOverdriveBuildUnits({ done: 0, total: 3 }, 7, 30)).toEqual({
      done: 7,
      total: 33,
    });
    expect(addMortarOverdriveBuildUnits({ done: 0, total: 3 }, 40, 30)).toEqual({
      done: 30,
      total: 33,
    });
    expect(addMortarOverdriveBuildUnits({ done: 0, total: 3 }, -1, Number.NaN)).toEqual({
      done: 0,
      total: 4,
    });
  });
});

describe('the upload frame', () => {
  it('draws the built view unculled and shadowless until a render drew it, then gives each mesh its own flags back', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    view.build().finish();
    const meshes: THREE.Object3D[] = [];
    view.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh || (object as THREE.Sprite).isSprite) meshes.push(object);
    });
    expect(meshes.length).toBeGreaterThan(3);
    // Some meshes carry their own flags already: those must come back as they were.
    meshes[0].frustumCulled = false;
    meshes[1].castShadow = true;
    meshes[2].castShadow = false;
    const own = meshes.map((mesh) => [mesh.frustumCulled, mesh.castShadow]);
    let held = true;
    tracks.holdReveal(() => held);
    let uploaded = false;
    void view.uploadFrame().then(() => {
      uploaded = true;
    });
    // Held: not shown, so no upload frame yet.
    tracks.update(LANE.x, LANE.z, 0, null);
    expect(view.group.visible).toBe(false);
    expect(meshes.every((mesh, i) => mesh.frustumCulled === own[i][0])).toBe(true);
    held = false;
    tracks.update(LANE.x, LANE.z, 1, null);
    expect(view.group.visible).toBe(true);
    for (const mesh of meshes) {
      expect(mesh.frustumCulled).toBe(false);
      expect(mesh.castShadow).toBe(false);
    }
    // Updated again with no render between (a frame loop that skipped its
    // present): nothing was drawn, so the upload frame is not over.
    tracks.update(LANE.x, LANE.z, 2, null);
    await flush();
    expect(uploaded).toBe(false);
    expect(meshes.every((mesh) => mesh.frustumCulled === false)).toBe(true);
    // three draws the view (one node is enough to say the frame drew).
    meshes[3].onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
    tracks.update(LANE.x, LANE.z, 3, null);
    await flush();
    expect(uploaded).toBe(true);
    expect(meshes.map((mesh) => [mesh.frustumCulled, mesh.castShadow])).toEqual(own);
    expect(meshes.every((mesh) => !Object.hasOwn(mesh, 'onAfterRender'))).toBe(true);
    // One-shot: a later frame changes nothing.
    tracks.update(LANE.x, LANE.z, 4, null);
    expect(meshes.map((mesh) => [mesh.frustumCulled, mesh.castShadow])).toEqual(own);
  });
});

describe('the upload frame is withdrawn on the frame its cover ends', () => {
  /** A walker on the lane under an arrival cover: built at once, gated, sky
   *  ready, the upload frame asked and armed by the frame's update, and no
   *  render drew it (the arrival holds the present). */
  async function armedUnderArrival() {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky());
    const view = viewOf(tracks);
    const walker = { queued: false, match: null };
    setArrivalCover(true);
    const frame = () => {
      seam.frame(seamHost(), walker, LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
    };
    for (let i = 0; i < 4; i++) {
      frame();
      await flush();
    }
    const meshes: THREE.Object3D[] = [];
    view.group.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) meshes.push(object);
    });
    return { seam, tracks, view, frame, meshes, id: mortarOverdriveCircuitPrepareId(CIRCUIT.id) };
  }

  it('restores every mesh inside the seam frame that notices the cover ended, with no microtask in between', async () => {
    const { seam, frame, meshes, id } = await armedUnderArrival();
    // Armed: the frame under the cover would draw it unculled.
    expect(meshes.some((mesh) => !mesh.frustumCulled)).toBe(true);
    expect(seam.stateOf(id)).toBe('preparing');
    // The arrival lifts (the linked circuit stopped holding it); the next frame
    // is the first one presented, and it must draw the circuit culled.
    setArrivalCover(false);
    frame();
    expect(meshes.every((mesh) => mesh.frustumCulled)).toBe(true);
    expect(meshes.every((mesh) => !Object.hasOwn(mesh, 'onAfterRender'))).toBe(true);
    // Never armed again, and the verdict still comes.
    for (let i = 0; i < 3; i++) {
      frame();
      expect(meshes.every((mesh) => mesh.frustumCulled)).toBe(true);
    }
    await flush();
    expect(seam.stateOf(id)).not.toBe('preparing');
  });

  it('never re-arms it when the client resumes after the cover ended', async () => {
    const { tracks, frame, meshes } = await armedUnderArrival();
    setArrivalCover(false);
    frame();
    await flush();
    for (let i = 0; i < 3; i++) {
      tracks.update(LANE.x, LANE.z, i + 10, null);
      expect(meshes.every((mesh) => mesh.frustumCulled)).toBe(true);
    }
  });

  it('asks a fresh upload frame after a withdrawal, which a draw resolves', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    view.build().finish();
    const first = view.uploadFrame();
    view.cancelUploadFrame();
    const second = view.uploadFrame();
    expect(second).not.toBe(first);
    let resolved = false;
    void second.then(() => {
      resolved = true;
    });
    tracks.update(LANE.x, LANE.z, 0, null);
    view.group.traverseVisible((object) => {
      if ((object as THREE.Mesh).isMesh) {
        object.onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
      }
    });
    tracks.update(LANE.x, LANE.z, 1, null);
    await flush();
    expect(resolved).toBe(true);
  });
});

describe('a re-asked upload frame', () => {
  it('resolves only on a render of its own, never on the last frame that drew one', async () => {
    const tracks = track.buildMortarOverdriveTracks();
    const view = viewOf(tracks);
    view.build().finish();
    const draw = (): void =>
      view.group.traverseVisible((object) => {
        if ((object as THREE.Mesh).isMesh) {
          object.onAfterRender(...([] as unknown as Parameters<THREE.Object3D['onAfterRender']>));
        }
      });
    let first = false;
    void view.uploadFrame().then(() => {
      first = true;
    });
    tracks.update(LANE.x, LANE.z, 0, null);
    draw();
    tracks.update(LANE.x, LANE.z, 1, null);
    await flush();
    expect(first).toBe(true);
    // A later run (a new lobby on the same circuit) withdraws and asks again.
    view.cancelUploadFrame();
    let second = false;
    void view.uploadFrame().then(() => {
      second = true;
    });
    tracks.update(LANE.x, LANE.z, 2, null);
    // Updated again with no render between: the earlier frame's draw is not
    // this frame's.
    tracks.update(LANE.x, LANE.z, 3, null);
    await flush();
    expect(second).toBe(false);
    draw();
    tracks.update(LANE.x, LANE.z, 4, null);
    await flush();
    expect(second).toBe(true);
  });
});

describe('the admission budget sees the build as two kinds', () => {
  it('adds at most two queue label kinds over a full race: the queue join, the lobby, the countdown', async () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    const q = manualHost();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), q.host);
    const view = viewOf(tracks);
    // The queue join in town: the representatives.
    seam.frame(seamHost(), { queued: true, match: null }, 0, 0);
    await flush();
    await q.drain();
    // The pop: the lobby, covered, builds the drawn circuit a piece at a time.
    setArrivalCover(true);
    for (let i = 0; i < 400 && !view.built; i++) {
      seam.frame(seamHost(), lobby(), LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, i, null);
      await q.drainOne();
    }
    expect(view.built).toBe(true);
    setArrivalCover(false);
    for (const phase of ['countdown', 'racing', 'finished']) {
      seam.frame(seamHost(), lobby(phase), LANE.x, LANE.z);
      tracks.update(LANE.x, LANE.z, 0, null);
      await q.drain();
    }
    const kinds = new Set(q.labels.map(gpuPrepKindOfLabel));
    expect(kinds).toEqual(new Set(['mortar-overdrive-common', 'mortar-overdrive-build']));
    expect(kinds.size).toBeLessThanOrEqual(2);
    // The pieces are still told apart where it helps: the label's tail, and
    // the build ledger, which is not the admission ledger.
    expect(new Set(q.labels.map((label) => label.split(':')[1])).size).toBeGreaterThan(8);
  });
});

describe('the pure halves of a build piece', () => {
  it('holds each drawable its own culling, shadow and hook across the upload frame, and names its draw', () => {
    const calls: string[] = [];
    const own = function (this: unknown) {
      calls.push('own');
    };
    const proto = { onAfterRender: () => calls.push('proto') };
    const node = (fields: Record<string, unknown>) => Object.assign(Object.create(proto), fields);
    const nodes = [
      node({ isMesh: true, frustumCulled: true, castShadow: true }),
      node({ isMesh: true, frustumCulled: false, castShadow: true, onAfterRender: own }),
      node({ isSprite: true, frustumCulled: true, castShadow: false }),
      node({ frustumCulled: true, castShadow: true }),
    ];
    const root = {
      traverse: (visit: (object: never) => void) => {
        for (const n of nodes) visit(n as never);
      },
    };
    let drawn = 0;
    const held = prepareUploadFrame(root, () => drawn++);
    expect(held).toHaveLength(3);
    expect(nodes.slice(0, 3).every((n) => !n.frustumCulled && !n.castShadow)).toBe(true);
    // A group is no drawable: left alone.
    expect([nodes[3].frustumCulled, nodes[3].castShadow]).toEqual([true, true]);
    expect(Object.hasOwn(nodes[3], 'onAfterRender')).toBe(false);
    // three drawing a node is what says the frame drew: its own hook still runs.
    nodes[1].onAfterRender();
    nodes[0].onAfterRender();
    expect(drawn).toBe(2);
    expect(calls).toEqual(['own', 'proto']);
    restoreAfterUploadFrame(held);
    expect(nodes.map((n) => [n.frustumCulled, n.castShadow])).toEqual([
      [true, true],
      [false, true],
      [true, false],
      [true, true],
    ]);
    expect(nodes[1].onAfterRender).toBe(own);
    expect(Object.hasOwn(nodes[0], 'onAfterRender')).toBe(false);
    expect(Object.hasOwn(nodes[2], 'onAfterRender')).toBe(false);
    nodes[0].onAfterRender();
    expect(drawn).toBe(2);
  });

  it('cuts the grass into pieces of whole tiles, in order, by cluster count', () => {
    const tile = (clusters: number) => ({ x: 0, z: 0, clusters: new Array(clusters).fill(null) });
    const tiles = [tile(900), tile(300), tile(1200), tile(50), tile(5)] as unknown as Parameters<
      typeof mortarOverdriveGrassPieces
    >[0];
    const pieces = mortarOverdriveGrassPieces(tiles, 1000);
    expect(pieces.map((piece) => piece.map((t) => t.clusters.length))).toEqual([
      [900, 300],
      [1200],
      [50, 5],
    ]);
    expect(pieces.flat()).toEqual(tiles);
    expect(mortarOverdriveGrassPieces([])).toEqual([]);
  });
});

describe('the common client (mortarOverdriveCommon) without a built circuit', () => {
  it('builds nothing without a parallel compile', async () => {
    const seam = new MortarOverdrivePrepare();
    const tracks = track.buildMortarOverdriveTracks();
    const q = manualHost();
    prepareMortarOverdriveCircuits(seam, tracks, fakeSky(), q.host);
    seam.frame(seamHost(false), { queued: true, match: null }, 0, 0);
    await flush();
    expect(seam.stateOf(MORTAR_OVERDRIVE_COMMON_PREPARE_ID)).toBe('unproven');
    expect(q.labels.filter((label) => label.startsWith('mortar-overdrive-common:'))).toEqual([]);
  });

  it('makes its representatives in queue pieces at the queue join, gates them once, and registers no light', async () => {
    vi.mocked(registerStaticNightLights).mockClear();
    const tracks = track.buildMortarOverdriveTracks();
    const q = manualHost();
    const client = new MortarOverdriveCommonPrepare(
      () => mortarOverdriveCommonBuild(MORTAR_OVERDRIVE_CIRCUIT_LIST, tracks.palette),
      q.host,
    );
    const root = client.prepare();
    expect(root.children).toEqual([]);
    const { gate, calls } = immediateGate();
    let verdict: boolean | null = null;
    void client.run(gate).then((ok) => {
      verdict = ok;
    });
    await flush();
    let pieces = 0;
    while (q.queued.length > 0) {
      expect(q.queued[0].priority).toBe(GPU_WORK_PRIORITY.VISIBLE_PREWARM);
      expect(q.queued[0].label).toMatch(/^mortar-overdrive-common:[a-z]+$/);
      expect(root.children).toEqual([]);
      await q.drainOne();
      pieces++;
    }
    await flush();
    expect(pieces).toBeGreaterThan(3);
    expect(verdict).toBe(true);
    expect(gate).toHaveBeenCalledTimes(1);
    expect(calls[0].target).toBe(root);
    expect(drawsUnder(root).length).toBeGreaterThan(5);
    expect(client.units()).toEqual({ done: pieces + 1, total: pieces + 1 });
    // Nothing of any circuit was built for it.
    for (const view of tracks.circuits) expect(view.built, view.circuitId).toBe(false);
    expect(registerStaticNightLights).not.toHaveBeenCalled();
  });
});

describe('giving the pool back', () => {
  it('frees what the built circuits own, the palette it minted, and stops every build', () => {
    const tracks = track.buildMortarOverdriveTracks();
    const built = viewOf(tracks);
    built.build().finish();
    const pending = tracks.circuits.find((view) => view !== built);
    if (!pending) throw new Error('one circuit only');
    const job = pending.build();
    job.step();
    let owned: THREE.BufferGeometry | null = null;
    built.group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!owned && mesh.isMesh && !(mesh as THREE.InstancedMesh).isInstancedMesh) {
        owned = mesh.geometry;
      }
    });
    if (!owned) throw new Error('no owned geometry');
    const geometryDispose = vi.spyOn(owned as THREE.BufferGeometry, 'dispose');
    const groundDispose = vi.spyOn(tracks.palette.ground(), 'dispose');
    tracks.dispose();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(groundDispose).toHaveBeenCalledOnce();
    expect(tracks.group.children).toEqual([]);
    expect(job.finished).toBe(true);
    // Idempotent.
    tracks.dispose();
    expect(groundDispose).toHaveBeenCalledOnce();
  });
});
