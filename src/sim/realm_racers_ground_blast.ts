// The Ground Blast: where a shot lands, and what landing there does to a machine.
//
// Two decisions, both pure. WHERE: the PLAYER aims, on the ground, with the same
// reticle every ground-targeted spell in the game uses; this module owns only
// the rules that reticle obeys (a forward cone, a range band) and it is the
// authority on them, because the aim arrives over the wire and a cheat client
// can ask for anything. WHAT: a blast with a geometric falloff that pops, shoves
// and spins whatever is standing in it, applied to the same drive state the
// driving model and the contact pass write.
//
// Pure leaf: no SimContext, no rng, no clock, no entities. The match module owns
// everything this deliberately does not know about: which racers exist, when the
// impact tick arrives, the vertical pop on the entity, the grip loss, and the
// events.
//
// Aiming was auto-ranged onto the nearest rival at first, with the shot leading
// their velocity. It was dropped after the maintainer drove it: an automatic
// range that sometimes finds the rival and sometimes drops the shell beside you
// is unreadable, because nothing on screen tells you which of the two just
// happened. Leading a moving machine is now the PLAYER's job, which is the whole
// skill of the weapon, and the ground circle says exactly where the shell will
// land before they commit to it.

import { normAngle, TICK_RATE, type VehicleDrive } from './types';
import {
  addVehicleSpin,
  applyAchievedVehicleVelocity,
  vehicleVelocityX,
  vehicleVelocityZ,
} from './vehicle_motion';

/** Closest a shell may be placed, yards. A point-blank aim slides out to here
 *  rather than landing under the caster's own nose. */
export const GROUND_BLAST_MIN_RANGE = 9;
/**
 * Furthest a shell may be placed, yards. It has to cover the LEAD, not just the
 * gap: a rival twenty yards ahead at racing speed will be around fifty-five
 * yards away by the time the shell arrives, and a player who reads that
 * correctly must be able to aim there.
 */
export const GROUND_BLAST_MAX_RANGE = 70;
/** Where a shot with no aim at all lands, yards. Only a cast that arrives with
 *  no ground point takes it (a bare keybind with nothing under the cursor). */
export const GROUND_BLAST_BLIND_RANGE = 22;
/**
 * Half-angle of the aiming cone, radians: how far off the machine's nose a shell
 * may be placed. The barrel is fixed to the chassis, so a pilot lines the shot
 * up by pointing the machine, and the cone is what stops the weapon from being a
 * turret that fires backwards out of a corner.
 */
export const GROUND_BLAST_AIM_CONE_RAD = Math.PI / 4;
/** Notional shell speed, yd/s. Only ever used to turn a distance into a flight
 *  time; the shell is never stepped. */
export const GROUND_BLAST_SPEED = 110;
/** The dodge window: a close shot still gives the rival this long to react, and
 *  a long one never hangs in the air past this. */
export const GROUND_BLAST_MIN_FLIGHT = 0.45;
export const GROUND_BLAST_MAX_FLIGHT = 0.9;
/** Blast radius, yards. Measured centre to centre, so it is also the width of
 *  the prediction error a rival holding a straight line may carry and still be
 *  caught. */
export const GROUND_BLAST_RADIUS = 6;
/**
 * The full-force core, yards: a machine whose centre is this close to the
 * impact takes the whole blast, and the force only starts falling off past it.
 *
 * A player judges a hit by the HULL, not by a point: a shell that bursts under
 * the machine's own footprint reads as dead-on, and a purely linear falloff
 * paid those shots 36 to 80 percent in playtest because the centres were still
 * 1.2 to 3.8 yards apart. 1.5 sits just inside the rally machine's body radius
 * (`bodyRadius` 1.7 on the loaner, pinned against this in the tests), so only a
 * shell landing under the hull counts as a direct hit.
 */
export const GROUND_BLAST_CORE_RADIUS = 1.5;
/** Where a shell leaves the machine, yards up its nose: the Fired event's
 *  muzzle, and where a client draws a rival's shot from its drawn hull. */
export const GROUND_BLAST_MUZZLE_NOSE_YD = 2;
/**
 * Upward velocity a hit in the core adds, yd/s. THE knob for how big a hit
 * feels, and the arithmetic is simple enough to tune against directly: at
 * GRAVITY = 16 the apex is `v^2 / 32` yards and the machine is airborne for
 * `v / 8` seconds. At 12 that is a 4.5 yd apex and 1.5 s off the ground, which
 * at racing speed is roughly seventy-five yards of flight with a quarter of the
 * usual steering (`airSteerFraction`) to fight it with.
 *
 * The whole cost of a hit compounds from that number, because airborne the grip
 * model does not run: the shove below is never trimmed by `maxSlip`, and the
 * spin keeps rotating the body under a velocity that does not turn with it, so
 * the machine lands genuinely sideways and has to be caught.
 */
