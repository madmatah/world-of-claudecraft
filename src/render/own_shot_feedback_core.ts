// The own-shot feedback latch: the tiny decision behind instant local fire
// feedback online. When the local pilot fires, the client plays the muzzle
// report at the press; the server's Fired event then arrives one round trip
// later carrying the SAME muzzle cue, and replaying it reads as a double shot.
// This core decides, per event, whether that duplicate is suppressed: exactly
// once per locally played report, only for the local player's own event, and
// only within a bounded window (past it the local cue evidently never matched
// a real shot, or the link is in painful shape, and the authoritative event
// plays normally).
//
// Pure and clock-agnostic: the caller passes its wall clock in, so a Vitest
// drives it with plain numbers (the net_interp_core pattern).

/** How long a local report suppresses the own Fired event's copy: one round
 *  trip plus generous slack. */
export const OWN_SHOT_FEEDBACK_WINDOW_MS = 1500;

export interface OwnShotFeedbackState {
  /** Wall-clock stamp of the last locally played report; 0 when none pending. */
  firedAtMs: number;
}

export function createOwnShotFeedback(): OwnShotFeedbackState {
  return { firedAtMs: 0 };
}

/**
 * May a NEW local report play now? False while a fresh mark is still waiting
 * for its event: the local cooldown mirror only updates when the server
 * echoes it, so inside one round trip a fast re-aim-and-commit passes the
 * client's cooldown check, and without this guard it would play a second
 * report for a shot the server is about to refuse (two bangs, one shell).
 * One report in flight at a time is the contract the consume side assumes.
 */
export function canMarkOwnShotFeedback(s: OwnShotFeedbackState, nowMs: number): boolean {
  return s.firedAtMs === 0 || nowMs - s.firedAtMs > OWN_SHOT_FEEDBACK_WINDOW_MS;
}

/** The local report just played. */
export function markOwnShotFeedback(s: OwnShotFeedbackState, nowMs: number): void {
  s.firedAtMs = nowMs;
}

/**
 * Should this arriving Fired event skip its muzzle cue? True exactly once per
 * marked local report; consuming clears the latch either way once it is the
 * local player's own event (a stale expired latch has nothing left to say).
 */
export function consumeOwnShotFeedback(
  s: OwnShotFeedbackState,
  isOwnEvent: boolean,
  nowMs: number,
): boolean {
  if (!isOwnEvent || s.firedAtMs === 0) return false;
  const fresh = nowMs - s.firedAtMs <= OWN_SHOT_FEEDBACK_WINDOW_MS;
  s.firedAtMs = 0;
  return fresh;
}
