import { describe, expect, it } from 'vitest';
import { SelfMotionFrameBuffer } from '../src/game/self_motion_frame_buffer';
import type { MoveInput } from '../src/sim/types';

const moveInput = (forward: boolean): MoveInput => ({
  forward,
  back: false,
  turnLeft: false,
  turnRight: false,
  strafeLeft: false,
  strafeRight: false,
  jump: false,
});

describe('self motion frame buffer', () => {
  it('updates one stable frame object in place', () => {
    const buffer = new SelfMotionFrameBuffer();
    const firstMove = moveInput(true);
    const first = buffer.write(true, firstMove, 1, 80, 4, 1_000, 0.5, 1 / 60, true);
    const secondMove = moveInput(false);
    const second = buffer.write(false, secondMove, 2, 120, 8, 1_050, 0.75, 1 / 30, false);

    expect(second).toBe(first);
    expect(second).toEqual({
      enabled: false,
      moveInput: secondMove,
      displayFacing: 2,
      echoMs: 120,
      jitterMs: 8,
      authorityToken: 1_050,
      alpha: 0.75,
      frameDt: 1 / 30,
      driveImpulse: false,
    });
    // The impulse flag is per-frame state, not a latch: a frame that does not
    // carry a shove must clear the one that did, or the predictor re-seeds
    // from an authoritative state forever after the first collision.
    expect(first.driveImpulse).toBe(false);
  });
});
