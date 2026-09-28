// The live world reads the overworld map's zone focus takes, bound once at
// module scope so Hud hands resolveMapZone the same bag on every redraw
// rather than allocating one per redraw.
import { dungeonAt, ZONES, zoneAt } from '../../../sim/data';
import { realmRacersZoneAt } from '../../../sim/realm_racers_zone';
import type { MapZoneFocusLookup } from './map_zone_focus_core';

export const MAP_ZONE_LOOKUP: MapZoneFocusLookup = {
  zones: ZONES,
  zoneAt,
  dungeonAt,
  realmRacersZoneAt,
};
