import { describe, expect, it } from 'vitest';
import type { InputTickFrame } from '../src/game/input_tick_sampler';
import { MovementWireGlue } from '../src/game/movement_wire_glue';
import { MovementPredictionPipeline, type SelfPredictionWire } from '../src/render/self_prediction';
import { SELF_PREDICTION_RING_CAPACITY } from '../src/render/self_prediction_core';
import { DELVE_X_MIN } from '../src/sim/data';
import { DELVE_DOOR_AISLE_HALF_DEPTH, type DelveDoorClampSolid } from '../src/sim/delves/geometry';
import { createPlayer } from '../src/sim/entity';
import { emptyMoveInput, type MoveInput, type VehicleDrive } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
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

  it('re-seeds once the drive recon arrives while still seated', () => {
    const { pipeline, wire, self } = driverFixture();
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
    wire.reconDrive = createVehicleDrive('rally_loaner');
    drivePredictionFrame(pipeline, 10);
    expect(ringHead(pipeline)).not.toBeNull();
    expect(pipeline.display()).not.toBeNull();
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
