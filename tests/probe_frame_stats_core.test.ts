import { describe, expect, it } from 'vitest';
import { estimateRefreshMs, frameStats, noiseFloorVerdict } from '../src/probe/frame_stats_core';

const steady = (n: number, ms: number) => Array.from({ length: n }, () => ms);

describe('frame statistics', () => {
  it('estimates the refresh interval as the mode of an idle scene', () => {
    expect(estimateRefreshMs([16.6, 16.7, 16.8, 33.4, 16.7, 16.6, 17.1])).toBeCloseTo(16.7, 1);
    expect(estimateRefreshMs([6.9, 7.0, 6.9, 7.1, 13.9])).toBeCloseTo(6.95, 1);
    expect(Number.isNaN(estimateRefreshMs([]))).toBe(true);
  });

  it('reads long frames and lost time relative to the refresh', () => {
    const stats = frameStats([16.7, 16.7, 50, 16.7, 16.7, 25.05, 16.7], 16.7);
    expect(stats.frames).toBe(7);
    expect(stats.longFrames).toBe(2);
    expect(stats.lostMs).toBeCloseTo(50 - 16.7 + (25.05 - 16.7), 5);
    expect(stats.maxMs).toBe(50);
    expect(stats.onCadence).toBeCloseTo(5 / 7, 5);
    expect(stats.medianMs).toBe(16.7);
    // The same intervals at a 144 Hz refresh read very differently.
    expect(frameStats([7, 7, 14, 7], 6.94).longFrames).toBe(1);
  });

  it('judges the noise floor: enough frames, on cadence, no run of long frames', () => {
    expect(noiseFloorVerdict(frameStats(steady(60, 16.7), 16.7))).toEqual({
      ok: true,
      reason: 'ok',
    });
    expect(noiseFloorVerdict(frameStats(steady(10, 16.7), 16.7))).toEqual({
      ok: false,
      reason: 'too-few-frames',
    });
    const jittery = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 12 : 22));
    expect(noiseFloorVerdict(frameStats(jittery, 16.7))).toEqual({
      ok: false,
      reason: 'off-cadence',
    });
    const stalls = [...steady(56, 16.7), 60, 60, 60, 60];
    expect(noiseFloorVerdict(frameStats(stalls, 16.7))).toEqual({
      ok: false,
      reason: 'long-frames',
    });
  });
});
