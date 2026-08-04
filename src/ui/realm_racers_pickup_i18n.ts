// The one place a drawn pickup effect becomes a line a pilot can read.
//
// The sim decides WHAT a box gave and says so with an id
// (`realmRacersPickup`, `src/sim/realm_racers_pickup_effects.ts`); the words are
// the client's, in the player's own language, exactly like the circuit names
// next door in `realm_racers_circuit_i18n.ts`. Nothing on the wire is English.
//
// It owns the id-to-key rule and nothing else: no DOM, no state, no fallback
// text. The map is exhaustive over the union, so adding an effect to the sim is
// a compile error here until it has been given words.

import type { RallyPickupEffect } from '../sim/realm_racers_pickup_effects';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';

const PICKUP_EFFECT_KEYS: Record<RallyPickupEffect, TranslationKey> = {
  charge: 'hudChrome.rally.pickupCharge',
  nitro: 'hudChrome.rally.pickupNitro',
  ward: 'hudChrome.rally.pickupWard',
  slick: 'hudChrome.rally.pickupSlick',
};

/** What the box just gave you, named. */
export function realmRacersPickupEffectText(effect: RallyPickupEffect): string {
  return t(PICKUP_EFFECT_KEYS[effect]);
}
