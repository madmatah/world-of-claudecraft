// The Realm Racers driving BRAIN: given where a machine is on the circuit
// and what is around it, decide which controls to hold this tick. It is the
// pure half of the bot, exactly as `vehicle_motion.ts` is the pure half of the
// kernel: no Sim, no SimContext, no rng, no clock, no entities. The lifecycle
// half (spawning, seating, teardown, and writing these flags into
// `meta.moveInput`) lives in `social/realm_racers_bots.ts`.
//
// The output is the SAME control set a human holds, which is the whole point: a
// bot flows through `stepPlayerMotion` and therefore through the same vehicle
// kernel, on the same surfaces, at the same top speed. A bot steering its own
// position would be a different game running beside the one the player is in.
//
// Zero rng, deliberately. These bots are driven INSIDE the sim tick on the live
// server, so a single draw here would shift the shared stream's draw order for
// every other system in the world. Every "personality" difference is a pure
// function of the tier, the bot's pid and the tick count.

import { GROUND_BLAST_AIM_CONE_RAD, groundBlastFlightSeconds } from './realm_racers_ground_blast';
import { type RallyProjection, type RallyTrackModel, rallyForwardDot } from './realm_racers_spline';
import { normAngle, TICK_RATE } from './types';

export type RallyDriverTier = 'rookie' | 'driver' | 'ace';

/** The tiers, ordered from gentlest to hardest. */
export const RALLY_DRIVER_TIERS: readonly RallyDriverTier[] = ['rookie', 'driver', 'ace'];

export function isRallyDriverTier(value: unknown): value is RallyDriverTier {
  return typeof value === 'string' && (RALLY_DRIVER_TIERS as readonly string[]).includes(value);
}

/**
 * A shell in flight, as the brain sees it: where it is going to land, and how
 * long until it does. That is exactly what the human reads off the ground
 * marker, which is the point: the bot's dodge is the player's dodge, not a
 * bot-only sense.
 */
export interface RallyDriverBlast {
  x: number;
  z: number;
  ticksToImpact: number;
}

export interface RallyDriverInput {
  /** Deterministic stagger key; the bot's pid in practice, never an identity. */
  pid: number;
  x: number;
  z: number;
  facing: number;
  /** Forward component of the machine's velocity, yd/s (negative in reverse). */
  speed: number;
  /** Lateral component, yd/s: how far sideways the machine is travelling. */
  slip: number;
  /** The circuit this race is on, as the derived model every geometric read
   *  goes through. Handed in rather than resolved here, so the brain stays a
   *  leaf that knows the shape of a circuit and nothing about which ones exist. */
  track: RallyTrackModel;
  /** Where the machine sits on the circuit, from that same track model. */
  projection: RallyProjection;
  /** Top speed available right now (profile maximum, surface, auras). */
  topSpeed: number;
  /** The nearest rival's pose and world velocity, if there is one to shoot at.
   *  The velocity is what the bot leads with, exactly as a human leads by eye. */
  rival: { x: number; z: number; vx: number; vz: number } | null;
  /** Shells in flight that are NOT this bot's own. */
  incoming: readonly RallyDriverBlast[];
  weaponReady: boolean;
  tier: RallyDriverTier;
  /** The sim tick count. A stagger key, never a clock: no wall time here. */
  tick: number;
}

export type RallyDriverMode = 'race' | 'turnAround' | 'unstick';

export interface RallyDriverOutput {
  forward: boolean;
  back: boolean;
  turnLeft: boolean;
  turnRight: boolean;
  /** Space, which the kernel reads as the handbrake while driving. */
  handbrake: boolean;
  fire: boolean;
  /** Where to place the shell, in the same frame as the input. Null unless
   *  `fire` is set. A bot aims the same ground point a player does, and leads
   *  the same way: it has no privileged shot. */
  fireAt: { x: number; z: number } | null;
  /** The speed the brain is driving to, yd/s. Exposed because it is the one
   *  decision a lap time is made of, and a test can read it directly. */
  speedTarget: number;
  mode: RallyDriverMode;
}

