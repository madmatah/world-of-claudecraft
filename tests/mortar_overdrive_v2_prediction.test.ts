import { beforeAll, describe, expect, it, vi } from 'vitest';

// Postgres is mocked before the server/game import the harness pulls in
// (tests/CLAUDE.md, Server tests): the union of the online harness suites'
// superset and the Mortar Overdrive online suite's.
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
import {
  MORTAR_OVERDRIVE_RETURN_TICKS,
  MORTAR_OVERDRIVE_VEHICLE_KEY,
} from '../src/sim/mortar_overdrive/race';
import { DT, RUN_SPEED } from '../src/sim/types';
import type { LatencyLinkConfig } from './helpers/latency_link';
import {
  DEFAULT_FRAME_MS,
  type FrameRecord,
  type HarnessRun,
  SERVER_TICK_MS,
} from './helpers/online_harness';
import {
  createRacerDuelHarness,
  createRacerHarness,
  parkedPilotReachYd,
} from './helpers/racer_harness';
import { type Phase, type PilotWatch, watchPilot } from './helpers/racer_prediction_watch';
import { racerLink } from './helpers/rival_frames';

// A browser always negotiates movement wire v2. Before the drive-aware wire,
// its self-prediction had no drive state: it stepped a kart with the runner
// kernel, and the server's override epoch sized a legal step at run speed, so
// it bumped nearly every tick for a kart. A seated driver the pipeline does
// not predict (driver prediction off, the `?drivepredict=0` arm, or a wire
// with no drive recon) stands prediction down (self_prediction.ts) and is
// drawn by the plain interpolated fallback, the `?nopredict` path. The first
// block below holds that stand-down with driver prediction switched OFF; the
// shipped default predicts the kart (the blocks after it).
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
  const rh = createRacerHarness({
    latency: link(RTT_MS, 10),
    keyTimeline,
    movementWire,
    predictDrivers: false,
  });
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
      durationMs: MORTAR_OVERDRIVE_RETURN_TICKS * SERVER_TICK_MS + 1500,
      script: [{ atMs: 0, mi: { forward: false, turnLeft: false, turnRight: false } }],
      actions: [{ atMs: 0, run: () => harness.client.forfeitMortarOverdrive() }],
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
])(
  'a seated racer on movement wire v2, driver prediction off (120 ms RTT, $mode)',
  ({ keyTimeline }) => {
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
      // Stood down, the drive view never steers the heading, so the camera
      // follows the interpolated server heading (the prediction-on blocks below
      // cover the predicted arm).
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
      expect(settled.filter((frame) => !frame.predictorActive).map((frame) => frame.tMs)).toEqual(
        [],
      );
    });
  },
);

// Wire v1 (script bots, non-negotiating clients) never predicts a kart: the
// display extrapolator stands down for a seated pilot, who is drawn by the
// plain interpolated fallback exactly like a stood-down v2 driver, and the
// chase camera follows the interpolated server heading.
describe('a seated racer on movement wire v1 (120 ms RTT, key timeline)', () => {
  it('draws the kart from the fallback and follows the server heading', () => {
    const racing = runScenario(true, 1).race.frames;
    expect(racing.length).toBeGreaterThan(0);
    expect(racing.every((frame) => frame.driving)).toBe(true);
    expect(racing.filter((frame) => frame.predictorActive).map((f) => f.tMs)).toEqual([]);
    expect(racing.filter((f) => f.predictedDrivingFacing !== null).map((f) => f.tMs)).toEqual([]);
    const offCamera = racing.filter((frame) => frame.cameraFacing !== mainCameraFacing(frame));
    expect(offCamera.map((frame) => frame.tMs)).toEqual([]);
    const scored = scoreRacingFrames(racing);
    expect(scored.length).toBeGreaterThan(racing.length / 2);
    expect(scored.filter((s) => s.aheadYd > 1e-9)).toEqual([]);
  });
});

