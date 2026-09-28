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
import { driveWire } from '../server/realm_racers_drive_wire';
import { emitRealmRacersKitKey, emitRealmRacersSelfKeys } from '../server/realm_racers_self_wire';
import { ClientWorld } from '../src/net/online';
import { decodeDriveWire } from '../src/net/realm_racers_drive_wire';
import { decodeRealmRacersKit, realmRacersKnownOr } from '../src/net/realm_racers_self_wire';
import {
  REALM_RACERS_NITRO_ABILITY_ID,
  REALM_RACERS_SLICK_ABILITY_ID,
} from '../src/sim/content/realm_racers';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_WARD_AURA,
  realmRacersMatchOf,
} from '../src/sim/social/realm_racers';
import { REALM_RACERS_LOADING_MAX_TICKS } from '../src/sim/social/realm_racers_loading';
import { TICK_RATE } from '../src/sim/types';
import {
  createRealmRacersReadySender,
  stepRealmRacersReady,
} from '../src/ui/realm_racers_ready_core';
import type { RealmRacersMatchInfo } from '../src/world_api/realm_racers';
import { bareClient } from './helpers/bare_client';
import { installScriptedRng, rallyPickupRollFor } from './helpers/realm_racers_rng';

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
    ClientWorld.prototype.readyRealmRacers.call(probe as never);
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'realm_racers_join' }],
      [{ cmd: 'realm_racers_leave' }],
      [{ cmd: 'realm_racers_forfeit' }],
      [{ cmd: 'realm_racers_reset' }],
      [{ cmd: 'realm_racers_practice', tier: 'ace' }],
      [{ cmd: 'realm_racers_ready' }],
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
      match: { phase: 'loading', totalLaps: 3, gridSize: REALM_RACERS_GRID_SIZE },
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
    expect(server.sim.realmRacers.match?.phase).toBe('loading');
  });

  it('holds the grid in the loading lobby until every pilot sends ready over the wire', () => {
    const server = new GameServer();
    const names = ['Aster', 'Briar', 'Cass', 'Dell'];
    const clients = names.map(() => fakeClient());
    const sessions = names.map((name, i) => join(server, clients[i], i + 1, name));
    const [first, second, third, fourth] = sessions;
    for (const session of sessions) command(server, session, 'realm_racers_join');
    advance(server);
    const match = server.sim.realmRacers.match;
    if (!match) throw new Error('missing match');
    expect(match.phase).toBe('loading');
    const lobbyOf = (client: FakeClient) =>
      (selfFields(client, 'rr').at(-1) as { match: RealmRacersMatchInfo }).match;
    expect(lobbyOf(clients[3]).loading).toEqual({
      secondsLeft: REALM_RACERS_LOADING_MAX_TICKS / TICK_RATE,
      readyIds: [],
    });

    for (const session of [first, second, third]) command(server, session, 'realm_racers_ready');
    command(server, first, 'realm_racers_ready');
    advance(server);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(clients[3]).loading?.readyIds).toEqual([first.pid, second.pid, third.pid]);

    // A dropped socket is not ready, and the lobby keeps waiting for it.
    expect(server.socketClosed(first, first.ws as never)).toBe(true);
    command(server, fourth, 'realm_racers_ready');
    advance(server);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(clients[3]).loading?.readyIds).toEqual([second.pid, third.pid, fourth.pid]);

    // Reconnected: still seated on the grid, ready only once it says so again.
    const back = fakeClient();
    expect(join(server, back, 1, 'Aster')).toBe(first);
    advance(server);
    expect(realmRacersMatchOf(server.sim.ctx, first.pid)).toBe(match);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(back).loading?.readyIds).toEqual([second.pid, third.pid, fourth.pid]);

    command(server, first, 'realm_racers_ready');
    advance(server);
    expect(match.phase).toBe('countdown');
    expect(match.goTick - server.sim.tickCount).toBe(REALM_RACERS_COUNTDOWN_TICKS);
    for (const client of [back, ...clients.slice(1)]) {
      const mirrored = lobbyOf(client);
      expect(mirrored).toMatchObject({
        phase: 'countdown',
        countdownTicks: REALM_RACERS_COUNTDOWN_TICKS,
      });
      expect(mirrored.loading).toBeUndefined();
    }
    // Out of the lobby, a late ready changes nothing.
    command(server, second, 'realm_racers_ready');
    advance(server);
    expect(match.goTick - server.sim.tickCount).toBe(REALM_RACERS_COUNTDOWN_TICKS - 1);
  });

  it('re-sends the client ready after a linkdead resume, and the lobby closes early', () => {
    const server = new GameServer();
    let client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    const mirror = bareClient(session.pid);
    const sent: string[] = [];
    (mirror as unknown as { cmd(msg: Record<string, unknown>): void }).cmd = (msg) => {
      sent.push(String(msg.cmd));
      command(server, session, String(msg.cmd));
    };
    const sender = createRealmRacersReadySender();
    const frame = () => {
      const snap = client.sent.filter((f) => f.t === 'snap').at(-1);
      (mirror as unknown as { applySnapshot(f: unknown): void }).applySnapshot(snap);
      stepRealmRacersReady(sender, mirror.realmRacersInfo, { settled: true }, () =>
        mirror.readyRealmRacers(),
      );
    };
    command(server, session, 'realm_racers_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    const seatTick = server.sim.tickCount;
    frame();
    expect(sent).toEqual(['realm_racers_ready']);
    // The socket drops before the lobby could close on that ready.
    expect(server.socketClosed(session, session.ws as never)).toBe(true);
    for (let i = 0; i < 5; i++) advance(server);
    expect(match.phase).toBe('loading');

    client = fakeClient();
    expect(join(server, client, 1, 'Aster')).toBe(session);
    for (let i = 0; i < 2 * TICK_RATE && match.phase === 'loading'; i++) {
      advance(server);
      frame();
    }
    advance(server);
    expect(match.phase).toBe('countdown');
    expect(sent).toEqual(['realm_racers_ready', 'realm_racers_ready']);
    expect(server.sim.tickCount - seatTick).toBeLessThan(3 * TICK_RATE);
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

  it('mirrors EVERY held effect at once, not just the first', () => {
    // The seat report of 2026-08-05, and the second instance of this exact bug
    // class: the kit flag carried ONE held effect (`known[1]`), so a racer
    // holding two had the second silently dropped between the sim and the bar.
    // In game that read as "/dev rallykit does not give me the slick" while the
    // nitro beside it came through, because the nitro happens to sort first.
    // The grant is a DEV surface, and the seat it was reported from runs a dev
    // realm, so the server under test has to be one too: without the flag the
    // stack is set and deliberately ignored, and this would pass on a mirror
    // that had nothing to carry.
    const previous = process.env.ALLOW_DEV_COMMANDS;
    process.env.ALLOW_DEV_COMMANDS = '1';
    try {
      const server = new GameServer();
      const client = fakeClient();
      const session = join(server, client, 1, 'Aster');
      command(server, session, 'realm_racers_practice', { tier: 'rookie' });
      advance(server);
      const match = server.sim.realmRacers.practices[0];
      if (!match) throw new Error('missing practice match');
      match.phase = 'racing';

      // Both slots stocked, the way the dev grant leaves them.
      expect(server.sim.ctx.realmRacersDevGrantKit(session.pid, 50)).toBe(true);
      advance(server);

      const kit = selfFields(client, 'rrkit').at(-1) as { h?: string[] };
      expect(kit.h).toEqual(['nitro', 'slick']);

      // And the mirror's OWN kit surface carries both, which is what the action
      // bar reads: replay every frame, since the kit flag rides a wireRev gate.
      const mirror = bareClient(session.pid);
      for (const frame of client.sent.filter((sent) => sent.t === 'snap')) {
        (mirror as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(frame);
      }
      const known = mirror.known.map((entry) => entry.def.id);
      expect(known).toContain(REALM_RACERS_SLICK_ABILITY_ID);
      expect(known).toContain(REALM_RACERS_NITRO_ABILITY_ID);
      // Carrying the server's real counts, not a hardcoded single charge: the
      // badge a pilot reads has to be the stack they actually hold.
      expect(
        mirror.known.find((entry) => entry.def.id === REALM_RACERS_SLICK_ABILITY_ID)?.charges,
      ).toBe(50);
    } finally {
      if (previous === undefined) delete process.env.ALLOW_DEV_COMMANDS;
      else process.env.ALLOW_DEV_COMMANDS = previous;
    }
  });

  it('mirrors the oil a drawn pickup left on the road', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'realm_racers_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.realmRacers.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    expect(selfFields(client, 'rr').at(-1)).toMatchObject({
      match: { slicks: [], warded: false },
    });

    // Every take on this lane draws the OIL, whoever makes it: the three house
    // pilots are driving the same circuit and a race is not a laboratory, so the
    // stream is scripted rather than the field being frozen.
    const rng = installScriptedRng(server.sim);
    rng.script(...Array.from({ length: 12 }, () => rallyPickupRollFor('leader', 'slick')));
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

    // The box fills the HELD slot (the operator's mid-review override); the
    // patch appears when the pilot spends it, under the machine.
    const progressAfter = match.progress.get(session.pid);
    if (!progressAfter) throw new Error('missing progress');
    expect(rng.consumed).toBeGreaterThan(0);
    expect(progressAfter.heldEffect).toBe('slick');
    // The held effect rides the kit flag onto the mirror, or an online pilot
    // would be holding something with no button to spend it.
    expect(selfFields(client, 'rrkit').at(-1)).toMatchObject({ h: ['slick'] });
    // The seat report of 2026-08-04: the wire carried `h` and the button never
    // appeared, because the decode re-fed the EFFECT NAME to a mapper whose
    // domain is ability ids and rebuilt the kit with `held: null`. While the
    // effect is held, the held ability must be in the mirror's OWN kit surface
    // (`known`, exactly what the action bar reads), which means replaying every
    // frame the session received so far, including the one carrying `rrkit.h`.
    const heldMirror = bareClient(session.pid);
    for (const frame of client.sent.filter((sent) => sent.t === 'snap')) {
      (heldMirror as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(frame);
    }
    expect(heldMirror.known.map((known) => known.def.id)).toContain(REALM_RACERS_SLICK_ABILITY_ID);
    command(server, session, 'cast', { ability: REALM_RACERS_SLICK_ABILITY_ID });
    advance(server);

    // The patch is on the road in the CIRCUIT's own frame, which is the frame
    // the renderer's track group is built in.
    const dropped = match.slicks.find((slick) => slick.ownerPid === session.pid);
    if (!dropped) throw new Error('no slick dropped');
    expect(Math.hypot(dropped.x - box.x, dropped.z - box.z)).toBeLessThan(1);

    const world = bareClient(session.pid);
    const snap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(snap);
    // Both worlds hand presentation the same field, which is what the patches'
    // renderer reads: the mirror is the offline readout, verbatim.
    expect(world.realmRacersInfo.match?.slicks).toEqual(
      server.sim.realmRacersInfoFor(session.pid).match?.slicks,
    );
    // The ward: an AURA on the racer (the operator's 2026-08-04 call), which is
    // the source of truth the `warded` flag on the blob is derived from. Granted
    // through the real path, a scripted ward draw at the next box.
    const serverRacer = server.sim.entities.get(session.pid);
    if (!serverRacer) throw new Error('missing racer');
    for (let i = 0; i < 21; i++) advance(server);
    // A FRESH scripted stream: the slick rolls queued above may not all have been
    // spent (the three house pilots take boxes too), and a leftover would hand
    // this take the wrong effect.
    const wardRng = installScriptedRng(server.sim);
    wardRng.script(rallyPickupRollFor('leader', 'ward'));
    // Every box back on the circuit, so the one below is certainly there: which
    // boxes the house pilots have collected is not what this case is about.
    match.pickups.taken.fill(false);
    const wardBox = realmRacersPickupBoxes(GARDEN_CIRCUIT)[5];
    serverRacer.pos.x = match.origin.x + wardBox.x;
    serverRacer.pos.z = match.origin.z + wardBox.z;
    serverRacer.prevPos = { ...serverRacer.pos };
    const wardProjection = realmRacersTrack(GARDEN_CIRCUIT).project(wardBox.x, wardBox.z);
    progressAfter.lastS = wardProjection.s;
    progressAfter.trackIndex = wardProjection.index;
    advance(server);
    expect(wardRng.consumed).toBe(1);
    expect(serverRacer.auras.some((aura) => aura.id === REALM_RACERS_WARD_AURA)).toBe(true);

    const wardedSnap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(wardedSnap);
    expect(world.realmRacersInfo.match?.warded).toBe(true);
    // And it rides the ORDINARY entity aura wire, so a rival who targets this
    // racer sees the shield in their target frame rather than being surprised by
    // a shell that does nothing. Read off the frame a SECOND session receives.
    const rivalClient = fakeClient();
    const rivalSession = join(server, rivalClient, 2, 'Briar');
    const rivalEntity = server.sim.entities.get(rivalSession.pid);
    if (!rivalEntity) throw new Error('missing rival');
    rivalEntity.pos = { ...serverRacer.pos, x: serverRacer.pos.x + 3 };
    rivalEntity.prevPos = { ...rivalEntity.pos };
    advance(server);
    const rivalFrames = rivalClient.sent.filter((frame) => frame.t === 'snap');
    const seen = rivalFrames
      .flatMap((frame) => (frame.ents as { id: number; auras?: { id: string }[] }[]) ?? [])
      .filter((row) => row.id === session.pid)
      .flatMap((row) => row.auras ?? []);
    expect(seen.map((aura) => aura.id)).toContain(REALM_RACERS_WARD_AURA);
    // Rounded to the hundredth of a yard by the shared readout builder, which is
    // where BOTH hosts do it: the mirror carries exactly what the offline Sim
    // would have handed presentation, to the byte.
    expect(world.realmRacersInfo.match?.slicks).toContainEqual({
      id: dropped.id,
      x: Math.round(dropped.x * 100) / 100,
      z: Math.round(dropped.z * 100) / 100,
    });
  });
});

