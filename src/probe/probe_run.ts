// The measuring run of one child: the sections in order, each measuring
// section in two passes on its own salted set, the result assembled as it
// goes and handed to the sink after every section (a child that dies
// mid-arm leaves what it finished). This file is the host glue over the
// section runners and their cores; nothing here decides.

import { readGpuBackend } from '../render/gpu_backend_class_core';
import { isSoftwareRendererName } from '../render/software_renderer';
import { heavyPrograms, type ProbeCorpus } from './corpus_core';
import { loadProbeCorpus } from './corpus_loader';
import { type LinkPassResult, runLinkPass } from './link_section';
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
}

export interface ProbeSectionRecord<T> {
  passes: T[];
  /** Passes that were disturbed and replayed. */
  replays: number;
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
  sections: {
    links?: ProbeSectionRecord<LinkPassResult>;
  };
  /** Why the run ended early, when it did. */
  ended: 'completed' | 'no-webgl2' | 'software' | 'no-corpus' | 'aborted';
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
  /** The link sections' heavy set size. */
  heavyCount?: number;
  now?: () => number;
  document?: Document;
  fetchImpl?: typeof fetch;
}

const PROBE_CANVAS_SIZE = 256;

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
  };
}

async function linkSection(
  context: ProbeContext,
  corpus: ProbeCorpus,
  options: ProbeRunOptions,
): Promise<ProbeSectionRecord<LinkPassResult> | null> {
  const programs = heavyPrograms(corpus).slice(0, options.heavyCount ?? 12);
  const passes: LinkPassResult[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const nonce = passNonce(options.run, options.round, 'links', pass);
    const salted = saltPrograms(programs, nonce);
    const result = await runLinkPass(context.gl, salted, { now: options.now });
    if (result.aborted) return null;
    passes.push({
      cold: result.cold,
      hit: result.hit,
      coldSamples: result.coldSamples,
      hitSamples: result.hitSamples,
    });
  }
  return { passes, replays: 0 };
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
    sections: {},
    ended: 'completed',
  };
  const context = createProbeContext(PROBE_CANVAS_SIZE, PROBE_CANVAS_SIZE, options.document);
  if (!context) {
    result.ended = 'no-webgl2';
    options.sink.post(result);
    return result;
  }
  try {
    result.identity = identityOf(context);
    options.sink.post(result);
    if (result.identity.software) {
      result.ended = 'software';
      options.sink.post(result);
      return result;
    }
    const loaded = await loadProbeCorpus(options.tier, options.fetchImpl);
    if (!loaded) {
      result.ended = 'no-corpus';
      options.sink.post(result);
      return result;
    }
    result.corpusTier = loaded.tier;
    result.corpusHash = loaded.corpus.inputsHash;
    const links = await linkSection(context, loaded.corpus, { ...options, now });
    if (!links) {
      result.ended = 'aborted';
      options.sink.post(result);
      return result;
    }
    result.sections.links = links;
    options.sink.post(result);
    return result;
  } finally {
    context.dispose();
  }
}
