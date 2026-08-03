// Where the preview camera stands: the orbit rig's clamped state, and the
// fly-through pose that rides the racing line at a chosen pace.
//
// The two modes answer two different questions. Orbit answers "what shape did I
// draw", which is the 2D canvas one level up. The fly-through answers the one
// the schematic cannot: what a pilot SEES at the pinch, and whether a corner
// arrives with any warning at race pace.
//
// The chase numbers are not invented here. `REALM_RACERS_CAMERA_BOOM_PROFILE`
// (`src/render/camera_boom_core.ts`) is what the game's own camera runs while
// driving, so the eye height and the boom stretch come in as parameters and a
// tuning pass on the game moves the preview with it. The page supplies them;
// this file only does the arithmetic.
//
// Pure core: DOM-free, Three-free, deterministic, no clock. Yards throughout,
// and every coordinate is CIRCUIT-LOCAL (the preview subtracts
// `REALM_RACERS_ORIGIN` from the world coordinates the track builder authors).

import { REALM_RACERS_CAMERA_BOOM_PROFILE } from '../../render/camera_boom_core';

export interface PreviewPoint {
  x: number;
  y: number;
  z: number;
}

export interface PreviewPose {
  camera: PreviewPoint;
  target: PreviewPoint;
}

export interface PreviewOrbitState {
  /** Azimuth, radians. */
  yaw: number;
  /** Elevation, radians. */
  pitch: number;
  /** Distance from the target, yards. */
  distance: number;
  target: PreviewPoint;
}

/**
 * How far the orbit rig may be pushed.
 *
 * The pitch floor stays above the horizon: a circuit is a flat ribbon on a flat
 * band, so an eye-level orbit shows a line and nothing else.
 *
 * The distance ceiling has to frame the WIDEST circuit the band can hold, in
 * the NARROWEST panel it can be read in. `REALM_RACERS_MAX_REGION_HALF_X` is
 * 300, so 600 yards across; a half-screen panel is about half as wide as it is
 * tall, which cuts the horizontal field in half again. Anything less and the
 * biggest legal circuit cannot be seen whole.
 */
export const PREVIEW_ORBIT_LIMITS = {
  minPitch: 0.06,
  maxPitch: 1.45,
  minDistance: 8,
  maxDistance: 1400,
} as const;

/** Radians of orbit per pixel dragged: a full turn in about a screen width. */
const ORBIT_RADIANS_PER_PIXEL = 0.005;
/** Zoom sensitivity per wheel unit, applied multiplicatively. */
const ZOOM_PER_WHEEL_UNIT = 0.001;
/**
 * Yards the orbit target slides per pixel dragged, PER YARD of orbit distance.
 *
 * Scaled by the distance rather than fixed, so a pan feels the same zoomed out
 * over a whole lap and zoomed in on one corner: the thing under the pointer moves
 * with the pointer either way, which is the only pan that reads as grabbing the
 * ground.
 */
const PAN_YARDS_PER_PIXEL_PER_YARD = 0.0022;
/**
 * How far the orbit target may be slid from the circuit's own origin, yards.
 *
 * Generous against `REALM_RACERS_MAX_REGION_HALF_X` (300), because a pan is for
 * getting the eye onto a corner and the corner can be at the region's edge with
 * the camera further out still. What it prevents is the one failure a free pan
 * has: a target dragged off into empty band, with the circuit nowhere on screen
 * and no way back but Fit.
 */
export const PREVIEW_PAN_LIMIT = 900;

function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** The opening pose: high enough to see a whole lap, far enough to hold one. */
export function createPreviewOrbit(): PreviewOrbitState {
  return { yaw: Math.PI, pitch: 0.85, distance: 260, target: { x: 0, y: 0, z: 0 } };
}

export function orbitDrag(state: PreviewOrbitState, dxPixels: number, dyPixels: number): void {
  state.yaw -= dxPixels * ORBIT_RADIANS_PER_PIXEL;
  state.pitch = clamp(
    state.pitch + dyPixels * ORBIT_RADIANS_PER_PIXEL,
    PREVIEW_ORBIT_LIMITS.minPitch,
    PREVIEW_ORBIT_LIMITS.maxPitch,
  );
}

/**
 * Slide the orbit target across the ground, in the camera's own screen basis.
 *
 * Without this the rig could only ever circle one fixed point, so half a big
 * circuit was unreachable: the far corners of an 1100 yard lap are simply not
 * inspectable from a target pinned at the origin. The ground under the pointer
 * follows the pointer, which is why the basis is the camera's and not the
 * world's, and the target stays on the ground plane (`y`) because a circuit is
 * flat and a lifted target only ever tilts the horizon.
 */
