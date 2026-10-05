// The Realm Racers race strip: the in-race readout (circuit pill, placing,
// lap, time, speed, the ward / wrong-way / track-limit / phase lines and the
// reset and forfeit controls) plus the off-screen announcer that speaks the
// drawn circuit. The pure core (realm_racers_view.ts `buildRealmRacersHudView`)
// decides what it says; this paints it.
//
// Hot: `RealmRacersUi` calls it every painted frame. The text-free skeleton is
// rebuilt in ONE innerHTML write per signature (once per race phase), the
// announcer takes its attributes once at ensure, and every per-frame
// write rides the PainterHost elided writers. A cell's localized text is
// resolved again only when a value it spells changes, and the constant labels
// are written once per rebuild (the lobby curtain's pattern): a rebuild, which
// a new race and a language switch both force, re-resolves every cell.

import { clockSeconds } from './clock_seconds_core';
import { esc } from './esc';
import { formatNumber, type TranslationKey, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import { realmRacersCircuitName } from './realm_racers_circuit_i18n';
import type { RealmRacersHudView } from './realm_racers_view';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/**
 * How long the strip's forfeit control stays armed after the first press. A race
 * is driven at speed with a thumb on a small target, so ending one takes two
 * presses inside this window; the arm lapses back to the idle label on its own.
 * Presentation-only state: it never reaches the sim.
 */
const FORFEIT_ARM_MS = 3000;

/** What each cell last painted; -1 (or undefined) until the rebuild's first
 *  paint, so a rebuild re-resolves every cell. */
interface PaintedCells {
  position: number;
  grid: number;
  lap: number;
  laps: number;
  second: number;
  speed: number;
  ward: number;
  limit: number;
  wrongWay: boolean | null;
  phaseKey: TranslationKey | null | undefined;
  phaseSeconds: number;
  armed: boolean | null;
}

/** The phase line's copy key (null: the line says nothing) and the seconds it
 *  spells (-1 for a line that spells no number). */
interface PhaseLine {
  key: TranslationKey | null;
  seconds: number;
}

/** The limits cell's key for the cut notice, which spells no number. */
const CUT_RETURNED = -2;

function phaseLineOf(view: RealmRacersHudView, out: PhaseLine): PhaseLine {
  out.seconds = -1;
  if (view.phase === 'loading' || view.phase === 'countdown') {
    out.key = view.countdown > 0 ? 'hudChrome.rally.countdown' : null;
    out.seconds = view.countdown;
  } else if (view.phase === 'finished') {
    // The podium carries the result headline and the return countdown once the
    // RACE is over, so this line stands down rather than saying the same thing
    // twice. A pilot who merely quit still gets it here: there is no ceremony
    // for them, and neither is there for a void race.
    out.key = view.voided
      ? 'hudChrome.rally.voidReturn'
      : view.decided
        ? null
        : view.result === 'won'
          ? 'hudChrome.rally.wonReturn'
          : view.result === 'draw'
            ? 'hudChrome.rally.drawReturn'
            : 'hudChrome.rally.lostReturn';
    out.seconds = view.returnIn;
  } else if (view.chaseIn > 0) {
    // The winner is home and this pilot is not: they are racing a clock now,
    // and it says so rather than cutting them off unwarned.
    out.key = 'hudChrome.rally.chase';
    out.seconds = view.chaseIn;
  } else {
    out.key = view.lap === view.totalLaps ? 'hudChrome.rally.finalLap' : 'hudChrome.rally.go';
  }
  return out;
}

export interface RealmRacersStripDeps {
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
  /** The reset control: put the pilot back on the road. */
  reset(): void;
  /** The forfeit control's confirmed second press: end the race. */
  forfeit(): void;
  /** The client clock the forfeit arm window runs on. */
  now(): number;
}

export class RealmRacersStrip {
  private lastHudSig = '';
  private hudRoot: HTMLElement | null = null;
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
  /** What each cell last painted, reset by every skeleton rebuild, which
   *  `relocalize()` forces: a language switch re-resolves every cell. */
  private readonly paintedCells: PaintedCells = {
    position: -1,
    grid: -1,
    lap: -1,
    laps: -1,
    second: -1,
    speed: -1,
    ward: -1,
    limit: -1,
    wrongWay: null,
    phaseKey: undefined,
    phaseSeconds: -2,
    armed: null,
  };
  private readonly phaseLine: PhaseLine = { key: null, seconds: 0 };

  constructor(private readonly deps: RealmRacersStripDeps) {}

  /** Rebuild from the current locale on the next update. */
  relocalize(): void {
    this.lastHudSig = '';
  }

  update(view: RealmRacersHudView): void {
    const w = this.deps.writers;
    if (!view.active) {
      if (this.hudRoot) w.setDisplay(this.hudRoot, 'none');
      this.forfeitArmedUntil = 0;
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
      this.resetEl?.addEventListener('click', () => this.deps.reset());
      this.forfeitEl?.addEventListener('click', () => this.pressForfeit());
      this.forgetPaintedCells();
      if (this.resetEl) w.setText(this.resetEl, t('hudChrome.rally.reset'));
    }
    // The pill is a VISUAL swap, and a swapped label is not an announcement: a
    // screen-reader user would otherwise first learn the circuit at the podium,
    // after the race. The announcer is an off-screen live region that lives
    // OUTSIDE the strip's rebuilt subtree, so the countdown-to-racing rebuild
    // cannot re-announce, and the write is elided, so it speaks exactly once per
    // race. Cleared when the strip goes down, so the next race announces even
    // when the draw lands on the same circuit.
    const announcer = this.ensureAnnouncer();
    if (announcer) w.setText(announcer, this.circuitName ?? '');
    if (
      this.positionEl &&
      (view.position !== this.paintedCells.position || view.gridSize !== this.paintedCells.grid)
    ) {
      this.paintedCells.position = view.position;
      this.paintedCells.grid = view.gridSize;
      w.setText(
        this.positionEl,
        t('hudChrome.rally.position', {
          position: num(view.position),
          total: num(view.gridSize),
        }),
      );
    }
    if (
      this.lapEl &&
      (view.lap !== this.paintedCells.lap || view.totalLaps !== this.paintedCells.laps)
    ) {
      this.paintedCells.lap = view.lap;
      this.paintedCells.laps = view.totalLaps;
      w.setText(
        this.lapEl,
        t('hudChrome.rally.lap', { lap: num(view.lap), total: num(view.totalLaps) }),
      );
    }
    const second = Math.floor(view.elapsed);
    if (this.timeEl && second !== this.paintedCells.second) {
      this.paintedCells.second = second;
      const minutes = Math.floor(second / 60);
      const seconds = second % 60;
      w.setText(
        this.timeEl,
        t('hudChrome.rally.time', {
          minutes: num(minutes),
          seconds: clockSeconds(seconds, true),
        }),
      );
    }
    // The speed is absolute, so rounding it here spells what `num` would.
    const speed = Math.round(view.speed);
    if (this.speedEl && speed !== this.paintedCells.speed) {
      this.paintedCells.speed = speed;
      w.setText(this.speedEl, t('hudChrome.rally.speed', { speed: num(speed) }));
    }
    if (this.wardEl) {
      // Written even while hidden, so a locale flip lands on the text. Visibility
      // rides setStyleProp, whose own (element, 'display') slot keeps the two
      // writes eliding independently (the same shape the limits line below uses).
      const ward = view.wardIn > 0 ? view.wardIn : 0;
      if (ward !== this.paintedCells.ward) {
        this.paintedCells.ward = ward;
        w.setText(
          this.wardEl,
          ward > 0
            ? t('hudChrome.rally.wardHeldFor', { seconds: num(ward) })
            : t('hudChrome.rally.wardHeld'),
        );
      }
      w.setStyleProp(this.wardEl, 'display', view.warded ? 'block' : 'none');
    }
    if (this.wrongWayEl) {
      // An alert speaks when its text is inserted, not when it is unhidden, so
      // the text is written on the rising edge and cleared on the falling one:
      // every turn the wrong way is announced, not only the first.
      if (view.wrongWay !== this.paintedCells.wrongWay) {
        this.paintedCells.wrongWay = view.wrongWay;
        w.setText(this.wrongWayEl, view.wrongWay ? t('hudChrome.rally.wrongWay') : '');
      }
      w.setStyleProp(this.wrongWayEl, 'display', view.wrongWay ? 'block' : 'none');
    }
    if (this.limitsEl) {
      // The text is written even while the line is hidden, so a locale flip
      // lands on it; visibility rides its own setStyleProp slot.
      const limit = view.trackLimit === 'cutReturned' ? CUT_RETURNED : view.offTrackIn;
      if (limit !== this.paintedCells.limit) {
        this.paintedCells.limit = limit;
        w.setText(
          this.limitsEl,
          limit === CUT_RETURNED
            ? t('hudChrome.rally.cutReturned')
            : t('hudChrome.rally.offTrack', { seconds: num(limit) }),
        );
      }
      w.setStyleProp(this.limitsEl, 'display', view.trackLimit === 'none' ? 'none' : 'block');
    }
    if (this.resetEl) {
      w.setAttr(this.resetEl, 'disabled', view.resetLocked ? '' : null);
    }
    if (this.phaseEl) {
      const line = phaseLineOf(view, this.phaseLine);
      if (
        line.key !== this.paintedCells.phaseKey ||
        line.seconds !== this.paintedCells.phaseSeconds
      ) {
        this.paintedCells.phaseKey = line.key;
        this.paintedCells.phaseSeconds = line.seconds;
        w.setText(
          this.phaseEl,
          line.key === null
            ? ''
            : line.seconds < 0
              ? t(line.key)
              : t(line.key, { seconds: num(line.seconds) }),
        );
      }
    }
    if (this.forfeitEl) {
      const armed = this.forfeitArmedUntil > this.deps.now();
      if (armed !== this.paintedCells.armed) {
        this.paintedCells.armed = armed;
        w.setText(
          this.forfeitEl,
          armed ? t('hudChrome.rally.forfeitConfirm') : t('hudChrome.rally.forfeit'),
        );
      }
      w.toggleClass(this.forfeitEl, 'armed', armed);
    }
  }

  private forgetPaintedCells(): void {
    const s = this.paintedCells;
    s.position = -1;
    s.grid = -1;
    s.lap = -1;
    s.laps = -1;
    s.second = -1;
    s.speed = -1;
    s.ward = -1;
    s.limit = -1;
    s.wrongWay = null;
    s.phaseKey = undefined;
    s.phaseSeconds = -2;
    s.armed = null;
  }

  // Two-step: the first press arms, a second press inside the window forfeits,
  // and a press after it lapses re-arms instead of ending the race.
  private pressForfeit(): void {
    const now = this.deps.now();
    if (this.forfeitArmedUntil > now) {
      this.forfeitArmedUntil = 0;
      this.deps.forfeit();
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
    // No live-region role of its own: it holds controls and its own status and
    // alert lines, each of which speaks for itself.
    const root = document.createElement('div');
    root.id = 'realm-racers-hud';
    layer.appendChild(root);
    this.hudRoot = root;
    return root;
  }
}
