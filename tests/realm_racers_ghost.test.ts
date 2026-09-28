// The recovery GHOST: a machine the race has just put back on the racing line is
// intangible to rival machines until it is unlocked and clear, or a hard cap
// runs out. The playtest case it exists for: at 200 ms a pilot shot a rival off
// the road, the rival was recovered onto the line locked still for two seconds,
// and the shooter, following at full speed, hit a parked solid machine.

import { describe, expect, it, vi } from 'vitest';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  REALM_RACERS_GHOST_AURA,
  REALM_RACERS_GHOST_MARGIN_TICKS,
  rallyGhostMayClear,
  rallyHullsOverlap,
  realmRacersGhosted,
} from '../src/sim/realm_racers_ghost';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { REALM_RACERS_SLICK_LIFETIME_TICKS } from '../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_GHOST_CAP_TICKS,
  REALM_RACERS_GROUND_BLAST_AURA,
  REALM_RACERS_RESET_LOCK_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_VEHICLE_KEY,
  type RealmRacersMatch,
  realmRacersStartMatch,
  realmRacersToCanonical,
  realmRacersToWorld,
} from '../src/sim/social/realm_racers';
import type { Entity } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './realm_racers_util';

const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];
const PROFILE = vehicleProfile(REALM_RACERS_VEHICLE_KEY);
/** The contact reach between two machines: two hull radii. */
const REACH = PROFILE.bodyRadius * 2;

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function onLane(match: RealmRacersMatch, s: number) {
  const point = realmRacersTrack(RACE_CIRCUIT).pointAt(s);
  const world = realmRacersToWorld(match, point.x, point.z);
  return { ...point, x: world.x, z: world.z };
}

/** Parks a machine at a world point with the lap bookkeeping a machine that
 *  DROVE there would carry, so the referee never reads the jump as a cut. */
function park(sim: Sim, match: RealmRacersMatch, pid: number, x: number, z: number): void {
  teleport(sim, pid, x, z);
  const progress = required(match.progress.get(pid), `progress ${pid}`);
  const local = realmRacersToCanonical(match, x, z);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(local.x, local.z);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function watch(sim: Sim, type: string) {
  const emit = vi.spyOn(sim, 'emit');
  return () =>
    emit.mock.calls
      .map(([event]) => event as { type: string } & Record<string, unknown>)
      .filter((event) => event.type === type);
}

/**
 * A racing grid with everybody parked well apart round the lap, and racer `a`
 * about to be recovered onto the line at 40 % of the lap (`road`).
 */
function racing() {
  const sim = makeWorld();
  const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40),
  );
  realmRacersStartMatch(sim.ctx, pids, undefined, RACE_CIRCUIT.id);
  sim.tick();
  const match = required(sim.realmRacers.match, 'race');
  match.phase = 'racing';
  sim.tick();
  const track = realmRacersTrack(RACE_CIRCUIT);
  pids.forEach((pid, i) => {
    const away = onLane(match, track.length * (0.6 + i * 0.08));
    park(sim, match, pid, away.x, away.z);
  });
  sim.tick();
  const [a, b] = pids;
  const road = onLane(match, track.length * 0.4);
  required(match.progress.get(a), 'progress').resetS = road.s;
  return {
    sim,
    match,
    pids,
    a,
    b,
    road,
    racer: required(sim.entities.get(a), 'racer'),
    rival: required(sim.entities.get(b), 'rival'),
    progress: required(match.progress.get(a), 'progress'),
  };
}

/** Put `pid` on top of `on`, `offset` yards to its side: overlapping hulls. */
function parkOn(sim: Sim, match: RealmRacersMatch, pid: number, on: Entity, offset = 1): void {
  park(sim, match, pid, on.pos.x + offset, on.pos.z);
}

