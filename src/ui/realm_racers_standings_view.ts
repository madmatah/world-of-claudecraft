// Pure view model for the Realm Racers standings panel: the live 1st-to-4th
// leaderboard the race HUD carries. DOM-free, i18n-free, Three-free.
//
// It exists because a four-pilot grid is mostly INVISIBLE. Server interest and
// the client draw range are both well under a 454 yard lap, so for most of a
// race the only evidence that three other machines are out there is this panel.
// The rows therefore read like party frames (one per pilot, ordered by placing)
// rather than like a table of numbers.
//
// The row carries no CLASS. A pilot's class has no effect on the machine (see
// `racerInfo` in sim/social/realm_racers.ts), so the crest the row used to draw
// was decoration paid for in the one resource this panel is short of: width.
// The name is what a pilot reads at speed, and on a 240px panel the crest cost
// it about a quarter of its letters. The podium still draws crests; it has the
// room and no name to truncate.
//
// The right-hand column is the LAP, not a distance. A distance to a machine
// nobody can see is a number a pilot has to interpret; "Lap 3/4" beside "Lap
// 2/4" says the one thing that is actually actionable at racing speed, which is
// whether the rival ahead is on the same lap at all.

import type { RealmRacersMatchInfo } from '../world_api';

export interface RealmRacersStandingsRow {
  pid: number;
  /** 1-based live placing, 1 is the leader. */
  placing: number;
  name: string;
  /** Lap this pilot is on, already clamped to the race length. */
  lap: number;
  isMe: boolean;
  finished: boolean;
  /** Quit rather than finished: still classified, no longer on the circuit. */
  retired: boolean;
  /**
   * True for a house pilot (`botTier` set on the racer), so a queued race the
   * realm backfilled never reads as an all-human grid. Deliberately a boolean,
   * not the tier: the tier badge was removed from this panel as noise, and the
   * one thing the row says is who is not human.
   */
  bot: boolean;
}

export interface RealmRacersStandingsView {
  active: boolean;
  rows: readonly RealmRacersStandingsRow[];
  totalLaps: number;
  /**
   * Repaint signature over everything the panel draws. Unlike the strip's other
   * readouts there is no fast-moving value left in a row (the lap changes a
   * handful of times a race, the placing only on a pass), so the whole panel is
   * rebuilt on change rather than written through per-cell.
   */
  sig: string;
}

/**
 * Module-level REUSED containers (the allocation-light per-frame contract,
 * src/ui/CLAUDE.md): this view is built once per frame for the whole race, so
 * a fresh array + row objects per call is per-frame garbage. `rows` is trimmed
 * to the live grid while `rowPool` keeps the high-water slot objects, so every
 * slot keeps its identity across frames and only primitives are mutated. A
 * caller reads the frame's values before the next build, which the synchronous
 * paint in `RealmRacersStandingsPanel.update` does.
 */
const rowPool: RealmRacersStandingsRow[] = [];
const rows: RealmRacersStandingsRow[] = [];
const state: {
  active: boolean;
  rows: RealmRacersStandingsRow[];
  totalLaps: number;
  sig: string;
} = { active: false, rows, totalLaps: 0, sig: 'off' };

export function buildRealmRacersStandingsView(
  match: RealmRacersMatchInfo | null,
): RealmRacersStandingsView {
  if (!match) {
    state.active = false;
    rows.length = 0;
    state.totalLaps = 0;
    state.sig = 'off';
    return state;
  }
  const viewerPid = match.me.pid;
  const standings = match.standings;
  rows.length = standings.length;
  let sig = `${match.id}|${match.gridSize}|${match.totalLaps}|`;
  for (let i = 0; i < standings.length; i++) {
    let row = rowPool[i];
    if (!row) {
      row = {
        pid: 0,
        placing: 0,
        name: '',
        lap: 0,
        isMe: false,
        finished: false,
        retired: false,
        bot: false,
      };
      rowPool[i] = row;
    }
    rows[i] = row;
    const racer = standings[i];
    row.pid = racer.pid;
    row.placing = racer.position;
    row.name = racer.name;
    row.lap = racer.lap;
    row.isMe = racer.pid === viewerPid;
    row.finished = racer.finished;
    row.retired = racer.retired;
    row.bot = racer.botTier !== null;
    sig +=
      `${i === 0 ? '' : ','}${row.pid}:${row.placing}${row.isMe ? '*' : ''}/${row.lap}` +
      `${row.finished ? 'f' : ''}${row.retired ? 'r' : ''}${row.bot ? 'b' : ''}`;
  }
  state.active = true;
  state.totalLaps = match.totalLaps;
  state.sig = sig;
  return state;
}
