// The Realm Racers ward drawn as a golden veil on any racer carrying it: the
// Veilbound March's translucent veil (`setGhost`), recoloured gold.
//
// Three contracts. The veil follows the entity aura every client mirrors, so a
// rival sees it too. It is ACTIONABLE (a shell fired at a warded rival is
// wasted), so it draws on every graphics tier: the decision takes no tier, and
// the gold clone paints on every material family a rig wears across the
// presets. And it links nothing new during play: the gold clone shares every
// program-key input with the March's own clone, so the boot character-effect
// prewarm twin (character_effect_prewarm.ts) is the exact program it draws.

import { readFileSync } from 'node:fs';
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

describe('the ward veil decision', () => {
  it('reads the ward off the racer aura and wears the gold veil', () => {
    expect(characterVeilboundState(racer([ward]))).toBe('ward');
    expect(characterVeilboundState(racer([]))).toBe('none');
    expect(characterVeilGhosted('ward')).toBe(true);
    expect(characterVeilGhosted('march')).toBe(true);
    expect(characterVeilGhosted('mark')).toBe(false);
    expect(characterVeilGhosted('none')).toBe(false);
    expect(characterGhostStyle(false, false, 'ward')).toBe('ward');
    // The March keeps its own spirit veil, and a real spirit or stealth read
    // wins over the ward (a ghost run is a spirit first).
    expect(characterGhostStyle(false, false, 'march')).toBe('spirit');
    expect(characterGhostStyle(false, true, 'ward')).toBe('spirit');
    expect(characterGhostStyle(true, true, 'ward')).toBe('stealth');
    expect(characterGhostStyle(false, false, 'none')).toBe('spirit');
  });

  it('takes no graphics tier, and the renderer mounts it on every rig it draws', () => {
    // Fairness: nothing between the aura and the rig may read a preset.
    expect(characterGhostStyle.length).toBe(3);
    expect(characterVeilGhosted.length).toBe(1);
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain(
      'active.setGhost(ghost || characterVeilGhosted(veilboundState), ghostStyle);',
    );
    expect(renderer).toContain(
      'const ghostStyle = characterGhostStyle(stealthFade, ghost, veilboundState);',
    );
  });
});

describe('the ward veil draws gold on every tier with a program the March already prepared', () => {
  it('paints every rig material family gold and translucent', () => {
    for (const source of tierMaterials()) {
      const veil = createGhostEffectMaterial(source, 'ward') as THREE.MeshStandardMaterial;
      const march = createGhostEffectMaterial(source, 'spirit') as THREE.MeshStandardMaterial;
      expect(veil.transparent, source.type).toBe(true);
      expect(veil.opacity).toBe(ghostEffectOpacity('ward'));
      expect(veil.opacity).toBeGreaterThan(march.opacity);
      // Gold: red and green lifted over blue, off the source colour.
      const { r, g, b } = veil.color;
      expect(r, source.type).toBeGreaterThan(b);
      expect(g, source.type).toBeGreaterThan(b);
      expect(veil.color.getHex()).not.toBe(march.color.getHex());
      if (veil.emissive) expect(veil.emissive.getHex()).toBe(0xb8860b);
    }
  });

  it('shares every program-key input with the March veil and the boot prewarm twin', () => {
    for (const source of tierMaterials()) {
      const geometry = skinnedGeometry();
      const root = new THREE.Group();
      root.add(new THREE.SkinnedMesh(geometry, source));
      const group = buildCharacterEffectPrewarmGroup(root);
      expect(group.children, source.type).toHaveLength(1);
      const twin = (group.children[0] as THREE.Mesh).material as THREE.Material;
      const veil = createGhostEffectMaterial(source, 'ward');
      const march = createGhostEffectMaterial(source, 'spirit');
      expect(programKeyInputs(veil)).toEqual(programKeyInputs(march));
      expect(programKeyInputs(veil)).toEqual(programKeyInputs(twin));
      const target = { material: source, geometry, skinned: true };
      expect(characterEffectProgramKey(characterEffectDrawPath(target, veil))).toBe(
        characterEffectProgramKey(characterEffectDrawPath(target, twin)),
      );
    }
  });

  it('repaints a shared clone on a style flip, so a veil never leaks into a ghost run', () => {
    const [source] = tierMaterials() as THREE.MeshStandardMaterial[];
    const clone = createGhostEffectMaterial(source, 'ward') as THREE.MeshStandardMaterial;
    const gold = clone.color.getHex();
    paintGhostEffectMaterial(clone, source, 'spirit');
    expect(clone.color.getHex()).toBe(source.color.getHex());
    expect(clone.emissive.getHex()).toBe(source.emissive.getHex());
    expect(clone.opacity).toBe(ghostEffectOpacity('spirit'));
    paintGhostEffectMaterial(clone, source, 'ward');
    expect(clone.color.getHex()).toBe(gold);
  });
});