export function orbitPan(state: PreviewOrbitState, dxPixels: number, dyPixels: number): void {
  const scale = state.distance * PAN_YARDS_PER_PIXEL_PER_YARD;
  // The horizontal forward (camera toward target) and the screen right derived
  // from it. Same yaw convention as `orbitPose`.
  const forwardX = Math.sin(state.yaw);
  const forwardZ = Math.cos(state.yaw);
  const rightX = -forwardZ;
  const rightZ = forwardX;
  // Opposite to the pointer in screen space, which is what "grab the ground"
  // means: drag right and the scene goes right, so the target goes left.
  state.target.x = clamp(
    state.target.x - rightX * dxPixels * scale + forwardX * dyPixels * scale,
    -PREVIEW_PAN_LIMIT,
    PREVIEW_PAN_LIMIT,
  );
  state.target.z = clamp(
    state.target.z - rightZ * dxPixels * scale + forwardZ * dyPixels * scale,
    -PREVIEW_PAN_LIMIT,
    PREVIEW_PAN_LIMIT,
  );
}

/**
 * Put the orbit target on a point, keeping the current angles and distance.
 *
 * What the plan is FOR: double-clicking a corner on the 2D plan is the shortest
 * way to say "look at that", and it needs no camera flying and no hunting.
 */
export function orbitLookAt(state: PreviewOrbitState, x: number, z: number): void {
  state.target.x = clamp(x, -PREVIEW_PAN_LIMIT, PREVIEW_PAN_LIMIT);
  state.target.y = 0;
  state.target.z = clamp(z, -PREVIEW_PAN_LIMIT, PREVIEW_PAN_LIMIT);
}

export function orbitZoom(state: PreviewOrbitState, wheelDelta: number): void {
  state.distance = clamp(
    state.distance * Math.exp(wheelDelta * ZOOM_PER_WHEEL_UNIT),
    PREVIEW_ORBIT_LIMITS.minDistance,
    PREVIEW_ORBIT_LIMITS.maxDistance,
  );
}

/** Breathing room around a framed circuit, so its dressing ring is not cropped
 *  flush against the panel edge. */
const FRAME_MARGIN = 1.15;

/**
 * Frame a circuit of the given half-extents, keeping the target on its centre.
 *
 * The distance is fitted to the FRUSTUM rather than guessed from the circuit's
 * size, because the panel is a tall narrow half-screen: its horizontal field is
 * much tighter than its vertical one, and a distance that frames a 400 yard
 * circuit in a wide viewport shows a third of it here. Pitch foreshortening is
 * ignored, which only ever pulls the camera further back than it needs.
 */
export function orbitFrame(
  state: PreviewOrbitState,
  halfX: number,
  halfZ: number,
  verticalFovRadians: number,
  aspect: number,
): void {
  state.target.x = 0;
  state.target.y = 0;
  state.target.z = 0;
  const vertical = 2 * Math.tan(verticalFovRadians / 2);
  const horizontal = vertical * Math.max(0.05, aspect);
  const needed = Math.max((2 * halfX) / horizontal, (2 * halfZ) / vertical);
  state.distance = clamp(
    needed * FRAME_MARGIN,
    PREVIEW_ORBIT_LIMITS.minDistance,
    PREVIEW_ORBIT_LIMITS.maxDistance,
  );
}

export function orbitPose(state: PreviewOrbitState): PreviewPose {
  const cosPitch = Math.cos(state.pitch);
  const sinPitch = Math.sin(state.pitch);
  return {
    camera: {
      x: state.target.x - Math.sin(state.yaw) * cosPitch * state.distance,
      y: state.target.y + sinPitch * state.distance,
      z: state.target.z - Math.cos(state.yaw) * cosPitch * state.distance,
    },
    target: { ...state.target },
  };
}

/**
 * Chase geometry for the fly-through, in the units the game's own driving
 * camera uses.
 *
 * `boomDistance` and `eyeHeight` come from
 * `REALM_RACERS_CAMERA_BOOM_PROFILE`; `pitch` is the gameplay chase pitch. The
 * lift is the boom's own rise (`distance * sin(pitch)`) plus the eye height, so
 * a tuning pass on either number moves the preview the same way it moves the
 * seat.
 */
export interface PreviewChaseProfile {
  boomDistance: number;
  pitch: number;
  eyeHeight: number;
  /** Yards ahead of the machine the camera looks, so a corner arrives framed. */
  lookAhead: number;
}

