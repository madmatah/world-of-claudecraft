import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import { createClientPlayerMotionDeps } from '../src/render/client_player_motion';
import { createDeckAwareStep } from '../src/render/deck_prediction';
import {
  copyMotionState,
  DRIVE_MATCH_FIELDS,
  DRIVE_PRESENTATION_FIELDS,
  type MotionState,
  type PredictionPose,
  type PredictionResidual,
  PredictionRing,
  predictTick,
  type ReconciliationResult,
  reconcile,
  SELF_PREDICTION_RING_CAPACITY,
} from '../src/render/self_prediction_core';
import { REALM_RACERS_PRACTICE_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { stepPlayerMotion } from '../src/sim/player_motion';
import {
  GROUND_BLAST_CONTROL_SECONDS,
  GROUND_BLAST_CONTROL_SPEED_MULT,
  GROUND_BLAST_POP_VELOCITY,
  GROUND_BLAST_SHOCK_GRIP,
  GROUND_BLAST_SHOCK_TICKS,
} from '../src/sim/realm_racers_ground_blast';
import {
  REALM_RACERS_NITRO_KICK,
  REALM_RACERS_NITRO_SPEED_MULT,
} from '../src/sim/realm_racers_pickup_effects';
import {
  REALM_RACERS_SLICK_GRIP,
  REALM_RACERS_SLICK_SLIP_CAP,
} from '../src/sim/realm_racers_slicks';
import { realmRacersStarts } from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GROUND_BLAST_AURA,
  REALM_RACERS_OFF_TRACK_AURA,
  REALM_RACERS_VEHICLE_KEY,
  REALM_RACERS_VERGE_BAND,
} from '../src/sim/social/realm_racers';
import {
  type Aura,
  CAST_COMPLETE_EPS,
  DT,
  type Entity,
  emptyMoveInput,
  type MoveInput,
  normAngle,
  type VehicleDrive,
} from '../src/sim/types';
import { resolveVehicleContact } from '../src/sim/vehicle_contact';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { groundHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

function state(x = 0): MotionState {
  return {
    id: 1,
    pos: { x, y: 2, z: 3 },
    prevPos: { x, y: 2, z: 3 },
    facing: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    onGround: true,
    jumping: false,
    fallStartY: 2,
    swimStroke: 0,
    swimDiving: false,
    auras: [],
    ghost: false,
    sitting: false,
    castingAbility: null,
    maxHp: 100,
    mountKey: '',
    mountCastRemaining: 0,
    mountCastKey: '',
  };
}

function frame(ct: number, facing: number | null = null): InputTickFrame {
  return {
    ct,
    facing,
    mi: {
      forward: true,
      back: false,
      turnLeft: false,
      turnRight: false,
      strafeLeft: false,
      strafeRight: false,
      jump: false,
      dive: false,
      surface: false,
    },
  };
}

const step = (motion: MotionState): void => {
  motion.pos.x += 1;
  motion.vx = 20;
};

describe('self prediction core', () => {
  it('steps once and records a full independent motion state', () => {
    const ring = new PredictionRing();
    const initial = state();
    const predicted = predictTick(ring, initial, frame(0, 0.5), step);

    expect(predicted.pos.x).toBe(1);
    expect(predicted.prevPos.x).toBe(0);
    expect(predicted.facing).toBe(0.5);
    expect(ring.head?.pose).toEqual(predicted);

    predicted.pos.x = 99;
    expect(ring.head?.pose.pos.x).toBe(1);
    expect(initial.pos.x).toBe(0);
  });

  it('bounds the ring at 128 entries', () => {
    const ring = new PredictionRing();
    let predicted = state();
    for (let ct = 0; ct < SELF_PREDICTION_RING_CAPACITY + 3; ct++) {
      predicted = predictTick(ring, predicted, frame(ct), step);
    }

    expect(ring.size).toBe(SELF_PREDICTION_RING_CAPACITY);
    expect(ring.oldestClientTick).toBe(3);
    expect(ring.head?.ct).toBe(130);
  });

  it('drops acknowledged entries after an exact position match', () => {
    const ring = new PredictionRing();
    let predicted = predictTick(ring, state(), frame(0), step);
    predicted = predictTick(ring, predicted, frame(1), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 7 }, 4, 4, step)).toEqual({
      mode: 'match',
    });
    expect(ring.size).toBe(1);
    expect(ring.head?.ct).toBe(1);
  });

  it('rebases and replays later inputs with an exact residual', () => {
    const ring = new PredictionRing();
    let predicted = predictTick(ring, state(), frame(0), step);
    predicted = predictTick(ring, predicted, frame(1), step);
    predictTick(ring, predicted, frame(2), step);

    const result = reconcile(ring, 0, { x: 0.25, y: 2, z: 3, facing: 0.75 }, 2, 2, step);

    expect(result).toEqual({
      mode: 'replayed',
      residual: { x: 0.75, y: 0, z: 0 },
    });
    expect(ring.size).toBe(2);
    expect(ring.find(1)?.pose.pos.x).toBe(1.25);
    expect(ring.head?.pose.pos.x).toBe(2.25);
    expect(ring.find(1)?.pose.prevPos.x).toBe(0.25);
  });

  it('suspends before replay when the override epoch changes', () => {
    const ring = new PredictionRing();
    predictTick(ring, state(), frame(0), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 0 }, 3, 2, step)).toEqual({
      mode: 'suspend',
    });
    expect(ring.size).toBe(1);
  });

  it('ignores an in-flight acknowledgement from before a re-anchored ring', () => {
    const ring = new PredictionRing();
    const predicted = predictTick(ring, state(), frame(71), step);
    predictTick(ring, predicted, frame(72), step);

    expect(reconcile(ring, 68, { x: 1, y: 2, z: 3, facing: 0 }, 4, 4, step)).toEqual({
      mode: 'ignore',
    });
    expect(ring.size).toBe(2);
    expect(ring.oldestClientTick).toBe(71);
    expect(ring.head?.ct).toBe(72);
  });

  it('marks an acknowledgement older than the retained tail as stale', () => {
    const ring = new PredictionRing(2);
    let predicted = state();
    for (let ct = 0; ct < 3; ct++) predicted = predictTick(ring, predicted, frame(ct), step);

    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 0 }, 0, 0, step)).toEqual({
      mode: 'stale',
    });
  });
});

