// Track limits, enforced by a REFEREE rather than by geometry.
//
// Every earlier answer on this circuit was the same family: a physical
// containment device derived from the racing line's own offset curve (a stone
// rim, a wall, deep water, a hedge, a kneewall). That family cannot look
// designed, because an offset curve of the road is visibly an offset curve of
// the road, and it punishes ordinary racing, because it stands exactly at the
// edge of the space bumps and Ground Blast legitimately throw machines into.
// The world is open now and a RULE puts a cutter back.
//
// The rule, in one line: an excursion may not come out AHEAD OF WHAT IT EARNED.
//
//   unearned = forwardArcDelta(exitS, s) - EXCHANGE_RATE * yards driven off the road
//
// The exchange rate is what makes this a racing rule rather than a geometry
// one, and getting there took a wrong turn worth recording. The first version
// shipped with a rate of 1: arc gained against ground driven, flat. It is a
// correct anti-cheat and a bad game rule, because a machine does not choose the
// arc it sweeps. Driving at an inward offset `d` through a corner of radius `R`
// sweeps `R / (R - d)` yards of centerline per yard of ground, so a rival's
// shove into the inside of a hairpin (R 25, d 10) collects two thirds of a yard
// of "gain" per yard driven, through no decision of the pilot's, and trips a
// flat tolerance in about thirty yards.
//
// What separates a cut from a shove is not geometry, it is TIME: a cut is only
// a cut if it beat the road. The off-track bands already price that (the
// measured ladder is road 57.9, verge 40.4, garden 28.2 yd/s), so a stretch of
// ground driven off the road is worth strictly less lap than the same ground on
// it, and the exchange rate is exactly how much less. Everything under the rate
// was already a losing line, priced by the bands and needing no referee.
//
// The rule is still side-agnostic and still free of per-corner proof:
//
//   - cutting the INSIDE drives a chord where the road drives an arc; it fires
//     once the chord is short enough to beat the road's time;
//   - cutting the OUTSIDE of a re-entrant shape (where a straight line between
//     two points of the lap is shorter than the road between them, which is the
//     hole the old infield-only containment never even looked at) is the same
//     arithmetic and fires the same way. The referee never reads which SIDE the
//     machine left on, only the two arc positions and the odometer;
//   - running wide, being shoved off line, or being launched by a weapon all
//     cover real ground for the lap they collect, so they come out under the
//     rate and nothing happens. That is racing, and it already costs speed.
//
// A machine parked off the road gains neither arc nor ground, so the rule above
// never fires on it: that is what `REALM_RACERS_LOITER_TICKS` is for.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM. Ticks in, verdict out.

import { forwardArcDelta } from './realm_racers_progress';
import { TICK_RATE } from './types';

/**
 * How much lap a yard driven OFF the road is worth, in yards of road.
 *
 * The bands make off-road ground slower, so it buys less lap than the same
 * ground on the racing surface, and this is the exchange rate between the two.
 * Measured rather than derived from the terminal-speed ladder, because nobody
 * drives at their terminal speed: a machine leaves the road carrying road
 * momentum and spends the whole excursion bleeding it, so the effective rate
 * sits under the 2.05 the ladder implies. `scripts/realm_racers_limits_probe.ts`
 * is what measures it: it drives every candidate straight-line cut on every
 * shipped circuit through the real kernel and compares the elapsed time against
 * the ace bot's own time over the same stretch of road.
 *
 * Raising it is STRICTER (less lap credited per yard driven off the road) and
 * lowering it is more permissive. At 1 the rule collapses to the flat
 * arc-against-ground tolerance this replaced, which is the same as claiming the
 * garden is as quick as the road.
 *
 * MEASURED, 2026-08-03, over twelve full house-pilot races (six seeds on each
 * shipped circuit, 60 excursions, blasts and contacts included):
 *
 *   worst HONEST excursion   at rate 1.0: +38 / +40 yd   at rate 1.6: +2.2 / +3.6 yd
 *
 * which is the whole reason the rate exists. A machine does not choose the arc
 * it sweeps, so a rival's shove into the inside of a hairpin collected forty
 * yards of "gain" under the flat rule and was returned for it.
 */
export const REALM_RACERS_OFF_ROAD_EXCHANGE_RATE = 1.6;

/**
 * Yards of UNEARNED lap an excursion may come out with before the referee puts
 * the machine back.
 *
 * A floor rather than the whole rule: the exchange rate already sends every
 * losing line negative, so this only has to sit above the noise of a short
 * excursion (a tick of projection jitter, the sagitta of the resampled
 * centerline, an apex clipped at speed) and below the smallest cut worth
 * taking. Twenty five is about seven times the worst honest excursion measured.
 *
 * What that measurement ALSO found, and the reason this arm currently fires on
 * nothing: on both shipped circuits the off-track bands have already priced
 * every cut into worthlessness. Driving every candidate straight line through
 * the real kernel and timing it against the ace bot's road pace, the best cut
 * anyone can take saves 0.2 s on the practice circuit and 0.8 s on the Express
 * Tour, over a whole race, and every other line is SLOWER than the road, most
 * of them by seconds. The bands are the anti-cheat here; the
 * referee is the backstop for a circuit shape nobody has drawn yet (a long
 * out-and-back, where a straight line really would pay). That is a property of
 * the CIRCUITS, not of the rule, so it is checked as one:
 * `tests/realm_racers_track_limits.test.ts` drives the cuts on every shipped
 * circuit and fails the day one of them starts paying, and
 * `scripts/realm_racers_limits_probe.ts` is the full sweep behind these numbers.
 */
