// The oil slicks: the patches of ground a spent `slick` leaves on the circuit,
// how long they last, and who drives into one.
//
// A slick is dropped UNDER the machine that spent it, which is what makes it a
// decision rather than a delivery: the oil goes into the corner the pilot
// chooses, and the machine that laid it is already past it. It is not consumed
// by the machine that hits it; it simply sits there until its lifetime runs out
// or the race ends.
//
// The pilot who dropped it is immune only until they have LEFT it once. Not
// forever: a patch laid into a hairpin is on ground its own author may well see
// again, and a trap that is safe for exactly one machine on the circuit reads as
// a rule rather than as oil. The immunity has to exist at all only because the
// drop is under the machine, so without it a pilot would catch their own patch
// on the tick they spent it.
//
// The same split as `mortar_overdrive/pickups.ts`, for the same reason: this decides
// WHERE the slicks are, WHO touched one this tick and HOW HARD it takes them,
// and `mortar_overdrive/race.ts` owns every consequence (the grip loss, the spin,
// the ward that eats a hit, the readout, the events). Both halves are driven
// from the Mortar Overdrive tick; neither knows what a race is.
//
// Pure leaf in the sense that matters here: no SimContext, no clock, no DOM,
// and deterministic. It is not side-effect free, and deliberately so: the step
// SWEEPS expired patches out of the caller's list and latches `ownerClear` on
// the ones it arms, which is bookkeeping only the geometry can do. It never
// touches the shared rng stream: which effect a box gives is decided once, at the take
// (`mortar_overdrive/pickup_effects.ts`), and everything after that is geometry plus
// one STATELESS hash (`hash2`, the same tool the circuit scenery resolves
// through). A draw here would shift the shared stream's order for every other
// system in the world.

import { hash2 } from '../rng';
import { TICK_RATE } from '../types';

/**
 * How close a machine's path has to pass a slick's centre to lose grip on it,
 * yards.
 *
 * Wider than a pickup box's catch radius, and deliberately: a box is a thing you
 * aim at and a slick is a thing you steer around, so its edge has to be where it
 * LOOKS like it is. The renderer draws the patch at exactly this radius, which
 * is the whole of why the number is exported rather than duplicated there.
 */
export const MORTAR_OVERDRIVE_SLICK_RADIUS = 2.6;

/**
 * How long a slick stays on the circuit, ticks.
 *
 * Twelve seconds is a quarter of a lap of the shipped circuits at racing pace:
 * long enough that the field behind a leader who dropped one really has to deal
 * with it, short enough that a circuit never silts up with hazards nobody
 * remembers the origin of, and short enough that the lap the leader opens is
 * mostly clean again.
 */
export const MORTAR_OVERDRIVE_SLICK_LIFETIME_TICKS = 12 * TICK_RATE;

/** How long a machine that drove through one keeps sliding, ticks. */
export const MORTAR_OVERDRIVE_SLICK_GRIP_TICKS = Math.round(1.5 * TICK_RATE);

/**
 * Fraction of the surface's grip that survives the oil.
 *
 * Harder than a Ground Blast shock (0.25) because oil is a passive trap: a shell
 * is aimed and dodgeable, a patch is driven over.
 *
 * This knob SATURATES, which is worth knowing before reaching for it: grip is
 * the rate the lateral slide bleeds away at, so the value only says how long
 * recovery takes (`1 / (roadGrip * this)`, so 3.3 s here) and the window it acts
 * over is 1.5 s. Anything below about 0.2 already means "no grip at all for the
 * whole window", and lowering it further changes nothing a pilot can feel. The
 * knobs that DO move the needle are the window (`_GRIP_TICKS`) and the spin
 * below, which is the only part of a slick that bites a machine travelling in a
 * straight line: with no lateral velocity there is nothing for grip to take.
 */
export const MORTAR_OVERDRIVE_SLICK_GRIP = 0.15;

