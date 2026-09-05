// Section 5, real parallelism, the runner: a batch of salted links submitted
// two at a time under the calibrated load, one completion poll per link per
// frame. Without KHR_parallel_shader_compile on this context the links are
// resolved by a blocking read, one per frame, and the pass is marked
// blocking: the frame figures then ARE the synchronous cost. The decisions
// are parallel_section_core's; the GL discipline is the warm-up's.

import {
  deleteWarmProgram,
  pollWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
  type WarmProgramHandle,
} from '../render/shader_warmup_gl_core';
import { runFrameLoop } from './frame_runner';
import type { LoadScene } from './load_scene';
import {
  PARALLEL_WINDOW,
  type ParallelLinkSample,
  type ParallelPassSummary,
  summarizeParallelPass,
} from './parallel_section_core';
import type { SaltedProgram } from './salt_core';

export interface ParallelPassOptions {
  gl: WebGL2RenderingContext;
  scene: LoadScene | null;
  loadPasses: number;
  parallelCompile: boolean;
  refreshMs: number;
  /** Frames the batch may take before it is capped (no progress). */
  maxFrames?: number;
  now?: () => number;
}

export interface ParallelPassResult {
  summary: ParallelPassSummary;
  samples: ParallelLinkSample[];
  frameIntervalsMs: number[];
  capped: boolean;
}

interface InFlight {
  program: SaltedProgram;
  handle: WarmProgramHandle;
  startedAt: number;
  framesPending: number;
}

export async function runParallelPass(
  programs: readonly SaltedProgram[],
  options: ParallelPassOptions,
): Promise<ParallelPassResult> {
  const now = options.now ?? (() => performance.now());
  const { gl } = options;
  const queue = [...programs];
  const inFlight: InFlight[] = [];
  const samples: ParallelLinkSample[] = [];
  const window = options.parallelCompile ? PARALLEL_WINDOW : 1;
  const maxFrames = options.maxFrames ?? 600;
  let lastProgressFrame = 0;
  let capped = false;

  const finish = (entry: InFlight, linked: boolean, t: number): void => {
    releaseWarmShaders(gl, entry.handle);
    deleteWarmProgram(gl, entry.handle);
    samples.push({
      cacheKey: entry.program.cacheKey,
      framesPending: entry.framesPending,
      ms: t - entry.startedAt,
      linked,
    });
  };

  const loop = await runFrameLoop({
    gl,
    scene: options.scene,
    passes: options.loadPasses,
    frames: maxFrames,
    now,
    onFrame: (frame, t) => {
      // Fill the window first, so a link submitted this frame is polled next frame.
      while (inFlight.length < window && queue.length > 0) {
        const program = queue.shift() as SaltedProgram;
        const handle = submitWarmProgram(gl, program);
        if (!handle) {
          samples.push({ cacheKey: program.cacheKey, framesPending: 0, ms: 0, linked: false });
          continue;
        }
        inFlight.push({ program, handle, startedAt: t, framesPending: 0 });
      }
      for (let i = inFlight.length - 1; i >= 0; i--) {
        const entry = inFlight[i];
        if (options.parallelCompile) {
          const state = pollWarmProgram(gl, entry.handle);
          if (state === 'pending') {
            entry.framesPending += 1;
            continue;
          }
          inFlight.splice(i, 1);
          finish(entry, state === 'linked', now());
          lastProgressFrame = frame;
        } else {
          // One blocking resolve per frame: the synchronous cost, on the frame.
          inFlight.splice(i, 1);
          finish(entry, resolveWarmProgram(gl, entry.handle) === 'linked', now());
          lastProgressFrame = frame;
          break;
        }
      }
      if (inFlight.length === 0 && queue.length === 0) return false;
      // No link resolved for a long stretch: the batch is wedged, not slow.
      if (frame - lastProgressFrame > 300) {
        capped = true;
        return false;
      }
      return true;
    },
  });
  for (const entry of inFlight) finish(entry, false, now());
  return {
    summary: summarizeParallelPass(samples, loop.intervalsMs, options.refreshMs, {
      blocking: !options.parallelCompile,
    }),
    samples,
    frameIntervalsMs: loop.intervalsMs,
    capped,
  };
}
