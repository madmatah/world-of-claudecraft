// The race preparation seam: WHEN the race-only producers prepare (the pure
// latch in realm_racers_prepare_core.ts) and how the painter
// (realm_racers_prepare.ts) turns a committed viewer into one world-gate call
// per client, reading its verdict off the settle record and never a clock.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { arrivalHeldImminentKeys, resetArrivalCoverForTest } from '../src/render/arrival_cover';
import { gpuPrepEventsSnapshot, resetGpuPrepEventsForTest } from '../src/render/gpu_prep_events';
import { markProgramReady } from '../src/render/linked_program_readiness';
import { RealmRacersGroundBlastVisuals } from '../src/render/realm_racers_ground_blast';
import {
  RealmRacersPrepare,
  type RealmRacersPrepareClient,
  type RealmRacersPrepareHost,
} from '../src/render/realm_racers_prepare';
import {
  createRealmRacersPrepareLatch,
  type RealmRacersCommitment,
  realmRacersPrepareHolds,
  realmRacersPrepareReason,
  takeRealmRacersPrepare,
} from '../src/render/realm_racers_prepare_core';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { stripComments } from './helpers/strip_comments';

vi.mock('../src/render/textures', () => ({
  rallyGroundBlastMarkerTexture: () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  },
}));

const IDLE = { queued: false, match: null };
const QUEUED = { queued: true, match: null };
const PRACTICE = { queued: false, match: { practice: true } };
const SEATED = { queued: false, match: { practice: false } };
/** Eastbrook-side world coordinates, far from the rally band. */
const TOWN = { x: 0, z: 0 };
const BAND = { x: REALM_RACERS_ORIGIN.x, z: REALM_RACERS_ORIGIN.z };

const at = (
  viewer: { queued: boolean; match: { practice: boolean } | null },
  inBand: boolean,
  shot = false,
): RealmRacersCommitment => ({ ...viewer, inBand, shot });

beforeEach(() => {
  resetArrivalCoverForTest();
  resetGpuPrepEventsForTest();
});

describe('race preparation trigger (core)', () => {
  it('names the commitment: queue, then the seat, then the band, then a shot', () => {
    expect(realmRacersPrepareReason(at(IDLE, false))).toBeNull();
    expect(realmRacersPrepareReason(at(QUEUED, false))).toBe('queue');
    expect(realmRacersPrepareReason(at(PRACTICE, false))).toBe('practice');
    expect(realmRacersPrepareReason(at(PRACTICE, true))).toBe('practice');
    expect(realmRacersPrepareReason(at(SEATED, false))).toBe('seated');
    expect(realmRacersPrepareReason(at(SEATED, true))).toBe('seated');
    expect(realmRacersPrepareReason(at(IDLE, true))).toBe('band');
    expect(realmRacersPrepareReason(at(IDLE, true, true))).toBe('band');
    expect(realmRacersPrepareReason(at(IDLE, false, true))).toBe('shot');
  });

  it('holds an arrival only while the viewer is on the circuit', () => {
    expect(realmRacersPrepareHolds(at(QUEUED, false))).toBe(false);
    expect(realmRacersPrepareHolds(at(IDLE, false, true))).toBe(false);
    expect(realmRacersPrepareHolds(at(PRACTICE, false))).toBe(true);
    expect(realmRacersPrepareHolds(at(SEATED, true))).toBe(true);
    expect(realmRacersPrepareHolds(at(IDLE, true))).toBe(true);
    expect(realmRacersPrepareHolds(at(QUEUED, true))).toBe(true);
  });

  it('fires exactly once per latch, on the first committed frame', () => {
    const latch = createRealmRacersPrepareLatch();
    expect(takeRealmRacersPrepare(latch, at(IDLE, false))).toBeNull();
    expect(takeRealmRacersPrepare(latch, at(QUEUED, false))).toBe('queue');
    expect(takeRealmRacersPrepare(latch, at(QUEUED, false))).toBeNull();
    expect(takeRealmRacersPrepare(latch, at(SEATED, true))).toBeNull();
    expect(latch.reason).toBe('queue');
  });
});

interface FakeHost extends RealmRacersPrepareHost {
  gate: ReturnType<typeof vi.fn>;
  /** Write what a settled gate leaves behind under `root`: every material's
   *  program recorded ready, every texture resident. */
  settle(root: THREE.Object3D): void;
  /** Resolve (or reject) the oldest pending gate call. */
  release(ok?: boolean): void;
}

