// What a pickup box GIVES: the vocabulary of neutral effects, the
// position-weighted table a take draws from, and the tuning of the two effects
// that are pure numbers on the machine itself.
//
// 22a's box always handed over a charge of the machine's own weapon. It still
// usually does, and that is the point: the common case is the one a pilot can
// plan around, and everything else is the surprise sitting on top of it. What
// changed is WHO is likely to get what. A take is ranked among the racers still
// driving, and the band that rank falls in chooses the table:
//
//  - the LEADER draws refill-heavy (they are winning; ammunition is what a
//    leader can use, and the oil slick they sometimes draw is dropped behind
//    them, which is the one hostile thing a leader is in a position to use);
//  - the BACKMARKER draws nitro and ward more often, which is the catch-up
//    weighting `00-OVERVIEW.md` asks for: LUCKIER, never strictly better. Every
//    effect on the last-place table is on the leader's table too, at a different
//    weight, so nothing is a consolation prize nobody else can win and the
//    refill is still the single likeliest draw wherever you are running.
//
// The tables are plain data, tuned in the seat. Changing the feel of the pickups
// is editing the numbers here and nothing else.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM. The DRAW takes a roll in
// [0, 1) rather than reaching for randomness, so the one `ctx.rng` draw per take
// happens at the single site in `social/realm_racers.ts` that owns the tick, and
// this module can be tested by handing it the rolls that matter.

import { TICK_RATE } from './types';

/**
 * The four things a box can hand over.
 *
 * `charge` is 22a's behavior, kept as the common case; the other three are the
 * neutral effects, which never replace the machine's signature weapon, they sit
 * beside it (settled 2026-08-04).
 */
export type RallyPickupEffect = 'charge' | 'nitro' | 'ward' | 'slick';

/**
 * The two a racer HOLDS rather than receives (the operator's mid-review override,
 * 2026-08-04): the draw fills a slot on the action bar and the pilot spends it
 * when they want. `charge` is spent the instant it is drawn (it is ammunition,
 * there is nothing to decide) and `ward` is a shield, which a pilot would arm
 * immediately anyway.
 */
export type RallyHeldEffect = 'nitro' | 'slick';

/** Is this a held effect, narrowed for the caller? */
export function isRallyHeldEffect(effect: RallyPickupEffect): effect is RallyHeldEffect {
  return effect === 'nitro' || effect === 'slick';
}

/**
 * A held effect off the WIRE, or null. The wire carries the effect NAME (the
 * server converts the kit's ability id before sending), so the decode must
 * validate a plain string against this union and never re-run the id-to-effect
 * mapper: feeding 'slick' to a mapper whose domain is ability ids answers null,
 * which is exactly the bug that left an online pilot holding an effect with no
 * button (seat report, 2026-08-04).
 */
export function rallyHeldEffectFromWire(value: string): RallyHeldEffect | null {
  return value === 'nitro' || value === 'slick' ? value : null;
}

/** Which table a take draws from, decided by where the taker is running. */
export type RallyPickupBand = 'leader' | 'midfield' | 'backmarker';

export interface RallyPickupWeight {
  effect: RallyPickupEffect;
  /** Relative weight inside its own table. Only the ratios matter; the tables
   *  deliberately share a total of 12 so they read as fractions of the same
   *  cake. */
  weight: number;
}

/**
 * The three tables, in draw order.
 *
 * `charge` is FIRST in every row on purpose: a roll of 0 is the refill in every
 * band, which makes the common case the thing at the bottom of the range rather
 * than an accident of ordering.
 */
export const REALM_RACERS_PICKUP_TABLES: Record<RallyPickupBand, readonly RallyPickupWeight[]> = {
  // Ammunition, mostly. A leader's slick is the exception that keeps the table
  // interesting: it is the one draw whose value goes UP the further ahead you
  // are, because it only ever bites the people behind you.
  leader: [
    { effect: 'charge', weight: 7 },
    { effect: 'nitro', weight: 1 },
    { effect: 'ward', weight: 1 },
    { effect: 'slick', weight: 3 },
  ],
  midfield: [
    { effect: 'charge', weight: 6 },
    { effect: 'nitro', weight: 2 },
    { effect: 'ward', weight: 2 },
    { effect: 'slick', weight: 2 },
  ],
  // Half the table is the two effects that close a gap (nitro) or survive one
  // being closed on you (ward). The refill is still the most likely single
  // outcome, so a backmarker is luckier, not armed with something else.
  backmarker: [
    { effect: 'charge', weight: 4 },
    { effect: 'nitro', weight: 4 },
    { effect: 'ward', weight: 3 },
    { effect: 'slick', weight: 1 },
  ],
};

/**
 * Which band a racer running at `rank` (0 is the leader) among `running` racers
 * still driving falls in.
 *
 * A solo field is its own leader: a practice lap against nobody must not draw
 * the catch-up table, or practice would quietly play a different game from the
 * one it exists to teach.
 */
export function rallyPickupBand(rank: number, running: number): RallyPickupBand {
  if (running <= 1 || rank <= 0) return 'leader';
  return rank >= running - 1 ? 'backmarker' : 'midfield';
}

/**
 * One draw from one table.
 *
 * `roll` is a value in [0, 1), which is exactly what `Rng.next()` hands back.
 * Out-of-range rolls are clamped rather than refused: a caller cannot produce
 * one, and a fallback that threw would turn a tuning typo into a crashed realm.
 */
export function drawRallyPickupEffect(band: RallyPickupBand, roll: number): RallyPickupEffect {
  const table = REALM_RACERS_PICKUP_TABLES[band];
  let total = 0;
  for (const row of table) total += row.weight;
  const clamped = roll < 0 ? 0 : roll >= 1 ? 0.999999 : roll;
  let cursor = clamped * total;
  for (const row of table) {
    cursor -= row.weight;
    if (cursor < 0) return row.effect;
  }
  // Unreachable while every table carries a positive total; the refill is the
  // answer that can never surprise anyone.
  return 'charge';
}

/**
 * How long a nitro burst lasts, ticks.
 *
 * Two seconds is about a hundred yards of the shipped circuits, which is a pass
 * down a straight and not a lap. Long enough to be a decision (spend it where it
 * carries), short enough that a pilot who takes one in a corner has wasted it.
 */
export const REALM_RACERS_NITRO_TICKS = 2 * TICK_RATE;

/**
 * What the burst does to the machine's top speed, as the multiplier the vehicle
 * kernel already reads (`VehicleDrive.speedCap`, folded into `vehicleMaxSpeed`).
 *
 * The kernel's own knob, not a new mechanism: the surface seam writes this every
 * tick, so a nitro is simply a tick where the ceiling is above 1 instead of at
 * it, and when the burst ends the machine SINKS onto the ordinary ceiling at the
 * profile's `capDecel` rather than losing 18 yd/s in a frame.
 */
export const REALM_RACERS_NITRO_SPEED_MULT = 1.3;

/**
 * The instant part of the burst, yd/s added to the forward speed the moment the
 * box is taken.
 *
 * Without it a nitro is a ceiling the engine then has to climb toward, which at
 * `engineAccel` 20 takes most of the burst's own duration to be felt. The kick
 * is what makes it read as a shove in the back; the raised ceiling is what lets
 * the kick survive instead of being trimmed back on the next tick.
 */
export const REALM_RACERS_NITRO_KICK = 6;
