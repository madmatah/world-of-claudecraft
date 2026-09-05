import { describe, expect, it } from 'vitest';
import { linkCapMs, summarizeLinkPass } from '../src/probe/link_section_core';

describe('the cold-link section core', () => {
  it('caps the next link at a multiple of the median so far, never before three links', () => {
    expect(linkCapMs([])).toBe(Infinity);
    expect(linkCapMs([100, 120])).toBe(Infinity);
    expect(linkCapMs([100, 120, 110])).toBe(2000);
    expect(linkCapMs([500, 600, 550])).toBe(4400);
    expect(linkCapMs([500, 600, 550], { multiple: 2, floorMs: 100 })).toBe(1100);
  });

  it('summarizes a pass over the linked samples and flags a cap and failures', () => {
    const samples = [
      { cacheKey: 'a', ms: 100, linkMs: 90, drawMs: 10, linked: true },
      { cacheKey: 'b', ms: 300, linkMs: 10, drawMs: 290, linked: true },
      { cacheKey: 'c', ms: 200, linkMs: 150, drawMs: 50, linked: true },
      { cacheKey: 'd', ms: 5, linkMs: 5, drawMs: 0, linked: false },
    ];
    const summary = summarizeLinkPass(samples, { minimum: 3 });
    expect(summary).toEqual({
      count: 3,
      medianMs: 200,
      maxMs: 300,
      trimmedMeanMs: 200,
      medianLinkMs: 90,
      medianDrawMs: 50,
      capped: false,
      failed: 1,
      reachedMinimum: true,
    });
    expect(summarizeLinkPass(samples, { minimum: 12, capped: true }).capped).toBe(true);
    expect(summarizeLinkPass(samples, { minimum: 12 }).reachedMinimum).toBe(false);
  });
});