/**
 * The lateral velocity the oil throws into a machine crossing at full speed,
 * yd/s, before the profile's slide ceiling.
 *
 * A SIDEWAYS shove, not a rotation, and that choice is the whole feel of the
 * weapon: the driving model conserves world velocity through a body rotation, so
 * a yaw impulse leaves the trajectory untouched at the instant it lands and only
 * swings the nose, which a chase camera glued to that nose reports as a violent
 * steering input. It was tried and it read as exactly that. Moving the velocity
 * instead puts the machine 11 degrees across its own nose on the first frame and
 * about ten yards off its line over the window, which on this road is most of
 * the width of it.
 *
 * Sized under the profile's `maxSlip` (14 on the loaner) so the shove that
 * arrives is the shove that was chosen rather than one the clamp rewrote, and it
 * composes with the grip loss above rather than duplicating it: the push is what
 * takes the machine off its line, the missing grip is why it cannot gather it
 * back up (at full grip this much slide would be gone in a third of a second).
 */
export const MORTAR_OVERDRIVE_SLICK_PUSH = 12;

/**
 * How far the oil raises the machine's SLIDE CEILING while it bites, as a
 * multiplier on the profile's `maxSlip`.
 *
 * Without it the shove above is nearly inert against the only pilots worth
 * shoving, which a measurement over a real ace lap says outright: a racing
 * machine carries 9.2 yd/s of slide at the median and the full 14 ceiling on one
 * cornering tick in ten, so a same-side push of 12 delivers 4.8 at the median,
 * 0.6 at the third quartile and NOTHING at the ninth decile. The weapon was
 * weakest exactly against the machines attacking hardest, which is backwards.
 *
 * Raising the ceiling rather than growing the push is the fix because a ceiling
 * is not a modifier: no value of `_PUSH` can get past a clamp. It is also the
 * true thing to say about oil, which is why it belongs on the SURFACE seam
 * (`applyVehicleSurface`, beside `gripMult` and `speedCap`) rather than on the
 * weapon: on a slick a car really does slide further than tarmac allows.
 */
export const MORTAR_OVERDRIVE_SLICK_SLIP_CAP = 2;

/**
 * Lateral speed at which a machine counts as ALREADY sliding, yd/s.
 *
 * Above it the push follows the slide (the oil takes the end that was already
 * going, the way a car steps out on a wet patch). Below it there is no slide to
 * follow and the direction comes from the geometry instead, then from the hash:
 * a machine crossing dead straight through the middle still has to be thrown
 * somewhere, and "nothing happened" is the failure this whole weapon has.
 */
export const MORTAR_OVERDRIVE_SLICK_PUSH_SLIP_FLOOR = 1.5;

/**
 * How far off the patch's centre a crossing has to be for the geometric side to
 * decide the direction, as a fraction of the radius.
 *
 * Nearer than this the side is a rounding artefact rather than a fact a pilot
 * could have read off the ground, so the hash takes over.
 */
const SLICK_PUSH_SIDE_FLOOR = 0.15;

/** Fixed key for the stateless direction hash. Any constant works; it is pinned
 *  only so a replay of the same race throws the same way on every host. */
const SLICK_PUSH_HASH_SEED = 0x5cb1c;

/**
 * The most patches one race carries at once, oldest evicted past it.
 *
 * It is a GAMEPLAY cap, not a memory one, and that is the whole reason it lives
 * here rather than in the renderer: the drawn pool is sized to this number
 * (`MORTAR_OVERDRIVE_SLICK_POOL`), so holding the sim to it is what guarantees that every
 * patch which bites is a patch a pilot can see. Sized off the arithmetic the
 * pool records: four machines, a box each about every seven seconds, a twelve
 * second lifetime, so even an all-oil race sits near seven.
 */
export const MORTAR_OVERDRIVE_SLICK_CAP = 16;

/**
 * One slick on one race's copy of the circuit.
 *
 * Coordinates are in the SPLINE's own frame, exactly like `MortarOverdrivePickupBox`: the
 * race adds its own lane origin, and the renderer's track group is already built
 * in it.
 */
export interface MortarOverdriveSlick {
  /** Stable identity for the whole of this slick's life. The wire and the
   *  renderer key off it, so a patch that expires cannot renumber the one drawn
   *  beside it into its animation. */
  id: number;
  x: number;
  z: number;
  /** Who dropped it. Immune while `ownerClear` is false, ordinary prey after. */
  ownerPid: number;
  /**
   * Whether the owner has left this patch since dropping it.
   *
   * False at the drop, since the oil goes down under their own machine, and
   * latched true the first tick they are clear of the radius. It is per PATCH
   * rather than per racer because a pilot can be standing in their newest slick
   * while an older one of their own, three corners back, is already armed
   * against them.
   */
  ownerClear: boolean;
  /** Tick it stops existing on. */
  expiresTick: number;
}

