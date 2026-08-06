// The Realm Racers house pilots: lifecycle (spawn, seat, reap), the private
// practice copies of the circuit they race on, and the one test that proves the
// whole stack works together, which is the bot driving a full practice race of
// the real circuit through the real vehicle kernel.
//
// The Practice path and the online backfill path share every line below the
// entry point, so a failure here is a failure of both.

import { describe, expect, it } from 'vitest';
import { REALM_RACERS_BOT_NAMES } from '../src/sim/content/realm_racers';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { RALLY_DRIVER_TIERS, type RallyDriverTier } from '../src/sim/realm_racers_driver';
import {
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  realmRacersLaneAt,
  realmRacersLaneOffset,
  realmRacersPracticeLanes,
} from '../src/sim/realm_racers_layout';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_CHASE_TICKS,
  REALM_RACERS_COUNTDOWN_TICKS,
  type RealmRacersMatch,
  realmRacersFreePracticeSlot,
  realmRacersMatchOf,
} from '../src/sim/social/realm_racers';
import {
  REALM_RACERS_BACKFILL_TICKS,
  REALM_RACERS_BACKFILL_TIER,
} from '../src/sim/social/realm_racers_bots';
import { addAt, makeWorld } from './vale_cup_util';

/** Ticks a full race may take: the countdown plus the 180 s limit, and a beat
 *  for the result tableau to tear down. */
const RACE_TICKS = REALM_RACERS_COUNTDOWN_TICKS + 180 * 20 + 200;
/** The canonical circuit's world x, which every copy shares. */
const RALLY_X = 113_700;

function botPidsOf(sim: Sim): number[] {
  return [...sim.realmRacers.bots.keys()];
}

function matchOf(sim: Sim, pid: number): RealmRacersMatch {
  const match = realmRacersMatchOf(sim.ctx, pid);
  if (!match) throw new Error(`no live race for pid ${pid}`);
  return match;
}

/** Every house pilot on the grid with `pid`, in seat order. */
function botsIn(sim: Sim, pid: number): number[] {
  return matchOf(sim, pid).pids.filter((p) => sim.realmRacers.bots.has(p));
}

/** The first house pilot on the grid with `pid`. */
function botIn(sim: Sim, pid: number): number {
  const bots = botsIn(sim, pid);
  if (bots.length === 0) throw new Error('no house pilot in that race');
  return bots[0];
}

function practiceWorld(tier: RallyDriverTier = 'driver', cfg = {}) {
  const sim = makeWorld(cfg);
  const human = addAt(sim, 'warrior', 'Aster', -5, -40);
  sim.realmRacersPracticeStart(tier, human);
  return { sim, human };
}

