// The arcade driving model: throttle and brake with inertia, speed-dependent
// steering authority, a lateral grip model that lets a machine slide, a
// handbrake that breaks grip on purpose, reverse, and surface-dependent
// behavior. It is the PURE half of the vehicle kernel: it advances the drive
// state and hands back a yaw delta, and knows nothing about collision, terrain,
// entities or the world.
//
// The composing half lives in `player_motion.ts` (the `p.drive` branch at the
// top of `stepPlayerMotion`, the one shared movement entry point): it reads the
// input flags, calls in here, integrates the facing, runs the SAME swept
// collision and vertical pass the character path uses, and re-derives the drive
// velocity from the achieved displacement. Splitting it this way is what makes
// the model Node-testable directly (tests/vehicle_motion.test.ts) while keeping
// exactly one movement entry point for both hosts, so the online
// self-extrapolator predicts vehicle motion in lockstep with the server
// (tests/player_motion.test.ts).
//
// Pure leaf: no SimContext, no rng, no clock, no DOM. Every handling number
// comes from the VehicleProfile record, never from this module.

import { type VehicleProfile, vehicleProfile } from './content/vehicles';
import { DT, type VehicleDrive } from './types';

/**
 * Fraction of top speed at which steering authority peaks. Below it the
 * authority ramps in (a machine standing still cannot pivot on nothing); above
 * it the authority tapers so the circuit's straights stay stable at speed.
 */
const STEER_AUTHORITY_PEAK = 0.35;
/** Steering authority left at top speed, as a fraction of the peak. */
const STEER_AUTHORITY_AT_TOP = 0.45;
/**
 * Shape of the engine's ease-off toward top speed. A LINEAR ease-off (the
 * obvious `1 - v/max`) can never reach the top: the engine force goes to zero
 * exactly where drag is largest, so the machine settles ~20% short and the
 * profile's `maxSpeed` stops meaning anything. A quartic holds nearly full
 * thrust through the mid range and collapses only at the very top, which lands
 * the terminal speed just under the stated maximum.
 */
const ENGINE_EASE_EXPONENT = 4;
/**
 * How fast the handbrake engagement reading ramps, 1/s. PRESENTATION only (the
 * drift smoke, the tyre audio, the camera): the grip cut itself is instant, so
 * this number can never change how a machine handles and is deliberately not a
 * profile field.
 */
const HANDBRAKE_RAMP = 6;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface VehicleStepInput {
  /** -1 (brake/reverse) .. 1 (throttle). */
  throttle: number;
  /** -1 (steer right) .. 1 (steer left), matching the facing convention. */
  steer: number;
  handbrake: boolean;
  onGround: boolean;
  /**
   * The entity's aura-only speed multiplier (slows and speed buffs). It caps the
   * TOP SPEED, exactly as it caps a runner's, and deliberately does NOT tax the
   * engine as well: a snare that scaled acceleration too could leave the engine
   * weaker than the drag of a heavy surface, and a machine that slid into the
   * deepest band would be stuck there for good rather than merely slow. The
   * mount bonus is not folded in either: the driving model replaces it outright.
   */
  auraMult: number;
}

/** A fresh drive state for a pilot taking the wheel: stopped, on a clean road. */
export function createVehicleDrive(profileKey: string): VehicleDrive {
  return {
    profileKey,
    speed: 0,
    slip: 0,
    yawRate: 0,
    spin: 0,
    handbrake: 0,
    gripMult: 1,
    dragMult: 1,
    speedCap: 1,
    collisionImpact: 0,
    controlsLocked: false,
  };
}

/** Zero the MOTION, leaving the surface multipliers alone (the owning activity
 *  rewrites those every tick anyway). Used by the race start lock so a queued
 *  input cannot bank speed before GO. */
export function resetVehicleDrive(drive: VehicleDrive): void {
  drive.speed = 0;
  drive.slip = 0;
  drive.yawRate = 0;
  drive.spin = 0;
  drive.handbrake = 0;
  drive.collisionImpact = 0;
}

/** Top forward speed available right now: the profile's maximum, cut by the
 *  surface the machine is on and by any speed aura it carries. */
