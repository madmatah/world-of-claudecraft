// The Mortar Overdrive window: its front screen (queue, practice entry, the live
// status of the viewer's race) and its practice setup screen. The pure view
// module (mortar_overdrive/race_view.ts) owns the state decisions; this renders, wires
// actions, and maintains dialog focus. Cold: `MortarOverdriveUi` polls it while it
// is open and it rebuilds only when its signature moves.

import type { IWorld, MortarOverdriveDriverTier } from '../../../world_api';
import { markDialogRoot } from '../../dialog_root';
import { esc } from '../../esc';
import { focusedWithin } from '../../focus_restore';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { svgIcon } from '../../ui_icons';
import { mortarOverdriveCircuitName } from './circuit_i18n';
import { MortarOverdriveQueueCard } from './queue_card_painter';
import {
  buildMortarOverdriveSetupView,
  buildMortarOverdriveWindowView,
  MORTAR_OVERDRIVE_DEFAULT_PRACTICE_TIER,
  type MortarOverdriveControlAction,
  type MortarOverdriveSetupView,
  type MortarOverdriveWindowView,
} from './race_view';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** The marker attribute (`data-close`, `data-mortar-overdrive-*`) and value of
 *  the window control holding focus, or null when focus is elsewhere. */
function focusedControl(root: HTMLElement): { name: string; value: string } | null {
  const active = focusedWithin(root);
  if (!active) return null;
  for (const name of active.getAttributeNames()) {
    if (name === 'data-close' || name.startsWith('data-mortar-overdrive-')) {
      return { name, value: active.getAttribute(name) ?? '' };
    }
  }
  return null;
}

/** Hand focus back to the rebuilt control carrying the same marker. */
function refocusControl(root: HTMLElement, control: { name: string; value: string }): void {
  for (const el of root.querySelectorAll(`[${control.name}]`)) {
    if (el.getAttribute(control.name) === control.value) {
      (el as HTMLElement).focus();
      return;
    }
  }
}

/** Difficulty tier -> its copy keys. Closed maps, so an unlabelled tier is a
 *  compile error rather than a button reading its own wire token. */
const TIER_LABEL_KEYS: Record<MortarOverdriveDriverTier, TranslationKey> = {
  rookie: 'hudChrome.mortarOverdrive.tierRookie',
  driver: 'hudChrome.mortarOverdrive.tierDriver',
  ace: 'hudChrome.mortarOverdrive.tierAce',
};
const TIER_HINT_KEYS: Record<MortarOverdriveDriverTier, TranslationKey> = {
  rookie: 'hudChrome.mortarOverdrive.tierRookieHint',
  driver: 'hudChrome.mortarOverdrive.tierDriverHint',
  ace: 'hudChrome.mortarOverdrive.tierAceHint',
};

/** Taught control -> its copy keys. Same closed-map rule. */
const CONTROL_COPY: Record<
  MortarOverdriveControlAction,
  { label: TranslationKey; hint: TranslationKey }
> = {
  throttle: {
    label: 'hudChrome.mortarOverdrive.controlThrottle',
    hint: 'hudChrome.mortarOverdrive.controlThrottleHint',
  },
  brake: {
    label: 'hudChrome.mortarOverdrive.controlBrake',
    hint: 'hudChrome.mortarOverdrive.controlBrakeHint',
  },
  steer: {
    label: 'hudChrome.mortarOverdrive.controlSteer',
    hint: 'hudChrome.mortarOverdrive.controlSteerHint',
  },
  handbrake: {
    label: 'hudChrome.mortarOverdrive.controlHandbrake',
    hint: 'hudChrome.mortarOverdrive.controlHandbrakeHint',
  },
};

function tierLabel(tier: MortarOverdriveDriverTier): string {
  return t(TIER_LABEL_KEYS[tier]);
}

