// The measuring run of one child: the sections in order, each measuring
// section in two passes on its own salted set, a noise floor before each,
// the result assembled as it goes and handed to the sink after every
// section (a child that dies mid-arm leaves what it finished). This file is
// the host glue over the section runners and their cores; nothing here
// decides.

import { readGpuBackend } from '../render/gpu_backend_class_core';
import { isSoftwareRendererName } from '../render/software_renderer';
import { heavyPrograms, type ProbeCorpus } from './corpus_core';
import { loadProbeCorpus } from './corpus_loader';
import { runFrameLoop } from './frame_runner';
import {
  estimateRefreshMs,
  type FrameStats,
  frameStats,
  type NoiseFloorVerdict,
  noiseFloorVerdict,
} from './frame_stats_core';
import { type LinkPassResult, runLinkPass } from './link_section';
import { calibrateLoadPasses, createLoadScene, type LoadScene } from './load_scene';
import { type PacingPassResult, runPacingPass } from './pacing_section';
import { type ParallelPassResult, runParallelPass } from './parallel_section';
import { createProbeContext, type ProbeContext } from './probe_context';
import { passNonce, saltPrograms } from './salt_core';

export const PROBE_VERSION = 1;

export interface ProbeIdentity {
  renderer: string;
  backend: string;
  software: boolean;
  parallelCompile: boolean;
  extensions: string[];
  powerPreference: string;
  hardwareConcurrency: number;
  userAgent: string;
  canvasWidth: number;
  canvasHeight: number;
}

export interface ProbeSectionRecord<T> {
  passes: T[];
  /** Passes that were disturbed and replayed. */
  replays: number;
  /** The noise floor read right before the section. */
  floor: FrameStats;
}

export interface ProbeResult {
  probeVersion: number;
  run: string;
  round: number;
  tier: string;
  corpusTier: string | null;
  corpusHash: string | null;
  startedAt: number;
  identity: ProbeIdentity | null;
  /** The refresh interval the frame figures are relative to. */
  refreshMs: number | null;
  /** The calibrated load: passes per frame and what they cost. */
  load: { passes: number; targetMs: number } | null;
  sections: {
    links?: ProbeSectionRecord<LinkPassResult>;
    parallel?: ProbeSectionRecord<ParallelPassResult>;
    pacing?: ProbeSectionRecord<PacingPassResult>;
  };
  /** Why the run ended early, when it did. */
  ended: 'completed' | 'no-webgl2' | 'software' | 'no-corpus' | 'aborted' | 'busy';
  busy?: NoiseFloorVerdict;
}

/** Where each finished section goes: the child's main process over the
 *  bridge in the shell, the page's own globals in a plain browser. */
export interface ProbeSink {
  post(result: ProbeResult): void;
}

export interface ProbeRunOptions {
  run: string;
  round: number;
  tier: string;
  sink: ProbeSink;
  /** Where the probe's canvas is shown (the child window's body). */
  host?: HTMLElement;
  /** The refresh interval the shell read off the display; estimated when absent. */
  refreshMs?: number;
  /** The link sections' heavy set size. */
  heavyCount?: number;
  now?: () => number;
  document?: Document;
  fetchImpl?: typeof fetch;
}

const MAX_CANVAS_WIDTH = 1280;
const MAX_CANVAS_HEIGHT = 720;
/** Frames of the trivial scene the refresh estimate and each floor read. */
const REFRESH_FRAMES = 60;
const FLOOR_FRAMES = 45;
/** The load's share of one refresh interval, per frame. */
const LOAD_SHARE = 0.4;

/** Two painted frames before the context exists: a WebGL context created
 *  before the page's first composite is lost at once on a surface-less
 *  Vulkan (measured on Mesa ANV in a headless Chrome), and the shell's
 *  window is painted before it measures anyway. */
function paintedFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const tick = (): void => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function identityOf(context: ProbeContext): ProbeIdentity {
  const readout = readGpuBackend(context.gl);
  return {
    renderer: readout.renderer,
    backend: readout.backend,
    software: isSoftwareRendererName(readout.renderer),
    parallelCompile: context.parallelCompile,
    extensions: context.extensions,
    powerPreference: context.powerPreference,
    hardwareConcurrency: navigator.hardwareConcurrency ?? 0,
    userAgent: navigator.userAgent,
    canvasWidth: context.canvas.width,
    canvasHeight: context.canvas.height,
  };
}

interface Rig {
  context: ProbeContext;
  scene: LoadScene | null;
  loadPasses: number;
  refreshMs: number;
  now: () => number;
}

async function trivialFrames(rig: Rig, frames: number): Promise<number[]> {
  const loop = await runFrameLoop({
    gl: rig.context.gl,
    scene: null,
    passes: 0,
    frames,
    now: rig.now,
  });
  return loop.intervalsMs;
}

/** The floor before a section; null when the machine is busy. */
async function floorBefore(rig: Rig): Promise<{ stats: FrameStats; verdict: NoiseFloorVerdict }> {
  const stats = frameStats(await trivialFrames(rig, FLOOR_FRAMES), rig.refreshMs);
  return { stats, verdict: noiseFloorVerdict(stats) };
}

