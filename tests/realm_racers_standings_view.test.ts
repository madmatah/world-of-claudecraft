// The pure core behind the race's live leaderboard panel.
//
// The core returns ONE reused container + row slots mutated in place per call
// (the allocation-light per-frame contract), so the signature tests below
// capture the sig STRING per build rather than holding two object handles.

import { describe, expect, it } from 'vitest';
import { buildRealmRacersStandingsView } from '../src/ui/realm_racers_standings_view';
import type { RealmRacersInfo } from '../src/world_api';
import { assertAllocationStable } from './util/alloc_probe';

type Match = NonNullable<RealmRacersInfo['match']>;
type Racer = Match['standings'][number];

function racer(over: Partial<Racer> & { pid: number }): Racer {
  return {
    name: `Racer${over.pid}`,
    cls: 'warrior',
    lap: 1,
    finished: false,
    botTier: null,
    position: 1,
    finishSeconds: null,
    retired: false,
    ...over,
  };
}

function match(standings: Racer[], mePid = 1): Match {
  const me = standings.find((row) => row.pid === mePid) as Racer;
  return {
    id: 7,
    circuitId: 'evergarden_practice',
    participantIds: standings.map((row) => row.pid),
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 0,
    elapsedTicks: 0,
    chaseIn: 0,
    returnIn: 0,
    me,
    standings,
    gridSize: 4,
    decided: false,
    speed: 0,
    wrongWay: false,
    offTrackIn: 0,
    cutReturned: false,
    pickupsTaken: [],
    slicks: [],
    warded: false,
    resetLocked: false,
    totalLaps: 3,
    practice: false,
    result: null,
  };
}

const field = (): Racer[] => [
  racer({ pid: 2, name: 'Briar', cls: 'mage', position: 1, lap: 3 }),
  racer({ pid: 1, name: 'Aster', position: 2, lap: 2 }),
  racer({ pid: 3, name: 'Cass', cls: 'rogue', position: 3, lap: 2 }),
  racer({ pid: 4, name: 'Dell', cls: 'priest', position: 4, lap: 1 }),
];

describe('Realm Racers standings core', () => {
  it('is inert with no race on', () => {
    const view = buildRealmRacersStandingsView(null);
    expect(view.active).toBe(false);
    expect(view.rows).toEqual([]);
  });

  it('keeps the live order it is given, and marks the viewer', () => {
    const view = buildRealmRacersStandingsView(match(field()));
    expect(view.rows.map((row) => row.pid)).toEqual([2, 1, 3, 4]);
    expect(view.rows.map((row) => row.placing)).toEqual([1, 2, 3, 4]);
    expect(view.rows.map((row) => row.isMe)).toEqual([false, true, false, false]);
    // The viewer's own row keeps their NAME: the marker is a flag the painter
    // decorates it with, not a replacement for it.
    expect(view.rows[1].name).toBe('Aster');
  });

  it('carries each pilot their own class and lap, which is what the row draws', () => {
    const view = buildRealmRacersStandingsView(match(field()));
    expect(view.rows.map((row) => row.cls)).toEqual(['mage', 'warrior', 'rogue', 'priest']);
    // The lap is the readable answer to "am I a lap down": the leader is on 3,
    // the tail is still on 1.
    expect(view.rows.map((row) => row.lap)).toEqual([3, 2, 2, 1]);
    expect(view.totalLaps).toBe(3);
  });

  it('carries the finished and retired flags through', () => {
    const view = buildRealmRacersStandingsView(
      match([
        racer({ pid: 1, position: 1, finished: true }),
        racer({ pid: 2, position: 2, retired: true }),
      ]),
    );
    expect(view.rows.map((row) => row.finished)).toEqual([true, false]);
    expect(view.rows.map((row) => row.retired)).toEqual([false, true]);
  });

  it('flags each house pilot and no human, which is what draws the Bot tag', () => {
    // The flag is WHO IS NOT HUMAN, nothing more: the tier stays off the panel
    // (the noise the removed tier badge was), so the row carries a boolean, not
    // the tier string.
    const view = buildRealmRacersStandingsView(
      match([
        racer({ pid: 1, position: 1 }),
        racer({ pid: 2, position: 2, botTier: 'rookie' }),
        racer({ pid: 3, position: 3, botTier: 'ace' }),
      ]),
    );
    expect(view.rows.map((row) => row.bot)).toEqual([false, true, true]);
  });

  it('moves its signature on everything it draws, and on nothing else', () => {
    const baseSig = buildRealmRacersStandingsView(match(field())).sig;
    expect(buildRealmRacersStandingsView(match(field())).sig).toBe(baseSig);
    // Speed and the elapsed clock move every frame and are not on this panel,
    // so they may never rebuild it.
    expect(buildRealmRacersStandingsView({ ...match(field()), speed: 51, elapsed: 62 }).sig).toBe(
      baseSig,
    );

    // A pass IS structure: the rows really do swap.
    const swapped = [
      { ...field()[1], position: 1 },
      { ...field()[0], position: 2 },
      field()[2],
      field()[3],
    ];
    expect(buildRealmRacersStandingsView(match(swapped)).sig).not.toBe(baseSig);
    // So is a lap ticking over, a pilot pulling off, and a pilot crossing.
    const lapped = field().map((row) => (row.pid === 4 ? { ...row, lap: 2 } : row));
    expect(buildRealmRacersStandingsView(match(lapped)).sig).not.toBe(baseSig);
    const retired = field().map((row) => (row.pid === 4 ? { ...row, retired: true } : row));
    expect(buildRealmRacersStandingsView(match(retired)).sig).not.toBe(baseSig);
    const finished = field().map((row) => (row.pid === 2 ? { ...row, finished: true } : row));
    expect(buildRealmRacersStandingsView(match(finished)).sig).not.toBe(baseSig);
    // So is who is driving: a seat handed to a house pilot must repaint the row
    // so the Bot tag appears, and a human taking it back must clear it.
    const backfilled = field().map((row) =>
      row.pid === 4 ? { ...row, botTier: 'ace' as const } : row,
    );
    expect(buildRealmRacersStandingsView(match(backfilled)).sig).not.toBe(baseSig);
    // And a different race is a different panel outright.
    expect(buildRealmRacersStandingsView({ ...match(field()), id: 8 }).sig).not.toBe(baseSig);
  });

  it('reuses its container and every row slot each frame (no per-frame garbage)', () => {
    // Built once per frame for the whole race, so the container, the rows array
    // and each row object must keep their identity across builds
    // (tests/util/alloc_probe.ts is the canonical reused-reference proxy).
    const racing = match(field());
    expect(() => {
      assertAllocationStable(
        () => buildRealmRacersStandingsView(racing),
        64,
        'standings view container',
      );
      assertAllocationStable(
        () => buildRealmRacersStandingsView(racing).rows,
        64,
        'standings view rows',
      );
    }).not.toThrow();
  });

  it('shrinks and regrows its rows without minting new slots', () => {
    // A race ends (the container empties) and another starts: the pool keeps
    // the old slot objects and reuses them rather than allocating a new grid.
    const racing = match(field());
    const before = [...buildRealmRacersStandingsView(racing).rows];
    expect(buildRealmRacersStandingsView(null).rows).toHaveLength(0);
    const after = buildRealmRacersStandingsView(racing).rows;
    expect(after).toHaveLength(before.length);
    for (const [i, row] of before.entries()) expect(after[i]).toBe(row);
  });
});
