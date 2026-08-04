// The Realm Racers class-agnostic one-button kit. It is swapped in only for
// seated racers and resolved identically by Sim and ClientWorld.
//
// Also the rally's data-as-code roster of house pilots: the names and cosmetic
// classes the practice/backfill bots are drawn from. Data only; the driving
// brain is `src/sim/realm_racers_driver.ts` and the lifecycle around it is
// `src/sim/social/realm_racers_bots.ts`.

import { GROUND_BLAST_MAX_RANGE, GROUND_BLAST_RADIUS } from '../realm_racers_ground_blast';
import type { RallyHeldEffect } from '../realm_racers_pickup_effects';
import type { AbilityDef, PlayerClass } from '../types';
import type { KnownAbility } from './classes';

export const REALM_RACERS_ABILITY_ID = 'rally_ground_blast';

/**
 * The two abilities a pickup box can put in a racer's hands (22b, after the
 * operator's mid-review override): the draw fills a HELD slot and the pilot
 * spends it when they want, rather than the effect happening to them at the row.
 *
 * They are ordinary `AbilityDef` records for one reason: the kit resolver below
 * hands them to `meta.known`, and from there the action bar, the keybinds, the
 * gamepad and the mobile bar all work exactly as they do for the signature
 * weapon. A bespoke "held effect" input would have had to be built four times.
 */
export const REALM_RACERS_NITRO_ABILITY_ID = 'rally_nitro';
export const REALM_RACERS_SLICK_ABILITY_ID = 'rally_oil_slick';

export const REALM_RACERS_ABILITIES: Record<string, AbilityDef> = {
  [REALM_RACERS_ABILITY_ID]: {
    id: REALM_RACERS_ABILITY_ID,
    name: 'Ground Blast',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 4.5,
    // The player picks the spot on the ground, so the ability is a
    // `targetMode: 'position'` cast like every other ground-targeted spell and
    // gets the shared reticle for free. Its range is the outer edge of the
    // aiming band; the forward CONE (and the minimum range) are the shell's own
    // rules, re-clamped authoritatively in `src/sim/realm_racers_ground_blast.ts`.
    range: GROUND_BLAST_MAX_RANGE,
    targetMode: 'position',
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    usableWhileMounted: true,
    // The radius is on the effect so the aiming circle, the marker during the
    // flight and the blast are all one number a player can trust.
    effects: [{ type: 'realmRacersGroundBlast', radius: GROUND_BLAST_RADIUS }],
    description:
      'Fires a heavy explosive shell that detonates on impact, shaking the ground and blasting nearby rivals.',
  },
  // Both held effects are SELF casts with no cooldown and no cost: the whole
  // limit is the single charge the pickup granted, so the decision a pilot makes
  // is WHEN to spend it, never whether the button is ready. `offGcd` because a
  // race has no global cooldown to speak of, and `usableWhileMounted` because
  // every racer is on a machine.
  [REALM_RACERS_NITRO_ABILITY_ID]: {
    id: REALM_RACERS_NITRO_ABILITY_ID,
    name: 'Nitro',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    usableWhileMounted: true,
    effects: [{ type: 'realmRacersPickupEffect', effect: 'nitro' }],
    description: 'Burns a nitro charge for a short burst of speed above your machine cap.',
  },
  [REALM_RACERS_SLICK_ABILITY_ID]: {
    id: REALM_RACERS_SLICK_ABILITY_ID,
    name: 'Oil Slick',
    class: 'warrior',
    learnLevel: 1,
    cost: 0,
    castTime: 0,
    cooldown: 0,
    range: 0,
    school: 'physical',
    requiresTarget: false,
    offGcd: true,
    usableWhileMounted: true,
    effects: [{ type: 'realmRacersPickupEffect', effect: 'slick' }],
    description: 'Dumps a slick of oil under your machine. Rivals who drive through it lose grip.',
  },
};

/** The ability a held effect is spent through, by effect id. */
export const REALM_RACERS_EFFECT_ABILITIES: Record<RallyHeldEffect, string> = {
  nitro: REALM_RACERS_NITRO_ABILITY_ID,
  slick: REALM_RACERS_SLICK_ABILITY_ID,
};

/**
 * Per-weapon rally metadata, keyed by the same ability id as the table above.
 * It is deliberately separate from the `AbilityDef`, which is the shared combat
 * shape every class ability wears: how many uses a race grants is a fact about
 * the RALLY, not about the spell.
 */
export interface RealmRacersWeapon {
  /** Uses per race, never refilled. Null would be unlimited fire. */
  charges: number | null;
}

