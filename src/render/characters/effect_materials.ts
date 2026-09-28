// The transparent-clone recipe every character effect overlay shares.
//
// `setGhost` (stealth, the spirit run, visions, ghost wolf, the spirit healer,
// the veilbound march), `setShadowform` and `setMoonkin` all mount a clone of
// the rig's live material with `transparent = true`. Three keys its program
// cache on that flip (`opaque` in WebGLPrograms.getParameters), so each of
// those clones is a SECOND program per rig material, and a production capture
// measured them linking cold inside a gameplay frame in a crowd
// (`paladin_metallic` 4808 ms, `mod_cloth` and `mod_jewel` 115 to 130 ms each).
//
// The recipe lives here, in one exported factory per flavour, so the boot
// prewarm twin (character_effect_prewarm.ts) mints the SAME clone the live
// path mounts and the two cannot drift into different program keys.
//
// The three flavours differ ONLY in opacity, base colour and emissive, none of
// which three reads into a program cache key: they resolve to ONE program per
// source material, which is why the prewarm group carries one twin for all
// three.
//
// Every clone goes through cloneMaterialWithHooks for the reason
// material_clone_hooks.ts spells out: a bare clone() drops onBeforeCompile, so
// it renders without the rim glow, the worn detail layer and the player's
// armour dye, AND links a whole new program because three's cache key defaults
// to `onBeforeCompile.toString()`.

import * as THREE from 'three';
import { cloneMaterialWithHooks } from '../material_clone_hooks';

/** Translucent-rig flavor: 'spirit' is the thin ghost run (released spirits,
 *  ghost wolf, the graveyard angel, the Veilbound March); 'stealth' is the
 *  denser Duskveil fade; 'ward' is the March's veil recoloured gold, worn by a
 *  racer carrying the Realm Racers ward; 'ghost' is the same veil washed pale,
 *  worn by a racer the recovery made intangible to rival machines. */
export type GhostStyle = 'spirit' | 'stealth' | 'ward' | 'ghost';

/** Every overlay that flips `transparent` on a rig material. */
type CharacterEffectStyle = GhostStyle | 'shadowform' | 'moonkin';

const GHOST_OPACITY = 0.34;
// Stealth (Duskveil/Smokefade) reads as a faded-but-solid silhouette, a touch
// denser than the spirit run's 0.34 (owner: stealth was "too transparent").
const STEALTH_OPACITY = 0.45;
// The racing ward: denser than the spirit run so the rider still reads in the
// seat at racing distance, and gold so a rival reads it as a shield.
const WARD_OPACITY = 0.6;
const WARD_TINT = new THREE.Color(0xffd35a);
const WARD_TINT_STRENGTH = 0.6;
const WARD_EMISSIVE_HEX = 0xb8860b;
const WARD_EMISSIVE_INTENSITY = 0.6;
// The recovery ghost: pale and see-through, so a rival reads "this will not
// block me" at racing distance, and never mistakes it for the gold ward.
const RALLY_GHOST_OPACITY = 0.4;
const RALLY_GHOST_TINT = new THREE.Color(0xe4ecf4);
const RALLY_GHOST_TINT_STRENGTH = 0.7;
const SHADOWFORM_OPACITY = 0.9;
const SHADOWFORM_TINT = new THREE.Color(0x5a2a8f);
const SHADOWFORM_EMISSIVE_HEX = 0x2a0a4a;
const SHADOWFORM_EMISSIVE_INTENSITY = 0.4;
// Moonkin Form: a brighter, more luminous violet than the ghost run (owner's brief: a
// purplish tint like ghost form but a bit brighter).
const MOONKIN_OPACITY = 0.72;
const MOONKIN_TINT = new THREE.Color(0x9d6bff);
const MOONKIN_EMISSIVE_HEX = 0x6a3fd0;
const MOONKIN_EMISSIVE_INTENSITY = 0.55;

/** userData marker every clone this module mints carries, so a factory-built
 *  variant is distinguishable from a hand-rolled one. */
const CHARACTER_EFFECT_MARKER = 'wocCharacterEffect';

