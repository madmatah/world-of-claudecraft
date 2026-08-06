// The classification comparator behind both readings of a Realm Racers grid:
// the live standings strip and the final result. One order, sampled twice.

import { describe, expect, it } from 'vitest';
import {
  compareRallyStandings,
  type RallyStandingEntry,
  rallyClassification,
  rallyLeadIsDeadHeat,
} from '../src/sim/realm_racers_standings';

function entry(over: Partial<RallyStandingEntry> & { pid: number }): RallyStandingEntry {
  return {
    travelled: 0,
    finishedTick: null,
    finishFraction: 1,
    retiredTick: null,
    slot: 0,
    ...over,
  };
}

const order = (entries: RallyStandingEntry[]): number[] =>
  rallyClassification(entries).map((e) => e.pid);

describe('Realm Racers classification', () => {
  it('puts finishers first, then drivers by distance, then quitters', () => {
    expect(
      order([
        entry({ pid: 1, travelled: 900, slot: 0 }),
        entry({ pid: 2, retiredTick: 40, slot: 1 }),
        entry({ pid: 3, finishedTick: 500, slot: 2 }),
        entry({ pid: 4, travelled: 1200, slot: 3 }),
      ]),
    ).toEqual([3, 4, 1, 2]);
  });

  it('splits two finishers on the same tick by where each cut the line', () => {
    // At 58 yd/s a tick is nearly three yards, so the sub-tick fraction is the
    // difference between a photo finish and a coin flip.
    expect(
      order([
        entry({ pid: 1, finishedTick: 500, finishFraction: 0.8, slot: 0 }),
        entry({ pid: 2, finishedTick: 500, finishFraction: 0.2, slot: 1 }),
      ]),
    ).toEqual([2, 1]);
    // An earlier tick beats any fraction on a later one.
    expect(
      order([
        entry({ pid: 1, finishedTick: 501, finishFraction: 0.01, slot: 0 }),
        entry({ pid: 2, finishedTick: 500, finishFraction: 0.99, slot: 1 }),
      ]),
    ).toEqual([2, 1]);
  });

  it('ranks the LAST pilot to quit ahead of the first', () => {
    // A pilot who drove two laps before pulling off finished ahead of one who
    // quit on the grid, even though neither was classified.
    expect(
      order([
        entry({ pid: 1, retiredTick: 10, slot: 0 }),
        entry({ pid: 2, retiredTick: 900, slot: 1 }),
        entry({ pid: 3, retiredTick: 400, slot: 2 }),
      ]),
    ).toEqual([2, 3, 1]);
  });

  it('breaks every remaining tie on the frozen grid slot, so the order is total', () => {
    const tied = [
      entry({ pid: 7, travelled: 100, slot: 3 }),
      entry({ pid: 8, travelled: 100, slot: 1 }),
      entry({ pid: 9, travelled: 100, slot: 2 }),
    ];
    expect(order(tied)).toEqual([8, 9, 7]);
    // And it is a real comparator: symmetric, and zero only for the same row.
    expect(compareRallyStandings(tied[0], tied[1])).toBeGreaterThan(0);
    expect(compareRallyStandings(tied[1], tied[0])).toBeLessThan(0);
    expect(compareRallyStandings(tied[0], { ...tied[0] })).toBe(0);
  });

  it('returns a sorted COPY, leaving the caller’s frozen grid order alone', () => {
    const grid = [
      entry({ pid: 1, travelled: 0, slot: 0 }),
      entry({ pid: 2, travelled: 50, slot: 1 }),
    ];
    const ranked = rallyClassification(grid);
    expect(ranked.map((e) => e.pid)).toEqual([2, 1]);
    expect(grid.map((e) => e.pid)).toEqual([1, 2]);
  });

  it('declares a dead heat only for the lead, and only between two drivers', () => {
    const close = [
      entry({ pid: 1, travelled: 500.2, slot: 0 }),
      entry({ pid: 2, travelled: 500.0, slot: 1 }),
      entry({ pid: 3, travelled: 120.1, slot: 2 }),
      entry({ pid: 4, travelled: 120.0, slot: 3 }),
    ];
    const ranked = rallyClassification(close);
    expect(rallyLeadIsDeadHeat(ranked, 0.5)).toBe(true);
    // The pair tied for third changes nothing: a tie back there is a placing.
    expect(rallyLeadIsDeadHeat(rallyClassification(close.slice(2)), 0.5)).toBe(true);
    // ...and that slice promoted the tail pair into a lead of their own, so on
    // its own it says nothing about SELECTION. A wide lead over a close third
    // and fourth is the case that does: an implementation reading any close
    // pair as a dead heat answers true here.
    expect(
      rallyLeadIsDeadHeat(
        rallyClassification([
          entry({ pid: 1, travelled: 510.0, slot: 0 }),
          entry({ pid: 2, travelled: 500.0, slot: 1 }),
          entry({ pid: 3, travelled: 120.1, slot: 2 }),
          entry({ pid: 4, travelled: 120.0, slot: 3 }),
        ]),
        0.5,
      ),
    ).toBe(false);
    expect(rallyLeadIsDeadHeat(ranked, 0.1)).toBe(false);
    // Two machines that actually crossed the line are split by the fraction, so
    // a finish is never a dead heat however close the distances read.
    const finished = rallyClassification([
      entry({ pid: 1, finishedTick: 500, finishFraction: 0.4, travelled: 900, slot: 0 }),
      entry({ pid: 2, finishedTick: 500, finishFraction: 0.5, travelled: 900, slot: 1 }),
    ]);
    expect(rallyLeadIsDeadHeat(finished, 0.5)).toBe(false);
    // And a lone survivor beside a quitter is not a draw either.
    expect(
      rallyLeadIsDeadHeat(
        rallyClassification([
          entry({ pid: 1, travelled: 10, slot: 0 }),
          entry({ pid: 2, retiredTick: 5, travelled: 10, slot: 1 }),
        ]),
        0.5,
      ),
    ).toBe(false);
    expect(rallyLeadIsDeadHeat([], 0.5)).toBe(false);
  });
});
