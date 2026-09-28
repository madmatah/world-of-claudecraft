// The recovery ghost drawn as a veil on any ghosted racer, the local one
// included: the shared spirit veil (ghost_veil.ts) in the released spirit's
// palette, an interim look until the ghost gets a palette of its own.
//
// A ghost will not block you, which is actionable, so the veil follows the
// entity aura every client mirrors and draws on every graphics tier. And it
// links nothing new during play: a palette is uniform values on the veil's
// shared program family, which the boot manifest links.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  characterVeilboundState,
  classVeilboundState,
  rallyVeilLook,
} from '../src/render/character_effects';
import {
  createSpiritVeilMaterial,
  spiritVeilPaletteOf,
  spiritVeilPassOf,
} from '../src/render/characters/ghost_veil';
import { addRimGlow } from '../src/render/gfx';
import { characterGhostLook } from '../src/render/ghost_style_core';
import { REALM_RACERS_GHOST_AURA } from '../src/sim/realm_racers_ghost';
import { REALM_RACERS_WARD_AURA } from '../src/sim/social/realm_racers';
import type { Aura, Entity } from '../src/sim/types';

const ghost: Aura = {
  id: REALM_RACERS_GHOST_AURA,
  name: 'Ghosted',
  kind: 'rally_ghost',
  remaining: 9999,
  duration: 9999,
  value: 0,
  sourceId: 7,
  school: 'physical',
};
const ward: Aura = {
  ...ghost,
  id: REALM_RACERS_WARD_AURA,
  name: 'Racing Ward',
  kind: 'rally_ward',
};

const racer = (auras: Aura[], over: Partial<Entity> = {}): Entity =>
  ({ id: 2, kind: 'player', auras, ghost: false, templateId: 'player', ...over }) as Entity;

/** The rig material families the graphics presets hand a character: the lit
 *  standard material, the low preset's Lambert, and the unlit basic one. */
function tierMaterials(): THREE.Material[] {
  const standard = new THREE.MeshStandardMaterial({ color: 0x5a6f88, roughness: 0.7 });
  standard.map = new THREE.Texture();
  addRimGlow(standard);
  const lambert = new THREE.MeshLambertMaterial({ color: 0x5a6f88 });
  lambert.map = new THREE.Texture();
  const basic = new THREE.MeshBasicMaterial({ color: 0x5a6f88 });
  return [standard, lambert, basic];
}

/** The look renderer.ts hands a racer's rig, composed the same way. */
function lookFor(e: Entity): string | null {
  const state = characterVeilboundState(e);
  return characterGhostLook(1, e, false, classVeilboundState(state)) ?? rallyVeilLook(state);
}

describe('the ghost veil decision', () => {
  it('reads the ghost off the racer aura, over the ward and any class veil', () => {
    expect(characterVeilboundState(racer([ghost]))).toBe('ghost');
    expect(characterVeilboundState(racer([ward, ghost]))).toBe('ghost');
    expect(characterVeilboundState(racer([ghost, ward]))).toBe('ghost');
    const march = { ...ghost, id: 'veilbound_march', kind: 'buff_speed' } as Aura;
    expect(characterVeilboundState(racer([march, ghost]))).toBe('ghost');
    // The gold is back the moment the ghost ends.
    expect(characterVeilboundState(racer([ward]))).toBe('ward');
    expect(classVeilboundState('ghost')).toBe('none');
    expect(rallyVeilLook('ghost')).toBe('spirit');
    expect(lookFor(racer([ghost]))).toBe('spirit');
    expect(lookFor(racer([ward, ghost]))).toBe('spirit');
    // The ghost and the ward never share a palette.
    expect(rallyVeilLook('ghost')).not.toBe(rallyVeilLook('ward'));
  });

  it('takes no graphics tier', () => {
    expect(characterVeilboundState.length).toBe(1);
    expect(classVeilboundState.length).toBe(1);
    expect(rallyVeilLook.length).toBe(1);
  });
});

describe('the ghost veil draws on every tier with the shared veil programs', () => {
  it('mounts its palette over every rig material family, on the program the ward draws', () => {
    const look = rallyVeilLook('ghost');
    const wardLook = rallyVeilLook('ward');
    if (!look || !wardLook) throw new Error('a racer veil wears no palette');
    for (const source of tierMaterials()) {
      const veil = createSpiritVeilMaterial(source, look);
      expect(veil.transparent, source.type).toBe(true);
      expect(spiritVeilPassOf(veil), source.type).toBe('color');
      expect(spiritVeilPaletteOf(veil), source.type).toBe(look);
      expect(veil.customProgramCacheKey()).toBe(
        createSpiritVeilMaterial(source, wardLook).customProgramCacheKey(),
      );
    }
  });
});