type TintableMaterial = THREE.Material & {
  color?: THREE.Color;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

/**
 * The program-relevant half of the recipe, and the only part the twin has to
 * reproduce byte for byte: the hook-preserving clone plus `transparent`.
 *
 * `depthWrite` stays ON: with it off the whole rig depth-blends against itself,
 * so back faces and far limbs shine through the chest (the x-ray the owner
 * reported on Duskveil). Writing depth lets nearer faces occlude farther ones
 * and the body reads as one uniformly faded silhouette. It is NOT a program
 * cache key input either way.
 */
function cloneTransparent(source: THREE.Material, style: CharacterEffectStyle): TintableMaterial {
  const clone = cloneMaterialWithHooks(source) as TintableMaterial;
  clone.transparent = true;
  clone.depthWrite = true;
  (clone.userData as { [CHARACTER_EFFECT_MARKER]?: CharacterEffectStyle })[
    CHARACTER_EFFECT_MARKER
  ] = style;
  return clone;
}

/** The ghost run / stealth fade / ward veil clone of `source`. */
export function createGhostEffectMaterial(
  source: THREE.Material,
  style: GhostStyle = 'spirit',
): THREE.Material {
  const clone = cloneTransparent(source, style);
  paintGhostEffectMaterial(clone, source, style);
  return clone;
}

/** The opacity a ghost clone wears for `style`. */
export function ghostEffectOpacity(style: GhostStyle): number {
  if (style === 'stealth') return STEALTH_OPACITY;
  if (style === 'ward') return WARD_OPACITY;
  return style === 'ghost' ? RALLY_GHOST_OPACITY : GHOST_OPACITY;
}

/**
 * Paint a ghost clone for `style` from its `source`, in place: one clone serves
 * every flavour (stealth to death to ghost run, or a ward veil, reuses it), so
 * a flip rewrites the look. Opacity, colour and emissive are uniforms, never
 * program-key inputs, so a repaint never relinks.
 */
export function paintGhostEffectMaterial(
  clone: THREE.Material,
  source: THREE.Material,
  style: GhostStyle,
): void {
  const target = clone as TintableMaterial;
  const from = source as TintableMaterial;
  target.opacity = ghostEffectOpacity(style);
  if (target.color && from.color) {
    target.color.copy(from.color);
    if (style === 'ward') target.color.lerp(WARD_TINT, WARD_TINT_STRENGTH);
    if (style === 'ghost') target.color.lerp(RALLY_GHOST_TINT, RALLY_GHOST_TINT_STRENGTH);
  }
  if (target.emissive && from.emissive) {
    if (style === 'ward') {
      target.emissive.setHex(WARD_EMISSIVE_HEX);
      target.emissiveIntensity = Math.max(from.emissiveIntensity ?? 0, WARD_EMISSIVE_INTENSITY);
    } else {
      target.emissive.copy(from.emissive);
      target.emissiveIntensity = from.emissiveIntensity ?? 1;
    }
  }
}

/** The Shadowform clone of `source`. */
export function createShadowformEffectMaterial(source: THREE.Material): THREE.Material {
  const clone = cloneTransparent(source, 'shadowform');
  clone.opacity = SHADOWFORM_OPACITY;
  if (clone.color) clone.color.copy(SHADOWFORM_TINT);
  if (clone.emissive) {
    clone.emissive.setHex(SHADOWFORM_EMISSIVE_HEX);
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, SHADOWFORM_EMISSIVE_INTENSITY);
  }
  return clone;
}

/** The Moonkin Form clone of `source`. */
export function createMoonkinEffectMaterial(source: THREE.Material): THREE.Material {
  const clone = cloneTransparent(source, 'moonkin');
  clone.opacity = MOONKIN_OPACITY;
  if (clone.color) clone.color.copy(MOONKIN_TINT);
  if (clone.emissive) {
    clone.emissive.setHex(MOONKIN_EMISSIVE_HEX);
    clone.emissiveIntensity = Math.max(clone.emissiveIntensity ?? 0, MOONKIN_EMISSIVE_INTENSITY);
  }
  return clone;
}
