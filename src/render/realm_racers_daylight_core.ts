// What hour a Realm Racers circuit is lit at: the pure resolve behind
// `RealmRacersCircuit.timeOfDay`.
//
// A circuit is the one outdoor place in the world that does NOT take the world's
// clock. The instance band belongs to no zone, a race lasts a few minutes, and
// the shared cycle is UTC-anchored, so a circuit on the live clock is a bright
// afternoon or a near-black night depending on when the queue popped: a practice
// lap is lit unlike the race it practises for, and how dark the road a pilot has
// to read is decided by nothing an author chose. Naming the hour on the record
// makes a circuit's light part of its design, the way its sky and its music
// already are.
//
// A render pure core: no Three, no DOM, and NO CLOCK of its own. The caller
// hands in the live phase and the dev override, so a Vitest drives every
// combination by hand.
//
// Why the ids live sim-side (`REALM_RACERS_TIME_OF_DAY_IDS`) and the phases
// live here: the editor's picker and the metrics readout resolve against the
// vocabulary and may not import render code, while a cycle phase means nothing
// without `day_night_core.ts`'s parameterization, which is render's.

import { REALM_RACERS_TIME_OF_DAY_IDS } from '../sim/content/realm_racers_circuits';

/**
 * The cycle phase each authored hour stands at, in `day_night_core.ts`'s own
 * parameterization: 0 is midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset.
 *
 * The two horizon crossings sit exactly ON the crossing rather than beside it,
 * because that is where the grade's dusk warmth and the long shadows both peak
 * and it is the whole reason to stage a race there. `night` is deliberately not
 * `midnight`: it is the early evening, dark enough that the lamps carry the road
 * while the sky still holds a little colour, which is the racing night. Midnight
 * is the black one, and a circuit that names it means it.
 *
 * `morning` and `afternoon` sit a little tighter around noon than an even
 * spacing would put them, and the reason is the lamps rather than the light:
 * the lamplighter is out well before the sun nears the horizon
 * (`night_lighting_core.ts`), and a circuit that names a daylight hour but
 * races under lit lamps is not the hour it named. Pinned in
 * `tests/realm_racers_daylight.test.ts`.
 */
export const REALM_RACERS_TIME_OF_DAY_PHASE: Readonly<Record<string, number>> = {
  dawn: 0.25,
  morning: 0.38,
  noon: 0.5,
  afternoon: 0.62,
  dusk: 0.75,
  night: 0.86,
  midnight: 0,
};

/** The hours in the vocabulary's own order, for a picker that wants no guessing
 *  about which module is the source. */
export const REALM_RACERS_TIME_OF_DAY_ORDER: readonly string[] = REALM_RACERS_TIME_OF_DAY_IDS;

/**
 * The phase an authored hour stands at, or null when the circuit authors none.
 *
 * An UNKNOWN id answers null too, so it falls back to the world clock rather
 * than to a hidden default hour. That is the same forgiveness `theme` gets: a
 * draft may name an hour being written in the same change and still be drivable,
 * and the metrics readout (`unknown_time_of_day`) is what judges the id.
 */
export function realmRacersAuthoredPhase(timeOfDay: string | undefined): number | null {
  if (timeOfDay === undefined) return null;
  const phase = REALM_RACERS_TIME_OF_DAY_PHASE[timeOfDay];
  return phase === undefined ? null : phase;
}

/** Which hour lights this frame, and whether a circuit chose it. */
export interface RealmRacersDaylight {
  /** The cycle phase the whole lighting rig is built from this frame. */
  phase: number;
  /**
   * True when the circuit named a known hour, dev override or not.
   *
   * The renderer reads this for the two decisions an authored hour changes
   * beyond the phase itself, both fairness rather than looks: an authored hour
   * is a CONSTANT, so its grade costs nothing per frame and is applied on every
   * graphics tier (the live cycle is skipped on the Lambert tier, which would
   * otherwise race a night circuit in daylight while everyone else squints), and
   * the after-dark readability layers (lamps, ground glow, rim lift) run on that
   * tier too, or a low-tier pilot would get the darkness with none of the lamps.
   */
  authored: boolean;
}

/**
 * The hour this frame lights a circuit at.
 *
 * Precedence is override, then the circuit, then the world clock. The dev
 * override wins outright on purpose: `/daynight` is how a circuit's dressing is
 * checked at an hour it will never ship at, and a tool that a record can silently
 * overrule is not a tool.
 */
export function realmRacersDaylight(
  timeOfDay: string | undefined,
  livePhase: number,
  phaseOverride: number | null,
): RealmRacersDaylight {
  const authoredPhase = realmRacersAuthoredPhase(timeOfDay);
  const phase = phaseOverride ?? authoredPhase ?? livePhase;
  return { phase, authored: authoredPhase !== null };
}
