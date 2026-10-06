// Where an online character is, as every server surface names it: the friend
// and guild rosters plus /who (presenceOf), the Discord `!word` relay embed,
// and the admin live location.
//
// The Mortar Overdrive band sits on the instance plane far east of the map, so the
// overworld lookup (`zoneAt`) answers a circuit lane with whichever zone band
// its z happens to share: a racer on the Palmreach Lagoon Run read The
// Drakelands on all three surfaces. Each surface must name the circuit's own
// zone instead, the one the minimap already shows.

vi.mock('../../server/db', () => ({
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  saveCharacterState: vi.fn(async () => {}),
  openPlaySession: vi.fn(async () => 1),
  touchCharacterLogin: vi.fn(async () => {}),
  closePlaySession: vi.fn(async () => {}),
  insertChatLogs: vi.fn(async () => {}),
  walletForAccount: vi.fn(async () => null),
  loadAccountFlair: vi.fn(async () => ({ ai: false, streamer: false, links: {} })),
  markAccountQuestComplete: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
  grantAccountMechChroma: vi.fn(async () => ({ completedQuestIds: [], mechChromaIds: [] })),
}));

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import { drainRelay } from '../../server/discord_relay';
import { type ClientSession, GameServer } from '../../server/game';
import {
  instanceZoneName,
  type LiveLocationHost,
  liveLocationFor,
  presenceOf,
  presenceZoneAt,
} from '../../server/player_location';
import type { Presence } from '../../server/social';
import type { WhoRosterRow } from '../../server/who_roster';
import {
  DELVES,
  DUNGEON_X_THRESHOLD,
  DUNGEONS,
  dungeonAt,
  isDelvePos,
  ZONES,
  zoneAt,
} from '../../src/sim/data';
import {
  MORTAR_OVERDRIVE_BAND_X_MAX,
  MORTAR_OVERDRIVE_BAND_X_MIN,
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneOrigin,
} from '../../src/sim/mortar_overdrive/layout';
import { mortarOverdriveThemeZone } from '../../src/sim/mortar_overdrive/zone';
import type { Entity, ZoneDef } from '../../src/sim/types';

// The lane the defect was found on: its z lies past the northmost zone band,
// which clamps onto The Drakelands, while the circuit is Palmreach's.
const LAGOON = (() => {
  const lane = MORTAR_OVERDRIVE_LANES.find((l) => l.circuit.id === 'palmreach_lagoon_run');
  if (!lane) throw new Error('the Palmreach Lagoon Run ships a lane');
  return lane;
})();
const LANE_POS = mortarOverdriveLaneOrigin(LAGOON.index);
const CIRCUIT_ZONE: ZoneDef = mortarOverdriveThemeZone(LAGOON.circuit.theme);
const OVERWORLD_ZONE: ZoneDef = zoneAt(LANE_POS.x, LANE_POS.z);

// The GameServer members the three surfaces read through.
interface LocationSurfaces {
  presenceOf(session: ClientSession): Presence;
  whoRosterFor(viewer: ClientSession): WhoRosterRow[];
  handleRelayCommand(session: ClientSession, text: string): boolean;
  liveSessions: GameServer['liveSessions'];
}

function serverWithPlayer(): {
  server: LocationSurfaces;
  session: ClientSession;
  entity: Entity;
} {
  const game = new GameServer();
  const ws = { readyState: 1, send: () => {} } as unknown as WebSocket;
  const session = game.join(ws, 7, 7, 'Racer', 'warrior', null);
  if ('error' in session) throw new Error(session.error);
  session.blockListLoaded = true;
  const entity = game.sim.entities.get(session.pid);
  if (!entity) throw new Error('the joined player has an entity');
  return { server: game as unknown as LocationSurfaces, session, entity };
}

function standOnLane(entity: Entity): void {
  entity.dungeonId = null;
  entity.pos.x = LANE_POS.x;
  entity.pos.z = LANE_POS.z;
}

describe('the fixture is decisive', () => {
  it('the overworld lookup names a different zone than the circuit at the lane', () => {
    expect(CIRCUIT_ZONE.id).toBe('palmreach');
    expect(OVERWORLD_ZONE.id).not.toBe(CIRCUIT_ZONE.id);
  });
});

