import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
  isMortarOverdriveAreaTrack,
  mortarOverdriveAreaTrackAt,
} from '../src/game/instance_music';
import {
  AREA_TRACK_GROUP,
  AREA_TRACK_URLS,
  type AreaTrackId,
  isAreaTrackId,
  ZONE_STREAM_URLS,
} from '../src/game/music_tracks';
import { MORTAR_OVERDRIVE_CIRCUIT_LIST } from '../src/sim/content/mortar_overdrive/circuits';
import { DELVE_X_MIN, DUNGEONS, instanceOrigin, ZONES } from '../src/sim/data';
import {
  MORTAR_OVERDRIVE_LANES,
  MORTAR_OVERDRIVE_ORIGIN,
  mortarOverdriveLaneOrigin,
} from '../src/sim/mortar_overdrive/layout';

const eastbrookFixture = ZONES.find((zone) => zone.id === 'eastbrook_vale');
if (!eastbrookFixture) throw new Error('eastbrook_vale fixture is missing');
const eastbrook = eastbrookFixture;

function input(overrides: Partial<InstanceMusicInput> = {}): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    inCombat: false,
    playerId: 7,
    playerPos: { x: eastbrook.hub.x, z: eastbrook.hub.z },
    zone: eastbrook,
    inDungeon: false,
    entities: [],
    mortarOverdriveMatchId: null,
    riftFloor: null,
    ...overrides,
  };
}

describe('instance music policy', () => {
  it('derives combat from the local aggro target without treating unrelated mobs as combat', () => {
    const unrelated: InstanceMusicEntity = {
      kind: 'mob',
      dead: false,
      templateId: 'wolf',
      aggroTargetId: 99,
    };
    const localAggro = { ...unrelated, aggroTargetId: 7 };

    expect(instanceMusicDecision(input({ entities: [unrelated] })).inCombat).toBe(false);
    expect(instanceMusicDecision(input({ entities: [localAggro] })).inCombat).toBe(true);
  });

  it('selects and resets a delve profile by its domain id', () => {
    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    const controller = new InstanceMusicController(port);
    const delveInput = input({
      playerPos: { x: DELVE_X_MIN, z: 0 },
      inDungeon: true,
    });

    const first = controller.update(delveInput);
    controller.update(delveInput);

    expect(first.instanceId).toBe('collapsed_reliquary');
    expect(first.zone).toBe('dungeon_hollow_crypt');
    expect(port.resetForDungeonEntry).toHaveBeenCalledTimes(1);
    expect(port.resetForDungeonEntry).toHaveBeenCalledWith(
      'collapsed_reliquary',
      'dungeon_hollow_crypt',
    );
    expect(port.update).toHaveBeenLastCalledWith('dungeon_hollow_crypt', false);
  });

  it('gives the Mortar Overdrive circuit its own race track instead of the dungeon crawl cue', () => {
    const onCircuit = input({
      // the circuit sits on the flat instance plane, so the HUD reports inDungeon
      playerPos: { x: MORTAR_OVERDRIVE_ORIGIN.x, z: MORTAR_OVERDRIVE_ORIGIN.z },
      inDungeon: true,
    });

    const racing = instanceMusicDecision(onCircuit);
    expect(racing.areaTrack).toBe('mortar_overdrive_evergarden');

    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    new InstanceMusicController(port).update(onCircuit);
    expect(port.setAreaTrack).toHaveBeenCalledWith('mortar_overdrive_evergarden');
  });

  it('covers the private practice copies and drops the track back in the world', () => {
    const practiceSlot = instanceMusicDecision(
      input({ playerPos: mortarOverdriveLaneOrigin(3), inDungeon: true }),
    );
    expect(practiceSlot.areaTrack).toBe('mortar_overdrive_evergarden');

    // default fixture position: the Eastbrook hub, nowhere near the band
    expect(instanceMusicDecision(input()).areaTrack).toBeNull();
  });

  it('restarts the Mortar Overdrive track when a new race begins without leaving the circuit', () => {
    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    const controller = new InstanceMusicController(port);
    const onCircuit = input({
      playerPos: { x: MORTAR_OVERDRIVE_ORIGIN.x, z: MORTAR_OVERDRIVE_ORIGIN.z },
      inDungeon: true,
      mortarOverdriveMatchId: 41,
    });

    controller.update(onCircuit);
    controller.update(onCircuit);
    controller.update({ ...onCircuit, mortarOverdriveMatchId: 42 });

    expect(port.setAreaTrack).toHaveBeenNthCalledWith(1, 'mortar_overdrive_evergarden', true);
    expect(port.setAreaTrack).toHaveBeenNthCalledWith(2, 'mortar_overdrive_evergarden');
    expect(port.setAreaTrack).toHaveBeenNthCalledWith(3, 'mortar_overdrive_evergarden', true);
  });
});

