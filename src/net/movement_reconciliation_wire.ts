import type { Entity, FerryDeckMirror, VehicleDrive } from '../sim/types';
import { parseDriveRecon } from './drive_recon_wire';
import { QuestWorldWireState } from './quest_world_wire_state';
import { parseFerryDeck } from './transport_wire';

export class ReconWireState extends QuestWorldWireState {
  reconAuthoritativeX: number | null = null;
  reconAuthoritativeY: number | null = null;
  reconAuthoritativeZ: number | null = null;
  reconPreviousAuthoritativeFacing: number | null = null;
  reconAuthoritativeFacing: number | null = null;
  reconAckClientTick = -1;
  reconOverrideEpoch = 0;
  reconOverrideActive = false;
  reconMoveSpeedMult = 1;
  /** The acknowledged pose in a sailing ship's frame (`rdk`), when the
   *  player rides one: the frame the deck-aware prediction replays in. Its
   *  height is the WORLD height (server transport_head.ts ferryDeckReconWire). */
  reconDeck: FerryDeckMirror | null = null;
  /** The acknowledged drive state while seated (`rdv`), with the vertical
   *  state the vehicle kernel reads (vy and onGround). */
  reconDrive: VehicleDrive | null = null;
  reconVy = 0;
  reconOnGround = true;

  resetReconWireState(): void {
    this.reconAuthoritativeX = null;
    this.reconAuthoritativeY = null;
    this.reconAuthoritativeZ = null;
    this.reconPreviousAuthoritativeFacing = null;
    this.reconAuthoritativeFacing = null;
    this.reconAckClientTick = -1;
    this.reconOverrideEpoch = 0;
    this.reconOverrideActive = false;
    this.reconMoveSpeedMult = 1;
    this.reconDeck = null;
    this.reconDrive = null;
    this.reconVy = 0;
    this.reconOnGround = true;
  }
}

interface MovementReconciliationSelfWire {
  rpx?: unknown;
  rpy?: unknown;
  rpz?: unknown;
  rpf?: unknown;
  ackCt?: unknown;
  ovE?: unknown;
  ovA?: unknown;
  msm?: unknown;
  rdk?: unknown;
  rdv?: unknown;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function applyReconSelfWire(
  target: ReconWireState,
  self: MovementReconciliationSelfWire,
  movementWireVersion: 1 | 2,
  entity?: Entity,
): void {
  const drive = movementWireVersion === 2 ? parseDriveRecon(self.rdv) : null;
  // A v2 self record carries no rounded `drv` beside `rdv`: the mirror is this.
  // A malformed row keeps the machine the last good one drew, for presentation.
  if (entity && drive) entity.drive = { ...drive.drive };
  else if (entity && self.rdv !== undefined && target.reconDrive) {
    entity.drive = { ...target.reconDrive };
  }
  if (
    movementWireVersion !== 2 ||
    !finiteNumber(self.rpx) ||
    !finiteNumber(self.rpy) ||
    !finiteNumber(self.rpz) ||
    !finiteNumber(self.rpf) ||
    !Number.isSafeInteger(self.ackCt) ||
    (self.ackCt as number) < -1 ||
    !Number.isSafeInteger(self.ovE) ||
    (self.ovE as number) < 0 ||
    (self.msm !== undefined && (!finiteNumber(self.msm) || self.msm < 0))
  ) {
    return;
  }
  const previousFacing = target.reconAuthoritativeFacing ?? self.rpf;
  target.reconAuthoritativeX = self.rpx;
  target.reconAuthoritativeY = self.rpy;
  target.reconAuthoritativeZ = self.rpz;
  target.reconPreviousAuthoritativeFacing = previousFacing;
  target.reconAuthoritativeFacing = self.rpf;
  target.reconAckClientTick = self.ackCt as number;
  target.reconOverrideEpoch = self.ovE as number;
  target.reconOverrideActive = self.ovA === 1;
  target.reconMoveSpeedMult = self.msm === undefined ? 1 : self.msm;
  target.reconDeck = parseFerryDeck(self.rdk);
  target.reconDrive = drive ? drive.drive : null;
  target.reconVy = drive ? drive.vy : 0;
  target.reconOnGround = drive ? drive.onGround : true;
  // A malformed `rdv` leaves no drive to stand a driver down on (the rounded
  // `drv` is not sent beside it), so it stands the prediction down itself.
  if (self.rdv !== undefined && !drive) target.reconOverrideActive = true;
}
