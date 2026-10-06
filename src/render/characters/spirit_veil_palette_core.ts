// The spirit veil's looks: one palette per veil user, and what a rig keeps
// while it wears one.
//
// A palette is uniform VALUES on the veil's shared programs (ghost_veil.ts),
// never a new program key, so every user draws the same pinned family
// (spirit_veil_family_core.ts). Colours are sRGB hex; three converts them to
// the working space.
//
// Three-free and deterministic: tests drive it directly.

export type SpiritVeilPalette =
  | 'spirit'
  | 'wolf'
  | 'march'
  | 'stealth-rogue'
  | 'stealth-other'
  | 'moonkin'
  | 'soul-rend'
  | 'mortar-overdrive-ward'
  | 'mortar-overdrive-ward-ending'
  | 'mortar-overdrive-ghost';

export interface SpiritVeilPaletteValues {
  tint: number;
  deep: number;
  rim: number;
  /** Past 1 the rim blooms on the composer tiers and saturates on the direct
   *  ones. */
  rimStrength: number;
  /** The body's alpha; the rim always rises to 1. */
  opacity: number;
  /** Height in yards over which the body fades up from its darker feet. */
  rise: number;
  /** Vertex ripple amplitude, replayed by the depth pre-pass. */
  shimmer: number;
  /** 0: the monochrome veil (deep to tint by texel luminance); 1: the rig's
   *  own colours (map, source colour and outfit dye) under the same rise,
   *  bands and rim. */
  keepColor: number;
  /** Depth of the rising bands: 0 is a still body. */
  band: number;
}

const MORTAR_OVERDRIVE_WARD_LOOK: Readonly<SpiritVeilPaletteValues> = {
  tint: 0xffd35a,
  deep: 0x8a6418,
  rim: 0xfeb50b,
  rimStrength: 1.93,
  opacity: 0.9,
  rise: 1.22,
  shimmer: 0,
  keepColor: 1,
  band: 0.42,
};

export const SPIRIT_VEIL_PALETTES: Readonly<
  Record<SpiritVeilPalette, Readonly<SpiritVeilPaletteValues>>
> = {
  // A released spirit (e.ghost), the Pale Keeper and the quest visions.
  spirit: {
    tint: 0x7cade1,
    deep: 0x213055,
    rim: 0x90c0ff,
    rimStrength: 2.69,
    opacity: 0.24,
    rise: 1.1,
    shimmer: 0.012,
    keepColor: 0,
    band: 0.3,
  },
  // The shaman's Ghost Wolf: a living combatant, never the dead blue.
  wolf: {
    tint: 0xb1a99a,
    deep: 0x787878,
    rim: 0xa3a39e,
    rimStrength: 1.15,
    opacity: 0.23,
    rise: 0.72,
    shimmer: 0,
    keepColor: 1,
    band: 0.3,
  },
  // The protection paladin's Veilbound March: holy gold.
  march: {
    tint: 0xffe2a0,
    deep: 0x5a4420,
    rim: 0xffd27a,
    rimStrength: 1.03,
    opacity: 0.12,
    rise: 0.6,
    shimmer: 0.01,
    keepColor: 1,
    band: 0.22,
  },
  // The rogue's Duskveil and Smokefade.
  'stealth-rogue': {
    tint: 0x6b7690,
    deep: 0x854686,
    rim: 0x9f3e2d,
    rimStrength: 2.55,
    opacity: 0.08,
    rise: 1.1,
    shimmer: 0,
    keepColor: 0.65,
    band: 0,
  },
  // The druid cat's Stalk and the mage's Greater Invisibility.
  'stealth-other': {
    tint: 0x6b7690,
    deep: 0x0d1018,
    rim: 0x725d4f,
    rimStrength: 0.21,
    opacity: 0.31,
    rise: 0.49,
    shimmer: 0,
    keepColor: 0.58,
    band: 0.36,
  },
  // The balance druid's Moonwing Form (no rig of its own: the druid's body).
  moonkin: {
    tint: 0x9373dd,
    deep: 0x3a2270,
    rim: 0xc9b8f5,
    rimStrength: 0.45,
    opacity: 0.71,
    rise: 1.1,
    shimmer: 0,
    keepColor: 0,
    band: 0.3,
  },
  // Nythraxis' Soul Rend mark, on whichever body the raider wears.
  'soul-rend': {
    tint: 0x552a2a,
    deep: 0x2b0303,
    rim: 0x930b0b,
    rimStrength: 1.07,
    opacity: 0.8,
    rise: 0.81,
    shimmer: 0,
    keepColor: 0,
    band: 1,
  },
  // A Mortar Overdrive machine carrying the ward, which a Ground Blast will not
  // touch: the March's look, far denser, with a hot gold rim, so it reads on
  // a kart at racing distance. Tuned live on the machine.
  'mortar-overdrive-ward': MORTAR_OVERDRIVE_WARD_LOOK,
  // The same ward in its last seconds: the same values, pulsed
  // (SPIRIT_VEIL_PULSES), so the rig swaps palette once when the ward starts
  // to run out and every ending ward shares the one pulsing uniform set.
  'mortar-overdrive-ward-ending': MORTAR_OVERDRIVE_WARD_LOOK,
  // A Mortar Overdrive machine just recovered onto the road, which rivals drive
  // through: its own colours under a pale, still, see-through body, never the
  // released spirit's blue. Tuned live on the machine.
  'mortar-overdrive-ghost': {
    tint: 0xeef3f8,
    deep: 0x9aa6b4,
    rim: 0xf2f7ff,
    rimStrength: 0.29,
    opacity: 0.42,
    rise: 0.56,
    shimmer: 0,
    keepColor: 1,
    band: 0,
  },
};

