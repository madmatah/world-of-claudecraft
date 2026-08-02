// The Realm Racers podium: the end-of-race ceremony, centred over the viewport.
// The pure core (realm_racers_podium_view.ts) decides who stands where; this
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

import { formatNumber, t } from './i18n';
import { iconDataUrl } from './icons';
import type { PainterHostWriters } from './painter_host';
import type { RealmRacersPodiumEntry, RealmRacersPodiumView } from './realm_racers_podium_view';

/** Portrait edge on a podium step. Bigger than the standings row's 20: this is
 *  the one moment the pilots are meant to be looked at rather than scanned. */
const STEP_CREST_PX = 44;
/** And on the rows listed under it, which stay at the roster size. */
const REST_CREST_PX = 20;

const SHOWN_CLASS = 'shown';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

export interface RealmRacersPodiumDeps {
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
}

export class RealmRacersPodium {
  private root: HTMLElement | null = null;
  private returnEl: HTMLElement | null = null;
  private lastSig = '';

  constructor(private readonly deps: RealmRacersPodiumDeps) {}

  /** Re-paint from the current locale on the next update: the signature is over
   *  the classification, which a language change cannot move. */
  relocalize(): void {
    this.lastSig = '';
  }

  update(view: RealmRacersPodiumView): void {
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
      root.innerHTML = this.markup(view);
      this.returnEl = root.querySelector('.rally-podium-return');
      this.paintNames(root, view);
    }
    if (this.returnEl) w.setText(this.returnEl, returnLabel(view));
  }

  /**
   * The skeleton: steps in display order, then the rows below. It carries no
   * player text at all, which is what lets it be a template string; the names
   * are written into it by paintNames.
   *
   * The heading slot is deliberately empty. Workstream 13 puts the circuit's
   * name there once there is more than one circuit to name.
   */
  private markup(view: RealmRacersPodiumView): string {
    const steps = view.steps
      .map(
        (entry) =>
          `<li class="rally-podium-step p${entry.placing}${entry.isMe ? ' me' : ''}">` +
          `<img class="rally-podium-crest" src="${iconDataUrl('crest', `class_${entry.cls}`, STEP_CREST_PX)}" alt="">` +
          `<span class="rally-podium-name"></span>` +
          `<span class="rally-podium-time"></span>` +
          `<span class="rally-podium-block"><span class="rally-podium-place">${num(entry.placing)}</span></span>` +
          `</li>`,
      )
      .join('');
    const rest = view.rest
      .map(
        (entry) =>
          `<li class="rally-podium-row${entry.isMe ? ' me' : ''}">` +
          `<span class="rally-podium-row-place">${num(entry.placing)}</span>` +
          `<img class="rally-podium-row-crest" src="${iconDataUrl('crest', `class_${entry.cls}`, REST_CREST_PX)}" alt="">` +
          `<span class="rally-podium-name"></span>` +
          `<span class="rally-podium-time"></span>` +
          `</li>`,
      )
      .join('');
    return (
      `<ol class="rally-podium-steps">${steps}</ol>` +
      (rest ? `<ol class="rally-podium-rest">${rest}</ol>` : '') +
      `<div class="rally-podium-return" aria-live="polite"></div>`
    );
  }

  /** Names and times, in the order the skeleton laid them out. */
  private paintNames(root: HTMLElement, view: RealmRacersPodiumView): void {
    const w = this.deps.writers;
    const names = [...root.querySelectorAll('.rally-podium-name')] as HTMLElement[];
    const times = [...root.querySelectorAll('.rally-podium-time')] as HTMLElement[];
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
    root.id = 'realm-racers-podium';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    layer.appendChild(root);
    this.root = root;
    return root;
  }
}

/** A finisher's race time, or where the flag caught a pilot who was still out. */
function timeLabel(entry: RealmRacersPodiumEntry, totalLaps: number): string {
  if (entry.retired) return t('hudChrome.rally.standingsRetired');
  if (entry.finishSeconds === null) {
    return t('hudChrome.rally.lap', { lap: num(entry.lap), total: num(totalLaps) });
  }
  const minutes = Math.floor(entry.finishSeconds / 60);
  const seconds = Math.floor(entry.finishSeconds % 60);
  // Tenths, floored with the rest: a time that rounds UP can read as slower than
  // the machine that actually finished behind it.
  const tenths = Math.floor((entry.finishSeconds * 10) % 10);
  return t('hudChrome.rally.podiumTime', {
    minutes: num(minutes),
    seconds: String(seconds).padStart(2, '0'),
    tenths: num(tenths),
  });
}

/** The headline: the viewer's own result, with the return countdown in it. The
 *  race strip goes quiet while this is up, so the line lives in one place. */
function returnLabel(view: RealmRacersPodiumView): string {
  const seconds = num(view.returnIn);
  if (view.result === 'won') return t('hudChrome.rally.wonReturn', { seconds });
  if (view.result === 'draw') return t('hudChrome.rally.drawReturn', { seconds });
  return t('hudChrome.rally.lostReturn', { seconds });
}
