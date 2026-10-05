import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));
// The rally scene's shell pool mints its marker texture at construction, which
// needs a DOM canvas; the rest of the textures module is the real one.
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    rallyGroundBlastMarkerTexture: () =>
      new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  };
});

import { addCameraShake, createCameraFeel } from '../src/render/camera_feel_core';
import { RealmRacersScene, SLICK_DROP_MEAN_TICK_WAIT_SEC } from '../src/render/realm_racers_scene';
import { Renderer } from '../src/render/renderer';
import type { ReconciledDrive } from '../src/render/self_drive_view_core';
import {
  createSelfRenderPositionState,
  type ReconciledSelfPrediction,
  type SelfRenderPositionState,
  updateSelfRenderPosition,
} from '../src/render/self_render_position_core';
import type { Entity } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { stripComments } from './helpers/strip_comments';

/** The provisional oil drop's calibration: half a 20 Hz tick, in seconds. */
const MEAN_TICK_WAIT_SEC = 0.025;

/** The renderer members the drive view's consumers read (a prototype fixture:
 *  no Renderer builds headless), with the rally scene built over it the way
 *  the renderer builds it over itself. */
interface RendererHarness {
  selfRender: SelfRenderPositionState;
  selfRenderPosition: { x: number; y: number; z: number };
  sim: {
    player: Entity;
    realmRacersInfo: { match: { circuitId: string } | null };
  };
  time: number;
  readonly selfMotionLeadMs: number | null;
}

const mirror: Entity = {
  prevPos: { x: 2, y: 0, z: 3 },
  pos: { x: 2, y: 0, z: 3 },
  prevFacing: 0.2,
  facing: 0.2,
  vy: 0,
  onGround: true,
  auras: [],
  ghost: false,
  drive: createVehicleDrive('rally_loaner'),
} as unknown as Entity;

const predictedKart: ReconciledDrive = {
  facing: 1.1,
  velocityX: 30,
  velocityZ: -12,
  onGround: true,
  state: createVehicleDrive('rally_loaner'),
};

function harness(): {
  renderer: RendererHarness;
  scene: RealmRacersScene;
  dropProvisionalSlick: ReturnType<typeof vi.fn>;
} {
  const renderer = Object.create(Renderer.prototype) as RendererHarness;
  renderer.selfRenderPosition = { x: 0, y: 0, z: 0 };
  renderer.selfRender = createSelfRenderPositionState(renderer.selfRenderPosition);
  renderer.sim = { player: mirror, realmRacersInfo: { match: { circuitId: 'probe' } } };
  renderer.time = 5;
  const scene = new RealmRacersScene(renderer);
  const dropProvisionalSlick = vi.fn();
  scene.track = { dropProvisionalSlick } as unknown as RealmRacersScene['track'];
  return { renderer, scene, dropProvisionalSlick };
}

function frame(renderer: RendererHarness, selfMotion: ReconciledSelfPrediction | null): void {
  updateSelfRenderPosition(renderer.selfRender, mirror, 42, 1, 1 / 60, 0.2, selfMotion, false);
}

const v2Kart = (): ReconciledSelfPrediction => ({
  kind: 'reconciled',
  position: { x: 10, y: 0, z: 20 },
  residual: null,
  drive: { ...predictedKart },
});

describe('renderer self-kart consumers on wire v2', () => {
  it('aims from the predicted heading while the v2 prediction drives the kart', () => {
    const { renderer, scene } = harness();
    frame(renderer, v2Kart());
    expect(scene.selfMotionFacing).toBe(1.1);
    expect(scene.selfAimPose).toEqual({ pos: { x: 10, y: 0, z: 20 }, facing: 1.1 });

    // a stood-down driver aims from the mirror (the HUD falls back to it)
    frame(renderer, null);
    expect(renderer.selfRender.drive.source).toBe('mirror');
    expect(scene.selfMotionFacing).toBeNull();
    expect(scene.selfAimPose).toBeNull();
  });

  it('reports the v2 prediction lead from the tick offset over the ack while driving', () => {
    const { renderer } = harness();
    // Two ticks ahead of the ack, drawn at alpha 0.4: 1.4 ticks of lead.
    frame(renderer, { ...v2Kart(), tickOffset: 2, tickAlpha: 0.4 });
    expect(renderer.selfMotionLeadMs).toBeCloseTo(70, 9);
    // A reconciled frame with no tick offset (a v2 runner) reads null.
    frame(renderer, { ...v2Kart(), tickOffset: null, tickAlpha: null });
    expect(renderer.selfMotionLeadMs).toBeNull();
    // Stood down on the fallback: nothing predicts the kart.
    frame(renderer, { ...v2Kart(), tickOffset: 2, tickAlpha: 0.4 });
    frame(renderer, null);
    expect(renderer.selfMotionLeadMs).toBeNull();
  });

  it('hands the chase camera the held heading across a suspend on the same seat', () => {
    const { renderer, scene } = harness();
    const near = v2Kart();
    near.position = { x: 3, y: 0, z: 4 };
    frame(renderer, near);
    expect(scene.selfMotionFacing).toBe(1.1);
    frame(renderer, null);
    const held = scene.selfMotionFacing as number;
    expect(held).toBeGreaterThan(0.2);
    expect(held).toBeLessThan(1.1);
    for (let i = 0; i < 120; i++) frame(renderer, null);
    expect(scene.selfMotionFacing).toBeNull();
  });

  it('lags the provisional oil drop by the predicted velocity, never the mirror', () => {
    const { renderer, scene, dropProvisionalSlick } = harness();
    expect(SLICK_DROP_MEAN_TICK_WAIT_SEC).toBe(MEAN_TICK_WAIT_SEC);
    frame(renderer, v2Kart());
    scene.predictOwnSlickDrop();
    const [circuit, x, z, time] = dropProvisionalSlick.mock.calls[0];
    expect(circuit).toBe('probe');
    expect(x).toBeCloseTo(10 - 30 * MEAN_TICK_WAIT_SEC, 12);
    expect(z).toBeCloseTo(20 + 12 * MEAN_TICK_WAIT_SEC, 12);
    expect(time).toBe(5);

    frame(renderer, null);
    scene.predictOwnSlickDrop();
    expect(dropProvisionalSlick.mock.calls[1]).toEqual(['probe', 2, 3, 5]);
  });
});

