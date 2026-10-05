// The online client's decode of `rdv`, a seated pilot's full drive state at
// the acknowledged tick (server/drive_recon_wire.ts is the encoder and owns the
// field table). Every field is re-validated and a malformed row is dropped
// whole (null), so a version-skewed frame can never hand the prediction a drive
// it would replay wrong. DOM-free and ClientWorld-free.

import { DEFAULT_VEHICLE_PROFILE_KEY, VEHICLE_PROFILES } from '../sim/content/vehicles';
import type { VehicleDrive } from '../sim/types';
import { createVehicleDrive } from '../sim/vehicle_motion';

export interface DriveRecon {
  drive: VehicleDrive;
  vy: number;
  onGround: boolean;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sparse(value: unknown, fallback: number): number | null {
  if (value === undefined) return fallback;
  return finite(value) ? value : null;
}

export function parseDriveRecon(rdv: unknown): DriveRecon | null {
  if (typeof rdv !== 'object' || rdv === null || Array.isArray(rdv)) return null;
  const w = rdv as Record<string, unknown>;
  const k = w.k;
  if (typeof k !== 'string' || !Object.hasOwn(VEHICLE_PROFILES, k)) return null;
  if (!finite(w.sp) || !finite(w.sl) || !finite(w.yr)) return null;
  const steerAngle = sparse(w.st, 0);
  const spin = sparse(w.sn, 0);
  const handbrake = sparse(w.hb, 0);
  const gripMult = sparse(w.g, 1);
  const dragMult = sparse(w.dg, 1);
  const speedCap = sparse(w.c, 1);
  const slipCap = sparse(w.sc, 1);
  const collisionImpact = sparse(w.ci, 0);
  if (
    steerAngle === null ||
    spin === null ||
    handbrake === null ||
    gripMult === null ||
    dragMult === null ||
    speedCap === null ||
    slipCap === null ||
    collisionImpact === null
  ) {
    return null;
  }
  if (w.lk !== undefined && w.lk !== 1) return null;
  const airborne = w.air === 1;
  if (w.air !== undefined && !airborne) return null;
  if (airborne ? !finite(w.vy) : w.vy !== undefined) return null;
  return {
    drive: {
      profileKey: k,
      speed: w.sp,
      slip: w.sl,
      steerAngle,
      yawRate: w.yr,
      spin,
      handbrake,
      gripMult,
      dragMult,
      speedCap,
      slipCap,
      collisionImpact,
      controlsLocked: w.lk === 1,
    },
    vy: airborne ? (w.vy as number) : 0,
    onGround: !airborne,
  };
}

/**
 * A resting machine for a seated pilot whose `rdv` row is malformed before any
 * good one has landed: the profile the row names when it names a known one,
 * the default otherwise. PRESENTATION only (the own kart is drawn instead of a
 * runner until a good row arrives); the prediction stands down on that row.
 */
export function restingDriveRecon(rdv: unknown): VehicleDrive {
  const k =
    typeof rdv === 'object' && rdv !== null ? (rdv as Record<string, unknown>).k : undefined;
  return createVehicleDrive(
    typeof k === 'string' && Object.hasOwn(VEHICLE_PROFILES, k) ? k : DEFAULT_VEHICLE_PROFILE_KEY,
  );
}
