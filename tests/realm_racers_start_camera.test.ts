import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyRealmRacersStartCamera,
  applyRealmRacersStartCameraFromWorld,
  createRealmRacersStartCamera,
  REALM_RACERS_OVERVIEW_TICKS,
  REALM_RACERS_PANORAMA_TICKS,
  REALM_RACERS_START_TICKS,
  realmRacersStartCameraInput,
  stepRealmRacersStartCamera,
} from '../src/game/realm_racers_start_camera';
import {
  cameraBoomDistance,
  REALM_RACERS_CAMERA_BOOM_PROFILE,
} from '../src/render/camera_boom_core';
import { rallyDressingSpots } from '../src/render/realm_racers_track_core';
import { REALM_RACERS_COUNTDOWN_TICKS } from '../src/sim/social/realm_racers';
import { realmRacersStarts } from '../src/sim/realm_racers_spline';

describe('Realm Racers start camera', () => {
  it('pins one six-second panorama and the shared nine-second start', () => {
    expect(REALM_RACERS_PANORAMA_TICKS).toBe(120);
    expect(REALM_RACERS_OVERVIEW_TICKS).toBe(120);
    expect(REALM_RACERS_START_TICKS).toBe(180);
    expect(REALM_RACERS_START_TICKS).toBe(REALM_RACERS_COUNTDOWN_TICKS);
  });

  it('uses one uninterrupted move from the overview to the rear view before three', () => {
    const state = createRealmRacersStartCamera();
    const input = {
      matchId: 7,
      phase: 'countdown' as const,
      countdownTicks: 180,
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
    expect(halfway).toEqual({
      yaw: input.facing - 0.15 * Math.PI * 2,
      pitch: (0.95 + 0.32) / 2,
      dist: (55 + 15) / 2,
    });

    const settled = stepRealmRacersStartCamera(state, {
      ...input,
      countdownTicks: 60,
      facing: -2,
      liveDist: 8,
    });
    expect(settled).toEqual({ yaw: 1.1, pitch: 0.32, dist: 15 });

    expect(
      stepRealmRacersStartCamera(state, { ...input, countdownTicks: 20, liveDist: 5 }),
    ).toEqual({ yaw: 1.1, pitch: 0.32, dist: 15 });
  });

  it('keeps authoritative timing but removes the sweep under reduced motion', () => {
    const state = createRealmRacersStartCamera();
    expect(
      stepRealmRacersStartCamera(state, {
        matchId: 2,
        phase: 'countdown',
        countdownTicks: 180,
        facing: -0.7,
        liveDist: 12,
        reducedMotion: true,
      }),
    ).toEqual({ yaw: -0.7, pitch: 0.32, dist: 12 });
  });

  it('keeps the complete panorama clear of every circuit tree from both grid slots', () => {
    const trees = rallyDressingSpots().filter((spot) => spot.kind === 'tree');
    for (const start of realmRacersStarts()) {
      const state = createRealmRacersStartCamera();
      let nearestTree = Number.POSITIVE_INFINITY;
      for (let elapsed = 0; elapsed <= REALM_RACERS_PANORAMA_TICKS; elapsed++) {
        const pose = stepRealmRacersStartCamera(state, {
          matchId: 31,
          phase: 'countdown',
          countdownTicks: REALM_RACERS_START_TICKS - elapsed,
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

  it('releases the camera at GO and captures a fresh pose for the next race', () => {
    const state = createRealmRacersStartCamera();
    stepRealmRacersStartCamera(state, {
      matchId: 1,
      phase: 'countdown',
      countdownTicks: 140,
      facing: 0,
      liveDist: 14,
      reducedMotion: false,
    });
    expect(
      stepRealmRacersStartCamera(state, {
        matchId: 1,
        phase: 'racing',
        countdownTicks: 0,
        facing: 0,
        liveDist: 14,
        reducedMotion: false,
      }),
    ).toBeNull();
    const next = stepRealmRacersStartCamera(state, {
      matchId: 2,
      phase: 'countdown',
      countdownTicks: 60,
      facing: 2,
      liveDist: 9,
      reducedMotion: false,
    });
    expect(next).toEqual({ yaw: 2, pitch: 0.32, dist: 9 });
  });

  it('maps the live match mirror into the camera clock without losing host fields', () => {
    expect(
      realmRacersStartCameraInput(
        { id: 19, phase: 'countdown', countdownTicks: 73 },
        -1.2,
        16,
        true,
      ),
    ).toEqual({
      matchId: 19,
      phase: 'countdown',
      countdownTicks: 73,
      facing: -1.2,
      liveDist: 16,
      reducedMotion: true,
    });
    expect(realmRacersStartCameraInput(null, 0.4, 9, false)).toMatchObject({
      matchId: null,
      phase: null,
      countdownTicks: 0,
    });
  });

  it('executes the live host adapter and leaves gameplay camera ownership untouched', () => {
    const state = createRealmRacersStartCamera();
    const camera = { camYaw: 9, camPitch: 9, camDist: 15 };
    expect(
      applyRealmRacersStartCamera(
        state,
        camera,
        { id: 21, phase: 'countdown', countdownTicks: 60 },
        1.4,
        false,
      ),
    ).toBe(true);
    expect(camera).toEqual({ camYaw: 1.4, camPitch: 0.32, camDist: 15 });

    const world = {
      realmRacersInfo: {
        match: { id: 22, phase: 'countdown' as const, countdownTicks: 60 },
      },
    };
    expect(applyRealmRacersStartCameraFromWorld(state, camera, world, -0.8, true)).toBe(true);
    expect(camera).toEqual({ camYaw: -0.8, camPitch: 0.32, camDist: 15 });

    expect(applyRealmRacersStartCamera(state, camera, null, -2, false)).toBe(false);
    expect(camera).toEqual({ camYaw: -0.8, camPitch: 0.32, camDist: 15 });
  });

  it('wires the start override into both hosts and selects the driving feel profiles', () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(main.match(/rallyCameraTick\(/g)).toHaveLength(2); // offline + online
    expect(main).toContain('const rallyCameraTick =');
    expect(main).toContain('applyRealmRacersStartCameraFromWorld(');
    expect(renderer).toContain('stepCameraBoomForDriving(');
    expect(renderer).toContain('stepCameraFeelForDriving(');
  });
});
