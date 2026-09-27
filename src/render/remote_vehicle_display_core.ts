// Display-only forward projection of REMOTE racing machines, factored out of
// the renderer so it unit-tests without a WebGL context (the net_interp_core /
// step_smooth_core pattern).
//
// A remote body is normally drawn interpolating between its last two wire
// poses, which shows it one downlink plus one snapshot interval in the past
// (~110 ms at a 120 ms RTT) and turns arrival-time jitter straight into
// freeze-and-dash: the interpolation clock chases measured arrival gaps, so a
// packet arriving late stalls the machine at the extrapolation cap and the
// next one makes it lunge. Both hurt racing specifically: rivals stutter, and
// a machine shown 110 ms in the past is 3 to 6 yards up the road on the
// server, so a visually clean lunge lands in empty space (the contact reach
// is 3.4 yd).
//
// A racing machine is the one remote body whose whole DRIVE STATE already
// rides the wire (speed/slip in the body frame, the wheel angle, yawRate,
// carried spin, the surface multipliers), so its present pose can be
// projected instead of interpolated: take the NEWEST wire pose and integrate
// the REAL vehicle model (`advanceVehicleDrive`, the same pure kernel both
// hosts drive with) forward by how old that pose is, assuming the pilot holds
// the throttle and holds the wheel where the wire last saw it. A constant-yaw
// chord was the first version and it missed exactly where contact aim
// matters: in corner entry and exit the yaw rate is CHANGING (the wheel
// winding, grip bleeding the slide), and the chord roughly doubled the
// corner error (measured 0.49 yd mean / 1.02 max over a hard-over window vs
// the kernel's 0.25 / 0.62, against a 1.7 yd body radius). The kernel
// carries the steering servo, the grip model and the spin decay through the
// horizon instead; its residual error is the rival's own input changes.
//
// Between snapshots the target moves continuously (the horizon grows with
// wall time), so arrival jitter no longer moves the display at all; on
// arrival the target steps only by the projection error accrued over one
// interval (now mostly the rival's own INPUT changes), and the glide absorbs
// it.
//
// Display-only, like self_motion.ts: the projected pose feeds the mesh and
// nothing else. Targeting, range checks and every server decision keep using
// authoritative positions (src/net/CLAUDE.md), and the projection is bounded:
// the horizon is capped, and a target far from the drawn pose snaps outright
// (teleports, track resets, respawns must not glide).

import { vehicleProfile } from '../sim/content/vehicles';
import { DT, type VehicleDrive } from '../sim/types';
import {
  advanceVehicleDrive,
  type VehicleStepInput,
  vehicleVelocityX,
  vehicleVelocityZ,
} from '../sim/vehicle_motion';
import type { SelfRenderPrediction } from './self_render_position_core';

export interface RemoteVehiclePose {
  x: number;
  z: number;
  facing: number;
}

/**
 * Projection horizon cap. The age of a freshly arrived pose is about half the
 * echo (~60 ms at 120 RTT) and grows by one snapshot interval until the next
 * arrival, so ordinary racing sits well under this. The cap only bites on a
 * broadcast stall, where projecting further would run the machine through a
 * corner it never took; past it the target holds and the glide settles.
 */
export const REMOTE_VEHICLE_AGE_CAP_MS = 250;
/**
 * Pull rate of the drawn pose toward the projected target (1/s). The target
 * is continuous between arrivals, so this rate only shows on the per-arrival
 * projection-error step; 14/s glides it in over ~70 ms, under one snapshot
 * interval.
 */
export const REMOTE_VEHICLE_SMOOTH_RATE = 14;
/** Beyond this displacement the move is a teleport or a track reset and the
 *  drawn pose adopts the target outright; racing corrections are far smaller. */
export const REMOTE_VEHICLE_SNAP_DIST = 6;
/** Facing gap that snaps rather than glides (a reset re-orients the machine). */
export const REMOTE_VEHICLE_SNAP_FACING_RAD = Math.PI / 2;

export interface RemoteVehicleDisplayState extends RemoteVehiclePose {
  active: boolean;
  /** Reused kernel scratch: the wire drive is copied in every step, so the
   *  projection never allocates and never writes into the mirrored object. */
  scratch: VehicleDrive;
  input: VehicleStepInput;
}

export function createRemoteVehicleDisplay(): RemoteVehicleDisplayState {
  return {
    active: false,
    x: 0,
    z: 0,
    facing: 0,
    scratch: {
      profileKey: '',
      speed: 0,
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
      controlsLocked: false,
    },
    // The held-input assumption: a racer is at the throttle almost every
    // moment of a race, and the wire carries no intent. A rival braking into
    // a hairpin is over-projected by well under a yard per horizon and the
    // glide absorbs the correction. Grounded always: the wire carries no
    // vertical state, and airborne machines are rare and brief.
    input: { throttle: 1, steer: 0, handbrake: false, onGround: true, auraMult: 1 },
  };
}

export function resetRemoteVehicleDisplay(s: RemoteVehicleDisplayState): void {
  s.active = false;
}

function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Advance the drawn pose one rendered frame. Writes into `s` and returns it.
 *
 * The glide is absorb-then-decay, not a plain pull toward the target: an
 * exponential smoother chasing a target that MOVES lags it by speed/rate in
 * steady state (2+ yd at racing speed), which would quietly reintroduce the
 * past-pose display this core exists to remove. Instead the drawn pose is
 * carried forward with the projection every frame (zero lag while it agrees),
 * and only the continuity gap against the fresh target, which is nonzero
 * exactly at snapshot arrivals and jitter wobbles, is absorbed and decayed.
 */
