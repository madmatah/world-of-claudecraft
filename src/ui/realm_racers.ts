// The Realm Racers HUD composer: the window (realm_racers_window.ts), the race
// strip (realm_racers_strip_painter.ts), the standings panel, the podium and the
// loading-lobby curtain, plus the match edges that tie them together (the
// window closing at the flag, the circuit banner, the countdown cue, the
// pickup splash teardown) and the lobby's ready send. It paints nothing itself.

import type { RealmRacersPrepareProgress } from '../render/realm_racers_prepare';
import type { IWorld, RealmRacersInfo } from '../world_api';
import {
  buildRealmRacersLobbyView,
  createRealmRacersLobbyFailsafe,
  RealmRacersLobby,
  RealmRacersLobbyHold,
  RealmRacersRaceWarm,
  type RealmRacersRaceWarmSinks,
  stepRealmRacersLobbyFailsafe,
} from './hud/realm_racers';
import type { PainterHostWriters } from './painter_host';
import { realmRacersCircuitName } from './realm_racers_circuit_i18n';
import { RealmRacersPodium } from './realm_racers_podium_painter';
import { buildRealmRacersPodiumView } from './realm_racers_podium_view';
import { createRealmRacersReadySender, stepRealmRacersReady } from './realm_racers_ready_core';
import { RealmRacersStandingsPanel } from './realm_racers_standings_painter';
import { buildRealmRacersStandingsView } from './realm_racers_standings_view';
import { RealmRacersStrip } from './realm_racers_strip_painter';
import { buildRealmRacersHudView, type RallyControlAction } from './realm_racers_view';
import { RealmRacersWindow } from './realm_racers_window';
import { connectionDropActive } from './reconnect_overlay';
import { RALLY_RACE_ON_CLASS } from './root_state_classes';

export interface RealmRacersDeps {
  root(): HTMLElement;
  layer(): HTMLElement | null;
  world(): IWorld;
  closeOthers(): void;
  captureFocus(): HTMLElement | null;
  restoreFocus(target: HTMLElement | null): void;
  /**
   * The keys currently bound to a taught control, as display labels. Supplied
   * by the HUD rather than read here, so this module never reaches into the
   * game layer's keybind profile: the tutorial teaches the keys the player
   * actually has, not the defaults.
   */
  controlKeys(action: RallyControlAction): readonly string[];
  /** True on the touch HUD, where naming keys would be nonsense. */
  isTouchHud(): boolean;
  /** One sampled cue per authoritative countdown number. */
  countdownTick(): void;
  /**
   * The HUD's big centre-screen banner. Injected rather than reached for, the
   * same way `countdownTick` is: this module never imports `Hud`.
   */
  showBanner(text: string): void;
  /**
   * Takes the pickup splash down at once. This module owns the edge (it is the
   * one that knows when the race view disappears), the HUD owns the splash, so
   * the teardown is injected the same way the banner is.
   */
  clearPickupSplash(): void;
  writers: PainterHostWriters;
  /** This machine's race preparation, read from the HUD's current renderer so
   *  a graphics rebuild hands over the new seam. Asked only in the lobby, with
   *  the drawn circuit, whose own preparation the readout must include, and
   *  the match, so a new lobby never reads the last one's verdict. */
  prepareProgress(
    out: RealmRacersPrepareProgress,
    circuitId: string,
    matchId: number,
  ): RealmRacersPrepareProgress;
  /** A lost connection, which takes the lobby curtain down at once; the
   *  reconnect overlay's readout by default. */
  connectionDropped?(): boolean;
  /** The client clock the lobby failsafe and the strip's forfeit arm run on;
   *  performance.now by default. */
  now?(): number;
  /** Raise or drop one arrival-cover depth for the lobby curtain: the
   *  render-side cover, handed in by the HUD parts so no UI painter imports it. */
  setArrivalCover(active: boolean): void;
  /** Where the race warm sends the first-use sounds and icons it prepares on
   *  the commitment trigger; without it nothing is warmed. */
  raceWarm?: RealmRacersRaceWarmSinks;
}

const NOT_PREPARED: RealmRacersPrepareProgress = { done: 0, total: 0, settled: false };

export class RealmRacersUi {
  private readonly window: RealmRacersWindow;
  private readonly strip: RealmRacersStrip;
  private readonly standings: RealmRacersStandingsPanel;
  private readonly podium: RealmRacersPodium;
  private readonly lobby: RealmRacersLobby;
  /** The circuit banner waits for the lobby curtain to lift. */
  private bannerPending = false;
  private readonly prepared: RealmRacersPrepareProgress = { done: 0, total: 0, settled: false };
  /** What sendReady read this frame, reused by the paint half of the same frame. */
  private preparedThisFrame: RealmRacersPrepareProgress | null = null;
  /** The window and menu key hold the lobby curtain drives; Hud exposes it to
   *  the input paths as `lobbyHold`. */
  readonly lobbyHold = new RealmRacersLobbyHold();
  private readonly lobbyFailsafe = createRealmRacersLobbyFailsafe();
  private wasInMatch = false;
  private lastCountdown = 0;
  private readonly readySender = createRealmRacersReadySender();
  private readonly raceWarm: RealmRacersRaceWarm | null;