interface RallyDriverProfile {
  /** Ceiling as a fraction of the machine's top speed. */
  speedFraction: number;
  /** Cornering budget, yd/s^2: how much lateral acceleration the tier dares. */
  lateralBudget: number;
  /** Steering deadband, radians: how straight is straight enough. */
  deadband: number;
  /** Steering demand past which the handbrake comes out; Infinity never. */
  handbrakeAngle: number;
  /** Half-angle of the firing cone, radians. */
  fireCone: number;
  /** Ticks between firing decisions: the tier's trigger discipline. */
  firePeriod: number;
  /** How long before impact a marker is noticed, ticks; 0 never dodges. A
   *  sharper tier reads the ground sooner and so has longer to get off it. */
  dodgeLeadTicks: number;
}

/**
 * The three tiers. Everything that separates a rookie from an ace is here:
 * how fast it dares go, how tidily it holds a line, whether it can use the
 * handbrake, how disciplined its trigger is, and whether it sees a shell
 * coming. A rookie is meant to be beatable on a first attempt; an ace is meant
 * to be a real race once the track is learned.
 */
const DRIVER_PROFILES: Record<RallyDriverTier, RallyDriverProfile> = {
  rookie: {
    speedFraction: 0.82,
    lateralBudget: 26,
    deadband: 0.12,
    handbrakeAngle: Number.POSITIVE_INFINITY,
    fireCone: 0.12,
    firePeriod: 30,
    dodgeLeadTicks: 0,
  },
  driver: {
    speedFraction: 0.92,
    lateralBudget: 34,
    deadband: 0.06,
    handbrakeAngle: 0.75,
    fireCone: 0.2,
    firePeriod: 10,
    dodgeLeadTicks: 10,
  },
  ace: {
    speedFraction: 1,
    lateralBudget: 42,
    deadband: 0.03,
    handbrakeAngle: 0.5,
    fireCone: 0.28,
    firePeriod: 4,
    dodgeLeadTicks: 18,
  },
};

export function rallyDriverProfile(tier: RallyDriverTier): RallyDriverProfile {
  return DRIVER_PROFILES[tier];
}

/** Yards of circuit the aim point sits ahead, at a standstill and per yd/s. */
const LOOKAHEAD_BASE = 7;
const LOOKAHEAD_PER_SPEED = 0.28;
const LOOKAHEAD_MAX = 26;
/** How far toward the inside of the coming corner the aim point is pulled, as a
 *  fraction of the local road half-width, at a corner tight enough to be worth
 *  an apex at all. */
const APEX_FRACTION = 0.55;
/**
 * The apex-seek ramps OFF as the circuit straightens: full at a corner of
 * APEX_RADIUS_FULL yards or tighter, nothing at APEX_RADIUS_NONE or gentler.
 * Without the ramp a barely-bent straight (the start/finish line reads about
 * 480 yd of radius, not infinity) would still pull the aim point half the road
 * off centre, and the bot would weave down every straight on the lap.
 */
const APEX_RADIUS_FULL = 50;
const APEX_RADIUS_NONE = 150;
/** Braking horizon: yards of circuit scanned for the corner to slow down for. */
const BRAKE_HORIZON_BASE = 12;
const BRAKE_HORIZON_PER_SPEED = 2.2;
const BRAKE_HORIZON_STEP = 3;
/**
 * Deceleration the horizon scan assumes, yd/s^2. Deliberately UNDER the
 * profile's real brake: the scan is what decides where braking starts, and
 * assuming less than the machine has is what leaves a margin for the corner
 * arriving faster than the flat model says.
 */
const BRAKE_DECEL = 16;
/** How far over the speed target the machine may sit before the brake comes on.
 *  The gap between throttle and brake is the coast band, without which the bot
 *  chatters between the two every tick. */
