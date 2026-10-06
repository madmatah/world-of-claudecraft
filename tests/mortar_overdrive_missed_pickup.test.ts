// The "missed" cue: a pickup box the viewer was CONTESTING (close, and closing
// on it at a real speed) taken by another pilot. Never for the viewer's own
// take, never for a box they were not racing for, never off a race.

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));

import {
  MORTAR_OVERDRIVE_MISSED_PICKUP_COLOR,
  MortarOverdriveFieldCues,
} from '../src/render/mortar_overdrive/field_cues';
import {
  MORTAR_OVERDRIVE_MISSED_PICKUP_MIN_CLOSING_YD_S,
  MORTAR_OVERDRIVE_MISSED_PICKUP_RADIUS_YD,
  type MortarOverdriveContestKart,
  mortarOverdriveContestKart,
  mortarOverdrivePickupMissed,
} from '../src/render/mortar_overdrive/missed_pickup_core';
import type { SelfDriveSource } from '../src/render/self_drive_view_core';
import { createSelfRenderPositionState } from '../src/render/self_render_position_core';
import type { SimEvent } from '../src/sim/types';

const SELF = 1;
const RIVAL = 2;

/** A kart at the origin driving +Z at `speed` yd/s. */
const kart = (speed = 30, x = 0, z = 0): MortarOverdriveContestKart => ({
  x,
  z,
  velocityX: 0,
  velocityZ: speed,
});

describe('who was contesting a box', () => {
  it('fires for a box ahead, in reach, taken by a rival', () => {
    expect(mortarOverdrivePickupMissed(SELF, kart(), RIVAL, 0, 6)).toBe(true);
    // A little off the nose still counts: the kart is closing on it.
    expect(mortarOverdrivePickupMissed(SELF, kart(), RIVAL, 3, 5)).toBe(true);
  });

  it('never fires for the viewer own take', () => {
    expect(mortarOverdrivePickupMissed(SELF, kart(), SELF, 0, 6)).toBe(false);
  });

  it('never fires off a race', () => {
    expect(mortarOverdrivePickupMissed(SELF, null, RIVAL, 0, 6)).toBe(false);
  });

  it('never fires for a box out of reach', () => {
    expect(
      mortarOverdrivePickupMissed(SELF, kart(), RIVAL, 0, MORTAR_OVERDRIVE_MISSED_PICKUP_RADIUS_YD),
    ).toBe(true);
    expect(
      mortarOverdrivePickupMissed(
        SELF,
        kart(),
        RIVAL,
        0,
        MORTAR_OVERDRIVE_MISSED_PICKUP_RADIUS_YD + 0.01,
      ),
    ).toBe(false);
  });

  it('never fires for a box behind or beside a kart, or for a kart too slow to be racing for it', () => {
    expect(mortarOverdrivePickupMissed(SELF, kart(), RIVAL, 0, -5)).toBe(false);
    expect(mortarOverdrivePickupMissed(SELF, kart(), RIVAL, 5, 0)).toBe(false);
    expect(mortarOverdrivePickupMissed(SELF, kart(0), RIVAL, 0, 5)).toBe(false);
    // The closing speed is what is measured, along the line to the box.
    expect(
      mortarOverdrivePickupMissed(
        SELF,
        kart(MORTAR_OVERDRIVE_MISSED_PICKUP_MIN_CLOSING_YD_S),
        RIVAL,
        0,
        5,
      ),
    ).toBe(true);
    expect(
      mortarOverdrivePickupMissed(
        SELF,
        kart(MORTAR_OVERDRIVE_MISSED_PICKUP_MIN_CLOSING_YD_S - 0.01),
        RIVAL,
        0,
        5,
      ),
    ).toBe(false);
  });

  it('counts a moving kart right on top of the box, not a parked one', () => {
    expect(mortarOverdrivePickupMissed(SELF, kart(30, 4, 4), RIVAL, 4, 4)).toBe(true);
    expect(mortarOverdrivePickupMissed(SELF, kart(0, 4, 4), RIVAL, 4, 4)).toBe(false);
  });
});

/** The mirror pose the world holds: 100, 50. */
function viewer(phase: string | null) {
  return {
    playerId: SELF,
    player: { pos: { x: 100, z: 50 }, facing: 0, drive: null },
    mortarOverdriveInfo: { match: phase === null ? null : { phase } },
  };
}

