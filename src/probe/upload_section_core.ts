// Section 8, upload hitches: the decisions, host-agnostic. The game streams
// compressed textures, uploads procedural textures drawn on 2D canvases, and
// fills geometry buffers during play; each path costs the main thread its
// call and the frame it lands in. A pass uploads one item per frame under
// the calibrated load, over each path, and reads the call times and the
// frames' cost relative to the refresh.

import { type FrameStats, frameStats } from './frame_stats_core';
import { max, median } from './stats_core';

export type UploadPath = 'compressed' | 'canvas' | 'buffer';

export interface UploadSample {
  path: UploadPath;
  /** The upload call alone, milliseconds. */
  callMs: number;
  /** The whole frame the upload landed in. */
  frameMs: number;
  bytes: number;
}

export interface UploadPathSummary {
  path: UploadPath;
  count: number;
  medianCallMs: number;
  maxCallMs: number;
  medianFrameMs: number;
  maxFrameMs: number;
  bytesPerUpload: number;
  /** The path was not exercised (no compressed format on this context). */
  skipped: boolean;
}

export interface UploadPassSummary {
  paths: UploadPathSummary[];
  frames: FrameStats;
}

export const UPLOAD_PATHS: readonly UploadPath[] = ['compressed', 'canvas', 'buffer'];

export function summarizeUploadPass(
  samples: readonly UploadSample[],
  frameIntervalsMs: readonly number[],
  refreshMs: number,
  skipped: readonly UploadPath[] = [],
): UploadPassSummary {
  const paths = UPLOAD_PATHS.map((path) => {
    const own = samples.filter((sample) => sample.path === path);
    return {
      path,
      count: own.length,
      medianCallMs: median(own.map((s) => s.callMs)),
      maxCallMs: max(own.map((s) => s.callMs)),
      medianFrameMs: median(own.map((s) => s.frameMs)),
      maxFrameMs: max(own.map((s) => s.frameMs)),
      bytesPerUpload: own.length === 0 ? 0 : own[0].bytes,
      skipped: skipped.includes(path),
    };
  });
  return { paths, frames: frameStats(frameIntervalsMs, refreshMs) };
}
