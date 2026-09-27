// Realm Racers loading lobby: the thin painter over realm_racers_lobby_view.ts.
// A self-mounted full-screen curtain (#realm-racers-lobby) in the HUD layer,
// with one panel on it: the drawn circuit's name, every pilot on the grid with
// Waiting or Ready, this machine's own preparation bar, and the lobby's wait.
//
// It is a CURTAIN in the arrival family (src/render/arrival_cover.ts): while
// it is up it holds one arrival-cover depth, so the GPU-prep admission and the
// frame cadence treat the covered frames the way they treat the loading
// screen's. The server decides when it lifts (the view hides on the countdown
// phase), which is why it needs no reveal wait of its own and works online,
// where the arrival wait is zero. Like the loading screen it sits over the
// whole HUD layer and takes the pointer off the chrome it hides; the keyboard,
// the ready send and GO are untouched, and the pilot is held on the grid by the
// server anyway.
//
// The skeleton is rebuilt in ONE innerHTML write when the structural sig
// changes (a new match, a different grid); every name, status, count and the
// bar ride the PainterHost elided writers.

import { setArrivalCover } from '../../../render/arrival_cover';
import { durationText } from '../../duration_text';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { realmRacersCircuitName } from '../../realm_racers_circuit_i18n';
import type { RealmRacersLobbyLive, RealmRacersLobbyView } from './realm_racers_lobby_view';

const SHOWN_CLASS = 'shown';

export interface RealmRacersLobbyDeps {
  /** The HUD layer the curtain mounts into (null before the HUD exists). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
  /** Raise or drop one arrival-cover depth; the real cover by default. */
  setCover?: (active: boolean) => void;
}

interface PilotSlots {
  name: HTMLElement;
  status: HTMLElement;
}

interface Slots {
  count: HTMLElement;
  pilots: PilotSlots[];
  prepLabel: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  deadline: HTMLElement;
}

export class RealmRacersLobby {
  private root: HTMLElement | null = null;
  private slots: Slots | null = null;
  private lastSig = '';
  private raised = false;

  constructor(private readonly deps: RealmRacersLobbyDeps) {}

  /** Whether this curtain currently holds an arrival-cover depth. */
  get covering(): boolean {
    return this.raised;
  }

  /** A language switch: rebuild the skeleton with fresh t() on the next update. */
  relocalize(): void {
    this.lastSig = '';
  }

  update(view: RealmRacersLobbyView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.toggleClass(this.root, SHOWN_CLASS, false);
      this.cover(false);
      this.lastSig = '';
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    this.cover(true);
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      this.build(root, view);
    }
    w.toggleClass(root, SHOWN_CLASS, true);
    this.paintValues(view);
  }

  private cover(active: boolean): void {
    if (active === this.raised) return;
    this.raised = active;
    (this.deps.setCover ?? setArrivalCover)(active);
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'realm-racers-lobby';
    layer.appendChild(el);
    this.root = el;
    return el;
  }

  /**
   * The heading is present only for a circuit the catalog names: a draft a dev
   * command registered has no name, and an unnamed lobby beats one headed by a
   * raw id (the podium's rule). Names are written by setText, never
   * interpolated.
   */
  private build(root: HTMLElement, view: RealmRacersLobbyLive): void {
    const circuit = realmRacersCircuitName(view.circuitId);
    const rows = view.pilots
      .map(
        (pilot) =>
          `<li class="rally-lobby-pilot${pilot.isMe ? ' me' : ''}">` +
          `<span class="rally-lobby-name"></span>` +
          (pilot.isMe
            ? `<span class="rally-lobby-tag">${esc(t('hudChrome.rally.standingsYou'))}</span>`
            : '') +
          (pilot.bot
            ? `<span class="rally-lobby-tag">${esc(t('hudChrome.rally.standingsBot'))}</span>`
            : '') +
          `<span class="rally-lobby-status ui-chip"></span></li>`,
      )
      .join('');
    root.innerHTML =
      `<div class="rally-lobby-panel ui-panel">` +
      `<p class="rally-lobby-kicker ui-meta">${esc(t('hudChrome.rally.title'))}</p>` +
      (circuit ? `<h2 class="rally-lobby-circuit ui-h">${esc(circuit)}</h2>` : '') +
      `<p class="rally-lobby-count" aria-live="polite"></p>` +
      `<ul class="rally-lobby-pilots">${rows}</ul>` +
      `<div class="rally-lobby-prep">` +
      `<span class="rally-lobby-prep-label" id="rally-lobby-prep-label"></span>` +
      `<div class="rally-lobby-bar ui-bar" role="progressbar" aria-valuemin="0" ` +
      `aria-valuemax="100" aria-valuenow="0" aria-labelledby="rally-lobby-prep-label">` +
      `<div class="rally-lobby-fill ui-bar-fill"></div></div></div>` +
      `<p class="rally-lobby-deadline ui-muted"></p>` +
      `</div>`;
    const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
    const names = [...root.querySelectorAll('.rally-lobby-name')] as HTMLElement[];
    const statuses = [...root.querySelectorAll('.rally-lobby-status')] as HTMLElement[];
    this.slots = {
      count: q('.rally-lobby-count'),
      pilots: names.map((name, index) => ({ name, status: statuses[index] as HTMLElement })),
      prepLabel: q('.rally-lobby-prep-label'),
      bar: q('.rally-lobby-bar'),
      fill: q('.rally-lobby-fill'),
      deadline: q('.rally-lobby-deadline'),
    };
  }

  private paintValues(view: RealmRacersLobbyLive): void {
    const s = this.slots;
    if (!s) return;
    const w = this.deps.writers;
    w.setText(
      s.count,
      t('hudChrome.rally.lobbyReadyCount', {
        ready: formatNumber(view.readyCount),
        total: formatNumber(view.pilots.length),
      }),
    );
    for (let index = 0; index < view.pilots.length; index++) {
      const pilot = view.pilots[index] as RealmRacersLobbyLive['pilots'][number];
      const slot = s.pilots[index];
      if (!slot) continue;
      const ready = pilot.status === 'ready';
      w.setText(slot.name, pilot.name);
      w.setText(
        slot.status,
        ready ? t('hudChrome.rally.lobbyReady') : t('hudChrome.rally.lobbyWaiting'),
      );
      w.toggleClass(slot.status, 'is-on', ready);
    }
    w.setText(
      s.prepLabel,
      view.settled ? t('hudChrome.rally.lobbyPrepared') : t('hudChrome.rally.lobbyPreparing'),
    );
    w.setWidth(s.fill, `${view.percent}%`);
    w.setAttr(s.bar, 'aria-valuenow', String(view.percent));
    w.setAttr(
      s.bar,
      'aria-valuetext',
      formatNumber(view.percent / 100, { style: 'percent', maximumFractionDigits: 0 }),
    );
    w.setText(
      s.deadline,
      t('hudChrome.rally.lobbyStartsBy', { time: durationText(view.secondsLeft) }),
    );
  }
}
