import { describe, expect, it } from 'vitest';
import type { RallyPickupEffect } from '../src/sim/realm_racers_pickup_effects';
import {
  RALLY_SPLASH_HOLD_MS,
  RALLY_SPLASH_IN_MS,
  RALLY_SPLASH_LIFE_MS,
  RALLY_SPLASH_OUT_MS,
  rallyPickupSplashView,
  rallySplashPhaseAt,
} from '../src/ui/realm_racers_pickup_splash_view';

const EFFECTS: readonly RallyPickupEffect[] = ['charge', 'nitro', 'ward', 'slick'];

describe('the pickup splash view', () => {
  it('gives every effect its own icon, copy key and tone', () => {
    expect(rallyPickupSplashView('charge')).toEqual({
      icon: { kind: 'ability', id: 'rally_ground_blast' },
      labelKey: 'hudChrome.rally.pickupCharge',
      tone: 'charge',
    });
    expect(rallyPickupSplashView('nitro')).toEqual({
      icon: { kind: 'ability', id: 'rally_nitro' },
      labelKey: 'hudChrome.rally.pickupNitro',
      tone: 'nitro',
    });
    expect(rallyPickupSplashView('ward')).toEqual({
      icon: { kind: 'aura', id: 'aura_rally_ward' },
      labelKey: 'hudChrome.rally.pickupWard',
      tone: 'ward',
    });
    expect(rallyPickupSplashView('slick')).toEqual({
      icon: { kind: 'ability', id: 'rally_oil_slick' },
      labelKey: 'hudChrome.rally.pickupSlick',
      tone: 'slick',
    });
  });

  it('never shows two effects the same face', () => {
    // A splash whose only job is to say WHICH thing you got fails completely if
    // two of them look alike, and an icon id reused across two effects is the
    // way that happens.
    const icons = EFFECTS.map((effect) => {
      const { icon } = rallyPickupSplashView(effect);
      return `${icon.kind}:${icon.id}`;
    });
    expect(new Set(icons).size).toBe(EFFECTS.length);
    expect(new Set(EFFECTS.map((effect) => rallyPickupSplashView(effect).tone)).size).toBe(
      EFFECTS.length,
    );
    // And the tone is a class TOKEN, never a colour: the stylesheet owns the
    // palette (the no-magic-values rule for anything painter-side).
    for (const effect of EFFECTS) {
      expect(rallyPickupSplashView(effect).tone).toMatch(/^[a-z]+$/);
    }
  });

  it('pins the lifecycle the controller arms its one-shot timer for', () => {
    // Literals: the splash is a MOMENT, and both halves of that (long enough to
    // read at racing speed, short enough not to sit on the screen through the
    // next corner) are these three numbers.
    expect(RALLY_SPLASH_IN_MS).toBe(140);
    expect(RALLY_SPLASH_HOLD_MS).toBe(900);
    expect(RALLY_SPLASH_OUT_MS).toBe(320);
    expect(RALLY_SPLASH_LIFE_MS).toBe(1360);
    expect(RALLY_SPLASH_LIFE_MS).toBe(
      RALLY_SPLASH_IN_MS + RALLY_SPLASH_HOLD_MS + RALLY_SPLASH_OUT_MS,
    );
  });

  it('walks its phases in order, boundary by boundary', () => {
    expect(rallySplashPhaseAt(0)).toBe('in');
    expect(rallySplashPhaseAt(RALLY_SPLASH_IN_MS - 1)).toBe('in');
    expect(rallySplashPhaseAt(RALLY_SPLASH_IN_MS)).toBe('hold');
    expect(rallySplashPhaseAt(RALLY_SPLASH_IN_MS + RALLY_SPLASH_HOLD_MS - 1)).toBe('hold');
    expect(rallySplashPhaseAt(RALLY_SPLASH_IN_MS + RALLY_SPLASH_HOLD_MS)).toBe('out');
    expect(rallySplashPhaseAt(RALLY_SPLASH_LIFE_MS - 1)).toBe('out');
    expect(rallySplashPhaseAt(RALLY_SPLASH_LIFE_MS)).toBe('done');
    expect(rallySplashPhaseAt(RALLY_SPLASH_LIFE_MS * 10)).toBe('done');
    // A negative elapsed (a clock that moved backwards on a resumed tab) reads
    // as the beginning rather than as finished, so a splash can never be born
    // already over.
    expect(rallySplashPhaseAt(-50)).toBe('in');
  });
});
