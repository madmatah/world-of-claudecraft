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
