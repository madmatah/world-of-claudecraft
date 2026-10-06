import { afterAll, describe, expect, it, vi } from 'vitest';
import { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/mortar_overdrive/circuits';

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
import { driveWire } from '../server/mortar_overdrive/drive_wire';
import {
  emitMortarOverdriveKitKey,
  emitMortarOverdriveSelfKeys,
  mortarOverdriveIdleReadout,
} from '../server/mortar_overdrive/self_wire';
import { decodeDriveWire } from '../src/net/mortar_overdrive/drive_wire';
import {
  decodeMortarOverdriveKit,
  mortarOverdriveKnownOr,
} from '../src/net/mortar_overdrive/self_wire';
import { ClientWorld } from '../src/net/online';
import { characterVeilboundState } from '../src/render/ghost_style_core';
import {
  MORTAR_OVERDRIVE_NITRO_ABILITY_ID,
  MORTAR_OVERDRIVE_SLICK_ABILITY_ID,
} from '../src/sim/content/mortar_overdrive/kit';
import { BUILTIN_WORLD, setActiveWorldContent } from '../src/sim/data';
import {
  MORTAR_OVERDRIVE_GHOST_AURA,
  mortarOverdriveGhosted,
} from '../src/sim/mortar_overdrive/ghost';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import { MORTAR_OVERDRIVE_LOADING_MAX_TICKS } from '../src/sim/mortar_overdrive/loading';
import { mortarOverdrivePickupBoxes } from '../src/sim/mortar_overdrive/pickups';
import {
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  MORTAR_OVERDRIVE_WARD_AURA,
  MORTAR_OVERDRIVE_WARD_AURA_SECONDS,
  mortarOverdriveMatchOf,
  mortarOverdriveWarded,
} from '../src/sim/mortar_overdrive/race';
import {
  type MortarOverdriveMatchClock,
  type MortarOverdriveStillInfo,
  mergeMortarOverdriveInfo,
  mortarOverdriveStillFromWire,
  mortarOverdriveStillToWire,
  splitMortarOverdriveInfo,
} from '../src/sim/mortar_overdrive/readout_clock';
import {
  MORTAR_OVERDRIVE_SLICK_CAP,
  MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
} from '../src/sim/mortar_overdrive/slicks';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';
import { type Entity, TICK_RATE } from '../src/sim/types';
import {
  createMortarOverdriveReadySender,
  stepMortarOverdriveReady,
} from '../src/ui/hud/mortar_overdrive/ready_core';
import type { MortarOverdriveMatchInfo } from '../src/world_api/mortar_overdrive';
import { bareClient } from './helpers/bare_client';
import { installScriptedRng, mortarOverdrivePickupRollFor } from './helpers/mortar_overdrive_rng';

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

describe('Mortar Overdrive online parity', () => {
  it('routes every ClientWorld command through the append-only command seam', () => {
    const cmd = vi.fn();
    const probe = { cmd };
    ClientWorld.prototype.joinMortarOverdriveQueue.call(probe as never);
    ClientWorld.prototype.leaveMortarOverdriveQueue.call(probe as never);
    ClientWorld.prototype.forfeitMortarOverdrive.call(probe as never);
    ClientWorld.prototype.resetMortarOverdrivePosition.call(probe as never);
    ClientWorld.prototype.startMortarOverdrivePractice.call(probe as never, 'ace');
    ClientWorld.prototype.readyMortarOverdrive.call(probe as never);
    ClientWorld.prototype.startMortarOverdriveNow.call(probe as never);
    expect(cmd.mock.calls).toEqual([
      [{ cmd: 'mortar_overdrive_join' }],
      [{ cmd: 'mortar_overdrive_leave' }],
      [{ cmd: 'mortar_overdrive_forfeit' }],
      [{ cmd: 'mortar_overdrive_reset' }],
      [{ cmd: 'mortar_overdrive_practice', tier: 'ace' }],
      [{ cmd: 'mortar_overdrive_ready' }],
      [{ cmd: 'mortar_overdrive_start_now' }],
    ]);
  });

  it('starts the queue online on Start now, for every queued pilot, and only from a queued one', () => {
    const server = new GameServer();
    const clients = [fakeClient(), fakeClient(), fakeClient()];
    const [aster, briar, idle] = ['Aster', 'Briar', 'Cass'].map((name, i) =>
      join(server, clients[i] as FakeClient, i + 1, name),
    ) as [ClientSession, ClientSession, ClientSession];
    command(server, aster, 'mortar_overdrive_join');
    command(server, briar, 'mortar_overdrive_join');
    advance(server);
    // A pilot who is not queued cannot start anybody's race.
    command(server, idle, 'mortar_overdrive_start_now');
    advance(server);
    expect(server.sim.mortarOverdrive.match).toBeNull();
    expect(server.sim.mortarOverdrive.bots.size).toBe(0);
    command(server, briar, 'mortar_overdrive_start_now');
    const match = server.sim.mortarOverdrive.match;
    expect(match?.pids.slice(0, 2)).toEqual([aster.pid, briar.pid]);
    expect(match?.practice).toBeNull();
    expect(server.sim.mortarOverdrive.bots.size).toBe(MORTAR_OVERDRIVE_GRID_SIZE - 2);
    expect(server.sim.mortarOverdrive.queue).toEqual([]);
  });

  it('ships a queued start as an absolute deadline once, and the mirror counts down like the sim', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'mortar_overdrive_join');
    const mirror = bareClient(session.pid);
    const apply = (frame: unknown): void =>
      (mirror as unknown as { applySnapshot(snap: unknown): void }).applySnapshot(frame);
    advance(server);
    for (const frame of client.sent.filter((f) => f.t === 'snap')) apply(frame);
    const shipped = selfFields(client, 'mo').at(-1) as {
      start: { startsAt: number; startsInTicks?: number; seats: unknown[] };
    };
    const startsIn = server.sim.mortarOverdriveInfoFor(session.pid).start?.startsInTicks as number;
    expect(shipped.start.startsAt).toBe(server.sim.tickCount + startsIn);
    expect(shipped.start).not.toHaveProperty('startsInTicks');
    expect(shipped.start.seats).toEqual([{ name: 'Aster', you: true }]);
    client.sent.length = 0;
    const TICKS = 40;
    for (let i = 0; i < TICKS; i++) {
      advance(server);
      apply(client.sent.filter((f) => f.t === 'snap').at(-1));
      expect(mirror.mortarOverdriveInfo, `tick ${i}`).toEqual(
        server.sim.mortarOverdriveInfoFor(session.pid),
      );
    }
    // The countdown moved every tick on both sides, yet `mo` never resent.
    expect(selfFields(client, 'mo')).toEqual([]);
  });

  it('ships a deadline already reached as a still value, never one that moves with the tick', () => {
    const at = (tick: number) =>
      mortarOverdriveStillToWire(
        {
          queued: true,
          queuePosition: 1,
          queueSize: 1,
          start: { seats: [], startsInTicks: 0, laneBusy: false, backfill: true },
          match: null,
          practiceAvailable: true,
        },
        tick,
      ).start?.startsAt;
    expect(at(100)).toBe(at(160));
    const back = mortarOverdriveStillFromWire(
      {
        queued: true,
        queuePosition: 1,
        queueSize: 1,
        start: { seats: [], startsAt: at(100) as number, laneBusy: false, backfill: true },
        match: null,
        practiceAvailable: true,
      },
      160,
    );
    expect(back.start?.startsInTicks).toBe(0);
  });

  it('seats a Practice race against a house pilot online, and rejects a bogus tier', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');

    // The tier is re-validated server-side: a client is never trusted with the
    // wire token, and an unknown one seats nobody.
    command(server, session, 'mortar_overdrive_practice', { tier: 'grandmaster' });
    advance(server);
    expect(server.sim.mortarOverdrive.practices).toEqual([]);
    expect(server.sim.mortarOverdrive.bots.size).toBe(0);

    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    // A private copy of the circuit, not the public one: the queue is free for
    // anyone who wants a real race.
    expect(server.sim.mortarOverdrive.match).toBeNull();
    const match = server.sim.mortarOverdrive.practices[0];
    expect(match?.pids).toContain(session.pid);
    expect(match?.practice?.ownerPid).toBe(session.pid);
    expect(match?.totalLaps).toBe(4);
    expect(match?.pids).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    expect(server.sim.mortarOverdrive.bots.size).toBe(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    // The whole standings list, tiers included, reaches the viewer through the
    // same `mo` self key the rest of the Mortar Overdrive state rides, so the HUD needs no
    // second channel for the four-row strip.
    const mirrored = selfFields(client, 'mo').at(-1) as {
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
      gridSize: MORTAR_OVERDRIVE_GRID_SIZE,
    });
    expect(mirrored.match.standings).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    expect(mirrored.match.standings.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(mirrored.match.standings.filter((row) => row.botTier === 'rookie')).toHaveLength(
      MORTAR_OVERDRIVE_GRID_SIZE - 1,
    );
  });

  it('forms a four-pilot match, routes personal events, and ships Mortar Overdrive kit/state deltas', () => {
    const server = new GameServer();
    const names = ['Aster', 'Briar', 'Cass', 'Dell'];
    const clients = names.map(() => fakeClient());
    const sessions = names.map((name, i) => join(server, clients[i], i + 1, name));

    for (const session of sessions) command(server, session, 'mortar_overdrive_join');
    for (let i = 0; i < 12; i++) advance(server);

    expect(server.sim.mortarOverdrive.match?.pids).toEqual(sessions.map((s) => s.pid));
    expect(server.sim.mortarOverdrive.match?.totalLaps).toBe(3);
    for (const client of clients) expect(events(client, 'mortarOverdriveFound')).toHaveLength(1);
    // The banner names the whole field, not one rival.
    expect(events(clients[0], 'mortarOverdriveFound')[0]).toMatchObject({
      rivalNames: ['Briar', 'Cass', 'Dell'],
    });
    expect(selfFields(clients[0], 'mo').at(-1)).toMatchObject({
      match: { phase: 'loading', totalLaps: 3, gridSize: MORTAR_OVERDRIVE_GRID_SIZE },
    });
    // The kit flag names the weapon in the racer's SLOT plus its per-race
    // budget, so the mirror rebuilds the same kit the sim granted rather than a
    // hardcoded one. The live remaining count rides `achg`, not this.
    expect(selfFields(clients[0], 'mokit').at(-1)).toEqual({
      active: true,
      w: 'mortar_overdrive_ground_blast',
      c: 3,
    });

    command(server, sessions[0], 'mortar_overdrive_forfeit');
    advance(server);
    // The quitter is told at once and placed last; nobody else's race ended, so
    // nobody else has a result yet.
    expect(events(clients[0], 'mortarOverdriveResult').at(-1)).toMatchObject({
      forfeited: true,
      won: false,
      placing: MORTAR_OVERDRIVE_GRID_SIZE,
      gridSize: MORTAR_OVERDRIVE_GRID_SIZE,
    });
    for (const client of clients.slice(1)) {
      expect(events(client, 'mortarOverdriveResult')).toHaveLength(0);
    }
    expect(server.sim.mortarOverdrive.match?.phase).toBe('loading');
  });

  it('holds the grid in the loading lobby until every pilot sends ready over the wire', () => {
    const server = new GameServer();
    const names = ['Aster', 'Briar', 'Cass', 'Dell'];
    const clients = names.map(() => fakeClient());
    const sessions = names.map((name, i) => join(server, clients[i], i + 1, name));
    const [first, second, third, fourth] = sessions;
    for (const session of sessions) command(server, session, 'mortar_overdrive_join');
    advance(server);
    const match = server.sim.mortarOverdrive.match;
    if (!match) throw new Error('missing match');
    expect(match.phase).toBe('loading');
    // The readout as the client folds it: the last `mo` and the last `moc`
    // (an absent key is an unchanged one, so the latest send of each is exact).
    const lobbyOf = (client: FakeClient) =>
      mergeMortarOverdriveInfo(
        selfFields(client, 'mo').at(-1) as MortarOverdriveStillInfo,
        selfFields(client, 'moc').at(-1) as MortarOverdriveMatchClock | null,
      ).match as MortarOverdriveMatchInfo;
    expect(lobbyOf(clients[3]).loading).toEqual({
      secondsLeft: MORTAR_OVERDRIVE_LOADING_MAX_TICKS / TICK_RATE,
      readyIds: [],
    });

    for (const session of [first, second, third])
      command(server, session, 'mortar_overdrive_ready');
    command(server, first, 'mortar_overdrive_ready');
    advance(server);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(clients[3]).loading?.readyIds).toEqual([first.pid, second.pid, third.pid]);

    // A dropped socket is not ready, and the lobby keeps waiting for it.
    expect(server.socketClosed(first, first.ws as never)).toBe(true);
    command(server, fourth, 'mortar_overdrive_ready');
    advance(server);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(clients[3]).loading?.readyIds).toEqual([second.pid, third.pid, fourth.pid]);

    // Reconnected: still seated on the grid, ready only once it says so again.
    const back = fakeClient();
    expect(join(server, back, 1, 'Aster')).toBe(first);
    advance(server);
    expect(mortarOverdriveMatchOf(server.sim.ctx, first.pid)).toBe(match);
    expect(match.phase).toBe('loading');
    expect(lobbyOf(back).loading?.readyIds).toEqual([second.pid, third.pid, fourth.pid]);

    command(server, first, 'mortar_overdrive_ready');
    advance(server);
    expect(match.phase).toBe('countdown');
    expect(match.goTick - server.sim.tickCount).toBe(MORTAR_OVERDRIVE_COUNTDOWN_TICKS);
    for (const client of [back, ...clients.slice(1)]) {
      const mirrored = lobbyOf(client);
      expect(mirrored).toMatchObject({
        phase: 'countdown',
        countdownTicks: MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
      });
      expect(mirrored.loading).toBeUndefined();
    }
    // Out of the lobby, a late ready changes nothing.
    command(server, second, 'mortar_overdrive_ready');
    advance(server);
    expect(match.goTick - server.sim.tickCount).toBe(MORTAR_OVERDRIVE_COUNTDOWN_TICKS - 1);
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
    const sender = createMortarOverdriveReadySender();
    const frame = () => {
      const snap = client.sent.filter((f) => f.t === 'snap').at(-1);
      (mirror as unknown as { applySnapshot(f: unknown): void }).applySnapshot(snap);
      stepMortarOverdriveReady(sender, mirror.mortarOverdriveInfo, { settled: true }, () =>
        mirror.readyMortarOverdrive(),
      );
    };
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    const seatTick = server.sim.tickCount;
    frame();
    expect(sent).toEqual(['mortar_overdrive_ready']);
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
    expect(sent).toEqual(['mortar_overdrive_ready', 'mortar_overdrive_ready']);
    expect(server.sim.tickCount - seatTick).toBeLessThan(3 * TICK_RATE);
  });

  it('dispatches recovery, routes its silent snap event, and mirrors the movement lock', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    const racer = server.sim.entities.get(session.pid);
    if (!racer) throw new Error('missing racer');
    const progress = match.progress.get(session.pid);
    if (!progress) throw new Error('missing racer progress');
    const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
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

    command(server, session, 'mortar_overdrive_reset');
    advance(server);

    // groundPos may resolve the horizontal sample onto a nearby terrain
    // triangle; the recovery still lands at the authored track anchor.
    expect(Math.hypot(racer.pos.x - anchorX, racer.pos.z - anchorZ)).toBeLessThan(0.2);
    expect(events(client, 'mortarOverdriveReset')).toHaveLength(1);
    expect(selfFields(client, 'mo').at(-1)).toMatchObject({ match: { resetLocked: true } });
    expect(selfFields(client, 'drv').at(-1)).toMatchObject({ lk: 1 });
  });

  it('mirrors the taken pickup boxes onto the online client', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    expect(selfFields(client, 'mo').at(-1)).toMatchObject({ match: { pickupsTaken: [] } });

    // Onto a box of the second row, on this practice lane's own copy of the
    // circuit. Taking one is a consequence of POSITION, so there is no command
    // to send: the server decides it inside the tick.
    const box = mortarOverdrivePickupBoxes(GARDEN_CIRCUIT)[4];
    const racer = server.sim.entities.get(session.pid);
    const progress = match.progress.get(session.pid);
    if (!racer || !progress) throw new Error('missing racer');
    racer.pos.x = match.origin.x + box.x;
    racer.pos.z = match.origin.z + box.z;
    racer.prevPos = { ...racer.pos };
    const projection = mortarOverdriveTrack(GARDEN_CIRCUIT).project(box.x, box.z);
    progress.lastS = projection.s;
    progress.trackIndex = projection.index;
    advance(server);

    const mirrored = selfFields(client, 'mo').at(-1) as {
      match: { pickupsTaken: number[] };
    };
    expect(mirrored.match.pickupsTaken).toContain(4);
    // And the mirror really decodes it: the offline Sim and the online
    // ClientWorld hand presentation the same field, which is what the boxes'
    // renderer reads.
    const world = bareClient(session.pid);
    const snap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(snap);
    expect(world.mortarOverdriveInfo.match?.pickupsTaken).toEqual(
      server.sim.mortarOverdriveInfoFor(session.pid).match?.pickupsTaken,
    );
    expect(world.mortarOverdriveInfo.match?.pickupsTaken).toContain(4);
  });

  it('mirrors EVERY held effect at once, not just the first', () => {
    // The seat report of 2026-08-05, and the second instance of this exact bug
    // class: the kit flag carried ONE held effect (`known[1]`), so a racer
    // holding two had the second silently dropped between the sim and the bar.
    // In game that read as "/dev overdrivekit does not give me the slick" while the
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
      command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
      advance(server);
      const match = server.sim.mortarOverdrive.practices[0];
      if (!match) throw new Error('missing practice match');
      match.phase = 'racing';

      // Both slots stocked, the way the dev grant leaves them.
      expect(server.sim.ctx.mortarOverdriveDevGrantKit(session.pid, 50)).toBe(true);
      advance(server);

      const kit = selfFields(client, 'mokit').at(-1) as { h?: string[] };
      expect(kit.h).toEqual(['nitro', 'slick']);

      // And the mirror's OWN kit surface carries both, which is what the action
      // bar reads: replay every frame, since the kit flag rides a wireRev gate.
      const mirror = bareClient(session.pid);
      for (const frame of client.sent.filter((sent) => sent.t === 'snap')) {
        (mirror as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(frame);
      }
      const known = mirror.known.map((entry) => entry.def.id);
      expect(known).toContain(MORTAR_OVERDRIVE_SLICK_ABILITY_ID);
      expect(known).toContain(MORTAR_OVERDRIVE_NITRO_ABILITY_ID);
      // Carrying the server's real counts, not a hardcoded single charge: the
      // badge a pilot reads has to be the stack they actually hold.
      expect(
        mirror.known.find((entry) => entry.def.id === MORTAR_OVERDRIVE_SLICK_ABILITY_ID)?.charges,
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
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    expect(selfFields(client, 'mo').at(-1)).toMatchObject({
      match: { slicks: [], warded: false },
    });

    // Every take on this lane draws the OIL, whoever makes it: the three house
    // pilots are driving the same circuit and a race is not a laboratory, so the
    // stream is scripted rather than the field being frozen.
    const rng = installScriptedRng(server.sim);
    rng.script(
      ...Array.from({ length: 12 }, () => mortarOverdrivePickupRollFor('leader', 'slick')),
    );
    const box = mortarOverdrivePickupBoxes(GARDEN_CIRCUIT)[4];
    const racer = server.sim.entities.get(session.pid);
    const progress = match.progress.get(session.pid);
    if (!racer || !progress) throw new Error('missing racer');
    racer.pos.x = match.origin.x + box.x;
    racer.pos.z = match.origin.z + box.z;
    racer.prevPos = { ...racer.pos };
    const projection = mortarOverdriveTrack(GARDEN_CIRCUIT).project(box.x, box.z);
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
    expect(selfFields(client, 'mokit').at(-1)).toMatchObject({ h: ['slick'] });
    // The seat report of 2026-08-04: the wire carried `h` and the button never
    // appeared, because the decode re-fed the EFFECT NAME to a mapper whose
    // domain is ability ids and rebuilt the kit with `held: null`. While the
    // effect is held, the held ability must be in the mirror's OWN kit surface
    // (`known`, exactly what the action bar reads), which means replaying every
    // frame the session received so far, including the one carrying `mokit.h`.
    const heldMirror = bareClient(session.pid);
    for (const frame of client.sent.filter((sent) => sent.t === 'snap')) {
      (heldMirror as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(frame);
    }
    expect(heldMirror.known.map((known) => known.def.id)).toContain(
      MORTAR_OVERDRIVE_SLICK_ABILITY_ID,
    );
    command(server, session, 'cast', { ability: MORTAR_OVERDRIVE_SLICK_ABILITY_ID });
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
    expect(world.mortarOverdriveInfo.match?.slicks).toEqual(
      server.sim.mortarOverdriveInfoFor(session.pid).match?.slicks,
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
    wardRng.script(mortarOverdrivePickupRollFor('leader', 'ward'));
    // Every box back on the circuit, so the one below is certainly there: which
    // boxes the house pilots have collected is not what this case is about.
    match.pickups.taken.fill(false);
    const wardBox = mortarOverdrivePickupBoxes(GARDEN_CIRCUIT)[5];
    serverRacer.pos.x = match.origin.x + wardBox.x;
    serverRacer.pos.z = match.origin.z + wardBox.z;
    serverRacer.prevPos = { ...serverRacer.pos };
    const wardProjection = mortarOverdriveTrack(GARDEN_CIRCUIT).project(wardBox.x, wardBox.z);
    progressAfter.lastS = wardProjection.s;
    progressAfter.trackIndex = wardProjection.index;
    advance(server);
    expect(wardRng.consumed).toBe(1);
    expect(serverRacer.auras.some((aura) => aura.id === MORTAR_OVERDRIVE_WARD_AURA)).toBe(true);

    const wardedSnap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (world as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(wardedSnap);
    expect(world.mortarOverdriveInfo.match?.warded).toBe(true);
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
    expect(seen.map((aura) => aura.id)).toContain(MORTAR_OVERDRIVE_WARD_AURA);
    // Rounded to the hundredth of a yard by the shared readout builder, which is
    // where BOTH hosts do it: the mirror carries exactly what the offline Sim
    // would have handed presentation, to the byte.
    // The race tick it dries up on rides with it, for the own-kart prediction.
    expect(world.mortarOverdriveInfo.match?.slicks).toContainEqual({
      id: dropped.id,
      x: Math.round(dropped.x * 100) / 100,
      z: Math.round(dropped.z * 100) / 100,
      endsAt: dropped.expiresTick - match.goTick,
    });
  });
});

describe('Mortar Overdrive net decode siblings', () => {
  it('decodes a drive record into a fresh object, with defaults for sparse keys', () => {
    const drv = { k: 'mo_loaner', sp: 12, lk: 1 };
    const drive = decodeDriveWire(drv);
    expect(drive).toEqual({
      profileKey: 'mo_loaner',
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
    expect(decodeMortarOverdriveKit(prior, undefined)).toBe(prior);
    expect(decodeMortarOverdriveKit(prior, null)).toBeNull();
    expect(decodeMortarOverdriveKit(prior, { active: false })).toBeNull();
    expect(
      decodeMortarOverdriveKit(null, {
        active: true,
        w: 'mortar_overdrive_ground_blast',
        c: 3,
        h: ['slick', 'bogus'],
      }),
    ).toEqual({ abilityId: 'mortar_overdrive_ground_blast', charges: 3, held: ['slick'] });
  });

  it('stamps the kit pools fixed and resolves the kit, or keeps the class list', () => {
    const presentation = [{ id: 'class_ability' }] as unknown as Parameters<
      typeof mortarOverdriveKnownOr
    >[2];
    const e = {
      abilityCharges: {
        mortar_overdrive_ground_blast: {
          charges: 2,
          maxCharges: 3,
          recharge: 0,
          rechargeLength: 0,
        },
        mortar_overdrive_oil_slick: { charges: 1, maxCharges: 1, recharge: 0, rechargeLength: 0 },
      },
    } as unknown as Parameters<typeof mortarOverdriveKnownOr>[1];
    expect(mortarOverdriveKnownOr(null, e, presentation)).toBe(presentation);
    const known = mortarOverdriveKnownOr(
      { abilityId: 'mortar_overdrive_ground_blast', charges: 3, held: ['slick'] },
      e,
      presentation,
    );
    expect(known.map((k) => k.def.id)).toEqual([
      'mortar_overdrive_ground_blast',
      'mortar_overdrive_oil_slick',
    ]);
    expect(e?.abilityCharges?.mortar_overdrive_ground_blast?.fixed).toBe(true);
    expect(e?.abilityCharges?.mortar_overdrive_oil_slick?.fixed).toBe(true);
  });
});

describe('Mortar Overdrive server wire siblings', () => {
  it('encodes a drive record sparsely, in its wire key order', () => {
    const drive = {
      profileKey: 'mo_loaner',
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
      '{"k":"mo_loaner","sp":12.35,"sl":0,"yr":0.5,"sn":0,"hb":0,"g":1,"dg":1,"c":1,"sc":1}',
    );
    expect(
      JSON.stringify(
        driveWire({ ...drive, steerAngle: -0.5, collisionImpact: 0.5, controlsLocked: true }),
      ),
    ).toBe(
      '{"k":"mo_loaner","sp":12.35,"sl":0,"yr":0.5,"st":-0.5,"sn":0,"hb":0,"g":1,"dg":1,"c":1,"sc":1,"ci":0.5,"lk":1}',
    );
  });

  it('splits the heat readout into a still mo and a per-tick moc, within named bounds', () => {
    // The worst case one pilot's readout can reach: a full grid with names at
    // the 16-character cap, every box taken and the oil at its cap, a ward up.
    const server = new GameServer();
    const names = ['Aaaaaaaaaaaaaaaa', 'Bbbbbbbbbbbbbbbb', 'Cccccccccccccccc', 'Dddddddddddddddd'];
    const sessions = names.map((name, i) => join(server, fakeClient(), i + 1, name));
    for (const session of sessions) command(server, session, 'mortar_overdrive_join');
    advance(server);
    const match = server.sim.mortarOverdrive.match;
    if (!match) throw new Error('no heat');
    match.phase = 'racing';
    for (let i = 0; i < MORTAR_OVERDRIVE_SLICK_CAP; i++) {
      match.slicks.push({
        id: 1000 + i,
        x: 113_712.345 + i * 7.77,
        z: match.origin.z - 123.456 + i * 9.13,
        ownerPid: sessions[0].pid,
        // Dropped on the race's last tick: the longest `endsAt` a patch carries.
        ownerClear: true,
        expiresTick: match.deadlineTick + MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS,
      });
    }
    match.pickups.taken = match.pickups.taken.map(() => true);
    const pilot = server.sim.entities.get(sessions[0].pid);
    if (!pilot?.drive) throw new Error('no machine');
    server.sim.ctx.applyAura(pilot, {
      id: MORTAR_OVERDRIVE_WARD_AURA,
      name: 'Racing Ward',
      kind: 'mortar_overdrive_ward',
      remaining: MORTAR_OVERDRIVE_WARD_AURA_SECONDS,
      duration: MORTAR_OVERDRIVE_WARD_AURA_SECONDS,
      value: 0,
      sourceId: pilot.id,
      school: 'physical',
    });
    advance(server);
    pilot.drive.speed = 47.123456789;
    const info = server.sim.mortarOverdriveInfoFor(sessions[0].pid);
    expect(info.match?.slicks).toHaveLength(MORTAR_OVERDRIVE_SLICK_CAP);
    expect(info.match?.wardIn).toBeGreaterThan(0);
    const { still, clock } = splitMortarOverdriveInfo(info);
    // The still half: four 16-character standings rows plus `me`, the
    // circuit's boxes and MORTAR_OVERDRIVE_SLICK_CAP hundredth-rounded patches.
    // Measured 1939 bytes, 224 of them the patches' `endsAt` (the owner has
    // left them all by now, so no `immunePid`); the old single `mo` (clocks
    // and a full-precision speed included, no `endsAt`) measured 1850 and
    // shipped on EVERY racing tick, while this half ships only when it changes.
    const RR_STILL_BOUND = 2050;
    // The clock half: nine scalars, the speed in hundredths, shipped per tick.
    // Measured 129 bytes here; a late-race clock adds a few digits.
    const RR_CLOCK_BOUND = 160;
    expect(JSON.stringify(still).length).toBeLessThanOrEqual(RR_STILL_BOUND);
    expect(JSON.stringify(clock).length).toBeLessThanOrEqual(RR_CLOCK_BOUND);
    expect(clock?.speed).toBe(47.12);
    expect(still.match).not.toHaveProperty('speed');
    expect(still.match).not.toHaveProperty('elapsedTicks');
    expect(mergeMortarOverdriveInfo(still, clock)).toEqual(info);
  });

  it('ships moc every racing tick, mo only on a real change, and the mirror equals the sim', () => {
    const server = new GameServer();
    const names = ['Aster', 'Briar', 'Cass', 'Dell'];
    const clients = names.map(() => fakeClient());
    const sessions = names.map((name, i) => join(server, clients[i], i + 1, name));
    for (const session of sessions) command(server, session, 'mortar_overdrive_join');
    advance(server);
    for (const session of sessions) command(server, session, 'mortar_overdrive_ready');
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS + 2; i++) advance(server);
    expect(server.sim.mortarOverdrive.match?.phase).toBe('racing');
    const meta = server.sim.players.get(sessions[0].pid);
    if (!meta) throw new Error('no pilot');
    const client = bareClient(sessions[0].pid);
    for (const frame of clients[0].sent.filter((f) => f.t === 'snap')) {
      (client as unknown as { applySnapshot(snap: unknown): void }).applySnapshot(frame);
    }
    clients[0].sent.length = 0;
    const TICKS = 40;
    for (let i = 0; i < TICKS; i++) {
      meta.moveInput.forward = true;
      advance(server);
      const snap = clients[0].sent.filter((f) => f.t === 'snap').at(-1);
      (client as unknown as { applySnapshot(snap: unknown): void }).applySnapshot(snap);
      expect(client.mortarOverdriveInfo, `tick ${i}`).toEqual(
        server.sim.mortarOverdriveInfoFor(sessions[0].pid),
      );
    }
    expect(selfFields(clients[0], 'moc')).toHaveLength(TICKS);
    expect(selfFields(clients[0], 'mo').length).toBeLessThan(TICKS / 4);
  });

  it('builds the idle mo once per pass for every idle viewer, and ships it raw', () => {
    // Most viewers are neither queued nor seated, and their readout is one
    // value for all of them: one build and one stringify per broadcast pass.
    const server = new GameServer();
    const idle = ['Eira', 'Finn', 'Gale', 'Hale', 'Ivo'].map((name, i) => {
      const client = fakeClient();
      return { client, session: join(server, client, 10 + i, name) };
    });
    const queuedClient = fakeClient();
    const queued = join(server, queuedClient, 20, 'Juno');
    command(server, queued, 'mortar_overdrive_join');
    const memo = mortarOverdriveIdleReadout(server.sim);
    const builds = vi.spyOn(server.sim, 'mortarOverdriveInfoFor');
    advance(server);
    // One build serves all five idle viewers; the queued one builds its own.
    expect(builds).toHaveBeenCalledTimes(2);
    expect(memo.objectBuilds).toBe(1);
    expect(memo.stringifies).toBe(1);
    for (const { client, session } of idle) {
      const sent = client.sent.filter((f) => f.t === 'snap').at(-1) as { self: { mo: unknown } };
      // Byte-identical to the per-viewer build it replaces.
      expect(JSON.stringify(sent.self.mo)).toBe(
        JSON.stringify(server.sim.mortarOverdriveInfoFor(session.pid)),
      );
      expect((sent.self as { moc?: unknown }).moc).toBeNull();
    }
    const queuedRr = selfFields(queuedClient, 'mo').at(-1) as { queued: boolean };
    expect(queuedRr.queued).toBe(true);
    // An unchanged pass elides the key for every idle viewer, a changed queue
    // reaches them on the next pass with one fresh build.
    for (const { client } of idle) client.sent.length = 0;
    advance(server);
    expect(memo.objectBuilds).toBe(2);
    for (const { client } of idle) expect(selfFields(client, 'mo')).toEqual([]);
    command(server, idle[0].session, 'mortar_overdrive_join');
    advance(server);
    expect(selfFields(idle[1].client, 'mo').at(-1)).toMatchObject({ queued: false, queueSize: 2 });
    expect(selfFields(idle[0].client, 'mo').at(-1)).toMatchObject({ queued: true, queueSize: 2 });
    builds.mockRestore();
  });

  it('emits mo then mot, and the kit with its held list or an explicit null', () => {
    const keys: [string, unknown][] = [];
    const maybe = (key: string, value: unknown) => keys.push([key, value]);
    const idle = { queued: true, match: null };
    emitMortarOverdriveSelfKeys(
      maybe,
      () => {
        throw new Error('a queued viewer builds its own readout');
      },
      {
        ctx: { mortarOverdrive: { queue: [7], match: null, practices: [] }, entities: new Map() },
        tickCount: 1,
        mortarOverdriveInfoFor: () => idle,
      } as never,
      7,
    );
    const weapon = { def: { id: 'mortar_overdrive_ground_blast' }, charges: 3 };
    const slick = { def: { id: 'mortar_overdrive_oil_slick' } };
    emitMortarOverdriveKitKey(maybe, {
      mortarOverdriveMatchId: 1,
      known: [weapon, slick],
    } as never);
    emitMortarOverdriveKitKey(maybe, { mortarOverdriveMatchId: 1, known: [weapon] } as never);
    emitMortarOverdriveKitKey(maybe, { mortarOverdriveMatchId: null, known: [weapon] } as never);
    expect(keys).toEqual([
      ['mo', idle],
      ['moc', null],
      ['mot', null],
      ['mokit', { active: true, w: 'mortar_overdrive_ground_blast', c: 3, h: ['slick'] }],
      ['mokit', { active: true, w: 'mortar_overdrive_ground_blast', c: 3 }],
      ['mokit', null],
    ]);
  });
});

describe('the recovery ghost online', () => {
  it('rides the entity aura wire to a rival and onto the pilot own mirror', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    const racer = server.sim.entities.get(session.pid);
    if (!racer) throw new Error('missing racer');
    expect(mortarOverdriveGhosted(racer)).toBe(false);

    // The ordinary manual recovery command, through the server's own dispatch.
    command(server, session, 'mortar_overdrive_reset');
    expect(mortarOverdriveGhosted(racer)).toBe(true);

    const rivalClient = fakeClient();
    const rivalSession = join(server, rivalClient, 2, 'Briar');
    const rivalEntity = server.sim.entities.get(rivalSession.pid);
    if (!rivalEntity) throw new Error('missing rival');
    rivalEntity.pos = { ...racer.pos, x: racer.pos.x + 3 };
    rivalEntity.prevPos = { ...rivalEntity.pos };
    advance(server);
    expect(mortarOverdriveGhosted(racer)).toBe(true);

    // A rival reads it off the ordinary entity rows...
    const seen = rivalClient.sent
      .filter((frame) => frame.t === 'snap')
      .flatMap((frame) => (frame.ents as { id: number; auras?: { id: string }[] }[]) ?? [])
      .filter((row) => row.id === session.pid)
      .flatMap((row) => row.auras ?? []);
    expect(seen.map((aura) => aura.id)).toContain(MORTAR_OVERDRIVE_GHOST_AURA);
    // ...and the mirror hands presentation a ghosted entity, which is what the
    // veil and the local bump gate read.
    const rivalWorld = bareClient(rivalSession.pid);
    const rivalSnap = rivalClient.sent.filter((frame) => frame.t === 'snap').at(-1);
    (rivalWorld as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(rivalSnap);
    expect(mortarOverdriveGhosted(rivalWorld.entities.get(session.pid))).toBe(true);
    // The pilot's own mirror carries it too, so the local kart draws the veil.
    const ownWorld = bareClient(session.pid);
    const ownSnap = client.sent.filter((frame) => frame.t === 'snap').at(-1);
    (ownWorld as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(ownSnap);
    expect(mortarOverdriveGhosted(ownWorld.entities.get(session.pid))).toBe(true);
  });
});

describe('the ward online', () => {
  it('runs out on every mirror ten seconds after the take: the pilot own and a rival', () => {
    const server = new GameServer();
    const client = fakeClient();
    const session = join(server, client, 1, 'Aster');
    command(server, session, 'mortar_overdrive_practice', { tier: 'rookie' });
    advance(server);
    const match = server.sim.mortarOverdrive.practices[0];
    if (!match) throw new Error('missing practice match');
    match.phase = 'racing';
    advance(server);
    const racer = server.sim.entities.get(session.pid);
    const progress = match.progress.get(session.pid);
    if (!racer || !progress) throw new Error('missing racer');

    // A rival standing beside the machine, so the racer is in its interest set.
    const rivalClient = fakeClient();
    const rivalSession = join(server, rivalClient, 2, 'Briar');
    const rivalEntity = server.sim.entities.get(rivalSession.pid);
    if (!rivalEntity) throw new Error('missing rival');

    // Granted through the real path: a scripted ward draw at a box.
    const rng = installScriptedRng(server.sim);
    rng.script(mortarOverdrivePickupRollFor('leader', 'ward'));
    const box = mortarOverdrivePickupBoxes(GARDEN_CIRCUIT)[4];
    racer.pos.x = match.origin.x + box.x;
    racer.pos.z = match.origin.z + box.z;
    racer.prevPos = { ...racer.pos };
    rivalEntity.pos = { ...racer.pos, x: racer.pos.x + 3 };
    rivalEntity.prevPos = { ...rivalEntity.pos };
    const projection = mortarOverdriveTrack(GARDEN_CIRCUIT).project(box.x, box.z);
    progress.lastS = projection.s;
    progress.trackIndex = projection.index;
    advance(server);
    expect(rng.consumed).toBe(1);
    expect(mortarOverdriveWarded(racer)).toBe(true);
    const grantedAt = server.sim.tickCount;

    // Both mirrors replay every frame they were sent, in order, the way a live
    // client does; nothing but the wire tells them the ward is gone.
    const ownWorld = bareClient(session.pid);
    const rivalWorld = bareClient(rivalSession.pid);
    let ownRead = 0;
    let rivalRead = 0;
    const catchUp = (): void => {
      const own = client.sent.filter((frame) => frame.t === 'snap');
      for (; ownRead < own.length; ownRead++) {
        (ownWorld as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(
          own[ownRead],
        );
      }
      const rival = rivalClient.sent.filter((frame) => frame.t === 'snap');
      for (; rivalRead < rival.length; rivalRead++) {
        (rivalWorld as unknown as { applySnapshot(frame: unknown): void }).applySnapshot(
          rival[rivalRead],
        );
      }
    };
    const wardOn = (world: ClientWorld) =>
      world.entities.get(session.pid)?.auras.find((aura) => aura.id === MORTAR_OVERDRIVE_WARD_AURA);
    catchUp();
    // The clock rides the ordinary aura wire: a rival reads the same ten
    // seconds the pilot does, not a mode with no end.
    for (const world of [ownWorld, rivalWorld]) {
      const seen = wardOn(world);
      expect(seen?.duration).toBe(MORTAR_OVERDRIVE_WARD_AURA_SECONDS);
      expect(seen?.remaining).toBeGreaterThan(MORTAR_OVERDRIVE_WARD_AURA_SECONDS - 0.5);
      expect(seen?.remaining).toBeLessThanOrEqual(MORTAR_OVERDRIVE_WARD_AURA_SECONDS);
    }
    expect(ownWorld.mortarOverdriveInfo.match?.warded).toBe(true);

    // Keep the rival beside the racer while the clock runs down, whatever the
    // machine does meanwhile.
    const wardTicks = MORTAR_OVERDRIVE_WARD_AURA_SECONDS * TICK_RATE;
    const runTo = (tick: number): void => {
      while (server.sim.tickCount < tick) {
        rivalEntity.pos = { ...racer.pos, x: racer.pos.x + 3 };
        rivalEntity.prevPos = { ...rivalEntity.pos };
        advance(server);
      }
    };
    // Eight and a half seconds in: both mirrors read the ward as ending (the
    // input the pulsing veil keys on) and the pilot's strip counts 2.
    runTo(grantedAt + (17 * TICK_RATE) / 2);
    catchUp();
    for (const world of [ownWorld, rivalWorld]) {
      const seen = wardOn(world);
      expect(seen?.remaining).toBeCloseTo(1.5, 5);
      expect(characterVeilboundState(world.entities.get(session.pid) as Entity)).toBe(
        'ward-ending',
      );
    }
    expect(ownWorld.mortarOverdriveInfo.match?.wardIn).toBe(2);
    runTo(grantedAt + wardTicks - 1);
    catchUp();
    expect(mortarOverdriveWarded(racer)).toBe(true);
    expect(wardOn(rivalWorld)).toBeDefined();
    expect(wardOn(ownWorld)).toBeDefined();

    rivalEntity.pos = { ...racer.pos, x: racer.pos.x + 3 };
    rivalEntity.prevPos = { ...rivalEntity.pos };
    advance(server);
    expect(server.sim.tickCount).toBe(grantedAt + wardTicks);
    expect(mortarOverdriveWarded(racer)).toBe(false);
    catchUp();
    expect(wardOn(rivalWorld)).toBeUndefined();
    expect(wardOn(ownWorld)).toBeUndefined();
    expect(ownWorld.mortarOverdriveInfo.match?.warded).toBe(false);
    expect(ownWorld.mortarOverdriveInfo.match).not.toHaveProperty('wardIn');
    // The pilot is told the aura faded, as for any other buff; nothing broke it.
    expect(events(client, 'aura')).toContainEqual(
      expect.objectContaining({ targetId: session.pid, name: 'Racing Ward', gained: false }),
    );
    expect(events(client, 'mortarOverdriveWardBroken')).toEqual([]);
  });
});
