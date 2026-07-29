import type { MoveInput } from '../sim/types';

export interface BufferedSelfMotionFrame {
  enabled: boolean;
  moveInput: MoveInput;
  displayFacing: number;
  echoMs: number;
  jitterMs: number;
  alpha: number;
  frameDt: number;
  driveImpulse: boolean;
}

export class SelfMotionFrameBuffer {
  private frame: BufferedSelfMotionFrame | null = null;

  write(
    enabled: boolean,
    moveInput: MoveInput,
    displayFacing: number,
    echoMs: number,
    jitterMs: number,
    alpha: number,
    frameDt: number,
    driveImpulse: boolean,
  ): BufferedSelfMotionFrame {
    if (this.frame === null) {
      this.frame = {
        enabled,
        moveInput,
        displayFacing,
        echoMs,
        jitterMs,
        alpha,
        frameDt,
        driveImpulse,
      };
    } else {
      this.frame.enabled = enabled;
      this.frame.moveInput = moveInput;
      this.frame.displayFacing = displayFacing;
      this.frame.echoMs = echoMs;
      this.frame.jitterMs = jitterMs;
      this.frame.alpha = alpha;
      this.frame.frameDt = frameDt;
      this.frame.driveImpulse = driveImpulse;
    }
    return this.frame;
  }
}
