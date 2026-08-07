import { describe, expect, it } from 'vitest';
import {
  createRemoteVehicleDisplay,
  REMOTE_VEHICLE_AGE_CAP_MS,
  resetRemoteVehicleDisplay,
  stepRemoteVehicleDisplay,
} from '../src/render/remote_vehicle_display_core';

// Policy tests for the remote-machine forward projection, driven by scripted
// trajectories under netem-like delivery (60 ms downlink, +/-20 ms per-packet
// jitter against the 20 Hz snapshot cadence): the exact conditions under which
// the plain interpolation path freezes and dashes.

const FRAME_MS = 1000 / 60;
const SNAP_MS = 50;
const DOWNLINK_MS = 60;

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

interface TrajectoryPoint {
  x: number;
  z: number;
  facing: number;
  vx: number;
  vz: number;
  yawRate: number;
}

/** Constant-speed, constant-yaw trajectory (straight when yawRate is 0). */
function trajectoryAt(tSec: number, speed: number, yawRate: number): TrajectoryPoint {
  const f = yawRate * tSec;
  if (yawRate === 0) {
    return { x: 0, z: speed * tSec, facing: 0, vx: 0, vz: speed, yawRate };
  }
  // forward = (sin f, cos f); integrating speed * forward over f = w t gives
  // a circle of radius speed / w.
  const r = speed / yawRate;
  return {
    x: r * (1 - Math.cos(f)),
    z: r * Math.sin(f),
    facing: ((f + Math.PI) % (2 * Math.PI)) - Math.PI,
    vx: speed * Math.sin(f),
    vz: speed * Math.cos(f),
    yawRate,
  };
}

/**
 * Run the client against jittered deliveries of a trajectory and collect the
 * drawn poses. Wall clock and server clock coincide; delivery k (sampled at
 * k * 50 ms) arrives at k * 50 + DOWNLINK + jitter[k].
 */
function run(
  speed: number,
  yawRate: number,
  seconds: number,
  opts: { stallFromMs?: number; stallToMs?: number } = {},
): { errs: number[]; facingErrs: number[]; frameSpeeds: number[]; lastWire: TrajectoryPoint } {
  const s = createRemoteVehicleDisplay();
  const frames = Math.round((seconds * 1000) / FRAME_MS);
  const snapCount = Math.ceil((seconds * 1000) / SNAP_MS) + 1;
  const jitter = jitterSequence(snapCount, 1234);
  const arrivals: { atMs: number; sample: TrajectoryPoint }[] = [];
  for (let k = 0; k < snapCount; k++) {
    const sentAt = k * SNAP_MS;
    const atMs = sentAt + DOWNLINK_MS + jitter[k];
    if (opts.stallFromMs !== undefined && atMs >= opts.stallFromMs && atMs < (opts.stallToMs ?? 0))
      continue;
    arrivals.push({ atMs, sample: trajectoryAt(sentAt / 1000, speed, yawRate) });
  }
  arrivals.sort((a, b) => a.atMs - b.atMs);

  const errs: number[] = [];
  const facingErrs: number[] = [];
  const frameSpeeds: number[] = [];
  let lastX = Number.NaN;
  let lastZ = Number.NaN;
  let wireIdx = -1;
  let wireArrivedAt = 0;
  let lastWire = arrivals[0].sample;
  for (let i = 0; i < frames; i++) {
    const now = (i + 1) * FRAME_MS;
    while (wireIdx + 1 < arrivals.length && arrivals[wireIdx + 1].atMs <= now) {
      wireIdx++;
      wireArrivedAt = arrivals[wireIdx].atMs;
      lastWire = arrivals[wireIdx].sample;
    }
    if (wireIdx < 0) continue;
    const ageMs = now - wireArrivedAt + DOWNLINK_MS;
    stepRemoteVehicleDisplay(
      s,
      lastWire.x,
      lastWire.z,
      lastWire.facing,
      lastWire.vx,
      lastWire.vz,
      lastWire.yawRate,
      ageMs,
      FRAME_MS / 1000,
    );
    const truth = trajectoryAt(now / 1000, speed, yawRate);
    errs.push(Math.hypot(s.x - truth.x, s.z - truth.z));
    let df = s.facing - truth.facing;
    while (df > Math.PI) df -= 2 * Math.PI;
    while (df < -Math.PI) df += 2 * Math.PI;
    facingErrs.push(Math.abs(df));
    if (!Number.isNaN(lastX))
      frameSpeeds.push(Math.hypot(s.x - lastX, s.z - lastZ) / (FRAME_MS / 1000));
    lastX = s.x;
    lastZ = s.z;
  }
  return { errs, facingErrs, frameSpeeds, lastWire };
}

