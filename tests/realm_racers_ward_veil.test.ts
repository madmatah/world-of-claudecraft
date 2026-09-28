// The Realm Racers ward drawn as a veil on any racer carrying it: the shared
// spirit veil (ghost_veil.ts) in the Veilbound March's gold palette, an interim
// look until the ward gets a palette of its own.
//
// Three contracts. The veil follows the entity aura every client mirrors, so a
// rival sees it too. It is ACTIONABLE (a shell fired at a warded rival is
// wasted), so it draws on every graphics tier: the decision takes no tier, and
// the veil mounts over every material family a rig wears across the presets.
// And it links nothing new during play: a palette is uniform values on the
// veil's shared program family, which the boot manifest links.

import { readFileSync } from 'node:fs';
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
import { SPIRIT_VEIL_PALETTES } from '../src/render/characters/spirit_veil_palette_core';
import { addRimGlow } from '../src/render/gfx';
import { characterGhostLook } from '../src/render/ghost_style_core';
import { REALM_RACERS_WARD_AURA } from '../src/sim/social/realm_racers';
import type { Aura, Entity } from '../src/sim/types';

const ward: Aura = {
  id: REALM_RACERS_WARD_AURA,
  name: 'Racing Ward',
  kind: 'rally_ward',
  remaining: 9999,
  duration: 9999,
  value: 0,
  sourceId: 7,
  school: 'physical',
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

describe('the ward veil decision', () => {
  it('reads the ward off the racer aura and wears the gold March palette', () => {
    expect(characterVeilboundState(racer([ward]))).toBe('ward');
    expect(characterVeilboundState(racer([]))).toBe('none');
    // The actionable read wins over any class veil a racer could carry.
    const march = { ...ward, id: 'veilbound_march', kind: 'buff_speed' } as Aura;
    const mark = { ...ward, id: 'veilbound_mark', kind: 'dot' } as Aura;
    expect(characterVeilboundState(racer([march, ward]))).toBe('ward');
    expect(characterVeilboundState(racer([mark, ward]))).toBe('ward');
    expect(classVeilboundState('ward')).toBe('none');
    expect(classVeilboundState('march')).toBe('march');
    expect(classVeilboundState('mark')).toBe('mark');
    expect(classVeilboundState('none')).toBe('none');
    expect(rallyVeilLook('ward')).toBe('march');
    expect(rallyVeilLook('march')).toBeNull();
    expect(rallyVeilLook('mark')).toBeNull();
    expect(rallyVeilLook('none')).toBeNull();
    expect(lookFor(racer([ward]))).toBe('march');
    expect(lookFor(racer([]))).toBeNull();
    // A real spirit wins over the ward (a ghost run is a spirit first).
    expect(lookFor(racer([ward], { ghost: true }))).toBe('spirit');
  });

  it('takes no graphics tier, and the renderer mounts it on every rig it draws', () => {
    // Fairness: nothing between the aura and the rig may read a preset.
    expect(characterVeilboundState.length).toBe(1);
    expect(classVeilboundState.length).toBe(1);
    expect(rallyVeilLook.length).toBe(1);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      'characterGhostLook(this.sim.playerId, e, ghostWolf, classVeilboundState(veilboundState)) ??',
    );
    expect(renderer).toContain('rallyVeilLook(veilboundState);');
    expect(renderer).toContain("active.setGhost(ghostLook !== null, ghostLook ?? 'spirit');");
  });
});

describe('the ward veil draws on every tier with the shared veil programs', () => {
  it('mounts the gold palette over every rig material family', () => {
    const look = rallyVeilLook('ward');
    if (!look) throw new Error('the ward wears no veil');
    const tint = SPIRIT_VEIL_PALETTES[look].tint;
    // Gold: red and green lifted over blue.
    expect(tint >> 16).toBeGreaterThan(tint & 0xff);
    expect((tint >> 8) & 0xff).toBeGreaterThan(tint & 0xff);
    for (const source of tierMaterials()) {
      const veil = createSpiritVeilMaterial(source, look);
      expect(veil.transparent, source.type).toBe(true);
      expect(spiritVeilPassOf(veil), source.type).toBe('color');
      expect(spiritVeilPaletteOf(veil), source.type).toBe(look);
      expect(veil.customProgramCacheKey()).toBe(
        createSpiritVeilMaterial(source, 'spirit').customProgramCacheKey(),
      );
    }
  });
});
