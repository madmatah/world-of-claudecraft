import { describe, expect, it, vi } from 'vitest';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
  isRealmRacersAreaTrack,
  realmRacersAreaTrackAt,
} from '../src/game/instance_music';
import {
  AREA_TRACK_GROUP,
  AREA_TRACK_URLS,
  type AreaTrackId,
  isAreaTrackId,
} from '../src/game/music_tracks';
import { REALM_RACERS_CIRCUIT_LIST } from '../src/sim/content/realm_racers_circuits';
import { DELVE_X_MIN, ZONES } from '../src/sim/data';
import {
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneOrigin,
} from '../src/sim/realm_racers_layout';
import { SOWFIELD_CENTER } from '../src/sim/vale_cup_layout';

const eastbrookFixture = ZONES.find((zone) => zone.id === 'eastbrook_vale');
if (!eastbrookFixture) throw new Error('eastbrook_vale fixture is missing');
const eastbrook = eastbrookFixture;

function input(overrides: Partial<InstanceMusicInput> = {}): InstanceMusicInput {
  return {
    now: 20000,
    lastCombatEventAt: 0,
    lastBossCombatEventAt: 0,
    playerId: 7,
    playerPos: { x: eastbrook.hub.x, z: eastbrook.hub.z },
    zone: eastbrook,
    inDungeon: false,
    entities: [],
    cupInfo: null,
    realmRacersMatchId: null,
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

  it('selects the Sowfield music zone and follows its public match phase', () => {
    const waiting = instanceMusicDecision(
      input({
        playerPos: SOWFIELD_CENTER,
        cupInfo: null,
      }),
    );
    expect(waiting.atSowfield).toBe(true);
    expect(waiting.zone).toBe('vale_cup');
    expect(waiting.areaTrack).toBe('sowfield_waiting');

    const active = instanceMusicDecision(
      input({
        playerPos: SOWFIELD_CENTER,
        cupInfo: {
          match: { phase: 'active', origin: { x: 0, z: 0 } },
          spectate: null,
        },
      }),
    );
    expect(active.atSowfield).toBe(true);
    expect(active.zone).toBe('vale_cup');
    expect(active.areaTrack).toBe('sowfield_match');
  });

  it('routes private-practice phases through the Vale Cup tracks', () => {
    const practice = instanceMusicDecision(
      input({
        playerPos: { x: 30000, z: 0 },
        inDungeon: true,
        cupInfo: {
          match: { phase: 'active', origin: { x: 30000, z: 0 } },
          spectate: null,
        },
      }),
    );
    expect(practice.areaTrack).toBe('sowfield_match');

    const waiting = instanceMusicDecision(
      input({
        playerPos: { x: 0, z: 0 },
        cupInfo: {
          match: null,
          spectate: { phase: 'briefing', origin: { x: 0, z: 0 } },
        },
      }),
    );
    expect(waiting.areaTrack).toBeNull();
  });

  it('gives the Realm Racers circuit its own race track instead of the dungeon crawl cue', () => {
    const onCircuit = input({
      // the circuit sits on the flat instance plane, so the HUD reports inDungeon
      playerPos: { x: REALM_RACERS_ORIGIN.x, z: REALM_RACERS_ORIGIN.z },
      inDungeon: true,
    });

    const racing = instanceMusicDecision(onCircuit);
    expect(racing.areaTrack).toBe('realm_racers_evergarden');
    expect(racing.atSowfield).toBe(false);

    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    new InstanceMusicController(port).update(onCircuit);
    expect(port.setAreaTrack).toHaveBeenCalledWith('realm_racers_evergarden');
  });

  it('covers the private practice copies and drops the track back in the world', () => {
    const practiceSlot = instanceMusicDecision(
      input({ playerPos: realmRacersLaneOrigin(3), inDungeon: true }),
    );
    expect(practiceSlot.areaTrack).toBe('realm_racers_evergarden');

    // default fixture position: the Eastbrook hub, nowhere near the band
    expect(instanceMusicDecision(input()).areaTrack).toBeNull();
  });

  it('restarts the Realm Racers track when a new race begins without leaving the circuit', () => {
    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    const controller = new InstanceMusicController(port);
    const onCircuit = input({
      playerPos: { x: REALM_RACERS_ORIGIN.x, z: REALM_RACERS_ORIGIN.z },
      inDungeon: true,
      realmRacersMatchId: 41,
    });

    controller.update(onCircuit);
    controller.update(onCircuit);
    controller.update({ ...onCircuit, realmRacersMatchId: 42 });

    expect(port.setAreaTrack).toHaveBeenNthCalledWith(1, 'realm_racers_evergarden', true);
    expect(port.setAreaTrack).toHaveBeenNthCalledWith(2, 'realm_racers_evergarden');
    expect(port.setAreaTrack).toHaveBeenNthCalledWith(3, 'realm_racers_evergarden', true);
  });
});

describe('Realm Racers music: the track comes off the circuit, not the band', () => {
  it('plays each circuit its own authored track, on every lane it stands on', () => {
    // The point of the per-circuit field: a themed circuit brings its zone's
    // music with it, so this reads the RECORD rather than expecting one id.
    for (const lane of REALM_RACERS_LANES) {
      const decision = instanceMusicDecision(
        input({ playerPos: realmRacersLaneOrigin(lane.index), inDungeon: true }),
      );
      expect(decision.areaTrack, `lane ${lane.index}`).toBe(lane.circuit.musicTrack);
      expect(
        realmRacersAreaTrackAt(REALM_RACERS_ORIGIN.x, realmRacersLaneOrigin(lane.index).z),
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
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      expect(isAreaTrackId(circuit.musicTrack), `${circuit.id} track is shipped`).toBe(true);
      const track = circuit.musicTrack as AreaTrackId;
      expect(AREA_TRACK_URLS[track], `${circuit.id} url`).toBeTruthy();
      const group = AREA_TRACK_GROUP[track];
      expect(group, `${circuit.id} group`).toBeTruthy();
      const owner = trackOfGroup.get(group);
      expect(owner ?? track, `group ${group} carries both ${owner} and ${track}`).toBe(track);
      trackOfGroup.set(group, track);
      expect(isRealmRacersAreaTrack(track)).toBe(true);
    }
    // The Sowfield is not a circuit, so a new race must never restart it.
    expect(isRealmRacersAreaTrack('sowfield_match')).toBe(false);
    expect(isRealmRacersAreaTrack(null)).toBe(false);
  });

  it('answers nothing off the band', () => {
    expect(realmRacersAreaTrackAt(0, 0)).toBeNull();
    expect(
      realmRacersAreaTrackAt(
        REALM_RACERS_ORIGIN.x,
        realmRacersLaneOrigin(REALM_RACERS_LANES.length).z,
      ),
    ).toBeNull();
  });
});
