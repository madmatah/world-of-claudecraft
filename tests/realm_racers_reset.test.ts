import { describe, expect, it } from 'vitest';
import { REALM_RACERS_GRID_SIZE } from '../src/sim/realm_racers_layout';
import { realmRacersGates, realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_RESET_LOCK_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WRONG_WAY_TICKS,
  type RealmRacersMatch,
  realmRacersMovementLocked,
  realmRacersToWorld,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import type { Entity } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './vale_cup_util';

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function staged(): {
  sim: Sim;
  a: number;
  b: number;
  pids: number[];
  match: RealmRacersMatch;
  racer: Entity;
} {
  const sim = makeWorld();
  const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
    addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40),
  );
  for (const pid of pids) sim.realmRacersQueueJoin(pid);
  sim.tick();
  const match = required(sim.realmRacers.match, 'race');
  const racer = required(sim.entities.get(pids[0]), 'racer');
  return { sim, a: pids[0], b: pids[1], pids, match, racer };
}

function racing() {
  const stagedRace = staged();
  stagedRace.match.phase = 'racing';
  stagedRace.sim.tick();
  return stagedRace;
}

describe('Realm Racers recovery', () => {
  it('pins a two-second manual lock and three-second automatic recovery wait', () => {
    expect(REALM_RACERS_RESET_LOCK_TICKS).toBe(40);
    expect(REALM_RACERS_STUCK_TICKS).toBe(60);
  });

  it('advances the silent recovery anchor after crossing the next ordered spline gate', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const gate = required(realmRacersGates()[1], 'recovery gate');
    progress.nextResetGate = gate.index;
    const before = realmRacersToWorld(match, gate.x - gate.dirX * 1.5, gate.z - gate.dirZ * 1.5);
    const after = realmRacersToWorld(match, gate.x + gate.dirX * 1.5, gate.z + gate.dirZ * 1.5);
    racer.prevPos.x = before.x;
    racer.prevPos.z = before.z;
    racer.pos.x = after.x;
    racer.pos.z = after.z;
    sim.drainEvents();

    updateRealmRacers(sim.ctx);

    expect(progress).toMatchObject({ nextResetGate: 2, resetS: gate.s });
    expect(progress.resetDistanceSinceWrap).toBeLessThan(progress.distanceSinceWrap);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('resets to the recovery-anchor pose and restores its progress snapshot', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const track = realmRacersTrack();
    const anchor = track.pointAt(track.length * 0.25);
    progress.resetS = anchor.s;
    progress.resetLap = 2;
    progress.resetDistanceSinceWrap = track.length * 0.25;
    progress.lap = 3;
    progress.distanceSinceWrap = track.length * 0.9;
    required(racer.drive, 'drive').speed = 38;
    teleport(sim, a, anchor.x + 30, anchor.z + 30);
    sim.drainEvents();

    sim.realmRacersResetPosition(a);

    expect(racer.pos.x).toBeCloseTo(anchor.x, 6);
    expect(racer.pos.z).toBeCloseTo(anchor.z, 6);
    expect(racer.facing).toBeCloseTo(Math.atan2(anchor.tx, anchor.tz), 6);
    expect(racer.drive).toMatchObject({ speed: 0, slip: 0, controlsLocked: true });
    expect(progress).toMatchObject({
      lap: 2,
      lastS: anchor.s,
      distanceSinceWrap: track.length * 0.25,
      wrongWay: false,
      stuckTicks: 0,
    });
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(true);
    expect(sim.drainEvents()).toContainEqual({ type: 'realmRacersReset', pid: a });
  });

  it('ignores reset requests outside a live racing phase', () => {
    const { sim, a, match, racer } = staged();
    const countdownX = racer.pos.x;
    sim.realmRacersResetPosition(a);
    expect(racer.pos.x).toBe(countdownX);

    match.phase = 'finished';
    racer.pos.x += 7;
    const finishedX = racer.pos.x;
    sim.realmRacersResetPosition(a);
    expect(racer.pos.x).toBe(finishedX);
  });

  it('holds movement for two seconds after a reset, then returns control', () => {
    const { sim, a, pids, racer } = racing();
    // Clear the rest of the grid off the centerline: recovery drops a machine
    // on the racing line, and a neighbour parked on it would legitimately be
    // shoved aside by the contact pass, which is a different test.
    const track = realmRacersTrack();
    pids.slice(1).forEach((pid, i) => {
      const away = track.pointAt(track.length * (0.3 + i * 0.15));
      teleport(sim, pid, away.x, away.z);
    });
    sim.realmRacersResetPosition(a);
    const startX = racer.pos.x;
    const startZ = racer.pos.z;
    required(sim.players.get(a), 'player').moveInput.forward = true;

    for (let i = 0; i < REALM_RACERS_RESET_LOCK_TICKS; i++) sim.tick();
    expect(Math.hypot(racer.pos.x - startX, racer.pos.z - startZ)).toBeLessThan(0.01);
    expect(racer.drive?.speed).toBe(0);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(true);

    sim.tick();
    expect(racer.drive?.speed).toBeGreaterThan(0);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(false);
  });

  it('automatically recovers after three seconds stopped off track without another lock', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const track = realmRacersTrack();
    const road = track.pointAt(track.length * 0.4);
    progress.resetS = road.s;
    const lateral = road.halfWidth + 8;
    teleport(sim, a, road.x - road.tz * lateral, road.z + road.tx * lateral);

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.resetLockedUntilTick).toBe(0);
    sim.tick();

    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
    expect(progress.resetLockedUntilTick).toBe(0);
    expect(racer.drive?.controlsLocked).toBe(false);
    expect(realmRacersMovementLocked(sim.ctx, a)).toBe(false);
    expect(racer.auras.some((aura) => aura.name === REALM_RACERS_VERGE_BAND.name)).toBe(false);
  });

  it('never auto-recovers a machine parked on the road', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.4);
    teleport(sim, a, road.x, road.z);

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) sim.tick();

    expect(progress.resetLockedUntilTick).toBe(0);
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
  });

  it('never auto-recovers an off-road machine that is still moving', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.4);
    const lateral = road.halfWidth + 8;
    teleport(sim, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    const offRoadX = racer.pos.x;
    const offRoadZ = racer.pos.z;

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) {
      required(racer.drive, 'drive').speed = 2;
      updateRealmRacers(sim.ctx);
    }

    expect(progress.stuckTicks).toBe(0);
    expect(racer.pos.x).toBeCloseTo(offRoadX, 5);
    expect(racer.pos.z).toBeCloseTo(offRoadZ, 5);
  });

  it('never advances the recovery anchor past the next UNCROSSED gate, so reset never gains ground', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const gates = realmRacersGates();
    const gate2 = required(gates[2], 'gate 2');
    const gate3 = required(gates[3], 'gate 3');

    // Cross gates 1 and 2 in order, exactly like the single-gate case above,
    // so the anchor legitimately advances twice before the probe.
    for (const gate of [required(gates[1], 'gate 1'), gate2]) {
      progress.nextResetGate = gate.index;
      const before = realmRacersToWorld(match, gate.x - gate.dirX * 1.5, gate.z - gate.dirZ * 1.5);
      const after = realmRacersToWorld(match, gate.x + gate.dirX * 1.5, gate.z + gate.dirZ * 1.5);
      racer.prevPos.x = before.x;
      racer.prevPos.z = before.z;
      racer.pos.x = after.x;
      racer.pos.z = after.z;
      updateRealmRacers(sim.ctx);
    }
    expect(progress).toMatchObject({ nextResetGate: gate3.index, resetS: gate2.s });
    const anchorAfterGate2 = { resetS: progress.resetS, resetLap: progress.resetLap };

    // Approach gate 3 but stop just short of its plane: both prevPos and pos
    // stay on the near side, so this tick crosses nothing.
    const short = realmRacersToWorld(match, gate3.x - gate3.dirX * 1.5, gate3.z - gate3.dirZ * 1.5);
    racer.prevPos.x = short.x;
    racer.prevPos.z = short.z;
    racer.pos.x = short.x + gate3.dirX * 0.2;
    racer.pos.z = short.z + gate3.dirZ * 0.2;
    updateRealmRacers(sim.ctx);

    expect(progress).toMatchObject({ nextResetGate: gate3.index, ...anchorAfterGate2 });

    sim.drainEvents();
    sim.realmRacersResetPosition(a);
    const anchor = realmRacersTrack().pointAt(anchorAfterGate2.resetS);
    expect(racer.pos.x).toBeCloseTo(anchor.x, 6);
    expect(racer.pos.z).toBeCloseTo(anchor.z, 6);
  });

  it('requires the full stuck window WITHOUT interruption, not an accumulated total', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.4);
    progress.resetS = road.s;
    const lateral = road.halfWidth + 8;
    const offRoadX = road.x - road.tz * lateral;
    const offRoadZ = road.z + road.tx * lateral;
    teleport(sim, a, offRoadX, offRoadZ);

    // Stopped off track for most, but not all, of the window.
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.stuckTicks).toBe(REALM_RACERS_STUCK_TICKS - 1);

    // One tick back on the road interrupts the count...
    teleport(sim, a, road.x, road.z);
    sim.tick();
    expect(progress.stuckTicks).toBe(0);

    // ...so returning off track resets the wait: the two nearly-full bouts
    // never sum past the threshold, only a single unbroken window does.
    teleport(sim, a, offRoadX, offRoadZ);
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS - 1; i++) sim.tick();
    expect(progress.resetLockedUntilTick).toBe(0);
    expect(racer.pos.x).toBeCloseTo(offRoadX, 5);

    sim.tick();
    expect(racer.pos.x).toBeCloseTo(road.x, 5);
    expect(racer.pos.z).toBeCloseTo(road.z, 5);
  });

  it('never counts an off-road stopped machine while its manual reset lock is active', () => {
    const { sim, a, match, racer } = racing();
    const progress = required(match.progress.get(a), 'progress');
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.4);
    const lateral = road.halfWidth + 8;
    teleport(sim, a, road.x - road.tz * lateral, road.z + road.tx * lateral);
    const lockedX = racer.pos.x;
    const lockedZ = racer.pos.z;
    progress.resetLockedUntilTick = sim.ctx.tickCount + REALM_RACERS_RESET_LOCK_TICKS;

    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 5; i++) updateRealmRacers(sim.ctx);

    expect(progress.stuckTicks).toBe(0);
    expect(racer.pos.x).toBeCloseTo(lockedX, 5);
    expect(racer.pos.z).toBeCloseTo(lockedZ, 5);
  });
});

