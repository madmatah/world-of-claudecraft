// The own-shot feedback latch: the tiny decision behind instant local fire
// feedback online. When the local pilot fires, the client plays the muzzle
// report at the press; the server's Fired event then arrives one round trip
// later carrying the SAME muzzle cue, and replaying it reads as a double shot.
// This core decides, per event, whether that duplicate is suppressed: exactly
// once per locally played report, only for the local player's own event whose
// target matches the reported shot, and only within a bounded window (past it
// the local cue evidently never matched a real shot, or the link is in painful
// shape, and the authoritative event plays normally).
//
// The target match is what keeps a refused shot from silencing a real one: the
// server can refuse a shot the client gate allowed, no Fired event ever comes
// for it, and its mark stays; a real shot pressed inside the window plays no
// local report (one in flight at a time), so its event must play.
//
// Pure and clock-agnostic: the caller passes its wall clock in, so a Vitest
// drives it with plain numbers (the net_interp_core pattern).

import { GROUND_BLAST_RADIUS } from '../sim/realm_racers_ground_blast';

/** How long a local report suppresses the own Fired event's copy: one round
 *  trip plus generous slack. */
export const OWN_SHOT_FEEDBACK_WINDOW_MS = 1500;

/** How far the server's target may sit from the reported shot's and still be
 *  that shot: the blast it draws. The server clamps the aim from its own pose,
 *  which the predicted one trails by a yard or two. */
export const OWN_SHOT_FEEDBACK_MATCH_YD = GROUND_BLAST_RADIUS;

export interface OwnShotFeedbackState {
  /** Wall-clock stamp of the last locally played report; 0 when none pending. */
  firedAtMs: number;
  /** Where the reported shot was aimed, as the client resolved it; NaN when
   *  the report carried no target (any own event then matches). */
  targetX: number;
  targetZ: number;
}

export function createOwnShotFeedback(): OwnShotFeedbackState {
  return { firedAtMs: 0, targetX: Number.NaN, targetZ: Number.NaN };
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

/** The local report just played, for a shot aimed at `target`. */
export function markOwnShotFeedback(
  s: OwnShotFeedbackState,
  nowMs: number,
  target: { x: number; z: number } | null = null,
): void {
  s.firedAtMs = nowMs;
  s.targetX = target ? target.x : Number.NaN;
  s.targetZ = target ? target.z : Number.NaN;
}

/**
 * Should this arriving Fired event skip its muzzle cue? True exactly once per
 * marked local report, for the own event whose target matches it; consuming
 * clears the latch either way once it is the local player's own event (one
 * report in flight, so an own event that does not match says the marked shot
 * was refused, and a stale expired latch has nothing left to say).
 */
export function consumeOwnShotFeedback(
  s: OwnShotFeedbackState,
  isOwnEvent: boolean,
  nowMs: number,
  target: { x: number; z: number } | null = null,
): boolean {
  if (!isOwnEvent || s.firedAtMs === 0) return false;
  const fresh = nowMs - s.firedAtMs <= OWN_SHOT_FEEDBACK_WINDOW_MS;
  const matches =
    target === null ||
    Number.isNaN(s.targetX) ||
    Math.hypot(target.x - s.targetX, target.z - s.targetZ) <= OWN_SHOT_FEEDBACK_MATCH_YD;
  s.firedAtMs = 0;
  return fresh && matches;
}
