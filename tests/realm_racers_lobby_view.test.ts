// The Realm Racers loading lobby view core: who is on the grid and whether they
// are ready, this machine's preparation bar, and when the curtain exists at all.

import { describe, expect, it } from 'vitest';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersReady } from '../src/sim/social/realm_racers';
import {
  buildRealmRacersLobbyView,
  createRealmRacersLobbyFailsafe,
  REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS,
  type RealmRacersLobbyLive,
  realmRacersLobbyPercent,
  stepRealmRacersLobbyFailsafe,
} from '../src/ui/hud/realm_racers';
import type { RealmRacersMatchInfo, RealmRacersRacerInfo } from '../src/world_api';
import { addAt, makeWorld } from './realm_racers_util';
import { assertAllocationStable } from './util/alloc_probe';

const PREPARING = { done: 0, total: 1, settled: false };
const SETTLED = { done: 1, total: 1, settled: true };

function racer(pid: number, name: string, botTier: RealmRacersRacerInfo['botTier'] = null) {
  return { pid, name, botTier } as RealmRacersRacerInfo;
}

function lobby(over: Partial<RealmRacersMatchInfo> = {}): RealmRacersMatchInfo {
  return {
    id: 7,
    circuitId: 'evergarden_express_tour',
    phase: 'loading',
    participantIds: [1, 2, 3, 4],
    me: racer(1, 'Aster'),
    // Standings are in live order; the lobby lists the frozen grid order.
    standings: [
      racer(3, 'Cass'),
      racer(1, 'Aster'),
      racer(4, 'Rookie', 'rookie'),
      racer(2, 'Briar'),
    ],
    loading: { secondsLeft: 12, readyIds: [2] },
    ...over,
  } as RealmRacersMatchInfo;
}

function live(view: ReturnType<typeof buildRealmRacersLobbyView>): RealmRacersLobbyLive {
  if (!view.visible) throw new Error('lobby hidden');
  return view;
}

describe('buildRealmRacersLobbyView', () => {
  it('exists only while the viewer is in the loading lobby', () => {
    expect(buildRealmRacersLobbyView(null, SETTLED).visible).toBe(false);
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      expect(buildRealmRacersLobbyView(lobby({ phase }), SETTLED).visible, phase).toBe(false);
    }
    expect(buildRealmRacersLobbyView(lobby(), PREPARING).visible).toBe(true);
  });

  it('lists the grid in frozen order, named from the standings, with a house pilot ready', () => {
    const view = live(buildRealmRacersLobbyView(lobby(), PREPARING));
    expect(view.pilots).toEqual([
      { pid: 1, name: 'Aster', isMe: true, bot: false, status: 'waiting' },
      { pid: 2, name: 'Briar', isMe: false, bot: false, status: 'ready' },
      { pid: 3, name: 'Cass', isMe: false, bot: false, status: 'waiting' },
      { pid: 4, name: 'Rookie', isMe: false, bot: true, status: 'ready' },
    ]);
    expect(view.readyCount).toBe(2);
    expect(view.secondsLeft).toBe(12);
    expect(view.circuitId).toBe('evergarden_express_tour');
  });

  it('reads the ready set, not a guess: listed humans flip to ready', () => {
    const view = live(
      buildRealmRacersLobbyView(
        lobby({ loading: { secondsLeft: 3, readyIds: [1, 2, 4] } }),
        SETTLED,
      ),
    );
    expect(view.pilots.map((pilot) => pilot.status)).toEqual([
      'ready',
      'ready',
      'waiting',
      'ready',
    ]);
    expect(view.readyCount).toBe(3);
  });

  it('drops a pilot it cannot name and survives an empty or missing ready list', () => {
    const partial = live(
      buildRealmRacersLobbyView(
        lobby({ standings: [racer(1, 'Aster'), racer(2, 'Briar')], loading: undefined }),
        PREPARING,
      ),
    );
    expect(partial.pilots.map((pilot) => pilot.pid)).toEqual([1, 2]);
    expect(partial.pilots.every((pilot) => pilot.status === 'waiting')).toBe(true);
    expect(partial.secondsLeft).toBe(0);
    const empty = live(
      buildRealmRacersLobbyView(lobby({ participantIds: [], standings: [] }), PREPARING),
    );
    expect(empty.pilots).toEqual([]);
    expect(empty.readyCount).toBe(0);
  });

  it('keys the skeleton on the match and the grid shape, never on readiness or time', () => {
    const base = live(buildRealmRacersLobbyView(lobby(), PREPARING)).sig;
    const moved = lobby({ loading: { secondsLeft: 4, readyIds: [1, 2, 3] } });
    expect(live(buildRealmRacersLobbyView(moved, SETTLED)).sig).toBe(base);
    expect(live(buildRealmRacersLobbyView(lobby({ id: 8 }), PREPARING)).sig).not.toBe(base);
    expect(
      live(buildRealmRacersLobbyView(lobby({ circuitId: 'nightbloom_moonwell_run' }), PREPARING))
        .sig,
    ).not.toBe(base);
    expect(
      live(buildRealmRacersLobbyView(lobby({ participantIds: [1, 2, 3] }), PREPARING)).sig,
    ).not.toBe(base);
  });
});

describe('the lobby view per frame', () => {
  it('reuses its container and pilot slots across frames', () => {
    const match = lobby();
    assertAllocationStable(() => buildRealmRacersLobbyView(match, PREPARING), 64, 'lobby view');
    assertAllocationStable(
      () => live(buildRealmRacersLobbyView(match, PREPARING)).pilots,
      64,
      'lobby pilots',
    );
    assertAllocationStable(
      () => live(buildRealmRacersLobbyView(match, PREPARING)).pilots[0],
      64,
      'lobby pilot slot',
    );
  });
});