export interface MortarOverdriveWindowDeps {
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
  controlKeys(action: MortarOverdriveControlAction): readonly string[];
  /** True on the touch HUD, where naming keys would be nonsense. */
  isTouchHud(): boolean;
  /** The elided writers the queue card's live countdown rides. */
  writers: PainterHostWriters;
  /** The client clock the queue card counts down on. */
  now(): number;
}

export class MortarOverdriveWindow {
  private lastWindowSig = '';
  private openerFocus: HTMLElement | null = null;
  /**
   * The practice setup screen's own state, presentation-only: whether the
   * player has stepped into it, and which rival they have picked. Neither ever
   * reaches the sim, and both reset when the window closes, so re-opening the
   * panel always lands on the front screen.
   */
  private setupOpen = false;
  private setupTier: MortarOverdriveDriverTier = MORTAR_OVERDRIVE_DEFAULT_PRACTICE_TIER;

  /** The start card the front screen shows while the viewer is queued. */
  private readonly queueCard: MortarOverdriveQueueCard;

  constructor(private readonly deps: MortarOverdriveWindowDeps) {
    this.queueCard = new MortarOverdriveQueueCard(deps.writers);
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
    markDialogRoot(root, { labelledBy: 'mortar-overdrive-title' });
    root.style.display = 'block';
    this.lastWindowSig = '';
    this.render();
    (root.querySelector('[data-close]') as HTMLElement | null)?.focus();
  }