describe('GameServer surfaces name a racer on a lane by the circuit zone', () => {
  beforeEach(() => {
    drainRelay();
  });

  it('presence (rosters and /who) reads the circuit zone, with no dungeon status', () => {
    const { server, session, entity } = serverWithPlayer();
    standOnLane(entity);
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe(CIRCUIT_ZONE.name);
    expect(presence.zone).not.toBe(OVERWORLD_ZONE.name);
    expect(presence.status).toBe('online');
    expect(presence.x).toBe(LANE_POS.x);
    expect(presence.z).toBe(LANE_POS.z);
  });

  it('presence off the band still reads the overworld zone', () => {
    const { server, session, entity } = serverWithPlayer();
    const presence = server.presenceOf(session);
    expect(presence.zone).toBe(zoneAt(entity.pos.x, entity.pos.z).name);
    expect(presence.status).toBe('online');
  });

  it('the /who roster row reads the circuit zone', () => {
    const { server, session, entity } = serverWithPlayer();
    standOnLane(entity);
    const rows = server.whoRosterFor(session);
    expect(rows.find((row) => row.name === 'Racer')?.zone).toBe(CIRCUIT_ZONE.name);
  });

  it('the Discord relay hands the bot the circuit zone', () => {
    const { server, session, entity } = serverWithPlayer();
    standOnLane(entity);
    expect(server.handleRelayCommand(session, '!lfg one more for the lagoon')).toBe(true);
    const [relay] = drainRelay();
    expect(relay?.zone).toBe(CIRCUIT_ZONE.name);
  });

  it('the Discord relay off the band still hands the bot the overworld zone', () => {
    const { server, session, entity } = serverWithPlayer();
    expect(server.handleRelayCommand(session, '!lfg anyone')).toBe(true);
    const [relay] = drainRelay();
    expect(relay?.zone).toBe(zoneAt(entity.pos.x, entity.pos.z).name);
  });

  it('the admin live location names the circuit zone, overworld kind, no POI', () => {
    const { server, entity } = serverWithPlayer();
    standOnLane(entity);
    const row = server.liveSessions().find((p) => p.characterId === 7);
    expect(row?.location).toMatchObject({
      kind: 'overworld',
      zoneId: CIRCUIT_ZONE.id,
      zone: CIRCUIT_ZONE.name,
      instanceId: null,
      instance: null,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    });
    expect(row?.zone).toBe(CIRCUIT_ZONE.name);
  });
});

describe('presenceZoneAt: the one zone rule', () => {
  it('reads the circuit zone on a lane and the overworld zone off the band', () => {
    expect(presenceZoneAt(LANE_POS.x, LANE_POS.z)).toBe(CIRCUIT_ZONE);
    const spawn = ZONES[0].pois[0];
    expect(presenceZoneAt(spawn.x, spawn.z)).toBe(zoneAt(spawn.x, spawn.z));
  });
});

describe('instanceZoneName on the Mortar Overdrive band', () => {
  it('answers null across the band: past the dungeon threshold but in no instance band', () => {
    const z = LANE_POS.z;
    for (const x of [MORTAR_OVERDRIVE_BAND_X_MIN, LANE_POS.x, MORTAR_OVERDRIVE_BAND_X_MAX]) {
      expect(x).toBeGreaterThan(DUNGEON_X_THRESHOLD);
      expect(isDelvePos(x), `delve at ${x}`).toBe(false);
      expect(dungeonAt(x), `dungeon at ${x}`).toBeNull();
      expect(instanceZoneName({ dungeonId: null }, { x, z }), `${x}`).toBeNull();
    }
  });

  it('still names a portal dungeon by the dungeonId field', () => {
    const crypt = DUNGEONS.hollow_crypt;
    expect(instanceZoneName({ dungeonId: crypt.id }, LANE_POS)).toBe(crypt.name);
  });
});

