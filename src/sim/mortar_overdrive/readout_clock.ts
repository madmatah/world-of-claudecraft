// The per-tick half of a Mortar Overdrive match readout: the race clocks and the
// speed, the only fields that move on (nearly) every tick of a race. The server
// ships them as their own small self key (`moc`) so the heavy rest of the
// readout (`mo`: the standings, the boxes, the oil) is resent only when it
// really changes, and the client folds the two back into the one
// `MortarOverdriveMatchInfo` presentation reads, exactly as the offline Sim builds
// it. Pure and host-agnostic: both sides of the wire import it.

import type {
  MortarOverdriveInfo,
  MortarOverdriveMatchInfo,
  MortarOverdriveQueueStart,
} from '../../world_api/mortar_overdrive';

export type MortarOverdriveClockKey =
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
export type MortarOverdriveMatchClock = Pick<MortarOverdriveMatchInfo, MortarOverdriveClockKey>;

/** The readout without its clock half: what `mo` carries. */
export type MortarOverdriveStillInfo = Omit<MortarOverdriveInfo, 'match'> & {
  match: Omit<MortarOverdriveMatchInfo, MortarOverdriveClockKey> | null;
};

/** The clock half of a match readout, or null with no match. */
export function mortarOverdriveClockOf(
  match: MortarOverdriveMatchInfo | null | undefined,
): MortarOverdriveMatchClock | null {
  if (!match) return null;
  const clock: MortarOverdriveMatchClock = {
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
export function splitMortarOverdriveInfo(info: MortarOverdriveInfo): {
  still: MortarOverdriveStillInfo;
  clock: MortarOverdriveMatchClock | null;
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
  return { still: { ...info, match: still }, clock: mortarOverdriveClockOf(match) };
}

/** The idle clock a match readout falls back to before its first `moc`. */
const IDLE_CLOCK: MortarOverdriveMatchClock = {
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
 * (the client's previous mirror, when only `moc` moved): every clock field of
 * it is overwritten, and a `wardIn` the clock no longer carries is dropped.
 */
export function mergeMortarOverdriveInfo(
  still: MortarOverdriveStillInfo | MortarOverdriveInfo,
  clock: MortarOverdriveMatchClock | null,
): MortarOverdriveInfo {
  if (!still.match) return { ...still, match: null };
  const match = { ...still.match, ...(clock ?? IDLE_CLOCK) } as MortarOverdriveMatchInfo;
  if (clock?.wardIn === undefined) delete match.wardIn;
  return { ...still, match };
}

/**
 * The queue start as `mo` ships it: the absolute deadline tick on the race
 * clock rather than the ticks left, which move every tick and would resend the
 * whole readout on every one. The mirror turns it back against each
 * snapshot's tick.
 */
export type MortarOverdriveQueueStartWire = Omit<MortarOverdriveQueueStart, 'startsInTicks'> & {
  startsAt: number | null;
};

/** The still readout as `mo` ships it. */
export type MortarOverdriveStillWire = Omit<MortarOverdriveStillInfo, 'start'> & {
  start?: MortarOverdriveQueueStartWire;
};

/** Ticks from `tick` until `at`, floored at zero; null with no deadline. */
export function mortarOverdriveTicksUntil(at: number | null, tick: number): number | null {
  return at === null ? null : Math.max(0, at - tick);
}

/** The still readout of `tick` with its queue start made absolute. */
export function mortarOverdriveStillToWire(
  still: MortarOverdriveStillInfo,
  tick: number,
): MortarOverdriveStillWire {
  const start = still.start;
  if (!start) return still as MortarOverdriveStillWire;
  const { startsInTicks, ...rest } = start;
  // A deadline already reached (the seat lagging it, say) ships as tick 0,
  // which every later tick decodes to zero ticks left: `tick + 0` would move
  // with the clock and resend `mo` on every tick until the race seats.
  const startsAt = startsInTicks === null ? null : startsInTicks > 0 ? tick + startsInTicks : 0;
  return { ...still, start: { ...rest, startsAt } };
}

/** The absolute deadline a shipped readout carries, or null without one. A
 *  value that is not a finite tick reads as no deadline, never as a clock. */
export function mortarOverdriveWireStartsAt(wire: MortarOverdriveStillWire | null): number | null {
  const at = wire?.start?.startsAt;
  return typeof at === 'number' && Number.isFinite(at) ? at : null;
}

/** A shipped readout back in its IWorld shape, its ticks left as of `tick`. */
export function mortarOverdriveStillFromWire(
  wire: MortarOverdriveStillWire,
  tick: number,
): MortarOverdriveStillInfo {
  const start = wire.start;
  if (!start) return wire as MortarOverdriveStillInfo;
  const { startsAt: _startsAt, ...rest } = start;
  const at = mortarOverdriveWireStartsAt(wire);
  return {
    ...wire,
    start: {
      ...rest,
      startsInTicks: Number.isFinite(tick) ? mortarOverdriveTicksUntil(at, tick) : null,
    },
  };
}
