import { afterEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import {
  type AmbienceState,
  biomePrecipitation,
  createAmbienceState,
  sampleAmbienceInto,
} from '../src/render/ambience_state_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_THEME_IDS,
  realmRacersThemeIdForZone,
} from '../src/sim/content/realm_racers_circuits';
import {
  arenaOrigin,
  bgOriginAt,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  delveOrigin,
  instanceOrigin,
  riftOriginAt,
  ZONES,
} from '../src/sim/data';
import {
  clearRealmRacersDraftCircuits,
  putRealmRacersDraftCircuit,
} from '../src/sim/realm_racers_draft_registry';
import {
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
  realmRacersLaneOrigin,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import type { BiomeId } from '../src/sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../src/sim/world';

describe('ambience_state_core', () => {
  it('maps each weathered biome to its precipitation', () => {
    expect(biomePrecipitation('peaks', false, true)).toBe('snow');
    expect(biomePrecipitation('frost', false, true)).toBe('snow');
    expect(biomePrecipitation('marsh', false, true)).toBe('rain');
    expect(biomePrecipitation('haunt', false, true)).toBe('rain');
    expect(biomePrecipitation('forest' as never, false, true)).toBeNull();
  });

  it('no precipitation with weather off or inside an instance', () => {
    expect(biomePrecipitation('peaks', false, false)).toBeNull();
    expect(biomePrecipitation('marsh', true, true)).toBeNull();
  });

  it('samples the same state the inline renderer code computed', () => {
    const seed = 1234;
    const out = createAmbienceState();
    for (const [x, z] of [
      [0, 0],
      [-281, 40],
      [150, -320],
      [DUNGEON_X_THRESHOLD + 50, 10],
    ]) {
      const s = sampleAmbienceInto(out, x, z, seed, true);
      expect(s).toBe(out); // refilled in place, no per-frame allocation
      const inDungeon = x > DUNGEON_X_THRESHOLD;
      expect(s.inDungeon).toBe(inDungeon);
      expect(s.biome).toBe(zoneBiomeAt(x, z));
      expect(s.precip).toBe(biomePrecipitation(s.biome, inDungeon, true));
      expect(s.nearWater).toBe(
        !inDungeon && groundHeight(x, z, seed) < waterLevelAt(x, z, seed) + 0.4,
      );
    }
  });

  it('never reports water inside an instance', () => {
    const s = sampleAmbienceInto(createAmbienceState(), DUNGEON_X_THRESHOLD + 5, 0, 1, true);
    expect(s.inDungeon).toBe(true);
    expect(s.nearWater).toBe(false);
  });
});

// A circuit stands on the flat instance plane, so the plain x test called the
// whole visit a dungeon: amb_dungeon under the race music and the outdoor beds
// off. A circuit is dressed as its zone, so it plays that zone's outdoors.
describe('ambience on a Realm Racers circuit', () => {
  const SEED = 1234;

  afterEach(() => {
    clearRealmRacersDraftCircuits();
  });

  // Stated as literals, so the pin cannot read its answer back out of the code
  // under test. A circuit on a theme missing here fails until it is added.
  const ZONE_BIOME_BY_THEME: Record<string, BiomeId> = {
    evergarden: 'garden',
    nightbloom: 'night',
  };

  const sampleAt = (x: number, z: number): AmbienceState =>
    sampleAmbienceInto(createAmbienceState(), x, z, SEED, true);

  function draftLaneOrigin(theme: string): { x: number; z: number } {
    const draft = { ...REALM_RACERS_PRACTICE_CIRCUIT, id: `ambience_probe_${theme}`, theme };
    putRealmRacersDraftCircuit(draft);
    return realmRacersLaneOrigin(realmRacersPublicLane(draft));
  }

  it('reads the literal zone table the pins below are written against', () => {
    expect(ZONES.find((zone) => zone.id === 'evergarden')?.biome).toBe('garden');
    expect(ZONES.find((zone) => zone.id === 'nightbloom')?.biome).toBe('night');
  });

  it('samples every authored lane as its circuit zone outdoors, never a dungeon', () => {
    // Every lane, practice copies included: the world under the band reads a
    // different zone per lane (vale, marsh, jungle, night, amber, ember), and
    // none of those is where the circuit is meant to be.
    for (const lane of REALM_RACERS_LANES) {
      const expected = ZONE_BIOME_BY_THEME[lane.circuit.theme];
      expect(expected, lane.circuit.theme).toBeDefined();
      const origin = realmRacersLaneOrigin(lane.index);
      const hx = lane.circuit.regionHalfX - 1;
      const hz = lane.circuit.regionHalfZ - 1;
      for (const [dx, dz] of [
        [0, 0],
        [hx, hz],
        [-hx, -hz],
      ]) {
        const s = sampleAt(origin.x + dx, origin.z + dz);
        expect(s.inDungeon, `${lane.circuit.id} lane ${lane.index}`).toBe(false);
        expect(s.biome, `${lane.circuit.id} lane ${lane.index}`).toBe(expected);
        // The band draws no weather, and world water knows nothing of a pond.
        expect(s.precip).toBeNull();
        expect(s.nearWater).toBe(false);
      }
    }
  });

  it('takes the zone biome over the ground tint, with no rain on the band', () => {
    // Farshore paints its lawn beach, but a player on the isle hears the vale.
    const farshore = draftLaneOrigin('farshore');
    expect(sampleAt(farshore.x, farshore.z)).toMatchObject({ inDungeon: false, biome: 'vale' });
    // Mirefen is a rain realm; the band draws no rain, so it plays none.
    const mirefen = draftLaneOrigin('mirefen');
    expect(sampleAt(mirefen.x, mirefen.z)).toMatchObject({
      inDungeon: false,
      biome: 'marsh',
      precip: null,
    });
    // An unknown theme wears the default theme's art, so it hears that zone.
    const typo = draftLaneOrigin('no_such_theme');
    expect(sampleAt(typo.x, typo.z)).toMatchObject({ inDungeon: false, biome: 'garden' });
  });

  it('resolves every theme a circuit may name to its own zone biome', () => {
    for (const theme of REALM_RACERS_THEME_IDS) {
      expect(ZONES.map((zone) => realmRacersThemeIdForZone(zone.id))).toContain(theme);
      // Derived independently of the helper: the zone id is the theme id, or
      // the theme id plus its dropped article.
      const zone = ZONES.find((z) => z.id === theme || z.id.startsWith(`${theme}_`));
      expect(zone, theme).toBeDefined();
      const origin = draftLaneOrigin(theme);
      expect(sampleAt(origin.x, origin.z).biome, theme).toBe(zone?.biome);
    }
  });

  it('keeps every other instance, and the empty band between lanes, on the dungeon bed', () => {
    const points: { x: number; z: number }[] = [
      ...Object.values(DUNGEONS).map((dungeon) => instanceOrigin(dungeon.index, 0)),
      arenaOrigin(0),
      delveOrigin(0, 0),
      riftOriginAt(0),
      bgOriginAt(0),
      { x: REALM_RACERS_ORIGIN.x, z: REALM_RACERS_ORIGIN.z + REALM_RACERS_LANE_DZ / 2 },
    ];
    for (const point of points) {
      expect(realmRacersLaneAt(point.x, point.z)).toBeNull();
      const s = sampleAt(point.x, point.z);
      expect(s.inDungeon, JSON.stringify(point)).toBe(true);
      expect(s.biome).toBe(zoneBiomeAt(point.x, point.z));
      expect(s.precip).toBeNull();
      expect(s.nearWater).toBe(false);
    }
  });

  describe('what the audio engine plays from the sample', () => {
    type BedSink = { ambient(key: string, target: number): void };

    // The engine's bed decision, read at its one seam: every global bed goes
    // through ambient(key, target) once per ambience() call.
    function bedsFor(sample: AmbienceState): Map<string, number> {
      const beds = new Map<string, number>();
      const spy = vi
        .spyOn(sfx as unknown as BedSink, 'ambient')
        .mockImplementation((key: string, target: number) => {
          beds.set(key, target);
        });
      try {
        sfx.ambience(sample.biome, sample.inDungeon, sample.precip, sample.nearWater, 0, []);
      } finally {
        spy.mockRestore();
      }
      return beds;
    }

    function bedsAtLaneOf(circuitId: string): Map<string, number> {
      const lane = REALM_RACERS_LANES.find((l) => l.circuit.id === circuitId);
      expect(lane, circuitId).toBeDefined();
      const origin = realmRacersLaneOrigin(lane?.index ?? -1);
      return bedsFor(sampleAt(origin.x, origin.z));
    }

    function bedsAtHubOf(zoneId: string): Map<string, number> {
      const hub = ZONES.find((zone) => zone.id === zoneId)?.hub;
      expect(hub, zoneId).toBeDefined();
      return bedsFor(sampleAt(hub?.x ?? 0, hub?.z ?? 0));
    }

    it('plays the Evergarden beds on an Evergarden circuit, and no dungeon bed', () => {
      for (const circuitId of ['evergarden_practice', 'evergarden_express_tour']) {
        const beds = bedsAtLaneOf(circuitId);
        expect(beds.get('amb_dungeon'), circuitId).toBe(0);
        expect(beds.get('amb_birds'), circuitId).toBe(0.12);
        expect(beds.get('amb_wind_marsh'), circuitId).toBe(0.07);
        // ...exactly what a player standing in the Evergarden itself hears.
        expect(beds, circuitId).toEqual(bedsAtHubOf('evergarden'));
      }
    });

    it('plays the Nightbloom beds on the Moonwell Run, and no dungeon bed', () => {
      const beds = bedsAtLaneOf('nightbloom_moonwell_run');
      expect(beds.get('amb_dungeon')).toBe(0);
      expect(beds.get('amb_birds')).toBe(0);
      expect(beds.get('amb_wind_marsh')).toBe(0.06);
      expect(beds).toEqual(bedsAtHubOf('nightbloom'));
    });

    it('still plays the dungeon bed inside a real dungeon', () => {
      const dungeon = Object.values(DUNGEONS)[0];
      const origin = instanceOrigin(dungeon.index, 0);
      const beds = bedsFor(sampleAt(origin.x, origin.z));
      expect(beds.get('amb_dungeon')).toBe(0.3);
      expect(beds.get('amb_birds')).toBe(0);
      expect(beds.get('amb_wind_marsh')).toBe(0);
    });
  });
});
