// A pilot seated in a Mortar Overdrive heat (loading lobby, countdown or race)
// never reaches Thornhollow Fields: the queue join refuses them, a leader's
// party press refuses the party, and the queue pop and the backfill sweep
// never offer them a seat. The reverse direction (a Thornhollow queuer is never
// seated in a heat) is mortarOverdriveHeldElsewhere, pinned in
// mortar_overdrive_busy.test.ts and re-checked here from the heat's side.

import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  mortarOverdriveStartMatch,
} from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import {
  BG_MIN_LEVEL,
  BG_TEAM_SIZE,
  bgResolveDesertion,
  bgRespond,
  updateBattleground,
} from '../src/sim/social/battleground';
import { bgProposalFor, bgProposalPids } from '../src/sim/social/battleground_proposal';
import type { SimEvent } from '../src/sim/types';
import { addAt, makeWorld, readyAllRacers } from './mortar_overdrive_util';

const BUSY = 'You cannot queue for Thornhollow Fields while in another match.';
const PARTY_BUSY = 'A party member is already queued or in a match.';

type Phase = 'loading' | 'countdown' | 'racing';
const PHASES: readonly Phase[] = ['loading', 'countdown', 'racing'];

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`missing ${label}`);
  return value;
}

function champion(sim: Sim, name: string, x: number, z = -40): number {
  const pid = addAt(sim, 'warrior', name, x, z);
  required(sim.entities.get(pid), 'entity').level = BG_MIN_LEVEL;
  return pid;
}

/** Four champions seated in the public heat, driven to `phase` by the real
 *  lobby ready and countdown. */
function seatHeat(sim: Sim, phase: Phase): number[] {
  const pids = [
    champion(sim, 'Aster', -5, -40),
    champion(sim, 'Briar', 7, -42),
    champion(sim, 'Cass', -9, -38),
    champion(sim, 'Dell', 11, -44),
  ];
  expect(mortarOverdriveStartMatch(sim.ctx, pids)).toBe(true);
  const match = required(sim.mortarOverdrive.match, 'heat');
  if (phase !== 'loading') {
    readyAllRacers(sim);
    sim.tick();
    expect(match.phase).toBe('countdown');
  }
  if (phase === 'racing') {
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS; i++) sim.tick();
  }
  expect(match.phase).toBe(phase);
  for (const pid of pids) expect(sim.players.get(pid)?.mortarOverdriveMatchId).toBe(match.id);
  return pids;
}

function errorsFor(events: SimEvent[], pid: number): string[] {
  return events
    .filter((e): e is Extract<SimEvent, { type: 'error' }> => e.type === 'error' && e.pid === pid)
    .map((e) => e.text);
}

function queued(sim: Sim, pid: number): boolean {
  return sim.ctx.bgQueue.some((g) => g.pids.includes(pid));
}

