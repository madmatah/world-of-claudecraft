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
// The HORIZON is where the local kart is drawn: while that kart is predicted
// (wire v2), every rival is carried into the same instant, read off the
// predictor's own tick bookkeeping (`remoteRacerHorizon`), so a touch, a lead
// or a box race on screen is the one the server resolves. Otherwise it is the
// pose's age since arrival, the frame the stood-down self is drawn in.
//
// Display-only, like self_motion.ts: the projected pose feeds the mesh and
// nothing else. Targeting, range checks and every server decision keep using
// authoritative positions (src/net/CLAUDE.md), and the projection is bounded:
// the horizon is capped, and a target far from the drawn pose snaps outright
// (teleports, track resets, respawns must not glide).

import { resolveMovement } from '../sim/colliders';
import { vehicleProfile } from '../sim/content/vehicles';
import { auraSpeedMult, GRAVITY } from '../sim/player_motion';
import {
  GROUND_BLAST_MUZZLE_NOSE_YD,
  GROUND_BLAST_POP_VELOCITY,
  GROUND_BLAST_PUSH,
} from '../sim/realm_racers_ground_blast';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import { type Aura, DT, type Entity, type VehicleDrive } from '../sim/types';
import { MAX_BUMP_IMPULSE } from '../sim/vehicle_contact';
import {
  advanceVehicleDrive,
  type VehicleStepInput,
  vehicleVelocityX,
  vehicleVelocityZ,
} from '../sim/vehicle_motion';
import {
  SELF_MOTION_HANDOFF_RATE,
  type SelfRenderPrediction,
  selfFrameLeadMs,
} from './self_render_position_core';

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
 *
 * In the local kart's time frame (`remoteRacerHorizon`) this stays the budget
 * for the pose's OWN age, and the self frame's lead rides on top of it: the
 * cap scales with the horizon instead of freezing a rival short of the self.
 */
export const REMOTE_VEHICLE_AGE_CAP_MS = 250;
/**
 * The most a rival is carried ahead of its snapshot to meet the local kart,
 * ms. A healthy link leads by about its round trip plus up to a tick of phase
 * (measured 190 to 250 ms at a 200 ms RTT, about 290 at 300). Past that the
 * held-wheel guess costs more than the frame agreement buys (its p95 error is
 * already 2.5 yd at 300 ms against a 3.4 yd contact reach), so the lead stops
 * here and a slower link sees its rivals slightly behind its own kart; a
 * starved uplink (the ack stuck while the head runs on) stops here too.
 */
export const REMOTE_VEHICLE_LEAD_CAP_MS = 350;
/**
 * How fast a lead the horizon drops or gains in one frame (the local kart
 * switching between predicted and stood down mid-race) is slewed in, 1/s: the
 * self pose's own handoff rate, so the rivals move with the kart they are
 * drawn beside instead of jumping back or ahead by the lead in one frame.
 */
export const REMOTE_VEHICLE_LEAD_SLEW_RATE = SELF_MOTION_HANDOFF_RATE;
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
/**
 * The most a server outcome changes a free machine's velocity in one tick,
 * yd/s: a contact's capped impulse and a Ground Blast's shove, which can land
 * together. A target projected over a horizon moves by that times the horizon
 * when the outcome's snapshot arrives (6.6 yd for a core shell at 300 ms), so a
 * free machine's snap distance grows by it; a held one keeps the plain rule,
 * since every reset, the grid and the tableau arrive held.
 */
export const REMOTE_VEHICLE_IMPULSE_YD_PER_S = MAX_BUMP_IMPULSE + GROUND_BLAST_PUSH;
/** Facing gap that snaps rather than glides (a reset re-orients the machine). */
export const REMOTE_VEHICLE_SNAP_FACING_RAD = Math.PI / 2;

/**
 * A Ground Blast pop drawn on a rival from the Hit event, ahead of the wire.
 *
 * `arc` draws the sim's own ballistic arc from the event frame; `settle` holds
 * the landed machine on the ground while the wire's late copy of the same hop
 * plays out (drawing it would hop the machine twice); `idle` draws the wire,
 * with `carry` (drawn minus wire height at the hand-back) decaying to zero.
 */
