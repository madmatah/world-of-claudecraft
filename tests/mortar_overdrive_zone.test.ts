// Which world zone a Mortar Overdrive circuit reads as (src/sim/mortar_overdrive/zone.ts).
//
// The band sits on the instance plane, where the overworld lookup answers a
// lane with whichever zone band its z shares: before this resolver the
// Palmreach Lagoon Run's minimap read The Drakelands. Every shipped lane must
// read its circuit's own zone, and the points the band holds between and past
// lanes fall back to the default theme's zone rather than to a stray realm.

import { afterEach, describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_DEFAULT_THEME_ID,
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
  MORTAR_OVERDRIVE_THEME_IDS,
} from '../src/sim/content/mortar_overdrive/circuits';
import { DUNGEONS, instanceOrigin, ZONES, zoneAt } from '../src/sim/data';
import {
  clearMortarOverdriveDraftCircuits,
  putMortarOverdriveDraftCircuit,
} from '../src/sim/mortar_overdrive/draft_registry';
import {
  MORTAR_OVERDRIVE_BAND_X_MAX,
  MORTAR_OVERDRIVE_BAND_X_MIN,
  MORTAR_OVERDRIVE_LANE_DZ,
  MORTAR_OVERDRIVE_LANES,
  MORTAR_OVERDRIVE_ORIGIN,
  mortarOverdriveLaneOrigin,
  mortarOverdrivePublicLane,
} from '../src/sim/mortar_overdrive/layout';
import { mortarOverdriveThemeZone, mortarOverdriveZoneAt } from '../src/sim/mortar_overdrive/zone';

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
  const lane = MORTAR_OVERDRIVE_LANES[index];
  const origin = mortarOverdriveLaneOrigin(index);
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

describe('mortarOverdriveZoneAt: a circuit lane reads its own zone', () => {
  it('names every shipped circuit in the table above', () => {
    expect(new Set(MORTAR_OVERDRIVE_LANES.map((lane) => lane.circuit.id))).toEqual(
      new Set(Object.keys(CIRCUIT_ZONE)),
    );
  });

  it.each(MORTAR_OVERDRIVE_LANES.map((lane) => [lane.index, lane.circuit.id] as const))(
    'lane %i (%s) reads its circuit zone across its whole region',
    (index, circuitId) => {
      const expected = zoneById(CIRCUIT_ZONE[circuitId]);
      expect(expected, circuitId).toBeDefined();
      for (const point of lanePoints(index)) {
        // The ZoneDef itself, so a consumer can read its pois and bounds too.
        expect(mortarOverdriveZoneAt(point.x, point.z), `${point.x}, ${point.z}`).toBe(expected);
      }
    },
  );

  it('answers the lanes the overworld lookup got wrong', () => {
    // The two lanes the defect was found on: the band's z past the northmost
    // zone clamps onto The Drakelands, which is only right for the Rampart Run.
    const lagoon = MORTAR_OVERDRIVE_LANES.find((l) => l.circuit.id === 'palmreach_lagoon_run');
    const rampart = MORTAR_OVERDRIVE_LANES.find((l) => l.circuit.id === 'drakelands_rampart_run');
    if (!lagoon || !rampart) throw new Error('both late circuits ship a lane');
    const at = (index: number) => mortarOverdriveLaneOrigin(index);
    expect(zoneAt(at(lagoon.index).x, at(lagoon.index).z).id).toBe('drakelands');
    expect(mortarOverdriveZoneAt(at(lagoon.index).x, at(lagoon.index).z)?.id).toBe('palmreach');
    expect(mortarOverdriveZoneAt(at(rampart.index).x, at(rampart.index).z)?.id).toBe('drakelands');
    // ...and the six practice copies stop reading six different realms.
    const practice = MORTAR_OVERDRIVE_LANES.filter((lane) => lane.practice);
    expect(practice).toHaveLength(MORTAR_OVERDRIVE_PRACTICE_CIRCUIT.practiceCopies);
    const before = new Set(practice.map((l) => zoneAt(at(l.index).x, at(l.index).z).id));
    const after = new Set(
      practice.map((l) => mortarOverdriveZoneAt(at(l.index).x, at(l.index).z)?.id),
    );
    expect(before.size).toBeGreaterThan(1);
    expect(after).toEqual(new Set(['evergarden']));
  });
});

