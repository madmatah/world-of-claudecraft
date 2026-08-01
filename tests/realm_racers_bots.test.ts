// The Realm Racers house pilots: lifecycle (spawn, seat, reap), the private
// practice copies of the circuit they race on, and the one test that proves the
// whole stack works together, which is the bot driving a full practice race of
// the real circuit through the real vehicle kernel.
//
// The Practice path and the online backfill path share every line below the
// entry point, so a failure here is a failure of both.

import { describe, expect, it } from 'vitest';
import { REALM_RACERS_BOT_NAMES } from '../src/sim/content/realm_racers';
import { RALLY_DRIVER_TIERS, type RallyDriverTier } from '../src/sim/realm_racers_driver';
import {
  REALM_RACERS_LAPS,
  REALM_RACERS_PRACTICE_LAPS,
  REALM_RACERS_PRACTICE_SLOTS,
  REALM_RACERS_SLOT_DZ,
  realmRacersSlotAtXZ,
} from '../src/sim/realm_racers_layout';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_COUNTDOWN_TICKS,
  type RealmRacersMatch,
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

/** The house pilot seated opposite `pid`. */
function botIn(sim: Sim, pid: number): number {
  const bot = matchOf(sim, pid).pids.find((p) => sim.realmRacers.bots.has(p));
  if (bot === undefined) throw new Error('no house pilot in that race');
  return bot;
}

function practiceWorld(tier: RallyDriverTier = 'driver', cfg = {}) {
  const sim = makeWorld(cfg);
  const human = addAt(sim, 'warrior', 'Aster', -5, -40);
  sim.realmRacersPracticeStart(tier, human);
  return { sim, human };
}

