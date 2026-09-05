// Section 9, the game-shaped frame: the decisions, host-agnostic. A frame
// shaped like the game's (a depth-only shadow pass with many draws, a colour
// pass of many small draws with the corpus's real programs and per-skeleton
// bone-texture updates, a post chain ping-ponging two half-float targets)
// runs for a fixed number of frames; the reading is the frame statistics
// plus how much of each frame the main thread spent SUBMITTING (the Windows
// lever the rendering audit found), and the correctness check: a known
// pattern read back with a tolerance against its CPU reference.

import { type FrameStats, frameStats } from './frame_stats_core';
import { median, percentile } from './stats_core';

export interface FrameShape {
  shadowDraws: number;
  colourDraws: number;
  skeletons: number;
  drawsPerSkeleton: number;
  postPasses: number;
}

export const GAME_FRAME_SHAPE: FrameShape = Object.freeze({
  shadowDraws: 300,
  colourDraws: 400,
  skeletons: 20,
  drawsPerSkeleton: 20,
  postPasses: 4,
});

export function drawsPerFrame(shape: FrameShape): number {
  return (
    shape.shadowDraws +
    shape.colourDraws +
    shape.skeletons * shape.drawsPerSkeleton +
    shape.postPasses
  );
}

export interface ChecksumSample {
  /** The pixel's expected and actual channels, 0 to 255. */
  expected: [number, number, number];
  actual: [number, number, number];
}

export interface ChecksumVerdict {
  ok: boolean;
  /** The largest channel difference seen, 0 to 255. */
  worstDelta: number;
  samples: number;
}

/** Codegen differs across HLSL, SPIR-V and GL, and half-float ping-pong rounds
 *  differently, so "wrong" is reserved for gross failures. */
export const CHECKSUM_TOLERANCE = 8;

export function checksumVerdict(
  samples: readonly ChecksumSample[],
  tolerance = CHECKSUM_TOLERANCE,
): ChecksumVerdict {
  let worst = 0;
  for (const sample of samples) {
    for (let c = 0; c < 3; c++) {
      worst = Math.max(worst, Math.abs(sample.expected[c] - sample.actual[c]));
    }
  }
  return {
    ok: samples.length > 0 && worst <= tolerance,
    worstDelta: worst,
    samples: samples.length,
  };
}

export interface FramePassSummary {
  frames: FrameStats;
  /** Main-thread time inside the frame's submission, milliseconds. */
  medianSubmitMs: number;
  p95SubmitMs: number;
  /** The share of the refresh interval the submission takes: near 1 is a
   *  main-thread-bound frame, the Windows case. */
  submitShare: number;
  drawsPerFrame: number;
  shape: FrameShape;
  checksum: ChecksumVerdict;
  /** The pattern texture read back through a sampler, the "textures are
   *  noise" case. */
  textureChecksum: ChecksumVerdict;
}

export function summarizeFramePass(input: {
  intervalsMs: readonly number[];
  submitMs: readonly number[];
  refreshMs: number;
  shape: FrameShape;
  checksum: ChecksumVerdict;
  textureChecksum: ChecksumVerdict;
}): FramePassSummary {
  const medianSubmit = median(input.submitMs);
  return {
    frames: frameStats(input.intervalsMs, input.refreshMs),
    medianSubmitMs: medianSubmit,
    p95SubmitMs: percentile(input.submitMs, 0.95),
    submitShare: input.refreshMs > 0 ? medianSubmit / input.refreshMs : Number.NaN,
    drawsPerFrame: drawsPerFrame(input.shape),
    shape: input.shape,
    checksum: input.checksum,
    textureChecksum: input.textureChecksum,
  };
}

/** The low-frequency pattern the checksum draws: the pixel at (u, v) of a
 *  gradient, the CPU reference of the pattern shader in frame_section.ts. */
export function patternReference(u: number, v: number): [number, number, number] {
  return [Math.round(u * 255), Math.round(v * 255), Math.round(0.5 * 255)];
}
