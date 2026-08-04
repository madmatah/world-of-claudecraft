import { afterAll, describe, expect, it, vi } from 'vitest';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';

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
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
}));

import { type ClientSession, GameServer } from '../server/game';
import { ClientWorld } from '../src/net/online';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import { bareClient } from './helpers/bare_client';

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
    ClientWorld.prototype.resetRealmRacersPosition.call(probe as never);
    ClientWorld.prototype.startRealmRacersPractice.call(probe as never, 'ace');
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'realm_racers_join' }],
      [{ cmd: 'realm_racers_leave' }],
      [{ cmd: 'realm_racers_forfeit' }],
      [{ cmd: 'realm_racers_reset' }],
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
    expect(match?.pids).toHaveLength(REALM_RACERS_GRID_SIZE);
    expect(server.sim.realmRacers.bots.size).toBe(REALM_RACERS_GRID_SIZE - 1);
    // The whole standings list, tiers included, reaches the viewer through the
    // same `rr` self key the rest of the rally state rides, so the HUD needs no
    // second channel for the four-row strip.
    const mirrored = selfFields(client, 'rr').at(-1) as {
      match: {
        practice: boolean;
        totalLaps: number;
        participantIds: number[];
        gridSize: number;
        standings: { pid: number; botTier: string | null; position: number }[];
      };
    };
    expect(mirrored.match).toMatchObject({
      practice: true,
      totalLaps: 4,
      participantIds: match?.pids,
      gridSize: REALM_RACERS_GRID_SIZE,
    });
    expect(mirrored.match.standings).toHaveLength(REALM_RACERS_GRID_SIZE);
    expect(mirrored.match.standings.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(mirrored.match.standings.filter((row) => row.botTier === 'rookie')).toHaveLength(
      REALM_RACERS_GRID_SIZE - 1,
    );
  });

  it('forms a four-pilot match, routes personal events, and ships Rally kit/state deltas', () => {
    const server = new GameServer();
    const names = ['Aster', 'Briar', 'Cass', 'Dell'];
    const clients = names.map(() => fakeClient());
    const sessions = names.map((name, i) => join(server, clients[i], i + 1, name));

    for (const session of sessions) command(server, session, 'realm_racers_join');
    for (let i = 0; i < 12; i++) advance(server);

    expect(server.sim.realmRacers.match?.pids).toEqual(sessions.map((s) => s.pid));
    expect(server.sim.realmRacers.match?.totalLaps).toBe(3);
    for (const client of clients) expect(events(client, 'realmRacersFound')).toHaveLength(1);
    // The banner names the whole field, not one rival.
    expect(events(clients[0], 'realmRacersFound')[0]).toMatchObject({
      rivalNames: ['Briar', 'Cass', 'Dell'],
    });
    expect(selfFields(clients[0], 'rr').at(-1)).toMatchObject({
      match: { phase: 'countdown', totalLaps: 3, gridSize: REALM_RACERS_GRID_SIZE },
    });
    // The kit flag names the weapon in the racer's SLOT plus its per-race
    // budget, so the mirror rebuilds the same kit the sim granted rather than a
    // hardcoded one. The live remaining count rides `achg`, not this.
    expect(selfFields(clients[0], 'rrkit').at(-1)).toEqual({
      active: true,
      w: 'rally_ground_blast',
      c: 3,
    });

    command(server, sessions[0], 'realm_racers_forfeit');
    advance(server);
    // The quitter is told at once and placed last; nobody else's race ended, so
    // nobody else has a result yet.
    expect(events(clients[0], 'realmRacersResult').at(-1)).toMatchObject({
      forfeited: true,
      won: false,
      placing: REALM_RACERS_GRID_SIZE,
      gridSize: REALM_RACERS_GRID_SIZE,
    });
    for (const client of clients.slice(1)) {
      expect(events(client, 'realmRacersResult')).toHaveLength(0);
    }
    expect(server.sim.realmRacers.match?.phase).toBe('countdown');
  });

  it('dispatches recovery, routes its silent snap event, and mirrors the movement lock', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'realm_racers_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    const racer = server.sim.entities.get(session.pid);
    if (!racer) throw new Error('missing racer');
    const progress = match.progress.get(session.pid);
    if (!progress) throw new Error('missing racer progress');
    const track = realmRacersTrack(GARDEN_CIRCUIT);
    const anchor = track.pointAt(progress.resetS);
    const anchorX = match.origin.x + anchor.x;
    const anchorZ = match.origin.z + anchor.z;
    // Clear the house pilots off the racing line first: recovery drops the
    // machine on it, and a rival parked there would legitimately be separated
    // by the contact pass, which this test is not about.
    match.pids
      .filter((pid) => pid !== session.pid)
      .forEach((pid, i) => {
        const away = track.pointAt(track.length * (0.3 + i * 0.15));
        const other = server.sim.entities.get(pid);
        if (!other) throw new Error('missing house pilot');
        other.pos.x = match.origin.x + away.x;
        other.pos.z = match.origin.z + away.z;
        other.prevPos = { ...other.pos };
      });
    racer.pos.x += 4;
    racer.prevPos = { ...racer.pos };
    client.sent.length = 0;

    command(server, session, 'realm_racers_reset');
    advance(server);

    // groundPos may resolve the horizontal sample onto a nearby terrain
    // triangle; the recovery still lands at the authored track anchor.
    expect(Math.hypot(racer.pos.x - anchorX, racer.pos.z - anchorZ)).toBeLessThan(0.2);
    expect(events(client, 'realmRacersReset')).toHaveLength(1);
    expect(selfFields(client, 'rr').at(-1)).toMatchObject({ match: { resetLocked: true } });
    expect(selfFields(client, 'drv').at(-1)).toMatchObject({ lk: 1 });
  });

  it('mirrors the taken pickup boxes onto the online client', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'realm_racers_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    expect(selfFields(client, 'rr').at(-1)).toMatchObject({ match: { pickupsTaken: [] } });

    // Onto a box of the second row, on this practice lane's own copy of the
    // circuit. Taking one is a consequence of POSITION, so there is no command
    // to send: the server decides it inside the tick.
    const box = realmRacersPickupBoxes(GARDEN_CIRCUIT)[4];
    const racer = server.sim.entities.get(session.pid);
    const progress = match.progress.get(session.pid);
    if (!racer || !progress) throw new Error('missing racer');
    racer.pos.x = match.origin.x + box.x;
    racer.pos.z = match.origin.z + box.z;
    racer.prevPos = { ...racer.pos };
    const projection = realmRacersTrack(GARDEN_CIRCUIT).project(box.x, box.z);
    progress.lastS = projection.s;
    progress.trackIndex = projection.index;
    advance(server);

    const mirrored = selfFields(client, 'rr').at(-1) as {
      match: { pickupsTaken: number[] };
    };
    expect(mirrored.match.pickupsTaken).toContain(4);
    // And the mirror really decodes it: the offline Sim and the online
    // ClientWorld hand presentation the same field, which is what the boxes'
    // renderer reads.
    const world = bareClient(session.pid);
    const snap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(snap);
    expect(world.realmRacersInfo.match?.pickupsTaken).toEqual(
      server.sim.realmRacersInfoFor(session.pid).match?.pickupsTaken,
    );
    expect(world.realmRacersInfo.match?.pickupsTaken).toContain(4);
  });
});
