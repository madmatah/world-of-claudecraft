export const MORTAR_OVERDRIVE_MIN_LAP_FRACTION = 0.85;

/**
 * How far past the line a wrap tick may land, yards: a later lap's odometer
 * starts at that tick, so it trails the arc by this much all lap long. Held
 * above the fastest legal one-tick move (MORTAR_OVERDRIVE_MAX_GATE_STEP, pinned in
 * tests/mortar_overdrive_progress.test.ts) and far below any real reverse.
 */
export const MORTAR_OVERDRIVE_WRAP_OVERSHOOT_YD = 8;

export interface MortarOverdriveProgressInput {
  lap: number;
  lastS: number;
  s: number;
  distanceSinceWrap: number;
  lapLength: number;
  totalLaps: number;
}

export interface MortarOverdriveProgressStep {
  lap: number;
  lastS: number;
  travelled: number;
  distanceSinceWrap: number;
  wrapped: boolean;
  finished: boolean;
  finishFraction: number | null;
}

const wrapS = (s: number, lapLength: number): number => ((s % lapLength) + lapLength) % lapLength;

export function forwardArcDelta(prevS: number, s: number, lapLength: number): number {
  let delta = wrapS(s, lapLength) - wrapS(prevS, lapLength);
  if (delta > lapLength / 2) delta -= lapLength;
  else if (delta <= -lapLength / 2) delta += lapLength;
  return delta;
}

export function travelledFromArc(
  lap: number,
  s: number,
  lapLength: number,
  distanceSinceWrap: number,
): number {
  const wrapped = wrapS(s, lapLength);
  // The negative arm exists for the GRID: lap one starts a few yards behind the
  // line, so a second-half arc there means "behind the start", not "nearly
  // home". The arc alone cannot tell that zone from a racer who honestly DROVE
  // into the second half while the lap counter still reads one (the first line
  // crossing is deliberately lap-neutral), and reading the latter as negative
  // inverted the live standings between the two halves of every first lap. The
  // odometer disambiguates: a machine in the second half of the arc that has
  // covered less than half a lap of ground can only be behind the line. On
  // EVERY lap, not just the first: a machine short of the line on a later lap
  // (recovered onto gate 0, or backed over it) has covered one lap fewer, never
  // one more. A later lap's odometer starts at the wrap tick, already a little
  // past the line, so an honest driver's trails the arc by that overshoot all
  // lap long; the third test keeps one just past halfway on its own lap, while
  // a reverse leaves the odometer far short of the arc.
  const behindTheLine =
    wrapped > lapLength / 2 &&
    distanceSinceWrap < lapLength / 2 &&
    distanceSinceWrap < wrapped - MORTAR_OVERDRIVE_WRAP_OVERSHOOT_YD;
  return (lap - 1) * lapLength + wrapped - (behindTheLine ? lapLength : 0);
}

export function stepMortarOverdriveProgress(
  input: MortarOverdriveProgressInput,
): MortarOverdriveProgressStep {
  const lastS = wrapS(input.lastS, input.lapLength);
  const s = wrapS(input.s, input.lapLength);
  const delta = forwardArcDelta(lastS, s, input.lapLength);
  const crossedStart = s < lastS && delta > 0;
  const distanceSinceWrap = input.distanceSinceWrap + Math.max(0, delta);
  const hasLapDistance = distanceSinceWrap >= input.lapLength * MORTAR_OVERDRIVE_MIN_LAP_FRACTION;
  const wrapped = crossedStart && hasLapDistance;
  const finished = wrapped && input.lap >= input.totalLaps;
  const lap = wrapped && !finished ? input.lap + 1 : input.lap;
  return {
    lap,
    lastS: s,
    travelled: travelledFromArc(lap, s, input.lapLength, distanceSinceWrap),
    distanceSinceWrap: wrapped ? 0 : distanceSinceWrap,
    wrapped,
    finished,
    finishFraction: wrapped ? (input.lapLength - lastS) / delta : null,
  };
}
