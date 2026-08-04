// The circuit THEME seam: whether one-circuit-per-zone is really a data
// exercise, or whether the Evergarden is still wired in somewhere.
//
// The Evergarden theme's own "nothing moved" pins live beside the rest of the
// circuit's derived placements, in `realm_racers_render.test.ts`, because they
// are literals captured on the far side of the extraction and belong with the
// build they were read off. What is here is the CONTRACT every theme signs:
// ids resolve both ways, nothing references a model the client cannot load,
// every consumer really reads the record, and a theme cannot reach physics.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  CIRCUIT_THEMES,
  REALM_RACERS_THEME_ASSET_URLS,
  realmRacersTheme,
  realmRacersThemeAt,
} from '../src/render/realm_racers_themes';
import { realmRacersPreloadInternalsForTest } from '../src/render/realm_racers_track';
import {
  rallyBorderFlowerSpots,
  rallyPerimeterPieces,
} from '../src/render/realm_racers_track_core';
import { DEEP_COLOR, SHALLOW_COLOR } from '../src/render/water_surface_material';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_DEFAULT_THEME_ID,
  REALM_RACERS_THEME_IDS,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../src/sim/content/realm_racers_props';
import {
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_ORIGIN, realmRacersLaneOffset } from '../src/sim/realm_racers_layout';
import { glbSize } from './helpers/glb_bounds';

// The builder mints procedural canvas textures, so the build cases below need
// the same texture stub every other headless render suite uses.
function mockTextures(): void {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    rallyKerbTexture: vi.fn(texture),
    rallyGroundBlastMarkerTexture: vi.fn(texture),
    rallyStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    // The lawn's grass card comes from foliage.ts, which mints its own tuft
    // texture out of this module.
    grassTuftTexture: vi.fn(texture),
    groundDetailTexture: vi.fn(texture),
    macroNoiseTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: { map: texture(), normalMap: texture() },
      dirt: { map: texture(), normalMap: texture() },
      rock: { map: texture(), normalMap: texture() },
      sand: { map: texture(), normalMap: texture() },
    })),
  }));
}

/** Every theme except the one the shipped circuits wear. */
const OTHER_THEME_IDS = Object.keys(CIRCUIT_THEMES).filter(
  (id) => id !== REALM_RACERS_DEFAULT_THEME_ID,
);

/**
 * The garden's curve wearing a named skin: the same geometry, so anything that
 * differs between two builds of it is the THEME and nothing else.
 *
 * Every case goes through this rather than reading the shipped record's own
 * `theme`, because that field is the one an operator flips to look at a theme
 * in game, and a suite that broke when they did would be pinning the state of a
 * scratch edit rather than the seam.
 */
function probeCircuit(themeId: string): RealmRacersCircuit {
  return { ...GARDEN_CIRCUIT, id: `theme_probe_${themeId}`, theme: themeId };
}

const GALECREST_CIRCUIT = probeCircuit('galecrest');

/**
 * Which horizontal axis a shipped model's LENGTH runs along, measured off the
 * GLB itself.
 *
 * Read out of the glTF JSON chunk rather than through GLTFLoader: every
 * POSITION accessor carries its own min/max, so the extents are available
 * without decoding a buffer, and the loader cannot parse these files headless
 * anyway (their KTX2 textures need a WebGL context). Node transforms are
 * composed on the way down, since a kit is free to author a module rotated
 * inside its own scene.
 */
function glbLongHorizontalAxis(url: string): 'x' | 'z' {
  const size = glbSize(url);
  // Never a coin toss: both shipped wall kits are better than 5:1 on their own
  // length, so a model this fails on is one nothing should be laying in a run.
  expect(
    Math.max(size.x, size.z) / Math.min(size.x, size.z),
    `${url} is not a run`,
  ).toBeGreaterThan(2);
  return size.x >= size.z ? 'x' : 'z';
}

