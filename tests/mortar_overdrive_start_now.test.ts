// Start now and the queue start readout. Start now is the backfill on demand:
// any queued pilot may press it, and it seats the queue head (up to a grid, in
// queue order) on the public lane with house pilots at the backfill tier in the
// open seats, through the backfill's own seat. The readout tells a queued viewer
// who takes the grid and how long until the backfill fills it, from the SAME
// deadline the backfill seats on.

import { describe, expect, it, vi } from 'vitest';
import {
  MORTAR_OVERDRIVE_BACKFILL_TICKS,
  MORTAR_OVERDRIVE_BACKFILL_TIER,
  mortarOverdriveBackfillAt,
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
    // The readout says why the button is refused.
    const start = sim.mortarOverdriveInfoFor(waiter).start;
    expect(start?.laneBusy).toBe(true);
    expect(start?.startsInTicks).toBeNull();
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

/** The shared-stream values `act` draws, in order. */
function drawsOf(sim: Sim, act: () => void): number[] {
  const seen: number[] = [];
  sim.rng.setObserver((value) => seen.push(value));
  try {
    act();
  } finally {
    sim.rng.setObserver(null);
  }
  return seen;
}

describe('Mortar Overdrive Start now: shared-stream cost', () => {
  it('draws exactly one value, the competition circuit, when it seats a grid', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(aster);
    sim.tick();
    const draws = drawsOf(sim, () => {
      expect(startMortarOverdriveNow(sim, aster)).toBe(true);
    });
    expect(draws).toHaveLength(1);
  });

  it('draws nothing on every refusal: not queued, lane busy, in combat, dead', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const stranger = addAt(sim, 'warrior', 'Aster', -5, -40);
    expect(drawsOf(sim, () => startMortarOverdriveNow(sim, stranger))).toEqual([]);

    const fighter = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(fighter);
    fighting(sim, fighter);
    expect(drawsOf(sim, () => startMortarOverdriveNow(sim, fighter))).toEqual([]);

    const fallen = addAt(sim, 'rogue', 'Cass', 13, -40);
    sim.mortarOverdriveQueueJoin(fallen);
    const e = sim.entities.get(fallen);
    if (!e) throw new Error('missing pilot');
    e.dead = true;
    expect(drawsOf(sim, () => startMortarOverdriveNow(sim, fallen))).toEqual([]);

    const racer = addAt(sim, 'priest', 'Dell', 17, -40);
    sim.mortarOverdriveQueueJoin(racer);
    sim.mortarOverdrive.queue = [racer];
    expect(startMortarOverdriveNow(sim, racer)).toBe(true);
    const waiter = addAt(sim, 'warrior', 'Eryn', 21, -40);
    sim.mortarOverdriveQueueJoin(waiter);
    expect(drawsOf(sim, () => startMortarOverdriveNow(sim, waiter))).toEqual([]);
    expect(sim.mortarOverdrive.queue).toContain(waiter);
  });
});

describe('Mortar Overdrive Start now: who the grid goes to', () => {
  it('passes over a head pilot in combat, who keeps their place, and seats the presser', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const head = addAt(sim, 'warrior', 'Aster', -5, -40);
    const presser = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(head);
    sim.mortarOverdriveQueueJoin(presser);
    sim.tick();
    fighting(sim, head);
    expect(startMortarOverdriveNow(sim, presser)).toBe(true);
    expect(sim.mortarOverdrive.match?.pids).toContain(presser);
    expect(sim.mortarOverdrive.match?.pids).not.toContain(head);
    expect(sim.mortarOverdrive.queue.indexOf(head)).toBe(0);
  });

  it('never lets a stale ineligible pilot at the head cost an eligible one their seat', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const pids = ['Aster', 'Briar', 'Cass', 'Dell', 'Eryn'].map((name, i) =>
      addAt(sim, 'warrior', name, -5 + i * 4, -40),
    );
    // All five join between ticks, so no queue pop has seated four of them,
    // and the head dies before any prune has run.
    for (const pid of pids) sim.mortarOverdriveQueueJoin(pid);
    const head = sim.entities.get(pids[0] as number);
    if (!head) throw new Error('missing pilot');
    head.dead = true;
    expect(startMortarOverdriveNow(sim, pids[4] as number)).toBe(true);
    // The four eligible pilots behind the head take the whole grid.
    expect(sim.mortarOverdrive.match?.pids.slice(0, 4)).toEqual(pids.slice(1));
  });
});

