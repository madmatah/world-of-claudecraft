// The circuit editor's 3D preview camera: the orbit rig's clamps and the
// fly-through pose.
//
// The property that matters most is the LAP SEAM. The fly-through exists to
// answer "what does the pilot see here", and the start straight is the stretch
// an operator re-reads most, so a camera that jumps as `s` wraps past the start
// line would be lying at exactly the wrong moment.

import { describe, expect, it } from 'vitest';
import {
  advanceFlyThrough,
  circuitLocalSample,
  createFlyLook,
  createPreviewOrbit,
  FLY_LOOK_MAX_PITCH,
  flyLookDrag,
  flyLookPose,
  flySpeedYardsPerSecond,
  flyThroughPose,
  flyThroughPoseAt,
  orbitDrag,
  orbitFrame,
  orbitLookAt,
  orbitPan,
  orbitPose,
  orbitZoom,
  PREVIEW_CHASE_PROFILE,
  PREVIEW_FLY_SPEED_FRACTIONS,
  PREVIEW_ORBIT_LIMITS,
  PREVIEW_PAN_LIMIT,
  PREVIEW_REBUILD_DEBOUNCE_MS,
} from '../src/editor/circuit/preview_camera_core';
import { MORTAR_OVERDRIVE_CAMERA_BOOM_PROFILE } from '../src/render/camera_boom_core';
import { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/mortar_overdrive/circuits';
import { VEHICLE_PROFILES } from '../src/sim/content/vehicles';
import {
  MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
  MORTAR_OVERDRIVE_ORIGIN,
} from '../src/sim/mortar_overdrive/layout';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';

/** The shipped profile, not a second copy of the arithmetic: a test that
 *  re-derives the chase would pass whatever the page happened to do. */
const CHASE = PREVIEW_CHASE_PROFILE;

const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('preview orbit rig', () => {
  it('clamps pitch to its band however far the pointer is dragged', () => {
    const state = createPreviewOrbit();
    orbitDrag(state, 0, 100_000);
    expect(state.pitch).toBe(PREVIEW_ORBIT_LIMITS.maxPitch);
    orbitDrag(state, 0, -100_000);
    expect(state.pitch).toBe(PREVIEW_ORBIT_LIMITS.minPitch);
  });

  it('never lets the pitch reach the horizon, where a flat circuit is a line', () => {
    expect(PREVIEW_ORBIT_LIMITS.minPitch).toBeGreaterThan(0);
    // Nor past straight down, where the rig would flip over its own target.
    expect(PREVIEW_ORBIT_LIMITS.maxPitch).toBeLessThan(Math.PI / 2);
    const state = createPreviewOrbit();
    orbitDrag(state, 0, -100_000);
    const pose = orbitPose(state);
    expect(pose.camera.y).toBeGreaterThan(pose.target.y);
  });

  it('leaves yaw unclamped so the circuit can be walked round in either direction', () => {
    const state = createPreviewOrbit();
    const start = state.yaw;
    orbitDrag(state, 400, 0);
    orbitDrag(state, 400, 0);
    expect(state.yaw).toBeLessThan(start);
    orbitDrag(state, -1600, 0);
    expect(state.yaw).toBeGreaterThan(start);
  });

  it('clamps zoom to its band in both directions', () => {
    const state = createPreviewOrbit();
    for (let i = 0; i < 200; i++) orbitZoom(state, 1000);
    expect(state.distance).toBe(PREVIEW_ORBIT_LIMITS.maxDistance);
    for (let i = 0; i < 200; i++) orbitZoom(state, -1000);
    expect(state.distance).toBe(PREVIEW_ORBIT_LIMITS.minDistance);
  });

  it('frames a circuit so its whole width fits the frustum, not just its centre', () => {
    const state = createPreviewOrbit();
    const fov = (62 * Math.PI) / 180;
    // The panel's real shape: a tall half-screen, where the HORIZONTAL field is
    // the one that binds and a size-based guess crops the circuit.
    orbitFrame(state, 220, 90, fov, 0.5);
    expect(state.target).toEqual({ x: 0, y: 0, z: 0 });
    const halfHorizontalSpan = state.distance * Math.tan(fov / 2) * 0.5;
    expect(halfHorizontalSpan).toBeGreaterThan(220);
  });

  it('pulls further back the narrower the panel gets', () => {
    const fov = (62 * Math.PI) / 180;
    const wide = createPreviewOrbit();
    const narrow = createPreviewOrbit();
    orbitFrame(wide, 220, 90, fov, 1.6);
    orbitFrame(narrow, 220, 90, fov, 0.5);
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });

  it('frames a circuit far wider than the band without leaving the zoom band', () => {
    const state = createPreviewOrbit();
    orbitFrame(state, 5000, 5000, (62 * Math.PI) / 180, 1);
    expect(state.distance).toBe(PREVIEW_ORBIT_LIMITS.maxDistance);
  });

  it('can frame the widest circuit the band allows in a half-screen panel', () => {
    // The ceiling exists for exactly this case: `MORTAR_OVERDRIVE_MAX_REGION_HALF_X`
    // yards of circuit read in a panel half as wide as it is tall.
    const state = createPreviewOrbit();
    const fov = (62 * Math.PI) / 180;
    orbitFrame(
      state,
      MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
      MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
      fov,
      0.5,
    );
    expect(state.distance).toBeLessThan(PREVIEW_ORBIT_LIMITS.maxDistance);
    expect(state.distance * Math.tan(fov / 2) * 0.5).toBeGreaterThan(
      MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
    );
  });

  it('stands the camera off the target by exactly the orbit distance', () => {
    const state = createPreviewOrbit();
    orbitDrag(state, 137, 41);
    orbitZoom(state, -220);
    const pose = orbitPose(state);
    expect(distance(pose.camera, pose.target)).toBeCloseTo(state.distance, 6);
  });
});

describe('panning the orbit rig', () => {
  // Why it exists: a target pinned on the origin makes half of a big circuit
  // unreachable, so the far corners of an 1100 yard lap cannot be inspected.
  it('slides the target across the ground, leaving the angles and distance alone', () => {
    const state = createPreviewOrbit();
    const { yaw, pitch, distance: was } = state;
    orbitPan(state, 60, -25);
    expect(state.yaw).toBe(yaw);
    expect(state.pitch).toBe(pitch);
    expect(state.distance).toBe(was);
    expect(state.target.y).toBe(0);
    expect(Math.hypot(state.target.x, state.target.z)).toBeGreaterThan(0);
  });

  it('moves the ground the way the pointer went, in the CAMERA basis', () => {
    // At yaw = 0 the camera looks along +z, so its screen right is world -x:
    // dragging right must send the target the other way, +x, which is what makes
    // the ground under the pointer follow the pointer.
    const state = createPreviewOrbit();
    state.yaw = 0;
    orbitPan(state, 100, 0);
    expect(state.target.x).toBeGreaterThan(0);
    expect(state.target.z).toBeCloseTo(0, 6);
    // A quarter turn later the same drag moves it along z instead.
    const turned = createPreviewOrbit();
    turned.yaw = Math.PI / 2;
    orbitPan(turned, 100, 0);
    expect(Math.abs(turned.target.z)).toBeGreaterThan(Math.abs(turned.target.x));
  });

  it('moves the ground the way the pointer went VERTICALLY too', () => {
    // The other half of the pan, and it was unprotected: every other test passes
    // dy = 0 or a clamped extreme, so dropping the forward term or flipping its
    // sign shipped green. At yaw = 0 the camera looks along +z, so dragging DOWN
    // has to send the target along +z, bringing the ground down with the pointer.
    const state = createPreviewOrbit();
    state.yaw = 0;
    orbitPan(state, 0, 100);
    expect(state.target.z).toBeGreaterThan(0);
    expect(state.target.x).toBeCloseTo(0, 6);
    // And back the other way, so a sign flip cannot hide behind an absolute.
    const up = createPreviewOrbit();
    up.yaw = 0;
    orbitPan(up, 0, -100);
    expect(up.target.z).toBeLessThan(0);
  });

  it('reaches a corner at the region edge, which is what the pan exists for', () => {
    // Only the ceiling side was pinned, and against itself: dropping the limit to
    // 100 would keep every other test green while making the far side of a legal
    // circuit unreachable again.
    expect(PREVIEW_PAN_LIMIT).toBeGreaterThan(MORTAR_OVERDRIVE_MAX_REGION_HALF_X);
  });

  it('pans further per pixel the further out the camera is', () => {
    const near = createPreviewOrbit();
    near.distance = 40;
    const far = createPreviewOrbit();
    far.distance = 400;
    orbitPan(near, 50, 0);
    orbitPan(far, 50, 0);
    // Same gesture, ten times the reach: what keeps the ground under the pointer
    // moving with the pointer at every zoom.
    expect(Math.hypot(far.target.x, far.target.z)).toBeCloseTo(
      Math.hypot(near.target.x, near.target.z) * 10,
      4,
    );
  });

  it('cannot be dragged off into empty band, with no way back but Fit', () => {
    const state = createPreviewOrbit();
    state.distance = PREVIEW_ORBIT_LIMITS.maxDistance;
    for (let i = 0; i < 200; i++) orbitPan(state, 500, 500);
    expect(Math.abs(state.target.x)).toBeLessThanOrEqual(PREVIEW_PAN_LIMIT);
    expect(Math.abs(state.target.z)).toBeLessThanOrEqual(PREVIEW_PAN_LIMIT);
  });

  it('puts the target on a named point, which is what a plan double-click says', () => {
    const state = createPreviewOrbit();
    orbitDrag(state, 90, 20);
    const { yaw, pitch } = state;
    orbitLookAt(state, -140, 88);
    expect(state.target).toEqual({ x: -140, y: 0, z: 88 });
    // Looking somewhere else is not looking from somewhere else.
    expect(state.yaw).toBe(yaw);
    expect(state.pitch).toBe(pitch);
    // Clamped by the same limit a pan is, so a stray coordinate cannot lose it.
    orbitLookAt(state, 99_999, -99_999);
    expect(state.target.x).toBe(PREVIEW_PAN_LIMIT);
    expect(state.target.z).toBe(-PREVIEW_PAN_LIMIT);
  });

  it('is undone by Fit, which returns the target to the circuit centre', () => {
    const state = createPreviewOrbit();
    orbitPan(state, 400, 400);
    orbitFrame(state, 200, 120, (62 * Math.PI) / 180, 1.6);
    expect(state.target).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('looking around from the seat', () => {
  const track = mortarOverdriveTrack(GARDEN);
  const chase = (): ReturnType<typeof flyThroughPoseAt> =>
    flyThroughPoseAt(track, 120, MORTAR_OVERDRIVE_ORIGIN);

  it('is the chase pose exactly, until the head turns', () => {
    const look = createFlyLook();
    expect(look).toEqual({ yaw: 0, pitch: 0 });
    expect(flyLookPose(chase(), look)).toEqual(chase());
  });

  it('turns the LOOK and never the eye', () => {
    // The whole point: the camera stays where the game boom profile put it, so
    // what is on screen is still what a pilot at that point on the lap sees.
    const pose = chase();
    const look = createFlyLook();
    flyLookDrag(look, 200, 60);
    const turned = flyLookPose(pose, look);
    expect(turned.camera).toEqual(pose.camera);
    expect(turned.target).not.toEqual(pose.target);
  });

  it('raises the view for a positive pitch, and lowers it for a negative one', () => {
    // `flyLookDrag`'s signs are pinned, but the POSE applied them unchecked: an
    // inverted vertical inside `flyLookPose` shipped green.
    const pose = chase();
    const up = flyLookPose(pose, { yaw: 0, pitch: 0.3 });
    const down = flyLookPose(pose, { yaw: 0, pitch: -0.3 });
    expect(up.target.y).toBeGreaterThan(pose.target.y);
    expect(down.target.y).toBeLessThan(pose.target.y);
  });

  it('turns the look to opposite sides for opposite yaws, and never mirrors it', () => {
    // The only directional yaw test was a half turn, which is sign-symmetric, so
    // mirroring the horizontal (the one thing the module says must never happen)
    // passed.
    const pose = chase();
    const flat = (p: { camera: { x: number; z: number }; target: { x: number; z: number } }) => ({
      x: p.target.x - p.camera.x,
      z: p.target.z - p.camera.z,
    });
    const ahead = flat(pose);
    const left = flat(flyLookPose(pose, { yaw: 0.6, pitch: 0 }));
    const right = flat(flyLookPose(pose, { yaw: -0.6, pitch: 0 }));
    // The 2D cross product against the forward direction: opposite signs means
    // the two look to opposite sides of the road.
    const side = (v: { x: number; z: number }) => ahead.x * v.z - ahead.z * v.x;
    expect(Math.sign(side(left))).toBe(-Math.sign(side(right)));
    expect(side(left)).not.toBe(0);
  });

  it('keeps the look at the same range, so the view swings rather than zooms', () => {
    const pose = chase();
    const look = createFlyLook();
    flyLookDrag(look, -150, -40);
    const turned = flyLookPose(pose, look);
    expect(distance(turned.camera, turned.target)).toBeCloseTo(
      distance(pose.camera, pose.target),
      4,
    );
  });

  it('turns the head left for a rightward drag, and lifts it for an upward one', () => {
    const look = createFlyLook();
    flyLookDrag(look, 100, -100);
    expect(look.yaw).toBeLessThan(0);
    expect(look.pitch).toBeGreaterThan(0);
  });

  it('flips the VERTICAL when asked, and never the horizontal', () => {
    // Which way a downward drag tips the view is the axis people disagree about;
    // an inverted horizontal is nobody preference, so there is no switch for one.
    const direct = createFlyLook();
    const inverted = createFlyLook();
    flyLookDrag(direct, 80, 50);
    flyLookDrag(inverted, 80, 50, true);
    expect(inverted.pitch).toBeCloseTo(-direct.pitch, 10);
    expect(inverted.yaw).toBeCloseTo(direct.yaw, 10);
  });

  it('never rolls the view past vertical, however far the pointer is dragged', () => {
    const up = createFlyLook();
    const down = createFlyLook();
    for (let i = 0; i < 100; i++) {
      flyLookDrag(up, 0, -400);
      flyLookDrag(down, 0, 400);
    }
    expect(up.pitch).toBe(FLY_LOOK_MAX_PITCH);
    expect(down.pitch).toBe(-FLY_LOOK_MAX_PITCH);
    // And the ceiling is BELOW vertical, which is what the title claims. Pinned
    // only against itself, setting it to 2.0 would have passed.
    expect(FLY_LOOK_MAX_PITCH).toBeLessThan(Math.PI / 2);
    // Yaw is free: turning right round to look back down the road is legitimate.
    const spun = createFlyLook();
    for (let i = 0; i < 100; i++) flyLookDrag(spun, 400, 0);
    expect(Math.abs(spun.yaw)).toBeGreaterThan(Math.PI * 2);
  });

  it('looks behind on a half turn, which is how a mirror check reads', () => {
    const pose = chase();
    const look = { yaw: Math.PI, pitch: 0 };
    const turned = flyLookPose(pose, look);
    const forward = {
      x: pose.target.x - pose.camera.x,
      y: 0,
      z: pose.target.z - pose.camera.z,
    };
    const behind = {
      x: turned.target.x - turned.camera.x,
      y: 0,
      z: turned.target.z - turned.camera.z,
    };
    const dot = forward.x * behind.x + forward.z * behind.z;
    expect(dot).toBeLessThan(0);
  });
});

describe('preview fly-through', () => {
  const track = mortarOverdriveTrack(GARDEN);

  it('wraps s at the start line rather than running off the end of the lap', () => {
    const almost = track.length - 1;
    const wrapped = advanceFlyThrough(almost, 40, 0.1, track.length);
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(track.length);
    expect(wrapped).toBeCloseTo(almost + 4 - track.length, 6);
  });

  it('treats a zero-length lap and a negative dt as standing still', () => {
    expect(advanceFlyThrough(12, 40, 0.1, 0)).toBe(0);
    expect(advanceFlyThrough(12, 40, -5, track.length)).toBe(12);
  });

  it('crosses the lap seam without a camera snap', () => {
    // Step across s = 0 at race pace and compare the WRAPPING step to its
    // neighbours. A fixed yard bound would pass on a pose that snapped by two
    // yards at the seam; what has to hold is that the seam step is an ordinary
    // step, so it is measured against the median of the others.
    const speed = flySpeedYardsPerSecond('race', VEHICLE_PROFILES.mo_loaner.maxSpeed);
    const dt = 1 / 60;
    let s = track.length - speed * dt * 8;
    let previous = flyThroughPoseAt(track, s, MORTAR_OVERDRIVE_ORIGIN);
    const steps: number[] = [];
    let seamStep = -1;
    for (let step = 0; step < 16; step++) {
      const next = advanceFlyThrough(s, speed, dt, track.length);
      const wrapped = next < s;
      s = next;
      const pose = flyThroughPoseAt(track, s, MORTAR_OVERDRIVE_ORIGIN);
      const moved = distance(pose.camera, previous.camera);
      if (wrapped) seamStep = moved;
      else steps.push(moved);
      previous = pose;
    }
    expect(seamStep).toBeGreaterThanOrEqual(0);
    expect(steps.length).toBeGreaterThan(8);
    const sorted = [...steps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(0);
    expect(seamStep).toBeLessThan(median * 1.5);
  });

  it('rides the circuit where the preview stages it, not where the band is', () => {
    // The bug this pins shipped once and reads as a working preview aimed at
    // empty sky: the spline speaks WORLD coordinates (x = 113 700) while the
    // preview stages the circuit on the world origin, so an unconverted sample
    // parks the camera a hundred thousand yards away.
    const world = track.pointAt(0);
    expect(Math.abs(world.x)).toBeGreaterThan(100_000);
    const local = circuitLocalSample(world, MORTAR_OVERDRIVE_ORIGIN);
    expect(local.x).toBeCloseTo(world.x - MORTAR_OVERDRIVE_ORIGIN.x, 6);
    expect(local.z).toBeCloseTo(world.z - MORTAR_OVERDRIVE_ORIGIN.z, 6);
    expect(local.tx).toBe(world.tx);
    expect(local.tz).toBe(world.tz);
    // And the pose that follows sits within a boom length of the staged
    // circuit rather than out at the band.
    const pose = flyThroughPose(local, CHASE);
    expect(Math.hypot(pose.camera.x - local.x, pose.camera.z - local.z)).toBeLessThan(
      CHASE.boomDistance + 1,
    );
  });

  it('sits behind the machine and looks ahead of it, both along the tangent', () => {
    const point = { x: 100, z: -40, tx: 1, tz: 0 };
    const pose = flyThroughPose(point, CHASE);
    expect(pose.camera.x).toBeLessThan(point.x);
    expect(pose.camera.z).toBeCloseTo(point.z, 6);
    expect(pose.target.x).toBeCloseTo(point.x + CHASE.lookAhead, 6);
    expect(pose.target.z).toBeCloseTo(point.z, 6);
  });

  it('takes its chase numbers from the game Mortar Overdrive boom profile, not a copy', () => {
    // Pinned against the exported profile so a tuning pass on the game moves
    // the preview with it, which is the only reason the profile is a parameter.
    expect(PREVIEW_CHASE_PROFILE.boomDistance).toBe(
      12 * MORTAR_OVERDRIVE_CAMERA_BOOM_PROFILE.distanceScale,
    );
    expect(PREVIEW_CHASE_PROFILE.eyeHeight).toBe(MORTAR_OVERDRIVE_CAMERA_BOOM_PROFILE.eyeHeight);
    expect(PREVIEW_CHASE_PROFILE.boomDistance).toBeGreaterThan(12);
    expect(PREVIEW_CHASE_PROFILE.lookAhead).toBeGreaterThan(PREVIEW_CHASE_PROFILE.boomDistance);
  });

  it('poses straight off a track, with the world-to-stage conversion applied ONCE', () => {
    // The composed call is what preview3d uses, so the conversion cannot be
    // skipped by a caller: sampling and posing separately is what shipped the
    // 113 700 yard bug. Applied once, never twice.
    const posed = flyThroughPoseAt(track, 0, MORTAR_OVERDRIVE_ORIGIN);
    const byHand = flyThroughPose(
      circuitLocalSample(track.pointAt(0), MORTAR_OVERDRIVE_ORIGIN),
      CHASE,
    );
    expect(posed).toEqual(byHand);
    // The stage carries exactly the offset the conversion removes, so adding it
    // back lands on the world sample the spline authored.
    const world = track.pointAt(0);
    expect(posed.target.x + MORTAR_OVERDRIVE_ORIGIN.x).toBeCloseTo(
      world.x + world.tx * CHASE.lookAhead,
      6,
    );
    expect(posed.target.z + MORTAR_OVERDRIVE_ORIGIN.z).toBeCloseTo(
      world.z + world.tz * CHASE.lookAhead,
      6,
    );
    // Applied ONCE, not twice: a double subtraction would leave the camera a
    // second origin away in the other direction.
    expect(Math.abs(posed.camera.x)).toBeLessThan(1000);
  });

  it('rebuilds on a debounce inside the band an editing cadence wants', () => {
    // Too short and a drag rebuilds per pointermove (half a megabyte a frame);
    // too long and the tool reads as unresponsive.
    expect(PREVIEW_REBUILD_DEBOUNCE_MS).toBeGreaterThanOrEqual(250);
    expect(PREVIEW_REBUILD_DEBOUNCE_MS).toBeLessThanOrEqual(400);
  });

  it('derives its lift and stand-off from the Mortar Overdrive boom profile', () => {
    const point = { x: 0, z: 0, tx: 0, tz: 1 };
    const pose = flyThroughPose(point, CHASE);
    expect(pose.camera.y).toBeCloseTo(
      CHASE.boomDistance * Math.sin(CHASE.pitch) + MORTAR_OVERDRIVE_CAMERA_BOOM_PROFILE.eyeHeight,
      6,
    );
    expect(pose.camera.z).toBeCloseTo(-CHASE.boomDistance * Math.cos(CHASE.pitch), 6);
    // A tuning pass that stretches the game's Mortar Overdrive boom stretches the preview
    // with it, which is the whole reason the profile is a parameter.
    const stretched = flyThroughPose(point, { ...CHASE, boomDistance: CHASE.boomDistance * 2 });
    expect(stretched.camera.z).toBeLessThan(pose.camera.z);
  });

  it('offers a race pace under the machine top speed and a slower scenic one', () => {
    const top = VEHICLE_PROFILES.mo_loaner.maxSpeed;
    const race = flySpeedYardsPerSecond('race', top);
    const scenic = flySpeedYardsPerSecond('scenic', top);
    expect(race).toBeGreaterThan(scenic);
    expect(race).toBeLessThan(top);
    expect(PREVIEW_FLY_SPEED_FRACTIONS.race).toBeLessThan(1);
    // The pace an ace house pilot actually laps at: the garden circuit's 454
    // yard lap in roughly eleven seconds.
    expect(track.length / race).toBeGreaterThan(9);
    expect(track.length / race).toBeLessThan(13);
  });
});
