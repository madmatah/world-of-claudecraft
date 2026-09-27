// `rdv`: a seated pilot's drive state at the acknowledged tick, full precision,
// for the v2 self block of a client that advertises it (src/net/drive_recon_wire.ts
// decodes it). With the recon pose and the auras it is every state that shapes
// the pose; `fallStartY` and `jumping` are not carried, as they only feed fall
// damage and the coyote jump. Sparse fields fall back to 0 (st, sn, hb) or 1 (g, dg, c, sc);
// `vy` and `air` ride only while airborne. `ci` (the scrape reading) follows
// the `drv` rule, above 0.01 only: the kernel never reads it, the self scrape
// sparks do.

import type { Entity } from '../src/sim/types';

export type DriveReconWire = Record<string, number | string>;

export function driveReconWire(e: Entity): DriveReconWire | undefined {
  const d = e.drive;
  if (!d) return undefined;
  const out: DriveReconWire = { k: d.profileKey, sp: d.speed, sl: d.slip, yr: d.yawRate };
  if (d.steerAngle !== 0) out.st = d.steerAngle;
  if (d.spin !== 0) out.sn = d.spin;
  if (d.handbrake !== 0) out.hb = d.handbrake;
  if (d.gripMult !== 1) out.g = d.gripMult;
  if (d.dragMult !== 1) out.dg = d.dragMult;
  if (d.speedCap !== 1) out.c = d.speedCap;
  if (d.slipCap !== 1) out.sc = d.slipCap;
  if (d.collisionImpact > 0.01) out.ci = d.collisionImpact;
  if (d.controlsLocked) out.lk = 1;
  if (!e.onGround) {
    out.vy = e.vy;
    out.air = 1;
  }
  return out;
}
