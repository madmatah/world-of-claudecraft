import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  addCameraShake,
  cameraFeelFovTarget,
  cameraFeelProfileForDriving,
  cameraFovOffset,
  cameraShakeOffsetInto,
  createCameraFeel,
  DEFAULT_CAMERA_FEEL_PROFILE,
  punchCameraFov,
  REALM_RACERS_CAMERA_FEEL_PROFILE,
  resolveCameraFov,
  SPEED_FOV_MAX,
  stepCameraFeel,
  stepCameraFeelForDriving,
  stepLandingDetector,
  underwaterCameraCeiling,
} from '../src/render/camera_feel_core';
import { Renderer } from '../src/render/renderer';
import { RUN_SPEED } from '../src/sim/types';

it('keeps the submerged chase eye under water, with no ceiling on dry or non-finite water', () => {
  expect(underwaterCameraCeiling(true, 4)).toBe(3.5);
  expect(underwaterCameraCeiling(false, 4)).toBe(Infinity);
  expect(underwaterCameraCeiling(true, Number.NaN)).toBe(Infinity);
  expect(underwaterCameraCeiling(true, -Infinity)).toBe(Infinity);
});

describe('FOV kicks', () => {
  it('gives no speed kick at base run speed, near-max at travel-form speed', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED, 1 / 60);
    expect(s.speedKick).toBeLessThan(0.3);
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60);
    expect(s.speedKick).toBeGreaterThan(5.1);
    expect(s.speedKick).toBeLessThanOrEqual(6);
  });

  it('eases a running speed kick to zero when reduced motion is enabled', () => {
    const s = createCameraFeel();
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60);
    expect(s.speedKick).toBeGreaterThan(5.1);
    for (let i = 0; i < 300; i++) stepCameraFeel(s, 0, RUN_SPEED * 1.4, 1 / 60, false);
    expect(Math.abs(s.speedKick)).toBeLessThan(0.001);
  });

  it('punch impulses decay on their own and the total offset stays clamped', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 3);
    expect(cameraFovOffset(s)).toBeCloseTo(3, 5);
    for (let i = 0; i < 90; i++) stepCameraFeel(s, 0, 0, 1 / 60); // 1.5 s
    expect(Math.abs(cameraFovOffset(s))).toBeLessThan(0.1);
    punchCameraFov(s, 100);
    expect(cameraFovOffset(s)).toBe(12);
    punchCameraFov(s, -300);
    expect(cameraFovOffset(s)).toBe(-8);
  });
});

describe('resolveCameraFov (the player-configured FOV slider)', () => {
  it('honors a non-default base FOV at rest, instead of snapping back to a hard-coded 60', () => {
    const s = createCameraFeel();
    expect(resolveCameraFov(80, s)).toBeCloseTo(80, 5);
    expect(resolveCameraFov(55, s)).toBeCloseTo(55, 5);
    expect(resolveCameraFov(100, s)).toBeCloseTo(100, 5);
  });

  it('applies the feel kicks on top of the configured base, not on top of a fixed default', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 5);
    expect(resolveCameraFov(70, s)).toBeCloseTo(75, 5);
    expect(resolveCameraFov(60, s)).toBeCloseTo(65, 5);
  });

  it('still clamps the combined result to the 50..100 envelope at either extreme', () => {
    const s = createCameraFeel();
    punchCameraFov(s, 50);
    expect(resolveCameraFov(100, s)).toBe(100);
    punchCameraFov(s, -200);
    expect(resolveCameraFov(55, s)).toBe(50);
  });

  it('uses a stronger unsaturated speed curve for the rally profile', () => {
    const normal = createCameraFeel();
    const rally = createCameraFeel();
    for (let i = 0; i < 300; i++) {
      stepCameraFeel(normal, 0, 26, 1 / 60);
      stepCameraFeel(rally, 0, 26, 1 / 60, true, REALM_RACERS_CAMERA_FEEL_PROFILE);
    }
    expect(cameraFovOffset(rally, REALM_RACERS_CAMERA_FEEL_PROFILE)).toBeGreaterThan(
      cameraFovOffset(normal),
    );
    expect(rally.speedKick).toBeCloseTo(8.24, 1);
    expect(REALM_RACERS_CAMERA_FEEL_PROFILE.speedFovMax).toBe(14);
    expect(DEFAULT_CAMERA_FEEL_PROFILE.speedFovMax).toBe(SPEED_FOV_MAX);
  });

  it('caps the rally speed widening at fourteen degrees', () => {
    const rally = createCameraFeel();
    for (let i = 0; i < 300; i++)
      stepCameraFeel(rally, 0, 80, 1 / 60, true, REALM_RACERS_CAMERA_FEEL_PROFILE);
    expect(cameraFovOffset(rally, REALM_RACERS_CAMERA_FEEL_PROFILE)).toBeCloseTo(14, 3);
  });

  it('selects and carries the rally profile through stepping and FOV projection', () => {
    const normalProfile = cameraFeelProfileForDriving(false);
    const rallyProfile = cameraFeelProfileForDriving(true);
    expect(normalProfile).toBe(DEFAULT_CAMERA_FEEL_PROFILE);
    expect(rallyProfile).toBe(REALM_RACERS_CAMERA_FEEL_PROFILE);
    const normal = createCameraFeel();
    const rally = createCameraFeel();
    let normalFov = 0;
    let rallyFov = 0;
    for (let i = 0; i < 300; i++) {
      normalFov = stepCameraFeelForDriving(normal, 0, 26, 1 / 60, true, false);
      rallyFov = stepCameraFeelForDriving(rally, 0, 26, 1 / 60, true, true);
    }
    expect(rallyFov).toBeGreaterThan(normalFov);
    expect(cameraFeelFovTarget(65, rallyFov)).toBeCloseTo(65 + rallyFov, 5);
    expect(cameraFeelFovTarget(98, 14)).toBe(100);
  });
});

