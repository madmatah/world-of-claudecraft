// The oil spray, decided: where a RIVAL's drop is drawn leaving the machine, and
// where each droplet of it is at a given moment. Three-free, so a plain Vitest
// drives it; the painter is realm_racers_oil_spray.ts.
//
// The patch itself stays where the server laid it: it grips where it is drawn,
// so a patch drawn anywhere else would lie about the road. What this softens is
// the gap between the machine a viewer SEES (a rival is drawn in the local
// kart's time frame, remote_vehicle_display_core.ts) and a patch that appears
// behind it: a short spray from the drawn tail to the patch says which machine
// laid it and that it just happened.
//
// The LOCAL pilot's own drop never sprays: its patch is painted provisionally
// under the drawn machine at the press (the slick layer's `dropProvisional`).

import { REALM_RACERS_SLICK_RADIUS } from '../sim/realm_racers_slicks';
import type { RemoteVehicleDisplayState } from './remote_vehicle_display_core';

/** How far behind the drawn machine's centre the spray leaves, yards. */
export const RALLY_OIL_SPRAY_TAIL_YD = 1.6;
/** Height over the ground at the tail, yards. */
export const RALLY_OIL_SPRAY_LIFT_YD = 0.55;
/** The longest spray drawn, yards: a drawn rival further from its patch than
 *  this (a snap, a reset) sprays from this far out along the same line. */
export const RALLY_OIL_SPRAY_MAX_REACH_YD = 14;
/** Droplets per spray, how long after the first the last one leaves, and how
 *  long each one is in the air, seconds. */
export const RALLY_OIL_SPRAY_DROPLETS = 12;
export const RALLY_OIL_SPRAY_STAGGER_SEC = 0.14;
export const RALLY_OIL_SPRAY_FLIGHT_SEC = 0.22;
/** A spray is over once its last droplet has landed. */
export const RALLY_OIL_SPRAY_SECONDS = RALLY_OIL_SPRAY_STAGGER_SEC + RALLY_OIL_SPRAY_FLIGHT_SEC;
/** Peak height of a droplet's arc over the straight line, yards. */
export const RALLY_OIL_SPRAY_ARC_YD = 0.9;
/** Fraction of the patch radius the droplets land inside. */
const LANDING_SPREAD = 0.7;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface RallyOilSprayPath {
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
}

/**
 * The spray a `realmRacersSlickDropped` event draws, or null for the viewer's
 * own drop. It leaves the tail of the machine as DRAWN (its live display
 * state), and lands on the event's point, which is where the server laid the
 * patch. A dropper with no live display sprays from the patch itself (a splash
 * in place), the same fallback the rival muzzle takes. Written into `out`, so
 * a drop allocates nothing.
 */
export function rallyOilSprayPath(
  views: ReadonlyMap<number, { remoteVehicle: Readonly<RemoteVehicleDisplayState> }>,
  drop: { sourceId: number; x: number; z: number },
  selfId: number,
  out: RallyOilSprayPath,
): RallyOilSprayPath | null {
  if (drop.sourceId === selfId) return null;
  const display = views.get(drop.sourceId)?.remoteVehicle;
  let fromX = drop.x;
  let fromZ = drop.z;
  if (display?.active) {
    fromX = display.x - Math.sin(display.facing) * RALLY_OIL_SPRAY_TAIL_YD;
    fromZ = display.z - Math.cos(display.facing) * RALLY_OIL_SPRAY_TAIL_YD;
  }
  const dx = fromX - drop.x;
  const dz = fromZ - drop.z;
  const reach = Math.hypot(dx, dz);
  if (reach > RALLY_OIL_SPRAY_MAX_REACH_YD) {
    const k = RALLY_OIL_SPRAY_MAX_REACH_YD / reach;
    fromX = drop.x + dx * k;
    fromZ = drop.z + dz * k;
  }
  out.fromX = fromX;
  out.fromZ = fromZ;
  out.toX = drop.x;
  out.toZ = drop.z;
  return out;
}

export interface RallyOilDroplet {
  x: number;
  y: number;
  z: number;
  /** 0 while the droplet is not in the air (not launched yet, or landed). */
  scale: number;
}

/**
 * Where droplet `index` of a spray is `elapsed` seconds in, written into `out`
 * (allocation-free). Each droplet leaves the tail in turn and lands on its own
 * point of the patch, spread across the disk on a golden-angle spiral so the
 * spray reads as oil spreading rather than one blob. `fromY` and `toY` are the
 * heights at the two ends.
 */
export function rallyOilDropletAt(
  path: RallyOilSprayPath,
  fromY: number,
  toY: number,
  index: number,
  elapsed: number,
  out: RallyOilDroplet,
): RallyOilDroplet {
  const launch = (index / RALLY_OIL_SPRAY_DROPLETS) * RALLY_OIL_SPRAY_STAGGER_SEC;
  const u = (elapsed - launch) / RALLY_OIL_SPRAY_FLIGHT_SEC;
  if (!(u > 0 && u < 1)) {
    out.scale = 0;
    return out;
  }
  const r =
    REALM_RACERS_SLICK_RADIUS *
    LANDING_SPREAD *
    Math.sqrt((index + 0.5) / RALLY_OIL_SPRAY_DROPLETS);
  const angle = index * GOLDEN_ANGLE;
  const landX = path.toX + Math.cos(angle) * r;
  const landZ = path.toZ + Math.sin(angle) * r;
  out.x = path.fromX + (landX - path.fromX) * u;
  out.z = path.fromZ + (landZ - path.fromZ) * u;
  out.y = fromY + (toY - fromY) * u + RALLY_OIL_SPRAY_ARC_YD * 4 * u * (1 - u);
  out.scale = 1 - 0.4 * u;
  return out;
}
