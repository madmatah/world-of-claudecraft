// Telling the probe's own measured stall apart from an outside disturbance.
//
// The run this pins: the first Windows run of the probe (RTX 3060) threw away
// BOTH passes of its reference arm because the link section starves the 250 ms
// watchdog with the very stalls it is there to measure. Direct3D 11 linked a
// cold program in 524 ms in the median and 723 ms at the worst, twelve per
// pass; the arm reported `throttled` four times over and the run could not
// decide at all. The bias is systematic, not bad luck: the worse a backend is
// at linking, the likelier its evidence is discarded.
import { describe, expect, it } from 'vitest';
import {
  gapIsStarvation,
  STARVATION_GAP_MS,
  unexplainedGapMs,
  WATCHDOG_TICK_MS,
} from '../src/probe/interference_gap_core';

describe('unexplainedGapMs', () => {
  it('charges a window to what the pass measured inside it', () => {
    expect(unexplainedGapMs({ gapMs: 900, chargedMs: 852 })).toBe(48);
  });

  it('never reports a negative remainder when the charges cover the whole gap', () => {
    expect(unexplainedGapMs({ gapMs: 400, chargedMs: 852 })).toBe(0);
  });

  it('reads a missing or nonsensical figure as nothing measured', () => {
    expect(unexplainedGapMs({ gapMs: 1500, chargedMs: Number.NaN })).toBe(1500);
    expect(unexplainedGapMs({ gapMs: 1500, chargedMs: -5 })).toBe(1500);
    expect(unexplainedGapMs({ gapMs: Number.NaN, chargedMs: 100 })).toBe(0);
  });
});

describe('gapIsStarvation', () => {
  // The measured run, sample for sample. A cold Direct3D 11 program held the
  // thread 852.4 ms at the worst, and the untimed release around it pushed its
  // window past the second the watchdog allows.
  it('clears the Direct3D 11 link window that used to invalidate the pass', () => {
    const worstProgram = 852.4;
    const window = { gapMs: worstProgram + 200, chargedMs: worstProgram };
    expect(unexplainedGapMs(window)).toBeLessThan(STARVATION_GAP_MS);
    expect(gapIsStarvation(unexplainedGapMs(window))).toBe(false);
  });

  it('still catches a real freeze longer than the work in its window', () => {
    expect(gapIsStarvation(unexplainedGapMs({ gapMs: 3000, chargedMs: 852.4 }))).toBe(true);
  });

  it('lets an honestly slow machine report its own slowness', () => {
    // Every link takes two seconds here. That is the measurement, not noise.
    expect(gapIsStarvation(unexplainedGapMs({ gapMs: 2100, chargedMs: 2000 }))).toBe(false);
  });

  it('keeps the old meaning when the window measured nothing blocking', () => {
    expect(gapIsStarvation(unexplainedGapMs({ gapMs: STARVATION_GAP_MS + 1, chargedMs: 0 }))).toBe(
      true,
    );
    expect(gapIsStarvation(unexplainedGapMs({ gapMs: STARVATION_GAP_MS, chargedMs: 0 }))).toBe(
      false,
    );
    expect(gapIsStarvation(unexplainedGapMs({ gapMs: WATCHDOG_TICK_MS, chargedMs: 0 }))).toBe(
      false,
    );
  });

  it('takes the caller threshold when one is given', () => {
    expect(gapIsStarvation(600, 500)).toBe(true);
    expect(gapIsStarvation(600, 700)).toBe(false);
  });
});
