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

import { cameraFollowFacing } from '../src/game/camera_follow';
import { adaptiveSelfAlphaLead, SELF_LEAD_MIN } from '../src/game/self_alpha_lead';
import { SELF_RENDER_SMOOTH_RATE, updateSelfRenderFallback } from '../src/render/self_motion';
import { selfSnapshotAlpha } from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { REALM_RACERS_RETURN_TICKS } from '../src/sim/social/realm_racers';
import { DT, RUN_SPEED } from '../src/sim/types';
import type { LatencyLinkConfig } from './helpers/latency_link';
import {
  DEFAULT_FRAME_MS,
  type FrameRecord,
  type HarnessRun,
  SERVER_TICK_MS,
} from './helpers/online_harness';
import { createRacerHarness, parkedPilotReachYd } from './helpers/racer_harness';

// A browser always negotiates movement wire v2, whose self-prediction has no
// drive state: it steps a kart with the runner kernel, and the server's
// override epoch sizes a legal step at run speed, so it bumps nearly every
// tick for a kart. Until the drive-aware wire lands, a seated driver with no
// drive recon on the wire stands prediction down (self_prediction.ts) and is
// drawn by the plain interpolated fallback, the `?nopredict` path.
//
// BEFORE the stand-down (re-measured with the production change reverted),
// this exact scenario (seed, link, script) counted 49 reconcile suspends:
// 0 at the seat, 1 in the countdown, 44 in the 3 s race, and 4 through the
// unseat (3 while the forfeit was in flight, 1 on the return home). The
// predictor owned 69 of the 180 racing frames; 46 of the 170 moving frames
// were drawn ahead of the fallback envelope (by up to 2.27 yd) and 74 trailed
// the mirror by more than one echo (up to 1.6 times the bound): the 20 Hz
// surge-and-snap. The key-timeline and direct-intent runs measured the same.
// After it, every one of those counts is 0.

const RTT_MS = 120;
const RACE_MS = 3000;

function link(rttMs: number, jitterMs: number): LatencyLinkConfig {
  return {
    toServer: { baseMs: rttMs / 2, jitterMs, seed: 1337 },
    toClient: { baseMs: rttMs / 2, jitterMs, seed: 4242 },
  };
}

interface Scenario {
  race: HarnessRun;
  unseat: HarnessRun;
  /** Reconcile suspends counted in each phase of the race. */
  suspends: { seat: number; countdown: number; race: number; unseat: number };
  minParkedGapYd: number;
  /** The largest move-speed multiplier the override epoch sized a legal step
   *  with during the race. */
  maxEpochSpeedMult: number;
  /** Override-epoch bumps across the 3 s race: the server session's and the
   *  one the v2 wire delivered to the client. */
  raceEpochBumps: { server: number; client: number };
  parkedReachYd: number;
  bodyRadiusYd: number;
}

function runScenario(keyTimeline: boolean, movementWire: 1 | 2 = 2): Scenario {
  const rh = createRacerHarness({ latency: link(RTT_MS, 10), keyTimeline, movementWire });
  try {
    const { harness } = rh;
    const suspends = () => harness.reconcileOutcomes().suspends;
    const beforeSeat = suspends();
    rh.seat();
    const afterSeat = suspends();
    rh.advanceToGo();
    const afterGo = suspends();
    const epochs = () => ({
      server: harness.session.movementOverrideEpoch,
      client: harness.client.reconOverrideEpoch,
    });
    const epochsAtGo = epochs();
    const profileKey = harness.serverEntity.drive?.profileKey ?? '';
    const parked = rh.parkedPilots();
    let minParkedGapYd = Number.POSITIVE_INFINITY;
    let maxEpochSpeedMult = 0;
    const unwatch = harness.onServerTick(() => {
      maxEpochSpeedMult = Math.max(maxEpochSpeedMult, harness.session.movementMoveSpeedMult);
      for (const pilot of parked) {
        const gap = Math.hypot(
          harness.serverEntity.pos.x - pilot.x,
          harness.serverEntity.pos.z - pilot.z,
        );
        minParkedGapYd = Math.min(minParkedGapYd, gap);
      }
    });
    const race = harness.runScript({
      durationMs: RACE_MS,
      script: [
        { atMs: 0, mi: { forward: true }, facing: null },
        { atMs: 800, mi: { turnLeft: true } },
        { atMs: 1600, mi: { turnLeft: false, turnRight: true } },
        { atMs: 2400, mi: { turnRight: false } },
      ],
    });
    unwatch();
    const afterRace = suspends();
    const epochsAfterRace = epochs();
    const unseat = harness.runScript({
      durationMs: REALM_RACERS_RETURN_TICKS * SERVER_TICK_MS + 1500,
      script: [{ atMs: 0, mi: { forward: false, turnLeft: false, turnRight: false } }],
      actions: [{ atMs: 0, run: () => harness.client.forfeitRealmRacers() }],
    });
    return {
      race,
      unseat,
      suspends: {
        seat: afterSeat - beforeSeat,
        countdown: afterGo - afterSeat,
        race: afterRace - afterGo,
        unseat: suspends() - afterRace,
      },
      minParkedGapYd,
      maxEpochSpeedMult,
      raceEpochBumps: {
        server: epochsAfterRace.server - epochsAtGo.server,
        client: epochsAfterRace.client - epochsAtGo.client,
      },
      parkedReachYd: parkedPilotReachYd(profileKey),
      bodyRadiusYd: vehicleProfile(profileKey).bodyRadius,
    };
  } finally {
    rh.dispose();
  }
}