describe('renderer self-kart reads go through the drive view', () => {
  // The self kart's consumers live in the renderer and in the two rally
  // modules the renderer drives (the scene and the kart presentation), which
  // read the same drive view through their renderer host (`h.selfRender`).
  const read = (path: string): string =>
    stripComments(readFileSync(new URL(path, import.meta.url), 'utf8'));
  const sources = {
    renderer: read('../src/render/renderer.ts'),
    scene: read('../src/render/realm_racers_scene.ts'),
    kart: read('../src/render/realm_racers_kart_presentation.ts'),
  };
  type Source = keyof typeof sources;
  const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Occurrences of `needle` in one source, any whitespace run in it matching any other. */
  const count = (where: Source, needle: string): number => {
    const pattern = needle.trim().split(/\s+/).map(escapeRegex).join('\\s+');
    return sources[where].match(new RegExp(pattern, 'g'))?.length ?? 0;
  };
  const everywhere = (needle: string): number =>
    (Object.keys(sources) as Source[]).reduce((sum, where) => sum + count(where, needle), 0);

  it('never reads the v1 predictor object: the latency telemetry goes through the core', () => {
    expect(everywhere('selfRender.predictor')).toBe(0);
    expect(count('renderer', 'return selfPredictionLeadMs(this.selfRender);')).toBe(1);
  });

  it('never rebuilds the self kart velocity from the mirror', () => {
    expect(everywhere('vehicleVelocityX(p.drive')).toBe(0);
    expect(everywhere('vehicleVelocityZ(p.drive')).toBe(0);
  });

  it('pins every self-kart consumer on the drive view', () => {
    const consumers: [Source, string][] = [
      // selfMotionFacing: the chase camera (camera_follow via main.ts)
      ['scene', 'return h.selfRender.drive.steersHeading ? h.selfRender.drive.facing : null;'],
      // the aim pose (the HUD's ground-aim clamp and the own shot)
      [
        'scene',
        'return displayedAimPose(h.selfRender, h.sim.player?.facing ?? 0, this.selfAimPoseOut);',
      ],
      // the provisional oil drop's lag and velocity
      [
        'scene',
        "const lag = h.selfRender.drive.source === 'predicted' ? SLICK_DROP_MEAN_TICK_WAIT_SEC : 0;",
      ],
      ['scene', 'const vx = h.selfRender.drive.velocityX;'],
      ['scene', 'const vz = h.selfRender.drive.velocityZ;'],
      // the local bump bang (and so its duplicate suppression)
      ['scene', 'if (p.drive && localBumpArmed(h.selfRender.drive.source, race, e, p)) {'],
      ['scene', 'h.selfRender.drive.velocityX - vehicleVelocityX(e.drive, facing),'],
      ['scene', 'h.selfRender.drive.velocityZ - vehicleVelocityZ(e.drive, facing),'],
      // the model yaw
      ['renderer', 'if (id === p.id && this.selfRender.drive.steersHeading) {'],
      ['renderer', 'facing = this.selfRender.drive.facing;'],
      // the airborne pose
      [
        'renderer',
        'animFromDisplay && this.selfRender.drive.kernelOnGround !== null && !inRift ? !this.selfRender.drive.kernelOnGround',
      ],
      // look-ahead and speed FOV
      ['renderer', 'let velX = p.drive ? this.selfRender.drive.velocityX : 0;'],
      ['renderer', 'let velZ = p.drive ? this.selfRender.drive.velocityZ : 0;'],
      // drift smoke, surface dust, scrape sparks
      ['kart', 'const kart = (isSelf && h.selfRender.drive.state) || e.drive;'],
      // the rider lean and the engine mix
      ['kart', 'return (e.id === h.sim.playerId && h.selfRender.drive.state) || e.drive;'],
      ['kart', 'h.vfx.vehicleDriftSmoke(v.group.position, facing, kart.slip, dt);'],
      ['kart', 'h.vfx.vehicleSurfaceDust(v.group.position, facing, kart.speed, dt);'],
      ['kart', 'if (kart.collisionImpact > 3 && v.vehicleScrapeCooldown <= 0) {'],
      ['kart', 'const impact = Math.min(1, kart.collisionImpact / 24);'],
    ];
    for (const [where, needle] of consumers) expect(count(where, needle), needle).toBe(1);
    expect(count('renderer', 'this.selfRender.drive.')).toBe(6);
    expect(count('scene', 'h.selfRender.drive.')).toBe(8);
    expect(count('kart', 'h.selfRender.drive.')).toBe(2);
    // The two rally modules read it on the renderer's own frame: the rival
    // step before the body is placed, the road effects after the mount pass.
    expect(
      count(
        'renderer',
        'this.realmRacers.projectRival(isSelf, v, e, rp, selfMotion, now, dt, p, selfPos);',
      ),
    ).toBe(1);
    expect(
      count(
        'renderer',
        'realmRacersKart.syncRoadFx(this, v, e, isSelf, settled, facing, ax, ay, az, dt);',
      ),
    ).toBe(1);
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
