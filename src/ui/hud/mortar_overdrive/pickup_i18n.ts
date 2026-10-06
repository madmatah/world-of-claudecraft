// The one place a drawn pickup effect becomes a line a pilot can read.
//
// The sim decides WHAT a box gave and says so with an id
// (`mortarOverdrivePickup`, `src/sim/mortar_overdrive/pickup_effects.ts`); the words are
// the client's, in the player's own language, exactly like the circuit names
// next door in `mortar_overdrive/circuit_i18n.ts`. Nothing on the wire is English.
//
// It owns the id-to-key rule and nothing else: no DOM, no state, no fallback
// text. The map is exhaustive over the union, so adding an effect to the sim is
// a compile error here until it has been given words.

import type { MortarOverdrivePickupEffect } from '../../../sim/mortar_overdrive';
import { t } from '../../i18n';
import type { TranslationKey } from '../../i18n.catalog';

const PICKUP_EFFECT_KEYS: Record<MortarOverdrivePickupEffect, TranslationKey> = {
  charge: 'hudChrome.mortarOverdrive.pickupCharge',
  nitro: 'hudChrome.mortarOverdrive.pickupNitro',
  ward: 'hudChrome.mortarOverdrive.pickupWard',
  slick: 'hudChrome.mortarOverdrive.pickupSlick',
};

/** What the box just gave you, named. */
export function mortarOverdrivePickupEffectText(effect: MortarOverdrivePickupEffect): string {
  return t(PICKUP_EFFECT_KEYS[effect]);
}
