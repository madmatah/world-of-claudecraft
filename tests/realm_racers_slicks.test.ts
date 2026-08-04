import { describe, expect, it } from 'vitest';
import {
  RALLY_SLICK_FADE_SECONDS,
  RALLY_SLICK_POOL,
  rallySlickInitialVisual,
  rallySlickListSame,
  rallySlickScale,
  rallySlickSheenSpin,
  rallySlickVisible,
  stepRallySlickVisual,
} from '../src/render/realm_racers_slicks_core';
import { REALM_RACERS_SLICK_ABILITY_ID } from '../src/sim/content/realm_racers';
import {
  REALM_RACERS_PRACTICE_CIRCUIT,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import {
  type RallySlick,
  REALM_RACERS_SLICK_CAP,
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_GRIP_TICKS,
  REALM_RACERS_SLICK_LIFETIME_TICKS,
  REALM_RACERS_SLICK_RADIUS,
  stepRealmRacersSlicks,
} from '../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS,
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_WARD_AURA,
  REALM_RACERS_WARD_AURA_SECONDS,
  realmRacersForfeit,
  realmRacersSpendPickupEffect,
  realmRacersToWorld,
  realmRacersWarded,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { startRealmRacersPractice } from '../src/sim/social/realm_racers_bots';
import { installScriptedRng, rallyPickupRollFor } from './helpers/realm_racers_rng';
import { addAt, makeWorld, teleport } from './vale_cup_util';

const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

const GRID = [
  { cls: 'warrior', name: 'Aster', x: -5, z: -40 },
  { cls: 'mage', name: 'Briar', x: 7, z: -42 },
  { cls: 'rogue', name: 'Cass', x: -9, z: -38 },
  { cls: 'priest', name: 'Dell', x: 11, z: -44 },
] as const;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function match(sim: Sim): NonNullable<Sim['realmRacers']['match']> {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

function racingGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  for (const pid of pids) sim.realmRacersQueueJoin(pid);
  sim.tick();
  for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
  expect(match(sim).phase).toBe('racing');
  return { sim, pids };
}

/** Parks a machine on a circuit-local point, with the lap bookkeeping a machine
 *  that drove there would carry. */
function standAt(sim: Sim, pid: number, x: number, z: number): void {
  const live = match(sim);
  const world = realmRacersToWorld(live, x, z);
  teleport(sim, pid, world.x, world.z);
  const progress = required(live.progress.get(pid), `progress ${pid}`);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(x, z, progress.trackIndex);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

/** Parks a machine ON the road at a lap position, which is where a machine that
 *  has driven clear of a patch really is (a raw point 40 yards to the side is in
 *  the garden, and the garden has its own grip penalty). */
function standOnCenterline(sim: Sim, pid: number, s: number): void {
  const point = realmRacersTrack(RACE_CIRCUIT).pointAt(s);
  standAt(sim, pid, point.x, point.z);
}

/**
 * Have `pid` take a box, draw the OIL, and spend it where they are standing.
 *
 * Two steps since the operator's mid-review override: the box fills a held slot
 * and the CAST is what puts the patch on the road, under the machine.
 */
function dropSlickAt(sim: Sim, pid: number, x: number, z: number, box = 0): RallySlick {
  const rng = installScriptedRng(sim);
  rng.script(rallyPickupRollFor('leader', 'slick'));
  const point = realmRacersPickupBoxes(RACE_CIRCUIT)[box];
  standAt(sim, pid, point.x, point.z);
  sim.tick();
  expect(rng.consumed).toBe(1);
  expect(required(match(sim).progress.get(pid), 'progress').heldEffect).toBe('slick');
  standAt(sim, pid, x, z);
  sim.castAbility(REALM_RACERS_SLICK_ABILITY_ID, pid);
  const dropped = match(sim).slicks.at(-1);
  return required(dropped, 'slick');
}

describe('the oil slick step, on its own', () => {
  const slickAt = (id: number, x: number, ownerPid: number): RallySlick => ({
    id,
    x,
    z: 0,
    ownerPid,
    expiresTick: 100,
  });
  const racer = (pid: number, x: number, overrides = {}) => ({
    pid,
    fromX: x,
    fromZ: 0,
    toX: x,
    toZ: 0,
    eligible: true,
    ...overrides,
  });

  it('catches a rival and never the machine that dropped it', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(7, 0), racer(8, 0)],
    });
    // The dropper drives over their own oil untouched, for the whole of its
    // life: it is a rearward weapon, not a trap you have to remember.
    expect(step.hits).toEqual([{ pid: 8, slick: 1 }]);
    // And it is not consumed by the machine that hit it.
    expect(slicks).toHaveLength(1);
  });

  it('catches a machine that drove THROUGH one between two ticks', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, 0, { fromX: -20, toX: 20 })],
    });
    // Forty yards in one tick with neither end in the patch: only the swept
    // segment can see this.
    expect(step.hits).toEqual([{ pid: 8, slick: 1 }]);
  });

  it('measures the patch by its own radius', () => {
    const slicks = [slickAt(1, 0, 7)];
    const clear = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, REALM_RACERS_SLICK_RADIUS + 0.01)],
    });
    expect(clear.hits).toEqual([]);
    const inside = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, REALM_RACERS_SLICK_RADIUS - 0.01)],
    });
    expect(inside.hits).toEqual([{ pid: 8, slick: 1 }]);
  });

  it('hands over ONE grip loss where two patches overlap', () => {
    const slicks = [slickAt(1, 0, 7), slickAt(2, 1, 7)];
    const step = stepRealmRacersSlicks(slicks, { tick: 0, racers: [racer(8, 0.9)] });
    // The nearest one, so two puddles a machine straddles are still one hit.
    expect(step.hits).toEqual([{ pid: 8, slick: 2 }]);
  });

  it('offers nothing to a machine that is not driving', () => {
    const slicks = [slickAt(1, 0, 7)];
    const step = stepRealmRacersSlicks(slicks, {
      tick: 0,
      racers: [racer(8, 0, { eligible: false })],
    });
    expect(step.hits).toEqual([]);
  });

  it('sweeps a patch off the circuit when its lifetime is up', () => {
    const slicks = [slickAt(1, 0, 7)];
    const alive = stepRealmRacersSlicks(slicks, { tick: 99, racers: [racer(8, 0)] });
    expect(alive.expired).toBe(false);
    expect(alive.hits).toHaveLength(1);
    const gone = stepRealmRacersSlicks(slicks, { tick: 100, racers: [racer(8, 0)] });
    expect(gone.expired).toBe(true);
    expect(gone.hits).toEqual([]);
    expect(slicks).toEqual([]);
  });

  it('reports a machine PARKED in the oil on every tick it stays there', () => {
    // The leaf's half of the one-crossing-one-window rule: it answers honestly
    // (the machine really is still in the puddle) every tick, and the match
    // module is what decides a repeat means nothing. Without this the in-race
    // case below could pass on a leaf that had simply stopped reporting.
    const slicks = [slickAt(1, 0, 7)];
    for (let tick = 0; tick < 5; tick++) {
      expect(stepRealmRacersSlicks(slicks, { tick, racers: [racer(8, 0)] }).hits).toEqual([
        { pid: 8, slick: 1 },
      ]);
    }
  });

  it('pins the shipped tuning to literals', () => {
    // The twin of the pin in the effects suite, repeated HERE on purpose: a
    // cross-file pin unpins itself the day a suite is split or renamed, and
    // these four numbers are the whole feel of the hazard.
    expect(REALM_RACERS_SLICK_RADIUS).toBe(2.6);
    expect(REALM_RACERS_SLICK_LIFETIME_TICKS).toBe(240);
    expect(REALM_RACERS_SLICK_GRIP_TICKS).toBe(30);
    expect(REALM_RACERS_SLICK_GRIP).toBe(0.15);
    expect(REALM_RACERS_SLICK_CAP).toBe(16);
    // And the drawn pool is at least the cap, which is what makes "what bites is
    // what you can see" structural rather than a coincidence of two constants.
    expect(RALLY_SLICK_POOL).toBe(16);
    expect(RALLY_SLICK_POOL).toBeGreaterThanOrEqual(REALM_RACERS_SLICK_CAP);
  });
});

