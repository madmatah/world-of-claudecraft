// Section 4, cold links on the main thread: the heavy corpus programs,
// salted for this pass, each compiled, linked and RESOLVED (the LINK_STATUS
// read) in turn on the main thread, timed one by one; then the unsalted
// repeat, the same texts linked again, which is the hit cost (the in-process
// program cache; with a fresh profile per child the disk cache is empty by
// construction). The GL discipline is the warm-up's (shader_warmup_gl_core:
// the location-0 bind, a resolved link); the decisions are
// link_section_core's. Yields between links so the watchdog and the shell's
// window-state push can be heard.

import {
  deleteWarmProgram,
  releaseWarmShaders,
  resolveWarmProgram,
  submitWarmProgram,
  type WarmupGl,
} from '../render/shader_warmup_gl_core';
import {
  type LinkPassSummary,
  type LinkSample,
  linkCapMs,
  summarizeLinkPass,
} from './link_section_core';
import type { SaltedProgram } from './salt_core';

export interface LinkPassResult {
  cold: LinkPassSummary;
  hit: LinkPassSummary;
  coldSamples: LinkSample[];
  hitSamples: LinkSample[];
}

export interface LinkPassOptions {
  minimum?: number;
  /** Called between links; a returning false aborts the pass (disturbed). */
  yieldFrame?: () => Promise<boolean>;
  now?: () => number;
}

const defaultYield = (): Promise<boolean> =>
  new Promise((resolve) => {
    const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number })
      .requestAnimationFrame;
    if (raf) raf(() => resolve(true));
    else setTimeout(() => resolve(true), 0);
  });

async function linkAll(
  gl: WarmupGl,
  programs: readonly SaltedProgram[],
  options: Required<Pick<LinkPassOptions, 'yieldFrame' | 'now'>> & { minimum: number },
): Promise<{ samples: LinkSample[]; capped: boolean; aborted: boolean }> {
  const samples: LinkSample[] = [];
  const timings: number[] = [];
  let capped = false;
  let aborted = false;
  for (const program of programs) {
    const started = options.now();
    const handle = submitWarmProgram(gl, program);
    if (!handle) {
      samples.push({ cacheKey: program.cacheKey, ms: 0, linked: false });
      continue;
    }
    // The resolve is the measured cost: on a backend that links off-thread
    // the submit returns at once and the LINK_STATUS read waits for it.
    const linked = resolveWarmProgram(gl, handle) === 'linked';
    const ms = options.now() - started;
    releaseWarmShaders(gl, handle);
    deleteWarmProgram(gl, handle);
    samples.push({ cacheKey: program.cacheKey, ms, linked });
    if (linked) {
      const cap = linkCapMs(timings);
      timings.push(ms);
      if (ms > cap) {
        capped = true;
        break;
      }
    }
    if (!(await options.yieldFrame())) {
      aborted = true;
      break;
    }
  }
  return { samples, capped, aborted };
}

/** One pass: the cold links, then the hit repeat over the same salted set. */
export async function runLinkPass(
  gl: WarmupGl,
  programs: readonly SaltedProgram[],
  options: LinkPassOptions = {},
): Promise<LinkPassResult & { aborted: boolean }> {
  const settings = {
    minimum: options.minimum ?? 12,
    yieldFrame: options.yieldFrame ?? defaultYield,
    now: options.now ?? (() => performance.now()),
  };
  const cold = await linkAll(gl, programs, settings);
  const hitRun = cold.aborted
    ? { samples: [], capped: false, aborted: true }
    : await linkAll(gl, programs, settings);
  return {
    cold: summarizeLinkPass(cold.samples, { minimum: settings.minimum, capped: cold.capped }),
    hit: summarizeLinkPass(hitRun.samples, { minimum: settings.minimum, capped: hitRun.capped }),
    coldSamples: cold.samples,
    hitSamples: hitRun.samples,
    aborted: cold.aborted || hitRun.aborted,
  };
}
