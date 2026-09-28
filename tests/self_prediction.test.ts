import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import { MovementWireGlue } from '../src/game/movement_wire_glue';
import { createClientPlayerMotionDeps } from '../src/render/client_player_motion';
import { MovementPredictionPipeline, type SelfPredictionWire } from '../src/render/self_prediction';
import {
  copyMotionState,
  type MotionState,
  type PredictionRing,
  SELF_PREDICTION_RING_CAPACITY,
} from '../src/render/self_prediction_core';
import { DELVE_X_MIN } from '../src/sim/data';
import { DELVE_DOOR_AISLE_HALF_DEPTH, type DelveDoorClampSolid } from '../src/sim/delves/geometry';
import { createPlayer } from '../src/sim/entity';
import { stepPlayerMotion } from '../src/sim/player_motion';
import { REALM_RACERS_VEHICLE_KEY } from '../src/sim/social/realm_racers';
import {
  type Aura,
  type Entity,
  emptyMoveInput,
  type MoveInput,
  normAngle,
  type VehicleDrive,
} from '../src/sim/types';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';
import { groundHeight } from '../src/sim/world';
import type { DelveRunInfo } from '../src/world_api/delves';

const SEED = 17;

interface SendRecord {
  frame: InputTickFrame;
  now: number;
  bypassBackpressure: boolean | undefined;
}

class FakeSelfPredictionWire implements SelfPredictionWire {
  movementWireVersion: 1 | 2 = 2;
  onMovementWireNegotiated: ((version: 1 | 2, now: number) => void) | null = null;
  onMovementWireNeutral: ((now: number) => boolean) | null = null;
  reconAuthoritativeX: number | null = 12;
  reconAuthoritativeY: number | null = groundHeight(12, 18, SEED);
  reconAuthoritativeZ: number | null = 18;
  reconAuthoritativeFacing: number | null = 0.25;
  reconAckClientTick = -1;
  reconOverrideEpoch = 0;
  reconOverrideActive = false;
  reconMoveSpeedMult = 1;
  reconDrive?: VehicleDrive | null;
  reconVy?: number;
  reconOnGround?: boolean;
  open = true;
  readonly sends: SendRecord[] = [];
  readonly reconcileOutcomes: Array<'match' | 'replayed' | 'ignore' | 'stale' | 'suspend'> = [];

  netPipeline(): {
    noteReconcileOutcome: (outcome: 'match' | 'replayed' | 'ignore' | 'stale' | 'suspend') => void;
  } {
    return { noteReconcileOutcome: (outcome) => this.reconcileOutcomes.push(outcome) };
  }

  movementWireIsOpen(): boolean {
    return this.open;
  }

  sendMovementFrame(frame: InputTickFrame, now: number, bypassBackpressure?: boolean): boolean {
    this.sends.push({ frame, now, bypassBackpressure });
    return true;
  }
}

function predictionFixture(): {
  pipeline: MovementPredictionPipeline;
  wire: FakeSelfPredictionWire;
} {
  const wire = new FakeSelfPredictionWire();
  const self = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Tester');
  const pipeline = new MovementPredictionPipeline(SEED);
  pipeline.connect(wire, 0);
  pipeline.prepare(wire, self, true);
  return { pipeline, wire };
}

type PredictionFrameDriver = {
  predictFrame(frame: InputTickFrame): void;
};

function drivePredictionFrame(
  pipeline: MovementPredictionPipeline,
  ct: number,
  mi: MoveInput = emptyMoveInput(),
): void {
  (pipeline as unknown as PredictionFrameDriver).predictFrame({ ct, mi, facing: null });
}

function setAuthoritativePose(
  wire: FakeSelfPredictionWire,
  x: number,
  z: number,
  facing: number,
): { x: number; y: number; z: number } {
  const y = groundHeight(x, z, SEED);
  wire.reconAuthoritativeX = x;
  wire.reconAuthoritativeY = y;
  wire.reconAuthoritativeZ = z;
  wire.reconAuthoritativeFacing = facing;
  return { x, y, z };
}

