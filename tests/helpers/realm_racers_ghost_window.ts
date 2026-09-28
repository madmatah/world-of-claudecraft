// One recovery's ghost window, asserted end to end on a live race: the ghost
// holds to its earliest clear tick even with nobody near it (the minimum), and
// then either ends on that very tick (nobody near) or, with a rival held on it,
// holds to the cap exactly, then goes. Shared by the ghost suite and the
// recovery suite, so every recovery kind is judged by the same rule.

import { expect } from 'vitest';
import {
  REALM_RACERS_GHOST_MARGIN_TICKS,
  REALM_RACERS_GHOST_MIN_TICKS,
  realmRacersGhosted,
} from '../../src/sim/realm_racers_ghost';
import type { Sim } from '../../src/sim/sim';
import {
  REALM_RACERS_RESET_LOCK_TICKS,
  type RealmRacersProgress,
} from '../../src/sim/social/realm_racers';
import type { Entity } from '../../src/sim/types';

// The expected windows are spelled out from the constants here rather than
// read back off the race or the module's own window function, so a wrong rule
// there cannot agree with itself. Ticks are exclusive, the lock's convention.

/** A manual recovery at `resetTick`: its two-second lock outlasts the minimum,
 *  so the ghost may end on the tick the lock does. */
export function manualGhostClearTick(resetTick: number): number {
  return resetTick + REALM_RACERS_RESET_LOCK_TICKS + 1;
}

/** An automatic (stuck, loiter) or cut recovery at `resetTick`: the minimum
 *  from the recovery outlasts its short lock. */
export function autoGhostClearTick(resetTick: number): number {
  return resetTick + REALM_RACERS_GHOST_MIN_TICKS + 1;
}

export interface GhostEndCase {
  sim: Sim;
  racer: Entity;
  progress: RealmRacersProgress;
  /** From `manualGhostClearTick` or `autoGhostClearTick`. */
  earliestClearTick: number;
}

export interface GhostWindowCase extends GhostEndCase {
  /** Put a rival on top of the recovered machine (called before each tick). */
  holdRivalOn: () => void;
}

/** The window opened as spelled, and nobody near it: a ghost up to the tick
 *  before its earliest clear. */
function expectMinimumHeld(c: GhostEndCase): void {
  const { sim, racer, progress, earliestClearTick } = c;
  expect(realmRacersGhosted(racer)).toBe(true);
  expect(progress.ghostClearTick).toBe(earliestClearTick);
  expect(progress.ghostCapTick).toBe(earliestClearTick + REALM_RACERS_GHOST_MARGIN_TICKS);
  while (sim.tickCount < earliestClearTick - 1) {
    sim.tick();
    expect(realmRacersGhosted(racer)).toBe(true);
  }
}

/** Nobody near it at all: the ghost ends ON its earliest clear tick. */
export function expectGhostEndsWhenClear(c: GhostEndCase): void {
  expectMinimumHeld(c);
  const { sim, racer, progress, earliestClearTick } = c;
  sim.tick();
  expect(sim.tickCount).toBe(earliestClearTick);
  expect(realmRacersGhosted(racer)).toBe(false);
  expect(progress.ghostCapTick).toBe(0);
}

/** A rival held on it from the tick before its earliest clear: a ghost to the
 *  cap, and not one tick more. */
export function expectGhostWindow(c: GhostWindowCase): void {
  expectMinimumHeld(c);
  const { sim, racer } = c;
  const capTick = c.earliestClearTick + REALM_RACERS_GHOST_MARGIN_TICKS;
  while (sim.tickCount < capTick - 1) {
    c.holdRivalOn();
    sim.tick();
    expect(realmRacersGhosted(racer)).toBe(true);
  }
  c.holdRivalOn();
  sim.tick();
  expect(sim.tickCount).toBe(capTick);
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