describe('Mortar Overdrive queue start readout', () => {
  it('is absent for a viewer who is not queued', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    expect('start' in sim.mortarOverdriveInfoFor(aster)).toBe(false);
  });

  it('names the queue head in order, marks the viewer, and counts down to the backfill', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    const briar = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(aster);
    for (let i = 0; i < 40; i++) sim.tick();
    sim.mortarOverdriveQueueJoin(briar);
    sim.tick();
    const start = sim.mortarOverdriveInfoFor(briar).start;
    expect(start?.seats).toEqual([
      { name: 'Aster', you: false },
      { name: 'Briar', you: true },
    ]);
    expect(start?.backfill).toBe(true);
    expect(start?.laneBusy).toBe(false);
    // The OLDEST waiter's clock: Briar races on Aster's deadline, not their own.
    const joined = sim.mortarOverdrive.queuedAtTick.get(aster) as number;
    expect(start?.startsInTicks).toBe(joined + MORTAR_OVERDRIVE_BACKFILL_TICKS - sim.tickCount);
  });

  it('announces the very tick the backfill seats the grid on', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(aster);
    sim.tick();
    const left = sim.mortarOverdriveInfoFor(aster).start?.startsInTicks as number;
    for (let i = 0; i < left - 1; i++) sim.tick();
    expect(sim.mortarOverdrive.match).toBeNull();
    expect(sim.mortarOverdriveInfoFor(aster).start?.startsInTicks).toBe(1);
    sim.tick();
    expect(sim.mortarOverdrive.match?.pids[0]).toBe(aster);
  });

  it('has no clock offline, where house pilots never come on their own', () => {
    const sim = makeWorld();
    const aster = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(aster);
    const start = sim.mortarOverdriveInfoFor(aster).start;
    expect(start).toEqual({
      seats: [{ name: 'Aster', you: true }],
      startsInTicks: null,
      laneBusy: false,
      backfill: false,
    });
  });

  it('caps the seats at a grid and holds a full grid off the backfill clock', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const pids = ['Aster', 'Briar', 'Cass', 'Dell', 'Eryn'].map((name, i) =>
      addAt(sim, 'warrior', name, -5 + i * 4, -40),
    );
    // Queue them while a race holds the lane, so the full grid stays queued.
    const racer = addAt(sim, 'mage', 'Fen', 30, -40);
    sim.mortarOverdriveQueueJoin(racer);
    startMortarOverdriveNow(sim, racer);
    for (const pid of pids) sim.mortarOverdriveQueueJoin(pid);
    const start = sim.mortarOverdriveInfoFor(pids[4] as number).start;
    expect(start?.seats.map((seat) => seat.name)).toEqual(['Aster', 'Briar', 'Cass', 'Dell']);
    expect(start?.seats.some((seat) => seat.you)).toBe(false);
    expect(start?.laneBusy).toBe(true);
  });

  it('computes the deadline from the oldest waiter and none for an empty or full grid', () => {
    const joined = new Map([
      [1, 100],
      [2, 40],
      [3, 70],
    ]);
    expect(mortarOverdriveBackfillAt([1, 2], joined, 200)).toBe(
      40 + MORTAR_OVERDRIVE_BACKFILL_TICKS,
    );
    expect(mortarOverdriveBackfillAt([], joined, 200)).toBeNull();
    expect(mortarOverdriveBackfillAt([1, 2, 3, 4], joined, 200)).toBeNull();
    // A waiter with no join tick counts as joining now.
    expect(mortarOverdriveBackfillAt([9], joined, 200)).toBe(200 + MORTAR_OVERDRIVE_BACKFILL_TICKS);
  });
});
