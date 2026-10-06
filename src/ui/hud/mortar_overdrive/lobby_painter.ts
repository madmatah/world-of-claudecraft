// Mortar Overdrive loading lobby: the thin painter over mortar_overdrive/lobby_view.ts.
// A self-mounted full-screen curtain (#mortar-overdrive-lobby) in the HUD layer,
// with one panel on it: the drawn circuit's name, every pilot on the grid with
// Waiting or Ready, this machine's own preparation bar, and the lobby's wait.
//
// It is a CURTAIN in the arrival family (src/render/arrival_cover.ts): while
// this machine is still preparing it holds one arrival-cover depth, so the
// GPU-prep admission runs the covered frames on the cover rule, the way it does
// under the loading screen. Once the preparation has settled the depth drops
// while the curtain stays up, so the boot-debt and background lanes the cover
// refuses run behind the curtain instead of landing in the countdown.
//
// What lifts it is decided outside: the view hides on the server's countdown,
// and the Mortar Overdrive UI hides it on a lost connection or its client failsafe. While
// shown it holds the window and menu keys (its owner's MortarOverdriveLobbyHold,
// mortar_overdrive/lobby_hold.ts), and it
// is mounted FIRST in the layer so the chat frame, a later sibling, can be
// stacked above it (the `mortar overdrive lobby` CSS section). It also marks body
// (MORTAR_OVERDRIVE_LOBBY_SHOWN_CLASS), which lifts the touch chat control over it.
//
// The skeleton is rebuilt in ONE innerHTML write when the structural sig
// changes (a new match, a different grid); every name, status, count and the
// bar ride the PainterHost elided writers, and a localized string is resolved
// again only when the value it spells changes.

import { durationText } from '../../duration_text';
import { esc } from '../../esc';
import { formatNumber, t } from '../../i18n';
import type { PainterHostWriters } from '../../painter_host';
import { MORTAR_OVERDRIVE_LOBBY_SHOWN_CLASS } from '../../root_state_classes';
import { mortarOverdriveCircuitName } from './circuit_i18n';
import type { MortarOverdriveLobbyHold } from './lobby_hold';
import type {
  MortarOverdriveLobbyLive,
  MortarOverdriveLobbyStatus,
  MortarOverdriveLobbyView,
} from './lobby_view';

const SHOWN_CLASS = 'shown';

export interface MortarOverdriveLobbyDeps {
  /** The HUD layer the curtain mounts into (null before the HUD exists). */
  layer(): HTMLElement | null;
  writers: PainterHostWriters;
  /** Raise or drop one arrival-cover depth: the render-side cover
   *  (`src/render/arrival_cover.ts`), handed in by the HUD parts. */
  setCover: (active: boolean) => void;
  /** The window and menu key hold this curtain drives while it is shown. */
  hold?: Pick<MortarOverdriveLobbyHold, 'set'>;
  /** The element carrying the shown state class; body by default. */
  stateRoot?: () => HTMLElement | null;
}

interface PilotSlots {
  name: HTMLElement;
  status: HTMLElement;
  lastStatus: MortarOverdriveLobbyStatus | null;
}

interface Slots {
  count: HTMLElement;
  pilots: PilotSlots[];
  prepLabel: HTMLElement;
  bar: HTMLElement;
  fill: HTMLElement;
  deadline: HTMLElement;
  lastReady: number;
  lastTotal: number;
  lastSeconds: number;
  lastPercent: number;
  lastSettled: boolean | null;
}

export class MortarOverdriveLobby {
  private root: HTMLElement | null = null;
  private slots: Slots | null = null;
  private lastSig = '';
  private raised = false;
  private holding = false;

  constructor(private readonly deps: MortarOverdriveLobbyDeps) {}

  /** Whether this curtain currently holds an arrival-cover depth. */
  get covering(): boolean {
    return this.raised;
  }

