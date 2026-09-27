import { vehicleProfile } from '../src/sim/content/vehicles';
import { GROUND_BLAST_PUSH } from '../src/sim/realm_racers_ground_blast';
import {
  REALM_RACERS_NITRO_KICK,
  REALM_RACERS_NITRO_SPEED_MULT,
} from '../src/sim/realm_racers_pickup_effects';
import { REALM_RACERS_SLICK_SLIP_CAP } from '../src/sim/realm_racers_slicks';
import type { PlayerMeta, Sim } from '../src/sim/sim';
import { realmRacersMovementLockedAt } from '../src/sim/social/realm_racers';
import { DT, type Entity, RUN_SPEED, type Vec3 } from '../src/sim/types';
import { MAX_BUMP_IMPULSE } from '../src/sim/vehicle_contact';
import { ferryMovementFrame } from './transport_head';

const OVERRIDE_CC_KINDS = new Set(['stun', 'root', 'incapacitate', 'polymorph']);
const POSITION_EPSILON = 1e-9;

export interface MovementOverrideSignature {
  crowdControlled: boolean;
  charging: boolean;
  following: boolean;
  heroicLeaping: boolean;
  valkyrsCalling: boolean;
  mountRaceLocked: boolean;
  vehicleLocked?: boolean;
  climbing: boolean;
  raceLocked: boolean;
  /** Compared, never active: seating and unseating restart prediction. */
  driving: boolean;
  moveSpeedMult: number;
}

export interface MovementOverrideSessionState {
  pid: number;
  movementWireVersion: 1 | 2;
  movementOverrideSignature: MovementOverrideSignature | null;
  movementOverrideEpoch: number;
  movementOverrideActive: boolean;
  movementMoveSpeedMult: number;
  movementAuthoritativePosition: Vec3 | null;
  /** The frame movementAuthoritativePosition is in: -1 the world, else the
   *  route index of the sailing ship the player rides (its hull frame). */
  movementAuthoritativeFrame?: number;
}

export function createMovementOverrideSessionState(): Pick<
  MovementOverrideSessionState,
  | 'movementOverrideSignature'
  | 'movementOverrideEpoch'
  | 'movementOverrideActive'
  | 'movementMoveSpeedMult'
  | 'movementAuthoritativePosition'
  | 'movementAuthoritativeFrame'
> {
  return {
    movementOverrideSignature: null,
    movementOverrideEpoch: 0,
    movementOverrideActive: false,
    movementMoveSpeedMult: 1,
    movementAuthoritativePosition: null,
    movementAuthoritativeFrame: -1,
  };
}

export function computeOverrideSignature(
  entity: Entity,
  meta: Pick<PlayerMeta, 'mountRace' | 'vehicle'>,
  moveSpeedMult: number,
  raceLocked = false,
): MovementOverrideSignature {
  return fillOverrideSignature(
    {
      crowdControlled: false,
      charging: false,
      following: false,
      heroicLeaping: false,
      valkyrsCalling: false,
      mountRaceLocked: false,
      climbing: false,
      raceLocked: false,
      driving: false,
      moveSpeedMult: 1,
    },
    entity,
    meta,
    moveSpeedMult,
    raceLocked,
  );
}

export function fillOverrideSignature(
  target: MovementOverrideSignature,
  entity: Entity,
  meta: Pick<PlayerMeta, 'mountRace' | 'vehicle'>,
  moveSpeedMult: number,
  raceLocked = false,
): MovementOverrideSignature {
  // Fear uses kind incapacitate, so it rides the crowd-control arm.
  target.crowdControlled = entity.auras.some((aura) => OVERRIDE_CC_KINDS.has(aura.kind));
  target.charging = entity.chargeTargetId !== null;
  target.following = entity.followTargetId !== null;
  target.heroicLeaping = entity.leap != null;
  target.valkyrsCalling = entity.valkyrsCalling != null;
  target.mountRaceLocked = meta.mountRace?.phase === 'countdown';
  target.vehicleLocked = !!meta.vehicle;
  target.climbing = entity.climb != null;
  target.raceLocked = raceLocked;
  target.driving = entity.drive != null;
  target.moveSpeedMult = moveSpeedMult;
  return target;
}

function overrideBits(signature: MovementOverrideSignature): number {
  return (
    (signature.crowdControlled ? 1 : 0) |
    (signature.charging ? 2 : 0) |
    (signature.following ? 4 : 0) |
    (signature.heroicLeaping ? 8 : 0) |
    (signature.valkyrsCalling ? 16 : 0) |
    (signature.mountRaceLocked ? 32 : 0) |
    (signature.climbing ? 64 : 0) |
    (signature.vehicleLocked ? 128 : 0) |
    (signature.raceLocked ? 256 : 0)
  );
}

export function overrideActive(signature: MovementOverrideSignature): boolean {
  return overrideBits(signature) !== 0;
}

/** The farthest a machine can legally travel in one tick, before the settle
 *  margin: every speed source at its peak at once, none decaying (nothing is
 *  clamped in the air). The step is horizontal, so the blast's vertical pop
 *  does not enter; its horizontal push does. */