export interface RemoteRacerHop {
  phase: 'idle' | 'arc' | 'settle';
  /** Drawn height the arc starts from, and its launch velocity, yd and yd/s. */
  y0: number;
  vy0: number;
  /** Seconds since the arc started, and since it landed. */
  t: number;
  settleT: number;
  /** The wire has shown the hop's own lift since the arc started. */
  wireSeenAirborne: boolean;
  carry: number;
  /** The height drawn last frame: where a new arc starts. */
  lastY: number;
  /** The wire's lift over the ground last frame, and its vertical rate, yd
   *  and yd/s: a machine already in the air when the shell lands keeps the
   *  velocity it had, which the sim's pop is ADDED to. */
  lastWireLift: number;
  wireRate: number;
}

export interface RemoteVehicleDisplayState extends RemoteVehiclePose {
  active: boolean;
  hop: RemoteRacerHop;
  /** Reused kernel scratch: the wire drive is copied in every step, so the
   *  projection never writes into the mirrored object and allocates no drive
   *  of its own (a collision resolve still returns a fresh pose per step). */
  scratch: VehicleDrive;
  input: VehicleStepInput;
  /** The part of a horizon switch still being slewed in, ms (0 at rest). */
  leadCarryMs: number;
  /** Last frame's horizon over the pose age, and whether it was the self
   *  frame's (null before the first projected frame). */
  lastLeadMs: number;
  lastSelfFrame: boolean | null;
}

export function createRemoteVehicleDisplay(): RemoteVehicleDisplayState {
  return {
    active: false,
    x: 0,
    z: 0,
    facing: 0,
    hop: {
      phase: 'idle',
      y0: 0,
      vy0: 0,
      t: 0,
      settleT: 0,
      wireSeenAirborne: false,
      carry: 0,
      lastY: Number.NaN,
      lastWireLift: Number.NaN,
      wireRate: 0,
    },
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
    // glide absorbs the correction. A machine the race holds is never
    // projected at all. Grounded always: the wire carries no vertical state,
    // and airborne machines are rare and brief. `auraMult` is set per step,
    // from the rival's own slows.
    input: { throttle: 1, steer: 0, handbrake: false, onGround: true, auraMult: 1 },
    leadCarryMs: 0,
    lastLeadMs: 0,
    lastSelfFrame: null,
  };
}

export function resetRemoteVehicleDisplay(s: RemoteVehicleDisplayState): void {
  s.active = false;
  s.leadCarryMs = 0;
  s.lastSelfFrame = null;
  clearRemoteRacerHop(s.hop);
}

function clearRemoteRacerHop(hop: RemoteRacerHop): void {
  hop.phase = 'idle';
  hop.carry = 0;
  hop.lastY = Number.NaN;
  hop.lastWireLift = Number.NaN;
  hop.wireRate = 0;
}

/** Where a projected hull may go: the swept move from one pose to the next,
 *  against the colliders the server drives the machine through. */
export type RemoteVehicleResolve = (
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  radius: number,
) => { x: number; z: number };

/**
 * The rally lanes' static collision (the garden wall, the authored barriers and
 * solid dressing), swept the way the sim moves a machine through an instanced
 * region. Outside a lane the move passes through: a racing machine only ever
 * drives in one, and the lane branch of the resolve reads no world seed.
 */
