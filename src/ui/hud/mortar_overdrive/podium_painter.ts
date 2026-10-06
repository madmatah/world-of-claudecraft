// The Mortar Overdrive podium: the end-of-race ceremony, centred over the viewport.
// The pure core (mortar_overdrive/podium_view.ts) decides who stands where; this
// paints it.
//
// Structure rebuilds only on the core's signature, which is the classification.
// The return countdown is the one live value and goes through the elided
// writers, so a ceremony sitting for its six seconds writes one number a second
// and nothing else.
//
// No `esc`: the markup is a fixed skeleton with no interpolation, and every
// player-supplied value (the names) is written with `setText`, which sets
// textContent. There is no HTML path for a name to take.

import { clockSeconds } from '../../clock_seconds_core';
import { formatNumber, t } from '../../i18n';
import { iconDataUrl } from '../../icons';
import type { PainterHostWriters } from '../../painter_host';
import { mortarOverdriveCircuitName } from './circuit_i18n';
import type { MortarOverdrivePodiumEntry, MortarOverdrivePodiumView } from './podium_view';

/** Portrait edge on a podium step. The podium is the one Mortar Overdrive surface that
 *  draws class art at all, and the one moment the pilots are meant to be looked
 *  at rather than scanned: the live standings panel spends its width on names. */
const STEP_CREST_PX = 44;
/** And on the rows listed under it, which stay at the party-frame roster size. */
const REST_CREST_PX = 20;

const SHOWN_CLASS = 'shown';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

export interface MortarOverdrivePodiumDeps {
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
}

export class MortarOverdrivePodium {
  private root: HTMLElement | null = null;
  private returnEl: HTMLElement | null = null;
  private lastSig = '';
  /** What the return headline last spelled: it is resolved again only when
   *  the second or the result moves, and every rebuild (which a language
   *  switch forces) re-resolves it. */
  private lastReturnIn = -1;
  private lastReturnResult: MortarOverdrivePodiumView['result'] | undefined = undefined;

  constructor(private readonly deps: MortarOverdrivePodiumDeps) {}

  /** Re-paint from the current locale on the next update: the signature is over
   *  the classification, which a language change cannot move. */
  relocalize(): void {
    this.lastSig = '';
  }

