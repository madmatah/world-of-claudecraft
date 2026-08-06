import { describe, expect, it } from 'vitest';
import { mountVisualSpec } from '../src/render/mount_visuals';
import { resolvePosition } from '../src/sim/colliders';
import { MOUNTS, type MountKey } from '../src/sim/content/mounts';
import { REALM_RACERS_ABILITY_ID } from '../src/sim/content/realm_racers';
import { realmRacersCompetitionCircuits } from '../src/sim/content/realm_racers_circuits';

/** The circuit a QUEUED race runs on, which is what every case here seats.
 *  Resolved from the pool rather than named, so these suites follow the
 *  competition circuit instead of silently measuring the practice one. */
const RACE_CIRCUIT = realmRacersCompetitionCircuits()[0];

import { vehicleProfile } from '../src/sim/content/vehicles';
import { updateDeeds } from '../src/sim/deeds';
import { forceDismount } from '../src/sim/mounts';
import { GROUND_BLAST_CONTROL_SPEED_MULT } from '../src/sim/realm_racers_ground_blast';
import {
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { CharacterState, Sim } from '../src/sim/sim';
import {
  REALM_RACERS_BUMP_EVENT_MIN_IMPACT,
  REALM_RACERS_BUMP_EVENT_TICKS,
  REALM_RACERS_CHASE_TICKS,
  REALM_RACERS_COUNTDOWN_TICKS,
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_MOUNT_KEY,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_RETURN_TICKS,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_VERGE_BAND,
  realmRacersCircuitOf,
  realmRacersFireGroundBlast,
  realmRacersStartMatch,
  realmRacersToCanonical,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import { startRealmRacersDevRace } from '../src/sim/social/realm_racers_bots';
import type { Entity, SimEvent } from '../src/sim/types';
import { TICK_RATE } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './vale_cup_util';

const LOANER = vehicleProfile('rally_loaner');

/** Four pilots, in grid order, is what a race is. */
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

function entity(sim: Sim, pid: number): Entity {
  return required(sim.entities.get(pid), `entity ${pid}`);
}

function match(sim: Sim): NonNullable<Sim['realmRacers']['match']> {
  return required(sim.realmRacers.match, 'Realm Racers match');
}

/** A world with four idle pilots standing outside the circuit. */
function makeGrid(): { sim: Sim; pids: number[] } {
  const sim = makeWorld();
  const pids = GRID.map((row) => addAt(sim, row.cls, row.name, row.x, row.z));
  return { sim, pids };
}

function startMatch(): { sim: Sim; pids: number[]; a: number; b: number } {
  const { sim, pids } = makeGrid();
  for (const pid of pids) sim.realmRacersQueueJoin(pid);
  sim.tick();
  expect(sim.realmRacers.match).not.toBeNull();
  return { sim, pids, a: pids[0], b: pids[1] };
}

function placeAtS(sim: Sim, pid: number, s: number, lateral = 0): void {
  const liveMatch = match(sim);
  const sample = realmRacersTrack(RACE_CIRCUIT).pointAt(s);
  teleport(
    sim,
    pid,
    liveMatch.origin.x + sample.x - sample.tz * lateral,
    liveMatch.origin.z + sample.z + sample.tx * lateral,
  );
}

/** A canonical point on the race's OWN lane. A public race stopped standing on
 *  lane 0 the day the practice circuit lost its public lane, so an absolute
 *  placement has to add the match origin or it lands on somebody else's copy. */
function onLane(sim: Sim, x: number, z: number): { x: number; z: number } {
  const liveMatch = match(sim);
  return { x: liveMatch.origin.x + x, z: liveMatch.origin.z + z };
}

/**
 * Parks a machine off the road at a chosen point, with the lap bookkeeping a
 * machine that DROVE there would have left behind.
 *
 * A bare teleport is not a drive, and the track-limits referee is written in
 * exactly that difference: it measures arc gained against ground covered, so a
 * fixture that jumps a machine across the circuit reads as a cut and is returned
 * before the case under test gets a tick. Stamping `lastS` at the destination is
 * what makes the jump a premise rather than an event.
 */
function parkOffRoad(sim: Sim, pid: number, x: number, z: number): void {
  const liveMatch = match(sim);
  teleport(sim, pid, x, z);
  const progress = required(liveMatch.progress.get(pid), `progress ${pid}`);
  const local = realmRacersToCanonical(liveMatch, x, z);
  const projection = realmRacersTrack(RACE_CIRCUIT).project(local.x, local.z);
  progress.lastS = projection.s;
  progress.trackIndex = projection.index;
}

function advanceArc(sim: Sim, pid: number, distance: number): void {
  const liveMatch = match(sim);
  const progress = required(liveMatch.progress.get(pid), `progress ${pid}`);
  let remaining = distance;
  while (remaining > 0 && liveMatch.phase === 'racing') {
    const step = Math.min(40, remaining);
    placeAtS(sim, pid, progress.lastS + step);
    updateRealmRacers(sim.ctx);
    remaining -= step;
  }
}

function crossStart(sim: Sim, pid: number): void {
  const progress = required(match(sim).progress.get(pid), `progress ${pid}`);
  placeAtS(sim, pid, progress.lastS + 12);
  updateRealmRacers(sim.ctx);
}

function completeLap(sim: Sim, pid: number): void {
  advanceArc(sim, pid, realmRacersTrack(RACE_CIRCUIT).length + 12);
}

describe('The Realm Racers loaned machine', () => {
  // Entity.mountKey is a bare string, so the mount the rally seats its racers on
  // is not type-checked against the catalog: when the mount catalog renamed its
  // key out from under a hardcoded literal, every racer silently rendered on
  // foot. These pin the two halves separately so the next rename fails loudly.
  it('names a mount that exists in the catalog and carries a visual', () => {
    expect(REALM_RACERS_MOUNT_KEY).toBe('terrorspark_groundshaker');
    expect(MOUNTS[REALM_RACERS_MOUNT_KEY as MountKey]).toBeDefined();
    expect(mountVisualSpec(REALM_RACERS_MOUNT_KEY)).not.toBeNull();
  });

  it('keeps the profile key out of the mount namespace', () => {
    expect(REALM_RACERS_VEHICLE_KEY).toBe('rally_loaner');
    expect(REALM_RACERS_VEHICLE_KEY in MOUNTS).toBe(false);
    expect(vehicleProfile(REALM_RACERS_VEHICLE_KEY).key).toBe(REALM_RACERS_MOUNT_KEY);
  });
});

describe('The Realm Racers lifecycle', () => {
  it('waits for a full grid, then runs a silent overview before the three-count', () => {
    const { sim, pids } = makeGrid();
    const [a, b] = pids;
    // Three humans is not a race: the grid is four abreast or it does not start.
    for (const pid of pids.slice(0, REALM_RACERS_GRID_SIZE - 1)) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(sim.realmRacers.match).toBeNull();
    expect(sim.realmRacersInfoFor(a)).toMatchObject({
      queued: true,
      queuePosition: 1,
      queueSize: REALM_RACERS_GRID_SIZE - 1,
      match: null,
    });
    sim.realmRacersQueueJoin(pids[REALM_RACERS_GRID_SIZE - 1]);
    sim.tick();
    const liveMatch = match(sim);
    expect(liveMatch.goTick - sim.tickCount).toBe(180);
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({
      countdown: 0,
      countdownTicks: 180,
      participantIds: pids,
      gridSize: REALM_RACERS_GRID_SIZE,
    });
    expect(sim.realmRacersInfoFor(b).match?.participantIds).toEqual(pids);
    for (const pid of pids) expect(entity(sim, pid).mountKey).toBe('terrorspark_groundshaker');
    const aMeta = required(sim.players.get(a), `player ${a}`);
    expect(aMeta.known.map((known) => known.def.id)).toEqual(['rally_ground_blast']);
    const before = { ...entity(sim, a).pos };
    aMeta.moveInput.forward = true;
    for (let i = 0; i < 119; i++) sim.tick();
    expect(entity(sim, a).pos.x).toBeCloseTo(before.x, 6);
    expect(entity(sim, a).pos.z).toBeCloseTo(before.z, 6);
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({ countdown: 0, countdownTicks: 61 });
    sim.tick();
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({ countdown: 3, countdownTicks: 60 });
    for (let i = 0; i < 59; i++) sim.tick();
    expect(liveMatch.phase).toBe('countdown');
    sim.tick();
    expect(liveMatch.phase).toBe('racing');
  });

  it('seats every pilot on its own grid slot with no two hulls overlapping', () => {
    const { sim, pids } = startMatch();
    const liveMatch = match(sim);
    expect(liveMatch.pids).toEqual(pids);
    expect(liveMatch.gridSize).toBe(REALM_RACERS_GRID_SIZE);
    for (let i = 0; i < pids.length; i++) {
      for (let j = i + 1; j < pids.length; j++) {
        const p = entity(sim, pids[i]).pos;
        const q = entity(sim, pids[j]).pos;
        expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(2 * LOANER.bodyRadius);
      }
    }
  });

  it('refuses a grid that is not exactly four distinct eligible pilots', () => {
    const { sim, pids } = makeGrid();
    expect(realmRacersStartMatch(sim.ctx, pids.slice(0, 3))).toBe(false);
    expect(sim.realmRacers.match).toBeNull();
    const fifth = addAt(sim, 'shaman', 'Elm', 13, -46);
    expect(realmRacersStartMatch(sim.ctx, [...pids, fifth])).toBe(false);
    expect(sim.realmRacers.match).toBeNull();
    // Four entries but only three pilots: a duplicate would seat one machine
    // twice and hand it two rows in the standings.
    expect(realmRacersStartMatch(sim.ctx, [pids[0], pids[1], pids[2], pids[0]])).toBe(false);
    expect(sim.realmRacers.match).toBeNull();
    expect(realmRacersStartMatch(sim.ctx, pids)).toBe(true);
    expect(match(sim).pids).toEqual(pids);
  });

  it('keeps the race running until the last machine is home, then ranks the field', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    crossStart(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 1 });
    completeLap(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 2 });
    completeLap(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 3 });
    completeLap(sim, a);
    // The leader is home and the race is NOT over: three machines are still out
    // there fighting over the rest of the podium.
    expect(required(liveMatch.progress.get(a), `progress ${a}`).finishedTick).not.toBeNull();
    expect(liveMatch.phase).toBe('racing');
    expect(sim.realmRacersInfoFor(a).match?.me.position).toBe(1);

    for (const pid of [b, c, d]) {
      // A tick apart, so each crossing has its own finish tick rather than four
      // machines cutting the line inside the same 50 ms.
      sim.tickCount++;
      crossStart(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
    }
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).toBe(a);
    expect(liveMatch.finishOrder).toEqual([a, b, c, d]);
    expect(sim.realmRacersInfoFor(a).match?.result).toBe('won');
    expect(sim.realmRacersInfoFor(d).match?.result).toBe('lost');
    expect(sim.realmRacersInfoFor(d).match?.me.position).toBe(4);
  });

  it('closes the race a chase window after the winner, not at the time limit', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    // A wins. B, C and D are still out there, and D has stopped driving.
    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    const armed = required(liveMatch.chaseUntilTick, 'chase window');
    expect(armed - sim.tickCount).toBe(REALM_RACERS_CHASE_TICKS);
    expect(liveMatch.phase).toBe('racing');
    // The window is a clock the pilots still out are told about, not a silent
    // cut-off; the ones already home are waiting on it, not racing it.
    expect(sim.realmRacersInfoFor(b).match?.chaseIn).toBe(REALM_RACERS_CHASE_TICKS / 20);
    expect(sim.realmRacersInfoFor(a).match?.chaseIn).toBe(0);

    // A second finisher does not push the window back: it is the WINNER's clock.
    sim.tickCount++;
    crossStart(sim, b);
    completeLap(sim, b);
    completeLap(sim, b);
    completeLap(sim, b);
    expect(liveMatch.chaseUntilTick).toBe(armed);
    expect(liveMatch.phase).toBe('racing');

    // C gets home inside the window; D never does and is ranked where it stands.
    placeAtS(sim, c, 200);
    updateRealmRacers(sim.ctx);
    sim.tickCount = armed;
    updateRealmRacers(sim.ctx);
    expect(liveMatch.phase).toBe('finished');
    // Well short of the 180 s limit, which is what the window exists to avoid.
    expect(sim.tickCount).toBeLessThan(liveMatch.deadlineTick);
    expect(liveMatch.winnerPid).toBe(a);
    expect(liveMatch.finishOrder).toEqual([a, b, c, d]);
  });

  it('times each finisher from the flag, sub-tick, and marks the race decided', () => {
    const { sim, pids } = startMatch();
    const [a, b] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    // The flag fell two seconds ago. The helpers below drive progress by
    // teleporting rather than by ticking the clock, so the start has to be put
    // in the past deliberately or every finish time would clamp to zero.
    liveMatch.goTick = sim.tickCount - 40;
    // Nobody has crossed: no time, and the race is not decided, so the podium
    // has nothing to stand on.
    expect(sim.realmRacersInfoFor(a).match?.decided).toBe(false);
    expect(sim.realmRacersInfoFor(a).match?.me.finishSeconds).toBeNull();

    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    const progress = required(liveMatch.progress.get(a), `progress ${a}`);
    const seconds = required(sim.realmRacersInfoFor(a).match?.me.finishSeconds, 'finish time');
    // Measured from the flag, and sub-tick: the crossing happened inside the
    // tick that detected it, at the fraction of the segment the gate test
    // returned, so the time is `finishedTick - 1 + fraction` past `goTick`.
    expect(seconds).toBeCloseTo(
      (required(progress.finishedTick, 'finish tick') -
        1 +
        progress.finishFraction -
        liveMatch.goTick) /
        20,
      6,
    );
    expect(seconds).toBeGreaterThan(0);
    // Two machines crossing on the SAME tick are still two different times,
    // which is the whole reason the fraction is folded in.
    const other = required(liveMatch.progress.get(b), `progress ${b}`);
    other.finishedTick = progress.finishedTick;
    other.finishFraction = progress.finishFraction / 2;
    const both = required(sim.realmRacersInfoFor(a).match, 'match info').standings;
    const times = both.flatMap((row) => (row.finishSeconds === null ? [] : [row.finishSeconds]));
    expect(new Set(times).size).toBe(times.length);

    // `decided` is the RACE's state, not the viewer's: it stays false while
    // anyone is still driving and flips when the classification is final.
    expect(sim.realmRacersInfoFor(a).match?.decided).toBe(false);
    for (const pid of pids.slice(2)) sim.realmRacersForfeit(pid);
    expect(liveMatch.phase).toBe('finished');
    expect(sim.realmRacersInfoFor(a).match?.decided).toBe(true);
  });

  it('reports a dead heat for the LEAD, but a tie for third is a placing', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    // A and B level at the front; C and D level with each other, well behind.
    for (const pid of [a, b]) {
      required(liveMatch.progress.get(pid), `progress ${pid}`).travelled = 120;
    }
    liveMatch.deadlineTick = sim.tickCount + RACE_CIRCUIT.timeLimitSeconds * TICK_RATE;
    sim.tickCount = liveMatch.deadlineTick;
    updateRealmRacers(sim.ctx);
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).toBeNull();
    expect(sim.realmRacersInfoFor(a).match?.result).toBe('draw');
    expect(sim.realmRacersInfoFor(b).match?.result).toBe('draw');
    // The pair tied for third are still ranked third and fourth, and they lost.
    expect(sim.realmRacersInfoFor(c).match?.result).toBe('lost');
    expect(sim.realmRacersInfoFor(d).match?.result).toBe('lost');
    expect(sim.realmRacersInfoFor(c).match?.me.position).toBe(3);
    expect(sim.realmRacersInfoFor(d).match?.me.position).toBe(4);
  });

  it('ranks the whole field by yards down the circuit', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    // Deliberately out of grid order: B leads, then D, then A, then C.
    for (const [pid, s] of [
      [b, 90],
      [d, 60],
      [a, 30],
      [c, 10],
    ] as const) {
      placeAtS(sim, pid, s);
      updateRealmRacers(sim.ctx);
    }
    const info = required(sim.realmRacersInfoFor(a).match, 'match info');
    expect(info.standings.map((row) => row.pid)).toEqual([b, d, a, c]);
    expect(info.standings.map((row) => row.position)).toEqual([1, 2, 3, 4]);
    expect(info.me.pid).toBe(a);
    expect(info.me.position).toBe(3);
    // The standings carry who each pilot IS, which is what the panel draws:
    // their name and the class its portrait comes from.
    expect(info.standings.map((row) => row.name)).toEqual(['Briar', 'Dell', 'Aster', 'Cass']);
    expect(info.standings.map((row) => row.cls)).toEqual(['mage', 'priest', 'warrior', 'rogue']);
    // The frozen grid order is untouched by the live sort: the renderer's
    // membership pins read identity, not placing.
    expect(info.participantIds).toEqual(pids);
    // Every viewer sees the SAME order; only `me` moves.
    expect(
      required(sim.realmRacersInfoFor(c).match, 'match info c').standings.map((r) => r.pid),
    ).toEqual([b, d, a, c]);
  });

  it('does not end anyone else’s race when one pilot forfeits', () => {
    const { sim, pids } = startMatch();
    const [a, b] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    updateRealmRacers(sim.ctx);
    sim.realmRacersForfeit(a);
    // The race carries on for the other three, and nobody was handed a win.
    expect(liveMatch.phase).toBe('racing');
    expect(liveMatch.winnerPid).toBeNull();
    expect(sim.realmRacersInfoFor(b).match?.result).toBeNull();
    expect(sim.realmRacersInfoFor(b).match?.phase).toBe('racing');
    // The quitter is classified last, and sees their own tableau at once.
    const quitter = required(sim.realmRacersInfoFor(a).match, 'quitter info');
    expect(quitter.result).toBe('forfeit');
    expect(quitter.phase).toBe('finished');
    expect(quitter.me.position).toBe(REALM_RACERS_GRID_SIZE);
    expect(quitter.me.retired).toBe(true);
    expect(quitter.returnIn).toBeGreaterThan(0);
    // ...and is returned on their OWN clock, while the race is still live.
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    expect(sim.realmRacersInfoFor(a).match).toBeNull();
    expect(entity(sim, a).drive).toBeNull();
    expect(sim.realmRacers.match).not.toBeNull();
    expect(match(sim).phase).toBe('racing');
    expect(entity(sim, b).drive).not.toBeNull();
  });

  it('ends the race at once when three of four quit, with the survivor first', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    updateRealmRacers(sim.ctx);
    sim.realmRacersForfeit(b);
    sim.tick();
    sim.realmRacersForfeit(c);
    sim.tick();
    expect(liveMatch.phase).toBe('racing');
    sim.realmRacersForfeit(d);
    // Nobody drives three lonely laps: the last pilot standing takes the win.
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).toBe(a);
    expect(sim.realmRacersInfoFor(a).match?.result).toBe('won');
    // The quitters are ranked behind the survivor, latest quitter first: a
    // pilot who drove most of the race beat one who pulled off immediately.
    expect(liveMatch.finishOrder).toEqual([a, d, c, b]);
  });

  it('treats a disconnect exactly like a forfeit, without ending the race', () => {
    const { sim, pids } = startMatch();
    const [a, b] = pids;
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    updateRealmRacers(sim.ctx);
    // A departing player is marked leaving before the persistence await; the
    // match module's own roster pass is what has to notice.
    required(sim.players.get(a), `player ${a}`).leaving = true;
    updateRealmRacers(sim.ctx);
    expect(liveMatch.phase).toBe('racing');
    expect(required(liveMatch.progress.get(a), `progress ${a}`).retiredTick).not.toBeNull();
    // Restored at ONCE, not after the tableau: the host saves the character
    // straight after this and must not persist a seated racer.
    expect(required(liveMatch.progress.get(a), `progress ${a}`).returned).toBe(true);
    expect(entity(sim, a).drive).toBeNull();
    expect(required(sim.players.get(a), `player ${a}`).realmRacersMatchId).toBeNull();
    expect(sim.realmRacersInfoFor(a).match).toBeNull();
    expect(sim.realmRacersInfoFor(b).match?.phase).toBe('racing');
  });

  it('keeps Ground Blast mounted and applies one short no-damage destabilization', () => {
    const { sim, a, b } = startMatch();
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    // The phase drives the CONTROL LOCK the match module writes onto each
    // machine every tick, and the cast gate refuses a held pilot outright.
    // Flipping the phase without running the module leaves both on the grid.
    updateRealmRacers(sim.ctx);
    const caster = entity(sim, a);
    const target = entity(sim, b);
    caster.facing = 0;
    teleport(sim, a, caster.pos.x, caster.pos.z);
    teleport(sim, b, caster.pos.x, caster.pos.z + 12);
    const hp = target.hp;
    // The pilot places the circle themselves, so the cast carries the ground
    // point: here, straight onto a parked rival.
    sim.castAbility(REALM_RACERS_ABILITY_ID, a, { x: target.pos.x, z: target.pos.z });
    expect(caster.mountKey).toBe('terrorspark_groundshaker');
    expect(liveMatch.groundBlasts).toHaveLength(1);
    for (let i = 0; i < 25 && liveMatch.groundBlasts.length > 0; i++) sim.tick();
    expect(liveMatch.groundBlasts).toHaveLength(0);
    expect(target.hp).toBe(hp);
    expect(
      target.auras.find((aura) => aura.id === 'realm_racers_ground_blast_control'),
    ).toMatchObject({
      kind: 'slow',
      value: GROUND_BLAST_CONTROL_SPEED_MULT,
    });
  });

  it('shows the forfeit result, then restores position, facing, pools, kit, and prior mount', () => {
    const { sim, pids } = makeGrid();
    const [a, b] = pids;
    const aEntity = entity(sim, a);
    const bEntity = entity(sim, b);
    aEntity.facing = 1.25;
    bEntity.facing = -0.5;
    aEntity.mountKey = 'valorsteed';
    aEntity.hp = 31;
    aEntity.resource = 7;
    aEntity.cooldowns.set('charge', 9);
    const expectedA = { x: aEntity.pos.x, z: aEntity.pos.z, facing: aEntity.facing };
    const expectedB = { x: bEntity.pos.x, z: bEntity.pos.z, facing: bEntity.facing };
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(aEntity.mountKey).toBe('terrorspark_groundshaker');
    sim.realmRacersForfeit(a);
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({
      phase: 'finished',
      result: 'forfeit',
    });
    // The three that stayed are still racing: a quitter hands nobody a win.
    expect(sim.realmRacersInfoFor(b).match).toMatchObject({ result: null });
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS; i++) sim.tick();
    expect(sim.realmRacersInfoFor(a).match).toBeNull();
    expect(aEntity.pos.x).toBeCloseTo(expectedA.x, 6);
    expect(aEntity.pos.z).toBeCloseTo(expectedA.z, 6);
    expect(aEntity.facing).toBeCloseTo(expectedA.facing, 6);
    expect(aEntity.mountKey).toBe('valorsteed');
    expect(aEntity.hp).toBe(31);
    expect(aEntity.resource).toBe(7);
    // Match formation happens at the tail of the next 20 Hz tick, after the
    // ordinary cooldown clock advances once; teardown returns that exact 8.95s
    // snapshot rather than resetting or gifting the missing time.
    expect(aEntity.cooldowns.get('charge')).toBe(8.95);
    const restoredMeta = required(sim.players.get(a), `player ${a}`);
    expect(restoredMeta.realmRacersMatchId).toBeNull();
    expect(restoredMeta.known.some((known) => known.def.id === 'rally_ground_blast')).toBe(false);

    // And the rest of the field is returned exactly where it was found once the
    // race itself is over.
    for (const pid of pids.slice(1)) sim.realmRacersForfeit(pid);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    expect(sim.realmRacers.match).toBeNull();
    expect(bEntity.pos.x).toBeCloseTo(expectedB.x, 6);
    expect(bEntity.pos.z).toBeCloseTo(expectedB.z, 6);
    expect(bEntity.facing).toBeCloseTo(expectedB.facing, 6);
    expect(bEntity.mountKey).toBe('');
  });

  it('restores temporary Rally state before a disconnect save', () => {
    const { sim, a, b } = startMatch();
    const original = match(sim).returns.get(a);
    sim.preparePlayerLeave(a);
    expect(entity(sim, a).pos).toMatchObject({ x: original?.x, z: original?.z });
    expect(required(sim.players.get(a), `player ${a}`).realmRacersMatchId).toBeNull();
    expect(sim.realmRacersInfoFor(a).match).toBeNull();
    // The other three are unaffected: one player closing their client is not
    // three other people's race ending.
    expect(sim.realmRacers.match).not.toBeNull();
    expect(sim.realmRacersInfoFor(b).match).not.toBeNull();
  });

  it('still restores before a disconnect save when the pilot had already forfeited', () => {
    // Forfeit first (the six-second tableau starts), THEN close the client
    // inside that window: the restore the leave save depends on must still run,
    // or the save captures full pools, cleared cooldowns, and the loaned kit.
    const { sim, a } = startMatch();
    sim.realmRacersForfeit(a);
    const original = match(sim).returns.get(a);
    sim.preparePlayerLeave(a);
    const meta = required(sim.players.get(a), `player ${a}`);
    expect(entity(sim, a).pos).toMatchObject({ x: original?.x, z: original?.z });
    expect(meta.realmRacersMatchId).toBeNull();
    expect(entity(sim, a).drive).toBeNull();
    expect(meta.known.some((known) => known.def.id === 'rally_ground_blast')).toBe(false);
  });

  it('leaves a returned quitter alone in the open world while the race runs on', () => {
    // A pilot who forfeits and is returned stays on the frozen grid for the
    // classification, but the referee must stop reprojecting their Evergarden
    // body onto the circuit copy: that lands them in the garden band and pins
    // an off-track slow on a player who is not racing. Checked on EVERY tick
    // after the return, because the stuck arm used to swallow the aura a few
    // seconds in and make the steady state look clean.
    const { sim, a } = startMatch();
    sim.realmRacersForfeit(a);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progress.returned).toBe(true);
    const aEntity = entity(sim, a);
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS + 80; i++) {
      sim.tick();
      expect(
        aEntity.auras.some((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA),
        `tick ${i}`,
      ).toBe(false);
    }
    expect(sim.realmRacers.match).not.toBeNull();
  });

  it('does not republish the rally kit onto a pilot the race already returned', () => {
    // A quitter holding an unspent effect is returned to their class kit; when
    // the race later ends, the tableau sweep must not hand them the rally kit
    // back in the middle of the Evergarden.
    const { sim, a, pids } = startMatch();
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    progress.heldEffect = 'nitro';
    sim.realmRacersForfeit(a);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    const meta = required(sim.players.get(a), `player ${a}`);
    expect(progress.returned).toBe(true);
    expect(meta.known.some((known) => known.def.id === 'rally_ground_blast')).toBe(false);
    for (const pid of pids.slice(1)) sim.realmRacersForfeit(pid);
    expect(match(sim).phase).toBe('finished');
    expect(meta.known.length).toBeGreaterThan(0);
    expect(meta.known.some((known) => known.def.id === 'rally_ground_blast')).toBe(false);
  });

  it('keeps a banked finish when the pilot leaves during the chase window', () => {
    // Crossing the line banks the placing: a disconnect while the rest of the
    // field chases must not reclassify the finisher as a quitter and hand the
    // win, and the rated meter, to someone who never crossed.
    const { sim, a, pids } = startMatch();
    const m = match(sim);
    m.phase = 'racing';
    const progress = required(m.progress.get(a), `progress ${a}`);
    progress.finishedTick = sim.ctx.tickCount;
    sim.preparePlayerLeave(a);
    expect(progress.finishedTick).not.toBeNull();
    expect(progress.retiredTick).toBeNull();
    expect(progress.returned).toBe(true);
    for (const pid of pids.slice(1)) sim.realmRacersForfeit(pid);
    expect(m.phase).toBe('finished');
    expect(m.winnerPid).toBe(a);
    expect(required(sim.players.get(a), `player ${a}`).rrWins).toBe(1);
  });

  it('does not issue a second tableau to a pilot who leaves during the finished phase', () => {
    const { sim, a, pids } = startMatch();
    const m = match(sim);
    m.phase = 'racing';
    for (const pid of pids.slice(1)) sim.realmRacersForfeit(pid);
    expect(m.phase).toBe('finished');
    sim.drainEvents();
    sim.realmRacersForfeit(a);
    const repeats = sim
      .drainEvents()
      .filter((ev) => ev.type === 'realmRacersResult' && ev.pid === a);
    expect(repeats).toHaveLength(0);
    // Leaving during the tableau is answered by going home, not by a second
    // retirement that restarts the return clock.
    expect(required(m.progress.get(a), `progress ${a}`).returned).toBe(true);
  });

  it('announces a queue eviction instead of dropping the pid silently', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -5, -40);
    const b = addAt(sim, 'mage', 'Briar', 7, -42);
    sim.realmRacersQueueJoin(a);
    sim.realmRacersQueueJoin(b);
    sim.drainEvents();
    const aEntity = entity(sim, a);
    aEntity.hp = 0;
    aEntity.dead = true;
    const events = sim.tick();
    expect(events).toContainEqual({ type: 'realmRacersUnqueued', pid: a });
    expect(sim.realmRacers.queue.includes(a)).toBe(false);
    expect(sim.realmRacers.queue.includes(b)).toBe(true);
  });

  it('reports the queue viable only where it can actually seat a race', () => {
    // Offline: no bot backfill and one human, so joining would wait forever
    // and the window disables the affordance off this flag.
    const solo = makeWorld();
    const lone = addAt(solo, 'warrior', 'Aster', -5, -40);
    expect(solo.realmRacersInfoFor(lone).queueViable).toBe(false);
    // Enough humans fill a grid without bots.
    const { sim, pids } = makeGrid();
    expect(sim.realmRacersInfoFor(pids[0]).queueViable).toBe(true);
    // The online server enables backfill, so one human is enough there.
    const backfilled = makeWorld({ realmRacersBackfill: true });
    const hosted = addAt(backfilled, 'warrior', 'Briar', -5, -40);
    expect(backfilled.realmRacersInfoFor(hosted).queueViable).toBe(true);
  });

  it('slows shortcut attempts outside the authored road without damaging the racer', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const hp = racer.hp;
    // Well past the run-off, out in the open garden on the infield side: that
    // is the cut a cheater actually wants, and it draws the harsher of the two
    // bands. Derived from the garden edge rather than aimed at the middle of
    // the region, which is a different distance on every circuit.
    const sample = realmRacersTrack(RACE_CIRCUIT).samples[120];
    const intoTheGarden = rallyGardenEdgeOffsetAt(RACE_CIRCUIT, sample.s) + 6;
    const spot = onLane(
      sim,
      sample.x - sample.tz * intoTheGarden,
      sample.z + sample.tx * intoTheGarden,
    );
    parkOffRoad(sim, a, spot.x, spot.z);
    updateRealmRacers(sim.ctx);
    expect(racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA)).toMatchObject({
      kind: 'slow',
      value: REALM_RACERS_GARDEN_BAND.speedMult,
    });
    expect(racer.hp).toBe(hp);
  });

  it('deepens the penalty from verge to garden, and lifts it back on the road', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const at = (offset: number) => {
      const spot = onLane(sim, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
      teleport(sim, a, spot.x, spot.z);
      updateRealmRacers(sim.ctx);
      return racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);
    };
    // On the road: nothing. Leaving the circuit is a price, not a wall, so the
    // bands have to read as a gradient rather than one all-or-nothing slow.
    expect(at(sample.halfWidth - 1)).toBeUndefined();
    expect(at(sample.halfWidth + 1.5)).toMatchObject({
      value: REALM_RACERS_VERGE_BAND.speedMult,
    });
    // OUTWARD, never infield: outward is garden all the way to the wall on every
    // circuit, while the infield turns to water at a shore each circuit places
    // for itself. A fixed infield offset reads garden on one circuit and water
    // on the next.
    expect(at(-(sample.halfWidth + 9))).toMatchObject({
      value: REALM_RACERS_GARDEN_BAND.speedMult,
    });
    // Coming back re-tunes the SAME aura rather than stacking a second slow.
    expect(at(sample.halfWidth + 1.5)).toMatchObject({
      value: REALM_RACERS_VERGE_BAND.speedMult,
    });
    expect(racer.auras.filter((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA)).toHaveLength(1);
    expect(at(0)).toBeUndefined();
  });

  it('follows the local road width when it decides a racer has run wide', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const track = realmRacersTrack(RACE_CIRCUIT);
    // The chicane is the narrowest road on the lap, the start straight the
    // widest: the same lateral offset is on-track at one and off at the other.
    const narrow = track.samples.reduce((best, s) => (s.halfWidth < best.halfWidth ? s : best));
    const wide = track.samples.reduce((best, s) => (s.halfWidth > best.halfWidth ? s : best));
    // Vacuity guard, derived from the constant that decides it: the midpoint
    // offset is only off-track at the narrow end if half the spread clears the
    // verge margin. A circuit with a flatter width profile fails HERE rather
    // than passing an assertion that proves nothing.
    expect(wide.halfWidth - narrow.halfWidth).toBeGreaterThan(2 * REALM_RACERS_VERGE_MARGIN);
    const offset = (narrow.halfWidth + wide.halfWidth) / 2;
    const verge = () => racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);

    const onWide = onLane(sim, wide.x - wide.tz * offset, wide.z + wide.tx * offset);
    teleport(sim, a, onWide.x, onWide.z);
    updateRealmRacers(sim.ctx);
    expect(verge()).toBeUndefined();

    const onNarrow = onLane(sim, narrow.x - narrow.tz * offset, narrow.z + narrow.tx * offset);
    teleport(sim, a, onNarrow.x, onNarrow.z);
    updateRealmRacers(sim.ctx);
    expect(verge()).toMatchObject({ kind: 'slow' });
  });

  it('seats a pilot in a machine, holds it at zero through the countdown, and takes it back', () => {
    const { sim, pids } = startMatch();
    const [a, b] = pids;
    const racer = entity(sim, a);
    const drive = required(racer.drive, 'drive state');
    expect(drive.profileKey).toBe('rally_loaner');
    for (const pid of pids) expect(entity(sim, pid).drive).not.toBeNull();

    // The countdown is a real start lock: input during it banks nothing, and a
    // speed forced onto the machine is zeroed again before GO.
    required(sim.players.get(a), `player ${a}`).moveInput.forward = true;
    drive.speed = 12;
    drive.slip = 3;
    sim.tick();
    expect(drive.speed).toBe(0);
    expect(drive.slip).toBe(0);

    match(sim).phase = 'racing';
    sim.tick();
    expect(racer.drive).not.toBeNull();

    for (const pid of pids) sim.realmRacersForfeit(pid);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS + 1; i++) sim.tick();
    expect(sim.realmRacers.match).toBeNull();
    // Off the machine outright: a leftover drive state would keep the restored
    // character on the vehicle movement model back in the overworld.
    expect(racer.drive).toBeNull();
    expect(entity(sim, b).drive).toBeNull();
  });

  it('re-seats a pilot whose machine was stripped mid-race', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    forceDismount(sim.ctx, racer);
    expect(racer.drive).toBeNull();
    updateRealmRacers(sim.ctx);
    expect(racer.mountKey).toBe('terrorspark_groundshaker');
    expect(required(racer.drive, 'drive state').profileKey).toBe('rally_loaner');
  });

  it('hands the driving model the surface each band stands for', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const surfaceAt = (offset: number) => {
      const spot = onLane(sim, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
      teleport(sim, a, spot.x, spot.z);
      updateRealmRacers(sim.ctx);
      const drive = required(racer.drive, 'drive state');
      return { grip: drive.gripMult, drag: drive.dragMult, cap: drive.speedCap };
    };
    // The road is the neutral surface; every band off it is looser and draggier.
    expect(surfaceAt(0)).toEqual({ grip: 1, drag: 1, cap: 1 });
    expect(surfaceAt(sample.halfWidth + 1.5)).toEqual({
      grip: REALM_RACERS_VERGE_BAND.gripMult,
      drag: REALM_RACERS_VERGE_BAND.dragMult,
      cap: 1,
    });
    // Outward, for the reason the band test above spells out.
    expect(surfaceAt(-(sample.halfWidth + 9))).toEqual({
      grip: REALM_RACERS_GARDEN_BAND.gripMult,
      drag: REALM_RACERS_GARDEN_BAND.dragMult,
      cap: 1,
    });
    // Back on the road it recovers, rather than staying punished for the lap.
    expect(surfaceAt(0)).toEqual({ grip: 1, drag: 1, cap: 1 });
    // The bands really are a ladder, harshest furthest out. There were three
    // and there are two: the wading band went with the water, which is
    // decoration a machine drives straight through.
    expect(REALM_RACERS_GARDEN_BAND.gripMult).toBeLessThan(REALM_RACERS_VERGE_BAND.gripMult);
    expect(REALM_RACERS_GARDEN_BAND.dragMult).toBeGreaterThan(REALM_RACERS_VERGE_BAND.dragMult);
  });

  it('rejects dismount and mount swapping while seated', () => {
    const { sim, a } = startMatch();
    expect(sim.toggleMountFor(a)).toBe(false);
    expect(entity(sim, a).mountKey).toBe('terrorspark_groundshaker');
  });

  it('resolves every unordered pair, and throttles each duel on its own clock', () => {
    const { sim, pids } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const facing = Math.atan2(sample.tx, sample.tz);
    // The whole field stacked into one heap: four machines is six unordered
    // pairs, and the pass has to separate all of them, not just the first.
    pids.forEach((pid, i) => {
      teleport(sim, pid, sample.x - sample.tz * (i * 0.6), sample.z + sample.tx * (i * 0.6));
      const racer = entity(sim, pid);
      racer.facing = facing;
      const drive = required(racer.drive, `drive ${pid}`);
      drive.speed = 20;
      drive.slip = i < 2 ? 12 : -12;
    });
    sim.tickCount++;
    updateRealmRacers(sim.ctx);

    // Every pair that hit hard enough announced itself, each on its OWN key: one
    // duel going quiet under the throttle may not silence another.
    const bumps = sim
      .drainEvents()
      .filter((event) => event.type === 'realmRacersBump')
      .map((event) => event as Extract<SimEvent, { type: 'realmRacersBump' }>);
    expect(bumps.length).toBeGreaterThan(1);
    const keys = bumps.map(
      (bump) => `${Math.min(bump.aId, bump.bId)}:${Math.max(bump.aId, bump.bId)}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    expect(match(sim).bumpTicks.size).toBe(bumps.length);

    // The pass is one sweep of six pairs, not an iterative solver, so a four-way
    // heap takes several of them to come apart: separating 0 from 2 can push 2
    // back into 1. What matters is that it CONVERGES rather than settling with
    // two hulls inside each other, so the worst overlap is measured over time.
    const worstOverlap = (): number => {
      let worst = 0;
      for (let i = 0; i < pids.length; i++) {
        for (let j = i + 1; j < pids.length; j++) {
          const p = entity(sim, pids[i]).pos;
          const q = entity(sim, pids[j]).pos;
          worst = Math.max(worst, 2 * LOANER.bodyRadius - Math.hypot(p.x - q.x, p.z - q.z));
        }
      }
      return worst;
    };
    const afterOne = worstOverlap();
    for (let tick = 0; tick < 24; tick++) {
      sim.tickCount++;
      updateRealmRacers(sim.ctx);
    }
    expect(worstOverlap()).toBeLessThan(afterOne);
    expect(worstOverlap()).toBeLessThan(0.01);
  });

  it('never lets two machines occupy the same space, and keeps them off the wall', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const racerA = entity(sim, a);
    const racerB = entity(sim, b);
    // Side by side on the road, overlapping by more than half a body.
    const onRoad = onLane(sim, sample.x, sample.z);
    const beside = onLane(sim, sample.x - sample.tz * 1.1, sample.z + sample.tx * 1.1);
    teleport(sim, a, onRoad.x, onRoad.z);
    teleport(sim, b, beside.x, beside.z);
    updateRealmRacers(sim.ctx);
    const apart = Math.hypot(racerA.pos.x - racerB.pos.x, racerA.pos.z - racerB.pos.z);
    expect(apart).toBeCloseTo(2 * LOANER.bodyRadius, 6);

    // Against the garden wall the separation runs ALONG it: a shove may not
    // push anybody through the one hard stop on the circuit.
    const wall = onLane(
      sim,
      REALM_RACERS_ORIGIN.x + RACE_CIRCUIT.perimeter.halfX - 0.4,
      REALM_RACERS_ORIGIN.z,
    );
    teleport(sim, a, wall.x - LOANER.bodyRadius, wall.z);
    teleport(sim, b, wall.x - LOANER.bodyRadius - 1, wall.z);
    required(racerB.drive, 'drive B').slip = -20; // leaning hard into A
    updateRealmRacers(sim.ctx);
    for (const racer of [racerA, racerB]) {
      const legal = resolvePosition(
        sim.cfg.seed,
        racer.pos.x,
        racer.pos.z,
        vehicleProfile('rally_loaner').bodyRadius,
      );
      expect(legal.x).toBeCloseTo(racer.pos.x, 6);
      expect(legal.z).toBeCloseTo(racer.pos.z, 6);
    }
    expect(racerA.pos.x).toBeLessThanOrEqual(wall.x - LOANER.bodyRadius + 1e-6);
  });

  it('makes no contact at all outside the racing phase', () => {
    const { sim, a, b } = startMatch();
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const racerA = entity(sim, a);
    const racerB = entity(sim, b);
    const overlap = () => {
      teleport(sim, a, sample.x, sample.z);
      teleport(sim, b, sample.x - sample.tz * 0.8, sample.z + sample.tx * 0.8);
      updateRealmRacers(sim.ctx);
      return Math.hypot(racerA.pos.x - racerB.pos.x, racerA.pos.z - racerB.pos.z);
    };
    expect(match(sim).phase).toBe('countdown');
    expect(overlap()).toBeCloseTo(0.8, 6);
    match(sim).phase = 'finished';
    match(sim).finishTick = sim.tickCount;
    expect(overlap()).toBeCloseTo(0.8, 6);
    // ...and the same pair on the same spot IS separated once they are racing,
    // so the two assertions above are about the phase and nothing else.
    match(sim).phase = 'racing';
    expect(overlap()).toBeCloseTo(2 * LOANER.bodyRadius, 6);
  });

  it('announces a real impact once per throttle window, and a rub not at all', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    // Both machines pointed down the road, B one body-width off A's right
    // shoulder: their lateral (slip) axis IS the line between them, so the
    // closing speed the pass measures is exactly what is set here.
    const facing = Math.atan2(sample.tx, sample.tz);
    const lean = (closingSpeed: number) => {
      teleport(sim, a, sample.x, sample.z);
      teleport(sim, b, sample.x - sample.tz * 1.2, sample.z + sample.tx * 1.2);
      const racerA = entity(sim, a);
      const racerB = entity(sim, b);
      racerA.facing = facing;
      racerB.facing = facing;
      const driveA = required(racerA.drive, 'drive A');
      const driveB = required(racerB.drive, 'drive B');
      driveA.speed = 20;
      driveB.speed = 20;
      driveA.slip = closingSpeed / 2;
      driveB.slip = -closingSpeed / 2;
      sim.tickCount++;
      updateRealmRacers(sim.ctx);
      return sim
        .drainEvents()
        .filter((event) => event.type === 'realmRacersBump')
        .map((event) => event as Extract<SimEvent, { type: 'realmRacersBump' }>);
    };

    // A gentle rub is silent: below the threshold there is no impact to report.
    const gentle = lean(REALM_RACERS_BUMP_EVENT_MIN_IMPACT - 1);
    expect(gentle).toHaveLength(0);

    // A real hit announces itself once, then stays quiet for the throttle
    // window however long the two keep leaning on each other.
    let announced = 0;
    const window = REALM_RACERS_BUMP_EVENT_TICKS;
    for (let tick = 0; tick < window; tick++) {
      const events = lean(24);
      announced += events.length;
      if (events.length > 0) {
        expect(events[0]).toMatchObject({ aId: a, bId: b });
        expect(events[0].impact).toBeCloseTo(24, 6);
      }
    }
    expect(announced).toBe(1);
    // One more window and it speaks again: the throttle silences a lean, it
    // does not silence the whole race.
    let later = 0;
    for (let tick = 0; tick < window; tick++) later += lean(24).length;
    expect(later).toBe(1);
  });

  it('hands scrape yaw to the receiver when one scrapes past the other', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const facing = Math.atan2(sample.tx, sample.tz);
    const racerA = entity(sim, a);
    const racerB = entity(sim, b);
    // A comes past B on its right shoulder, leaning in: same heading, real
    // difference in pace, so the carcasses scrape rather than only push.
    teleport(sim, a, sample.x, sample.z);
    teleport(sim, b, sample.x - sample.tz * 1.2, sample.z + sample.tx * 1.2);
    racerA.facing = facing;
    racerB.facing = facing;
    const driveA = required(racerA.drive, 'drive A');
    const driveB = required(racerB.drive, 'drive B');
    driveA.speed = 45;
    driveB.speed = 25;
    driveA.slip = 6;
    updateRealmRacers(sim.ctx);
    // Arcade share: A is the aggressor (closing along the normal), so it keeps
    // most of its heading with a light push-off; B takes the yaw and is nudged
    // wide. Neither pilot is touching the wheel.
    expect(Math.abs(driveB.spin)).toBeGreaterThan(Math.abs(driveA.spin));
    expect(Math.abs(driveB.spin)).toBeGreaterThan(1);
    expect(driveA.spin).toBeGreaterThan(0);
    expect(driveB.spin).toBeLessThan(0);
    expect(driveA.yawRate).toBe(0);

    // ...and it really turns them: half a second later both noses have moved
    // off the heading they were pinned to, with no steering input at all.
    // B (the receiver) is the one that must visibly slew; A turns less.
    const kicked = driveB.spin;
    const headings = { a: racerA.facing, b: racerB.facing };
    for (let tick = 0; tick < 10; tick++) sim.tick();
    expect(Math.abs(racerB.facing - headings.b)).toBeGreaterThan(0.1);
    expect(Math.abs(racerA.facing - headings.a)).toBeGreaterThan(0.05);
    // The spin is spent, not permanent: ten ticks of the profile's decay leave
    // under about half of the receiver's kick, so the machines are driveable
    // again.
    expect(Math.abs(required(racerB.drive, 'drive B').spin)).toBeLessThan(0.55 * Math.abs(kicked));
  });

  it('keeps the queue in its original order when a grid is refused', () => {
    const { sim, pids } = makeGrid();
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    expect(sim.realmRacers.queue).toEqual(pids);
    // Make the head of the grid ineligible without touching the queue itself:
    // the seating attempt then refuses and has to put the rest back as it found
    // them. Unshifting one at a time (the two-pilot code) would reverse them.
    entity(sim, pids[0]).dead = true;
    updateRealmRacers(sim.ctx);
    expect(sim.realmRacers.match).toBeNull();
    expect(sim.realmRacers.queue).toEqual(pids.slice(1));
  });

  it('fires no shell outside an active Rally match', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster');
    realmRacersFireGroundBlast(sim.ctx, entity(sim, a));
    expect(sim.realmRacers.match).toBeNull();
  });
});

describe('The Realm Racers Book of Deeds credit (docs/design/deeds.md)', () => {
  it('credits a full race, ticked from queue through the real countdown into racing', () => {
    const { sim, pids } = makeGrid();
    for (const pid of pids) sim.realmRacersQueueJoin(pid);
    sim.tick();
    expect(sim.realmRacers.match).not.toBeNull();
    expect(match(sim).phase).toBe('countdown');
    // The real GO branch, not a hand-flipped phase: this is what actually
    // writes lapStartTick, and no other test in this file ticks through it.
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS; i++) sim.tick();
    expect(match(sim).phase).toBe('racing');
    const [a, b, c, d] = pids;
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progressA.lapStartTick).toBe(match(sim).goTick);
    // Deliberately slow laps (tens of seconds each): this heat asserts what it
    // expects of the fast-lap deed rather than leaving the outcome silent.
    crossStart(sim, a);
    sim.tickCount += 30 * TICK_RATE;
    completeLap(sim, a);
    sim.tickCount += 30 * TICK_RATE;
    completeLap(sim, a);
    sim.tickCount += 30 * TICK_RATE;
    completeLap(sim, a);
    for (const pid of [b, c, d]) {
      sim.tickCount++;
      crossStart(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
    }
    expect(match(sim).phase).toBe('finished');
    expect(match(sim).winnerPid).toBe(a);
    for (const pid of pids) {
      expect(
        required(sim.players.get(pid), `player ${pid}`).deedsEarned.has('pvp_rr_first_race'),
        `pid ${pid}`,
      ).toBe(true);
    }
    const winnerMeta = required(sim.players.get(a), 'winner meta');
    expect(winnerMeta.rrWins).toBe(1);
    // pvp_rr_first_win is a meter deed (non-manual): onRallyRaceEndForDeeds only
    // marks the pid dirty, and the full pass (sim.tick, or updateDeeds directly)
    // is what actually grants it.
    updateDeeds(sim.ctx);
    expect(winnerMeta.deedsEarned.has('pvp_rr_first_win')).toBe(true);
    // A crossed clean throughout this test: never bumped, never off the road.
    expect(winnerMeta.deedsEarned.has('pvp_rr_clean_race')).toBe(true);
    // Every lap here ran at 30s, well over the 26s threshold: never fast.
    expect(winnerMeta.deedsEarned.has('pvp_rr_fast_lap')).toBe(false);
  });

  it('never credits a practice heat, even for the human who saw it out', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Practicer');
    sim.realmRacersPracticeStart('ace', human);
    expect(sim.realmRacers.practices).toHaveLength(1);
    const practiceMatch = required(sim.realmRacers.practices[0], 'practice match');
    // Break the tie among the three untouched house pilots first, so the
    // classification below genuinely produces a winner: a null winnerPid
    // (a dead heat) would let a deferred, never-run endMatch pass this test
    // by accident.
    const bots = practiceMatch.pids.filter((pid) => pid !== human);
    const leadBotProgress = required(practiceMatch.progress.get(bots[0]), 'lead bot progress');
    leadBotProgress.travelled += 50;
    // The human quitting leaves only house pilots driving, which decides the
    // race at once (raceIsDecided's house-pilot-only arm).
    sim.realmRacersForfeit(human);
    expect(practiceMatch.phase).toBe('finished');
    expect(practiceMatch.winnerPid).toBe(bots[0]); // proves endMatch really ran
    const meta = required(sim.players.get(human), 'player meta');
    expect(meta.deedsEarned.has('pvp_rr_first_race')).toBe(false);
    expect(meta.rrWins).toBe(0);
  });

  it('never credits a practice WIN either: no rrWins and no first_win even though the human crosses first', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Practicer');
    sim.realmRacersPracticeStart('ace', human);
    const practiceMatch = required(sim.realmRacers.practices[0], 'practice match');
    practiceMatch.phase = 'racing';
    const circuit = realmRacersCircuitOf(practiceMatch);
    const track = realmRacersTrack(circuit);
    const place = (s: number) => {
      const sample = track.pointAt(s);
      teleport(sim, human, practiceMatch.origin.x + sample.x, practiceMatch.origin.z + sample.z);
      updateRealmRacers(sim.ctx);
    };
    // Bounded steps (mirrors advanceArc/completeLap above): the wrap gate
    // requires distanceSinceWrap to clear most of a lap, so a single big
    // teleport straight to "one lap on" never accumulates it and the lap
    // silently never completes. Stepping in <=40 yd hops is what makes each
    // one register as real forward distance.
    const advance = (distance: number) => {
      let remaining = distance;
      while (remaining > 0 && practiceMatch.phase === 'racing') {
        const step = Math.min(40, remaining);
        const progress = required(practiceMatch.progress.get(human), 'human progress');
        place(progress.lastS + step);
        remaining -= step;
      }
    };
    // The three house pilots never move, so crossing the line every lap wins
    // outright without needing to out-drive them.
    for (let lap = 0; lap < practiceMatch.totalLaps; lap++) {
      advance(track.length + 12);
    }
    expect(practiceMatch.phase).toBe('finished');
    expect(practiceMatch.winnerPid).toBe(human); // the human really did win it
    const meta = required(sim.players.get(human), 'player meta');
    expect(meta.deedsEarned.has('pvp_rr_first_race')).toBe(false);
    expect(meta.deedsEarned.has('pvp_rr_first_win')).toBe(false);
    expect(meta.rrWins).toBe(0);
    updateDeeds(sim.ctx);
    expect(meta.deedsEarned.has('pvp_rr_first_win')).toBe(false);
  });

  it('pvp_rr_first_race: never a forfeiter, but a pilot still driving when the clock decides it', () => {
    const { sim, pids } = startMatch();
    const [a, b] = pids;
    match(sim).phase = 'racing';
    updateRealmRacers(sim.ctx);
    // B forfeits early: must never earn it.
    sim.realmRacersForfeit(b);
    // A wins outright; the chase window then closes the race for whoever is
    // still out there without ever finishing.
    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    const armed = required(match(sim).chaseUntilTick, 'chase window');
    sim.tickCount = armed;
    updateRealmRacers(sim.ctx);
    expect(match(sim).phase).toBe('finished');
    const bMeta = required(sim.players.get(b), 'b meta');
    expect(bMeta.deedsEarned.has('pvp_rr_first_race')).toBe(false);
    for (const pid of pids.slice(2)) {
      const meta = required(sim.players.get(pid), `pid ${pid}`);
      expect(meta.deedsEarned.has('pvp_rr_first_race'), `pid ${pid}`).toBe(true);
    }
  });

  it('never credits a house pilot, even the winner, in a bot-backfilled rated heat', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    expect(startRealmRacersDevRace(sim, RACE_CIRCUIT.id, 'ace', human)).toBe(true);
    const liveMatch = match(sim);
    expect(liveMatch.practice).toBeNull(); // rated: the public lane, not a private copy
    const bots = liveMatch.pids.filter((pid) => sim.realmRacers.bots.has(pid));
    expect(bots).toHaveLength(REALM_RACERS_GRID_SIZE - 1);
    // The human holds no throttle and never finishes (tests/realm_racers_circuits.test.ts's
    // own rule), so a bot always wins this race.
    const budget = (RACE_CIRCUIT.timeLimitSeconds + 30) * TICK_RATE;
    for (let tick = 0; tick < budget && liveMatch.phase !== 'finished'; tick++) sim.tick();
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).not.toBeNull();
    expect(bots).toContain(liveMatch.winnerPid);
    for (const pid of bots) {
      const meta = required(sim.players.get(pid), `bot ${pid}`);
      expect(meta.deedsEarned.has('pvp_rr_first_race'), `bot ${pid}`).toBe(false);
      expect(meta.rrWins, `bot ${pid}`).toBe(0);
    }
  });

  it('tracks a real off-track excursion (garden or water), but never the soft verge alone', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const at = (offset: number) => {
      const spot = onLane(sim, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
      teleport(sim, a, spot.x, spot.z);
      updateRealmRacers(sim.ctx);
    };
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    at(sample.halfWidth + 1.5); // the soft verge only
    expect(progress.hadOffTrackContact).toBe(false);
    at(-(sample.halfWidth + 9)); // out into the garden
    expect(progress.hadOffTrackContact).toBe(true);
  });

  it('tracks the deep-infield arm of the off-track spoiler, not only the verge', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    // Well past the apron, on the infield side: deep enough that a pilot who
    // ends up there has really left the circuit rather than clipped an apex.
    const intoTheGarden = rallyGardenEdgeOffsetAt(RACE_CIRCUIT, sample.s) + 6;
    const spot = onLane(
      sim,
      sample.x - sample.tz * intoTheGarden,
      sample.z + sample.tx * intoTheGarden,
    );
    parkOffRoad(sim, a, spot.x, spot.z);
    updateRealmRacers(sim.ctx);
    const racer = entity(sim, a);
    expect(racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA)).toMatchObject({
      value: REALM_RACERS_GARDEN_BAND.speedMult,
    });
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progress.hadOffTrackContact).toBe(true);
  });

  it('tracks a real rival bump, but never a gentle rub', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const facing = Math.atan2(sample.tx, sample.tz);
    const lean = (closingSpeed: number) => {
      teleport(sim, a, sample.x, sample.z);
      teleport(sim, b, sample.x - sample.tz * 1.2, sample.z + sample.tx * 1.2);
      const racerA = entity(sim, a);
      const racerB = entity(sim, b);
      racerA.facing = facing;
      racerB.facing = facing;
      const driveA = required(racerA.drive, 'drive A');
      const driveB = required(racerB.drive, 'drive B');
      driveA.speed = 20;
      driveB.speed = 20;
      driveA.slip = closingSpeed / 2;
      driveB.slip = -closingSpeed / 2;
      sim.tickCount++;
      updateRealmRacers(sim.ctx);
    };
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    const progressB = required(match(sim).progress.get(b), `progress ${b}`);
    lean(REALM_RACERS_BUMP_EVENT_MIN_IMPACT - 1); // a rub, below the announce floor
    expect(progressA.hadRivalContact).toBe(false);
    expect(progressB.hadRivalContact).toBe(false);
    lean(REALM_RACERS_BUMP_EVENT_MIN_IMPACT + 5); // a real impact
    expect(progressA.hadRivalContact).toBe(true);
    expect(progressB.hadRivalContact).toBe(true);
  });

  it('tracks a Ground Blast hit on the victim only', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    updateRealmRacers(sim.ctx);
    const caster = entity(sim, a);
    const target = entity(sim, b);
    caster.facing = 0;
    teleport(sim, a, caster.pos.x, caster.pos.z);
    teleport(sim, b, caster.pos.x, caster.pos.z + 12);
    sim.castAbility(REALM_RACERS_ABILITY_ID, a, { x: target.pos.x, z: target.pos.z });
    for (let i = 0; i < 25 && match(sim).groundBlasts.length > 0; i++) sim.tick();
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    const progressB = required(match(sim).progress.get(b), `progress ${b}`);
    expect(progressB.hitByShell).toBe(true);
    expect(progressA.hitByShell).toBe(false);
  });

  it('a shell hit does not spoil a clean race: comeback and clean_race are independent', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    match(sim).phase = 'racing';
    updateRealmRacers(sim.ctx);
    const caster = entity(sim, b);
    const target = entity(sim, a);
    caster.facing = 0;
    teleport(sim, b, caster.pos.x, caster.pos.z);
    teleport(sim, a, caster.pos.x, caster.pos.z + 12);
    sim.castAbility(REALM_RACERS_ABILITY_ID, b, { x: target.pos.x, z: target.pos.z });
    for (let i = 0; i < 25 && match(sim).groundBlasts.length > 0; i++) sim.tick();
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progressA.hitByShell).toBe(true);
    expect(progressA.hadRivalContact).toBe(false);
    expect(progressA.hadOffTrackContact).toBe(false);
    // The impact leaves real residual speed/slip on the machine (the physical
    // knockup, ticked for real above); zero it before driving the rest of the
    // lap by teleport, so only the SHELL flag is under test here, not
    // incidental bump physics the impact scene leaves behind.
    const driveA = required(entity(sim, a).drive, 'drive A');
    driveA.speed = 0;
    driveA.slip = 0;
    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    for (const pid of [b, c, d]) {
      sim.tickCount++;
      crossStart(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
    }
    const meta = required(sim.players.get(a), 'winner meta');
    expect(meta.deedsEarned.has('pvp_rr_clean_race')).toBe(true);
  });

  it('keeps a clean run after the finish line: wandering off the road during the chase window does not spoil it', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    match(sim).phase = 'racing';
    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    expect(progressA.finishedTick).not.toBeNull();
    expect(progressA.hadOffTrackContact).toBe(false);
    // Wander into the garden well after crossing the line: must not spoil it.
    const track = realmRacersTrack(RACE_CIRCUIT);
    const sample = track.samples[120];
    const offset = -(sample.halfWidth + 9);
    const spot = onLane(sim, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
    teleport(sim, a, spot.x, spot.z);
    updateRealmRacers(sim.ctx);
    expect(progressA.hadOffTrackContact).toBe(false);
    for (const pid of [b, c, d]) {
      sim.tickCount++;
      crossStart(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
    }
    const meta = required(sim.players.get(a), 'winner meta');
    expect(meta.deedsEarned.has('pvp_rr_clean_race')).toBe(true);
  });

  it('grants Flying Lap under the 26s threshold through the real per-tick call site', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    const meta = required(sim.players.get(a), 'player meta');
    // Under the threshold: 25.9s, granted.
    sim.tickCount = progress.lapStartTick + Math.round(25.9 * TICK_RATE);
    completeLap(sim, a);
    expect(meta.deedsEarned.has('pvp_rr_fast_lap')).toBe(true);
  });

  it('withholds Flying Lap at exactly the 26s threshold (the guard is exclusive)', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    const meta = required(sim.players.get(a), 'player meta');
    // Exactly 26.0s: flipping the guard from >= to > would be invisible
    // without this exact boundary pinned.
    sim.tickCount = progress.lapStartTick + 26 * TICK_RATE;
    completeLap(sim, a);
    expect(meta.deedsEarned.has('pvp_rr_fast_lap')).toBe(false);
  });

  it('withholds Flying Lap well over the threshold too', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const progress = required(match(sim).progress.get(a), `progress ${a}`);
    const meta = required(sim.players.get(a), 'player meta');
    sim.tickCount = progress.lapStartTick + 40 * TICK_RATE;
    completeLap(sim, a);
    expect(meta.deedsEarned.has('pvp_rr_fast_lap')).toBe(false);
  });

  it('does not let the starting grid slot flag a pilot dead last before the field has spread out', () => {
    const { sim, pids } = startMatch();
    const [, , , d] = pids;
    match(sim).phase = 'racing';
    updateRealmRacers(sim.ctx);
    const progressD = required(match(sim).progress.get(d), `progress ${d}`);
    expect(progressD.wasLastPlace).toBe(false);
  });

  it('marks the trailing pilot dead last, live, as the field spreads out', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    match(sim).phase = 'racing';
    // Explicit, unambiguous arc order: A leads, D trails everyone.
    placeAtS(sim, a, 300);
    placeAtS(sim, b, 150);
    placeAtS(sim, c, 80);
    placeAtS(sim, d, 20);
    updateRealmRacers(sim.ctx);
    const progressA = required(match(sim).progress.get(a), `progress ${a}`);
    const progressC = required(match(sim).progress.get(c), `progress ${c}`);
    const progressD = required(match(sim).progress.get(d), `progress ${d}`);
    expect(progressA.wasLastPlace).toBe(false);
    expect(progressC.wasLastPlace).toBe(false);
    expect(progressD.wasLastPlace).toBe(true);

    // The field reshuffles: D now leads and A trails everyone.
    placeAtS(sim, d, 400);
    placeAtS(sim, a, 5);
    updateRealmRacers(sim.ctx);
    expect(progressA.wasLastPlace).toBe(true);
    expect(progressD.wasLastPlace).toBe(true); // once true, deed-tracking never clears
  });

  it('keeps tracking the real trailing driver after a mid-pack quitter retires', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    match(sim).phase = 'racing';
    placeAtS(sim, a, 300);
    placeAtS(sim, b, 150);
    placeAtS(sim, c, 80);
    placeAtS(sim, d, 20);
    updateRealmRacers(sim.ctx);
    const progressC = required(match(sim).progress.get(c), `progress ${c}`);
    const progressD = required(match(sim).progress.get(d), `progress ${d}`);
    expect(progressD.wasLastPlace).toBe(true);
    expect(progressC.wasLastPlace).toBe(false);
    // C, mid-pack, quits. D is genuinely still the trailing DRIVER and must
    // keep being flagged: reading the FINAL classification (which always
    // ranks the retired band last) would instead credit C's retirement and
    // stop tracking D, the driver actually trailing, altogether.
    sim.realmRacersForfeit(c);
    placeAtS(sim, a, 320);
    placeAtS(sim, b, 170);
    updateRealmRacers(sim.ctx);
    expect(progressD.wasLastPlace).toBe(true);
  });

  it('winner who was last but never shelled gets no comeback, and the reverse', () => {
    // Forced "last" with no shell: no comeback.
    {
      const { sim, pids } = startMatch();
      const [a, b, c, d] = pids;
      match(sim).phase = 'racing';
      crossStart(sim, a);
      completeLap(sim, a);
      completeLap(sim, a);
      completeLap(sim, a);
      const progressA = required(match(sim).progress.get(a), `progress ${a}`);
      expect(progressA.hitByShell).toBe(false);
      progressA.wasLastPlace = true; // force: was last at some point, never hit
      for (const pid of [b, c, d]) {
        sim.tickCount++;
        crossStart(sim, pid);
        completeLap(sim, pid);
        completeLap(sim, pid);
        completeLap(sim, pid);
      }
      expect(match(sim).winnerPid).toBe(a);
      const meta = required(sim.players.get(a), 'winner meta');
      expect(meta.deedsEarned.has('pvp_rr_comeback')).toBe(false);
    }
    // Forced shell hit with no "last": no comeback either.
    {
      const { sim, pids } = startMatch();
      const [a, b, c, d] = pids;
      match(sim).phase = 'racing';
      crossStart(sim, a);
      completeLap(sim, a);
      completeLap(sim, a);
      completeLap(sim, a);
      const progressA = required(match(sim).progress.get(a), `progress ${a}`);
      // Forced rather than asserted-natural: the grid slot's own tiny
      // projection asymmetry can flag a leader dead-last for one tick at the
      // green light on this circuit (see "does not let the starting grid slot
      // flag..." above), so this case pins the DECOUPLING deliberately
      // instead of depending on incidental start-line geometry.
      progressA.wasLastPlace = false;
      progressA.hitByShell = true; // force: was shelled, never actually last
      for (const pid of [b, c, d]) {
        sim.tickCount++;
        crossStart(sim, pid);
        completeLap(sim, pid);
        completeLap(sim, pid);
        completeLap(sim, pid);
      }
      expect(match(sim).winnerPid).toBe(a);
      const meta = required(sim.players.get(a), 'winner meta');
      expect(meta.deedsEarned.has('pvp_rr_comeback')).toBe(false);
    }
  });
});

describe('Realm Racers rrWins persistence (mirrors tests/vale_cup_meta.test.ts)', () => {
  it('is absent before any win, present after one, and survives a reload into fresh meta', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    // Before any result: the field stays absent (back-compat shape).
    const clean = sim.serializeCharacter(a)!;
    expect('rrWins' in clean).toBe(false);

    match(sim).phase = 'racing';
    crossStart(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    completeLap(sim, a);
    for (const pid of [b, c, d]) {
      sim.tickCount++;
      crossStart(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
      completeLap(sim, pid);
    }
    expect(match(sim).winnerPid).toBe(a);
    const won = sim.serializeCharacter(a)!;
    expect(won.rrWins).toBe(1);

    const sim2 = makeWorld();
    const a2 = sim2.addPlayer('warrior', 'Aleph', { state: won });
    const meta2 = sim2.players.get(a2)!;
    expect(meta2.rrWins).toBe(1);
  });

  it('loads an old-shape save with no rrWins, then a rated win still lands and re-serializes', () => {
    const { sim, pids } = startMatch();
    const [a, b, c, d] = pids;
    const state = sim.serializeCharacter(a)!;
    expect('rrWins' in state).toBe(false);
    // Round-trip through JSON: a pre-Rally row genuinely has no rrWins key at
    // all, not merely a zero value.
    const oldShape = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;
    delete oldShape.rrWins;

    const sim2 = makeWorld();
    let reloadedPid = -1;
    expect(() => {
      reloadedPid = sim2.addPlayer('warrior', 'Reloaded', {
        state: oldShape as unknown as CharacterState,
      });
    }).not.toThrow();
    const reloadedMeta = sim2.players.get(reloadedPid)!;
    expect(reloadedMeta.rrWins).toBe(0);

    // Race the reloaded character to a rated win; the counter both moves and
    // re-serializes from a save that never had the field.
    const grid2 = [b, c, d].map((_, i) => addAt(sim2, 'warrior', `Rival${i}`, -5 - i * 3, -40));
    const fullGrid = [reloadedPid, ...grid2];
    for (const pid of fullGrid) sim2.realmRacersQueueJoin(pid);
    sim2.tick();
    expect(sim2.realmRacers.match).not.toBeNull();
    sim2.realmRacers.match!.phase = 'racing';
    const winMatch = sim2.realmRacers.match!;
    const track2 = realmRacersTrack(realmRacersCircuitOf(winMatch));
    const placeReloaded = (s: number) => {
      const sample = track2.pointAt(s);
      teleport(sim2, reloadedPid, winMatch.origin.x + sample.x, winMatch.origin.z + sample.z);
      updateRealmRacers(sim2.ctx);
    };
    // Bounded steps: the wrap gate needs distanceSinceWrap to clear most of a
    // lap, so a single big teleport to "one lap on" never accumulates it.
    const advanceReloaded = (distance: number) => {
      let remaining = distance;
      while (remaining > 0 && winMatch.phase === 'racing') {
        const step = Math.min(40, remaining);
        const progress2 = winMatch.progress.get(reloadedPid)!;
        placeReloaded(progress2.lastS + step);
        remaining -= step;
      }
    };
    for (let lap = 0; lap < winMatch.totalLaps; lap++) {
      advanceReloaded(track2.length + 12);
    }
    // The other three are real (non-bot) rivals, so finishing first only arms
    // the chase window; it does not end the race outright (four real pilots
    // race each other to the last podium step, unlike the house-pilot-only
    // early decision above).
    const armed2 = winMatch.chaseUntilTick;
    expect(armed2).not.toBeNull();
    sim2.tickCount = armed2 as number;
    updateRealmRacers(sim2.ctx);
    expect(winMatch.phase).toBe('finished');
    expect(winMatch.winnerPid).toBe(reloadedPid);
    expect(reloadedMeta.rrWins).toBe(1);
    const reSerialized = sim2.serializeCharacter(reloadedPid)!;
    expect(reSerialized.rrWins).toBe(1);
  });
});
