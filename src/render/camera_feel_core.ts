// Camera "feel" layer: velocity look-ahead, speed/impulse FOV kicks, and the
// display-side landing detector. Together with the spring boom
// (camera_boom_core.ts) this is the moment-to-moment AAA camera grammar:
//  - the look pivot LEADS into the run direction so the player sits slightly
//    behind screen center while moving (and recenters at rest);
//  - FOV widens a touch at above-run speeds (travel forms, ghost run, speed
//    buffs) and takes short punch impulses (landing dip, level-up flourish);
//  - landings are detected from the DISPLAY trajectory alone (works offline
//    and online, where the wire does not mirror vy/onGround), and report a
//    0..1 thump the renderer turns into an FOV dip + a trauma shake.
// Pure math, no Three/DOM; renderer.ts owns one state and steps it per frame.

import { RUN_SPEED } from '../sim/types';

export interface CameraFeelState {
  leadX: number;
  leadZ: number;
  speedKick: number;
  /** Transient FOV impulse (degrees), decays to 0. */
  punchKick: number;
  // Landing detector: last display height + last vertical display velocity,
  // plus how many consecutive frames the body has been falling fast. Only a
  // SUSTAINED fall thumps: an instant one-frame drop (sitting on a bench, a
  // short relocation) is a pose change, not a landing.
  lastY: number;
  lastVy: number;
  fallFrames: number;
  detectorActive: boolean;
  /** Positional shake lives in this same deterministic feel channel. */
  shakeTrauma: number;
  shakePhase: number;
}

export interface CameraFeelProfile {
  leadTime: number;
  leadMax: number;
  leadOmega: number;
  speedFovMax: number;
  speedKickStart: number;
  speedKickFull: number;
  /** Curve exponent after speed normalization. Below one widens earlier. */
  speedFovExponent: number;
  speedFovOmega: number;
  fovMin: number;
  fovMax: number;
  shakeDecay: number;
  shakeFrequency: number;
}

/** Seconds of travel the look pivot leads by while moving. */
export const LEAD_TIME = 0.13;
/** Lead cap (yards): keeps the player near center at any speed. */
export const LEAD_MAX = 1.0;
/** Lead ease rate (1/s): slow enough to never feel like a snap. */
export const LEAD_OMEGA = 4;
/** Max FOV widen (degrees) from sustained above-run speed. */
export const SPEED_FOV_MAX = 6;
/** Speed FOV ease rate (1/s). */
export const SPEED_FOV_OMEGA = 3;
/** Punch impulse decay rate (1/s). */
export const PUNCH_DECAY = 6;
/** Display fall speed (yd/s) where a landing starts to thump. A plain jump
 * lands around 6 yd/s; only harder falls register. */
export const THUMP_MIN_FALL = 7;
/** Fall speed for a full-strength (1.0) thump. */
export const THUMP_MAX_FALL = 20;
/** Consecutive fast-falling frames required before a settle may thump. */
export const THUMP_MIN_FALL_FRAMES = 3;
const MAX_STEP = 0.25;

export const DEFAULT_CAMERA_FEEL_PROFILE: CameraFeelProfile = {
  leadTime: LEAD_TIME,
  leadMax: LEAD_MAX,
  leadOmega: LEAD_OMEGA,
  speedFovMax: SPEED_FOV_MAX,
  speedKickStart: RUN_SPEED,
  speedKickFull: RUN_SPEED * 1.45,
  speedFovExponent: 1,
  speedFovOmega: SPEED_FOV_OMEGA,
  fovMin: -8,
  fovMax: 12,
  shakeDecay: 1.8,
  shakeFrequency: 60,
};

/** Wider, slower-settling chase grammar for the 60 yd/s rally machine. */
export const REALM_RACERS_CAMERA_FEEL_PROFILE: CameraFeelProfile = {
  leadTime: 0.22,
  leadMax: 3.5,
  leadOmega: 3,
  speedFovMax: 14,
  speedKickStart: 8,
  speedKickFull: 60,
  speedFovExponent: 0.5,
  speedFovOmega: 2.5,
  fovMin: -10,
  fovMax: 18,
  shakeDecay: 1.6,
  shakeFrequency: 54,
};

export function cameraFeelProfileForDriving(driving: boolean): CameraFeelProfile {
  return driving ? REALM_RACERS_CAMERA_FEEL_PROFILE : DEFAULT_CAMERA_FEEL_PROFILE;
}

export function createCameraFeel(): CameraFeelState {
  return {
    leadX: 0,
    leadZ: 0,
    speedKick: 0,
    punchKick: 0,
    lastY: 0,
    lastVy: 0,
    fallFrames: 0,
    detectorActive: false,
    shakeTrauma: 0,
    shakePhase: 0,
  };
}

const ease = (current: number, target: number, omega: number, dt: number): number =>
  target + (current - target) * Math.exp(-omega * dt);

