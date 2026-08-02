// How a Realm Racers grid is ordered, first to last. Pure leaf: no SimContext,
// no rng, no clock beyond the ticks it is handed.
//
// ONE comparator serves both readings of a race, which is the whole point of
// the module. The live standings strip and the final classification are the
// same order sampled at different moments, so a race cannot finish in an order
// the strip never showed.
//
// The order is three bands, in this sequence:
//
//   1. racers who CROSSED the line, earliest crossing first (two machines
//      finishing on the same tick are split by the sub-tick fraction at which
//      each one cut the line);
//   2. racers still DRIVING, furthest down the circuit first;
//   3. racers who QUIT, latest quitter first, because a pilot who drove two
//      laps before pulling off finished ahead of one who quit on the grid.
//
// The frozen grid slot breaks every remaining tie, so the order is total and
// deterministic with no rng and no map-iteration dependence.

export interface RallyStandingEntry {
  pid: number;
  /** Yards down the circuit, monotonic across laps: the live ranking key. */
  travelled: number;
  /** Tick this racer crossed the finish line, or null. */
  finishedTick: number | null;
  /**
   * Where inside the crossing tick's segment the line was cut, 0 to 1. Only
   * read against another racer finishing on the SAME tick, which at 20 Hz and
   * 58 yd/s is the difference between a photo finish and a coin flip.
   */
  finishFraction: number;
  /** Tick this racer quit (forfeit or disconnect), or null. */
  retiredTick: number | null;
  /** Frozen grid slot, the stable final tie-break. */
  slot: number;
}

/** Which of the three bands an entry sits in. Lower is better. */
function band(entry: RallyStandingEntry): number {
  if (entry.finishedTick !== null) return 0;
  if (entry.retiredTick === null) return 1;
  return 2;
}

export function compareRallyStandings(a: RallyStandingEntry, b: RallyStandingEntry): number {
  const bandDelta = band(a) - band(b);
  if (bandDelta !== 0) return bandDelta;
  if (a.finishedTick !== null && b.finishedTick !== null) {
    return (
      a.finishedTick - b.finishedTick || a.finishFraction - b.finishFraction || a.slot - b.slot
    );
  }
  if (a.retiredTick !== null && b.retiredTick !== null) {
    return b.retiredTick - a.retiredTick || a.slot - b.slot;
  }
  return b.travelled - a.travelled || a.slot - b.slot;
}

/** The classification of a race, first to last. Returns a sorted COPY: the
 *  caller's grid order is frozen identity and is never re-ordered in place. */
export function rallyClassification(entries: readonly RallyStandingEntry[]): RallyStandingEntry[] {
  return [...entries].sort(compareRallyStandings);
}

/**
 * Is the lead of an already-classified race a dead heat? Only the top TWO are
 * ever tested, and only while BOTH are still driving: a tie for third is a
 * placing, not a draw, and two machines that actually crossed the line are
 * split by the crossing fraction rather than declared equal.
 */
export function rallyLeadIsDeadHeat(
  ranked: readonly RallyStandingEntry[],
  deadHeatYards: number,
): boolean {
  const [first, second] = ranked;
  if (!first || !second) return false;
  if (band(first) !== 1 || band(second) !== 1) return false;
  return first.travelled - second.travelled < deadHeatYards;
}
