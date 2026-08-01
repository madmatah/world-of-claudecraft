import { describe, expect, it, vi } from 'vitest';
import {
  InstanceMusicController,
  type InstanceMusicEntity,
  type InstanceMusicInput,
  instanceMusicDecision,
} from '../src/game/instance_music';
import { DELVE_X_MIN, ZONES } from '../src/sim/data';
import { REALM_RACERS_ORIGIN, realmRacersSlotOrigin } from '../src/sim/realm_racers_layout';
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
    expect(racing.areaTrack).toBe('realm_racers');
    expect(racing.atSowfield).toBe(false);

    const port = {
      resetForDungeonEntry: vi.fn(),
      update: vi.fn(),
      setBossCombat: vi.fn(),
      setAreaTrack: vi.fn(),
    };
    new InstanceMusicController(port).update(onCircuit);
    expect(port.setAreaTrack).toHaveBeenCalledWith('realm_racers');
  });

  it('covers the private practice copies and drops the track back in the world', () => {
    const practiceSlot = instanceMusicDecision(
      input({ playerPos: realmRacersSlotOrigin(3), inDungeon: true }),
    );
    expect(practiceSlot.areaTrack).toBe('realm_racers');

    // default fixture position: the Eastbrook hub, nowhere near the band
    expect(instanceMusicDecision(input()).areaTrack).toBeNull();
  });
});