describe('the ghost rule, on its own', () => {
  it('pins the cap to the manual lock plus one second of driving', () => {
    expect(REALM_RACERS_GHOST_MARGIN_TICKS).toBe(20);
    expect(REALM_RACERS_GHOST_CAP_TICKS).toBe(REALM_RACERS_RESET_LOCK_TICKS + 20);
    expect(REALM_RACERS_GHOST_CAP_TICKS).toBe(60);
  });

  it('ends only once unlocked and clear, or at the cap whatever the overlap', () => {
    const at = (tick: number, overlapping: boolean) =>
      rallyGhostMayClear({ tick, lockedUntilTick: 10, capTick: 30, overlapping });
    expect(at(9, false)).toBe(false);
    expect(at(10, false)).toBe(true);
    expect(at(10, true)).toBe(false);
    expect(at(29, true)).toBe(false);
    expect(at(30, true)).toBe(true);
    // The cap wins even over a lock that somehow outlived it.
    expect(
      rallyGhostMayClear({ tick: 30, lockedUntilTick: 99, capTick: 30, overlapping: true }),
    ).toBe(true);
  });

  it('reads overlap on the contact reach, touching exactly at the reach being clear', () => {
    const hull = (x: number) => ({ x, z: 0, radius: PROFILE.bodyRadius });
    expect(rallyHullsOverlap(hull(0), hull(REACH - 0.01))).toBe(true);
    expect(rallyHullsOverlap(hull(0), hull(REACH))).toBe(false);
    expect(rallyHullsOverlap({ x: 0, z: 0, radius: 1 }, { x: 0.6, z: 0.8, radius: 0.1 })).toBe(
      true,
    );
  });
});

describe('the ghost starts on every recovery', () => {
  it('starts on a manual recovery, as an aura every client mirrors', () => {
    const { sim, a, racer, progress } = racing();
    const auras = watch(sim, 'aura');
    expect(realmRacersGhosted(racer)).toBe(false);
    sim.realmRacersResetPosition(a);
    const aura = required(
      racer.auras.find((entry) => entry.id === REALM_RACERS_GHOST_AURA),
      'ghost aura',
    );
    expect(aura).toMatchObject({ kind: 'rally_ghost', name: 'Ghosted', value: 0 });
    expect(progress.ghostCapTick).toBe(sim.tickCount + REALM_RACERS_GHOST_CAP_TICKS + 1);
    // Silent, like the recovery itself: the entity aura list is the whole wire,
    // and no gain line lands in anybody's event frame.
    expect(auras().filter((event) => event.name === 'Ghosted')).toEqual([]);
  });

  it('starts on the automatic stuck recovery, and ends with its one-tick lock', () => {
    const { sim, match, a, racer, road, progress } = racing();
    const lateral = road.halfWidth + 8;
    park(sim, match, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS; i++) sim.tick();
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(realmRacersGhosted(racer)).toBe(true);
    // Nobody near it: the ghost goes the tick the lock does.
    while (sim.tickCount < progress.resetLockedUntilTick) {
      expect(realmRacersGhosted(racer)).toBe(true);
      sim.tick();
    }
    expect(realmRacersGhosted(racer)).toBe(false);
    expect(progress.ghostCapTick).toBe(0);
  });
});

