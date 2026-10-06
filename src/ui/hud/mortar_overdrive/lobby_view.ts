// Mortar Overdrive loading lobby: the pure, DOM-free view core behind the curtain
// that covers a race while every pilot's machine prepares it. It shows only
// while THIS viewer's match is in its `loading` phase, so it lifts for the
// whole grid on the server's switch to the countdown (never on this client's
// own readiness), and a reconnect into a race already under way never sees it.
//
// Pilots are the grid in its frozen order (`participantIds`), named from the
// standings; a house pilot is ready from the seat. The progress is this
// machine's own preparation (src/render/mortar_overdrive/prepare.ts): prepared
// units over units to prepare, full only once every producer has its verdict.

import type { MortarOverdriveMatchInfo } from '../../../world_api';

export type MortarOverdriveLobbyStatus = 'waiting' | 'ready';

export interface MortarOverdriveLobbyPilot {
  pid: number;
  name: string;
  isMe: boolean;
  bot: boolean;
  status: MortarOverdriveLobbyStatus;
}

/** The slice of the preparation readout the lobby paints. */
export interface MortarOverdriveLobbyProgress {
  done: number;
  total: number;
  settled: boolean;
}

export interface MortarOverdriveLobbyLive {
  visible: true;
  /** Structural identity: the skeleton rebuilds only when this changes. */
  sig: string;
  circuitId: string;
  pilots: readonly MortarOverdriveLobbyPilot[];
  readyCount: number;
  /** Whole seconds until the lobby closes whoever is ready. */
  secondsLeft: number;
  /** Whole percent for the bar and its `aria-valuenow`: 100 only once settled. */
  percent: number;
  /** This machine has finished preparing. */
  settled: boolean;
}

export interface MortarOverdriveLobbyHidden {
  visible: false;
  sig: string;
}

export type MortarOverdriveLobbyView = MortarOverdriveLobbyLive | MortarOverdriveLobbyHidden;

const HIDDEN: MortarOverdriveLobbyHidden = { visible: false, sig: 'hidden' };

/** Whole percent of the preparation: never full before the verdicts are in,
 *  whatever a client's own step count says. */
export function mortarOverdriveLobbyPercent(progress: MortarOverdriveLobbyProgress): number {
  if (progress.settled) return 100;
  const total = Number.isFinite(progress.total) ? progress.total : 0;
  if (total <= 0) return 0;
  const done = Number.isFinite(progress.done) ? Math.max(0, Math.min(total, progress.done)) : 0;
  return Math.min(99, Math.floor((done / total) * 100));
}

// Reused across frames, the standings view's pattern: the lobby repaints every
// frame for up to its whole wait, and one caller paints it.
const pilotPool: MortarOverdriveLobbyPilot[] = [];
const pilots: MortarOverdriveLobbyPilot[] = [];
const LIVE: MortarOverdriveLobbyLive = {
  visible: true,
  sig: '',
  circuitId: '',
  pilots,
  readyCount: 0,
  secondsLeft: 0,
  percent: 0,
  settled: false,
};

export function buildMortarOverdriveLobbyView(
  match: MortarOverdriveMatchInfo | null,
  progress: MortarOverdriveLobbyProgress,
): MortarOverdriveLobbyView {
  if (match?.phase !== 'loading') return HIDDEN;
  const readyIds = match.loading?.readyIds;
  pilots.length = 0;
  let readyCount = 0;
  let shape = '';
  for (const pid of match.participantIds) {
    const racer = match.standings.find((row) => row.pid === pid);
    if (!racer) continue;
    const bot = racer.botTier !== null;
    const ready = bot || (readyIds?.includes(pid) ?? false);
    const isMe = pid === match.me.pid;
    if (ready) readyCount++;
    let pilot = pilotPool[pilots.length];
    if (!pilot) {
      pilot = { pid: 0, name: '', isMe: false, bot: false, status: 'waiting' };
      pilotPool.push(pilot);
    }
    pilot.pid = pid;
    pilot.name = racer.name;
    pilot.isMe = isMe;
    pilot.bot = bot;
    pilot.status = ready ? 'ready' : 'waiting';
    pilots.push(pilot);
    shape += `${pid}${isMe ? 'm' : ''}${bot ? 'b' : ''},`;
  }
  LIVE.sig = `${match.id}|${match.circuitId}|${shape}`;
  LIVE.circuitId = match.circuitId;
  LIVE.readyCount = readyCount;
  LIVE.secondsLeft = Math.max(0, match.loading?.secondsLeft ?? 0);
  LIVE.percent = mortarOverdriveLobbyPercent(progress);
  LIVE.settled = progress.settled;
  return LIVE;
}

/**
 * How long past the lobby deadline the server last announced the curtain may
 * outlive it: a snapshot's latency plus the rounding up of `secondsLeft`.
 */
export const MORTAR_OVERDRIVE_LOBBY_FAILSAFE_GRACE_MS = 2_000;

export interface MortarOverdriveLobbyFailsafe {
  matchId: number | null;
  secondsLeft: number;
  deadlineMs: number;
  expired: boolean;
}

export function createMortarOverdriveLobbyFailsafe(): MortarOverdriveLobbyFailsafe {
  return { matchId: null, secondsLeft: -1, deadlineMs: 0, expired: false };
}

/**
 * Whether the curtain may still stand on this client clock. Each newly received,
 * changed `secondsLeft` becomes a client deadline when it arrives, so a frozen
 * readout (a dead socket, a stalled server) expires the curtain once that
 * deadline plus the grace has passed, while a lobby that is still counting
 * (after a background tab or a long stall of this client) raises it again.
 * A presentation failsafe only: it never sends ready and never touches readiness.
 */
export function stepMortarOverdriveLobbyFailsafe(
  state: MortarOverdriveLobbyFailsafe,
  match: MortarOverdriveMatchInfo | null,
  nowMs: number,
): boolean {
  if (match?.phase !== 'loading') {
    state.matchId = null;
    return false;
  }
  if (match.id !== state.matchId) {
    state.matchId = match.id;
    state.secondsLeft = -1;
  }
  const secondsLeft = Math.max(0, match.loading?.secondsLeft ?? 0);
  if (secondsLeft !== state.secondsLeft) {
    state.secondsLeft = secondsLeft;
    state.deadlineMs = nowMs + secondsLeft * 1000 + MORTAR_OVERDRIVE_LOBBY_FAILSAFE_GRACE_MS;
  }
  state.expired = nowMs > state.deadlineMs;
  return !state.expired;
}