describe('Realm Racers practice: one press, one race', () => {
  it('seats a lone player against a house pilot immediately, with no queue', () => {
    const { sim, human } = practiceWorld('rookie');
    const match = matchOf(sim, human);
    expect(sim.realmRacers.queue).toEqual([]);
    const bots = botPidsOf(sim);
    expect(bots).toHaveLength(1);
    expect(match.pids).toContain(bots[0]);
    expect(sim.realmRacers.bots.get(bots[0])).toBe('rookie');
    // The pilot races under the house name, spliced verbatim like any player
    // name. One name on purpose: every player meets the same rival.
    expect(REALM_RACERS_BOT_NAMES).toEqual(['Mat Driftwright']);
    expect(sim.players.get(bots[0])?.name).toBe('Mat Driftwright');
    // And it is a PRIVATE race: the public circuit is untouched.
    expect(sim.realmRacers.match).toBeNull();
    expect(sim.realmRacers.practices).toEqual([match]);
  });

  it('reports the opponent as a house pilot, and at which tier', () => {
    const { sim, human } = practiceWorld('ace');
    const info = sim.realmRacersInfoFor(human);
    expect(info.match?.opponent.botTier).toBe('ace');
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
    expect(botPidsOf(sim)).toHaveLength(1);
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
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.realmRacersQueueJoin(a);
    sim.realmRacersQueueJoin(b);
    sim.tick();
    expect(sim.realmRacers.match?.pids).toEqual([a, b]);

    const solo = addAt(sim, 'rogue', 'Cass', 14, -40);
    expect(sim.realmRacersInfoFor(solo).practiceAvailable).toBe(true);
    sim.realmRacersPracticeStart('ace', solo);
    expect(matchOf(sim, solo).practice?.ownerPid).toBe(solo);
    // The public race is untouched and still has both its racers.
    expect(sim.realmRacers.match?.pids).toEqual([a, b]);
  });

  it('gives concurrent pilots distinct names, so a whisper still resolves', () => {
    const sim = makeWorld();
    const pids = [0, 1].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    const names = botPidsOf(sim).map((pid) => sim.players.get(pid)?.name);
    expect(names[0]).toBe('Mat Driftwright');
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every concurrent practice race its own copy of the circuit', () => {
    const sim = makeWorld();
    const pids = [0, 1, 2].map((i) => addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40));
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    const slots = pids.map((pid) => matchOf(sim, pid).practice?.slot);
    expect(new Set(slots).size).toBe(pids.length);
    expect(slots.every((slot) => (slot ?? 0) > 0)).toBe(true);
    // And each racer really stands on their own copy, far from the others.
    const where = pids.map((pid) => {
      const e = sim.entities.get(pid);
      if (!e) throw new Error('no racer');
      return realmRacersSlotAtXZ(e.pos.x, e.pos.z);
    });
    expect(where).toEqual(slots);
  });

  it('hands a copy back when a practice race ends, and refuses once none are left', () => {
    const sim = makeWorld();
    const pids = Array.from({ length: REALM_RACERS_PRACTICE_SLOTS }, (_, i) =>
      addAt(sim, 'warrior', `Racer${i}`, -5 + i * 4, -40),
    );
    for (const pid of pids) sim.realmRacersPracticeStart('rookie', pid);
    expect(sim.realmRacers.practices).toHaveLength(REALM_RACERS_PRACTICE_SLOTS);

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
    expect(REALM_RACERS_SLOT_DZ).toBeGreaterThan(300);
    // And the region test claims each copy, with clear plane between them.
    for (let slot = 0; slot <= REALM_RACERS_PRACTICE_SLOTS; slot++) {
      const z = slot * REALM_RACERS_SLOT_DZ;
      expect(realmRacersSlotAtXZ(RALLY_X, z), `centre of copy ${slot}`).toBe(slot);
      expect(realmRacersSlotAtXZ(RALLY_X, z + REALM_RACERS_SLOT_DZ / 2)).toBeNull();
    }
    expect(
      realmRacersSlotAtXZ(RALLY_X, (REALM_RACERS_PRACTICE_SLOTS + 1) * REALM_RACERS_SLOT_DZ),
    ).toBeNull();
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
    expect(sim.players.size).toBe(players + 1);
    sim.realmRacersForfeit(human);
    // The result tableau holds the race open for its return countdown; the pilot
    // goes home only once the race itself is torn down.
    for (let i = 0; i < 200 && realmRacersMatchOf(sim.ctx, human); i++) sim.tick();
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
    for (let i = 0; i < 200 && realmRacersMatchOf(sim.ctx, human); i++) sim.tick();
    assertReaped(sim, players, entities);
  });

  it('reaps only the pilot whose race ended, never a parallel one', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.realmRacersPracticeStart('rookie', a);
    sim.realmRacersPracticeStart('ace', b);
    const survivor = botIn(sim, b);
    sim.realmRacersForfeit(a);
    for (let i = 0; i < 200 && realmRacersMatchOf(sim.ctx, a); i++) sim.tick();
    expect(botPidsOf(sim)).toEqual([survivor]);
    expect(matchOf(sim, b).pids).toContain(survivor);
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

  it('sends a pilot out only after the wait, and only to a lone racer', () => {
    const sim = makeWorld({ realmRacersBackfill: true });
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 9, -40);
    sim.realmRacersQueueJoin(a);
    sim.realmRacersQueueJoin(b);
    // Two in the queue: they pair off with each other, no pilot is sent.
    sim.tick();
    expect(botPidsOf(sim)).toEqual([]);
    expect(sim.realmRacers.match?.pids).toEqual([a, b]);
    sim.realmRacersForfeit(a);
    for (let i = 0; i < 200 && sim.realmRacers.match; i++) sim.tick();

    sim.realmRacersQueueJoin(a);
    const joinedAt = sim.tickCount;
    // Well short of the wait: still alone, still waiting.
    for (let i = 0; i < REALM_RACERS_BACKFILL_TICKS - 20; i++) sim.tick();
    expect(botPidsOf(sim), `at tick ${sim.tickCount - joinedAt}`).toEqual([]);
    for (let i = 0; i < 60; i++) sim.tick();
    expect(botPidsOf(sim)).toHaveLength(1);
    expect(sim.realmRacers.match?.pids).toContain(a);
    expect(sim.realmRacers.bots.get(botPidsOf(sim)[0])).toBe(REALM_RACERS_BACKFILL_TIER);
    expect(sim.realmRacers.queue).toEqual([]);
    // A backfilled race is the PUBLIC race, not a practice copy: this player
    // queued for a real one and is getting one.
    expect(sim.realmRacers.match?.practice).toBeNull();
    expect(sim.realmRacers.practices).toEqual([]);
  });
});