// The drive-aware reconcile against the REAL movement kernel on the practice
// circuit. The "server" steps a body with stepPlayerMotion (the call the Sim's
// movement pass makes; tests/player_motion.test.ts pins the client dep shape
// to the live Sim for a driver) and applies its race outcomes with the rally's
// own numbers; the client predicts ahead through the production deck-aware
// step and reconciles each acknowledgement.

const SEED = WORLD_SEED;
const RACE_START = realmRacersStarts(REALM_RACERS_PRACTICE_CIRCUIT)[0];

function driveMi(over: Partial<MoveInput> = {}): MoveInput {
  return { ...emptyMoveInput(), ...over };
}

function seatedPilot(facing = RACE_START.facing): MotionState {
  const y = groundHeight(RACE_START.x, RACE_START.z, SEED);
  return {
    ...state(),
    id: 7,
    pos: { x: RACE_START.x, y, z: RACE_START.z },
    prevPos: { x: RACE_START.x, y, z: RACE_START.z },
    facing,
    fallStartY: y,
    mountKey: 'terrorspark_groundshaker',
    drive: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
  };
}

function scriptedInput(ct: number): MoveInput {
  if (ct < 30) return driveMi({ forward: true });
  if (ct < 50) return driveMi({ forward: true, turnLeft: true });
  if (ct < 60) return driveMi({ forward: true, turnLeft: true, jump: true });
  if (ct < 80) return driveMi({ forward: true, strafeRight: true });
  return driveMi({ forward: ct % 7 !== 0, turnRight: ct % 5 < 2 });
}

function acknowledgement(body: MotionState): PredictionPose {
  return {
    x: body.pos.x,
    y: body.pos.y,
    z: body.pos.z,
    facing: body.facing,
    deck: null,
    drive: body.drive ? { ...body.drive } : null,
    vy: body.vy,
    onGround: body.onGround,
    auras: body.auras.map((aura) => ({ ...aura })),
  };
}

// updateAuras (src/sim/combat/auras.ts) runs after the movement pass and
// before the rally pass: one DT off each timer, gone once within the epsilon.
function tickAuras(body: MotionState): void {
  for (const aura of body.auras.slice()) {
    aura.remaining -= DT;
    if (aura.remaining <= CAST_COMPLETE_EPS) body.auras = body.auras.filter((a) => a !== aura);
  }
}

/** The tick whose updateAuras removes an aura the rally pass of `appliedCt`
 *  left at `seconds`. */
function auraExpiryTick(appliedCt: number, seconds: number): number {
  let remaining = seconds;
  for (let ct = appliedCt + 1; ; ct++) {
    remaining -= DT;
    if (remaining <= CAST_COMPLETE_EPS) return ct;
  }
}

const OFF_TRACK_AURA_SECONDS = 0.2;