  /** Whether the curtain is up (and so holds the window and menu keys). */
  get shown(): boolean {
    return this.holding;
  }

  /** A language switch: rebuild the skeleton with fresh t() on the next update. */
  relocalize(): void {
    this.lastSig = '';
  }

  update(view: MortarOverdriveLobbyView): void {
    const w = this.deps.writers;
    if (!view.visible) {
      if (this.root) w.toggleClass(this.root, SHOWN_CLASS, false);
      this.cover(false);
      this.hold(false);
      this.lastSig = '';
      return;
    }
    const root = this.ensureRoot();
    if (!root) return;
    this.cover(!view.settled);
    this.hold(true);
    if (view.sig !== this.lastSig) {
      this.lastSig = view.sig;
      this.build(root, view);
    }
    w.toggleClass(root, SHOWN_CLASS, true);
    this.paintValues(view);
  }

  /** Drop the cover depth and the key hold, and unmount. */
  dispose(): void {
    this.cover(false);
    this.hold(false);
    this.root?.remove();
    this.root = null;
    this.slots = null;
    this.lastSig = '';
  }

  private cover(active: boolean): void {
    if (active === this.raised) return;
    this.raised = active;
    this.deps.setCover(active);
  }

  private hold(active: boolean): void {
    if (active === this.holding) return;
    this.holding = active;
    this.deps.hold?.set(active);
    const stateRoot = this.deps.stateRoot ? this.deps.stateRoot() : document.body;
    if (stateRoot)
      this.deps.writers.toggleClass(stateRoot, MORTAR_OVERDRIVE_LOBBY_SHOWN_CLASS, active);
  }

  private ensureRoot(): HTMLElement | null {
    if (this.root) return this.root;
    const layer = this.deps.layer();
    if (!layer) return null;
    const el = document.createElement('div');
    el.id = 'mortar-overdrive-lobby';
    el.setAttribute('role', 'dialog');
    layer.prepend(el);
    this.root = el;
    return el;
  }

  /**
   * The heading is present only for a circuit the catalog names: a draft a dev
   * command registered has no name, and an unnamed lobby beats one headed by a
   * raw id (the podium's rule). The dialog is named by the heading, or by the
   * kicker without one. Names are written by setText, never interpolated.
   */
  private build(root: HTMLElement, view: MortarOverdriveLobbyLive): void {
    const circuit = mortarOverdriveCircuitName(view.circuitId);
    const rows = view.pilots
      .map(
        (pilot) =>
          `<li class="mortar-overdrive-lobby-pilot${pilot.isMe ? ' me' : ''}">` +
          `<span class="mortar-overdrive-lobby-name"></span>` +
          (pilot.isMe
            ? `<span class="mortar-overdrive-lobby-tag">${esc(t('hudChrome.mortarOverdrive.standingsYou'))}</span>`
            : '') +
          (pilot.bot
            ? `<span class="mortar-overdrive-lobby-tag">${esc(t('hudChrome.mortarOverdrive.standingsBot'))}</span>`
            : '') +
          `<span class="mortar-overdrive-lobby-status ui-chip"></span></li>`,
      )
      .join('');
    root.innerHTML =
      `<div class="mortar-overdrive-lobby-panel ui-panel">` +
      `<p class="mortar-overdrive-lobby-kicker ui-meta" id="mortar-overdrive-lobby-kicker">` +
      `${esc(t('hudChrome.mortarOverdrive.title'))}</p>` +
      (circuit
        ? `<h2 class="mortar-overdrive-lobby-circuit ui-h" id="mortar-overdrive-lobby-circuit">${esc(circuit)}</h2>`
        : '') +
      `<p class="mortar-overdrive-lobby-count" aria-live="polite"></p>` +
      `<ul class="mortar-overdrive-lobby-pilots">${rows}</ul>` +
      `<div class="mortar-overdrive-lobby-prep">` +
      `<span class="mortar-overdrive-lobby-prep-label" id="mortar-overdrive-lobby-prep-label"></span>` +
      `<div class="mortar-overdrive-lobby-bar ui-bar" role="progressbar" aria-valuemin="0" ` +
      `aria-valuemax="100" aria-valuenow="0" aria-labelledby="mortar-overdrive-lobby-prep-label">` +
      `<div class="mortar-overdrive-lobby-fill ui-bar-fill"></div></div></div>` +
      `<p class="mortar-overdrive-lobby-deadline ui-muted"></p>` +
      `</div>`;
    this.deps.writers.setAttr(
      root,
      'aria-labelledby',
      circuit ? 'mortar-overdrive-lobby-circuit' : 'mortar-overdrive-lobby-kicker',
    );
    const q = (sel: string): HTMLElement => root.querySelector(sel) as HTMLElement;
    const names = [...root.querySelectorAll('.mortar-overdrive-lobby-name')] as HTMLElement[];
    const statuses = [...root.querySelectorAll('.mortar-overdrive-lobby-status')] as HTMLElement[];
    this.slots = {
      count: q('.mortar-overdrive-lobby-count'),
      pilots: names.map((name, index) => ({
        name,
        status: statuses[index] as HTMLElement,
        lastStatus: null,
      })),
      prepLabel: q('.mortar-overdrive-lobby-prep-label'),
      bar: q('.mortar-overdrive-lobby-bar'),
      fill: q('.mortar-overdrive-lobby-fill'),
      deadline: q('.mortar-overdrive-lobby-deadline'),
      lastReady: -1,
      lastTotal: -1,
      lastSeconds: -1,
      lastPercent: -1,
      lastSettled: null,
    };
  }

