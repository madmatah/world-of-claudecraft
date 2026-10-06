import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT_ID,
  mortarOverdriveCompetitionCircuits,
} from '../src/sim/content/mortar_overdrive/circuits';
import {
  buildMortarOverdriveHudView,
  buildMortarOverdriveSetupView,
  buildMortarOverdriveWindowView,
  MORTAR_OVERDRIVE_CONTROL_ACTIONS,
  MORTAR_OVERDRIVE_PRACTICE_TIERS,
  mortarOverdriveControlKeys,
} from '../src/ui/hud/mortar_overdrive/race_view';
import type { MortarOverdriveInfo } from '../src/world_api';
import { assertAllocationStable } from './util/alloc_probe';

// NOTE on the HUD-view tests below: buildMortarOverdriveHudView returns ONE reused
// live container mutated in place per call (the allocation-light per-frame
// contract), so a test that compares two frames captures the PRIMITIVES it
// needs (a sig string, a flag) before building the next frame, never two
// object handles.

function info(over: Partial<MortarOverdriveInfo> = {}): MortarOverdriveInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    ...over,
  };
}

type Match = NonNullable<MortarOverdriveInfo['match']>;
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
    circuitId: 'evergarden_practice',
    participantIds: [1, 2, 3, 4],
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 61,
    elapsedTicks: 0,
    chaseIn: 0,
    speed: 42,
    wrongWay: false,
    offTrackIn: 0,
    cutReturned: false,
    pickupsTaken: [],
    slicks: [],
    warded: false,
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

describe('Mortar Overdrive pure views: the practice setup screen', () => {
  const noKeys = () => [];
  const keys = (action: string) =>
    ({ throttle: ['W'], brake: ['S'], steer: ['A', 'D'], handbrake: ['Space'] })[action] ?? [];

  it('offers every tier, with exactly one selected', () => {
    const view = buildMortarOverdriveSetupView(info(), 'ace', noKeys, false);
    expect(view.tiers.map((option) => option.tier)).toEqual(MORTAR_OVERDRIVE_PRACTICE_TIERS);
    expect(view.tiers.filter((option) => option.selected).map((option) => option.tier)).toEqual([
      'ace',
    ]);
    expect(view.available).toBe(true);
  });

  it('teaches the keys the player actually has, and moves its signature when they change', () => {
    const bound = buildMortarOverdriveSetupView(info(), 'driver', keys, false);
    expect(bound.controls.map((row) => row.action)).toEqual(MORTAR_OVERDRIVE_CONTROL_ACTIONS);
    expect(bound.controls.find((row) => row.action === 'steer')?.keys).toEqual(['A', 'D']);
    // A rebind is the one input to this screen no world state would carry, so
    // the signature has to move on it or the screen would teach a stale key.
    const rebound = buildMortarOverdriveSetupView(
      info(),
      'driver',
      (action) => (action === 'steer' ? ['Left', 'Right'] : keys(action)),
      false,
    );
    expect(rebound.sig).not.toBe(bound.sig);
  });

  it('resolves each taught control through the binds the player actually has', () => {
    // Extracted from Hud (which passes Keybinds.primaryLabel): steering is two
    // bindings by nature, the rest one, and an unbound control contributes no
    // label rather than an empty keycap.
    const bound: Record<string, string> = {
      forward: 'W',
      back: 'S',
      turnLeft: 'A',
      turnRight: 'D',
      jump: 'Space',
    };
    const primary = (bind: string): string => bound[bind] ?? '';
    expect(mortarOverdriveControlKeys('throttle', primary)).toEqual(['W']);
    expect(mortarOverdriveControlKeys('brake', primary)).toEqual(['S']);
    expect(mortarOverdriveControlKeys('steer', primary)).toEqual(['A', 'D']);
    expect(mortarOverdriveControlKeys('handbrake', primary)).toEqual(['Space']);
    expect(mortarOverdriveControlKeys('handbrake', () => '')).toEqual([]);
  });

  it('drops the key column entirely on a touch HUD', () => {
    const view = buildMortarOverdriveSetupView(info(), 'driver', keys, true);
    expect(view.touch).toBe(true);
    expect(view.controls.every((row) => row.keys.length === 0)).toBe(true);
    // Still every control, so the tutorial teaches the same five things.
    expect(view.controls).toHaveLength(MORTAR_OVERDRIVE_CONTROL_ACTIONS.length);
  });

  it('reports the screen unavailable when the realm has no copy left', () => {
    const full = buildMortarOverdriveSetupView(
      info({ practiceAvailable: false }),
      'ace',
      keys,
      false,
    );
    expect(full.available).toBe(false);
    expect(full.sig).not.toBe(buildMortarOverdriveSetupView(info(), 'ace', keys, false).sig);
  });

  it('moves its signature when the picked tier changes', () => {
    const a = buildMortarOverdriveSetupView(info(), 'rookie', keys, false);
    const b = buildMortarOverdriveSetupView(info(), 'ace', keys, false);
    expect(a.sig).not.toBe(b.sig);
  });

  it('names the circuit practice runs, which is always the practice circuit', () => {
    // Practice never draws, so this is a build-time constant rather than a live
    // value; carrying it here is what lets the screen be honest that the
    // circuit a player learns on is not one competition will ever give them.
    const view = buildMortarOverdriveSetupView(info(), 'driver', keys, false);
    expect(view.circuitId).toBe(MORTAR_OVERDRIVE_PRACTICE_CIRCUIT_ID);
    expect(mortarOverdriveCompetitionCircuits().map((c) => c.id)).not.toContain(view.circuitId);
  });

  it('distinguishes a practice field from a queued one, in the window signature', () => {
    const practice = live({ practice: true });
    const queued = live();
    const practiceWindow = buildMortarOverdriveWindowView(info({ match: practice }));
    const queuedWindow = buildMortarOverdriveWindowView(info({ match: queued }));
    if (practiceWindow.kind !== 'match' || queuedWindow.kind !== 'match') {
      throw new Error('expected match views');
    }
    expect(practiceWindow.practice).toBe(true);
    expect(queuedWindow.practice).toBe(false);
    expect(practiceWindow.sig).not.toBe(queuedWindow.sig);
  });
});