describe('presenceOf (pure)', () => {
  const racer = (over: Partial<{ dead: boolean; inCombat: boolean }> = {}) => ({
    dungeonId: null,
    dead: false,
    inCombat: false,
    pos: { x: LANE_POS.x, y: 0, z: LANE_POS.z },
    ...over,
  });

  it('names the circuit zone with the overworld status ladder intact', () => {
    expect(presenceOf(racer(), null)).toEqual({
      zone: CIRCUIT_ZONE.name,
      status: 'online',
      x: LANE_POS.x,
      z: LANE_POS.z,
    });
    expect(presenceOf(racer({ dead: true }), null).status).toBe('dead');
    expect(presenceOf(racer({ inCombat: true }), null).status).toBe('combat');
    expect(presenceOf(racer(), { mode: 'afk', message: '' }).status).toBe('afk');
    expect(presenceOf(racer(), { mode: 'dnd', message: '' }).status).toBe('online');
  });

  it('reads a spectator by the saved position, not the live one', () => {
    const parked = { ...racer(), pos: { x: 0, y: 0, z: 0 } };
    expect(presenceOf(parked, null, LANE_POS).zone).toBe(CIRCUIT_ZONE.name);
    const presence = presenceOf(racer(), null, { x: 0, z: 0 });
    expect(presence.zone).toBe(zoneAt(0, 0).name);
  });

  it('reports an unknown zone for a missing entity', () => {
    expect(presenceOf(undefined, null)).toEqual({ zone: 'Unknown', status: 'online' });
  });
});

describe('liveLocationFor (pure, behind a fake host)', () => {
  const noInstance: LiveLocationHost = {
    instanceInfoAt: () => null,
    delveRunForPlayer: () => null,
  };
  const at = (x: number, z: number) => ({ id: 1, dungeonId: null, pos: { x, y: 0, z } });

  it('names the circuit zone on a lane, where no POI of that zone is in reach', () => {
    expect(liveLocationFor(noInstance, at(LANE_POS.x, LANE_POS.z))).toEqual({
      kind: 'overworld',
      zoneId: CIRCUIT_ZONE.id,
      zone: CIRCUIT_ZONE.name,
      instanceId: null,
      instance: null,
      instanceSlot: null,
      poiIndex: null,
      poi: null,
      poiDistance: null,
    });
  });

  it('still finds the nearest overworld POI off the band', () => {
    const zone = ZONES.find(
      (z) => z.pois.length > 0 && presenceZoneAt(z.pois[0].x, z.pois[0].z) === z,
    );
    if (!zone) throw new Error('a zone holds a POI inside its own bounds');
    const poi = zone.pois[0];
    const location = liveLocationFor(noInstance, at(poi.x + 3, poi.z + 4));
    expect(location.kind).toBe('overworld');
    expect(location.zoneId).toBe(zone.id);
    expect(location.poi).not.toBeNull();
    expect(location.poiDistance).not.toBeNull();
    expect(location.poiDistance as number).toBeLessThanOrEqual(5);
  });

  it('keeps the dungeon and delve arms, named by their door zone', () => {
    const crypt = DUNGEONS.hollow_crypt;
    const inCrypt: LiveLocationHost = {
      instanceInfoAt: () => ({ slot: 2, dungeonId: crypt.id }),
      delveRunForPlayer: () => null,
    };
    expect(liveLocationFor(inCrypt, at(LANE_POS.x, LANE_POS.z))).toMatchObject({
      kind: 'dungeon',
      zoneId: zoneAt(crypt.doorPos.x, crypt.doorPos.z).id,
      instanceId: crypt.id,
      instance: crypt.name,
      instanceSlot: 2,
    });
    const delve = DELVES.collapsed_reliquary;
    const inDelve: LiveLocationHost = {
      instanceInfoAt: () => null,
      delveRunForPlayer: () => ({ delveId: delve.id, slot: 1 }),
    };
    expect(liveLocationFor(inDelve, at(LANE_POS.x, LANE_POS.z))).toMatchObject({
      kind: 'delve',
      zoneId: zoneAt(delve.doorPos.x, delve.doorPos.z).id,
      instanceId: delve.id,
      instance: delve.name,
      instanceSlot: 1,
    });
  });
});
