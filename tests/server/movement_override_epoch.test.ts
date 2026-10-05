import { describe, expect, it } from 'vitest';
import {
  computeOverrideSignature,
  createMovementOverrideSessionState,
  type MovementOverrideSessionState,
  overrideActive,
  updateMovementOverrideEpochs,
  vehicleStepCeilingYd,
  vehicleStepKinematicYd,
  vehicleStepSettleMarginYd,
} from '../../server/movement_override_epoch';
import { realmRacersCompetitionCircuits } from '../../src/sim/content/realm_racers_circuits';
import {
  EASTBROOK_FERRY_HULL,
  EASTBROOK_NIGHTBLOOM_FERRY,
} from '../../src/sim/content/transport_ships';
import { vehicleProfile } from '../../src/sim/content/vehicles';
import { REALM_RACERS_GRID_SIZE } from '../../src/sim/realm_racers_layout';
import { REALM_RACERS_NITRO_SPEED_MULT } from '../../src/sim/realm_racers_pickup_effects';
import { REALM_RACERS_SLICK_SLIP_CAP } from '../../src/sim/realm_racers_slicks';
import { realmRacersTrack } from '../../src/sim/realm_racers_spline';
import { Sim } from '../../src/sim/sim';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_RETURN_TICKS,
  REALM_RACERS_STUCK_TICKS,
  REALM_RACERS_VERGE_BAND,
  type RealmRacersMatch,
  realmRacersStartMatch,
  realmRacersToCanonical,
  realmRacersToWorld,
} from '../../src/sim/social/realm_racers';
import { deckToWorld } from '../../src/sim/transport_deck';
import { carryPassengersAcrossClockJump, transportClock } from '../../src/sim/transport_ferry';
import { transportShipPoseAt, transportVoyageSeconds } from '../../src/sim/transport_schedule';
import {
  type Aura,
  DT,
  type Entity,
  emptyMoveInput,
  type MoveInput,
  RUN_SPEED,
} from '../../src/sim/types';
import { MAX_BUMP_IMPULSE } from '../../src/sim/vehicle_contact';
import { addVehicleSlip, createVehicleDrive, vehicleMaxSlip } from '../../src/sim/vehicle_motion';
import { WATER_LEVEL } from '../../src/sim/world';
import { WORLD_SEED } from '../../src/sim/world_seed';
import { addAt, makeWorld, readyAllRacers } from '../realm_racers_util';

function fixture(): { sim: Sim; session: MovementOverrideSessionState } {
  const sim = new Sim({ seed: 42, playerClass: 'warrior' });
  return {
    sim,
    session: {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    },
  };
}

function aura(kind: Aura['kind'], id: string = kind, value = 0): Aura {
  return {
    id,
    name: id,
    kind,
    remaining: 1,
    duration: 1,
    value,
    sourceId: 0,
    school: 'physical',
  };
}

describe('computeOverrideSignature', () => {
  it('covers each crowd-control and forced-movement arm', () => {
    const { sim } = fixture();
    const entity = sim.player;
    const meta = sim.meta(entity.id)!;
    for (const kind of ['stun', 'root', 'incapacitate', 'polymorph'] as const) {
      entity.auras = [aura(kind)];
      expect(overrideActive(computeOverrideSignature(entity, meta, 1)), kind).toBe(true);
    }
    entity.auras = [];
    const forcedModes = [
      () => (entity.chargeTargetId = 2),
      () => (entity.followTargetId = 2),
      () => (entity.leap = {} as NonNullable<typeof entity.leap>),
      () => (entity.valkyrsCalling = {} as NonNullable<typeof entity.valkyrsCalling>),
      () => (meta.mountRace = { phase: 'countdown' } as NonNullable<typeof meta.mountRace>),
      () => (entity.climb = {} as NonNullable<typeof entity.climb>),
    ];
    for (const arm of forcedModes) {
      arm();
      expect(overrideActive(computeOverrideSignature(entity, meta, 1))).toBe(true);
      entity.chargeTargetId = null;
      entity.followTargetId = null;
      entity.leap = null;
      entity.valkyrsCalling = null;
      meta.mountRace = null;
      entity.climb = null;
    }
  });

  it('keeps death, ghost, swimming, and speed-only changes out of the active flag', () => {
    const { sim } = fixture();
    const entity = sim.player;
    entity.dead = true;
    entity.ghost = true;
    entity.pos.y = -100;
    expect(overrideActive(computeOverrideSignature(entity, sim.meta(entity.id)!, 1.75))).toBe(
      false,
    );
  });
});

