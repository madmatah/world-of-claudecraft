// The circuit THEME seam: whether one-circuit-per-zone is really a data
// exercise, or whether the Evergarden is still wired in somewhere.
//
// The Evergarden theme's own "nothing moved" pins live beside the rest of the
// circuit's derived placements, in `mortar_overdrive_render.test.ts`, because they
// are literals captured on the far side of the extraction and belong with the
// build they were read off. What is here is the CONTRACT every theme signs:
// ids resolve both ways, nothing references a model the client cannot load,
// every consumer really reads the record, and a theme cannot reach physics.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import { REALM_DAYNIGHT_AMPLITUDE } from '../src/render/day_night_core';
import { EMBER_PROP_URLS } from '../src/render/ember_prop_urls';
import { ignivarEnvPropKeyOfUrl } from '../src/render/ignivar_env_props';
import { JUNGLE_PALM_URLS, JUNGLE_PROP_URLS } from '../src/render/jungle_prop_urls';
import {
  MORTAR_OVERDRIVE_BARRIER_VISUALS,
  mortarOverdriveBarrierKitUrls,
} from '../src/render/mortar_overdrive/barrier_visuals';
import { mortarOverdriveDressingRoute } from '../src/render/mortar_overdrive/dressing_material';
import { MORTAR_OVERDRIVE_PROP_VISUALS } from '../src/render/mortar_overdrive/prop_visuals';
import {
  CIRCUIT_THEMES,
  MORTAR_OVERDRIVE_THEME_ASSET_URLS,
  mortarOverdriveSkyDayNightBiome,
  mortarOverdriveTheme,
  mortarOverdriveThemeAt,
  mortarOverdriveThemeKitUrls,
} from '../src/render/mortar_overdrive/themes';
import { mortarOverdriveCircuitKitUrls } from '../src/render/mortar_overdrive/track';
import { mortarOverdriveBorderFlowerSpots } from '../src/render/mortar_overdrive/track_core';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { questObjectPreloadInternalsForTest } from '../src/render/quest_objects';
import { BIOME_PALETTE } from '../src/render/terrain_palette';
import { WATER_FLORA_SKIP_BIOMES } from '../src/render/water_flora_core';
import { DEEP_COLOR, SHALLOW_COLOR } from '../src/render/water_surface_material';
import { DRAKELANDS_PROPS, DRAKELANDS_ZONE } from '../src/sim/content/drakelands';
import { MORTAR_OVERDRIVE_BARRIERS } from '../src/sim/content/mortar_overdrive/barriers';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  MORTAR_OVERDRIVE_DEFAULT_THEME_ID,
  MORTAR_OVERDRIVE_THEME_IDS,
  type MortarOverdriveCircuit,
} from '../src/sim/content/mortar_overdrive/circuits';
import { MORTAR_OVERDRIVE_PROPS } from '../src/sim/content/mortar_overdrive/props';
import { PALMREACH_PROPS, PALMREACH_ZONE } from '../src/sim/content/palmreach';
import { VEHICLE_STATIONS } from '../src/sim/content/vehicle_stations';
import { ZONES } from '../src/sim/data';
import { FORGEFATHER_FORTRESS_PLACEMENTS } from '../src/sim/forgefather_fortress';
import {
  mortarOverdriveCircuitErrors,
  mortarOverdriveCircuitMetrics,
} from '../src/sim/mortar_overdrive/circuit_metrics';
import {
  MORTAR_OVERDRIVE_ORIGIN,
  mortarOverdriveLaneOffset,
} from '../src/sim/mortar_overdrive/layout';
import { mortarOverdriveThemeZone } from '../src/sim/mortar_overdrive/zone';
import { STREETLAMP_STYLE_BY_ZONE } from '../src/sim/streetlamp_style';

