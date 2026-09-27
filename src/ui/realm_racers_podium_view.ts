// Pure view model for the Realm Racers podium: the end-of-race ceremony, big
// and centred. DOM-free, i18n-free, Three-free.
//
// It exists because a race used to end on one line of text and a standings
// panel that quietly stopped moving. There was no moment to enjoy, which on a
// four-pilot grid is most of what a race is for.
//
// It keys on `decided`, the RACE's own state, never on `phase`, which is the
// VIEWER's: a pilot who quit while three rivals are still driving reads
// `phase: 'finished'` and there is no classification to show them yet. So a
// quitter gets their forfeit tableau, and everyone still in the match when the
// flag falls gets the podium, whether they crossed the line or were caught by
// it out on the circuit.

import type { PlayerClass } from '../sim/types';
import type { RealmRacersMatchInfo, RealmRacersResult } from '../world_api';

/** How many places stand on the podium proper. The rest are listed under it,
 *  which is the convention every real classification uses. */
export const RALLY_PODIUM_STEPS = 3;

export interface RealmRacersPodiumEntry {
  pid: number;
  placing: number;
  name: string;
  cls: PlayerClass;
  isMe: boolean;
  /** Race time in seconds, or null for a pilot the flag caught still driving. */
  finishSeconds: number | null;
  /** Their lap, which is what a row with no time shows instead. */
  lap: number;
  retired: boolean;
}

export interface RealmRacersPodiumView {
  active: boolean;
  /** The circuit the race was run on, as a record id: it heads the ceremony,
   *  which is the slot workstream 12 left empty for exactly this. */
  circuitId: string;
  /**
   * The top three in DISPLAY order, second to the left of first: the shape of a
   * real podium, not the classification order. Shorter than three only if a
   * future grid is.
   */
  steps: readonly RealmRacersPodiumEntry[];
  /** Everyone below the podium, in classification order. */
  rest: readonly RealmRacersPodiumEntry[];
  totalLaps: number;
  /** The viewer's own result, which is what the headline says. */
  result: RealmRacersResult;
  returnIn: number;
  sig: string;
}

const EMPTY: RealmRacersPodiumView = {
  active: false,
  circuitId: '',
  steps: [],
  rest: [],
  totalLaps: 0,
  result: null,
  returnIn: 0,
  sig: 'off',
};

/** Second, first, third: the middle step is the tall one. */
const STEP_ORDER = [1, 0, 2] as const;

export function buildRealmRacersPodiumView(
  match: RealmRacersMatchInfo | null,
): RealmRacersPodiumView {
  // A void race has no classification to celebrate.
  if (!match || !match.decided || match.voided) return EMPTY;
  const viewerPid = match.me.pid;
  const entries = match.standings.map((racer) => ({
    pid: racer.pid,
    placing: racer.position,
    name: racer.name,
    cls: racer.cls,
    isMe: racer.pid === viewerPid,
    finishSeconds: racer.finishSeconds,
    lap: racer.lap,
    retired: racer.retired,
  }));
  const top = entries.slice(0, RALLY_PODIUM_STEPS);
  const steps = STEP_ORDER.flatMap((index) => (top[index] ? [top[index]] : []));
  return {
    active: true,
    circuitId: match.circuitId,
    steps,
    rest: entries.slice(RALLY_PODIUM_STEPS),
    totalLaps: match.totalLaps,
    result: match.result,
    returnIn: match.returnIn,
    // The return countdown is out: it ticks once a second and the painter writes
    // it through the elided writers, so it may not rebuild the whole ceremony.
    // The circuit is IN, even though it cannot move inside one match id: the
    // heading is structure the painter builds from it, so the thing that
    // decides the heading has to be the thing that rebuilds it.
    sig: `${match.id}|${match.circuitId}|${match.result ?? '-'}|${entries
      .map((entry) => `${entry.pid}:${entry.placing}${entry.isMe ? '*' : ''}`)
      .join(',')}`,
  };
}
