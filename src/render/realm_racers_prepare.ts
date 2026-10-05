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
// pool; a queue join in a town never holds an unrelated arrival. A client
// that says it is `arrivalReady` (a circuit linked, its sky ready) stops
// holding it: what it still waits on is a presented frame, and a blocking
// arrival holds the world draw until it lifts. That wait only exists where
// the arrival wait is non-zero (offline, and the online first-spawn
// establishing shot); the online race lobby brings its own.
//
// Clients root only what they build at `prepare()`: an object added under a
// root after its gate ran is not covered by that gate. A client whose root
// fills in later (a circuit's dressing models) runs its own steps instead
// (`run`): it waits for the fill, then gates.
//
// Two kinds of client join the ones built with the seam: the procedural
// programs every circuit draws (`rallyCommon`, whose representatives are made
// from the circuit records, so it starts at the commitment trigger with no
// circuit known or built), and one client per circuit (`rallyCircuit:<id>`),
// asked of `RealmRacersCircuitClients` on the first frame that circuit is
// known: the viewer's own match from its loading lobby on, or, for a walker in
// the band with no race, the lane underfoot. NOTHING of a circuit exists
// before its client runs: building it is that client's first step
// (realm_racers_circuit_prepare.ts), spread across tasks only while the
// viewer's own lobby covers the world, and run to the end at once everywhere
// else (`buildNow`, `realmRacersBuildNow`): a login, a reconnect or a graphics
// rebuild mid-race builds on the renderer's first frame, still under the
// world-entry loading screen or the graphics curtain. Online, that login's gate
// then runs uncovered and links cold, as it always has. While a circuit's
// client has no verdict and a curtain covers the world (the arrival cover, or
// the viewer's own race still loading), its view stays hidden on the viewer's
// lane (`revealHeld`), so its first hidden-to-visible flip draws linked
// programs; uncovered it draws cold, never late.
//
// The race lobby reads `progress()` through the HUD's current renderer (so a
// graphics rebuild hands it the new seam): its progress bar is the unit tally,
// and its ready is sent once every client has a verdict, never on a clock. It
// names the drawn circuit, so a circuit client this seam has not asked for yet
// still counts as an unsettled unit whatever order the HUD and the renderer
// run in.
//
// A circuit is asked once per renderer, but a verdict does not always carry to
// the NEXT lobby on it: a run whose cover ended first (a lost connection, the
// failsafe, the cap) never drew its upload frame under it, and an unproven one
// proved nothing. A new lobby (a new match id) on such a circuit runs its client
// again, which keeps the build and redoes the gate, the upload frame and the sky
// under the new lobby's cover (`rerunDue`). The lobby names its match too, so a
// read that lands before the renderer's frame already counts it unsettled.

import type * as THREE from 'three';
import { isAtRealmRacersXZ, realmRacersLaneAt } from '../sim/realm_racers_layout';
import { arrivalCoverActive, registerRevealGateForArrival } from './arrival_cover';
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
  realmRacersBuildNow,
  realmRacersPrepareCircuit,
  realmRacersPrepareHolds,
  realmRacersPrepareSettledState,
  realmRacersRevealHeld,
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
  /** A client whose preparation is more than one gate over `prepare()`'s
   *  root runs its own steps with the gate and resolves whether the work
   *  beside the gate proved itself; the root's settle record is still read.
   *  `uncovered` resolves when the cover it races against ends (the lobby
   *  curtain falls, the arrival cover lifts): it then gates what exists and
   *  settles rather than wait on a fetch that may never land. Without a
   *  parallel compile it still runs, with a gate that resolves at once. */
  run?(
    gate: (target: THREE.Object3D) => Promise<unknown>,
    uncovered: Promise<void>,
  ): Promise<boolean>;
  /** True once the client's own view may be drawn (its programs linked), even
   *  before its verdict: a reveal hold lets go then. */
  revealReady?(): boolean;
  /** True once what an arrival curtain waits on is done (programs linked, sky
   *  ready), even before its verdict: what is left needs a PRESENTED frame,
   *  which a blocking arrival holds back until it lifts. */
  arrivalReady?(): boolean;
  /** Run what is left of the client's own build at once: called on the frame
   *  its circuit's build must stop waiting on the queue (`buildNow`). */
  hurry?(): void;
  /** The cover this client races has ended: called inside the seam frame that
   *  noticed it, before the frame's draw (the `uncovered` promise of `run`
   *  resolves only a microtask later). */
  coverEnded?(): void;
  /** Builds only for the gate (stand-ins), so without one it builds nothing. */
  readonly gateOnly?: boolean;
  /** True when a settled verdict does not carry to a NEW lobby on this
   *  client's circuit: its last run's cover ended before its upload frame drew
   *  under it. The seam then runs it again for that lobby (an unproven verdict
   *  is run again whatever this says). */
  rerunDue?(): boolean;
}

