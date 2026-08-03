import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyRealmRacersStartCamera,
  applyRealmRacersStartCameraFromWorld,
  createRealmRacersStartCamera,
  REALM_RACERS_HANDOFF_TICKS,
  REALM_RACERS_OVERVIEW_TICKS,
  REALM_RACERS_PANORAMA_TICKS,
  REALM_RACERS_START_TICKS,
  realmRacersStartCameraInput,
  stepRealmRacersStartCamera,
} from '../src/game/realm_racers_start_camera';
import type { CameraPose } from '../src/game/spawn_cinematic';
import {
  cameraBoomDistance,
  REALM_RACERS_CAMERA_BOOM_PROFILE,
} from '../src/render/camera_boom_core';
import {
  rallyDressingSpots,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from '../src/render/realm_racers_track_core';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import { realmRacersStarts } from '../src/sim/realm_racers_spline';
import { REALM_RACERS_COUNTDOWN_TICKS } from '../src/sim/social/realm_racers';
import { TICK_RATE } from '../src/sim/types';

/** renderer.ts CAMERA_BASE_FOV, the vertical FOV in degrees; pinned below. */
const CAMERA_BASE_FOV = 60;

/**
 * Where a start lamp lands vertically in frame, as a fraction of the half
 * frame: 0 is dead centre, 1 is the top edge. Reproduces the renderer's own
 * placement (updateCamera): the camera orbits the player at the boom distance
 * for the active driving profile and looks at their eye.
 *
 * Three things updateCamera also does are left out, each because it is zero for
 * a machine sitting still on a flat grid: the boom's lead/lag pivot offsets, the
 * camera-feel FOV kick, and the ground clamp under the camera. The clamp is the
 * one that could bite if a circuit ever started on a rise behind the grid, and
 * it would push the lamps DOWN in frame, against the lower bound below.
 */
function screenHeightOfLight(
  start: { x: number; z: number },
  pose: CameraPose,
  light: { x: number; z: number; lift: number },
): number {
  const boom = cameraBoomDistance(pose.dist, REALM_RACERS_CAMERA_BOOM_PROFILE);
  // Standing on the road at y = 0. The lamp's lift is measured from the grass
  // plane just under it, so reading it as road-relative overstates its height
  // by 0.12 yd, which only makes the in-frame assertion stricter.
  const eyeY = REALM_RACERS_CAMERA_BOOM_PROFILE.eyeHeight;
  const cam = {
    x: start.x - Math.sin(pose.yaw) * Math.cos(pose.pitch) * boom,
    y: eyeY + Math.sin(pose.pitch) * boom,
    z: start.z - Math.cos(pose.yaw) * Math.cos(pose.pitch) * boom,
  };
  const fwd = { x: start.x - cam.x, y: eyeY - cam.y, z: start.z - cam.z };
  const fl = Math.hypot(fwd.x, fwd.y, fwd.z);
  fwd.x /= fl;
  fwd.y /= fl;
  fwd.z /= fl;
  // right = forward x up(0,1,0), then up = right x forward.
  const right = { x: -fwd.z, y: 0, z: fwd.x };
  const rl = Math.hypot(right.x, right.z);
  right.x /= rl;
  right.z /= rl;
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };
  const v = { x: light.x - cam.x, y: light.lift - cam.y, z: light.z - cam.z };
  const depth = v.x * fwd.x + v.y * fwd.y + v.z * fwd.z;
  const height = v.x * up.x + v.y * up.y + v.z * up.z;
  return height / depth / Math.tan(((CAMERA_BASE_FOV / 2) * Math.PI) / 180);
}

/** How high the camera eye rides above the machine's own footing, in yards. */
function cameraEyeHeight(pose: CameraPose): number {
  const boom = cameraBoomDistance(pose.dist, REALM_RACERS_CAMERA_BOOM_PROFILE);
  return REALM_RACERS_CAMERA_BOOM_PROFILE.eyeHeight + Math.sin(pose.pitch) * boom;
}

