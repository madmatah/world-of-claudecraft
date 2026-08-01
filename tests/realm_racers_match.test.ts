import { describe, expect, it } from 'vitest';
import { mountVisualSpec } from '../src/render/mount_visuals';
import { resolvePosition } from '../src/sim/colliders';
import { MOUNTS, type MountKey } from '../src/sim/content/mounts';
import { REALM_RACERS_ABILITY_ID } from '../src/sim/content/realm_racers';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { forceDismount } from '../src/sim/mounts';
import { GROUND_BLAST_CONTROL_SPEED_MULT } from '../src/sim/realm_racers_ground_blast';
import { REALM_RACERS_ORIGIN, REALM_RACERS_PERIMETER_HALF_X } from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { Sim } from '../src/sim/sim';
import {
  REALM_RACERS_BUMP_EVENT_MIN_IMPACT,
  REALM_RACERS_BUMP_EVENT_TICKS,
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_MOUNT_KEY,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_RETURN_TICKS,
  REALM_RACERS_TIME_LIMIT_TICKS,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WATER_BAND,
  realmRacersFireGroundBlast,
  updateRealmRacers,
} from '../src/sim/social/realm_racers';
import type { Entity, SimEvent } from '../src/sim/types';
import { addAt, makeWorld, teleport } from './vale_cup_util';

const LOANER = vehicleProfile('rally_loaner');

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

function startMatch(): { sim: Sim; a: number; b: number } {
  const sim = makeWorld();
  const a = addAt(sim, 'warrior', 'Aster', -5, -40);
  const b = addAt(sim, 'mage', 'Briar', 7, -42);
  sim.realmRacersQueueJoin(a);
  sim.realmRacersQueueJoin(b);
  sim.tick();
  expect(sim.realmRacers.match).not.toBeNull();
  return { sim, a, b };
}