describe('positional shake channel', () => {
  it('decays deterministically and is zero throughout reduced motion', () => {
    const s = createCameraFeel();
    const out = { x: 0, y: 0, z: 0 };
    addCameraShake(s, 8);
    expect(s.shakeTrauma).toBe(1);
    stepCameraFeel(s, 0, 0, 1 / 60);
    cameraShakeOffsetInto(s, out);
    expect(Math.hypot(out.x, out.y, out.z)).toBeGreaterThan(0);
    for (let i = 0; i < 120; i++) stepCameraFeel(s, 0, 0, 1 / 60);
    cameraShakeOffsetInto(s, out);
    expect(s.shakeTrauma).toBe(0);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });

    addCameraShake(s, 0.8);
    stepCameraFeel(s, 0, 0, 1 / 60, false, REALM_RACERS_CAMERA_FEEL_PROFILE);
    cameraShakeOffsetInto(s, out);
    expect(out).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe("the renderer's editor camera", () => {
  it('still decays a shake: the free camera skips the chase path, not the feel step', () => {
    // The shake's decay lives in the feel step; the editor branch returning
    // before it left a shake taken there offsetting the camera forever.
    const renderer = Object.create(Renderer.prototype) as unknown as {
      camera: THREE.PerspectiveCamera;
      cameraLookAt: THREE.Vector3;
      editorCam: { pos: THREE.Vector3; target: THREE.Vector3 };
      camFeel: ReturnType<typeof createCameraFeel>;
      reduceMotionSetting: boolean;
      reduceMotionMql: null;
      updateCamera(selfPos: THREE.Vector3, dt: number): void;
    };
    renderer.camera = new THREE.PerspectiveCamera();
    renderer.cameraLookAt = new THREE.Vector3();
    renderer.editorCam = { pos: new THREE.Vector3(0, 10, 0), target: new THREE.Vector3(5, 0, 5) };
    renderer.camFeel = createCameraFeel();
    renderer.reduceMotionSetting = false;
    renderer.reduceMotionMql = null;
    addCameraShake(renderer.camFeel, 1);
    for (let i = 0; i < 120; i++) renderer.updateCamera(new THREE.Vector3(), 1 / 60);
    expect(renderer.camFeel.shakeTrauma).toBe(0);
    expect(renderer.camera.position.toArray()).toEqual([0, 10, 0]);
  });
});

describe('landing detector', () => {
  const fall = (s: ReturnType<typeof createCameraFeel>, vy: number, frames: number): number => {
    let y = 10;
    let thump = 0;
    for (let i = 0; i < frames; i++) {
      y += vy / 60;
      thump = Math.max(thump, stepLandingDetector(s, y, 1 / 60));
    }
    // settle: height stops changing (landed)
    for (let i = 0; i < 5; i++) thump = Math.max(thump, stepLandingDetector(s, y, 1 / 60));
    return thump;
  };

  it('thumps once on a hard landing, scaled by fall speed', () => {
    const s = createCameraFeel();
    stepLandingDetector(s, 10, 1 / 60); // arm
    const hard = fall(s, -14, 20);
    expect(hard).toBeCloseTo(7 / 13, 5);
    // settled: no further thumps
    expect(stepLandingDetector(s, 10 - (14 * 20) / 60, 1 / 60)).toBe(0);
  });

  it('scales landing thumps with sustained fall speed', () => {
    const medium = createCameraFeel();
    stepLandingDetector(medium, 10, 1 / 60);
    const hard = createCameraFeel();
    stepLandingDetector(hard, 10, 1 / 60);
    expect(fall(hard, -18, 20)).toBeGreaterThan(fall(medium, -10, 20));
  });

  it('ignores gentle landings and teleports', () => {
    const gentle = createCameraFeel();
    stepLandingDetector(gentle, 10, 1 / 60);
    expect(fall(gentle, -5, 20)).toBe(0);

    const tp = createCameraFeel();
    stepLandingDetector(tp, 10, 1 / 60);
    stepLandingDetector(tp, 10, 1 / 60);
    // A 50 yd drop in one frame is a teleport, not a landing.
    expect(stepLandingDetector(tp, -40, 1 / 60)).toBe(0);
    expect(stepLandingDetector(tp, -40, 1 / 60)).toBe(0);
  });

  it('never thumps on an instant one-frame drop (sitting down, short relocations)', () => {
    const s = createCameraFeel();
    stepLandingDetector(s, 10, 1 / 60);
    stepLandingDetector(s, 10, 1 / 60);
    // A 0.5 yd pose drop lands in ONE frame: fast "fall speed" but not a
    // sustained fall, so the settle must not kick the camera.
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
    expect(stepLandingDetector(s, 9.5, 1 / 60)).toBe(0);
  });
});