/** One machine's tick, as the slicks see it. */
export interface MortarOverdriveSlickRacer {
  pid: number;
  /** The segment this machine covered this tick, circuit-local: a machine
   *  covers about three yards a tick, which steps over a patch measured as a
   *  point. */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** False for anyone a slick may not touch: finished, retired, or held by the
   *  referee's control lock (a machine that was PUT somewhere did not drive
   *  into anything). */
  eligible: boolean;
}

export interface MortarOverdriveSlickHit {
  pid: number;
  /** `MortarOverdriveSlick.id`, not an index: the caller may drop expired slicks in the
   *  same step. */
  slick: number;
  /** Where that patch is, circuit-local. Carried on the hit rather than left to
   *  a lookup by id: the step has just measured this machine against it, and the
   *  throw the caller asks for next needs the same point. */
  x: number;
  z: number;
}

export interface MortarOverdriveSlickStep {
  /** In the order the racers were offered, which is the caller's grid order. */
  hits: readonly MortarOverdriveSlickHit[];
  /** True on a tick that swept at least one expired slick off the circuit. */
  expired: boolean;
}

export interface MortarOverdriveSlickInput {
  tick: number;
  racers: readonly MortarOverdriveSlickRacer[];
}

/**
 * Square of the distance from a point to a segment.
 *
 * The second copy of this in the race (the first is the pickup take test).
 * Left as a copy on purpose: two is not three, and the day a third arrives it
 * earns a home in `geometry2d.ts` rather than an import chain between two leaves
 * that otherwise share nothing.
 */
function distanceSqToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const raw = len2 <= 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

/**
 * Advance one race's slicks by a tick, and say who drove through one.
 *
 * MUTATES `slicks`, which is the match's own list: expired patches are removed
 * here, so the race never has to sweep them itself.
 *
 * A machine that is standing on a slick is reported EVERY tick it stays there.
 * That is the honest answer from this side (it really is still in the oil) and
 * it is the caller that decides what a repeat means: the match module refreshes
 * the grip window and announces nothing, so sitting in a puddle is not twenty
 * events a second.
 */
/**
 * Is this point still inside the patch's oil? The race asks it when the
 * NEAREST patch flips inside an overlap: leaving the remembered patch is what
 * ends a crossing, not the tie between two patches both under the machine.
 */
export function mortarOverdriveSlickContains(
  slick: MortarOverdriveSlick,
  x: number,
  z: number,
): boolean {
  const dx = x - slick.x;
  const dz = z - slick.z;
  return dx * dx + dz * dz <= MORTAR_OVERDRIVE_SLICK_RADIUS * MORTAR_OVERDRIVE_SLICK_RADIUS;
}

export function stepMortarOverdriveSlicks(
  slicks: MortarOverdriveSlick[],
  input: MortarOverdriveSlickInput,
): MortarOverdriveSlickStep {
  let expired = false;
  for (let i = slicks.length - 1; i >= 0; i--) {
    if (input.tick < slicks[i].expiresTick) continue;
    slicks.splice(i, 1);
    expired = true;
  }
  const hits: MortarOverdriveSlickHit[] = [];
  if (slicks.length === 0) return { hits, expired };
  const reach2 = MORTAR_OVERDRIVE_SLICK_RADIUS * MORTAR_OVERDRIVE_SLICK_RADIUS;
  for (const racer of input.racers) {
    // The NEAREST slick this machine's path came to, so two overlapping patches
    // hand out one grip loss rather than two. A strict `<` keeps the earliest
    // one on an exact tie, and the list is in id order (patches are appended as
    // they are dropped and only ever removed), so that is the lowest id and the
    // answer is the same on every host.
    let best: MortarOverdriveSlick | null = null;
    let bestDistance = reach2;
    for (const slick of slicks) {
      if (slick.ownerPid === racer.pid && !slick.ownerClear) {
        // Arming the owner's own patch, measured on where the machine ENDED the
        // tick rather than on the segment it drove: a machine leaving a patch is
        // still touching the ground it just crossed, so a swept test would hold
        // the immunity open forever. It never bites on the tick it arms, which
        // needs no rule of its own: being clear of the radius is exactly what
        // arming it means.
        const dx = slick.x - racer.toX;
        const dz = slick.z - racer.toZ;
        if (dx * dx + dz * dz > reach2) slick.ownerClear = true;
        continue;
      }
      if (!racer.eligible) continue;
      const distance = distanceSqToSegment(
        slick.x,
        slick.z,
        racer.fromX,
        racer.fromZ,
        racer.toX,
        racer.toZ,
      );
      if (distance < bestDistance) {
        best = slick;
        bestDistance = distance;
      }
    }
    if (best) hits.push({ pid: racer.pid, slick: best.id, x: best.x, z: best.z });
  }
  return { hits, expired };
}

