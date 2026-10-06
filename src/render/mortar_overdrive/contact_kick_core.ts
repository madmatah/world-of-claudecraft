// The bump, drawn at the touch: when the local kart and a drawn rival meet on
// screen (the local bump bang's own test, own_bump_feedback_core.ts), both are
// drawn moving by the velocity change the sim's contact resolver gives that
// pair, DISPLAY-ONLY, from that frame on. The server's contact reaches the
// screen about a round trip later, through a reconcile replay. The kick
// retires on the first replay after the touch frame's acknowledgement (or the
// touch tick plus the margin with none), not on the bump event (a contact under the event threshold
// or inside its throttle still moves both machines): its drawn shift is handed
// to the glides that carry the authoritative correction (the self display's
// handoff offset, the rival projection's drawn pose), so the replayed bump
// cancels it instead of adding to it, and a touch the server never had glides
// back out.
//
// The self shift is its own term of the drawn pose (self_render_position_core.ts
// steps the kick before it draws), so it is exact at any frame rate. Every pose
// a command is aimed from subtracts it (`displayedAimPose`); the own muzzle and
// oil cues follow that pose too, so they can sit up to the cap off the drawn
// kart while a kick lives. One kick at a time: a second rival touched meanwhile
// still bangs, but is not drawn. Nothing here is written into the prediction,
// the mirror or anything sent. Pure: no Three, no DOM, no clock.

import { vehicleProfile } from '../../sim/content/vehicles';
import type { VehicleDrive } from '../../sim/types';
import { type ContactBody, resolveVehicleContact } from '../../sim/vehicle_contact';
import { vehicleVelocityX, vehicleVelocityZ } from '../../sim/vehicle_motion';

/** Ticks past the touch's client tick an acknowledgement may still carry the
 *  server's contact: the rival is projected, so its touch can land a tick or
 *  two either side of the drawn one. Past it the touch was not the server's. */
export const CONTACT_KICK_MARGIN_TICKS = 2;
/** The largest velocity change drawn, yd/s: a hard ram's worth (the resolver's
 *  own ceiling, 39, is for the authoritative bump, not a guess). */
export const CONTACT_KICK_MAX_DV = 24;
/** The largest drawn shift, yd: half the rival projection's snap distance
 *  (REMOTE_VEHICLE_SNAP_DIST), so folding it in does not by itself pop a rival. */
export const CONTACT_KICK_MAX_SHIFT_YD = 3;

/** A drawn machine at the touch. `drive` is only read (copied first). */
export interface ContactKickBody {
  x: number;
  z: number;
  facing: number;
  drive: VehicleDrive;
  radius: number;
  mass: number;
}

export interface ContactKick {
  /** The rival the live kick is against, or -1. */
  rivalId: number;
  /** Velocity change at the touch, yd/s, world axes, capped. */
  selfVx: number;
  selfVz: number;
  rivalVx: number;
  rivalVz: number;
  /** The predicted client tick the touch was drawn in. */
  touchTick: number;
  /** The acknowledged client tick when the touch was drawn: any replay past
   *  it may be the server's contact, landed early or on time. */
  startAck: number;
  /** The drawn shifts so far, yd, capped. */
  selfX: number;
  selfZ: number;
  rivalX: number;
  rivalZ: number;
  /** A retired kick's rival shift, waiting for that rival's next projection
   *  step to fold it into the drawn pose; -1 when none. */
  handoffRivalId: number;
  handoffX: number;
  handoffZ: number;
  /** Self display frames the handoff has waited (it is due the frame it is
   *  made; a rival not drawn by the next one drops it). */
  handoffFrames: number;
}

export function createContactKick(): ContactKick {
  return {
    rivalId: -1,
    selfVx: 0,
    selfVz: 0,
    rivalVx: 0,
    rivalVz: 0,
    touchTick: 0,
    startAck: 0,
    selfX: 0,
    selfZ: 0,
    rivalX: 0,
    rivalZ: 0,
    handoffRivalId: -1,
    handoffX: 0,
    handoffZ: 0,
    handoffFrames: 0,
  };
}