const BRAKE_MARGIN = 1.06;
/** Below this ground speed the handbrake only spins the machine, never helps. */
const HANDBRAKE_MIN_SPEED = 12;
/** Forward dot under which the machine counts as pointing the wrong way. */
const WRONG_WAY_DOT = 0.15;
/** Yards past the road edge at which a machine counts as lost rather than wide. */
const RECOVERY_MARGIN = 6;
/** Ground speed under which a lost machine counts as wedged rather than moving. */
const RECOVERY_CRAWL = 2.5;
/** Ticks of one full rock-out cycle (forward half, reverse half). */
const UNSTICK_CYCLE = 24;
/** Yards ahead the recovery aim point sits, on the centerline itself. */
const RECOVERY_LOOKAHEAD = 12;
/** Range a shot is taken at, yards. Comfortably inside the auto-range's reach
 *  once the lead is added (GROUND_BLAST_MAX_RANGE is 60). */
const FIRE_RANGE = 12.5;
/**
 * How near a marked impact point the bot is willing to be when it lands, yards.
 * Wider than GROUND_BLAST_RADIUS (4) on purpose: leaving the blast by a hair is
 * a coin flip against the machine's own drift, and a margin is what makes the
 * dodge read as a driver getting out of the way.
 */
const DODGE_RADIUS = 6;
/** The dodge aims at a point this far ahead and this far to the side. Aiming at
 *  an offset point rather than straight sideways is what makes a dodge a swerve
 *  a racer could drive rather than a ninety-degree turn out of the race. */
const DODGE_AHEAD = 9;
const DODGE_SIDE = 5;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Squared distance, kept local so the leaf pulls in nothing but the track. */
function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  return dx * dx + dz * dz;
}

/** Signed steering demand from a heading to a world point, radians: positive
 *  turns left, matching the facing convention (f points along (sin f, cos f)). */
function demandTo(facing: number, fromX: number, fromZ: number, toX: number, toZ: number): number {
  return normAngle(Math.atan2(toX - fromX, toZ - fromZ) - facing);
}

/**
 * How far off the centerline the racing line runs at `s`, signed the same way
 * the projection's `lateral` is: positive toward the infield. `turnRadius`
 * carries that same sign where the circuit bends toward the infield, and the
 * inside of a corner is by definition the side it bends toward, so the offset
 * simply carries the radius's sign.
 *
 * Exported because it is the one geometric claim of the racing line and an eye
 * cannot check it: getting the sign backwards produces a bot that apexes the
 * OUTSIDE of every corner, which looks merely clumsy rather than wrong. (And
 * note the sign is NOT the pilot's left/right: the spline's normal is a plain
 * +90 degree rotation in (x, z), which in the facing convention is the pilot's
 * right-hand side.)
 */
export function rallyRacingLineOffset(track: RallyTrackModel, s: number): number {
  const sample = track.pointAt(s);
  const radius = sample.turnRadius;
  if (!Number.isFinite(radius)) return 0;
  const strength = clamp01(
    (APEX_RADIUS_NONE - Math.abs(radius)) / (APEX_RADIUS_NONE - APEX_RADIUS_FULL),
  );
  return Math.sign(radius) * sample.halfWidth * APEX_FRACTION * strength;
}

/** Where the brain wants to be `lookahead` yards up the circuit. */
function aimPoint(track: RallyTrackModel, s: number, lookahead: number): { x: number; z: number } {
  const sample = track.pointAt(s + lookahead);
  const offset = rallyRacingLineOffset(track, sample.s);
  return { x: sample.x - sample.tz * offset, z: sample.z + sample.tx * offset };
}

/**
 * The speed the machine may carry right now: the tier's ceiling, cut by every
 * corner inside the braking horizon. A corner of radius R can be taken at
 * `sqrt(budget * R)`, and being `d` yards short of it the machine may still be
 * going `sqrt(corner^2 + 2 * decel * d)`. Taking the minimum over the horizon
 * is what makes the bot brake BEFORE a corner rather than in it.
 */
