// Start now, the backfill on demand: any queued pilot may press it, and it
// seats the queue head (up to a grid, in queue order) on the public lane with
// house pilots at the backfill tier in the open seats, through the backfill's
// own seat.

import { describe, expect, it, vi } from 'vitest';
import {
  MORTAR_OVERDRIVE_BACKFILL_TICKS,
  MORTAR_OVERDRIVE_BACKFILL_TIER,
} from '../src/sim/mortar_overdrive/backfill';
import { startMortarOverdriveNow } from '../src/sim/mortar_overdrive/bots';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../src/sim/mortar_overdrive/layout';
import { mortarOverdriveMatchOf } from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import { addAt, makeWorld } from './mortar_overdrive_util';

function botPids(sim: Sim): number[] {
  return [...sim.mortarOverdrive.bots.keys()];
}

function fighting(sim: Sim, pid: number): void {
  const e = sim.entities.get(pid);
  if (!e) throw new Error('missing pilot');
  e.inCombat = true;
  e.combatTimer = 0;
}

describe('Mortar Overdrive Start now', () => {
  it('seats a lone queued pilot on the public lane against house pilots at the backfill tier', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(aster);
    sim.tick();
    expect(startMortarOverdriveNow(sim, aster)).toBe(true);
    const match = sim.mortarOverdrive.match;
    expect(match).not.toBeNull();
    expect(match?.practice).toBeNull();
    expect(match?.pids[0]).toBe(aster);
    expect(match?.pids).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    const bots = botPids(sim);
    expect(bots).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    for (const bot of bots)
      expect(sim.mortarOverdrive.bots.get(bot)).toBe(MORTAR_OVERDRIVE_BACKFILL_TIER);
    // Seated, so out of the queue, and well before the backfill would have come.
    expect(sim.mortarOverdrive.queue).toEqual([]);
    expect(sim.mortarOverdrive.queuedAtTick.size).toBe(0);
    expect(sim.tickCount).toBeLessThan(MORTAR_OVERDRIVE_BACKFILL_TICKS);
  });

  it('starts the race for every queued pilot, in queue order, whoever presses it', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    const briar = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(aster);
    sim.mortarOverdriveQueueJoin(briar);
    sim.tick();
    // The SECOND pilot in line presses it: both race, the first still on pole.
    expect(startMortarOverdriveNow(sim, briar)).toBe(true);
    const match = sim.mortarOverdrive.match;
    expect(match?.pids.slice(0, 2)).toEqual([aster, briar]);
    expect(botPids(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 2);
    expect(mortarOverdriveMatchOf(sim.ctx, aster)).toBe(match);
    expect(sim.mortarOverdrive.queue).toEqual([]);
  });

  it('works offline, where nothing else would ever fill the grid', () => {
    const sim = makeWorld();
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(aster);
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS + 20; i++) sim.tick();
    expect(sim.mortarOverdrive.match).toBeNull();
    sim.startMortarOverdriveNow(aster);
    expect(sim.mortarOverdrive.match?.pids[0]).toBe(aster);
    expect(botPids(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
  });

  it('refuses a pilot who is not queued, and spawns nobody doing it', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    const briar = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(briar);
    const spawns = vi.spyOn(sim, 'addPlayer');
    sim.drainEvents();
    expect(startMortarOverdriveNow(sim, aster)).toBe(false);
    expect(spawns).not.toHaveBeenCalled();
    expect(sim.mortarOverdrive.match).toBeNull();
    expect(sim.mortarOverdrive.queue).toEqual([briar]);
    // Silent: the window only offers it while queued.
    expect(sim.drainEvents()).toEqual([]);
  });

  it('refuses while the public lane is racing, and the queue keeps its places', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const racer = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(racer);
    expect(startMortarOverdriveNow(sim, racer)).toBe(true);
    const running = sim.mortarOverdrive.match;
    const waiter = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(waiter);
    const spawns = vi.spyOn(sim, 'addPlayer');
    expect(startMortarOverdriveNow(sim, waiter)).toBe(false);
    expect(spawns).not.toHaveBeenCalled();
    expect(sim.mortarOverdrive.match).toBe(running);
    expect(sim.mortarOverdrive.queue).toEqual([waiter]);
  });

  it('refuses a queued pilot in combat with the in-combat error', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const fighter = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(fighter);
    fighting(sim, fighter);
    const spawns = vi.spyOn(sim, 'addPlayer');
    sim.drainEvents();
    expect(startMortarOverdriveNow(sim, fighter)).toBe(false);
    expect(spawns).not.toHaveBeenCalled();
    expect(sim.mortarOverdrive.queue).toEqual([fighter]);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: "You can't do that while in combat.",
      pid: fighter,
    });
  });

  it('refuses a queued pilot who can no longer race, and seats nobody', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const ghost = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(ghost);
    const e = sim.entities.get(ghost);
    if (!e) throw new Error('missing pilot');
    // Between ticks, before the queue prune has seen it.
    e.dead = true;
    const spawns = vi.spyOn(sim, 'addPlayer');
    expect(startMortarOverdriveNow(sim, ghost)).toBe(false);
    expect(spawns).not.toHaveBeenCalled();
    expect(sim.mortarOverdrive.match).toBeNull();
  });

  it('starts for the eligible waiters when one behind the presser has just become ineligible', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    const briar = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(aster);
    sim.mortarOverdriveQueueJoin(briar);
    const e = sim.entities.get(briar);
    if (!e) throw new Error('missing pilot');
    e.dead = true;
    expect(startMortarOverdriveNow(sim, aster)).toBe(true);
    expect(sim.mortarOverdrive.match?.pids).not.toContain(briar);
    expect(sim.mortarOverdrive.match?.pids[0]).toBe(aster);
  });
});