export const GROUND_BLAST_POP_VELOCITY = 12;
/** Horizontal shove away from the blast, yd/s in the core. It survives the
 *  whole flight (there is nothing to grip in the air), so this is how far
 *  off-line a hit really throws a rival, not just an initial nudge. */
export const GROUND_BLAST_PUSH = 22;
/**
 * Yaw kick in the core, rad/s, added to the contact SPIN rather than to the
 * steering yaw rate. The steering servo pulls `yawRate` back to the wheel's
 * demand inside about a tenth of a second, so a kick delivered there would be
 * erased before the pilot felt it; `spin` decays on the profile's own clock and
 * is what a shove has to ride (workstream 04 found this the hard way).
 *
 * Total rotation is roughly the kick divided by the profile's `spinDecay`, so
 * on the loaner 4.5 turns the machine about 130 degrees before it is spent: a
 * real spin to drive out of, and still inside the shared `MAX_VEHICLE_SPIN`
 * ceiling. The divisor is per-machine, so read it off the profile rather than
 * from here.
 */
export const GROUND_BLAST_YAW_KICK = 4.5;
/** How long a hit machine drives on ice afterwards, ticks. It starts at the
 *  moment of impact, so most of it is spent in the air and the rest covers the
 *  landing, which is where it matters. */
export const GROUND_BLAST_SHOCK_TICKS = 30;
/** Fraction of the surface's grip that survives the shock. */
export const GROUND_BLAST_SHOCK_GRIP = 0.25;

/**
 * The speed aura a hit leaves behind, as the MULTIPLIER `moveSpeedMult` reads
 * (0.6 keeps three fifths of the top speed), and how long it lasts.
 *
 * It is deliberately gentler than the 0.22 the first version applied: read the
 * right way round that was a 78% snare, and now that a hit also pops, shoves,
 * spins and de-grips the machine, the aura's job is only to put the hit in the
 * HUD's debuff row where the player can see it.
 */
export const GROUND_BLAST_CONTROL_SPEED_MULT = 0.6;
export const GROUND_BLAST_CONTROL_SECONDS = 1.5;

const clamp = (n: number, lo: number, hi: number): number => (n < lo ? lo : n > hi ? hi : n);

/** A pilot's pose, which is all the aim rules are measured against. */
export interface GroundBlastShooter {
  x: number;
  z: number;
  facing: number;
}

export interface GroundBlastAim {
  /** Impact point, decided at fire time and never revised. */
  x: number;
  z: number;
  /** Whole ticks of flight, so the ground marker's countdown and the blast can
   *  never disagree about when the shell lands. */
  flightTicks: number;
  /** The request was outside the cone or the range band and was pulled to the
   *  edge. The reticle dims on this, so a player can see the limit they are
   *  pressing against instead of guessing where the shot really went. */
  clamped: boolean;
}

/**
 * How long a shell placed that far away stays in the air. Exported because
 * anyone LEADING a moving target needs it before they choose the point: the bot
 * brain reads it, and a human reads it off how long the circle sits there.
 */
export function groundBlastFlightSeconds(distance: number): number {
  return (
    Math.round(
      clamp(distance / GROUND_BLAST_SPEED, GROUND_BLAST_MIN_FLIGHT, GROUND_BLAST_MAX_FLIGHT) *
        TICK_RATE,
    ) / TICK_RATE
  );
}

/**
 * The one authority on where a shell may be placed, shared verbatim by the
 * reticle and by the sim.
 *
 * Sharing it is the point. The circle a player commits to must be the crater
 * they get, so the client cannot own a softer rule than the server; and the
 * server cannot trust the point at all, because the aim arrives over the wire.
 * Running the same pure clamp on both sides is what makes those two facts one
 * piece of code instead of two that drift.
 *
 * Out of bounds is pulled to the EDGE rather than refused: a shot that lands
 * somewhere visible teaches the player where the limit is, while a refusal at
 * racing speed just reads as the button not working.
 *
 * `requested` null (a keybind pressed with nothing under the cursor) fires
 * straight down the nose at the blind range.
 */
