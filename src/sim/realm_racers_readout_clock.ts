// The per-tick half of a Realm Racers match readout: the race clocks and the
// speed, the only fields that move on (nearly) every tick of a race. The server
// ships them as their own small self key (`rrc`) so the heavy rest of the
// readout (`rr`: the standings, the boxes, the oil) is resent only when it
// really changes, and the client folds the two back into the one
// `RealmRacersMatchInfo` presentation reads, exactly as the offline Sim builds
// it. Pure and host-agnostic: both sides of the wire import it.

import type { RealmRacersInfo, RealmRacersMatchInfo } from '../world_api/realm_racers';

export type RealmRacersClockKey =
  | 'countdown'
  | 'countdownTicks'
  | 'elapsed'
  | 'elapsedTicks'
  | 'chaseIn'
  | 'returnIn'
  | 'offTrackIn'
  | 'wardIn'
  | 'speed';

/** The clock half: whole-second clocks, their tick twins and the speed. */
export type RealmRacersMatchClock = Pick<RealmRacersMatchInfo, RealmRacersClockKey>;

/** The readout without its clock half: what `rr` carries. */
export type RealmRacersStillInfo = Omit<RealmRacersInfo, 'match'> & {
  match: Omit<RealmRacersMatchInfo, RealmRacersClockKey> | null;
};

/** The clock half of a match readout, or null with no match. */
export function realmRacersClockOf(
  match: RealmRacersMatchInfo | null | undefined,
): RealmRacersMatchClock | null {
  if (!match) return null;
  const clock: RealmRacersMatchClock = {
    countdown: match.countdown,
    countdownTicks: match.countdownTicks,
    elapsed: match.elapsed,
    elapsedTicks: match.elapsedTicks,
    chaseIn: match.chaseIn,
    returnIn: match.returnIn,
    offTrackIn: match.offTrackIn,
    speed: match.speed,
  };
  // Present only while warded, like the readout it comes from.
  if (match.wardIn !== undefined) clock.wardIn = match.wardIn;
  return clock;
}

/** Split a readout into the two keys the wire ships. The clock is null exactly
 *  when the match is, which the client's fold relies on when one key arrives
 *  without the other. */
export function splitRealmRacersInfo(info: RealmRacersInfo): {
  still: RealmRacersStillInfo;
  clock: RealmRacersMatchClock | null;
} {
  const match = info.match;
  if (!match) return { still: info, clock: null };
  const {
    countdown: _countdown,
    countdownTicks: _countdownTicks,
    elapsed: _elapsed,
    elapsedTicks: _elapsedTicks,
    chaseIn: _chaseIn,
    returnIn: _returnIn,
    offTrackIn: _offTrackIn,
    wardIn: _wardIn,
    speed: _speed,
    ...still
  } = match;
  return { still: { ...info, match: still }, clock: realmRacersClockOf(match) };
}

/** The idle clock a match readout falls back to before its first `rrc`. */
const IDLE_CLOCK: RealmRacersMatchClock = {
  countdown: 0,
  countdownTicks: 0,
  elapsed: 0,
  elapsedTicks: 0,
  chaseIn: 0,
  returnIn: 0,
  offTrackIn: 0,
  speed: 0,
};

/**
 * Fold the two halves back into one readout. `still` may be a whole readout
 * (the client's previous mirror, when only `rrc` moved): every clock field of
 * it is overwritten, and a `wardIn` the clock no longer carries is dropped.
 */
export function mergeRealmRacersInfo(
  still: RealmRacersStillInfo | RealmRacersInfo,
  clock: RealmRacersMatchClock | null,
): RealmRacersInfo {
  if (!still.match) return { ...still, match: null };
  const match = { ...still.match, ...(clock ?? IDLE_CLOCK) } as RealmRacersMatchInfo;
  if (clock?.wardIn === undefined) delete match.wardIn;
  return { ...still, match };
}
