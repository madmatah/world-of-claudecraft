// The local kart as the renderer reads it, on either movement wire: one view
// filled from the v1 display predictor or from the v2 reconciled prediction,
// and from the interpolated mirror while nothing predicts the seat. Pure (no
// Three), so the renderer stays a one-line reader and a unit test can drive
// both wires through the same kart state.

import type { Entity, VehicleDrive } from '../sim/types';
import { vehicleVelocityX, vehicleVelocityZ } from '../sim/vehicle_motion';
import { wrapAngle } from './facing_smooth';

/** The v2 prediction's kart at the frame's interpolation alpha. */
export interface ReconciledDrive {
  facing: number;
  velocityX: number;
  velocityZ: number;
  vy: number;
  onGround: boolean;
  handbrake: number;
  collisionImpact: number;
}

/** The predicted head the v2 display reads its kart from. */
export interface PredictedDriveHead {
  drive?: VehicleDrive | null;
  facing: number;
  prevFacing?: number;
  vy: number;
  onGround: boolean;
}

/** What the v1 display predictor exposes about its scratch kart. */
export interface DrivePredictorReadout {
  readonly driving: boolean;
  readonly facing: number;
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly vy: number;
  readonly onGround: boolean;
  readonly drive: VehicleDrive | null;
}

/**
 * `predicted`: a prediction owns the kart (v1 predictor or v2 reconcile).
 * `mirror`: seated but not predicted (offline, gated, a v2 driver stood
 * down): every field is the interpolated mirror. `none`: on foot.
 */
export type SelfDriveSource = 'predicted' | 'mirror' | 'none';

export interface SelfDriveView {
  source: SelfDriveSource;
  facing: number;
  velocityX: number;
  velocityZ: number;
  vy: number;
  handbrake: number;
  collisionImpact: number;
  /** The kernel's ground state for the drawn body, or null when no kernel
   *  owns it and the renderer's foot-height heuristic decides. */
  kernelOnGround: boolean | null;
  /** The reconcile yaw residual still gliding out of the drawn heading. */
  yawOffset: number;
}

export function createSelfDriveView(): SelfDriveView {
  return {
    source: 'none',
    facing: 0,
    velocityX: 0,
    velocityZ: 0,
    vy: 0,
    handbrake: 0,
    collisionImpact: 0,
    kernelOnGround: null,
    yawOffset: 0,
  };
}

export function lerpFacing(from: number, to: number, alpha: number): number {
  return wrapAngle(from + wrapAngle(to - from) * alpha);
}

/** The v2 output's kart: heading lerped wrap-aware from the tick start at
 *  `alpha`, velocity and presentation from the head. Null on foot. */
export function fillReconciledDrive(
  out: ReconciledDrive,
  head: PredictedDriveHead,
  alpha: number,
): ReconciledDrive | null {
  const drive = head.drive;
  if (!drive) return null;
  out.facing = lerpFacing(head.prevFacing ?? head.facing, head.facing, alpha);
  out.velocityX = vehicleVelocityX(drive, head.facing);
  out.velocityZ = vehicleVelocityZ(drive, head.facing);
  out.vy = head.vy;
  out.onGround = head.onGround;
  out.handbrake = drive.handbrake;
  out.collisionImpact = drive.collisionImpact;
  return out;
}

function writeDrive(view: SelfDriveView, drive: VehicleDrive | null): void {
  view.handbrake = drive?.handbrake ?? 0;
  view.collisionImpact = drive?.collisionImpact ?? 0;
}

/** The seat as the mirror shows it, or `none` on foot. */
export function driveViewFromMirror(
  view: SelfDriveView,
  p: Entity,
  alpha: number,
  predictor: Pick<DrivePredictorReadout, 'onGround'> | null,
): SelfDriveView {
  view.yawOffset = 0;
  view.kernelOnGround = predictor ? predictor.onGround : null;
  const drive = p.drive ?? null;
  writeDrive(view, drive);
  if (!drive) {
    view.source = 'none';
    view.facing = 0;
    view.velocityX = 0;
    view.velocityZ = 0;
    view.vy = 0;
    return view;
  }
  view.source = 'mirror';
  view.facing = lerpFacing(p.prevFacing, p.facing, Math.min(1, alpha));
  view.velocityX = vehicleVelocityX(drive, p.facing);
  view.velocityZ = vehicleVelocityZ(drive, p.facing);
  view.vy = p.vy;
  return view;
}

/** Wire v1: the display predictor's scratch kart, once it has adopted the
 *  seat; the mirror until then. */
export function driveViewFromPredictor(
  view: SelfDriveView,
  predictor: DrivePredictorReadout,
  p: Entity,
  alpha: number,
): SelfDriveView {
  if (!predictor.driving) return driveViewFromMirror(view, p, alpha, predictor);
  view.source = 'predicted';
  view.yawOffset = 0;
  view.kernelOnGround = predictor.onGround;
  view.facing = predictor.facing;
  view.velocityX = predictor.velocityX;
  view.velocityZ = predictor.velocityZ;
  view.vy = predictor.vy;
  writeDrive(view, predictor.drive);
  return view;
}

/**
 * Wire v2: the reconciled kart, its heading gliding a replay's yaw residual
 * out at `decayShare` this frame (the position offset's handoff rate), or
 * dropping it outright on a teleport-size gap. The mirror while the
 * prediction holds no kart (a driver stood down, a seat not yet adopted).
 */
export function driveViewFromReconciled(
  view: SelfDriveView,
  drive: ReconciledDrive | null,
  p: Entity,
  alpha: number,
  predictor: Pick<DrivePredictorReadout, 'onGround'> | null,
  residualYaw: number,
  snap: boolean,
  decayShare: number,
): SelfDriveView {
  if (!drive) return driveViewFromMirror(view, p, alpha, predictor);
  const offset = snap || view.source !== 'predicted' ? 0 : view.yawOffset + residualYaw;
  view.yawOffset = wrapAngle(offset) * (1 - decayShare);
  view.source = 'predicted';
  view.kernelOnGround = drive.onGround;
  view.facing = wrapAngle(drive.facing + view.yawOffset);
  view.velocityX = drive.velocityX;
  view.velocityZ = drive.velocityZ;
  view.vy = drive.vy;
  view.handbrake = drive.handbrake;
  view.collisionImpact = drive.collisionImpact;
  return view;
}
