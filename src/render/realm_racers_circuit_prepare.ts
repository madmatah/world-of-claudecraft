// What the race preparation compiles of the circuits (realm_racers_prepare.ts
// is the seam, realm_racers_track.ts the views).
//
// `rallyCommon` links, at the commitment trigger and before any circuit is
// known or built, one representative draw per procedural program the authored
// circuits carry (ground, road, kerb, grid, start lights, flowers, blade grass,
// water, pickups, slicks, lamps, the procedural props): a program depends on
// the material and the mesh shape, not on the circuit, so every circuit's own
// copy is a cache hit once its representative linked. The representatives are
// made from the circuit RECORDS and the pool's palette
// (realm_racers_common_pieces.ts), in pieces on the GPU work queue, then gated,
// grouped by the material's program signature plus its variant (instancing
// and its colour buffer, the geometry attributes). Theme dressing models are
// not in it: their materials depend on the model (the world's converted prop
// material, or the file's own; realm_racers_dressing_material.ts).
//
// `rallyCircuit:<id>` prepares the drawn circuit once it is known. Its FIRST
// step is to build it: nothing of a circuit exists before this client runs.
// The build's pieces (realm_racers_track.ts `realmRacersTrackBuild`) ride the
// renderer's GPU work queue one unit each, under ONE label kind
// (`rally-build:<piece>:<id>`: the admission budget learns a cost per kind, the
// text before the first colon, out of a bounded ledger, and a kind per piece
// filled it; the pieces stay apart in the build ledger), with a task turn
// between two pieces:
// under the lobby's cover the admission takes every unit at once and the queue
// drains synchronous units back to back, so without the turn the whole build
// would still be one long task and the lobby would freeze. The seam says when
// the build must instead run to the end at once (`buildNow`: the viewer's own
// race past its lobby, a viewer standing on the lane). Each piece is recorded
// in the renderer's build ledger. Then it waits for the circuit's
// fetch-and-fill models to land (realm_racers_fills.ts), gates the circuit's
// view, textures included, and re-gates if a fill was started meanwhile, while
// its theme sky prepares beside it on the GPU queue (realm_racers_sky.ts). Its
// linked view is then released to the reveal hold and the verdict waits for its
// upload frame on the viewer's lane (drawn unculled, so every buffer of the
// circuit uploads), so that too lands under the curtain. A cover that ends
// first (the curtain falls, the arrival cover lifts) settles it on what exists:
// a fetch that never lands never holds a verdict. Its steps (each build piece,
// each fill, the gate, the upload frame, the sky) are the lobby bar's units,
// and its verdict joins the seam's settle, so the lobby's ready waits for it.

import * as THREE from 'three';
import { REALM_RACERS_CIRCUIT_LIST } from '../sim/content/realm_racers_circuits';
import { GPU_WORK_PRIORITY, isGpuQueueShutdown } from './background_gpu_queue';
import { programVariantOf } from './compile_gate_pieces';
import { materialProgramSignature } from './prewarm_policy';
import { type RallyCommonBuild, realmRacersCommonBuild } from './realm_racers_common_pieces';
import { type RealmRacersFills, realmRacersFills } from './realm_racers_fills';
import type {
  RealmRacersCircuitClients,
  RealmRacersPrepare,
  RealmRacersPrepareClient,
  RealmRacersPrepareUnits,
} from './realm_racers_prepare';
import {
  addRealmRacersBuildUnits,
  REALM_RACERS_COMMON_PREPARE_ID,
  realmRacersCircuitPrepareId,
  realmRacersCircuitUnits,
} from './realm_racers_prepare_core';
import type { RealmRacersSky } from './realm_racers_sky';
import type {
  RealmRacersCircuitView,
  RealmRacersLazyCircuitView,
  RealmRacersTrackBuild,
  RealmRacersTracksView,
} from './realm_racers_track';
import { textureRandomStream, withTextureRandomStream } from './texture_random_stream';

type Drawable = THREE.Object3D & {
  isMesh?: boolean;
  isSprite?: boolean;
  isInstancedMesh?: boolean;
  instanceColor?: THREE.InstancedBufferAttribute | null;
  geometry?: THREE.BufferGeometry;
  material?: THREE.Material | THREE.Material[];
};

