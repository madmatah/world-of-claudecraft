// The vehicle roster, data-as-code: one declarative record per drivable
// machine. EVERY handling number the driving model uses lives here, never as a
// constant inside the kernel (src/sim/vehicle_motion.ts), so a second machine
// is a new record plus its art and audio rather than a kernel change.
//
// Exactly one profile ships today (the machine the Realm Racers loans its
// pilots). The shape is what carries the extensibility; the roster fills in
// later. A profile key names the ROLE a machine plays in an activity, never the
// machine itself: the model it wears is the `key` field below, so retiring or
// swapping the art is a one-field edit that no persisted drive state notices.

import type { MountKey } from './mounts';

export interface VehicleProfile {
  /** Mount catalog key the racer visually rides while driving this profile. */
  key: MountKey;
  /** Top forward speed on a clean road surface, yd/s. */
  maxSpeed: number;
  /**
   * How fast the machine sheds speed when its top speed suddenly DROPS under
   * it, yd/s^2. It never applies on a clean road (the engine cannot exceed its
   * own maximum), only when the ceiling falls: driving off the circuit, or a
   * snare landing. Without it the drop is a single-tick teleport from full
   * speed to the new ceiling, which reads as a collision rather than as ground
   * going soft under the tracks.
   */
  capDecel: number;
  /** Top reverse speed, yd/s (a positive magnitude). */
  reverseMax: number;
  /** Engine acceleration at rest, yd/s^2; eased off toward maxSpeed. */
  engineAccel: number;
  /** Braking deceleration while rolling forward, yd/s^2. */
  brakeDecel: number;
  /** Acceleration into reverse from a standstill, yd/s^2. */
  reverseAccel: number;
  /** Constant rolling resistance, yd/s^2. */
  rollDrag: number;
  /** Speed-proportional drag, yd/s^2 per (yd/s). */
  airDrag: number;
  /** Yaw rate at peak steering authority, rad/s. */
  steerMaxYaw: number;
  /** How fast the yaw rate reaches its target, 1/s. */
  steerResponse: number;
  /** Lateral grip on a clean road surface, 1/s (an exponential bleed rate). */
  roadGrip: number;
  /** Fraction of the road grip that survives while the handbrake is held. */
  handbrakeGripFraction: number;
  /** Extra longitudinal bite the handbrake adds, yd/s^2. */
  handbrakeDecel: number;
  /** Hard ceiling on the lateral slide, yd/s. */
  maxSlip: number;
  /**
   * How fast a contact's spin bleeds away, 1/s (an exponential decay). It sets
   * how far a shove actually turns the machine: the total rotation a kick
   * delivers is roughly the kick divided by this number, so 2.5 turns a
   * 1 rad/s kick into about 23 degrees before it is gone.
   */
  spinDecay: number;
  /** Fraction of the steering authority that survives while airborne. */
  airSteerFraction: number;
  /** Collision radius, yards; also the contact radius of a vehicle bump. */
  bodyRadius: number;
  /** Relative mass. Equal machines today; a bump split reads it as a ratio. */
  mass: number;
  /** The machine's signature weapon, resolved into the racer's kit. */
  weaponAbilityId: string;
}

/**
 * The one shipping profile, tuned by driving it. Terminal speed on a clean road
 * is ~58 yd/s (drag holds it just under the stated maximum), so a ~454 yd lap
 * runs well inside the 180 s limit for three of them even with corners. These
 * are feel numbers, arrived at in the seat; they are not defended as physics.
 */
export const VEHICLE_PROFILES: Record<string, VehicleProfile> = {
  rally_loaner: {
    key: 'terrorspark_groundshaker',
    maxSpeed: 60,
    // A quarter of a second to fall from road speed to the garden's ceiling:
    // fast enough to read as a real price the moment the tracks leave the road,
    // slow enough that it is a fall the player can see rather than a frame in
    // which 22 yd/s simply vanish.
    capDecel: 90,
    reverseMax: 30,
    engineAccel: 20,
    brakeDecel: 22,
    reverseAccel: 13,
    rollDrag: 1.5,
    airDrag: 0.02,
    steerMaxYaw: 2.6,
    steerResponse: 9,
    roadGrip: 2,
    handbrakeGripFraction: 0.03,
    handbrakeDecel: 6,
    maxSlip: 14,
    // ~1.5 s to shake off a shove: long enough to read the yaw after a bump,
    // short enough that a rub in a corner is not a lost lap.
    spinDecay: 1.6,
    airSteerFraction: 0.25,
    bodyRadius: 1.7,
    mass: 1,
    weaponAbilityId: 'rally_ground_blast',
  },
};

export const DEFAULT_VEHICLE_PROFILE_KEY = 'rally_loaner';

/** The profile behind a drive state's key, falling back to the default so a
 *  stale key from an old wire record can never crash the movement kernel. */
export function vehicleProfile(key: string): VehicleProfile {
  return VEHICLE_PROFILES[key] ?? VEHICLE_PROFILES[DEFAULT_VEHICLE_PROFILE_KEY];
}