// The rally's off-track half of the surface pass (tickTrackLimits): the band
// writes its multipliers and refreshes its slow aura, the road clears both.
function offTrackPass(server: MotionState, inBand: boolean): void {
  const drive = server.drive as VehicleDrive;
  const existing = server.auras.find((aura) => aura.id === REALM_RACERS_OFF_TRACK_AURA);
  drive.gripMult = inBand ? REALM_RACERS_VERGE_BAND.gripMult : 1;
  drive.dragMult = inBand ? REALM_RACERS_VERGE_BAND.dragMult : 1;
  if (!inBand) {
    if (existing) server.auras = server.auras.filter((aura) => aura !== existing);
    return;
  }
  if (existing) {
    existing.remaining = existing.duration;
    return;
  }
  server.auras = [
    ...server.auras,
    {
      id: REALM_RACERS_OFF_TRACK_AURA,
      name: REALM_RACERS_VERGE_BAND.name,
      kind: 'slow',
      remaining: OFF_TRACK_AURA_SECONDS,
      duration: OFF_TRACK_AURA_SECONDS,
      value: REALM_RACERS_VERGE_BAND.speedMult,
      sourceId: server.id,
      school: 'physical',
    },
  ];
}

function slowAura(id: string, value: number): Aura {
  return {
    id,
    name: id,
    kind: 'slow',
    remaining: 60,
    duration: 60,
    value,
    sourceId: 7,
    school: 'physical',
  };
}

interface DriveRun {
  modes: Map<number, ReconciliationResult>;
  server: MotionState[];
  ring: PredictionRing;
}

interface DriveScenario {
  ticks: number;
  lag?: number;
  /** A server outcome written in the rally pass of tick `ct` (after the
   *  movement pass and updateAuras). */
  outcome?: (ct: number, server: MotionState) => void;
  /** The server's movement pass skips the kernel on this tick. */
  locked?: (ct: number) => boolean;
  facing?: number;
  input?: (ct: number) => MoveInput;
}

const kernelDeps = createClientPlayerMotionDeps(SEED);
// the streamed camera facing: the server writes it onto a runner, never a driver
const FRAME_FACING = 0.25;

function runDrive(scenario: DriveScenario): DriveRun {
  const lag = scenario.lag ?? 4;
  const input = scenario.input ?? scriptedInput;
  const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
  const ring = new PredictionRing();
  const server = seatedPilot(scenario.facing);
  let predicted = seatedPilot(scenario.facing);
  const modes = new Map<number, ReconciliationResult>();
  const trail: MotionState[] = [];
  for (let t = 0; t < scenario.ticks + lag - 1; t++) {
    if (t < scenario.ticks) {
      predicted = predictTick(ring, predicted, { ct: t, mi: input(t), facing: FRAME_FACING }, step);
    }
    const ct = t - lag + 1;
    if (ct < 0) continue;
    server.prevPos = { ...server.pos };
    if (!server.drive) server.facing = FRAME_FACING;
    if (!scenario.locked?.(ct)) stepPlayerMotion(kernelDeps, server as Entity, input(ct));
    tickAuras(server);
    scenario.outcome?.(ct, server);
    trail.push(copyMotionState(server));
    const result = reconcile(ring, ct, acknowledgement(server), 0, 0, step);
    modes.set(ct, result);
    if (result.mode === 'replayed' && ring.head) predicted = copyMotionState(ring.head.pose);
  }
  return { modes, server: trail, ring };
}

function replayedTicks(run: DriveRun): number[] {
  return [...run.modes].filter(([, r]) => r.mode === 'replayed').map(([ct]) => ct);
}

/** The first replay's residual, derived without the core: before it the head
 *  is the clean run's server pose (a clean run matches every tick), after it
 *  the event run's server pose at the same head tick (every later ack matches). */
function expectExactResidual(run: DriveRun, clean: DriveRun, ct: number, lag = 4): void {
  const result = run.modes.get(ct);
  if (result?.mode !== 'replayed') throw new Error(`expected a replay at ${ct}`);
  const head = ct + lag - 1;
  const before = clean.server[head];
  const after = run.server[head];
  const expected: PredictionResidual = {
    x: before.pos.x - after.pos.x,
    y: before.pos.y - after.pos.y,
    z: before.pos.z - after.pos.z,
  };
  if (after.drive) expected.yaw = normAngle(before.facing - after.facing);
  expect(result.residual).toStrictEqual(expected);
}

function expectAllReconciled(run: DriveRun, ticks: number): void {
  expect(run.modes.size).toBe(ticks);
  for (const [ct, result] of run.modes) {
    expect(['match', 'replayed'], `ct ${ct}`).toContain(result.mode);
  }
}

