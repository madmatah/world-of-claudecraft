// Pure view model for the Realm Racers standings panel: the live 1st-to-4th
// leaderboard the race HUD carries. DOM-free, i18n-free, Three-free.
//
// It exists because a four-pilot grid is mostly INVISIBLE. Server interest and
// the client draw range are both well under a 454 yard lap, so for most of a
// race the only evidence that three other machines are out there is this panel.
// The rows therefore read like party frames (portrait plus name, one per pilot,
// ordered by placing) rather than like a table of numbers.
//
// The right-hand column is the LAP, not a distance. A distance to a machine
// nobody can see is a number a pilot has to interpret; "Lap 3/4" beside "Lap
// 2/4" says the one thing that is actually actionable at racing speed, which is
// whether the rival ahead is on the same lap at all.

import type { PlayerClass } from '../sim/types';
import type { RealmRacersMatchInfo } from '../world_api';

export interface RealmRacersStandingsRow {
  pid: number;
  /** 1-based live placing, 1 is the leader. */
  placing: number;
  name: string;
  /** The class whose crest the row draws as this pilot's portrait. */
  cls: PlayerClass;
  /** Lap this pilot is on, already clamped to the race length. */
  lap: number;
  isMe: boolean;
  finished: boolean;
  /** Quit rather than finished: still classified, no longer on the circuit. */
  retired: boolean;
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

const EMPTY: RealmRacersStandingsView = { active: false, rows: [], totalLaps: 0, sig: 'off' };

export function buildRealmRacersStandingsView(
  match: RealmRacersMatchInfo | null,
): RealmRacersStandingsView {
  if (!match) return EMPTY;
  const viewerPid = match.me.pid;
  const rows = match.standings.map((racer) => ({
    pid: racer.pid,
    placing: racer.position,
    name: racer.name,
    cls: racer.cls,
    lap: racer.lap,
    isMe: racer.pid === viewerPid,
    finished: racer.finished,
    retired: racer.retired,
  }));
  const sig = `${match.id}|${match.gridSize}|${match.totalLaps}|${rows
    .map(
      (row) =>
        `${row.pid}:${row.placing}${row.isMe ? '*' : ''}${row.cls}/${row.lap}` +
        `${row.finished ? 'f' : ''}${row.retired ? 'r' : ''}`,
    )
    .join(',')}`;
  return { active: true, rows, totalLaps: match.totalLaps, sig };
}
