// Thin DOM painter for The Realm Racers window, its practice setup screen,
// and the race HUD. The pure view module owns state decisions; this class only
// renders, wires actions, and maintains dialog focus.

import type { RealmRacersPrepareProgress } from '../render/realm_racers_prepare';
import type { IWorld, RallyDriverTier, RealmRacersInfo } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import {
  buildRealmRacersLobbyView,
  createRealmRacersLobbyFailsafe,
  RealmRacersLobby,
  RealmRacersLobbyHold,
  RealmRacersRaceWarm,
  type RealmRacersRaceWarmSinks,
  stepRealmRacersLobbyFailsafe,
} from './hud/realm_racers';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { realmRacersCircuitName } from './realm_racers_circuit_i18n';
import { RealmRacersPodium } from './realm_racers_podium_painter';
import { buildRealmRacersPodiumView } from './realm_racers_podium_view';
import { createRealmRacersReadySender, stepRealmRacersReady } from './realm_racers_ready_core';
import { RealmRacersStandingsPanel } from './realm_racers_standings_painter';
import {
  buildRealmRacersStandingsView,
  type RealmRacersStandingsView,
} from './realm_racers_standings_view';
import {
  buildRealmRacersHudView,
  buildRealmRacersSetupView,
  buildRealmRacersWindowView,
  RALLY_DEFAULT_PRACTICE_TIER,
  type RallyControlAction,
  type RealmRacersHudView,
  type RealmRacersSetupView,
  type RealmRacersWindowView,
} from './realm_racers_view';
import { connectionDropActive } from './reconnect_overlay';
import { RALLY_RACE_ON_CLASS } from './root_state_classes';
import { svgIcon } from './ui_icons';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** Difficulty tier -> its copy keys. Closed maps, so an unlabelled tier is a
 *  compile error rather than a button reading its own wire token. */
const TIER_LABEL_KEYS: Record<RallyDriverTier, TranslationKey> = {
  rookie: 'hudChrome.rally.tierRookie',
  driver: 'hudChrome.rally.tierDriver',
  ace: 'hudChrome.rally.tierAce',
};
const TIER_HINT_KEYS: Record<RallyDriverTier, TranslationKey> = {
  rookie: 'hudChrome.rally.tierRookieHint',
  driver: 'hudChrome.rally.tierDriverHint',
  ace: 'hudChrome.rally.tierAceHint',
};

/** Taught control -> its copy keys. Same closed-map rule. */
const CONTROL_COPY: Record<RallyControlAction, { label: TranslationKey; hint: TranslationKey }> = {
  throttle: {
    label: 'hudChrome.rally.controlThrottle',
    hint: 'hudChrome.rally.controlThrottleHint',
  },
  brake: { label: 'hudChrome.rally.controlBrake', hint: 'hudChrome.rally.controlBrakeHint' },
  steer: { label: 'hudChrome.rally.controlSteer', hint: 'hudChrome.rally.controlSteerHint' },
  handbrake: {
    label: 'hudChrome.rally.controlHandbrake',
    hint: 'hudChrome.rally.controlHandbrakeHint',
  },
};

function tierLabel(tier: RallyDriverTier): string {
  return t(TIER_LABEL_KEYS[tier]);
}

/**
 * How long the strip's forfeit control stays armed after the first press. A race
 * is driven at speed with a thumb on a small target, so ending one takes two
 * presses inside this window; the arm lapses back to the idle label on its own.
 * Presentation-only state: it never reaches the sim.
 */
const FORFEIT_ARM_MS = 3000;

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
   *  the drawn circuit, whose own preparation the readout must include. */
  prepareProgress(out: RealmRacersPrepareProgress, circuitId: string): RealmRacersPrepareProgress;
  /** A lost connection, which takes the lobby curtain down at once; the
   *  reconnect overlay's readout by default. */
  connectionDropped?(): boolean;
  /** The client clock the lobby failsafe runs on; performance.now by default. */
  now?(): number;
  /** Where the race warm sends the first-use sounds and icons it prepares on
   *  the commitment trigger; without it nothing is warmed. */
  raceWarm?: RealmRacersRaceWarmSinks;
  /** Where RALLY_RACE_ON_CLASS is marked; document.body by default. */
  stateRoot?(): HTMLElement | null;
}