describe('Realm Racers practice: one press, one race', () => {
  it('seats a lone player against a full grid of house pilots, with no queue', () => {
    const { sim, human } = practiceWorld('rookie');
    const match = matchOf(sim, human);
    expect(sim.realmRacers.queue).toEqual([]);
    const bots = botPidsOf(sim);
    expect(bots).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    expect(match.pids).toHaveLength(REALM_RACERS_GRID_SIZE);
    expect(match.gridSize).toBe(REALM_RACERS_GRID_SIZE);
    for (const bot of bots) {
      expect(match.pids).toContain(bot);
      expect(sim.realmRacers.bots.get(bot)).toBe('rookie');
    }
    // The pilots race under house names, spliced verbatim like any player name.
    // One name per grid slot, so a four-row strip reads as a field of rivals
    // rather than as one name with numbers after it.
    expect(REALM_RACERS_BOT_NAMES.length).toBeGreaterThanOrEqual(REALM_RACERS_GRID_SIZE);
    expect(REALM_RACERS_BOT_NAMES[0]).toBe('Mat Driftwright');
    const names = bots.map((pid) => sim.players.get(pid)?.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(REALM_RACERS_BOT_NAMES).toContain(name);
    // And it is a PRIVATE race: the public circuit is untouched.
    expect(sim.realmRacers.match).toBeNull();
    expect(sim.realmRacers.practices).toEqual([match]);
  });

  it('reports every rival as a house pilot, and at which tier', () => {
    const { sim, human } = practiceWorld('ace');
    const info = sim.realmRacersInfoFor(human);
    const standings = info.match?.standings ?? [];
    expect(standings).toHaveLength(REALM_RACERS_GRID_SIZE);
    expect(standings.filter((row) => row.botTier === 'ace')).toHaveLength(
      REALM_RACERS_GRID_SIZE - 1,
    );
    expect(info.match?.me.botTier).toBeNull();
    expect(info.match?.practice).toBe(true);
    // Already racing, so no second practice race is on offer to this viewer.
    expect(info.practiceAvailable).toBe(false);
  });

  it('takes a waiting player out of the queue rather than leaving them in it', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersQueueJoin(human);
    expect(sim.realmRacers.queue).toEqual([human]);
    sim.realmRacersPracticeStart('driver', human);
    expect(sim.realmRacers.queue).toEqual([]);
    expect(matchOf(sim, human).practice).not.toBeNull();
  });

  it('refuses a player already racing, and leaks no pilot doing it', () => {
    const { sim, human } = practiceWorld('driver');
    const before = sim.players.size;
    sim.realmRacersPracticeStart('ace', human);
    expect(sim.players.size).toBe(before);
    expect(botPidsOf(sim)).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
  });

  it('refuses a player who cannot race, and leaks no pilot doing it', () => {
    const sim = makeWorld();
    const dead = addAt(sim, 'warrior', 'Aster', -5, -40);
    const e = sim.entities.get(dead);
    if (e) e.dead = true;
    const before = sim.players.size;
    sim.realmRacersPracticeStart('driver', dead);
    expect(realmRacersMatchOf(sim.ctx, dead)).toBeNull();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.players.size).toBe(before);
  });
});

