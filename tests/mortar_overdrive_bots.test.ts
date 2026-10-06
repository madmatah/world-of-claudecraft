// The Mortar Overdrive house pilots: lifecycle (spawn, seat, reap), the private
// practice copies of the circuit they race on, and the one test that proves the
// whole stack works together, which is the bot driving a full practice race of
// the real circuit through the real vehicle kernel.
//
// The Practice path and the online backfill path share every line below the
// entry point, so a failure here is a failure of both.

import { describe, expect, it, vi } from 'vitest';
import { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/mortar_overdrive/circuits';
import { MORTAR_OVERDRIVE_BOT_NAMES } from '../src/sim/content/mortar_overdrive/kit';
import {
  MORTAR_OVERDRIVE_BACKFILL_TICKS,
  MORTAR_OVERDRIVE_BACKFILL_TIER,
} from '../src/sim/mortar_overdrive/bots';
import {
  MORTAR_OVERDRIVE_DRIVER_TIERS,
  type MortarOverdriveDriverTier,
} from '../src/sim/mortar_overdrive/driver';
import {
  MORTAR_OVERDRIVE_GRID_SIZE,
  MORTAR_OVERDRIVE_LANE_DZ,
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOffset,
  mortarOverdrivePracticeLanes,
} from '../src/sim/mortar_overdrive/layout';
import {
  MORTAR_OVERDRIVE_CHASE_TICKS,
  MORTAR_OVERDRIVE_COUNTDOWN_TICKS,
  MORTAR_OVERDRIVE_RETURN_TICKS,
  type MortarOverdriveMatch,
  mortarOverdriveFreePracticeSlot,
  mortarOverdriveMatchOf,
} from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import { addAt, makeWorld, readyAllRacers } from './mortar_overdrive_util';

/** Ticks a full race may take: the countdown plus the 180 s limit, and a beat
 *  for the result tableau to tear down. */
const RACE_TICKS = MORTAR_OVERDRIVE_COUNTDOWN_TICKS + 180 * 20 + 200;
/** The canonical circuit's world x, which every copy shares. */
const MORTAR_OVERDRIVE_X = 113_700;

function botPidsOf(sim: Sim): number[] {
  return [...sim.mortarOverdrive.bots.keys()];
}

function matchOf(sim: Sim, pid: number): MortarOverdriveMatch {
  const match = mortarOverdriveMatchOf(sim.ctx, pid);
  if (!match) throw new Error(`no live race for pid ${pid}`);
  return match;
}

/** Every house pilot on the grid with `pid`, in seat order. */
function botsIn(sim: Sim, pid: number): number[] {
  return matchOf(sim, pid).pids.filter((p) => sim.mortarOverdrive.bots.has(p));
}

/** The first house pilot on the grid with `pid`. */
function botIn(sim: Sim, pid: number): number {
  const bots = botsIn(sim, pid);
  if (bots.length === 0) throw new Error('no house pilot in that race');
  return bots[0];
}

function practiceWorld(tier: MortarOverdriveDriverTier = 'driver', cfg = {}) {
  const sim = makeWorld(cfg);
  const human = addAt(sim, 'warrior', 'Aster', -5, -40);
  sim.mortarOverdrivePracticeStart(tier, human);
  // The pilot's client has prepared the circuit: the lobby closes on the next tick.
  readyAllRacers(sim);
  return { sim, human };
}

describe('Mortar Overdrive practice: one press, one race', () => {
  it('seats a lone player against a full grid of house pilots, with no queue', () => {
    const { sim, human } = practiceWorld('rookie');
    const match = matchOf(sim, human);
    expect(sim.mortarOverdrive.queue).toEqual([]);
    const bots = botPidsOf(sim);
    expect(bots).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    expect(match.pids).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    expect(match.gridSize).toBe(MORTAR_OVERDRIVE_GRID_SIZE);
    for (const bot of bots) {
      expect(match.pids).toContain(bot);
      expect(sim.mortarOverdrive.bots.get(bot)).toBe('rookie');
    }
    // The pilots race under house names, spliced verbatim like any player name.
    // One name per grid slot, so a four-row strip reads as a field of rivals
    // rather than as one name with numbers after it.
    expect(MORTAR_OVERDRIVE_BOT_NAMES.length).toBeGreaterThanOrEqual(MORTAR_OVERDRIVE_GRID_SIZE);
    expect(MORTAR_OVERDRIVE_BOT_NAMES[0]).toBe('Mat Driftwright');
    // These names SIZE the live standings panel (the 240px in the
    // `#mortar-overdrive-standings` rule): the row shows the full name beside the
    // Bot tag, and a longer house name than the ones the width was measured
    // from puts every rival row back behind an ellipsis, which is the bug that
    // width exists to fix. A new pilot past this bound needs the panel remeasured.
    for (const name of MORTAR_OVERDRIVE_BOT_NAMES) expect(name.length).toBeLessThanOrEqual(16);
    const names = bots.map((pid) => sim.players.get(pid)?.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(MORTAR_OVERDRIVE_BOT_NAMES).toContain(name);
    // And it is a PRIVATE race: the public circuit is untouched.
    expect(sim.mortarOverdrive.match).toBeNull();
    expect(sim.mortarOverdrive.practices).toEqual([match]);
  });

  it('reports every rival as a house pilot, and at which tier', () => {
    const { sim, human } = practiceWorld('ace');
    const info = sim.mortarOverdriveInfoFor(human);
    const standings = info.match?.standings ?? [];
    expect(standings).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    expect(standings.filter((row) => row.botTier === 'ace')).toHaveLength(
      MORTAR_OVERDRIVE_GRID_SIZE - 1,
    );
    expect(info.match?.me.botTier).toBeNull();
    expect(info.match?.practice).toBe(true);
    // Already racing, so no second practice race is on offer to this viewer.
    expect(info.practiceAvailable).toBe(false);
  });

  it('takes a waiting player out of the queue rather than leaving them in it', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(human);
    expect(sim.mortarOverdrive.queue).toEqual([human]);
    sim.mortarOverdrivePracticeStart('driver', human);
    expect(sim.mortarOverdrive.queue).toEqual([]);
    expect(matchOf(sim, human).practice).not.toBeNull();
  });

  it('refuses a player already racing, and leaks no pilot doing it', () => {
    const { sim, human } = practiceWorld('driver');
    const before = sim.players.size;
    sim.mortarOverdrivePracticeStart('ace', human);
    expect(sim.players.size).toBe(before);
    expect(botPidsOf(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
  });

  it('refuses a player in combat, says why, and spawns no pilot doing it', () => {
    // An instant seat would drop combat and strip every debuff: Practice must
    // never be the escape button from a fight.
    const sim = makeWorld();
    const fighter = addAt(sim, 'warrior', 'Aster', -5, -40);
    const e = sim.entities.get(fighter);
    if (!e) throw new Error('missing fighter');
    e.inCombat = true;
    e.combatTimer = 0;
    const before = sim.players.size;
    sim.drainEvents();
    sim.mortarOverdrivePracticeStart('driver', fighter);
    expect(mortarOverdriveMatchOf(sim.ctx, fighter)).toBeNull();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.players.size).toBe(before);
    expect(e.inCombat).toBe(true);
    expect(sim.drainEvents()).toContainEqual({
      type: 'error',
      text: "You can't do that while in combat.",
      pid: fighter,
    });
  });

  it('holds the online backfill for a waiter in combat, spawning nobody meanwhile', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const waiter = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(waiter);
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS - 5; i++) sim.tick();
    const e = sim.entities.get(waiter);
    if (!e) throw new Error('missing waiter');
    let spawned = 0;
    const addPlayer = sim.addPlayer.bind(sim);
    sim.addPlayer = ((...args: Parameters<Sim['addPlayer']>) => {
      spawned++;
      return addPlayer(...args);
    }) as Sim['addPlayer'];
    for (let i = 0; i < 40; i++) {
      e.inCombat = true;
      e.combatTimer = 0;
      sim.tick();
    }
    expect(spawned).toBe(0);
    expect(sim.mortarOverdrive.match).toBeNull();
    expect(sim.mortarOverdrive.queue).toEqual([waiter]);
    for (let i = 0; i < 6 * 20 && !sim.mortarOverdrive.match; i++) sim.tick();
    expect(sim.mortarOverdrive.match?.pids).toContain(waiter);
    expect(spawned).toBe(MORTAR_OVERDRIVE_GRID_SIZE - 1);
  });

  it('backfills the waiters behind one still in combat, who keeps their place', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const fighter = addAt(sim, 'warrior', 'Aster', -5, -40);
    const idle = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdriveQueueJoin(fighter);
    sim.mortarOverdriveQueueJoin(idle);
    const e = sim.entities.get(fighter);
    if (!e) throw new Error('missing fighter');
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS + 20 && !sim.mortarOverdrive.match; i++) {
      e.inCombat = true;
      e.combatTimer = 0;
      sim.tick();
    }
    expect(sim.mortarOverdrive.match?.pids).toContain(idle);
    expect(sim.mortarOverdrive.match?.pids).not.toContain(fighter);
    expect(botPidsOf(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    expect(sim.mortarOverdrive.queue).toEqual([fighter]);
  });

  it('refuses a player who cannot race, and spawns no pilot doing it', () => {
    const sim = makeWorld();
    const dead = addAt(sim, 'warrior', 'Aster', -5, -40);
    const e = sim.entities.get(dead);
    if (e) e.dead = true;
    const before = sim.players.size;
    // Refused before any house pilot is spawned, not spawned and reaped again.
    const spawns = vi.spyOn(sim, 'addPlayer');
    sim.mortarOverdrivePracticeStart('driver', dead);
    expect(spawns).not.toHaveBeenCalled();
    expect(mortarOverdriveMatchOf(sim.ctx, dead)).toBeNull();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.players.size).toBe(before);
  });
});

