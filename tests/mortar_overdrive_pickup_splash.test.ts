import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MortarOverdrivePickupEffect } from '../src/sim/mortar_overdrive/pickup_effects';
import { MortarOverdrivePickupSplash } from '../src/ui/hud/mortar_overdrive/pickup_splash_controller';
import {
  MORTAR_OVERDRIVE_SPLASH_HOLD_MS,
  MORTAR_OVERDRIVE_SPLASH_IN_MS,
  MORTAR_OVERDRIVE_SPLASH_LIFE_MS,
  MORTAR_OVERDRIVE_SPLASH_OUT_MS,
  mortarOverdrivePickupSplashView,
  mortarOverdriveSplashPhaseAt,
} from '../src/ui/hud/mortar_overdrive/pickup_splash_view';
import { t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { FakeDocument, type FakeElement } from './helpers/fake_dom';

const EFFECTS: readonly MortarOverdrivePickupEffect[] = ['charge', 'nitro', 'ward', 'slick'];

describe('the pickup splash view', () => {
  it('gives every effect its own icon, copy key and tone', () => {
    expect(mortarOverdrivePickupSplashView('charge')).toEqual({
      icon: { kind: 'ability', id: 'mortar_overdrive_ground_blast' },
      labelKey: 'hudChrome.mortarOverdrive.pickupCharge',
      tone: 'charge',
    });
    expect(mortarOverdrivePickupSplashView('nitro')).toEqual({
      icon: { kind: 'ability', id: 'mortar_overdrive_nitro' },
      labelKey: 'hudChrome.mortarOverdrive.pickupNitro',
      tone: 'nitro',
    });
    expect(mortarOverdrivePickupSplashView('ward')).toEqual({
      icon: { kind: 'aura', id: 'aura_mortar_overdrive_ward' },
      labelKey: 'hudChrome.mortarOverdrive.pickupWard',
      tone: 'ward',
    });
    expect(mortarOverdrivePickupSplashView('slick')).toEqual({
      icon: { kind: 'ability', id: 'mortar_overdrive_oil_slick' },
      labelKey: 'hudChrome.mortarOverdrive.pickupSlick',
      tone: 'slick',
    });
  });

  it('never shows two effects the same face', () => {
    // A splash whose only job is to say WHICH thing you got fails completely if
    // two of them look alike, and an icon id reused across two effects is the
    // way that happens.
    const icons = EFFECTS.map((effect) => {
      const { icon } = mortarOverdrivePickupSplashView(effect);
      return `${icon.kind}:${icon.id}`;
    });
    expect(new Set(icons).size).toBe(EFFECTS.length);
    expect(
      new Set(EFFECTS.map((effect) => mortarOverdrivePickupSplashView(effect).tone)).size,
    ).toBe(EFFECTS.length);
    // And the tone is a class TOKEN, never a colour: the stylesheet owns the
    // palette (the no-magic-values rule for anything painter-side).
    for (const effect of EFFECTS) {
      expect(mortarOverdrivePickupSplashView(effect).tone).toMatch(/^[a-z]+$/);
    }
  });

  it('pins the lifecycle the controller arms its one-shot timer for', () => {
    // Literals: the splash is a MOMENT, and both halves of that (long enough to
    // read at racing speed, short enough not to sit on the screen through the
    // next corner) are these three numbers.
    expect(MORTAR_OVERDRIVE_SPLASH_IN_MS).toBe(140);
    expect(MORTAR_OVERDRIVE_SPLASH_HOLD_MS).toBe(900);
    expect(MORTAR_OVERDRIVE_SPLASH_OUT_MS).toBe(320);
    expect(MORTAR_OVERDRIVE_SPLASH_LIFE_MS).toBe(1360);
    expect(MORTAR_OVERDRIVE_SPLASH_LIFE_MS).toBe(
      MORTAR_OVERDRIVE_SPLASH_IN_MS +
        MORTAR_OVERDRIVE_SPLASH_HOLD_MS +
        MORTAR_OVERDRIVE_SPLASH_OUT_MS,
    );
  });

  it('walks its phases in order, boundary by boundary', () => {
    expect(mortarOverdriveSplashPhaseAt(0)).toBe('in');
    expect(mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_IN_MS - 1)).toBe('in');
    expect(mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_IN_MS)).toBe('hold');
    expect(
      mortarOverdriveSplashPhaseAt(
        MORTAR_OVERDRIVE_SPLASH_IN_MS + MORTAR_OVERDRIVE_SPLASH_HOLD_MS - 1,
      ),
    ).toBe('hold');
    expect(
      mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_IN_MS + MORTAR_OVERDRIVE_SPLASH_HOLD_MS),
    ).toBe('out');
    expect(mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_LIFE_MS - 1)).toBe('out');
    expect(mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_LIFE_MS)).toBe('done');
    expect(mortarOverdriveSplashPhaseAt(MORTAR_OVERDRIVE_SPLASH_LIFE_MS * 10)).toBe('done');
    // A negative elapsed (a clock that moved backwards on a resumed tab) reads
    // as the beginning rather than as finished, so a splash can never be born
    // already over.
    expect(mortarOverdriveSplashPhaseAt(-50)).toBe('in');
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
    const splash = new MortarOverdrivePickupSplash({
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
    expect(root?.children[1]?.textContent).toBe(t('hudChrome.mortarOverdrive.pickupCharge'));
    expect(h.scheduled).toHaveLength(1);
    expect(h.scheduled[0].delayMs).toBe(MORTAR_OVERDRIVE_SPLASH_LIFE_MS);
  });

  it('clear() takes it down at once and cancels the pending timer', () => {
    // The two callers this wires: a race ending under a splash (the MortarOverdriveUi
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
    expect(h.root()?.children[1]?.textContent).toBe(t('hudChrome.mortarOverdrive.pickupSlick'));
    expect(h.scheduled).toHaveLength(2);
  });
});