interface Excursion {
  tMs: number;
  speed: number;
  echoMs: number;
  aheadYd: number;
  behindYd: number;
  behindBoundYd: number;
}

/**
 * Score each moving racing frame against the fallback's own envelope.
 *
 * AHEAD: the fallback draws `prevPos + (pos - prevPos) * selfSnapshotAlpha`,
 * which is capped at alpha 1.25, then eases toward it with the renderer's
 * exponential smoother (updateSelfRenderFallback). The reference is the SAME
 * smoother fed the mirror extrapolated at the cap, so a frame drawn past it
 * along the direction of travel is a pose no fallback frame could produce.
 *
 * BEHIND: the bound is the plan's echo policy, the ground the machine covers
 * in one measured input echo at the mirror's own speed.
 */
/** The chase-camera heading main.ts composes for this frame's inputs. */
function mainCameraFacing(frame: FrameRecord): number {
  return cameraFollowFacing(
    frame.driving,
    frame.predictedDrivingFacing,
    frame.keyboardFacing,
    frame.serverFacing,
  );
}

function scoreRacingFrames(frames: readonly FrameRecord[]): Excursion[] {
  const reference = { x: 0, y: 0, z: 0 };
  let ready = false;
  const out: Excursion[] = [];
  for (const frame of frames) {
    const stepX = frame.mirrorX - frame.mirrorPrevX;
    const stepZ = frame.mirrorZ - frame.mirrorPrevZ;
    const capAlpha = selfSnapshotAlpha(Number.POSITIVE_INFINITY, 0);
    updateSelfRenderFallback(
      reference,
      frame.mirrorPrevX + stepX * capAlpha,
      frame.mirrorPrevY + (frame.mirrorY - frame.mirrorPrevY) * capAlpha,
      frame.mirrorPrevZ + stepZ * capAlpha,
      ready,
      frame.frameDtSec,
      true,
      false,
    );
    ready = true;
    const stepLength = Math.hypot(stepX, stepZ);
    if (stepLength === 0) continue;
    const ux = stepX / stepLength;
    const uz = stepZ / stepLength;
    const speed = stepLength / DT;
    out.push({
      tMs: frame.tMs,
      speed,
      echoMs: frame.echoMs,
      aheadYd: (frame.x - reference.x) * ux + (frame.z - reference.z) * uz,
      behindYd: (frame.mirrorX - frame.x) * ux + (frame.mirrorZ - frame.z) * uz,
      behindBoundYd: (speed * frame.echoMs) / 1000,
    });
  }
  return out;
}