describe('updateMovementOverrideEpochs', () => {
  it('drives every crowd-control and forced-movement arm through the live updater', () => {
    const { sim, session } = fixture();
    const entity = sim.player;
    const meta = sim.meta(entity.id)!;
    updateMovementOverrideEpochs(sim, [session]);

    for (const kind of ['stun', 'root', 'incapacitate', 'polymorph'] as const) {
      entity.auras = [aura(kind)];
      updateMovementOverrideEpochs(sim, [session]);
      expect(session.movementOverrideActive, kind).toBe(true);
      entity.auras = [];
      updateMovementOverrideEpochs(sim, [session]);
    }

    const forcedModes = [
      () => (entity.chargeTargetId = 2),
      () => (entity.followTargetId = 2),
      () => (entity.leap = {} as NonNullable<typeof entity.leap>),
      () => (entity.valkyrsCalling = {} as NonNullable<typeof entity.valkyrsCalling>),
      () => (meta.mountRace = { phase: 'countdown' } as NonNullable<typeof meta.mountRace>),
      () => (entity.climb = {} as NonNullable<typeof entity.climb>),
    ];
    for (const arm of forcedModes) {
      arm();
      updateMovementOverrideEpochs(sim, [session]);
      expect(session.movementOverrideActive).toBe(true);
      entity.chargeTargetId = null;
      entity.followTargetId = null;
      entity.leap = null;
      entity.valkyrsCalling = null;
      meta.mountRace = null;
      entity.climb = null;
      updateMovementOverrideEpochs(sim, [session]);
    }
  });

  it('classifies fear through the crowd-control arm with one aura scan', () => {
    const { sim, session } = fixture();
    const auras = [aura('incapacitate', 'fear_incap')];
    const some = auras.some.bind(auras);
    let scans = 0;
    auras.some = ((predicate: Parameters<typeof auras.some>[0]) => {
      scans++;
      return some(predicate);
    }) as typeof auras.some;
    sim.player.auras = auras;
    sim.moveSpeedMult(sim.player);
    const speedScans = scans;
    scans = 0;

    updateMovementOverrideEpochs(sim, [session]);

    expect(session.movementOverrideActive).toBe(true);
    expect(scans).toBe(speedScans + 1);
  });

  it('increments on signature transitions and exact speed multiplier changes', () => {
    const { sim, session } = fixture();
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(0);
    sim.player.auras.push(aura('root', 'test_root'));
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(1);
    expect(session.movementOverrideActive).toBe(true);
    sim.player.auras = [];
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(2);
    sim.player.auras.push(aura('buff_speed', 'test_speed', 1.5));
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(3);
    expect(session.movementOverrideActive).toBe(false);
    expect(session.movementMoveSpeedMult).toBe(1.5);
  });

  it('increments on teleports and knockbacks but not a maximum-speed intent step', () => {
    const { sim, session } = fixture();
    const entity = sim.player;
    updateMovementOverrideEpochs(sim, [session]);

    const legalStep = RUN_SPEED * sim.moveSpeedMult(entity) * DT;
    entity.prevPos = { ...entity.pos };
    entity.pos.x += legalStep;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(0);

    entity.pos.x += 2;
    entity.prevPos = { ...entity.pos };
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(1);

    entity.prevPos = { ...entity.pos };
    entity.pos.z += 1;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session.movementOverrideEpoch).toBe(2);
  });

  it('leaves movement v1 session state untouched', () => {
    const { sim, session } = fixture();
    session.movementWireVersion = 1;
    sim.player.chargeTargetId = 2;
    updateMovementOverrideEpochs(sim, [session]);
    expect(session).toMatchObject(createMovementOverrideSessionState());
  });

  it('reuses the stored signature and authoritative position objects', () => {
    const { sim, session } = fixture();
    updateMovementOverrideEpochs(sim, [session]);
    const signature = session.movementOverrideSignature;
    const position = session.movementAuthoritativePosition;

    sim.player.auras.push(aura('root', 'test_root'));
    sim.player.pos.x += 1;
    updateMovementOverrideEpochs(sim, [session]);

    expect(session.movementOverrideSignature).toBe(signature);
    expect(session.movementAuthoritativePosition).toBe(position);
  });
});

