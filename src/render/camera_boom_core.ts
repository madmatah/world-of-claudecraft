// Spring-arm pivot damping: the "camera lag" half of an Unreal-style
// SpringArm. The chase camera's LOOK pivot no longer rides the avatar
// rigidly; it is pulled toward the avatar by a critically damped spring with
// separate horizontal and vertical stiffness (vertical deliberately softer,
// so jumps, mantles, and landings read as weighty rises and settles instead
// of one-tick yanks). Pure math, no Three/DOM: renderer.ts owns one state and
// steps it per frame with the display position as the target.
//
// Safety properties, in order:
//  1. Exact closed-form critically damped update: stable and overshoot-free
//     at ANY frame dt (60 to 480 fps and load hitches alike).
//  2. Leashed: the pivot can never trail the avatar by more than the leash,
//     so fast motion keeps the player framed.
//  3. Snap on teleports (same 6 yd rule the renderer's self smoother uses).

export interface CameraBoomState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** False until the first step adopts the target outright. */
  active: boolean;
}

export interface CameraBoomProfile {
  omegaXZ: number;
  omegaY: number;
  leashXZ: number;
  leashY: number;
  distanceScale: number;
  eyeHeight: number;
}

/** Horizontal pull rate (1/s). Higher = tighter follow; ~70 ms of trail. */
export const BOOM_OMEGA_XZ = 12;
/** Vertical pull rate (1/s): softer, ~150 ms, the jump/land weight. */
export const BOOM_OMEGA_Y = 6.5;
/** The pivot never trails the avatar horizontally beyond this (yards). */
export const BOOM_LEASH_XZ = 1.1;
/** Vertical trail cap: below the jump apex so arcs stay fully framed. */
export const BOOM_LEASH_Y = 1.6;
/** Beyond this the motion is a teleport: adopt the target outright. */
export const BOOM_SNAP_DIST = 6;

export const DEFAULT_CAMERA_BOOM_PROFILE: CameraBoomProfile = {
  omegaXZ: BOOM_OMEGA_XZ,
  omegaY: BOOM_OMEGA_Y,
  leashXZ: BOOM_LEASH_XZ,
  leashY: BOOM_LEASH_Y,
  distanceScale: 1,
  eyeHeight: 2,
};

export const REALM_RACERS_CAMERA_BOOM_PROFILE: CameraBoomProfile = {
  omegaXZ: 9.5,
  omegaY: 5.5,
  leashXZ: 2.5,
  leashY: 1.9,
  distanceScale: 1.16,
  eyeHeight: 1.8,
};

export function cameraBoomProfileForDriving(driving: boolean): CameraBoomProfile {
  return driving ? REALM_RACERS_CAMERA_BOOM_PROFILE : DEFAULT_CAMERA_BOOM_PROFILE;
}

export function cameraBoomDistance(distance: number, profile: CameraBoomProfile): number {
  return distance * profile.distanceScale;
}

export function createCameraBoom(): CameraBoomState {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, active: false };
}

// One axis of the exact critically damped spring over dt.
// y(t) = (y0 + (v0 + w*y0)*t) * e^(-w*t), differentiated for the velocity.
function dampAxis(
  pos: number,
  vel: number,
  target: number,
  omega: number,
  dt: number,
): { pos: number; vel: number } {
  const y0 = pos - target;
  const e = Math.exp(-omega * dt);
  const t = (vel + omega * y0) * dt;
  return { pos: target + (y0 + t) * e, vel: (vel - omega * t) * e };
}

/**
 * Advance the boom pivot toward (tx, ty, tz) over dt seconds. `stiffness`
 * scales both pull rates up (reduced-motion mode passes a large value to make
 * the boom near-rigid without a separate code path).
 */
export function stepCameraBoom(
  s: CameraBoomState,
  tx: number,
  ty: number,
  tz: number,
  dt: number,
  stiffness = 1,
  profile: CameraBoomProfile = DEFAULT_CAMERA_BOOM_PROFILE,
): void {
  const dx = s.x - tx;
  const dy = s.y - ty;
  const dz = s.z - tz;
  if (!s.active || dx * dx + dy * dy + dz * dz > BOOM_SNAP_DIST * BOOM_SNAP_DIST) {
    s.x = tx;
    s.y = ty;
    s.z = tz;
    s.vx = 0;
    s.vy = 0;
    s.vz = 0;
    s.active = true;
    return;
  }
  const step = Math.min(Math.max(dt, 0), 0.25);
  const ax = dampAxis(s.x, s.vx, tx, profile.omegaXZ * stiffness, step);
  const az = dampAxis(s.z, s.vz, tz, profile.omegaXZ * stiffness, step);
  const ay = dampAxis(s.y, s.vy, ty, profile.omegaY * stiffness, step);
  s.x = ax.pos;
  s.vx = ax.vel;
  s.z = az.pos;
  s.vz = az.vel;
  s.y = ay.pos;
  s.vy = ay.vel;

  // Leash: clamp the trailing offset; the spring then decays the excess.
  const ox = s.x - tx;
  const oz = s.z - tz;
  const horiz = Math.hypot(ox, oz);
  if (horiz > profile.leashXZ) {
    const k = profile.leashXZ / horiz;
    s.x = tx + ox * k;
    s.z = tz + oz * k;
  }
  const oy = s.y - ty;
  if (oy > profile.leashY) s.y = ty + profile.leashY;
  else if (oy < -profile.leashY) s.y = ty - profile.leashY;
}

/** Select and execute the complete boom step used by the renderer. */
export function stepCameraBoomForDriving(
  s: CameraBoomState,
  tx: number,
  ty: number,
  tz: number,
  dt: number,
  stiffness: number,
  driving: boolean,
): CameraBoomProfile {
  const profile = cameraBoomProfileForDriving(driving);
  stepCameraBoom(s, tx, ty, tz, dt, stiffness, profile);
  return profile;
}
