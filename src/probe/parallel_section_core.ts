// Section 5, real parallelism: the decisions, host-agnostic.
//
// A backend that exposes KHR_parallel_shader_compile may still resolve every
// link on the thread that presents frames (ANGLE's OpenGL backends on
// NVIDIA do). So the section submits a batch of salted links, a window of
// two in flight, polls COMPLETION_STATUS once per frame while it draws the
// calibrated load, and reads two things: whether the poll ever answers
// FALSE (a link that completes across frames is real parallelism; one that
// is always complete at the first poll is synchronous in disguise), and the
// frames during the batch (worst frame, lost time) relative to the refresh.

import { type FrameStats, frameStats } from './frame_stats_core';
import { median } from './stats_core';

export interface ParallelLinkSample {
  cacheKey: string;
  /** Frames the completion poll answered false before true; 0 when the
   *  first poll already answered true. */
  framesPending: number;
  /** Submission to the resolving poll, milliseconds. */
  ms: number;
  linked: boolean;
}

export interface ParallelPassSummary {
  count: number;
  failed: number;
  /** Links whose poll answered false at least once, as a fraction of the
   *  linked ones: 1 is fully asynchronous, 0 synchronous in disguise. */
  asyncFraction: number;
  medianFramesPending: number;
  medianMs: number;
  frames: FrameStats;
  /** No completion query on this context: the links resolved one per frame
   *  by a blocking read, and the frame figures are that cost. */
  blocking: boolean;
  reachedMinimum: boolean;
}

export function summarizeParallelPass(
  samples: readonly ParallelLinkSample[],
  frameIntervalsMs: readonly number[],
  refreshMs: number,
  options: { minimum?: number; blocking?: boolean } = {},
): ParallelPassSummary {
  const linked = samples.filter((sample) => sample.linked);
  const asyncLinks = linked.filter((sample) => sample.framesPending > 0).length;
  return {
    count: linked.length,
    failed: samples.length - linked.length,
    asyncFraction: linked.length === 0 ? Number.NaN : asyncLinks / linked.length,
    medianFramesPending: median(linked.map((sample) => sample.framesPending)),
    medianMs: median(linked.map((sample) => sample.ms)),
    frames: frameStats(frameIntervalsMs, refreshMs),
    blocking: options.blocking === true,
    reachedMinimum: linked.length >= (options.minimum ?? 6),
  };
}

/** The in-flight window the section keeps: the POC's paced mode, two links
 *  at a time, which kept the main thread near the refresh where a whole
 *  batch at once lost seconds of frames. */
export const PARALLEL_WINDOW = 2;
