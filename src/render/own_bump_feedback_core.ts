// The local bump bang: the tiny decisions behind instant collision feedback
// online. The server's realmRacersBump event carries the sparks, the sound and
// the shake, one downlink after the touch; with the displayed hulls now
// accurate, the player SEES the touch a beat before hearing it. The renderer
// therefore plays the bang the moment the DISPLAYED hulls meet with a real
// closing speed, and this core decides when that is allowed (per-rival
// throttle, mirroring the server's own event throttle) and whether an arriving
// server event is the duplicate of a bang already played (suppress its
// cosmetics once, physics untouched).
//
// Pure and clock-agnostic like own_shot_feedback_core: the caller passes its
// wall clock in.

import { realmRacersGhosted } from '../sim/realm_racers_ghost';
import type { Entity } from '../sim/types';

/**
 * Displayed closing speed under which no local bang plays, yd/s. Mirrors
 * REALM_RACERS_BUMP_EVENT_MIN_IMPACT (src/sim/social/realm_racers.ts), which
 * cannot be imported here: that module is a sim system behind SimContext, and
 * the render tree may only import pure sim leaves. Display-only, so drift
 * would cost a spurious or missed EARLY bang, never a wrong outcome.
 */
export const LOCAL_BUMP_MIN_CLOSING = 3;
/** One local bang per rival per this window, the server's half-second event
 *  throttle with a little slack. */
export const LOCAL_BUMP_THROTTLE_MS = 600;
/** How long a local bang suppresses the server event's duplicate cosmetics. */
export const LOCAL_BUMP_SUPPRESS_MS = 1200;

export interface OwnBumpFeedbackState {
  /** Per-rival wall-clock stamp of the last locally played bang: the throttle. */
  firedAtMs: Map<number, number>;
  /** The same stamp while its bang still waits for the server's echo. */
  pendingAtMs: Map<number, number>;
}

export function createOwnBumpFeedback(): OwnBumpFeedbackState {
  return { firedAtMs: new Map(), pendingAtMs: new Map() };
}

const STAMP_LIFETIME_MS = Math.max(LOCAL_BUMP_THROTTLE_MS, LOCAL_BUMP_SUPPRESS_MS);

function forgetStale(stamps: Map<number, number>, nowMs: number): void {
  for (const [rivalId, at] of stamps) if (nowMs - at > STAMP_LIFETIME_MS) stamps.delete(rivalId);
}

/**
 * Closing speed of the displayed pair along the line between them, yd/s:
 * positive only while they approach. (dx, dz) points from the self hull to
 * the rival's; (relVx, relVz) is self velocity minus rival velocity, so an
 * approach projects positively onto the separation direction.
 */
export function bumpClosingSpeed(dx: number, dz: number, relVx: number, relVz: number): number {
  const dist = Math.hypot(dx, dz);
  if (dist <= 0) return 0;
  return Math.max(0, (relVx * dx + relVz * dz) / dist);
}

/** The slice of a standings row the bang gate reads. */
export interface LocalBumpRacer {
  pid: number;
  finished: boolean;
  retired: boolean;
}

/** The slice of the local race readout the bang gate reads. */
export interface LocalBumpRace {
  phase: string;
  standings: readonly LocalBumpRacer[];
}

/** Is this pilot on the local race's grid and still racing? A pilot with no
 *  row is no machine of this race, like a pilot the sim has no progress for. */
function stillRacing(race: LocalBumpRace, pid: number): boolean {
  for (const racer of race.standings) {
    if (racer.pid === pid) return !racer.finished && !racer.retired;
  }
  return false;
}

/**
 * Is a local bang armed between the self machine and this rival at all?
 * Only for a PREDICTED self drive, in the local race's racing phase, between
 * two machines of its grid that are both still racing (the sim only resolves
 * contacts over the match's own grid, and a machine across the line or pulled
 * off is no longer solid, so a paddock, chase-window or tableau touch must
 * never bang), and never when either machine is a recovery ghost: the server
 * skips every contact with a ghost, so a bang there would be a collision that
 * never happens.
 */
export function localBumpArmed(
  selfSource: string,
  race: LocalBumpRace | null | undefined,
  rival: Entity,
  self: Entity,
): boolean {
  return (
    selfSource === 'predicted' &&
    race?.phase === 'racing' &&
    stillRacing(race, rival.id) &&
    stillRacing(race, self.id) &&
    !realmRacersGhosted(rival) &&
    !realmRacersGhosted(self)
  );
}

/** May a bang play against this rival now? The caller marks after playing. */
export function shouldPlayLocalBump(
  s: OwnBumpFeedbackState,
  rivalId: number,
  nowMs: number,
): boolean {
  const last = s.firedAtMs.get(rivalId);
  return last === undefined || nowMs - last > LOCAL_BUMP_THROTTLE_MS;
}

export function markLocalBump(s: OwnBumpFeedbackState, rivalId: number, nowMs: number): void {
  forgetStale(s.firedAtMs, nowMs);
  forgetStale(s.pendingAtMs, nowMs);
  s.firedAtMs.set(rivalId, nowMs);
  s.pendingAtMs.set(rivalId, nowMs);
}

/**
 * Should this arriving bump event skip its cosmetics? True EXACTLY ONCE per
 * locally played bang, while it is fresh: the pending stamp is consumed, so a
 * second authoritative bump against the same rival inside the window (the
 * server throttles at half a second, under this window) plays normally
 * instead of being swallowed. The throttle stamp stays: the echo lands while
 * the drawn hulls may still overlap, and re-arming there banged one contact
 * twice.
 */
export function consumeLocalBumpSuppression(
  s: OwnBumpFeedbackState,
  rivalId: number,
  nowMs: number,
): boolean {
  const last = s.pendingAtMs.get(rivalId);
  if (last === undefined) return false;
  s.pendingAtMs.delete(rivalId);
  return nowMs - last <= LOCAL_BUMP_SUPPRESS_MS;
}
