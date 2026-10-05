import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bumpClosingSpeed,
  consumeLocalBumpSuppression,
  createOwnBumpFeedback,
  LOCAL_BUMP_SUPPRESS_MS,
  LOCAL_BUMP_THROTTLE_MS,
  localBumpArmed,
  markLocalBump,
  shouldPlayLocalBump,
} from '../src/render/own_bump_feedback_core';
import { REALM_RACERS_GHOST_AURA } from '../src/sim/realm_racers_ghost';
import type { Aura, Entity } from '../src/sim/types';

const ghostAura = {
  id: REALM_RACERS_GHOST_AURA,
  name: 'Ghosted',
  kind: 'rally_ghost',
} as Aura;
const machine = (id: number, ghost = false): Entity =>
  ({ id, auras: ghost ? [ghostAura] : [] }) as unknown as Entity;
const row = (pid: number, out: 'finished' | 'retired' | null = null) => ({
  pid,
  finished: out === 'finished',
  retired: out === 'retired',
});

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
    // Past the throttle a fresh bang may play.
    expect(shouldPlayLocalBump(s, 7, 2000 + LOCAL_BUMP_SUPPRESS_MS + 2)).toBe(true);
  });

  it('keeps the throttle through the echo, so one contact never bangs twice', () => {
    // The echo lands well inside the throttle while the drawn hulls may still
    // overlap: consuming it must not re-arm a second bang for the same touch.
    const s = createOwnBumpFeedback();
    markLocalBump(s, 7, 1000);
    expect(consumeLocalBumpSuppression(s, 7, 1150)).toBe(true);
    expect(shouldPlayLocalBump(s, 7, 1160)).toBe(false);
    expect(shouldPlayLocalBump(s, 7, 1000 + LOCAL_BUMP_THROTTLE_MS + 1)).toBe(true);
  });

  it('forgets every stamp past both windows, so the latch never grows with the rivals met', () => {
    const s = createOwnBumpFeedback();
    for (let rival = 1; rival <= 40; rival++) markLocalBump(s, rival, 1000);
    const later = 1000 + Math.max(LOCAL_BUMP_THROTTLE_MS, LOCAL_BUMP_SUPPRESS_MS) + 1;
    markLocalBump(s, 99, later);
    expect(s.firedAtMs.size).toBe(1);
    expect(s.pendingAtMs.size).toBe(1);
    expect(shouldPlayLocalBump(s, 5, later)).toBe(true);
    expect(consumeLocalBumpSuppression(s, 5, later)).toBe(false);
  });

  it('arms a local bang only for a predicted drive against a racing rival, never a ghost', () => {
    const race = { phase: 'racing', standings: [row(1), row(2)] };
    expect(localBumpArmed('predicted', race, machine(2), machine(1))).toBe(true);
    // The server skips every contact with a recovery ghost, on either side.
    expect(localBumpArmed('predicted', race, machine(2, true), machine(1))).toBe(false);
    expect(localBumpArmed('predicted', race, machine(2), machine(1, true))).toBe(false);
    // The gates it already had.
    expect(localBumpArmed('none', race, machine(2), machine(1))).toBe(false);
    expect(
      localBumpArmed('predicted', { ...race, phase: 'finished' }, machine(2), machine(1)),
    ).toBe(false);
    expect(localBumpArmed('predicted', race, machine(3), machine(1))).toBe(false);
    expect(localBumpArmed('predicted', null, machine(2), machine(1))).toBe(false);
  });

  it('never arms against a machine out of the race, a finisher or a quitter, on either side', () => {
    // The server pairs only machines still racing: a finisher drives on through
    // the chase window and a quitter sits parked for its tableau, neither solid.
    const race = (rival: 'finished' | 'retired' | null, self: 'finished' | 'retired' | null) => ({
      phase: 'racing',
      standings: [row(1, self), row(2, rival)],
    });
    expect(localBumpArmed('predicted', race(null, null), machine(2), machine(1))).toBe(true);
    expect(localBumpArmed('predicted', race('finished', null), machine(2), machine(1))).toBe(false);
    expect(localBumpArmed('predicted', race('retired', null), machine(2), machine(1))).toBe(false);
    // The viewer's own phase stays racing after they cross the line while the
    // field drives on, so only their standings row says they are out.
    expect(localBumpArmed('predicted', race(null, 'finished'), machine(2), machine(1))).toBe(false);
    expect(localBumpArmed('predicted', race(null, 'retired'), machine(2), machine(1))).toBe(false);
  });

  it('is the gate the renderer bangs through, with the rival first and the self second', () => {
    // The bang lives in the rally scene's rival step, which the renderer's
    // entity loop runs for every view before it places the body.
    const scene = readFileSync(
      new URL('../src/render/realm_racers_scene.ts', import.meta.url),
      'utf8',
    );
    expect(scene).toContain(
      'if (p.drive && localBumpArmed(h.selfRender.drive.source, race, e, p)) {',
    );
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      'this.realmRacers.projectRival(isSelf, v, e, rp, selfMotion, now, dt, p, selfPos);',
    );
  });
});
