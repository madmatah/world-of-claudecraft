// Realm Racers loading lobby: the pure, DOM-free view core behind the curtain
// that covers a race while every pilot's machine prepares it. It shows only
// while THIS viewer's match is in its `loading` phase, so it lifts for the
// whole grid on the server's switch to the countdown (never on this client's
// own readiness), and a reconnect into a race already under way never sees it.
//
// Pilots are the grid in its frozen order (`participantIds`), named from the
// standings; a house pilot is ready from the seat. The progress is this
// machine's own preparation (src/render/realm_racers_prepare.ts): prepared
// units over units to prepare, full only once every producer has its verdict.

import type { RealmRacersMatchInfo } from '../../../world_api';

export type RealmRacersLobbyStatus = 'waiting' | 'ready';

export interface RealmRacersLobbyPilot {
  pid: number;
  name: string;
  isMe: boolean;
  bot: boolean;
  status: RealmRacersLobbyStatus;
}

/** The slice of the preparation readout the lobby paints. */
export interface RealmRacersLobbyProgress {
  done: number;
  total: number;
  settled: boolean;
}

export interface RealmRacersLobbyLive {
  visible: true;
  /** Structural identity: the skeleton rebuilds only when this changes. */
  sig: string;
  circuitId: string;
  pilots: readonly RealmRacersLobbyPilot[];
  readyCount: number;
  /** Whole seconds until the lobby closes whoever is ready. */
  secondsLeft: number;
  /** Whole percent for the bar and its `aria-valuenow`: 100 only once settled. */
  percent: number;
  /** This machine has finished preparing. */
  settled: boolean;
}

export interface RealmRacersLobbyHidden {
  visible: false;
  sig: string;
}

export type RealmRacersLobbyView = RealmRacersLobbyLive | RealmRacersLobbyHidden;

const HIDDEN: RealmRacersLobbyHidden = { visible: false, sig: 'hidden' };

/** Whole percent of the preparation: never full before the verdicts are in,
 *  whatever a client's own step count says. */
export function realmRacersLobbyPercent(progress: RealmRacersLobbyProgress): number {
  if (progress.settled) return 100;
  const total = Number.isFinite(progress.total) ? progress.total : 0;
  if (total <= 0) return 0;
  const done = Number.isFinite(progress.done) ? Math.max(0, Math.min(total, progress.done)) : 0;
  return Math.min(99, Math.floor((done / total) * 100));
}

// Reused across frames, the standings view's pattern: the lobby repaints every
// frame for up to its whole wait, and one caller paints it.
const pilotPool: RealmRacersLobbyPilot[] = [];
const pilots: RealmRacersLobbyPilot[] = [];
const LIVE: RealmRacersLobbyLive = {
  visible: true,
  sig: '',
  circuitId: '',
  pilots,
  readyCount: 0,
  secondsLeft: 0,
  percent: 0,
  settled: false,
};

export function buildRealmRacersLobbyView(
  match: RealmRacersMatchInfo | null,
  progress: RealmRacersLobbyProgress,
): RealmRacersLobbyView {
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
  LIVE.percent = realmRacersLobbyPercent(progress);
  LIVE.settled = progress.settled;
  return LIVE;
}