/** Where the seam gets the client of a circuit once that circuit is known;
 *  null for a circuit with no view to prepare (a dev draft). */
export interface RealmRacersCircuitClients {
  circuitClient(circuitId: string): RealmRacersPrepareClient | null;
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
  match: { practice: boolean; circuitId?: string; phase?: string; id?: number } | null;
}

export { rallyArrivalLifts } from './realm_racers_prepare_core';
export type { RealmRacersPrepareProgress, RealmRacersPrepareState, RealmRacersPrepareUnits };

export const REALM_RACERS_PREPARE_EVENT_PREFIX = 'realm-racers-prepare';

const TRUE = (): boolean => true;
const IMMEDIATE_GATE = (): Promise<void> => Promise.resolve();

type Gate = (target: THREE.Object3D) => Promise<unknown>;

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
  private circuits: RealmRacersCircuitClients | null = null;
  private readonly askedCircuits = new Set<string>();
  /** The viewer's match and the circuit of the lane underfoot, as of the last
   *  frame: what `buildNow` reads. */
  private viewerMatch: RealmRacersPrepareViewer['match'] = null;
  private laneCircuit: string | null = null;
  /** Circuit id to its client's id, and back. */
  private readonly circuitClientIds = new Map<string, string>();
  private readonly clientCircuits = new Map<string, string>();
  /** The in-flight clients racing a cover, released when it ends. */
  private readonly uncoverWaits = new Map<string, () => void>();
  private loadingCircuit: string | null = null;
  private lobbyCircuit: string | null = null;
  private lobbyCoverSeen = false;
  /** The match id of the last lobby a frame saw: a NEW lobby on a circuit
   *  already prepared runs its readiness again when the verdict will not carry
   *  (`rerunDue`). A circuit is otherwise prepared once per renderer. */
  private lastLobbyId: number | null = null;

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

  /** Hand the seam its circuit clients; asked per circuit as each is known. */
  useCircuits(circuits: RealmRacersCircuitClients): void {
    this.circuits = circuits;
  }

  /** The world gate once the seam has started (a fill that lands later rides
   *  it), undefined before or without a parallel compile. */
  worldGate(): Gate | undefined {
    return this.host?.worldCompileGate();
  }

  /** Whether the circuit's view stays hidden on the viewer's lane: its client
   *  has not linked it yet and a curtain covers the world. */
  revealHeld(circuitId: string): boolean {
    const id = this.circuitClientIds.get(circuitId);
    if (id === undefined) return false;
    if (this.clients.get(id)?.revealReady?.()) return false;
    return realmRacersRevealHeld(this.stateOf(id), this.coveredFor(circuitId));
  }

  /** Why the preparation started, or null while it has not. */
  get reason(): RealmRacersPrepareReason | null {
    return this.latch.reason;
  }

  stateOf(prepareId: string): RealmRacersPrepareState {
    return this.states.get(prepareId) ?? 'idle';
  }

  /** Units prepared over units to prepare, across every client, and whether
   *  every client has its verdict. A named circuit not asked for yet counts as
   *  one unsettled unit when it has a view to prepare. */
  progress(
    out: RealmRacersPrepareProgress,
    circuitId: string | null = null,
    matchId: number | null = null,
  ): RealmRacersPrepareProgress {
    beginRealmRacersPrepareTally(out, this.latch.reason !== null);
    // A lobby this seam's frame has not seen yet (the HUD reads first) whose
    // circuit will run again counts as not started, so no ready goes out on
    // the last lobby's verdict.
    const rerun =
      circuitId !== null && matchId !== null && matchId !== this.lastLobbyId
        ? this.rerunClient(circuitId)
        : null;
    for (const client of this.clients.values()) {
      const state = client === rerun ? 'idle' : this.stateOf(client.prepareId);
      addRealmRacersPrepareTally(out, state, client.units?.() ?? null);
    }
    if (circuitId !== null && !this.askedCircuits.has(circuitId)) {
      if (this.circuits?.circuitClient(circuitId)) addRealmRacersPrepareTally(out, 'idle', null);
    }
    return out;
  }

  heldImminentKeys(): number {
    if (!this.holding || this.inFlight === 0) return 0;
    let held = 0;
    for (const client of this.clients.values()) {
      if (this.stateOf(client.prepareId) !== 'preparing') continue;
      if (!client.arrivalReady?.()) held++;
    }
    return held;
  }

  /** Whether the circuit's build must run to the end now rather than a piece
   *  per task (`realmRacersBuildNow`): read by its client at every piece. */
  buildNow(circuitId: string): boolean {
    return realmRacersBuildNow(
      circuitId,
      this.viewerMatch,
      this.laneCircuit,
      this.coveredFor(circuitId),
    );
  }

  /** Per frame: one band test, plus a lane lookup in the band; a no-op past
   *  that once started with nothing in flight and the due circuit asked. */
  frame(host: RealmRacersPrepareHost, viewer: RealmRacersPrepareViewer, x: number, z: number) {
    const match = viewer.match;
    this.noteLobby(match?.phase === 'loading' ? (match.circuitId ?? null) : null);
    const lobbyId = match?.phase === 'loading' ? (match.id ?? null) : null;
    if (lobbyId !== null && lobbyId !== this.lastLobbyId) {
      this.lastLobbyId = lobbyId;
      const rerun = match?.circuitId ? this.rerunClient(match.circuitId) : null;
      if (rerun && this.host) this.start(this.host, rerun);
    }
    const inBand = isAtRealmRacersXZ(x, z);
    const underfoot = inBand ? (realmRacersLaneAt(x, z)?.circuit.id ?? null) : null;
    this.viewerMatch = match;
    this.laneCircuit = underfoot;
    const circuitId = realmRacersPrepareCircuit(match?.circuitId ?? null, underfoot);
    // The lane underfoot is asked too when a match names another circuit (a
    // finished race's viewer walking on): its walls collide, drawn or not.
    const laneDue =
      underfoot !== null && underfoot !== circuitId && !this.askedCircuits.has(underfoot);
    const circuitDue = laneDue || (circuitId !== null && !this.askedCircuits.has(circuitId));
    if (this.latch.reason !== null && this.inFlight === 0 && !circuitDue) return;
    const commitment = this.commitment;
    commitment.queued = viewer.queued;
    commitment.match = match;
    commitment.inBand = inBand;
    commitment.shot = this.anyClientBuilt();
    this.holding = realmRacersPrepareHolds(commitment);
    for (const id of this.uncoverWaits.keys()) {
      if (this.coveredFor(this.clientCircuits.get(id) ?? null)) continue;
      this.releaseCover(id);
    }
    // A build still spread over the queue whose road is now on screen (its
    // lobby's curtain fell, the viewer stepped onto it) finishes on this frame.
    for (const [circuit, clientId] of this.circuitClientIds) {
      if (this.stateOf(clientId) !== 'preparing' || !this.buildNow(circuit)) continue;
      this.clients.get(clientId)?.hurry?.();
    }
    if (takeRealmRacersPrepare(this.latch, commitment) !== null) {
      this.host = host;
      for (const client of this.clients.values()) this.start(host, client);
    }
    if (!circuitDue || this.latch.reason === null) return;
    if (circuitId !== null) this.askCircuit(circuitId);
    if (laneDue && underfoot !== null) this.askCircuit(underfoot);
  }

  /** The lobby arm of the cover: from the frame the viewer's race is loading
   *  until the lobby curtain raises its arrival-cover depth, since the renderer
   *  draws before the HUD paints the curtain. Once the curtain's depth has been
   *  seen, the depth alone speaks for it, so a curtain that falls (a lost
   *  connection) uncovers the circuit even while the phase still reads loading. */
  private noteLobby(loadingCircuit: string | null): void {
    this.loadingCircuit = loadingCircuit;
    if (loadingCircuit !== this.lobbyCircuit) {
      this.lobbyCircuit = loadingCircuit;
      this.lobbyCoverSeen = false;
    }
    if (loadingCircuit !== null && arrivalCoverActive()) this.lobbyCoverSeen = true;
  }

  private coveredFor(circuitId: string | null): boolean {
    if (arrivalCoverActive()) return true;
    return circuitId !== null && this.loadingCircuit === circuitId && !this.lobbyCoverSeen;
  }

  private askCircuit(circuitId: string): void {
    if (this.askedCircuits.has(circuitId)) return;
    this.askedCircuits.add(circuitId);
    const client = this.circuits?.circuitClient(circuitId) ?? null;
    if (!client) return;
    this.circuitClientIds.set(circuitId, client.prepareId);
    this.clientCircuits.set(client.prepareId, circuitId);
    if (!this.clients.has(client.prepareId)) this.addClient(client);
  }

  /** Tell a client its cover ended, synchronously, then resolve its wait. */
  private releaseCover(id: string): void {
    const release = this.uncoverWaits.get(id);
    if (!release) return;
    this.uncoverWaits.delete(id);
    this.clients.get(id)?.coverEnded?.();
    release();
  }

  /** The circuit's client when it has settled on a verdict that will not
   *  carry to a new lobby: unproven, or its cover ended before its upload frame
   *  drew. Null when it has no client, is still running, or is ready as is. */
  private rerunClient(circuitId: string): RealmRacersPrepareClient | null {
    const id = this.circuitClientIds.get(circuitId);
    const client = id === undefined ? undefined : this.clients.get(id);
    if (!client) return null;
    const state = this.stateOf(client.prepareId);
    if (!realmRacersPrepareSettledState(state)) return null;
    return state === 'unproven' || client.rerunDue?.() === true ? client : null;
  }

  private anyClientBuilt(): boolean {
    for (const client of this.clients.values()) if (client.built) return true;
    return false;
  }

  private start(host: RealmRacersPrepareHost, client: RealmRacersPrepareClient): void {
    const id = client.prepareId;
    const compile = host.worldCompileGate();
    if (!compile && (client.gateOnly || !client.run)) {
      // Without a parallel compile every first draw links anyway: a client
      // that builds only for the gate has nothing to build, whatever its steps.
      if (!client.gateOnly) client.prepare();
      this.states.set(id, 'unproven');
      return;
    }
    const root = client.prepare();
    const gate: Gate = compile ?? IMMEDIATE_GATE;
    this.states.set(id, 'preparing');
    this.inFlight++;
    const startedAt = gpuPrepNow();
    const key = `${REALM_RACERS_PREPARE_EVENT_PREFIX}:${this.latch.reason}:${id}`;
    const settle = (beside: boolean): void => {
      this.inFlight--;
      this.uncoverWaits.delete(id);
      const proven = beside && compileTargetPrepared(host.webgl.properties, root);
      this.states.set(id, proven ? 'proven' : 'unproven');
      recordGpuPrepEvent({
        kind: 'prepare',
        key,
        ageMs: gpuPrepNow() - startedAt,
        readyRoots: proven ? 1 : 0,
        totalRoots: 1,
      });
    };
    let work: Promise<boolean>;
    if (client.run) {
      let release: () => void = () => undefined;
      const uncovered = new Promise<void>((resolve) => {
        release = resolve;
      });
      this.uncoverWaits.set(id, release);
      work = client.run(gate, uncovered);
      // Started in the open (a walker, a login once its cover is gone): it
      // races no cover, so it is told at once rather than a frame later.
      if (this.uncoverWaits.has(id) && !this.coveredFor(this.clientCircuits.get(id) ?? null)) {
        this.releaseCover(id);
      }
    } else {
      work = gate(root).then(TRUE, TRUE);
    }
    work.then(
      (beside) => settle(beside === true),
      () => settle(false),
    );
  }
}
