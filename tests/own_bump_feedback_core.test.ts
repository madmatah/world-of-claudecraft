import { describe, expect, it } from 'vitest';
import {
  bumpClosingSpeed,
  consumeLocalBumpSuppression,
  createOwnBumpFeedback,
  LOCAL_BUMP_SUPPRESS_MS,
  LOCAL_BUMP_THROTTLE_MS,
  markLocalBump,
  shouldPlayLocalBump,
} from '../src/render/own_bump_feedback_core';

describe('own bump feedback', () => {
  it('measures closing speed along the separation, approach only', () => {
    // Rival dead ahead (+z), self moving toward it: full closing.
    expect(bumpClosingSpeed(0, 3, 0, 10)).toBeCloseTo(10);
    // Moving away: zero, never negative.
    expect(bumpClosingSpeed(0, 3, 0, -10)).toBe(0);
    // Sliding past sideways: no closing along the separation.
    expect(bumpClosingSpeed(0, 3, 10, 0)).toBeCloseTo(0);
    // Diagonal approach projects onto the line.
    expect(bumpClosingSpeed(3, 4, 3, 4)).toBeCloseTo(5);
    // Concentric display poses have no direction to close along.
    expect(bumpClosingSpeed(0, 0, 5, 5)).toBe(0);
  });

  it('throttles bangs per rival, independently', () => {
    const s = createOwnBumpFeedback();
    expect(shouldPlayLocalBump(s, 7, 1000)).toBe(true);
    markLocalBump(s, 7, 1000);
    // A sustained lean is one bang, not one per frame.
    expect(shouldPlayLocalBump(s, 7, 1000 + LOCAL_BUMP_THROTTLE_MS - 1)).toBe(false);
    expect(shouldPlayLocalBump(s, 7, 1000 + LOCAL_BUMP_THROTTLE_MS + 1)).toBe(true);
    // A different rival has its own clock.
    expect(shouldPlayLocalBump(s, 9, 1001)).toBe(true);
  });

  it('suppresses the server duplicate EXACTLY once, then lets everything play', () => {
    const s = createOwnBumpFeedback();
    markLocalBump(s, 7, 1000);
    expect(consumeLocalBumpSuppression(s, 7, 1000 + 150)).toBe(true);
    // The server throttles bumps at half a second, under the suppression
    // window: a SECOND authoritative bump inside it is a genuinely new
    // contact and must play, not be swallowed by a spent latch.
    expect(consumeLocalBumpSuppression(s, 7, 1000 + 600)).toBe(false);
    // A bump against a rival nothing local played for is never suppressed.
    expect(consumeLocalBumpSuppression(s, 9, 1150)).toBe(false);
    // Stale stamp: the authoritative event plays normally (and is cleared).
    markLocalBump(s, 7, 2000);
    expect(consumeLocalBumpSuppression(s, 7, 2000 + LOCAL_BUMP_SUPPRESS_MS + 1)).toBe(false);
    // Consuming re-arms the local side: a fresh bang may play at once.
    expect(shouldPlayLocalBump(s, 7, 2000 + LOCAL_BUMP_SUPPRESS_MS + 2)).toBe(true);
  });
});