describe('Mortar Overdrive practice: nobody ever waits on anybody', () => {
  it('starts a practice race while the public circuit is mid-race', () => {
    // The whole point of the copies: a queued race owns circuit 0 and a practice
    // lap is simply somewhere else, so neither can ever block the other.
    const sim = makeWorld();
    const grid = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Queued${i}`, -5 + i * 4, -40),
    );
    for (const pid of grid) sim.mortarOverdriveQueueJoin(pid);
    sim.tick();
    expect(sim.mortarOverdrive.match?.pids).toEqual(grid);

    const solo = addAt(sim, 'rogue', 'Cass', 30, -40);
    expect(sim.mortarOverdriveInfoFor(solo).practiceAvailable).toBe(true);
    sim.mortarOverdrivePracticeStart('ace', solo);
    expect(matchOf(sim, solo).practice?.ownerPid).toBe(solo);
    // The public race is untouched and still has its whole grid.
    expect(sim.mortarOverdrive.match?.pids).toEqual(grid);
  });

  it('gives concurrent pilots distinct names, so a whisper still resolves', () => {
    const sim = makeWorld();
    const pids = [0, 1].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.mortarOverdrivePracticeStart('rookie', pid);
    const names = botPidsOf(sim).map((pid) => sim.players.get(pid)?.name);
    expect(names[0]).toBe('Mat Driftwright');
    expect(names).toHaveLength(2 * (MORTAR_OVERDRIVE_GRID_SIZE - 1));
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every concurrent practice race its own copy of the circuit', () => {
    const sim = makeWorld();
    const pids = [0, 1, 2].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.mortarOverdrivePracticeStart('rookie', pid);
    const slots = pids.map((pid) => matchOf(sim, pid).practice?.slot);
    expect(new Set(slots).size).toBe(pids.length);
    // Every one is a private lane OF THE PRACTICE CIRCUIT. Lane 0 is one of
    // them now that the practice circuit no longer serves competition, so the
    // claim is membership, never "not zero".
    const practiceLanes = mortarOverdrivePracticeLanes().map((lane) => lane.index);
    expect(slots.every((slot) => practiceLanes.includes(slot ?? -1))).toBe(true);
    // And each racer really stands on their own copy, far from the others.
    const where = pids.map((pid) => {
      const e = sim.entities.get(pid);
      if (!e) throw new Error('no racer');
      return mortarOverdriveLaneAt(e.pos.x, e.pos.z)?.index ?? null;
    });
    expect(where).toEqual(slots);
  });

  it('hands a copy back when a practice race ends, and refuses once none are left', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: GARDEN_CIRCUIT.practiceCopies }, (_, i) =>
      addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40),
    );
    for (const pid of pids) sim.mortarOverdrivePracticeStart('rookie', pid);
    expect(sim.mortarOverdrive.practices).toHaveLength(GARDEN_CIRCUIT.practiceCopies);

    // Every copy is out: the next player is told so rather than silently failing.
    const late = addAt(sim, 'mage', 'Late', 30, -40);
    expect(sim.mortarOverdriveInfoFor(late).practiceAvailable).toBe(false);
    sim.mortarOverdrivePracticeStart('rookie', late);
    expect(mortarOverdriveMatchOf(sim.ctx, late)).toBeNull();

    // One race ends: its copy comes back and the waiting player gets it.
    const freed = matchOf(sim, pids[0]).practice?.slot;
    sim.mortarOverdriveForfeit(pids[0]);
    for (let i = 0; i < 200 && mortarOverdriveMatchOf(sim.ctx, pids[0]); i++) sim.tick();
    expect(sim.mortarOverdriveInfoFor(late).practiceAvailable).toBe(true);
    sim.mortarOverdrivePracticeStart('rookie', late);
    expect(matchOf(sim, late).practice?.slot).toBe(freed);
  });

  it('keeps every copy far enough apart to stay private', () => {
    // Interest scoping is ~120 yd, so the copies have to be further apart than
    // that or a practice lap would appear in a stranger's snapshot.
    expect(MORTAR_OVERDRIVE_LANE_DZ).toBeGreaterThan(300);
    // And the region test claims each copy, with clear plane between them.
    for (const lane of mortarOverdrivePracticeLanes()) {
      const z = lane.index * MORTAR_OVERDRIVE_LANE_DZ;
      expect(
        mortarOverdriveLaneAt(MORTAR_OVERDRIVE_X, z)?.index,
        `centre of copy ${lane.index}`,
      ).toBe(lane.index);
      expect(mortarOverdriveLaneAt(MORTAR_OVERDRIVE_X, z)?.circuit.id).toBe(GARDEN_CIRCUIT.id);
      expect(
        mortarOverdriveLaneAt(MORTAR_OVERDRIVE_X, z + MORTAR_OVERDRIVE_LANE_DZ / 2),
      ).toBeNull();
    }
    expect(mortarOverdrivePracticeLanes()).toHaveLength(GARDEN_CIRCUIT.practiceCopies);
    expect(
      mortarOverdriveLaneAt(
        MORTAR_OVERDRIVE_X,
        MORTAR_OVERDRIVE_LANES.length * MORTAR_OVERDRIVE_LANE_DZ,
      ),
    ).toBeNull();
  });
});

describe('Mortar Overdrive house pilots: no entity ever leaks', () => {
  // One rule reaps them (seated in no live race), so every exit path is the
  // same path. Each arm asserts on the ROSTER, not just the marker: the marker
  // going quiet while the entity survives is exactly the leak.
  function assertReaped(sim: Sim, players: number, entities: number): void {
    sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.players.size).toBe(players);
    expect(sim.entities.size).toBe(entities);
  }

  it('takes the pilot home when the human forfeits and the tableau clears', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const players = sim.players.size;
    const entities = sim.entities.size;
    sim.mortarOverdrivePracticeStart('driver', human);
    expect(sim.players.size).toBe(players + MORTAR_OVERDRIVE_GRID_SIZE - 1);
    sim.mortarOverdriveForfeit(human);
    // The result tableau holds the race open for its return countdown; the
    // pilots go home only once the race itself is torn down. The human quitting
    // leaves nothing but house pilots on the grid, which ends it: nobody is
    // watching a practice race its owner walked out of.
    for (let i = 0; i < 400 && sim.mortarOverdrive.practices.length > 0; i++) sim.tick();
    assertReaped(sim, players, entities);
    expect(sim.mortarOverdrive.practices).toEqual([]);
  });

  it('takes the pilot home when the human disconnects mid-race', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const players = sim.players.size;
    const entities = sim.entities.size;
    sim.mortarOverdrivePracticeStart('driver', human);
    sim.removePlayer(human);
    for (let i = 0; i < 400 && sim.mortarOverdrive.practices.length > 0; i++) sim.tick();
    expect(sim.mortarOverdrive.practices).toEqual([]);
    // The human left too, so the roster settles one under where it started.
    assertReaped(sim, players - 1, entities - 1);
  });

  it('takes the pilot home when the race runs out of time', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const players = sim.players.size;
    const entities = sim.entities.size;
    sim.mortarOverdrivePracticeStart('rookie', human);
    const match = matchOf(sim, human);
    // Jump the clock to the deadline rather than ticking three minutes of world.
    match.deadlineTick = sim.tickCount + 1;
    match.phase = 'racing';
    for (let i = 0; i < 400 && mortarOverdriveMatchOf(sim.ctx, human); i++) sim.tick();
    assertReaped(sim, players, entities);
  });

  it('reaps only the pilot whose race ended, never a parallel one', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdrivePracticeStart('rookie', a);
    sim.mortarOverdrivePracticeStart('ace', b);
    const survivors = botsIn(sim, b);
    expect(survivors).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    sim.mortarOverdriveForfeit(a);
    for (let i = 0; i < 400 && mortarOverdriveMatchOf(sim.ctx, a); i++) sim.tick();
    expect(botPidsOf(sim).sort()).toEqual([...survivors].sort());
    for (const survivor of survivors) expect(matchOf(sim, b).pids).toContain(survivor);
  });

  it('ticks every live race on the tick one of them is torn down', () => {
    // The races are walked in place: a race torn down by its own tick is
    // spliced out under the walk, and the one behind it must still get its tick.
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.mortarOverdrivePracticeStart('rookie', a);
    sim.mortarOverdrivePracticeStart('rookie', b);
    const first = matchOf(sim, a);
    const second = matchOf(sim, b);
    expect(sim.mortarOverdrive.practices).toEqual([first, second]);
    sim.mortarOverdriveForfeit(a);
    expect(first.phase).toBe('finished');
    const teardownTick = (first.finishTick ?? 0) + MORTAR_OVERDRIVE_RETURN_TICKS;
    second.phase = 'countdown';
    second.goTick = teardownTick;
    while (sim.tickCount < teardownTick) sim.tick();
    expect(sim.mortarOverdrive.practices).toEqual([second]);
    expect(second.phase).toBe('racing');
    expect(botsIn(sim, b)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    expect(botPidsOf(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
  });
});

describe('Mortar Overdrive online backfill', () => {
  it('stays off unless the host asks for it', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(human);
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS + 40; i++) sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.mortarOverdrive.match).toBeNull();
  });

  it('never sends a pilot when four humans fill the grid themselves', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const grid = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Queued${i}`, -5 + i * 4, -40),
    );
    for (const pid of grid) sim.mortarOverdriveQueueJoin(pid);
    sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.mortarOverdrive.match?.pids).toEqual(grid);
    // And it stays that way past the wait: a full grid is never topped up.
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS + 40; i++) sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
  });

  it('sends pilots out only after the wait, and only for the empty seats', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(a);
    const joinedAt = sim.tickCount;
    // Well short of the wait: still alone, still waiting.
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS - 20; i++) sim.tick();
    expect(botPidsOf(sim), `at tick ${sim.tickCount - joinedAt}`).toEqual([]);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(botPidsOf(sim)).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
    expect(sim.mortarOverdrive.match?.pids).toContain(a);
    expect(sim.mortarOverdrive.match?.pids).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    for (const bot of botPidsOf(sim)) {
      expect(sim.mortarOverdrive.bots.get(bot)).toBe(MORTAR_OVERDRIVE_BACKFILL_TIER);
    }
    expect(sim.mortarOverdrive.queue).toEqual([]);
    // A backfilled race is the PUBLIC race, not a practice copy: this player
    // queued for a real one and is getting one.
    expect(sim.mortarOverdrive.match?.practice).toBeNull();
    expect(sim.mortarOverdrive.practices).toEqual([]);
  });

  it('costs the shared stream exactly one draw, on the tick it seats the grid', () => {
    // The backfill is the ONLY path that draws a circuit in production: a
    // practice start takes the practice circuit outright and `/dev overdrive` is
    // told its circuit, so both skip the draw. Everything else about the Mortar Overdrive
    // is deterministic with zero rng, which is what makes the count readable
    // here: the whole tick's draw cost is this one draw.
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(human);
    const drawsOnTick = (): number[] => {
      const seen: number[] = [];
      sim.rng.setObserver((value) => seen.push(value));
      try {
        sim.tick();
      } finally {
        sim.rng.setObserver(null);
      }
      return seen;
    };
    let seatingDraws: number[] = [];
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS + 60; i++) {
      const before = sim.mortarOverdrive.match;
      const draws = drawsOnTick();
      if (!before && sim.mortarOverdrive.match) {
        seatingDraws = draws;
        break;
      }
      // Every tick before the grid is seated is free, which is what makes the
      // seating tick's single draw attributable to the draw site.
      expect(draws, `tick ${i} drew before the grid was seated`).toEqual([]);
    }
    expect(sim.mortarOverdrive.match, 'the backfill never seated a grid').not.toBeNull();
    expect(seatingDraws).toHaveLength(1);
  });

  it('draws one value per box taken over a whole race, and nothing for the house pilots', () => {
    // The phase's documented budget (updateMortarOverdrivePhase): one draw per box
    // that changes hands, all of it inside the Mortar Overdrive phase, while the bot half
    // (each pilot's Ground Blast through castAbility, the reap through
    // removePlayer) draws nothing. The test world has no ambient spawns, so any
    // other draw on these ticks would be the race's.
    let pending = 0;
    let phaseDraws = 0;
    let otherDraws = 0;
    const sim = makeWorld({
      perfLap: (name) => {
        if (name === 'mortarOverdrive') phaseDraws += pending;
        else otherDraws += pending;
        pending = 0;
      },
    });
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdrivePracticeStart('ace', human);
    readyAllRacers(sim);
    sim.rng.setObserver(() => {
      pending++;
    });
    let takes = 0;
    let shots = 0;
    try {
      for (let i = 0; i < RACE_TICKS && sim.mortarOverdrive.practices.length > 0; i++) {
        const phaseBefore = phaseDraws;
        const events = sim.tick();
        otherDraws += pending;
        pending = 0;
        const taken = events.filter((ev) => ev.type === 'mortarOverdrivePickup').length;
        takes += taken;
        shots += events.filter((ev) => ev.type === 'mortarOverdriveGroundBlastFired').length;
        expect(phaseDraws - phaseBefore, `tick ${sim.tickCount}`).toBe(taken);
      }
    } finally {
      sim.rng.setObserver(null);
    }
    expect(sim.mortarOverdrive.practices, 'the race never ended').toEqual([]);
    expect(botPidsOf(sim), 'the house pilots were never reaped').toEqual([]);
    expect(shots, 'no house pilot fired').toBeGreaterThan(0);
    expect(takes, 'no box changed hands').toBeGreaterThan(0);
    expect(phaseDraws).toBe(takes);
    expect(otherDraws).toBe(0);
  });

  it('draws nothing when a practice start is refused', () => {
    // `seatWithBots` spawns its house pilots BEFORE the match module can refuse,
    // then despawns them again. Neither spawn nor despawn may draw, or a
    // refused practice press would perturb the world's draw order.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    // Hand out every practice copy, so the next press has no lane to take.
    const holders = mortarOverdrivePracticeLanes().map((_, i) =>
      addAt(sim, 'warrior', `Holder${i}`, -40 - i * 4, -40),
    );
    for (const pid of holders) sim.mortarOverdrivePracticeStart('rookie', pid);
    expect(mortarOverdriveFreePracticeSlot(sim.ctx), 'a practice copy was still free').toBeLessThan(
      0,
    );
    const seen: number[] = [];
    sim.rng.setObserver((value) => seen.push(value));
    try {
      sim.mortarOverdrivePracticeStart('ace', human);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(mortarOverdriveMatchOf(sim.ctx, human), 'the refused start seated a race').toBeNull();
    expect(seen).toEqual([]);
  });

  it('fills only the seats nobody claimed, and clocks the OLDEST waiter', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const humans = Array.from({ length: MORTAR_OVERDRIVE_GRID_SIZE - 1 }, (_, i) =>
      addAt(sim, 'warrior', `Waiter${i}`, -5 + i * 4, -40),
    );
    // The first waiter joins, then the other two arrive much later. A queue of
    // three must not wait for a fourth human forever, and the pilot at the head
    // of it must not be made to wait longer because the queue grew behind them.
    sim.mortarOverdriveQueueJoin(humans[0]);
    for (let i = 0; i < MORTAR_OVERDRIVE_BACKFILL_TICKS - 10; i++) sim.tick();
    for (const pid of humans.slice(1)) sim.mortarOverdriveQueueJoin(pid);
    expect(botPidsOf(sim)).toEqual([]);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(botPidsOf(sim)).toHaveLength(1);
    const seated = sim.mortarOverdrive.match?.pids ?? [];
    expect(seated).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    for (const pid of humans) expect(seated).toContain(pid);
    expect(sim.mortarOverdrive.queue).toEqual([]);
  });
});