/**
 * A centerline sample in the preview's own frame.
 *
 * The spline authors WORLD coordinates, around `REALM_RACERS_ORIGIN` out at
 * x = 113 700; the preview stages the circuit on the world origin instead (see
 * `preview3d.ts`). Handing `flyThroughPose` a raw sample therefore parks the
 * camera a hundred thousand yards from the circuit it is meant to be riding,
 * which looks exactly like a working preview pointed at empty sky. One
 * conversion, in one place, so there is nowhere else to forget it.
 */
export function circuitLocalSample(
  sample: { x: number; z: number; tx: number; tz: number },
  origin: { x: number; z: number },
): { x: number; z: number; tx: number; tz: number } {
  return { x: sample.x - origin.x, z: sample.z - origin.z, tx: sample.tx, tz: sample.tz };
}

/**
 * The pose behind a point on the racing line.
 *
 * Depends on nothing but the sample handed in, which is what makes it
 * CONTINUOUS across the start line: `s` wrapping from just under the lap length
 * to just over zero moves the sample by one step, so the camera moves by one
 * step too. A pose carrying its own integrated state would snap there, and the
 * seam is exactly where an operator is looking when they check the start
 * straight.
 */
export function flyThroughPose(
  point: { x: number; z: number; tx: number; tz: number },
  profile: PreviewChaseProfile,
): PreviewPose {
  const lift = profile.boomDistance * Math.sin(profile.pitch) + profile.eyeHeight;
  const back = profile.boomDistance * Math.cos(profile.pitch);
  return {
    camera: {
      x: point.x - point.tx * back,
      y: lift,
      z: point.z - point.tz * back,
    },
    target: {
      x: point.x + point.tx * profile.lookAhead,
      y: profile.eyeHeight,
      z: point.z + point.tz * profile.lookAhead,
    },
  };
}

/**
 * Where the fly-through is LOOKING, relative to straight down the road.
 *
 * Zero is the chase pose, which is the one that answers "does this corner arrive
 * with any warning". Everything else is the operator turning their head: paused
 * at a corner exit, the question becomes what the dressing looks like from the
 * seat, and the chase pose cannot answer it because it only ever faces forward.
 */
export interface PreviewFlyLook {
  /** Radians left/right of the racing direction. */
  yaw: number;
  /** Radians up/down, clamped so the view never rolls past vertical. */
  pitch: number;
}

export const FLY_LOOK_MAX_PITCH = 1.15;
/** Radians of head turn per pixel dragged, matched to the orbit rig's feel. */
const FLY_LOOK_RADIANS_PER_PIXEL = 0.004;

export const createFlyLook = (): PreviewFlyLook => ({ yaw: 0, pitch: 0 });

/**
 * Turn the head by a drag.
 *
 * `invertPitch` flips the vertical only, which is the axis people genuinely
 * disagree about: pulling the pointer down either tips the view down (the
 * pointer IS the aim) or up (the pointer is the machine's stick). Nobody wants an
 * inverted horizontal, so there is no switch for one.
 */
export function flyLookDrag(
  look: PreviewFlyLook,
  dxPixels: number,
  dyPixels: number,
  invertPitch = false,
): void {
  look.yaw -= dxPixels * FLY_LOOK_RADIANS_PER_PIXEL;
  const vertical = (invertPitch ? -dyPixels : dyPixels) * FLY_LOOK_RADIANS_PER_PIXEL;
  look.pitch = clamp(look.pitch - vertical, -FLY_LOOK_MAX_PITCH, FLY_LOOK_MAX_PITCH);
}

/**
 * The same pose, looking somewhere else.
 *
 * It turns the LOOK and never the camera: the eye stays exactly where the chase
 * boom put it, so what the operator sees is still what a pilot at that point on
 * the lap would see, from the seat height the game's own boom profile gives them.
 * Moving the camera instead would answer a question about nowhere.
 */
export function flyLookPose(pose: PreviewPose, look: PreviewFlyLook): PreviewPose {
  if (look.yaw === 0 && look.pitch === 0) return pose;
  const dx = pose.target.x - pose.camera.x;
  const dy = pose.target.y - pose.camera.y;
  const dz = pose.target.z - pose.camera.z;
  const flat = Math.hypot(dx, dz);
  const range = Math.hypot(dx, dy, dz);
  if (!(range > 0)) return pose;
  const heading = Math.atan2(dx, dz) + look.yaw;
  const elevation = Math.atan2(dy, flat || 1e-6) + look.pitch;
  const cosEl = Math.cos(elevation);
  return {
    camera: { ...pose.camera },
    target: {
      x: pose.camera.x + Math.sin(heading) * cosEl * range,
      y: pose.camera.y + Math.sin(elevation) * range,
      z: pose.camera.z + Math.cos(heading) * cosEl * range,
    },
  };
}