const NOT_PREPARED: RealmRacersPrepareProgress = { done: 0, total: 0, settled: false };

export class RealmRacersUi {
  private lastWindowSig = '';
  private lastHudSig = '';
  private openerFocus: HTMLElement | null = null;
  private hudRoot: HTMLElement | null = null;
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
  /** The off-screen live region that SPEAKS the drawn circuit. Kept outside the
   *  strip's rebuilt subtree so a rebuild cannot re-announce. */
  private announceEl: HTMLElement | null = null;
  /** The drawn circuit's localized name, resolved once per strip rebuild rather
   *  than per frame. Safe to cache against the language: the strip's signature
   *  starts with the match id, and `relocalize()` clears it, so a language flip
   *  re-resolves through the same path a new race does. */
  private circuitName: string | null = null;
  private lapEl: HTMLElement | null = null;
  private positionEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private speedEl: HTMLElement | null = null;
  private wardEl: HTMLElement | null = null;
  private wrongWayEl: HTMLElement | null = null;
  private limitsEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private resetEl: HTMLElement | null = null;
  private forfeitEl: HTMLElement | null = null;
  private forfeitArmedUntil = 0;
  private wasInMatch = false;
  private lastCountdown = 0;
  private readonly readySender = createRealmRacersReadySender();
  private readonly raceWarm: RealmRacersRaceWarm | null;
  /**
   * The practice setup screen's own state, presentation-only: whether the
   * player has stepped into it, and which rival they have picked. Neither ever
   * reaches the sim, and both reset when the window closes, so re-opening the
   * panel always lands on the front screen.
   */
  private setupOpen = false;
  private setupTier: RallyDriverTier = RALLY_DEFAULT_PRACTICE_TIER;

