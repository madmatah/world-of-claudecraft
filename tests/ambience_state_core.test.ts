import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sfx } from '../src/game/sfx';
import {
  type AmbienceState,
  biomePrecipitation,
  createAmbienceState,
  sampleAmbienceInto,
} from '../src/render/ambience_state_core';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
  MORTAR_OVERDRIVE_THEME_IDS,
} from '../src/sim/content/mortar_overdrive/circuits';
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
  clearMortarOverdriveDraftCircuits,
  putMortarOverdriveDraftCircuit,
} from '../src/sim/mortar_overdrive/draft_registry';
import {
  MORTAR_OVERDRIVE_LANE_DZ,
  MORTAR_OVERDRIVE_LANES,
  MORTAR_OVERDRIVE_ORIGIN,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOrigin,
  mortarOverdrivePublicLane,
} from '../src/sim/mortar_overdrive/layout';
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
      expect(s.precip).toBe(biomePrecipitation(zoneBiomeAt(x, z), inDungeon, true));
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
// whole visit a dungeon and played amb_dungeon under the race music. By the
// developer's listening test a circuit plays no bed at all, from the lobby to
// the results: its music, engines and effects are the whole mix.
describe('ambience on a Mortar Overdrive circuit', () => {
  const SEED = 1234;

  afterEach(() => {
    clearMortarOverdriveDraftCircuits();
  });

  const sampleAt = (x: number, z: number): AmbienceState =>
    sampleAmbienceInto(createAmbienceState(), x, z, SEED, true);

  function draftLaneOrigin(theme: string): { x: number; z: number } {
    const draft = { ...MORTAR_OVERDRIVE_PRACTICE_CIRCUIT, id: `ambience_probe_${theme}`, theme };
    putMortarOverdriveDraftCircuit(draft);
    return mortarOverdriveLaneOrigin(mortarOverdrivePublicLane(draft));
  }

  // The centre and two opposite corners of a lane's region.
  function lanePoints(index: number): { x: number; z: number }[] {
    const lane = MORTAR_OVERDRIVE_LANES[index] ?? null;
    const origin = mortarOverdriveLaneOrigin(index);
    const hx = (lane?.circuit.regionHalfX ?? 1) - 1;
    const hz = (lane?.circuit.regionHalfZ ?? 1) - 1;
    return [
      { x: origin.x, z: origin.z },
      { x: origin.x + hx, z: origin.z + hz },
      { x: origin.x - hx, z: origin.z - hz },
    ];
  }

  // Every instance the band sits beside, and the empty band between two lanes.
  const instancePoints = (): { x: number; z: number }[] => [
    ...Object.values(DUNGEONS).map((dungeon) => instanceOrigin(dungeon.index, 0)),
    arenaOrigin(0),
    delveOrigin(0, 0),
    riftOriginAt(0),
    bgOriginAt(0),
    { x: MORTAR_OVERDRIVE_ORIGIN.x, z: MORTAR_OVERDRIVE_ORIGIN.z + MORTAR_OVERDRIVE_LANE_DZ / 2 },
  ];

  it('samples every authored lane as nowhere a bed plays', () => {
    // Every lane, practice copies included: the Express Tour, the Moonspring
    // Run and each Evergarden practice copy.
    const ids = new Set(MORTAR_OVERDRIVE_LANES.map((lane) => lane.circuit.id));
    for (const id of [
      'evergarden_practice',
      'evergarden_express_tour',
      'nightbloom_moonwell_run',
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
    expect(MORTAR_OVERDRIVE_LANES.some((lane) => lane.practice)).toBe(true);
    for (const lane of MORTAR_OVERDRIVE_LANES) {
      for (const point of lanePoints(lane.index)) {
        expect(mortarOverdriveLaneAt(point.x, point.z)?.index).toBe(lane.index);
        expect(sampleAt(point.x, point.z), `${lane.circuit.id} lane ${lane.index}`).toEqual({
          inDungeon: false,
          biome: null,
          precip: null,
          nearWater: false,
        });
      }
    }
  });

  it('keeps every other instance, and the empty band between lanes, on the dungeon bed', () => {
    for (const point of instancePoints()) {
      expect(mortarOverdriveLaneAt(point.x, point.z)).toBeNull();
      const s = sampleAt(point.x, point.z);
      expect(s.inDungeon, JSON.stringify(point)).toBe(true);
      expect(s.biome).toBe(zoneBiomeAt(point.x, point.z));
      expect(s.precip).toBeNull();
      expect(s.nearWater).toBe(false);
    }
  });

  describe('what the audio engine plays from the sample', () => {
    type BedSink = { ambient(key: string, target: number): void };

    // Named as literals so a bed the engine stops driving fails here, and
    // checked against the engine's own calls so a bed it starts driving is
    // held to the same rule without an edit to this list.
    const GLOBAL_BEDS = [
      'amb_dungeon',
      'amb_crowd',
      'amb_wind_vale',
      'amb_birds',
      'amb_wind_marsh',
      'amb_wind_peaks',
      'amb_rain',
      'amb_snow',
      'amb_water',
    ];

    // The engine's bed decision, read at its one seam: every global bed goes
    // through ambient(key, target) once per ambience() call. The arguments are
    // the renderer's own call, pinned below.
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

    function expectSilent(beds: Map<string, number>, where: string): void {
      expect([...beds.keys()].sort(), where).toEqual([...GLOBAL_BEDS].sort());
      for (const [key, target] of beds) expect(target, `${where} ${key}`).toBe(0);
    }

    function bedsAtHubOf(zoneId: string): Map<string, number> {
      const hub = ZONES.find((zone) => zone.id === zoneId)?.hub;
      expect(hub, zoneId).toBeDefined();
      return bedsFor(sampleAt(hub?.x ?? 0, hub?.z ?? 0));
    }

    it('replays exactly what the renderer hands the audio sink', () => {
      const renderer = readFileSync(path.join(__dirname, '..', 'src/render/renderer.ts'), 'utf8');
      expect(renderer).toContain(
        'sink.ambience(amb.biome, amb.inDungeon, amb.precip, amb.nearWater, 0, points);',
      );
    });

    it('plays no bed on any authored lane, the dungeon bed included', () => {
      for (const lane of MORTAR_OVERDRIVE_LANES) {
        for (const point of lanePoints(lane.index)) {
          expectSilent(
            bedsFor(sampleAt(point.x, point.z)),
            `${lane.circuit.id} lane ${lane.index}`,
          );
        }
      }
    });

    it('plays no bed on a draft circuit, whatever theme it wears', () => {
      // A rain realm, a shore isle, the dungeon-dark hollow and a typo: the
      // theme dresses the circuit and never reaches the mix.
      for (const theme of [...MORTAR_OVERDRIVE_THEME_IDS, 'no_such_theme']) {
        const origin = draftLaneOrigin(theme);
        expectSilent(bedsFor(sampleAt(origin.x, origin.z)), theme);
      }
    });

    it('still plays the dungeon bed alone in a dungeon, delve, rift, arena, battleground and between lanes', () => {
      for (const point of instancePoints()) {
        const where = JSON.stringify(point);
        const beds = bedsFor(sampleAt(point.x, point.z));
        expect([...beds.keys()].sort(), where).toEqual([...GLOBAL_BEDS].sort());
        for (const [key, target] of beds) {
          expect(target, `${where} ${key}`).toBe(key === 'amb_dungeon' ? 0.3 : 0);
        }
      }
    });

    it('still plays each zone its own outdoor beds', () => {
      const evergarden = bedsAtHubOf('evergarden');
      expect(evergarden.get('amb_dungeon')).toBe(0);
      expect(evergarden.get('amb_birds')).toBe(0.12);
      expect(evergarden.get('amb_wind_marsh')).toBe(0.07);
      const nightbloom = bedsAtHubOf('nightbloom');
      expect(nightbloom.get('amb_dungeon')).toBe(0);
      expect(nightbloom.get('amb_birds')).toBe(0);
      expect(nightbloom.get('amb_wind_marsh')).toBe(0.06);
    });
  });
});
