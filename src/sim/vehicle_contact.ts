// Wheel-to-wheel contact between two vehicles: depenetration, a reciprocal
// impulse along the contact normal, and a scrub that costs the aggressor speed
// too. Nudging a rival wide on corner entry is a tactic; being nudged is
// recoverable rather than fatal.
//
// Pure leaf: no SimContext, no rng, no clock, no colliders. It takes two plain
// bodies, mutates their positions and their drive velocities, and reports the
// closing speed so the caller can decide whether that was an impact worth an
// event. The caller owns everything this deliberately does not know about:
// re-clamping both bodies through static collision (so a bump against the
// garden wall pushes along it rather than through it), re-bucketing them, and
// throttling the event.
//
// Masses and radii are PARAMETERS, never module constants. Equal masses reduce
// the split below to the obvious even one, so today's two identical machines are
// the simple case of the general formula rather than a special case that a
// roster of machines would have to rewrite.

import type { VehicleDrive } from './types';
import {
  addVehicleSpin,
  applyAchievedVehicleVelocity,
  vehicleVelocityX,
  vehicleVelocityZ,
} from './vehicle_motion';

/** How much of the closing speed comes back as bounce. Mostly absorbed: two
 *  machines leaning on each other should settle, not ping apart. */
const BUMP_RESTITUTION = 0.6;
/**
 * Ceiling on the exchanged impulse. With unit masses this is exactly the
 * largest velocity change one contact can hand a body, so a machine launched by
 * a shell landing on a rival cannot cannon it off the circuit.
 */
export const MAX_BUMP_IMPULSE = 39;
/** Fraction of the closing speed both bodies lose as FORWARD speed on top of
 *  the impulse, which is what makes ramming cost the rammer. */
const BUMP_SCRUB = 0.22;
/** How much of the scrub a body pointing its nose into the contact keeps. Kept
 *  modest on purpose: a committed dive into a corner should be worth a little
 *  over a lazy sideswipe, not be a ram-to-win button. */
export const BUMP_NOSE_BONUS = 0.35;
/**
 * Base scrape spin per yd/s of tangential closing, rad/s. The push itself runs
 * through both centers and cannot yaw anyone; rotation comes from how fast the
 * carcasses slide past each other. How that kick is SHARED is arcade, not disc
 * friction: the receiver takes most of it (nudged wide), the aggressor keeps
 * their heading (see BUMP_SPIN_ATTACKER / BUMP_SPIN_VICTIM).
 */
export const BUMP_SPIN = 0.28;
/**
 * Scrape-spin scale on the aggressor (nose into the contact and/or closing
 * along the normal). Negative is a small push-off away from the rival so a
 * dive does not suck the rammer into the machine they just hit.
 */
export const BUMP_SPIN_ATTACKER = -0.25;
/** Scrape-spin scale on the receiver: full kick, turned wide of the contact. */
export const BUMP_SPIN_VICTIM = 1;

export interface ContactBody {
  x: number;
  z: number;
  facing: number;
  drive: VehicleDrive;
  /** Contact radius, yards. The VehicleProfile's `bodyRadius`, which is also
   *  the radius the movement kernel sweeps: one value, one meaning. */
  radius: number;
  /** Relative mass. Equal today; the split below reads it as a ratio. */
  mass: number;
}

export interface ContactResult {
  contacted: boolean;
  /** Closing speed along the contact normal, yd/s. Zero when the bodies were
   *  already separating (they still get depenetrated, but no impulse). */
  impact: number;
  /** Contact midpoint after depenetration, for the caller's event anchor. */
  x: number;
  z: number;
}

/** Bleed a body's forward speed toward zero, never through it: a scrub slows a
 *  machine, it never reverses one. */
function scrubForwardSpeed(drive: VehicleDrive, amount: number): void {
  if (amount <= 0 || drive.speed === 0) return;
  drive.speed = Math.sign(drive.speed) * Math.max(0, Math.abs(drive.speed) - amount);
}

/**
 * Resolve one contact, mutating both bodies in place.
 *
 * Order independent by construction: swapping the arguments flips the normal
 * with it, so every term below mirrors rather than changing. That is what keeps
 * the pair order (which comes from the match's racer order) out of the result,
 * and what makes a grid of more than two pilots a loop over unordered pairs
 * rather than a rewrite.
 */
