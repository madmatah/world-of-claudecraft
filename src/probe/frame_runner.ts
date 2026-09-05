// The probe's frame loop: draw the load (or nothing, the trivial scene) for
// N animation frames and hand back the intervals between them. The noise
// floor, the refresh estimate and the presentation pacing are all this
// loop with different counts; the parallel and upload sections run their
// own work inside a frame through the `onFrame` hook. Thin host code over
// requestAnimationFrame; the reading of the intervals is frame_stats_core's.

import type { LoadScene } from './load_scene';

export interface FrameLoopOptions {
  frames: number;
  /** Load passes per frame; 0 draws a clear only (the trivial scene). */
  passes: number;
  scene: LoadScene | null;
  gl: WebGL2RenderingContext;
  /** Work to do inside each frame after the load; return false to stop early. */
  onFrame?: (frame: number, nowMs: number) => boolean;
  now?: () => number;
  raf?: (callback: (t: number) => void) => number;
}

export interface FrameLoopResult {
  intervalsMs: number[];
  /** The loop stopped early at the hook's request. */
  stopped: boolean;
}

/** Run the loop; the first frame's interval is discarded (it measures the
 *  wait before the loop, not a frame). */
export function runFrameLoop(options: FrameLoopOptions): Promise<FrameLoopResult> {
  const now = options.now ?? (() => performance.now());
  const raf = options.raf ?? ((callback) => requestAnimationFrame(callback));
  const { gl } = options;
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = Number.NaN;
    let frame = 0;
    let stopped = false;
    const tick = (): void => {
      const t = now();
      if (Number.isFinite(last)) intervals.push(t - last);
      last = t;
      gl.clearColor(0.05, 0.05, 0.08, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (options.passes > 0 && options.scene) options.scene.draw(options.passes, frame * 0.05);
      if (options.onFrame && options.onFrame(frame, t) === false) {
        stopped = true;
        resolve({ intervalsMs: intervals, stopped });
        return;
      }
      frame += 1;
      if (frame >= options.frames) {
        resolve({ intervalsMs: intervals, stopped });
        return;
      }
      raf(tick);
    };
    raf(tick);
  });
}
