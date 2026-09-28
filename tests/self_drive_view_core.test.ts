import { describe, expect, it } from 'vitest';
import {
  createSelfDriveView,
  driveViewFromMirror,
  driveViewFromReconciled,
  fillReconciledDrive,
  lerpFacing,
  type PredictedDriveHead,
  type ReconciledDrive,
} from '../src/render/self_drive_view_core';
import {
  SELF_MOTION_SNAP_DIST_SQ,
  type SelfMotionFrame,
  SelfMotionPredictor,
  updateSelfRenderFallback,
  type Vec3Like,
} from '../src/render/self_motion';
import {
  createSelfRenderPositionState,
  MAX_SELF_REWIND_YD_PER_SEC,
  type ReconciledSelfPrediction,
  type SelfRenderPositionState,
  selfRewindCapYdPerSec,
  teleportGapLimitSq,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { type Entity, emptyMoveInput, RUN_SPEED, type VehicleDrive } from '../src/sim/types';
import { createVehicleDrive, vehicleVelocityX, vehicleVelocityZ } from '../src/sim/vehicle_motion';

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

const v1Frame = (): SelfMotionFrame => ({
  enabled: true,
  moveInput: { ...emptyMoveInput(), forward: true },
  displayFacing: 0,
  echoMs: 80,
  jitterMs: 10,
  authorityToken: 0,
  driveImpulse: false,
  popVelocity: 0,
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

/** A real v1 predictor whose scratch kart is `head`, drawn at `frac`. */
function v1PredictorOver(
  head: PredictedDriveHead,
  frac: number,
  at: Vec3Like,
): SelfMotionPredictor {
  const predictor = new SelfMotionPredictor(SEED);
  const internals = predictor as unknown as {
    actor: unknown;
    renderFacing: number;
    step: () => Vec3Like;
  };
  internals.actor = { ...head, pos: { ...at }, prevPos: { ...at } };
  internals.renderFacing = lerpFacing(head.prevFacing ?? head.facing, head.facing, frac);
  internals.step = () => ({ ...at });
  return predictor;
}

describe('the self drive view on both wires', () => {
  const at = { x: 10, y: 3, z: -4 };
  const head: PredictedDriveHead = {
    drive: kartDrive(),
    prevFacing: 0.9,
    facing: 1.05,
    vy: 2.25,
    onGround: false,
  };

  it('fills the same view from the v1 predictor and the v2 output for one kart', () => {
    const alpha = 0.4;
    const v1 = createSelfRenderPositionState();
    v1.predictor = v1PredictorOver(head, alpha, at);
    updateSelfRenderPosition(v1, seated(at), SEED, alpha, FRAME_DT, 0.2, v1Frame(), false);

    const v2 = createSelfRenderPositionState();
    const output = reconciled(at, headDrive(head, alpha));
    updateSelfRenderPosition(v2, seated(at), SEED, alpha, FRAME_DT, 0.2, output, false);

    const drive = head.drive as VehicleDrive;
    for (const view of [v1.drive, v2.drive]) {
      expect(view.source).toBe('predicted');
      expect(view.facing).toBeCloseTo(0.9 + 0.15 * alpha, 12);
      expect(view.velocityX).toBe(vehicleVelocityX(drive, head.facing));
      expect(view.velocityZ).toBe(vehicleVelocityZ(drive, head.facing));
      expect(view.vy).toBe(2.25);
      expect(view.kernelOnGround).toBe(false);
      expect(view.handbrake).toBe(0.4);
      expect(view.collisionImpact).toBe(7);
      expect(view.yawOffset).toBe(0);
    }
    expect(v2.drive).toEqual({ ...v1.drive, facing: v2.drive.facing });
  });

  it('falls back to the interpolated mirror for a stood-down driver, and says so', () => {
    const p = seated(at, kartDrive({ speed: 20 }));
    const state = createSelfRenderPositionState();
    // a stood-down v2 driver: the pipeline hands the renderer no prediction
    updateSelfRenderPosition(state, p, SEED, 0.5, FRAME_DT, 0.2, null, false);
    const mirror = { ...state.drive };
    expect(mirror.source).toBe('mirror');
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
      vy: 0,
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

    // and so does any frame the prediction does not own the kart
    run(reconciled(at, drive, { x: 0.2, y: 0, z: 0, yaw: 0.3 }));
    updateSelfRenderPosition(state, p, SEED, 1, FRAME_DT, 0.2, null, false);
    expect(state.drive.yawOffset).toBe(0);
    run(reconciled(at, drive));
    expect(state.drive.facing).toBe(0.4);
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

  it('scales the rewind cap by the profile top speed, runners unchanged', () => {
    const runner = seated({ x: 0, y: 0, z: 0 }, null);
    const driver = seated({ x: 0, y: 0, z: 0 });
    const profileCap = (MAX_SELF_REWIND_YD_PER_SEC * vehicleProfile(PROFILE).maxSpeed) / RUN_SPEED;
    expect(selfRewindCapYdPerSec(runner)).toBe(MAX_SELF_REWIND_YD_PER_SEC);
    expect(selfRewindCapYdPerSec(driver)).toBeCloseTo(profileCap, 12);

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

  it('keeps the runner snap at the fixed six yards', () => {
    expect(teleportGapLimitSq(seated({ x: 0, y: 0, z: 0 }, null), HITCH_DT)).toBe(
      SELF_MOTION_SNAP_DIST_SQ,
    );
  });
});
