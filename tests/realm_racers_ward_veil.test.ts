// The Realm Racers ward drawn as a veil on any racer carrying it, on the pilot
// and on the whole machine: the shared spirit veil (ghost_veil.ts) in the
// ward's own palette, a denser March gold tuned live on the kart.
//
// Three contracts. The veil follows the entity aura every client mirrors, so a
// rival sees it too. It is ACTIONABLE (a shell fired at a warded rival is
// wasted), so it draws on every graphics tier: the decision takes no tier, and
// the veil mounts over every material family a rig wears across the presets.
// And it links nothing new during play: a palette is uniform values on the
// veil's shared program family, which the boot manifest links. The ward is the
// veil alone: the paladin's class look (the ascension tint, the holy motes
// over the head) stays with the March and the Mark.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { type CharacterVeilRig, syncCharacterVeils } from '../src/render/character_effects';
import {
  createSpiritVeilMaterial,
  spiritVeilPaletteOf,
  spiritVeilPassOf,
} from '../src/render/characters/ghost_veil';
import {
  SPIRIT_VEIL_PALETTES,
  SPIRIT_VEIL_POLICY,
  type SpiritVeilPalette,
} from '../src/render/characters/spirit_veil_palette_core';
import { addRimGlow } from '../src/render/gfx';
import {
  characterVeilboundState,
  classVeilActive,
  classVeilboundState,
  rallyVeilLook,
  riderVeilLook,
} from '../src/render/ghost_style_core';
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
const march = { ...ward, id: 'veilbound_march', kind: 'buff_speed' } as Aura;
const mark = { ...ward, id: 'veilbound_mark', kind: 'dot' } as Aura;

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

/** A rig that records what the veil decision hands it. */
function recordingRig(): CharacterVeilRig & {
  look: SpiritVeilPalette | null;
  unitOf: CharacterVeilRig | null;
} {
  const rig = {
    look: null as SpiritVeilPalette | null,
    unitOf: null as CharacterVeilRig | null,
    setGhost(on: boolean, look?: SpiritVeilPalette) {
      rig.look = on ? (look ?? 'spirit') : null;
    },
    shareVeilUnit(other: CharacterVeilRig | null) {
      rig.unitOf = other;
    },
  };
  return rig;
}

/** The veils renderer.ts hands a racer's pilot and machine, the same call.
 *  `pending`: the kart is still behind its creation gate. */
function veilsFor(
  e: Entity,
  opts: { ghostWolf?: boolean; pending?: boolean } = {},
): { rider: SpiritVeilPalette | null; kart: SpiritVeilPalette | null } {
  const rider = recordingRig();
  const kart = recordingRig();
  const view = { mountVisual: kart, mountCompilePending: opts.pending === true };
  syncCharacterVeils(1, e, opts.ghostWolf === true, characterVeilboundState(e), rider, view);
  if (!opts.pending) expect(kart.unitOf).toBe(rider);
  return { rider: rider.look, kart: kart.look };
}

const stealthBy = (id: string): Aura => ({ ...ward, id, name: id, kind: 'stealth' });

