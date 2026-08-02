import { describe, expect, it } from 'vitest';
import {
  buildRealmRacersHudView,
  buildRealmRacersSetupView,
  buildRealmRacersWindowView,
  RALLY_CONTROL_ACTIONS,
  RALLY_PRACTICE_TIERS,
} from '../src/ui/realm_racers_view';
import type { RealmRacersInfo } from '../src/world_api';

function info(over: Partial<RealmRacersInfo> = {}): RealmRacersInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    ...over,
  };
}

type Match = NonNullable<RealmRacersInfo['match']>;
type Racer = Match['standings'][number];

function racer(over: Partial<Racer> = {}): Racer {
  return {
    pid: 1,
    name: 'Aster',
    cls: 'warrior',
    lap: 2,
    finished: false,
    botTier: null,
    position: 1,
    finishSeconds: null,
    retired: false,
    ...over,
  };
}

/** A four-pilot grid with the viewer leading it. */
function live(over: Partial<Match> = {}): Match {
  const me = racer();
  const field = [
    me,
    racer({ pid: 2, name: 'Briar', lap: 1, position: 2 }),
    racer({ pid: 3, name: 'Cass', lap: 1, position: 3 }),
    racer({ pid: 4, name: 'Dell', lap: 1, position: 4 }),
  ];
  return {
    id: 7,
    circuitId: 'evergarden_garden',
    participantIds: [1, 2, 3, 4],
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 61,
    chaseIn: 0,
    speed: 42,
    wrongWay: false,
    resetLocked: false,
    returnIn: 0,
    me,
    standings: field,
    gridSize: 4,
    decided: false,
    totalLaps: 3,
    practice: false,
    result: null,
    ...over,
  };
}

describe('Realm Racers pure views: the practice setup screen', () => {
  const noKeys = () => [];
  const keys = (action: string) =>
    ({ throttle: ['W'], brake: ['S'], steer: ['A', 'D'], handbrake: ['Space'] })[action] ?? [];

  it('offers every tier, with exactly one selected', () => {
    const view = buildRealmRacersSetupView(info(), 'ace', noKeys, false);
    expect(view.tiers.map((option) => option.tier)).toEqual(RALLY_PRACTICE_TIERS);
    expect(view.tiers.filter((option) => option.selected).map((option) => option.tier)).toEqual([
      'ace',
    ]);
    expect(view.available).toBe(true);
  });

  it('teaches the keys the player actually has, and moves its signature when they change', () => {
    const bound = buildRealmRacersSetupView(info(), 'driver', keys, false);
    expect(bound.controls.map((row) => row.action)).toEqual(RALLY_CONTROL_ACTIONS);
    expect(bound.controls.find((row) => row.action === 'steer')?.keys).toEqual(['A', 'D']);
    // A rebind is the one input to this screen no world state would carry, so
    // the signature has to move on it or the screen would teach a stale key.
    const rebound = buildRealmRacersSetupView(
      info(),
      'driver',
      (action) => (action === 'steer' ? ['Left', 'Right'] : keys(action)),
      false,
    );
    expect(rebound.sig).not.toBe(bound.sig);
  });

  it('drops the key column entirely on a touch HUD', () => {
    const view = buildRealmRacersSetupView(info(), 'driver', keys, true);
    expect(view.touch).toBe(true);
    expect(view.controls.every((row) => row.keys.length === 0)).toBe(true);
    // Still every control, so the tutorial teaches the same five things.
    expect(view.controls).toHaveLength(RALLY_CONTROL_ACTIONS.length);
  });

  it('reports the screen unavailable when the realm has no copy left', () => {
    const full = buildRealmRacersSetupView(info({ practiceAvailable: false }), 'ace', keys, false);
    expect(full.available).toBe(false);
    expect(full.sig).not.toBe(buildRealmRacersSetupView(info(), 'ace', keys, false).sig);
  });

  it('moves its signature when the picked tier changes', () => {
    const a = buildRealmRacersSetupView(info(), 'rookie', keys, false);
    const b = buildRealmRacersSetupView(info(), 'ace', keys, false);
    expect(a.sig).not.toBe(b.sig);
  });

  it('distinguishes a practice field from a queued one, in the window signature', () => {
    const practice = live({ practice: true });
    const queued = live();
    const practiceWindow = buildRealmRacersWindowView(info({ match: practice }));
    const queuedWindow = buildRealmRacersWindowView(info({ match: queued }));
    if (practiceWindow.kind !== 'match' || queuedWindow.kind !== 'match') {
      throw new Error('expected match views');
    }
    expect(practiceWindow.practice).toBe(true);
    expect(queuedWindow.practice).toBe(false);
    expect(practiceWindow.sig).not.toBe(queuedWindow.sig);
  });
});

