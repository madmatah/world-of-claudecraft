// The Realm Racers standings panel: the race's live leaderboard, in the
// top-left corner where the party frames sit. The pure core
// (realm_racers_standings_view.ts) decides the rows; this paints them.
//
// A KEYED POOL, one row node per pid, held for the life of the race. That is
// what buys the overtake animation: a full innerHTML rebuild destroys its nodes,
// and a destroyed node cannot animate from where it used to be. Rows trade
// places, which in a close race is several times a second.
//
// The slide needs no measurement and no layout read. Rows are uniform, so a row
// that gained a place animates from `translateY(100%)`, which is exactly one row
// below wherever it now sits; the stylesheet owns the distance and the duration,
// and drops both under prefers-reduced-motion.

import { formatNumber, t } from './i18n';
import type { PainterHostWriters } from './painter_host';
import type {
  RealmRacersStandingsRow,
  RealmRacersStandingsView,
} from './realm_racers_standings_view';

const ROW_CLASS = 'rally-standing';
const ME_CLASS = 'me';
const OUT_CLASS = 'out';
/** Set for one paint's worth of movement; the stylesheet owns what they do. */
const GAINED_CLASS = 'gained';
const LOST_CLASS = 'lost';
/** On the panel itself: the stylesheet transitions it in from the left edge. */
const SHOWN_CLASS = 'shown';

const num = (value: number): string => formatNumber(value, { maximumFractionDigits: 0 });

/** One pooled row and the cells it writes into, resolved once at build time
 *  rather than re-queried per paint. */
interface PooledRow {
  el: HTMLElement;
  place: HTMLElement;
  name: HTMLElement;
  you: HTMLElement;
  bot: HTMLElement;
  lap: HTMLElement;
  /** Last painted placing, which is what decides the movement cue. */
  placing: number;
}

export interface RealmRacersStandingsPanelDeps {
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
}

export class RealmRacersStandingsPanel {
  private list: HTMLElement | null = null;
  private readonly rows = new Map<number, PooledRow>();
  private lastSig = '';

  constructor(private readonly deps: RealmRacersStandingsPanelDeps) {}

  /** Re-paint from the current locale on the next update: the signature is over
   *  the DATA, so a language change alone would never move it. */
  relocalize(): void {
    this.lastSig = '';
  }

  update(view: RealmRacersStandingsView): void {
    const list = this.ensure();
    if (!list) return;
    const w = this.deps.writers;
    w.toggleClass(list, SHOWN_CLASS, view.active);
    if (!view.active) {
      // Keep the pool: a race that ends and a race that starts are different
      // ids, and the signature check below rebuilds the roster either way.
      this.lastSig = '';
      return;
    }
    if (view.sig === this.lastSig) return;
    this.lastSig = view.sig;

    const order: PooledRow[] = [];
    const live = new Set<number>();
    for (const row of view.rows) {
      live.add(row.pid);
      const pooled = this.rowFor(row);
      this.paintRow(pooled, row, view.totalLaps);
      order.push(pooled);
    }
    for (const [pid, pooled] of this.rows) {
      if (live.has(pid)) continue;
      pooled.el.remove();
      this.rows.delete(pid);
    }
    this.reorder(order);
  }

  /** Minimal moves: walk the desired order beside the live child list and only
   *  re-parent a node that is not already where it belongs. */
  private reorder(order: readonly PooledRow[]): void {
    const list = this.list;
    if (!list) return;
    let ref: ChildNode | null = list.firstChild;
    for (const row of order) {
      if (ref === row.el) {
        ref = row.el.nextSibling;
        continue;
      }
      list.insertBefore(row.el, ref);
    }
  }

  private paintRow(pooled: PooledRow, row: RealmRacersStandingsRow, totalLaps: number): void {
    const w = this.deps.writers;
    // The movement cue, before the placing is remembered. A row keeps the class
    // until a later paint leaves its placing alone, which is what lets the same
    // keyframe run again on the next overtake; two gains on consecutive paints
    // with nothing between them therefore animate once, which no player can see.
    const gained = pooled.placing !== 0 && row.placing < pooled.placing;
    const lost = pooled.placing !== 0 && row.placing > pooled.placing;
    w.toggleClass(pooled.el, GAINED_CLASS, gained);
    w.toggleClass(pooled.el, LOST_CLASS, lost);
    pooled.placing = row.placing;

    w.setText(pooled.place, num(row.placing));
    // The pilot's own name, always. The marker is its OWN cell beside it rather
    // than a suffix on the same string: the name is what truncates on a narrow
    // panel, and a marker glued to its end is the first thing an ellipsis eats.
    w.setText(pooled.name, row.name);
    w.setText(pooled.you, row.isMe ? t('hudChrome.rally.standingsYou') : '');
    // The house-pilot marker, the game's ONE AI badge. The title mirrors the
    // text so hover names it too; both ride the row signature (the core's
    // `bot` flag) and the empty cell collapses in CSS.
    const botLabel = row.bot ? t('hudChrome.rally.standingsBot') : '';
    w.setText(pooled.bot, botLabel);
    w.setAttr(pooled.bot, 'title', botLabel);
    w.setText(pooled.lap, lapLabel(row, totalLaps));
    w.toggleClass(pooled.el, ME_CLASS, row.isMe);
    w.toggleClass(pooled.el, OUT_CLASS, row.retired);
  }

  private rowFor(row: RealmRacersStandingsRow): PooledRow {
    const existing = this.rows.get(row.pid);
    if (existing) return existing;
    const el = document.createElement('li');
    el.className = ROW_CLASS;
    el.innerHTML =
      `<span class="rally-standing-place"></span>` +
      `<span class="rally-standing-id"><span class="rally-standing-name"></span>` +
      `<span class="rally-standing-you"></span>` +
      `<span class="rally-standing-bot"></span></span>` +
      `<span class="rally-standing-lap"></span>`;
    const pooled: PooledRow = {
      el,
      place: el.querySelector('.rally-standing-place') as HTMLElement,
      name: el.querySelector('.rally-standing-name') as HTMLElement,
      you: el.querySelector('.rally-standing-you') as HTMLElement,
      bot: el.querySelector('.rally-standing-bot') as HTMLElement,
      lap: el.querySelector('.rally-standing-lap') as HTMLElement,
      placing: 0,
    };
    this.list?.appendChild(el);
    this.rows.set(row.pid, pooled);
    return pooled;
  }

  private ensure(): HTMLElement | null {
    if (this.list) return this.list;
    const layer = this.deps.layer();
    if (!layer) return null;
    const list = document.createElement('ol');
    list.id = 'realm-racers-standings';
    list.setAttribute('role', 'status');
    list.setAttribute('aria-live', 'off');
    layer.appendChild(list);
    this.list = list;
    return list;
  }
}

/** The right-hand column: the lap while a pilot is driving, and where they
 *  stopped once they are not. */
function lapLabel(row: RealmRacersStandingsRow, totalLaps: number): string {
  if (row.retired) return t('hudChrome.rally.standingsRetired');
  if (row.finished) return t('hudChrome.rally.standingsFinished');
  return t('hudChrome.rally.lap', { lap: num(row.lap), total: num(totalLaps) });
}