export const REALM_RACERS_CUT_TOLERANCE_YD = 25;

/**
 * How long a machine may stay off the racing surface, moving or not, before it
 * is returned to the last recovery anchor.
 *
 * This is the anti-camping arm, and it is deliberately generous: at the garden
 * band's terminal speed five seconds is well over a hundred yards of driving,
 * so a pilot genuinely fighting their way back from a blast rejoins long before
 * it bites, while a machine sitting in the infield sniping the field does not.
 */
export const REALM_RACERS_LOITER_TICKS = 5 * TICK_RATE;

/** How much of that window is spent WARNING, so the reset is a clock the pilot
 *  watched rather than a teleport that happened to them. */
export const REALM_RACERS_LOITER_WARN_TICKS = 3 * TICK_RATE;

/**
 * Control lock after a cut return, ticks. Short on purpose: the machine is put
 * back on the racing line facing along it, and the point is to undo a gain, not
 * to add a stop-go penalty on top of it.
 */
export const REALM_RACERS_CUT_LOCK_TICKS = TICK_RATE;

/** How long the "you rejoin where you left" banner stands, ticks. */
export const REALM_RACERS_CUT_NOTICE_TICKS = 3 * TICK_RATE;

/**
 * One racer's live excursion. `exitS` null is the on-track state, which is what
 * every racer carries for almost the whole race.
 */
export interface RallyExcursion {
  /** Arc position the machine last left the racing surface at, yards. */
  exitS: number | null;
  /** Ticks since that exit. */
  ticks: number;
  /** Ground yards driven since that exit. */
  ground: number;
}

export interface RallyTrackLimitInput {
  /** Is the machine on the racing surface (road or verge) right now? */
  onTrack: boolean;
  /** Its arc position now, yards. */
  s: number;
  /**
   * The arc position it held at the end of the previous tick. An excursion
   * beginning on THIS tick is recorded as having left there, not here: that is
   * the last position the machine actually held on the road, and it is the one
   * the caller's lap bookkeeping is in step with.
   */
  previousS: number;
  /** Ground yards covered this tick. */
  moved: number;
  lapLength: number;
}

export type RallyTrackLimitVerdict = 'none' | 'cutReturn' | 'loiter';

export interface RallyTrackLimitStep {
  excursion: RallyExcursion;
  verdict: RallyTrackLimitVerdict;
  /** Where a `cutReturn` puts the machine back; null for every other verdict. */
  returnS: number | null;
}

/** The on-track state, which is also what a reset restores. */
export function noRallyExcursion(): RallyExcursion {
  return { exitS: null, ticks: 0, ground: 0 };
}

/**
 * Advance one racer's excursion by a tick and say what the referee wants done.
 *
 * The caller owns the consequences (the teleport, the control lock, the
 * banner): this decides only whether there is one.
 */
export function stepRealmRacersTrackLimits(
  state: RallyExcursion,
  input: RallyTrackLimitInput,
): RallyTrackLimitStep {
  if (input.onTrack) {
    return { excursion: noRallyExcursion(), verdict: 'none', returnS: null };
  }
  const exitS = state.exitS ?? input.previousS;
  const excursion: RallyExcursion = {
    exitS,
    ticks: state.ticks + 1,
    ground: state.ground + Math.max(0, input.moved),
  };
  // Negative for every excursion that did not beat the road, which is every
  // honest one: the ground it drove was worth more lap than the lap it took.
  const unearned =
    forwardArcDelta(exitS, input.s, input.lapLength) -
    REALM_RACERS_OFF_ROAD_EXCHANGE_RATE * excursion.ground;
  if (unearned > REALM_RACERS_CUT_TOLERANCE_YD) {
    return { excursion: noRallyExcursion(), verdict: 'cutReturn', returnS: exitS };
  }
  if (excursion.ticks >= REALM_RACERS_LOITER_TICKS) {
    return { excursion: noRallyExcursion(), verdict: 'loiter', returnS: null };
  }
  return { excursion, verdict: 'none', returnS: null };
}

/**
 * Ticks left before the loiter reset, or 0 while the warning has not armed (and
 * for a machine on the road, which has no excursion at all). What the HUD
 * counts down.
 */
export function rallyLoiterCountdownTicks(state: RallyExcursion): number {
  if (state.exitS === null) return 0;
  const left = REALM_RACERS_LOITER_TICKS - state.ticks;
  return left <= REALM_RACERS_LOITER_WARN_TICKS ? Math.max(0, left) : 0;
}