function scratchBody(): ContactBody {
  return {
    x: 0,
    z: 0,
    facing: 0,
    drive: {
      profileKey: '',
      speed: 0,
      slip: 0,
      steerAngle: 0,
      yawRate: 0,
      spin: 0,
      handbrake: 0,
      gripMult: 1,
      dragMult: 1,
      speedCap: 1,
      slipCap: 1,
      collisionImpact: 0,
      controlsLocked: false,
    },
    radius: 0,
    mass: 1,
  };
}

const selfScratch = scratchBody();
const rivalScratch = scratchBody();
const capped = { x: 0, z: 0 };

function load(into: ContactBody, from: ContactKickBody): void {
  into.x = from.x;
  into.z = from.z;
  into.facing = from.facing;
  Object.assign(into.drive, from.drive);
  into.radius = from.radius;
  into.mass = from.mass;
}

function cap(x: number, z: number, max: number): { x: number; z: number } {
  const length = Math.hypot(x, z);
  const scale = length > max ? max / length : 1;
  capped.x = x * scale;
  capped.z = z * scale;
  return capped;
}

/**
 * Start a kick at a drawn touch: the sim's own resolver run on copies of the
 * two drawn machines gives each one's velocity change. `startAck` is the
 * acknowledged client tick of the frame, `touchTick` the predicted client tick
 * the touch is drawn in (the head's). False (nothing started) while another
 * kick is live, or when the pair is not closing.
 */
export function startContactKick(
  kick: ContactKick,
  self: ContactKickBody,
  rival: ContactKickBody,
  rivalId: number,
  startAck: number,
  touchTick: number,
): boolean {
  // One at a time, and never over a handoff still waiting to fold.
  if (kick.rivalId !== -1 || kick.handoffRivalId !== -1) return false;
  load(selfScratch, self);
  load(rivalScratch, rival);
  const selfVx = vehicleVelocityX(selfScratch.drive, self.facing);
  const selfVz = vehicleVelocityZ(selfScratch.drive, self.facing);
  const rivalVx = vehicleVelocityX(rivalScratch.drive, rival.facing);
  const rivalVz = vehicleVelocityZ(rivalScratch.drive, rival.facing);
  const contact = resolveVehicleContact(selfScratch, rivalScratch);
  if (!contact.contacted || !(contact.impact > 0)) return false;
  let dv = cap(
    vehicleVelocityX(selfScratch.drive, self.facing) - selfVx,
    vehicleVelocityZ(selfScratch.drive, self.facing) - selfVz,
    CONTACT_KICK_MAX_DV,
  );
  kick.selfVx = dv.x;
  kick.selfVz = dv.z;
  dv = cap(
    vehicleVelocityX(rivalScratch.drive, rival.facing) - rivalVx,
    vehicleVelocityZ(rivalScratch.drive, rival.facing) - rivalVz,
    CONTACT_KICK_MAX_DV,
  );
  kick.rivalVx = dv.x;
  kick.rivalVz = dv.z;
  kick.rivalId = rivalId;
  kick.startAck = startAck;
  kick.touchTick = touchTick;
  kick.selfX = 0;
  kick.selfZ = 0;
  kick.rivalX = 0;
  kick.rivalZ = 0;
  return true;
}

/** A drawn machine as the race scene sees it at the touch. */
export interface ContactKickPose {
  x: number;
  z: number;
  facing: number;
  drive: VehicleDrive;
}

const selfBody: ContactKickBody = {
  x: 0,
  z: 0,
  facing: 0,
  drive: selfScratch.drive,
  radius: 0,
  mass: 1,
};
const rivalBody: ContactKickBody = {
  x: 0,
  z: 0,
  facing: 0,
  drive: rivalScratch.drive,
  radius: 0,
  mass: 1,
};

function bodyOf(into: ContactKickBody, pose: ContactKickPose): ContactKickBody {
  const profile = vehicleProfile(pose.drive.profileKey);
  into.x = pose.x;
  into.z = pose.z;
  into.facing = pose.facing;
  into.drive = pose.drive;
  into.radius = profile.bodyRadius;
  into.mass = profile.mass;
  return into;
}

/** Let go of the live drives the bodies read, so a despawned rival's is not
 *  kept alive by the scratch. */
function releaseBodies(): void {
  selfBody.drive = selfScratch.drive;
  rivalBody.drive = rivalScratch.drive;
}