export const rallyLaneResolve: RemoteVehicleResolve = (fromX, fromZ, toX, toZ, radius) =>
  realmRacersLaneAt(toX, toZ) === null
    ? { x: toX, z: toZ }
    : resolveMovement(0, fromX, fromZ, toX, toZ, radius);

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
  /** Where the horizon stops (`remoteRacerHorizon`); the arrival-age cap by default. */
  capMs = REMOTE_VEHICLE_AGE_CAP_MS,
  /** Collision for the projected path; none by default. */
  resolve: RemoteVehicleResolve | null = null,
  /** How much the horizon itself moved this frame beyond the frame's own time,
   *  ms (a slewed lead decaying): the drawn pose rides it like the projection. */
  horizonShiftMs = 0,
  /** The rival's own aura speed multiplier (`remoteRacerAuraMult`). */
  auraMult = 1,
): RemoteVehicleDisplayState {
  // A machine the race holds (the grid, a recovery, a retirement, the finished
  // tableau) does not move on the server: its movement pass returns before the
  // kernel. It is drawn at its wire pose, with no horizon and no carry.
  const held = drive.controlsLocked;
  const span = held ? 0 : Math.min(Math.max(ageMs, 0), capMs) / 1000;
  let remaining = span;
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
  d.controlsLocked = held;
  const profile = vehicleProfile(d.profileKey);
  const input = s.input;
  input.handbrake = d.handbrake > 0.5;
  input.auraMult = auraMult;
  let tx = wireX;
  let tz = wireZ;
  let tf = wireFacing;
  // Whole kernel ticks over the horizon (the cap over DT, 5 on the arrival
  // age and up to 12 in the self frame), then a linear tail for the sub-tick
  // remainder: the same integration order as the composing half in
  // player_motion (rotate the body, then move at the rotated velocity), each
  // step swept against the colliders so a long lead cannot carry a rival
  // through the garden wall.
  while (remaining >= DT) {
    input.steer = d.steerAngle; // hold the wheel where the wire last saw it
    tf = wrapAngle(tf + advanceVehicleDrive(d, profile, input));
    const nx = tx + vehicleVelocityX(d, tf) * DT;
    const nz = tz + vehicleVelocityZ(d, tf) * DT;
    if (resolve) {
      const at = resolve(tx, tz, nx, nz, profile.bodyRadius);
      tx = at.x;
      tz = at.z;
    } else {
      tx = nx;
      tz = nz;
    }
    remaining -= DT;
  }
  if (remaining > 0) {
    tf = wrapAngle(tf + (d.yawRate + d.spin) * remaining);
    const nx = tx + vehicleVelocityX(d, tf) * remaining;
    const nz = tz + vehicleVelocityZ(d, tf) * remaining;
    if (resolve) {
      const at = resolve(tx, tz, nx, nz, profile.bodyRadius);
      tx = at.x;
      tz = at.z;
    } else {
      tx = nx;
      tz = nz;
    }
  }
  const frameDt = Math.max(0, dt);
  const step = Math.min(frameDt, 1 / 30);
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
  // past the cap before the decay caught it. The carry is the WHOLE frame,
  // the time the target's horizon advanced: only the decay below is clamped,
  // since a carry clamped to a 30 fps frame left a slower client's rival a
  // steady speed x (dt - 1/30) behind its projection.
  const carrying = ageMs < capMs && !held;
  const carry = carrying ? frameDt + horizonShiftMs / 1000 : 0;
  const carriedX = s.x + vehicleVelocityX(d, tf) * carry;
  const carriedZ = s.z + vehicleVelocityZ(d, tf) * carry;
  const carriedF = wrapAngle(s.facing + (d.yawRate + d.spin) * carry);
  const offX = carriedX - tx;
  const offZ = carriedZ - tz;
  const offF = wrapAngle(carriedF - tf);
  const snapDist = REMOTE_VEHICLE_SNAP_DIST + REMOTE_VEHICLE_IMPULSE_YD_PER_S * span;
  if (
    offX * offX + offZ * offZ > snapDist * snapDist ||
    Math.abs(offF) > REMOTE_VEHICLE_SNAP_FACING_RAD
  ) {
    s.x = tx;
    s.z = tz;
    s.facing = tf;
    // A teleport or a track reset puts the machine back on the ground.
    clearRemoteRacerHop(s.hop);
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
  /** Its mirrored auras: every entity record carries them. */
  auras?: readonly Aura[];
}

/**
 * The rival's aura speed multiplier as its own server movement pass reads it
 * (`auraSpeedMult`: a Ground Blast's control slow, the off-track bands), off
 * the auras its wire record mirrors; 1 for a mirror that carries none.
 */
export function remoteRacerAuraMult(e: RemoteRacerMirror): number {
  return e.auras && e.auras.length > 0 ? auraSpeedMult(e as Entity) : 1;
}

export interface RemoteRacerHorizon {
  /** How far the newest wire pose is projected, ms. */
  ageMs: number;
  /** Where that projection stops (a stall), ms. */
  capMs: number;
}

/**
 * The projection horizon of a remote racer and its cap, written into `out`.
 *
 * While the local kart is predicted the rival is drawn in the SAME time frame:
 * its pose age since arrival plus the self frame's lead over the snapshot the
 * self pose arrived in (`selfFrameLeadMs` minus the self pose's own age). When
 * both came in one snapshot, as they do while racing, the two ages cancel and
 * the horizon is the self lead exactly, jitter-free; a rival pose older than
 * the self's keeps projecting over the difference. The cap is that lead plus
 * the arrival-age budget (`REMOTE_VEHICLE_AGE_CAP_MS`), so it grows with the
 * horizon and a stall still holds the pose's own age to the old budget.
 *
 * Otherwise the horizon is today's: the age since ARRIVAL, plus half the
 * uplink echo when the display frame carries one (a v1 SelfMotionFrame), under
 * the fixed cap. A v2 frame that is not predicting has no echo channel, which
 * leaves the rival about one downlink in the past, the frame the stood-down
 * self is drawn in.
 */
export function remoteRacerHorizon(
  nowMs: number,
  netUpdatedAt: number,
  selfMotion: SelfRenderPrediction | null,
  /** Arrival time of the local player's newest wire pose, ms. */
  selfArrivedAt: number | undefined,
  out: RemoteRacerHorizon,
): RemoteRacerHorizon {
  const poseAgeMs = nowMs - netUpdatedAt;
  const leadMs = selfFrameLeadMs(selfMotion);
  if (leadMs === null) {
    out.ageMs = poseAgeMs + (selfMotion && 'echoMs' in selfMotion ? selfMotion.echoMs * 0.5 : 0);
    out.capMs = REMOTE_VEHICLE_AGE_CAP_MS;
    return out;
  }
  const selfAgeMs = selfArrivedAt === undefined ? poseAgeMs : nowMs - selfArrivedAt;
  const leadOverArrivalMs = Math.min(Math.max(leadMs - selfAgeMs, 0), REMOTE_VEHICLE_LEAD_CAP_MS);
  out.ageMs = poseAgeMs + leadOverArrivalMs;
  out.capMs = leadOverArrivalMs + REMOTE_VEHICLE_AGE_CAP_MS;
  return out;
}

const horizonScratch: RemoteRacerHorizon = { ageMs: 0, capMs: REMOTE_VEHICLE_AGE_CAP_MS };

/** `remoteRacerHorizon`'s age alone (the latency harness records it). */
export function remoteRacerProjectionAgeMs(
  nowMs: number,
  netUpdatedAt: number,
  selfMotion: SelfRenderPrediction | null,
  selfArrivedAt?: number,
): number {
  return remoteRacerHorizon(nowMs, netUpdatedAt, selfMotion, selfArrivedAt, horizonScratch).ageMs;
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
  /** Arrival time of the local player's newest wire pose, ms. */
  selfArrivedAt?: number,
  resolve: RemoteVehicleResolve | null = rallyLaneResolve,
): e is E & { drive: VehicleDrive; netUpdatedAt: number } {
  if (e.drive && e.netUpdatedAt !== undefined) {
    const horizon = remoteRacerHorizon(
      nowMs,
      e.netUpdatedAt,
      selfMotion,
      selfArrivedAt,
      horizonScratch,
    );
    // A switch between the self frame and the arrival age moves the horizon
    // by the whole lead at once; carry that jump and let it decay.
    const selfFrame = selfFrameLeadMs(selfMotion) !== null;
    const leadMs = horizon.ageMs - (nowMs - e.netUpdatedAt);
    let shiftMs = 0;
    if (s.active) {
      const before = s.leadCarryMs;
      s.leadCarryMs *= Math.exp(-REMOTE_VEHICLE_LEAD_SLEW_RATE * Math.max(0, Math.min(dt, 1 / 30)));
      if (Math.abs(s.leadCarryMs) < 0.01) s.leadCarryMs = 0;
      // The decay moves the horizon; the switch itself does not (it is carried).
      shiftMs = s.leadCarryMs - before;
      if (s.lastSelfFrame !== null && s.lastSelfFrame !== selfFrame) {
        s.leadCarryMs += s.lastLeadMs - leadMs;
      }
    } else {
      s.leadCarryMs = 0;
    }
    s.lastSelfFrame = selfFrame;
    s.lastLeadMs = leadMs;
    stepRemoteVehicleDisplay(
      s,
      e.pos.x,
      e.pos.z,
      e.facing,
      e.drive,
      horizon.ageMs + s.leadCarryMs,
      dt,
      horizon.capMs + Math.max(0, s.leadCarryMs),
      resolve,
      shiftMs,
      remoteRacerAuraMult(e),
    );
    return true;
  }
  if (s.active) resetRemoteVehicleDisplay(s);
  return false;
}

/**
 * The drawn height of a projected machine off the wire alone. The wire's
 * vertical stays on the interpolated segment (no vy rides for a rival), so the
 * ground change between that pose and the drawn one is added to it, every
 * frame, on both horizons: a grounded machine follows the surface under where
 * it is drawn, and an airborne one keeps its height above it.
 */
export function remoteRacerDrawnY(
  wireX: number,
  wireY: number,
  wireZ: number,
  drawnX: number,
  drawnZ: number,
  ground: (x: number, z: number) => number,
): number {
  return wireY + ground(drawnX, drawnZ) - ground(wireX, wireZ);
}

/** The muzzle's height over the ground under it, yd: where the flash plays. */
export const REMOTE_RACER_MUZZLE_LIFT_YD = 1.1;

/**
 * Where a Ground Blast leaves the barrel, as the viewer draws it. A rival's
 * shell leaves the machine as DRAWN: the event's muzzle is the server pose at
 * the shot, which a projected rival has already driven past (by the lead in the
 * self frame, by the downlink stood down). The local pilot's own shot, and a
 * shooter with no live projection, keep the event's own muzzle. The target is
 * ground and stays where the server put it; `y` is the flash height over the
 * ground at the muzzle.
 */
export function remoteRacerMuzzle<S extends { x: number; z: number; sourceId: number }>(
  views: ReadonlyMap<number, { remoteVehicle: Readonly<RemoteVehicleDisplayState> }>,
  shot: S,
  selfId: number,
  ground: (x: number, z: number) => number,
): S & { y: number } {
  const display = shot.sourceId === selfId ? undefined : views.get(shot.sourceId)?.remoteVehicle;
  const x = display?.active
    ? display.x + Math.sin(display.facing) * GROUND_BLAST_MUZZLE_NOSE_YD
    : shot.x;
  const z = display?.active
    ? display.z + Math.cos(display.facing) * GROUND_BLAST_MUZZLE_NOSE_YD
    : shot.z;
  return { ...shot, x, z, y: ground(x, z) + REMOTE_RACER_MUZZLE_LIFT_YD };
}

/** Wire lift over the ground under it past which the wire is showing a hop, yd. */
export const REMOTE_RACER_WIRE_AIR_YD = 0.05;
/**
 * Longest a landed arc waits for the wire's late copy of the hop to land, s:
 * the wire trails the drawn frame by at most the projection budgets, so past
 * this the wire is not replaying the hop and is handed back at once.
 */
export const REMOTE_RACER_HOP_SETTLE_CAP_S =
  (REMOTE_VEHICLE_LEAD_CAP_MS + REMOTE_VEHICLE_AGE_CAP_MS) / 1000;

/**
 * Height gained `t` seconds into a pop launched at `vy0`, on the sim's own air
 * pass (`vy -= GRAVITY * DT; y += vy * DT` per tick): exact at every tick
 * boundary, and the smooth curve through them in between.
 */
export function remoteRacerHopRise(vy0: number, t: number): number {
  return vy0 * t - (GRAVITY * t * (t + DT)) / 2;
}

/**
 * Launch a drawn pop on a rival the server just threw, adding `pop` yd/s the
 * way the sim adds it to vy: onto the velocity a drawn arc has left, or onto
 * the wire's own vertical rate for a machine already in the air. False, and
 * nothing drawn, for a rival with no live projection: the wire (or the
 * offline sim) already carries its height.
 *
 * Drawn in the local kart's time frame, the rival's hull is already the
 * frame's lead past the snapshot the event rode in, so the arc starts that far
 * into its flight: the vertical and the horizontal share one time frame.
 */
export function startRemoteRacerHop(s: RemoteVehicleDisplayState, pop: number): boolean {
  const hop = s.hop;
  if (!s.active || !(pop > 0) || Number.isNaN(hop.lastY)) return false;
  const airborne = hop.lastWireLift > REMOTE_RACER_WIRE_AIR_YD;
  const vyLeft =
    hop.phase === 'arc'
      ? hop.vy0 - GRAVITY * hop.t
      : airborne && hop.phase === 'idle'
        ? hop.wireRate
        : 0;
  hop.phase = 'arc';
  hop.y0 = hop.lastY;
  hop.vy0 = vyLeft + pop;
  hop.t = remoteRacerHopSeedS(s);
  hop.settleT = 0;
  hop.wireSeenAirborne = false;
  hop.carry = 0;
  return true;
}

/** How far into its flight a pop starts: the self frame's current lead over
 *  the snapshot (`lastLeadMs` plus any lead still being slewed in), or 0 when
 *  the rival is drawn on its arrival age. */
export function remoteRacerHopSeedS(s: RemoteVehicleDisplayState): number {
  if (s.lastSelfFrame !== true) return 0;
  return Math.max(0, s.lastLeadMs + s.leadCarryMs) / 1000;
}

/**
 * Start a drawn pop on every rival a Ground Blast Hit event names (its
 * per-racer `hits`), at the velocity the sim applied to each. The local
 * pilot's own machine is skipped: its pop rides the prediction. Returns how
 * many drawn rivals took one.
 */
export function startRemoteRacerHops(
  views: ReadonlyMap<number, { remoteVehicle: RemoteVehicleDisplayState }>,
  event: { hits?: readonly number[] },
  selfId: number,
): number {
  const hits = event.hits;
  if (!hits) return 0;
  let started = 0;
  for (let i = 0; i + 1 < hits.length; i += 2) {
    if (hits[i] === selfId) continue;
    const display = views.get(hits[i])?.remoteVehicle;
    if (display && startRemoteRacerHop(display, GROUND_BLAST_POP_VELOCITY * hits[i + 1])) {
      started++;
    }
  }
  return started;
}

/**
 * The drawn height of a projected machine: the wire's (`remoteRacerDrawnY`)
 * unless a Ground Blast pop is being drawn ahead of it. The arc is absolute,
 * like the sim's, and lands where the ground under the drawn hull meets it;
 * the landed machine then stays down until the wire has shown and finished its
 * own copy of the hop, and hands back through a decaying offset, so the wire's
 * late hop never draws as a second one. The hand-back never RAISES a landed
 * machine into a wire that is still in the air: it waits while the wire rises,
 * and holds the drawn height while the wire comes down.
 */
export function remoteRacerDisplayY(
  s: RemoteVehicleDisplayState,
  wireX: number,
  wireY: number,
  wireZ: number,
  drawnX: number,
  drawnZ: number,
  ground: (x: number, z: number) => number,
  dt: number,
): number {
  const hop = s.hop;
  const groundDrawn = ground(drawnX, drawnZ);
  const wireLift = wireY - ground(wireX, wireZ);
  const wireDrawnY = wireLift + groundDrawn;
  const step = Math.max(0, dt);
  const lastWireLift = hop.lastWireLift;
  const wireDelta = Number.isNaN(lastWireLift) ? 0 : wireLift - lastWireLift;
  hop.wireRate = step > 0 ? wireDelta / step : 0;
  hop.lastWireLift = wireLift;
  const wireAirborne = wireLift > REMOTE_RACER_WIRE_AIR_YD;
  if (hop.phase !== 'idle' && wireAirborne) hop.wireSeenAirborne = true;
  let y = wireDrawnY;
  if (hop.phase === 'arc') {
    hop.t += step;
    const arcY = hop.y0 + remoteRacerHopRise(hop.vy0, hop.t);
    if (arcY > groundDrawn) {
      y = arcY;
    } else {
      hop.phase = 'settle';
      hop.settleT = 0;
    }
  } else if (hop.phase === 'settle') {
    hop.settleT += step;
  }
  if (hop.phase === 'settle') {
    const wireLanded = hop.wireSeenAirborne && !wireAirborne;
    const capped = hop.settleT >= REMOTE_RACER_HOP_SETTLE_CAP_S && wireDelta <= 0;
    if (wireLanded || capped) {
      hop.phase = 'idle';
      hop.carry = groundDrawn - wireDrawnY;
    } else {
      y = groundDrawn;
    }
  }
  if (hop.phase === 'idle' && hop.carry !== 0) {
    // Never eased under the ground: a hand-back caught a hair above it would
    // otherwise carry the landed machine into the road as the wire settles.
    y = Math.max(wireDrawnY + hop.carry, Math.min(wireDrawnY, groundDrawn));
    // Nor lifted into a wire still coming down: that rise is the second hop.
    if (hop.carry < 0 && wireDelta < 0 && !Number.isNaN(hop.lastY)) y = Math.min(y, hop.lastY);
    hop.carry *= Math.exp(-REMOTE_VEHICLE_SMOOTH_RATE * Math.min(step, 1 / 30));
    if (Math.abs(hop.carry) < 1e-3) hop.carry = 0;
  }
  hop.lastY = y;
  return y;
}