async function linkSection(
  rig: Rig,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
  floor: FrameStats,
): Promise<ProbeSectionRecord<LinkPassResult> | null> {
  const programs = heavyPrograms(corpus).slice(0, options.heavyCount ?? 12);
  const passes: LinkPassResult[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const nonce = passNonce(options.run, options.round, 'links', pass);
    const salted = saltPrograms(programs, nonce);
    const result = await runLinkPass(rig.context.gl, salted, { now: rig.now });
    if (result.aborted) return null;
    passes.push({
      cold: result.cold,
      hit: result.hit,
      coldSamples: result.coldSamples,
      hitSamples: result.hitSamples,
    });
  }
  return { passes, replays: 0, floor };
}

async function parallelSection(
  rig: Rig,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
  floor: FrameStats,
): Promise<ProbeSectionRecord<ParallelPassResult>> {
  const programs = heavyPrograms(corpus).slice(0, 6);
  const passes: ParallelPassResult[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const nonce = passNonce(options.run, options.round, 'parallel', pass);
    const salted = saltPrograms(programs, nonce);
    passes.push(
      await runParallelPass(salted, {
        gl: rig.context.gl,
        scene: rig.scene,
        loadPasses: rig.loadPasses,
        parallelCompile: rig.context.parallelCompile,
        refreshMs: rig.refreshMs,
        now: rig.now,
      }),
    );
  }
  return { passes, replays: 0, floor };
}

async function pacingSection(
  rig: Rig,
  floor: FrameStats,
): Promise<ProbeSectionRecord<PacingPassResult>> {
  const passes: PacingPassResult[] = [];
  for (let pass = 0; pass < 2; pass++) {
    passes.push(await runPacingPass(rig.context.gl, rig.refreshMs, { now: rig.now }));
  }
  return { passes, replays: 0, floor };
}

/** Run every section on this page's context; the sink hears every section. */
export async function runProbe(options: ProbeRunOptions): Promise<ProbeResult> {
  const now = options.now ?? (() => performance.now());
  const result: ProbeResult = {
    probeVersion: PROBE_VERSION,
    run: options.run,
    round: options.round,
    tier: options.tier,
    corpusTier: null,
    corpusHash: null,
    startedAt: Date.now(),
    identity: null,
    refreshMs: null,
    load: null,
    sections: {},
    ended: 'completed',
  };
  const post = (): void => options.sink.post(result);
  await paintedFrames(2);
  const width = Math.min(MAX_CANVAS_WIDTH, Math.max(320, window.innerWidth));
  const height = Math.min(MAX_CANVAS_HEIGHT, Math.max(240, window.innerHeight));
  const context = createProbeContext(width, height, options.document);
  if (!context) {
    result.ended = 'no-webgl2';
    post();
    return result;
  }
  // Shown, so the compositor presents it: a hidden canvas measures no
  // presentation and lets a surface-less backend drop the context.
  options.host?.append(context.canvas);
  context.gl.viewport(0, 0, width, height);
  try {
    result.identity = identityOf(context);
    post();
    if (result.identity.software) {
      result.ended = 'software';
      post();
      return result;
    }
    const loaded = await loadProbeCorpus(options.tier, options.fetchImpl);
    if (!loaded) {
      result.ended = 'no-corpus';
      post();
      return result;
    }
    result.corpusTier = loaded.tier;
    result.corpusHash = loaded.corpus.inputsHash;

    const rig: Rig = { context, scene: null, loadPasses: 0, refreshMs: Number.NaN, now };
    rig.refreshMs =
      options.refreshMs ?? estimateRefreshMs(await trivialFrames(rig, REFRESH_FRAMES));
    result.refreshMs = rig.refreshMs;
    rig.scene = createLoadScene(context.gl);
    if (rig.scene) {
      const targetMs = rig.refreshMs * LOAD_SHARE;
      rig.loadPasses = calibrateLoadPasses(context.gl, rig.scene, targetMs, now);
      result.load = { passes: rig.loadPasses, targetMs };
    }
    post();

    const sections: Array<{
      name: 'links' | 'parallel' | 'pacing';
      run: (floor: FrameStats) => Promise<unknown>;
    }> = [
      { name: 'links', run: (floor) => linkSection(rig, loaded.corpus, options, floor) },
      { name: 'parallel', run: (floor) => parallelSection(rig, loaded.corpus, options, floor) },
      { name: 'pacing', run: (floor) => pacingSection(rig, floor) },
    ];
    for (const section of sections) {
      const floor = await floorBefore(rig);
      if (!floor.verdict.ok) {
        result.ended = 'busy';
        result.busy = floor.verdict;
        post();
        return result;
      }
      const record = await section.run(floor.stats);
      if (!record) {
        result.ended = 'aborted';
        post();
        return result;
      }
      (result.sections as Record<string, unknown>)[section.name] = record;
      post();
    }
    return result;
  } finally {
    rigDispose(context);
  }
}

function rigDispose(context: ProbeContext): void {
  context.canvas.remove();
  context.dispose();
}