function proxyOf(node: Drawable): THREE.Object3D {
  if (node.isSprite) return new THREE.Sprite(node.material as THREE.SpriteMaterial);
  if (node.isInstancedMesh) {
    const proxy = new THREE.InstancedMesh(node.geometry, node.material, 1);
    if (node.instanceColor) {
      proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    }
    return proxy;
  }
  return new THREE.Mesh(node.geometry, node.material);
}

/** One proxy per procedural program key under `groups`, dressing excluded. */
export function buildRealmRacersCommonRoot(groups: readonly THREE.Object3D[]): THREE.Group {
  const root = new THREE.Group();
  root.name = 'realmRacersCommon';
  const seen = new Set<string>();
  for (const group of groups) {
    group.traverse((object) => {
      const node = object as Drawable;
      if (!(node.isMesh || node.isSprite) || !node.material) return;
      if (node.userData.realmRacersDressing) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      const key = `${materials.map(materialProgramSignature).join('+')}#${programVariantOf(node)}`;
      if (seen.has(key)) return;
      seen.add(key);
      root.add(proxyOf(node));
    });
  }
  return root;
}

/** What a build piece runs on: the renderer's GPU work queue, one task turn
 *  between two pieces, its build ledger and clock. */
export interface RealmRacersBuildHost {
  run(work: () => unknown, priority: number, label: string): Promise<unknown>;
  yieldTask(): Promise<void>;
  record(kind: string, ms: number, atMs: number): void;
  now(): number;
}

/** A build host with no queue: every piece at once (a suite, a headless host). */
export const IMMEDIATE_BUILD_HOST: RealmRacersBuildHost = {
  run: async (work) => work(),
  yieldTask: () => Promise.resolve(),
  record: () => undefined,
  now: () => 0,
};

/**
 * One task turn, on a message port rather than a timer: a timer chain is
 * clamped to 4 ms a turn after five nested turns and to a second a turn in a
 * background tab, and a build is a few dozen turns. Each piece is its own
 * task, so the browser paints (the lobby bar, chat) between two of them.
 */