const mean = (a: number[]): number => a.reduce((s, v) => s + v, 0) / a.length;

describe('remote vehicle display projection', () => {
  it('tracks the PRESENT pose on a straight instead of showing the past', () => {
    // Plain interpolation shows the machine downlink + one interval in the
    // past: 30 yd/s * 110 ms = 3.3 yd behind. The projection must beat that
    // by a wide margin, settled (skip the first half second of adoption).
    const { errs } = run(30, 0, 4);
    const settled = errs.slice(60);
    expect(mean(settled)).toBeLessThan(0.8);
    expect(Math.max(...settled)).toBeLessThan(1.5);
  });

  it('never freezes or dashes under per-packet jitter', () => {
    // The defect this core replaces: arrival jitter turned into dead stops
    // (up to ~30 ms at the extrapolation cap) and catch-up lunges. Projected
    // off the newest pose, the drawn speed must stay near the true 30 yd/s
    // every single frame.
    const { frameSpeeds } = run(30, 0, 4);
    const settled = frameSpeeds.slice(60);
    expect(Math.min(...settled)).toBeGreaterThan(30 * 0.5);
    expect(Math.max(...settled)).toBeLessThan(30 * 1.5);
  });

  it('keeps turning through a hairpin: the yaw is never frozen', () => {
    // 25 yd/s at 1.8 rad/s is a tight hairpin. Facing must track (the plain
    // path freezes yaw at the interpolation cap on every late packet), and
    // the midpoint-rotated projection keeps the position error near the arc.
    const { errs, facingErrs } = run(25, 1.8, 4);
    expect(mean(facingErrs.slice(60))).toBeLessThan(0.15);
    expect(mean(errs.slice(60))).toBeLessThan(1.6);
  });

  it('snaps outright on a teleport-sized correction', () => {
    const s = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(s, 0, 0, 0, 0, 30, 0, 100, 1 / 60);
    const before = { x: s.x, z: s.z };
    stepRemoteVehicleDisplay(s, 40, 200, 0, 0, 30, 0, 100, 1 / 60);
    // A 40+ yd move is a track reset, not racing: adopted in one frame.
    expect(Math.hypot(s.x - 40, s.z - 200 - 3)).toBeLessThan(0.2);
    expect(Math.hypot(s.x - before.x, s.z - before.z)).toBeGreaterThan(6);
  });

  it('caps the projection horizon on a broadcast stall', () => {
    // Deliveries stop for 600 ms mid-run: the target may advance at most
    // AGE_CAP of projection past the last wire pose, then hold, instead of
    // driving a corner the machine never took.
    const { lastWire, errs } = run(30, 0, 3, { stallFromMs: 1500, stallToMs: 2100 });
    void errs;
    const s = createRemoteVehicleDisplay();
    for (let i = 0; i < 60; i++)
      stepRemoteVehicleDisplay(
        s,
        lastWire.x,
        lastWire.z,
        lastWire.facing,
        lastWire.vx,
        lastWire.vz,
        0,
        1000 + i * FRAME_MS,
        1 / 60,
      );
    const advance = Math.hypot(s.x - lastWire.x, s.z - lastWire.z);
    expect(advance).toBeLessThanOrEqual(30 * (REMOTE_VEHICLE_AGE_CAP_MS / 1000) + 0.1);
  });

  it('adopts the target exactly on the first step and after a reset', () => {
    const s = createRemoteVehicleDisplay();
    stepRemoteVehicleDisplay(s, 5, -3, 0.4, 0, 0, 0, 0, 1 / 60);
    expect(s.x).toBeCloseTo(5);
    expect(s.z).toBeCloseTo(-3);
    expect(s.facing).toBeCloseTo(0.4);
    resetRemoteVehicleDisplay(s);
    expect(s.active).toBe(false);
    stepRemoteVehicleDisplay(s, 100, -3, 0.4, 0, 0, 0, 0, 1 / 60);
    expect(s.x).toBeCloseTo(100);
  });
});