describe('a ferry passenger (server/transport_head.ts ferryMovementFrame)', () => {
  // A passenger is measured in the sailing hull's frame, so the ship's way (19 yd/s, far
  // past a runner's step) never reads as a teleport and restarts their prediction each
  // tick; the one bump is the frame change itself, at cast-off and at mooring.
  it('bumps once at cast-off and once at mooring, never while the deck carries them', () => {
    const route = EASTBROOK_NIGHTBLOOM_FERRY;
    const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
    const e = sim.player;
    const session: MovementOverrideSessionState = {
      pid: sim.playerId,
      movementWireVersion: 2,
      ...createMovementOverrideSessionState(),
    };
    const over = (ticks: number): { bumps: number; riding: number } => {
      let bumps = 0;
      let riding = 0;
      for (let i = 0; i < ticks; i++) {
        const before = session.movementOverrideEpoch;
        sim.tick();
        updateMovementOverrideEpochs(sim, [session]);
        if (session.movementOverrideEpoch !== before) bumps++;
        if (e.ferryRide) riding++;
      }
      return { bumps, riding };
    };
    updateMovementOverrideEpochs(sim, [session]);
    expect(over(40), 'on foot ashore').toEqual({ bumps: 0, riding: 0 });

    // aboard a second before cast-off, then well into the voyage
    sim.transportClockOffset = route.timings.docked - 1 - sim.time;
    const pose = transportShipPoseAt(route, transportClock(sim.ctx), { x: 0, z: 0, rot: 0 });
    const at = deckToWorld(pose, 0.5, -3, { x: 0, z: 0 });
    e.pos = { x: at.x, y: WATER_LEVEL + EASTBROOK_FERRY_HULL.mainDeckY, z: at.z };
    e.prevPos = { ...e.pos };
    e.onGround = true;
    sim.ctx.rebucket(e);
    updateMovementOverrideEpochs(sim, [session]); // the placement's own jump, uncounted
    const start = { x: e.pos.x, z: e.pos.z };
    const sail = over(400);
    expect(sail.bumps, 'cast-off, then a still epoch under way').toBe(1);
    expect(sail.riding).toBeGreaterThan(300);
    expect(Math.hypot(e.pos.x - start.x, e.pos.z - start.z)).toBeGreaterThan(40);

    // on to a second before mooring (the dev skip's carry), then through it
    const from = transportClock(sim.ctx);
    const mooring = route.timings.docked + transportVoyageSeconds(route, 0) - 1.5;
    sim.transportClockOffset += mooring - from;
    carryPassengersAcrossClockJump(sim.ctx, from);
    // the skip's own jump, uncounted: the ride's recorded pose catches up on the next tick
    updateMovementOverrideEpochs(sim, [session]);
    sim.tick();
    updateMovementOverrideEpochs(sim, [session]);
    expect(e.ferryRide, 'still under way after the skip').toBeTruthy();
    const moor = over(60);
    expect(moor.bumps, 'the frame change back to the world at mooring').toBe(1);
    expect(e.ferryRide ?? null).toBeNull();
  });
});