describe('Realm Racers net decode siblings', () => {
  it('decodes a drive record into a fresh object, with defaults for sparse keys', () => {
    const drv = { k: 'rally_loaner', sp: 12, lk: 1 };
    const drive = decodeDriveWire(drv);
    expect(drive).toEqual({
      profileKey: 'rally_loaner',
      speed: 12,
      slip: 0,
      steerAngle: 0,
      yawRate: 0,
      spin: 0,
      handbrake: 0,
      gripMult: 1,
      dragMult: 1,
      speedCap: 1,
      slipCap: 1,
      collisionImpact: 0,
      controlsLocked: true,
    });
    expect(drive).not.toBe(drv);
    expect(decodeDriveWire(undefined)).toBeNull();
  });

  it('keeps the prior kit on an absent key and drops unknown held effects', () => {
    const prior = { abilityId: 'x', charges: 1, held: [] };
    expect(decodeRealmRacersKit(prior, undefined)).toBe(prior);
    expect(decodeRealmRacersKit(prior, null)).toBeNull();
    expect(decodeRealmRacersKit(prior, { active: false })).toBeNull();
    expect(
      decodeRealmRacersKit(null, {
        active: true,
        w: 'rally_ground_blast',
        c: 3,
        h: ['slick', 'bogus'],
      }),
    ).toEqual({ abilityId: 'rally_ground_blast', charges: 3, held: ['slick'] });
  });

  it('stamps the kit pools fixed and resolves the kit, or keeps the class list', () => {
    const presentation = [{ id: 'class_ability' }] as unknown as Parameters<
      typeof realmRacersKnownOr
    >[2];
    const e = {
      abilityCharges: {
        rally_ground_blast: { charges: 2, maxCharges: 3, recharge: 0, rechargeLength: 0 },
        rally_oil_slick: { charges: 1, maxCharges: 1, recharge: 0, rechargeLength: 0 },
      },
    } as unknown as Parameters<typeof realmRacersKnownOr>[1];
    expect(realmRacersKnownOr(null, e, presentation)).toBe(presentation);
    const known = realmRacersKnownOr(
      { abilityId: 'rally_ground_blast', charges: 3, held: ['slick'] },
      e,
      presentation,
    );
    expect(known.map((k) => k.def.id)).toEqual(['rally_ground_blast', 'rally_oil_slick']);
    expect(e?.abilityCharges?.rally_ground_blast?.fixed).toBe(true);
    expect(e?.abilityCharges?.rally_oil_slick?.fixed).toBe(true);
  });
});

