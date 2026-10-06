// src/sim/mortar_overdrive/busy.ts: the release activities a Mortar Overdrive
// seat must never pull a player out of. Each state is driven through the three
// real entry points (the queue join, Practice, and the queue pop), since all of
// them answer through the seat's one eligibility test.

import { describe, expect, it } from 'vitest';
import { NORTH_WATCH_CANNON } from '../src/sim/content/vehicle_stations';
import { GLIDER_QUEST_ID } from '../src/sim/content/world_quest_glider';
import { SHADOW_QUEST_ID } from '../src/sim/content/world_quest_shadow';
import { WISP_MAZE_QUEST_ID } from '../src/sim/content/world_quest_wisp_maze';
import { createCannonEncounter } from '../src/sim/minigames/cannon_encounter';
import { createGliderFlightState } from '../src/sim/minigames/glider_flight';
import { createWispMaze } from '../src/sim/minigames/wisp_maze';
import { startMortarOverdrivePractice } from '../src/sim/mortar_overdrive/bots';
import { mortarOverdriveHeldElsewhere } from '../src/sim/mortar_overdrive/busy';
import { mortarOverdriveStartMatch, updateMortarOverdrive } from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import type { Entity, WorldQuestProgress } from '../src/sim/types';
import { takeWorldQuestDeliveryCargo } from '../src/sim/world_quest_delivery';
import { addAt, makeWorld } from './mortar_overdrive_util';

function entity(sim: Sim, pid: number): Entity {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`no entity for pid ${pid}`);
  return e;
}

function meta(sim: Sim, pid: number) {
  const m = sim.players.get(pid);
  if (!m) throw new Error(`no meta for pid ${pid}`);
  return m;
}

function logQuest(sim: Sim, pid: number, questId: string, extra: Partial<WorldQuestProgress>) {
  meta(sim, pid).worldQuestLog.set(questId, { questId, count: 0, state: 'active', ...extra });
}

type Occupy = (sim: Sim, pid: number) => void;

/** Every state that owns the player, or carries something the seat would lose. */
const OCCUPIED: readonly (readonly [string, Occupy])[] = [
  [
    'seated in a cannon',
    (sim, pid) => {
      meta(sim, pid).vehicle = {
        kind: 'cannon',
        stationId: NORTH_WATCH_CANNON.id,
        cycle: '',
        origin: { ...entity(sim, pid).pos },
        encounter: createCannonEncounter(),
      };
    },
  ],
  [
    'counting down a glider launch',
    (sim, pid) => logQuest(sim, pid, GLIDER_QUEST_ID, { glider: createGliderFlightState(true) }),
  ],
  [
    'gliding',
    (sim, pid) => {
      const glider = createGliderFlightState(true);
      glider.phase = 'flying';
      logQuest(sim, pid, GLIDER_QUEST_ID, { glider });
    },
  ],
  [
    'inside the wisp maze',
    (sim, pid) => {
      const wispMaze = createWispMaze(42);
      wispMaze.phase = 'active';
      logQuest(sim, pid, WISP_MAZE_QUEST_ID, { wispMaze });
    },
  ],
  [
    'cloaked for the shadow trial',
    (sim, pid) =>
      logQuest(sim, pid, SHADOW_QUEST_ID, {
        shadow: { phase: 'cloaked', suspicion: 0, cooldown: 0 },
      }),
  ],
  [
    'riding the ferry',
    (sim, pid) => {
      entity(sim, pid).ferryRide = { route: 'r', from: 0, to: 1, ship: { x: 0, z: 0, rot: 0 } };
    },
  ],
  [
    'owed a pet the ferry parked',
    (sim, pid) => {
      entity(sim, pid).ferryPetParked = true;
    },
  ],
  [
    'carrying freight',
    (sim, pid) => {
      expect(takeWorldQuestDeliveryCargo(sim.ctx, entity(sim, pid))).toBe(true);
    },
  ],
  [
    'queued for Thornhollow Fields',
    (sim, pid) => {
      sim.ctx.bgQueue.push({ pids: [pid], waited: 0 });
    },
  ],
];

function fourPilots(sim: Sim): number[] {
  return [
    addAt(sim, 'warrior', 'Aster', -5, -40),
    addAt(sim, 'mage', 'Briar', 7, -42),
    addAt(sim, 'rogue', 'Cass', -9, -38),
    addAt(sim, 'priest', 'Dell', 11, -44),
  ];
}

describe('Mortar Overdrive never seats a pilot another activity owns', () => {
  it.each(OCCUPIED)('keeps a player %s out of the queue', (_label, occupy) => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Aster');
    occupy(sim, pid);
    sim.mortarOverdriveQueueJoin(pid);
    expect(sim.mortarOverdrive.queue).not.toContain(pid);
  });

  it.each(OCCUPIED)('refuses Practice to a player %s', (_label, occupy) => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Aster');
    const before = { ...entity(sim, pid).pos };
    occupy(sim, pid);
    expect(startMortarOverdrivePractice(sim, 'driver', pid)).toBe(false);
    expect(sim.mortarOverdrive.practices).toHaveLength(0);
    expect(entity(sim, pid).drive).toBeNull();
    expect(entity(sim, pid).pos).toEqual(before);
    // The refused grid's house pilots went home with it.
    expect(sim.players.size).toBe(1);
  });

  it.each(OCCUPIED)(
    'drops a queued pilot who is %s by the time the heat seats',
    (_label, occupy) => {
      const sim = makeWorld();
      const pids = fourPilots(sim);
      for (const pid of pids) sim.mortarOverdriveQueueJoin(pid);
      expect(sim.mortarOverdrive.queue).toEqual(pids);
      sim.drainEvents();
      occupy(sim, pids[0]);
      updateMortarOverdrive(sim.ctx);
      expect(sim.mortarOverdrive.match).toBeNull();
      expect(sim.mortarOverdrive.queue).toEqual(pids.slice(1));
      expect(sim.drainEvents()).toContainEqual({ type: 'mortarOverdriveUnqueued', pid: pids[0] });
      expect(entity(sim, pids[0]).drive).toBeNull();
    },
  );

  it('still seats the same four once nothing owns them', () => {
    const sim = makeWorld();
    const pids = fourPilots(sim);
    expect(mortarOverdriveStartMatch(sim.ctx, pids)).toBe(true);
  });
});

describe('mortarOverdriveHeldElsewhere', () => {
  it.each(OCCUPIED)('holds a player %s', (_label, occupy) => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Aster');
    expect(mortarOverdriveHeldElsewhere(sim.ctx, meta(sim, pid), entity(sim, pid))).toBe(false);
    occupy(sim, pid);
    expect(mortarOverdriveHeldElsewhere(sim.ctx, meta(sim, pid), entity(sim, pid))).toBe(true);
  });

  it('lets a paused maze, a landed glider and a caught shadow go', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Aster');
    const wispMaze = createWispMaze(42);
    wispMaze.phase = 'active';
    logQuest(sim, pid, WISP_MAZE_QUEST_ID, { wispMaze: { ...wispMaze, paused: true } });
    const glider = createGliderFlightState(true);
    glider.phase = 'won';
    logQuest(sim, pid, GLIDER_QUEST_ID, { glider });
    logQuest(sim, pid, SHADOW_QUEST_ID, {
      shadow: { phase: 'caught', suspicion: 0, cooldown: 0 },
    });
    expect(mortarOverdriveHeldElsewhere(sim.ctx, meta(sim, pid), entity(sim, pid))).toBe(false);
  });
});
