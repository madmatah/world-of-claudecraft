// @vitest-environment jsdom
//
// The Mortar Overdrive podium resolves its return headline only when the second
// or the result it spells moves: it is painted every frame the ceremony is up.
// A rebuild (a new classification, or a language switch) re-resolves it.

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/ui/i18n')>();
  return { ...actual, t: vi.fn(actual.t) };
});
// The class crest needs a 2D canvas jsdom does not have; the podium only
// needs a string for it.
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: (_kind: string, key: string) => `data:${key}`,
}));

import { MortarOverdrivePodium } from '../src/ui/hud/mortar_overdrive/podium_painter';
import type {
  MortarOverdrivePodiumEntry,
  MortarOverdrivePodiumView,
} from '../src/ui/hud/mortar_overdrive/podium_view';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';

const entry = (pid: number, placing: number): MortarOverdrivePodiumEntry => ({
  pid,
  placing,
  name: `Racer${pid}`,
  cls: 'warrior',
  isMe: pid === 1,
  finishSeconds: 60 + placing,
  lap: 3,
  retired: false,
});

function podium(over: Partial<MortarOverdrivePodiumView> = {}): MortarOverdrivePodiumView {
  return {
    active: true,
    circuitId: 'evergarden_express_tour',
    steps: [entry(2, 2), entry(1, 1), entry(3, 3)],
    rest: [],
    totalLaps: 3,
    result: 'won',
    returnIn: 6,
    sig: '7|evergarden_express_tour|won|1:1*,2:2,3:3',
    ...over,
  };
}

const RETURN_KEYS = new Set([
  'hudChrome.mortarOverdrive.wonReturn',
  'hudChrome.mortarOverdrive.drawReturn',
  'hudChrome.mortarOverdrive.lostReturn',
]);
const returnResolves = (): string[] =>
  vi
    .mocked(t)
    .mock.calls.map(([key]) => key as string)
    .filter((key) => RETURN_KEYS.has(key));

beforeAll(async () => {
  await ensureLocaleLoaded('zh_CN');
});

afterEach(() => {
  setLanguage('en');
  document.body.innerHTML = '';
});

describe('the podium return headline', () => {
  it('resolves only when the second or the result moves, and again after a rebuild', () => {
    const layer = document.createElement('div');
    document.body.appendChild(layer);
    const noop = (): void => {};
    const painter = new MortarOverdrivePodium({
      layer: () => layer,
      writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
    });
    const headline = (): string | null | undefined =>
      layer.querySelector('.mortar-overdrive-podium-return')?.textContent;
    painter.update(podium());
    expect(headline()).toBe(t('hudChrome.mortarOverdrive.wonReturn', { seconds: '6' }));
    vi.mocked(t).mockClear();
    for (let frame = 0; frame < 5; frame++) painter.update(podium());
    expect(returnResolves()).toEqual([]);
    painter.update(podium({ returnIn: 5 }));
    expect(returnResolves()).toEqual(['hudChrome.mortarOverdrive.wonReturn']);
    expect(headline()).toBe(t('hudChrome.mortarOverdrive.wonReturn', { seconds: '5' }));
    vi.mocked(t).mockClear();
    painter.update(podium({ returnIn: 5, result: 'draw' }));
    expect(returnResolves()).toEqual(['hudChrome.mortarOverdrive.drawReturn']);
    // A language switch forces a rebuild, which re-resolves the headline.
    const english = headline();
    setLanguage('zh_CN');
    painter.relocalize();
    painter.update(podium({ returnIn: 5, result: 'draw' }));
    expect(headline()).toBe(t('hudChrome.mortarOverdrive.drawReturn', { seconds: '5' }));
    expect(headline()).not.toBe(english);
  });
});
