import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { biomeGroundTint, paintInstanceGround } from '../src/render/instance_surface';
import {
  terrainSplatPresence,
  terrainSplatPresenceMask,
} from '../src/render/terrain_splat_presence_core';

const ORIGIN = { x: 113_700, z: 0 };

/** A 2x2 quad on the XZ plane, world-placed the way the contract requires. */
function quad(size = 10): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(size, size, 1, 1)
    .rotateX(-Math.PI / 2)
    .translate(ORIGIN.x, 0, ORIGIN.z);
}

describe('instanced ground surface', () => {
  it('gives every vertex the named layer and nothing else', () => {
    const geo = paintInstanceGround(quad(), ORIGIN, 'dirt', 0x8a7a5a);
    const splat = geo.getAttribute('aSplat');
    expect(splat.itemSize).toBe(4);
    expect(splat.count).toBe(geo.getAttribute('position').count);
    for (let i = 0; i < splat.count; i++) {
      // Dirt is index 1. The weights must SUM to 1 or the albedo comes out
      // darkened by the missing share rather than mis-coloured, which is far
      // harder to spot.
      expect([splat.getX(i), splat.getY(i), splat.getZ(i), splat.getW(i)]).toEqual([0, 1, 0, 0]);
    }
  });

  it('zeroes aExtra explicitly, because an ABSENT attribute is a crater', () => {
    // WebGL hands a shader (0, 0, 0, 1) for an attribute the geometry does not
    // supply, and the ground material reads aExtra.w as impact-crater ash. So
    // "we have no extras" has to be written down, not left out.
    const geo = paintInstanceGround(quad(), ORIGIN, 'grass', 0x58a04e);
    const extra = geo.getAttribute('aExtra');
    expect(extra.itemSize).toBe(4);
    for (let i = 0; i < extra.count; i++) {
      expect([extra.getX(i), extra.getY(i), extra.getZ(i), extra.getW(i)]).toEqual([0, 0, 0, 0]);
    }
  });

  it('declares its layer present, or the shader culls every albedo tap', () => {
    // The splat shader skips a layer whose presence bit is 0, and an attribute
    // the geometry does not supply reads as 0. Leaving the mask out therefore
    // culls the ONLY layer the surface has, and the band renders as the bare
    // fallback constants: a uniform brown plane where a lawn should be.
    for (const layer of ['grass', 'dirt', 'rock', 'sand'] as const) {
      const geo = paintInstanceGround(quad(), ORIGIN, layer, 0x58a04e);
      const mask = geo.getAttribute('aTerrainPresenceMask');
      expect(mask, layer).toBeDefined();
      expect(mask.itemSize).toBe(1);
      expect(mask.count).toBe(geo.getAttribute('position').count);
      const splat = geo.getAttribute('aSplat');
      const expected = terrainSplatPresenceMask(
        terrainSplatPresence(
          splat.array as Float32Array,
          geo.getAttribute('aExtra').array as Float32Array,
        ),
      );
      // Exactly the one layer, and no extras: mud, snow and the crater bits
      // stay off, which is what keeps a band out of the marsh/impact arms.
      expect(expected, layer).toBe(1 << ['grass', 'dirt', 'rock', 'sand'].indexOf(layer));
      for (let i = 0; i < mask.count; i++) expect(mask.getX(i), layer).toBe(expected);
    }
  });

  it('carries the biome tint as a vertex colour in the working space', () => {
    const tint = biomeGroundTint('garden');
    const geo = paintInstanceGround(quad(), ORIGIN, 'grass', tint.grass);
    const colours = geo.getAttribute('color');
    expect(colours.itemSize).toBe(3);
    // Whatever colour management three.js applies, the attribute has to match
    // what a terrain chunk writes for the same hex, or the band reads as a
    // different biome from the zone it is meant to belong to.
    // Float32 round trip, so exact to single precision rather than to double.
    const expected = new THREE.Color(tint.grass);
    for (let i = 0; i < colours.count; i++) {
      expect(colours.getX(i)).toBeCloseTo(expected.r, 6);
      expect(colours.getY(i)).toBeCloseTo(expected.g, 6);
      expect(colours.getZ(i)).toBeCloseTo(expected.b, 6);
    }
    // ...and not the raw sRGB bytes: three.js converts into the linear working
    // space, and a channel that skipped it would sit far from this.
    expect(expected.g).not.toBeCloseTo(((tint.grass >> 8) & 255) / 255, 2);
  });

  it('lays a uv relative to the ORIGIN, not to the world', () => {
    // The band sits around x = 113_700. A uv taken in absolute world yards is
    // enormous there, and on the Lambert tier the detail map turns to aliasing
    // hash. Anchoring on the origin keeps it in the same range the world's own
    // strip-planar uv occupies.
    const geo = paintInstanceGround(quad(20), ORIGIN, 'grass', 0x58a04e);
    const uv = geo.getAttribute('uv');
    const position = geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) {
      expect(Math.abs(uv.getX(i))).toBeLessThan(0.1);
      expect(Math.abs(uv.getY(i))).toBeLessThan(0.1);
      // ...and it tracks the surface, so two vertices a span apart differ.
      expect(Math.sign(uv.getX(i))).toBe(Math.sign(position.getX(i) - ORIGIN.x));
    }
    expect(new Set(Array.from({ length: uv.count }, (_, i) => uv.getX(i))).size).toBeGreaterThan(1);
  });

  it('reads the tint off the shared biome palette rather than a copy', () => {
    // A hand-copied hex is a colour that drifts the day the biome is retuned.
    const garden = biomeGroundTint('garden');
    const vale = biomeGroundTint('vale');
    expect(garden.grass).not.toBe(vale.grass);
    expect(garden.grass).not.toBe(garden.dirt);
  });
});