describe('the Proving Shore cue, resolved from the shipped zone record', () => {
  // The routing tests in music.test.ts feed musicZoneForLocation a hand-typed
  // zone id and biome. This one goes through the real content record and the
  // resolver the client actually calls, so a change to the island's biome,
  // its hub, or its id cannot silently drop it back onto the mainland loop.
  const islandFixture = ZONES.find((zone) => zone.id === 'proving_shore');
  if (!islandFixture) throw new Error('proving_shore fixture is missing');
  const island = islandFixture;

  const at = (x: number, z: number) =>
    instanceMusicDecision(input({ zone: island, playerPos: { x, z } })).zone;

  it('plays the island cue at Dawnrest Camp and out on the strand alike', () => {
    expect(at(island.hub.x, island.hub.z)).toBe('proving_shore');
    // The Wreck Line, the far west end of the island, well outside the hub.
    expect(at(-380, -42)).toBe('proving_shore');
  });

  it('is a different cue from the mainland vale it paints as', () => {
    // Without its own row the island would inherit its biome's cue, which is
    // the whole reason this exists: the first music a new player hears would
    // be the mainland's.
    expect(island.biome).toBe('vale');
    expect(at(island.hub.x, island.hub.z)).not.toBe('vale');
    expect(ZONE_STREAM_URLS.proving_shore).not.toBe(ZONE_STREAM_URLS.vale);
  });

  it('streams a committed file, so the island is never silent', () => {
    const url = ZONE_STREAM_URLS.proving_shore;
    expect(url).toBeTruthy();
    expect(existsSync(path.join(__dirname, '..', 'public', ...url!.split('?')[0].split('/')))).toBe(
      true,
    );
  });

  it('selects the authored ambient cue for each Ignivar raid room', () => {
    const rooms = [
      { id: 'ignivar_forge_approach', zone: 'ignivar_forge_approach' },
      { id: 'ignivar_raid_arena', zone: 'ignivar_raid_arena' },
      { id: 'ignivar_molten_assembly', zone: 'ignivar_forge_approach' },
      { id: 'ignivar_inner_crucible', zone: 'ignivar_inner_crucible' },
    ] as const;

    for (const room of rooms) {
      const origin = instanceOrigin(DUNGEONS[room.id].index, 0);
      const decision = instanceMusicDecision(
        input({
          playerPos: origin,
          inDungeon: true,
        }),
      );
      expect(decision.instanceId, room.id).toBe(room.id);
      expect(decision.zone, room.id).toBe(room.zone);
      expect(decision.musicCombat, room.id).toBe(false);
    }
  });

  it('keeps the final room soundtrack active instead of the global combat layer', () => {
    const room = 'ignivar_inner_crucible';
    const origin = instanceOrigin(DUNGEONS[room].index, 0);
    const decision = instanceMusicDecision(
      input({
        playerPos: origin,
        inDungeon: true,
        entities: [
          {
            kind: 'mob',
            dead: false,
            templateId: 'varkhul_forgefather',
            aggroTargetId: 7,
          },
        ],
      }),
    );

    expect(decision.zone).toBe(room);
    expect(decision.inCombat).toBe(true);
    expect(decision.musicCombat).toBe(false);
    expect(decision.crucibleFloor).toBe(4);
  });
});

describe('instance music policy: the authoritative in-combat flag', () => {
  it('the world flag alone puts the player in combat, with no aggro target and no recent event', () => {
    const decision = instanceMusicDecision(input({ inCombat: true }));
    expect(decision.inCombat).toBe(true);
    expect(decision.musicCombat).toBe(true);
  });

  it('a false world flag never suppresses the aggro or recent-event arms', () => {
    const aggro = instanceMusicDecision(
      input({
        inCombat: false,
        entities: [{ kind: 'mob', dead: false, templateId: 'wolf', aggroTargetId: 7 }],
      }),
    );
    expect(aggro.inCombat).toBe(true);
    const recent = instanceMusicDecision(input({ inCombat: false, lastCombatEventAt: 19000 }));
    expect(recent.inCombat).toBe(true);
    const calm = instanceMusicDecision(input({ inCombat: false }));
    expect(calm.inCombat).toBe(false);
  });
});

describe('Mortar Overdrive music: the track comes off the circuit, not the band', () => {
  it('plays each circuit its own authored track, on every lane it stands on', () => {
    // The point of the per-circuit field: a themed circuit brings its zone's
    // music with it, so this reads the RECORD rather than expecting one id.
    for (const lane of MORTAR_OVERDRIVE_LANES) {
      const decision = instanceMusicDecision(
        input({ playerPos: mortarOverdriveLaneOrigin(lane.index), inDungeon: true }),
      );
      expect(decision.areaTrack, `lane ${lane.index}`).toBe(lane.circuit.musicTrack);
      expect(
        mortarOverdriveAreaTrackAt(
          MORTAR_OVERDRIVE_ORIGIN.x,
          mortarOverdriveLaneOrigin(lane.index).z,
        ),
      ).toBe(lane.circuit.musicTrack);
    }
  });

  it('ships a url for every circuit track, and one group per TRACK', () => {
    // Two circuits MAY share a track: circuits of the same zone wear the same
    // music, and that is a feature, not a collision. What must not happen is two
    // DIFFERENT tracks sharing a prewarm group, because activating either would
    // download both, and you never cross from one circuit to another without a
    // race start. So the rule is one group per track, not one per circuit.
    const trackOfGroup = new Map<string, AreaTrackId>();
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      expect(isAreaTrackId(circuit.musicTrack), `${circuit.id} track is shipped`).toBe(true);
      const track = circuit.musicTrack as AreaTrackId;
      expect(AREA_TRACK_URLS[track], `${circuit.id} url`).toBeTruthy();
      const group = AREA_TRACK_GROUP[track];
      expect(group, `${circuit.id} group`).toBeTruthy();
      const owner = trackOfGroup.get(group);
      expect(owner ?? track, `group ${group} carries both ${owner} and ${track}`).toBe(track);
      trackOfGroup.set(group, track);
      expect(isMortarOverdriveAreaTrack(track)).toBe(true);
    }
    expect(isMortarOverdriveAreaTrack(null)).toBe(false);
  });

  it('answers nothing off the band', () => {
    expect(mortarOverdriveAreaTrackAt(0, 0)).toBeNull();
    expect(
      mortarOverdriveAreaTrackAt(
        MORTAR_OVERDRIVE_ORIGIN.x,
        mortarOverdriveLaneOrigin(MORTAR_OVERDRIVE_LANES.length).z,
      ),
    ).toBeNull();
  });
});