  constructor(private readonly deps: RealmRacersDeps) {
    this.raceWarm = deps.raceWarm ? new RealmRacersRaceWarm(deps.raceWarm) : null;
    this.window = new RealmRacersWindow(deps);
    this.strip = new RealmRacersStrip({
      layer: () => deps.layer(),
      writers: deps.writers,
      reset: () => deps.world().resetRealmRacersPosition(),
      forfeit: () => deps.world().forfeitRealmRacers(),
      now: () => this.now(),
    });
    this.standings = new RealmRacersStandingsPanel({
      layer: () => deps.layer(),
      writers: deps.writers,
    });
    this.podium = new RealmRacersPodium({
      layer: () => deps.layer(),
      writers: deps.writers,
    });
    this.lobby = new RealmRacersLobby({
      layer: () => deps.layer(),
      writers: deps.writers,
      hold: this.lobbyHold,
      setCover: deps.setArrivalCover,
    });
  }

  get isOpen(): boolean {
    return this.window.isOpen;
  }

  toggle(): void {
    this.window.toggle();
  }

  close(): void {
    this.window.close();
  }

  relocalize(): void {
    this.strip.relocalize();
    // The standings rows carry localized text of their own (the lap, the viewer
    // marker) behind a signature over the DATA, which a language flip cannot
    // move on its own.
    this.standings.relocalize();
    this.podium.relocalize();
    this.lobby.relocalize();
    this.window.relocalize();
  }

  /**
   * The lobby's ready send, and the race warm on the commitment trigger. It
   * paints nothing, so the HUD calls it above its paint cut: a hidden window
   * still says it is ready, and still warms.
   */
  sendReady(): void {
    const world = this.deps.world();
    this.raceWarm?.step(world);
    const info = world.realmRacersInfo;
    const prepared = this.preparedFor(info.match);
    this.preparedThisFrame = prepared;
    stepRealmRacersReady(this.readySender, info, prepared, () => world.readyRealmRacers());
  }

  /** Drop the lobby curtain's cover depth and key hold, and unmount it. */
  dispose(): void {
    this.lobby.dispose();
    this.markRaceOn(false);
  }

  private markRaceOn(on: boolean): void {
    this.deps.writers.toggleClass(document.body, RALLY_RACE_ON_CLASS, on);
  }

  private preparedFor(match: RealmRacersInfo['match']): RealmRacersPrepareProgress {
    return match?.phase === 'loading'
      ? this.deps.prepareProgress(this.prepared, match.circuitId, match.id)
      : NOT_PREPARED;
  }

  /** The client clock the lobby failsafe and the forfeit arm run on. */
  private now(): number {
    return this.deps.now?.() ?? performance.now();
  }

  /** The lobby curtain stands for the server's lobby, unless the connection
   *  dropped or the client failsafe ran out. */
  private lobbyCurtainStands(match: RealmRacersInfo['match']): boolean {
    if (!stepRealmRacersLobbyFailsafe(this.lobbyFailsafe, match, this.now())) return false;
    return !(this.deps.connectionDropped ?? connectionDropActive)();
  }

  /** The race strip, lobby curtain and countdown audio; Hud calls it every
   *  painted frame, and every write rides the elided writers. */
  update(): void {
    const world = this.deps.world();
    const info = world.realmRacersInfo;
    const prepared = this.preparedThisFrame ?? this.preparedFor(info.match);
    this.preparedThisFrame = null;
    const curtain = this.lobbyCurtainStands(info.match);
    this.lobby.update(buildRealmRacersLobbyView(curtain ? info.match : null, prepared));
    // Auto-close on the false -> true match edge only. The window is centered
    // over the viewport, so leaving it up would hide the circuit for the whole
    // countdown and race. An edge rather than a level check, so a player who
    // deliberately reopens the panel mid-race keeps it open.
    const inMatch = info.match !== null;
    if (inMatch && !this.wasInMatch) {
      this.window.closeForRace();
      // The circuit, big and centre-screen, on the one frame it is news. Driven
      // from STATE rather than from the `realmRacersFound` event, because the
      // name is what the banner says and the circuit rides the SNAPSHOT: the
      // server routes events before it broadcasts, so at the event the mirrored
      // match is still absent. Online this lands at most one snapshot later,
      // inside the nine-second countdown either way.
      //
      // This is the same rising edge that closes the queue window, so it fires
      // exactly once per race and re-arms for the next one (the match goes null
      // between races). Gated on the pre-race phase so a mid-race reconnect
      // restores a HUD without announcing a circuit the pilot has been driving
      // for a minute. A match seen in its loading lobby holds the banner until
      // the countdown, since the lobby curtain would cover it.
      const phase = info.match?.phase;
      this.bannerPending = phase === 'loading' || phase === 'countdown';
    }
    const match = info.match;
    if (this.bannerPending && match?.phase !== 'loading') {
      this.bannerPending = false;
      if (match?.phase === 'countdown') {
        // A circuit nothing names can only be a DRAFT registered by a dev
        // command (`tests/realm_racers_circuit_i18n.test.ts` pins that every
        // authored circuit has a name), so the raw id here is a developer
        // reading their own draft's id, never a player seeing a token.
        this.deps.showBanner(realmRacersCircuitName(match.circuitId) ?? match.circuitId);
      }
    }
    // The falling edge: the race view is gone, so a splash announcing a pickup
    // from it must not outlive it (a forfeit can end a race under one).
    if (!inMatch && this.wasInMatch) this.deps.clearPickupSplash();
    this.wasInMatch = inMatch;
    const countdown = info.match?.phase === 'countdown' ? info.match.countdown : 0;
    if (countdown > 0 && countdown !== this.lastCountdown) this.deps.countdownTick();
    this.lastCountdown = countdown;
    this.window.update();
    const hud = buildRealmRacersHudView(info);
    this.markRaceOn(hud.active);
    if (!hud.active) this.lastCountdown = 0;
    this.strip.update(hud);
    this.standings.update(buildRealmRacersStandingsView(info.match));
    this.podium.update(buildRealmRacersPodiumView(info.match));
  }
}