  private paintValues(view: MortarOverdriveLobbyLive): void {
    const s = this.slots;
    if (!s) return;
    const w = this.deps.writers;
    const total = view.pilots.length;
    if (view.readyCount !== s.lastReady || total !== s.lastTotal) {
      s.lastReady = view.readyCount;
      s.lastTotal = total;
      w.setText(
        s.count,
        t('hudChrome.mortarOverdrive.lobbyReadyCount', {
          ready: formatNumber(view.readyCount),
          total: formatNumber(total),
        }),
      );
    }
    for (let index = 0; index < total; index++) {
      const pilot = view.pilots[index] as MortarOverdriveLobbyLive['pilots'][number];
      const slot = s.pilots[index];
      if (!slot) continue;
      w.setText(slot.name, pilot.name);
      if (pilot.status === slot.lastStatus) continue;
      slot.lastStatus = pilot.status;
      const ready = pilot.status === 'ready';
      w.setText(
        slot.status,
        ready
          ? t('hudChrome.mortarOverdrive.lobbyReady')
          : t('hudChrome.mortarOverdrive.lobbyWaiting'),
      );
      w.toggleClass(slot.status, 'is-on', ready);
    }
    if (view.settled !== s.lastSettled) {
      s.lastSettled = view.settled;
      w.setText(
        s.prepLabel,
        view.settled
          ? t('hudChrome.mortarOverdrive.lobbyPrepared')
          : t('hudChrome.mortarOverdrive.lobbyPreparing'),
      );
    }
    if (view.percent !== s.lastPercent) {
      s.lastPercent = view.percent;
      w.setWidth(s.fill, `${view.percent}%`);
      w.setAttr(s.bar, 'aria-valuenow', String(view.percent));
      w.setAttr(
        s.bar,
        'aria-valuetext',
        formatNumber(view.percent / 100, { style: 'percent', maximumFractionDigits: 0 }),
      );
    }
    if (view.secondsLeft !== s.lastSeconds) {
      s.lastSeconds = view.secondsLeft;
      w.setText(
        s.deadline,
        t('hudChrome.mortarOverdrive.lobbyStartsBy', { time: durationText(view.secondsLeft) }),
      );
    }
  }
}
