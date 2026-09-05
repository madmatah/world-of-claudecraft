// The measuring run of one child: the sections in order, each measuring
// section in two passes on its own salted set, a noise floor before each,
// a disturbed pass replayed once, the result assembled as it goes and handed
// to the sink after every section (a child that dies mid-arm leaves what it
// finished). This file is the host glue over the section runners and their
// cores; nothing here decides.

import { readGpuBackend } from '../render/gpu_backend_class_core';
import { isSoftwareRendererName } from '../render/software_renderer';
import type { CapabilityReport } from './capability_core';
import { runCapabilitySection } from './capability_section';
import { heavyPrograms, type ProbeCorpus, programRole } from './corpus_core';
import { loadProbeCorpus } from './corpus_loader';
import { runFrameLoop } from './frame_runner';
import { type FramePassResult, linkCorpusProgram, runFramePass } from './frame_section';
import {
  estimateRefreshMs,
  type FrameStats,
  frameStats,
  type NoiseFloorVerdict,
  noiseFloorVerdict,
} from './frame_stats_core';
import { createInterferenceMonitor, type InterferenceMonitor } from './interference';
import { type LinkPassResult, runLinkPass } from './link_section';
import { calibrateLoadPasses, createLoadScene, type LoadScene } from './load_scene';
import { type PacingPassResult, runPacingPass } from './pacing_section';
import { type ParallelPassResult, runParallelPass } from './parallel_section';
import { createProbeContext, type ProbeContext } from './probe_context';
import { passNonce, saltPrograms } from './salt_core';
import { runUploadPass, type UploadPassResult } from './upload_section';
import { runWorkerPass, type WorkerPassResult } from './worker_section';

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
  /** Per pass: false when it was disturbed on its replay too. */
  validity: boolean[];
  /** Passes that were disturbed and replayed. */
  replays: number;
  /** What disturbed them. */
  disturbances: string[];
  /** The noise floor read right before the section. */
  floor: FrameStats;
}

export type ProbeSectionName = 'links' | 'parallel' | 'worker' | 'uploads' | 'frame' | 'pacing';

export interface ProbeResult {
  probeVersion: number;
  run: string;
  round: number;
  tier: string;
  corpusTier: string | null;
  corpusHash: string | null;
  startedAt: number;
  identity: ProbeIdentity | null;
  capability: CapabilityReport | null;
  /** Navigation start to the probe's first painted frame, informative. */
  bootMs: number | null;
  /** The refresh interval the frame figures are relative to. */
  refreshMs: number | null;
  /** The calibrated load: passes per frame and what they cost. */
  load: { passes: number; targetMs: number } | null;
  sections: {
    links?: ProbeSectionRecord<LinkPassResult>;
    parallel?: ProbeSectionRecord<ParallelPassResult>;
    worker?: ProbeSectionRecord<WorkerPassResult>;
    uploads?: ProbeSectionRecord<UploadPassResult>;
    frame?: ProbeSectionRecord<FramePassResult>;
    pacing?: ProbeSectionRecord<PacingPassResult>;
  };
  /** Why the run ended early, when it did. */
  ended: 'completed' | 'no-webgl2' | 'software' | 'no-corpus' | 'aborted' | 'busy' | 'capped';
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
  monitor?: InterferenceMonitor;
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
const PASSES = 2;

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
  document: Document | undefined;
  monitor: InterferenceMonitor;
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

/** The floor before a section, and whether the machine is clean enough. */
async function floorBefore(rig: Rig): Promise<{ stats: FrameStats; verdict: NoiseFloorVerdict }> {
  const stats = frameStats(await trivialFrames(rig, FLOOR_FRAMES), rig.refreshMs);
  return { stats, verdict: noiseFloorVerdict(stats) };
}

/** The pass rule's host half: each pass runs under the monitor; a disturbed
 *  pass is replayed once with a fresh nonce slot; still disturbed, it is
 *  kept but marked invalid. A pass that aborts ends the section (null). */
async function runPasses<T>(
  rig: Rig,
  floor: FrameStats,
  run: (slot: number) => Promise<T | null>,
): Promise<ProbeSectionRecord<T> | null> {
  const passes: T[] = [];
  const validity: boolean[] = [];
  const disturbances: string[] = [];
  let replays = 0;
  for (let pass = 0; pass < PASSES; pass++) {
    let slot = pass;
    let result: T | null = null;
    let valid = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      rig.monitor.mark();
      result = await run(slot);
      if (result === null) return null;
      if (!rig.monitor.disturbed()) {
        valid = true;
        break;
      }
      disturbances.push(...rig.monitor.reasons());
      if (attempt === 0) {
        replays += 1;
        // A fresh slot so the replay links texts no earlier attempt linked.
        slot = pass + 10 * (attempt + 1);
      }
    }
    passes.push(result as T);
    validity.push(valid);
  }
  return { passes, validity, replays, disturbances, floor };
}

function linkSection(
  rig: Rig,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
  floor: FrameStats,
): Promise<ProbeSectionRecord<LinkPassResult> | null> {
  const programs = heavyPrograms(corpus).slice(0, options.heavyCount ?? 12);
  return runPasses(rig, floor, async (slot) => {
    const salted = saltPrograms(programs, passNonce(options.run, options.round, 'links', slot));
    const result = await runLinkPass(rig.context.gl, salted, { now: rig.now });
    if (result.aborted) return null;
    return {
      cold: result.cold,
      hit: result.hit,
      coldSamples: result.coldSamples,
      hitSamples: result.hitSamples,
    };
  });
}