export function resolveGroundBlastAim(
  shooter: GroundBlastShooter,
  requested: { x: number; z: number } | null,
): GroundBlastAim {
  let angle = 0;
  let distance = GROUND_BLAST_BLIND_RANGE;
  let clamped = false;
  if (requested) {
    const dx = requested.x - shooter.x;
    const dz = requested.z - shooter.z;
    const asked = Math.hypot(dx, dz);
    // An aim on the caster's own spot carries no direction, so there is nothing
    // to clamp toward: it is the same nothing a missing point is.
    if (asked > 1e-6) {
      const offNose = normAngle(Math.atan2(dx, dz) - shooter.facing);
      angle = clamp(offNose, -GROUND_BLAST_AIM_CONE_RAD, GROUND_BLAST_AIM_CONE_RAD);
      distance = clamp(asked, GROUND_BLAST_MIN_RANGE, GROUND_BLAST_MAX_RANGE);
      clamped = angle !== offNose || distance !== asked;
    }
  }
  const heading = shooter.facing + angle;
  // Further is slower, which is the trade the player is making when they lead a
  // rival a long way up the road: a longer flight is a longer look at the
  // circle for whoever is standing on it.
  return {
    x: shooter.x + Math.sin(heading) * distance,
    z: shooter.z + Math.cos(heading) * distance,
    flightTicks: Math.round(groundBlastFlightSeconds(distance) * TICK_RATE),
    clamped,
  };
}

/** A machine standing in a blast: its pose plus the drive state the shove is
 *  written into. */
export interface GroundBlastBody {
  x: number;
  z: number;
  facing: number;
  drive: VehicleDrive;
}

/**
 * How hard a blast at (x, z) catches a machine standing at (bx, bz): 1 across
 * the whole core (`GROUND_BLAST_CORE_RADIUS`), falling linearly from there to 0
 * at the rim, and exactly 0 outside it.
 *
 * Split out of the impact resolver so a caller can ask WHETHER a shell caught a
 * machine without the answer already having shoved it: the rally ward has to
 * decide it absorbs the hit before anything is applied, and `resolveGroundBlastImpact`
 * mutates the drive state on its way to returning the same number.
 */
export function groundBlastFalloff(bx: number, bz: number, x: number, z: number): number {
  const dist = Math.hypot(bx - x, bz - z);
  if (dist >= GROUND_BLAST_RADIUS) return 0;
  if (dist <= GROUND_BLAST_CORE_RADIUS) return 1;
  return 1 - (dist - GROUND_BLAST_CORE_RADIUS) / (GROUND_BLAST_RADIUS - GROUND_BLAST_CORE_RADIUS);
}

/** A falloff as the Hit event's per-racer list carries it: thousandths, which
 *  keeps the event small and moves a drawn pop by under a hundredth of a yard. */
export function groundBlastHitFalloffWire(falloff: number): number {
  return Math.round(falloff * 1000) / 1000;
}

export interface GroundBlastResult {
  /** 1 across the core, falling to 0 at the rim. Zero means untouched. */
  falloff: number;
  /** Upward velocity the caller must add to the body, yd/s. Returned rather
   *  than applied because the drive state carries no vertical component: the
   *  hop rides the entity's own air pass, exactly like a jump. */
  pop: number;
}

/**
 * Resolve one machine against one blast, mutating its drive state in place.
 *
 * Everything here is geometric: no rng, so the same blast on the same machine
 * always does the same thing on every host. Visual variation is the client's to
 * derive from the impact coordinates.
 */
export function resolveGroundBlastImpact(
  body: GroundBlastBody,
  x: number,
  z: number,
): GroundBlastResult {
  const dx = body.x - x;
  const dz = body.z - z;
  const dist = Math.hypot(dx, dz);
  const falloff = groundBlastFalloff(body.x, body.z, x, z);
  if (falloff <= 0) return { falloff: 0, pop: 0 };

  // Away from the blast. A machine sitting exactly on the impact point has no
  // direction to be thrown in, so it takes the pop alone: arbitrary is not an
  // option here, a draw would fork the world between hosts.
  const awayX = dist > 0 ? dx / dist : 0;
  const awayZ = dist > 0 ? dz / dist : 0;
  const push = GROUND_BLAST_PUSH * falloff;
  applyAchievedVehicleVelocity(
    body.drive,
    body.facing,
    vehicleVelocityX(body.drive, body.facing) + awayX * push,
    vehicleVelocityZ(body.drive, body.facing) + awayZ * push,
  );

  // Which side of the machine the blast went off on, as a signed unit component
  // along the body's LEFT vector (cos f, -sin f), the right vector negated. A
  // hit taken square on the nose or the tail has no side and spins nobody; a
  // glancing one slews the machine away from the blast, and the further
  // off-centre the harder.
  const side = awayX * Math.cos(body.facing) - awayZ * Math.sin(body.facing);
  // The shared add carries the one ceiling on carried spin, wherever the shove
  // came from: a machine shelled while already spinning off a contact must not
  // run away past it.
  addVehicleSpin(body.drive, GROUND_BLAST_YAW_KICK * falloff * side);

  return { falloff, pop: GROUND_BLAST_POP_VELOCITY * falloff };
}
