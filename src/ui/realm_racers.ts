// Thin DOM painter for The Realm Racers window, its practice setup screen,
// and the race HUD. The pure view module owns state decisions; this class only
// renders, wires actions, and maintains dialog focus.

import type { IWorld, RallyDriverTier } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { RealmRacersPodium } from './realm_racers_podium';
import { buildRealmRacersPodiumView } from './realm_racers_podium_view';
import { RealmRacersStandingsPanel } from './realm_racers_standings_panel';
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
  writers: PainterHostWriters;
}

export class RealmRacersUi {
  private lastWindowSig = '';
  private lastHudSig = '';
  private openerFocus: HTMLElement | null = null;
  private hudRoot: HTMLElement | null = null;
  private readonly standings: RealmRacersStandingsPanel;
  private readonly podium: RealmRacersPodium;
  private lapEl: HTMLElement | null = null;
  private positionEl: HTMLElement | null = null;
  private timeEl: HTMLElement | null = null;
  private speedEl: HTMLElement | null = null;
  private wrongWayEl: HTMLElement | null = null;
  private phaseEl: HTMLElement | null = null;
  private resetEl: HTMLElement | null = null;
  private forfeitEl: HTMLElement | null = null;
  private forfeitArmedUntil = 0;
  private wasInMatch = false;
  private lastCountdown = 0;
  /**
   * The practice setup screen's own state, presentation-only: whether the
   * player has stepped into it, and which rival they have picked. Neither ever
   * reaches the sim, and both reset when the window closes, so re-opening the
   * panel always lands on the front screen.
   */
  private setupOpen = false;
  private setupTier: RallyDriverTier = RALLY_DEFAULT_PRACTICE_TIER;

  constructor(private readonly deps: RealmRacersDeps) {
    this.standings = new RealmRacersStandingsPanel({
      layer: () => deps.layer(),
      writers: deps.writers,
    });
    this.podium = new RealmRacersPodium({
      layer: () => deps.layer(),
      writers: deps.writers,
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
    if (this.isOpen) this.renderWindow();
  }

  update(): void {
    const info = this.deps.world().realmRacersInfo;
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
    }
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
    return (
      `${this.headerHtml()}<div class="rally-body rally-setup">` +
      `<p class="rally-setup-intro">${esc(t('hudChrome.rally.practiceIntro'))}</p>` +
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

  /** The house window grammar (.panel-title + .x-btn, see src/styles/layout.css):
   *  it is what carries the sticky header, the titlebar drag, and the pinned
   *  close control every other window has. Shared by both screens, so stepping
   *  into the setup never loses the frame's chrome. */
  private headerHtml(): string {
    return (
      `<div class="panel-title">` +
      `<span class="rally-heading"><span class="rally-kicker">${esc(t('hudChrome.rally.kicker'))}</span>` +
      `<span id="realm-racers-title">${esc(t('hudChrome.rally.title'))}</span></span>` +
      `<button type="button" class="x-btn" data-close aria-label="${esc(t('hudChrome.rally.close'))}">${svgIcon('close')}</button>` +
      `</div>`
    );
  }

  /**
   * The one Practice control on the front screen. It opens the setup screen
   * rather than starting a race, and it rides ALONGSIDE the queue controls
   * (including while queued, which the sim treats as "race now" and takes the
   * player out of the queue for), because a player alone on the realm should
   * never have to find out the hard way that nobody else is waiting.
   */
  private practiceButtonHtml(): string {
    return (
      `<div class="rally-or"><span>${esc(t('hudChrome.rally.orRace'))}</span></div>` +
      `<button type="button" class="btn rally-cta rally-practice-cta" data-rally-practice-open>` +
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
      action =
        `<div class="rally-status">${esc(t('hudChrome.rally.waiting', { count: num(view.queueSize) }))}</div>` +
        `<button type="button" class="btn btn-primary rally-cta" data-rally-join>${esc(t('hudChrome.rally.join'))}</button>` +
        this.practiceButtonHtml();
    } else if (view.kind === 'queued') {
      action =
        `<div class="rally-status queued">${esc(t('hudChrome.rally.queued', { position: num(view.position), count: num(view.queueSize) }))}</div>` +
        `<button type="button" class="btn rally-cta leave" data-rally-leave>${esc(t('hudChrome.rally.leave'))}</button>` +
        this.practiceButtonHtml();
    } else {
      const placing = { position: num(view.position), total: num(view.gridSize) };
      const live = view.practice
        ? t('hudChrome.rally.racingAgainstBot', placing)
        : t('hudChrome.rally.racingAgainst', placing);
      const status =
        view.phase === 'finished'
          ? view.result === 'won'
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
    if (!view.active) {
      if (this.hudRoot) w.setDisplay(this.hudRoot, 'none');
      this.standings.update(standings);
      this.forfeitArmedUntil = 0;
      this.lastCountdown = 0;
      return;
    }
    const root = this.ensureHud();
    if (!root) return;
    w.setDisplay(root, 'block');
    if (view.sig !== this.lastHudSig) {
      this.lastHudSig = view.sig;
      this.forfeitArmedUntil = 0;
      root.innerHTML =
        `<div class="rallyhud-top"><span class="rallyhud-mark">G</span>` +
        `<span class="rallyhud-title">${esc(t('hudChrome.rally.title'))}</span></div>` +
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
        `<div class="rallyhud-wrong-way" role="alert" aria-live="assertive"></div>` +
        `<div class="rallyhud-phase" aria-live="polite"></div>`;
      this.positionEl = root.querySelector('.rallyhud-position');
      this.lapEl = root.querySelector('.rallyhud-lap');
      this.timeEl = root.querySelector('.rallyhud-time');
      this.speedEl = root.querySelector('.rallyhud-speed');
      this.wrongWayEl = root.querySelector('.rallyhud-wrong-way');
      this.phaseEl = root.querySelector('.rallyhud-phase');
      this.resetEl = root.querySelector('.rallyhud-reset');
      this.forfeitEl = root.querySelector('.rallyhud-forfeit');
      this.resetEl?.addEventListener('click', () => this.deps.world().resetRealmRacersPosition());
      this.forfeitEl?.addEventListener('click', () => this.pressForfeit());
    }
    this.standings.update(standings);
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
    if (this.wrongWayEl) {
      w.setText(this.wrongWayEl, t('hudChrome.rally.wrongWay'));
      w.setDisplay(this.wrongWayEl, view.wrongWay ? 'block' : 'none');
    }
    if (this.resetEl) {
      w.setText(this.resetEl, t('hudChrome.rally.reset'));
      const resetButton = this.resetEl as HTMLButtonElement;
      if (resetButton.disabled !== view.resetLocked) resetButton.disabled = view.resetLocked;
    }
    if (this.phaseEl) {
      const phase =
        view.phase === 'countdown'
          ? view.countdown > 0
            ? t('hudChrome.rally.countdown', { seconds: num(view.countdown) })
            : ''
          : view.phase === 'finished'
            ? // The podium carries the result headline and the return
              // countdown once the RACE is over, so this line stands down
              // rather than saying the same thing twice. A pilot who merely
              // quit still gets it here: there is no ceremony for them.
              view.decided
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
