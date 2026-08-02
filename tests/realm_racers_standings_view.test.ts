// The pure core behind the race's live leaderboard panel.

import { describe, expect, it } from 'vitest';
import { buildRealmRacersStandingsView } from '../src/ui/realm_racers_standings_view';
import type { RealmRacersInfo } from '../src/world_api';

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
    circuitId: 'evergarden_garden',
    participantIds: standings.map((row) => row.pid),
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 0,
    chaseIn: 0,
    returnIn: 0,
    me,
    standings,
    gridSize: 4,
    decided: false,
    speed: 0,
    wrongWay: false,
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

  it('moves its signature on everything it draws, and on nothing else', () => {
    const base = buildRealmRacersStandingsView(match(field()));
    expect(buildRealmRacersStandingsView(match(field())).sig).toBe(base.sig);
    // Speed and the elapsed clock move every frame and are not on this panel,
    // so they may never rebuild it.
    expect(buildRealmRacersStandingsView({ ...match(field()), speed: 51, elapsed: 62 }).sig).toBe(
      base.sig,
    );

    // A pass IS structure: the rows really do swap.
    const swapped = [
      { ...field()[1], position: 1 },
      { ...field()[0], position: 2 },
      field()[2],
      field()[3],
    ];
    expect(buildRealmRacersStandingsView(match(swapped)).sig).not.toBe(base.sig);
    // So is a lap ticking over, a pilot pulling off, and a pilot crossing.
    const lapped = field().map((row) => (row.pid === 4 ? { ...row, lap: 2 } : row));
    expect(buildRealmRacersStandingsView(match(lapped)).sig).not.toBe(base.sig);
    const retired = field().map((row) => (row.pid === 4 ? { ...row, retired: true } : row));
    expect(buildRealmRacersStandingsView(match(retired)).sig).not.toBe(base.sig);
    const finished = field().map((row) => (row.pid === 2 ? { ...row, finished: true } : row));
    expect(buildRealmRacersStandingsView(match(finished)).sig).not.toBe(base.sig);
    // And a different race is a different panel outright.
    expect(buildRealmRacersStandingsView({ ...match(field()), id: 8 }).sig).not.toBe(base.sig);
  });
});
