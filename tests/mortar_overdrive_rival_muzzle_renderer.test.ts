import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));
// The shell pool mints its marker texture at construction, which needs a DOM
// canvas; the rest of the textures module is the real one.
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    mortarOverdriveGroundBlastMarkerTexture: () =>
      new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  };
});
vi.mock('../src/render/mortar_overdrive/audio', () => ({
  playMortarOverdriveEventAudio: vi.fn(),
  playMortarOverdriveScrapeAudio: vi.fn(),
  syncMortarOverdriveVehicleAudio: vi.fn(),
}));

import { playMortarOverdriveEventAudio } from '../src/render/mortar_overdrive/audio';
import { createContactKick } from '../src/render/mortar_overdrive/contact_kick_core';
import { MortarOverdriveScene } from '../src/render/mortar_overdrive/scene';
import {
  createRemoteVehicleDisplay,
  REMOTE_RACER_MUZZLE_LIFT_YD,
  stepRemoteRacerView,
} from '../src/render/remote_vehicle_display_core';
import { GROUND_BLAST_MUZZLE_NOSE_YD } from '../src/sim/mortar_overdrive/ground_blast';
import { createVehicleDrive } from '../src/sim/vehicle_motion';

// The Mortar Overdrive scene's Ground Blast Fired arm: a RIVAL's shell leaves the barrel of
// the machine as drawn (its projected view), not the server muzzle it has
// already driven past, on either horizon. The target stays the server's.

const SELF = 1;
const RIVAL = 2;
const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

/** The rival's view as renderer.sync leaves it for a STOOD-DOWN local kart:
 *  projected on its arrival age (no self frame). */
function steppedStoodDown() {
  const drive = createVehicleDrive('mo_loaner');
  drive.speed = 30;
  const view = createRemoteVehicleDisplay();
  const mirror = { pos: { x: 40, z: 12 }, facing: 0.5, drive, netUpdatedAt: 1000 };
  stepRemoteRacerView(view, mirror, null, 1080, 1 / 60, 1000);
  return view;
}

function harness() {
  const fire = vi.fn();
  const burst = vi.fn();
  const rivalView = steppedStoodDown();
  // The self view carries a live-looking state on purpose: the viewer's own
  // shot must keep the event muzzle whatever its view holds.
  const selfView = createRemoteVehicleDisplay();
  selfView.active = true;
  // The Mortar Overdrive scene over a stub of the renderer members it reads.
  const scene = new MortarOverdriveScene({
    vfx: { burst },
    groundSample: ground,
    audioSink: null,
    sim: { playerId: SELF, player: { id: SELF } },
    views: new Map([
      [RIVAL, { remoteVehicle: rivalView }],
      [SELF, { remoteVehicle: selfView }],
    ]),
  });
  (scene as unknown as { groundBlasts: unknown }).groundBlasts = { fire };
  return { scene, fire, burst, rivalView };
}

const fired = (sourceId: number): Parameters<MortarOverdriveScene['onEvent']>[0] => ({
  type: 'mortarOverdriveGroundBlastFired',
  sourceId,
  x: 30,
  z: 5,
  targetX: 60,
  targetZ: 30,
  flightSeconds: 0.6,
});

describe('a rival Ground Blast leaves the drawn nose', () => {
  it('stood down: fires the arc and the muzzle at the projected rival, target untouched', () => {
    const { scene, fire, burst, rivalView } = harness();
    expect(rivalView.active).toBe(true);
    scene.onEvent(fired(RIVAL));
    const noseX = rivalView.x + Math.sin(rivalView.facing) * GROUND_BLAST_MUZZLE_NOSE_YD;
    const noseZ = rivalView.z + Math.cos(rivalView.facing) * GROUND_BLAST_MUZZLE_NOSE_YD;
    const [shot] = fire.mock.calls[0];
    expect(shot.x).toBeCloseTo(noseX, 12);
    expect(shot.z).toBeCloseTo(noseZ, 12);
    expect([shot.targetX, shot.targetZ, shot.flightSeconds]).toEqual([60, 30, 0.6]);
    // The flash plays at the drawn barrel, over the ground there.
    const at = burst.mock.calls[0][0];
    expect([at.x, at.z]).toEqual([shot.x, shot.z]);
    expect(at.y).toBeCloseTo(ground(shot.x, shot.z) + REMOTE_RACER_MUZZLE_LIFT_YD, 12);
    const audio = vi.mocked(playMortarOverdriveEventAudio).mock.calls.at(-1)?.[2] as { x: number };
    expect(audio.x).toBe(shot.x);
  });

  it('keeps the event muzzle for the local pilot, whatever its own view holds', () => {
    const { scene, fire } = harness();
    scene.onEvent(fired(SELF));
    const [shot] = fire.mock.calls[0];
    expect([shot.x, shot.z]).toEqual([30, 5]);
  });
});

describe("the local pilot's own report", () => {
  /** The scene with a ready, predicted kart at the origin facing +z. */
  function predicted() {
    const h = harness();
    const launchOwn = vi.fn(() => true);
    (h.scene as unknown as { groundBlasts: unknown }).groundBlasts = { fire: h.fire, launchOwn };
    const host = (h.scene as unknown as { host: Record<string, unknown> }).host;
    host.selfRender = {
      active: true,
      ready: true,
      position: { x: 0, y: 0, z: 0 },
      drive: { steersHeading: true, facing: 0 },
      reconciledLeadMs: 80,
      contactKick: createContactKick(),
    };
    host.sim = { playerId: SELF, player: { id: SELF, pos: { x: 0, z: 0 }, facing: 0 } };
    return h;
  }

  const ownFired = (
    targetX: number,
    targetZ: number,
  ): Parameters<MortarOverdriveScene['onEvent']>[0] => ({
    type: 'mortarOverdriveGroundBlastFired',
    sourceId: SELF,
    x: 0,
    z: 2,
    targetX,
    targetZ,
    flightSeconds: 0.6,
  });

  it('suppresses the echo of the shot it reported, at the press', () => {
    const { scene, burst } = predicted();
    scene.predictOwnGroundBlastFire({ x: 0, z: 30 });
    expect(burst).toHaveBeenCalledTimes(1);
    scene.onEvent(ownFired(0.5, 30.5));
    expect(burst).toHaveBeenCalledTimes(1);
  });

  it('still plays a real shot that followed a refused one inside the window', () => {
    const { scene, burst } = predicted();
    scene.predictOwnGroundBlastFire({ x: 0, z: 30 });
    expect(burst).toHaveBeenCalledTimes(1);
    // The server refused that one. A second press inside the window plays no
    // local report (one in flight), and its Fired event lands elsewhere: it
    // plays rather than being swallowed by the stale mark.
    scene.predictOwnGroundBlastFire({ x: 20, z: 50 });
    expect(burst).toHaveBeenCalledTimes(1);
    scene.onEvent(ownFired(20, 50));
    expect(burst).toHaveBeenCalledTimes(2);
  });
});