export function messageTaskTurn(): Promise<void> {
  if (typeof MessageChannel === 'undefined') {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/** Run `step` and file its main-thread time under `kind` in the build ledger
 *  (`zone:` lane: a piece is a scene construction, the hitch tracker's
 *  zone-build cause). Returns the time. */
function timedPiece(host: RealmRacersBuildHost, kind: string, step: () => void): number {
  const startedAt = host.now();
  step();
  const ms = host.now() - startedAt;
  host.record(`zone:${kind}`, ms, startedAt);
  return ms;
}

export class RealmRacersCommonPrepare implements RealmRacersPrepareClient {
  readonly prepareId = REALM_RACERS_COMMON_PREPARE_ID;
  readonly built = false;
  readonly gateOnly = true;
  private readonly root = new THREE.Group();
  private readonly steps: RealmRacersPrepareUnits = { done: 0, total: 1 };
  /** Whatever a representative paints, it paints from here: the queue join
   *  comes at a varying moment, which must shift no shared texture. */
  private readonly stream = textureRandomStream('realm-racers:common');

  constructor(
    private readonly source: () => RallyCommonBuild,
    private readonly host: RealmRacersBuildHost = IMMEDIATE_BUILD_HOST,
  ) {
    this.root.name = 'realmRacersCommon';
  }

  /** Empty until `run` has made the representatives. */
  prepare(): THREE.Object3D {
    return this.root;
  }

  units(): RealmRacersPrepareUnits {
    return this.steps;
  }

  async run(gate: (target: THREE.Object3D) => Promise<unknown>): Promise<boolean> {
    const build = this.source();
    this.steps.total = build.pieces.length + 1;
    try {
      for (const piece of build.pieces) {
        // At the queue join this runs in town, live: the ordinary budget paces it.
        await this.host.run(
          () =>
            timedPiece(this.host, `rally-common-${piece.kind}`, () =>
              withTextureRandomStream(this.stream, () => piece.run()),
            ),
          GPU_WORK_PRIORITY.VISIBLE_PREWARM,
          `rally-common:${piece.kind}`,
        );
        this.steps.done++;
        await this.host.yieldTask();
      }
    } catch (error) {
      // Dev-channel English, per the render i18n carve-out.
      if (!isGpuQueueShutdown(error)) console.warn('Realm Racers: common pieces failed', error);
      return false;
    }
    for (const proxy of [...buildRealmRacersCommonRoot([build.sampler]).children]) {
      this.root.add(proxy);
    }
    await gate(this.root).catch(() => undefined);
    this.steps.done++;
    return true;
  }
}

const TRUE = (): true => true;

function lazyOf(view: RealmRacersCircuitView): RealmRacersLazyCircuitView | null {
  return 'build' in view ? (view as RealmRacersLazyCircuitView) : null;
}

export class RealmRacersCircuitPrepare implements RealmRacersPrepareClient {
  readonly prepareId: string;
  readonly built = false;
  private readonly fills: RealmRacersFills;
  private readonly steps: RealmRacersPrepareUnits = { done: 0, total: 0 };
  private job: RealmRacersTrackBuild | null = null;
  private gated = false;
  private drawn = false;
  private skyReady = false;
  /** The build's main-thread and wall milliseconds once it ran, null before
   *  (and for a view built elsewhere): the local readout (probes reach it
   *  through the seam) that keeps building apart from linking, which the
   *  verdict's age mixes. */
  buildMs: number | null = null;
  buildWallMs: number | null = null;
  private buildCpu = 0;
  private coverGone = false;

  /**
   * `view` is the pool's lazy view, which this client builds first, or a view
   * built elsewhere (the editor preview's, a suite's). `buildNow` is the
   * seam's rule for running the build to the end at once.
   */
  constructor(
    private readonly view: RealmRacersCircuitView,
    private readonly sky: Pick<RealmRacersSky, 'ensure'>,
    private readonly host: RealmRacersBuildHost = IMMEDIATE_BUILD_HOST,
    private readonly buildNow: () => boolean = () => true,
  ) {
    this.prepareId = realmRacersCircuitPrepareId(view.circuitId);
    this.fills = realmRacersFills(view.group);
  }

  /** The view's group, empty until `run` has built it: the root the settle
   *  proof reads once the steps are done. */
  prepare(): THREE.Object3D {
    return this.view.group;
  }

  units(): RealmRacersPrepareUnits {
    realmRacersCircuitUnits(
      this.steps,
      this.fills.done,
      this.fills.total,
      this.gated,
      this.drawn,
      this.skyReady,
    );
    if (lazyOf(this.view)) {
      addRealmRacersBuildUnits(this.steps, this.job?.done ?? 0, this.job?.total ?? 1);
    }
    return this.steps;
  }

  revealReady(): boolean {
    return this.gated;
  }

  /** Linked and its sky ready: the upload frame left needs a presented frame,
   *  which a blocking arrival's world-draw hold would otherwise wait out. */
  arrivalReady(): boolean {
    return this.gated && this.skyReady;
  }

  /** The seam's word, inside the frame that noticed it, that the cover this
   *  client raced has ended: the upload frame is withdrawn before that frame's
   *  track update, which would otherwise draw the circuit unculled in the
   *  open. The `uncovered` promise says the same a microtask later. */
  coverEnded(): void {
    this.coverGone = true;
    lazyOf(this.view)?.cancelUploadFrame();
  }

  async run(
    gate: (target: THREE.Object3D) => Promise<unknown>,
    uncovered: Promise<void>,
  ): Promise<boolean> {
    let released = false;
    const lifted = uncovered.then(() => {
      released = true;
      return false;
    });
    const covered = (): boolean => !released && !this.coverGone;
    const sky = this.sky.ensure(this.view.skyBiome).then((ok) => {
      this.skyReady = true;
      return ok;
    });
    const build = await this.build();
    if (build === 'stopped') return false;
    // `want` is read before the wait, so a fill started during it is gated by
    // the next round. Once the cover is gone, what exists is gated and a fill
    // landing later rides its own gated attach (realm_racers_track.ts).
    for (;;) {
      const want = this.fills.total;
      if (covered() && this.fills.done < want) {
        await Promise.race([this.fills.landed(), lifted]);
      }
      await gate(this.view.group).catch(() => undefined);
      if (!covered() || (this.fills.total === want && this.fills.done === want)) break;
    }
    this.gated = true;
    // The linked view's upload frame (drawn unculled, see `uploadFrame`)
    // uploads every vertex and instance buffer it shows: held until it
    // happened, so that lands under the curtain too. A view built elsewhere
    // proves its first visible frame, which uploads what the camera saw.
    if (covered() && this.view.onViewerLane()) {
      const lazy = lazyOf(this.view);
      const drawn = lazy ? lazy.uploadFrame().then(TRUE) : this.view.drawnOnce().then(TRUE);
      // The cover ended first: the upload frame is withdrawn, never drawn in
      // the open (an unculled, shadowless frame of the whole circuit).
      if (!(await Promise.race([drawn, lifted]))) lazy?.cancelUploadFrame();
    }
    this.drawn = true;
    const skyOk = await Promise.race([sky, lifted]);
    // A build with a failed piece still gates and shows what it built, and
    // reads as unproven.
    return skyOk && build === 'built';
  }

  /** Run what is left of the build at once: the seam calls it the frame its
   *  rule says the road is on screen (`buildNow`), so a piece waiting in the
   *  queue for frame headroom never keeps it off the lane. */
  hurry(): void {
    const job = this.job;
    if (!job || job.finished) return;
    while (!job.finished) this.stepPiece(job);
  }

  private stepPiece(job: RealmRacersTrackBuild): void {
    // A unit still queued after `hurry` finished the build runs nothing and
    // records nothing: a near-zero sample would teach the budget a false cost.
    if (job.finished) return;
    const kind = job.nextKind;
    this.buildCpu += timedPiece(this.host, `rally-${kind}`, () => job.step());
  }

  /** The view's build, a piece per queue unit and task, or to the end at once
   *  when the seam says so. `failed` when a piece threw (the rest was built,
   *  see `RealmRacersTrackBuild.step`), `stopped` when it never finished (its
   *  queue shut down under a renderer teardown, or the pool was given back). */
  private async build(): Promise<'built' | 'failed' | 'stopped'> {
    const lazy = lazyOf(this.view);
    if (!lazy) return 'built';
    const job = lazy.build();
    this.job = job;
    const id = this.view.circuitId;
    const startedAt = this.host.now();
    try {
      while (!job.finished) {
        if (this.buildNow()) {
          this.hurry();
          break;
        }
        await this.host.run(
          () => this.stepPiece(job),
          GPU_WORK_PRIORITY.LIVE_VIEW,
          `rally-build:${job.nextKind}:${id}`,
        );
        if (!job.finished) await this.host.yieldTask();
      }
    } catch (error) {
      if (isGpuQueueShutdown(error)) return 'stopped';
      // Any other queue failure: the lane still needs its road. Dev-channel
      // English, per the render i18n carve-out.
      console.warn('Realm Racers: circuit build queue failed', id, error);
      this.hurry();
    }
    if (!lazy.built) return 'stopped';
    this.buildMs = this.buildCpu;
    this.buildWallMs = this.host.now() - startedAt;
    return job.failures > 0 ? 'failed' : 'built';
  }
}

/** One client per authored circuit, minted on first ask; null for any other id. */
export function realmRacersCircuitClients(
  views: readonly RealmRacersCircuitView[],
  sky: Pick<RealmRacersSky, 'ensure'>,
  host: RealmRacersBuildHost = IMMEDIATE_BUILD_HOST,
  buildNow: (circuitId: string) => boolean = () => true,
): RealmRacersCircuitClients {
  const clients = new Map<string, RealmRacersCircuitPrepare>();
  return {
    circuitClient(circuitId) {
      const known = clients.get(circuitId);
      if (known) return known;
      const view = views.find((candidate) => candidate.circuitId === circuitId);
      if (!view) return null;
      const client = new RealmRacersCircuitPrepare(view, sky, host, () => buildNow(circuitId));
      clients.set(circuitId, client);
      return client;
    },
  };
}

/** The renderer's one call: the common client, the circuit clients, the
 *  reveal hold the tracks consult, and the gate a late model fill rides. */
export function prepareRealmRacersCircuits(
  seam: Pick<
    RealmRacersPrepare,
    'addClient' | 'useCircuits' | 'revealHeld' | 'worldGate' | 'buildNow'
  >,
  tracks: Pick<RealmRacersTracksView, 'circuits' | 'palette' | 'holdReveal' | 'gateFills'>,
  sky: Pick<RealmRacersSky, 'ensure'>,
  host: RealmRacersBuildHost = IMMEDIATE_BUILD_HOST,
): void {
  seam.addClient(
    new RealmRacersCommonPrepare(
      () => realmRacersCommonBuild(REALM_RACERS_CIRCUIT_LIST, tracks.palette),
      host,
    ),
  );
  seam.useCircuits(
    realmRacersCircuitClients(tracks.circuits, sky, host, (id) => seam.buildNow(id)),
  );
  tracks.holdReveal((circuitId) => seam.revealHeld(circuitId));
  tracks.gateFills(() => seam.worldGate());
}