describe('Realm Racers practice: nobody ever waits on anybody', () => {
  it('starts a practice race while the public circuit is mid-race', () => {
    // The whole point of the copies: a queued race owns circuit 0 and a practice
    // lap is simply somewhere else, so neither can ever block the other.
    const sim = makeWorld();
    const grid = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Queued${i}`, -5 + i * 4, -40),
    );
    for (const pid of grid) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(sim.realmRacers.match?.pids).toEqual(grid);

    const solo = addAt(sim, 'rogue', 'Cass', 30, -40);
    expect(sim.realmRacersInfoFor(solo).practiceAvailable).toBe(true);
    sim.realmRacersPracticeStart('ace', solo);
    expect(matchOf(sim, solo).practice?.ownerPid).toBe(solo);
    // The public race is untouched and still has its whole grid.
    expect(sim.realmRacers.match?.pids).toEqual(grid);
  });

  it('gives concurrent pilots distinct names, so a whisper still resolves', () => {
    const sim = makeWorld();
    const pids = [0, 1].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    const names = botPidsOf(sim).map((pid) => sim.players.get(pid)?.name);
    expect(names[0]).toBe('Mat Driftwright');
    expect(names).toHaveLength(2 * (REALM_RACERS_GRID_SIZE - 1));
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every concurrent practice race its own copy of the circuit', () => {
    const sim = makeWorld();
    const pids = [0, 1, 2].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    const slots = pids.map((pid) => matchOf(sim, pid).practice?.slot);
    expect(new Set(slots).size).toBe(pids.length);
    // Every one is a private lane OF THE PRACTICE CIRCUIT. Lane 0 is one of
    // them now that the practice circuit no longer serves competition, so the
    // claim is membership, never "not zero".
    const practiceLanes = realmRacersPracticeLanes().map((lane) => lane.index);
    expect(slots.every((slot) => practiceLanes.includes(slot ?? -1))).toBe(true);
    // And each racer really stands on their own copy, far from the others.
    const where = pids.map((pid) => {
      const e = sim.entities.get(pid);
      if (!e) throw new Error('no racer');
      return realmRacersLaneAt(e.pos.x, e.pos.z)?.index ?? null;
    });
    expect(where).toEqual(slots);
  });

  it('hands a copy back when a practice race ends, and refuses once none are left', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: GARDEN_CIRCUIT.practiceCopies }, (_, i) =>
      addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40),
    );
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    expect(sim.realmRacers.practices).toHaveLength(GARDEN_CIRCUIT.practiceCopies);

    // Every copy is out: the next player is told so rather than silently failing.
    const late = addAt(sim, 'mage', 'Late', 30, -40);
    expect(sim.realmRacersInfoFor(late).practiceAvailable).toBe(false);
    sim.realmRacersPracticeStart('rookie', late);
    expect(realmRacersMatchOf(sim.ctx, late)).toBeNull();

    // One race ends: its copy comes back and the waiting player gets it.
    const freed = matchOf(sim, pids[0]).practice?.slot;
    sim.realmRacersForfeit(pids[0]);
    for (let i = 0; i < 200 && realmRacersMatchOf(sim.ctx, pids[0]); i++) sim.tick();
    expect(sim.realmRacersInfoFor(late).practiceAvailable).toBe(true);
    sim.realmRacersPracticeStart('rookie', late);
    expect(matchOf(sim, late).practice?.slot).toBe(freed);
  });

  it('keeps every copy far enough apart to stay private', () => {
    // Interest scoping is ~120 yd, so the copies have to be further apart than
    // that or a practice lap would appear in a stranger's snapshot.
    expect(REALM_RACERS_LANE_DZ).toBeGreaterThan(300);
    // And the region test claims each copy, with clear plane between them.
    for (const lane of realmRacersPracticeLanes()) {
      const z = lane.index * REALM_RACERS_LANE_DZ;
      expect(realmRacersLaneAt(RALLY_X, z)?.index, `centre of copy ${lane.index}`).toBe(lane.index);
      expect(realmRacersLaneAt(RALLY_X, z)?.circuit.id).toBe(GARDEN_CIRCUIT.id);
      expect(realmRacersLaneAt(RALLY_X, z + REALM_RACERS_LANE_DZ / 2)).toBeNull();
    }
    expect(realmRacersPracticeLanes()).toHaveLength(GARDEN_CIRCUIT.practiceCopies);
    expect(realmRacersLaneAt(RALLY_X, REALM_RACERS_LANES.length * REALM_RACERS_LANE_DZ)).toBeNull();
  });
});

describe('Realm Racers house pilots: no entity ever leaks', () => {
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
    sim.realmRacersPracticeStart('driver', human);
    expect(sim.players.size).toBe(players + REALM_RACERS_GRID_SIZE - 1);
    sim.realmRacersForfeit(human);
    // The result tableau holds the race open for its return countdown; the
    // pilots go home only once the race itself is torn down. The human quitting
    // leaves nothing but house pilots on the grid, which ends it: nobody is
    // watching a practice race its owner walked out of.
    for (let i = 0; i < 400 && sim.realmRacers.practices.length > 0; i++) sim.tick();
    assertReaped(sim, players, entities);
    expect(sim.realmRacers.practices).toEqual([]);
  });

  it('takes the pilot home when the human disconnects mid-race', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const players = sim.players.size;
    const entities = sim.entities.size;
    sim.realmRacersPracticeStart('driver', human);
    sim.removePlayer(human);
    for (let i = 0; i < 400 && sim.realmRacers.practices.length > 0; i++) sim.tick();
    expect(sim.realmRacers.practices).toEqual([]);
    // The human left too, so the roster settles one under where it started.
    assertReaped(sim, players - 1, entities - 1);
  });

  it('takes the pilot home when the race runs out of time', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    const players = sim.players.size;
    const entities = sim.entities.size;
    sim.realmRacersPracticeStart('rookie', human);
    const match = matchOf(sim, human);
    // Jump the clock to the deadline rather than ticking three minutes of world.
    match.deadlineTick = sim.tickCount + 1;
    match.phase = 'racing';
    for (let i = 0; i < 400 && realmRacersMatchOf(sim.ctx, human); i++) sim.tick();
    assertReaped(sim, players, entities);
  });

  it('reaps only the pilot whose race ended, never a parallel one', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.realmRacersPracticeStart('rookie', a);
    sim.realmRacersPracticeStart('ace', b);
    const survivors = botsIn(sim, b);
    expect(survivors).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    sim.realmRacersForfeit(a);
    for (let i = 0; i < 400 && realmRacersMatchOf(sim.ctx, a); i++) sim.tick();
    expect(botPidsOf(sim).sort()).toEqual([...survivors].sort());
    for (const survivor of survivors) expect(matchOf(sim, b).pids).toContain(survivor);
  });
});

describe('Realm Racers online backfill', () => {
  it('stays off unless the host asks for it', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersQueueJoin(human);
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS + 40; i++) sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.realmRacers.match).toBeNull();
  });

  it('never sends a pilot when four humans fill the grid themselves', () => {
    const sim = makeWorld({ realmRacersBackfill: true });
    const grid = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Queued${i}`, -5 + i * 4, -40),
    );
    for (const pid of grid) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.realmRacers.match?.pids).toEqual(grid);
    // And it stays that way past the wait: a full grid is never topped up.
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS + 40; i++) sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
  });

  it('sends pilots out only after the wait, and only for the empty seats', () => {
    const sim = makeWorld({ realmRacersBackfill: true });
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersQueueJoin(a);
    const joinedAt = sim.tickCount;
    // Well short of the wait: still alone, still waiting.
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS - 20; i++) sim.tick();
    expect(botPidsOf(sim), `at tick ${sim.tickCount - joinedAt}`).toEqual([]);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(botPidsOf(sim)).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    expect(sim.realmRacers.match?.pids).toContain(a);
    expect(sim.realmRacers.match?.pids).toHaveLength(REALM_RACERS_GRID_SIZE);
    for (const bot of botPidsOf(sim)) {
      expect(sim.realmRacers.bots.get(bot)).toBe(REALM_RACERS_BACKFILL_TIER);
    }
    expect(sim.realmRacers.queue).toEqual([]);
    // A backfilled race is the PUBLIC race, not a practice copy: this player
    // queued for a real one and is getting one.
    expect(sim.realmRacers.match?.practice).toBeNull();
    expect(sim.realmRacers.practices).toEqual([]);
  });

  it('costs the shared stream exactly one draw, on the tick it seats the grid', () => {
    // The backfill is the ONLY path that draws a circuit in production: a
    // practice start takes the practice circuit outright and `/dev rally` is
    // told its circuit, so both skip the draw. Everything else about the rally
    // is deterministic with zero rng, which is what makes the count readable
    // here: the whole tick's draw cost is this one draw.
    const sim = makeWorld({ realmRacersBackfill: true });
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersQueueJoin(human);
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
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS + 60; i++) {
      const before = sim.realmRacers.match;
      const draws = drawsOnTick();
      if (!before && sim.realmRacers.match) {
        seatingDraws = draws;
        break;
      }
      // Every tick before the grid is seated is free, which is what makes the
      // seating tick's single draw attributable to the draw site.
      expect(draws, `tick ${i} drew before the grid was seated`).toEqual([]);
    }
    expect(sim.realmRacers.match, 'the backfill never seated a grid').not.toBeNull();
    expect(seatingDraws).toHaveLength(1);
  });

  it('draws nothing when a practice start is refused', () => {
    // `seatWithBots` spawns its house pilots BEFORE the match module can refuse,
    // then despawns them again. Neither spawn nor despawn may draw, or a
    // refused practice press would perturb the world's draw order.
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    // Hand out every practice copy, so the next press has no lane to take.
    const holders = realmRacersPracticeLanes().map((_, i) =>
      addAt(sim, 'warrior', `Holder${i}`, -40 - i * 4, -40),
    );
    for (const pid of holders) sim.realmRacersPracticeStart('rookie', pid);
    expect(realmRacersFreePracticeSlot(sim.ctx), 'a practice copy was still free').toBeLessThan(0);
    const seen: number[] = [];
    sim.rng.setObserver((value) => seen.push(value));
    try {
      sim.realmRacersPracticeStart('ace', human);
    } finally {
      sim.rng.setObserver(null);
    }
    expect(realmRacersMatchOf(sim.ctx, human), 'the refused start seated a race').toBeNull();
    expect(seen).toEqual([]);
  });

  it('fills only the seats nobody claimed, and clocks the OLDEST waiter', () => {
    const sim = makeWorld({ realmRacersBackfill: true });
    const humans = Array.from({ length: REALM_RACERS_GRID_SIZE - 1 }, (_, i) =>
      addAt(sim, 'warrior', `Waiter${i}`, -5 + i * 4, -40),
    );
    // The first waiter joins, then the other two arrive much later. A queue of
    // three must not wait for a fourth human forever, and the pilot at the head
    // of it must not be made to wait longer because the queue grew behind them.
    sim.realmRacersQueueJoin(humans[0]);
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS - 10; i++) sim.tick();
    for (const pid of humans.slice(1)) sim.realmRacersQueueJoin(pid);
    expect(botPidsOf(sim)).toEqual([]);
    for (let i = 0; i < 40; i++) sim.tick();
    expect(botPidsOf(sim)).toHaveLength(1);
    const seated = sim.realmRacers.match?.pids ?? [];
    expect(seated).toHaveLength(REALM_RACERS_GRID_SIZE);
    for (const pid of humans) expect(seated).toContain(pid);
    expect(sim.realmRacers.queue).toEqual([]);
  });
});

