import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));
vi.mock('../src/render/realm_racers_audio', () => ({
  playRealmRacersEventAudio: vi.fn(),
  playRealmRacersScrapeAudio: vi.fn(),
  syncRealmRacersVehicleAudio: vi.fn(),
}));

import { playRealmRacersEventAudio } from '../src/render/realm_racers_audio';
import {
  createRemoteVehicleDisplay,
  REMOTE_RACER_MUZZLE_LIFT_YD,
  stepRemoteRacerView,
} from '../src/render/remote_vehicle_display_core';
import { Renderer } from '../src/render/renderer';
import { GROUND_BLAST_MUZZLE_NOSE_YD } from '../src/sim/realm_racers_ground_blast';
import type { SimEvent } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';

// The renderer's Ground Blast Fired arm: a RIVAL's shell leaves the barrel of
// the machine as drawn (its projected view), not the server muzzle it has
// already driven past, on either horizon. The target stays the server's.

interface EventHarness {
  handleEvent(ev: SimEvent): void;
}

const SELF = 1;
const RIVAL = 2;
const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

/** The rival's view as renderer.sync leaves it for a STOOD-DOWN local kart:
 *  projected on its arrival age (no self frame). */
function steppedStoodDown() {
  const drive = createVehicleDrive('rally_loaner');
  drive.speed = 30;
  const view = createRemoteVehicleDisplay();
  const mirror = { pos: { x: 40, z: 12 }, facing: 0.5, drive, netUpdatedAt: 1000 };
  stepRemoteRacerView(view, mirror, null, 1080, 1 / 60, 1000);
  return view;
}

function harness() {
  const fire = vi.fn();
  const burst = vi.fn();
  const renderer = Object.create(Renderer.prototype) as EventHarness & Record<string, unknown>;
  const rivalView = steppedStoodDown();
  renderer.realmRacersGroundBlasts = { fire };
  renderer.vfx = { burst };
  renderer.groundSample = ground;
  renderer.audioSink = null;
  renderer.sim = { playerId: SELF, player: { id: SELF } };
  // The self view carries a live-looking state on purpose: the viewer's own
  // shot must keep the event muzzle whatever its view holds.
  const selfView = createRemoteVehicleDisplay();
  selfView.active = true;
  renderer.views = new Map([
    [RIVAL, { remoteVehicle: rivalView }],
    [SELF, { remoteVehicle: selfView }],
  ]);
  return { renderer, fire, burst, rivalView };
}

const fired = (sourceId: number): SimEvent => ({
  type: 'realmRacersGroundBlastFired',
  sourceId,
  x: 30,
  z: 5,
  targetX: 60,
  targetZ: 30,
  flightSeconds: 0.6,
});

describe('a rival Ground Blast leaves the drawn nose', () => {
  it('stood down: fires the arc and the muzzle at the projected rival, target untouched', () => {
    const { renderer, fire, burst, rivalView } = harness();
    expect(rivalView.active).toBe(true);
    renderer.handleEvent(fired(RIVAL));
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
    const audio = vi.mocked(playRealmRacersEventAudio).mock.calls.at(-1)?.[2] as { x: number };
    expect(audio.x).toBe(shot.x);
  });

  it('keeps the event muzzle for the local pilot, whatever its own view holds', () => {
    const { renderer, fire } = harness();
    renderer.handleEvent(fired(SELF));
    const [shot] = fire.mock.calls[0];
    expect([shot.x, shot.z]).toEqual([30, 5]);
  });
});
