// The cold-link section's decisions, host-agnostic: how a pass over the heavy
// programs is summarized, and when it is capped.
//
// A blocking link cannot be interrupted, so the no-progress cap is judged
// AFTER each link: a link that took longer than the cap ends the pass, and
// the pass reports a lower bound ("at least this many ms per link") rather
// than a value. The cap is a multiple of the pass's own median so far
// (floored, so the first links of a slow machine are not capped by their
// own novelty), never a wall-clock constant tuned on one machine.

import { max, median, minimumSampleReached, trimmedMean } from './stats_core';

export interface LinkSample {
  cacheKey: string;
  /** Submission to a program READY TO DRAW: the resolve plus an immediate
   *  first draw, main thread, milliseconds. On ANGLE's OpenGL backends the
   *  whole cost sits in the resolve; on ANGLE Vulkan the resolve answers in
   *  a few milliseconds and the driver compiles the pipeline in the
   *  background, so a draw that comes too soon waits for it: the game pays
   *  whichever of the two its own timing lands on, so both are kept. */
  ms: number;
  linkMs: number;
  drawMs: number;
  /** A second draw in another state (blending on, a half-float target):
   *  a backend that builds a pipeline per state pays again here. */
  draw2Ms: number;
  linked: boolean;
}

export interface LinkPassSummary {
  count: number;
  medianMs: number;
  maxMs: number;
  trimmedMeanMs: number;
  /** The resolve alone and the immediate first draw alone, medians. */
  medianLinkMs: number;
  medianDrawMs: number;
  /** The second-state draw, median. */
  medianDraw2Ms: number;
  /** The pass stopped at a link past the cap: the figures are a lower bound. */
  capped: boolean;
  /** Links that failed to link at all (a driver refusing the program). */
  failed: number;
  reachedMinimum: boolean;
}

/** The cap for the next link, from the links so far. */
export function linkCapMs(
  samplesMs: readonly number[],
  options: { multiple?: number; floorMs?: number } = {},
): number {
  const multiple = options.multiple ?? 8;
  const floorMs = options.floorMs ?? 2000;
  if (samplesMs.length < 3) return Infinity;
  return Math.max(floorMs, median(samplesMs) * multiple);
}

export function summarizeLinkPass(
  samples: readonly LinkSample[],
  options: { minimum?: number; capped?: boolean } = {},
): LinkPassSummary {
  const kept = samples.filter((sample) => sample.linked);
  const linked = kept.map((sample) => sample.ms);
  return {
    count: linked.length,
    medianMs: median(linked),
    maxMs: max(linked),
    trimmedMeanMs: trimmedMean(linked),
    medianLinkMs: median(kept.map((sample) => sample.linkMs)),
    medianDrawMs: median(kept.map((sample) => sample.drawMs)),
    medianDraw2Ms: median(kept.map((sample) => sample.draw2Ms)),
    capped: options.capped === true,
    failed: samples.length - linked.length,
    reachedMinimum: minimumSampleReached(linked.length, options.minimum ?? 12),
  };
}