describe('a ghost touches nobody', () => {
  it('lets a rival sit inside it for the whole lock with no shove and no bump', () => {
    const { sim, match, a, b, racer, rival } = racing();
    const bumps = watch(sim, 'realmRacersBump');
    sim.realmRacersResetPosition(a);
    parkOn(sim, match, b, racer);
    const rivalAt = { ...rival.pos };
    const racerAt = { ...racer.pos };
    for (let i = 0; i < REALM_RACERS_RESET_LOCK_TICKS; i++) sim.tick();
    expect(realmRacersGhosted(racer)).toBe(true);
    expect(rival.pos.x).toBeCloseTo(rivalAt.x, 9);
    expect(rival.pos.z).toBeCloseTo(rivalAt.z, 9);
    expect(racer.pos.x).toBeCloseTo(racerAt.x, 9);
    expect(racer.pos.z).toBeCloseTo(racerAt.z, 9);
    expect(bumps()).toEqual([]);
    expect(required(match.progress.get(b), 'rival progress').hadRivalContact).toBe(false);
  });

  it('shoves the same parked rival apart when the machine is NOT a ghost (the control)', () => {
    const { sim, match, a, b, racer, rival } = racing();
    sim.realmRacersResetPosition(a);
    // Strip the ghost by hand: the same overlap must now resolve.
    racer.auras = racer.auras.filter((aura) => aura.id !== REALM_RACERS_GHOST_AURA);
    parkOn(sim, match, b, racer);
    const rivalAt = { ...rival.pos };
    sim.tick();
    expect(Math.hypot(rival.pos.x - rivalAt.x, rival.pos.z - rivalAt.z)).toBeGreaterThan(0.01);
  });

  it('stays a ghost past the lock while overlapped, and ends the first tick it is clear', () => {
    const { sim, match, a, b, racer, rival, progress } = racing();
    sim.realmRacersResetPosition(a);
    parkOn(sim, match, b, racer);
    while (sim.tickCount < progress.resetLockedUntilTick) sim.tick();
    sim.tick();
    sim.tick();
    // Unlocked, still inside the rival: a ghost, or two machines spawn in each
    // other.
    expect(sim.tickCount).toBeGreaterThan(progress.resetLockedUntilTick);
    expect(realmRacersGhosted(racer)).toBe(true);
    // Clear of it by more than the reach: solid on the next tick.
    park(sim, match, b, racer.pos.x + REACH + 1, racer.pos.z);
    expect(realmRacersGhosted(rival)).toBe(false);
    sim.tick();
    expect(realmRacersGhosted(racer)).toBe(false);
    expect(progress.ghostCapTick).toBe(0);
  });

  it('ends at the cap even with a rival parked on it, and the contact resolves again', () => {
    const { sim, match, a, b, racer, rival, progress } = racing();
    sim.realmRacersResetPosition(a);
    const cap = progress.ghostCapTick;
    expect(cap).toBeGreaterThan(progress.resetLockedUntilTick);
    while (sim.tickCount < cap - 1) {
      // Held on top of it every tick, the way a rival parked on it would sit.
      parkOn(sim, match, b, racer, 0.5);
      sim.tick();
      expect(realmRacersGhosted(racer)).toBe(true);
    }
    parkOn(sim, match, b, racer, 0.5);
    const rivalAt = { ...rival.pos };
    sim.tick();
    expect(sim.tickCount).toBe(cap);
    expect(realmRacersGhosted(racer)).toBe(false);
    // Solid again on that same tick: the pair is pushed apart.
    expect(Math.hypot(rival.pos.x - rivalAt.x, rival.pos.z - rivalAt.z)).toBeGreaterThan(0.01);
  });

  it('replays the playtest: the shooter follows at speed and passes the recovered kart clean', () => {
    const run = (ghost: boolean) => {
      const { sim, match, a, b, racer, rival, pids, progress } = racing();
      const bumps = watch(sim, 'realmRacersBump');
      sim.realmRacersResetPosition(a);
      if (!ghost) racer.auras = racer.auras.filter((aura) => aura.id !== REALM_RACERS_GHOST_AURA);
      // The shooter, twelve yards behind on the racing line, aimed straight at
      // the recovered machine and already at racing speed.
      const dirX = Math.sin(racer.facing);
      const dirZ = Math.cos(racer.facing);
      park(sim, match, b, racer.pos.x - dirX * 12, racer.pos.z - dirZ * 12);
      rival.facing = racer.facing;
      required(rival.drive, 'rival drive').speed = PROFILE.maxSpeed * 0.75;
      required(sim.players.get(b), 'rival player').moveInput.forward = true;
      const parked = { ...racer.pos };
      for (let i = 0; i < 12; i++) sim.tick();
      const ahead = (rival.pos.x - parked.x) * dirX + (rival.pos.z - parked.z) * dirZ;
      return {
        bumps: bumps().filter((event) => pids.includes(event.aId as number)),
        ahead,
        racerMoved: Math.hypot(racer.pos.x - parked.x, racer.pos.z - parked.z),
        rivalContact: required(match.progress.get(b), 'rival progress').hadRivalContact,
        stillLocked: sim.tickCount < progress.resetLockedUntilTick,
      };
    };
    const clean = run(true);
    // Straight through, still inside the recovered machine's lock, and neither
    // machine touched.
    expect(clean.stillLocked).toBe(true);
    expect(clean.ahead).toBeGreaterThan(REACH);
    expect(clean.bumps).toEqual([]);
    expect(clean.racerMoved).toBeLessThan(0.01);
    expect(clean.rivalContact).toBe(false);
    // The same approach against a SOLID parked machine is the collision the
    // playtest reported, which is what makes the case above decisive.
    const solid = run(false);
    expect(solid.bumps.length).toBeGreaterThan(0);
    expect(solid.rivalContact).toBe(true);
  });
});

