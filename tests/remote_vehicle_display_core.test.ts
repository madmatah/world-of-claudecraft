import { describe, expect, it } from 'vitest';
import {
  createRemoteVehicleDisplay,
  REMOTE_VEHICLE_AGE_CAP_MS,
  remoteRacerProjectionAgeMs,
  resetRemoteVehicleDisplay,
  stepRemoteRacerView,
  stepRemoteVehicleDisplay,
} from '../src/render/remote_vehicle_display_core';
import type { SelfMotionFrame } from '../src/render/self_motion';
import type { ReconciledSelfPrediction } from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { DT, type VehicleDrive } from '../src/sim/types';
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
  opts: { stallFromMs?: number; stallToMs?: number } = {},
): RunResult {
  const s = createRemoteVehicleDisplay();
  const frames = Math.round((seconds * 1000) / FRAME_MS);
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
    const now = (i + 1) * FRAME_MS;
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
      FRAME_MS / 1000,
    );
    const t = truthAt(truth, now);
    const speed = Number.isNaN(lastX)
      ? Number.NaN
      : Math.hypot(s.x - lastX, s.z - lastZ) / (FRAME_MS / 1000);
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
