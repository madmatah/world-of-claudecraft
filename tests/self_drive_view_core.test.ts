import { describe, expect, it } from 'vitest';
import {
  createSelfDriveView,
  driveViewFromMirror,
  driveViewFromReconciled,
  fillReconciledDrive,
  type PredictedDriveHead,
  type ReconciledDrive,
  SELF_YAW_SNAP_RAD,
} from '../src/render/self_drive_view_core';
import {
  displaySpeedBudget,
  SELF_MOTION_SNAP_DIST_SQ,
  type SelfMotionFrame,
  updateSelfRenderFallback,
  type Vec3Like,
} from '../src/render/self_motion';
import {
  createSelfRenderPositionState,
  MAX_SELF_REWIND_YD_PER_SEC,
  type ReconciledSelfPrediction,
  type SelfRenderPositionState,
  selfPredictionLeadMs,
  selfRewindCapYdPerSec,
  teleportGapLimitSq,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { Sim } from '../src/sim/sim';
import {
  type Entity,
  emptyMoveInput,
  type MoveInput,
  RUN_SPEED,
  type VehicleDrive,
} from '../src/sim/types';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';
import { terrainHeight } from '../src/sim/world';
import { EMPTY_TEST_WORLD } from './sim_shared';

const SEED = 42;
const FRAME_DT = 1 / 60;
const HANDOFF_RATE = 15;
const PROFILE = 'rally_loaner';

const kartDrive = (over: Partial<VehicleDrive> = {}): VehicleDrive => ({
  ...createVehicleDrive(PROFILE),
  speed: 31,
  slip: 2.5,
  yawRate: 0.8,
  handbrake: 0.4,
  collisionImpact: 7,
  ...over,
});

const v1Frame = (
  moveInput: MoveInput = { ...emptyMoveInput(), forward: true },
): SelfMotionFrame => ({
  enabled: true,
  moveInput,
  displayFacing: 0,
  echoMs: 80,
  jitterMs: 10,
  alpha: 0.5,
  frameDt: FRAME_DT,
  snapAgeMs: 25,
  snapIntervalMs: 50,
  riftFloor: null,
  delveRun: null,
  delveSolids: [],
});

function seated(at: Vec3Like, drive: VehicleDrive | null = kartDrive()): Entity {
  return {
    prevPos: { ...at },
    pos: { ...at },
    prevFacing: 0.2,
    facing: 0.5,
    vy: 0,
    onGround: true,
    auras: [],
    ghost: false,
    drive,
  } as unknown as Entity;
}

function reconciled(
  position: Vec3Like,
  drive: ReconciledDrive | null,
  residual: ReconciledSelfPrediction['residual'] = null,
): ReconciledSelfPrediction {
  return { kind: 'reconciled', position: { ...position }, residual, drive };
}

function headDrive(head: PredictedDriveHead, alpha: number): ReconciledDrive {
  const out = {} as ReconciledDrive;
  return fillReconciledDrive(out, head, alpha) as ReconciledDrive;
}

/** A seated pilot on open, collider-free ground, as a snapshot mirrors it. */
function seatedMirror(): { sim: Sim; mirror: Entity } {
  const sim = new Sim({
    seed: SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: EMPTY_TEST_WORLD,
  });
  const p = sim.player;
  p.pos = { x: 0, y: terrainHeight(0, -1000, sim.cfg.seed), z: -1000 };
  p.prevPos = { ...p.pos };
  p.fallStartY = p.pos.y;
  p.facing = 0.3;
  p.prevFacing = 0.3;
  p.mountKey = 'tank';
  p.drive = { ...createVehicleDrive('tank'), speed: 14 };
  const mirror = { ...p, pos: { ...p.pos }, prevPos: { ...p.prevPos }, drive: { ...p.drive } };
  return { sim, mirror };
}

describe('the self drive view on both wires', () => {
  const at = { x: 10, y: 3, z: -4 };
  const head: PredictedDriveHead = {
    drive: kartDrive(),
    prevFacing: 0.9,
    facing: 1.05,
    onGround: false,
  };

  it('draws a wire v1 driver from the interpolated mirror, like a stood-down v2 driver', () => {
    const { mirror } = seatedMirror();
    const v1 = createSelfRenderPositionState();
    const stoodDown = createSelfRenderPositionState();
    const steer: MoveInput = { ...emptyMoveInput(), forward: true, turnLeft: true };
    for (let frame = 0; frame < 20; frame++) {
      updateSelfRenderPosition(v1, mirror, SEED, 0.5, FRAME_DT, 0.2, v1Frame(steer), false);
      updateSelfRenderPosition(stoodDown, mirror, SEED, 0.5, FRAME_DT, 0.2, null, false);
      expect(v1.position).toEqual(stoodDown.position);
    }
    // the v1 predictor never adopts the seat: nothing predicts the kart
    expect(v1.active).toBe(false);
    expect(selfPredictionLeadMs(v1)).toBeNull();
    expect(v1.drive.source).toBe('mirror');
    expect(v1.drive.steersHeading).toBe(false);
    expect(v1.drive.facing).toBeCloseTo(0.3, 12);
    // the kernel ground state is the only field the idle predictor fills, and
    // the renderer ignores it while nothing predicts the pose
    expect({ ...v1.drive, kernelOnGround: null }).toEqual(stoodDown.drive);
  });

  it('reads the v2 head at the interpolation alpha', () => {
    const v2 = createSelfRenderPositionState();
    const output = reconciled(at, headDrive(head, 0.4));
    updateSelfRenderPosition(v2, seated(at), SEED, 0.4, FRAME_DT, 0.2, output, false);
    const drive = head.drive as VehicleDrive;
    expect(v2.drive.source).toBe('predicted');
    expect(v2.drive.steersHeading).toBe(true);
    expect(v2.drive.facing).toBeCloseTo(0.9 + 0.15 * 0.4, 12);
    expect(v2.drive.velocityX).toBe(vehicleVelocityX(drive, head.facing));
    expect(v2.drive.velocityZ).toBe(vehicleVelocityZ(drive, head.facing));
    expect(v2.drive.kernelOnGround).toBe(false);
    expect(v2.drive.state).toBe(drive);
    expect(v2.drive.yawOffset).toBe(0);
  });

  it('falls back to the interpolated mirror for a stood-down driver, and says so', () => {
    const p = seated(at, kartDrive({ speed: 20 }));
    const state = createSelfRenderPositionState();
    // a stood-down v2 driver: the pipeline hands the renderer no prediction
    updateSelfRenderPosition(state, p, SEED, 0.5, FRAME_DT, 0.2, null, false);
    const mirror = { ...state.drive };
    expect(mirror.source).toBe('mirror');
    expect(mirror.steersHeading).toBe(false);
    expect(mirror.state).toBe(p.drive);
    expect(mirror.facing).toBeCloseTo(0.35, 12);
    expect(mirror.velocityX).toBe(vehicleVelocityX(p.drive as VehicleDrive, p.facing));
    expect(mirror.velocityZ).toBe(vehicleVelocityZ(p.drive as VehicleDrive, p.facing));
    expect(mirror.kernelOnGround).toBeNull();
    expect(state.active).toBe(false);

    // a prediction that has not adopted the seat yet reads the same mirror
    updateSelfRenderPosition(state, p, SEED, 0.5, FRAME_DT, 0.2, reconciled(at, null), false);
    expect(state.drive).toEqual(mirror);

    // the mirror never extrapolates the heading past the newest snapshot
    driveViewFromMirror(state.drive, p, 1.2, null);
    expect(state.drive.facing).toBeCloseTo(0.5, 12);

    // on foot there is no kart at all
    updateSelfRenderPosition(state, seated(at, null), SEED, 0.5, FRAME_DT, 0.2, null, false);
    expect(state.drive.source).toBe('none');
    expect(state.drive.velocityX).toBe(0);
  });

  it('lerps the predicted heading wrap-aware across the seam', () => {
    const across: PredictedDriveHead = {
      drive: kartDrive(),
      prevFacing: Math.PI - 0.1,
      facing: -Math.PI + 0.1,
      onGround: true,
    };
    expect(Math.abs(headDrive(across, 0.5).facing)).toBeCloseTo(Math.PI, 12);
    expect(headDrive(across, 0.25).facing).toBeCloseTo(Math.PI - 0.05, 12);
    expect(headDrive(across, 0.75).facing).toBeCloseTo(-Math.PI + 0.05, 12);
    expect(headDrive(across, 1).facing).toBeCloseTo(-Math.PI + 0.1, 12);
    expect(fillReconciledDrive({} as ReconciledDrive, { ...across, drive: null }, 0.5)).toBeNull();
  });

  it('glides a replay yaw residual at the handoff rate and snaps it at a teleport gap', () => {
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    const drive = headDrive({ ...head, prevFacing: 0.4, facing: 0.4 }, 1);
    const p = seated(at);
    const state = createSelfRenderPositionState();
    const run = (
      output: ReconciledSelfPrediction,
      discontinuity = false,
    ): SelfRenderPositionState => {
      updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, output, discontinuity);
      return state;
    };
    run(reconciled(at, drive));
    expect(state.drive.facing).toBeCloseTo(0.4, 12);

    run(reconciled(at, drive, { x: 0.2, y: 0, z: 0, yaw: 0.3 }));
    expect(state.drive.yawOffset).toBeCloseTo(0.3 * decay, 12);
    expect(state.drive.facing).toBeCloseTo(0.4 + 0.3 * decay, 12);
    run(reconciled(at, drive));
    expect(state.drive.facing).toBeCloseTo(0.4 + 0.3 * decay * decay, 12);
    for (let i = 0; i < 60; i++) run(reconciled(at, drive));
    expect(state.drive.facing).toBeCloseTo(0.4, 6);

    // a teleport-size residual drops the yaw with the position
    run(reconciled(at, drive, { x: 0.2, y: 0, z: 0, yaw: 0.3 }));
    run(reconciled(at, drive, { x: 600, y: 0, z: 0, yaw: 0.5 }));
    expect(state.drive.yawOffset).toBe(0);
    expect(state.drive.facing).toBe(0.4);

    // an authoritative discontinuity drops it too
    run(reconciled(at, drive, { x: 0.2, y: 0, z: 0, yaw: 0.3 }));
    run(reconciled(at, drive), true);
    expect(state.drive.facing).toBe(0.4);
  });

  it('snaps a re-facing past the named angle instead of gliding it', () => {
    const drive = headDrive({ ...head, prevFacing: 0.4, facing: 0.4 }, 1);
    const p = seated(at);
    const state = createSelfRenderPositionState();
    const run = (residual: ReconciledSelfPrediction['residual']) =>
      updateSelfRenderPosition(
        state,
        p,
        SEED,
        1,
        FRAME_DT,
        0.2,
        reconciled(at, drive, residual),
        false,
      );
    run(null);
    run({ x: 0.1, y: 0, z: 0, yaw: SELF_YAW_SNAP_RAD - 0.05 });
    expect(state.drive.yawOffset).not.toBe(0);
    run({ x: 0.1, y: 0, z: 0, yaw: 0.45 });
    expect(state.drive.yawOffset).toBe(0);
    expect(state.drive.facing).toBe(0.4);
    run({ x: 0.1, y: 0, z: 0, yaw: SELF_YAW_SNAP_RAD + 0.05 });
    expect(state.drive.facing).toBe(0.4);
  });

  it('holds the predicted heading across a suspend and glides it onto the mirror', () => {
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    const p = seated(at);
    const mirrorFacing = 0.5;
    p.prevFacing = mirrorFacing;
    const state = createSelfRenderPositionState();
    const predicted = headDrive({ ...head, prevFacing: 0.9, facing: 0.9 }, 1);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, reconciled(at, predicted), false);
    expect(state.drive.facing).toBe(0.9);

    // the epoch suspends: no prediction this frame, same seat
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.drive.source).toBe('mirror');
    expect(state.drive.steersHeading).toBe(true);
    expect(state.drive.facing).toBeCloseTo(mirrorFacing + 0.4 * decay, 12);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.drive.facing).toBeCloseTo(mirrorFacing + 0.4 * decay * decay, 12);
    // the camera follows the same held heading (selfMotionFacing stays set)
    for (let i = 0; i < 120 && state.drive.steersHeading; i++) {
      updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    }
    expect(state.drive.steersHeading).toBe(false);
    expect(state.drive.yawOffset).toBe(0);
    expect(state.drive.facing).toBeCloseTo(mirrorFacing, 12);

    // a suspend across a teleport drops the heading outright
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, reconciled(at, predicted), false);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, true);
    expect(state.drive.steersHeading).toBe(false);
    expect(state.drive.facing).toBeCloseTo(mirrorFacing, 12);
  });

  it('glides the drawn mirror heading into a resumed prediction on the same seat', () => {
    const decay = Math.exp(-HANDOFF_RATE * FRAME_DT);
    const p = seated(at);
    p.prevFacing = 0.5;
    const state = createSelfRenderPositionState();
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.drive.facing).toBe(0.5);
    const predicted = headDrive({ ...head, prevFacing: 0.8, facing: 0.8 }, 1);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, reconciled(at, predicted), false);
    expect(state.drive.facing).toBeCloseTo(0.8 - 0.3 * decay, 12);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, reconciled(at, predicted), false);
    expect(state.drive.facing).toBeCloseTo(0.8 - 0.3 * decay * decay, 12);

    // resuming across a teleport adopts the prediction outright
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    for (let i = 0; i < 120; i++)
      updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, reconciled(at, predicted), true);
    expect(state.drive.facing).toBe(0.8);
  });

  it('keeps a first predicted frame free of a residual it has no drawn heading for', () => {
    const view = createSelfDriveView();
    const drive = headDrive({ ...head, prevFacing: 0.4, facing: 0.4 }, 1);
    driveViewFromReconciled(view, drive, seated(at), 1, null, 0.3, false, 0.2);
    expect(view.facing).toBe(0.4);
    driveViewFromReconciled(view, drive, seated(at), 1, null, 0.3, false, 0.2);
    expect(view.facing).toBeCloseTo(0.4 + 0.3 * 0.8, 12);
  });
});

