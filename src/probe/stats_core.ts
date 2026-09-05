// The probe's statistics and its pass rule, host-agnostic.
//
// Every measuring section runs two PASSES; the pass is the unit of validity.
// A section with two valid passes is a value, with one valid pass it is
// usable but forces the second round, with none it is neutral (the run ends
// with the re-run offer). The spread between the two passes, taken as the
// largest seen on any arm, sets the decision margin. Twelve links never give
// a p95, so the link figures are a median and a maximum (or a trimmed mean).

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function max(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  let best = -Infinity;
  for (const value of values) if (value > best) best = value;
  return best;
}

/** The mean with the top and bottom `trim` fraction of the sorted values
 *  dropped (each side), so one stall or one lucky hit does not move it. */
export function trimmedMean(values: readonly number[], trim = 0.1): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const drop = Math.floor(sorted.length * trim);
  const kept = sorted.slice(drop, sorted.length - drop);
  let sum = 0;
  for (const value of kept) sum += value;
  return sum / kept.length;
}

/** The p-th percentile (0 to 1) by nearest rank, for the frame-sized samples
 *  where the count supports it. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

/** The spread of two passes' figures, relative to their mean: what the
 *  decision margin is built from (twice the largest spread seen). */
export function relativeSpread(a: number, b: number): number {
  const mean = (a + b) / 2;
  if (!Number.isFinite(mean) || mean === 0) return Number.isFinite(a - b) && a === b ? 0 : 1;
  return Math.abs(a - b) / mean;
}

export type PassVerdictKind = 'value' | 'single-pass' | 'neutral';

export interface PassVerdict {
  kind: PassVerdictKind;
  /** The passes that count, in order. */
  valid: number[];
  /** Forces the second full round (a single valid pass). */
  forcesSecondRound: boolean;
}

/** The pass rule over a section's two passes: which are valid decides what
 *  the section is. */
export function passVerdict(passes: readonly { valid: boolean }[]): PassVerdict {
  const valid = passes.map((pass, index) => (pass.valid ? index : -1)).filter((i) => i >= 0);
  if (valid.length >= 2) return { kind: 'value', valid, forcesSecondRound: false };
  if (valid.length === 1) return { kind: 'single-pass', valid, forcesSecondRound: true };
  return { kind: 'neutral', valid, forcesSecondRound: false };
}

/** Whether a section reached its minimum sample: a section that stopped
 *  short (a no-progress cap) is a lower bound, never a value. */
export function minimumSampleReached(count: number, minimum: number): boolean {
  return Number.isInteger(count) && count >= minimum;
}
