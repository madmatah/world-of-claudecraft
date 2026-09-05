// Section 6, worker benefit: the decisions, host-agnostic. The game's real
// warm worker (src/render/shader_warm_worker.ts) links a salted set on its
// own context while the page draws the load; then the main context links
// the same texts, which is the hit the game would pay after a warm. The
// reading: how long the worker took to be ready, its own link times, the
// frames lost DURING the warm, the hit cost after it, and the benefit against
// the cold cost the link section measured. A worker that refuses, or a hit
// that costs as much as a cold link (ANGLE Vulkan's program-binary load path
// does), is a worker not worth running.

import { type FrameStats, frameStats } from './frame_stats_core';
import { median } from './stats_core';

export interface WorkerWarmSample {
  id: number;
  /** The worker's own link time, on its clock. */
  linkMs: number;
  warmed: boolean;
}

export interface WorkerHitSample {
  cacheKey: string;
  /** The main context's link plus first draw after the warm. */
  ms: number;
  linked: boolean;
}

export interface WorkerPassSummary {
  /** Null when the worker never became ready. */
  readyMs: number | null;
  refusal: string | null;
  warmed: number;
  failed: number;
  medianWorkerLinkMs: number;
  /** Frames during the warm, under the load. */
  framesDuringWarm: FrameStats;
  /** The main context's cost after the warm (the hit). */
  medianHitMs: number;
  maxHitMs: number;
  /** The cold cost the link section measured, for the ratio. */
  coldMedianMs: number;
  /** hit over cold: below the threshold the warm paid for itself. */
  hitOverCold: number;
  /** The warm did not finish inside the frame budget: a bound. */
  capped: boolean;
}

/** A warm is worth it when the hit costs at most this fraction of the cold
 *  link (the challenge page's PASS rule) and the frames during the warm stay
 *  under the tolerance the decision applies. */
export const WORKER_HIT_RATIO_LIMIT = 0.25;

export function summarizeWorkerPass(input: {
  readyMs: number | null;
  refusal: string | null;
  warm: readonly WorkerWarmSample[];
  hits: readonly WorkerHitSample[];
  frameIntervalsMs: readonly number[];
  refreshMs: number;
  coldMedianMs: number;
  capped: boolean;
}): WorkerPassSummary {
  const warmed = input.warm.filter((sample) => sample.warmed);
  const hits = input.hits.filter((sample) => sample.linked).map((sample) => sample.ms);
  const medianHit = median(hits);
  return {
    readyMs: input.readyMs,
    refusal: input.refusal,
    warmed: warmed.length,
    failed: input.warm.length - warmed.length,
    medianWorkerLinkMs: median(warmed.map((sample) => sample.linkMs)),
    framesDuringWarm: frameStats(input.frameIntervalsMs, input.refreshMs),
    medianHitMs: medianHit,
    maxHitMs: hits.length === 0 ? Number.NaN : Math.max(...hits),
    coldMedianMs: input.coldMedianMs,
    hitOverCold: input.coldMedianMs > 0 ? medianHit / input.coldMedianMs : Number.NaN,
    capped: input.capped,
  };
}

/** The worker's decisive criteria, before the margin: ready, every program
 *  warmed, the hit a clear fraction of the cold link. The frame-gap
 *  tolerance is the decision core's, applied with the margin. */
export function workerWorthIt(summary: WorkerPassSummary): boolean {
  return (
    summary.readyMs !== null &&
    summary.refusal === null &&
    summary.failed === 0 &&
    summary.warmed > 0 &&
    !summary.capped &&
    Number.isFinite(summary.hitOverCold) &&
    summary.hitOverCold <= WORKER_HIT_RATIO_LIMIT
  );
}
