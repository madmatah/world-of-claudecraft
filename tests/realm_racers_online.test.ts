import { afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => ({ listings: [], collections: new Map() })),
  saveMarketState: vi.fn(async () => {}),
  loadMailState: vi.fn(async () => ({})),
  saveMailState: vi.fn(async () => {}),
  markAccountQuestComplete: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  grantAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  revokeAccountMechChroma: vi.fn(async () => ({
    completedQuestIds: [],
    mechChromaIds: [],
  })),
  insertBankLedgerRow: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';

setActiveWorldContent({
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
});
afterAll(() => setActiveWorldContent(null));

interface FakeClient {
  sent: Record<string, unknown>[];
  ws: { readyState: number; send(payload: string): void };
}

function fakeClient(): FakeClient {
  const sent: Record<string, unknown>[] = [];
  return {
    sent,
    ws: {
      readyState: 1,
      send(payload) {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    },
  };
}

function join(server: GameServer, client: FakeClient, id: number, name: string): ClientSession {
  const joined = server.join(client.ws as never, id, id, name, 'warrior', null);
  if ('error' in joined) throw new Error(joined.error);
  joined.blockListLoaded = true;
  return joined;
}

function command(
  server: GameServer,
  session: ClientSession,
  cmd: string,
  extra: Record<string, unknown> = {},
): void {
  server.handleMessage(session, JSON.stringify({ t: 'cmd', cmd, ...extra }));
}

function advance(server: GameServer): void {
  const batch = server.sim.tick();
  (
    server as unknown as {
      routeEvents(events: typeof batch): void;
      broadcastSnapshots(): void;
    }
  ).routeEvents(batch);
  (
    server as unknown as {
      broadcastSnapshots(): void;
    }
  ).broadcastSnapshots();
}

function events(client: FakeClient, type: string): Record<string, unknown>[] {
  return client.sent
    .filter((frame) => frame.t === 'events')
    .flatMap((frame) => (frame.list as Record<string, unknown>[] | undefined) ?? [])
    .filter((event) => event.type === type);
}

function selfFields(client: FakeClient, key: string): unknown[] {
  return client.sent
    .filter((frame) => frame.t === 'snap')
    .map((frame) => frame.self as Record<string, unknown>)
    .filter((self) => Object.hasOwn(self, key))
    .map((self) => self[key]);
}

describe('Realm Racers online parity', () => {
  it('routes every ClientWorld command through the append-only command seam', () => {
    const cmd = vi.fn();
    const probe = { cmd };
    ClientWorld.prototype.joinRealmRacersQueue.call(probe as never);
    ClientWorld.prototype.leaveRealmRacersQueue.call(probe as never);
    ClientWorld.prototype.forfeitRealmRacers.call(probe as never);
    ClientWorld.prototype.startRealmRacersPractice.call(probe as never, 'ace');
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'realm_racers_join' }],
      [{ cmd: 'realm_racers_leave' }],
      [{ cmd: 'realm_racers_forfeit' }],
      [{ cmd: 'realm_racers_practice', tier: 'ace' }],
    ]);
  });

  it('seats a Practice race against a house pilot online, and rejects a bogus tier', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');

    // The tier is re-validated server-side: a client is never trusted with the
    // wire token, and an unknown one seats nobody.
    command(server, session, 'realm_racers_practice', { tier: 'grandmaster' });
    advance(server);
    expect(server.sim.realmRacers.practices).toEqual([]);
    expect(server.sim.realmRacers.bots.size).toBe(0);

    command(server, session, 'realm_racers_practice', { tier: 'rookie' });
    advance(server);
    // A private copy of the circuit, not the public one: the queue is free for
    // anyone who wants a real race.
    expect(server.sim.realmRacers.match).toBeNull();
    const match = server.sim.realmRacers.practices[0];
    expect(match?.pids).toContain(session.pid);
    expect(match?.practice?.ownerPid).toBe(session.pid);
    expect(match?.totalLaps).toBe(4);
    expect(server.sim.realmRacers.bots.size).toBe(1);
    // The opponent's tier reaches the viewer through the same `rr` self key
    // the rest of the rally state rides, so the HUD needs no second channel.
    expect(selfFields(client, 'rr').at(-1)).toMatchObject({
      match: { practice: true, totalLaps: 4, opponent: { botTier: 'rookie' } },
    });
  });

  it('forms a two-player match, routes personal events, and ships Rally kit/state deltas', () => {
    const server = new GameServer();
    const aClient = fakeClient();
    const bClient = fakeClient();
    const a = join(server, aClient, 1, 'Aster');
    const b = join(server, bClient, 2, 'Briar');

    command(server, a, 'realm_racers_join');
    command(server, b, 'realm_racers_join');
    for (let i = 0; i < 12; i++) advance(server);

    expect(server.sim.realmRacers.match?.pids).toEqual([a.pid, b.pid]);
    expect(server.sim.realmRacers.match?.totalLaps).toBe(3);
    expect(events(aClient, 'realmRacersFound')).toHaveLength(1);
    expect(events(bClient, 'realmRacersFound')).toHaveLength(1);
    expect(selfFields(aClient, 'rr').at(-1)).toMatchObject({
      match: { phase: 'countdown', totalLaps: 3, opponent: { name: 'Briar' } },
    });
    // The kit flag names the weapon in the racer's SLOT plus its per-race
    // budget, so the mirror rebuilds the same kit the sim granted rather than a
    // hardcoded one. The live remaining count rides `achg`, not this.
    expect(selfFields(aClient, 'rrkit').at(-1)).toEqual({
      active: true,
      w: 'rally_arc_shell',
      c: 3,
    });

    command(server, a, 'realm_racers_forfeit');
    advance(server);
    expect(events(aClient, 'realmRacersResult').at(-1)).toMatchObject({
      forfeited: true,
      winnerName: 'Briar',
    });
    expect(events(bClient, 'realmRacersResult').at(-1)).toMatchObject({
      won: true,
      winnerName: 'Briar',
    });
  });
});