/**
 * The veils a player ACTS on (docs/design/graphics-settings-fairness.md): Soul
 * Rend, and a Mortar Overdrive rival's ward (ending or not) and recovery ghost.
 * They mount on the frame their state lands, never staged behind the effect
 * gate: a staged veil that never proves its link would leave the state unread
 * while it holds. A tuple the boot family has not linked yet links live
 * instead, once.
 */
export const SPIRIT_VEIL_NEVER_DEFERRED: ReadonlySet<SpiritVeilPalette> =
  new Set<SpiritVeilPalette>([
    'soul-rend',
    'mortar-overdrive-ward',
    'mortar-overdrive-ward-ending',
    'mortar-overdrive-ghost',
  ]);

/** A palette whose rim strength and body opacity pulse on the world clock. */
export interface SpiritVeilPulse {
  /** Full-to-dim-to-full cycles per second. */
  hz: number;
  /** The trough, as a fraction of the palette's own rim strength and body
   *  opacity. Above 0: the veil dims, it never goes out. */
  dim: number;
}

/** How fast an ending ward pulses, cycles per second. Kept under three a
 *  second, the flash-safety ceiling. */
export const MORTAR_OVERDRIVE_WARD_ENDING_PULSE_HZ = 2.5;
/** How far an ending ward dims at the trough, as a fraction of the full
 *  ward's rim and body: a dimmer gold, still plainly a ward. */
export const MORTAR_OVERDRIVE_WARD_ENDING_DIM = 0.4;

export const SPIRIT_VEIL_PULSES: Readonly<
  Partial<Record<SpiritVeilPalette, Readonly<SpiritVeilPulse>>>
> = {
  'mortar-overdrive-ward-ending': {
    hz: MORTAR_OVERDRIVE_WARD_ENDING_PULSE_HZ,
    dim: MORTAR_OVERDRIVE_WARD_ENDING_DIM,
  },
};

/**
 * The pulse's level at `timeSec` on the world clock: 1 at the crest, `dim` at
 * the trough, a raised cosine between. Null time (reduced motion) holds the
 * trough, a still look that differs from the full palette, so the read
 * survives without the motion.
 */
export function spiritVeilPulseLevel(pulse: SpiritVeilPulse, timeSec: number | null): number {
  if (timeSec === null) return pulse.dim;
  const crest = 0.5 + 0.5 * Math.cos(2 * Math.PI * pulse.hz * timeSec);
  return pulse.dim + (1 - pulse.dim) * crest;
}

/** What a veiled rig keeps. The class halo is hidden under every palette. */
export interface SpiritVeilPolicy {
  castsShadow: boolean;
  /** The weapon-skin VFX parts and their light; hidden, the light is held at
   *  intensity 0 and stays counted. */
  weaponVfx: boolean;
}

export const SPIRIT_VEIL_POLICY: Readonly<Record<SpiritVeilPalette, Readonly<SpiritVeilPolicy>>> = {
  spirit: { castsShadow: false, weaponVfx: false },
  wolf: { castsShadow: false, weaponVfx: false },
  march: { castsShadow: false, weaponVfx: true },
  'stealth-rogue': { castsShadow: false, weaponVfx: false },
  'stealth-other': { castsShadow: false, weaponVfx: false },
  moonkin: { castsShadow: true, weaponVfx: true },
  'soul-rend': { castsShadow: false, weaponVfx: true },
  'mortar-overdrive-ward': { castsShadow: false, weaponVfx: false },
  'mortar-overdrive-ward-ending': { castsShadow: false, weaponVfx: false },
  'mortar-overdrive-ghost': { castsShadow: false, weaponVfx: false },
};