describe('Realm Racers start camera', () => {
  it('pins one six-second panorama and the shared nine-second start', () => {
    expect(REALM_RACERS_PANORAMA_TICKS).toBe(120);
    expect(REALM_RACERS_OVERVIEW_TICKS).toBe(120);
    expect(REALM_RACERS_START_TICKS).toBe(180);
    expect(REALM_RACERS_START_TICKS).toBe(REALM_RACERS_COUNTDOWN_TICKS);
  });

  it('uses one uninterrupted move from the overview to the grid pose before three', () => {
    const state = createRealmRacersStartCamera();
    const input = {
      matchId: 7,
      phase: 'countdown' as const,
      countdownTicks: 180,
      elapsedTicks: 0,
      liveYaw: 0,
      facing: 1.1,
      liveDist: 15,
      reducedMotion: false,
    };
    const opening = stepRealmRacersStartCamera(state, input);
    expect(opening).toMatchObject({ pitch: 0.95, dist: 55 });
    expect(opening?.yaw).not.toBeCloseTo(input.facing, 3);

    const halfway = stepRealmRacersStartCamera(state, {
      ...input,
      countdownTicks: 120,
      facing: -2,
      liveDist: 8,
    });
    expect(halfway?.yaw).toBe(input.facing - 0.15 * Math.PI * 2);
    expect(halfway?.pitch).toBeCloseTo((0.95 + 0.2) / 2, 12);
    expect(halfway?.dist).toBe((55 + 22) / 2);

    const settled = stepRealmRacersStartCamera(state, {
      ...input,
      countdownTicks: 60,
      facing: -2,
      liveDist: 8,
    });
    expect(settled).toEqual({ yaw: 1.1, pitch: 0.2, dist: 22 });

    expect(
      stepRealmRacersStartCamera(state, { ...input, countdownTicks: 20, liveDist: 5 }),
    ).toEqual({ yaw: 1.1, pitch: 0.2, dist: 22 });
  });

  it('never zooms a far-out player back IN for the grid pose', () => {
    const state = createRealmRacersStartCamera();
    expect(
      stepRealmRacersStartCamera(state, {
        matchId: 8,
        phase: 'countdown',
        countdownTicks: 60,
        elapsedTicks: 0,
        liveYaw: 0,
        facing: 0.5,
        liveDist: 25,
        reducedMotion: false,
      }),
    ).toEqual({ yaw: 0.5, pitch: 0.2, dist: 25 });
  });

  it('keeps authoritative timing and the readable light framing under reduced motion', () => {
    // The lamps are a start signal, so reduced motion drops the sweep but keeps
    // the pose that puts them in frame; it leaves it by cutting, not gliding.
    // Driven through the host adapter on purpose: the cut is a WRITE, and a
    // release that only returns null would strand the whole race on the flat,
    // far grid pose (nothing else in the host restores pitch or distance).
    const state = createRealmRacersStartCamera();
    const camera = { camYaw: -0.7, camPitch: 0.32, camDist: 12 };
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 2, phase: 'countdown', countdownTicks: 180, elapsedTicks: 0 },
        -0.7,
        true,
      ),
    ).toBe(true);
    expect(camera).toEqual({ camYaw: -0.7, camPitch: 0.2, camDist: 22 });
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 2, phase: 'racing', countdownTicks: 0, elapsedTicks: 0 },
        -0.7,
        true,
      ),
    ).toBe(true);
    expect(camera).toEqual({ camYaw: -0.7, camPitch: 0.32, camDist: 12 });
  });

  it('holds the grid pose through the green light and hands back after the flag', () => {
    const state = createRealmRacersStartCamera();
    const base = {
      matchId: 12,
      phase: 'countdown' as const,
      countdownTicks: 0,
      elapsedTicks: 0,
      liveYaw: 0.4,
      facing: 0.4,
      liveDist: 12,
      reducedMotion: false,
    };
    // Lights out, GO: still the grid pose, which is the point of the handoff.
    expect(stepRealmRacersStartCamera(state, base)).toEqual({ yaw: 0.4, pitch: 0.2, dist: 22 });

    const racing = { ...base, phase: 'racing' as const };
    expect(stepRealmRacersStartCamera(state, racing)).toEqual({ yaw: 0.4, pitch: 0.2, dist: 22 });

    // Mid-handoff the pose is strictly between the two, and the yaw is handed
    // straight back so mouselook and the follow camera keep owning the heading.
    const mid = stepRealmRacersStartCamera(state, {
      ...racing,
      elapsedTicks: REALM_RACERS_HANDOFF_TICKS / 2,
      liveYaw: 1.9,
    });
    expect(mid?.yaw).toBe(1.9);
    expect(mid?.pitch).toBeCloseTo((0.2 + 0.32) / 2, 6);
    expect(mid?.dist).toBeCloseTo((22 + 12) / 2, 6);

    // The handoff ends by WRITING the gameplay pose, then releases.
    expect(
      stepRealmRacersStartCamera(state, {
        ...racing,
        elapsedTicks: REALM_RACERS_HANDOFF_TICKS,
        liveYaw: 1.9,
      }),
    ).toEqual({ yaw: 1.9, pitch: 0.32, dist: 12 });
    expect(
      stepRealmRacersStartCamera(state, { ...racing, elapsedTicks: 80, liveYaw: 1.9 }),
    ).toBeNull();
  });

  it('eases the handoff smoothly on the tick clock the sim actually reports', () => {
    // The regression this pins: `elapsed` is floored to whole seconds, so easing
    // on it would hold the grid pose for a full second and then pop.
    const state = createRealmRacersStartCamera();
    const base = {
      matchId: 13,
      phase: 'racing' as const,
      countdownTicks: 0,
      elapsedTicks: 0,
      liveYaw: 0,
      facing: 0,
      liveDist: 12,
      reducedMotion: false,
    };
    stepRealmRacersStartCamera(state, { ...base, phase: 'countdown', countdownTicks: 1 });
    let previous = { pitch: 0.2, dist: 22 };
    let steps = 0;
    for (let ticks = 0; ticks <= REALM_RACERS_HANDOFF_TICKS; ticks++) {
      const pose = stepRealmRacersStartCamera(state, { ...base, elapsedTicks: ticks });
      expect(pose).not.toBeNull();
      const next = pose as CameraPose;
      // No single tick may jump more than a fifth of the whole move.
      expect(Math.abs(next.pitch - previous.pitch)).toBeLessThan(0.2 * Math.abs(0.32 - 0.2));
      expect(Math.abs(next.dist - previous.dist)).toBeLessThan(0.2 * Math.abs(22 - 12));
      previous = next;
      steps++;
    }
    expect(steps).toBeGreaterThan(20); // a per-tick ease, not two whole-second jumps
    expect(previous).toMatchObject({ pitch: 0.32, dist: 12 });
  });

  it('leaves a mid-race joiner on the plain gameplay camera', () => {
    const state = createRealmRacersStartCamera();
    expect(
      stepRealmRacersStartCamera(state, {
        matchId: 44,
        phase: 'racing',
        countdownTicks: 0,
        elapsedTicks: 4,
        liveYaw: 0,
        facing: 0,
        liveDist: 12,
        reducedMotion: false,
      }),
    ).toBeNull();
  });

  it('frames the start lights well inside the frame for the whole lit sequence', () => {
    // Why this exists: the lamps hang 10.2 yd up under the arch beam and the grid
    // sits 7.4 yd behind the line, so the GAMEPLAY pose pushes them to the very
    // top edge. Project both poses and compare.
    const lights = rallyStartLightPlacements(GARDEN_CIRCUIT);
    // Walk the whole countdown and project only the ticks the lamps are
    // actually lit on, asked of the light schedule itself rather than a copy of
    // its threshold: moving the sequence must move this window with it.
    let litTicks = 0;
    for (const start of realmRacersStarts(GARDEN_CIRCUIT)) {
      const state = createRealmRacersStartCamera();
      for (let ticks = REALM_RACERS_START_TICKS; ticks >= 0; ticks--) {
        const pose = stepRealmRacersStartCamera(state, {
          matchId: 5,
          phase: 'countdown',
          countdownTicks: ticks,
          elapsedTicks: 0,
          liveYaw: 0,
          facing: start.facing,
          liveDist: 12,
          reducedMotion: false,
        });
        expect(pose).not.toBeNull();
        if (realmRacersStartLightSignal('countdown', ticks, 0).litCount === 0) continue;
        litTicks++;
        for (const light of lights) {
          const height = screenHeightOfLight(start, pose as CameraPose, light);
          expect(height).toBeLessThan(0.8);
          expect(height).toBeGreaterThan(0.2);
        }
      }
      // The pose this replaced put the same lamps at the top edge of the frame.
      for (const light of lights) {
        expect(
          screenHeightOfLight(start, { yaw: start.facing, pitch: 0.32, dist: 12 }, light),
        ).toBeGreaterThan(0.93);
      }
    }
    expect(litTicks).toBe(realmRacersStarts(GARDEN_CIRCUIT).length * (3 * TICK_RATE + 1));
  });

  it('never sits the grid eye lower than the gameplay camera it takes over from', () => {
    // The framing test above is satisfied by a LOW, level camera as happily as
    // by a raised one, and the first pose that passed it sat at 3.9 yd, a foot
    // and a half BELOW the gameplay eye: the start read as ground level. Pitch
    // and arm are what trade against each other here, so pin the height they
    // produce rather than either number on its own.
    const gameplay = cameraEyeHeight({ yaw: 0, pitch: 0.32, dist: 12 });
    const state = createRealmRacersStartCamera();
    const grid = stepRealmRacersStartCamera(state, {
      matchId: 61,
      phase: 'countdown',
      countdownTicks: 60,
      elapsedTicks: 0,
      liveYaw: 0,
      facing: 0,
      liveDist: 12,
      reducedMotion: false,
    });
    expect(cameraEyeHeight(grid as CameraPose)).toBeGreaterThan(gameplay);
    expect(cameraEyeHeight(grid as CameraPose)).toBeCloseTo(6.87, 2);
    expect(gameplay).toBeCloseTo(6.18, 2);
  });

  it('keeps the complete panorama clear of every circuit tree from both grid slots', () => {
    const trees = rallyDressingSpots(GARDEN_CIRCUIT).filter((spot) => spot.kind === 'tree');
    for (const start of realmRacersStarts(GARDEN_CIRCUIT)) {
      const state = createRealmRacersStartCamera();
      let nearestTree = Number.POSITIVE_INFINITY;
      for (let elapsed = 0; elapsed <= REALM_RACERS_PANORAMA_TICKS; elapsed++) {
        const pose = stepRealmRacersStartCamera(state, {
          matchId: 31,
          phase: 'countdown',
          countdownTicks: REALM_RACERS_START_TICKS - elapsed,
          elapsedTicks: 0,
          liveYaw: 0,
          facing: start.facing,
          liveDist: 12,
          reducedMotion: false,
        });
        expect(pose).not.toBeNull();
        const horizontalBoom =
          cameraBoomDistance(pose?.dist ?? 0, REALM_RACERS_CAMERA_BOOM_PROFILE) *
          Math.cos(pose?.pitch ?? 0);
        const cameraX = start.x - Math.sin(pose?.yaw ?? 0) * horizontalBoom;
        const cameraZ = start.z - Math.cos(pose?.yaw ?? 0) * horizontalBoom;
        for (const tree of trees) {
          nearestTree = Math.min(nearestTree, Math.hypot(cameraX - tree.x, cameraZ - tree.z));
        }
      }
      expect(nearestTree).toBeGreaterThan(12);
    }
  });

  it('gives two consecutive races back exactly the zoom the player set', () => {
    // Driven through the host adapter, since the trap is cumulative: a release
    // that never writes its endpoint leaves every race a little further out,
    // and the NEXT race captures that as the player's zoom.
    const state = createRealmRacersStartCamera();
    const camera = { camYaw: 0, camPitch: 0.32, camDist: 14 };
    for (const id of [1, 2]) {
      for (const ticks of [140, 60, 0])
        applyRealmRacersStartCamera(
          state,
          camera,
          { id, phase: 'countdown', countdownTicks: ticks, elapsedTicks: 0 },
          0.3,
          false,
        );
      expect(camera).toEqual({ camYaw: 0.3, camPitch: 0.2, camDist: 22 });
      for (let ticks = 0; ticks <= REALM_RACERS_HANDOFF_TICKS; ticks++)
        applyRealmRacersStartCamera(
          state,
          camera,
          { id, phase: 'racing', countdownTicks: 0, elapsedTicks: ticks },
          0.3,
          false,
        );
      expect(camera).toEqual({ camYaw: 0.3, camPitch: 0.32, camDist: 14 });
    }
  });

  it('cuts back to the gameplay pose when the race ends mid-handoff', () => {
    const state = createRealmRacersStartCamera();
    const camera = { camYaw: 0, camPitch: 0.32, camDist: 12 };
    applyRealmRacersStartCamera(
      state,
      camera,
      { id: 3, phase: 'countdown', countdownTicks: 40, elapsedTicks: 0 },
      0,
      false,
    );
    expect(camera).toMatchObject({ camPitch: 0.2, camDist: 22 });
    // A pilot who forfeits reads 'finished' straight out of the countdown; the
    // override owes them their own camera back rather than a silent release.
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 3, phase: 'finished', countdownTicks: 0, elapsedTicks: 4 },
        0,
        false,
      ),
    ).toBe(true);
    expect(camera).toEqual({ camYaw: 0, camPitch: 0.32, camDist: 12 });
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 3, phase: 'finished', countdownTicks: 0, elapsedTicks: 5 },
        0,
        false,
      ),
    ).toBe(false);
  });

  it('maps the live match mirror into the camera clock without losing host fields', () => {
    expect(
      realmRacersStartCameraInput(
        { id: 19, phase: 'racing', countdownTicks: 0, elapsedTicks: 51 },
        -1.2,
        0.5,
        16,
        true,
      ),
    ).toEqual({
      matchId: 19,
      phase: 'racing',
      countdownTicks: 0,
      elapsedTicks: 51,
      facing: -1.2,
      liveYaw: 0.5,
      liveDist: 16,
      reducedMotion: true,
    });
    expect(realmRacersStartCameraInput(null, 0.4, 0.5, 9, false)).toMatchObject({
      matchId: null,
      phase: null,
      countdownTicks: 0,
      elapsedTicks: 0,
      liveYaw: 0.5,
    });
  });

  it('executes the live host adapter and leaves gameplay camera ownership untouched', () => {
    const state = createRealmRacersStartCamera();
    const camera = { camYaw: 9, camPitch: 9, camDist: 15 };
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 21, phase: 'countdown', countdownTicks: 60, elapsedTicks: 0 },
        1.4,
        false,
      ),
    ).toBe(true);
    expect(camera).toEqual({ camYaw: 1.4, camPitch: 0.2, camDist: 22 });

    const world = {
      realmRacersInfo: {
        match: { id: 22, phase: 'countdown' as const, countdownTicks: 60, elapsedTicks: 0 },
      },
    };
    expect(applyRealmRacersStartCameraFromWorld(state, camera, world, -0.8, true)).toBe(true);
    expect(camera).toEqual({ camYaw: -0.8, camPitch: 0.2, camDist: 22 });

    // A match that vanishes (left the race, disconnected) still gets one cut
    // back to the gameplay pose, then hands the camera over for good.
    expect(applyRealmRacersStartCamera(state, camera, null, -2, false)).toBe(true);
    expect(camera).toEqual({ camYaw: -0.8, camPitch: 0.32, camDist: 22 });
    expect(applyRealmRacersStartCamera(state, camera, null, -2, false)).toBe(false);
    expect(camera).toEqual({ camYaw: -0.8, camPitch: 0.32, camDist: 22 });
  });

  it('wires the start override into both hosts and selects the driving feel profiles', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(main.match(/rallyCameraTick\(/g)).toHaveLength(2); // offline + online
    expect(main).toContain('const rallyCameraTick =');
    expect(main).toContain('applyRealmRacersStartCameraFromWorld(');
    expect(main).toContain('renderer.selfMotionFacing');
    expect(main).toMatch(
      /onlineJitterMs,\s+net\.lastSnapAt,\s+alpha,\s+frameDt,\s+selfDriveImpulse/,
    );
    expect(main).toContain('updateCamera(frameDt, onlineCameraFacing)');
    expect(main).toContain('rallyCameraTick(onlineCameraFacing)');
    // The light-framing projection above reproduces the renderer's vertical FOV.
    expect(renderer).toContain(`const CAMERA_BASE_FOV = ${CAMERA_BASE_FOV};`);
    expect(renderer).toContain('stepCameraBoomForDriving(');
    expect(renderer).toContain('stepCameraFeelForDriving(');
    expect(renderer).toContain('this.selfMotionPredictor.velocityX');
    expect(renderer).toContain('this.selfMotionPredictor.velocityZ');
    expect(renderer).toContain('vehicleVelocityX(p.drive, p.facing)');
    expect(renderer).toContain('vehicleVelocityZ(p.drive, p.facing)');
  });
});