  constructor(private readonly deps: RealmRacersDeps) {
    this.raceWarm = deps.raceWarm ? new RealmRacersRaceWarm(deps.raceWarm) : null;
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
    });
  }

  get isOpen(): boolean {
    return this.deps.root().style.display === 'block';
  }

  toggle(): void {
    if (this.isOpen) {
      this.close();
      return;
    }
    this.deps.closeOthers();
    this.openerFocus = this.deps.captureFocus();
    const root = this.deps.root();
    markDialogRoot(root, { labelledBy: 'realm-racers-title' });
    root.style.display = 'block';
    this.lastWindowSig = '';
    this.renderWindow();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    root.style.display = 'none';
    this.deps.restoreFocus(this.openerFocus);
    this.openerFocus = null;
  }

  relocalize(): void {
    this.lastWindowSig = '';
    this.lastHudSig = '';
    // The standings rows carry localized text of their own (the lap, the viewer
    // marker) behind a signature over the DATA, which a language flip cannot
    // move on its own.
    this.standings.relocalize();
    this.podium.relocalize();
    this.lobby.relocalize();
    if (this.isOpen) this.renderWindow();
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
    const stateRoot = this.deps.stateRoot ? this.deps.stateRoot() : document.body;
    if (stateRoot) this.deps.writers.toggleClass(stateRoot, RALLY_RACE_ON_CLASS, on);
  }

  private preparedFor(match: RealmRacersInfo['match']): RealmRacersPrepareProgress {
    return match?.phase === 'loading'
      ? this.deps.prepareProgress(this.prepared, match.circuitId)
      : NOT_PREPARED;
  }

  /** The lobby curtain stands for the server's lobby, unless the connection
   *  dropped or the client failsafe ran out. */
  private lobbyCurtainStands(match: RealmRacersInfo['match']): boolean {
    const now = this.deps.now?.() ?? performance.now();
    if (!stepRealmRacersLobbyFailsafe(this.lobbyFailsafe, match, now)) return false;
    return !(this.deps.connectionDropped ?? connectionDropActive)();
  }

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
      // The setup screen has done its job the moment the flag is up: leaving it
      // armed would put the player back on it after the race.
      this.setupOpen = false;
      if (this.isOpen) this.close();
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
    if (this.isOpen) this.renderWindow();
    this.renderHud(buildRealmRacersHudView(info), buildRealmRacersStandingsView(info.match));
    this.podium.update(buildRealmRacersPodiumView(info.match));
  }

  private renderWindow(): void {
    const info = this.deps.world().realmRacersInfo;
    // The setup screen is a second SCREEN of this window, not a second window:
    // it replaces the body, keeps the same frame, header and close control, and
    // is only reachable while nothing is racing.
    const view = this.setupOpen && info.match === null ? null : buildRealmRacersWindowView(info);
    const setup = view
      ? null
      : buildRealmRacersSetupView(
          info,
          this.setupTier,
          (action) => this.deps.controlKeys(action),
          this.deps.isTouchHud(),
        );
    const sig = view ? view.sig : (setup as RealmRacersSetupView).sig;
    if (sig === this.lastWindowSig) return;
    this.lastWindowSig = sig;
    const root = this.deps.root();
    root.innerHTML = view ? this.windowHtml(view) : this.setupHtml(setup as RealmRacersSetupView);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelector('[data-rally-join]')?.addEventListener('click', () => {
      this.deps.world().joinRealmRacersQueue();
    });
    root.querySelector('[data-rally-leave]')?.addEventListener('click', () => {
      this.deps.world().leaveRealmRacersQueue();
    });
    root.querySelector('[data-rally-forfeit]')?.addEventListener('click', () => {
      this.deps.world().forfeitRealmRacers();
    });
    root.querySelector('[data-rally-practice-open]')?.addEventListener('click', () => {
      this.setupOpen = true;
      this.repaint();
    });
    root.querySelector('[data-rally-practice-back]')?.addEventListener('click', () => {
      this.setupOpen = false;
      this.repaint();
    });
    root.querySelector('[data-rally-practice-play]')?.addEventListener('click', () => {
      this.deps.world().startRealmRacersPractice(this.setupTier);
    });
    for (const button of root.querySelectorAll('[data-rally-tier]')) {
      const tier = (button as HTMLElement).dataset.rallyTier as RallyDriverTier;
      button.addEventListener('click', () => {
        this.setupTier = tier;
        this.repaint();
      });
    }
  }

  /** Force the next render even though the world has not moved: the setup
   *  screen's state is the painter's own, so no world signature would change. */
  private repaint(): void {
    this.lastWindowSig = '';
    if (this.isOpen) this.renderWindow();
  }

  /**
   * The practice setup screen. It exists so the start countdown is not the
   * first time a player meets the machine: by the time the flag falls they have
   * chosen a rival and been told what every control does, in the keys they
   * personally have bound rather than the defaults.
   */
  private setupHtml(view: RealmRacersSetupView): string {
    const tiers = view.tiers
      .map(
        (option) =>
          `<button type="button" class="rally-tier${option.selected ? ' selected' : ''}" ` +
          `data-rally-tier="${esc(option.tier)}" aria-pressed="${option.selected}">` +
          `<strong>${esc(tierLabel(option.tier))}</strong>` +
          `<span>${esc(t(TIER_HINT_KEYS[option.tier]))}</span></button>`,
      )
      .join('');
    const controls = view.controls
      .map((row) => {
        const copy = CONTROL_COPY[row.action];
        const keys = row.keys
          .map((key) => `<kbd class="rally-key">${esc(key)}</kbd>`)
          .join(`<span class="rally-key-sep">/</span>`);
        return (
          `<div class="rally-control"><div class="rally-control-copy">` +
          `<strong>${esc(t(copy.label))}</strong>` +
          `<span>${esc(t(copy.hint))}</span></div>` +
          `<div class="rally-control-keys">${keys}</div></div>`
        );
      })
      .join('');
    const play = view.available
      ? `<button type="button" class="btn btn-primary rally-cta rally-play" data-rally-practice-play>` +
        `${esc(t('hudChrome.rally.practicePlay'))}</button>`
      : `<div class="rally-status queued">${esc(t('hudChrome.rally.practiceUnavailable'))}</div>`;
    // Which circuit practice runs, and that competition runs a different one.
    // The trade is the pool's, not a detail: a pilot learns the machine here
    // and meets the map for the first time on the grid.
    const circuit = realmRacersCircuitName(view.circuitId);
    const circuitLine = circuit
      ? `<p class="rally-setup-circuit">${esc(t('hudChrome.rally.practiceCircuit', { circuit }))}</p>`
      : '';
    return (
      `${this.headerHtml()}<div class="rally-body rally-setup">` +
      `<p class="rally-setup-intro">${esc(t('hudChrome.rally.practiceIntro'))}</p>` +
      circuitLine +
      `<h3 class="rally-legend">${esc(t('hudChrome.rally.practiceTierLegend'))}</h3>` +
      `<div class="rally-tiers">${tiers}</div>` +
      `<h3 class="rally-legend">${esc(t('hudChrome.rally.practiceControlsLegend'))}</h3>` +
      `<div class="rally-controls">${controls}</div>` +
      (view.touch
        ? `<p class="rally-touch-note">${esc(t('hudChrome.rally.practiceTouchNote'))}</p>`
        : '') +
      `<div class="rally-setup-actions">` +
      `<button type="button" class="btn rally-back" data-rally-practice-back>${esc(t('hudChrome.rally.practiceBack'))}</button>` +
      `${play}</div></div>`
    );
  }

  /** The house window grammar (.panel-title + .x-btn, see src/styles/layout.css)
   *  on the window family's head (DESIGN.md 8.1): it is what carries the sticky
   *  header, the titlebar drag, and the pinned close control every other window
   *  has. The society line is the subtitle, outside the span the dialog is named
   *  by. Shared by both screens, so stepping into the setup never loses the
   *  frame's chrome. */
  private headerHtml(): string {
    return (
      `<div class="panel-title ui-win-head"><span class="ui-win-title">` +
      `<span id="realm-racers-title">${esc(t('hudChrome.rally.title'))}</span>` +
      `<span class="ui-win-sub">${esc(t('hudChrome.rally.kicker'))}</span></span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.rally.close'))}">${svgIcon('close')}</button>` +
      `</div>`
    );
  }

  /**
   * The one Practice control on the front screen. It opens the setup screen
   * rather than starting a race, and it rides ALONGSIDE the queue controls
   * (including while queued, which the sim treats as "race now" and takes the
   * player out of the queue for), because a player alone on the realm should
   * never have to find out the hard way that nobody else is waiting.
   *
   * Disabled when the realm has handed out every practice copy, the same
   * availability the setup screen's Play control honors: a button that opens a
   * screen whose only action is refused would be a two-click way to learn "no".
   */
  private practiceButtonHtml(available: boolean): string {
    return (
      `<div class="rally-or"><span>${esc(t('hudChrome.rally.orRace'))}</span></div>` +
      `<button type="button" class="btn rally-cta rally-practice-cta" data-rally-practice-open${available ? '' : ' disabled'}>` +
      `${esc(t('hudChrome.rally.practice'))}</button>`
    );
  }

  private windowHtml(view: RealmRacersWindowView): string {
    const header = this.headerHtml();
    // Atmosphere first, then a short control primer. No pilot counts and no lap
    // counts: those change with circuits and formats, and the front screen has
    // to stay true when they do. The crest is a mark, not a roman numeral.
    const rules =
      `<div class="rally-hero">` +
      `<div class="rally-hero-mark" aria-hidden="true"><span class="rally-crest"></span></div>` +
      `<div class="rally-hero-copy">` +
      `<p class="rally-pitch">${esc(t('hudChrome.rally.pitch'))}</p>` +
      `<ul class="rally-promises">` +
      `<li>${esc(t('hudChrome.rally.promiseCircuit'))}</li>` +
      `<li>${esc(t('hudChrome.rally.promiseSlide'))}</li>` +
      `<li>${esc(t('hudChrome.rally.promiseRival'))}</li>` +
      `</ul></div></div>` +
      `<div class="rally-howto"><strong>${esc(t('hudChrome.rally.howToPlayTitle'))}</strong>` +
      `<span>${esc(t('hudChrome.rally.howToPlay'))}</span></div>`;
    let action = '';
    if (view.kind === 'idle') {
      // A queue that can never seat a race (the offline world) keeps its button
      // visible but disabled, with one line saying why and where to race
      // instead: hiding it would read as a missing feature, and an enabled
      // button would hold the player in a wait that cannot end.
      const status = view.queueViable
        ? `<div class="rally-status">${esc(t('hudChrome.rally.waiting', { count: num(view.queueSize) }))}</div>`
        : `<div class="rally-status">${esc(t('hudChrome.rally.queueNeedsRealm'))}</div>`;
      action =
        status +
        `<button type="button" class="btn btn-primary rally-cta" data-rally-join${view.queueViable ? '' : ' disabled'}>${esc(t('hudChrome.rally.join'))}</button>` +
        this.practiceButtonHtml(view.practiceAvailable);
    } else if (view.kind === 'queued') {
      action =
        `<div class="rally-status queued">${esc(t('hudChrome.rally.queued', { position: num(view.position), count: num(view.queueSize) }))}</div>` +
        `<button type="button" class="btn rally-cta leave" data-rally-leave>${esc(t('hudChrome.rally.leave'))}</button>` +
        this.practiceButtonHtml(view.practiceAvailable);
    } else {
      const placing = { position: num(view.position), total: num(view.gridSize) };
      const live = view.practice
        ? t('hudChrome.rally.racingAgainstBot', placing)
        : t('hudChrome.rally.racingAgainst', placing);
      const status =
        view.phase === 'finished'
          ? view.result === 'void'
            ? t('hudChrome.rally.raceVoid')
            : view.result === 'won'
              ? t('hudChrome.rally.won')
              : view.result === 'draw'
                ? t('hudChrome.rally.draw')
                : t('hudChrome.rally.lost', placing)
          : live;
      action =
        `<div class="rally-status live">${esc(status)}</div>` +
        (view.phase === 'finished'
          ? ''
          : `<button type="button" class="btn rally-cta leave" data-rally-forfeit>${esc(t('hudChrome.rally.forfeit'))}</button>`);
    }
    return `${header}<div class="rally-body">${rules}${action}</div>`;
  }

  private renderHud(view: RealmRacersHudView, standings: RealmRacersStandingsView): void {
    const w = this.deps.writers;
    this.markRaceOn(view.active);
    if (!view.active) {
      if (this.hudRoot) w.setDisplay(this.hudRoot, 'none');
      this.standings.update(standings);
      this.forfeitArmedUntil = 0;
      this.lastCountdown = 0;
      // Reset the announcement with the strip, so back-to-back races on the
      // SAME circuit are each announced rather than elided into silence by the
      // second one writing what is already there.
      this.circuitName = null;
      if (this.announceEl) w.setText(this.announceEl, '');
      return;
    }
    const root = this.ensureHud();
    if (!root) return;
    w.setDisplay(root, 'block');
    if (view.sig !== this.lastHudSig) {
      this.lastHudSig = view.sig;
      this.forfeitArmedUntil = 0;
      // Competition DRAWS its circuit the moment the grid fills, so the pill at
      // the head of the strip carries the circuit's name for the whole race
      // instead of the minigame's: nobody chose this circuit, the player has to
      // be told which one they got before the flag drops, and "Realm Racers" is
      // not news to someone already sitting on the grid. It falls back to the
      // minigame title for a circuit nothing names (a dev draft), because the
      // pill can never be empty.
      //
      // Resolved BEFORE the skeleton is built: both the pill and the announcer
      // below read it, and they must not be able to disagree.
      this.circuitName = realmRacersCircuitName(view.circuitId);
      root.innerHTML =
        `<div class="rallyhud-top">` +
        `<span class="rallyhud-title">${esc(this.circuitName ?? t('hudChrome.rally.title'))}</span></div>` +
        `<div class="rallyhud-stats"><span class="rallyhud-position"></span>` +
        `<span class="rallyhud-lap"></span><span class="rallyhud-time"></span>` +
        `<span class="rallyhud-speed"></span></div>` +
        `<div class="rallyhud-actions">` +
        (view.canReset
          ? `<button type="button" class="rallyhud-reset" data-rally-hud-reset${view.resetLocked ? ' disabled' : ''}></button>`
          : '') +
        (view.canForfeit
          ? `<button type="button" class="rallyhud-forfeit" data-rally-hud-forfeit></button>`
          : '') +
        `</div>` +
        `<div class="rallyhud-ward" role="status" aria-live="polite"></div>` +
        `<div class="rallyhud-wrong-way" role="alert" aria-live="assertive"></div>` +
        `<div class="rallyhud-limits" role="status" aria-live="polite"></div>` +
        `<div class="rallyhud-phase" aria-live="polite"></div>`;
      this.positionEl = root.querySelector('.rallyhud-position');
      this.lapEl = root.querySelector('.rallyhud-lap');
      this.timeEl = root.querySelector('.rallyhud-time');
      this.speedEl = root.querySelector('.rallyhud-speed');
      this.wardEl = root.querySelector('.rallyhud-ward');
      this.wrongWayEl = root.querySelector('.rallyhud-wrong-way');
      this.limitsEl = root.querySelector('.rallyhud-limits');
      this.phaseEl = root.querySelector('.rallyhud-phase');
      this.resetEl = root.querySelector('.rallyhud-reset');
      this.forfeitEl = root.querySelector('.rallyhud-forfeit');
      this.resetEl?.addEventListener('click', () => this.deps.world().resetRealmRacersPosition());
      this.forfeitEl?.addEventListener('click', () => this.pressForfeit());
    }
    this.standings.update(standings);
    // The pill is a VISUAL swap, and a swapped label is not an announcement: a
    // screen-reader user would otherwise first learn the circuit at the podium,
    // after the race. The announcer is an off-screen live region that lives
    // OUTSIDE the strip's rebuilt subtree, so the countdown-to-racing rebuild
    // cannot re-announce, and the write is elided, so it speaks exactly once per
    // race. Cleared when the strip goes down, so the next race announces even
    // when the draw lands on the same circuit.
    const announcer = this.ensureAnnouncer();
    if (announcer) w.setText(announcer, this.circuitName ?? '');
    if (this.positionEl)
      w.setText(
        this.positionEl,
        t('hudChrome.rally.position', {
          position: num(view.position),
          total: num(view.gridSize),
        }),
      );
    if (this.lapEl)
      w.setText(
        this.lapEl,
        t('hudChrome.rally.lap', { lap: num(view.lap), total: num(view.totalLaps) }),
      );
    if (this.timeEl) {
      const minutes = Math.floor(view.elapsed / 60);
      const seconds = Math.floor(view.elapsed % 60);
      w.setText(
        this.timeEl,
        t('hudChrome.rally.time', {
          minutes: num(minutes),
          seconds: String(seconds).padStart(2, '0'),
        }),
      );
    }
    if (this.speedEl)
      w.setText(this.speedEl, t('hudChrome.rally.speed', { speed: num(view.speed) }));
    if (this.wardEl) {
      // Written even while hidden, so a locale flip lands on the text. Visibility
      // rides setStyleProp, whose own (element, 'display') slot keeps the two
      // writes eliding independently (the same shape the limits line below uses).
      w.setText(
        this.wardEl,
        view.wardIn > 0
          ? t('hudChrome.rally.wardHeldFor', { seconds: num(view.wardIn) })
          : t('hudChrome.rally.wardHeld'),
      );
      w.setStyleProp(this.wardEl, 'display', view.warded ? 'block' : 'none');
    }
    if (this.wrongWayEl) {
      w.setText(this.wrongWayEl, t('hudChrome.rally.wrongWay'));
      w.setStyleProp(this.wrongWayEl, 'display', view.wrongWay ? 'block' : 'none');
    }
    if (this.limitsEl) {
      // The text is written even while the line is hidden, so a locale flip
      // lands on it; visibility rides its own setStyleProp slot.
      w.setText(
        this.limitsEl,
        view.trackLimit === 'cutReturned'
          ? t('hudChrome.rally.cutReturned')
          : t('hudChrome.rally.offTrack', { seconds: num(view.offTrackIn) }),
      );
      w.setStyleProp(this.limitsEl, 'display', view.trackLimit === 'none' ? 'none' : 'block');
    }
    if (this.resetEl) {
      w.setText(this.resetEl, t('hudChrome.rally.reset'));
      const resetButton = this.resetEl as HTMLButtonElement;
      if (resetButton.disabled !== view.resetLocked) resetButton.disabled = view.resetLocked;
    }
    if (this.phaseEl) {
      const phase =
        view.phase === 'loading' || view.phase === 'countdown'
          ? view.countdown > 0
            ? t('hudChrome.rally.countdown', { seconds: num(view.countdown) })
            : ''
          : view.phase === 'finished'
            ? // The podium carries the result headline and the return
              // countdown once the RACE is over, so this line stands down
              // rather than saying the same thing twice. A pilot who merely
              // quit still gets it here: there is no ceremony for them, and
              // neither is there for a void race.
              view.voided
              ? t('hudChrome.rally.voidReturn', { seconds: num(view.returnIn) })
              : view.decided
                ? ''
                : view.result === 'won'
                  ? t('hudChrome.rally.wonReturn', { seconds: num(view.returnIn) })
                  : view.result === 'draw'
                    ? t('hudChrome.rally.drawReturn', { seconds: num(view.returnIn) })
                    : t('hudChrome.rally.lostReturn', { seconds: num(view.returnIn) })
            : // The winner is home and this pilot is not: they are racing a
              // clock now, and it says so rather than cutting them off unwarned.
              view.chaseIn > 0
              ? t('hudChrome.rally.chase', { seconds: num(view.chaseIn) })
              : view.lap === view.totalLaps
                ? t('hudChrome.rally.finalLap')
                : t('hudChrome.rally.go');
      w.setText(this.phaseEl, phase);
    }
    if (this.forfeitEl) {
      const armed = this.forfeitArmedUntil > Date.now();
      w.setText(
        this.forfeitEl,
        armed ? t('hudChrome.rally.forfeitConfirm') : t('hudChrome.rally.forfeit'),
      );
      w.toggleClass(this.forfeitEl, 'armed', armed);
    }
  }

  // Two-step: the first press arms, a second press inside the window forfeits,
  // and a press after it lapses re-arms instead of ending the race.
  private pressForfeit(): void {
    const now = Date.now();
    if (this.forfeitArmedUntil > now) {
      this.forfeitArmedUntil = 0;
      this.deps.world().forfeitRealmRacers();
      return;
    }
    this.forfeitArmedUntil = now + FORFEIT_ARM_MS;
  }

  /**
   * The circuit announcer: an off-screen `role="status"` region on the HUD
   * layer, NOT inside the strip.
   *
   * Two reasons it is its own node rather than an `aria-live` on the pill.
   * The strip's skeleton is rebuilt whenever its signature moves (the reset
   * control appears at GO, the forfeit control goes at the flag), and a live
   * region replaced wholesale re-announces its content; and the pill is a
   * truncating one-line label, whose visible text is not necessarily the whole
   * name. This speaks the name once, in full.
   *
   * `.visually-hidden` is the shared utility the rest of the HUD announces
   * through (`claudium_window`, `party_frame_row`, `market_window`).
   */
  private ensureAnnouncer(): HTMLElement | null {
    if (this.announceEl) return this.announceEl;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.className = 'visually-hidden';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.dataset.rallyCircuitAnnounce = '';
    layer.appendChild(el);
    this.announceEl = el;
    return el;
  }

  private ensureHud(): HTMLElement | null {
    if (this.hudRoot) return this.hudRoot;
    const layer = this.deps.layer();
    if (!layer) return null;
    const root = document.createElement('div');
    root.id = 'realm-racers-hud';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'off');
    layer.appendChild(root);
    this.hudRoot = root;
    return root;
  }
}
