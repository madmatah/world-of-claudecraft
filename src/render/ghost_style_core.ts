// Which translucent look a character wears this frame, if any.
//
// Every ethereal read is the spirit VEIL (characters/ghost_veil.ts): one
// shared unlit program family linked at boot, drawn with the user's palette
// (characters/spirit_veil_palette_core.ts). A released spirit, the Pale
// Keeper and the quest visions wear the released-spirit palette, Ghost Wolf
// and the Veilbound March their own. Stealth wears one of two palettes by its
// source: the rogue's Duskveil and Smokefade, or any other (the druid cat's
// Stalk, the mage's Greater Invisibility). A dead stealther is a spirit
// first, and a stealthed Ghost Wolf stays a wolf. The Mortar Overdrive ward and
// recovery ghost wear their own palettes, on the pilot and on the machine
// (character_effects.ts syncCharacterVeils dresses both). Three-free so a
// Vitest pins the table.
//
// Who sees a stealther at all is the server's call (server/game.ts
// canObserveEntity never sends one to a hostile viewer), so this only styles
// what the viewer already receives.

import type { Aura, Entity } from '../sim/types';
import type { SpiritVeilPalette } from './characters/spirit_veil_palette_core';
import { shouldRenderStealthGhost } from './stealth';

export type CharacterGhostLook = SpiritVeilPalette;

/** The aura ids of the rogue's stealth (Duskveil, Smokefade). */
export const ROGUE_STEALTH_AURA_IDS: ReadonlySet<string> = new Set(['stealth', 'vanish']);

/** The stealth palette for the stealth aura(s) a body carries. */
export function stealthVeilPalette(auras: readonly Pick<Aura, 'id' | 'kind'>[]): SpiritVeilPalette {
  for (const aura of auras) {
    if (aura.kind === 'stealth' && ROGUE_STEALTH_AURA_IDS.has(aura.id)) return 'stealth-rogue';
  }
  return 'stealth-other';
}

export function characterGhostLook(
  viewerId: number,
  e: Entity,
  ghostWolf: boolean,
  veilbound: 'march' | 'mark' | 'none',
): CharacterGhostLook | null {
  if (e.ghost) return 'spirit';
  if (shouldRenderStealthGhost(viewerId, e) && !ghostWolf) return stealthVeilPalette(e.auras);
  if (ghostWolf) return 'wolf';
  if (veilbound === 'march') return 'march';
  if (e.templateId.startsWith('vision_') || e.templateId === 'spirit_healer') return 'spirit';
  return null;
}

/**
 * The veil family: the paladin's Veilbound March and Mark, and the Mortar
 * Overdrive ward and recovery ghost, which wear the spirit veil in palettes of
 * their own (a denser March gold, a cold pale) on the pilot and on the whole
 * machine. A ward in its last `MORTAR_OVERDRIVE_WARD_ENDING_SECONDS` is `ward-ending`: the
 * same gold, pulsing, so its holder and every rival see it is about to go.
 *
 * Both racer veils are ACTIONABLE (a shell fired at a warded rival is wasted, a
 * ghosted one will not block you), so they are read off the entity aura every
 * client mirrors and drawn on every graphics tier; nothing here takes a tier.
 * Each is matched by its own aura kind, which nothing else in the game carries.
 */
export type CharacterVeilboundState = 'none' | 'march' | 'mark' | 'ward' | 'ward-ending' | 'ghost';

/** When a ward starts to read as ending, seconds of its aura clock left (the
 *  mirrored `remaining`, which both worlds count down). */
export const MORTAR_OVERDRIVE_WARD_ENDING_SECONDS = 2;
// The offline clock is a sum of float ticks and the mirror's a rounded
// deadline: the tolerance lets both flip on the same tick.
const MORTAR_OVERDRIVE_WARD_ENDING_EPS = 1e-6;

export function characterVeilboundState(e: Entity): CharacterVeilboundState {
  // The racer reads first: a class veil must never mask one. The ghost wins
  // over the ward because it is the short one (it ends the moment the machine
  // is clear) and the one a rival arriving at speed acts on; the gold is back
  // the tick it ends, and the ward stays in the aura row meanwhile.
  if (e.auras.some((a) => a.kind === 'mortar_overdrive_ghost')) return 'ghost';
  const ward = e.auras.find((a) => a.kind === 'mortar_overdrive_ward');
  if (ward) {
    return ward.remaining <= MORTAR_OVERDRIVE_WARD_ENDING_SECONDS + MORTAR_OVERDRIVE_WARD_ENDING_EPS
      ? 'ward-ending'
      : 'ward';
  }
  if (e.auras.some((a) => a.id === 'veilbound_march')) return 'march';
  if (e.auras.some((a) => a.id === 'veilbound_mark')) return 'mark';
  return 'none';
}

/** The class veil a state carries into characterGhostLook: a racer's is none. */
export function classVeilboundState(state: CharacterVeilboundState): 'march' | 'mark' | 'none' {
  return state === 'ward' || state === 'ward-ending' || state === 'ghost' ? 'none' : state;
}

/**
 * Whether the paladin's class look rides the state: the ascension tint and the
 * holy motes rising over the head. A racer's ward and ghost wear their veil
 * only.
 */
export function classVeilActive(state: CharacterVeilboundState): boolean {
  return classVeilboundState(state) !== 'none';
}

/**
 * The spirit veil palette a racer's ward or recovery ghost wears: on the pilot
 * unless a released spirit, stealth or Ghost Wolf claims the rig first (none of
 * which a seated racer can hold), and on the machine always.
 */
export function mortarOverdriveVeilLook(state: CharacterVeilboundState): SpiritVeilPalette | null {
  if (state === 'ward') return 'mortar-overdrive-ward';
  if (state === 'ward-ending') return 'mortar-overdrive-ward-ending';
  return state === 'ghost' ? 'mortar-overdrive-ghost' : null;
}

/**
 * The look a character's own body wears: a released spirit, stealth and Ghost
 * Wolf keep precedence, then a class veil, then the racer veil. A racer's state
 * reads first (characterVeilboundState), so its class veil is none.
 */
export function riderVeilLook(
  viewerId: number,
  e: Entity,
  ghostWolf: boolean,
  state: CharacterVeilboundState,
): CharacterGhostLook | null {
  return (
    characterGhostLook(viewerId, e, ghostWolf, classVeilboundState(state)) ??
    mortarOverdriveVeilLook(state)
  );
}
