import { afterEach, describe, expect, it } from 'vitest';
import type { RallyPickupEffect } from '../src/sim/realm_racers_pickup_effects';
import { t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersPickupSplash } from '../src/ui/realm_racers_pickup_splash_controller';
import {
  RALLY_SPLASH_HOLD_MS,
  RALLY_SPLASH_IN_MS,
  RALLY_SPLASH_LIFE_MS,
  RALLY_SPLASH_OUT_MS,
  rallyPickupSplashView,
  rallySplashPhaseAt,
} from '../src/ui/realm_racers_pickup_splash_view';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

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

// The controller, over the reusable hand-rolled fake DOM (the Node-env idiom
// for controller suites, tests/CLAUDE.md): the module reaches `document` only
// to mint its own subtree, so a FakeDocument stub on globalThis is the whole
// host it needs, and the injected schedule/cancel pair means no timers run.
describe('the pickup splash controller', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'document');
  });

  function controllerHarness() {
    const doc = new FakeDocument();
    (globalThis as { document?: unknown }).document = doc;
    const layer = doc.createElement('div');
    const noop = (): void => {};
    const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
    const cancelled: number[] = [];
    const splash = new RealmRacersPickupSplash({
      layer: () => layer as unknown as HTMLElement,
      writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
      iconUrl: (icon) => `icon:${icon.kind}:${icon.id}`,
      schedule: (callback, delayMs) => {
        scheduled.push({ callback, delayMs });
        return scheduled.length;
      },
      cancel: (handle) => {
        cancelled.push(handle);
      },
    });
    const root = (): FakeElement | undefined => layer.children[0];
    return { splash, layer, root, scheduled, cancelled };
  }

  it('shows what a box gave and arms one take-down timer for the splash life', () => {
    const h = controllerHarness();
    h.splash.show('charge');
    const root = h.root();
    expect(root).toBeDefined();
    expect(root?.style.display).toBe('flex');
    expect(root?.children[1]?.textContent).toBe(t('hudChrome.rally.pickupCharge'));
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].delayMs).toBe(RALLY_SPLASH_LIFE_MS);
  });

  it('clear() takes it down at once and cancels the pending timer', () => {
    // The two callers this wires: a race ending under a splash (the RealmRacersUi
    // falling match edge) and a locale flip (the Hud language fan-out), both of
    // which must not leave a stale splash on its own clock.
    const h = controllerHarness();
    h.splash.show('nitro');
    expect(h.root()?.style.display).toBe('flex');
    h.splash.clear();
    expect(h.root()?.style.display).toBe('none');
    expect(h.cancelled).toEqual([1]);
    // The timer handle was released with the cancel: a second clear has
    // nothing left to cancel and stays idempotent.
    h.splash.clear();
    expect(h.cancelled).toEqual([1]);
  });

  it('is safe to clear before anything was ever shown', () => {
    const h = controllerHarness();
    expect(() => h.splash.clear()).not.toThrow();
    expect(h.cancelled).toEqual([]);
    expect(h.root()).toBeUndefined();
  });

  it('rises again for the next box after being cleared', () => {
    const h = controllerHarness();
    h.splash.show('ward');
    h.splash.clear();
    h.splash.show('slick');
    expect(h.root()?.style.display).toBe('flex');
    expect(h.root()?.children[1]?.textContent).toBe(t('hudChrome.rally.pickupSlick'));
    expect(h.scheduled).toHaveLength(2);
  });
});
