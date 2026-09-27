// The race-only GPU producers' preparation seam. Each client builds, hidden,
// everything it can draw and hands back the root; this module sends that root
// through the renderer's world compile gate (live-gate at LIVE_VIEW: link
// pieces with their variant settle, the texture upload lane, the touch tail)
// on the frame the viewer commits to racing (realm_racers_prepare_core.ts says
// which frame), and reads the verdict off the settle record
// (compile_target_readiness.ts), never off a clock. The verdict is recorded as
// a `prepare` gpu-prep event keyed `realm-racers-prepare:<reason>:<client>`.
// Nothing is hidden while it runs: a client that draws before its proof draws
// cold, never late. A client that had to build itself for such a draw (a shot
// that beat the trigger) starts the seam on the next frame, so the rest of
// its pool still links off the live frame.
//
// While a preparation is in flight AND the viewer is seated or in the rally
// band, it holds the arrival curtain like an imminent reveal key
// (arrival_cover.ts), so a covered landing on the circuit lifts on a proved
// pool; a queue join in a town never holds an unrelated arrival. That wait
// only exists where the arrival wait is non-zero (offline, and the online
// first-spawn establishing shot); the online race lobby brings its own.
//
// Clients root only what they build at `prepare()`: an object added under a
// root after its gate ran is not covered by that gate.
//
// The race lobby reads `progress()` through the HUD's current renderer (so a
// graphics rebuild hands it the new seam): its progress bar is the unit tally,
// and its ready is sent once every client has a verdict, never on a clock.

import type * as THREE from 'three';
import { isAtRealmRacersXZ } from '../sim/realm_racers_layout';
import { registerRevealGateForArrival } from './arrival_cover';
import { compileTargetPrepared } from './compile_target_readiness';
import { gpuPrepNow, recordGpuPrepEvent } from './gpu_prep_events';
import {
  addRealmRacersPrepareTally,
  beginRealmRacersPrepareTally,
  createRealmRacersPrepareLatch,
  type RealmRacersCommitment,
  type RealmRacersPrepareProgress,
  type RealmRacersPrepareReason,
  type RealmRacersPrepareState,
  type RealmRacersPrepareUnits,
  realmRacersPrepareHolds,
  takeRealmRacersPrepare,
} from './realm_racers_prepare_core';
import type { TexturePropertiesLike } from './texture_prep_core';

export interface RealmRacersPrepareClient {
  /** Stable id, unique per seam: the key of its state and its event. */
  readonly prepareId: string;
  /** True once the client built its drawables on its own, because a draw
   *  came before the seam asked. */
  readonly built: boolean;
  /** Build, hidden, every object this producer draws and return the root
   *  holding them. Idempotent. */
  prepare(): THREE.Object3D;
  /** A client that prepares in several steps reports them; one without
   *  counts as a single unit, done at its verdict. */
  units?(): RealmRacersPrepareUnits;
}

/** What the seam needs of the renderer: its world gate (undefined without a
 *  parallel compile, where every first draw links anyway) and the property
 *  records the settle proof reads. */
export interface RealmRacersPrepareHost {
  worldCompileGate(): ((target: THREE.Object3D) => Promise<unknown>) | undefined;
  readonly webgl: { readonly properties: TexturePropertiesLike };
}

/** The slice of `IWorld.realmRacersInfo` the trigger reads. */
export interface RealmRacersPrepareViewer {
  queued: boolean;
  match: { practice: boolean } | null;
}

export type { RealmRacersPrepareProgress, RealmRacersPrepareState, RealmRacersPrepareUnits };

export const REALM_RACERS_PREPARE_EVENT_PREFIX = 'realm-racers-prepare';

export class RealmRacersPrepare {
  private readonly latch = createRealmRacersPrepareLatch();
  private readonly commitment: RealmRacersCommitment = {
    queued: false,
    match: null,
    inBand: false,
    shot: false,
  };
  private readonly clients = new Map<string, RealmRacersPrepareClient>();
  private readonly states = new Map<string, RealmRacersPrepareState>();
  private host: RealmRacersPrepareHost | null = null;
  private inFlight = 0;
  private holding = false;

  constructor(clients: readonly RealmRacersPrepareClient[] = []) {
    for (const client of clients) this.addClient(client);
    registerRevealGateForArrival(this);
  }

  /** Register a producer. Once the seam has started, it starts at once. */
  addClient(client: RealmRacersPrepareClient): void {
    if (this.clients.has(client.prepareId)) {
      throw new Error(`duplicate race prepare client ${client.prepareId}`);
    }
    this.clients.set(client.prepareId, client);
    this.states.set(client.prepareId, 'idle');
    if (this.latch.reason !== null && this.host) this.start(this.host, client);
  }

  /** Why the preparation started, or null while it has not. */
  get reason(): RealmRacersPrepareReason | null {
    return this.latch.reason;
  }

  stateOf(prepareId: string): RealmRacersPrepareState {
    return this.states.get(prepareId) ?? 'idle';
  }

  /** Units prepared over units to prepare, across every client, and whether
   *  every client has its verdict. */
  progress(out: RealmRacersPrepareProgress): RealmRacersPrepareProgress {
    beginRealmRacersPrepareTally(out, this.latch.reason !== null);
    for (const client of this.clients.values()) {
      addRealmRacersPrepareTally(out, this.stateOf(client.prepareId), client.units?.() ?? null);
    }
    return out;
  }

  heldImminentKeys(): number {
    return this.holding ? this.inFlight : 0;
  }

  /** Per frame: a no-op once started with nothing in flight; one band test
   *  otherwise. */
  frame(host: RealmRacersPrepareHost, viewer: RealmRacersPrepareViewer, x: number, z: number) {
    if (this.latch.reason !== null && this.inFlight === 0) return;
    const commitment = this.commitment;
    commitment.queued = viewer.queued;
    commitment.match = viewer.match;
    commitment.inBand = isAtRealmRacersXZ(x, z);
    commitment.shot = this.anyClientBuilt();
    this.holding = realmRacersPrepareHolds(commitment);
    if (takeRealmRacersPrepare(this.latch, commitment) === null) return;
    this.host = host;
    for (const client of this.clients.values()) this.start(host, client);
  }

  private anyClientBuilt(): boolean {
    for (const client of this.clients.values()) if (client.built) return true;
    return false;
  }

  private start(host: RealmRacersPrepareHost, client: RealmRacersPrepareClient): void {
    const id = client.prepareId;
    const root = client.prepare();
    const gate = host.worldCompileGate();
    if (!gate) {
      this.states.set(id, 'unproven');
      return;
    }
    this.states.set(id, 'preparing');
    this.inFlight++;
    const startedAt = gpuPrepNow();
    const key = `${REALM_RACERS_PREPARE_EVENT_PREFIX}:${this.latch.reason}:${id}`;
    const settle = (): void => {
      this.inFlight--;
      const proven = compileTargetPrepared(host.webgl.properties, root);
      this.states.set(id, proven ? 'proven' : 'unproven');
      recordGpuPrepEvent({
        kind: 'prepare',
        key,
        ageMs: gpuPrepNow() - startedAt,
        readyRoots: proven ? 1 : 0,
        totalRoots: 1,
      });
    };
    gate(root).then(settle, settle);
  }
}