describe('MovementPredictionPipeline', () => {
  it('canPredict closed by an active override clears the prior prediction', () => {
    const { pipeline, wire } = predictionFixture();
    drivePredictionFrame(pipeline, 10);
    expect(pipeline.display()).not.toBeNull();

    wire.reconOverrideActive = true;
    expect(pipeline.display()).toBeNull();

    wire.reconOverrideActive = false;
    expect(pipeline.display()).toBeNull();
  });

  it('override epoch change suspends an active prediction', () => {
    const { pipeline, wire } = predictionFixture();
    drivePredictionFrame(pipeline, 10);
    expect(pipeline.display()).not.toBeNull();

    wire.reconOverrideEpoch = 1;
    expect(pipeline.display()).toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['suspend']);
    const authoritative = setAuthoritativePose(wire, 20, 28, 1.25);
    drivePredictionFrame(pipeline, 11);
    expect(pipeline.display()?.position).toEqual(authoritative);
  });

  it('adopts the first own epoch after a spectate-shaped pose gap without suspending', () => {
    const { pipeline, wire } = predictionFixture();
    drivePredictionFrame(pipeline, 10);
    expect(pipeline.display()).not.toBeNull();

    wire.reconAuthoritativeX = null;
    wire.reconAuthoritativeY = null;
    wire.reconAuthoritativeZ = null;
    wire.reconAuthoritativeFacing = null;
    wire.reconOverrideEpoch = 0;
    expect(pipeline.display()).toBeNull();

    setAuthoritativePose(wire, 20, 28, 1.25);
    wire.reconOverrideEpoch = 5;
    drivePredictionFrame(pipeline, 11);

    expect(pipeline.display()).not.toBeNull();
    expect(wire.reconcileOutcomes).toEqual([]);
  });

  it('acknowledgement older than a fresh ring anchor is ignored', () => {
    const { pipeline, wire } = predictionFixture();
    drivePredictionFrame(pipeline, 71);
    drivePredictionFrame(pipeline, 72);
    const beforeAcknowledgement = pipeline.display();

    wire.reconAckClientTick = 68;
    expect(pipeline.display()).toEqual(beforeAcknowledgement);
    expect(wire.reconcileOutcomes).toEqual(['ignore']);
  });

  it('acknowledgement rolled past the retained ring tail suspends', () => {
    const { pipeline, wire } = predictionFixture();
    for (let ct = 0; ct <= SELF_PREDICTION_RING_CAPACITY; ct++) {
      drivePredictionFrame(pipeline, ct);
    }
    expect(pipeline.display()).not.toBeNull();

    wire.reconAckClientTick = 0;
    expect(pipeline.display()).toBeNull();
    expect(pipeline.display()).toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['stale']);
  });

  it('records exact matches and correction replays from the live pipeline', () => {
    const exact = predictionFixture();
    drivePredictionFrame(exact.pipeline, 0);
    exact.pipeline.display();
    exact.wire.reconAckClientTick = 0;
    exact.pipeline.display();
    expect(exact.wire.reconcileOutcomes).toEqual(['match']);

    const corrected = predictionFixture();
    drivePredictionFrame(corrected.pipeline, 0, { ...emptyMoveInput(), forward: true });
    corrected.pipeline.display();
    corrected.wire.reconAckClientTick = 0;
    corrected.pipeline.display();
    expect(corrected.wire.reconcileOutcomes).toEqual(['replayed']);
  });

  it('resume plus a subsequent predicted frame re-anchors after suspension', () => {
    const { pipeline, wire } = predictionFixture();
    pipeline.advance(wire, 0.05, emptyMoveInput(), null, 50);
    expect(pipeline.display()).not.toBeNull();

    wire.reconOverrideActive = true;
    expect(pipeline.display()).toBeNull();
    expect(wire.onMovementWireNeutral?.(50)).toBe(true);
    const authoritative = setAuthoritativePose(wire, 24, 30, 1.5);
    wire.reconOverrideActive = false;

    pipeline.advance(wire, 0.05, emptyMoveInput(), null, 100);
    expect(pipeline.display()).toBeNull();
    pipeline.resume();
    pipeline.advance(wire, 0.05, emptyMoveInput(), null, 100);
    expect(pipeline.display()?.position).toEqual(authoritative);
  });

  it('client tick regression resets and re-anchors at the current wire pose', () => {
    const { pipeline, wire } = predictionFixture();
    drivePredictionFrame(pipeline, 10);
    expect(pipeline.display()).not.toBeNull();

    const authoritative = setAuthoritativePose(wire, 32, 36, 2.25);
    drivePredictionFrame(pipeline, 9);

    expect(pipeline.display()?.position).toEqual(authoritative);
  });

  // Issue #3480 (enable self-motion prediction inside delves): prepare()'s
  // delveRun/delveSolids parameters must reach the deps.resolveMove closure
  // createClientPlayerMotionDeps builds (the geometry itself is proven
  // separately: tests/delve_geometry.test.ts for the pure clamp + the
  // server/client derivation parity, tests/player_motion.test.ts for the same
  // clamp chain run tick-for-tick against a live Sim). The synthetic door
  // sits well short of this module's own real wall, so only the door clamp
  // this test targets can be what stops the approach.
  // The player really must sit at a real delve-band x: stepPlayerMotion only
  // routes through deps.resolveMove at all inside isInstancedRegion(x)
  // (src/sim/player_motion.ts), which delve x-coordinates satisfy and an
  // arbitrary open-world x (the other fixtures in this file all use x near 0)
  // does not, so a wrong x here would run the open-world physics solver and
  // pass vacuously with the clamp never invoked.
  it('threads delveRun/delveSolids from prepare() into the predicted kernel step', () => {
    const wire = new FakeSelfPredictionWire();
    wire.reconAuthoritativeX = DELVE_X_MIN;
    wire.reconAuthoritativeY = groundHeight(DELVE_X_MIN, 0, SEED);
    wire.reconAuthoritativeZ = 0;
    wire.reconAuthoritativeFacing = 0; // face +z, straight at the door
    const self = createPlayer(1, 'warrior', { x: DELVE_X_MIN, y: 0, z: 0 }, 'Tester');
    const pipeline = new MovementPredictionPipeline(SEED);
    pipeline.connect(wire, 0);
    const delveRun: DelveRunInfo = {
      delveId: 'test_delve',
      tierId: 'normal',
      slot: 0,
      origin: { x: DELVE_X_MIN, z: 0 },
      moduleIndex: 0,
      moduleCount: 1,
      // A real module id (its own real wall bounds apply too, well clear of
      // the synthetic door below): resolveMovement's swept sub-steps build
      // real colliders from DELVE_MODULE_LAYOUTS[moduleId], which crashes on
      // an id with no matching layout.
      modules: ['reliquary_sunken_ossuary'],
      objective: { kind: 'kill_boss', counts: [0], complete: false },
      affixes: [],
      completed: false,
      exitPortalOpen: false,
      bountiful: false,
      rite: null,
    };
    const doorZ = 10;
    const solids: DelveDoorClampSolid[] = [
      { kind: 'locked_door', x: DELVE_X_MIN, z: doorZ, hp: 1 },
    ];
    pipeline.prepare(wire, self, true, { delveRun, delveSolids: solids });

    for (let ct = 0; ct < 80; ct++) {
      drivePredictionFrame(pipeline, ct, { ...emptyMoveInput(), forward: true });
    }
    const predictedZ = (pipeline as unknown as { predicted: { pos: { z: number } } }).predicted.pos
      .z;
    const blockedFace = doorZ - DELVE_DOOR_AISLE_HALF_DEPTH - 0.5; // PLAYER_BODY_RADIUS
    // Blocked well short of the door (80 forward frames at run speed would
    // otherwise cover far more than doorZ if the clamp never ran).
    expect(predictedZ).toBeLessThan(blockedFace + 0.5);
    expect(predictedZ).toBeGreaterThan(0); // and not vacuously stuck at the start either
  });
});