describe('Realm Racers server wire siblings', () => {
  it('encodes a drive record sparsely, in its wire key order', () => {
    const drive = {
      profileKey: 'rally_loaner',
      speed: 12.345,
      slip: 0,
      steerAngle: 0,
      yawRate: 0.5,
      spin: 0,
      handbrake: 0,
      gripMult: 1,
      dragMult: 1,
      speedCap: 1,
      slipCap: 1,
      collisionImpact: 0.005,
      controlsLocked: false,
    };
    expect(JSON.stringify(driveWire(drive))).toBe(
      '{"k":"rally_loaner","sp":12.35,"sl":0,"yr":0.5,"sn":0,"hb":0,"g":1,"dg":1,"c":1,"sc":1}',
    );
    expect(
      JSON.stringify(
        driveWire({ ...drive, steerAngle: -0.5, collisionImpact: 0.5, controlsLocked: true }),
      ),
    ).toBe(
      '{"k":"rally_loaner","sp":12.35,"sl":0,"yr":0.5,"st":-0.5,"sn":0,"hb":0,"g":1,"dg":1,"c":1,"sc":1,"ci":0.5,"lk":1}',
    );
  });

  it('emits rr then rrt, and the kit with its held list or an explicit null', () => {
    const keys: [string, unknown][] = [];
    const maybe = (key: string, value: unknown) => keys.push([key, value]);
    emitRealmRacersSelfKeys(
      maybe,
      { realmRacersInfoFor: () => 'info', realmRacersTracksideFor: () => null } as never,
      7,
    );
    const weapon = { def: { id: 'rally_ground_blast' }, charges: 3 };
    const slick = { def: { id: 'rally_oil_slick' } };
    emitRealmRacersKitKey(maybe, { realmRacersMatchId: 1, known: [weapon, slick] } as never);
    emitRealmRacersKitKey(maybe, { realmRacersMatchId: 1, known: [weapon] } as never);
    emitRealmRacersKitKey(maybe, { realmRacersMatchId: null, known: [weapon] } as never);
    expect(keys).toEqual([
      ['rr', 'info'],
      ['rrt', null],
      ['rrkit', { active: true, w: 'rally_ground_blast', c: 3, h: ['slick'] }],
      ['rrkit', { active: true, w: 'rally_ground_blast', c: 3 }],
      ['rrkit', null],
    ]);
  });
});