function fakeHost(withGate = true): FakeHost {
  const records = new Map<object, unknown>();
  const pending: { resolve: () => void; reject: () => void }[] = [];
  const gate = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return {
    gate,
    worldCompileGate: () => (withGate ? gate : undefined),
    webgl: { properties: { get: (object: object) => records.get(object) } },
    settle(root) {
      root.traverse((object) => {
        const material = (object as THREE.Mesh).material as THREE.Material | undefined;
        if (!material) return;
        const program = { getUniforms: () => ({}), getAttributes: () => ({}) };
        markProgramReady(program);
        records.set(material, { programs: new Map([['key', program]]) });
        const map = (material as THREE.MeshBasicMaterial).map;
        if (map) records.set(map, { __webglTexture: {}, __version: map.version });
      });
    },
    release(ok = true) {
      const next = pending.shift();
      if (ok) next?.resolve();
      else next?.reject();
    },
  };
}

interface CountingClient extends RealmRacersPrepareClient {
  calls: number;
  root: THREE.Group;
}

function countingClient(prepareId = 'probe'): CountingClient {
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()));
  const client: CountingClient = {
    prepareId,
    built: false,
    calls: 0,
    root,
    prepare() {
      client.calls++;
      return root;
    },
  };
  return client;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function prepareEvents() {
  return gpuPrepEventsSnapshot().events.filter((event) => event.kind === 'prepare');
}