export function vehicleMaxSpeed(
  profile: VehicleProfile,
  drive: VehicleDrive,
  auraMult: number,
): number {
  return profile.maxSpeed * drive.speedCap * auraMult;
}

/** Top speed of the entity's CURRENT profile, for callers holding only the
 *  drive state (the online display leash sizes its budget off this). */
export function vehicleTopSpeedFor(drive: VehicleDrive, auraMult: number): number {
  return vehicleMaxSpeed(vehicleProfile(drive.profileKey), drive, auraMult);
}

/**
 * Steering authority as a function of how fast the machine is going, expressed
 * as a fraction of its top speed: 0 at a standstill, full at
 * STEER_AUTHORITY_PEAK, tapering to STEER_AUTHORITY_AT_TOP at maximum speed.
 */
export function steerAuthority(speedFraction: number): number {
  const t = clamp01(speedFraction);
  if (t <= STEER_AUTHORITY_PEAK) return t / STEER_AUTHORITY_PEAK;
  const past = (t - STEER_AUTHORITY_PEAK) / (1 - STEER_AUTHORITY_PEAK);
  return 1 - (1 - STEER_AUTHORITY_AT_TOP) * past;
}

/**
 * Advance the drive state one fixed tick and return the YAW DELTA the caller
 * must add to the entity's facing (returned rather than recomputed from
 * `yawRate`, so the body rotation applied in here and the facing integration
 * applied out there can never disagree).
 */