/** The renderer's self render state, as it holds it (self_render_position_core). */
function seen(
  source: SelfDriveSource,
  drawnAt: { x: number; z: number } | null,
  velocityX = 0,
  velocityZ = 30,
) {
  const state = createSelfRenderPositionState({ x: 0, y: 0, z: 0 });
  if (drawnAt) {
    state.position.x = drawnAt.x;
    state.position.z = drawnAt.z;
    state.active = true;
    state.ready = true;
  }
  state.drive.source = source;
  state.drive.velocityX = velocityX;
  state.drive.velocityZ = velocityZ;
  return state;
}

const out = (): MortarOverdriveContestKart => ({ x: 0, z: 0, velocityX: 0, velocityZ: 0 });

describe("the viewer's kart", () => {
  it('is the kart the viewer sees: the drawn pose and the drive view velocity', () => {
    // Predicted online: drawn 12 yd up the road from the mirror.
    expect(
      mortarOverdriveContestKart(
        viewer('racing'),
        seen('predicted', { x: 100, z: 62 }, 4, 30),
        out(),
      ),
    ).toEqual({ x: 100, z: 62, velocityX: 4, velocityZ: 30 });
    // No live self render (offline, gated): the mirror pose, as selfAimPose.
    expect(
      mortarOverdriveContestKart(viewer('racing'), seen('mirror', null, 0, 25), out()),
    ).toEqual({
      x: 100,
      z: 50,
      velocityX: 0,
      velocityZ: 25,
    });
  });

  it('is null off a race or on foot', () => {
    for (const phase of [null, 'loading', 'countdown', 'finished']) {
      expect(
        mortarOverdriveContestKart(viewer(phase), seen('predicted', { x: 0, z: 0 }), out()),
        String(phase),
      ).toBeNull();
    }
    expect(
      mortarOverdriveContestKart(viewer('racing'), seen('none', { x: 0, z: 0 }), out()),
    ).toBeNull();
  });
});

describe('the missed cue', () => {
  const ground = (): number => 2;
  const taken = (takerId: number, x: number, z: number): SimEvent => ({
    type: 'mortarOverdrivePickupTaken',
    takerId,
    x,
    z,
  });
  const run = (
    ev: SimEvent,
    phase: string | null = 'racing',
    self: ReturnType<typeof seen> = seen('mirror', null),
  ) => {
    const cues = new MortarOverdriveFieldCues(new Map(), ground);
    const vfx = { burst: vi.fn(), groundPuff: vi.fn() };
    cues.onEvent(ev, viewer(phase) as never, vfx, null, self);
    return vfx;
  };

  it('fizzles a contested box a rival took, at the box', () => {
    const vfx = run(taken(RIVAL, 100, 56));
    expect(vfx.burst).toHaveBeenCalledOnce();
    const [at, , , , color] = vfx.burst.mock.calls[0];
    expect([at.x, at.y, at.z]).toEqual([100, 3, 56]);
    expect(color).toBe(MORTAR_OVERDRIVE_MISSED_PICKUP_COLOR);
  });

  it('follows the predicted pose the player sees, not the mirror', () => {
    // The box is 5 yd ahead of the DRAWN kart and 20 yd ahead of the mirror:
    // on screen the viewer was racing for it.
    const drawnNear = seen('predicted', { x: 100, z: 65 });
    expect(run(taken(RIVAL, 100, 70), 'racing', drawnNear).burst).toHaveBeenCalledOnce();
    // The box is 5 yd ahead of the MIRROR but already behind the drawn kart:
    // on screen it was passed, nothing was lost.
    const drawnPast = seen('predicted', { x: 100, z: 60 });
    expect(run(taken(RIVAL, 100, 55), 'racing', drawnPast).burst).not.toHaveBeenCalled();
  });

  it('stays quiet for the viewer own take, an uncontested box, and off a race', () => {
    expect(run(taken(SELF, 100, 56)).burst).not.toHaveBeenCalled();
    expect(run(taken(RIVAL, 100, 80)).burst).not.toHaveBeenCalled();
    expect(run(taken(RIVAL, 100, 44)).burst).not.toHaveBeenCalled();
    expect(run(taken(RIVAL, 100, 56), 'countdown').burst).not.toHaveBeenCalled();
  });
});
