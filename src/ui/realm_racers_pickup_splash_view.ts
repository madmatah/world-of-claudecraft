// The pickup splash: what a big on-screen flash of a drawn pickup effect SAYS,
// and how long it stands there.
//
// A kart-racer moment. The FCT self-note and the held-ability slot both survive
// beside it and do different jobs: the note is a line in the corner of the eye,
// the slot is the STATE (a button you still hold), and this is the MOMENT, big
// enough to read at racing speed without looking away from the road.
//
// Pure core: no DOM, no three, no i18n, no clock of its own (elapsed
// milliseconds are an argument). It decides which icon and which copy key stand
// for an effect and where the transient sits in its own life; the controller
// beside it owns the element, `t()`, the icon composition and the timers.
//
// FAIRNESS: nothing here reads a graphics tier or an effects preset, and
// nothing may. A pickup splash is the only readout of what a box gave, so every
// player on every preset gets the same one.

import type { RallyPickupEffect } from '../sim/realm_racers_pickup_effects';
import type { TranslationKey } from './i18n.catalog';

/**
 * The icon a splash shows, as the arguments `iconDataUrl` takes.
 *
 * Composed through the shared icon machinery rather than an image asset or an
 * emoji: the two held effects already have ability icons (they are abilities on
 * the action bar), the refill borrows the machine's own weapon, and the ward
 * uses its aura recipe.
 */
export interface RallyPickupSplashIcon {
  kind: 'ability' | 'aura';
  id: string;
}

export interface RallyPickupSplashView {
  icon: RallyPickupSplashIcon;
  /** The line under the icon. The same four keys the FCT note uses, so the
   *  moment and the note can never disagree about what was drawn. */
  labelKey: TranslationKey;
  /** A stable class token per effect, so the tone is a stylesheet decision and
   *  this module holds no colour. */
  tone: string;
}

const SPLASHES: Record<RallyPickupEffect, RallyPickupSplashView> = {
  charge: {
    icon: { kind: 'ability', id: 'rally_ground_blast' },
    labelKey: 'hudChrome.rally.pickupCharge',
    tone: 'charge',
  },
  nitro: {
    icon: { kind: 'ability', id: 'rally_nitro' },
    labelKey: 'hudChrome.rally.pickupNitro',
    tone: 'nitro',
  },
  ward: {
    icon: { kind: 'aura', id: 'aura_rally_ward' },
    labelKey: 'hudChrome.rally.pickupWard',
    tone: 'ward',
  },
  slick: {
    icon: { kind: 'ability', id: 'rally_oil_slick' },
    labelKey: 'hudChrome.rally.pickupSlick',
    tone: 'slick',
  },
};

/** What to show for one drawn effect. Exhaustive over the union by
 *  construction, so a fifth effect is a compile error here. */
export function rallyPickupSplashView(effect: RallyPickupEffect): RallyPickupSplashView {
  return SPLASHES[effect];
}

/** The pixel size the splash composes its icon at. */
export const RALLY_SPLASH_ICON_SIZE = 128;

/** Every icon a splash can show, one per effect, for the race warm to compose
 *  before the first pickup. */
export function rallyPickupSplashIcons(): readonly RallyPickupSplashIcon[] {
  return Object.values(SPLASHES).map((splash) => splash.icon);
}

/** How long the splash pops IN, milliseconds: fast enough that it is already
 *  readable by the time a pilot's eye reaches it. */
export const RALLY_SPLASH_IN_MS = 140;
/** How long it stands at full size once it has arrived. */
export const RALLY_SPLASH_HOLD_MS = 900;
/** And how long it takes to fade out afterwards. */
export const RALLY_SPLASH_OUT_MS = 320;
/** The whole life of one splash, which is what the controller's one-shot timer
 *  is armed for. */
export const RALLY_SPLASH_LIFE_MS = RALLY_SPLASH_IN_MS + RALLY_SPLASH_HOLD_MS + RALLY_SPLASH_OUT_MS;

export type RallySplashPhase = 'in' | 'hold' | 'out' | 'done';

/**
 * Where a splash is in its own life, given how long it has been up.
 *
 * The controller drives the visuals with CSS (one class, one animation) rather
 * than a per-frame paint, so nothing in the game reads this every frame; it is
 * here because the phase boundaries are the thing worth pinning, and a test can
 * assert them without a browser.
 */
export function rallySplashPhaseAt(elapsedMs: number): RallySplashPhase {
  if (elapsedMs < 0) return 'in';
  if (elapsedMs < RALLY_SPLASH_IN_MS) return 'in';
  if (elapsedMs < RALLY_SPLASH_IN_MS + RALLY_SPLASH_HOLD_MS) return 'hold';
  if (elapsedMs < RALLY_SPLASH_LIFE_MS) return 'out';
  return 'done';
}
