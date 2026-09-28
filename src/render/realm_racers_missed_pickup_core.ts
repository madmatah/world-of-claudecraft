// Whether a pickup box someone ELSE just took was one the viewer was going for.
// Three-free, so a plain Vitest drives it; the cue itself is drawn by
// realm_racers_field_cues.ts.
//
// The box goes where the server says it went: a rival drawn in the local kart's
// time frame can reach a box on screen a moment after the server already handed
// it to them. The "missed" cue names that moment instead of leaving a box that
// simply vanishes in front of the viewer's nose.
//
// CONTESTING is deliberately simple and deterministic: the viewer's kart was
// within a small radius of the box and closing on it at a real speed when it
// was taken. A kart parked beside a box, driving away from it, or a box across
// the circuit is not a race the viewer lost, and the viewer's own take never is.

import type { SelfDriveSource } from './self_drive_view_core';

/** How close the viewer's kart must be to a box to have been contesting it,
 *  yards: a little under half a second of road at race speed. */
export const RALLY_MISSED_PICKUP_RADIUS_YD = 9;
/** How fast the kart must be closing on the box, yards per second. */
export const RALLY_MISSED_PICKUP_MIN_CLOSING_YD_S = 3;

/** The viewer's kart at the moment of the take: its position and world-space
 *  velocity (`vehicleVelocityX` / `vehicleVelocityZ`). */
export interface RallyContestKart {
  x: number;
  z: number;
  velocityX: number;
  velocityZ: number;
}

/**
 * True when a take by `takerId` of the box at (`boxX`, `boxZ`) is a box the
 * viewer (`selfId`, driving `kart`) was contesting and lost. `kart` is null
 * while the viewer is not driving a race, which is never a miss.
 */
export function rallyPickupMissed(
  selfId: number,
  kart: RallyContestKart | null,
  takerId: number,
  boxX: number,
  boxZ: number,
): boolean {
  if (kart === null || takerId === selfId) return false;
  const dx = boxX - kart.x;
  const dz = boxZ - kart.z;
  const distance = Math.hypot(dx, dz);
  if (distance > RALLY_MISSED_PICKUP_RADIUS_YD) return false;
  const speed = Math.hypot(kart.velocityX, kart.velocityZ);
  // On top of the box there is no direction to close along: moving at all is
  // contesting it.
  if (distance < 1e-6) return speed >= RALLY_MISSED_PICKUP_MIN_CLOSING_YD_S;
  const closing = (kart.velocityX * dx + kart.velocityZ * dz) / distance;
  return closing >= RALLY_MISSED_PICKUP_MIN_CLOSING_YD_S;
}

/** The slice of the viewer's world the contest test reads: whether they are
 *  racing, and the mirror pose it falls back to. */
export interface RallyContestViewer {
  player: { pos: { x: number; z: number } };
  realmRacersInfo: { match: { phase: string } | null };
}

/** The kart as the viewer SEES it: the renderer's self render state
 *  (self_render_position_core.ts), whose drive view carries the drawn
 *  velocity on either wire. */
export interface RallySeenSelf {
  position: { x: number; z: number };
  active: boolean;
  ready: boolean;
  drive: { source: SelfDriveSource; velocityX: number; velocityZ: number };
}

/**
 * The viewer's kart as the contest test reads it, written into `out`, or null
 * while they are not driving a race (no match, a lobby, a countdown, a
 * finished race, on foot). It is the kart the viewer SEES: the drawn pose
 * while the self render is live (the predicted kart online), the mirror pose
 * otherwise (the same fallback `selfAimPose` takes), and the drive view's
 * velocity. Judging a miss off the mirror would measure a kart one echo behind
 * the one on screen.
 */
export function rallyContestKart(
  viewer: RallyContestViewer,
  seen: RallySeenSelf,
  out: RallyContestKart,
): RallyContestKart | null {
  const match = viewer.realmRacersInfo.match;
  if (!match || match.phase !== 'racing' || seen.drive.source === 'none') return null;
  const drawn = seen.active && seen.ready;
  out.x = drawn ? seen.position.x : viewer.player.pos.x;
  out.z = drawn ? seen.position.z : viewer.player.pos.z;
  out.velocityX = seen.drive.velocityX;
  out.velocityZ = seen.drive.velocityZ;
  return out;
}