  close(): void {
    const root = this.deps.root();
    if (root.style.display !== 'block') return;
    root.style.display = 'none';
    this.queueCard.reset();
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
    const info = this.deps.world().mortarOverdriveInfo;
    // The setup screen is a second SCREEN of this window, not a second window:
    // it replaces the body, keeps the same frame, header and close control, and
    // is only reachable while nothing is racing.
    const view =
      this.setupOpen && info.match === null ? null : buildMortarOverdriveWindowView(info);
    const setup = view
      ? null
      : buildMortarOverdriveSetupView(
          info,
          this.setupTier,
          (action) => this.deps.controlKeys(action),
          this.deps.isTouchHud(),
        );
    const sig = view ? view.sig : (setup as MortarOverdriveSetupView).sig;
    // The queue card's countdown is live outside the signature: stepped and
    // painted through the elided writers every frame the card is up.
    const queued = view?.kind === 'queued';
    if (queued) this.queueCard.step(info.start, this.deps.now());
    // A rebuild paints the card in bind(), on its new nodes.
    if (queued && sig === this.lastWindowSig) this.queueCard.paint();
    if (sig === this.lastWindowSig) return;
    this.lastWindowSig = sig;
    const root = this.deps.root();
    // A rebuild must not drop the keyboard: the queue card's grid moves with
    // every join, so the control that held focus takes it back by its marker.
    const focused = focusedControl(root);
    root.innerHTML = view
      ? this.windowHtml(view)
      : this.setupHtml(setup as MortarOverdriveSetupView);
    if (queued) this.queueCard.bind(root);
    else this.queueCard.reset();
    if (focused) refocusControl(root, focused);
    root.querySelector('[data-close]')?.addEventListener('click', () => this.close());
    root.querySelector('[data-mortar-overdrive-start-now]')?.addEventListener('click', () => {
      if (this.queueCard.canStart) this.deps.world().startMortarOverdriveNow();
    });
    root.querySelector('[data-mortar-overdrive-join]')?.addEventListener('click', () => {
      this.deps.world().joinMortarOverdriveQueue();
    });
    root.querySelector('[data-mortar-overdrive-leave]')?.addEventListener('click', () => {
      this.deps.world().leaveMortarOverdriveQueue();
    });
    root.querySelector('[data-mortar-overdrive-forfeit]')?.addEventListener('click', () => {
      this.deps.world().forfeitMortarOverdrive();
    });
    root.querySelector('[data-mortar-overdrive-practice-open]')?.addEventListener('click', () => {
      this.setupOpen = true;
      this.repaint();
    });
    root.querySelector('[data-mortar-overdrive-practice-back]')?.addEventListener('click', () => {
      this.setupOpen = false;
      this.repaint();
    });
    root.querySelector('[data-mortar-overdrive-practice-play]')?.addEventListener('click', () => {
      this.deps.world().startMortarOverdrivePractice(this.setupTier);
    });
    for (const button of root.querySelectorAll('[data-mortar-overdrive-tier]')) {
      const tier = (button as HTMLElement).dataset.mortarOverdriveTier as MortarOverdriveDriverTier;
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
  private setupHtml(view: MortarOverdriveSetupView): string {
    const tiers = view.tiers
      .map(
        (option) =>
          `<button type="button" class="mortar-overdrive-tier${option.selected ? ' selected' : ''}" ` +
          `data-mortar-overdrive-tier="${esc(option.tier)}" aria-pressed="${option.selected}">` +
          `<strong>${esc(tierLabel(option.tier))}</strong>` +
          `<span>${esc(t(TIER_HINT_KEYS[option.tier]))}</span></button>`,
      )
      .join('');
    const controls = view.controls
      .map((row) => {
        const copy = CONTROL_COPY[row.action];
        const keys = row.keys
          .map((key) => `<kbd class="mortar-overdrive-key">${esc(key)}</kbd>`)
          .join(`<span class="mortar-overdrive-key-sep">/</span>`);
        return (
          `<div class="mortar-overdrive-control"><div class="mortar-overdrive-control-copy">` +
          `<strong>${esc(t(copy.label))}</strong>` +
          `<span>${esc(t(copy.hint))}</span></div>` +
          `<div class="mortar-overdrive-control-keys">${keys}</div></div>`
        );
      })
      .join('');
    const play = view.available
      ? `<button type="button" class="btn btn-primary mortar-overdrive-cta mortar-overdrive-play" data-mortar-overdrive-practice-play>` +
        `${esc(t('hudChrome.mortarOverdrive.practicePlay'))}</button>`
      : `<div class="mortar-overdrive-status queued">${esc(t('hudChrome.mortarOverdrive.practiceUnavailable'))}</div>`;
    // Which circuit practice runs, and that competition runs a different one.
    // The trade is the pool's, not a detail: a pilot learns the machine here
    // and meets the map for the first time on the grid.
    const circuit = mortarOverdriveCircuitName(view.circuitId);
    const circuitLine = circuit
      ? `<p class="mortar-overdrive-setup-circuit">${esc(t('hudChrome.mortarOverdrive.practiceCircuit', { circuit }))}</p>`
      : '';
    return (
      `${this.headerHtml()}<div class="mortar-overdrive-body mortar-overdrive-setup">` +
      `<p class="mortar-overdrive-setup-intro">${esc(t('hudChrome.mortarOverdrive.practiceIntro'))}</p>` +
      circuitLine +
      `<h3 class="mortar-overdrive-legend">${esc(t('hudChrome.mortarOverdrive.practiceTierLegend'))}</h3>` +
      `<div class="mortar-overdrive-tiers">${tiers}</div>` +
      `<h3 class="mortar-overdrive-legend">${esc(t('hudChrome.mortarOverdrive.practiceControlsLegend'))}</h3>` +
      `<div class="mortar-overdrive-controls">${controls}</div>` +
      (view.touch
        ? `<p class="mortar-overdrive-touch-note">${esc(t('hudChrome.mortarOverdrive.practiceTouchNote'))}</p>`
        : '') +
      `<div class="mortar-overdrive-setup-actions">` +
      `<button type="button" class="btn mortar-overdrive-back" data-mortar-overdrive-practice-back>${esc(t('hudChrome.mortarOverdrive.practiceBack'))}</button>` +
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
      `<span id="mortar-overdrive-title">${esc(t('hudChrome.mortarOverdrive.title'))}</span>` +
      `<span class="ui-win-sub">${esc(t('hudChrome.mortarOverdrive.kicker'))}</span></span>` +
      `<button type="button" class="x-btn ui-x-btn" data-close aria-label="${esc(t('hudChrome.mortarOverdrive.close'))}">${svgIcon('close')}</button>` +
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
      `<div class="mortar-overdrive-or"><span>${esc(t('hudChrome.mortarOverdrive.orRace'))}</span></div>` +
      `<button type="button" class="btn mortar-overdrive-cta mortar-overdrive-practice-cta" data-mortar-overdrive-practice-open${available ? '' : ' disabled'}>` +
      `${esc(t('hudChrome.mortarOverdrive.practice'))}</button>`
    );
  }

  private windowHtml(view: MortarOverdriveWindowView): string {
    const header = this.headerHtml();
    // Atmosphere first, then a short control primer. No pilot counts and no lap
    // counts: those change with circuits and formats, and the front screen has
    // to stay true when they do. The crest is a mark, not a roman numeral.
    const rules =
      `<div class="mortar-overdrive-hero">` +
      `<div class="mortar-overdrive-hero-mark" aria-hidden="true"><span class="mortar-overdrive-crest"></span></div>` +
      `<div class="mortar-overdrive-hero-copy">` +
      `<p class="mortar-overdrive-pitch">${esc(t('hudChrome.mortarOverdrive.pitch'))}</p>` +
      `<ul class="mortar-overdrive-promises">` +
      `<li>${esc(t('hudChrome.mortarOverdrive.promiseMortar'))}</li>` +
      `<li>${esc(t('hudChrome.mortarOverdrive.promiseSlide'))}</li>` +
      `<li>${esc(t('hudChrome.mortarOverdrive.promiseRival'))}</li>` +
      `</ul></div></div>` +
      `<div class="mortar-overdrive-howto"><strong>${esc(t('hudChrome.mortarOverdrive.howToPlayTitle'))}</strong>` +
      `<span>${esc(t('hudChrome.mortarOverdrive.howToPlay'))}</span></div>`;
    let action = '';
    if (view.kind === 'idle') {
      action =
        `<div class="mortar-overdrive-status">${esc(t('hudChrome.mortarOverdrive.waiting', { count: num(view.queueSize) }))}</div>` +
        `<button type="button" class="btn btn-primary mortar-overdrive-cta" data-mortar-overdrive-join>${esc(t('hudChrome.mortarOverdrive.join'))}</button>` +
        this.practiceButtonHtml(view.practiceAvailable);
    } else if (view.kind === 'queued') {
      action =
        this.queueCard.html(view.card) +
        `<button type="button" class="btn mortar-overdrive-cta leave" data-mortar-overdrive-leave>${esc(t('hudChrome.mortarOverdrive.leave'))}</button>` +
        this.practiceButtonHtml(view.practiceAvailable);
    } else {
      const placing = { position: num(view.position), total: num(view.gridSize) };
      const live = view.practice
        ? t('hudChrome.mortarOverdrive.racingAgainstBot', placing)
        : t('hudChrome.mortarOverdrive.racingAgainst', placing);
      const status =
        view.phase === 'finished'
          ? view.result === 'void'
            ? t('hudChrome.mortarOverdrive.raceVoid')
            : view.result === 'won'
              ? t('hudChrome.mortarOverdrive.won')
              : view.result === 'draw'
                ? t('hudChrome.mortarOverdrive.draw')
                : t('hudChrome.mortarOverdrive.lost', placing)
          : live;
      action =
        `<div class="mortar-overdrive-status live">${esc(status)}</div>` +
        (view.phase === 'finished'
          ? ''
          : `<button type="button" class="btn mortar-overdrive-cta leave" data-mortar-overdrive-forfeit>${esc(t('hudChrome.mortarOverdrive.forfeit'))}</button>`);
    }
    // Queued, the body says so: the touch sheet then stands the pitch and the
    // primer down, so the card is what a phone opens on rather than a scroll
    // below the fold.
    const body =
      view.kind === 'queued' ? 'mortar-overdrive-body is-queued' : 'mortar-overdrive-body';
    return `${header}<div class="${body}">${rules}${action}</div>`;
  }
}
