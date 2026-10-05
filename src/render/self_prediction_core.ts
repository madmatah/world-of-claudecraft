import { type Aura, type Entity, type MoveInput, normAngle, type VehicleDrive } from '../sim/types';
import {
  copySlickState,
  type SlickPredictionState,
  sameSlickState,
} from './self_slick_prediction_core';

export const SELF_PREDICTION_RING_CAPACITY = 128;

export interface PredictionPose {
  x: number;
  y: number;
  z: number;
  facing: number;
  /** The frame the pose is in: a sailing ship's route index, or world. */
  deck?: number | null;
  /** A seated pilot's acknowledgement: the drive at the acked tick, or null
   *  once the wheel is gone (race end). Undefined on a runner's. */
  drive?: VehicleDrive | null;
  vy?: number;
  onGround?: boolean;
  /** The auras of the snapshot that carried the acknowledgement. */
  auras?: readonly Aura[];
  /** A racing pilot's standing with the oil at the acked tick. */
  slick?: SlickPredictionState | null;
}

/** `yaw` rides only when the replayed head drives: the kernel owns a
 *  driver's facing, so a replay can move it. */
export type PredictionResidual = Pick<PredictionPose, 'x' | 'y' | 'z'> & { yaw?: number };

export interface PredictionFrame {
  ct: number;
  mi: MoveInput;
  facing: number | null;
}

/** The predicted body. `deck` set (a route index) means the pose is kept in
 *  that sailing ship's frame (render/deck_prediction.ts): position x port and
 *  z bow (height stays world yards); heading and velocity off the bow. */
export type MotionState = {
  deck?: number | null;
  /** Set while seated behind a wheel: the vehicle kernel's state. */
  drive?: VehicleDrive | null;
  /** A driver's facing at the tick start, for the display's yaw lerp. */
  prevFacing?: number;
  /** Set while racing: the oil the predicted kart stands in
   *  (render/self_slick_prediction_core.ts). */
  slick?: SlickPredictionState | null;
} & Pick<
  Entity,
  | 'id'
  | 'pos'
  | 'prevPos'
  | 'facing'
  | 'vx'
  | 'vy'
  | 'vz'
  | 'onGround'
  | 'jumping'
  | 'fallStartY'
  | 'swimStroke'
  | 'swimDiving'
  | 'auras'
  | 'ghost'
  | 'sitting'
  | 'castingAbility'
  | 'maxHp'
  | 'mountKey'
  | 'mountCastRemaining'
  | 'mountCastKey'
>;

export interface PredictionEntry {
  ct: number;
  mi: MoveInput;
  facing: number | null;
  pose: MotionState;
}

export type PredictionStep = (state: MotionState, frame: PredictionFrame) => void;

export type ReconciliationResult =
  | { mode: 'match' }
  | { mode: 'replayed'; residual: PredictionResidual }
  | { mode: 'ignore' }
  | { mode: 'stale' }
  | { mode: 'suspend' };

export function copyMotionState(state: MotionState): MotionState {
  const copy: MotionState = {
    ...state,
    pos: { ...state.pos },
    prevPos: { ...state.prevPos },
    auras: state.auras.slice(),
  };
  if (state.drive) copy.drive = { ...state.drive };
  if (state.slick) copy.slick = copySlickState(state.slick);
  return copy;
}

function entryFrame(entry: PredictionEntry): PredictionFrame {
  return { ct: entry.ct, mi: entry.mi, facing: entry.facing };
}

function stepFrom(state: MotionState, frame: PredictionFrame, stepFn: PredictionStep): MotionState {
  const next = copyMotionState(state);
  next.prevPos.x = next.pos.x;
  next.prevPos.y = next.pos.y;
  next.prevPos.z = next.pos.z;
  const drive = next.drive ?? null;
  if (drive) next.prevFacing = next.facing;
  // the server writes a runner's streamed facing, never a driver's
  if (frame.facing !== null && !drive) next.facing = frame.facing;
  stepFn(next, frame);
  return next;
}

/** Every drive field the vehicle kernel reads back: a driver's match compares
 *  them exactly. */
export const DRIVE_MATCH_FIELDS = [
  'profileKey',
  'speed',
  'slip',
  'steerAngle',
  'yawRate',
  'spin',
  'gripMult',
  'dragMult',
  'speedCap',
  'slipCap',
  'controlsLocked',
] as const satisfies readonly (keyof VehicleDrive)[];

/** Adopted but never compared: the handbrake's own presentation ramp and the
 *  scrape reading never shape a pose. */
export const DRIVE_PRESENTATION_FIELDS = [
  'handbrake',
  'collisionImpact',
] as const satisfies readonly (keyof VehicleDrive)[];

function sameDrive(
  a: VehicleDrive | null | undefined,
  b: VehicleDrive | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  for (const field of DRIVE_MATCH_FIELDS) if (a[field] !== b[field]) return false;
  return true;
}

// Exact on every field: the kernel is IEEE arithmetic over full-precision wire
// numbers, so the same inputs land on the same bits. `===` folds -0 into +0.
function matchesAuthoritative(pose: MotionState, authoritative: PredictionPose): boolean {
  if (
    (pose.deck ?? null) !== (authoritative.deck ?? null) ||
    pose.pos.x !== authoritative.x ||
    pose.pos.y !== authoritative.y ||
    pose.pos.z !== authoritative.z
  ) {
    return false;
  }
  if (!pose.drive && !authoritative.drive) return true;
  return (
    pose.facing === authoritative.facing &&
    pose.vy === authoritative.vy &&
    pose.onGround === authoritative.onGround &&
    sameDrive(pose.drive, authoritative.drive) &&
    // a prediction still racing past the acked race's end is no reason to replay
    (!authoritative.slick || (!!pose.slick && sameSlickState(pose.slick, authoritative.slick)))
  );
}

