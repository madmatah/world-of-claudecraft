import { describe, expect, it } from 'vitest';
import {
  summarizeWorkerPass,
  WORKER_HIT_RATIO_LIMIT,
  workerWorthIt,
} from '../src/probe/worker_section_core';

const base = {
  readyMs: 120,
  refusal: null,
  warm: [
    { id: 1, linkMs: 300, warmed: true },
    { id: 2, linkMs: 340, warmed: true },
  ],
  hits: [
    { cacheKey: 'a', ms: 40, linked: true },
    { cacheKey: 'b', ms: 50, linked: true },
  ],
  frameIntervalsMs: [16.7, 16.7, 20, 16.7],
  refreshMs: 16.7,
  coldMedianMs: 320,
  capped: false,
};

describe('the worker section core', () => {
  it('summarizes the warm, the hit and their ratio', () => {
    const summary = summarizeWorkerPass(base);
    expect(summary.warmed).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.medianWorkerLinkMs).toBe(320);
    expect(summary.medianHitMs).toBe(45);
    expect(summary.maxHitMs).toBe(50);
    expect(summary.hitOverCold).toBeCloseTo(45 / 320, 5);
    expect(summary.framesDuringWarm.frames).toBe(4);
    expect(workerWorthIt(summary)).toBe(true);
  });

  it('is not worth it when refused, capped, failing, or when the hit costs like a cold link', () => {
    expect(
      workerWorthIt(summarizeWorkerPass({ ...base, readyMs: null, refusal: 'no-webgl2' })),
    ).toBe(false);
    expect(workerWorthIt(summarizeWorkerPass({ ...base, capped: true }))).toBe(false);
    expect(
      workerWorthIt(summarizeWorkerPass({ ...base, warm: [{ id: 1, linkMs: 1, warmed: false }] })),
    ).toBe(false);
    const vulkanLike = summarizeWorkerPass({
      ...base,
      hits: [{ cacheKey: 'a', ms: 300, linked: true }],
    });
    expect(vulkanLike.hitOverCold).toBeGreaterThan(WORKER_HIT_RATIO_LIMIT);
    expect(workerWorthIt(vulkanLike)).toBe(false);
  });
});
