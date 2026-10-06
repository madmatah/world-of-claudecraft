import type { VehicleDrive } from '../../sim/types';

/**
 * Vehicle state (volatile): absent means on foot, which is what selects
 * the character path in the shared movement kernel. Rebuilt into a fresh
 * object rather than kept by reference, so the display-only self
 * extrapolator can never write back into this mirror.
 */
// biome-ignore lint/suspicious/noExplicitAny: the raw entity wire `drv` field
export function decodeDriveWire(drv: any): VehicleDrive | null {
  return drv
    ? {
        profileKey: drv.k ?? '',
        speed: drv.sp ?? 0,
        slip: drv.sl ?? 0,
        // Absent means a centred wheel (see the server's sparse encoding).
        steerAngle: drv.st ?? 0,
        yawRate: drv.yr ?? 0,
        spin: drv.sn ?? 0,
        handbrake: drv.hb ?? 0,
        gripMult: drv.g ?? 1,
        dragMult: drv.dg ?? 1,
        speedCap: drv.c ?? 1,
        slipCap: drv.sc ?? 1,
        collisionImpact: drv.ci ?? 0,
        // Sent only while set, so absent means the pilot has the controls.
        controlsLocked: !!drv.lk,
      }
    : null;
}