describe('oil slicks, in a race', () => {
  it('takes the grip off a rival and leaves the dropper alone', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);

    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const dropperProgress = required(match(sim).progress.get(dropper), 'dropper progress');
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
    // The dropper is standing in it too (they spent it under themselves) and
    // keeps every bit of grip they had.
    expect(dropperProgress.slickGripUntilTick).toBe(0);

    // The surface pass runs before the hit inside a tick, so the grip lands on
    // the next one: the same tick of lag every surface fact in the rally has.
    sim.tick();
    const rivalDrive = required(sim.entities.get(rival)?.drive, 'rival drive');
    const dropperDrive = required(sim.entities.get(dropper)?.drive, 'dropper drive');
    expect(rivalDrive.gripMult).toBeCloseTo(REALM_RACERS_SLICK_GRIP, 9);
    expect(dropperDrive.gripMult).toBe(1);

    // And it wears off on its own clock once the machine is out of the oil.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount <= rivalProgress.slickGripUntilTick) sim.tick();
    sim.tick();
    expect(rivalDrive.gripMult).toBe(1);
  });

  it('cannot bite anyone on the tick it is dropped', () => {
    // The drop happens on the CAST, which is resolved outside the slick pass (a
    // player's command lands between ticks; a bot's cast runs after the rally
    // phase). So a rival standing exactly where the oil lands is not caught by
    // the tick that was already running, only by the next one.
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    // The rival parked on the exact spot BEFORE the oil arrives.
    standAt(sim, rival, point.x, point.z);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    expect(Math.hypot(slick.x - point.x, slick.z - point.z)).toBeLessThan(0.5);
    // Nothing yet: no tick has run since the patch appeared.
    expect(rivalProgress.slickGripUntilTick).toBe(0);

    // And the very next tick is when it bites: the hazard is real, it is just
    // never retroactive.
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('resolves one crossing once, however many ticks it takes', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    const armed = rivalProgress.slickGripUntilTick;
    expect(armed).toBeGreaterThan(sim.tickCount);
    // Parked in the puddle: the leaf goes on reporting the contact every tick
    // (pinned above), and the window is NOT pushed back by any of them, or a
    // machine that stopped in the oil would never get its grip back.
    for (let i = 0; i < 5; i++) sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(armed);
    expect(rivalProgress.slickContactUntilTick).toBe(armed);
  });

  it('lets a ward eat the oil, once', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    // Granted as the real AURA, which is the ward's source of truth.
    const rivalRacer = required(sim.entities.get(rival), 'rival');
    rivalRacer.auras.push({
      id: REALM_RACERS_WARD_AURA,
      name: 'Racing Ward',
      kind: 'rally_ward',
      remaining: REALM_RACERS_WARD_AURA_SECONDS,
      duration: REALM_RACERS_WARD_AURA_SECONDS,
      value: 0,
      sourceId: rival,
      school: 'physical',
    });

    standAt(sim, rival, slick.x, slick.z);
    const absorbed = sim.tick();
    expect(realmRacersWarded(rivalRacer)).toBe(false);
    expect(rivalProgress.slickGripUntilTick).toBe(0);
    expect(absorbed.filter((event) => event.type === 'realmRacersWardBroken')).toMatchObject([
      { pid: rival },
    ]);

    // Spent: the next crossing is a crossing like anyone else's. Driven clear of
    // the patch first, or the machine never stopped touching it and the window
    // it is standing in is the same one.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount < rivalProgress.slickContactUntilTick) sim.tick();
    standAt(sim, rival, slick.x, slick.z);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(sim.tickCount + REALM_RACERS_SLICK_GRIP_TICKS);
  });

  it('offers no grip loss to a racer who has pulled off', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    realmRacersForfeit(sim.ctx, rival);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    expect(rivalProgress.retiredTick).not.toBeNull();
    standAt(sim, rival, slick.x, slick.z);
    updateRealmRacers(sim.ctx);
    // They keep the machine and may drive it anywhere; they are not in the race
    // any more, so the race's hazards are not theirs.
    expect(rivalProgress.slickGripUntilTick).toBe(0);
  });

  it('offers no grip loss to a machine the referee has just put back', () => {
    // The twin of the 22a pickup case, on the hazard side: automatic recovery
    // puts a machine somewhere, and a patch it lands in is not a patch it drove
    // into. (The lock is one tick, which is exactly what this guard needs.)
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const rivalProgress = required(match(sim).progress.get(rival), 'rival progress');
    // The recovery anchor, and the oil dropped exactly on it.
    const anchor = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, anchor.x, anchor.z);
    rivalProgress.resetS = track.length * 0.25;
    rivalProgress.resetLap = rivalProgress.lap;
    rivalProgress.resetDistanceSinceWrap = rivalProgress.distanceSinceWrap;

    // Wedged off the road: three seconds stationary is what arms the automatic
    // recovery, which is the arm that used to hand back control with no lock at
    // all.
    const off = track.pointAt(track.length * 0.4);
    const outward = track.halfWidthAt(off.s) + 12;
    standAt(sim, rival, off.x - off.tz * outward, off.z + off.tx * outward);
    // Ticked only until the recovery FIRES: the lock is one tick long, so
    // running past it would be testing life after the lock rather than the lock.
    for (
      let i = 0;
      i < REALM_RACERS_STUCK_TICKS + 4 && rivalProgress.resetLockedUntilTick <= sim.tickCount;
      i++
    ) {
      sim.tick();
    }
    expect(rivalProgress.resetLockedUntilTick).toBeGreaterThan(sim.tickCount);
    expect(REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS).toBe(1);
    // Standing in the oil, having been PUT there.
    expect(Math.hypot(slick.x - anchor.x, slick.z - anchor.z)).toBeLessThan(0.5);
    sim.tick();
    expect(rivalProgress.slickGripUntilTick).toBe(0);
  });

  it('holds the field to the cap the renderer can draw, oldest first', () => {
    const { sim, pids } = racingGrid();
    const [dropper] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const live = match(sim);
    const racer = required(sim.entities.get(dropper), 'racer');
    const progress = required(live.progress.get(dropper), 'progress');
    // Driven through the REAL drop path, the one a cast reaches: filling the
    // slot by hand and spending it is the same code the pilot's button runs, and
    // it is where the cap lives. (Taking twenty boxes instead would be timing
    // the pickup cooldown, and the circuit does not carry twenty boxes.)
    for (let i = 0; i < REALM_RACERS_SLICK_CAP + 4; i++) {
      const point = track.pointAt((track.length * i) / (REALM_RACERS_SLICK_CAP + 4));
      standAt(sim, dropper, point.x, point.z);
      progress.heldEffect = 'slick';
      realmRacersSpendPickupEffect(sim.ctx, racer, 'slick');
    }
    expect(live.slicks).toHaveLength(REALM_RACERS_SLICK_CAP);
    // Oldest gone, newest kept: what is left is the tail of the id sequence, so
    // the patch a pilot just laid is never the one evicted.
    expect(live.slicks[0].id).toBe(5);
    expect(live.slicks.at(-1)?.id).toBe(REALM_RACERS_SLICK_CAP + 4);
    expect(sim.realmRacersInfoFor(dropper).match?.slicks).toHaveLength(REALM_RACERS_SLICK_CAP);
  });

  it('keeps every practice lane on its own oil', () => {
    const sim = makeWorld();
    const one = addAt(sim, 'warrior', 'Aster', -5, -40);
    const two = addAt(sim, 'mage', 'Briar', 7, -42);
    expect(startRealmRacersPractice(sim, 'driver', one)).toBe(true);
    expect(startRealmRacersPractice(sim, 'driver', two)).toBe(true);
    const [first, second] = sim.realmRacers.practices;
    first.phase = 'racing';
    second.phase = 'racing';
    // A patch on the FIRST lane's copy of the circuit only.
    const point = realmRacersTrack(REALM_RACERS_PRACTICE_CIRCUIT).pointAt(40);
    first.slicks.push({
      id: first.nextSlickId++,
      x: point.x,
      z: point.z,
      ownerPid: one,
      expiresTick: sim.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
    });
    updateRealmRacers(sim.ctx);
    expect(first.slicks).toHaveLength(1);
    expect(second.slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(two).match?.slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(one).match?.slicks).toHaveLength(1);
  });

  it('takes the patch off the road and off the readout when it expires', () => {
    const { sim, pids } = racingGrid();
    const [dropper, rival] = pids;
    const track = realmRacersTrack(RACE_CIRCUIT);
    const point = track.pointAt(track.length * 0.25);
    const slick = dropSlickAt(sim, dropper, point.x, point.z);
    expect(sim.realmRacersInfoFor(rival).match?.slicks).toHaveLength(1);
    // Parked well clear of the row so nothing else changes hands meanwhile.
    standOnCenterline(sim, rival, track.length * 0.5);
    while (sim.tickCount < slick.expiresTick) sim.tick();
    updateRealmRacers(sim.ctx);
    expect(match(sim).slicks).toEqual([]);
    expect(sim.realmRacersInfoFor(rival).match?.slicks).toEqual([]);
    // The lifetime is the constant, not a number this suite invented.
    expect(slick.expiresTick - REALM_RACERS_SLICK_LIFETIME_TICKS).toBeGreaterThan(0);
  });
});

