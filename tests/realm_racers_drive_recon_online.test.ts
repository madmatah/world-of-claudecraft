import { beforeAll, describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the union of the online harness suites'
// superset and the Realm Racers online suite's.
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

import { wireEntity } from '../server/game';
import type { VehicleDrive } from '../src/sim/types';
import type { LatencyLinkConfig } from './helpers/latency_link';
import { createRacerHarness } from './helpers/racer_harness';

// The drive recon (`rdv`) on the REAL online path: every self snapshot a v2
// racer's client decodes must hand it the server's drive state at the
// acknowledged tick, bit for bit, over a whole scripted race. The prediction
// stays stood down for the driver while the drive-aware replay is off, even
// though the recon is now on the wire.

const RACE_MS = 3000;

function link(rttMs: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed: 1337 },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: 4242 },
  };
}

interface ServerSample {
  ackCt: number;
  drive: VehicleDrive;
  vy: number;
  onGround: boolean;
  drvBytes: number;
}

interface Decoded {
  tick: number;
  ackCt: number;
  drive: VehicleDrive | null;
  mirror: VehicleDrive | null;
  vy: number;
  onGround: boolean;
  rdvBytes: number;
  hasDrv: boolean;
}

/** Field-wise ===, so a signed zero the JSON carried as +0 still matches; the
 *  scrape reading crosses only above 0.01 (the kernel never reads it). */
function sameDrive(server: VehicleDrive, got: VehicleDrive | null): boolean {
  if (!got) return false;
  const ci = server.collisionImpact > 0.01 ? server.collisionImpact : 0;
  return (
    got.profileKey === server.profileKey &&
    got.speed === server.speed &&
    got.slip === server.slip &&
    got.steerAngle === server.steerAngle &&
    got.yawRate === server.yawRate &&
    got.spin === server.spin &&
    got.handbrake === server.handbrake &&
    got.gripMult === server.gripMult &&
    got.dragMult === server.dragMult &&
    got.speedCap === server.speedCap &&
    got.slipCap === server.slipCap &&
    got.collisionImpact === ci &&
    got.controlsLocked === server.controlsLocked
  );
}

describe('the drive recon over a 3 s race on movement wire v2 (120 ms RTT)', () => {
  const server = new Map<number, ServerSample>();
  const decoded: Decoded[] = [];
  const racingFrames: { predictorActive: boolean; reconDrive: boolean }[] = [];

  beforeAll(() => {
    const rh = createRacerHarness({ latency: link(120, 10) });
    try {
      const { harness } = rh;
      const { client } = harness;
      rh.seat();
      rh.advanceToGo();
      let popPending = false;
      harness.onServerTick(() => {
        const e = harness.serverEntity;
        if (!e.drive) return;
        if (popPending) {
          popPending = false;
          e.vy = 6.5;
          e.onGround = false;
        }
        server.set(harness.server.sim.tickCount, {
          ackCt: harness.session.lastConsumedCt,
          drive: { ...e.drive },
          vy: e.vy,
          onGround: e.onGround,
          drvBytes: JSON.stringify(wireEntity(e).drv).length,
        });
      });
      const target = client as unknown as { applySnapshot(snap: unknown): void };
      const apply = target.applySnapshot.bind(client);
      target.applySnapshot = (snap: unknown) => {
        apply(snap);
        const s = snap as { tick: number; self?: Record<string, unknown> };
        if (!s.self || s.self.rdv === undefined) return;
        decoded.push({
          tick: s.tick,
          ackCt: client.reconAckClientTick,
          drive: client.reconDrive,
          mirror: client.player.drive,
          vy: client.reconVy,
          onGround: client.reconOnGround,
          rdvBytes: `,"rdv":${JSON.stringify(s.self.rdv)}`.length,
          hasDrv: Object.hasOwn(s.self, 'drv'),
        });
      };
      harness.onClientFrame((frame) => {
        racingFrames.push({
          predictorActive: frame.predictorActive,
          reconDrive: client.reconDrive !== null,
        });
      });
      harness.runScript({
        durationMs: RACE_MS,
        script: [
          { atMs: 0, mi: { forward: true }, facing: null },
          { atMs: 800, mi: { turnLeft: true } },
          { atMs: 1400, mi: { turnLeft: false, turnRight: true, jump: true } },
          { atMs: 1900, mi: { jump: false } },
          { atMs: 2400, mi: { turnRight: false } },
        ],
        // A Ground Blast shaped pop, applied after a tick like the blast: the
        // machine flies a few ticks.
        actions: [{ atMs: 2000, run: () => (popPending = true) }],
      });
    } finally {
      rh.dispose();
    }
  });

  it('decodes the server drive at the acknowledged tick on every self snapshot', () => {
    const scored = decoded.filter((d) => server.has(d.tick));
    expect(scored.length).toBeGreaterThanOrEqual(50);
    const mismatched = scored.filter((d) => {
      const at = server.get(d.tick) as ServerSample;
      return (
        d.ackCt !== at.ackCt ||
        !sameDrive(at.drive, d.drive) ||
        !sameDrive(at.drive, d.mirror) ||
        d.vy !== (at.onGround ? 0 : at.vy) ||
        d.onGround !== at.onGround
      );
    });
    expect(mismatched.map((d) => d.tick)).toEqual([]);
    // The race really exercised the state: speed, a turn, the handbrake.
    const drives = scored.map((d) => server.get(d.tick)?.drive as VehicleDrive);
    expect(Math.max(...drives.map((d) => d.speed))).toBeGreaterThan(20);
    expect(drives.some((d) => d.steerAngle !== 0)).toBe(true);
    expect(drives.some((d) => d.handbrake !== 0)).toBe(true);
    expect(scored.filter((d) => !d.onGround).length).toBeGreaterThanOrEqual(3);
  });

  it('never carries the rounded drv beside the recon on the self record', () => {
    expect(decoded.length).toBeGreaterThan(0);
    expect(decoded.filter((d) => d.hasDrv).map((d) => d.tick)).toEqual([]);
  });

  it('keeps the predictor stood down for the driver with the recon on the wire', () => {
    expect(racingFrames.length).toBeGreaterThan(RACE_MS / 20);
    expect(racingFrames.every((f) => f.reconDrive)).toBe(true);
    expect(racingFrames.filter((f) => f.predictorActive)).toEqual([]);
  });

  it('costs about as much as the rounded drive it replaces', () => {
    const bytes = decoded.map((d) => d.rdvBytes).sort((a, b) => a - b);
    const median = bytes[Math.floor(bytes.length / 2)];
    const worst = bytes[bytes.length - 1];
    const drv = [...server.values()].map((s) => s.drvBytes).sort((a, b) => a - b);
    expect(drv[Math.floor(drv.length / 2)]).toBeGreaterThan(90);
    // Measured on this scenario: median 121 B, worst 176 B (airborne), against
    // a dropped `drv` of about 106 B with its key.
    expect(median).toBeLessThanOrEqual(130);
    expect(worst).toBeLessThanOrEqual(190);
  });
});