export function vehicleStepKinematicYd(profileKey: string): number {
  const profile = vehicleProfile(profileKey);
  return (
    (profile.maxSpeed * REALM_RACERS_NITRO_SPEED_MULT +
      REALM_RACERS_NITRO_KICK +
      profile.maxSlip * REALM_RACERS_SLICK_SLIP_CAP +
      MAX_BUMP_IMPULSE +
      GROUND_BLAST_PUSH) *
    DT
  );
}

/** A rival contact's depenetration: at most a full overlap of two hulls. */
export function vehicleStepSettleMarginYd(profileKey: string): number {
  return 2 * vehicleProfile(profileKey).bodyRadius;
}

export function vehicleStepCeilingYd(profileKey: string): number {
  return vehicleStepKinematicYd(profileKey) + vehicleStepSettleMarginYd(profileKey);
}

function positionDiscontinuous(
  entity: Entity,
  position: Vec3,
  previousPosition: Vec3,
  maxStep: number,
): boolean {
  const dx = position.x - previousPosition.x;
  const dy = position.y - previousPosition.y;
  const dz = position.z - previousPosition.z;
  const movedSq = dx * dx + dy * dy + dz * dz;
  if (movedSq <= POSITION_EPSILON) return false;
  if (
    entity.pos.x === entity.prevPos.x &&
    entity.pos.y === entity.prevPos.y &&
    entity.pos.z === entity.prevPos.z
  ) {
    return true;
  }
  return Math.hypot(dx, dz) > maxStep + POSITION_EPSILON;
}

// The position the step-size check compares, in the player's movement frame:
// a ferry passenger is measured in the sailing ship's hull frame, so the
// ship's own way (a yard a tick at cruise) never reads as a server-driven
// move, while their own steps on its deck still do. Boarding or leaving the
// deck changes the frame, which does bump the epoch: the client's prediction
// restarts cleanly in the new frame (render/deck_prediction.ts).
const framePosition: Vec3 = { x: 0, y: 0, z: 0 };

export function updateMovementOverrideEpochs(
  sim: Pick<Sim, 'entities' | 'meta' | 'moveSpeedMult' | 'ctx'>,
  sessions: Iterable<MovementOverrideSessionState>,
): void {
  for (const session of sessions) {
    if (session.movementWireVersion !== 2) continue;
    const entity = sim.entities.get(session.pid);
    const meta = sim.meta(session.pid);
    if (!entity || !meta) continue;
    const moveSpeedMult = sim.moveSpeedMult(entity);
    const signature = session.movementOverrideSignature;
    const previousBits = signature ? overrideBits(signature) : 0;
    const previousActive = previousBits !== 0;
    const previousMoveSpeedMult = signature?.moveSpeedMult ?? 0;
    const previousDriving = signature?.driving ?? false;
    // Asked for the NEXT pass: a reset lock ends one tick before this tick's
    // own read of it would say so. Command-driven lock changes between ticks
    // (forfeit, manual reset) bump one tick late, like every command-driven
    // override.
    const raceLocked =
      meta.realmRacersMatchId !== null &&
      realmRacersMovementLockedAt(sim.ctx, session.pid, sim.ctx.tickCount + 1);
    const nextSignature = signature
      ? fillOverrideSignature(signature, entity, meta, moveSpeedMult, raceLocked)
      : computeOverrideSignature(entity, meta, moveSpeedMult, raceLocked);
    const active = overrideActive(nextSignature);
    const driving = nextSignature.driving;
    // A driver's step is bounded by the machine, not run speed, and their slows
    // are surface bands. Loosening it costs no authority: a driver sends flags
    // only and both wires refuse their streamed facing
    // (movement_input_timeline_v2.ts acceptsStreamedFacing).
    const vehicleSpan = driving || previousDriving;
    const maxStep =
      active || previousActive
        ? Number.POSITIVE_INFINITY
        : entity.drive
          ? vehicleStepCeilingYd(entity.drive.profileKey)
          : RUN_SPEED * Math.max(moveSpeedMult, previousMoveSpeedMult) * DT;
    const signatureChanged =
      signature !== null &&
      (previousBits !== overrideBits(nextSignature) ||
        previousDriving !== driving ||
        (!vehicleSpan && previousMoveSpeedMult !== moveSpeedMult));
    const frame = ferryMovementFrame(entity, framePosition);
    const frameChanged =
      session.movementAuthoritativeFrame !== undefined &&
      session.movementAuthoritativeFrame !== frame;
    const discontinuous =
      session.movementAuthoritativePosition !== null &&
      (frameChanged ||
        positionDiscontinuous(
          entity,
          framePosition,
          session.movementAuthoritativePosition,
          maxStep,
        ));
    if (signatureChanged || discontinuous) session.movementOverrideEpoch++;
    session.movementOverrideSignature = nextSignature;
    session.movementOverrideActive = active;
    session.movementMoveSpeedMult = moveSpeedMult;
    session.movementAuthoritativeFrame = frame;
    if (session.movementAuthoritativePosition) {
      session.movementAuthoritativePosition.x = framePosition.x;
      session.movementAuthoritativePosition.y = framePosition.y;
      session.movementAuthoritativePosition.z = framePosition.z;
    } else {
      session.movementAuthoritativePosition = { ...framePosition };
    }
  }
}
