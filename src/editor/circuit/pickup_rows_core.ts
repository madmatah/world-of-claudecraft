// The RACE tool's one canvas gesture: laying a row of pickup boxes across the
// road, and picking one back up again.
//
// A row is one lap fraction, so the gesture is one click and everything it needs
// to decide is here: which fraction a click on the plan means, whether the click
// landed on a row that already exists, and what adding or removing one does to
// the record's list.
//
// Where the boxes THEMSELVES end up is not decided here and must not be:
// `src/sim/realm_racers_pickups.ts` resolves a row into boxes, the game draws
// what it returns, and the plan draws the same thing. The bug class that rule
// exists for is the one the dressing already met once, a tool drawing a
// placement the game did not have.
//
// Pure and DOM-free, deterministic, no rng. Dev tool, so English lives here.

import type { RallyPickupRow, RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import { realmRacersPickupBoxes } from '../../sim/realm_racers_pickups';
import { realmRacersTrack } from '../../sim/realm_racers_spline';
import { NUDGE_STEP_BIG_YD, NUDGE_STEP_YD } from '../placement_transform_core';

/**
 * How close two rows may be authored, as a lap fraction.
 *
 * A row is a couple of yards deep and its boxes are taken by anything driving
 * through them, so two rows a yard apart are one row a machine collects twice.
 * A click inside this of an existing row is read as aiming AT that row rather
 * than as authoring a second one.
 */
export const PICKUP_ROW_MIN_GAP = 0.01;

/** How many rows a circuit may carry. A ceiling rather than a design: past this
 *  a lap is a corridor of boxes and something upstream is wrong. */
export const MAX_PICKUP_ROWS = 32;

/**
 * The lap fraction a point on the plan means, or null when the point is not on
 * the road at all.
 *
 * Null rather than the nearest fraction, and that is the gesture's whole
 * refusal: a row is authored ON the road, so a click out in the lawn is a miss
 * to be reported rather than a row laid a hundred yards away from the pointer.
 *
 * The boundary is the ROAD EDGE, not the garden edge every DRESSING placement is
 * judged against, and the difference is deliberate: the dressing's question is
 * "may this piece stand here", whose answer is the whole racing surface, and this
 * one's is "did the operator point at the road", whose answer is the road. It
 * also has to be the road because that is what the readout measures a row
 * against (`pickup_row_off_road`) and what the status line says: a click on the
 * verge that authored a row would be the tool accepting a gesture with one
 * boundary and judging it by another.
 *
 * The projection is UNHINTED, which on a circuit whose two stretches run close
 * (the Express Tour's pinch) can answer with the far one. That is visible
 * immediately, because the row draws itself where it landed, and it is the same
 * limitation every unhinted placement in this tool has.
 */
export function pickupRowFractionAt(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
): number | null {
  const track = realmRacersTrack(circuit);
  const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
  if (Math.abs(projection.lateral) > track.halfWidthAt(projection.s)) return null;
  return track.length <= 0 ? null : projection.s / track.length;
}

/**
 * Where along the lap a point is, whatever it is standing on.
 *
 * The unconstrained twin of `pickupRowFractionAt`, and the two answer two
 * different questions on purpose. PLACING asks "did the operator point at the
 * road", which the road edge answers and a miss has to be refused by. MOVING asks
 * "where along the lap is the pointer now", and a drag whose row stopped
 * following because the pointer strayed a yard onto the verge would read as the
 * tool having dropped the gesture. The row itself still ends up on the road: it
 * is authored by its lap position alone and the boxes are resolved across
 * whatever road is there.
 */
export function pickupDragFractionAt(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
): number | null {
  const track = realmRacersTrack(circuit);
  if (track.length <= 0) return null;
  const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
  return projection.s / track.length;
}

/**
 * The row a click is aiming at, or -1.
 *
 * Measured against the row's BOXES rather than against its lap fraction: a row
 * is a line across the road and the operator clicks on the part of it they can
 * see, which at the outer lane is eight yards off the centerline.
 */
export function pickupRowAtPoint(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  tolerance: number,
): number {
  let best = -1;
  let bestDistance = tolerance;
  for (const box of realmRacersPickupBoxes(circuit)) {
    const distance = Math.hypot(
      box.x - REALM_RACERS_ORIGIN.x - x,
      box.z - REALM_RACERS_ORIGIN.z - z,
    );
    if (distance > bestDistance) continue;
    best = box.row;
    bestDistance = distance;
  }
  return best;
}

/** What a placement did, so the status bar can say it rather than leaving the
 *  operator to guess why nothing moved. */
export type PickupRowAddOutcome = 'added' | 'tooClose' | 'full';

export interface PickupRowAdd {
  outcome: PickupRowAddOutcome;
  /** The list to commit; the original array when nothing was added. */
  rows: readonly RallyPickupRow[];
  /** Index of the row the outcome is about: the new one, or the one in the way. */
  index: number;
}

/**
 * A row at `fraction`, inserted in lap order.
 *
 * Sorted rather than appended, so the record reads down the lap and an index is
 * a position on the circuit rather than a history of the editing session. A
 * click too near an existing row selects nothing and authors nothing: it is
 * reported, because a gesture that silently does nothing reads as a broken tool.
 */
export function addPickupRow(rows: readonly RallyPickupRow[], fraction: number): PickupRowAdd {
  // Wrapped only where it has to be: `((f % 1) + 1) % 1` is not the identity on
  // a fraction already in range (it turns 0.2 into 0.19999999999999996), and
  // this number goes on the record.
  const s = fraction >= 0 && fraction < 1 ? fraction : ((fraction % 1) + 1) % 1;
  for (let i = 0; i < rows.length; i++) {
    const gap = Math.abs(rows[i].s - s);
    // Wrapped, so a row at 0.999 and a click at 0.001 are two yards apart on a
    // circuit rather than a whole lap.
    if (Math.min(gap, 1 - gap) < PICKUP_ROW_MIN_GAP) {
      return { outcome: 'tooClose', rows, index: i };
    }
  }
  if (rows.length >= MAX_PICKUP_ROWS) return { outcome: 'full', rows, index: -1 };
  const out = [...rows, { s }].sort((a, b) => a.s - b.s);
  return { outcome: 'added', rows: out, index: out.findIndex((row) => row.s === s) };
}

/** The list without one entry. */
export function removedPickupRow(
  rows: readonly RallyPickupRow[],
  index: number,
): readonly RallyPickupRow[] {
  return rows.filter((_, i) => i !== index);
}

/**
 * A lap fraction in [0, 1).
 *
 * Wrapped only where it has to be, for the reason `addPickupRow` spells out: the
 * `((f % 1) + 1) % 1` round trip is not the identity on a fraction already in
 * range, and these numbers go on the record.
 */
function wrapFraction(fraction: number): number {
  return fraction >= 0 && fraction < 1 ? fraction : ((fraction % 1) + 1) % 1;
}

/** How far apart two lap fractions are the SHORT way round, so a row at 0.999
 *  and one at 0.001 are two yards apart on a circuit rather than a whole lap. */
function gapBetween(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1 - raw);
}