describe('mortarOverdriveZoneAt: the rest of the band, and off it', () => {
  afterEach(() => {
    clearMortarOverdriveDraftCircuits();
  });

  const DEFAULT_ZONE = mortarOverdriveThemeZone(MORTAR_OVERDRIVE_DEFAULT_THEME_ID);

  it('reads the default theme zone between two lanes and past the last one', () => {
    expect(DEFAULT_ZONE.id).toBe('evergarden');
    for (const lane of MORTAR_OVERDRIVE_LANES) {
      const between = MORTAR_OVERDRIVE_ORIGIN.z + (lane.index + 0.5) * MORTAR_OVERDRIVE_LANE_DZ;
      expect(
        mortarOverdriveZoneAt(MORTAR_OVERDRIVE_ORIGIN.x, between),
        `after lane ${lane.index}`,
      ).toBe(DEFAULT_ZONE);
    }
    // South of lane 0, and beside a lane but outside its region on x.
    expect(mortarOverdriveZoneAt(MORTAR_OVERDRIVE_ORIGIN.x, -MORTAR_OVERDRIVE_LANE_DZ)).toBe(
      DEFAULT_ZONE,
    );
    expect(mortarOverdriveZoneAt(MORTAR_OVERDRIVE_BAND_X_MIN, MORTAR_OVERDRIVE_ORIGIN.z)).toBe(
      DEFAULT_ZONE,
    );
    expect(mortarOverdriveZoneAt(MORTAR_OVERDRIVE_BAND_X_MAX, MORTAR_OVERDRIVE_ORIGIN.z)).toBe(
      DEFAULT_ZONE,
    );
  });

  it('answers null off the band, where the caller keeps its own lookup', () => {
    expect(mortarOverdriveZoneAt(0, 0)).toBeNull();
    expect(
      mortarOverdriveZoneAt(MORTAR_OVERDRIVE_BAND_X_MIN - 1, MORTAR_OVERDRIVE_ORIGIN.z),
    ).toBeNull();
    expect(
      mortarOverdriveZoneAt(MORTAR_OVERDRIVE_BAND_X_MAX + 1, MORTAR_OVERDRIVE_ORIGIN.z),
    ).toBeNull();
    for (const dungeon of Object.values(DUNGEONS)) {
      const origin = instanceOrigin(dungeon.index, 0);
      expect(mortarOverdriveZoneAt(origin.x, origin.z), dungeon.id).toBeNull();
    }
  });

  it('reads a draft lane by its own theme, and a lost draft as the space between lanes', () => {
    const draft = {
      ...MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
      id: 'zone_probe_draft',
      theme: 'nightbloom',
    };
    putMortarOverdriveDraftCircuit(draft);
    const lane = mortarOverdrivePublicLane(draft);
    expect(lane).toBeGreaterThanOrEqual(MORTAR_OVERDRIVE_LANES.length);
    const origin = mortarOverdriveLaneOrigin(lane);
    expect(mortarOverdriveZoneAt(origin.x, origin.z)?.id).toBe('nightbloom');
    // A theme no zone answers to wears the default, the way the renderer does.
    putMortarOverdriveDraftCircuit({ ...draft, theme: 'no_such_realm' });
    expect(mortarOverdriveZoneAt(origin.x, origin.z)).toBe(DEFAULT_ZONE);
    // A host with no record of the draft (the online client) reads empty band.
    clearMortarOverdriveDraftCircuits();
    expect(mortarOverdriveZoneAt(origin.x, origin.z)).toBe(DEFAULT_ZONE);
  });
});

describe('mortarOverdriveThemeZone: one zone per theme', () => {
  it('resolves every theme id to a distinct world zone', () => {
    const zones = MORTAR_OVERDRIVE_THEME_IDS.map((id) => mortarOverdriveThemeZone(id));
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(MORTAR_OVERDRIVE_THEME_IDS.length);
    for (const zone of zones) expect(ZONES).toContain(zone);
    expect(mortarOverdriveThemeZone('eastbrook').id).toBe('eastbrook_vale');
    expect(mortarOverdriveThemeZone('farshore').id).toBe('farshore_isle');
    expect(mortarOverdriveThemeZone('veiled_hollow').id).toBe('veiled_hollow');
  });

  it('falls back to the default theme zone for an unknown id', () => {
    expect(mortarOverdriveThemeZone('')).toBe(
      mortarOverdriveThemeZone(MORTAR_OVERDRIVE_DEFAULT_THEME_ID),
    );
    expect(mortarOverdriveThemeZone('proving_shore').id).toBe('evergarden');
  });
});