describe('the oil slick visual core', () => {
  it('draws a new patch at FULL radius and soaks a gone one away', () => {
    let visual = rallySlickInitialVisual();
    expect(visual.phase).toBe('present');
    // Full size on the very first frame: the sim can report a grip loss for a
    // patch the tick it appears, so a disk still growing would be drawn smaller
    // than it bites.
    expect(rallySlickScale(visual)).toBe(1);
    for (let i = 0; i < 10; i++) visual = stepRallySlickVisual(visual, true, 0.05);
    expect(visual.phase).toBe('present');
    expect(rallySlickScale(visual)).toBe(1);
    expect(rallySlickVisible(visual)).toBe(true);

    visual = stepRallySlickVisual(visual, false, 0.05);
    // The transition itself carries no time, so the patch is still full size on
    // the frame it starts soaking away; the frame after is when it shrinks.
    expect(visual).toEqual({ phase: 'fading', t: 0 });
    expect(rallySlickScale(visual)).toBe(1);
    expect(rallySlickScale(stepRallySlickVisual(visual, false, 0.05))).toBeLessThan(1);
    for (let i = 0; i < 20; i++) visual = stepRallySlickVisual(visual, false, 0.05);
    expect(visual.phase).toBe('gone');
    expect(rallySlickVisible(visual)).toBe(false);
    expect(rallySlickScale(visual)).toBe(0);
  });

  it('is drawn at full radius on EVERY frame the race can still report a hit', () => {
    // The fairness pin, stated as the property rather than as a phase: for as
    // long as the readout says the patch is there, its drawn edge is its real
    // edge.
    let visual = rallySlickInitialVisual();
    for (let frame = 0; frame < 60; frame++) {
      expect(rallySlickScale(visual)).toBe(1);
      expect(rallySlickVisible(visual)).toBe(true);
      visual = stepRallySlickVisual(visual, true, 0.016);
    }
  });

  it('turns a re-used id mid fade straight back into a full patch', () => {
    let visual = rallySlickInitialVisual();
    visual = stepRallySlickVisual(visual, false, 0.05);
    visual = stepRallySlickVisual(visual, false, RALLY_SLICK_FADE_SECONDS / 2);
    expect(visual.phase).toBe('fading');
    visual = stepRallySlickVisual(visual, true, 0.01);
    expect(visual).toEqual({ phase: 'present', t: 0 });
    expect(rallySlickScale(visual)).toBe(1);
  });

  it('hands back the SAME state object in either resting phase', () => {
    // Identity, not equality: the painter decides whether a matrix has to be
    // written by comparing what came back with what it held.
    const present = rallySlickInitialVisual();
    expect(stepRallySlickVisual(present, true, 0.016)).toBe(present);
    let gone = stepRallySlickVisual(present, false, 0.016);
    for (let i = 0; i < 20; i++) gone = stepRallySlickVisual(gone, false, 0.05);
    expect(gone.phase).toBe('gone');
    expect(stepRallySlickVisual(gone, false, 0.016)).toBe(gone);
  });

  it('desynchronizes two patches from each other', () => {
    const time = 3.2;
    expect(rallySlickSheenSpin(time, 1)).not.toBeCloseTo(rallySlickSheenSpin(time, 2), 3);
    // A constant per id rather than noise: the same patch at the same moment is
    // always in the same place.
    expect(rallySlickSheenSpin(time + 1, 1) - rallySlickSheenSpin(time, 1)).toBeCloseTo(
      rallySlickSheenSpin(time + 1, 2) - rallySlickSheenSpin(time, 2),
      9,
    );
  });

  it('reads two patch lists as the same only when they are', () => {
    expect(rallySlickListSame([], [])).toBe(true);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 3 }])).toBe(true);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 4 }])).toBe(false);
    expect(rallySlickListSame([{ id: 3 }], [{ id: 3 }, { id: 4 }])).toBe(false);
    expect(rallySlickListSame([{ id: 4 }, { id: 3 }], [{ id: 3 }, { id: 4 }])).toBe(false);
  });
});