function speedTargetAt(
  track: RallyTrackModel,
  s: number,
  groundSpeed: number,
  profile: RallyDriverProfile,
  ceiling: number,
) {
  const horizon = BRAKE_HORIZON_BASE + groundSpeed * BRAKE_HORIZON_PER_SPEED;
  let target = ceiling;
  for (let d = 0; d <= horizon; d += BRAKE_HORIZON_STEP) {
    const radius = Math.abs(track.pointAt(s + d).turnRadius);
    if (!Number.isFinite(radius)) continue;
    const corner = Math.sqrt(profile.lateralBudget * radius);
    if (corner >= target) continue;
    const allowed = Math.sqrt(corner * corner + 2 * BRAKE_DECEL * d);
    if (allowed < target) target = allowed;
  }
  return target;
}

/**
 * The dodge: a steering demand away from a marked impact point this machine is
 * otherwise going to be standing on when the shell arrives. Returns null when
 * there is nothing to dodge.
 *
 * Where the machine WILL be is extrapolated from its current world velocity,
 * which is the same straight-line reading the marker asks a human to make, and
 * the escape side comes from that predicted offset rather than from the shell's
 * bearing: an impact marked dead on the nose has no bearing to step off, and one
 * marked a yard to the left has an obvious answer.
 */
function dodgeDemand(input: RallyDriverInput, profile: RallyDriverProfile): number | null {
  if (profile.dodgeLeadTicks <= 0 || input.incoming.length === 0) return null;
  const fx = Math.sin(input.facing);
  const fz = Math.cos(input.facing);
  // World velocity of this machine: forward * speed + right * slip, the same
  // decomposition the driving model integrates.
  const vx = input.speed * fx - input.slip * fz;
  const vz = input.speed * fz + input.slip * fx;
  for (const blast of input.incoming) {
    if (blast.ticksToImpact < 0 || blast.ticksToImpact > profile.dodgeLeadTicks) continue;
    const flight = blast.ticksToImpact / TICK_RATE;
    let missX = input.x + vx * flight - blast.x;
    let missZ = input.z + vz * flight - blast.z;
    if (Math.hypot(missX, missZ) > DODGE_RADIUS) continue;
    if (Math.hypot(missX, missZ) < 1e-6) {
      // Predicted dead on the centre, so there is no side to step to: take the
      // machine's own right vector, deterministically rather than by a draw.
      missX = -fz;
      missZ = fx;
    }
    const away = Math.hypot(missX, missZ) || 1;
    return demandTo(
      input.facing,
      input.x,
      input.z,
      input.x + fx * DODGE_AHEAD + (missX / away) * DODGE_SIDE,
      input.z + fz * DODGE_AHEAD + (missZ / away) * DODGE_SIDE,
    );
  }
  return null;
}

/**
 * Where this bot would put a shell this tick, or null for "do not shoot".
 *
 * The LEAD is the whole shot, and it is done here rather than by the weapon:
 * placing the circle where a rival will be is exactly the skill the player
 * exercises with their mouse, so a bot that got it for free from the weapon
 * would be playing a different game. It extrapolates a straight line at the
 * rival's current velocity over the shell's flight, which is the same reading a
 * human makes and wrong in the same way (a rival who turns, brakes or takes the
 * corner is gone).
 *
 * The flight time is estimated from the CURRENT gap rather than solved against
 * the led point. Inside the bot's firing range the two differ by well under the
 * blast radius, and an exact intercept would be a sharper shot than a person can
 * take by eye.
 */
function fireAim(
  input: RallyDriverInput,
  profile: RallyDriverProfile,
): { x: number; z: number } | null {
  const rival = input.rival;
  if (!input.weaponReady || !rival) return null;
  if ((input.tick + input.pid) % profile.firePeriod !== 0) return null;
  const gap2 = dist2(input.x, input.z, rival.x, rival.z);
  if (gap2 > FIRE_RANGE * FIRE_RANGE) return null;
  const flight = groundBlastFlightSeconds(Math.sqrt(gap2));
  const aimX = rival.x + rival.vx * flight;
  const aimZ = rival.z + rival.vz * flight;
  // The barrel is fixed to the chassis: a shot the cone would clamp is a shot
  // that lands somewhere the bot did not choose, so it holds fire instead.
  const demand = demandTo(input.facing, input.x, input.z, aimX, aimZ);
  if (Math.abs(demand) > Math.min(profile.fireCone, GROUND_BLAST_AIM_CONE_RAD)) return null;
  return { x: aimX, z: aimZ };
}

