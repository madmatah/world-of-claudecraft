// Driving the ONE rng draw a Realm Racers pickup takes, from a test.
//
// A take draws once off the shared stream and turns the value into an effect
// through a weighted table (`src/sim/realm_racers_pickup_effects.ts`). A suite
// that wants "this take gives a nitro" therefore has to own the value the stream
// hands back, and it must do so without quietly changing what every OTHER system
// in the tick draws, or a pickup test would be asserting about a different world
// than the one it set up.
//
// `ScriptedRng` gets as close to that as a test can: every call still advances a
// real mulberry32 stream (so the draw ORDER is unchanged, the per-draw observer
// fires exactly once per draw, and an unscripted consumer still gets a
// deterministic value) and the scripted number is substituted only in what the
// call RETURNS.
//
// The honest limit, so nothing here claims more than it does: installing it
// RESTARTS the stream from this helper's own seed rather than continuing the
// sim's. Every consumer downstream of the install therefore sees a different
// (still deterministic, still reproducible) sequence from an unscripted run. That
// is fine for what these suites assert, and it is why the counts matter: the rigs
// that use it draw NOTHING outside the pickups (no camps, npcs or ground objects
// in the test world), and every case that turns on a scripted value also asserts
// `rng.consumed`, so a value eaten by anything else fails loudly instead of
// quietly changing what the case is about.
//
// `rallyPickupRollFor` turns "I want a ward" into the number that means a ward in
// a given band, read off the shipped table rather than pinned here.

import {
  type RallyPickupBand,
  type RallyPickupEffect,
  REALM_RACERS_PICKUP_TABLES,
} from '../../src/sim/realm_racers_pickup_effects';
import { Rng } from '../../src/sim/rng';
import type { Sim } from '../../src/sim/sim';

/**
 * A roll that lands squarely on `effect` in `band`'s table: the midpoint of that
 * effect's own slice, so a weight change moves it with the table instead of
 * silently selecting the neighbour.
 */
export function rallyPickupRollFor(band: RallyPickupBand, effect: RallyPickupEffect): number {
  const table = REALM_RACERS_PICKUP_TABLES[band];
  let total = 0;
  for (const row of table) total += row.weight;
  let floor = 0;
  for (const row of table) {
    if (row.effect === effect) return (floor + row.weight / 2) / total;
    floor += row.weight;
  }
  throw new Error(`${effect} is not on the ${band} table`);
}

/** The shared stream, with a queue of values a test wants handed back next. */
export class ScriptedRng extends Rng {
  private readonly queue: number[] = [];

  /** Queue the values the next draws return, in order. */
  script(...rolls: number[]): void {
    this.queue.push(...rolls);
  }

  /** How many scripted values have been consumed so far. */
  consumed = 0;

  next(): number {
    // The real draw happens either way: the stream advances, the observer fires
    // once, and an unscripted run of the same seed sees the same sequence.
    const real = super.next();
    if (this.queue.length === 0) return real;
    this.consumed++;
    return this.queue.shift() as number;
  }
}

/**
 * Put a scripted stream behind a live `Sim`.
 *
 * `ctx.rng` is a live view of `sim.rng`, so every module reached from the tick
 * picks this up immediately. The seed is this helper's own (see the header's
 * limit note), so two runs of the same script agree with each other but not with
 * an unscripted run of the same world.
 */
export function installScriptedRng(sim: Sim, seed = 1234): ScriptedRng {
  const rng = new ScriptedRng(seed);
  (sim as unknown as { rng: Rng }).rng = rng;
  return rng;
}