  update(view: MortarOverdrivePodiumView): void {
    const root = this.ensure();
    if (!root) return;
    const w = this.deps.writers;
    w.toggleClass(root, SHOWN_CLASS, view.active);
    if (!view.active) {
      this.lastSig = '';
      return;
    }
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      // Resolved once and handed to both halves: the skeleton decides whether
      // the heading EXISTS from it and paintNames fills it, and those two must
      // never be able to disagree.
      const circuit = mortarOverdriveCircuitName(view.circuitId);
      root.innerHTML = this.markup(view, circuit);
      this.returnEl = root.querySelector('.mortar-overdrive-podium-return');
      this.paintNames(root, view, circuit);
      this.lastReturnIn = -1;
      this.lastReturnResult = undefined;
    }
    if (
      this.returnEl &&
      (view.returnIn !== this.lastReturnIn || view.result !== this.lastReturnResult)
    ) {
      this.lastReturnIn = view.returnIn;
      this.lastReturnResult = view.result;
      w.setText(this.returnEl, returnLabel(view));
    }
  }

  /**
   * The skeleton: the circuit that was raced, the steps in display order, then
   * the rows below. It carries no text at all, which is what lets it be a
   * template string; the names and the heading are written into it by
   * paintNames.
   *
   * The heading is present only for a circuit the catalog names. A draft
   * circuit registered by a dev command has no name, and an unnamed ceremony is
   * better than one headed by a raw id.
   *
   * It is a `p`, not an `h`: this root is an atomic `role="status"` live region,
   * so assistive tech reads the whole ceremony as one string and a heading role
   * buys nothing, while a document-outline entry that exists only while a
   * ceremony is up (and only for a named circuit) is a real cost. The window's
   * own section headings are `h3`; a lone `h2` here would not match them either.
   */
  private markup(view: MortarOverdrivePodiumView, circuit: string | null): string {
    const steps = view.steps
      .map(
        (entry) =>
          `<li class="mortar-overdrive-podium-step p${entry.placing}${entry.isMe ? ' me' : ''}">` +
          `<img class="mortar-overdrive-podium-crest" src="${iconDataUrl('crest', `class_${entry.cls}`, STEP_CREST_PX)}" alt="">` +
          `<span class="mortar-overdrive-podium-name"></span>` +
          `<span class="mortar-overdrive-podium-time"></span>` +
          `<span class="mortar-overdrive-podium-block"><span class="mortar-overdrive-podium-place">${num(entry.placing)}</span></span>` +
          `</li>`,
      )
      .join('');
    const rest = view.rest
      .map(
        (entry) =>
          `<li class="mortar-overdrive-podium-row${entry.isMe ? ' me' : ''}">` +
          `<span class="mortar-overdrive-podium-row-place">${num(entry.placing)}</span>` +
          `<img class="mortar-overdrive-podium-row-crest" src="${iconDataUrl('crest', `class_${entry.cls}`, REST_CREST_PX)}" alt="">` +
          `<span class="mortar-overdrive-podium-name"></span>` +
          `<span class="mortar-overdrive-podium-time"></span>` +
          `</li>`,
      )
      .join('');
    const heading = circuit ? `<p class="mortar-overdrive-podium-heading"></p>` : '';
    return (
      heading +
      `<ol class="mortar-overdrive-podium-steps">${steps}</ol>` +
      (rest ? `<ol class="mortar-overdrive-podium-rest">${rest}</ol>` : '') +
      `<div class="mortar-overdrive-podium-return" aria-live="polite"></div>`
    );
  }

  /** The circuit heading, then the names and times, in the order the skeleton
   *  laid them out. */
  private paintNames(
    root: HTMLElement,
    view: MortarOverdrivePodiumView,
    circuit: string | null,
  ): void {
    const w = this.deps.writers;
    const heading = root.querySelector('.mortar-overdrive-podium-heading') as HTMLElement | null;
    if (heading && circuit) w.setText(heading, circuit);
    const names = [...root.querySelectorAll('.mortar-overdrive-podium-name')] as HTMLElement[];
    const times = [...root.querySelectorAll('.mortar-overdrive-podium-time')] as HTMLElement[];
    const entries = [...view.steps, ...view.rest];
    entries.forEach((entry, index) => {
      const name = names[index];
      const time = times[index];
      if (name) w.setText(name, entry.name);
      if (time) w.setText(time, timeLabel(entry, view.totalLaps));
    });
  }

  private ensure(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const root = document.createElement('div');
    root.id = 'mortar-overdrive-podium';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    layer.appendChild(root);
    this.root = root;
    return root;
  }
}

/** A finisher's race time, or where the flag caught a pilot who was still out. */
function timeLabel(entry: MortarOverdrivePodiumEntry, totalLaps: number): string {
  if (entry.retired) return t('hudChrome.mortarOverdrive.standingsRetired');
  if (entry.finishSeconds === null) {
    return t('hudChrome.mortarOverdrive.lap', { lap: num(entry.lap), total: num(totalLaps) });
  }
  const minutes = Math.floor(entry.finishSeconds / 60);
  const seconds = Math.floor(entry.finishSeconds % 60);
  // Tenths, floored with the rest: a time that rounds UP can read as slower than
  // the machine that actually finished behind it.
  const tenths = Math.floor((entry.finishSeconds * 10) % 10);
  return t('hudChrome.mortarOverdrive.podiumTime', {
    minutes: num(minutes),
    seconds: clockSeconds(seconds, true),
    tenths: num(tenths),
  });
}

/** The headline: the viewer's own result, with the return countdown in it. The
 *  race strip goes quiet while this is up, so the line lives in one place. */
function returnLabel(view: MortarOverdrivePodiumView): string {
  const seconds = num(view.returnIn);
  if (view.result === 'won') return t('hudChrome.mortarOverdrive.wonReturn', { seconds });
  if (view.result === 'draw') return t('hudChrome.mortarOverdrive.drawReturn', { seconds });
  return t('hudChrome.mortarOverdrive.lostReturn', { seconds });
}