describe('Realm Racers pure views', () => {
  it('distinguishes idle and FIFO queue state', () => {
    expect(buildRealmRacersWindowView(info())).toEqual({
      kind: 'idle',
      queueSize: 0,
      practiceAvailable: true,
      sig: 'idle|0|open',
    });
    expect(
      buildRealmRacersWindowView(info({ queued: true, queuePosition: 2, queueSize: 3 })),
    ).toMatchObject({ kind: 'queued', position: 2, queueSize: 3 });
  });

  it('derives the HUD lap total from the shared snapshot, not a hard-coded race length', () => {
    const view = buildRealmRacersHudView(info({ match: live() }));
    expect(view).toMatchObject({
      active: true,
      phase: 'racing',
      lap: 2,
      totalLaps: 3,
      position: 1,
      gridSize: 4,
      elapsed: 61,
    });
    expect(
      buildRealmRacersHudView(info({ match: live({ totalLaps: 4, practice: true }) })),
    ).toMatchObject({ totalLaps: 4 });
  });

  it('keeps the structural HUD signature stable while race values tick', () => {
    const first = buildRealmRacersHudView(info({ match: live() }));
    const next = buildRealmRacersHudView(
      info({
        match: live({
          elapsed: 62,
          me: racer({ lap: 3, position: 2 }),
        }),
      }),
    );
    expect(next.sig).toBe(first.sig);
    expect(next).toMatchObject({ elapsed: 62, position: 2, lap: 3 });
  });

  it('keeps a finished result visible through the return countdown', () => {
    const finished = live({
      phase: 'finished',
      returnIn: 6,
      result: 'won',
      me: racer({ lap: 3, finished: true }),
    });
    expect(buildRealmRacersWindowView(info({ match: finished }))).toMatchObject({
      kind: 'match',
      phase: 'finished',
      result: 'won',
    });
    expect(buildRealmRacersHudView(info({ match: finished }))).toMatchObject({
      active: true,
      result: 'won',
      returnIn: 6,
    });
  });

  it('offers the strip forfeit control while the race is undecided', () => {
    expect(buildRealmRacersHudView(info({ match: live({ phase: 'countdown' }) })).canForfeit).toBe(
      true,
    );
    expect(buildRealmRacersHudView(info({ match: live({ phase: 'racing' }) })).canForfeit).toBe(
      true,
    );
    expect(buildRealmRacersHudView(info()).canForfeit).toBe(false);
  });

  it('exposes racing speed, wrong-way, and reset availability', () => {
    const view = buildRealmRacersHudView(
      info({ match: live({ speed: 53, wrongWay: true, resetLocked: true }) }),
    );
    expect(view).toMatchObject({
      speed: 53,
      wrongWay: true,
      canReset: true,
      resetLocked: true,
    });
    expect(buildRealmRacersHudView(info({ match: live({ phase: 'countdown' }) })).canReset).toBe(
      false,
    );
    const unlocked = buildRealmRacersHudView(info({ match: live({ resetLocked: false }) }));
    const locked = buildRealmRacersHudView(info({ match: live({ resetLocked: true }) }));
    expect(locked.sig).toBe(unlocked.sig);
  });

  it('withdraws the forfeit control once the race is decided, and moves the signature', () => {
    const racing = buildRealmRacersHudView(info({ match: live({ phase: 'racing' }) }));
    const finished = buildRealmRacersHudView(
      info({
        match: live({
          phase: 'finished',
          result: 'lost',
          returnIn: 6,
          me: racer({ lap: 3, finished: true }),
        }),
      }),
    );
    expect(racing.canForfeit).toBe(true);
    expect(finished.canForfeit).toBe(false);
    // The control lives in the strip's rebuilt markup, so the flip has to move
    // the structural signature or the painter never rebuilds it away.
    expect(finished.sig).not.toBe(racing.sig);
  });

  it('keeps a dead heat distinct from a loss', () => {
    const finished = live({
      phase: 'finished',
      returnIn: 6,
      result: 'draw',
      me: racer({ lap: 3, finished: true }),
    });
    expect(buildRealmRacersWindowView(info({ match: finished }))).toMatchObject({
      kind: 'match',
      phase: 'finished',
      result: 'draw',
    });
    expect(buildRealmRacersHudView(info({ match: finished }))).toMatchObject({
      active: true,
      result: 'draw',
      returnIn: 6,
    });
  });
});