describe('Thornhollow Fields refuses a pilot seated in a Mortar Overdrive heat', () => {
  it.each(PHASES)('refuses the queue join during the %s phase', (phase) => {
    const sim = makeWorld();
    const [racer] = seatHeat(sim, phase);
    sim.drainEvents();
    sim.bgQueueJoin(racer);
    expect(queued(sim, racer)).toBe(false);
    expect(errorsFor(sim.drainEvents(), racer)).toEqual([BUSY]);
  });

  it.each(PHASES)('refuses a leader queueing a party with a racer in the %s phase', (phase) => {
    const sim = makeWorld();
    const [racer] = seatHeat(sim, phase);
    const leader = champion(sim, 'Lead', 0, -60);
    sim.partyInvite(racer, leader);
    sim.partyAccept(racer);
    expect(sim.ctx.partyOf(leader)?.members).toContain(racer);
    sim.drainEvents();
    sim.bgQueueJoin(leader);
    expect(queued(sim, leader)).toBe(false);
    expect(queued(sim, racer)).toBe(false);
    expect(errorsFor(sim.drainEvents(), leader)).toEqual([PARTY_BUSY]);
  });

  it.each(PHASES)('drops a queued racer at the pop during the %s phase', (phase) => {
    const sim = makeWorld();
    const [racer] = seatHeat(sim, phase);
    // Unreachable through the entry points above; forced so the pop's own
    // hygiene is what is tested. The racer is the OLDEST group, so without it
    // they would be picked first.
    sim.ctx.bgQueue.unshift({ pids: [racer], waited: 60 });
    const others: number[] = [];
    for (let i = 0; i < BG_TEAM_SIZE * 2; i++) {
      const pid = champion(sim, `Q${i}`, (i % 5) * 2 - 4, -60 - Math.floor(i / 5) * 2);
      sim.bgQueueJoin(pid);
      others.push(pid);
    }
    sim.drainEvents();
    updateBattleground(sim.ctx);
    const events = sim.drainEvents();
    expect(bgProposalFor(sim.ctx, racer)).toBeNull();
    expect(queued(sim, racer)).toBe(false);
    expect(events).toContainEqual({ type: 'bgUnqueued', pid: racer });
    // The pop still ran for everyone else.
    const proposal = required(bgProposalFor(sim.ctx, others[0]), 'proposal');
    expect(bgProposalPids(proposal).sort((a, b) => a - b)).toEqual(others);
    for (const pid of others) bgRespond(sim.ctx, true, pid);
    expect(sim.bgMatchFor(racer)).toBeNull();
    expect(sim.bgMatchFor(others[0])).not.toBeNull();
    expect(sim.players.get(racer)?.mortarOverdriveMatchId).not.toBeNull();
  });

  it('never offers a racer a backfill seat, and offers the next solo instead', () => {
    const sim = makeWorld();
    const fighters: number[] = [];
    for (let i = 0; i < BG_TEAM_SIZE * 2; i++) {
      const pid = champion(sim, `F${i}`, (i % 5) * 2 - 4, -60 - Math.floor(i / 5) * 2);
      sim.bgQueueJoin(pid);
      fighters.push(pid);
    }
    updateBattleground(sim.ctx);
    for (const pid of fighters) bgRespond(sim.ctx, true, pid);
    const match = required(sim.bgMatchFor(fighters[0]), 'bg match');
    const [racer] = seatHeat(sim, 'racing');
    const solo = champion(sim, 'Solo', 20, -60);
    sim.ctx.bgQueue.push({ pids: [racer], waited: 60 });
    sim.bgQueueJoin(solo);
    match.state = 'active';
    match.timer = 0;
    bgResolveDesertion(sim.ctx, match.teams[0][BG_TEAM_SIZE - 1]);
    expect(match.teams[0]).toHaveLength(BG_TEAM_SIZE - 1);
    updateBattleground(sim.ctx);
    expect(bgProposalFor(sim.ctx, racer)).toBeNull();
    expect(bgProposalFor(sim.ctx, solo)?.backfill?.match).toBe(match);
    bgRespond(sim.ctx, true, solo);
    expect(match.teams[0]).toContain(solo);
    expect(match.teams[0]).not.toContain(racer);
    expect(sim.bgMatchFor(racer)).toBeNull();
  });

  it('leaves a champion who is not racing free to queue', () => {
    const sim = makeWorld();
    seatHeat(sim, 'racing');
    const bystander = champion(sim, 'Bystander', 0, -60);
    sim.drainEvents();
    sim.bgQueueJoin(bystander);
    expect(queued(sim, bystander)).toBe(true);
    expect(errorsFor(sim.drainEvents(), bystander)).toEqual([]);
  });

  it('never seats a Thornhollow queuer in a heat, so nothing needs unqueueing', () => {
    const sim = makeWorld();
    const pids = [
      champion(sim, 'Aster', -5, -40),
      champion(sim, 'Briar', 7, -42),
      champion(sim, 'Cass', -9, -38),
      champion(sim, 'Dell', 11, -44),
    ];
    sim.bgQueueJoin(pids[0]);
    expect(queued(sim, pids[0])).toBe(true);
    expect(mortarOverdriveStartMatch(sim.ctx, pids)).toBe(false);
    expect(sim.players.get(pids[0])?.mortarOverdriveMatchId).toBeNull();
    expect(queued(sim, pids[0])).toBe(true);
  });
});