describe('self prediction core: a seated driver', () => {
  it('replays a clean race script on the real kernel with every acknowledgement an exact match', () => {
    const run = runDrive({ ticks: 120 });
    expectAllReconciled(run, 120);
    expect(replayedTicks(run)).toEqual([]);
    const last = run.server[run.server.length - 1];
    expect(Math.hypot(last.pos.x - RACE_START.x, last.pos.z - RACE_START.z)).toBeGreaterThan(20);
    expect(last.facing).not.toBe(RACE_START.facing);
  });

  it('ignores the frame facing: the kernel owns a driver heading', () => {
    const ring = new PredictionRing();
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const direct = seatedPilot();
    direct.prevPos = { ...direct.pos };
    stepPlayerMotion(kernelDeps, direct as Entity, driveMi({ forward: true, turnLeft: true }));
    const predicted = predictTick(
      ring,
      seatedPilot(),
      { ct: 0, mi: driveMi({ forward: true, turnLeft: true }), facing: 2.5 },
      step,
    );
    expect(predicted.facing).toBe(direct.facing);
    expect(predicted.prevFacing).toBe(RACE_START.facing);
    expect(predicted.pos).toEqual(direct.pos);
  });

  it('deep-copies the drive into the ring, so a later write never reaches a stored pose', () => {
    const ring = new PredictionRing();
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const initial = seatedPilot();
    const predicted = predictTick(
      ring,
      initial,
      { ct: 0, mi: driveMi({ forward: true }), facing: null },
      step,
    );
    const stored = ring.head?.pose.drive?.speed;
    expect(stored).toBeGreaterThan(0);
    (predicted.drive as VehicleDrive).speed = 99;
    expect(ring.head?.pose.drive?.speed).toBe(stored);
    expect(initial.drive?.speed).toBe(0);
    expect(copyMotionState(predicted).drive).not.toBe(predicted.drive);
  });

  it.each([
    [
      'a contact',
      (server: MotionState) => {
        const drive = server.drive as VehicleDrive;
        const body = {
          x: server.pos.x,
          z: server.pos.z,
          facing: server.facing,
          drive,
          radius: 1.4,
          mass: 1,
        };
        const rival = {
          x: server.pos.x + Math.sin(server.facing) * 1.5 + Math.cos(server.facing) * 0.6,
          z: server.pos.z + Math.cos(server.facing) * 1.5 - Math.sin(server.facing) * 0.6,
          facing: server.facing + 1,
          drive: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
          radius: 1.4,
          mass: 1,
        };
        expect(resolveVehicleContact(body, rival).contacted).toBe(true);
        server.pos.x = body.x;
        server.pos.z = body.z;
      },
    ],
    [
      'a surface band change',
      (server: MotionState) => {
        const drive = server.drive as VehicleDrive;
        drive.gripMult = REALM_RACERS_VERGE_BAND.gripMult;
        drive.dragMult = REALM_RACERS_VERGE_BAND.dragMult;
        server.auras = [
          ...server.auras,
          slowAura(REALM_RACERS_OFF_TRACK_AURA, REALM_RACERS_VERGE_BAND.speedMult),
        ];
      },
    ],
  ])(
    'mismatches at the acked tick of %s, then adopts and replays onto the server',
    (_label, hit) => {
      const EVENT = 42;
      const run = runDrive({ ticks: 110, outcome: (ct, server) => ct === EVENT && hit(server) });
      expectAllReconciled(run, 110);
      expect(replayedTicks(run)).toEqual([EVENT]);
      expectExactResidual(run, runDrive({ ticks: 110 }), EVENT);
      const last = run.server[run.server.length - 1];
      expect(run.ring.size).toBe(0);
      expect(last.drive).not.toBeNull();
    },
  );

  it('replays a Ground Blast at the pop and once more when the shock and its control aura end', () => {
    const POP = 42;
    const SHOCK_END = POP + GROUND_BLAST_SHOCK_TICKS;
    const run = runDrive({
      ticks: 110,
      outcome: (ct, server) => {
        const drive = server.drive as VehicleDrive;
        if (ct === POP) {
          server.vy += GROUND_BLAST_POP_VELOCITY;
          server.onGround = false;
          server.auras = [
            ...server.auras,
            {
              ...slowAura(REALM_RACERS_GROUND_BLAST_AURA, GROUND_BLAST_CONTROL_SPEED_MULT),
              remaining: GROUND_BLAST_CONTROL_SECONDS,
              duration: GROUND_BLAST_CONTROL_SECONDS,
            },
          ];
        }
        if (ct >= POP) drive.gripMult = ct < SHOCK_END ? GROUND_BLAST_SHOCK_GRIP : 1;
      },
    });
    // the control aura ages out in the very updateAuras before the pass that
    // ends the shock, so one acknowledgement carries both and one replay adopts both
    expect(auraExpiryTick(POP, GROUND_BLAST_CONTROL_SECONDS)).toBe(SHOCK_END);
    expect(run.server[SHOCK_END - 1].auras.map((a) => a.id)).toEqual([
      REALM_RACERS_GROUND_BLAST_AURA,
    ]);
    expect(run.server[SHOCK_END].auras).toEqual([]);
    expectAllReconciled(run, 110);
    expect(replayedTicks(run)).toEqual([POP, SHOCK_END]);
    expectExactResidual(run, runDrive({ ticks: 110 }), POP);
    const airborne = run.server.slice(POP, SHOCK_END).filter((s) => !s.onGround).length;
    expect(airborne).toBeGreaterThan(1);
    expect(run.server[SHOCK_END].onGround).toBe(true);
  });

  it('replays a verge excursion once on entry and once on exit, the pass clearing the aura with the band', () => {
    const ENTER = 24;
    const EXIT = 44;
    const run = runDrive({
      ticks: 90,
      outcome: (ct, server) => offTrackPass(server, ct >= ENTER && ct < EXIT),
    });
    expect(run.server[EXIT - 1].auras.map((a) => a.id)).toEqual([REALM_RACERS_OFF_TRACK_AURA]);
    expect(run.server[EXIT].auras).toEqual([]);
    expectAllReconciled(run, 90);
    expect(replayedTicks(run)).toEqual([ENTER, EXIT]);
    expectExactResidual(run, runDrive({ ticks: 90 }), ENTER);
  });

  it('replays an off-track aura left to age out once more, on the first tick stepped without it', () => {
    const ENTER = 24;
    const EXIT = 44;
    const run = runDrive({
      ticks: 90,
      outcome: (ct, server) => {
        if (ct < EXIT) offTrackPass(server, ct >= ENTER);
        else if (ct === EXIT) {
          const drive = server.drive as VehicleDrive;
          drive.gripMult = 1;
          drive.dragMult = 1;
        }
      },
    });
    // auras are adopted, not compared: the expiry shows at the first step that
    // ran without the slow, one tick after the updateAuras that removed it
    const expiry = auraExpiryTick(EXIT - 1, OFF_TRACK_AURA_SECONDS);
    expect(expiry).toBe(EXIT + 3);
    expect(run.server[expiry - 1].auras.map((a) => a.id)).toEqual([REALM_RACERS_OFF_TRACK_AURA]);
    expect(run.server[expiry].auras).toEqual([]);
    expectAllReconciled(run, 90);
    expect(replayedTicks(run)).toEqual([ENTER, EXIT, expiry + 1]);
  });

  it.each([
    [
      'nitro',
      (drive: VehicleDrive) => {
        drive.speedCap = REALM_RACERS_NITRO_SPEED_MULT;
        drive.speed += REALM_RACERS_NITRO_KICK;
      },
      (drive: VehicleDrive) => {
        drive.speedCap = 1;
      },
    ],
    [
      'oil',
      (drive: VehicleDrive) => {
        drive.gripMult = REALM_RACERS_SLICK_GRIP;
        drive.slipCap = REALM_RACERS_SLICK_SLIP_CAP;
      },
      (drive: VehicleDrive) => {
        drive.gripMult = 1;
        drive.slipCap = 1;
      },
    ],
  ])(
    'replays %s exactly at its onset and at its expiry, and matches in between',
    (_label, onset, expiry) => {
      const ON = 36;
      const OFF = 76;
      const run = runDrive({
        ticks: 110,
        outcome: (ct, server) => {
          if (ct === ON) onset(server.drive as VehicleDrive);
          if (ct === OFF) expiry(server.drive as VehicleDrive);
        },
      });
      expectAllReconciled(run, 110);
      expect(replayedTicks(run)).toEqual([ON, OFF]);
    },
  );

  it('adopts the replayed state from the acknowledgement, auras included', () => {
    const EVENT = 42;
    const lag = 6;
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    let predicted = seatedPilot();
    for (let ct = 0; ct <= EVENT + lag; ct++) {
      predicted = predictTick(ring, predicted, { ct, mi: scriptedInput(ct), facing: null }, step);
    }
    const server = seatedPilot();
    for (let ct = 0; ct <= EVENT; ct++) {
      server.prevPos = { ...server.pos };
      stepPlayerMotion(kernelDeps, server as Entity, scriptedInput(ct));
    }
    ring.dropThrough(EVENT - 1);
    server.vy += GROUND_BLAST_POP_VELOCITY;
    server.onGround = false;
    server.auras = [slowAura(REALM_RACERS_GROUND_BLAST_AURA, GROUND_BLAST_CONTROL_SPEED_MULT)];
    const ack = acknowledgement(server);

    expect(reconcile(ring, EVENT, ack, 0, 0, step).mode).toBe('replayed');

    const next = ring.find(EVENT + 1)?.pose;
    const expected = copyMotionState(server);
    expected.prevPos = { ...expected.pos };
    stepPlayerMotion(kernelDeps, expected as Entity, scriptedInput(EVENT + 1));
    expect(next?.pos).toEqual(expected.pos);
    expect(next?.vy).toBe(expected.vy);
    expect(next?.onGround).toBe(false);
    expect(next?.drive).toEqual(expected.drive);
    expect(next?.auras.map((a) => a.id)).toEqual([REALM_RACERS_GROUND_BLAST_AURA]);
    expect(next?.prevFacing).toBe(server.facing);
    expect(ack.drive).not.toBe(next?.drive);
  });

  it('adopts a null drive at race end and replays the rest as a runner', () => {
    const END = 50;
    const run = runDrive({
      ticks: 70,
      outcome: (ct, server) => {
        if (ct === END) server.drive = null;
      },
    });
    expectAllReconciled(run, 70);
    expect(replayedTicks(run)).toEqual([END]);
    // a runner head's facing is the camera's: no kart-minus-camera yaw to glide
    expectExactResidual(run, runDrive({ ticks: 70 }), END);
    const result = run.modes.get(END);
    if (result?.mode !== 'replayed') throw new Error('expected a replay');
    expect('yaw' in result.residual).toBe(false);
  });

  it('lands an airborne kart when the race takes the wheel and the ack carries no vertical state', () => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const airborne = seatedPilot();
    airborne.vy = 4;
    airborne.onGround = false;
    const runner = driveMi({ forward: true });
    const expectedAfter = (vy: number, onGround: boolean, ack: PredictionPose): MotionState => {
      const body: MotionState = {
        ...copyMotionState(airborne),
        pos: { x: ack.x, y: ack.y, z: ack.z },
        prevPos: { x: ack.x, y: ack.y, z: ack.z },
        facing: FRAME_FACING,
        drive: null,
        vy,
        onGround,
      };
      stepPlayerMotion(kernelDeps, body as Entity, runner);
      return body;
    };
    for (const carried of [false, true]) {
      const ring = new PredictionRing();
      let predicted = predictTick(
        ring,
        airborne,
        { ct: 0, mi: driveMi({ forward: true }), facing: FRAME_FACING },
        step,
      );
      predicted = predictTick(ring, predicted, { ct: 1, mi: runner, facing: FRAME_FACING }, step);
      expect(ring.find(0)?.pose.onGround).toBe(false);
      const ack = acknowledgement(ring.find(0)?.pose as MotionState);
      ack.drive = null;
      if (carried) {
        ack.vy = -2;
        ack.onGround = false;
      } else {
        delete ack.vy;
        delete ack.onGround;
      }
      expect(reconcile(ring, 0, ack, 0, 0, step).mode).toBe('replayed');
      const expected = carried ? expectedAfter(-2, false, ack) : expectedAfter(0, true, ack);
      const head = ring.head?.pose as MotionState;
      expect(head.pos).toEqual(expected.pos);
      expect(head.vy).toBe(expected.vy);
      expect(head.onGround).toBe(expected.onGround);
    }
  });

  it('keeps a race-end head free of the driver-only fields', () => {
    const ring = new PredictionRing();
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    let predicted = seatedPilot();
    for (let ct = 0; ct < 4; ct++) {
      predicted = predictTick(
        ring,
        predicted,
        { ct, mi: driveMi({ forward: true }), facing: 0.5 },
        step,
      );
    }
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    ack.drive = null;
    expect(reconcile(ring, 0, ack, 0, 0, step).mode).toBe('replayed');
    const head = ring.head?.pose as MotionState;
    expect(head.drive).toBeNull();
    expect('prevFacing' in head).toBe(false);
    expect(head.facing).toBe(0.5);
  });

  it('never steps a locked tick: a race lock replays exactly at its start and at its release', () => {
    const FROM = 40;
    const UNTIL = 60;
    const lockedAt = (ct: number) => ct >= FROM && ct < UNTIL;
    const run = runDrive({
      ticks: 100,
      locked: lockedAt,
      outcome: (ct, server) => {
        (server.drive as VehicleDrive).controlsLocked = lockedAt(ct);
      },
    });
    expectAllReconciled(run, 100);
    // One replay per release is expected: the acked controlsLocked says the
    // acked tick was held, so the client holds the next one too, while the
    // server's gate has already opened on it (the release lags one tick).
    expect(replayedTicks(run)).toEqual([FROM, UNTIL]);
    const held = run.server.filter((_, ct) => lockedAt(ct));
    for (const body of held) expect(body.pos).toEqual(held[0].pos);
  });

  it('holds a locked or server-held frame where it stands', () => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const locked = seatedPilot();
    (locked.drive as VehicleDrive).controlsLocked = true;
    (locked.drive as VehicleDrive).speed = 20;
    const ring = new PredictionRing();
    const a = predictTick(
      ring,
      locked,
      { ct: 0, mi: driveMi({ forward: true }), facing: null },
      step,
    );
    expect(a.pos).toEqual(locked.pos);
    expect(a.drive).toEqual(locked.drive);

    const moving = seatedPilot();
    (moving.drive as VehicleDrive).speed = 20;
    const b = predictTick(
      ring,
      moving,
      { ct: 1, mi: driveMi({ forward: true }), facing: null, held: true },
      step,
    );
    expect(b.pos).toEqual(moving.pos);
    expect(ring.head?.held).toBe(true);
    const c = predictTick(ring, b, { ct: 2, mi: driveMi({ forward: true }), facing: null }, step);
    expect(c.pos).not.toEqual(moving.pos);
  });

  it('keeps a held frame held when a correction replays it', () => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    const start = seatedPilot();
    (start.drive as VehicleDrive).speed = 20;
    let predicted = predictTick(
      ring,
      start,
      { ct: 0, mi: driveMi({ forward: true }), facing: null },
      step,
    );
    predicted = predictTick(
      ring,
      predicted,
      { ct: 1, mi: driveMi({ forward: true }), facing: null, held: true },
      step,
    );
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    ack.x += 0.5;
    expect(reconcile(ring, 0, ack, 0, 0, step).mode).toBe('replayed');
    expect(ring.find(1)?.pose.pos.x).toBe(ack.x);
  });

  it('reports a yaw residual for a spin, and none once the replay has converged', () => {
    const EVENT = 20;
    const scenario = {
      ticks: 60,
      facing: Math.PI - 0.05,
      input: (ct: number) => driveMi({ forward: true, turnLeft: ct >= 6 }),
    };
    const run = runDrive({
      ...scenario,
      outcome: (ct, server) => {
        if (ct === EVENT) (server.drive as VehicleDrive).spin += 2.4;
      },
    });
    expectAllReconciled(run, 60);
    expect(replayedTicks(run)).toEqual([EVENT]);
    expectExactResidual(run, runDrive(scenario), EVENT);
    const result = run.modes.get(EVENT);
    if (result?.mode !== 'replayed') throw new Error('expected a replay');
    expect(result.residual.yaw).not.toBe(0);
    expect(run.server.some((s) => s.facing < 0)).toBe(true);
  });

  it('wraps the yaw residual across the heading seam', () => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    let predicted = seatedPilot(Math.PI - 0.05);
    for (let ct = 0; ct < 3; ct++) {
      predicted = predictTick(ring, predicted, { ct, mi: driveMi(), facing: null }, step);
    }
    expect(ring.head?.pose.facing).toBe(Math.PI - 0.05);
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    ack.facing = -Math.PI + 0.05;
    const result = reconcile(ring, 0, ack, 0, 0, step);
    if (result.mode !== 'replayed') throw new Error('expected a replay');
    expect(ring.head?.pose.facing).toBe(-Math.PI + 0.05);
    expect(result.residual.yaw).toBeCloseTo(-0.1, 12);
  });

  it('matches a signed zero: -0 and +0 speed and slip step to the same state', () => {
    const plus = seatedPilot();
    const minus = seatedPilot();
    (minus.drive as VehicleDrive).speed = -0;
    (minus.drive as VehicleDrive).slip = -0;
    for (let ct = 0; ct < 12; ct++) {
      const mi = driveMi({ forward: ct > 3, turnLeft: ct % 2 === 0 });
      for (const body of [plus, minus]) {
        body.prevPos = { ...body.pos };
        stepPlayerMotion(kernelDeps, body as Entity, mi);
      }
      expect(minus.pos.x === plus.pos.x && minus.pos.z === plus.pos.z, `ct ${ct}`).toBe(true);
      expect(minus.facing === plus.facing).toBe(true);
      expect((minus.drive as VehicleDrive).speed === (plus.drive as VehicleDrive).speed).toBe(true);
      expect((minus.drive as VehicleDrive).slip === (plus.drive as VehicleDrive).slip).toBe(true);
    }

    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    predictTick(ring, seatedPilot(), { ct: 0, mi: driveMi(), facing: null }, step);
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    expect(Object.is((ack.drive as VehicleDrive).speed, 0)).toBe(true);
    (ack.drive as VehicleDrive).speed = -0;
    (ack.drive as VehicleDrive).slip = -0;
    expect(reconcile(ring, 0, ack, 0, 0, step)).toEqual({ mode: 'match' });
  });

  it.each([
    ['speed', (d: VehicleDrive) => (d.speed += 1e-9)],
    ['slip', (d: VehicleDrive) => (d.slip += 1e-9)],
    ['steerAngle', (d: VehicleDrive) => (d.steerAngle += 1e-9)],
    ['yawRate', (d: VehicleDrive) => (d.yawRate += 1e-9)],
    ['spin', (d: VehicleDrive) => (d.spin += 1e-9)],
    ['gripMult', (d: VehicleDrive) => (d.gripMult = 0.7)],
    ['dragMult', (d: VehicleDrive) => (d.dragMult = 3)],
    ['speedCap', (d: VehicleDrive) => (d.speedCap = 1.3)],
    ['slipCap', (d: VehicleDrive) => (d.slipCap = 2)],
    ['controlsLocked', (d: VehicleDrive) => (d.controlsLocked = true)],
    ['profileKey', (d: VehicleDrive) => (d.profileKey = 'tank')],
  ])('mismatches on a driver %s that differs by any amount', (_field, change) => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    predictTick(
      ring,
      seatedPilot(),
      { ct: 0, mi: driveMi({ forward: true, turnLeft: true }), facing: null },
      step,
    );
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    change(ack.drive as VehicleDrive);
    expect(reconcile(ring, 0, ack, 0, 0, step).mode).toBe('replayed');
  });

  it.each([
    ['facing', (a: PredictionPose) => (a.facing += 1e-12)],
    ['vy', (a: PredictionPose) => (a.vy = 1e-12)],
    ['onGround', (a: PredictionPose) => (a.onGround = false)],
    ['a missing drive', (a: PredictionPose) => (a.drive = null)],
  ])('mismatches on a driver %s that differs', (_field, change) => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    predictTick(ring, seatedPilot(), { ct: 0, mi: driveMi({ forward: true }), facing: null }, step);
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    change(ack);
    expect(reconcile(ring, 0, ack, 0, 0, step).mode).toBe('replayed');
  });

  it('compares every drive field but the two presentation readings, so a new field forces a decision', () => {
    const fields = Object.keys(createVehicleDrive(REALM_RACERS_VEHICLE_KEY)).sort();
    expect(fields).toEqual([
      'collisionImpact',
      'controlsLocked',
      'dragMult',
      'gripMult',
      'handbrake',
      'profileKey',
      'slip',
      'slipCap',
      'speed',
      'speedCap',
      'spin',
      'steerAngle',
      'yawRate',
    ]);
    expect([...DRIVE_PRESENTATION_FIELDS].sort()).toEqual(['collisionImpact', 'handbrake']);
    expect([...DRIVE_MATCH_FIELDS, ...DRIVE_PRESENTATION_FIELDS].sort()).toEqual(fields);
  });

  it('ignores the presentation-only handbrake and scrape readings', () => {
    const step = createDeckAwareStep(createClientPlayerMotionDeps(SEED), () => 0);
    const ring = new PredictionRing();
    predictTick(ring, seatedPilot(), { ct: 0, mi: driveMi({ forward: true }), facing: null }, step);
    const ack = acknowledgement(ring.find(0)?.pose as MotionState);
    (ack.drive as VehicleDrive).handbrake = 0.5;
    (ack.drive as VehicleDrive).collisionImpact = 3;
    expect(reconcile(ring, 0, ack, 0, 0, step)).toEqual({ mode: 'match' });
  });

  it('mismatches when a runner acknowledgement meets a seated one', () => {
    const ring = new PredictionRing();
    predictTick(ring, state(), frame(0), step);
    const seated: PredictionPose = {
      x: 1,
      y: 2,
      z: 3,
      facing: 0,
      drive: createVehicleDrive(REALM_RACERS_VEHICLE_KEY),
      vy: 0,
      onGround: true,
    };
    expect(reconcile(ring, 0, seated, 0, 0, step).mode).toBe('replayed');
    expect(ring.size).toBe(0);
  });
});