// The builder mints procedural canvas textures, so the build cases below need
// the same texture stub every other headless render suite uses.
function mockTextures(): void {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    mortarOverdriveKerbTexture: vi.fn(texture),
    mortarOverdriveGroundBlastMarkerTexture: vi.fn(texture),
    mortarOverdriveStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    // The lawn's grass card comes from foliage.ts, which mints its own tuft
    // texture out of this module.
    grassTuftTexture: vi.fn(texture),
    // The pickup boxes wear the world's own quest-object sparkle.
    sparkleTexture: vi.fn(texture),
    groundDetailTexture: vi.fn(texture),
    macroNoiseTexture: vi.fn(texture),
    // The low-tier water is the world's own Phong plane material.
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
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
  (id) => id !== MORTAR_OVERDRIVE_DEFAULT_THEME_ID,
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
function probeCircuit(themeId: string): MortarOverdriveCircuit {
  return { ...GARDEN_CIRCUIT, id: `theme_probe_${themeId}`, theme: themeId };
}

const GALECREST_CIRCUIT = probeCircuit('galecrest');

/** Every model url a theme names, whatever the shape of the piece naming it. */
function themeUrls(themeId: string): string[] {
  const theme = CIRCUIT_THEMES[themeId];
  return [
    theme.startFixture.archUrl,
    theme.startFixture.bannerUrl,
    ...(theme.reedUrl ? [theme.reedUrl] : []),
  ];
}

describe('Mortar Overdrive circuit themes', () => {
  it('resolves every id both ways, so neither list can grow alone', () => {
    // The sim-side list is what the editor's picker offers and what the metrics
    // readout validates against; the registry is what the renderer draws. An id
    // in one and not the other is either a theme nobody can select or a
    // selection that silently falls back to the garden.
    expect([...MORTAR_OVERDRIVE_THEME_IDS].sort()).toEqual(Object.keys(CIRCUIT_THEMES).sort());
    expect(MORTAR_OVERDRIVE_THEME_IDS).toContain(MORTAR_OVERDRIVE_DEFAULT_THEME_ID);
    expect(MORTAR_OVERDRIVE_THEME_IDS.length).toBeGreaterThan(1);
  });

  it.each(OTHER_THEME_IDS)('the %s theme owns every knob a skin must own', (themeId) => {
    // A registry with one record cannot tell "reads the theme" from "reads
    // the Evergarden by another name", so a second one is the proof the seam
    // is general. Held for EVERY theme rather than for one: a record that
    // inherits half the garden is a skin nobody would ship, and it is exactly
    // what a copied record produces.
    const garden = CIRCUIT_THEMES[MORTAR_OVERDRIVE_DEFAULT_THEME_ID];
    const theme = CIRCUIT_THEMES[themeId];
    expect(theme.ground).not.toBe(garden.ground);
    expect(theme.kerb).not.toEqual(garden.kerb);
    expect(theme.startGrid).not.toEqual(garden.startGrid);
    expect(theme.startFixture.bannerUrl).not.toBe(garden.startFixture.bannerUrl);
    expect(theme.flowers.colours).not.toEqual(garden.flowers.colours);
    expect(theme.flowers.card).not.toEqual(garden.flowers.card);
    expect(theme.sky.biome).not.toBe(garden.sky.biome);
    expect(theme.sky.fog.color).not.toBe(garden.sky.fog.color);
    // ...and the scenery vocabulary is its own, not the garden's re-listed.
    // Pieces MAY be shared (a bench is a bench in any zone), but not all.
    expect(theme.props).not.toEqual(garden.props);
    expect(theme.props.filter((asset) => !garden.props.includes(asset)).length).toBeGreaterThan(0);
    // The BARRIER vocabulary is its own too. It replaced a mandatory wall kit,
    // and it is an authoring aid rather than a skin: pieces MAY be shared (a
    // stone wall is a stone wall in any zone), but a record that just re-lists
    // the garden's is a record nobody chose kits for.
    expect(theme.barriers).not.toEqual(garden.barriers);
    expect(theme.barriers[0], `${themeId} leads with its own kit`).not.toBe(garden.barriers[0]);
    // SHARED BY DESIGN, and listed so the exemption is auditable rather than
    // an omission: one race arch serves every zone, and reeds are reeds.
    expect(theme.startFixture.archUrl).toBe(garden.startFixture.archUrl);
    if (theme.reedUrl !== null) {
      expect(theme.reedUrl).toBe(garden.reedUrl);
      return;
    }
    // ...or no rim at all, and only where that is the WORLD's answer rather
    // than a taste: the realm's own lakes are ones the world's water flora
    // leaves bare. The lakes check keeps it from passing on a realm that has
    // no water to be bare.
    // The world-map zone the theme is the record of (the one naming rule,
    // src/sim/mortar_overdrive/zone.ts).
    const zone = mortarOverdriveThemeZone(themeId);
    expect(WATER_FLORA_SKIP_BIOMES.has(zone.biome), `${themeId} lakes are planted`).toBe(true);
    expect(zone.lakes?.length ?? 0, `${themeId} has lakes`).toBeGreaterThan(0);
  });

  it('every shipped circuit names a theme the game authors', () => {
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      expect(MORTAR_OVERDRIVE_THEME_IDS, circuit.id).toContain(circuit.theme);
      expect(mortarOverdriveCircuitErrors(mortarOverdriveCircuitMetrics(circuit))).toEqual([]);
    }
  });

  it('calls an unknown theme an error by name, and still draws the circuit', () => {
    // The readout is what a DRAFT is admitted by, so a theme id typed one
    // letter wrong has to be reported rather than silently swallowed...
    const typo: MortarOverdriveCircuit = {
      ...GARDEN_CIRCUIT,
      id: 'theme_typo',
      theme: 'evergardn',
    };
    const errors = mortarOverdriveCircuitErrors(mortarOverdriveCircuitMetrics(typo));
    expect(errors.map((problem) => problem.code)).toContain('unknown_theme');
    // ...and the clean circuit next to it must not be reported, or the readout
    // is just noisy.
    expect(
      mortarOverdriveCircuitErrors(mortarOverdriveCircuitMetrics(GALECREST_CIRCUIT)).map(
        (p) => p.code,
      ),
    ).not.toContain('unknown_theme');
    // The resolver still answers, because this runs inside a world build: a
    // crash over a typo would take the whole client down.
    expect(mortarOverdriveTheme(typo)).toBe(CIRCUIT_THEMES[MORTAR_OVERDRIVE_DEFAULT_THEME_ID]);
  });

  describe.each(Object.keys(CIRCUIT_THEMES))('the %s theme', (themeId) => {
    const theme = CIRCUIT_THEMES[themeId];

    it('names only models the client actually has', () => {
      for (const url of themeUrls(themeId)) {
        // On disk and hashed into the media manifest. A theme nothing ships
        // yet is exactly the case where a url typed one letter wrong would go
        // unnoticed, so this is held for EVERY record rather than the worn
        // ones: an unresolvable model draws nothing at all rather than
        // failing, on a route (the editor preview, `/dev overdrivedraft`) whose
        // whole job is to look at a theme before a circuit wears it.
        expect(MEDIA_ASSETS[url.replace(/^\//, '')], url).toBeDefined();
      }
      // ...and it is the SET the manifest guard walks, so a record naming a
      // file outside it is out of that guard's reach.
      expect(MORTAR_OVERDRIVE_THEME_ASSET_URLS).toEqual(expect.arrayContaining(themeUrls(themeId)));
    });

    it('carries a vocabulary, a palette and a card the build can use', () => {
      // The prop list is an authoring aid, so the only thing that can be wrong
      // with it is naming a piece the game cannot place. It is checked against
      // the SIM catalog, which is what carries footprints and heights and what
      // the editor's palette is built from.
      expect(theme.props.length).toBeGreaterThan(0);
      expect(new Set(theme.props).size).toBe(theme.props.length);
      for (const asset of theme.props) {
        expect(MORTAR_OVERDRIVE_PROPS, `${themeId} offers ${asset}`).toHaveProperty(asset);
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
      expect(theme.barriers.length).toBeGreaterThan(0);
      for (const kit of theme.barriers) {
        expect(MORTAR_OVERDRIVE_BARRIERS[kit], `${themeId} offers ${kit}`).toBeDefined();
      }
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
      const shipped = CIRCUIT_THEMES[MORTAR_OVERDRIVE_DEFAULT_THEME_ID].sky.fog;
      expect(theme.sky.fog.near).toBe(shipped.near);
      expect(theme.sky.fog.far).toBe(shipped.far);
    });

    it('flies a dome the world has, and grades it off a realm the tables know', () => {
      // The DOME and the day/night GRADE are two questions, and this is the one
      // case that holds them apart. `sky.biome` is a `MortarOverdriveSkyKey`, so it may
      // name the Farshore's place-keyed dome, which is NOT a biome; the grade
      // tables are keyed by biome, so the Mortar Overdrive scene (`mortar_overdrive/scene.ts`)
      // resolves it through `mortarOverdriveSkyDayNightBiome` before indexing them.
      //
      // The amplitude arm is the one that matters: an undefined there is a NaN
      // sun angle rather than a crash, so a mis-keyed record would darken a
      // circuit and fail nothing. Held for EVERY record rather than for the one
      // exception, since a fifteenth realm naming a fresh key is exactly the
      // case that would slip through a spot check.
      const graded = mortarOverdriveSkyDayNightBiome(theme.sky.biome);
      expect(REALM_DAYNIGHT_AMPLITUDE[graded], `${themeId} amplitude`).toBeTypeOf('number');
      expect(Number.isFinite(REALM_DAYNIGHT_AMPLITUDE[graded])).toBe(true);
      // ...and the mapping is the identity wherever the key IS a biome, which
      // is what makes the helper's introduction a no-op for thirteen realms.
      if (theme.sky.biome !== 'farshore') expect(graded).toBe(theme.sky.biome);
    });

    it('changes visuals only: it has no field physics could read', () => {
      // The rule this whole registry is written under, made mechanical. Speed,
      // grip, drag, widths, laps and the referee live on the circuit record and
      // the shared constants; a theme that grew a handling knob would be a skin
      // that changes how a machine drives, which is the one thing it may never
      // be. A new VISUAL knob is added to this list in the same change.
      expect(Object.keys(theme).sort()).toEqual(
        [
          'barriers',
          'flowers',
          'ground',
          'kerb',
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

  it('fetches with a circuit build exactly the kit that circuit wears', () => {
    // Structure a circuit cannot draw late (the wall, the arch, the grid
    // banner) is fetched when ITS build starts, the race preparation's
    // commitment to it, never at boot: a boot preload of every worn kit pinned
    // parsed scenes on a map that never clears, for a player who may never
    // race. Each circuit asks for its own theme's kit and the barrier kits its
    // record authors, and nothing of another theme.
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      const kit = mortarOverdriveCircuitKitUrls(circuit);
      expect([...kit].sort(), circuit.id).toEqual(
        [
          ...new Set([...themeUrls(circuit.theme), ...mortarOverdriveBarrierKitUrls([circuit])]),
        ].sort(),
      );
      const own = new Set(themeUrls(circuit.theme));
      for (const [themeId, theme] of Object.entries(CIRCUIT_THEMES)) {
        if (own.has(theme.startFixture.bannerUrl)) continue;
        expect(kit, `${circuit.id} ${themeId} banner`).not.toContain(theme.startFixture.bannerUrl);
      }
    }
    // An unknown theme id wears the default theme's kit, the fallback the
    // build itself reads mid-build.
    const unknown = { ...GARDEN_CIRCUIT, theme: 'no_such_theme', fences: [] };
    expect(mortarOverdriveThemeKitUrls(unknown)).toEqual(
      themeUrls(MORTAR_OVERDRIVE_DEFAULT_THEME_ID),
    );
    // The whole reason for the scoping, stated against the thing it is scoped
    // FROM: no circuit asks for the registry's whole kit set.
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      expect(mortarOverdriveThemeKitUrls(circuit).length).toBeLessThan(
        MORTAR_OVERDRIVE_THEME_ASSET_URLS.length,
      );
    }
  });

  it('sends the one place-keyed dome to the realm under it', () => {
    // The single non-identity branch in the whole seam, asserted on its own
    // rather than only through the records: the Farshore's dome is a place key
    // (`sky.ts` overrides the biome pick inside the isle's rect), and the realm
    // beneath it is the vale its ZoneDef sits in. Stated as a LITERAL, because
    // reading the answer back out of the record it is meant to check would pass
    // whatever the helper did.
    expect(mortarOverdriveSkyDayNightBiome('farshore')).toBe('vale');
    expect(ZONES.find((zone) => zone.id === 'farshore_isle')?.biome).toBe('vale');
    // ...and it touches nothing else: every biome key is its own answer.
    for (const biome of new Set(ZONES.map((zone) => zone.biome))) {
      expect(mortarOverdriveSkyDayNightBiome(biome), biome).toBe(biome);
    }
  });

  it('gives every world-map zone a theme, and every theme a zone', () => {
    // THE contract this registry exists for, held mechanically rather than by
    // review: a circuit drawn anywhere wears the art of the realm it is meant
    // to be in, so a fifteenth realm cannot ship without a record and a record
    // cannot name a realm the world does not have.
    //
    // Matched through the one resolver that holds the naming rule the ids are
    // authored under (`thornpeak` for `thornpeak_heights`), read backwards: a
    // zone no theme resolves to reads undefined and fails the list below.
    const themeIdForZone = (zoneId: string): string | undefined =>
      MORTAR_OVERDRIVE_THEME_IDS.find((themeId) => mortarOverdriveThemeZone(themeId).id === zoneId);
    // ONE named exemption, and it is a fact about the place rather than a
    // shortcut: the Proving Shore is the level 1 to 2 tutorial island a
    // character learns on and sails away from (its ferry bell only ever brings
    // one back for a refresher), so no circuit is drawn on it. It also carries
    // the vale's own biome, and the unique-ground rule below forbids a second
    // record painting the vale, so it could not have a theme of its own even
    // if a circuit wanted one. Named here, exactly as the Farshore's two art
    // exceptions are, rather than exempted quietly.
    const RACEABLE_ZONES = ZONES.filter((zone) => zone.id !== 'proving_shore');
    expect(ZONES.length - RACEABLE_ZONES.length).toBe(1);
    expect(RACEABLE_ZONES.length).toBeGreaterThan(13);
    expect(RACEABLE_ZONES.map((zone) => themeIdForZone(zone.id)).sort()).toEqual(
      [...MORTAR_OVERDRIVE_THEME_IDS].sort(),
    );
    // ...and each one paints its OWN realm's ground, which is the half an id
    // match cannot see: a record could carry the right name over the wrong
    // palette. The Farshore is the deliberate exception and is named here
    // rather than exempted quietly: its isle is a sand shore, so it takes the
    // `beach` paint rather than the `vale` its ZoneDef sits in, which is also
    // what leaves the vale free for Eastbrook under the unique-ground rule.
    for (const zone of RACEABLE_ZONES) {
      const theme = CIRCUIT_THEMES[themeIdForZone(zone.id) ?? ''];
      const expected = zone.id === 'farshore_isle' ? 'beach' : zone.biome;
      expect(theme.ground, zone.id).toBe(expected);
      // The SKY is the second dimension, and it is worth the extra line: an id
      // match plus one field could still be two records swapped wholesale, one
      // realm's art under the other's name. It also pins the Evergarden's move
      // off Eastbrook's `vale` dome onto its own POSITIVELY, rather than only
      // through "not the garden's" somewhere else. The Farshore is the same
      // deliberate exception, from the other side: its dome is place-keyed, so
      // it is the one record whose sky is not a biome at all.
      const sky = zone.id === 'farshore_isle' ? 'farshore' : zone.biome;
      expect(theme.sky.biome, zone.id).toBe(sky);
    }
    // No two themes paint the same ground: two realms that came out the same
    // colour would make the whole registry decorative.
    const grounds = Object.values(CIRCUIT_THEMES).map((theme) => theme.ground);
    expect(new Set(grounds).size).toBe(grounds.length);
  });

  it('flies one sky per circuit rather than one per lane', () => {
    // The band's own `zoneBiomeAt` answer depends on which lane a copy of the
    // circuit sits in, so the public lane and the private practice copies used
    // to be lit by different skies. The theme is what makes them one.
    const themes = [0, 1, 2, 3].map((lane) => {
      const offset = mortarOverdriveLaneOffset(lane);
      return mortarOverdriveThemeAt(
        MORTAR_OVERDRIVE_ORIGIN.x + offset.x,
        MORTAR_OVERDRIVE_ORIGIN.z + offset.z,
      );
    });
    for (const theme of themes) expect(theme.sky.biome).toBe(themes[0].sky.biome);
    // ...and a point outside every lane still answers, because the fog arm
    // reads it unconditionally inside the band.
    expect(mortarOverdriveThemeAt(0, 0)).toBe(CIRCUIT_THEMES[MORTAR_OVERDRIVE_DEFAULT_THEME_ID]);
  });

  describe('what a theme actually moves on one unchanged curve', () => {
    it.each(OTHER_THEME_IDS)('%s re-sows the border off its own palette', (themeId) => {
      // Resolved through each theme's OWN palette rather than compared as raw
      // indices, which is the whole difference between this case and a
      // coincidence: the index is drawn against the palette's LENGTH, so two
      // themes that happen to carry five colours each sow the identical index
      // sequence down the identical road and an index comparison would call
      // that "not re-sown". What the border actually shows is the colour the
      // index lands on.
      const sown = (id: string): number[] => {
        const palette = CIRCUIT_THEMES[id].flowers.colours;
        const indices = mortarOverdriveBorderFlowerSpots(probeCircuit(id)).map(
          (spot) => spot.colour,
        );
        // The core reads the theme through EXACTLY ONE value, the palette's
        // length, so this is where that read is proven. Both directions, which
        // is what makes it bite: no index may fall outside the palette, and
        // every slot in the palette must actually be drawn. A core that
        // hardcoded any constant fails the second half against the Amberfall's
        // three colours or the garden's five, whichever it did not pick.
        //
        // It carries the whole case for the four themes whose palette happens
        // to be five long like the garden's: those sow the identical index
        // sequence down the identical road, so the comparison below is only
        // telling them apart by palette CONTENT, which another case already
        // owns.
        expect(Math.max(...indices)).toBe(palette.length - 1);
        expect(new Set(indices).size).toBe(palette.length);
        return indices.map((index) => palette[index]);
      };
      const garden = sown(MORTAR_OVERDRIVE_DEFAULT_THEME_ID);
      const themed = sown(themeId);
      expect(themed).toHaveLength(garden.length);
      expect(themed).not.toEqual(garden);
    });

    describe('through the real builder', () => {
      beforeEach(() => {
        vi.resetModules();
        mockTextures();
      });
      afterEach(() => {
        vi.doUnmock('../src/render/textures');
        vi.doUnmock('../src/render/water');
      });

      /** A tier where the world draws the water shader: headless is the low one,
       *  where the band wears the world's Phong plane instead. */
      const onShaderWaterTier = (): void => {
        vi.doMock('../src/render/water', async (importOriginal) => ({
          ...(await importOriginal<typeof import('../src/render/water')>()),
          usesShaderWater: () => true,
        }));
      };

      it('asks for a circuit kit at build time, since nothing preloads it', async () => {
        // THE assumption the race-time kit fetch rests on, and the one thing
        // about it nothing else can see. Nothing preloads a kit, so a circuit's
        // wall, arch and banner reach the draw path only through its build's
        // own fetch (and `instanceModel`'s fetch-and-fill arm); if that ever
        // regressed (an added must-be-preloaded assert, or the headless early
        // return moving above the fetch), every circuit would draw no wall, no
        // arch and no banner, and every other case here would stay green
        // because none of them can tell an unfetched model from an undrawn one.
        //
        // The window stub is load-bearing rather than incidental: that arm is
        // gated on a browser host, so without it the builder takes the headless
        // no-op path and this case would pass while asserting nothing.
        const asked: string[] = [];
        vi.doMock('../src/render/assets/loader', () => ({
          // Never settles. What is under test is the ASK, not the fill, and a
          // resolved stub would drag in a fake scene graph for no added claim.
          loadGltf: vi.fn((url: string) => {
            asked.push(url);
            return new Promise(() => undefined);
          }),
          releaseGltf: vi.fn(),
          releaseTexture: vi.fn(),
          loadHdr: vi.fn(() => new Promise(() => undefined)),
          loadTexture: vi.fn(() => new Promise(() => undefined)),
        }));
        vi.stubGlobal('window', {});
        try {
          const { buildMortarOverdriveTrack } = await import(
            '../src/render/mortar_overdrive/track'
          );
          const themeId = 'frostveil';
          expect(MORTAR_OVERDRIVE_THEME_IDS).toContain(themeId);
          const theme = CIRCUIT_THEMES[themeId];
          // An authored BARRIER stands in for the wall this case was written
          // against: since the perimeter box stopped being drawn, a kit reaches
          // the draw path through the record rather than through the theme, and
          // a kit no shipped circuit wears is exactly what the fetch-and-fill
          // arm exists for.
          const kit = theme.barriers[0];
          const barrier = MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
          buildMortarOverdriveTrack({
            ...probeCircuit(themeId),
            id: 'fetch_and_fill_probe',
            fences: [
              {
                kit,
                points: [
                  { x: -60, z: -40 },
                  { x: -60, z: 40 },
                ],
              },
            ],
          });
          // Structure, not dressing: the barrier and the grid banner.
          expect(asked, 'barrier').toContain(barrier.panelUrl);
          expect(asked, 'banner').toContain(theme.startFixture.bannerUrl);
        } finally {
          vi.unstubAllGlobals();
          vi.doUnmock('../src/render/assets/loader');
        }
      });

      it('paints the ground and the water in the theme colours', async () => {
        onShaderWaterTier();
        const { buildMortarOverdriveTrack } = await import('../src/render/mortar_overdrive/track');
        const groundColour = (circuit: MortarOverdriveCircuit): THREE.Color => {
          const lawn = buildMortarOverdriveTrack(circuit).group.children.find(
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

        const rampOf = (circuit: MortarOverdriveCircuit): { shallow: number; deep: number } => {
          const water = buildMortarOverdriveTrack(circuit).group.children.find(
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
        expect(rampOf(probeCircuit(MORTAR_OVERDRIVE_DEFAULT_THEME_ID))).toEqual({
          shallow: SHALLOW_COLOR.getHex(),
          deep: DEEP_COLOR.getHex(),
        });
      });

      it('anchors the Mortar Overdrive water on the band origin, not on the world one', async () => {
        onShaderWaterTier();
        const { buildMortarOverdriveTrack } = await import('../src/render/mortar_overdrive/track');
        // The band sits around x = 113_700, where a highp float resolves about
        // 7mm: a ripple lookup taken straight off the world position quantizes
        // past a texel and the foam sines lose their argument. The shader
        // subtracts this ONCE in the vertex stage, so the pool out here paints
        // the same water an Evergarden lake does.
        const water = buildMortarOverdriveTrack(GALECREST_CIRCUIT).group.children.find(
          (child): child is THREE.Mesh =>
            child instanceof THREE.Mesh && child.geometry.getAttribute('aShoreDepth') !== undefined,
        );
        if (!water) throw new Error('the build has no water');
        const material = water.material as THREE.ShaderMaterial;
        expect(material.uniforms.uSurfaceOrigin.value).toEqual(
          new THREE.Vector2(MORTAR_OVERDRIVE_ORIGIN.x, MORTAR_OVERDRIVE_ORIGIN.z),
        );
        // The uniform is inert unless the shader actually subtracts it, and a
        // subtraction in the FRAGMENT stage would be the same arithmetic on a
        // value that has already lost the bits. Both halves, pinned.
        expect(material.vertexShader).toContain('vSurf = wp.xz - uSurfaceOrigin;');
        expect(material.fragmentShader).toContain('texture2D(uNorm1, vSurf * 0.055');
      });
    });
  });
  describe('the Drakelands, as the world builds the zone today', () => {
    // The record was rewritten against the zone itself, and these hold it
    // there: every piece it offers is one the zone draws, through a route that
    // shares the zone's own material, so a retired kit or a borrowed castle
    // cannot creep back in as "Drakelands".
    const theme = CIRCUIT_THEMES.drakelands;
    const inZone = (x: number, z: number): boolean =>
      x >= (DRAKELANDS_ZONE.xMin ?? -Infinity) &&
      x <= (DRAKELANDS_ZONE.xMax ?? Infinity) &&
      z >= DRAKELANDS_ZONE.zMin &&
      z <= DRAKELANDS_ZONE.zMax;
    const decorKeys = new Set((DRAKELANDS_PROPS.decorProps ?? []).map((prop) => prop.key));
    // The props.ts builder a ZonePropsDef list feeds, read off its own section
    // of `buildProps`, so a builder that changed its model fails the evidence.
    const propsSource = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');
    const builderPlaces = (section: string, key: string): boolean => {
      const start = propsSource.indexOf(`  // ---- ${section}`);
      const end = propsSource.indexOf('  // ---- ', start + 1);
      return start >= 0 && propsSource.slice(start, end).includes(`'${key}'`);
    };
    const stationUrls = VEHICLE_STATIONS.filter((station) => inZone(station.x, station.z)).map(
      (station) => questObjectPreloadInternalsForTest.questObjectUrl[station.id],
    );
    /** The catalog pieces the zone places itself, each with WHERE it does. */
    const PLACED_BY_THE_ZONE: Record<string, () => boolean> = {
      lampDrakelandsBrazier: () => STREETLAMP_STYLE_BY_ZONE.drakelands === 'drakelands_brazier',
      // Smith Mara's forge and the two cannon stations' dressing.
      hexrBlacksmith: () => decorKeys.has('hexrBlacksmith'),
      hexCannonballs: () => decorKeys.has('hexCannonballs'),
      kcasCratesStacked: () => decorKeys.has('kcasCratesStacked'),
      hexCrateBig: () => decorKeys.has('hexCrateBig'),
      hexSack: () => decorKeys.has('hexSack'),
      // The stations themselves stand the very hex cannon model.
      hexCannon: () =>
        stationUrls.length > 0 && stationUrls.every((url) => url === PROP_ASSET_DEFS.hexCannon.url),
      // The four ruin rings, their columns and their relic hearts.
      column: () => DRAKELANDS_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'column'),
      columnBroken: () =>
        DRAKELANDS_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'columnBroken'),
      statueHead: () =>
        DRAKELANDS_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'statueHead'),
      statueBlock: () =>
        DRAKELANDS_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'statueBlock'),
      graveRound: () =>
        DRAKELANDS_PROPS.graveyards.length > 0 && builderPlaces('graveyards', 'graveRound'),
      graveCross: () =>
        DRAKELANDS_PROPS.graveyards.length > 0 && builderPlaces('graveyards', 'graveCross'),
      well: () => DRAKELANDS_PROPS.wells.length > 0 && builderPlaces('wells', 'well'),
      bonfire: () => DRAKELANDS_PROPS.campfires.length > 0 && builderPlaces('campfires', 'bonfire'),
    };
    const worldKitKeys = new Set<string>(
      FORGEFATHER_FORTRESS_PLACEMENTS.map((placement) => placement.key),
    );
    const emberUrls = new Set<string>(Object.values(EMBER_PROP_URLS));

    it('offers only pieces the zone draws, each through a route that shares its material', () => {
      let kit = 0;
      let ember = 0;
      for (const key of theme.props) {
        const visual = MORTAR_OVERDRIVE_PROP_VISUALS[key];
        expect(visual, key).toBeDefined();
        if (visual.kind === 'worldKit') {
          // A template the fortress table itself places.
          const kitKey = ignivarEnvPropKeyOfUrl(visual.url);
          expect(kitKey !== undefined && worldKitKeys.has(kitKey), key).toBe(true);
          expect(mortarOverdriveDressingRoute(visual.url), key).toBe('worldKit');
          kit++;
          continue;
        }
        if (visual.kind === 'gltf' && emberUrls.has(visual.url)) {
          expect(mortarOverdriveDressingRoute(visual.url), key).toBe('worldRaw');
          ember++;
          continue;
        }
        const placed = PLACED_BY_THE_ZONE[key];
        expect(placed, `${key} is offered with no evidence the zone places it`).toBeDefined();
        expect(placed?.(), key).toBe(true);
      }
      // The two families carry the zone's look; the floors keep them offered.
      expect(kit).toBeGreaterThanOrEqual(10);
      expect(ember).toBe(4);
    });

    it('walls with the fortress curtain and the keep palisade, drawn from the templates', () => {
      expect(theme.barriers).toEqual(['fortressWall', 'keepFence']);
      for (const kit of theme.barriers) {
        const visual = MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
        const urls = [visual.panelUrl, ...(visual.corner === 'none' ? [] : [visual.corner.url])];
        for (const url of urls) {
          expect(mortarOverdriveDressingRoute(url), `${kit} ${url}`).toBe('worldKit');
          expect(worldKitKeys.has(ignivarEnvPropKeyOfUrl(url) ?? ''), url).toBe(true);
        }
      }
    });

    it('dresses the shipped Rampart Run from the zone own vocabulary, one banner of its own', () => {
      // The one shipped Drakelands circuit places only what this theme offers
      // and walls only with its two kits, so it wears what the zone draws.
      const rampart = MORTAR_OVERDRIVE_CIRCUIT_LIST.find((c) => c.id === 'drakelands_rampart_run');
      if (!rampart) throw new Error('the Rampart Run ships');
      const offered = new Set(theme.props);
      for (const prop of rampart.props ?? [])
        expect(offered.has(prop.asset), prop.asset).toBe(true);
      for (const fence of rampart.fences ?? []) {
        expect(theme.barriers.includes(fence.kit), fence.kit).toBe(true);
      }
      // What racing it fetches that no other shipped circuit does: the red grid
      // banner, and nothing of its walls (template-drawn, resident already).
      const lane = new Set(mortarOverdriveCircuitKitUrls(rampart));
      const others = new Set(
        MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.id !== rampart.id).flatMap((c) =>
          themeUrls(c.theme),
        ),
      );
      const added = themeUrls('drakelands').filter((url) => !others.has(url));
      expect(added).toEqual([theme.startFixture.bannerUrl]);
      for (const url of added) expect(lane.has(url), url).toBe(true);
      for (const kit of theme.barriers) {
        expect(lane.has(MORTAR_OVERDRIVE_BARRIER_VISUALS[kit].panelUrl), kit).toBe(false);
      }
    });

    it('flies the ember storm under the zone own haze, and plants no rim', () => {
      expect(theme.ground).toBe('ember');
      expect(theme.sky.biome).toBe('ember');
      // The zone's fog colour, read off the renderer's own table rather than
      // restated, so a retint of the world's haze shows up here.
      const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
      const fog = /\bember: \{ color: (0x[0-9a-f]{6}), near:/.exec(renderer);
      expect(fog, 'the ember row of BIOME_FOG').not.toBeNull();
      expect(theme.sky.fog.color).toBe(Number(fog?.[1]));
      // The zone's lakes are the world's own water, and bare.
      expect(theme.water).toBeUndefined();
      expect(theme.reedUrl).toBeNull();
    });
  });

  describe('the Palmreach, as the world builds the zone today', () => {
    // The record was rewritten against the zone itself, and these hold it
    // there: every piece it offers is one the zone draws, through a route that
    // shares the zone's own material, so a borrowed harbour or a stockade the
    // zone never built cannot creep back in as "Palmreach".
    const theme = CIRCUIT_THEMES.palmreach;
    const decorKeys = new Set((PALMREACH_PROPS.decorProps ?? []).map((prop) => prop.key));
    const propsSource = readFileSync(new URL('../src/render/props.ts', import.meta.url), 'utf8');
    const builderPlaces = (section: string, key: string): boolean => {
      const start = propsSource.indexOf(`  // ---- ${section}`);
      const end = propsSource.indexOf('  // ---- ', start + 1);
      return start >= 0 && propsSource.slice(start, end).includes(`'${key}'`);
    };
    // The village's houses draw from one pool, keyed per building: the two
    // members a circuit can seat (house2 carries a yaw correction) are offered.
    const housePool = /const HOUSE_POOL: PropKey\[\] = \[([^\]]*)\]/.exec(propsSource)?.[1] ?? '';
    const houses = (PALMREACH_PROPS.buildings ?? []).filter((b) => b.kind === 'house');
    const jungleSource = readFileSync(
      new URL('../src/render/jungle_features.ts', import.meta.url),
      'utf8',
    );
    const foliageSource = readFileSync(
      new URL('../src/render/foliage.ts', import.meta.url),
      'utf8',
    );
    /** The catalog pieces the zone places itself, each with WHERE it does. */
    const PLACED_BY_THE_ZONE: Record<string, () => boolean> = {
      lampPalmreachTotem: () => STREETLAMP_STYLE_BY_ZONE.palmreach === 'palmreach_totem',
      inn: () => (PALMREACH_PROPS.buildings ?? []).some((b) => b.kind === 'inn'),
      house1: () => houses.length > 0 && housePool.includes("'house1'"),
      blacksmith: () => houses.length > 0 && housePool.includes("'blacksmith'"),
      well: () => PALMREACH_PROPS.wells.length > 0 && builderPlaces('wells', 'well'),
      bonfire: () => PALMREACH_PROPS.campfires.length > 0 && builderPlaces('campfires', 'bonfire'),
      crateWooden: () =>
        PALMREACH_PROPS.crates.length > 0 && builderPlaces('crates', 'crateWooden'),
      barrel: () => PALMREACH_PROPS.crates.length > 0 && builderPlaces('crates', 'barrel'),
      dockPlatform: () =>
        PALMREACH_PROPS.docks.length > 0 && builderPlaces('fishing docks', 'dockPlatform'),
      rowboat: () => decorKeys.has('rowboat'),
      mushroomRed: () =>
        PALMREACH_PROPS.mudHuts.length > 0 && builderPlaces('murloc mud huts', 'mushroomRed'),
      mushroomTan: () =>
        PALMREACH_PROPS.mudHuts.length > 0 && builderPlaces('murloc mud huts', 'mushroomTan'),
      column: () => PALMREACH_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'column'),
      columnBroken: () =>
        PALMREACH_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'columnBroken'),
      statueHead: () =>
        PALMREACH_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'statueHead'),
      statueBlock: () =>
        PALMREACH_PROPS.ruinRings.length > 0 && builderPlaces('ruin rings', 'statueBlock'),
      // The banyans: the zone raises the very elder model at its greatTrees spots.
      greatTree: () =>
        (PALMREACH_PROPS.greatTrees ?? []).length > 0 &&
        jungleSource.includes(`GREAT_TREE_URL = '${PROP_ASSET_DEFS.greatTree.url}'`),
      // The broadleaf canopy: an oak model the foliage grows, tinted for the jungle.
      oak: () =>
        /^\/models\/foliage\/oak_[1-5]\.glb$/.test(PROP_ASSET_DEFS.oakTree.url) &&
        /jungle: 0x[0-9a-f]{6}, \/\/ lush broadleaf canopy/.test(foliageSource),
      // The lily rafts the zone floats on its lakes are that very model.
      lilyRaft: () =>
        PALMREACH_ZONE.lakes.length > 0 &&
        PROP_ASSET_DEFS.fenLilies.url === JUNGLE_PROP_URLS.lilies,
      // The rim: the zone's lakes are ringed with reeds.
      reeds: () => PALMREACH_ZONE.lakes.length > 0 && theme.reedUrl !== null,
    };
    const jungleUrls = new Set<string>([...JUNGLE_PALM_URLS, JUNGLE_PROP_URLS.coconuts]);

    it('offers only pieces the zone draws, each through a route that shares its material', () => {
      let strand = 0;
      for (const key of theme.props) {
        const visual = MORTAR_OVERDRIVE_PROP_VISUALS[key];
        expect(visual, key).toBeDefined();
        if (visual.kind === 'gltf' && jungleUrls.has(visual.url)) {
          // The jungle build's own parse, drawn raw as jungle_features draws it.
          expect(mortarOverdriveDressingRoute(visual.url), key).toBe('worldRaw');
          strand++;
          continue;
        }
        const placed = PLACED_BY_THE_ZONE[key];
        expect(placed, `${key} is offered with no evidence the zone places it`).toBeDefined();
        expect(placed?.(), key).toBe(true);
      }
      // The three palms and the coconuts carry the strand; all four are offered.
      expect(strand).toBe(4);
      // ...and every piece the evidence table names is offered, so the table
      // cannot quietly outgrow the vocabulary it vouches for.
      for (const key of Object.keys(PLACED_BY_THE_ZONE)) {
        expect(theme.props.includes(key), key).toBe(true);
      }
    });

    it('dresses the shipped Lagoon Run from the zone own vocabulary, one banner of its own', () => {
      // The one shipped Palmreach circuit places only what this theme offers and
      // walls with nothing: its edge is the island's own shore.
      const lagoon = MORTAR_OVERDRIVE_CIRCUIT_LIST.find((c) => c.id === 'palmreach_lagoon_run');
      if (!lagoon) throw new Error('the Lagoon Run ships');
      const offered = new Set(theme.props);
      for (const prop of lagoon.props ?? []) {
        expect(offered.has(prop.asset), prop.asset).toBe(true);
      }
      expect(lagoon.fences ?? []).toEqual([]);
      expect(lagoon.groundOutline?.length ?? 0).toBeGreaterThan(0);
      // What racing it fetches that no other shipped circuit does: the green
      // grid banner, and nothing else (the arch and the rim reed are shared).
      const lane = new Set(mortarOverdriveCircuitKitUrls(lagoon));
      const others = new Set(
        MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.id !== lagoon.id).flatMap((c) =>
          themeUrls(c.theme),
        ),
      );
      const added = themeUrls('palmreach').filter((url) => !others.has(url));
      expect(added).toEqual([theme.startFixture.bannerUrl]);
      for (const url of added) expect(lane.has(url), url).toBe(true);
    });

    it('walls with timber rails, because the zone itself lays no wall at all', () => {
      expect(PALMREACH_PROPS.fences).toEqual([]);
      expect(theme.barriers).toEqual(['paddockRail', 'woodPaling']);
    });

    it('takes its kerb and grid from the zone sand and the lagoon water', () => {
      expect(theme.kerb.base).toBe(BIOME_PALETTE.jungle.sand);
      expect(theme.kerb.stripe).toBe(SHALLOW_COLOR.getHex());
      expect(theme.startGrid.light).toBe(BIOME_PALETTE.jungle.sand);
    });

    it('flies the jungle dome under the zone own haze, over the world own water', () => {
      expect(theme.ground).toBe('jungle');
      expect(theme.sky.biome).toBe('jungle');
      const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
      const fog = /\bjungle: \{ color: (0x[0-9a-f]{6}), near:/.exec(renderer);
      expect(fog, 'the jungle row of BIOME_FOG').not.toBeNull();
      expect(theme.sky.fog.color).toBe(Number(fog?.[1]));
      // The Sapphire Lagoon is the world's own water, so no ramp of its own.
      expect(theme.water).toBeUndefined();
    });
  });
});