function parallelSection(
  rig: Rig,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
  floor: FrameStats,
): Promise<ProbeSectionRecord<ParallelPassResult> | null> {
  const programs = heavyPrograms(corpus).slice(0, 6);
  return runPasses(rig, floor, (slot) =>
    runParallelPass(
      saltPrograms(programs, passNonce(options.run, options.round, 'parallel', slot)),
      {
        gl: rig.context.gl,
        scene: rig.scene,
        loadPasses: rig.loadPasses,
        parallelCompile: rig.context.parallelCompile,
        refreshMs: rig.refreshMs,
        now: rig.now,
      },
    ),
  );
}

function workerSection(
  rig: Rig,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
  floor: FrameStats,
  coldMedianMs: number,
): Promise<ProbeSectionRecord<WorkerPassResult> | null> {
  const programs = heavyPrograms(corpus).slice(0, 6);
  return runPasses(rig, floor, (slot) =>
    runWorkerPass(saltPrograms(programs, passNonce(options.run, options.round, 'worker', slot)), {
      gl: rig.context.gl,
      contextAttributes: rig.context.gl.getContextAttributes() as Record<string, unknown> | null,
      extensions: rig.context.extensions,
      scene: rig.scene,
      loadPasses: rig.loadPasses,
      refreshMs: rig.refreshMs,
      coldMedianMs,
      now: rig.now,
    }),
  );
}

function uploadSection(
  rig: Rig,
  floor: FrameStats,
): Promise<ProbeSectionRecord<UploadPassResult> | null> {
  return runPasses(rig, floor, () =>
    runUploadPass({
      gl: rig.context.gl,
      scene: rig.scene,
      loadPasses: rig.loadPasses,
      refreshMs: rig.refreshMs,
      now: rig.now,
      document: rig.document,
    }),
  );
}

async function frameSection(
  rig: Rig,
  corpus: ProbeCorpus,
  floor: FrameStats,
): Promise<ProbeSectionRecord<FramePassResult> | null> {
  const gl = rig.context.gl;
  // Four heavy programs and a depth twin, linked unsalted once for the
  // section (the salted sets of the link sections are untouched by them).
  const colourPrograms = heavyPrograms(corpus)
    .slice(0, 4)
    .map((program) => linkCorpusProgram(gl, program))
    .filter((program): program is WebGLProgram => program !== null);
  const twin = corpus.programs.find((program) => programRole(program) === 'twin');
  const shadowProgram = twin ? linkCorpusProgram(gl, twin) : null;
  const record = await runPasses(rig, floor, () =>
    runFramePass({
      gl,
      refreshMs: rig.refreshMs,
      colourPrograms,
      shadowProgram,
      width: rig.context.canvas.width,
      height: rig.context.canvas.height,
      now: rig.now,
    }),
  );
  for (const program of colourPrograms) gl.deleteProgram(program);
  if (shadowProgram) gl.deleteProgram(shadowProgram);
  return record;
}

function pacingSection(
  rig: Rig,
  floor: FrameStats,
): Promise<ProbeSectionRecord<PacingPassResult> | null> {
  return runPasses(rig, floor, () =>
    runPacingPass(rig.context.gl, rig.refreshMs, { now: rig.now }),
  );
}

type LinkSectionRecord = ProbeSectionRecord<LinkPassResult>;

/** Capped when every VALID pass hit the cap (a disturbed pass says nothing). */
function linkSectionCapped(record: LinkSectionRecord): boolean {
  const valid = record.passes.filter((_, i) => record.validity[i]);
  return valid.length > 0 && valid.every((pass) => pass.cold.capped);
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
    capability: null,
    bootMs: null,
    refreshMs: null,
    load: null,
    sections: {},
    ended: 'completed',
  };
  const post = (): void => options.sink.post(result);
  await paintedFrames(2);
  result.bootMs = performance.now();
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
  const monitor = options.monitor ?? createInterferenceMonitor(options.document ?? document);
  try {
    result.identity = identityOf(context);
    result.capability = runCapabilitySection(context);
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

    const rig: Rig = {
      context,
      scene: null,
      loadPasses: 0,
      refreshMs: Number.NaN,
      now,
      document: options.document,
      monitor,
    };
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

    const coldMedian = (): number => {
      const links = result.sections.links;
      if (!links) return Number.NaN;
      const valid = links.passes.filter((_, i) => links.validity[i]);
      return valid.reduce((sum, pass) => sum + pass.cold.medianMs, 0) / Math.max(1, valid.length);
    };
    const sections: Array<{
      name: ProbeSectionName;
      run: (floor: FrameStats) => Promise<unknown>;
    }> = [
      { name: 'links', run: (floor) => linkSection(rig, loaded.corpus, options, floor) },
      { name: 'parallel', run: (floor) => parallelSection(rig, loaded.corpus, options, floor) },
      {
        name: 'worker',
        run: (floor) => workerSection(rig, loaded.corpus, options, floor, coldMedian()),
      },
      { name: 'uploads', run: (floor) => uploadSection(rig, floor) },
      { name: 'frame', run: (floor) => frameSection(rig, loaded.corpus, floor) },
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
      // The link section's no-progress cap ends the arm: its linked set feeds
      // every later section, and a backend that cannot link the corpus in
      // time is measured as that bound, never as the sections it never ran.
      if (section.name === 'links' && linkSectionCapped(record as LinkSectionRecord)) {
        result.ended = 'capped';
        post();
        return result;
      }
    }
    return result;
  } finally {
    if (!options.monitor) monitor.dispose();
    context.canvas.remove();
    context.dispose();
  }
}
