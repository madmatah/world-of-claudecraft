import { describe, expect, it } from 'vitest';
import { PARALLEL_WINDOW, summarizeParallelPass } from '../src/probe/parallel_section_core';

describe('the parallelism section core', () => {
  it('reads the async fraction, the pending frames and the frames under load', () => {
    const samples = [
      { cacheKey: 'a', framesPending: 12, ms: 200, linked: true },
      { cacheKey: 'b', framesPending: 0, ms: 5, linked: true },
      { cacheKey: 'c', framesPending: 8, ms: 140, linked: true },
      { cacheKey: 'd', framesPending: 0, ms: 0, linked: false },
    ];
    const summary = summarizeParallelPass(samples, [16.7, 16.7, 40, 16.7], 16.7, { minimum: 3 });
    expect(summary.count).toBe(3);
    expect(summary.failed).toBe(1);
    expect(summary.asyncFraction).toBeCloseTo(2 / 3, 5);
    expect(summary.medianFramesPending).toBe(8);
    expect(summary.medianMs).toBe(140);
    expect(summary.frames.longFrames).toBe(1);
    expect(summary.blocking).toBe(false);
    expect(summary.reachedMinimum).toBe(true);
  });

  it('marks a blocking pass and an empty one', () => {
    const summary = summarizeParallelPass([], [], 16.7, { blocking: true });
    expect(summary.blocking).toBe(true);
    expect(Number.isNaN(summary.asyncFraction)).toBe(true);
    expect(summary.reachedMinimum).toBe(false);
  });

  it('keeps the paced window at two links in flight', () => {
    expect(PARALLEL_WINDOW).toBe(2);
  });
});