/**
 * The gameplay chase pitch, radians. It matches `GAMEPLAY_PITCH` in
 * `src/game/realm_racers_start_camera.ts`, which keeps it module-private; the
 * preview is a dev tool and not worth widening that module's surface for.
 */
const CHASE_PITCH = 0.32;

/** The game's default camera distance (`Input.camDist`), before the rally boom
 *  profile stretches it. */
const CHASE_BASE_DISTANCE = 12;

/** Yards ahead the fly-through looks. About a second of race pace, which is
 *  what puts a corner on screen before the machine is committed to it. */
const CHASE_LOOK_AHEAD = 26;

/**
 * The chase the fly-through actually rides, derived here rather than in the
 * page so a test can pin it against the game's own profile instead of
 * re-deriving its own copy of the arithmetic (which would pass whatever the
 * page did).
 */
export const PREVIEW_CHASE_PROFILE: PreviewChaseProfile = {
  boomDistance: CHASE_BASE_DISTANCE * REALM_RACERS_CAMERA_BOOM_PROFILE.distanceScale,
  pitch: CHASE_PITCH,
  eyeHeight: REALM_RACERS_CAMERA_BOOM_PROFILE.eyeHeight,
  lookAhead: CHASE_LOOK_AHEAD,
};

/** The part of `RallyTrackModel` the fly-through reads. Structural, so the core
 *  needs no sim import to ride a real track. */
export interface PreviewTrackSampler {
  pointAt(s: number): { x: number; z: number; tx: number; tz: number };
}

/**
 * The whole fly-through pose for a lap position: sample, convert, pose.
 *
 * It is one call ON PURPOSE. Split across the page it was possible to sample
 * the track and pose from it while forgetting the conversion, which is exactly
 * the bug that shipped: the camera sat 113 700 yards from the circuit and the
 * preview looked like a working view of empty sky. There is nothing left for a
 * caller to forget.
 */
export function flyThroughPoseAt(
  track: PreviewTrackSampler,
  s: number,
  origin: { x: number; z: number },
  profile: PreviewChaseProfile = PREVIEW_CHASE_PROFILE,
): PreviewPose {
  return flyThroughPose(circuitLocalSample(track.pointAt(s), origin), profile);
}

/**
 * How long after the last edit the scene rebuilds, milliseconds.
 *
 * The builder is one call over a whole circuit and lands about half a megabyte
 * of geometry, which is fine at editing cadence and ruinous per pointermove. A
 * third of a second is under the "did it notice me" threshold while still
 * collapsing a drag into one build.
 */
export const PREVIEW_REBUILD_DEBOUNCE_MS = 320;

/**
 * Advance the fly-through along the lap, wrapping at the start line.
 *
 * Wrapped rather than clamped because a lap is a loop: a fly-through that
 * stopped at the line would never show the corner leading onto it, which is the
 * one an operator re-draws most.
 */
export function advanceFlyThrough(
  s: number,
  speedYardsPerSecond: number,
  dt: number,
  lapLength: number,
): number {
  if (!(lapLength > 0)) return 0;
  const next = s + speedYardsPerSecond * Math.max(0, dt);
  return ((next % lapLength) + lapLength) % lapLength;
}

/**
 * The two paces the fly-through offers, as FRACTIONS of the machine's top
 * speed, so a change to `VEHICLE_PROFILES` moves them.
 *
 * `race` is the pace an `ace` house pilot actually laps at rather than the
 * machine's ceiling: 1469 yards in about 37 seconds on the Express Tour, and
 * 454 in about 11 on the garden circuit, both landing near two thirds of the 60
 * yd/s top speed. That is the number that answers "does this corner arrive with
 * any warning". `scenic` is a walk-round, for reading the dressing.
 */
export const PREVIEW_FLY_SPEED_FRACTIONS = { race: 0.67, scenic: 0.2 } as const;

export type PreviewFlySpeed = keyof typeof PREVIEW_FLY_SPEED_FRACTIONS;

export function flySpeedYardsPerSecond(preset: PreviewFlySpeed, maxSpeed: number): number {
  return maxSpeed * PREVIEW_FLY_SPEED_FRACTIONS[preset];
}