describe('Mortar Overdrive race clock tuning', () => {
  it('pins the straggler chase window to its shipped literal', () => {
    // Thirty seconds at the 20 Hz tick: about a lap of struggling off the
    // racing line, so a real straggler still takes their placing and only a
    // machine nobody is driving runs the clock out. Every other reading of the
    // constant is derived, so this is the one that fails on a retune.
    expect(MORTAR_OVERDRIVE_CHASE_TICKS).toBe(600);
  });
});

describe('Mortar Overdrive house pilots: they can actually drive', () => {
  // The single most valuable test in the workstream: it proves the brain, the
  // vehicle kernel, the collision set and continuous spline progress work together,
  // ON A PRACTICE COPY, which also proves the whole frame shift is right.
  // Nothing here is mocked, and the pilot holds the same controls a human does.
  for (const tier of MORTAR_OVERDRIVE_DRIVER_TIERS) {
    it(`completes ${GARDEN_CIRCUIT.practiceLaps} practice laps at the ${tier} tier inside the time limit`, () => {
      const { sim, human } = practiceWorld(tier);
      const match = matchOf(sim, human);
      expect(match.totalLaps).toBe(GARDEN_CIRCUIT.practiceLaps);
      const bot = botIn(sim, human);
      const progress = match.progress.get(bot);
      if (!progress) throw new Error('no progress');
      let finishedAt = -1;
      for (let i = 0; i < RACE_TICKS && finishedAt < 0; i++) {
        sim.tick();
        if (progress.finishedTick !== null) finishedAt = sim.tickCount;
      }
      expect(finishedAt, `${tier} never finished`).toBeGreaterThan(0);
      expect(progress.lap).toBe(GARDEN_CIRCUIT.practiceLaps);
      // And it leads, because the human never touched a control. The race
      // itself runs on: the other two pilots are still out there, and with four
      // on the grid the fight behind the leader is the rest of the race.
      const standings = sim.mortarOverdriveInfoFor(human).match?.standings ?? [];
      expect(standings[0].botTier).toBe(tier);
      expect(sim.mortarOverdriveInfoFor(human).match?.me.position).toBe(MORTAR_OVERDRIVE_GRID_SIZE);
    });
  }

  it('seats three pilots at the chosen tier, and two identical races agree tick for tick', () => {
    const run = (): { finish: number[]; tiers: (string | null)[] } => {
      const { sim, human } = practiceWorld('ace');
      const bots = botsIn(sim, human);
      expect(bots).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE - 1);
      const progresses = bots.map((pid) => {
        const p = matchOf(sim, human).progress.get(pid);
        if (!p) throw new Error('no progress');
        return p;
      });
      const done = () => progresses.every((p) => p.finishedTick !== null);
      for (let i = 0; i < RACE_TICKS && !done(); i++) sim.tick();
      expect(done()).toBe(true);
      return {
        finish: progresses.map((p) => p.finishedTick as number),
        tiers: bots.map((pid) => sim.mortarOverdrive.bots.get(pid) ?? null),
      };
    };
    const first = run();
    expect(first.tiers).toEqual(Array(MORTAR_OVERDRIVE_GRID_SIZE - 1).fill('ace'));
    // The determinism pin 06 established, re-run at four: a private copy plus
    // three brains is still a pure function of the tick clock.
    expect(run()).toEqual(first);
  });

  it('drives a relocated copy exactly as it drives the one at the origin', () => {
    // The frame shift is either exact or it is not, and an eye watching a lap
    // could never tell. Both races are the SAME race: same tick, same pids, same
    // house pilots, same circuit. The only thing that differs is the lane the
    // second one is moved onto before the flag drops, so any drift in the shift
    // shows up as a different finishing tick.
    //
    // This used to compare a practice copy against the PUBLIC race. That premise
    // died when the practice circuit stopped serving competition: the public
    // race now runs on a different circuit, so the two are no longer comparable
    // and only the lane can vary.
    const race = (lane: number): { ticks: number; originZ: number } => {
      const sim = makeWorld();
      const human = addAt(sim, 'warrior', 'Aster', -5, -40);
      sim.tick();
      sim.mortarOverdrivePracticeStart(MORTAR_OVERDRIVE_BACKFILL_TIER, human);
      readyAllRacers(sim);
      const match = matchOf(sim, human);
      if (lane !== match.practice?.slot) {
        // Move the whole race onto another lane, before it has driven a yard:
        // the origin AND every racer shift by the same vector, which is exactly
        // what seating on that lane would have produced.
        const delta = mortarOverdriveLaneOffset(lane).z - match.origin.z;
        match.origin = { x: match.origin.x, z: match.origin.z + delta };
        if (match.practice) match.practice.slot = lane;
        for (const pid of match.pids) {
          const e = sim.entities.get(pid);
          if (!e) throw new Error('no racer');
          e.pos = { ...e.pos, z: e.pos.z + delta };
          e.prevPos = { ...e.pos };
          sim.rebucket(e);
        }
      }
      const progress = match.progress.get(botIn(sim, human));
      if (!progress) throw new Error('no progress');
      const started = sim.tickCount;
      for (let i = 0; i < RACE_TICKS && progress.finishedTick === null; i++) sim.tick();
      expect(progress.finishedTick, `lane ${lane}`).not.toBeNull();
      return { ticks: sim.tickCount - started, originZ: match.origin.z };
    };
    const lanes = mortarOverdrivePracticeLanes().map((l) => l.index);
    const atOrigin = race(lanes[0]);
    const relocated = race(lanes[lanes.length - 1]);
    expect(atOrigin.originZ).toBe(0);
    expect(relocated.originZ).toBeGreaterThan(0);
    expect(atOrigin.ticks).toBeGreaterThan(0);
    expect(relocated.ticks).toBe(atOrigin.ticks);
  });

  it('runs a harder tier no slower than a gentler one over the same race', () => {
    // The WINNING pilot of each race, not one arbitrary seat: three machines at
    // the same tier trade paint and their individual times spread, so the fair
    // comparison between tiers is how fast the tier's best lap is.
    const lapTicks = new Map<MortarOverdriveDriverTier, number>();
    for (const tier of MORTAR_OVERDRIVE_DRIVER_TIERS) {
      const { sim, human } = practiceWorld(tier);
      const match = matchOf(sim, human);
      const progresses = botsIn(sim, human).map((pid) => {
        const p = match.progress.get(pid);
        if (!p) throw new Error('no progress');
        return p;
      });
      const anyFinished = () => progresses.some((p) => p.finishedTick !== null);
      for (let i = 0; i < RACE_TICKS && !anyFinished(); i++) sim.tick();
      expect(anyFinished(), tier).toBe(true);
      lapTicks.set(
        tier,
        Math.min(...progresses.flatMap((p) => (p.finishedTick === null ? [] : [p.finishedTick]))),
      );
    }
    expect(lapTicks.get('ace') as number).toBeLessThan(lapTicks.get('rookie') as number);
    expect(lapTicks.get('driver') as number).toBeLessThanOrEqual(lapTicks.get('rookie') as number);
  });

  it('is deterministic: the same practice race twice gives the same finish tick', () => {
    const run = (): number => {
      const { sim, human } = practiceWorld('ace');
      const progress = matchOf(sim, human).progress.get(botIn(sim, human));
      if (!progress) throw new Error('no progress');
      for (let i = 0; i < RACE_TICKS && progress.finishedTick === null; i++) sim.tick();
      return progress.finishedTick ?? -1;
    };
    const first = run();
    expect(first).toBeGreaterThan(0);
    expect(run()).toBe(first);
  });

  it('holds the same controls a human does, never a position of its own', () => {
    const { sim, human } = practiceWorld('ace');
    const bot = botIn(sim, human);
    // Through the countdown the start lock holds every machine still; once the
    // flag drops the pilot is on the throttle, and the movement it produces is
    // the kernel's, driven from meta.moveInput.
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS + 20; i++) sim.tick();
    const meta = sim.players.get(bot);
    const e = sim.entities.get(bot);
    expect(meta?.moveInput.forward).toBe(true);
    expect(e?.drive?.speed ?? 0).toBeGreaterThan(1);
  });

  it('never gets permanently stuck, even dropped facing the garden wall', () => {
    const { sim, human } = practiceWorld('ace');
    const match = matchOf(sim, human);
    const bot = botIn(sim, human);
    for (let i = 0; i < MORTAR_OVERDRIVE_COUNTDOWN_TICKS + 5; i++) sim.tick();
    const e = sim.entities.get(bot);
    const progress = match.progress.get(bot);
    if (!e || !progress) throw new Error('no bot');
    // Wedged: far out in the garden, stopped, nose pointing back up the circuit.
    e.pos.x -= 40;
    e.prevPos = { ...e.pos };
    e.facing += Math.PI;
    if (e.drive) {
      e.drive.speed = 0;
      e.drive.slip = 0;
    }
    const startedAt = progress.travelled;
    // Twenty seconds is generous for rocking out and turning around; being
    // stuck forever is what this rules out.
    for (let i = 0; i < 20 * 20; i++) sim.tick();
    expect(progress.travelled).toBeGreaterThan(startedAt);
  });
});