describe('self prediction core: a runner keeps its old shape', () => {
  it('adds no driver field to a runner pose, entry or residual', () => {
    const ring = new PredictionRing();
    let predicted = predictTick(ring, state(), frame(0, 0.5), step);
    predicted = predictTick(ring, predicted, frame(1), step);
    predictTick(ring, predicted, frame(2), step);
    expect(Object.keys(ring.head?.pose ?? {}).sort()).toEqual(Object.keys(state()).sort());
    expect(Object.keys(ring.head ?? {}).sort()).toEqual(['ct', 'facing', 'mi', 'pose']);

    const result = reconcile(ring, 0, { x: 0.25, y: 2, z: 3, facing: 0.75 }, 2, 2, step);
    if (result.mode !== 'replayed') throw new Error('expected a replay');
    expect(Object.keys(result.residual).sort()).toEqual(['x', 'y', 'z']);
    expect(Object.keys(ring.head?.pose ?? {}).sort()).toEqual(
      [...Object.keys(state()), 'deck'].sort(),
    );
    expect(ring.find(1)?.pose.facing).toBe(0.75);
  });

  it('writes a held runner frame facing without stepping it, as the server does', () => {
    const ring = new PredictionRing();
    const held = predictTick(ring, state(), { ...frame(0, 1.2), held: true }, step);
    expect(held.facing).toBe(1.2);
    expect(held.pos).toEqual(state().pos);
    expect(held.prevPos).toEqual(state().pos);
  });

  it('still matches a runner on position alone', () => {
    const ring = new PredictionRing();
    predictTick(ring, state(), frame(0), step);
    expect(reconcile(ring, 0, { x: 1, y: 2, z: 3, facing: 9 }, 0, 0, step)).toEqual({
      mode: 'match',
    });
  });
});