// The splash timings exist TWICE: the constants above arm the controller's
// one-shot take-down timer, and src/styles/components.css spells the same
// lifecycle as an animation duration plus keyframe stops. Nothing at runtime
// connects the two, so this reads the sheet (the editor_circuit_page idiom) and
// holds the stops to the TS phase boundaries: retiming the splash in one place
// without the other fails here instead of shipping a splash whose fade
// disagrees with its own timer.
describe('the pickup splash stylesheet timing', () => {
  const css = readFileSync(resolve(import.meta.dirname, '../src/styles/components.css'), 'utf8');

  /** The named keyframes body, brace-matched because the stops nest braces. */
  function keyframes(name: string): string {
    const at = css.indexOf(`@keyframes ${name}`);
    expect(at, `components.css declares @keyframes ${name}`).toBeGreaterThan(-1);
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) return css.slice(open + 1, i);
      }
    }
    throw new Error(`unbalanced @keyframes ${name}`);
  }

  function stops(block: string): { at: number; body: string }[] {
    return [...block.matchAll(/([\d.]+)%\s*\{([^}]*)\}/g)].map((match) => ({
      at: Number(match[1]),
      body: match[2],
    }));
  }

  /** Where a TS phase boundary falls, as a percent of the animation. */
  const percentOf = (ms: number): number => (ms / MORTAR_OVERDRIVE_SPLASH_LIFE_MS) * 100;

  it('runs both pop animations for exactly the controller timer life', () => {
    for (const [className, animation] of [
      ['mortar-overdrive-splash-a', 'mortar-overdrive-splash-pop-a'],
      ['mortar-overdrive-splash-b', 'mortar-overdrive-splash-pop-b'],
    ] as const) {
      const rule = new RegExp(
        `\\.${className}\\s*\\{[^}]*animation:\\s*${animation}\\s+([\\d.]+)s\\b`,
      ).exec(css);
      expect(rule, `.${className} arms ${animation} with a literal duration`).not.toBeNull();
      expect(Math.round(Number(rule?.[1]) * 1000), className).toBe(MORTAR_OVERDRIVE_SPLASH_LIFE_MS);
    }
  });

  it('places every opacity stop on a TS phase boundary, within one point', () => {
    // The reduced-motion fade rides the same clock (only animation-name is
    // overridden), so it answers to the same boundaries as the two pops.
    for (const name of [
      'mortar-overdrive-splash-pop-a',
      'mortar-overdrive-splash-pop-b',
      'mortar-overdrive-splash-fade',
    ]) {
      const all = stops(keyframes(name));
      expect(all.length, name).toBeGreaterThanOrEqual(4);
      const opacity = all
        .map(({ at, body }) => ({ at, value: /opacity\s*:\s*([\d.]+)/.exec(body)?.[1] }))
        .filter((stop) => stop.value !== undefined);
      // Born invisible, fully gone at the end of the life.
      expect(opacity[0], name).toEqual({ at: 0, value: '0' });
      expect(opacity[opacity.length - 1], name).toEqual({ at: 100, value: '0' });
      // Arrived where the TS pop-in ends...
      const arrived = opacity.find((stop) => stop.value === '1');
      expect(arrived, `${name} reaches full opacity`).toBeDefined();
      expect(
        Math.abs((arrived?.at ?? 0) - percentOf(MORTAR_OVERDRIVE_SPLASH_IN_MS)),
        `${name} pop-in boundary`,
      ).toBeLessThanOrEqual(1);
      // ...and held until the TS hold ends, which is where the fade-out starts.
      const held = [...opacity].reverse().find((stop) => stop.value === '1');
      expect(
        Math.abs(
          (held?.at ?? 0) -
            percentOf(MORTAR_OVERDRIVE_SPLASH_IN_MS + MORTAR_OVERDRIVE_SPLASH_HOLD_MS),
        ),
        `${name} fade-out boundary`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