describe('the ward veil decision', () => {
  it('reads the ward off the racer aura and wears the ward palette on pilot and machine', () => {
    expect(characterVeilboundState(racer([ward]))).toBe('ward');
    expect(characterVeilboundState(racer([]))).toBe('none');
    // The actionable read wins over any class veil a racer could carry.
    expect(characterVeilboundState(racer([march, ward]))).toBe('ward');
    expect(characterVeilboundState(racer([mark, ward]))).toBe('ward');
    expect(classVeilboundState('ward')).toBe('none');
    expect(classVeilboundState('march')).toBe('march');
    expect(classVeilboundState('mark')).toBe('mark');
    expect(classVeilboundState('none')).toBe('none');
    expect(rallyVeilLook('ward')).toBe('rally-ward');
    expect(rallyVeilLook('march')).toBeNull();
    expect(rallyVeilLook('mark')).toBeNull();
    expect(rallyVeilLook('none')).toBeNull();
    expect(veilsFor(racer([ward]))).toEqual({ rider: 'rally-ward', kart: 'rally-ward' });
    expect(veilsFor(racer([march, ward]))).toEqual({ rider: 'rally-ward', kart: 'rally-ward' });
    expect(veilsFor(racer([]))).toEqual({ rider: null, kart: null });
    // A real spirit wins on the pilot (a ghost run is a spirit first); the
    // machine still carries the ward a rival reads.
    expect(veilsFor(racer([ward], { ghost: true }))).toEqual({
      rider: 'spirit',
      kart: 'rally-ward',
    });
  });

  it('lets spirit, stealth and Ghost Wolf keep the pilot while the kart still carries the ward', () => {
    // None of these can ride a seated racer (the seat strips every aura, and
    // the rally kit casts none of them: realm_racers_seat_clean_slate.test.ts),
    // but the precedence must still never cost the machine its read.
    expect(veilsFor(racer([stealthBy('stealth'), ward]))).toEqual({
      rider: 'stealth-rogue',
      kart: 'rally-ward',
    });
    expect(veilsFor(racer([stealthBy('prowl'), ward]))).toEqual({
      rider: 'stealth-other',
      kart: 'rally-ward',
    });
    expect(veilsFor(racer([ward]), { ghostWolf: true })).toEqual({
      rider: 'wolf',
      kart: 'rally-ward',
    });
    expect(riderVeilLook(1, racer([ward]), false, 'ward')).toBe('rally-ward');
  });

  it('leaves a kart behind its creation gate bare, the pilot carrying the ward', () => {
    expect(veilsFor(racer([ward]), { pending: true })).toEqual({
      rider: 'rally-ward',
      kart: null,
    });
  });

  it('keeps the March on the pilot alone: a mounted March veils no mount', () => {
    expect(veilsFor(racer([march]))).toEqual({ rider: 'march', kart: null });
    expect(veilsFor(racer([mark]))).toEqual({ rider: null, kart: null });
  });

  it('is the veil only: no ascension tint and no holy motes over the head', () => {
    expect(classVeilActive('ward')).toBe(false);
    expect(classVeilActive('ghost')).toBe(false);
    // the class looks stay exactly where they were
    expect(classVeilActive('march')).toBe(true);
    expect(classVeilActive('mark')).toBe(true);
    expect(classVeilActive('none')).toBe(false);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('active.setAscended(classVeilActive(veilboundState));');
    expect(renderer).toContain(
      "if (classVeilActive(veilboundState)) this.vfx.castSparkle(e.id, 'holy', dt * 2.4);",
    );
    expect(renderer).not.toContain("veilboundState !== 'none'");
  });

  it('takes no graphics tier, and the renderer dresses every rig and its mount with it', () => {
    // Fairness: nothing between the aura and the rig may read a preset.
    expect(characterVeilboundState.length).toBe(1);
    expect(classVeilboundState.length).toBe(1);
    expect(classVeilActive.length).toBe(1);
    expect(rallyVeilLook.length).toBe(1);
    expect(riderVeilLook.length).toBe(4);
    expect(syncCharacterVeils.length).toBe(6);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // Unconditional, between the two statements that frame it: no preset,
    // governor or cull branch can come between the aura and the rigs.
    expect(renderer).toContain(
      [
        '      v.height = active.height;',
        '      syncCharacterVeils(this.sim.playerId, e, ghostWolf, veilboundState, active, v);',
        '      active.setSoulRend(hasSoulRend);',
      ].join('\n'),
    );
    expect(renderer.match(/syncCharacterVeils\(/g)).toHaveLength(1);
  });
});

describe('the ward palette', () => {
  it('is gold, far denser than the March, and keeps neither shadow nor weapon skin', () => {
    const p = SPIRIT_VEIL_PALETTES['rally-ward'];
    for (const hex of [p.tint, p.rim]) {
      // Gold: red and green lifted over blue.
      expect(hex >> 16).toBeGreaterThan(hex & 0xff);
      expect((hex >> 8) & 0xff).toBeGreaterThan(hex & 0xff);
    }
    expect(p.opacity).toBeGreaterThanOrEqual(0.9);
    expect(p.opacity).toBeGreaterThan(SPIRIT_VEIL_PALETTES.march.opacity * 5);
    expect(p.rimStrength).toBeGreaterThan(SPIRIT_VEIL_PALETTES.march.rimStrength);
    expect(SPIRIT_VEIL_POLICY['rally-ward']).toEqual({ castsShadow: false, weaponVfx: false });
  });
});

describe('the ward veil draws on every tier with the shared veil programs', () => {
  it('mounts the ward palette over every rig material family', () => {
    const look = rallyVeilLook('ward');
    if (!look) throw new Error('the ward wears no veil');
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
