// The Ground Blast pool is prepared, not grown: `prepare()` builds every mesh
// and material the pool will ever draw, so the race preparation seam links and
// uploads that exact set before the first shot, and a shot only moves and
// shows what is already there. The oracle is three's own program cache key
// (tests/helpers/three_program_keys.ts), read on every visible mesh at every
// step of a long volley, against the keys of every mesh `prepare()` built.

import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { floorVfxLayerOf } from '../src/render/floor_vfx_layer_core';
import { RealmRacersGroundBlastVisuals } from '../src/render/realm_racers_ground_blast';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

vi.mock('../src/render/textures', () => ({
  rallyGroundBlastMarkerTexture: () => {
    const texture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    texture.needsUpdate = true;
    return texture;
  },
}));

type Blasts = RealmRacersGroundBlastVisuals;

const ROLES = ['column', 'core', 'flash', 'glow', 'marker', 'projectile', 'trail', 'wave'].map(
  (role) => `realmRacersGroundBlast:${role}`,
);

/** Every program a draw of these objects links: a transparent DoubleSide
 *  material is two single-sided programs, back then front. Split in half, never
 *  on every newline: a hooked material's key carries its hook source. */
function programKeys(root: THREE.Object3D, visibleOnly: boolean): Set<string> {
  const keys = new Set<string>();
  for (const { object, material } of drawsUnder(root)) {
    if (visibleOnly && !object.visible) continue;
    const joined = threeProgramKeys(material, object);
    const twoPass =
      material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass;
    if (!twoPass) {
      keys.add(joined);
      continue;
    }
    const lines = joined.split('\n');
    const half = lines.length / 2;
    keys.add(lines.slice(0, half).join('\n'));
    keys.add(lines.slice(half).join('\n'));
  }
  return keys;
}

function materialsUnder(root: THREE.Object3D): Set<THREE.Material> {
  return new Set(drawsUnder(root).map((draw) => draw.material));
}

const shot = (x: number, z: number, targetX: number, targetZ: number, flightSeconds = 0.5) => ({
  x,
  z,
  targetX,
  targetZ,
  flightSeconds,
});

/** Fire, land and age shots well past two full laps of the pool, calling
 *  `observe` after every step so the caller sees every drawn frame. */
function volley(blasts: Blasts, observe: () => void): void {
  for (let n = 0; n < 20; n++) {
    blasts.fire(shot(n, 0, n, 30 + n, 0.3 + (n % 3) * 0.2), 0);
    observe();
    if (n % 2 === 0) {
      blasts.fire(shot(-n, 5, -n, 25), 1);
      observe();
    }
    blasts.update(0.15);
    observe();
    blasts.impact(n, 30 + n, 0);
    observe();
    blasts.update(0.2);
    observe();
  }
  for (let step = 0; step < 10; step++) {
    blasts.update(0.1);
    observe();
  }
}

describe('Ground Blast pool preparation', () => {
  it('draws only programs, meshes and materials that prepare() built', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    const root = blasts.prepare();
    expect(root).toBe(blasts.group);
    const prepared = programKeys(root, false);
    const children = root.children.length;
    const materials = materialsUnder(root);
    // Six shells of six parts and six bursts of two, every one hidden.
    expect(children).toBe(48);
    root.traverse((object) => {
      if (object !== root) expect(object.visible, object.name).toBe(false);
    });

    const drawn = new Set<string>();
    const drawnRoles = new Set<string>();
    volley(blasts, () => {
      for (const key of programKeys(root, true)) drawn.add(key);
      for (const { object, material } of drawsUnder(root)) {
        if (object.visible) drawnRoles.add(material.name);
      }
      expect(root.children.length).toBe(children);
    });

    // The volley draws every part of the pool, so the subset check below
    // covers every program the pool can draw, not a convenient few.
    expect([...drawnRoles].sort()).toEqual(ROLES);
    expect(drawn).toEqual(prepared);
    expect([...drawn].filter((key) => !prepared.has(key))).toEqual([]);
    const after = materialsUnder(root);
    expect([...after].filter((material) => !materials.has(material))).toEqual([]);
    expect(after.size).toBe(materials.size);
  });

  it('names every material it draws after the pool and its role', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    const materials = materialsUnder(blasts.prepare());
    expect(materials.size).toBeGreaterThan(0);
    const roles = new Set<string>();
    for (const material of materials) {
      expect(material.name).toMatch(/^realmRacersGroundBlast:[a-z]+$/);
      roles.add(material.name);
    }
    expect([...roles].sort()).toEqual(ROLES);
  });

  it('is idempotent: a second prepare() builds nothing', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    const root = blasts.prepare();
    const children = [...root.children];
    const materials = materialsUnder(root);
    expect(blasts.prepare()).toBe(root);
    expect(root.children).toEqual(children);
    expect(materialsUnder(root)).toEqual(materials);
  });

  it('builds the whole pool at once when a shot beats the preparation', () => {
    // A shot is never held for its programs (the marker is actionable), so an
    // unprepared pool still draws, and still never grows past that first shot.
    const blasts = new RealmRacersGroundBlastVisuals();
    blasts.fire(shot(0, 0, 0, 20), 0);
    const children = blasts.group.children.length;
    expect(children).toBe(48);
    const materials = materialsUnder(blasts.group);
    volley(blasts, () => undefined);
    expect(blasts.group.children.length).toBe(children);
    expect(materialsUnder(blasts.group)).toEqual(materials);
  });

  it('ignores every late call once disposed', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    blasts.prepare();
    blasts.fire(shot(0, 0, 0, 20), 0);
    blasts.dispose();
    expect(blasts.group.children).toHaveLength(0);
    expect(() => {
      blasts.fire(shot(0, 0, 0, 20), 0);
      blasts.impact(0, 20, 0);
      blasts.update(0.1);
      blasts.dispose();
    }).not.toThrow();
    expect(blasts.prepare()).toBe(blasts.group);
    expect(blasts.group.children).toHaveLength(0);
    expect(blasts.inFlight).toBe(0);
  });

  it('puts the landing marker on the encounter band over its countdown fill', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    const root = blasts.prepare();
    const marker = root.getObjectByName('marker0');
    const core = root.getObjectByName('core0');
    expect(marker && core).toBeTruthy();
    expect(floorVfxLayerOf(marker?.renderOrder ?? 0)).toBe('encounter');
    expect(floorVfxLayerOf(core?.renderOrder ?? 0)).toBe('encounter');
    expect(marker?.renderOrder).toBeGreaterThan(core?.renderOrder ?? 0);
    // The impact shockwaves, one per burst, ride the player band under it.
    const player = root.children.filter((child) => floorVfxLayerOf(child.renderOrder) === 'player');
    expect(player).toHaveLength(6);
  });

  it('tags every drawable of the prepared pool for the VFX walk', () => {
    const blasts = new RealmRacersGroundBlastVisuals();
    expect(blasts.group.userData.renderCategory).toBe('vfx');
    const root = blasts.prepare();
    root.traverse((object) => {
      expect(object.userData.renderCategory, object.name).toBe('vfx');
    });
  });
});
