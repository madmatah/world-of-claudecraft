import { describe, expect, it } from 'vitest';
import {
  createRemoteVehicleDisplay,
  REMOTE_RACER_MUZZLE_LIFT_YD,
  REMOTE_VEHICLE_AGE_CAP_MS,
  REMOTE_VEHICLE_LEAD_CAP_MS,
  type RemoteRacerHorizon,
  type RemoteVehicleDisplayState,
  rallyLaneResolve,
  remoteRacerDrawnY,
  remoteRacerHorizon,
  remoteRacerMuzzle,
  remoteRacerProjectionAgeMs,
  resetRemoteVehicleDisplay,
  stepRemoteRacerView,
  stepRemoteVehicleDisplay,
} from '../src/render/remote_vehicle_display_core';
import type { SelfMotionFrame } from '../src/render/self_motion';
import {
  type ReconciledSelfPrediction,
  selfFrameLeadMs,
} from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { GROUND_BLAST_MUZZLE_NOSE_YD } from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_ORIGIN, realmRacersLaneAt } from '../src/sim/realm_racers_layout';
import { type Aura, DT, type VehicleDrive } from '../src/sim/types';
import {
  advanceVehicleDrive,
  createVehicleDrive,
  vehicleTopSpeedFor,
  vehicleVelocityX,
  vehicleVelocityZ,
} from '../src/sim/vehicle_motion';

// Policy tests for the remote-machine forward projection, driven by the REAL
// vehicle kernel as ground truth and netem-like delivery (60 ms downlink,
// +/-20 ms per-packet jitter against the 20 Hz snapshot cadence): the exact
// conditions under which the plain interpolation path froze and dashed, plus
// the corner-entry window where a constant-yaw projection misses.

const FRAME_MS = 1000 / 60;
const SNAP_MS = 50;
const DOWNLINK_MS = 60;
const PROFILE_KEY = 'tank';