/**
 * Unlimited fire on a 4.5 s cooldown is about sixteen shots over a race, which
 * is spam and asks the player for no decision at all. A budget makes every shot
 * a choice: spend it on the rival beside you now, or save it for the hairpin on
 * the last lap.
 */
export const REALM_RACERS_WEAPON_CHARGES = 3;

export const REALM_RACERS_WEAPONS: Record<string, RealmRacersWeapon> = {
  [REALM_RACERS_ABILITY_ID]: { charges: REALM_RACERS_WEAPON_CHARGES },
};

/** The budget a weapon starts a race with. An id with no rally record fires
 *  without one rather than not at all. */
export function realmRacersWeaponCharges(abilityId: string): number | null {
  return REALM_RACERS_WEAPONS[abilityId]?.charges ?? null;
}

/**
 * The Evergarden Racing Society's house pilots, the names a practice or backfill
 * bot races under. Proper nouns: they splice verbatim on the client exactly like
 * a player name, and are never localized.
 *
 * ONE per grid slot, so a four-pilot practice race reads as a field of rivals
 * rather than as one name with numbers after it. The suffix path in
 * `nextBotName` survives for the case it was written for (a real player already
 * carrying a house name, since names still resolve by name for whispers), but it
 * is the edge case again rather than three rows of every standings strip.
 */
export const REALM_RACERS_BOT_NAMES: readonly string[] = [
  'Mat Driftwright',
  'Nessa Thornwake',
  'Corin Ashvale',
  'Bryn Kettlespoke',
] as const;

/**
 * Cosmetic class variety for house pilots. The rally kit overrides `known` and
 * the machine replaces locomotion outright, so class is purely what the pilot
 * looks like in the seat. The two pet classes are excluded so no beast or demon
 * ever trots onto the circuit behind its rider.
 */
export const REALM_RACERS_BOT_CLASSES: readonly PlayerClass[] = [
  'warrior',
  'rogue',
  'mage',
  'priest',
  'paladin',
  'shaman',
  'druid',
] as const;

/**
 * The kit a seated racer carries, resolved from the weapon SLOT rather than from
 * a hardcoded id. Both of the directions the rally is heading (weapons picked up
 * off the circuit, one signature weapon per machine) are then a different value
 * written into the slot, not a rewrite of this path.
 *
 * `charges` is the slot's BUDGET, mirrored onto `KnownAbility.charges` so the
 * action bar draws the stored-use badge with the machinery every other
 * charge-limited ability already uses. It is deliberately not `bonusCharges`:
 * that field drives the RECHARGE model, which refills, and a race's three shots
 * never do.
 */
export function resolveRealmRacersKit(
  weaponAbilityId: string,
  charges: number | null,
  heldEffect: RallyHeldEffect | null = null,
): KnownAbility[] {
  const def = REALM_RACERS_ABILITIES[weaponAbilityId];
  if (!def) return [];
  // The weapon is FIRST, always. The action bar's activity kit gives slot 0 to
  // the first rally ability a racer knows, so a held effect landing ahead of it
  // would take the leftmost key off the machine's own weapon; everything else
  // the kit grants auto-places into the assignable rows behind it.
  const kit: KnownAbility[] = [
    {
      def,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: def.cooldown,
      effects: def.effects,
      threatFlat: 0,
      threatMult: 1,
      ...(charges === null ? {} : { charges }),
    },
  ];
  // The held effect, when the racer is carrying one: ONE charge, because that is
  // the whole of what a pickup granted. Spending it takes the ability back out
  // of the kit, so an empty slot never sits on the bar pretending to be ready.
  const heldDef = heldEffect
    ? REALM_RACERS_ABILITIES[REALM_RACERS_EFFECT_ABILITIES[heldEffect]]
    : undefined;
  if (heldDef) {
    kit.push({
      def: heldDef,
      rank: 1,
      cost: 0,
      castTime: 0,
      cooldown: heldDef.cooldown,
      effects: heldDef.effects,
      threatFlat: 0,
      threatMult: 1,
      charges: 1,
    });
  }
  return kit;
}

/** Which held effect an ability id spends, or null for anything else (the
 *  weapon, a class ability). The reverse of `REALM_RACERS_EFFECT_ABILITIES`. */
export function realmRacersHeldEffectOf(abilityId: string): RallyHeldEffect | null {
  if (abilityId === REALM_RACERS_NITRO_ABILITY_ID) return 'nitro';
  if (abilityId === REALM_RACERS_SLICK_ABILITY_ID) return 'slick';
  return null;
}