// Driver prediction on (the shipped default; `?drivepredict=0` is the
// opt-out), end to end on the real client and server: the pipeline predicts the kart from the `rdv` drive,
// reconciles every acknowledgement exactly, and leaves the kart only at the
// server's own discontinuities. The proof suite with thresholds is separate;
// this block shows the wiring works. Measured at this commit (flag on, single
// = the practice circuit behind parked house pilots, duel = two humans a lane
// apart on the drawn circuit, 3 s of racing each):
//
//   RTT   predicted racing frames    suspends (seat, GO, race, end)   replays
//   single
//    60        177 / 180                 0, 1, 0, 1                   GO re-seed 1, verge onset 1, band change 1
//   120        179 / 180                 0, 1, 0, 1                   verge onset 1, band change 1
//   200        179 / 180                 0, 1, 0, 1                   verge onset 1, band change 1
//   duel (A / B)
//    60   171 / 173, 171 / 173           0, 1, 0, 1                   none
//   120   170 / 170, 170 / 170           0, 1, 0, 1                   GO re-seed 1 / none
//   200   167 / 167, 167 / 167           0, 1, 0, 1                   GO re-seed 1 each
//
// Every ignore and stale falls between a suspend and the first reconcile after
// it: the frames already in flight when the prediction re-seeded. Home on foot,
// every frame after the first sample is predicted again, with no replay after
// the race-end suspend. The recorder is tests/helpers/racer_prediction_watch.ts.

function runPredictedSingle(rttMs: number): PilotWatch[] {
  const rh = createRacerHarness({ latency: link(rttMs, 10) });
  try {
    const { harness } = rh;
    let phase: Phase = 'seat';
    const watch = watchPilot(
      harness,
      {
        client: harness.client,
        session: harness.session,
        serverEntity: harness.serverEntity,
        onFrame: harness.onClientFrame,
        reconcileOutcomes: harness.reconcileOutcomes,
      },
      () => phase,
    );
    rh.seat();
    phase = 'go';
    rh.advanceToGo();
    phase = 'race';
    harness.runScript({
      durationMs: RACE_MS,
      script: [
        { atMs: 0, mi: { forward: true }, facing: null },
        { atMs: 800, mi: { turnLeft: true } },
        { atMs: 1600, mi: { turnLeft: false, turnRight: true } },
        { atMs: 2400, mi: { turnRight: false } },
      ],
    });
    phase = 'end';
    harness.runScript({
      durationMs: MORTAR_OVERDRIVE_RETURN_TICKS * SERVER_TICK_MS + 1500,
      script: [{ atMs: 0, mi: { forward: false, turnLeft: false, turnRight: false } }],
      actions: [{ atMs: 0, run: () => harness.client.forfeitMortarOverdrive() }],
    });
    return [watch];
  } finally {
    rh.dispose();
  }
}

/** Half a lane each side of the brain's line: wide enough that the two never
 *  touch on this stretch at any of the links. */
const DUEL_LANE_YD = 3.5;

function runPredictedDuel(rttMs: number): {
  watches: PilotWatch[];
  bumps: number;
  minGapYd: number;
  reachYd: number;
} {
  const d = createRacerDuelHarness({
    latencyA: racerLink(rttMs, 1337),
    latencyB: racerLink(rttMs, 7331),
  });
  try {
    const { harness, a, b } = d;
    let phase: Phase = 'seat';
    const watches = [a, b].map((pilot) => watchPilot(harness, pilot.peer, () => phase));
    let bumps = 0;
    let minGapYd = Number.POSITIVE_INFINITY;
    harness.onServerTick((events) => {
      if (phase !== 'race') return;
      bumps += events.filter((ev) => ev.type === 'mortarOverdriveBump').length;
      const pa = a.peer.serverEntity.pos;
      const pb = b.peer.serverEntity.pos;
      minGapYd = Math.min(minGapYd, Math.hypot(pa.x - pb.x, pa.z - pb.z));
    });
    d.seat();
    a.autopilot({ lineOffsetYd: -DUEL_LANE_YD, observe: 'server' });
    b.autopilot({ lineOffsetYd: DUEL_LANE_YD, observe: 'server' });
    phase = 'go';
    d.advanceToGo();
    phase = 'race';
    d.advanceToRaceMs(RACE_MS);
    phase = 'end';
    a.autopilot(null);
    b.autopilot(null);
    a.client.forfeitMortarOverdrive();
    b.client.forfeitMortarOverdrive();
    d.advanceFor(MORTAR_OVERDRIVE_RETURN_TICKS * SERVER_TICK_MS + 1500);
    const reachYd =
      2 *
      vehicleProfile(a.peer.serverEntity.drive?.profileKey ?? MORTAR_OVERDRIVE_VEHICLE_KEY)
        .bodyRadius;
    return { watches, bumps, minGapYd, reachYd };
  } finally {
    d.dispose();
  }
}

