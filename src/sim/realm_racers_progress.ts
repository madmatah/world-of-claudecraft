export const REALM_RACERS_MIN_LAP_FRACTION = 0.85;

export interface RealmRacersProgressInput {
  lap: number;
  lastS: number;
  s: number;
  distanceSinceWrap: number;
  lapLength: number;
  totalLaps: number;
}

export interface RealmRacersProgressStep {
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
  // odometer disambiguates: a machine that has covered less than half a lap of
  // ground and sits in the second half of the arc can only be behind the line.
  const behindTheLine = lap === 1 && wrapped > lapLength / 2 && distanceSinceWrap < lapLength / 2;
  return (lap - 1) * lapLength + wrapped - (behindTheLine ? lapLength : 0);
}

export function stepRealmRacersProgress(input: RealmRacersProgressInput): RealmRacersProgressStep {
  const lastS = wrapS(input.lastS, input.lapLength);
  const s = wrapS(input.s, input.lapLength);
  const delta = forwardArcDelta(lastS, s, input.lapLength);
  const crossedStart = s < lastS && delta > 0;
  const distanceSinceWrap = input.distanceSinceWrap + Math.max(0, delta);
  const hasLapDistance = distanceSinceWrap >= input.lapLength * REALM_RACERS_MIN_LAP_FRACTION;
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