function applyAuthoritativePose(state: MotionState, authoritative: PredictionPose): void {
  state.deck = authoritative.deck ?? null;
  state.pos.x = authoritative.x;
  state.pos.y = authoritative.y;
  state.pos.z = authoritative.z;
  state.prevPos.x = authoritative.x;
  state.prevPos.y = authoritative.y;
  state.prevPos.z = authoritative.z;
  state.facing = authoritative.facing;
  if (authoritative.drive === undefined && !state.drive) return;
  state.drive = authoritative.drive ? { ...authoritative.drive } : null;
  if (state.drive) {
    state.prevFacing = authoritative.facing;
    if (authoritative.vy !== undefined) state.vy = authoritative.vy;
    if (authoritative.onGround !== undefined) state.onGround = authoritative.onGround;
    state.slick = authoritative.slick ? copySlickState(authoritative.slick) : null;
  } else {
    // a runner's recon carries no vertical state, and the race puts a finished
    // pilot back on the ground: an airborne kart's vy must not fall a runner
    delete state.prevFacing;
    delete state.slick;
    state.vy = authoritative.vy ?? 0;
    state.onGround = authoritative.onGround ?? true;
  }
  if (authoritative.auras) state.auras = authoritative.auras.slice();
}

export class PredictionRing {
  private readonly entries: PredictionEntry[] = [];
  private anchorCt: number | null = null;

  constructor(readonly capacity = SELF_PREDICTION_RING_CAPACITY) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError('prediction ring capacity must be a positive integer');
    }
  }

  get size(): number {
    return this.entries.length;
  }

  get oldestClientTick(): number | null {
    return this.entries[0]?.ct ?? null;
  }

  get anchorClientTick(): number | null {
    return this.anchorCt;
  }

  get head(): PredictionEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  clear(): void {
    this.entries.length = 0;
    this.anchorCt = null;
  }

  push(entry: PredictionEntry): void {
    if (this.anchorCt === null) this.anchorCt = entry.ct;
    this.entries.push({
      ct: entry.ct,
      mi: { ...entry.mi },
      facing: entry.facing,
      pose: copyMotionState(entry.pose),
    });
    if (this.entries.length > this.capacity) this.entries.shift();
  }

  find(clientTick: number): PredictionEntry | null {
    return this.entries.find((entry) => entry.ct === clientTick) ?? null;
  }

  entriesAfter(clientTick: number): PredictionEntry[] {
    return this.entries.filter((entry) => entry.ct > clientTick);
  }

  dropThrough(clientTick: number): void {
    let count = 0;
    while (count < this.entries.length && this.entries[count].ct <= clientTick) count++;
    if (count > 0) this.entries.splice(0, count);
  }
}

export function predictTick(
  ring: PredictionRing,
  state: MotionState,
  frame: PredictionFrame,
  stepFn: PredictionStep,
): MotionState {
  const predicted = stepFrom(state, frame, stepFn);
  ring.push({ ct: frame.ct, mi: frame.mi, facing: frame.facing, pose: predicted });
  return predicted;
}

export function reconcile(
  ring: PredictionRing,
  ackCt: number,
  authoritative: PredictionPose,
  epoch: number,
  lastEpoch: number | null,
  stepFn: PredictionStep,
): ReconciliationResult {
  if (lastEpoch !== null && epoch !== lastEpoch) return { mode: 'suspend' };

  const oldest = ring.oldestClientTick;
  if (oldest === null) return { mode: 'stale' };
  if (ackCt < oldest) {
    return ackCt < (ring.anchorClientTick ?? oldest) ? { mode: 'ignore' } : { mode: 'stale' };
  }
  const acknowledged = ring.find(ackCt);
  if (!acknowledged) return { mode: 'stale' };

  if (matchesAuthoritative(acknowledged.pose, authoritative)) {
    ring.dropThrough(ackCt);
    return { mode: 'match' };
  }

  const oldHead = ring.head ? copyMotionState(ring.head.pose) : null;
  const replayed = ring.entriesAfter(ackCt);
  applyAuthoritativePose(acknowledged.pose, authoritative);
  let state = acknowledged.pose;
  for (const entry of replayed) {
    state = stepFrom(state, entryFrame(entry), stepFn);
    entry.pose = state;
  }
  const newHead = replayed[replayed.length - 1]?.pose ?? acknowledged.pose;
  ring.dropThrough(ackCt);
  // A replay that changed frames (boarding or leaving a sailing ship's deck,
  // render/deck_prediction.ts) has no residual to glide: the two heads are in
  // different coordinates, and the display rebases across the switch itself.
  if (oldHead && (oldHead.deck ?? null) !== (newHead.deck ?? null)) {
    return { mode: 'replayed', residual: { x: 0, y: 0, z: 0 } };
  }
  const residual: PredictionResidual = {
    x: (oldHead?.pos.x ?? authoritative.x) - newHead.pos.x,
    y: (oldHead?.pos.y ?? authoritative.y) - newHead.pos.y,
    z: (oldHead?.pos.z ?? authoritative.z) - newHead.pos.z,
  };
  // a runner head's facing is the camera's, so kart minus camera is no glide
  if (newHead.drive) {
    residual.yaw = normAngle((oldHead?.facing ?? authoritative.facing) - newHead.facing);
  }
  return { mode: 'replayed', residual };
}
