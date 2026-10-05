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

/**
 * Module-level REUSED containers (the allocation-light per-frame contract,
 * src/ui/CLAUDE.md), the standings view's shape: this view is built every frame
 * the podium is up, so a fresh entry per pilot, two lists and a view per call is
 * per-frame garbage. `entryPool` keeps the high-water entry objects in
 * classification order while `steps` and `rest` are refilled in place, so every
 * entry keeps its identity across frames and only primitives are mutated. A
 * caller reads a frame's values before the next build, which the synchronous
 * paint in `RealmRacersPodium.update` does.
 */
const entryPool: RealmRacersPodiumEntry[] = [];
const steps: RealmRacersPodiumEntry[] = [];
const rest: RealmRacersPodiumEntry[] = [];
const state: RealmRacersPodiumView = {
  active: false,
  circuitId: '',
  steps,
  rest,
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
  steps.length = 0;
  rest.length = 0;
  // A void race has no classification to celebrate.
  if (!match || !match.decided || match.voided) {
    state.active = false;
    state.circuitId = '';
    state.totalLaps = 0;
    state.result = null;
    state.returnIn = 0;
    state.sig = 'off';
    return state;
  }
  const viewerPid = match.me.pid;
  const standings = match.standings;
  // The return countdown is out of the signature: it ticks once a second and
  // the painter writes it through the elided writers, so it may not rebuild the
  // whole ceremony. The circuit is IN, even though it cannot move inside one
  // match id: the heading is structure the painter builds from it, so the thing
  // that decides the heading has to be the thing that rebuilds it.
  let sig = `${match.id}|${match.circuitId}|${match.result ?? '-'}|`;
  for (let i = 0; i < standings.length; i++) {
    let entry = entryPool[i];
    if (!entry) {
      entry = {
        pid: 0,
        placing: 0,
        name: '',
        cls: 'warrior',
        isMe: false,
        finishSeconds: null,
        lap: 0,
        retired: false,
      };
      entryPool[i] = entry;
    }
    const racer = standings[i];
    entry.pid = racer.pid;
    entry.placing = racer.position;
    entry.name = racer.name;
    entry.cls = racer.cls;
    entry.isMe = racer.pid === viewerPid;
    entry.finishSeconds = racer.finishSeconds;
    entry.lap = racer.lap;
    entry.retired = racer.retired;
    sig += `${i === 0 ? '' : ','}${entry.pid}:${entry.placing}${entry.isMe ? '*' : ''}`;
    if (i >= RALLY_PODIUM_STEPS) rest.push(entry);
  }
  for (let i = 0; i < STEP_ORDER.length; i++) {
    const index = STEP_ORDER[i];
    if (index < standings.length && index < RALLY_PODIUM_STEPS) steps.push(entryPool[index]);
  }
  state.active = true;
  state.circuitId = match.circuitId;
  state.totalLaps = match.totalLaps;
  state.result = match.result;
  state.returnIn = match.returnIn;
  state.sig = sig;
  return state;
}