/** One machine's crossing, as the throw sees it. Positions and `facing` share
 *  one frame; the caller's canonical frame is a translation of the world's, so a
 *  world facing is a canonical facing. */
export interface MortarOverdriveSlickThrowInput {
  /** Lateral velocity, yd/s, signed along the body's right vector. */
  slip: number;
  /** Forward velocity, yd/s. Negative in reverse. */
  forwardSpeed: number;
  /** The machine's top speed, yd/s: what the crossing is measured against. */
  topSpeed: number;
  facing: number;
  x: number;
  z: number;
  slickX: number;
  slickZ: number;
  /** Both only reach the deterministic hash of last resort. */
  slickId: number;
  pid: number;
}

export interface MortarOverdriveSlickThrowResult {
  /** Signed lateral velocity to add, yd/s, on the SAME axis `slip` is measured
   *  on (the body's right vector). Ready for `addVehicleSlip`, which holds it
   *  inside the profile's slide ceiling. */
  push: number;
  /** How hard the crossing was, 0 to 1. The push is already scaled by it; it is
   *  returned because the presentation scales off the same number, and a puff of
   *  smoke that disagrees with the shove is worse than no puff. */
  strength: number;
}

/**
 * Which way, and how hard, the oil throws a machine crossing it.
 *
 * The MAGNITUDE is unconditional (it follows the speed, nothing else), which is
 * the whole design: grip alone is a modifier that does nothing to a machine
 * travelling straight, and a weapon that does nothing most of the time is not a
 * weapon. The DIRECTION follows the slide when there is one, so the oil takes
 * the end that was already going.
 *
 * Deterministic, and pure: same input, same answer, on all three hosts.
 */
export function mortarOverdriveSlickThrow(
  input: MortarOverdriveSlickThrowInput,
): MortarOverdriveSlickThrowResult {
  const groundSpeed = Math.hypot(input.forwardSpeed, input.slip);
  const strength = input.topSpeed > 0 ? Math.min(1, groundSpeed / input.topSpeed) : 0;
  if (strength <= 0) return { push: 0, strength: 0 };
  return { push: MORTAR_OVERDRIVE_SLICK_PUSH * strength * slickPushDirection(input), strength };
}

/**
 * The direction, +1 or -1, in three fallbacks.
 *
 * The push shares an axis with `slip` by construction, so following the slide is
 * simply the same sign: a machine already going left is sent further left.
 */
function slickPushDirection(input: MortarOverdriveSlickThrowInput): number {
  if (Math.abs(input.slip) >= MORTAR_OVERDRIVE_SLICK_PUSH_SLIP_FLOOR) return Math.sign(input.slip);
  // No slide to follow, so the geometry answers: the offset from the patch to
  // the machine, projected on the body's right vector (-cos f, sin f). Positive
  // means the machine is off to its own right of the centre, and pushing that
  // way carries it further off the edge it clipped rather than dragging it back
  // across the oil.
  const dx = input.x - input.slickX;
  const dz = input.z - input.slickZ;
  const away = dz * Math.sin(input.facing) - dx * Math.cos(input.facing);
  if (Math.abs(away) >= SLICK_PUSH_SIDE_FLOOR * MORTAR_OVERDRIVE_SLICK_RADIUS)
    return Math.sign(away);
  // Straight through the middle: there is no fact about this crossing left to
  // read, so the answer is a stateless hash of the pair rather than a draw. It
  // is unpredictable to the pilot and identical on every host, which is the
  // whole of what is needed here.
  return hash2(input.slickId, input.pid, SLICK_PUSH_HASH_SEED) < 0.5 ? -1 : 1;
}
