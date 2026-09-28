// The materials every Realm Racers circuit of one renderer shares.
//
// A circuit used to mint its own copy of each of these per build. The ground
// splat material was the costly one: every build regenerated the legacy canvas
// splat maps and a macro-noise canvas for a material identical to the last
// circuit's, a fifth of a circuit build. One material serves every ground
// surface of every circuit because what a surface is made of (layer, tint) is a
// per-vertex weight (instance_surface.ts), and nothing writes the rally
// material's brush uniforms (only the world editor's terrain brush does, on the
// terrain's own materials).
//
// PER RENDERER, never module scope: the splat material reads renderer-time
// state when it is built (the grass bake, the haze and night-light fields, the
// tier arm), and a graphics rebuild mints a new renderer and so a new palette.
// The race preparation's common client (realm_racers_common_pieces.ts) draws
// the same objects its representatives link, so a circuit built afterwards
// finds its programs linked.
//
// Every texture painted here comes from a private random stream
// (texture_random_stream.ts), so which circuit asks first, and when,
// never shifts a texture painted after it.

import * as THREE from 'three';
import { REALM_RACERS_ORIGIN } from '../sim/realm_racers_layout';
import { configureMaskedDoubleSidedVegetationMaterial, GFX } from './gfx';
import { buildInstanceGroundMaterial } from './instance_surface';
import type { RallyCircuitTheme, RallyThemeStartGrid } from './realm_racers_themes';
import { textureRandomStream, withTextureRandomStream } from './texture_random_stream';
import { type FlowerKind, flowerTuftTexture, rallyStartGridTexture } from './textures';
import { lowTierWaterMaterial, usesShaderWater } from './water';
import { buildWaterSurfaceMaterial, zeroWaveUniforms } from './water_surface_material';

export interface RallyStartLightMaterials {
  off: THREE.Material;
  red: THREE.Material;
  green: THREE.Material;
}

export interface RealmRacersTrackPalette {
  /** The one ground material every ground surface of every circuit draws. */
  ground(): THREE.Material;
  startGrid(colours: RallyThemeStartGrid): THREE.Material;
  flower(card: FlowerKind[]): THREE.Material;
  startLights(): RallyStartLightMaterials;
  /** The water on the tier's arm: the theme's ramp on the world's shader, or
   *  the world's own low-tier plane material. */
  water(theme: RallyCircuitTheme): THREE.Material;
}

/** The stream every rally flower card is painted from: scoped to the rally so a
 *  world palette of the same colours keeps its own card. */
const FLOWER_STREAM_ID = 'realm-racers:flower';

export function createRealmRacersTrackPalette(): RealmRacersTrackPalette {
  let ground: THREE.Material | null = null;
  const grids = new Map<string, THREE.Material>();
  const flowers = new Map<string, THREE.Material>();
  let lights: RallyStartLightMaterials | null = null;
  const waters = new Map<string, THREE.Material>();
  return {
    ground() {
      if (ground) return ground;
      // Painted from its own stream, which is also why the legacy splat
      // canvases (a pure spend there, kept only to hold the SHARED sequence in
      // place) are skipped: the material is the same, 35 of its 47 ms are not.
      ground = withTextureRandomStream(textureRandomStream('realm-racers:ground'), () =>
        buildInstanceGroundMaterial(REALM_RACERS_ORIGIN, { legacySplatDraws: false }),
      );
      ground.name = 'realmRacersTrack:ground';
      return ground;
    },
    startGrid(colours) {
      const key = `${colours.light}:${colours.dark}`;
      const known = grids.get(key);
      if (known) return known;
      const material = new THREE.MeshBasicMaterial({ map: rallyStartGridTexture(colours) });
      material.name = 'realmRacersTrack:startGrid';
      grids.set(key, material);
      return material;
    },
    flower(card) {
      // The tier arm is part of the key: a Lambert card on a Standard tier
      // would be a program nothing prepared.
      const key = `${GFX.standardMaterials ? 's' : 'l'}|${JSON.stringify(card)}`;
      const known = flowers.get(key);
      if (known) return known;
      const map = flowerTuftTexture(card, false, textureRandomStream(FLOWER_STREAM_ID));
      // MeshStandardMaterial where the tier has it, for the same reason the
      // world's own meadow uses it: a vertical card lit only by a zenith sun
      // through Lambert comes out nearly black, which is how these first shipped.
      const material = configureMaskedDoubleSidedVegetationMaterial(
        GFX.standardMaterials
          ? new THREE.MeshStandardMaterial({ map, alphaTest: 0.3, roughness: 0.85 })
          : new THREE.MeshLambertMaterial({ map, alphaTest: 0.35 }),
      );
      material.name = 'realmRacersTrack:flower';
      flowers.set(key, material);
      return material;
    },
    startLights() {
      if (lights) return lights;
      const off = new THREE.MeshBasicMaterial({ color: 0x241c12 });
      off.name = 'realmRacersTrack:startLightOff';
      const red = new THREE.MeshBasicMaterial({ color: 0xff3b1f });
      red.name = 'realmRacersTrack:startLightRed';
      const green = new THREE.MeshBasicMaterial({ color: 0x45e06f });
      green.name = 'realmRacersTrack:startLightGreen';
      lights = { off, red, green };
      return lights;
    },
    water(theme) {
      // The tier gate is the world's own (`usesShaderWater`): where the world
      // lays its Phong plane, the band wears that very material, theme ramp and
      // all left behind, rather than linking a shader only a racer would draw.
      if (!usesShaderWater()) return lowTierWaterMaterial();
      const key = theme.water ? `${theme.water.shallow}:${theme.water.deep}` : 'world';
      const known = waters.get(key);
      if (known) return known;
      // The colour ramp is the theme's, and it is the ONLY thing about the water
      // a theme moves: the ripples, the fresnel sky tint, the sun glints and the
      // foam are the world's own water everywhere, deliberately.
      const material = buildWaterSurfaceMaterial({
        wave: zeroWaveUniforms(),
        surfaceOrigin: REALM_RACERS_ORIGIN,
        ...(theme.water
          ? {
              shallow: new THREE.Color(theme.water.shallow),
              deep: new THREE.Color(theme.water.deep),
            }
          : {}),
      });
      material.name = 'realmRacersTrack:water';
      waters.set(key, material);
      return material;
    },
  };
}
