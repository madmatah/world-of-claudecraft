// The local kart as the renderer reads it: one view filled from the v2
// reconciled prediction, and from the interpolated mirror while nothing
// predicts the seat (offline, a stood-down v2 driver, and every wire v1
// driver, since the v1 display predictor never drives a kart). Pure (no
// Three), so the renderer stays a one-line reader and a unit test can drive
// the kart state directly.

import type { Entity, VehicleDrive } from '../sim/types';
import { vehicleVelocityX, vehicleVelocityZ } from '../sim/vehicle_motion';
import { wrapAngle } from './facing_smooth';

/** A heading gap past this is a re-facing (a recovery, a server turn), never
 *  a correction: it snaps instead of gliding. */
export const SELF_YAW_SNAP_RAD = Math.PI / 2;
const SELF_YAW_FLUSH_RAD = 1e-3;

/** The v2 prediction's kart at the frame's interpolation alpha. */
export interface ReconciledDrive {
  facing: number;
  velocityX: number;
  velocityZ: number;
  onGround: boolean;
  state: VehicleDrive | null;
}

/** The predicted head the v2 display reads its kart from. */
export interface PredictedDriveHead {
  drive?: VehicleDrive | null;
  facing: number;
  prevFacing?: number;
  onGround: boolean;
}

/** The v1 display predictor's kernel ground state (it predicts runners only). */
export interface DrivePredictorReadout {
  readonly onGround: boolean;
}

/**
 * `predicted`: the v2 reconcile owns the kart.
 * `mirror`: seated but not predicted (offline, gated, a v2 driver stood
 * down, any v1 driver): every field is the interpolated mirror. `none`: on
 * foot.
 */
export type SelfDriveSource = 'predicted' | 'mirror' | 'none';

export interface SelfDriveView {
  source: SelfDriveSource;
  /** The view owns the drawn heading: predicted, or a mirror still gliding
   *  out of the last predicted one. While it does, the heading is not
   *  camera-driven input: it is steered, and the predictor integrates it with
   *  the same kernel the server runs. `facing` is then the zero-latency truth,
   *  so the renderer's model reads it directly instead of the interpolated
   *  mirror (a full echo behind on every corner) or the camera override (which
   *  is null while driving). */
  steersHeading: boolean;
  facing: number;
  velocityX: number;
  velocityZ: number;
  /** The kart's drive at the drawn instant, for its surface and contact
   *  effects; null on foot. */
  state: VehicleDrive | null;
  /** The kernel's ground state for the drawn body, or null when no kernel
   *  owns it and the renderer's foot-height heuristic decides. */
  kernelOnGround: boolean | null;
  /** The heading gap still gliding out of the drawn heading. */
  yawOffset: number;
}

export function createSelfDriveView(): SelfDriveView {
  return {
    source: 'none',
    steersHeading: false,
    facing: 0,
    velocityX: 0,
    velocityZ: 0,
    state: null,
    kernelOnGround: null,
    yawOffset: 0,
  };
}

export function lerpFacing(from: number, to: number, alpha: number): number {
  return wrapAngle(from + wrapAngle(to - from) * alpha);
}

/** The v2 output's kart: heading lerped wrap-aware from the tick start at
 *  `alpha`, velocity and drive from the head. Null on foot. */
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
  out.onGround = head.onGround;
  out.state = drive;
  return out;
}

function glide(offset: number, decayShare: number): number {
  const wrapped = wrapAngle(offset);
  if (Math.abs(wrapped) > SELF_YAW_SNAP_RAD) return 0;
  const left = wrapped * (1 - decayShare);
  return Math.abs(left) < SELF_YAW_FLUSH_RAD ? 0 : left;
}

/**
 * The seat as the mirror shows it, or `none` on foot. Leaving a v2
 * prediction on the same seat (a suspend), the last predicted heading is held
 * and glides onto the mirror at `decayShare` instead of popping; `snap` (a
 * teleport-size gap) drops it.
 */
export function driveViewFromMirror(
  view: SelfDriveView,
  p: Entity,
  alpha: number,
  predictor: DrivePredictorReadout | null,
  snap = false,
  decayShare = 0,
): SelfDriveView {
  view.kernelOnGround = predictor ? predictor.onGround : null;
  const drive = p.drive ?? null;
  view.state = drive;
  if (!drive) {
    view.source = 'none';
    view.steersHeading = false;
    view.facing = 0;
    view.velocityX = 0;
    view.velocityZ = 0;
    view.yawOffset = 0;
    return view;
  }
  const facing = lerpFacing(p.prevFacing, p.facing, Math.min(1, alpha));
  let offset = 0;
  if (!snap && view.source === 'predicted') offset = view.facing - facing;
  else if (!snap && view.source === 'mirror') offset = view.yawOffset;
  view.yawOffset = glide(offset, decayShare);
  view.source = 'mirror';
  view.steersHeading = view.yawOffset !== 0;
  view.facing = wrapAngle(facing + view.yawOffset);
  view.velocityX = vehicleVelocityX(drive, p.facing);
  view.velocityZ = vehicleVelocityZ(drive, p.facing);
  return view;
}

/**
 * Wire v2: the reconciled kart. Its heading glides at `decayShare` (the
 * position offset's handoff rate) out of a replay's yaw residual, or out of
 * the drawn mirror heading when the prediction resumes on the same seat; a
 * teleport-size gap (`snap`) or a re-facing past SELF_YAW_SNAP_RAD drops it.
 * The mirror while the prediction holds no kart (a driver stood down, a seat
 * not yet adopted).
 */
export function driveViewFromReconciled(
  view: SelfDriveView,
  drive: ReconciledDrive | null,
  p: Entity,
  alpha: number,
  predictor: DrivePredictorReadout | null,
  residualYaw: number,
  snap: boolean,
  decayShare: number,
): SelfDriveView {
  if (!drive) return driveViewFromMirror(view, p, alpha, predictor, snap, decayShare);
  let offset = 0;
  if (!snap && view.source === 'predicted') offset = view.yawOffset + residualYaw;
  else if (!snap && view.source === 'mirror') offset = view.facing - drive.facing;
  view.yawOffset = glide(offset, decayShare);
  view.source = 'predicted';
  view.steersHeading = true;
  view.kernelOnGround = drive.onGround;
  view.facing = wrapAngle(drive.facing + view.yawOffset);
  view.velocityX = drive.velocityX;
  view.velocityZ = drive.velocityZ;
  view.state = drive.state;
  return view;
}
