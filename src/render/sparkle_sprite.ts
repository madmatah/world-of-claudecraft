// The gold glint that says "this is yours to take": the sprite every takeable
// thing in the world wears over it.
//
// It is one factory rather than a block copied per caller because there are now
// three of them (the renderer's F-interactable objects, its ground quest
// objects, and the Mortar Overdrive pickup boxes) and the glint has to be the SAME
// glint: a player learns it once, on a quest crate, and then reads it at race
// speed on a circuit.
//
// The boost is a colour multiplier above 1, which the composer tiers turn into
// bloom; a tier without bloom simply clamps it. Whether a caller asks for it is
// the caller's own call: the renderer keeps it off on its low tier, and race
// furniture always asks for it (the fairness rule under `src/render/CLAUDE.md`:
// nothing a pilot steers at may be dimmed by a preset).

import * as THREE from 'three';
import { sparkleTexture } from './textures';

/** How far above 1 the glint's colour is driven, so it blooms. */
export const SPARKLE_BOOST = 1.5;

/**
 * One sparkle material, ready to hang on a `THREE.Sprite`.
 *
 * Callers are expected to mint ONE and share it across their sprites: it holds
 * a canvas texture, and a material per sprite would mint a canvas per sprite.
 */
export function sparkleSpriteMaterial(boosted: boolean): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({
    map: sparkleTexture(),
    transparent: true,
    depthWrite: false,
  });
  if (boosted) material.color.setScalar(SPARKLE_BOOST);
  return material;
}