describe('Realm Racers wrong-way state', () => {
  it('requires sustained reverse heading and clears on a forward heading', () => {
    const { sim, a, racer } = racing();
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.3);
    teleport(sim, a, road.x, road.z);
    racer.facing = Math.atan2(-road.tx, -road.tz);

    for (let i = 0; i < REALM_RACERS_WRONG_WAY_TICKS - 1; i++) sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(true);

    racer.facing = Math.atan2(road.tx, road.tz);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
  });

  it('never raises on an isolated blip followed by neutral driving', () => {
    const { sim, a, racer } = racing();
    const road = realmRacersTrack().pointAt(realmRacersTrack().length * 0.3);
    teleport(sim, a, road.x, road.z);

    // One tick pointed backward: far short of the debounce window.
    racer.facing = Math.atan2(-road.tx, -road.tz);
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);

    // Then drive with a heading perpendicular to the track (forwardDot ~ 0,
    // inside the dead zone) for well over the debounce window. A regression
    // that dropped the debounce entirely would have already tripped above;
    // this proves the blip alone never surfaces as wrongWay to the player.
    racer.facing = Math.atan2(-road.tz, road.tx);
    for (let i = 0; i < REALM_RACERS_WRONG_WAY_TICKS * 2; i++) {
      sim.tick();
      expect(sim.realmRacersInfoFor(a).match?.wrongWay).toBe(false);
    }
  });
});