function placeAtS(sim: Sim, pid: number, s: number, lateral = 0): void {
  const liveMatch = match(sim);
  const sample = realmRacersTrack().pointAt(s);
  teleport(
    sim,
    pid,
    liveMatch.origin.x + sample.x - sample.tz * lateral,
    liveMatch.origin.z + sample.z + sample.tx * lateral,
  );
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
  advanceArc(sim, pid, realmRacersTrack().length + 12);
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
  it('waits for exactly two racers, then runs a silent overview before the three-count', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster');
    const b = addAt(sim, 'mage', 'Briar', 3, -40);
    sim.realmRacersQueueJoin(a);
    sim.tick();
    expect(sim.realmRacersInfoFor(a)).toMatchObject({
      queued: true,
      queuePosition: 1,
      queueSize: 1,
      match: null,
    });
    sim.realmRacersQueueJoin(b);
    sim.tick();
    const liveMatch = match(sim);
    expect(liveMatch.goTick - sim.tickCount).toBe(180);
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({ countdown: 0, countdownTicks: 180 });
    expect(entity(sim, a).mountKey).toBe('terrorspark_groundshaker');
    expect(entity(sim, b).mountKey).toBe('terrorspark_groundshaker');
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

  it('requires real arc distance and awards the first clean third-lap finish', () => {
    const { sim, a, b } = startMatch();
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    crossStart(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 1 });
    completeLap(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 2 });
    completeLap(sim, a);
    expect(liveMatch.progress.get(a)).toMatchObject({ lap: 3 });
    completeLap(sim, a);
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).toBe(a);
    expect(sim.realmRacersInfoFor(a).match?.result).toBe('won');
    expect(sim.realmRacersInfoFor(b).match?.result).toBe('lost');
  });

  it('reports a dead heat when the time limit expires at equal progress', () => {
    const { sim, a, b } = startMatch();
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    liveMatch.deadlineTick = sim.tickCount + REALM_RACERS_TIME_LIMIT_TICKS;
    sim.tickCount = liveMatch.deadlineTick;
    updateRealmRacers(sim.ctx);
    expect(liveMatch.phase).toBe('finished');
    expect(liveMatch.winnerPid).toBeNull();
    expect(sim.realmRacersInfoFor(a).match?.result).toBe('draw');
    expect(sim.realmRacersInfoFor(b).match?.result).toBe('draw');
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
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster', -8, -41);
    const b = addAt(sim, 'mage', 'Briar', 9, -39);
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
    sim.realmRacersQueueJoin(a);
    sim.realmRacersQueueJoin(b);
    sim.tick();
    expect(aEntity.mountKey).toBe('terrorspark_groundshaker');
    sim.realmRacersForfeit(a);
    expect(sim.realmRacersInfoFor(a).match).toMatchObject({
      phase: 'finished',
      result: 'forfeit',
    });
    expect(sim.realmRacersInfoFor(b).match).toMatchObject({
      phase: 'finished',
      result: 'won',
    });
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS; i++) sim.tick();
    expect(sim.realmRacers.match).toBeNull();
    expect(aEntity.pos.x).toBeCloseTo(expectedA.x, 6);
    expect(aEntity.pos.z).toBeCloseTo(expectedA.z, 6);
    expect(aEntity.facing).toBeCloseTo(expectedA.facing, 6);
    expect(bEntity.pos.x).toBeCloseTo(expectedB.x, 6);
    expect(bEntity.pos.z).toBeCloseTo(expectedB.z, 6);
    expect(bEntity.facing).toBeCloseTo(expectedB.facing, 6);
    expect(aEntity.mountKey).toBe('valorsteed');
    expect(bEntity.mountKey).toBe('');
    expect(aEntity.hp).toBe(31);
    expect(aEntity.resource).toBe(7);
    // Match formation happens at the tail of the next 20 Hz tick, after the
    // ordinary cooldown clock advances once; teardown returns that exact 8.95s
    // snapshot rather than resetting or gifting the missing time.
    expect(aEntity.cooldowns.get('charge')).toBe(8.95);
    const restoredMeta = required(sim.players.get(a), `player ${a}`);
    expect(restoredMeta.realmRacersMatchId).toBeNull();
    expect(restoredMeta.known.some((known) => known.def.id === 'rally_ground_blast')).toBe(false);
  });

  it('restores temporary Rally state before a disconnect save', () => {
    const { sim, a } = startMatch();
    const original = match(sim).returns.get(a);
    sim.preparePlayerLeave(a);
    expect(sim.realmRacers.match).toBeNull();
    expect(entity(sim, a).pos).toMatchObject({ x: original?.x, z: original?.z });
    expect(required(sim.players.get(a), `player ${a}`).realmRacersMatchId).toBeNull();
  });

  it('slows shortcut attempts outside the authored road without damaging the racer', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const hp = racer.hp;
    // The middle of the region is the middle of the BASIN, which is the cut a
    // cheater actually wants, so it draws the harshest band of the three.
    teleport(sim, a, REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z);
    updateRealmRacers(sim.ctx);
    expect(racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA)).toMatchObject({
      kind: 'slow',
      value: REALM_RACERS_WATER_BAND.speedMult,
    });
    expect(racer.hp).toBe(hp);
  });

  it('deepens the penalty from verge to garden, and lifts it back on the road', () => {
    const { sim, a } = startMatch();
    match(sim).phase = 'racing';
    const racer = entity(sim, a);
    const track = realmRacersTrack();
    const sample = track.samples[120];
    const at = (offset: number) => {
      teleport(sim, a, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
      updateRealmRacers(sim.ctx);
      return racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);
    };
    // On the road: nothing. Leaving the circuit is a price, not a wall, so the
    // bands have to read as a gradient rather than one all-or-nothing slow.
    expect(at(sample.halfWidth - 1)).toBeUndefined();
    expect(at(sample.halfWidth + 1.5)).toMatchObject({
      value: REALM_RACERS_VERGE_BAND.speedMult,
    });
    expect(at(sample.halfWidth + 9)).toMatchObject({
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
    const track = realmRacersTrack();
    // The chicane is the narrowest road on the lap, the start straight the
    // widest: the same lateral offset is on-track at one and off at the other.
    const narrow = track.samples.reduce((best, s) => (s.halfWidth < best.halfWidth ? s : best));
    const wide = track.samples.reduce((best, s) => (s.halfWidth > best.halfWidth ? s : best));
    expect(narrow.halfWidth).toBeLessThan(wide.halfWidth - 2);
    const offset = (narrow.halfWidth + wide.halfWidth) / 2;
    const verge = () => racer.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);

    teleport(sim, a, wide.x - wide.tz * offset, wide.z + wide.tx * offset);
    updateRealmRacers(sim.ctx);
    expect(verge()).toBeUndefined();

    teleport(sim, a, narrow.x - narrow.tz * offset, narrow.z + narrow.tx * offset);
    updateRealmRacers(sim.ctx);
    expect(verge()).toMatchObject({ kind: 'slow' });
  });

  it('ranks live position by yards down the circuit', () => {
    const { sim, a, b } = startMatch();
    const liveMatch = match(sim);
    liveMatch.phase = 'racing';
    placeAtS(sim, b, 60);
    updateRealmRacers(sim.ctx);
    placeAtS(sim, a, 10);
    updateRealmRacers(sim.ctx);
    expect(sim.realmRacersInfoFor(b).match?.position).toBe(1);
    expect(sim.realmRacersInfoFor(a).match?.position).toBe(2);
    const progressA = required(liveMatch.progress.get(a), `progress ${a}`);
    const progressB = required(liveMatch.progress.get(b), `progress ${b}`);
    expect(progressB.travelled - progressA.travelled).toBeCloseTo(50, 0);
  });

  it('seats a pilot in a machine, holds it at zero through the countdown, and takes it back', () => {
    const { sim, a, b } = startMatch();
    const racer = entity(sim, a);
    const drive = required(racer.drive, 'drive state');
    expect(drive.profileKey).toBe('rally_loaner');
    expect(entity(sim, b).drive).not.toBeNull();

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

    sim.realmRacersForfeit(a);
    for (let i = 0; i < REALM_RACERS_RETURN_TICKS; i++) sim.tick();
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
    const track = realmRacersTrack();
    const sample = track.samples[120];
    const surfaceAt = (offset: number) => {
      teleport(sim, a, sample.x - sample.tz * offset, sample.z + sample.tx * offset);
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
    expect(surfaceAt(sample.halfWidth + 9)).toEqual({
      grip: REALM_RACERS_GARDEN_BAND.gripMult,
      drag: REALM_RACERS_GARDEN_BAND.dragMult,
      cap: 1,
    });
    // Back on the road it recovers, rather than staying punished for the lap.
    expect(surfaceAt(0)).toEqual({ grip: 1, drag: 1, cap: 1 });
    // The bands really are a ladder, harshest in the water.
    expect(REALM_RACERS_WATER_BAND.gripMult).toBeLessThan(REALM_RACERS_GARDEN_BAND.gripMult);
    expect(REALM_RACERS_GARDEN_BAND.gripMult).toBeLessThan(REALM_RACERS_VERGE_BAND.gripMult);
    expect(REALM_RACERS_WATER_BAND.dragMult).toBeGreaterThan(REALM_RACERS_GARDEN_BAND.dragMult);
    expect(REALM_RACERS_GARDEN_BAND.dragMult).toBeGreaterThan(REALM_RACERS_VERGE_BAND.dragMult);
  });

  it('rejects dismount and mount swapping while seated', () => {
    const { sim, a } = startMatch();
    expect(sim.toggleMountFor(a)).toBe(false);
    expect(entity(sim, a).mountKey).toBe('terrorspark_groundshaker');
  });

  it('never lets two machines occupy the same space, and keeps them off the wall', () => {
    const { sim, a, b } = startMatch();
    match(sim).phase = 'racing';
    const track = realmRacersTrack();
    const sample = track.samples[120];
    const racerA = entity(sim, a);
    const racerB = entity(sim, b);
    // Side by side on the road, overlapping by more than half a body.
    teleport(sim, a, sample.x, sample.z);
    teleport(sim, b, sample.x - sample.tz * 1.1, sample.z + sample.tx * 1.1);
    updateRealmRacers(sim.ctx);
    const apart = Math.hypot(racerA.pos.x - racerB.pos.x, racerA.pos.z - racerB.pos.z);
    expect(apart).toBeCloseTo(2 * LOANER.bodyRadius, 6);

    // Against the garden wall the separation runs ALONG it: a shove may not
    // push anybody through the one hard stop on the circuit.
    const wallX = REALM_RACERS_ORIGIN.x + REALM_RACERS_PERIMETER_HALF_X - 0.4;
    teleport(sim, a, wallX - LOANER.bodyRadius, REALM_RACERS_ORIGIN.z);
    teleport(sim, b, wallX - LOANER.bodyRadius - 1, REALM_RACERS_ORIGIN.z);
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
    expect(racerA.pos.x).toBeLessThanOrEqual(wallX - LOANER.bodyRadius + 1e-6);
  });

  it('makes no contact at all outside the racing phase', () => {
    const { sim, a, b } = startMatch();
    const track = realmRacersTrack();
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
    const track = realmRacersTrack();
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
    const track = realmRacersTrack();
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

  it('fires no shell outside an active Rally match', () => {
    const sim = makeWorld();
    const a = addAt(sim, 'warrior', 'Aster');
    realmRacersFireGroundBlast(sim.ctx, entity(sim, a));
    expect(sim.realmRacers.match).toBeNull();
  });
});
