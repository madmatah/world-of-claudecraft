// Frame-interval statistics, host-agnostic: what the noise floor, the
// presentation pacing and every "frames during X" measurement are read from.
//
// Every figure is RELATIVE to the display's refresh interval (never a
// hard-coded 16.7 ms): a frame is "long" past one and a half intervals, and
// "lost time" is what a long frame cost beyond the interval. The refresh
// interval itself is the shell's reading of the display when it has one, or
// the mode of the intervals of an idle scene when it does not (a plain
// browser). A bad noise floor (the machine busy with something else) stops
// the run; the same statistics say so.

import { max, median, percentile } from './stats_core';

export interface FrameStats {
  frames: number;
  /** The refresh interval the figures are relative to. */
  refreshMs: number;
  medianMs: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  /** Frames longer than 1.5 refresh intervals. */
  longFrames: number;
  /** Milliseconds the long frames cost beyond one interval each. */
  lostMs: number;
  /** Frames within 20 percent of the refresh interval, as a fraction. */
  onCadence: number;
}

export const LONG_FRAME_FACTOR = 1.5;
export const CADENCE_TOLERANCE = 0.2;

/** The refresh interval of an idle scene: the mode of its intervals, over
 *  one-millisecond bins, so a 60 Hz display reads 16 or 17 and a 144 Hz one
 *  reads 7; the median of the bin's members refines it. */
export function estimateRefreshMs(intervalsMs: readonly number[]): number {
  if (intervalsMs.length === 0) return Number.NaN;
  const bins = new Map<number, number[]>();
  for (const interval of intervalsMs) {
    const bin = Math.round(interval);
    const members = bins.get(bin);
    if (members) members.push(interval);
    else bins.set(bin, [interval]);
  }
  let best: number[] = [];
  for (const members of bins.values()) if (members.length > best.length) best = members;
  return median(best);
}

export function frameStats(intervalsMs: readonly number[], refreshMs: number): FrameStats {
  const longAt = refreshMs * LONG_FRAME_FACTOR;
  let longFrames = 0;
  let lostMs = 0;
  let onCadence = 0;
  for (const interval of intervalsMs) {
    if (interval > longAt) {
      longFrames += 1;
      lostMs += interval - refreshMs;
    }
    if (Math.abs(interval - refreshMs) <= refreshMs * CADENCE_TOLERANCE) onCadence += 1;
  }
  return {
    frames: intervalsMs.length,
    refreshMs,
    medianMs: median(intervalsMs),
    p95Ms: percentile(intervalsMs, 0.95),
    p99Ms: percentile(intervalsMs, 0.99),
    maxMs: max(intervalsMs),
    longFrames,
    lostMs,
    onCadence: intervalsMs.length === 0 ? Number.NaN : onCadence / intervalsMs.length,
  };
}

export interface NoiseFloorVerdict {
  ok: boolean;
  reason: 'ok' | 'too-few-frames' | 'off-cadence' | 'long-frames';
}

/** Whether an idle scene runs clean enough to measure on top of: most
 *  frames on cadence, and no run of long frames. A bad floor is "machine
 *  busy, re-run", never a figure that weighs against a backend. */
export function noiseFloorVerdict(
  stats: FrameStats,
  limits: { minFrames?: number; minOnCadence?: number; maxLongFraction?: number } = {},
): NoiseFloorVerdict {
  const minFrames = limits.minFrames ?? 30;
  const minOnCadence = limits.minOnCadence ?? 0.8;
  const maxLongFraction = limits.maxLongFraction ?? 0.05;
  if (stats.frames < minFrames) return { ok: false, reason: 'too-few-frames' };
  if (stats.onCadence < minOnCadence) return { ok: false, reason: 'off-cadence' };
  if (stats.longFrames / stats.frames > maxLongFraction)
    return { ok: false, reason: 'long-frames' };
  return { ok: true, reason: 'ok' };
}
