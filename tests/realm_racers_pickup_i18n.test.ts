import { beforeAll, describe, expect, it } from 'vitest';
import type { RallyPickupEffect } from '../src/sim/realm_racers_pickup_effects';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { realmRacersPickupEffectText } from '../src/ui/realm_racers_pickup_i18n';
import { rallyPickupSplashView } from '../src/ui/realm_racers_pickup_splash_view';

const EFFECTS: readonly RallyPickupEffect[] = ['charge', 'nitro', 'ward', 'slick'];

describe('naming a drawn pickup effect', () => {
  beforeAll(async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
  });

  it('gives every effect its own English line', () => {
    // The literals, so a reworded key is a decision that lands here rather than
    // a silent change to the only words a pilot gets for what a box gave.
    expect(realmRacersPickupEffectText('charge')).toBe('Shells loaded');
    expect(realmRacersPickupEffectText('nitro')).toBe('Nitro ready');
    expect(realmRacersPickupEffectText('ward')).toBe('Ward up');
    expect(realmRacersPickupEffectText('slick')).toBe('Oil ready');
    // Four distinct lines: two effects sharing copy would be a pilot told
    // nothing.
    expect(new Set(EFFECTS.map(realmRacersPickupEffectText)).size).toBe(EFFECTS.length);
  });

  it('names the ward pip and the moment a ward breaks', () => {
    expect(t('hudChrome.rally.wardHeld')).toBe('WARD');
    expect(t('hudChrome.rally.wardBroken')).toBe('Ward broken');
  });

  it('shares its keys with the splash, so the two can never disagree', () => {
    // The big splash and the quiet floating note are the same moment on two
    // surfaces; they resolve through the same four keys on purpose.
    for (const effect of EFFECTS) {
      expect(t(rallyPickupSplashView(effect).labelKey)).toBe(realmRacersPickupEffectText(effect));
    }
  });
});