describe('Mortar Overdrive pure views', () => {
  it('distinguishes idle and FIFO queue state', () => {
    expect(buildMortarOverdriveWindowView(info())).toEqual({
      kind: 'idle',
      queueSize: 0,
      practiceAvailable: true,
      sig: 'idle|0|open',
    });
    const queued = buildMortarOverdriveWindowView(
      info({
        queued: true,
        queuePosition: 2,
        queueSize: 2,
        start: {
          seats: [
            { name: 'Briar', you: false },
            { name: 'Aster', you: true },
          ],
          startsInTicks: 100,
          laneBusy: false,
          backfill: true,
        },
      }),
    );
    expect(queued.kind).toBe('queued');
    if (queued.kind === 'queued') {
      expect(queued.card.seats.map((seat) => seat.name)).toEqual(['Briar', 'Aster', null, null]);
      expect(queued.card.solo).toBe(false);
    }
  });

  it('derives the HUD lap total from the shared snapshot, not a hard-coded race length', () => {
    const view = buildMortarOverdriveHudView(info({ match: live() }));
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
      buildMortarOverdriveHudView(info({ match: live({ totalLaps: 4, practice: true }) })),
    ).toMatchObject({ totalLaps: 4 });
  });

  it('carries the drawn circuit to the strip, as an id rather than a name', () => {
    // The view is i18n-free, so it hands the painter the record id and the
    // painter resolves the copy. Nobody CHOSE this circuit, so the strip has to
    // be able to say which one the draw gave the grid.
    const view = buildMortarOverdriveHudView(
      info({ match: live({ circuitId: 'evergarden_express_tour' }) }),
    );
    expect(view.circuitId).toBe('evergarden_express_tour');
    // And nothing to name when there is no race at all.
    expect(buildMortarOverdriveHudView(info()).circuitId).toBe('');
  });

  it('keeps the structural HUD signature stable while race values tick', () => {
    const firstSig = buildMortarOverdriveHudView(info({ match: live() })).sig;
    const next = buildMortarOverdriveHudView(
      info({
        match: live({
          elapsed: 62,
          me: racer({ lap: 3, position: 2 }),
        }),
      }),
    );
    expect(next.sig).toBe(firstSig);
    expect(next).toMatchObject({ elapsed: 62, position: 2, lap: 3 });
  });

  it('reuses one live strip container every frame (no per-frame garbage)', () => {
    // The strip view is rebuilt from update() every frame of a race, so the
    // core returns a module-level reused container and mutates primitives in
    // place (tests/util/alloc_probe.ts is the canonical proxy for that).
    const racing = info({ match: live() });
    expect(() =>
      assertAllocationStable(
        () => buildMortarOverdriveHudView(racing),
        64,
        'mortar overdrive hud view container',
      ),
    ).not.toThrow();
  });

  it('keeps the match window signature still while only the lap advances', () => {
    // The queue window never displays the lap (the strip does), so a lap tick
    // must not rebuild it: the lap is out of the view AND out of the signature.
    const firstView = buildMortarOverdriveWindowView(
      info({ match: live({ me: racer({ lap: 1 }) }) }),
    );
    if (firstView.kind !== 'match') throw new Error('expected a match view');
    const firstSig = firstView.sig;
    expect('lap' in firstView).toBe(false);
    const next = buildMortarOverdriveWindowView(info({ match: live({ me: racer({ lap: 3 }) }) }));
    if (next.kind !== 'match') throw new Error('expected a match view');
    expect(next.sig).toBe(firstSig);
    // The placing IS displayed ("3 of 4"), so it still moves the signature.
    const placed = buildMortarOverdriveWindowView(
      info({ match: live({ me: racer({ lap: 1, position: 2 }) }) }),
    );
    expect(placed.sig).not.toBe(firstSig);
  });

  it('moves the idle and queued signatures when practice availability flips', () => {
    // Availability is what the front screen's practice button paints as its
    // disabled state, so the flip has to repaint the window on its own.
    expect(buildMortarOverdriveWindowView(info({ practiceAvailable: false })).sig).not.toBe(
      buildMortarOverdriveWindowView(info()).sig,
    );
    const queued = { queued: true, queuePosition: 2, queueSize: 3 } as const;
    expect(
      buildMortarOverdriveWindowView(info({ ...queued, practiceAvailable: false })).sig,
    ).not.toBe(buildMortarOverdriveWindowView(info({ ...queued })).sig);
  });

  it('keeps a finished result visible through the return countdown', () => {
    const finished = live({
      phase: 'finished',
      returnIn: 6,
      result: 'won',
      me: racer({ lap: 3, finished: true }),
    });
    expect(buildMortarOverdriveWindowView(info({ match: finished }))).toMatchObject({
      kind: 'match',
      phase: 'finished',
      result: 'won',
    });
    expect(buildMortarOverdriveHudView(info({ match: finished }))).toMatchObject({
      active: true,
      result: 'won',
      returnIn: 6,
    });
  });

  it('offers the strip forfeit control while the race is undecided', () => {
    expect(
      buildMortarOverdriveHudView(info({ match: live({ phase: 'countdown' }) })).canForfeit,
    ).toBe(true);
    expect(buildMortarOverdriveHudView(info({ match: live({ phase: 'racing' }) })).canForfeit).toBe(
      true,
    );
    expect(buildMortarOverdriveHudView(info()).canForfeit).toBe(false);
  });

  it('exposes racing speed, wrong-way, and reset availability', () => {
    const view = buildMortarOverdriveHudView(
      info({ match: live({ speed: 53, wrongWay: true, resetLocked: true }) }),
    );
    expect(view).toMatchObject({
      speed: 53,
      wrongWay: true,
      trackLimit: 'none',
      canReset: true,
      resetLocked: true,
    });
    expect(
      buildMortarOverdriveHudView(info({ match: live({ phase: 'countdown' }) })).canReset,
    ).toBe(false);
    const unlockedSig = buildMortarOverdriveHudView(
      info({ match: live({ resetLocked: false }) }),
    ).sig;
    const lockedSig = buildMortarOverdriveHudView(info({ match: live({ resetLocked: true }) })).sig;
    expect(lockedSig).toBe(unlockedSig);
  });

  it('carries the ward as a live pip, out of the signature', () => {
    // The ward is a one-shot shield a pickup granted, and the FCT that announced
    // it is long gone by the time it matters: the strip carries a standing pip
    // so a pilot can plan around it.
    expect(buildMortarOverdriveHudView(info({ match: live({ warded: true }) })).warded).toBe(true);
    expect(buildMortarOverdriveHudView(info({ match: live({}) })).warded).toBe(false);
    // Out of the signature, like `resetLocked`: it flips mid-race and must not
    // rebuild the strip (which would drop the forfeit control's armed state and
    // any focus inside it).
    const wardedSig = buildMortarOverdriveHudView(info({ match: live({ warded: true }) })).sig;
    const bareSig = buildMortarOverdriveHudView(info({ match: live({ warded: false }) })).sig;
    expect(wardedSig).toBe(bareSig);
  });

  it('carries the seconds the ward has left, out of the signature, and 0 without one', () => {
    expect(
      buildMortarOverdriveHudView(info({ match: live({ warded: true, wardIn: 8 }) })).wardIn,
    ).toBe(8);
    // A count with no ward behind it is never shown.
    expect(
      buildMortarOverdriveHudView(info({ match: live({ warded: false, wardIn: 8 }) })).wardIn,
    ).toBe(0);
    expect(buildMortarOverdriveHudView(info({ match: live({ warded: true }) })).wardIn).toBe(0);
    expect(buildMortarOverdriveHudView(info({ match: live({}) })).wardIn).toBe(0);
    const ticking = buildMortarOverdriveHudView(
      info({ match: live({ warded: true, wardIn: 3 }) }),
    ).sig;
    const later = buildMortarOverdriveHudView(
      info({ match: live({ warded: true, wardIn: 2 }) }),
    ).sig;
    expect(later).toBe(ticking);
  });

  it('resolves the track-limits banner to ONE line, countdown before notice', () => {
    // Two alarms cannot both be the loudest thing on the strip, and the two
    // states cannot legitimately co-occur anyway: a pilot the referee has just
    // returned for cutting is back ON the road, so their loiter clock is not
    // running. The precedence is written down here rather than left to whichever
    // branch the painter happens to test first.
    const off = buildMortarOverdriveHudView(info({ match: live({ offTrackIn: 3 }) }));
    expect(off).toMatchObject({ trackLimit: 'offTrack', offTrackIn: 3 });
    const offSig = off.sig;

    const cut = buildMortarOverdriveHudView(info({ match: live({ cutReturned: true }) }));
    expect(cut.trackLimit).toBe('cutReturned');
    const cutSig = cut.sig;

    const both = buildMortarOverdriveHudView(
      info({ match: live({ offTrackIn: 2, cutReturned: true }) }),
    );
    expect(both.trackLimit).toBe('offTrack');

    expect(buildMortarOverdriveHudView(info({ match: live({}) })).trackLimit).toBe('none');
    // Neither state is structural: the banner is one element the painter writes
    // through, so a pilot running wide must not rebuild the strip under them.
    expect(offSig).toBe(cutSig);
  });

  it('withdraws the forfeit control once the race is decided, and moves the signature', () => {
    const racing = buildMortarOverdriveHudView(info({ match: live({ phase: 'racing' }) }));
    expect(racing.canForfeit).toBe(true);
    const racingSig = racing.sig;
    const finished = buildMortarOverdriveHudView(
      info({
        match: live({
          phase: 'finished',
          result: 'lost',
          returnIn: 6,
          me: racer({ lap: 3, finished: true }),
        }),
      }),
    );
    expect(finished.canForfeit).toBe(false);
    // The control lives in the strip's rebuilt markup, so the flip has to move
    // the structural signature or the painter never rebuilds it away.
    expect(finished.sig).not.toBe(racingSig);
  });

  it('keeps a dead heat distinct from a loss', () => {
    const finished = live({
      phase: 'finished',
      returnIn: 6,
      result: 'draw',
      me: racer({ lap: 3, finished: true }),
    });
    expect(buildMortarOverdriveWindowView(info({ match: finished }))).toMatchObject({
      kind: 'match',
      phase: 'finished',
      result: 'draw',
    });
    expect(buildMortarOverdriveHudView(info({ match: finished }))).toMatchObject({
      active: true,
      result: 'draw',
      returnIn: 6,
    });
  });
});
