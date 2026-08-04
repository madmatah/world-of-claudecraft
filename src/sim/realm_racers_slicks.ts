// The oil slicks: the patches of ground a drawn `slick` leaves on the circuit,
// how long they last, and who drives into one.
//
// A slick is dropped AT the row the box stood in, which is what makes it a
// rearward weapon by construction: the machine that took the box is already
// past, and whoever is following crosses the same row a moment later. It is not
// consumed by the machine that hits it, and it never bites the pilot who
// dropped it; it simply sits there until its lifetime runs out or the race ends.
//
// The same split as `realm_racers_pickups.ts`, for the same reason: this decides
// WHERE the slicks are and WHO touched one this tick, and
// `social/realm_racers.ts` owns every consequence (the grip loss, the ward that
// eats a hit, the readout, the events). Both halves are driven from the rally
// tick; neither knows what a race is.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM. It draws NO randomness at
// all: which effect a box gives is decided once, at the take
// (`realm_racers_pickup_effects.ts`), and everything after that is geometry.

import { TICK_RATE } from './types';

/**
 * How close a machine's path has to pass a slick's centre to lose grip on it,
 * yards.
 *
 * Wider than a pickup box's catch radius, and deliberately: a box is a thing you
 * aim at and a slick is a thing you steer around, so its edge has to be where it
 * LOOKS like it is. The renderer draws the patch at exactly this radius, which
 * is the whole of why the number is exported rather than duplicated there.
 */
export const REALM_RACERS_SLICK_RADIUS = 2.6;

/**
 * How long a slick stays on the circuit, ticks.
 *
 * Twelve seconds is a quarter of a lap of the shipped circuits at racing pace:
 * long enough that the field behind a leader who dropped one really has to deal
 * with it, short enough that a circuit never silts up with hazards nobody
 * remembers the origin of, and short enough that the lap the leader opens is
 * mostly clean again.
 */
export const REALM_RACERS_SLICK_LIFETIME_TICKS = 12 * TICK_RATE;

/** How long a machine that drove through one keeps sliding, ticks. */
export const REALM_RACERS_SLICK_GRIP_TICKS = Math.round(1.5 * TICK_RATE);

/**
 * Fraction of the surface's grip that survives the oil.
 *
 * Harder than a Ground Blast shock (0.25) because it is the WHOLE of what a
 * slick does: it never pops, shoves or spins anyone, so if it did not take the
 * grip away properly it would be a patch of ground with no consequence.
 */
export const REALM_RACERS_SLICK_GRIP = 0.15;

/**
 * The most patches one race carries at once, oldest evicted past it.
 *
 * It is a GAMEPLAY cap, not a memory one, and that is the whole reason it lives
 * here rather than in the renderer: the drawn pool is sized to this number
 * (`RALLY_SLICK_POOL`), so holding the sim to it is what guarantees that every
 * patch which bites is a patch a pilot can see. Sized off the arithmetic the
 * pool records: four machines, a box each about every seven seconds, a twelve
 * second lifetime, so even an all-oil race sits near seven.
 */
export const REALM_RACERS_SLICK_CAP = 16;

/**
 * One slick on one race's copy of the circuit.
 *
 * Coordinates are in the SPLINE's own frame, exactly like `RallyPickupBox`: the
 * race adds its own lane origin, and the renderer's track group is already built
 * in it.
 */
export interface RallySlick {
  /** Stable identity for the whole of this slick's life. The wire and the
   *  renderer key off it, so a patch that expires cannot renumber the one drawn
   *  beside it into its animation. */
  id: number;
  x: number;
  z: number;
  /** Who dropped it. They are never caught by their own oil. */
  ownerPid: number;
  /** Tick it stops existing on. */
  expiresTick: number;
}

/** One machine's tick, as the slicks see it. */
export interface RallySlickRacer {
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

export interface RallySlickHit {
  pid: number;
  /** `RallySlick.id`, not an index: the caller may drop expired slicks in the
   *  same step. */
  slick: number;
}

export interface RallySlickStep {
  /** In the order the racers were offered, which is the caller's grid order. */
  hits: readonly RallySlickHit[];
  /** True on a tick that swept at least one expired slick off the circuit. */
  expired: boolean;
}

export interface RallySlickInput {
  tick: number;
  racers: readonly RallySlickRacer[];
}

/**
 * Square of the distance from a point to a segment.
 *
 * The second copy of this in the rally (the first is the pickup take test).
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
export function stepRealmRacersSlicks(
  slicks: RallySlick[],
  input: RallySlickInput,
): RallySlickStep {
  let expired = false;
  for (let i = slicks.length - 1; i >= 0; i--) {
    if (input.tick < slicks[i].expiresTick) continue;
    slicks.splice(i, 1);
    expired = true;
  }
  const hits: RallySlickHit[] = [];
  if (slicks.length === 0) return { hits, expired };
  const reach2 = REALM_RACERS_SLICK_RADIUS * REALM_RACERS_SLICK_RADIUS;
  for (const racer of input.racers) {
    if (!racer.eligible) continue;
    // The NEAREST slick this machine's path came to, so two overlapping patches
    // hand out one grip loss rather than two. A strict `<` keeps the earliest
    // one on an exact tie, and the list is in id order (patches are appended as
    // they are dropped and only ever removed), so that is the lowest id and the
    // answer is the same on every host.
    let best: RallySlick | null = null;
    let bestDistance = reach2;
    for (const slick of slicks) {
      if (slick.ownerPid === racer.pid) continue;
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
    if (best) hits.push({ pid: racer.pid, slick: best.id });
  }
  return { hits, expired };
}
