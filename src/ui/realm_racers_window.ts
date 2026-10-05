// The Realm Racers window: its front screen (queue, practice entry, the live
// status of the viewer's race) and its practice setup screen. The pure view
// module (realm_racers_view.ts) owns the state decisions; this renders, wires
// actions, and maintains dialog focus. Cold: `RealmRacersUi` polls it while it
// is open and it rebuilds only when its signature moves.

import type { IWorld, RallyDriverTier } from '../world_api';
import { markDialogRoot } from './dialog_root';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import { realmRacersCircuitName } from './realm_racers_circuit_i18n';
import {
  buildRealmRacersSetupView,
  buildRealmRacersWindowView,
  RALLY_DEFAULT_PRACTICE_TIER,
  type RallyControlAction,
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

export interface RealmRacersWindowDeps {
  root(): HTMLElement;
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
}

export class RealmRacersWindow {
  private lastWindowSig = '';
  private openerFocus: HTMLElement | null = null;
  /**
   * The practice setup screen's own state, presentation-only: whether the
   * player has stepped into it, and which rival they have picked. Neither ever
   * reaches the sim, and both reset when the window closes, so re-opening the
   * panel always lands on the front screen.
   */
  private setupOpen = false;
  private setupTier: RallyDriverTier = RALLY_DEFAULT_PRACTICE_TIER;

  constructor(private readonly deps: RealmRacersWindowDeps) {}

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
    this.render();
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
    if (this.isOpen) this.render();
  }

  /** The poll: repaint while open, behind the signature. */
  update(): void {
    if (this.isOpen) this.render();
  }

  /** The viewer's race has begun: the setup screen has done its job the moment
   *  the flag is up (leaving it armed would put the player back on it after the
   *  race), and the window closes, since it is centered over the viewport and
   *  would hide the circuit for the whole countdown and race. */
  closeForRace(): void {
    this.setupOpen = false;
    if (this.isOpen) this.close();
  }

  private render(): void {
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
    if (this.isOpen) this.render();
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
}
