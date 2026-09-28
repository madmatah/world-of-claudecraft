import { beforeAll, describe, expect, it } from 'vitest';
import type { RallyPickupEffect } from '../src/sim/realm_racers_pickup_effects';
import { auraDisplayNameFromSource } from '../src/ui/aura_display_name';
import { ensureLocaleLoaded, setLanguage, t } from '../src/ui/i18n';
import { realmRacersPickupEffectText } from '../src/ui/realm_racers_pickup_i18n';
import { rallyPickupSplashView } from '../src/ui/realm_racers_pickup_splash_view';
import { localizeSimAuraName } from '../src/ui/sim_i18n';

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

  it('names the ward AURA through the sim-text path every other aura uses', () => {
    // The buff bar resolves an aura with no ability record behind it through the
    // sim-name map, so the ward has to be IN that map: an unmapped name would
    // ship the sim's raw English to every locale.
    expect(auraDisplayNameFromSource('Racing Ward')).toBe('Racing Ward');
    // Mapped, not merely echoed: the fallback returns the input unchanged, so a
    // locale that really translates it is the decisive check.
    expect(localizeSimAuraName('Racing Ward')).toBe('Racing Ward');
    expect(localizeSimAuraName('a name nothing maps')).toBeNull();
    // A locale that really translates it, which is what proves the name is
    // MAPPED rather than merely echoed back unchanged.
    setLanguage('ru_RU');
    try {
      expect(localizeSimAuraName('Racing Ward')).toBe('Гоночный щит');
    } finally {
      setLanguage('en');
    }
  });

  it('names the recovery GHOST aura through the same sim-text path, mapped not echoed', () => {
    expect(auraDisplayNameFromSource('Ghosted')).toBe('Ghosted');
    expect(localizeSimAuraName('Ghosted')).toBe('Ghosted');
    setLanguage('ru_RU');
    try {
      expect(localizeSimAuraName('Ghosted')).toBe('Призрак');
    } finally {
      setLanguage('en');
    }
  });

  it('shares its keys with the splash, so the two can never disagree', () => {
    // The big splash and the quiet floating note are the same moment on two
    // surfaces; they resolve through the same four keys on purpose.
    for (const effect of EFFECTS) {
      expect(t(rallyPickupSplashView(effect).labelKey)).toBe(realmRacersPickupEffectText(effect));
    }
  });
});