describe('realmRacersLobbyPercent', () => {
  it('clamps to the units and is full only once every producer has its verdict', () => {
    expect(realmRacersLobbyPercent({ done: 0, total: 0, settled: false })).toBe(0);
    expect(realmRacersLobbyPercent({ done: 0, total: 0, settled: true })).toBe(100);
    expect(realmRacersLobbyPercent({ done: 1, total: 4, settled: false })).toBe(25);
    expect(realmRacersLobbyPercent({ done: 4, total: 4, settled: false })).toBe(99);
    expect(realmRacersLobbyPercent({ done: 9, total: 4, settled: false })).toBe(99);
    expect(realmRacersLobbyPercent({ done: -3, total: 4, settled: false })).toBe(0);
    expect(realmRacersLobbyPercent({ done: Number.NaN, total: 4, settled: false })).toBe(0);
    expect(realmRacersLobbyPercent({ done: 1, total: Number.NaN, settled: false })).toBe(0);
    expect(realmRacersLobbyPercent({ done: 1, total: 3, settled: false })).toBe(33);
    expect(realmRacersLobbyPercent({ done: 2, total: 4, settled: true })).toBe(100);
  });
});

describe('the lobby view over both hosts', () => {
  it('builds the same view from the offline Sim readout and its wire-shaped mirror', () => {
    const sim = makeWorld();
    const pids = [
      addAt(sim, 'warrior', 'Aster', -5, -40),
      addAt(sim, 'mage', 'Briar', 7, -42),
      addAt(sim, 'rogue', 'Cass', -9, -38),
      addAt(sim, 'priest', 'Dell', 11, -44),
    ];
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    realmRacersReady(sim.ctx, pids[1] as number);
    sim.tick();
    const readout = sim.realmRacersInfoFor(pids[0] as number).match;
    expect(readout?.phase).toBe('loading');
    const mirrored = JSON.parse(JSON.stringify(readout)) as RealmRacersMatchInfo;
    // A copy: the core reuses its container, so comparing two live results
    // would compare the object with itself.
    const offline = structuredClone(live(buildRealmRacersLobbyView(readout, PREPARING)));
    expect(buildRealmRacersLobbyView(mirrored, PREPARING)).toEqual(offline);
    expect(offline.pilots.map((pilot) => [pilot.name, pilot.status])).toEqual([
      ['Aster', 'waiting'],
      ['Briar', 'ready'],
      ['Cass', 'waiting'],
      ['Dell', 'waiting'],
    ]);
  });

  it('shows the house pilots of a practice race ready from the seat', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.tick();
    sim.realmRacersPracticeStart('rookie', human);
    const view = live(buildRealmRacersLobbyView(sim.realmRacersInfoFor(human).match, PREPARING));
    const me = view.pilots.find((pilot) => pilot.isMe);
    const house = view.pilots.filter((pilot) => !pilot.isMe);
    expect(me).toMatchObject({ pid: human, bot: false, status: 'waiting' });
    expect(house).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    expect(house.every((pilot) => pilot.bot && pilot.status === 'ready')).toBe(true);
  });
});

describe('stepRealmRacersLobbyFailsafe', () => {
  it('turns each received secondsLeft into a client deadline, expiring on a frozen value', () => {
    const state = createRealmRacersLobbyFailsafe();
    const at = (secondsLeft: number) => lobby({ loading: { secondsLeft, readyIds: [] } });
    expect(stepRealmRacersLobbyFailsafe(state, at(12), 1_000)).toBe(true);
    // A frozen snapshot (a dead socket, a stalled server) keeps its first receipt.
    const deadline = 1_000 + 12_000 + REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS;
    expect(stepRealmRacersLobbyFailsafe(state, at(12), deadline)).toBe(true);
    expect(stepRealmRacersLobbyFailsafe(state, at(12), deadline + 1)).toBe(false);
    expect(stepRealmRacersLobbyFailsafe(state, at(12), deadline + 5_000)).toBe(false);
    // A newly received, CHANGED value means the lobby is alive: it re-arms.
    expect(stepRealmRacersLobbyFailsafe(state, at(3), deadline + 6_000)).toBe(true);
    const next = deadline + 6_000 + 3_000 + REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS;
    expect(stepRealmRacersLobbyFailsafe(state, at(3), next)).toBe(true);
    expect(stepRealmRacersLobbyFailsafe(state, at(3), next + 1)).toBe(false);
  });

  it('moves the deadline with each new second, and re-arms for the next match', () => {
    const state = createRealmRacersLobbyFailsafe();
    const at = (secondsLeft: number, id = 7) =>
      lobby({ id, loading: { secondsLeft, readyIds: [] } });
    stepRealmRacersLobbyFailsafe(state, at(12), 0);
    expect(stepRealmRacersLobbyFailsafe(state, at(11), 1_000)).toBe(true);
    expect(
      stepRealmRacersLobbyFailsafe(state, at(11), 12_000 + REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS),
    ).toBe(true);
    expect(stepRealmRacersLobbyFailsafe(state, lobby({ phase: 'countdown' }), 90_000)).toBe(false);
    expect(stepRealmRacersLobbyFailsafe(state, at(15, 8), 90_000)).toBe(true);
    expect(stepRealmRacersLobbyFailsafe(state, null, 90_001)).toBe(false);
  });
});
