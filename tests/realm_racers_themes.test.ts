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
import { REALM_DAYNIGHT_AMPLITUDE } from '../src/render/day_night_core';
import {
  REALM_RACERS_BARRIER_BOOT_URLS,
  REALM_RACERS_BARRIER_VISUALS,
} from '../src/render/realm_racers_barrier_visuals';
import {
  CIRCUIT_THEMES,
  REALM_RACERS_THEME_ASSET_URLS,
  rallySkyDayNightBiome,
  realmRacersTheme,
  realmRacersThemeAt,
} from '../src/render/realm_racers_themes';
import { realmRacersPreloadInternalsForTest } from '../src/render/realm_racers_track';
import { rallyBorderFlowerSpots } from '../src/render/realm_racers_track_core';
import { DEEP_COLOR, SHALLOW_COLOR } from '../src/render/water_surface_material';
import { REALM_RACERS_BARRIERS } from '../src/sim/content/realm_racers_barriers';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_DEFAULT_THEME_ID,
  REALM_RACERS_THEME_IDS,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../src/sim/content/realm_racers_props';
import { ZONES } from '../src/sim/data';
import {
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_ORIGIN, realmRacersLaneOffset } from '../src/sim/realm_racers_layout';

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
    // The pickup boxes wear the world's own quest-object sparkle.
    sparkleTexture: vi.fn(texture),
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