function expectPredictedDrive(watch: PilotWatch): void {
  // Predicted on every racing frame from the first one it owns; the frames
  // before it are the GO suspend and the re-seed's first sample.
  const first = watch.racingFrames.indexOf(true);
  expect(first).toBeGreaterThanOrEqual(0);
  expect(first).toBeLessThanOrEqual(3);
  expect(watch.racingFrames.slice(first).filter((active) => !active)).toEqual([]);

  // One suspend at the GO bump, one at the race-end teleport, none else.
  const suspends = watch.notes.filter((n) => n.kind === 'suspend');
  expect(suspends.filter((n) => n.phase === 'seat')).toEqual([]);
  expect(
    suspends.filter((n) => n.phase === 'go' || (n.phase === 'race' && n.beforePredictedRace)),
  ).toHaveLength(1);
  expect(suspends.filter((n) => n.phase === 'race' && !n.beforePredictedRace)).toEqual([]);
  expect(suspends.filter((n) => n.phase === 'end')).toHaveLength(1);

  // A replay is the re-seed's first reconcile or sits on a server transition,
  // one at most per transition.
  const replays = watch.notes.filter((n) => n.kind === 'replayed');
  const offTransition = replays.filter(
    (n) => !n.afterSuspend && (n.tick === null || !watch.transitions.has(n.tick)),
  );
  expect(offTransition).toEqual([]);
  const onTicks = replays.filter((n) => !n.afterSuspend).map((n) => n.tick);
  expect(new Set(onTicks).size).toBe(onTicks.length);

  // Home on foot, the runner is predicted again once its first sample lands,
  // and nothing replays after the race-end suspend.
  const home = watch.endFrames.findIndex((f) => !f.driving);
  expect(home).toBeGreaterThan(0);
  const seedFrames = Math.ceil((DT * 1000) / DEFAULT_FRAME_MS) + 1;
  const settled = watch.endFrames.slice(home + seedFrames);
  expect(settled.length).toBeGreaterThan(20);
  expect(settled.filter((f) => !f.predictorActive)).toEqual([]);
  const endSuspend = watch.notes.findIndex((n) => n.phase === 'end' && n.kind === 'suspend');
  expect(watch.notes.slice(endSuspend).filter((n) => n.kind === 'replayed')).toEqual([]);

  // Ignores and stales are the frames in flight across a re-seed.
  expect(
    watch.notes.filter((n) => (n.kind === 'ignored' || n.kind === 'stale') && !n.afterSuspend),
  ).toEqual([]);
}

describe.each([60, 120, 200])('driver prediction on, one racer (%i ms RTT)', (rttMs) => {
  it('predicts the kart through a clean drive, leaving it only at GO and race end', () => {
    const [watch] = runPredictedSingle(rttMs);
    expectPredictedDrive(watch);
    // the verge on this script: its onset and its deeper band each replay once
    const racingReplays = watch.notes.filter((n) => n.kind === 'replayed' && !n.afterSuspend);
    expect(racingReplays).toHaveLength(2);
  });
});

describe.each([60, 120, 200])('driver prediction on, two racers (%i ms RTT)', (rttMs) => {
  it('predicts both karts through a clean drive, leaving them only at GO and race end', () => {
    const run = runPredictedDuel(rttMs);
    expect(run.bumps).toBe(0);
    expect(run.minGapYd).toBeGreaterThan(run.reachYd);
    for (const watch of run.watches) {
      expectPredictedDrive(watch);
      expect(watch.notes.filter((n) => n.kind === 'replayed' && !n.afterSuspend)).toEqual([]);
    }
  });
});