describe('the self fallback for a seated driver', () => {
  const HITCH_DT = 0.1;

  it('snaps the plain fallback at the frame teleport limit, widened for a driver', () => {
    const current = { x: 0, y: 0, z: 0 };
    updateSelfRenderFallback(current, 8, 0, 0, true, HITCH_DT, true, false);
    expect(current.x).toBe(8);
    const driverLimit = teleportGapLimitSq(seated({ x: 0, y: 0, z: 0 }), HITCH_DT);
    expect(driverLimit).toBeGreaterThan(64);
    const eased = { x: 0, y: 0, z: 0 };
    updateSelfRenderFallback(eased, 8, 0, 0, true, HITCH_DT, true, false, driverLimit);
    expect(eased.x).toBeGreaterThan(0);
    expect(eased.x).toBeLessThan(8);
  });

  it('eases an 8 yd hitch for a never-predicted driver, and snaps it for a runner', () => {
    for (const [drive, eases] of [
      [kartDrive(), true],
      [null, false],
    ] as const) {
      const state = createSelfRenderPositionState();
      updateSelfRenderPosition(
        state,
        seated({ x: 0, y: 0, z: 0 }, drive),
        SEED,
        1,
        FRAME_DT,
        0.2,
        null,
        false,
      );
      const p = seated({ x: 8, y: 0, z: 0 }, drive);
      updateSelfRenderPosition(state, p, SEED, 1, HITCH_DT, 0.2, null, false);
      if (eases) expect(state.position.x).toBeLessThan(8);
      else expect(state.position.x).toBe(8);
    }
  });

  it('scales the rewind cap by the driver speed budget, boost included, runners unchanged', () => {
    const runner = seated({ x: 0, y: 0, z: 0 }, null);
    const driver = seated({ x: 0, y: 0, z: 0 });
    const profileCap = (MAX_SELF_REWIND_YD_PER_SEC * vehicleProfile(PROFILE).maxSpeed) / RUN_SPEED;
    expect(selfRewindCapYdPerSec(runner)).toBe(MAX_SELF_REWIND_YD_PER_SEC);
    expect(selfRewindCapYdPerSec(driver)).toBeCloseTo(profileCap, 12);
    const boosted = seated({ x: 0, y: 0, z: 0 }, kartDrive({ speedCap: 1.3 }));
    expect(displaySpeedBudget(boosted)).toBeCloseTo(vehicleProfile(PROFILE).maxSpeed * 1.3, 12);
    expect(selfRewindCapYdPerSec(boosted)).toBeCloseTo(profileCap * 1.3, 12);
    const slowed = seated({ x: 0, y: 0, z: 0 }, kartDrive({ speedCap: 0.5 }));
    expect(selfRewindCapYdPerSec(slowed)).toBeCloseTo(profileCap, 12);

    // a machine thrown backward at 60 yd/s while the display still holds a
    // 4 yd lead: the gate closes and the drawn body rewinds onto the mirror
    for (const [drive, cap] of [
      [null, MAX_SELF_REWIND_YD_PER_SEC],
      [kartDrive(), profileCap],
    ] as const) {
      const state = createSelfRenderPositionState();
      const lead = reconciled({ x: 4, y: 0, z: 0 }, null);
      updateSelfRenderPosition(
        state,
        seated({ x: 0, y: 0, z: 0 }, drive),
        SEED,
        1,
        FRAME_DT,
        0.2,
        lead,
        false,
      );
      let widest = 0;
      for (let frameIndex = 1; frameIndex <= 8; frameIndex++) {
        const before = state.position.x;
        const p = seated({ x: -frameIndex, y: 0, z: 0 }, drive);
        updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
        const rewind = before - state.position.x;
        expect(rewind).toBeLessThanOrEqual(cap * FRAME_DT + 1e-9);
        widest = Math.max(widest, rewind);
      }
      expect(widest).toBeCloseTo(cap * FRAME_DT, 9);
    }
  });

  it('flushes a driver spent rewind offset so the plain fallback takes the pose back', () => {
    const state = createSelfRenderPositionState();
    const p = seated({ x: 0, y: 0, z: 0 });
    updateSelfRenderPosition(
      state,
      p,
      SEED,
      1,
      FRAME_DT,
      0.2,
      reconciled({ x: 1, y: 0, z: 0 }, null),
      false,
    );
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.offset.x).toBeGreaterThan(0.5);
    let frames = 0;
    while (state.offset.x !== 0 && frames < 2000) {
      updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
      frames++;
    }
    expect(state.offset).toEqual({ x: 0, y: 0, z: 0 });
    expect(frames).toBeLessThan(120);
    expect(Math.abs(state.position.x)).toBeLessThan(1e-3);

    // a runner keeps the old unflushed decay
    const runner = createSelfRenderPositionState();
    const walker = seated({ x: 0, y: 0, z: 0 }, null);
    const lead = reconciled({ x: 1, y: 0, z: 0 }, null);
    updateSelfRenderPosition(runner, walker, SEED, 1, FRAME_DT, 0.2, lead, false);
    for (let i = 0; i < 120; i++) {
      updateSelfRenderPosition(runner, walker, SEED, 1, FRAME_DT, 0.2, null, false);
    }
    expect(runner.offset.x).toBeGreaterThan(0);
  });

  it('keeps the runner snap at the fixed six yards', () => {
    expect(teleportGapLimitSq(seated({ x: 0, y: 0, z: 0 }, null), HITCH_DT)).toBe(
      SELF_MOTION_SNAP_DIST_SQ,
    );
  });
});
