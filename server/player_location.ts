// Where an online character is, for every server surface that names it: the
// friend and guild rosters and /who (presenceOf), the Discord `!word` relay
// embed, and the admin live location. Host-free (no sessions, no sockets):
// game.ts hands in the entity and the session state these read.
//
// One zone rule serves them all (presenceZoneAt): a player on the Realm Racers
// band reads the zone of the circuit on that lane, the one the minimap shows,
// never the overworld band the lane's z happens to share. The band sits past
// DUNGEON_X_THRESHOLD but between the instance bands, so instanceZoneName
// answers null there and a racer keeps the plain overworld status ladder.
//
// presenceOf runs inside the /who realm readout (built once per tick) and on
// social location reads, so its zone lookups stay O(1) and allocation-free.

import {
  DELVES,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  delveAt,
  dungeonAt,
  isDelvePos,
  zoneAt,
} from '../src/sim/data';
import { realmRacersZoneAt } from '../src/sim/realm_racers_zone';
import type { AwayStatus } from '../src/sim/sim';
import type { DelveRun, Entity, Vec3, ZoneDef } from '../src/sim/types';
import type { Presence, PresenceStatus } from './social';
import { round2 } from './tick_perf_log';

const ADMIN_LOCATION_POI_RADIUS = 32;

interface PointXZ {
  readonly x: number;
  readonly z: number;
}

export interface AdminLiveLocation {
  kind: 'overworld' | 'dungeon' | 'delve';
  zoneId: string | null;
  zone: string;
  instanceId: string | null;
  instance: string | null;
  instanceSlot: number | null;
  poiIndex: number | null;
  poi: string | null;
  poiDistance: number | null;
}

/** The instance reads the admin live location needs; the Sim satisfies it. */
export interface LiveLocationHost {
  instanceInfoAt(pos: Vec3): { slot: number; dungeonId: string } | null;
  delveRunForPlayer(pid: number): Pick<DelveRun, 'delveId' | 'slot'> | null;
}

/** The world zone a position outside any instance reads as. */
export function presenceZoneAt(x: number, z: number): ZoneDef {
  return realmRacersZoneAt(x, z) ?? zoneAt(x, z);
}

// The instance (dungeon OR delve) an entity is inside, named as its own zone,
// or null when the entity is in the overworld (or an arena, which is not a
// dungeon). Resolved in order: an explicit dungeonId portal field, then a
// delve position, then any other far-off instance-space x as a dungeon. A
// failed lookup returns null so callers fall back to the overworld zone
// rather than ever surfacing a raw id. Callers pass a spectator's saved
// position so a spectating moderator reports where they really are, not the
// limbo they were parked in.
export function instanceZoneName(e: Pick<Entity, 'dungeonId'>, pos: PointXZ): string | null {
  if (e.dungeonId) return DUNGEONS[e.dungeonId]?.name ?? e.dungeonId;
  if (isDelvePos(pos.x)) return delveAt(pos.x)?.name ?? null;
  if (pos.x > DUNGEON_X_THRESHOLD) return dungeonAt(pos.x)?.name ?? null;
  return null;
}

// Live location + activity of an online character, for friend/guild rosters
// and /who. A player inside any instance (dungeon or delve) reports the
// instance name and the 'dungeon' status, not the overworld zone the instance
// coordinates happen to fall under.
export function presenceOf(
  e: Pick<Entity, 'dungeonId' | 'dead' | 'inCombat' | 'pos'> | undefined,
  away: AwayStatus | null | undefined,
  savedPos?: PointXZ,
): Presence {
  if (!e) return { zone: 'Unknown', status: 'online' };
  const pos = savedPos ?? e.pos;
  const instanceZone = instanceZoneName(e, pos);
  let status: PresenceStatus = 'online';
  if (e.dead) status = 'dead';
  else if (instanceZone != null) status = 'dungeon';
  else if (e.inCombat) status = 'combat';
  // AFK is the lowest-priority active state: a dead/instanced/in-combat player
  // reports that first, but an idle /afk player shows 'afk' over plain 'online'.
  else if (away?.mode === 'afk') status = 'afk';
  const zone = instanceZone ?? presenceZoneAt(pos.x, pos.z).name;
  return { zone, status, x: pos.x, z: pos.z };
}

/** Where the admin Online panel places a live player: the instance and the
 *  zone its door stands in, or the overworld zone and the nearest named POI. */
export function liveLocationFor(
  host: LiveLocationHost,
  e: Pick<Entity, 'id' | 'dungeonId' | 'pos'>,
): AdminLiveLocation {
  const instance = host.instanceInfoAt(e.pos);
  const dungeonId = e.dungeonId ?? instance?.dungeonId ?? null;
  if (dungeonId) {
    const dungeon = DUNGEONS[dungeonId];
    const zone = dungeon ? zoneAt(dungeon.doorPos.x, dungeon.doorPos.z) : zoneAt(e.pos.x, e.pos.z);
    return {
      kind: 'dungeon',
      zoneId: zone.id,
      zone: zone.name,
      instanceId: dungeonId,
      instance: dungeon?.name ?? dungeonId,
      instanceSlot: instance?.slot ?? null,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    };
  }

  const delveRun = host.delveRunForPlayer(e.id);
  if (delveRun) {
    const delve = DELVES[delveRun.delveId];
    const zone = delve ? zoneAt(delve.doorPos.x, delve.doorPos.z) : zoneAt(e.pos.x, e.pos.z);
    return {
      kind: 'delve',
      zoneId: zone.id,
      zone: zone.name,
      instanceId: delveRun.delveId,
      instance: delve?.name ?? delveRun.delveId,
      instanceSlot: delveRun.slot,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    };
  }

  const zone = presenceZoneAt(e.pos.x, e.pos.z);
  let bestIndex: number | null = null;
  let bestDistance = ADMIN_LOCATION_POI_RADIUS;
  for (let i = 0; i < zone.pois.length; i++) {
    const poi = zone.pois[i];
    const distance = Math.hypot(e.pos.x - poi.x, e.pos.z - poi.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  const poi = bestIndex === null ? null : zone.pois[bestIndex];
  return {
    kind: 'overworld',
    zoneId: zone.id,
    zone: zone.name,
    instanceId: null,
    instance: null,
    instanceSlot: null,
    poiIndex: bestIndex,
    poi: poi?.label ?? null,
    poiDistance: poi ? round2(bestDistance) : null,
  };
}