/**
 * The race scene's start at a seen touch: the self is the predicted machine as
 * drawn, the rival as projected, and the touch tick is the predicted head (the
 * acknowledged tick plus the display's tick offset).
 */
export function startContactKickAt(
  kick: ContactKick,
  self: ContactKickPose,
  rival: ContactKickPose,
  rivalId: number,
  ackTick: number,
  tickOffset: number,
): boolean {
  const started = startContactKick(
    kick,
    bodyOf(selfBody, self),
    bodyOf(rivalBody, rival),
    rivalId,
    ackTick,
    ackTick + tickOffset,
  );
  releaseBodies();
  return started;
}

/**
 * Has the acknowledgement that can carry the server's contact landed? Any
 * replay past the touch frame's acknowledgement may be that contact (a rival
 * drawn behind its server pose meets it early): retiring there costs a small
 * wobble at worst, since a later real replay is absorbed by its residual,
 * while waiting would draw an early contact twice. An acknowledgement past
 * the touch plus the margin with no replay means there was no contact.
 */
export function contactKickDue(kick: ContactKick, ackTick: number, replayed: boolean): boolean {
  if (kick.rivalId === -1) return false;
  if (replayed && ackTick > kick.startAck) return true;
  return ackTick >= kick.touchTick + CONTACT_KICK_MARGIN_TICKS;
}

/** One frame's growth of the live kick's shifts, `dt` seconds. */
export function growContactKick(kick: ContactKick, dt: number): void {
  if (kick.rivalId === -1) return;
  const step = Math.max(0, dt);
  let shift = cap(
    kick.selfX + kick.selfVx * step,
    kick.selfZ + kick.selfVz * step,
    CONTACT_KICK_MAX_SHIFT_YD,
  );
  kick.selfX = shift.x;
  kick.selfZ = shift.z;
  shift = cap(
    kick.rivalX + kick.rivalVx * step,
    kick.rivalZ + kick.rivalVz * step,
    CONTACT_KICK_MAX_SHIFT_YD,
  );
  kick.rivalX = shift.x;
  kick.rivalZ = shift.z;
}

/** End the live kick: the caller has handed the self shift to its glide; the
 *  rival's waits for that rival's next projection step. */
export function retireContactKick(kick: ContactKick): void {
  if (kick.rivalId === -1) return;
  kick.handoffRivalId = kick.rivalId;
  kick.handoffX = kick.rivalX;
  kick.handoffZ = kick.rivalZ;
  kick.handoffFrames = 0;
  kick.rivalId = -1;
  kick.selfX = 0;
  kick.selfZ = 0;
}

/** One self display frame of a waiting rival handoff: dropped once it has
 *  waited past the frame after it was made (that rival is not drawn). */
export function ageContactKickHandoff(kick: ContactKick): void {
  if (kick.handoffRivalId === -1) return;
  if (++kick.handoffFrames > 1) kick.handoffRivalId = -1;
}

/** Drop everything, the pending rival handoff included (a new character). */
export function resetContactKick(kick: ContactKick): void {
  kick.rivalId = -1;
  kick.selfX = 0;
  kick.selfZ = 0;
  kick.handoffRivalId = -1;
}

/**
 * Before `rivalId`'s projection step: fold a retired kick's shift into its
 * drawn pose, so the projection glides from where the rival is drawn to where
 * the server now has it. False when there is nothing to fold.
 */
export function foldContactKickHandoff(
  kick: ContactKick,
  rivalId: number,
  drawn: { x: number; z: number },
): boolean {
  if (kick.handoffRivalId !== rivalId) return false;
  drawn.x += kick.handoffX;
  drawn.z += kick.handoffZ;
  kick.handoffRivalId = -1;
  return true;
}

/** The live kick's shift of `rivalId`'s drawn pose this frame, added into
 *  `out`; false (and `out` untouched) for any other rival. */
export function contactKickRivalShift(
  kick: ContactKick,
  rivalId: number,
  out: { x: number; z: number },
): boolean {
  if (kick.rivalId !== rivalId) return false;
  out.x += kick.rivalX;
  out.z += kick.rivalZ;
  return true;
}