describe('Realm Racers house pilots: they can actually drive', () => {
  // The single most valuable test in the workstream: it proves the brain, the
  // vehicle kernel, the collision set and continuous spline progress work together,
  // ON A PRACTICE COPY, which also proves the whole frame shift is right.
  // Nothing here is mocked, and the pilot holds the same controls a human does.
  for (const tier of RALLY_DRIVER_TIERS) {
    it(`completes ${REALM_RACERS_PRACTICE_LAPS} practice laps at the ${tier} tier inside the time limit`, () => {
      const { sim, human } = practiceWorld(tier);
      const match = matchOf(sim, human);
      expect(match.totalLaps).toBe(REALM_RACERS_PRACTICE_LAPS);
      const bot = botIn(sim, human);
      const progress = match.progress.get(bot);
      if (!progress) throw new Error('no progress');
      let finishedAt = -1;
      for (let i = 0; i < RACE_TICKS && finishedAt < 0; i++) {
        sim.tick();
        if (progress.finishedTick !== null) finishedAt = sim.tickCount;
      }
      expect(finishedAt, `${tier} never finished`).toBeGreaterThan(0);
      expect(progress.lap).toBe(REALM_RACERS_PRACTICE_LAPS);
      // And it won, because the human never touched a control.
      expect(match.winnerPid).toBe(bot);
    });
  }

  it('drives a practice copy exactly as it drives the public circuit', () => {
    // The frame shift is either exact or it is not, and an eye watching a lap
    // could never tell. Both races are seated on the SAME sim tick with the same
    // pids, so the only thing left that differs is the copy: any drift in the
    // shift then shows up as a different lap time, down to the tick.
    // Practice runs more laps than the public race, so the comparison stops at
    // the public length: finish for a queued race, lap past that length for a
    // practice copy.
    const race = (kind: 'public' | 'practice'): { ticks: number; originZ: number } => {
      const sim = makeWorld({ realmRacersBackfill: true });
      const human = addAt(sim, 'warrior', 'Aster', -5, -40);
      if (kind === 'public') {
        // Backdate the wait so the backfill seats them inside the first tick,
        // rather than ticking 45 seconds of world to reach the same place.
        sim.realmRacersQueueJoin(human);
        sim.realmRacers.queuedAtTick.set(human, -REALM_RACERS_BACKFILL_TICKS);
        sim.tick();
      } else {
        sim.tick();
        sim.realmRacersPracticeStart(REALM_RACERS_BACKFILL_TIER, human);
      }
      const match = matchOf(sim, human);
      expect(match.practice === null, kind).toBe(kind === 'public');
      expect(match.totalLaps).toBe(
        kind === 'public' ? REALM_RACERS_LAPS : REALM_RACERS_PRACTICE_LAPS,
      );
      const progress = match.progress.get(botIn(sim, human));
      if (!progress) throw new Error('no progress');
      const started = sim.tickCount;
      const reachedPublicLength = (): boolean =>
        progress.finishedTick !== null || progress.lap > REALM_RACERS_LAPS;
      for (let i = 0; i < RACE_TICKS && !reachedPublicLength(); i++) sim.tick();
      expect(reachedPublicLength(), kind).toBe(true);
      return { ticks: sim.tickCount - started, originZ: match.origin.z };
    };
    const onPublic = race('public');
    const onCopy = race('practice');
    expect(onPublic.originZ).toBe(0);
    expect(onCopy.originZ).toBeGreaterThan(0);
    expect(onPublic.ticks).toBeGreaterThan(0);
    expect(onCopy.ticks).toBe(onPublic.ticks);
  });

  it('runs a harder tier no slower than a gentler one over the same race', () => {
    const lapTicks = new Map<RallyDriverTier, number>();
    for (const tier of RALLY_DRIVER_TIERS) {
      const { sim, human } = practiceWorld(tier);
      const progress = matchOf(sim, human).progress.get(botIn(sim, human));
      if (!progress) throw new Error('no progress');
      for (let i = 0; i < RACE_TICKS && progress.finishedTick === null; i++) sim.tick();
      expect(progress.finishedTick, tier).not.toBeNull();
      lapTicks.set(tier, progress.finishedTick as number);
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