/**
 * Advance the lead vector and FOV kicks. (vx, vz) is the horizontal DISPLAY
 * velocity in yd/s; `enabled` false (reduced-motion) eases everything home.
 */
export function stepCameraFeel(
  s: CameraFeelState,
  vx: number,
  vz: number,
  dt: number,
  enabled = true,
  profile: CameraFeelProfile = DEFAULT_CAMERA_FEEL_PROFILE,
): void {
  const step = Math.min(Math.max(dt, 0), MAX_STEP);
  const speed = Math.hypot(vx, vz);
  let targetX = 0;
  let targetZ = 0;
  let targetKick = 0;
  if (enabled && speed > 0.05) {
    const lead = Math.min(profile.leadMax, speed * profile.leadTime);
    targetX = (vx / speed) * lead;
    targetZ = (vz / speed) * lead;
    // Widen only ABOVE base run speed (travel form 1.4x maps to ~full kick).
    const speedProgress = Math.min(
      1,
      Math.max(
        0,
        (speed - profile.speedKickStart) / (profile.speedKickFull - profile.speedKickStart),
      ),
    );
    targetKick = profile.speedFovMax * speedProgress ** profile.speedFovExponent;
  }
  s.leadX = ease(s.leadX, targetX, profile.leadOmega, step);
  s.leadZ = ease(s.leadZ, targetZ, profile.leadOmega, step);
  s.speedKick = ease(s.speedKick, targetKick, profile.speedFovOmega, step);
  s.punchKick = ease(s.punchKick, 0, PUNCH_DECAY, step);
  if (!enabled) s.shakeTrauma = 0;
  else {
    s.shakePhase += step * profile.shakeFrequency;
    s.shakeTrauma = Math.max(0, s.shakeTrauma - step * profile.shakeDecay);
  }
}

/** Add a transient FOV impulse in degrees (negative = a dip, e.g. landings). */
export function punchCameraFov(s: CameraFeelState, degrees: number): void {
  s.punchKick += degrees;
}

/** Total FOV offset to add on top of the base camera FOV. */
export function cameraFovOffset(
  s: CameraFeelState,
  profile: CameraFeelProfile = DEFAULT_CAMERA_FEEL_PROFILE,
): number {
  const total = s.speedKick + s.punchKick;
  return Math.min(profile.fovMax, Math.max(profile.fovMin, total));
}

/** Select, step, and project the complete feel profile used by the renderer. */
export function stepCameraFeelForDriving(
  s: CameraFeelState,
  vx: number,
  vz: number,
  dt: number,
  enabled: boolean,
  driving: boolean,
): number {
  const profile = cameraFeelProfileForDriving(driving);
  stepCameraFeel(s, vx, vz, dt, enabled, profile);
  return cameraFovOffset(s, profile);
}

export function cameraFeelFovTarget(baseFov: number, feelOffset: number): number {
  return Math.min(100, Math.max(50, baseFov + feelOffset));
}

export function addCameraShake(s: CameraFeelState, amount: number): void {
  s.shakeTrauma = Math.min(1, s.shakeTrauma + Math.max(0, amount));
}

export function cameraShakeOffsetInto(
  s: CameraFeelState,
  out: { x: number; y: number; z: number },
): void {
  const intensity = s.shakeTrauma * s.shakeTrauma;
  if (intensity === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return;
  }
  out.x = Math.sin(s.shakePhase * 1.7) * intensity * 0.6;
  out.y = Math.sin(s.shakePhase * 2.3 + 1.1) * intensity * 0.45;
  out.z = Math.sin(s.shakePhase * 1.3 + 2.4) * intensity * 0.18;
}

/**
 * Feed the display height each frame; returns a 0..1 landing thump when the
 * trajectory transitions from a fast fall to settled, else 0. Purely
 * display-derived so it works identically offline and online, and never fires
 * on teleports (the discontinuity resets the detector instead).
 */
export function stepLandingDetector(s: CameraFeelState, y: number, dt: number): number {
  if (dt <= 0) return 0;
  if (!s.detectorActive) {
    s.detectorActive = true;
    s.lastY = y;
    s.lastVy = 0;
    s.fallFrames = 0;
    return 0;
  }
  const dy = y - s.lastY;
  const vy = dy / Math.min(Math.max(dt, 1e-4), MAX_STEP);
  const prevVy = s.lastVy;
  const fell = s.fallFrames;
  s.lastY = y;
  // A teleport (huge jump in either direction) resets rather than thumps.
  if (Math.abs(dy) > 6) {
    s.lastVy = 0;
    s.fallFrames = 0;
    return 0;
  }
  s.lastVy = vy;
  s.fallFrames = vy < -THUMP_MIN_FALL ? s.fallFrames + 1 : 0;
  if (prevVy < -THUMP_MIN_FALL && vy > -1 && fell >= THUMP_MIN_FALL_FRAMES) {
    return Math.min(1, (-prevVy - THUMP_MIN_FALL) / (THUMP_MAX_FALL - THUMP_MIN_FALL));
  }
  return 0;
}