// Deterministic per-packet jitter in [-20, 20] ms (mulberry-style, fixed seed).
function jitterSequence(count: number, seed: number): number[] {
  let a = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out.push((((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 40);
  }
  return out;
}

interface TruthSample {
  x: number;
  z: number;
  facing: number;
  drive: VehicleDrive;
}

/**
 * Drive the real kernel for `seconds` with a scripted wheel (throttle held,
 * like a racer), recording one sample per tick: the authoritative trajectory
 * the server would broadcast.
 */
function driveTruth(seconds: number, steerAt: (tSec: number) => number): TruthSample[] {
  const drive = createVehicleDrive(PROFILE_KEY);
  const profile = vehicleProfile(PROFILE_KEY);
  let x = 0;
  let z = 0;
  let facing = 0;
  const out: TruthSample[] = [{ x, z, facing, drive: { ...drive } }];
  const ticks = Math.round(seconds / DT);
  for (let k = 1; k <= ticks; k++) {
    facing += advanceVehicleDrive(drive, profile, {
      throttle: 1,
      steer: steerAt((k - 1) * DT),
      handbrake: false,
      onGround: true,
      auraMult: 1,
    });
    x += vehicleVelocityX(drive, facing) * DT;
    z += vehicleVelocityZ(drive, facing) * DT;
    out.push({ x, z, facing, drive: { ...drive } });
  }
  return out;
}

function wrap(d: number): number {
  let a = d;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function truthAt(truth: TruthSample[], tMs: number): { x: number; z: number; facing: number } {
  const t = Math.max(0, tMs / 1000 / DT);
  const k = Math.min(truth.length - 1, Math.floor(t));
  const n = Math.min(truth.length - 1, k + 1);
  const f = Math.min(1, t - k);
  return {
    x: truth[k].x + (truth[n].x - truth[k].x) * f,
    z: truth[k].z + (truth[n].z - truth[k].z) * f,
    facing: truth[k].facing + wrap(truth[n].facing - truth[k].facing) * f,
  };
}

interface RunResult {
  /** Per frame: [tMs, position error yd, facing error rad, frame speed yd/s]. */
  frames: [number, number, number, number][];
  lastWire: TruthSample;
}

/** Run the client against jittered deliveries of the truth track. Delivery k
 *  (sampled at k * 50 ms) arrives at k * 50 + DOWNLINK + jitter[k]. */
function run(
  truth: TruthSample[],
  seconds: number,
  opts: { stallFromMs?: number; stallToMs?: number; frameMs?: number } = {},
): RunResult {
  const frameMs = opts.frameMs ?? FRAME_MS;
  const s = createRemoteVehicleDisplay();
  const frames = Math.round((seconds * 1000) / frameMs);
  const snapCount = Math.floor((seconds * 1000) / SNAP_MS);
  const jitter = jitterSequence(snapCount + 1, 1234);
  const arrivals: { atMs: number; sample: TruthSample }[] = [];
  for (let k = 0; k <= snapCount; k++) {
    const sentAt = k * SNAP_MS;
    const atMs = sentAt + DOWNLINK_MS + jitter[k];
    if (opts.stallFromMs !== undefined && atMs >= opts.stallFromMs && atMs < (opts.stallToMs ?? 0))
      continue;
    const tick = Math.round(sentAt / 1000 / DT);
    if (tick < truth.length) arrivals.push({ atMs, sample: truth[tick] });
  }
  arrivals.sort((a, b) => a.atMs - b.atMs);

  const out: RunResult = { frames: [], lastWire: arrivals[0].sample };
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let wireIdx = -1;
  let wireArrivedAt = 0;
  for (let i = 0; i < frames; i++) {
    const now = (i + 1) * frameMs;
    while (wireIdx + 1 < arrivals.length && arrivals[wireIdx + 1].atMs <= now) {
      wireIdx++;
      wireArrivedAt = arrivals[wireIdx].atMs;
      out.lastWire = arrivals[wireIdx].sample;
    }
    if (wireIdx < 0) continue;
    const w = out.lastWire;
    stepRemoteVehicleDisplay(
      s,
      w.x,
      w.z,
      w.facing,
      w.drive,
      now - wireArrivedAt + DOWNLINK_MS,
      frameMs / 1000,
    );
    const t = truthAt(truth, now);
    const speed = Number.isNaN(lastX)
      ? Number.NaN
      : Math.hypot(s.x - lastX, s.z - lastZ) / (frameMs / 1000);
    out.frames.push([
      now,
      Math.hypot(s.x - t.x, s.z - t.z),
      Math.abs(wrap(s.facing - t.facing)),
      speed,
    ]);
    lastX = s.x;
    lastZ = s.z;
  }
  return out;
}

const inWindow = (r: RunResult, fromMs: number, toMs: number) =>
  r.frames.filter(([t]) => t >= fromMs && t < toMs);
const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

describe('remote vehicle display projection', () => {
  it('tracks the PRESENT pose on a straight instead of showing the past', () => {
    // Plain interpolation shows the machine downlink + one interval in the
    // past: ~110 ms at terminal speed is 5+ yd behind. The kernel projection
    // must track the present within a yard once up to speed.
    const truth = driveTruth(6, () => 0);
    const r = run(truth, 6);
    const errs = inWindow(r, 3000, 6000).map(([, e]) => e);
    expect(mean(errs)).toBeLessThan(0.8);
    expect(Math.max(...errs)).toBeLessThan(1.5);
  });

  it('never freezes or dashes under per-packet jitter', () => {
    // The defect the projection replaces: arrival jitter turned into dead
    // stops at the extrapolation cap and catch-up lunges. Over the settled
    // window the drawn per-frame speed must stay near the cruise speed.
    const truth = driveTruth(6, () => 0);
    const r = run(truth, 6);
    const speeds = inWindow(r, 4000, 6000)
      .map(([, , , v]) => v)
      .filter((v) => !Number.isNaN(v));
    const cruise = mean(speeds);
    expect(Math.min(...speeds)).toBeGreaterThan(cruise * 0.5);
    expect(Math.max(...speeds)).toBeLessThan(cruise * 1.5);
  });

  it('holds the line through corner entry, apex and exit', () => {
    // The wheel goes hard over at 3 s and back to centre at 4.5 s, at speed:
    // the yaw rate RAMPS through the whole window (servo winding, grip
    // bleeding the slide), which is exactly where a constant-yaw chord drifts
    // off the true line. The bounds are DECISIVE against that chord: on this
    // scenario it measures 0.49 yd mean / 1.02 max over the window, the
    // kernel 0.25 / 0.62, so a regression back to any yaw-frozen projection
    // fails both lines while the kernel keeps honest margin.
    const truth = driveTruth(6, (t) => (t >= 3 && t < 4.5 ? 1 : 0));
    const r = run(truth, 6);
    const corner = inWindow(r, 3000, 5000);
    expect(mean(corner.map(([, e]) => e))).toBeLessThan(0.4);
    expect(Math.max(...corner.map(([, e]) => e))).toBeLessThan(0.8);
    expect(mean(corner.map(([, , f]) => f))).toBeLessThan(0.12);
  });

  it('keeps the drawn pose on its projection at 15, 20, 24, 30 and 60 fps', () => {
    // Between arrivals the target moves with the horizon, by the machine's
    // velocity times the whole frame. A carry capped at a 30 fps frame left a
    // slower client's rival steadily behind it (measured at 55 yd/s: 0.75 yd
    // at 24 fps, 1.5 at 20, 3.1 at 15, against a 3.4 yd contact reach).
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = 55;
    const targetAt = (ageMs: number): RemoteVehicleDisplayState =>
      stepRemoteVehicleDisplay(createRemoteVehicleDisplay(), 0, 0, 0, drive, ageMs, 0, 5000);
    for (const fps of [15, 20, 24, 30, 60]) {
      const s = createRemoteVehicleDisplay();
      let worst = 0;
      for (let i = 0; i <= fps; i++) {
        const ageMs = 50 + (i * 1000) / fps;
        stepRemoteVehicleDisplay(s, 0, 0, 0, drive, ageMs, 1 / fps, 5000);
        const target = targetAt(ageMs);
        worst = Math.max(worst, Math.hypot(s.x - target.x, s.z - target.z));
      }
      expect(worst, `${fps} fps`).toBeLessThan(0.02);
    }
    // The jittered straight at speed: every frame rate tracks the present as
    // closely as 60 fps does.
    const truth = driveTruth(6, () => 0);
    const at60 = mean(inWindow(run(truth, 6), 3000, 6000).map(([, e]) => e));
    for (const fps of [15, 20, 24, 30]) {
      const r = run(truth, 6, { frameMs: 1000 / fps });
      const errs = inWindow(r, 3000, 6000).map(([, e]) => e);
      expect(mean(errs), `${fps} fps`).toBeLessThan(at60 + 0.1);
    }
  });

  it('snaps outright on a teleport-sized correction', () => {
    const s = createRemoteVehicleDisplay();
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = 30;
    stepRemoteVehicleDisplay(s, 0, 0, 0, drive, 100, 1 / 60);
    const before = { x: s.x, z: s.z };
    stepRemoteVehicleDisplay(s, 40, 200, 0, drive, 100, 1 / 60);
    // A 40+ yd move is a track reset, not racing: adopted in one frame.
    expect(Math.hypot(s.x - 40, s.z - 200)).toBeLessThan(5);
    expect(Math.hypot(s.x - before.x, s.z - before.z)).toBeGreaterThan(6);
  });

  it('caps the projection horizon on a broadcast stall', () => {
    // Deliveries stop for 600 ms mid-run: the target may advance at most
    // AGE_CAP of projection past the last wire pose, then hold, instead of
    // driving a corner the machine never took.
    const truth = driveTruth(3, () => 0);
    const r = run(truth, 3, { stallFromMs: 1500, stallToMs: 2100 });
    const w = r.lastWire;
    const s = createRemoteVehicleDisplay();
    for (let i = 0; i < 60; i++)
      stepRemoteVehicleDisplay(s, w.x, w.z, w.facing, w.drive, 1000 + i * FRAME_MS, 1 / 60);
    const advance = Math.hypot(s.x - w.x, s.z - w.z);
    const top = vehicleTopSpeedFor(w.drive, 1);
    expect(advance).toBeLessThanOrEqual(top * (REMOTE_VEHICLE_AGE_CAP_MS / 1000) + 0.1);
  });

  it('adopts the target exactly on the first step and after a reset', () => {
    const s = createRemoteVehicleDisplay();
    const still = createVehicleDrive(PROFILE_KEY);
    stepRemoteVehicleDisplay(s, 5, -3, 0.4, still, 0, 1 / 60);
    expect(s.x).toBeCloseTo(5);
    expect(s.z).toBeCloseTo(-3);
    expect(s.facing).toBeCloseTo(0.4);
    resetRemoteVehicleDisplay(s);
    expect(s.active).toBe(false);
    stepRemoteVehicleDisplay(s, 100, -3, 0.4, still, 0, 1 / 60);
    expect(s.x).toBeCloseTo(100);
  });

  it('never writes into the mirrored drive object', () => {
    // The wire mirror is ClientWorld state; the projection owns only its
    // scratch. Frozen exactly like the self_motion lab freezes its mirror.
    const s = createRemoteVehicleDisplay();
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = 40;
    drive.steerAngle = 0.8;
    const frozen = Object.freeze({ ...drive });
    stepRemoteVehicleDisplay(s, 0, 0, 0, frozen, 200, 1 / 60);
    expect(frozen.speed).toBe(40);
  });
});

describe('the remote racer view step renderer.sync runs', () => {
  // Only the echo channel matters to the horizon, so the v1 frame carries just
  // that field; the v2 frame is the reconciled shape, which has none.
  const v1Frame = { echoMs: 120 } as unknown as SelfMotionFrame;
  const v2Frame: ReconciledSelfPrediction = {
    kind: 'reconciled',
    position: { x: 0, y: 0, z: 0 },
    residual: null,
  };
  const straightDrive = (speed: number): VehicleDrive => {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = speed;
    return drive;
  };

  it('ages a wire pose from its arrival, plus half the echo only on a v1 frame', () => {
    expect(remoteRacerProjectionAgeMs(1000, 940, null)).toBe(60);
    expect(remoteRacerProjectionAgeMs(1000, 940, v2Frame)).toBe(60);
    expect(remoteRacerProjectionAgeMs(1000, 940, v1Frame)).toBe(120);
  });

  it('projects a remote machine exactly as the direct step does, at that age', () => {
    const drive = straightDrive(40);
    const mirror = { pos: { x: 3, z: -7 }, facing: 0.3, drive, netUpdatedAt: 900 };
    for (const frame of [null, v1Frame]) {
      const viaView = createRemoteVehicleDisplay();
      const direct = createRemoteVehicleDisplay();
      for (let i = 0; i < 6; i++) {
        const now = 950 + i * FRAME_MS;
        expect(stepRemoteRacerView(viaView, mirror, frame, now, FRAME_MS / 1000)).toBe(true);
        stepRemoteVehicleDisplay(
          direct,
          3,
          -7,
          0.3,
          drive,
          remoteRacerProjectionAgeMs(now, 900, frame),
          FRAME_MS / 1000,
        );
        expect({ x: viaView.x, z: viaView.z, facing: viaView.facing }).toEqual({
          x: direct.x,
          z: direct.z,
          facing: direct.facing,
        });
      }
    }
  });

  it('resets a live projection when the machine has no drive or no arrival', () => {
    const s = createRemoteVehicleDisplay();
    const drive = straightDrive(40);
    const mirror = { pos: { x: 0, z: 0 }, facing: 0, drive, netUpdatedAt: 0 };
    expect(stepRemoteRacerView(s, mirror, null, 50, 1 / 60)).toBe(true);
    expect(s.active).toBe(true);
    expect(stepRemoteRacerView(s, { ...mirror, drive: null }, null, 60, 1 / 60)).toBe(false);
    expect(s.active).toBe(false);
    stepRemoteRacerView(s, mirror, null, 70, 1 / 60);
    expect(stepRemoteRacerView(s, { ...mirror, netUpdatedAt: undefined }, null, 80, 1 / 60)).toBe(
      false,
    );
    expect(s.active).toBe(false);
  });
});

describe('the self-frame horizon: rivals drawn where the local kart is', () => {
  const TICK_MS = DT * 1000;
  const v1Frame = { echoMs: 120 } as unknown as SelfMotionFrame;
  /** A driving v2 frame: the head `tickOffset` ticks over the ack, drawn at `alpha`. */
  const driving = (tickOffset: number, tickAlpha: number): ReconciledSelfPrediction => ({
    kind: 'reconciled',
    position: { x: 0, y: 0, z: 0 },
    residual: null,
    tickOffset,
    tickAlpha,
  });
  const horizon = (): RemoteRacerHorizon => ({ ageMs: 0, capMs: 0 });
  const straight = (speed: number): VehicleDrive => {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = speed;
    return drive;
  };

  it('reads the lead off the predictor: (tickOffset - 1 + alpha) ticks', () => {
    expect(selfFrameLeadMs(driving(3, 0.4))).toBeCloseTo((3 - 1 + 0.4) * TICK_MS, 9);
    expect(selfFrameLeadMs(driving(1, 0))).toBe(0);
    expect(selfFrameLeadMs(driving(6, 1))).toBeCloseTo(6 * TICK_MS, 9);
    // Not predicted: no lead, whatever else the frame carries.
    expect(selfFrameLeadMs(null)).toBeNull();
    expect(selfFrameLeadMs(v1Frame)).toBeNull();
    expect(
      selfFrameLeadMs({ kind: 'reconciled', position: { x: 0, y: 0, z: 0 }, residual: null }),
    ).toBeNull();
    expect(selfFrameLeadMs({ ...driving(3, 0.4), tickOffset: null })).toBeNull();
    expect(selfFrameLeadMs({ ...driving(3, 0.4), tickAlpha: null })).toBeNull();
  });

  it('projects a rival from the self pose snapshot by exactly the self lead', () => {
    // Rival and self arrived together (one snapshot): the arrival ages cancel.
    const frame = driving(4, 0.25);
    const lead = (4 - 1 + 0.25) * TICK_MS;
    for (const now of [1000, 1017, 1049]) {
      const out = remoteRacerHorizon(now, 980, frame, 980, horizon());
      expect(out.ageMs).toBeCloseTo(lead, 9);
      // The cap is the lead over the self's arrival plus the arrival budget.
      expect(out.capMs).toBeCloseTo(lead - (now - 980) + REMOTE_VEHICLE_AGE_CAP_MS, 9);
    }
  });

  it('carries a rival pose older than the self one over the difference', () => {
    const frame = driving(4, 0.25);
    const lead = (4 - 1 + 0.25) * TICK_MS;
    const out = remoteRacerHorizon(1000, 930, frame, 980, horizon());
    expect(out.ageMs).toBeCloseTo(lead + 50, 9);
  });

  it('keeps the arrival age and the fixed cap exactly when the kart is not predicted', () => {
    for (const frame of [null, { ...driving(4, 0.25), tickOffset: null }] as const) {
      const out = remoteRacerHorizon(1000, 940, frame, 990, horizon());
      expect(out).toEqual({ ageMs: 60, capMs: REMOTE_VEHICLE_AGE_CAP_MS });
      expect(remoteRacerProjectionAgeMs(1000, 940, frame, 990)).toBe(60);
    }
    // v1 keeps its echo half.
    expect(remoteRacerHorizon(1000, 940, v1Frame, 990, horizon())).toEqual({
      ageMs: 120,
      capMs: REMOTE_VEHICLE_AGE_CAP_MS,
    });
  });

  it('bounds the lead, and holds a stalled pose to the arrival budget', () => {
    // A starved uplink: the ack stuck 40 ticks back while snapshots still land.
    const stuck = remoteRacerHorizon(1000, 1000, driving(40, 0.5), 1000, horizon());
    expect(stuck.ageMs).toBe(REMOTE_VEHICLE_LEAD_CAP_MS);
    expect(stuck.capMs).toBe(REMOTE_VEHICLE_LEAD_CAP_MS + REMOTE_VEHICLE_AGE_CAP_MS);
    // A whole-downlink stall: nothing arrives while the head runs on, so the
    // lead over the self's arrival holds and only the pose's own age grows,
    // past the budget, where the projection stops.
    const lead = (4 - 1 + 0.5) * TICK_MS;
    const fresh = remoteRacerHorizon(1000, 1000, driving(4, 0.5), 1000, horizon());
    const stall = 400;
    const late = remoteRacerHorizon(
      1000 + stall,
      1000,
      driving(4 + stall / TICK_MS, 0.5),
      1000,
      horizon(),
    );
    expect(fresh.capMs).toBeCloseTo(lead + REMOTE_VEHICLE_AGE_CAP_MS, 9);
    expect(late.capMs).toBeCloseTo(fresh.capMs, 9);
    expect(late.ageMs).toBeGreaterThan(late.capMs);
    // A self pose that arrived AFTER its lead ran out clamps at zero.
    expect(remoteRacerHorizon(1000, 900, driving(1, 0), 900, horizon()).ageMs).toBe(100);
  });

  it('projects past the old fixed cap when the self frame leads by more', () => {
    // A 200 ms round trip leads by about 300 ms: the arrival-age cap (250 ms)
    // would freeze the rival 50 ms short of the self.
    const frame = driving(7, 0);
    const lead = 6 * TICK_MS;
    expect(lead).toBeGreaterThan(REMOTE_VEHICLE_AGE_CAP_MS);
    const drive = straight(40);
    const mirror = { pos: { x: 0, z: 0 }, facing: 0, drive, netUpdatedAt: 1000 };
    const s = createRemoteVehicleDisplay();
    expect(stepRemoteRacerView(s, mirror, frame, 1000, 1 / 60, 1000)).toBe(true);
    const direct = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(direct, 0, 0, 0, drive, lead, 1 / 60, lead + 250);
    expect(s.z).toBeCloseTo(direct.z, 9);
    const capped = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(capped, 0, 0, 0, drive, lead, 1 / 60);
    expect(s.z).toBeGreaterThan(capped.z + 1);
  });

  it('never writes into the prediction frame or the mirror', () => {
    const frame = Object.freeze(driving(5, 0.5));
    const drive = Object.freeze(straight(30));
    const mirror = Object.freeze({
      pos: Object.freeze({ x: 1, z: 2 }),
      facing: 0.2,
      drive,
      netUpdatedAt: 500,
    });
    const s = createRemoteVehicleDisplay();
    for (let i = 0; i < 4; i++) stepRemoteRacerView(s, mirror, frame, 510 + i * 16, 1 / 60, 500);
    expect(frame.tickOffset).toBe(5);
    expect(mirror.pos.x).toBe(1);
    expect(drive.speed).toBe(30);
  });
});

describe('a held or snared rival is projected the way the server moves it', () => {
  const TICK_MS = DT * 1000;
  /** A driving frame leading the snapshot by 250 ms. */
  const leading: ReconciledSelfPrediction = {
    kind: 'reconciled',
    position: { x: 0, y: 0, z: 0 },
    residual: null,
    tickOffset: 6,
    tickAlpha: 0,
  };
  const machine = (speed: number, locked: boolean): VehicleDrive => {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = speed;
    drive.controlsLocked = locked;
    return drive;
  };
  const slow = (value: number) => [{ id: 'snare', kind: 'slow', value }] as unknown as Aura[];

  it('draws a machine held on the grid exactly at its wire pose, frame after frame', () => {
    // The server's movement pass returns before the kernel while the race holds
    // a machine: projecting it at full throttle drew it jumping the start.
    for (const speed of [0, 30]) {
      const mirror = {
        pos: { x: 4, z: 9 },
        facing: 0.5,
        drive: machine(speed, true),
        netUpdatedAt: 1000,
      };
      for (const frame of [leading, null]) {
        const s = createRemoteVehicleDisplay();
        for (let i = 0; i < 20; i++) {
          stepRemoteRacerView(s, mirror, frame, 1000 + i * FRAME_MS, FRAME_MS / 1000, 1000, null);
          expect({ x: s.x, z: s.z, facing: s.facing }).toEqual({ x: 4, z: 9, facing: 0.5 });
        }
      }
    }
  });

  it('projects the machine again from the first unheld snapshot', () => {
    const s = createRemoteVehicleDisplay();
    const held = { pos: { x: 0, z: 0 }, facing: 0, drive: machine(0, true), netUpdatedAt: 1000 };
    stepRemoteRacerView(s, held, leading, 1000, FRAME_MS / 1000, 1000, null);
    expect(s.z).toBe(0);
    const go = { ...held, drive: machine(0, false), netUpdatedAt: 1050 };
    const direct = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(direct, 0, 0, 0, go.drive, 5 * TICK_MS, 0, 5000);
    for (let i = 0; i < 30; i++) {
      stepRemoteRacerView(s, go, leading, 1050 + i * FRAME_MS, FRAME_MS / 1000, 1050, null);
    }
    expect(direct.z).toBeGreaterThan(0.5);
    expect(s.z).toBeGreaterThan(direct.z);
  });

  it("honours a snared rival's own slow, off the auras its wire record carries", () => {
    // A Ground Blast leaves its target at 0.6 of its top speed for a moment.
    const drive = machine(55, false);
    const snared = { pos: { x: 0, z: 0 }, facing: 0, drive, netUpdatedAt: 1000, auras: slow(0.6) };
    const s = createRemoteVehicleDisplay();
    stepRemoteRacerView(s, snared, leading, 1000, FRAME_MS / 1000, 1000, null);
    const direct = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(direct, 0, 0, 0, drive, 5 * TICK_MS, 0, 5000, null, 0, 0.6);
    expect(s.z).toBeCloseTo(direct.z, 9);
    const free = createRemoteVehicleDisplay();
    stepRemoteRacerView(free, { ...snared, auras: [] }, leading, 1000, FRAME_MS / 1000, 1000, null);
    expect(free.z - s.z).toBeGreaterThan(0.5);
  });
});

describe('the drawn height and the muzzle of a projected rival', () => {
  const ramp = (x: number, z: number): number => 0.25 * x + 0.1 * z;
  const flat = (): number => 0;

  it('keeps the wire height where the projection has not moved the hull', () => {
    expect(remoteRacerDrawnY(10, 3, 10, 10, 10, ramp)).toBe(3);
  });

  it('follows the ground under the projected hull with no step, keeping any height above it', () => {
    // Grounded: the wire y is the ground there, the drawn y the ground here.
    const grounded = remoteRacerDrawnY(10, ramp(10, 10), 10, 22, 14, ramp);
    expect(grounded).toBeCloseTo(ramp(22, 14), 12);
    // Airborne 2 yd up (a blast pop): still 2 yd over the ground drawn under it.
    const airborne = remoteRacerDrawnY(10, ramp(10, 10) + 2, 10, 22, 14, ramp);
    expect(airborne).toBeCloseTo(ramp(22, 14) + 2, 12);
    // Continuous in the displacement: a hair of projection moves y by a hair.
    const tiny = remoteRacerDrawnY(10, ramp(10, 10), 10, 10.01, 10, ramp);
    expect(Math.abs(tiny - ramp(10, 10))).toBeLessThan(0.01);
    // A flat circuit band: nothing changes.
    expect(remoteRacerDrawnY(10, 5, 10, 22, 14, () => -1)).toBe(5);
  });

  const shot = { sourceId: 7, x: 3, z: 4, targetX: 30, targetZ: 40, flightSeconds: 0.6 };
  const drawnAt = (x: number, z: number, facing: number): RemoteVehicleDisplayState => {
    const display = createRemoteVehicleDisplay();
    display.active = true;
    display.x = x;
    display.z = z;
    display.facing = facing;
    return display;
  };

  it('leaves the barrel of the machine as drawn, at the server muzzle offset', () => {
    const views = new Map([[7, { remoteVehicle: drawnAt(20, -5, 0.7) }]]);
    const at = remoteRacerMuzzle(views, shot, 1, ramp);
    expect(at.x).toBeCloseTo(20 + Math.sin(0.7) * GROUND_BLAST_MUZZLE_NOSE_YD, 12);
    expect(at.z).toBeCloseTo(-5 + Math.cos(0.7) * GROUND_BLAST_MUZZLE_NOSE_YD, 12);
    // The flash sits over the ground under the drawn barrel.
    expect(at.y).toBeCloseTo(ramp(at.x, at.z) + REMOTE_RACER_MUZZLE_LIFT_YD, 12);
    // The landing point is ground, and stays the server's.
    expect([at.targetX, at.targetZ, at.flightSeconds, at.sourceId]).toEqual([30, 40, 0.6, 7]);
    expect(shot.x).toBe(3);
  });

  it('keeps the event muzzle for the local pilot and for a shooter with no live projection', () => {
    const lift = REMOTE_RACER_MUZZLE_LIFT_YD;
    const self = new Map([[7, { remoteVehicle: drawnAt(20, -5, 0.7) }]]);
    // The shooter IS the viewer: its own view is never a projection.
    expect(remoteRacerMuzzle(self, shot, 7, flat)).toEqual({ ...shot, y: lift });
    expect(remoteRacerMuzzle(new Map(), shot, 1, flat)).toEqual({ ...shot, y: lift });
    const idle = new Map([[7, { remoteVehicle: createRemoteVehicleDisplay() }]]);
    expect(remoteRacerMuzzle(idle, shot, 1, flat)).toEqual({ ...shot, y: lift });
  });

  it('stood down too: a rival stepped on its arrival age follows the ground and fires from its nose', () => {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = 30;
    const mirror = { pos: { x: 10, z: 10 }, facing: 0, drive, netUpdatedAt: 1000 };
    const view = createRemoteVehicleDisplay();
    expect(stepRemoteRacerView(view, mirror, null, 1100, 1 / 60)).toBe(true);
    // 100 ms of arrival age: 3 yd up the road from the wire pose.
    expect(view.z).toBeGreaterThan(12.9);
    expect(view.z).toBeLessThan(13.5);
    const y = remoteRacerDrawnY(10, ramp(10, 10), 10, view.x, view.z, ramp);
    expect(y).toBeCloseTo(ramp(view.x, view.z), 12);
    expect(y).not.toBeCloseTo(ramp(10, 10), 3);
    const at = remoteRacerMuzzle(new Map([[7, { remoteVehicle: view }]]), shot, 1, flat);
    expect(at.z).toBeCloseTo(view.z + GROUND_BLAST_MUZZLE_NOSE_YD, 12);
    expect(at.z).not.toBe(shot.z);
  });
});

describe('a projected rival keeps to the circuit colliders', () => {
  const lane = realmRacersLaneAt(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z);
  if (!lane) throw new Error('lane 0 has no circuit');
  const { halfX, halfThickness } = lane.circuit.perimeter;
  const radius = vehicleProfile(PROFILE_KEY).bodyRadius;
  /** The garden wall's inner face, circuit-local x. */
  const innerFace = halfX - halfThickness;
  const frame = (tickOffset: number, tickAlpha: number): ReconciledSelfPrediction => ({
    kind: 'reconciled',
    position: { x: 0, y: 0, z: 0 },
    residual: null,
    tickOffset,
    tickAlpha,
  });

  it('a rival driving into the garden wall with a 250 ms lead stays inside', () => {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = 40;
    // Six yards short of the wall, heading straight at it (+x).
    const start = REALM_RACERS_ORIGIN.x + innerFace - radius - 6;
    const mirror = {
      pos: { x: start, z: REALM_RACERS_ORIGIN.z },
      facing: Math.PI / 2,
      drive,
      netUpdatedAt: 1000,
    };
    const lead = frame(6, 0); // (6 - 1) ticks: 250 ms
    const walled = createRemoteVehicleDisplay();
    stepRemoteRacerView(walled, mirror, lead, 1000, 1 / 60, 1000);
    expect(walled.x - REALM_RACERS_ORIGIN.x).toBeLessThanOrEqual(innerFace - radius + 1e-6);
    expect(walled.x).toBeGreaterThan(start + 5);
    // The same step with no collision runs the hull 4 yd through the wall.
    const open = createRemoteVehicleDisplay();
    stepRemoteRacerView(open, mirror, lead, 1000, 1 / 60, 1000, null);
    expect(open.x - REALM_RACERS_ORIGIN.x).toBeGreaterThan(halfX + halfThickness);
  });

  it('passes a move outside every rally lane straight through', () => {
    expect(rallyLaneResolve(0, 0, 3, 4, radius)).toEqual({ x: 3, z: 4 });
  });
});

describe('a mid-race switch between the self frame and the arrival age glides', () => {
  const SPEED = 40;
  const FRAME = 1000 / 60;
  const SNAP = 50;
  /** Truth: straight up +z at racing speed; a snapshot every 50 ms carries the
   *  pose 60 ms old, and the self frame leads it by 200 ms growing with the
   *  tick alpha, the way the predictor's own counters do. */
  function run(mode: (tMs: number) => 'predicted' | 'stood'): { t: number; z: number }[] {
    const drive = createVehicleDrive(PROFILE_KEY);
    drive.speed = SPEED;
    const view = createRemoteVehicleDisplay();
    const out: { t: number; z: number }[] = [];
    for (let t = 1000; t < 3000; t += FRAME) {
      const arrival = Math.floor(t / SNAP) * SNAP;
      const mirror = {
        pos: { x: 0, z: (SPEED * (arrival - 60)) / 1000 },
        facing: 0,
        drive,
        netUpdatedAt: arrival,
      };
      const selfMotion: ReconciledSelfPrediction | null =
        mode(t) === 'predicted'
          ? {
              kind: 'reconciled',
              position: { x: 0, y: 0, z: 0 },
              residual: null,
              tickOffset: 5,
              tickAlpha: (t - arrival) / SNAP,
            }
          : null;
      stepRemoteRacerView(view, mirror, selfMotion, t, FRAME / 1000, arrival, null);
      out.push({ t, z: view.z });
    }
    return out;
  }
  const switched = (t: number) => (t >= 1800 && t < 2400 ? 'stood' : 'predicted');

  it('never jumps the rival by the lead in one frame, either way', () => {
    const drawn = run(switched);
    let worst = 0;
    for (let i = 1; i < drawn.length; i++)
      worst = Math.max(worst, Math.abs(drawn[i].z - drawn[i - 1].z));
    // The lead is 200 to 250 ms: 8 to 10 yd in one frame without the slew
    // (a snap). Slewed, a frame moves it at most the slew rate times the lead
    // times the speed, over one frame (15 x 0.25 s x 40 yd/s / 60, 2.5 yd).
    expect(worst).toBeLessThan(3);
    expect(worst).toBeGreaterThan((SPEED * FRAME) / 1000);
  });

  it('settles on each horizon within about 300 ms of the switch', () => {
    const drawn = run(switched);
    const stood = run(() => 'stood');
    const predicted = run(() => 'predicted');
    const at = (rows: { t: number; z: number }[], tMs: number) =>
      rows.reduce((best, r) => (Math.abs(r.t - tMs) < Math.abs(best.t - tMs) ? r : best)).z;
    // 300 ms after dropping to stood down, and after coming back.
    expect(Math.abs(at(drawn, 2100) - at(stood, 2100))).toBeLessThan(0.3);
    expect(Math.abs(at(drawn, 2700) - at(predicted, 2700))).toBeLessThan(0.3);
    // Right at the switch it has not jumped: still near the old horizon.
    expect(Math.abs(at(drawn, 1817) - at(predicted, 1817))).toBeLessThan(2.5);
  });
});