const IDLE: Omit<RallyDriverOutput, 'speedTarget' | 'mode'> = {
  forward: false,
  back: false,
  turnLeft: false,
  turnRight: false,
  handbrake: false,
  fire: false,
  fireAt: null,
};

/**
 * One tick of driving. Pure: the same input always yields the same output, and
 * nothing outside the returned record is touched.
 */
export function driveRealmRacers(input: RallyDriverInput): RallyDriverOutput {
  const profile = DRIVER_PROFILES[input.tier];
  const track = input.track;
  const s = input.projection.s;
  const groundSpeed = Math.hypot(input.speed, input.slip);
  const forwardDot = rallyForwardDot(
    input.projection,
    Math.sin(input.facing),
    Math.cos(input.facing),
  );
  const wrongWay = forwardDot < WRONG_WAY_DOT;
  const lost =
    Math.abs(input.projection.lateral) > track.halfWidthAt(s) + RECOVERY_MARGIN || wrongWay;

  // Recovery aims at the CENTERLINE, never the racing line: a machine that is
  // lost wants the road back, not an apex.
  const home = track.pointAt(s + RECOVERY_LOOKAHEAD);
  const homeDemand = demandTo(input.facing, input.x, input.z, home.x, home.z);

  if (lost && groundSpeed < RECOVERY_CRAWL) {
    // Wedged: rock out. Alternating drive and reverse at full lock frees a
    // machine pinned against the garden wall, which nothing else here can do
    // (a stopped machine has no steering authority to turn on the spot with).
    // Deterministic by tick, so a replay of the same seed rocks identically.
    const reversing = input.tick % UNSTICK_CYCLE < UNSTICK_CYCLE / 2;
    // Reversing steers like a car: the kernel flips the yaw demand, so the
    // wheel goes the other way to point the nose the same way.
    const demand = reversing ? -homeDemand : homeDemand;
    return {
      ...IDLE,
      forward: !reversing,
      back: reversing,
      turnLeft: demand > 0,
      turnRight: demand < 0,
      speedTarget: 0,
      mode: 'unstick',
    };
  }

  if (wrongWay) {
    // Pointing back up the circuit with speed on: kill the speed while turning
    // the nose around. Driving on would only take the machine further the wrong
    // way, and the continuous spline progress would not credit a yard of it.
    return {
      ...IDLE,
      forward: input.speed < -RECOVERY_CRAWL,
      back: input.speed > RECOVERY_CRAWL,
      turnLeft: homeDemand > 0,
      turnRight: homeDemand < 0,
      speedTarget: 0,
      mode: 'turnAround',
    };
  }

  const lookahead = Math.min(
    LOOKAHEAD_MAX,
    LOOKAHEAD_BASE + Math.max(0, groundSpeed) * LOOKAHEAD_PER_SPEED,
  );
  const aim = aimPoint(track, s, lookahead);
  const racingDemand = demandTo(input.facing, input.x, input.z, aim.x, aim.z);
  const dodge = dodgeDemand(input, profile);
  const demand = dodge ?? racingDemand;

  const ceiling = Math.max(0, input.topSpeed) * profile.speedFraction;
  const speedTarget = speedTargetAt(track, s, groundSpeed, profile, ceiling);
  const fireAt = fireAim(input, profile);

  return {
    forward: input.speed < speedTarget,
    back: input.speed > speedTarget * BRAKE_MARGIN,
    turnLeft: demand > profile.deadband,
    turnRight: demand < -profile.deadband,
    handbrake: Math.abs(racingDemand) > profile.handbrakeAngle && groundSpeed > HANDBRAKE_MIN_SPEED,
    fire: fireAt !== null,
    fireAt,
    speedTarget,
    mode: 'race',
  };
}
