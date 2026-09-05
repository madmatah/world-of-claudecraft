// Section 10, presentation pacing: the trivial scene under vsync for a few
// seconds, read against the display's real refresh. A backend that holds
// the frame rate but presents irregularly feels stuttery; the figures are
// frame_stats_core's (on-cadence fraction, long frames, lost time). Windowed
// here; the shell adds the borderless half and the toggle in step 2.

import { runFrameLoop } from './frame_runner';
import { type FrameStats, frameStats } from './frame_stats_core';

export interface PacingPassResult {
  windowed: FrameStats;
  intervalsMs: number[];
}

export const PACING_FRAMES = 180;

export async function runPacingPass(
  gl: WebGL2RenderingContext,
  refreshMs: number,
  options: { frames?: number; now?: () => number } = {},
): Promise<PacingPassResult> {
  const loop = await runFrameLoop({
    gl,
    scene: null,
    passes: 0,
    frames: options.frames ?? PACING_FRAMES,
    now: options.now,
  });
  return { windowed: frameStats(loop.intervalsMs, refreshMs), intervalsMs: loop.intervalsMs };
}
