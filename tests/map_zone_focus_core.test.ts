import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { REALM_RACERS_LANES, realmRacersLaneOrigin } from '../src/sim/realm_racers_layout';
import type { ZoneDef } from '../src/sim/types';
import { resolveMapZone } from '../src/ui/hud/map/map_zone_focus_core';
import { MAP_ZONE_LOOKUP } from '../src/ui/hud/map/map_zone_focus_lookup';

const zone = (id: string): ZoneDef => ({ id }) as unknown as ZoneDef;
const zones = [zone('eastbrook_vale'), zone('mirefen_marsh'), zone('frostveil'), zone('palmreach')];
/** A stub band: x at or past 9_000 is a circuit whose zone is `circuitZone`. */
const CIRCUIT_X = 9_000;
const lookup = (
  dungeonDoor: { x: number; z: number } | null = null,
  circuitZone: string | null = null,
) => ({
  zones,
  zoneAt: (x: number, _z: number) => (x < 0 ? zones[0] : zones[1]),
  dungeonAt: () => (dungeonDoor ? { doorPos: dungeonDoor } : null),
  realmRacersZoneAt: (x: number, _z: number) =>
    circuitZone !== null && x >= CIRCUIT_X ? { id: circuitZone } : null,
});

describe('resolveMapZone', () => {
  it('outdoors follows the committed zone, never the raw position', () => {
    expect(resolveMapZone(null, 'frostveil', { x: -5, z: 0 }, lookup()).id).toBe('frostveil');
  });

  it('falls back to the zone under the player when the committed id is unknown', () => {
    expect(resolveMapZone(null, 'retired_zone', { x: 10, z: 0 }, lookup()).id).toBe(
      'mirefen_marsh',
    );
  });

  it('inside a dungeon frames the zone its door stands in', () => {
    const at = resolveMapZone(null, 'frostveil', { x: 9_000, z: 0 }, lookup({ x: -1, z: 0 }));
    expect(at.id).toBe('eastbrook_vale');
  });

  it('on a Realm Racers circuit frames the zone the circuit belongs to, not the frozen one', () => {
    // The zone tracker freezes past the instance threshold, so the committed id
    // is wherever the pilot queued from; the circuit names its own zone, and
    // the zone comes out of the bag's own table.
    const at = { x: CIRCUIT_X, z: 0 };
    const framed = resolveMapZone(null, 'frostveil', at, lookup(null, 'palmreach'));
    expect(framed).toBe(zones[3]);
    // An atlas pick still wins there, as it does everywhere else.
    expect(resolveMapZone('mirefen_marsh', 'frostveil', at, lookup(null, 'palmreach')).id).toBe(
      'mirefen_marsh',
    );
    // A dungeon door is asked first (the bands never overlap in the world).
    expect(resolveMapZone(null, 'frostveil', at, lookup({ x: -1, z: 0 }, 'palmreach')).id).toBe(
      'eastbrook_vale',
    );
    // A circuit zone the table does not hold falls through to the frozen zone.
    expect(resolveMapZone(null, 'frostveil', at, lookup(null, 'nowhere')).id).toBe('frostveil');
  });

  it('binds the live lookups: a real lane frames its circuit zone out of ZONES', () => {
    const lane = REALM_RACERS_LANES.find((l) => l.circuit.id === 'palmreach_lagoon_run');
    if (!lane) throw new Error('expected the Lagoon Run lane');
    const origin = realmRacersLaneOrigin(lane.index);
    const lagoon = resolveMapZone(null, 'frostveil', origin, MAP_ZONE_LOOKUP);
    expect(lagoon).toBe(ZONES.find((z) => z.id === 'palmreach'));
    const practice = realmRacersLaneOrigin(REALM_RACERS_LANES.find((l) => l.practice)?.index ?? 0);
    expect(resolveMapZone(null, 'frostveil', practice, MAP_ZONE_LOOKUP).id).toBe('evergarden');
    // Off the band the live binding keeps the committed zone.
    expect(resolveMapZone(null, 'frostveil', { x: 0, z: 0 }, MAP_ZONE_LOOKUP).id).toBe('frostveil');
  });

  it('an override wins over the dungeon and the committed zone, and degrades to the position if stale', () => {
    const forced = resolveMapZone(
      'mirefen_marsh',
      'frostveil',
      { x: 9_000, z: 0 },
      lookup({ x: -1, z: 0 }),
    );
    expect(forced.id).toBe('mirefen_marsh');
    expect(resolveMapZone('gone', 'frostveil', { x: -1, z: 0 }, lookup()).id).toBe(
      'eastbrook_vale',
    );
  });
});
