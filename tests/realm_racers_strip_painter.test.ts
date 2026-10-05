// @vitest-environment jsdom
//
// The Realm Racers race strip resolves a localized string only when the value
// it spells changes: it is painted every frame of a race, and an interpolating
// t() plus its number formatting per cell per frame is work (and garbage) a
// frame whose readout did not move does not owe. The constant labels are
// written once per skeleton rebuild, and a language switch (which forces one)
// re-resolves every cell.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/i18n')>();
  return { ...actual, t: vi.fn(actual.t), formatNumber: vi.fn(actual.formatNumber) };
});

import { formatNumber, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersStrip } from '../src/ui/realm_racers_strip_painter';
import type { RealmRacersHudView } from '../src/ui/realm_racers_view';

function racing(over: Partial<RealmRacersHudView> = {}): RealmRacersHudView {
  return {
    active: true,
    circuitId: 'evergarden_express_tour',
    phase: 'racing',
    countdown: 0,
    lap: 1,
    totalLaps: 3,
    position: 2,
    gridSize: 4,
    elapsed: 61.4,
    speed: 23.6,
    wrongWay: false,
    trackLimit: 'none',
    offTrackIn: 0,
    warded: false,
    wardIn: 0,
    chaseIn: 0,
    decided: false,
    voided: false,
    result: null,
    returnIn: 0,
    canForfeit: true,
    canReset: true,
    resetLocked: false,
    sig: 'race-1|4|quit|reset',
    ...over,
  };
}

let layer: HTMLElement;
let strip: RealmRacersStrip;

const noop = (): void => {};
const tKeys = (): string[] => vi.mocked(t).mock.calls.map(([key]) => key as string);
const text = (selector: string): string | null | undefined =>
  layer.querySelector(selector)?.textContent;

beforeEach(() => {
  layer = document.createElement('div');
  document.body.appendChild(layer);
  strip = new RealmRacersStrip({
    layer: () => layer,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
    reset: noop,
    forfeit: noop,
  });
  strip.update(racing());
  vi.mocked(t).mockClear();
  vi.mocked(formatNumber).mockClear();
});

afterEach(() => {
  layer.remove();
});

describe('the race strip readout', () => {
  it('resolves nothing on a frame whose spelled values did not move', () => {
    // A tenth of a second later and a hair faster: the same whole second, the
    // same rounded speed, so the same text in every cell.
    strip.update(racing({ elapsed: 61.9, speed: 23.7 }));
    strip.update(racing({ elapsed: 61.95, speed: 23.55 }));
    expect(tKeys()).toEqual([]);
    expect(formatNumber).not.toHaveBeenCalled();
  });

  it('resolves exactly the cell whose value moved, and paints it', () => {
    strip.update(racing({ speed: 30.2 }));
    expect(tKeys()).toEqual(['hudChrome.rally.speed']);
    expect(text('.rallyhud-speed')).toBe(t('hudChrome.rally.speed', { speed: '30' }));
    vi.mocked(t).mockClear();
    strip.update(racing({ speed: 30.2, elapsed: 62.1, position: 1, lap: 2 }));
    expect(tKeys().sort()).toEqual(
      ['hudChrome.rally.lap', 'hudChrome.rally.position', 'hudChrome.rally.time'].sort(),
    );
    vi.mocked(t).mockClear();
    // The status lines spell their own inputs the same way.
    strip.update(
      racing({ speed: 30.2, elapsed: 62.1, position: 1, lap: 2, warded: true, wardIn: 4 }),
    );
    expect(tKeys()).toEqual(['hudChrome.rally.wardHeldFor']);
    vi.mocked(t).mockClear();
    strip.update(
      racing({ speed: 30.2, elapsed: 62.1, position: 1, lap: 3, warded: true, wardIn: 4 }),
    );
    expect(tKeys().sort()).toEqual(['hudChrome.rally.finalLap', 'hudChrome.rally.lap'].sort());
  });

  it('writes the constant labels once per rebuild, and re-resolves every cell after a language switch', () => {
    strip.relocalize();
    strip.update(racing());
    const keys = tKeys();
    for (const key of [
      'hudChrome.rally.position',
      'hudChrome.rally.lap',
      'hudChrome.rally.time',
      'hudChrome.rally.speed',
      'hudChrome.rally.wardHeld',
      'hudChrome.rally.offTrack',
      'hudChrome.rally.reset',
      'hudChrome.rally.go',
      'hudChrome.rally.forfeit',
    ]) {
      expect(
        keys.filter((key2) => key2 === key),
        key,
      ).toHaveLength(1);
    }
    expect(text('.rallyhud-reset')).not.toBe('');
    vi.mocked(t).mockClear();
    strip.update(racing({ resetLocked: true }));
    expect(tKeys()).toEqual([]);
  });

  it('writes the wrong-way alert on each rising edge, so a screen reader hears every one', () => {
    const alert = (): HTMLElement => layer.querySelector('.rallyhud-wrong-way') as HTMLElement;
    const warning = t('hudChrome.rally.wrongWay');
    vi.mocked(t).mockClear();
    expect(alert().textContent).toBe('');
    strip.update(racing({ wrongWay: true }));
    expect(alert().textContent).toBe(warning);
    expect(alert().style.display).toBe('block');
    strip.update(racing({ wrongWay: true }));
    expect(tKeys()).toEqual(['hudChrome.rally.wrongWay']);
    strip.update(racing({ wrongWay: false }));
    expect(alert().textContent).toBe('');
    expect(alert().style.display).toBe('none');
    strip.update(racing({ wrongWay: true }));
    expect(alert().textContent).toBe(warning);
    expect(tKeys()).toEqual(['hudChrome.rally.wrongWay', 'hudChrome.rally.wrongWay']);
  });

  it('gives neither the strip nor the standings list a live-region role over its contents', () => {
    expect(layer.querySelector('#realm-racers-hud')?.getAttribute('role')).toBeNull();
    // The two lines that do speak keep their own regions.
    expect(layer.querySelector('.rallyhud-wrong-way')?.getAttribute('role')).toBe('alert');
    expect(layer.querySelector('.rallyhud-limits')?.getAttribute('role')).toBe('status');
  });

  it('arms and disarms the forfeit label only on the press and the lapse', () => {
    vi.useFakeTimers();
    try {
      const forfeit = layer.querySelector('.rallyhud-forfeit') as HTMLButtonElement;
      forfeit.click();
      strip.update(racing());
      expect(tKeys()).toEqual(['hudChrome.rally.forfeitConfirm']);
      vi.mocked(t).mockClear();
      strip.update(racing());
      expect(tKeys()).toEqual([]);
      vi.advanceTimersByTime(5000);
      strip.update(racing());
      expect(tKeys()).toEqual(['hudChrome.rally.forfeit']);
    } finally {
      vi.useRealTimers();
    }
  });
});
