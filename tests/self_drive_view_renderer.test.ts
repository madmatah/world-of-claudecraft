import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));

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

const SLICK_DROP_MEAN_TICK_WAIT_SEC = 0.025;

interface RendererHarness {
  selfRender: SelfRenderPositionState;
  selfRenderPosition: { x: number; y: number; z: number };
  selfAimPoseOut: { pos: { x: number; y: number; z: number }; facing: number };
  sim: {
    player: Entity;
    realmRacersInfo: { match: { circuitId: string } | null };
  };
  realmRacersTrack: { dropProvisionalSlick: ReturnType<typeof vi.fn> };
  time: number;
  readonly selfAimPose: { pos: { x: number; y: number; z: number }; facing: number } | null;
  readonly selfMotionFacing: number | null;
  predictOwnSlickDrop(): void;
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
  vy: 0,
  onGround: true,
  handbrake: 0,
  collisionImpact: 0,
};

function harness(): RendererHarness {
  const renderer = Object.create(Renderer.prototype) as RendererHarness;
  renderer.selfRenderPosition = { x: 0, y: 0, z: 0 };
  renderer.selfRender = createSelfRenderPositionState(renderer.selfRenderPosition);
  renderer.selfAimPoseOut = { pos: { x: 0, y: 0, z: 0 }, facing: 0 };
  renderer.sim = { player: mirror, realmRacersInfo: { match: { circuitId: 'probe' } } };
  renderer.realmRacersTrack = { dropProvisionalSlick: vi.fn() };
  renderer.time = 5;
  return renderer;
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
    const renderer = harness();
    frame(renderer, v2Kart());
    expect(renderer.selfMotionFacing).toBe(1.1);
    expect(renderer.selfAimPose).toEqual({ pos: { x: 10, y: 0, z: 20 }, facing: 1.1 });

    // a stood-down driver aims from the mirror (the HUD falls back to it)
    frame(renderer, null);
    expect(renderer.selfRender.drive.source).toBe('mirror');
    expect(renderer.selfMotionFacing).toBeNull();
    expect(renderer.selfAimPose).toBeNull();
  });

  it('lags the provisional oil drop by the predicted velocity, never the mirror', () => {
    const renderer = harness();
    frame(renderer, v2Kart());
    renderer.predictOwnSlickDrop();
    const [circuit, x, z, time] = renderer.realmRacersTrack.dropProvisionalSlick.mock.calls[0];
    expect(circuit).toBe('probe');
    expect(x).toBeCloseTo(10 - 30 * SLICK_DROP_MEAN_TICK_WAIT_SEC, 12);
    expect(z).toBeCloseTo(20 + 12 * SLICK_DROP_MEAN_TICK_WAIT_SEC, 12);
    expect(time).toBe(5);

    frame(renderer, null);
    renderer.predictOwnSlickDrop();
    expect(renderer.realmRacersTrack.dropProvisionalSlick.mock.calls[1]).toEqual([
      'probe',
      2,
      3,
      5,
    ]);
  });
});

describe('renderer self-kart reads go through the drive view', () => {
  const source = stripComments(
    readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8'),
  );
  const count = (needle: string): number => source.split(needle).length - 1;

  it('reads the v1 predictor object only for the latency telemetry', () => {
    expect(count('this.selfRender.predictor')).toBe(2);
    expect(source).toContain(
      'return this.selfRender.active && this.selfRender.predictor\n      ? this.selfRender.predictor.leadMs',
    );
  });

  it('pins every self-kart consumer on the drive view', () => {
    const consumers: Array<[string, number]> = [
      // selfMotionFacing: model aim pose, chase camera (camera_follow via main.ts)
      [
        "return this.selfRender.drive.source === 'predicted' ? this.selfRender.drive.facing : null;",
        1,
      ],
      ['out.facing = this.selfMotionFacing ?? this.sim.player?.facing ?? 0;', 1],
      // the provisional oil drop's lag and velocity
      [
        "this.selfRender.drive.source === 'predicted' ? Renderer.SLICK_DROP_MEAN_TICK_WAIT_SEC : 0;",
        1,
      ],
      ['const vx = this.selfRender.drive.velocityX;', 1],
      ['const vz = this.selfRender.drive.velocityZ;', 1],
      // the local bump bang (and so its duplicate suppression)
      ["this.selfRender.drive.source === 'predicted' &&\n          p.drive &&", 1],
      ['this.selfRender.drive.velocityX - vehicleVelocityX(e.drive, facing),', 1],
      ['this.selfRender.drive.velocityZ - vehicleVelocityZ(e.drive, facing),', 1],
      // the model yaw
      ["if (id === p.id && this.selfRender.drive.source === 'predicted') {", 1],
      ['facing = this.selfRender.drive.facing;', 1],
      // the airborne pose
      ['animFromDisplay && this.selfRender.drive.kernelOnGround !== null && !inRift', 1],
      ['? !this.selfRender.drive.kernelOnGround', 1],
      // look-ahead and speed FOV
      ['velX = this.selfRender.drive.velocityX;', 1],
      ['velZ = this.selfRender.drive.velocityZ;', 1],
    ];
    for (const [needle, times] of consumers) expect(count(needle), needle).toBe(times);
    expect(count('this.selfRender.drive.')).toBe(14);
    expect(count('this.selfRender.drive')).toBe(14);
  });
});
