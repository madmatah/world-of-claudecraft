import type { MoveInput } from '../sim/types';

export interface BufferedSelfMotionFrame {
  enabled: boolean;
  moveInput: MoveInput;
  displayFacing: number;
  echoMs: number;
  jitterMs: number;
  authorityToken: number;
  alpha: number;
  frameDt: number;
  driveImpulse: boolean;
  popVelocity: number;
}

export class SelfMotionFrameBuffer {
  private frame: BufferedSelfMotionFrame | null = null;

  write(
    enabled: boolean,
    moveInput: MoveInput,
    displayFacing: number,
    echoMs: number,
    jitterMs: number,
    authorityToken: number,
    alpha: number,
    frameDt: number,
    driveImpulse: boolean,
    popVelocity: number,
  ): BufferedSelfMotionFrame {
    if (this.frame === null) {
      this.frame = {
        enabled,
        moveInput,
        displayFacing,
        echoMs,
        jitterMs,
        authorityToken,
        alpha,
        frameDt,
        driveImpulse,
        popVelocity,
      };
    } else {
      this.frame.enabled = enabled;
      this.frame.moveInput = moveInput;
      this.frame.displayFacing = displayFacing;
      this.frame.echoMs = echoMs;
      this.frame.jitterMs = jitterMs;
      this.frame.authorityToken = authorityToken;
      this.frame.alpha = alpha;
      this.frame.frameDt = frameDt;
      this.frame.driveImpulse = driveImpulse;
      this.frame.popVelocity = popVelocity;
    }
    return this.frame;
  }
}
