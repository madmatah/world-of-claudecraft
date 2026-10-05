import { describe, expect, it } from 'vitest';
import {
  canMarkOwnShotFeedback,
  consumeOwnShotFeedback,
  createOwnShotFeedback,
  markOwnShotFeedback,
  OWN_SHOT_FEEDBACK_MATCH_YD,
  OWN_SHOT_FEEDBACK_WINDOW_MS,
} from '../src/render/own_shot_feedback_core';
import { GROUND_BLAST_RADIUS } from '../src/sim/realm_racers_ground_blast';

describe('own shot feedback latch', () => {
  it('suppresses the own Fired event exactly once per local report', () => {
    const s = createOwnShotFeedback();
    markOwnShotFeedback(s, 1000);
    expect(consumeOwnShotFeedback(s, true, 1120)).toBe(true);
    // A second own event (a later shot with no local report) plays normally.
    expect(consumeOwnShotFeedback(s, true, 1200)).toBe(false);
  });

  it('never suppresses a rival shot, and leaves the latch armed for the own one', () => {
    const s = createOwnShotFeedback();
    markOwnShotFeedback(s, 1000);
    // Rival Fired events can land between the press and the own echo.
    expect(consumeOwnShotFeedback(s, false, 1050)).toBe(false);
    expect(consumeOwnShotFeedback(s, true, 1120)).toBe(true);
  });

  it('lets an expired latch play the authoritative event normally', () => {
    const s = createOwnShotFeedback();
    markOwnShotFeedback(s, 1000);
    expect(consumeOwnShotFeedback(s, true, 1000 + OWN_SHOT_FEEDBACK_WINDOW_MS + 1)).toBe(false);
    // And the stale stamp is gone: it cannot suppress a later shot either.
    expect(consumeOwnShotFeedback(s, true, 1000 + OWN_SHOT_FEEDBACK_WINDOW_MS + 2)).toBe(false);
  });

  it('does nothing before any local report', () => {
    const s = createOwnShotFeedback();
    expect(consumeOwnShotFeedback(s, true, 500)).toBe(false);
  });

  it('refuses a second report while one is in flight, then re-arms', () => {
    // Inside one round trip the local cooldown mirror has not updated yet, so
    // a fast re-commit passes the client's cooldown check: without this guard
    // it would play two bangs for one shell.
    const s = createOwnShotFeedback();
    expect(canMarkOwnShotFeedback(s, 1000)).toBe(true);
    markOwnShotFeedback(s, 1000);
    expect(canMarkOwnShotFeedback(s, 1100)).toBe(false);
    // The event consumed the mark: the next shot may report again.
    consumeOwnShotFeedback(s, true, 1150);
    expect(canMarkOwnShotFeedback(s, 1200)).toBe(true);
    // And an expired mark (no event ever came) stops blocking on its own.
    markOwnShotFeedback(s, 2000);
    expect(canMarkOwnShotFeedback(s, 2000 + OWN_SHOT_FEEDBACK_WINDOW_MS + 1)).toBe(true);
  });

  it('lets a real shot play after a refused one: only the marked shot is suppressed', () => {
    // The server refuses a shot the client gate allowed (its cooldown mirror
    // lagged): no Fired event ever comes for it, and the mark stays. A real
    // shot pressed inside the window plays no local report (one in flight at
    // a time), so its Fired event must not be swallowed by the stale mark.
    const s = createOwnShotFeedback();
    markOwnShotFeedback(s, 1000, { x: 10, z: 20 });
    expect(canMarkOwnShotFeedback(s, 1400)).toBe(false);
    // The real shot lands somewhere else: it plays, and clears the stale mark.
    expect(consumeOwnShotFeedback(s, true, 1500, { x: 40, z: 65 })).toBe(false);
    expect(canMarkOwnShotFeedback(s, 1510)).toBe(true);
    // The marked shot itself, as the server resolved it from its own pose a
    // little off the client's: suppressed.
    markOwnShotFeedback(s, 2000, { x: 10, z: 20 });
    expect(consumeOwnShotFeedback(s, true, 2120, { x: 12, z: 21 })).toBe(true);
    expect(canMarkOwnShotFeedback(s, 2130)).toBe(true);
  });

  it('matches the marked shot within the blast it draws, and no further', () => {
    expect(OWN_SHOT_FEEDBACK_MATCH_YD).toBe(GROUND_BLAST_RADIUS);
    const s = createOwnShotFeedback();
    markOwnShotFeedback(s, 1000, { x: 0, z: 0 });
    expect(consumeOwnShotFeedback(s, true, 1100, { x: 0, z: OWN_SHOT_FEEDBACK_MATCH_YD })).toBe(
      true,
    );
    markOwnShotFeedback(s, 2000, { x: 0, z: 0 });
    expect(
      consumeOwnShotFeedback(s, true, 2100, { x: 0, z: OWN_SHOT_FEEDBACK_MATCH_YD + 0.01 }),
    ).toBe(false);
    // A rival event never touches the mark, whatever it carries.
    markOwnShotFeedback(s, 3000, { x: 0, z: 0 });
    expect(consumeOwnShotFeedback(s, false, 3050, { x: 0, z: 0 })).toBe(false);
    expect(consumeOwnShotFeedback(s, true, 3100, { x: 0, z: 0 })).toBe(true);
  });
});
