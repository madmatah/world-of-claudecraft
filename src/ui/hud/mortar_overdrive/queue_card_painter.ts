// The Mortar Overdrive queue card: the thin painter over queue_card_view.ts that
// the race window composes while the viewer is queued. The window writes the
// card's markup in its own innerHTML pass when the card's signature moves; every
// frame after that the countdown, the bar, the status line and Start now's state
// ride the PainterHost elided writers, and a localized string is resolved again
// only when the value it spells changes.
//
// Assistive tech: the clock is a `timer` (never announced by itself), the bar is
// decorative beside it, and the status line is the card's one polite live
// region, so a screen reader hears the meaningful changes (the track busy, the
// track free again) and never a second-by-second count. Start now stays a
// focusable button while refused (`aria-disabled`), described by that status
// line, so the reason is one keystroke away.

import type { MortarOverdriveQueueStart } from '../../../world_api';
import { esc } from '../../esc';
import { formatNumber, type TranslationKey, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import {
  createMortarOverdriveQueueCountdown,
  MORTAR_OVERDRIVE_QUEUE_BAR_STEPS,
  type MortarOverdriveQueueCardStatus,
  type MortarOverdriveQueueCardView,
  stepMortarOverdriveQueueCountdown,
} from './queue_card_view';

const NOTE_ID = 'mortar-overdrive-start-note';
const HINT_ID = 'mortar-overdrive-start-hint';
const TITLE_ID = 'mortar-overdrive-start-title';
/** Stands the clock and the bar down when nothing is counting. */
const OFF_CLASS = 'is-off';

/** Every width the bar can be written at, built once, so a frame allocates no
 *  string for it. */
const BAR_WIDTHS: readonly string[] = Array.from(
  { length: MORTAR_OVERDRIVE_QUEUE_BAR_STEPS + 1 },
  (_, step) => `${(step * 100) / MORTAR_OVERDRIVE_QUEUE_BAR_STEPS}%`,
);

/** The status line per status; the counting and starting states say nothing
 *  there (the clock does), so the live region stays quiet through the count. */
const NOTE_KEYS: Record<MortarOverdriveQueueCardStatus, TranslationKey | null> = {
  counting: null,
  starting: null,
  busy: 'hudChrome.mortarOverdrive.queueCardBusy',
  manual: 'hudChrome.mortarOverdrive.queueCardManual',
  held: null,
};

interface Slots {
  clock: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  note: HTMLElement;
  startNow: HTMLElement;
  lastStatus: MortarOverdriveQueueCardStatus | null;
  lastSeconds: number;
}

export class MortarOverdriveQueueCard {
  private readonly countdown = createMortarOverdriveQueueCountdown();
  private slots: Slots | null = null;

  constructor(private readonly writers: PainterHostWriters) {}

  /** Whether Start now may be sent this frame (the lane is free). */
  get canStart(): boolean {
    return this.countdown.canStart;
  }

  /** Advance the countdown to `nowMs`; the window calls it every frame the card
   *  is up, before any paint, so a fresh card opens on the right second. */
  step(start: MortarOverdriveQueueStart | undefined, nowMs: number): void {
    stepMortarOverdriveQueueCountdown(this.countdown, start, nowMs);
  }

  /** The card is down: the next one anchors afresh. */
  reset(): void {
    this.countdown.deadlineMs = null;
    this.countdown.lastTicks = null;
    this.slots = null;
  }

  /** The card's markup, for the window's own innerHTML pass. Names are escaped
   *  here; nothing live is written into it. */
  html(view: MortarOverdriveQueueCardView): string {
    const seats = view.seats
      .map((seat) =>
        seat.name === null
          ? `<li class="mortar-overdrive-start-seat open"><span class="mortar-overdrive-start-name">` +
            `${esc(t('hudChrome.mortarOverdrive.queueCardOpenSeat'))}</span></li>`
          : `<li class="mortar-overdrive-start-seat${seat.you ? ' me' : ''}">` +
            `<span class="mortar-overdrive-start-name">${esc(seat.name)}</span>` +
            (seat.you
              ? `<span class="mortar-overdrive-start-tag">${esc(t('hudChrome.mortarOverdrive.standingsYou'))}</span>`
              : '') +
            `</li>`,
      )
      .join('');
    return (
      `<section class="mortar-overdrive-start" aria-labelledby="${TITLE_ID}">` +
      `<div class="mortar-overdrive-start-head">` +
      `<h3 class="mortar-overdrive-start-title" id="${TITLE_ID}">${esc(t('hudChrome.mortarOverdrive.queueCardTitle'))}</h3>` +
      `<span class="mortar-overdrive-start-clock ui-num" role="timer" data-mo-start-clock></span></div>` +
      `<div class="mortar-overdrive-start-bar ui-bar" aria-hidden="true" data-mo-start-bar>` +
      `<div class="mortar-overdrive-start-fill ui-bar-fill" data-mo-start-fill></div></div>` +
      `<p class="mortar-overdrive-start-note" id="${NOTE_ID}" role="status" data-mo-start-note></p>` +
      `<ol class="mortar-overdrive-start-seats">${seats}</ol>` +
      (view.solo
        ? `<p class="mortar-overdrive-start-solo">${esc(t('hudChrome.mortarOverdrive.queueCardSolo'))}</p>`
        : '') +
      `<button type="button" class="btn btn-primary mortar-overdrive-cta mortar-overdrive-start-now" ` +
      `data-mortar-overdrive-start-now aria-describedby="${NOTE_ID} ${HINT_ID}">` +
      `${esc(t('hudChrome.mortarOverdrive.queueCardStartNow'))}</button>` +
      `<p class="mortar-overdrive-start-hint" id="${HINT_ID}">${esc(t('hudChrome.mortarOverdrive.queueCardStartNowHint'))}</p>` +
      `</section>`
    );
  }

  /** Take the card's live nodes after the window wrote its markup, and paint
   *  the current frame at once, so a new bar never sweeps in from empty. */
  bind(root: HTMLElement): void {
    const q = (sel: string): HTMLElement | null => root.querySelector(sel);
    const clock = q('[data-mo-start-clock]');
    const bar = q('[data-mo-start-bar]');
    const fill = q('[data-mo-start-fill]');
    const note = q('[data-mo-start-note]');
    const startNow = q('[data-mortar-overdrive-start-now]');
    this.slots =
      clock && bar && fill && note && startNow
        ? { clock, bar, fill, note, startNow, lastStatus: null, lastSeconds: -1 }
        : null;
    this.paint();
  }

  /** The frame's live writes, each elided when unchanged. */
  paint(): void {
    const s = this.slots;
    if (!s) return;
    const w = this.writers;
    const c = this.countdown;
    const clocked = c.status === 'counting' || c.status === 'starting';
    if (c.status !== s.lastStatus || c.seconds !== s.lastSeconds) {
      if (c.status !== s.lastStatus) {
        const note = NOTE_KEYS[c.status];
        w.setText(s.note, note ? t(note) : '');
      }
      s.lastStatus = c.status;
      s.lastSeconds = c.seconds;
      w.setText(
        s.clock,
        c.status === 'counting'
          ? t('hudChrome.mortarOverdrive.queueCardStartsIn', {
              seconds: formatNumber(c.seconds, { maximumFractionDigits: 0 }),
            })
          : c.status === 'starting'
            ? t('hudChrome.mortarOverdrive.queueCardStarting')
            : '',
      );
    }
    w.toggleClass(s.clock, OFF_CLASS, !clocked);
    w.toggleClass(s.bar, OFF_CLASS, !clocked);
    w.setWidth(s.fill, BAR_WIDTHS[c.barStep] ?? '0%');
    w.setAttr(s.startNow, 'aria-disabled', c.canStart ? null : 'true');
  }
}