export function advanceVehicleDrive(
  drive: VehicleDrive,
  profile: VehicleProfile,
  input: VehicleStepInput,
): number {
  const maxSpeed = vehicleMaxSpeed(profile, drive, input.auraMult);

  // 1. Longitudinal. Throttle eases off toward the top; `back` brakes first and
  //    only becomes reverse once the machine has actually stopped. Nothing here
  //    applies while airborne: a machine in the air keeps its momentum.
  if (input.onGround) {
    if (input.throttle > 0 && maxSpeed > 0) {
      const ease = 1 - clamp01(drive.speed / maxSpeed) ** ENGINE_EASE_EXPONENT;
      drive.speed += profile.engineAccel * input.throttle * ease * DT;
    } else if (input.throttle < 0) {
      if (drive.speed > 0) {
        drive.speed = Math.max(0, drive.speed + profile.brakeDecel * input.throttle * DT);
      } else {
        drive.speed = Math.max(
          -profile.reverseMax,
          drive.speed + profile.reverseAccel * input.throttle * DT,
        );
      }
    }
    // The handbrake slows as well as slides.
    if (input.handbrake && drive.speed !== 0) {
      const bite = Math.min(Math.abs(drive.speed), profile.handbrakeDecel * DT);
      drive.speed -= Math.sign(drive.speed) * bite;
    }
    // Rolling and speed-proportional drag, always, scaled by the surface.
    if (drive.speed !== 0) {
      const drag =
        (profile.rollDrag + profile.airDrag * Math.abs(drive.speed)) * drive.dragMult * DT;
      const bite = Math.min(Math.abs(drive.speed), drag);
      drive.speed -= Math.sign(drive.speed) * bite;
    }
    // The ceiling is approached, never snapped to. On a clean road this is
    // inert (the ease-off above keeps the engine under its own maximum), so it
    // only ever runs where the ceiling FALLS under a machine already at speed:
    // leaving the circuit, or taking a snare. Assigning the new ceiling outright
    // there deletes 22 yd/s in one tick, which reads as hitting something rather
    // than as ground going soft.
    if (drive.speed > maxSpeed) {
      drive.speed = Math.max(maxSpeed, drive.speed - profile.capDecel * DT);
    }
    drive.speed = Math.max(-profile.reverseMax, drive.speed);
  }

  // 2. Steering. Authority follows the speed OVER THE GROUND, not the forward
  //    component: a drift is exactly the process of turning the one into the
  //    other, so measuring the forward component alone kills the steering at
  //    ~90 degrees of slide, precisely where a spin becomes interesting. A
  //    machine sideways at speed still has its tracks turning. In a straight
  //    line the lateral term is ~0 and this is the forward speed again.
  const groundSpeed = Math.hypot(drive.speed, drive.slip);
  const authority =
    steerAuthority(profile.maxSpeed > 0 ? groundSpeed / profile.maxSpeed : 0) *
    (input.onGround ? 1 : profile.airSteerFraction);
  // Backing up steers like a car rather than like a turret. REVERSING means the
  // forward component dominates AND points backwards; mid-slide it crosses zero
  // and its sign is noise, which would flip the braking direction and fight the
  // spin the instant the body passes ninety degrees.
  const direction = drive.speed < 0 && Math.abs(drive.speed) > Math.abs(drive.slip) ? -1 : 1;
  const targetYaw = profile.steerMaxYaw * authority * input.steer * direction;
  drive.yawRate += (targetYaw - drive.yawRate) * clamp01(profile.steerResponse * DT);
  // The contact spin turns the machine ALONGSIDE the wheel rather than through
  // it. Folding it into yawRate instead would hand it straight to the servo
  // above, which pulls back to the wheel's demand within about a tenth of a
  // second: the shove would be gone before the pilot saw it. Here it decays on
  // its own clock, so a hard hit is a real moment sideways to drive out of.
  const yawDelta = (drive.yawRate + drive.spin) * DT;
  drive.spin *= Math.exp(-profile.spinDecay * DT);

  // 3. Body rotation. The velocity vector keeps pointing where it pointed, so
  //    rotating the BODY under it is what throws the machine sideways: this
  //    exact rotation of (speed, slip) is the whole source of drift, and it
  //    conserves the velocity's magnitude, which is what makes the airborne
  //    case ballistic for free.
  const cos = Math.cos(yawDelta);
  const sin = Math.sin(yawDelta);
  const forward = drive.speed;
  const lateral = drive.slip;
  drive.speed = forward * cos - lateral * sin;
  drive.slip = lateral * cos + forward * sin;

  // 4. Grip bleeds the lateral component away exponentially. The handbrake and
  //    a loose surface both cut it, which is what produces a controllable
  //    slide; airborne there is nothing to grip.
  const grip = input.onGround
    ? profile.roadGrip * drive.gripMult * (input.handbrake ? profile.handbrakeGripFraction : 1)
    : 0;
  drive.slip *= Math.exp(-grip * DT);
  // The slide ceiling is part of the GRIP model, so it only applies with wheels
  // on the ground. Clamping it airborne would silently delete momentum from a
  // machine mid-flight (the body rotation feeds the lateral component, and past
  // the ceiling the velocity vector would shrink), which is exactly what a shell
  // or a bump launching a drifting racer would hit.
  if (input.onGround) {
    drive.slip = Math.max(-profile.maxSlip, Math.min(profile.maxSlip, drive.slip));
  }

  // 5. The engagement reading the presentation layers ride.
  const target = input.handbrake ? 1 : 0;
  const ramp = HANDBRAKE_RAMP * DT;
  drive.handbrake =
    Math.abs(target - drive.handbrake) <= ramp
      ? target
      : drive.handbrake + Math.sign(target - drive.handbrake) * ramp;

  return yawDelta;
}

/** World-space X velocity of the drive state: forward * speed + right * slip,
 *  with forward = (sin f, cos f) and right = (-cos f, sin f). */
export function vehicleVelocityX(drive: VehicleDrive, facing: number): number {
  return drive.speed * Math.sin(facing) - drive.slip * Math.cos(facing);
}

/** World-space Z velocity of the drive state. */
export function vehicleVelocityZ(drive: VehicleDrive, facing: number): number {
  return drive.speed * Math.cos(facing) + drive.slip * Math.sin(facing);
}

/**
 * Re-derive the drive velocity from the displacement the collision solver
 * ACTUALLY achieved. This is the whole wall story in two lines: scraping a
 * barrier kills the into-the-wall component and keeps the along-the-wall one,
 * so a machine slides down a wall and loses speed in proportion to the angle it
 * hit it at, with no normal extraction and no special cases.
 */
export function applyAchievedVehicleVelocity(
  drive: VehicleDrive,
  facing: number,
  achievedX: number,
  achievedZ: number,
): void {
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  drive.speed = achievedX * sin + achievedZ * cos;
  drive.slip = -achievedX * cos + achievedZ * sin;
}