describe.each([
  { mode: 'key timeline', keyTimeline: true },
  { mode: 'direct intent', keyTimeline: false },
])('a seated racer on movement wire v2 (120 ms RTT, $mode)', ({ keyTimeline }) => {
  let scenario: Scenario;
  let racing: FrameRecord[];
  beforeAll(() => {
    scenario = runScenario(keyTimeline);
    racing = scenario.race.frames;
  });

  it('races the circuit with the house pilots parked out of reach', () => {
    expect(racing.length).toBeGreaterThanOrEqual(Math.floor(RACE_MS / DEFAULT_FRAME_MS));
    expect(racing.every((frame) => frame.driving)).toBe(true);
    // The machine really raced: faster than any step the override epoch reads
    // as a legal run, which is what thrashes the epoch under a kart.
    const peakSpeed = Math.max(
      ...racing.map((f) => Math.hypot(f.mirrorX - f.mirrorPrevX, f.mirrorZ - f.mirrorPrevZ) / DT),
    );
    expect(scenario.maxEpochSpeedMult).toBeGreaterThan(0);
    expect(peakSpeed).toBeGreaterThan(RUN_SPEED * scenario.maxEpochSpeedMult);
    // No rival could have touched it: every parked pilot stayed farther than
    // two bodies plus the ground one tick of rolling covers before re-parking.
    expect(scenario.minParkedGapYd).toBeGreaterThan(
      2 * scenario.bodyRadiusYd + scenario.parkedReachYd,
    );
  });

  it('takes the driving arm: steering on the wire, no heading, the chase camera', () => {
    expect(scenario.race.commands.some((c) => c.mi.turnLeft)).toBe(true);
    expect(scenario.race.commands.some((c) => c.mi.turnRight)).toBe(true);
    expect(racing.filter((frame) => frame.netFacing !== null).map((f) => f.tMs)).toEqual([]);
    expect(racing.filter((frame) => frame.keyboardFacing !== null).map((f) => f.tMs)).toEqual([]);
    const offCamera = racing.filter((frame) => frame.cameraFacing !== mainCameraFacing(frame));
    expect(offCamera.map((frame) => frame.tMs)).toEqual([]);
    // On wire v2 no v1 predictor is ever built, so the camera follows the
    // interpolated server heading (the v1 case below covers the other arm).
    expect(racing.filter((f) => f.predictedDrivingFacing !== null).map((f) => f.tMs)).toEqual([]);
  });

  it('keeps the override epoch flat across the race, on the server and on the wire', () => {
    expect(scenario.raceEpochBumps).toEqual({ server: 0, client: 0 });
  });

  it('never lets the predictor own a racing frame', () => {
    expect(racing.filter((frame) => frame.predictorActive).map((frame) => frame.tMs)).toEqual([]);
  });

  it('never suspends through the seat, the countdown, the race and the unseat', () => {
    expect(scenario.suspends).toEqual({ seat: 0, countdown: 0, race: 0, unseat: 0 });
  });

  it('is never drawn ahead of the fallback envelope', () => {
    const scored = scoreRacingFrames(racing);
    // Most racing frames moved (only the launch off the grid is still).
    expect(scored.length).toBeGreaterThan(racing.length / 2);
    // Float slack only: the fallback frame and the reference differ by a
    // non-positive multiple of the mirror's step.
    expect(scored.filter((s) => s.aheadYd > 1e-9)).toEqual([]);
  });

  it('never trails the mirror by more than one input echo', () => {
    const scored = scoreRacingFrames(racing);
    expect(scored.length).toBeGreaterThan(racing.length / 2);
    expect(scored.filter((s) => !(s.echoMs > 0))).toEqual([]);
    expect(scored.filter((s) => s.behindYd > s.behindBoundYd)).toEqual([]);
    // The policy is reachable by the fallback's own terms: at the lead floor
    // the target trails the mirror by the rest of one snapshot step, and the
    // smoother lags a steady target by speed over its rate.
    expect(adaptiveSelfAlphaLead(1, 1e9, SERVER_TICK_MS)).toBe(SELF_LEAD_MIN);
    const envelopeOverBound = scored.filter(
      (s) => s.speed * ((1 - SELF_LEAD_MIN) * DT + 1 / SELF_RENDER_SMOOTH_RATE) > s.behindBoundYd,
    );
    expect(envelopeOverBound).toEqual([]);
  });

  it('hands the pose back to prediction once the pilot is home on foot', () => {
    const frames = scenario.unseat.frames;
    const home = frames.findIndex((frame) => !frame.driving);
    expect(home).toBeGreaterThan(0);
    // The first fixed-tick sample after the return seeds the prediction: at
    // most one sampler period of frames, plus the frame the return lands on.
    const seedFrames = Math.ceil((DT * 1000) / DEFAULT_FRAME_MS) + 1;
    const settled = frames.slice(home + seedFrames);
    expect(settled.length).toBeGreaterThan(0);
    expect(settled.filter((frame) => !frame.predictorActive).map((frame) => frame.tMs)).toEqual([]);
  });
});

// The chase camera's other arm: on wire v1 the display extrapolator drives the
// machine and the camera follows its predicted heading, as main.ts reads it
// off the renderer's previous frame.
describe('a seated racer on movement wire v1 (120 ms RTT, key timeline)', () => {
  it('follows the predicted driving heading with the chase camera', () => {
    const racing = runScenario(true, 1).race.frames;
    expect(racing.length).toBeGreaterThan(0);
    expect(racing.some((frame) => frame.predictedDrivingFacing !== null)).toBe(true);
    const offCamera = racing.filter((frame) => frame.cameraFacing !== mainCameraFacing(frame));
    expect(offCamera.map((frame) => frame.tMs)).toEqual([]);
  });
});