describe('race preparation seam (painter)', () => {
  it('never prepares for a player who never races', () => {
    const host = fakeHost();
    const client = countingClient();
    const seam = new RealmRacersPrepare([client]);
    for (let frame = 0; frame < 600; frame++) seam.frame(host, IDLE, TOWN.x + frame, TOWN.z);
    expect(client.calls).toBe(0);
    expect(host.gate).not.toHaveBeenCalled();
    expect(seam.reason).toBeNull();
    expect(seam.stateOf('probe')).toBe('idle');
  });

  for (const [label, viewer, where, reason] of [
    ['on joining the queue', QUEUED, TOWN, 'queue'],
    ['when a practice race seats the player, before any teleport', PRACTICE, TOWN, 'practice'],
    ['when a practice race seats the player in the band', PRACTICE, BAND, 'practice'],
    ['on a login already seated in a race', SEATED, BAND, 'seated'],
    ['on a login already standing in the rally band', IDLE, BAND, 'band'],
  ] as const) {
    it(`prepares ${label}, once`, () => {
      const host = fakeHost();
      const client = countingClient();
      const seam = new RealmRacersPrepare([client]);
      seam.frame(host, IDLE, TOWN.x, TOWN.z);
      expect(host.gate).not.toHaveBeenCalled();
      seam.frame(host, viewer, where.x, where.z);
      expect(seam.reason).toBe(reason);
      expect(client.calls).toBe(1);
      expect(host.gate).toHaveBeenCalledTimes(1);
      expect(host.gate).toHaveBeenCalledWith(client.root);
      for (const next of [QUEUED, PRACTICE, SEATED, IDLE]) seam.frame(host, next, BAND.x, BAND.z);
      expect(client.calls).toBe(1);
      expect(host.gate).toHaveBeenCalledTimes(1);
    });
  }

  it('prepares again only for a rebuilt renderer', () => {
    const host = fakeHost();
    const client = countingClient();
    const first = new RealmRacersPrepare([client]);
    first.frame(host, QUEUED, TOWN.x, TOWN.z);
    first.frame(host, SEATED, BAND.x, BAND.z);
    expect(host.gate).toHaveBeenCalledTimes(1);
    const rebuilt = new RealmRacersPrepare([client]);
    rebuilt.frame(host, SEATED, BAND.x, BAND.z);
    expect(host.gate).toHaveBeenCalledTimes(2);
    expect(rebuilt.reason).toBe('seated');
  });

  it('proves a seated pool off the settle record, records it, and holds the arrival meanwhile', async () => {
    const host = fakeHost();
    const blasts = new RealmRacersGroundBlastVisuals();
    const seam = new RealmRacersPrepare([blasts]);
    seam.frame(host, SEATED, BAND.x, BAND.z);
    expect(host.gate).toHaveBeenCalledWith(blasts.group);
    expect(blasts.group.children.length).toBe(48);
    expect(seam.stateOf('groundBlast')).toBe('preparing');
    expect(seam.heldImminentKeys()).toBe(1);
    expect(arrivalHeldImminentKeys()).toBe(1);
    expect(prepareEvents()).toEqual([]);
    host.settle(blasts.group);
    host.release();
    await flush();
    expect(seam.stateOf('groundBlast')).toBe('proven');
    expect(seam.heldImminentKeys()).toBe(0);
    expect(arrivalHeldImminentKeys()).toBe(0);
    expect(prepareEvents()).toMatchObject([
      { key: 'realm-racers-prepare:seated:groundBlast', readyRoots: 1, totalRoots: 1 },
    ]);
    expect(gpuPrepEventsSnapshot().counts.prepare).toBe(1);
  });

  it('never holds an arrival for a queue join in town, only once the viewer is on the circuit', async () => {
    const host = fakeHost();
    const blasts = new RealmRacersGroundBlastVisuals();
    const seam = new RealmRacersPrepare([blasts]);
    seam.frame(host, QUEUED, TOWN.x, TOWN.z);
    expect(seam.stateOf('groundBlast')).toBe('preparing');
    expect(seam.heldImminentKeys()).toBe(0);
    expect(arrivalHeldImminentKeys()).toBe(0);
    seam.frame(host, SEATED, BAND.x, BAND.z);
    expect(seam.heldImminentKeys()).toBe(1);
    expect(arrivalHeldImminentKeys()).toBe(1);
    host.release();
    await flush();
    expect(seam.stateOf('groundBlast')).toBe('unproven');
    expect(arrivalHeldImminentKeys()).toBe(0);
    expect(prepareEvents()).toMatchObject([
      { key: 'realm-racers-prepare:queue:groundBlast', readyRoots: 0, totalRoots: 1 },
    ]);
  });

  it('reads a rejected gate off the record too: linked is proven, nothing linked is unproven', async () => {
    // The proof is the settle record, never the promise: a gate rejected on
    // shutdown after its programs linked still proved them.
    const host = fakeHost();
    const linked = countingClient('linked');
    const cold = countingClient('cold');
    const seam = new RealmRacersPrepare([linked, cold]);
    seam.frame(host, SEATED, BAND.x, BAND.z);
    host.settle(linked.root);
    host.release(false);
    host.release(false);
    await flush();
    expect(seam.stateOf('linked')).toBe('proven');
    expect(seam.stateOf('cold')).toBe('unproven');
    expect(seam.heldImminentKeys()).toBe(0);
  });

  it('still builds the pool without a parallel compile, where first draws link anyway', () => {
    const host = fakeHost(false);
    const blasts = new RealmRacersGroundBlastVisuals();
    const seam = new RealmRacersPrepare([blasts]);
    seam.frame(host, QUEUED, TOWN.x, TOWN.z);
    expect(blasts.group.children.length).toBe(48);
    expect(host.gate).not.toHaveBeenCalled();
    expect(seam.stateOf('groundBlast')).toBe('unproven');
    expect(seam.heldImminentKeys()).toBe(0);
  });

  it('links the rest of the pool off the live frame when a shot beat every trigger', () => {
    const host = fakeHost();
    const blasts = new RealmRacersGroundBlastVisuals();
    const seam = new RealmRacersPrepare([blasts]);
    seam.frame(host, IDLE, TOWN.x, TOWN.z);
    expect(host.gate).not.toHaveBeenCalled();
    blasts.fire({ x: 0, z: 0, targetX: 0, targetZ: 20, flightSeconds: 0.5 }, 0);
    expect(blasts.group.children.length).toBe(48);
    seam.frame(host, IDLE, TOWN.x, TOWN.z);
    expect(seam.reason).toBe('shot');
    expect(host.gate).toHaveBeenCalledTimes(1);
    expect(host.gate).toHaveBeenCalledWith(blasts.group);
    expect(seam.stateOf('groundBlast')).toBe('preparing');
    expect(seam.heldImminentKeys()).toBe(0);
  });

  it('keeps one state per client id, and starts a late client at once', async () => {
    const host = fakeHost();
    const road = countingClient('road');
    const kerb = countingClient('kerb');
    const seam = new RealmRacersPrepare([road, kerb]);
    expect(() => seam.addClient(countingClient('road'))).toThrow();
    seam.frame(host, IDLE, BAND.x, BAND.z);
    expect(seam.stateOf('road')).toBe('preparing');
    expect(seam.stateOf('kerb')).toBe('preparing');
    expect(seam.heldImminentKeys()).toBe(2);
    expect(arrivalHeldImminentKeys()).toBe(2);
    host.settle(road.root);
    host.release();
    await flush();
    expect(seam.stateOf('road')).toBe('proven');
    expect(seam.stateOf('kerb')).toBe('preparing');
    expect(seam.heldImminentKeys()).toBe(1);
    const grid = countingClient('grid');
    seam.addClient(grid);
    expect(grid.calls).toBe(1);
    expect(seam.stateOf('grid')).toBe('preparing');
    expect(host.gate).toHaveBeenCalledTimes(3);
    expect(host.gate).toHaveBeenLastCalledWith(grid.root);
    expect(seam.heldImminentKeys()).toBe(2);
  });
});

describe('race preparation seam (renderer wiring)', () => {
  it('owns the Ground Blast pool as its client and runs on every world frame', () => {
    const renderer = stripComments(
      readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
    );
    const occurrences = (needle: string) => renderer.split(needle).length - 1;
    expect(
      occurrences(
        'private realmRacersPrepare = new RealmRacersPrepare([this.realmRacersGroundBlasts]);',
      ),
    ).toBe(1);
    expect(
      occurrences('this.realmRacersPrepare.frame(this, realmRacersInfo, p.pos.x, p.pos.z);'),
    ).toBe(1);
  });
});
