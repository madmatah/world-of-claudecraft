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

export function travelledFromArc(lap: number, s: number, lapLength: number): number {
  const wrapped = wrapS(s, lapLength);
  return (lap - 1) * lapLength + wrapped - (lap === 1 && wrapped > lapLength / 2 ? lapLength : 0);
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
    travelled: travelledFromArc(lap, s, input.lapLength),
    distanceSinceWrap: wrapped ? 0 : distanceSinceWrap,
    wrapped,
    finished,
    finishFraction: wrapped ? (input.lapLength - lastS) / delta : null,
  };
}
