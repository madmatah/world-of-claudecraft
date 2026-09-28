// The recovery ghost drawn as a pale veil on any ghosted racer, the local one
// included: the Veilbound March's translucent veil (`setGhost`), washed pale.
//
// A ghost will not block you, which is actionable, so the veil follows the
// entity aura every client mirrors and draws on every graphics tier. And it
// links nothing new during play: the pale clone shares every program-key input
// with the March's own clone and the gold ward veil, so the boot
// character-effect prewarm twin (character_effect_prewarm.ts) is the exact
// program it draws.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildCharacterEffectPrewarmGroup,
  characterEffectDrawPath,
} from '../src/render/character_effect_prewarm';
import { characterEffectProgramKey } from '../src/render/character_effect_prewarm_core';
import {
  characterGhostStyle,
  characterVeilboundState,
  characterVeilGhosted,
} from '../src/render/character_effects';
import {
  createGhostEffectMaterial,
  ghostEffectOpacity,
  paintGhostEffectMaterial,
} from '../src/render/characters/effect_materials';
import { addRimGlow } from '../src/render/gfx';
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

const racer = (auras: Aura[]): Entity => ({ auras }) as unknown as Entity;

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

function skinnedGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 2, 1);
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(
    'skinIndex',
    new THREE.Uint16BufferAttribute(new Uint16Array(count * 4), 4),
  );
  geometry.setAttribute(
    'skinWeight',
    new THREE.Float32BufferAttribute(new Float32Array(count * 4), 4),
  );
  return geometry;
}

/** The inputs three folds into a program key (WebGLPrograms.getParameters). */
function programKeyInputs(material: THREE.Material): Record<string, unknown> {
  const m = material as THREE.MeshStandardMaterial;
  return {
    type: material.type,
    opaque: material.transparent === false && material.blending === THREE.NormalBlending,
    cacheKey: material.customProgramCacheKey(),
    defines: JSON.stringify(material.defines ?? null),
    side: material.side,
    vertexColors: m.vertexColors,
    blending: material.blending,
    alphaTest: material.alphaTest,
    map: !!m.map,
    emissive: m.emissive !== undefined,
  };
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
    expect(characterVeilGhosted('ghost')).toBe(true);
    expect(characterGhostStyle(false, false, 'ghost')).toBe('ghost');
    // A real spirit or stealth read still wins.
    expect(characterGhostStyle(false, true, 'ghost')).toBe('spirit');
    expect(characterGhostStyle(true, false, 'ghost')).toBe('stealth');
    expect(characterGhostStyle(false, false, 'ward')).toBe('ward');
  });

  it('takes no graphics tier', () => {
    expect(characterVeilboundState.length).toBe(1);
    expect(characterGhostStyle.length).toBe(3);
    expect(characterVeilGhosted.length).toBe(1);
  });
});

describe('the ghost veil draws pale on every tier with a program already prepared', () => {
  it('paints every rig material family pale and translucent, unlike the ward and the March', () => {
    for (const source of tierMaterials()) {
      const veil = createGhostEffectMaterial(source, 'ghost') as THREE.MeshStandardMaterial;
      const march = createGhostEffectMaterial(source, 'spirit') as THREE.MeshStandardMaterial;
      const gold = createGhostEffectMaterial(source, 'ward') as THREE.MeshStandardMaterial;
      expect(veil.transparent, source.type).toBe(true);
      expect(veil.opacity).toBe(ghostEffectOpacity('ghost'));
      expect(veil.opacity).toBeLessThan(1);
      // Pale: lighter than the source on every channel, and near-neutral.
      const { r, g, b } = veil.color;
      const from = (source as THREE.MeshStandardMaterial).color;
      expect(r, source.type).toBeGreaterThan(from.r);
      expect(g, source.type).toBeGreaterThan(from.g);
      expect(b, source.type).toBeGreaterThan(from.b);
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.2);
      expect(veil.color.getHex()).not.toBe(march.color.getHex());
      expect(veil.color.getHex()).not.toBe(gold.color.getHex());
    }
  });

  it('shares every program-key input with the March, the ward and the boot prewarm twin', () => {
    for (const source of tierMaterials()) {
      const geometry = skinnedGeometry();
      const root = new THREE.Group();
      root.add(new THREE.SkinnedMesh(geometry, source));
      const group = buildCharacterEffectPrewarmGroup(root);
      expect(group.children, source.type).toHaveLength(1);
      const twin = (group.children[0] as THREE.Mesh).material as THREE.Material;
      const veil = createGhostEffectMaterial(source, 'ghost');
      expect(programKeyInputs(veil)).toEqual(
        programKeyInputs(createGhostEffectMaterial(source, 'spirit')),
      );
      expect(programKeyInputs(veil)).toEqual(
        programKeyInputs(createGhostEffectMaterial(source, 'ward')),
      );
      expect(programKeyInputs(veil)).toEqual(programKeyInputs(twin));
      const target = { material: source, geometry, skinned: true };
      expect(characterEffectProgramKey(characterEffectDrawPath(target, veil))).toBe(
        characterEffectProgramKey(characterEffectDrawPath(target, twin)),
      );
    }
  });

  it('repaints a shared clone on a flip, so the pale never leaks into the gold or a ghost run', () => {
    const [source] = tierMaterials() as THREE.MeshStandardMaterial[];
    const clone = createGhostEffectMaterial(source, 'ghost') as THREE.MeshStandardMaterial;
    const pale = clone.color.getHex();
    paintGhostEffectMaterial(clone, source, 'ward');
    expect(clone.color.getHex()).not.toBe(pale);
    expect(clone.opacity).toBe(ghostEffectOpacity('ward'));
    paintGhostEffectMaterial(clone, source, 'spirit');
    expect(clone.color.getHex()).toBe(source.color.getHex());
    expect(clone.emissive.getHex()).toBe(source.emissive.getHex());
    paintGhostEffectMaterial(clone, source, 'ghost');
    expect(clone.color.getHex()).toBe(pale);
    expect(clone.opacity).toBe(ghostEffectOpacity('ghost'));
  });
});
