// `rdv`: a seated pilot's drive state at the acknowledged tick, full precision,
// for the v2 self block of a client that advertises it (src/net/drive_recon_wire.ts
// decodes it). With the recon pose and the auras it is every state that shapes
// the pose; `fallStartY` and `jumping` are not carried, as they only feed fall
// damage and the coyote jump. Sparse fields fall back to 0 (st, sn, hb) or 1 (g, dg, c, sc);
// `vy` and `air` ride only while airborne. `ci` (the scrape reading) follows
// the `drv` rule, above 0.01 only: the kernel never reads it, the self scrape
// sparks do. `og`, `oc` and `ou` are the pilot's standing with the oil
// (RallySlickRecon: grip ticks left, the patch a crossing remembers, its ticks
// left), each omitted at 0 or none, so the client predicts a slide the server
// is about to hand out instead of correcting it a round trip late.

import type { RallySlickRecon } from '../src/sim/realm_racers_slick_contact';
import type { Entity } from '../src/sim/types';

export type DriveReconWire = Record<string, number | string>;

export function driveReconWire(
  e: Entity,
  slick: RallySlickRecon | null = null,
): DriveReconWire | undefined {
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
  if (slick) {
    if (slick.gripLeft > 0) out.og = slick.gripLeft;
    if (slick.contactId !== null) {
      out.oc = slick.contactId;
      if (slick.contactLeft > 0) out.ou = slick.contactLeft;
    }
  }
  return out;
}