/** Every model url a theme names, whatever the shape of the piece naming it. */
function themeUrls(themeId: string): string[] {
  const theme = CIRCUIT_THEMES[themeId];
  return [
    theme.perimeter.fenceUrl,
    theme.perimeter.pillarUrl,
    theme.startFixture.archUrl,
    theme.startFixture.bannerUrl,
    theme.reedUrl,
  ];
}

describe('Realm Racers circuit themes', () => {
  it('resolves every id both ways, so neither list can grow alone', () => {
    // The sim-side list is what the editor's picker offers and what the metrics
    // readout validates against; the registry is what the renderer draws. An id
    // in one and not the other is either a theme nobody can select or a
    // selection that silently falls back to the garden.
    expect([...REALM_RACERS_THEME_IDS].sort()).toEqual(Object.keys(CIRCUIT_THEMES).sort());
    expect(REALM_RACERS_THEME_IDS).toContain(REALM_RACERS_DEFAULT_THEME_ID);
    expect(REALM_RACERS_THEME_IDS.length).toBeGreaterThan(1);
  });

  it.each(OTHER_THEME_IDS)('the %s theme owns every knob a skin must own', (themeId) => {
    // A registry with one record cannot tell "reads the theme" from "reads
    // the Evergarden by another name", so a second one is the proof the seam
    // is general. Held for EVERY theme rather than for one: a record that
    // inherits half the garden is a skin nobody would ship, and it is exactly
    // what a copied record produces.
    const garden = CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID];
    const theme = CIRCUIT_THEMES[themeId];
    expect(theme.ground).not.toBe(garden.ground);
    expect(theme.kerb).not.toEqual(garden.kerb);
    expect(theme.startGrid).not.toEqual(garden.startGrid);
    expect(theme.perimeter.fenceUrl).not.toBe(garden.perimeter.fenceUrl);
    expect(theme.startFixture.bannerUrl).not.toBe(garden.startFixture.bannerUrl);
    expect(theme.flowers.colours).not.toEqual(garden.flowers.colours);
    expect(theme.flowers.card).not.toEqual(garden.flowers.card);
    expect(theme.sky.biome).not.toBe(garden.sky.biome);
    expect(theme.sky.fog.color).not.toBe(garden.sky.fog.color);
    // ...and the scenery vocabulary is its own, not the garden's re-listed.
    // Pieces MAY be shared (a bench is a bench in any zone), but not all.
    expect(theme.props).not.toEqual(garden.props);
    expect(theme.props.filter((asset) => !garden.props.includes(asset)).length).toBeGreaterThan(0);
    // The wall kit is owned too, and all four of its numbers travel together:
    // a kit swapped without its run, scale or axis is the defect that stood
    // the Galecrest wall broadside to itself.
    expect(theme.perimeter.pillarUrl).not.toBe(garden.perimeter.pillarUrl);
    expect([
      theme.perimeter.panelYards,
      theme.perimeter.scale,
      theme.perimeter.lengthAxis,
    ]).not.toEqual([
      garden.perimeter.panelYards,
      garden.perimeter.scale,
      garden.perimeter.lengthAxis,
    ]);
    // SHARED BY DESIGN, and listed so the exemption is auditable rather than
    // an omission: one race arch serves every zone, and reeds are reeds.
    expect(theme.startFixture.archUrl).toBe(garden.startFixture.archUrl);
    expect(theme.reedUrl).toBe(garden.reedUrl);
  });

  it('every shipped circuit names a theme the game authors', () => {
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      expect(REALM_RACERS_THEME_IDS, circuit.id).toContain(circuit.theme);
      expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(circuit))).toEqual([]);
    }
  });

  it('calls an unknown theme an error by name, and still draws the circuit', () => {
    // The readout is what a DRAFT is admitted by, so a theme id typed one
    // letter wrong has to be reported rather than silently swallowed...
    const typo: RealmRacersCircuit = { ...GARDEN_CIRCUIT, id: 'theme_typo', theme: 'evergardn' };
    const errors = realmRacersCircuitErrors(realmRacersCircuitMetrics(typo));
    expect(errors.map((problem) => problem.code)).toContain('unknown_theme');
    // ...and the clean circuit next to it must not be reported, or the readout
    // is just noisy.
    expect(
      realmRacersCircuitErrors(realmRacersCircuitMetrics(GALECREST_CIRCUIT)).map((p) => p.code),
    ).not.toContain('unknown_theme');
    // The resolver still answers, because this runs inside a world build: a
    // crash over a typo would take the whole client down.
    expect(realmRacersTheme(typo)).toBe(CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID]);
  });

  describe.each(Object.keys(CIRCUIT_THEMES))('the %s theme', (themeId) => {
    const theme = CIRCUIT_THEMES[themeId];

    it('names only models the client has and will have loaded', () => {
      for (const url of themeUrls(themeId)) {
        // On disk and hashed into the media manifest...
        expect(MEDIA_ASSETS[url.replace(/^\//, '')], url).toBeDefined();
        // ...and in the preload lane, which is the half no other test can see:
        // an unpreloaded model draws NOTHING on a cold client rather than
        // failing, and a theme nothing ships yet is exactly the case where
        // that would go unnoticed.
        expect(realmRacersPreloadInternalsForTest.assetUrls, url).toContain(url);
      }
    });

    it('carries a vocabulary, a palette and a card the build can use', () => {
      // The prop list is an authoring aid, so the only thing that can be wrong
      // with it is naming a piece the game cannot place. It is checked against
      // the SIM catalog, which is what carries footprints and heights and what
      // the editor's palette is built from.
      expect(theme.props.length).toBeGreaterThan(0);
      expect(new Set(theme.props).size).toBe(theme.props.length);
      for (const asset of theme.props) {
        expect(REALM_RACERS_PROPS, `${themeId} offers ${asset}`).toHaveProperty(asset);
      }
      expect(theme.flowers.colours.length).toBeGreaterThan(0);
      for (const colour of theme.flowers.colours) {
        expect(Number.isInteger(colour)).toBe(true);
        expect(colour).toBeGreaterThanOrEqual(0);
        expect(colour).toBeLessThanOrEqual(0xffffff);
      }
      expect(theme.flowers.card.length).toBeGreaterThan(0);
      for (const kind of theme.flowers.card) {
        for (const channel of [...kind.p, ...kind.c]) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
      expect(theme.perimeter.panelYards).toBeGreaterThan(0);
      expect(theme.perimeter.scale).toBeGreaterThan(0);
    });

    it('lays every wall module ALONG the wall, whichever axis its kit runs on', () => {
      // The defect this exists for was visible from the grid: the Galecrest
      // wall's every stone module stood broadside to the wall, because the yaw
      // was the ironwork's and that kit runs along a different local axis.
      //
      // The axis is MEASURED off the shipped GLB rather than read off the
      // record, which is the whole difference between a test and a restatement:
      // the first version of this case took `lengthAxis` from the theme and
      // then checked a yaw derived from `lengthAxis`, so it passed with the
      // field set wrong. The record is checked against the measurement too,
      // second, so a mis-authored theme is named rather than merely failing.
      const measured = glbLongHorizontalAxis(theme.perimeter.fenceUrl);
      expect(theme.perimeter.lengthAxis, `${themeId} wall kit`).toBe(measured);

      const circuit: RealmRacersCircuit = { ...GARDEN_CIRCUIT, id: 'wall_probe', theme: themeId };
      const pieces = rallyPerimeterPieces(circuit).filter((piece) => !piece.pillar);
      expect(pieces.length).toBeGreaterThan(20);
      const seen = new Set<string>();
      for (const piece of pieces) {
        // A three.js yaw maps local +x to (cos, -sin) and local +z to
        // (sin, cos).
        const along =
          measured === 'z'
            ? { x: Math.sin(piece.yaw), z: Math.cos(piece.yaw) }
            : { x: Math.cos(piece.yaw), z: -Math.sin(piece.yaw) };
        // Which face it stands on, read off the position rather than assumed.
        const onEastWest =
          Math.abs(Math.abs(piece.x - REALM_RACERS_ORIGIN.x) - circuit.perimeter.halfX) < 1e-6;
        seen.add(onEastWest ? 'ew' : 'ns');
        // Parallel to that face: the module's length runs down the wall, not
        // across it.
        const acrossTheFace = onEastWest ? along.x : along.z;
        expect(Math.abs(acrossTheFace), `${themeId} module at ${piece.x}, ${piece.z}`).toBeCloseTo(
          0,
          6,
        );
      }
      // ...on both pairs of faces, so a yaw that happens to be right on one
      // axis and wrong on the other cannot pass.
      expect(seen).toEqual(new Set(['ew', 'ns']));
    });

    it('tints the air without veiling anything a pilot reacts to', () => {
      // The COLOUR of the haze is the themed half. Its DEPTH is not: how far
      // down the road a pilot can see a rival, a corner or the wall is a
      // fairness number, and a skin is the last thing that should move it. Every
      // theme therefore holds the depth the raced circuit already shipped with,
      // and a circuit that genuinely wants a different one changes it here, out
      // loud, rather than through its art.
      // Anchored on LITERALS, not on another theme's record: the band moved out
      // of renderer.ts into three sibling records in this change, and a
      // theme-against-theme comparison would stay green if one edit rewrote all
      // three, which is exactly the quiet rewrite this case exists to stop.
      expect(theme.sky.fog.near).toBe(85);
      expect(theme.sky.fog.far).toBe(430);
      const shipped = CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID].sky.fog;
      expect(theme.sky.fog.near).toBe(shipped.near);
      expect(theme.sky.fog.far).toBe(shipped.far);
    });

    it('changes visuals only: it has no field physics could read', () => {
      // The rule this whole registry is written under, made mechanical. Speed,
      // grip, drag, widths, laps and the referee live on the circuit record and
      // the shared constants; a theme that grew a handling knob would be a skin
      // that changes how a machine drives, which is the one thing it may never
      // be. A new VISUAL knob is added to this list in the same change.
      expect(Object.keys(theme).sort()).toEqual(
        [
          'flowers',
          'ground',
          'kerb',
          'perimeter',
          'props',
          'reedUrl',
          'sky',
          'startFixture',
          'startGrid',
          ...(theme.water ? ['water'] : []),
        ].sort(),
      );
    });
  });

  it('preloads every kit, including one no circuit wears yet', () => {
    for (const url of REALM_RACERS_THEME_ASSET_URLS) {
      expect(realmRacersPreloadInternalsForTest.assetUrls).toContain(url);
    }
    // EVERY theme's kit, worn by a shipped circuit or not: a theme with no
    // circuit on it is exactly the case a lane check would miss, and the
    // registry is meant to be written a zone ahead of the circuit.
    for (const themeId of OTHER_THEME_IDS) {
      expect(REALM_RACERS_THEME_ASSET_URLS).toContain(CIRCUIT_THEMES[themeId].perimeter.fenceUrl);
    }
  });

  it('flies one sky per circuit rather than one per lane', () => {
    // The band's own `zoneBiomeAt` answer depends on which lane a copy of the
    // circuit sits in, so the public lane and the private practice copies used
    // to be lit by different skies. The theme is what makes them one.
    const themes = [0, 1, 2, 3].map((lane) => {
      const offset = realmRacersLaneOffset(lane);
      return realmRacersThemeAt(REALM_RACERS_ORIGIN.x + offset.x, REALM_RACERS_ORIGIN.z + offset.z);
    });
    for (const theme of themes) expect(theme.sky.biome).toBe(themes[0].sky.biome);
    // ...and a point outside every lane still answers, because the fog arm
    // reads it unconditionally inside the band.
    expect(realmRacersThemeAt(0, 0)).toBe(CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID]);
  });

  describe('what a theme actually moves on one unchanged curve', () => {
    it.each(Object.keys(CIRCUIT_THEMES))('%s cuts the wall with its own module', (themeId) => {
      const wall = rallyPerimeterPieces(probeCircuit(themeId));
      expect(wall.filter((piece) => piece.pillar)).toHaveLength(4);
      // Same wall, so the same number of PIECES only if the module run is the
      // same too: a longer module is fewer, bigger panels around one rectangle.
      const panels = wall.length - 4;
      const garden = rallyPerimeterPieces(probeCircuit(REALM_RACERS_DEFAULT_THEME_ID)).length - 4;
      const longerModule =
        CIRCUIT_THEMES[themeId].perimeter.panelYards >
        CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID].perimeter.panelYards;
      if (longerModule) expect(panels).toBeLessThan(garden);
    });

    it.each(OTHER_THEME_IDS)('%s re-sows the border off its own palette', (themeId) => {
      // The colour index is drawn against the palette's LENGTH, so a theme with
      // a different number of colours sows a different border on the same road.
      const garden = rallyBorderFlowerSpots(probeCircuit(REALM_RACERS_DEFAULT_THEME_ID));
      const themed = rallyBorderFlowerSpots(probeCircuit(themeId));
      expect(themed).toHaveLength(garden.length);
      expect(themed.map((spot) => spot.colour)).not.toEqual(garden.map((spot) => spot.colour));
      for (const spot of themed) {
        expect(spot.colour).toBeLessThan(CIRCUIT_THEMES[themeId].flowers.colours.length);
      }
    });

    describe('through the real builder', () => {
      beforeEach(() => {
        vi.resetModules();
        mockTextures();
      });
      afterEach(() => {
        vi.doUnmock('../src/render/textures');
      });

      it('paints the ground and the water in the theme colours', async () => {
        const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
        const groundColour = (circuit: RealmRacersCircuit): THREE.Color => {
          const lawn = buildRealmRacersTrack(circuit).group.children.find(
            (child): child is THREE.Mesh =>
              child instanceof THREE.Mesh && child.geometry.getAttribute('aSplat') !== undefined,
          );
          if (!lawn) throw new Error('the build has no ground surface');
          const colour = lawn.geometry.getAttribute('color');
          return new THREE.Color(colour.getX(0), colour.getY(0), colour.getZ(0));
        };
        // Read off the built vertex colours, which is the end of the chain the
        // theme's `ground` starts: a record read that never reached a buffer
        // would pass every assertion above this one. Every theme paints its own
        // ground, so no two circuits come out the same colour.
        const grounds = Object.keys(CIRCUIT_THEMES).map((themeId) =>
          groundColour(probeCircuit(themeId)).getHex(),
        );
        expect(new Set(grounds).size).toBe(grounds.length);

        const rampOf = (circuit: RealmRacersCircuit): { shallow: number; deep: number } => {
          const water = buildRealmRacersTrack(circuit).group.children.find(
            (child): child is THREE.Mesh =>
              child instanceof THREE.Mesh &&
              child.geometry.getAttribute('aShoreDepth') !== undefined,
          );
          if (!water) throw new Error('the build has no water');
          const material = water.material as THREE.ShaderMaterial;
          return {
            shallow: (material.uniforms.uShallow.value as THREE.Color).getHex(),
            deep: (material.uniforms.uDeep.value as THREE.Color).getHex(),
          };
        };
        const gale = CIRCUIT_THEMES.galecrest.water;
        if (!gale) throw new Error('the Galecrest theme tints its water');
        // BOTH ends of the ramp: wiring one uniform to the other colour is the
        // single-character mistake this pins.
        expect(rampOf(GALECREST_CIRCUIT)).toEqual({ shallow: gale.shallow, deep: gale.deep });
        // The Evergarden asks for no tint, so its pools stay the WORLD's own
        // water, which is a positive claim rather than "not Galecrest's".
        expect(rampOf(probeCircuit(REALM_RACERS_DEFAULT_THEME_ID))).toEqual({
          shallow: SHALLOW_COLOR.getHex(),
          deep: DEEP_COLOR.getHex(),
        });
      });
    });
  });
});
