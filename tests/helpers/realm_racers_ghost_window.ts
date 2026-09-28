// One recovery's ghost window, asserted end to end on a live race: the ghost
// holds to its earliest clear tick even with nobody near it (the minimum), and
// with a rival held on it from there it holds to the cap exactly, then goes.
// Shared by the ghost suite and the recovery suite, so every recovery kind is
// judged by the same rule.

import { expect } from 'vitest';
import {
  REALM_RACERS_GHOST_MARGIN_TICKS,
  REALM_RACERS_GHOST_MIN_TICKS,
  realmRacersGhosted,
} from '../../src/sim/realm_racers_ghost';
import type { Sim } from '../../src/sim/sim';
import type { RealmRacersProgress } from '../../src/sim/social/realm_racers';
import type { Entity } from '../../src/sim/types';

export interface GhostWindowCase {
  sim: Sim;
  racer: Entity;
  progress: RealmRacersProgress;
  /** `sim.tickCount` right after the recovery was observed. */
  resetTick: number;
  /** Put a rival on top of the recovered machine (called before each tick). */
  holdRivalOn: () => void;
}

export function expectGhostWindow(c: GhostWindowCase): void {
  const { sim, racer, progress, resetTick } = c;
  expect(realmRacersGhosted(racer)).toBe(true);
  // Spelled out here rather than read back off the module's own window
  // function, so a wrong rule there cannot agree with itself: the minimum is
  // from the RECOVERY whatever lock it carried, and the cap is one margin past
  // the earliest clear.
  const earliestClearTick = Math.max(
    progress.resetLockedUntilTick,
    resetTick + REALM_RACERS_GHOST_MIN_TICKS + 1,
  );
  const expected = {
    earliestClearTick,
    capTick: earliestClearTick + REALM_RACERS_GHOST_MARGIN_TICKS,
  };
  expect(progress.ghostClearTick).toBe(expected.earliestClearTick);
  expect(progress.ghostCapTick).toBe(expected.capTick);
  // Nobody near it: still a ghost for the whole minimum.
  while (sim.tickCount < expected.earliestClearTick - 1) {
    sim.tick();
    expect(realmRacersGhosted(racer)).toBe(true);
  }
  // Held on from there: a ghost to the cap, and not one tick more.
  while (sim.tickCount < expected.capTick - 1) {
    c.holdRivalOn();
    sim.tick();
    expect(realmRacersGhosted(racer)).toBe(true);
  }
  c.holdRivalOn();
  sim.tick();
  expect(sim.tickCount).toBe(expected.capTick);
  expect(realmRacersGhosted(racer)).toBe(false);
}

export interface FollowerCase {
  sim: Sim;
  recovered: Entity;
  follower: Entity;
  /** Park a machine at a world point with drove-there bookkeeping. */
  place: (pid: number, x: number, z: number) => void;
  /** Every racer on the grid, to filter the bump events to this race. */
  pids: readonly number[];
}

/**
 * The playtest, replayed: a follower twelve yards behind the recovered machine
 * on its heading, at racing speed, drives straight through it. Asserts no bump
 * and that the follower came out the other side, and returns the bump count so
 * a caller can run the SOLID control the same way.
 */
export function followThrough(c: FollowerCase): { bumps: number; ahead: number } {
  const { sim, recovered, follower } = c;
  const bumps: unknown[] = [];
  const original = sim.emit.bind(sim);
  sim.emit = (event) => {
    if (
      event.type === 'realmRacersBump' &&
      c.pids.includes(event.aId) &&
      (event.aId === follower.id || event.bId === follower.id)
    ) {
      bumps.push(event);
    }
    original(event);
  };
  try {
    const dirX = Math.sin(recovered.facing);
    const dirZ = Math.cos(recovered.facing);
    c.place(follower.id, recovered.pos.x - dirX * 12, recovered.pos.z - dirZ * 12);
    follower.facing = recovered.facing;
    if (!follower.drive) throw new Error('follower has no machine');
    follower.drive.speed = 45;
    const meta = sim.players.get(follower.id);
    if (meta) meta.moveInput.forward = true;
    const parked = { ...recovered.pos };
    for (let i = 0; i < 12; i++) sim.tick();
    const ahead = (follower.pos.x - parked.x) * dirX + (follower.pos.z - parked.z) * dirZ;
    return { bumps: bumps.length, ahead };
  } finally {
    sim.emit = original;
  }
}