export function stepRemoteVehicleDisplay(
  s: RemoteVehicleDisplayState,
  wireX: number,
  wireZ: number,
  wireFacing: number,
  /** The mirrored wire drive state; read only, copied into the scratch. */
  drive: Readonly<VehicleDrive>,
  ageMs: number,
  dt: number,
): RemoteVehicleDisplayState {
  let remaining = Math.min(Math.max(ageMs, 0), REMOTE_VEHICLE_AGE_CAP_MS) / 1000;
  const d = s.scratch;
  d.profileKey = drive.profileKey;
  d.speed = drive.speed;
  d.slip = drive.slip;
  d.steerAngle = drive.steerAngle;
  d.yawRate = drive.yawRate;
  d.spin = drive.spin;
  d.handbrake = drive.handbrake;
  d.gripMult = drive.gripMult;
  d.dragMult = drive.dragMult;
  d.speedCap = drive.speedCap;
  d.slipCap = drive.slipCap;
  const profile = vehicleProfile(d.profileKey);
  const input = s.input;
  input.handbrake = d.handbrake > 0.5;
  let tx = wireX;
  let tz = wireZ;
  let tf = wireFacing;
  // Whole kernel ticks over the horizon (at most 5 at the cap), then a linear
  // tail for the sub-tick remainder: the same integration order as the
  // composing half in player_motion (rotate the body, then move at the
  // rotated velocity).
  while (remaining >= DT) {
    input.steer = d.steerAngle; // hold the wheel where the wire last saw it
    tf = wrapAngle(tf + advanceVehicleDrive(d, profile, input));
    tx += vehicleVelocityX(d, tf) * DT;
    tz += vehicleVelocityZ(d, tf) * DT;
    remaining -= DT;
  }
  if (remaining > 0) {
    tf = wrapAngle(tf + (d.yawRate + d.spin) * remaining);
    tx += vehicleVelocityX(d, tf) * remaining;
    tz += vehicleVelocityZ(d, tf) * remaining;
  }
  const step = Math.max(0, Math.min(dt, 1 / 30));
  if (!s.active) {
    s.active = true;
    s.x = tx;
    s.z = tz;
    s.facing = tf;
    return s;
  }
  // Where the drawn pose would be if it kept moving with the projection: the
  // continuity gap against the fresh target is the only thing to smooth. Once
  // the horizon is at the cap (a broadcast stall) the target is frozen, so
  // the carry stops too: otherwise the pose would keep sailing speed/rate
  // past the cap before the decay caught it.
  const carrying = ageMs < REMOTE_VEHICLE_AGE_CAP_MS;
  const carriedX = s.x + (carrying ? vehicleVelocityX(d, tf) * step : 0);
  const carriedZ = s.z + (carrying ? vehicleVelocityZ(d, tf) * step : 0);
  const carriedF = wrapAngle(s.facing + (carrying ? (d.yawRate + d.spin) * step : 0));
  const offX = carriedX - tx;
  const offZ = carriedZ - tz;
  const offF = wrapAngle(carriedF - tf);
  if (
    offX * offX + offZ * offZ > REMOTE_VEHICLE_SNAP_DIST * REMOTE_VEHICLE_SNAP_DIST ||
    Math.abs(offF) > REMOTE_VEHICLE_SNAP_FACING_RAD
  ) {
    s.x = tx;
    s.z = tz;
    s.facing = tf;
    return s;
  }
  const decay = Math.exp(-REMOTE_VEHICLE_SMOOTH_RATE * step);
  s.x = tx + offX * decay;
  s.z = tz + offZ * decay;
  s.facing = wrapAngle(tf + offF * decay);
  return s;
}

/** What the remote racing projection reads off a mirrored entity. */
export interface RemoteRacerMirror {
  pos: { x: number; z: number };
  facing: number;
  drive: VehicleDrive | null;
  /** Arrival time of its newest wire pose (performance.now() ms). */
  netUpdatedAt?: number;
}

/**
 * The projection horizon of a remote racer, ms: the age of its newest wire
 * pose since ARRIVAL, plus half the uplink echo when the display frame carries
 * one (a v1 SelfMotionFrame). The v2 reconciled prediction has no echo
 * channel of its own, so a v2 session projects the rival off the arrival age
 * alone, which leaves it about one downlink in the past.
 */
export function remoteRacerProjectionAgeMs(
  nowMs: number,
  netUpdatedAt: number,
  selfMotion: SelfRenderPrediction | null,
): number {
  return (
    nowMs - netUpdatedAt + (selfMotion && 'echoMs' in selfMotion ? selfMotion.echoMs * 0.5 : 0)
  );
}

/**
 * One frame of renderer.sync's remote racing branch for one view: a remote
 * entity with a drive state and a wire arrival is projected (true: draw the
 * state's pose); anything else resets a live projection (false). The one
 * place both the renderer and the latency harness step a drawn rival.
 */
export function stepRemoteRacerView<E extends RemoteRacerMirror>(
  s: RemoteVehicleDisplayState,
  e: E,
  selfMotion: SelfRenderPrediction | null,
  nowMs: number,
  dt: number,
): e is E & { drive: VehicleDrive; netUpdatedAt: number } {
  if (e.drive && e.netUpdatedAt !== undefined) {
    stepRemoteVehicleDisplay(
      s,
      e.pos.x,
      e.pos.z,
      e.facing,
      e.drive,
      remoteRacerProjectionAgeMs(nowMs, e.netUpdatedAt, selfMotion),
      dt,
    );
    return true;
  }
  if (s.active) resetRemoteVehicleDisplay(s);
  return false;
}
