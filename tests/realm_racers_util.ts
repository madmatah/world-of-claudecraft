// Shared world-staging helpers for the Realm Racers suites. Not a test file:
// nothing here runs on its own.
//
// These three functions came from the retired vale_cup_util factory, which left
// with the Vale Cup itself; the racing suites are the remaining callers, so the
// helpers are re-homed here under their own name. The prebuilt cup world went
// with the minigame: what stays is a plain scoped world plus the two placement
// helpers every racing case uses.

import { BUILTIN_WORLD } from '../src/sim/data';
import type { Sim } from '../src/sim/sim';
import { Sim as SimCtor } from '../src/sim/sim';
import { realmRacersMatches, realmRacersReady } from '../src/sim/social/realm_racers';
import type { SimConfig, WorldContent } from '../src/sim/types';
import { groundHeight } from '../src/sim/world';

// The racing suites need the real terrain and instance-plane geometry, but none
// of the hundreds of unrelated overworld mobs, NPCs, or objects. A full race
// advances thousands of ticks, so stripping ambient constructor spawns keeps
// every terrain-relevant field while avoiding unrelated simulation work.
export const REALM_RACERS_TEST_WORLD: WorldContent = {
  ...BUILTIN_WORLD,
  camps: [],
  npcs: {},
  groundObjects: [],
};

export function makeWorld(overrides: Partial<SimConfig> = {}): Sim {
  return new SimCtor({
    seed: 42,
    playerClass: 'warrior',
    noPlayer: true,
    ...overrides,
    world: REALM_RACERS_TEST_WORLD,
  });
}

export function teleport(sim: Sim, pid: number, x: number, z: number): void {
  const e = sim.entities.get(pid);
  if (!e) throw new Error(`no entity for pid ${pid}`);
  e.pos.x = x;
  e.pos.z = z;
  e.pos.y = groundHeight(x, z, sim.cfg.seed);
  e.prevPos = { ...e.pos };
  (sim as unknown as { rebucket(entity: typeof e): void }).rebucket(e);
}

export function addAt(
  sim: Sim,
  cls: Parameters<Sim['addPlayer']>[0],
  name: string,
  x = 0,
  z = -40,
): number {
  const pid = sim.addPlayer(cls, name);
  teleport(sim, pid, x, z);
  return pid;
}

/**
 * Every human pilot of every live race sends the loading lobby's ready, through
 * the same entry the server's `realm_racers_ready` dispatch calls. The next tick
 * closes the lobby and starts the countdown.
 */
export function readyAllRacers(sim: Sim): void {
  for (const match of realmRacersMatches(sim.ctx)) {
    for (const pid of match.pids) realmRacersReady(sim.ctx, pid);
  }
}