/**
 * Slack on the fraction a row is parked at when it is pushed clear of a
 * neighbour, as a lap fraction.
 *
 * `neighbour + PICKUP_ROW_MIN_GAP` is not reliably one whole gap away from the
 * neighbour once a double has rounded it (0.19 + 0.01 lands at
 * 0.19999999999999998, which measures 0.00999999999999998 away), so the parked
 * row would be refused by the very rule that put it there.
 *
 * The slack has to SURVIVE the commit: every commit rounds a fraction to
 * `FRACTION_PLACES` (4 decimals, `export_core.ts`), so a slack under half that
 * resolution is rounded straight back ONTO the band edge, where the gap
 * measures short in doubles again (0.21 - 0.2 < 0.01), and the record durably
 * held a pair `isClearOf` refuses. One whole resolution step is the smallest
 * value the rounding preserves exactly: a twentieth of a yard on the garden
 * circuit, invisible on the plan, and one definition of "clear" serves the
 * placement, the move, and the committed record alike.
 */
const GAP_SLACK = 1e-4;

/** Is `s` far enough from every row in `rows`? The same test `addPickupRow`
 *  refuses a placement with, so a move cannot author what a click could not. */
function isClearOf(rows: readonly RallyPickupRow[], s: number): boolean {
  return rows.every((row) => gapBetween(row.s, s) >= PICKUP_ROW_MIN_GAP);
}

