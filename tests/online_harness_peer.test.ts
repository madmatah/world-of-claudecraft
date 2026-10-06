import { afterEach, describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the same factory as
// tests/mortar_overdrive_v2_prediction.test.ts.
const calls = vi.hoisted(() => ({ consume: [] as number[][], epochs: [] as number[][] }));
vi.mock('../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  saveCharacterAndMarketState: vi.fn(async () => {}),
  saveMarketState: vi.fn(async () => {}),
  saveMailState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  walletForAccount: vi.fn(async () => null),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  revokeAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  acquireCharacterLease: vi.fn(async () => true),
  releaseCharacterLease: vi.fn(async () => {}),
  heartbeatCharacterLeases: vi.fn(async () => {}),
  releaseAllCharacterLeases: vi.fn(async () => {}),
  insertBankLedgerRow: vi.fn(async () => {}),
  loadMarketState: vi.fn(async () => null),
  loadMailState: vi.fn(async () => null),
  loadRiftState: vi.fn(async () => null),
  saveRiftState: vi.fn(async () => {}),
  loadGuildBankRow: vi.fn(async () => null),
  loadGuildBankRows: vi.fn(async () => []),
  saveCharacterAndGuildBankState: vi.fn(async () => {}),
  GUILD_BANK_ROW_MAX_BYTES: 262144,
}));

// The two per-tick session walks the harness drives, wrapped to record which
// sessions each call was handed and in what order; the real code still runs.
vi.mock('../server/movement_input_timeline_v2', async (importOriginal) => {
  const real = await importOriginal<typeof import('../server/movement_input_timeline_v2')>();
  return {
    ...real,
    consumeMovementFramesV2: (...args: Parameters<typeof real.consumeMovementFramesV2>) => {
      const sessions = [...args[1]];
      calls.consume.push(sessions.map((s) => (s as { pid: number }).pid));
      return real.consumeMovementFramesV2(args[0], sessions);
    },
  };
});
vi.mock('../server/movement_override_epoch', async (importOriginal) => {
  const real = await importOriginal<typeof import('../server/movement_override_epoch')>();
  return {
    ...real,
    updateMovementOverrideEpochs: (
      ...args: Parameters<typeof real.updateMovementOverrideEpochs>
    ) => {
      const sessions = [...args[1]];
      calls.epochs.push(sessions.map((s) => (s as { pid: number }).pid));
      return real.updateMovementOverrideEpochs(args[0], sessions);
    },
  };
});

import type { LatencyLinkConfig } from './helpers/latency_link';
import { createOnlineHarness, type OnlineHarness, SERVER_TICK_MS } from './helpers/online_harness';

// addPeer: a second client on the harness's server, over its own link, with
// its own frame pipeline on the shared clock.

const LINK: LatencyLinkConfig = {
  toServer: { baseMs: 40, jitterMs: 5, seed: 11 },
  toClient: { baseMs: 40, jitterMs: 5, seed: 12 },
};
const PEER_LINK: LatencyLinkConfig = {
  toServer: { baseMs: 90, jitterMs: 5, seed: 21 },
  toClient: { baseMs: 90, jitterMs: 5, seed: 22 },
};

let open: OnlineHarness | null = null;
afterEach(() => {
  open?.dispose();
  open = null;
  calls.consume.length = 0;
  calls.epochs.length = 0;
});

describe('online harness: addPeer', () => {
  it('walks every session in join order, and the peer drives its own machine', () => {
    const h = createOnlineHarness({ latency: LINK });
    open = h;
    expect(calls.consume.length).toBeGreaterThan(0);
    for (const walk of [...calls.consume, ...calls.epochs]) expect(walk).toEqual([h.pid]);
    calls.consume.length = 0;
    calls.epochs.length = 0;
    const peer = h.addPeer({ latency: PEER_LINK, characterId: 2 });
    expect(peer.pid).not.toBe(h.pid);
    expect(peer.client).not.toBe(h.client);
    expect(peer.link).not.toBe(h.link);
    // Warmup is 1000 ms: one walk of each kind per server tick, both sessions.
    expect(calls.consume).toHaveLength(1000 / SERVER_TICK_MS);
    expect(calls.epochs).toHaveLength(1000 / SERVER_TICK_MS);
    for (const walk of [...calls.consume, ...calls.epochs]) expect(walk).toEqual([h.pid, peer.pid]);
    // The peer's mirror is synced, and its own held keys move its own machine.
    expect(peer.client.entities.has(peer.client.playerId)).toBe(true);
    const start = { ...peer.serverEntity.pos };
    const primaryStart = { ...h.serverEntity.pos };
    let frames = 0;
    peer.onFrame(() => frames++);
    peer.holdIntent({ forward: true });
    h.clock.advanceTo(h.clock.now() + 1000);
    expect(frames).toBeGreaterThan(50);
    expect(
      Math.hypot(peer.serverEntity.pos.x - start.x, peer.serverEntity.pos.z - start.z),
    ).toBeGreaterThan(3);
    expect(h.serverEntity.pos).toEqual(primaryStart);
  });

  it('refuses a character that is already joined', () => {
    const h = createOnlineHarness({ latency: LINK });
    open = h;
    expect(() => h.addPeer({ latency: PEER_LINK, characterId: 1 })).toThrow(/already joined/);
    h.addPeer({ latency: PEER_LINK, characterId: 2 });
    expect(() => h.addPeer({ latency: PEER_LINK, characterId: 2 })).toThrow(/already joined/);
  });

  it('refuses a warmup that is not a whole server tick', () => {
    const h = createOnlineHarness({ latency: LINK });
    open = h;
    const before = h.clock.now();
    expect(() => h.addPeer({ latency: PEER_LINK, characterId: 2, warmupMs: 30 })).toThrow(
      /whole server tick/,
    );
    expect(h.clock.now()).toBe(before);
  });

  it('keeps the primary WebSocket stub installed, and dispose puts the original back', () => {
    const globals = globalThis as Record<string, unknown>;
    const original = globals.WebSocket;
    const h = createOnlineHarness({ latency: LINK });
    open = h;
    const primaryStub = globals.WebSocket;
    expect(primaryStub).not.toBe(original);
    h.addPeer({ latency: PEER_LINK, characterId: 2 });
    expect(globals.WebSocket).toBe(primaryStub);
    h.dispose();
    open = null;
    expect(globals.WebSocket).toBe(original);
  });
});