// A kart runs past 80 yd/s with slip, is shoved by rivals and thrown into the
// air by a shell, and its slows are surface bands: none of that is a server
// override. What is: the seat and the unseat, every circuit teleport, and the
// race lock the movement pass returns early on, bumped for the exact tick the
// next pass reads.
describe('a Realm Racers driver (vehicle-aware epoch)', () => {
  const CIRCUIT = realmRacersCompetitionCircuits()[0];
  const TRACK = realmRacersTrack(CIRCUIT);

  interface RaceRig {
    sim: Sim;
    pids: number[];
    sessions: MovementOverrideSessionState[];
    events: { type: string; pid?: number }[];
    match(): RealmRacersMatch;
    entity(pid: number): Entity;
    input(pid: number, mi: Partial<MoveInput>): void;
    /** One server tick, then the post-tick epoch pass (server/game.ts order);
     *  which sessions bumped. */
    step(): boolean[];
    /** The ticks (sim tickCount) each session bumped on over `ticks` steps. */
    run(ticks: number): number[][];
    place(pid: number, s: number, opts?: { lateral?: number; heading?: number }): void;
    resets(pid: number): number;
    /** Per session, the longest horizontal step between two epoch passes
     *  since the last `resetWorst`. */
    worst: number[];
    resetWorst(): void;
  }

  function rig(): RaceRig {
    const sim = makeWorld();
    const pids = Array.from({ length: REALM_RACERS_GRID_SIZE }, (_, i) =>
      addAt(sim, 'warrior', `Racer${i}`, -6 + i * 4, -40),
    );
    const sessions = pids.map(
      (pid): MovementOverrideSessionState => ({
        pid,
        movementWireVersion: 2,
        ...createMovementOverrideSessionState(),
      }),
    );
    const events: { type: string; pid?: number }[] = [];
    updateMovementOverrideEpochs(sim, sessions);
    const match = (): RealmRacersMatch => {
      const found = sim.realmRacers.match;
      if (!found) throw new Error('no race seated');
      return found;
    };
    const entity = (pid: number): Entity => {
      const e = sim.entities.get(pid);
      if (!e) throw new Error(`no entity ${pid}`);
      return e;
    };
    const worst = sessions.map(() => 0);
    const step = (): boolean[] => {
      const before = sessions.map((session) => session.movementOverrideEpoch);
      const from = sessions.map((session) => ({ ...session.movementAuthoritativePosition! }));
      for (const event of sim.tick()) events.push(event as { type: string; pid?: number });
      updateMovementOverrideEpochs(sim, sessions);
      sessions.forEach((session, i) => {
        const to = session.movementAuthoritativePosition!;
        worst[i] = Math.max(worst[i], Math.hypot(to.x - from[i].x, to.z - from[i].z));
      });
      return sessions.map((session, i) => session.movementOverrideEpoch !== before[i]);
    };
    return {
      sim,
      pids,
      sessions,
      events,
      match,
      entity,
      input(pid, mi) {
        Object.assign(sim.meta(pid)!.moveInput, emptyMoveInput(), mi);
      },
      step,
      run(ticks) {
        const bumped: number[][] = sessions.map(() => []);
        for (let i = 0; i < ticks; i++) {
          step().forEach((b, k) => {
            if (b) bumped[k].push(sim.tickCount);
          });
        }
        return bumped;
      },
      // A fixture teleport, stamped the way a machine that drove there would
      // have left its lap bookkeeping (tests/realm_racers_reset.test.ts
      // parkOffRoad). Its own jump is absorbed by one epoch pass here, the way
      // the ferry case absorbs its placement.
      place(pid, s, opts = {}) {
        const m = match();
        const point = TRACK.pointAt(s);
        const lateral = opts.lateral ?? 0;
        const world = realmRacersToWorld(
          m,
          point.x - point.tz * lateral,
          point.z + point.tx * lateral,
        );
        const e = entity(pid);
        e.pos = sim.ctx.groundPos(world.x, world.z);
        e.prevPos = { ...e.pos };
        const canonical = realmRacersToCanonical(m, world.x, world.z);
        const projection = TRACK.project(canonical.x, canonical.z);
        const progress = m.progress.get(pid)!;
        progress.lastS = projection.s;
        progress.trackIndex = projection.index;
        e.facing = Math.atan2(point.tx, point.tz) + (opts.heading ?? 0);
        e.prevFacing = e.facing;
        sim.ctx.rebucket(e);
        updateMovementOverrideEpochs(sim, sessions);
      },
      resets(pid) {
        return events.filter((ev) => ev.type === 'realmRacersReset' && ev.pid === pid).length;
      },
      worst,
      resetWorst() {
        worst.fill(0);
      },
    };
  }

  /** The loosened bound is really exercised (far past a runner's step), yet the
   *  worst legal step stays under it with the settle margin left unspent. */
  function expectLegalVehicleSteps(r: RaceRig, session: number): void {
    const key = r.entity(r.pids[session]).drive!.profileKey;
    expect(r.worst[session]).toBeLessThan(vehicleStepKinematicYd(key));
    expect(vehicleStepCeilingYd(key) - r.worst[session]).toBeGreaterThan(
      vehicleStepSettleMarginYd(key),
    );
  }

  /** The arc position that starts the straightest `span` yards of the lap, so a
   *  machine leaving the road there gains no arc and the track-limits referee
   *  (a legitimate teleport) stays out of a zero-bump window. */
  function straightest(span: number): number {
    let best = 0;
    let bestTurn = Number.POSITIVE_INFINITY;
    for (let s = 0; s < TRACK.length; s += TRACK.length / 200) {
      const a = TRACK.pointAt(s);
      const b = TRACK.pointAt((s + span) % TRACK.length);
      const c = TRACK.pointAt((s + span / 2) % TRACK.length);
      const turn = 2 - (a.tx * b.tx + a.tz * b.tz) - (a.tx * c.tx + a.tz * c.tz);
      if (turn < bestTurn) {
        bestTurn = turn;
        best = s;
      }
    }
    return best;
  }

  /** Seated, lobby closed, countdown run out; the rest of the grid parked far
   *  down the lap so only the case under test touches the local machine. */
  function racing(clearFrom: number): RaceRig {
    const r = rig();
    realmRacersStartMatch(r.sim.ctx, r.pids, undefined, CIRCUIT.id);
    r.step();
    readyAllRacers(r.sim);
    while (r.match().phase !== 'racing') r.step();
    r.step();
    r.pids.slice(1).forEach((pid, i) => {
      r.place(pid, (clearFrom + TRACK.length * (0.35 + i * 0.15)) % TRACK.length);
    });
    // the grid seat's own relocation markers are not an in-race recovery
    r.events.length = 0;
    return r;
  }

  function runnerStep(r: RaceRig, pid: number): number {
    return RUN_SPEED * r.sim.moveSpeedMult(r.entity(pid)) * DT;
  }

  it('bumps once at the seat, holds through lobby and countdown, and once at GO for the next pass', () => {
    const r = rig();
    const [a] = r.pids;
    const session = r.sessions[0];
    realmRacersStartMatch(r.sim.ctx, r.pids, undefined, CIRCUIT.id);
    const seat = r.run(1);
    expect(seat[0], 'the seat: drive, grid teleport and race lock in one bump').toHaveLength(1);
    expect(r.resets(a), 'the grid teleport snaps the owning client').toBe(1);
    expect(session.movementOverrideSignature).toMatchObject({ driving: true, raceLocked: true });
    expect(session.movementOverrideActive).toBe(true);

    r.input(a, { forward: true });
    readyAllRacers(r.sim);
    const bumps: number[] = [];
    let goSeen: number | null = null;
    let lkAtGo: boolean | null = null;
    for (let i = 0; i < 400 && goSeen === null; i++) {
      if (r.step()[0]) bumps.push(r.sim.tickCount);
      if (r.match().phase === 'racing') {
        goSeen = r.sim.tickCount;
        lkAtGo = r.entity(a).drive?.controlsLocked ?? null;
      }
    }
    // One bump, on the post-tick of the very tick whose rally pass drops the
    // flag. The drive's lock (`lk` on the wire) was written earlier in that
    // same tick, so the mirror clears it one snapshot late; this bit does not.
    expect(goSeen).toBe(r.match().goTick);
    expect(bumps).toEqual([goSeen]);
    expect(lkAtGo).toBe(true);
    expect(session.movementOverrideActive).toBe(false);
    const grid = { ...r.entity(a).pos };
    r.step();
    expect(Math.hypot(r.entity(a).pos.x - grid.x, r.entity(a).pos.z - grid.z)).toBeGreaterThan(0);
  });

  it('never bumps through a drift at nitro top speed on oil, then the nitro running out over the cap', () => {
    const s = straightest(120);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s);
    const e = r.entity(a);
    const drive = e.drive!;
    const profile = vehicleProfile(drive.profileKey);
    const progress = r.match().progress.get(a)!;
    const nitroTicks = 6;
    progress.nitroUntilTick = r.sim.tickCount + nitroTicks;
    progress.slickGripUntilTick = r.sim.tickCount + 20;
    drive.speedCap = REALM_RACERS_NITRO_SPEED_MULT;
    drive.slipCap = REALM_RACERS_SLICK_SLIP_CAP;
    drive.speed = profile.maxSpeed * REALM_RACERS_NITRO_SPEED_MULT;
    drive.slip = vehicleMaxSlip(profile, drive);
    r.input(a, { forward: true, turnLeft: true, jump: true });
    r.resetWorst();
    let maxStepOverRunner = 0;
    let overCapAfterNitro = 0;
    const bumps: number[] = [];
    for (let i = 0; i < 20; i++) {
      const from = { ...e.pos };
      if (r.step()[0]) bumps.push(r.sim.tickCount);
      const moved = Math.hypot(e.pos.x - from.x, e.pos.z - from.z);
      maxStepOverRunner = Math.max(maxStepOverRunner, moved / runnerStep(r, a));
      if (r.sim.tickCount >= progress.nitroUntilTick && drive.speed > profile.maxSpeed) {
        overCapAfterNitro++;
      }
    }
    expect(r.resets(a)).toBe(0);
    expect(maxStepOverRunner, 'a step the runner bound calls a teleport').toBeGreaterThan(5);
    expect(overCapAfterNitro, 'ticks past the nitro still over the road cap').toBeGreaterThan(0);
    expectLegalVehicleSteps(r, 0);
    expect(bumps).toEqual([]);
  });

  it('never bumps driving off the road through the verge into the garden', () => {
    const s = straightest(60);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s, { heading: Math.PI / 2 });
    const road = r.sessions[0].movementMoveSpeedMult;
    r.entity(a).drive!.speed = 50;
    r.input(a, { forward: true });
    r.resetWorst();
    const mults = new Set<number>();
    const bumps: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (r.step()[0]) bumps.push(r.sim.tickCount);
      mults.add(r.sessions[0].movementMoveSpeedMult);
    }
    expect(r.resets(a)).toBe(0);
    expect([...mults]).toEqual(
      expect.arrayContaining([
        road * REALM_RACERS_VERGE_BAND.speedMult,
        road * REALM_RACERS_GARDEN_BAND.speedMult,
      ]),
    );
    expectLegalVehicleSteps(r, 0);
    expect(bumps).toEqual([]);
  });

  it('never bumps either machine through a real contact, nor through a 39 yd/s shove', () => {
    const s = straightest(80);
    const r = racing(s);
    const [a, b] = r.pids;
    r.place(a, s);
    r.place(b, s + 10);
    r.entity(a).drive!.speed = 45;
    r.input(a, { forward: true });
    r.resetWorst();
    const contact = r.run(12);
    expect(r.events.some((ev) => ev.type === 'realmRacersBump')).toBe(true);
    expect(r.resets(a) + r.resets(b)).toBe(0);
    expect(contact[0]).toEqual([]);
    expect(contact[1]).toEqual([]);
    expectLegalVehicleSteps(r, 0);
    expectLegalVehicleSteps(r, 1);

    r.place(a, s);
    const drive = r.entity(a).drive!;
    drive.speed = 40 + MAX_BUMP_IMPULSE;
    addVehicleSlip(
      drive,
      MAX_BUMP_IMPULSE,
      vehicleMaxSlip(vehicleProfile(drive.profileKey), drive),
    );
    r.resetWorst();
    const shove = r.run(12);
    expect(r.resets(a)).toBe(0);
    expectLegalVehicleSteps(r, 0);
    expect(shove[0]).toEqual([]);
  });

  it('covers a hull settled out of every rival at once in a four-kart pile-up', () => {
    // Each pair moves a hull by half its overlap (one profile, equal masses),
    // so a hull that comes out of the last pair still inside the next rival is
    // moved again: three rivals stacked that way push it three body radii,
    // past a margin sized for one full overlap of two hulls.
    const s = straightest(40);
    const r = racing(s);
    const [a, b, c, d] = r.pids;
    const radius = vehicleProfile(r.entity(a).drive!.profileKey).bodyRadius;
    const eps = 0.01;
    r.place(a, s);
    r.place(b, s, { lateral: eps });
    r.place(c, s, { lateral: -radius + 1.5 * eps });
    r.place(d, s, { lateral: -2 * radius + 2 * eps });
    r.resetWorst();
    const bumped = r.step();
    expect(r.worst[0]).toBeGreaterThan(2 * radius + 1);
    expect(r.worst[0]).toBeLessThanOrEqual(
      vehicleStepSettleMarginYd(r.entity(a).drive!.profileKey),
    );
    expect(bumped[0]).toBe(false);
  });

  it('never bumps through a Ground Blast pop, the slow it leaves, the flight and the landing', () => {
    const s = straightest(100);
    const r = racing(s);
    const [a, b] = r.pids;
    r.place(a, s);
    const e = r.entity(a);
    e.drive!.speed = 45;
    r.input(a, { forward: true });
    r.match().groundBlasts.push({
      ownerPid: b,
      x: e.pos.x + Math.sin(e.facing) * 2.5,
      z: e.pos.z + Math.cos(e.facing) * 2.5,
      impactTick: r.sim.tickCount + 1,
    });
    r.resetWorst();
    let airborne = 0;
    let landed = false;
    const mults = new Set<number>();
    const bumps: number[] = [];
    for (let i = 0; i < 40; i++) {
      if (r.step()[0]) bumps.push(r.sim.tickCount);
      mults.add(r.sessions[0].movementMoveSpeedMult);
      if (!e.onGround) airborne++;
      else if (airborne > 0) landed = true;
    }
    expect(r.events.some((ev) => ev.type === 'realmRacersGroundBlastHit')).toBe(true);
    expect(airborne).toBeGreaterThan(3);
    expect(landed).toBe(true);
    expect(mults.size).toBeGreaterThan(1);
    expect(r.resets(a)).toBe(0);
    expectLegalVehicleSteps(r, 0);
    expect(bumps).toEqual([]);
  });

  it('bumps once for a driver teleported between ticks with no lock, still coasting', () => {
    const s = straightest(120);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s);
    const e = r.entity(a);
    e.drive!.speed = 50;
    r.input(a, { forward: true });
    expect(r.run(5)[0]).toEqual([]);
    // The start-of-tick copy absorbs prevPos, so the kernel's step moves the
    // body off it and only the step bound can see the jump.
    const jumpYd = 40;
    e.pos.x += Math.sin(e.facing) * jumpYd;
    e.pos.z += Math.cos(e.facing) * jumpYd;
    e.pos = r.sim.ctx.groundPos(e.pos.x, e.pos.z);
    e.prevPos = { ...e.pos };
    r.sim.ctx.rebucket(e);
    expect(jumpYd).toBeGreaterThan(vehicleStepCeilingYd(e.drive!.profileKey));
    const bumps = r.run(10)[0];
    expect(r.resets(a)).toBe(0);
    expect(r.sessions[0].movementOverrideActive).toBe(false);
    expect(e.drive!.speed).toBeGreaterThan(0);
    expect(bumps).toHaveLength(1);
  });

  it('bumps once for a racing driver teleported inside the tick, even by less than the bound', () => {
    const s = straightest(120);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s);
    const e = r.entity(a);
    e.drive!.speed = 50;
    r.input(a, { forward: true });
    expect(r.run(5)[0]).toEqual([]);
    const before = r.sessions[0].movementOverrideEpoch;
    // After this tick's movement, the way a circuit teleport lands: prevPos is
    // written with the new pose, so the `pos == prevPos` arm alone decides.
    r.sim.tick();
    const hopYd = 3;
    e.pos.x += Math.sin(e.facing) * hopYd;
    e.pos.z += Math.cos(e.facing) * hopYd;
    e.prevPos = { ...e.pos };
    updateMovementOverrideEpochs(r.sim, r.sessions);
    expect(hopYd + 50 * DT).toBeLessThan(vehicleStepCeilingYd(e.drive!.profileKey));
    expect(r.sessions[0].movementOverrideActive).toBe(false);
    expect(r.sessions[0].movementOverrideEpoch - before).toBe(1);
    expect(r.run(10)[0]).toEqual([]);
  });

  it('bumps once at a manual recovery and once as its lock lifts, for the pass that drives', () => {
    const s = straightest(60);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s);
    r.input(a, { forward: true });
    r.run(10);
    const commandTick = r.sim.tickCount;
    r.sim.realmRacersResetPosition(a);
    const until = r.match().progress.get(a)!.resetLockedUntilTick;
    const e = r.entity(a);
    const held = { ...e.pos };
    const bumps: number[] = [];
    while (r.sim.tickCount < until - 1) {
      if (r.step()[0]) bumps.push(r.sim.tickCount);
    }
    expect(Math.hypot(e.pos.x - held.x, e.pos.z - held.z), 'held for the whole lock').toBe(0);
    expect(r.sessions[0].movementOverrideActive).toBe(false);
    if (r.step()[0]) bumps.push(r.sim.tickCount);
    expect(r.sim.tickCount).toBe(until);
    expect(Math.hypot(e.pos.x - held.x, e.pos.z - held.z), 'the next pass drives').toBeGreaterThan(
      0,
    );
    // The teleport and the lock start land on the first held pass; the lock
    // end on the post-tick BEFORE the first pass that drives again.
    expect(bumps).toEqual([commandTick + 1, until - 1]);
    expect(r.run(20)[0]).toEqual([]);
  });

  it('bumps once at an automatic recovery and once as its one-tick lock lifts', () => {
    const s = straightest(60);
    const r = racing(s);
    const [a] = r.pids;
    const road = r.sessions[0].movementMoveSpeedMult;
    const progress = r.match().progress.get(a)!;
    progress.resetS = s;
    r.place(a, s, { lateral: TRACK.pointAt(s).halfWidth + 8 });
    r.entity(a).drive!.speed = 0;
    r.input(a, {});
    const mults = new Set<number>();
    const bumps: number[] = [];
    let resetTick: number | null = null;
    for (let i = 0; i < REALM_RACERS_STUCK_TICKS + 20; i++) {
      if (r.step()[0]) bumps.push(r.sim.tickCount);
      if (resetTick === null && r.resets(a) > 0) resetTick = r.sim.tickCount;
      mults.add(r.sessions[0].movementMoveSpeedMult);
    }
    expect(r.resets(a)).toBe(1);
    // Stopped on the lawn under its slow for the whole wait: not an override.
    expect(mults.has(road * REALM_RACERS_GARDEN_BAND.speedMult)).toBe(true);
    expect(bumps).toEqual([resetTick, (resetTick ?? 0) + 1]);
  });

  it('bumps once as the flag falls into the tableau and once at the return home', () => {
    const s = straightest(60);
    const r = racing(s);
    const [a] = r.pids;
    r.place(a, s);
    r.match().deadlineTick = r.sim.tickCount + 1;
    const finishTick = r.sim.tickCount + 1;
    const bumps = r.run(REALM_RACERS_RETURN_TICKS + 10)[0];
    expect(r.sim.realmRacers.match).toBeNull();
    expect(r.entity(a).drive).toBeNull();
    expect(bumps).toEqual([finishTick, finishTick + REALM_RACERS_RETURN_TICKS]);
    expect(r.sessions[0].movementOverrideSignature).toMatchObject({
      driving: false,
      raceLocked: false,
    });
  });

  it('bumps once when a drive is taken or dropped on its own, without standing the client down', () => {
    const r = rig();
    const [a] = r.pids;
    const e = r.entity(a);
    e.drive = createVehicleDrive('rally_loaner');
    updateMovementOverrideEpochs(r.sim, r.sessions);
    expect(r.sessions[0].movementOverrideEpoch).toBe(1);
    expect(r.sessions[0].movementOverrideActive).toBe(false);
    updateMovementOverrideEpochs(r.sim, r.sessions);
    e.drive = null;
    updateMovementOverrideEpochs(r.sim, r.sessions);
    expect(r.sessions[0].movementOverrideEpoch).toBe(2);
  });

  it('keeps a runner step bounded and a runner speed change a bump', () => {
    const r = rig();
    const [a] = r.pids;
    const e = r.entity(a);
    e.prevPos = { ...e.pos };
    e.pos.x += runnerStep(r, a) * 1.5;
    updateMovementOverrideEpochs(r.sim, r.sessions);
    expect(r.sessions[0].movementOverrideEpoch).toBe(1);
    e.auras.push(aura('slow', 'runner_slow', 0.5));
    updateMovementOverrideEpochs(r.sim, r.sessions);
    expect(r.sessions[0].movementOverrideEpoch).toBe(2);
    expect(r.sessions[0].movementOverrideSignature).toMatchObject({
      driving: false,
      raceLocked: false,
    });
  });
});
