import { describe, expect, it } from 'vitest';
import {
  max,
  median,
  minimumSampleReached,
  passVerdict,
  percentile,
  relativeSpread,
  trimmedMean,
} from '../src/probe/stats_core';

describe('the probe statistics', () => {
  it('median, max and percentile read the sorted samples by rank', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(max([3, 9, 2])).toBe(9);
    expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 0.9)).toBe(90);
    expect(percentile([5], 0.5)).toBe(5);
    expect(Number.isNaN(median([]))).toBe(true);
    expect(Number.isNaN(max([]))).toBe(true);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });

  it('the trimmed mean drops one stall and one lucky hit from twelve links', () => {
    const links = [10, 11, 12, 10, 11, 12, 10, 11, 12, 10, 1, 400];
    expect(trimmedMean(links)).toBeCloseTo(10.9, 1);
    expect(trimmedMean([7])).toBe(7);
    expect(Number.isNaN(trimmedMean([]))).toBe(true);
  });

  it('the relative spread of two passes is their gap over their mean', () => {
    expect(relativeSpread(10, 12)).toBeCloseTo(2 / 11, 6);
    expect(relativeSpread(5, 5)).toBe(0);
    expect(relativeSpread(0, 0)).toBe(0);
    expect(relativeSpread(0, 4)).toBe(2);
    expect(relativeSpread(Number.NaN, 4)).toBe(1);
  });

  it('the pass rule: two valid passes are a value, one forces round two, none is neutral', () => {
    expect(passVerdict([{ valid: true }, { valid: true }])).toEqual({
      kind: 'value',
      valid: [0, 1],
      forcesSecondRound: false,
    });
    expect(passVerdict([{ valid: false }, { valid: true }])).toEqual({
      kind: 'single-pass',
      valid: [1],
      forcesSecondRound: true,
    });
    expect(passVerdict([{ valid: false }, { valid: false }])).toEqual({
      kind: 'neutral',
      valid: [],
      forcesSecondRound: false,
    });
  });

  it('a section reaches its minimum sample only with a whole count at or past it', () => {
    expect(minimumSampleReached(12, 12)).toBe(true);
    expect(minimumSampleReached(11, 12)).toBe(false);
    expect(minimumSampleReached(12.5, 12)).toBe(false);
  });
});