describe('Realm Racers race clock tuning', () => {
  it('pins the straggler chase window to its shipped literal', () => {
    // Thirty seconds at the 20 Hz tick: about a lap of struggling off the
    // racing line, so a real straggler still takes their placing and only a
    // machine nobody is driving runs the clock out. Every other reading of the
    // constant is derived, so this is the one that fails on a retune.
    expect(REALM_RACERS_CHASE_TICKS).toBe(600);
  });
});

describe('Realm Racers house pilots: they can actually drive', () => {
  // The single most valuable test in the workstream: it proves the brain, the
  // vehicle kernel, the collision set and continuous spline progress work together,
  // ON A PRACTICE COPY, which also proves the whole frame shift is right.
  // Nothing here is mocked, and the pilot holds the same controls a human does.
  for (const tier of RALLY_DRIVER_TIERS) {
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
      const standings = sim.realmRacersInfoFor(human).match?.standings ?? [];
      expect(standings[0].botTier).toBe(tier);
      expect(sim.realmRacersInfoFor(human).match?.me.position).toBe(REALM_RACERS_GRID_SIZE);
    });
  }

  it('seats three pilots at the chosen tier, and two identical races agree tick for tick', () => {
    const run = (): { finish: number[]; tiers: (string | null)[] } => {
      const { sim, human } = practiceWorld('ace');
      const bots = botsIn(sim, human);
      expect(bots).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
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
        tiers: bots.map((pid) => sim.realmRacers.bots.get(pid) ?? null),
      };
    };
    const first = run();
    expect(first.tiers).toEqual(Array(REALM_RACERS_GRID_SIZE - 1).fill('ace'));
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
      sim.realmRacersPracticeStart(REALM_RACERS_BACKFILL_TIER, human);
      const match = matchOf(sim, human);
      if (lane !== match.practice?.slot) {
        // Move the whole race onto another lane, before it has driven a yard:
        // the origin AND every racer shift by the same vector, which is exactly
        // what seating on that lane would have produced.
        const delta = realmRacersLaneOffset(lane).z - match.origin.z;
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
    const lanes = realmRacersPracticeLanes().map((l) => l.index);
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
    const lapTicks = new Map<RallyDriverTier, number>();
    for (const tier of RALLY_DRIVER_TIERS) {
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
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS + 20; i++) sim.tick();
    const meta = sim.players.get(bot);
    const e = sim.entities.get(bot);
    expect(meta?.moveInput.forward).toBe(true);
    expect(e?.drive?.speed ?? 0).toBeGreaterThan(1);
  });

  it('never gets permanently stuck, even dropped facing the garden wall', () => {
    const { sim, human } = practiceWorld('ace');
    const match = matchOf(sim, human);
    const bot = botIn(sim, human);
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS + 5; i++) sim.tick();
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