describe('MovementPredictionPipeline for a seated driver', () => {
  function driverFixture() {
    const wire = new FakeSelfPredictionWire();
    const self = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Tester');
    self.drive = createVehicleDrive('rally_loaner');
    const pipeline = new MovementPredictionPipeline(SEED);
    pipeline.connect(wire, 0);
    pipeline.prepare(wire, self, true);
    return { pipeline, wire, self };
  }

  function ringHead(pipeline: MovementPredictionPipeline): unknown {
    return (pipeline as unknown as { ring: { head: unknown } }).ring.head;
  }

  it('stands down while the wire carries no drive recon', () => {
    const { pipeline, wire } = driverFixture();
    drivePredictionFrame(pipeline, 10, { ...emptyMoveInput(), forward: true });
    expect(ringHead(pipeline)).toBeNull();
    expect(pipeline.display()).toBeNull();

    // The epoch thrashes under a kart and the acknowledgements keep coming:
    // nothing is predicted, so nothing is suspended or reconciled.
    for (let epoch = 1; epoch <= 4; epoch++) {
      wire.reconOverrideEpoch = epoch;
      wire.reconAckClientTick = 10 + epoch;
      drivePredictionFrame(pipeline, 10 + epoch, { ...emptyMoveInput(), forward: true });
      expect(ringHead(pipeline)).toBeNull();
      expect(pipeline.display()).toBeNull();
    }
    expect(wire.reconcileOutcomes).toEqual([]);
  });

  it('resumes from the recon pose after the unseat with zero suspends', () => {
    const { pipeline, wire, self } = driverFixture();
    wire.reconOverrideEpoch = 3;
    drivePredictionFrame(pipeline, 10);
    expect(pipeline.display()).toBeNull();

    // The snapshot that unseats the pilot also carries the teleport home: a
    // new pose, a bumped epoch and a new acknowledgement, all at once.
    self.drive = null;
    const home = setAuthoritativePose(wire, 40, 44, 0.5);
    wire.reconOverrideEpoch = 4;
    wire.reconAckClientTick = 10;
    drivePredictionFrame(pipeline, 11);
    expect(pipeline.display()?.position).toEqual(home);
    expect(wire.reconcileOutcomes).toEqual([]);

    // ...and the resumed prediction reconciles normally from there on.
    wire.reconAckClientTick = 11;
    expect(pipeline.display()?.position).toEqual(home);
    expect(wire.reconcileOutcomes).toEqual(['match']);
  });

  it('resumes without a suspend when the unseat lands between sampled frames', () => {
    const { pipeline, wire, self } = driverFixture();
    wire.reconOverrideEpoch = 3;
    expect(pipeline.display()).toBeNull();

    self.drive = null;
    const home = setAuthoritativePose(wire, 40, 44, 0.5);
    wire.reconOverrideEpoch = 4;
    wire.reconAckClientTick = 10;
    expect(pipeline.display()).toBeNull();
    drivePredictionFrame(pipeline, 11);
    expect(pipeline.display()?.position).toEqual(home);
    expect(wire.reconcileOutcomes).toEqual([]);
  });

  it('adopts the unseat state in the predicted frame, then suspends on a later bump', () => {
    const { pipeline, wire, self } = driverFixture();
    wire.reconOverrideEpoch = 3;
    expect(pipeline.display()).toBeNull();

    self.drive = null;
    setAuthoritativePose(wire, 40, 44, 0.5);
    wire.reconOverrideEpoch = 4;
    wire.reconAckClientTick = 10;
    drivePredictionFrame(pipeline, 11);
    // A bump after the resumed prediction started is a real one.
    wire.reconOverrideEpoch = 5;
    expect(pipeline.display()).toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['suspend']);
  });

  it('forgets a pending driver stand-down on reset', () => {
    const { pipeline, wire, self } = driverFixture();
    expect(pipeline.display()).toBeNull();
    self.drive = null;
    pipeline.reset();
    wire.reconAckClientTick = 10;
    drivePredictionFrame(pipeline, 20);
    pipeline.display();
    // What the pipeline recorded before driver stand-downs existed: a reset
    // pipeline reconciles the first acknowledgement it sees, and one older
    // than its fresh ring is ignored.
    expect(wire.reconcileOutcomes).toEqual(['ignore']);
  });

  it('arms the stand-down re-seed while a malformed row holds the last good machine', () => {
    const { pipeline, wire, self } = driverFixture();
    pipeline.predictDrivers = true;
    // What a malformed `rdv` leaves: the mirror still seated on the held
    // machine, no drive recon, and the override flag standing the client down.
    wire.reconDrive = null;
    wire.reconOverrideActive = true;
    expect(self.drive).not.toBeNull();
    expect(pipeline.display()).toBeNull();
    expect(
      (pipeline as unknown as { reseedAfterDriverStandDown: boolean }).reseedAfterDriverStandDown,
    ).toBe(true);
  });

  it('keeps a driver standing down on a drive recon while driver prediction is off', () => {
    const { pipeline, wire } = driverFixture();
    expect(pipeline.predictDrivers).toBe(false);
    wire.reconDrive = createVehicleDrive('rally_loaner');
    for (let epoch = 1; epoch <= 3; epoch++) {
      wire.reconOverrideEpoch = epoch;
      wire.reconAckClientTick = 10 + epoch;
      drivePredictionFrame(pipeline, 10 + epoch, { ...emptyMoveInput(), forward: true });
      expect(ringHead(pipeline)).toBeNull();
      expect(pipeline.display()).toBeNull();
    }
    expect(wire.reconcileOutcomes).toEqual([]);
  });

  it('re-seeds once the drive recon arrives while still seated', () => {
    const { pipeline, wire, self } = driverFixture();
    pipeline.predictDrivers = true;
    self.drive = null;
    drivePredictionFrame(pipeline, 5);
    expect(pipeline.display()).not.toBeNull();
    self.drive = createVehicleDrive('rally_loaner');
    wire.reconOverrideEpoch = 3;
    expect(pipeline.display()).toBeNull();

    wire.reconDrive = createVehicleDrive('rally_loaner');
    drivePredictionFrame(pipeline, 11);
    expect(pipeline.display()).not.toBeNull();
    expect(wire.reconcileOutcomes).toEqual([]);
  });

  it('predicts a driver once the wire carries a drive recon', () => {
    const { pipeline, wire } = driverFixture();
    pipeline.predictDrivers = true;
    wire.reconDrive = createVehicleDrive('rally_loaner');
    drivePredictionFrame(pipeline, 10);
    expect(ringHead(pipeline)).not.toBeNull();
    expect(pipeline.display()).not.toBeNull();
  });
});

