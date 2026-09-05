// Section 6, the runner: the game's REAL warm worker (shader_warm_worker.ts,
// the same script and the same init message the client sends) warms a
// salted set on its own OffscreenCanvas context while the page draws the
// calibrated load and counts its frames; then the main context links the
// same texts with a first draw each, which is the hit the game would pay
// after a warm. The decisions are worker_section_core's.

import type {
  ShaderWarmClientMessage,
  ShaderWarmSource,
  ShaderWarmWorkerMessage,
} from '../render/shader_warm_protocol';
import { SHADER_WARM_MAX_WINDOW_DESKTOP } from '../render/shader_warm_worker_core';
import {
  deleteWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
} from '../render/shader_warmup_gl_core';
import { runFrameLoop } from './frame_runner';
import { createFirstDrawRig } from './link_section';
import type { LoadScene } from './load_scene';
import type { SaltedProgram } from './salt_core';
import {
  summarizeWorkerPass,
  type WorkerHitSample,
  type WorkerPassSummary,
  type WorkerWarmSample,
} from './worker_section_core';

export interface WorkerPassOptions {
  gl: WebGL2RenderingContext;
  contextAttributes: Record<string, unknown> | null;
  extensions: readonly string[];
  scene: LoadScene | null;
  loadPasses: number;
  refreshMs: number;
  coldMedianMs: number;
  /** Frames to wait for the worker's ready message. */
  readyFrames?: number;
  /** Frames without a warmed link before the warm is capped. */
  noProgressFrames?: number;
  spawn?: () => Worker | null;
  now?: () => number;
}

export interface WorkerPassResult {
  summary: WorkerPassSummary;
  warm: WorkerWarmSample[];
  hits: WorkerHitSample[];
  frameIntervalsMs: number[];
}

function defaultSpawn(): Worker | null {
  try {
    return new Worker(new URL('../render/shader_warm_worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

export async function runWorkerPass(
  programs: readonly SaltedProgram[],
  options: WorkerPassOptions,
): Promise<WorkerPassResult> {
  const now = options.now ?? (() => performance.now());
  const { gl } = options;
  const worker = (options.spawn ?? defaultSpawn)();
  const warm: WorkerWarmSample[] = [];
  const hits: WorkerHitSample[] = [];
  let readyMs: number | null = null;
  let refusal: string | null = worker ? null : 'no-worker';
  let capped = false;
  let intervals: number[] = [];

  if (worker) {
    const startedAt = now();
    const pending = new Set<number>();
    const linkOf = new Map<number, string>();
    let ready = false;
    let lastProgressFrame = 0;
    worker.onmessage = (event: MessageEvent<ShaderWarmWorkerMessage>) => {
      const message = event.data;
      if (message.kind === 'ready') {
        ready = true;
        readyMs = now() - startedAt;
        if (!message.ok) refusal = message.reason;
      } else if (message.kind === 'warmed') {
        pending.delete(message.id);
        warm.push({ id: message.id, linkMs: message.linkMs, warmed: true });
      } else if (message.kind === 'failed') {
        pending.delete(message.id);
        warm.push({ id: message.id, linkMs: 0, warmed: false });
      } else if (message.kind === 'lost') {
        refusal = 'context-lost';
      }
    };
    const post = (message: ShaderWarmClientMessage): void => worker.postMessage(message);
    post({
      kind: 'init',
      contextAttributes: options.contextAttributes,
      extensions: [...options.extensions],
      maxWindow: SHADER_WARM_MAX_WINDOW_DESKTOP,
      retain: 0,
    });
    const sources: ShaderWarmSource[] = programs.map((program, index) => {
      pending.add(index + 1);
      linkOf.set(index + 1, program.cacheKey);
      return {
        id: index + 1,
        vertex: program.vertex,
        fragment: program.fragment,
        index0Attribute: program.index0Attribute,
        priority: 1,
      };
    });
    let sent = false;
    const readyFrames = options.readyFrames ?? 180;
    const noProgress = options.noProgressFrames ?? 300;
    let warmedSeen = 0;
    const loop = await runFrameLoop({
      gl,
      scene: options.scene,
      passes: options.loadPasses,
      frames: readyFrames + noProgress * programs.length,
      now,
      onFrame: (frame) => {
        if (refusal !== null) return false;
        if (!ready) return frame < readyFrames;
        if (!sent) {
          post({ kind: 'warm', sources });
          sent = true;
          lastProgressFrame = frame;
        }
        if (warm.length > warmedSeen) {
          warmedSeen = warm.length;
          lastProgressFrame = frame;
        }
        if (pending.size === 0) return false;
        if (frame - lastProgressFrame > noProgress) {
          capped = true;
          return false;
        }
        return true;
      },
    });
    intervals = loop.intervalsMs;
    if (!ready && refusal === null) refusal = 'ready-timeout';
    worker.terminate();
  }

  // The hit: the same texts on the main context, link plus first draw.
  if (refusal === null && !capped) {
    const rig = createFirstDrawRig(gl);
    for (const program of programs) {
      const started = now();
      const handle = submitWarmProgram(gl, program);
      if (!handle) {
        hits.push({ cacheKey: program.cacheKey, ms: 0, linked: false });
        continue;
      }
      const linked = resolveWarmProgram(gl, handle) === 'linked';
      if (linked) rig.draw(handle.program);
      hits.push({ cacheKey: program.cacheKey, ms: now() - started, linked });
      releaseWarmShaders(gl, handle);
      deleteWarmProgram(gl, handle);
    }
    rig.dispose();
  }

  return {
    summary: summarizeWorkerPass({
      readyMs,
      refusal,
      warm,
      hits,
      frameIntervalsMs: intervals,
      refreshMs: options.refreshMs,
      coldMedianMs: options.coldMedianMs,
      capped,
    }),
    warm,
    hits,
    frameIntervalsMs: intervals,
  };
}