describe('hazards ignore the ghost', () => {
  /** A ghost past its lock, held a ghost by a rival parked on it. */
  function unlockedGhost() {
    const staged = racing();
    const { sim, match, a, b, racer, progress } = staged;
    sim.realmRacersResetPosition(a);
    while (sim.tickCount < progress.resetLockedUntilTick + 1) {
      parkOn(sim, match, b, racer);
      sim.tick();
    }
    expect(realmRacersGhosted(racer)).toBe(true);
    expect(sim.tickCount).toBeGreaterThan(progress.resetLockedUntilTick);
    return staged;
  }

  it('lets a Ground Blast land on an unlocked ghost', () => {
    const { sim, match, pids, racer } = unlockedGhost();
    match.groundBlasts.push({
      ownerPid: pids[2],
      x: racer.pos.x + 0.5,
      z: racer.pos.z + 0.4,
      impactTick: sim.tickCount + 1,
    });
    sim.tick();
    expect(racer.auras.some((aura) => aura.id === REALM_RACERS_GROUND_BLAST_AURA)).toBe(true);
  });

  it('lets a patch of oil catch an unlocked ghost', () => {
    const { sim, match, pids, racer, progress } = unlockedGhost();
    const local = realmRacersToCanonical(match, racer.pos.x, racer.pos.z);
    match.slicks.push({
      id: match.nextSlickId++,
      x: local.x,
      z: local.z,
      ownerPid: pids[2],
      ownerClear: true,
      expiresTick: sim.tickCount + REALM_RACERS_SLICK_LIFETIME_TICKS,
    });
    expect(progress.slickGripUntilTick).toBe(0);
    sim.tick();
    expect(progress.slickGripUntilTick).toBeGreaterThan(sim.tickCount);
  });
});

describe('the ghost aura lifecycle', () => {
  it('goes with the flag when the race ends', () => {
    const { sim, match, a, racer } = racing();
    sim.realmRacersResetPosition(a);
    const auras = watch(sim, 'aura');
    match.deadlineTick = sim.tickCount;
    sim.tick();
    expect(match.phase).toBe('finished');
    expect(realmRacersGhosted(racer)).toBe(false);
    expect(auras().filter((event) => event.name === 'Ghosted')).toEqual([]);
  });

  it('goes with a forfeit, at once, while the tableau still stands', () => {
    const { sim, a, racer, progress } = racing();
    sim.realmRacersResetPosition(a);
    sim.realmRacersForfeit(a);
    expect(progress.retiredTick).not.toBeNull();
    expect(progress.returned).toBe(false);
    expect(realmRacersGhosted(racer)).toBe(false);
    expect(progress.ghostCapTick).toBe(0);
  });

  it('goes with a disconnect', () => {
    const { sim, a, racer, progress } = racing();
    sim.realmRacersResetPosition(a);
    sim.preparePlayerLeave(a);
    expect(progress.returned).toBe(true);
    expect(realmRacersGhosted(racer)).toBe(false);
  });
});