describe('MovementPredictionPipeline predicting a seated driver', () => {
  const THROTTLE: MoveInput = { ...emptyMoveInput(), forward: true };

  interface Internals {
    predicted: MotionState | null;
    ring: PredictionRing;
  }

  function internals(pipeline: MovementPredictionPipeline): Internals {
    return pipeline as unknown as Internals;
  }

  function seatedDriver(drive: Partial<VehicleDrive> = {}) {
    const wire = new FakeSelfPredictionWire();
    const self = createPlayer(1, 'warrior', { x: 0, y: 0, z: 0 }, 'Tester');
    self.drive = createVehicleDrive(REALM_RACERS_VEHICLE_KEY);
    wire.reconDrive = { ...createVehicleDrive(REALM_RACERS_VEHICLE_KEY), ...drive };
    wire.reconVy = 0;
    wire.reconOnGround = true;
    const pipeline = new MovementPredictionPipeline(SEED);
    pipeline.predictDrivers = true;
    pipeline.connect(wire, 0);
    pipeline.prepare(wire, self, true);
    return { pipeline, wire, self };
  }

  /** The server's kart, seeded from the same recon the pipeline seeds from. */
  function serverTwin(wire: FakeSelfPredictionWire): MotionState {
    const x = wire.reconAuthoritativeX as number;
    const y = wire.reconAuthoritativeY as number;
    const z = wire.reconAuthoritativeZ as number;
    const twin = copyMotionState({
      ...createPlayer(1, 'warrior', { x, y, z }, 'Tester'),
      pos: { x, y, z },
      prevPos: { x, y, z },
      facing: wire.reconAuthoritativeFacing as number,
      vy: wire.reconVy ?? 0,
      onGround: wire.reconOnGround ?? true,
      fallStartY: y,
    } as MotionState);
    twin.drive = { ...(wire.reconDrive as VehicleDrive) };
    return twin;
  }

  function slowAura(): Aura {
    return {
      id: 'probe_slow',
      name: 'probe_slow',
      kind: 'slow',
      remaining: 60,
      duration: 60,
      value: 0.5,
      sourceId: 9,
      school: 'physical',
    };
  }

  const twinDeps = createClientPlayerMotionDeps(SEED);

  function stepTwin(twin: MotionState, mi: MoveInput): void {
    twin.prevPos = { ...twin.pos };
    stepPlayerMotion(twinDeps, twin as Entity, mi);
  }

  function acknowledge(wire: FakeSelfPredictionWire, twin: MotionState, ct: number): void {
    wire.reconAuthoritativeX = twin.pos.x;
    wire.reconAuthoritativeY = twin.pos.y;
    wire.reconAuthoritativeZ = twin.pos.z;
    wire.reconAuthoritativeFacing = twin.facing;
    wire.reconDrive = twin.drive ? { ...twin.drive } : null;
    wire.reconVy = twin.vy;
    wire.reconOnGround = twin.onGround;
    wire.reconAckClientTick = ct;
  }

  it('seeds the kart from the drive recon and matches an exact server twin', () => {
    const { pipeline, wire } = seatedDriver({ speed: 12 });
    const twin = serverTwin(wire);
    const seeded = wire.reconDrive;
    for (let ct = 0; ct < 6; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    const head = internals(pipeline).predicted as MotionState;
    expect(head.drive?.profileKey).toBe(REALM_RACERS_VEHICLE_KEY);
    expect(head.drive?.speed).toBeGreaterThan(12);
    // the recon is copied, never stepped in place
    expect(wire.reconDrive).toBe(seeded);
    expect(wire.reconDrive?.speed).toBe(12);

    for (let ct = 0; ct < 3; ct++) stepTwin(twin, THROTTLE);
    acknowledge(wire, twin, 2);
    expect(pipeline.display()).not.toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['match']);
  });

  it('re-seeds an airborne kart from the recon vertical state and heading', () => {
    const { pipeline, wire } = seatedDriver({ speed: 18, yawRate: 1.2 });
    wire.reconAuthoritativeY = (wire.reconAuthoritativeY as number) + 4;
    wire.reconVy = -3;
    wire.reconOnGround = false;
    const seededFacing = wire.reconAuthoritativeFacing;
    const twin = serverTwin(wire);
    stepTwin(twin, THROTTLE);
    drivePredictionFrame(pipeline, 0, THROTTLE);
    const head = internals(pipeline).predicted as MotionState;
    expect(twin.onGround).toBe(false);
    expect(head.vy).toBe(twin.vy);
    expect(head.onGround).toBe(twin.onGround);
    // the heading the tick started from, for the display's yaw lerp
    expect(head.prevFacing).toBe(seededFacing);
    expect(head.facing).toBe(twin.facing);
    expect(head.facing).not.toBe(seededFacing);
    acknowledge(wire, twin, 0);
    pipeline.display();
    expect(wire.reconcileOutcomes).toEqual(['match']);
  });

  it('reports the displayed client tick over the ack while driving, and null on foot', () => {
    const { pipeline, wire, self } = seatedDriver({ speed: 12 });
    const twin = serverTwin(wire);
    for (let ct = 0; ct < 6; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    expect(pipeline.display()?.tickOffset).toBeNull();
    for (let ct = 0; ct < 3; ct++) stepTwin(twin, THROTTLE);
    acknowledge(wire, twin, 2);
    expect(pipeline.display()?.tickOffset).toBe(3);
    drivePredictionFrame(pipeline, 6, THROTTLE);
    expect(pipeline.display()?.tickOffset).toBe(4);

    // back on foot the output carries no offset
    self.drive = null;
    setAuthoritativePose(wire, 30, 26, 0.75);
    wire.reconDrive = null;
    wire.reconOverrideEpoch = 1;
    wire.reconAckClientTick = 5;
    pipeline.display();
    drivePredictionFrame(pipeline, 7);
    wire.reconAckClientTick = 6;
    const onFoot = pipeline.display();
    expect(onFoot).not.toBeNull();
    expect(onFoot?.tickOffset).toBeNull();

    const runner = predictionFixture();
    drivePredictionFrame(runner.pipeline, 0);
    drivePredictionFrame(runner.pipeline, 1);
    runner.wire.reconAckClientTick = 0;
    expect(runner.pipeline.display()?.tickOffset).toBeNull();
  });

  it('hands the display the predicted kart at the interpolation alpha, and none on foot', () => {
    const { pipeline, wire, self } = seatedDriver({ speed: 18, yawRate: 1.2, handbrake: 0.3 });
    for (let ct = 0; ct < 4; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    const head = internals(pipeline).predicted as MotionState;
    const drive = head.drive as VehicleDrive;
    const alpha = 0.35;
    const glue = (pipeline as unknown as { wireGlue: object }).wireGlue;
    Object.defineProperty(glue, 'interpolationAlpha', { value: alpha });
    const turn = normAngle(head.facing - (head.prevFacing as number));
    expect(turn).not.toBe(0);
    const shown = pipeline.display()?.drive;
    expect(shown?.facing).toBeCloseTo(normAngle((head.prevFacing as number) + turn * alpha), 12);
    expect(shown?.velocityX).toBe(vehicleVelocityX(drive, head.facing));
    expect(shown?.velocityZ).toBe(vehicleVelocityZ(drive, head.facing));
    expect(shown?.vy).toBe(head.vy);
    expect(shown?.onGround).toBe(head.onGround);
    expect(shown?.handbrake).toBe(drive.handbrake);
    expect(shown?.collisionImpact).toBe(drive.collisionImpact);

    // stood down (driver prediction off), the display hands over no kart
    pipeline.predictDrivers = false;
    expect(pipeline.display()).toBeNull();
    pipeline.predictDrivers = true;

    self.drive = null;
    setAuthoritativePose(wire, 30, 26, 0.75);
    wire.reconDrive = null;
    wire.reconOverrideEpoch = 1;
    wire.reconAckClientTick = 5;
    pipeline.display();
    drivePredictionFrame(pipeline, 7);
    wire.reconAckClientTick = 6;
    const onFoot = pipeline.display();
    expect(onFoot).not.toBeNull();
    expect(onFoot?.drive).toBeNull();
  });

  it('adopts a shoved drive with the snapshot auras and replays to an exact match', () => {
    const { pipeline, wire, self } = seatedDriver({ speed: 12 });
    const twin = serverTwin(wire);
    for (let ct = 0; ct < 8; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    const headBefore = copyMotionState(internals(pipeline).predicted as MotionState);

    for (let ct = 0; ct < 4; ct++) stepTwin(twin, THROTTLE);
    // a contact after tick 3: speed and spin the client never saw coming
    (twin.drive as VehicleDrive).speed += 6;
    (twin.drive as VehicleDrive).spin = 1.5;
    const slow = slowAura();
    self.auras = [slow];
    acknowledge(wire, twin, 3);
    const shown = pipeline.display();
    expect(wire.reconcileOutcomes).toEqual(['replayed']);
    expect(shown?.residual).not.toBeNull();
    expect(shown?.residual).toHaveProperty('yaw');
    const head = internals(pipeline).predicted as MotionState;
    expect(head.drive?.speed).not.toBe(headBefore.drive?.speed);
    expect(head.facing).not.toBe(headBefore.facing);
    expect(internals(pipeline).ring.head?.pose.auras.map((a) => a.id)).toEqual(['probe_slow']);

    // the server keeps the aura; the replayed kart is its exact twin
    twin.auras = [slow];
    stepTwin(twin, THROTTLE);
    acknowledge(wire, twin, 4);
    pipeline.display();
    expect(wire.reconcileOutcomes).toEqual(['replayed', 'match']);
  });

  it('borrows the newest mirrored auras on every predicted frame', () => {
    const { pipeline, self } = seatedDriver({ speed: 12 });
    self.auras = [];
    drivePredictionFrame(pipeline, 0, THROTTLE);
    expect(internals(pipeline).ring.head?.pose.auras).toEqual([]);
    self.auras = [slowAura()];
    drivePredictionFrame(pipeline, 1, THROTTLE);
    expect(internals(pipeline).ring.head?.pose.auras.map((a) => a.id)).toEqual(['probe_slow']);
  });

  it('returns to a runner at race end with no spin carried, on a replay', () => {
    const { pipeline, wire, self } = seatedDriver({ speed: 20, spin: 2, yawRate: 1 });
    self.auras = [slowAura()];
    for (let ct = 0; ct < 6; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    const kart = internals(pipeline).predicted as MotionState;
    expect(kart.drive).toBeTruthy();
    expect(kart.facing).not.toBe(wire.reconAuthoritativeFacing);

    // the race takes the wheel without a bump: the snapshot drops the drive
    // and the race's slow with it
    self.drive = null;
    self.auras = [];
    const home = setAuthoritativePose(wire, 30, 26, 0.75);
    wire.reconDrive = null;
    wire.reconVy = 0;
    wire.reconOnGround = true;
    wire.reconAckClientTick = 2;
    pipeline.display();
    expect(wire.reconcileOutcomes).toEqual(['replayed']);
    const head = internals(pipeline).predicted as MotionState;
    expect(head.drive).toBeNull();
    expect(head).not.toHaveProperty('prevFacing');
    expect(head.vy).toBe(0);
    expect(head.onGround).toBe(true);
    expect(internals(pipeline).ring.head?.pose.auras).toEqual([]);
    // the replayed throttle frames ran on foot, off the acked pose and heading
    expect(head.facing).toBe(0.75);
    expect(head.pos).not.toEqual(home);

    for (let ct = 6; ct < 12; ct++) drivePredictionFrame(pipeline, ct);
    const settled = copyMotionState(internals(pipeline).predicted as MotionState);
    for (let ct = 12; ct < 18; ct++) drivePredictionFrame(pipeline, ct);
    const after = internals(pipeline).predicted as MotionState;
    expect(after.facing).toBe(0.75);
    expect(after.pos).toEqual(settled.pos);
  });

  it('suspends on the race-end teleport and re-seeds a runner', () => {
    const { pipeline, wire, self } = seatedDriver({ speed: 20, spin: 2 });
    for (let ct = 0; ct < 4; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
    expect(pipeline.display()).not.toBeNull();

    self.drive = null;
    const home = setAuthoritativePose(wire, 30, 26, 0.75);
    wire.reconDrive = null;
    wire.reconOverrideEpoch = 1;
    wire.reconAckClientTick = 2;
    expect(pipeline.display()).toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['suspend']);

    for (let ct = 4; ct < 8; ct++) drivePredictionFrame(pipeline, ct);
    const runner = internals(pipeline).predicted as MotionState;
    expect(runner).not.toHaveProperty('drive');
    expect(runner.facing).toBe(0.75);
    expect(pipeline.display()?.position).toEqual(home);
  });

  it('keeps the override stand-down: nothing predicted under ovA, one suspend at its end', () => {
    const { pipeline, wire } = seatedDriver();
    drivePredictionFrame(pipeline, 0, THROTTLE);
    expect(pipeline.display()).not.toBeNull();

    wire.reconOverrideActive = true;
    wire.reconOverrideEpoch = 1;
    for (let ct = 1; ct < 5; ct++) {
      wire.reconAckClientTick = ct - 1;
      expect(pipeline.display()).toBeNull();
      drivePredictionFrame(pipeline, ct, THROTTLE);
      expect(internals(pipeline).ring.head).toBeNull();
    }
    expect(wire.reconcileOutcomes).toEqual([]);

    // the lock ends with its own bump
    wire.reconOverrideActive = false;
    wire.reconOverrideEpoch = 2;
    expect(pipeline.display()).toBeNull();
    expect(wire.reconcileOutcomes).toEqual(['suspend']);
    drivePredictionFrame(pipeline, 5, THROTTLE);
    expect(internals(pipeline).predicted?.drive).toBeTruthy();
    expect(pipeline.display()).not.toBeNull();
  });

  it('hands a runner acknowledgement no drive, vertical state or auras', () => {
    function correctedRunner(noise: boolean): MotionState {
      const { pipeline, wire } = predictionFixture();
      pipeline.predictDrivers = true;
      if (noise) {
        wire.reconVy = 5;
        wire.reconOnGround = false;
      }
      for (let ct = 0; ct < 4; ct++) drivePredictionFrame(pipeline, ct, THROTTLE);
      pipeline.display();
      wire.reconAckClientTick = 0;
      pipeline.display();
      expect(wire.reconcileOutcomes).toEqual(['replayed']);
      return internals(pipeline).predicted as MotionState;
    }
    const head = correctedRunner(true);
    expect(head).not.toHaveProperty('drive');
    expect(head).toEqual(correctedRunner(false));
  });

  it('is never switched on by main.ts', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/new MovementPredictionPipeline/);
    expect(main).not.toMatch(/predictDrivers|drivepredict/);
  });
});

describe('MovementWireGlue.resume', () => {
  it('emits frames again after a neutral frame pauses the glue', () => {
    const wire = new FakeSelfPredictionWire();
    const glue = new MovementWireGlue();
    const moving = { ...emptyMoveInput(), forward: true };
    glue.connect(wire, 0);

    expect(glue.emitNeutralFrame(wire, 25)).toBe(true);
    glue.advance(wire, 0.075, moving, 0.5, 100);
    expect(wire.sends).toEqual([
      {
        frame: { ct: 0, mi: emptyMoveInput(), facing: null },
        now: 25,
        bypassBackpressure: true,
      },
    ]);

    glue.resume();
    glue.advance(wire, 0.075, moving, 0.5, 100);

    expect(wire.sends).toEqual([
      {
        frame: { ct: 0, mi: emptyMoveInput(), facing: null },
        now: 25,
        bypassBackpressure: true,
      },
      {
        frame: { ct: 1, mi: moving, facing: 0.5 },
        now: 100,
        bypassBackpressure: undefined,
      },
    ]);
  });
});
