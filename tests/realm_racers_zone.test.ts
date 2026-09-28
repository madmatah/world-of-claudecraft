// Which world zone a Realm Racers circuit reads as (src/sim/realm_racers_zone.ts).
//
// The band sits on the instance plane, where the overworld lookup answers a
// lane with whichever zone band its z shares: before this resolver the
// Palmreach Lagoon Run's minimap read The Drakelands. Every shipped lane must
// read its circuit's own zone, and the points the band holds between and past
// lanes fall back to the default theme's zone rather than to a stray realm.

import { afterEach, describe, expect, it } from 'vitest';
import {
  REALM_RACERS_DEFAULT_THEME_ID,
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_THEME_IDS,
} from '../src/sim/content/realm_racers_circuits';
import { DUNGEONS, instanceOrigin, ZONES, zoneAt } from '../src/sim/data';
import {
  clearRealmRacersDraftCircuits,
  putRealmRacersDraftCircuit,
} from '../src/sim/realm_racers_draft_registry';
import {
  REALM_RACERS_BAND_X_MAX,
  REALM_RACERS_BAND_X_MIN,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneOrigin,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import { realmRacersThemeZone, realmRacersZoneAt } from '../src/sim/realm_racers_zone';

/** Every shipped circuit and the zone it belongs to, written out rather than
 *  derived so a new circuit has to say where it is. */
const CIRCUIT_ZONE: Record<string, string> = {
  evergarden_practice: 'evergarden',
  evergarden_express_tour: 'evergarden',
  nightbloom_moonwell_run: 'nightbloom',
  drakelands_rampart_run: 'drakelands',
  palmreach_lagoon_run: 'palmreach',
};

/** The centre and the four corners of a lane's region, one yard inside. */
function lanePoints(index: number): { x: number; z: number }[] {
  const lane = REALM_RACERS_LANES[index];
  const origin = realmRacersLaneOrigin(index);
  const hx = lane.circuit.regionHalfX - 1;
  const hz = lane.circuit.regionHalfZ - 1;
  return [
    { x: origin.x, z: origin.z },
    { x: origin.x + hx, z: origin.z + hz },
    { x: origin.x - hx, z: origin.z + hz },
    { x: origin.x + hx, z: origin.z - hz },
    { x: origin.x - hx, z: origin.z - hz },
  ];
}

const zoneById = (id: string) => ZONES.find((zone) => zone.id === id);

describe('realmRacersZoneAt: a circuit lane reads its own zone', () => {
  it('names every shipped circuit in the table above', () => {
    expect(new Set(REALM_RACERS_LANES.map((lane) => lane.circuit.id))).toEqual(
      new Set(Object.keys(CIRCUIT_ZONE)),
    );
  });

  it.each(REALM_RACERS_LANES.map((lane) => [lane.index, lane.circuit.id] as const))(
    'lane %i (%s) reads its circuit zone across its whole region',
    (index, circuitId) => {
      const expected = zoneById(CIRCUIT_ZONE[circuitId]);
      expect(expected, circuitId).toBeDefined();
      for (const point of lanePoints(index)) {
        // The ZoneDef itself, so a consumer can read its pois and bounds too.
        expect(realmRacersZoneAt(point.x, point.z), `${point.x}, ${point.z}`).toBe(expected);
      }
    },
  );

  it('answers the lanes the overworld lookup got wrong', () => {
    // The two lanes the defect was found on: the band's z past the northmost
    // zone clamps onto The Drakelands, which is only right for the Rampart Run.
    const lagoon = REALM_RACERS_LANES.find((l) => l.circuit.id === 'palmreach_lagoon_run');
    const rampart = REALM_RACERS_LANES.find((l) => l.circuit.id === 'drakelands_rampart_run');
    if (!lagoon || !rampart) throw new Error('both late circuits ship a lane');
    const at = (index: number) => realmRacersLaneOrigin(index);
    expect(zoneAt(at(lagoon.index).x, at(lagoon.index).z).id).toBe('drakelands');
    expect(realmRacersZoneAt(at(lagoon.index).x, at(lagoon.index).z)?.id).toBe('palmreach');
    expect(realmRacersZoneAt(at(rampart.index).x, at(rampart.index).z)?.id).toBe('drakelands');
    // ...and the six practice copies stop reading six different realms.
    const practice = REALM_RACERS_LANES.filter((lane) => lane.practice);
    expect(practice).toHaveLength(REALM_RACERS_PRACTICE_CIRCUIT.practiceCopies);
    const before = new Set(practice.map((l) => zoneAt(at(l.index).x, at(l.index).z).id));
    const after = new Set(practice.map((l) => realmRacersZoneAt(at(l.index).x, at(l.index).z)?.id));
    expect(before.size).toBeGreaterThan(1);
    expect(after).toEqual(new Set(['evergarden']));
  });
});

describe('realmRacersZoneAt: the rest of the band, and off it', () => {
  afterEach(() => {
    clearRealmRacersDraftCircuits();
  });

  const DEFAULT_ZONE = realmRacersThemeZone(REALM_RACERS_DEFAULT_THEME_ID);

  it('reads the default theme zone between two lanes and past the last one', () => {
    expect(DEFAULT_ZONE.id).toBe('evergarden');
    for (const lane of REALM_RACERS_LANES) {
      const between = REALM_RACERS_ORIGIN.z + (lane.index + 0.5) * REALM_RACERS_LANE_DZ;
      expect(realmRacersZoneAt(REALM_RACERS_ORIGIN.x, between), `after lane ${lane.index}`).toBe(
        DEFAULT_ZONE,
      );
    }
    // South of lane 0, and beside a lane but outside its region on x.
    expect(realmRacersZoneAt(REALM_RACERS_ORIGIN.x, -REALM_RACERS_LANE_DZ)).toBe(DEFAULT_ZONE);
    expect(realmRacersZoneAt(REALM_RACERS_BAND_X_MIN, REALM_RACERS_ORIGIN.z)).toBe(DEFAULT_ZONE);
    expect(realmRacersZoneAt(REALM_RACERS_BAND_X_MAX, REALM_RACERS_ORIGIN.z)).toBe(DEFAULT_ZONE);
  });

  it('answers null off the band, where the caller keeps its own lookup', () => {
    expect(realmRacersZoneAt(0, 0)).toBeNull();
    expect(realmRacersZoneAt(REALM_RACERS_BAND_X_MIN - 1, REALM_RACERS_ORIGIN.z)).toBeNull();
    expect(realmRacersZoneAt(REALM_RACERS_BAND_X_MAX + 1, REALM_RACERS_ORIGIN.z)).toBeNull();
    for (const dungeon of Object.values(DUNGEONS)) {
      const origin = instanceOrigin(dungeon.index, 0);
      expect(realmRacersZoneAt(origin.x, origin.z), dungeon.id).toBeNull();
    }
  });

  it('reads a draft lane by its own theme, and a lost draft as the space between lanes', () => {
    const draft = { ...REALM_RACERS_PRACTICE_CIRCUIT, id: 'zone_probe_draft', theme: 'nightbloom' };
    putRealmRacersDraftCircuit(draft);
    const lane = realmRacersPublicLane(draft);
    expect(lane).toBeGreaterThanOrEqual(REALM_RACERS_LANES.length);
    const origin = realmRacersLaneOrigin(lane);
    expect(realmRacersZoneAt(origin.x, origin.z)?.id).toBe('nightbloom');
    // A theme no zone answers to wears the default, the way the renderer does.
    putRealmRacersDraftCircuit({ ...draft, theme: 'no_such_realm' });
    expect(realmRacersZoneAt(origin.x, origin.z)).toBe(DEFAULT_ZONE);
    // A host with no record of the draft (the online client) reads empty band.
    clearRealmRacersDraftCircuits();
    expect(realmRacersZoneAt(origin.x, origin.z)).toBe(DEFAULT_ZONE);
  });
});

describe('realmRacersThemeZone: one zone per theme', () => {
  it('resolves every theme id to a distinct world zone', () => {
    const zones = REALM_RACERS_THEME_IDS.map((id) => realmRacersThemeZone(id));
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(REALM_RACERS_THEME_IDS.length);
    for (const zone of zones) expect(ZONES).toContain(zone);
    expect(realmRacersThemeZone('eastbrook').id).toBe('eastbrook_vale');
    expect(realmRacersThemeZone('farshore').id).toBe('farshore_isle');
    expect(realmRacersThemeZone('veiled_hollow').id).toBe('veiled_hollow');
  });

  it('falls back to the default theme zone for an unknown id', () => {
    expect(realmRacersThemeZone('')).toBe(realmRacersThemeZone(REALM_RACERS_DEFAULT_THEME_ID));
    expect(realmRacersThemeZone('proving_shore').id).toBe('evergarden');
  });
});