export function resolveVehicleContact(a: ContactBody, b: ContactBody): ContactResult {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const reach = a.radius + b.radius;
  if (dist >= reach) {
    return { contacted: false, impact: 0, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
  }

  // The separation normal, pointing from A to B. Exactly concentric bodies have
  // no normal to read, so they fall back to A's right vector: arbitrary, but
  // DETERMINISTIC, which is the only property that matters (a random nudge here
  // would fork the world between hosts).
  const nx = dist > 0 ? dx / dist : -Math.cos(a.facing);
  const nz = dist > 0 ? dz / dist : Math.sin(a.facing);

  // Depenetration, split by mass share: the lighter body gives more ground.
  const overlap = reach - dist;
  const shareA = b.mass / (a.mass + b.mass);
  a.x -= nx * overlap * shareA;
  a.z -= nz * overlap * shareA;
  b.x += nx * overlap * (1 - shareA);
  b.z += nz * overlap * (1 - shareA);
  const midX = (a.x + b.x) / 2;
  const midZ = (a.z + b.z) / 2;

  const relN = applyContactImpulse(a, b, nx, nz);
  // Already moving apart: separating them is the whole correction. Applying an
  // impulse here would suck two bodies that had settled back into each other.
  if (relN <= 0) return { contacted: true, impact: 0, x: midX, z: midZ };
  return { contacted: true, impact: relN, x: midX, z: midZ };
}

/**
 * The velocity half of a contact: spin split, reciprocal impulse, scrub, all
 * along an established normal. Returns the closing speed, applying NOTHING
 * when the pair is already separating. Extracted verbatim from the same-tick
 * resolver: the float ops and their order are unchanged, which is what keeps
 * the parity traces intact.
 */
function applyContactImpulse(a: ContactBody, b: ContactBody, nx: number, nz: number): number {
  let avx = vehicleVelocityX(a.drive, a.facing);
  let avz = vehicleVelocityZ(a.drive, a.facing);
  let bvx = vehicleVelocityX(b.drive, b.facing);
  let bvz = vehicleVelocityZ(b.drive, b.facing);
  const relN = (avx - bvx) * nx + (avz - bvz) * nz;
  if (relN <= 0) return relN;

  const noseA = Math.max(0, Math.sin(a.facing) * nx + Math.cos(a.facing) * nz);
  const noseB = Math.max(0, Math.sin(b.facing) * -nx + Math.cos(b.facing) * -nz);
  // Who is driving the contact: nose into it, and/or closing along the normal.
  // The receiver takes the yaw (nudged wide); the aggressor keeps their heading
  // (a small opposite kick so a dive does not pull them in).
  const approachA = Math.max(0, avx * nx + avz * nz);
  const approachB = Math.max(0, -(bvx * nx + bvz * nz));
  const attackA = noseA + approachA;
  const attackB = noseB + approachB;
  const attackSum = attackA + attackB;
  const blendA = attackSum > 0 ? attackA / attackSum : 0.5;
  const blendB = attackSum > 0 ? attackB / attackSum : 0.5;
  const scaleA = BUMP_SPIN_VICTIM + (BUMP_SPIN_ATTACKER - BUMP_SPIN_VICTIM) * blendA;
  const scaleB = BUMP_SPIN_VICTIM + (BUMP_SPIN_ATTACKER - BUMP_SPIN_VICTIM) * blendB;

  const relT = (avx - bvx) * -nz + (avz - bvz) * nx;
  const kick = BUMP_SPIN * relT;
  addVehicleSpin(a.drive, (kick * scaleA) / a.mass);
  addVehicleSpin(b.drive, (kick * scaleB) / b.mass);

  const j = Math.min(MAX_BUMP_IMPULSE, ((1 + BUMP_RESTITUTION) * relN) / (1 / a.mass + 1 / b.mass));
  avx -= (nx * j) / a.mass;
  avz -= (nz * j) / a.mass;
  bvx += (nx * j) / b.mass;
  bvz += (nz * j) / b.mass;
  // Back into each body's own frame, the same re-derivation the wall scrape
  // uses: the exchange is done in world space, the drive state lives in the
  // body frame, and this is the one conversion between them.
  applyAchievedVehicleVelocity(a.drive, a.facing, avx, avz);
  applyAchievedVehicleVelocity(b.drive, b.facing, bvx, bvz);

  const scrub = BUMP_SCRUB * relN;
  scrubForwardSpeed(a.drive, scrub * (1 - BUMP_NOSE_BONUS * noseA));
  scrubForwardSpeed(b.drive, scrub * (1 - BUMP_NOSE_BONUS * noseB));

  return relN;
}

/** A contact body plus the position it STARTED the tick at (Entity.prevPos):
 *  together they are the segment the body covered this tick. */
export interface SweptContactBody extends ContactBody {
  prevX: number;
  prevZ: number;
}

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Resolve one contact with the tick's motion swept in, mutating both bodies in
 * place exactly like `resolveVehicleContact`.
 *
 * The discrete end-of-tick overlap misses a pair whose combined closing speed
 * covers more than the contact reach inside one tick (~68 yd/s at the loaner's
 * 3.4 yd reach): a head-on meeting at race speed, or a machine a shell threw
 * across the road, passes clean through between two tests. When the endpoints
 * are separated, this solves the two traversed segments (linear motion within
 * the tick, the same assumption every interpolation in this codebase makes)
 * for their FIRST TOUCH, the earliest instant the pair came within reach;
 * both bodies are moved a hair past that configuration and the ordinary
 * resolver runs there, so the impulse, spin, scrub and depenetration are the
 * ones a same-tick overlap would have produced at the moment of collision.
 *
 * First touch, not closest approach, and the distinction is the physics: for
 * a crossing pair the closest-approach normal is nearly PERPENDICULAR to the
 * relative motion (two machines meeting head-on read as a zero-impulse side
 * graze there), while the touch normal carries the honest frontal component.
 * The hair past it exists because exactly ON the reach the resolver's
 * `dist >= reach` arm refuses, and it is capped at the closest approach so
 * the evaluated pose can never re-separate.
 *
 * A pair already inside reach at the START of the tick falls out naturally
 * (its first touch is in the past, outside [0, 1]): that is last tick's
 * contact finishing its depenetration, and re-resolving it would yank two
 * settled machines back together every other tick.
 *
 * Pure and order-independent like the discrete resolver: swapping the
 * arguments mirrors every term.
 */
export function resolveVehicleContactSwept(
  a: SweptContactBody,
  b: SweptContactBody,
): ContactResult {
  const discrete = resolveVehicleContact(a, b);
  if (discrete.contacted) return discrete;
  const reach = a.radius + b.radius;
  const px = b.prevX - a.prevX;
  const pz = b.prevZ - a.prevZ;
  const vx = b.x - b.prevX - (a.x - a.prevX);
  const vz = b.z - b.prevZ - (a.z - a.prevZ);
  const vv = vx * vx + vz * vz;
  // The sweep arm wakes ONLY for a pair whose relative motion covers the
  // whole reach inside the tick, the one case the discrete test can actually
  // tunnel through. Below that, an interior dip under the reach is a
  // centimeters-deep graze between two separated endpoints: physically
  // nothing, and firing on it is what broke the relocated-circuit
  // translation invariance (each such graze sits at the exact threshold,
  // where the float noise of a big coordinate offset flips it).
  if (vv < reach * reach) return discrete;
  const bq = px * vx + pz * vz;
  if (bq >= 0) return discrete; // never approaching inside this tick
  // |p + t v|^2 = reach^2, earliest root: the first instant within reach.
  const c0 = px * px + pz * pz - reach * reach;
  const disc = bq * bq - vv * c0;
  if (disc <= 0) return discrete; // the segments never come within reach
  const tTouch = (-bq - Math.sqrt(disc)) / vv;
  if (tTouch < 0 || tTouch >= 1) return discrete;
  const t = Math.min(tTouch + 1e-3, clamp01(-bq / vv));
  a.x = a.prevX + (a.x - a.prevX) * t;
  a.z = a.prevZ + (a.z - a.prevZ) * t;
  b.x = b.prevX + (b.x - b.prevX) * t;
  b.z = b.prevZ + (b.z - b.prevZ) * t;
  return resolveVehicleContact(a, b);
}