/** Every model url a theme names, whatever the shape of the piece naming it. */
function themeUrls(themeId: string): string[] {
  const theme = CIRCUIT_THEMES[themeId];
  return [theme.startFixture.archUrl, theme.startFixture.bannerUrl, theme.reedUrl];
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

    it('names only models the client actually has', () => {
      for (const url of themeUrls(themeId)) {
        // On disk and hashed into the media manifest. A theme nothing ships
        // yet is exactly the case where a url typed one letter wrong would go
        // unnoticed, so this is held for EVERY record rather than the worn
        // ones: an unresolvable model draws nothing at all rather than
        // failing, on a route (the editor preview, `/dev rallydraft`) whose
        // whole job is to look at a theme before a circuit wears it.
        expect(MEDIA_ASSETS[url.replace(/^\//, '')], url).toBeDefined();
      }
      // ...and it is the SET the manifest guard walks, so a record naming a
      // file outside it is out of that guard's reach.
      expect(REALM_RACERS_THEME_ASSET_URLS).toEqual(expect.arrayContaining(themeUrls(themeId)));
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
      expect(theme.barriers.length).toBeGreaterThan(0);
      for (const kit of theme.barriers) {
        expect(REALM_RACERS_BARRIERS[kit], `${themeId} offers ${kit}`).toBeDefined();
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
      const shipped = CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID].sky.fog;
      expect(theme.sky.fog.near).toBe(shipped.near);
      expect(theme.sky.fog.far).toBe(shipped.far);
    });

    it('flies a dome the world has, and grades it off a realm the tables know', () => {
      // The DOME and the day/night GRADE are two questions, and this is the one
      // case that holds them apart. `sky.biome` is a `RallySkyKey`, so it may
      // name the Farshore's place-keyed dome, which is NOT a biome; the grade
      // tables are keyed by biome, so `renderer.ts` resolves it through
      // `rallySkyDayNightBiome` before indexing them.
      //
      // The amplitude arm is the one that matters: an undefined there is a NaN
      // sun angle rather than a crash, so a mis-keyed record would darken a
      // circuit and fail nothing. Held for EVERY record rather than for the one
      // exception, since a fifteenth realm naming a fresh key is exactly the
      // case that would slip through a spot check.
      const graded = rallySkyDayNightBiome(theme.sky.biome);
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

  it('preloads the kit of every theme a shipped circuit wears, and no other', () => {
    // The boot lane is structure a circuit cannot draw late (the wall, the
    // arch, the grid banner), so what a raced circuit wears must be resident
    // before the lights. What is NOT in it is the point of this case: at one
    // theme per world zone the registry is fourteen kits, and preloading all
    // of them would pin about forty parsed scenes on a map that never clears,
    // for the whole session, for a player who may never race. An unworn
    // theme's wall takes the builder's fetch-and-fill arm instead.
    const lane = new Set(realmRacersPreloadInternalsForTest.assetUrls);
    const worn = new Set([
      REALM_RACERS_DEFAULT_THEME_ID,
      ...REALM_RACERS_CIRCUIT_LIST.map((circuit) => circuit.theme),
    ]);
    // Derived from the circuit list rather than listed, so the day a Frostveil
    // circuit ships, its wall joins the lane without anyone remembering to.
    //
    // The BARRIER boot list is in the expectation for the same reason and not
    // as a loosening: the lane has always opened with both, and that list was
    // empty for exactly as long as no shipped circuit authored a fence, so the
    // equality read as "theme urls only" while it was never saying that. The
    // first circuit to author a hedge is what tells the two apart.
    expect([...lane].sort()).toEqual(
      [
        ...new Set([
          ...[...worn].flatMap((themeId) => themeUrls(themeId)),
          ...REALM_RACERS_BARRIER_BOOT_URLS,
        ]),
      ].sort(),
    );
    for (const themeId of worn) {
      for (const url of themeUrls(themeId)) expect(lane, `${themeId} ${url}`).toContain(url);
    }
    // ...and the counter-example, stated positively: a theme written a zone
    // ahead of its circuit is out of the lane, wall and banner both.
    const unworn = Object.keys(CIRCUIT_THEMES).filter((id) => !worn.has(id));
    // Only a non-vacuity floor: the equality above already fixes the lane
    // exactly, so this exists so the loop under it registers cases at all.
    // Deliberately NOT a count near today's thirteen, which would go red the
    // day enough circuits ship to drain it, reporting success as a regression.
    expect(unworn.length).toBeGreaterThan(0);
    for (const themeId of unworn) {
      const theme = CIRCUIT_THEMES[themeId];
      expect(lane, `${themeId} banner`).not.toContain(theme.startFixture.bannerUrl);
    }
    // The whole reason for the scoping, stated against the thing it is scoped
    // FROM rather than against an absolute: the lane is strictly smaller than
    // the registry's own kit set. An absolute ceiling would have to be raised
    // every time a circuit ships, which is the one event that must not need a
    // test edit; this one holds until every realm has a circuit, and on that
    // day it is correct that scoping bought nothing.
    expect(lane.size).toBeLessThan(REALM_RACERS_THEME_ASSET_URLS.length);
  });

  it('sends the one place-keyed dome to the realm under it', () => {
    // The single non-identity branch in the whole seam, asserted on its own
    // rather than only through the records: the Farshore's dome is a place key
    // (`sky.ts` overrides the biome pick inside the isle's rect), and the realm
    // beneath it is the vale its ZoneDef sits in. Stated as a LITERAL, because
    // reading the answer back out of the record it is meant to check would pass
    // whatever the helper did.
    expect(rallySkyDayNightBiome('farshore')).toBe('vale');
    expect(ZONES.find((zone) => zone.id === 'farshore_isle')?.biome).toBe('vale');
    // ...and it touches nothing else: every biome key is its own answer.
    for (const biome of new Set(ZONES.map((zone) => zone.biome))) {
      expect(rallySkyDayNightBiome(biome), biome).toBe(biome);
    }
  });

  it('gives every world-map zone a theme, and every theme a zone', () => {
    // THE contract this registry exists for, held mechanically rather than by
    // review: a circuit drawn anywhere wears the art of the realm it is meant
    // to be in, so a fifteenth realm cannot ship without a record and a record
    // cannot name a realm the world does not have.
    //
    // Matched on the zone id with its article dropped, which is the naming
    // rule the ids are authored under (`thornpeak` for `thornpeak_heights`).
    const themeIdForZone = (zoneId: string): string =>
      zoneId.replace(/_(vale|marsh|heights|isle)$/, '');
    expect(ZONES.length).toBeGreaterThan(13);
    expect(ZONES.map((zone) => themeIdForZone(zone.id)).sort()).toEqual(
      [...REALM_RACERS_THEME_IDS].sort(),
    );
    // ...and each one paints its OWN realm's ground, which is the half an id
    // match cannot see: a record could carry the right name over the wrong
    // palette. The Farshore is the deliberate exception and is named here
    // rather than exempted quietly: its isle is a sand shore, so it takes the
    // `beach` paint rather than the `vale` its ZoneDef sits in, which is also
    // what leaves the vale free for Eastbrook under the unique-ground rule.
    for (const zone of ZONES) {
      const theme = CIRCUIT_THEMES[themeIdForZone(zone.id)];
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
      const offset = realmRacersLaneOffset(lane);
      return realmRacersThemeAt(REALM_RACERS_ORIGIN.x + offset.x, REALM_RACERS_ORIGIN.z + offset.z);
    });
    for (const theme of themes) expect(theme.sky.biome).toBe(themes[0].sky.biome);
    // ...and a point outside every lane still answers, because the fog arm
    // reads it unconditionally inside the band.
    expect(realmRacersThemeAt(0, 0)).toBe(CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID]);
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
        const indices = rallyBorderFlowerSpots(probeCircuit(id)).map((spot) => spot.colour);
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
      const garden = sown(REALM_RACERS_DEFAULT_THEME_ID);
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
      });

      it('asks for an unworn wall at build time, since the lane no longer holds it', async () => {
        // THE assumption the whole boot-lane scoping rests on, and the one
        // thing about it nothing else can see. Scoping the lane is only safe
        // because a theme no circuit wears still reaches the draw path, through
        // `instanceModel`'s fetch-and-fill arm; if that arm ever regressed (an
        // added must-be-preloaded assert, or the headless early return moving
        // above the fetch), thirteen themes would draw no wall, no arch and no
        // banner, and every other case here would stay green because none of
        // them can tell an unfetched model from an undrawn one.
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
          const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
          const themeId = 'frostveil';
          expect(REALM_RACERS_THEME_IDS).toContain(themeId);
          const theme = CIRCUIT_THEMES[themeId];
          // An authored BARRIER stands in for the wall this case was written
          // against: since the perimeter box stopped being drawn, a kit reaches
          // the draw path through the record rather than through the theme, and
          // a kit no shipped circuit wears is exactly what the fetch-and-fill
          // arm exists for.
          const kit = theme.barriers[0];
          const barrier = REALM_RACERS_BARRIER_VISUALS[kit];
          // Not in the lane, which is the precondition that makes the rest mean
          // something rather than restate it.
          expect(realmRacersPreloadInternalsForTest.assetUrls).not.toContain(barrier.panelUrl);
          buildRealmRacersTrack({
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
          // Structure, not dressing: the barrier and the grid banner are what
          // the lane used to guarantee.
          expect(asked, 'barrier').toContain(barrier.panelUrl);
          expect(asked, 'banner').toContain(theme.startFixture.bannerUrl);
        } finally {
          vi.unstubAllGlobals();
          vi.doUnmock('../src/render/assets/loader');
        }
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