/**
 * The legal fraction nearest `target`, or null when the lap is too crowded to
 * hold one at all.
 *
 * The legal positions are the lap minus a band of `PICKUP_ROW_MIN_GAP` either
 * side of every other row, so when the target is inside a band the answer is one
 * of that band's two EDGES, whichever is nearer. That is what makes a drag past a
 * neighbour a swap rather than a wall: approaching from behind, the near edge is
 * the one in front of the neighbour, and the moment the pointer passes the
 * neighbour's own fraction the far edge becomes the nearer one and the row hops
 * across. Nothing in between is ever committed, so the record never holds two
 * rows a click could not have authored.
 */
function nearestClearFraction(others: readonly RallyPickupRow[], target: number): number | null {
  if (isClearOf(others, target)) return target;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of others) {
    for (const side of [-1, 1] as const) {
      const candidate = wrapFraction(row.s + side * (PICKUP_ROW_MIN_GAP + GAP_SLACK));
      if (!isClearOf(others, candidate)) continue;
      const distance = gapBetween(candidate, target);
      // Strict, so the lower `others` index wins an exact tie and a drag dropped
      // dead between two neighbours lands the same way on every run.
      if (distance >= bestDistance) continue;
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

export type PickupRowMoveOutcome = 'moved' | 'blocked';

export interface PickupRowMove {
  outcome: PickupRowMoveOutcome;
  /** The list to commit; the original array when nothing moved. */
  rows: readonly RallyPickupRow[];
  /** Where the row ended up, which is NOT where it started once a move has
   *  carried it past a neighbour. */
  index: number;
}

/**
 * The row at `index`, moved to `fraction`.
 *
 * The row is held by its VALUE rather than by its index, because the list is
 * sorted by lap position and a move that crosses a neighbour renumbers both: the
 * caller's selection follows the returned index, exactly as it follows
 * `addPickupRow`'s.
 *
 * `blocked` is very nearly unreachable (it needs a lap with no clear fraction
 * left on it at all), and it is an outcome rather than a throw for the reason the
 * placement refusals are: the caller has a status bar to say so with.
 */
export function movedPickupRow(
  rows: readonly RallyPickupRow[],
  index: number,
  fraction: number,
): PickupRowMove {
  if (index < 0 || index >= rows.length) return { outcome: 'blocked', rows, index };
  const others = rows.filter((_, i) => i !== index);
  const s = nearestClearFraction(others, wrapFraction(fraction));
  if (s === null) return { outcome: 'blocked', rows, index };
  const out = [...others, { s }].sort((a, b) => a.s - b.s);
  return { outcome: 'moved', rows: out, index: out.findIndex((row) => row.s === s) };
}

/** Which way along the LAP an arrow key moves a row, or null for a key that is
 *  not one of the two. */
export function pickupNudgeDirection(key: string): 1 | -1 | null {
  if (key === 'ArrowRight') return 1;
  if (key === 'ArrowLeft') return -1;
  return null;
}

/**
 * Where an arrow key takes a row, as a lap fraction.
 *
 * The step is a length in YARDS divided by the lap, never a fraction of a lap,
 * which is the same rule the width tool's ramps follow: a fixed fraction would
 * mean 4.5 yards on the garden circuit and 8.3 on the Express Tour, and a nudge
 * has to mean one thing everywhere. The two step sizes are the map editor's own,
 * so a nudge means the same in both tools.
 *
 * Only the two horizontal arrows are mapped, because a row has one degree of
 * freedom: `left` is back down the lap and `right` is on down it, the way a
 * scrubber reads. Up and down would have to invent a lateral the record cannot
 * carry.
 */
export function nudgedPickupFraction(
  s: number,
  lapLength: number,
  direction: 1 | -1,
  big: boolean,
): number {
  const yards = big ? NUDGE_STEP_BIG_YD : NUDGE_STEP_YD;
  return s + direction * (lapLength > 0 ? yards / lapLength : 0);
}
