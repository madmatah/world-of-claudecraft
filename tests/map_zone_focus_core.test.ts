import { describe, expect, it } from 'vitest';
import { REALM_RACERS_LANES, realmRacersLaneOrigin } from '../src/sim/realm_racers_layout';
import type { ZoneDef } from '../src/sim/types';
import { resolveMapZone } from '../src/ui/hud/map/map_zone_focus_core';

const zone = (id: string): ZoneDef => ({ id }) as unknown as ZoneDef;
const zones = [zone('eastbrook_vale'), zone('mirefen_marsh'), zone('frostveil')];
const lookup = (dungeonDoor: { x: number; z: number } | null = null) => ({
  zones,
  zoneAt: (x: number, _z: number) => (x < 0 ? zones[0] : zones[1]),
  dungeonAt: () => (dungeonDoor ? { doorPos: dungeonDoor } : null),
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
    // is wherever the pilot queued from; the circuit names its own zone.
    const lane = REALM_RACERS_LANES.find((l) => l.circuit.id === 'palmreach_lagoon_run');
    if (!lane) throw new Error('expected the Lagoon Run lane');
    const origin = realmRacersLaneOrigin(lane.index);
    expect(resolveMapZone(null, 'frostveil', origin, lookup()).id).toBe('palmreach');
    const practice = realmRacersLaneOrigin(REALM_RACERS_LANES.find((l) => l.practice)?.index ?? 0);
    expect(resolveMapZone(null, 'frostveil', practice, lookup()).id).toBe('evergarden');
    // An atlas pick still wins there, as it does everywhere else.
    expect(resolveMapZone('mirefen_marsh', 'frostveil', origin, lookup()).id).toBe('mirefen_marsh');
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
