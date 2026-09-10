// Waiting for the window to hold still before the probe reads its canvas size.
// The report behind this: the shell's full-screen switch happens after the page
// loads, so without the wait the window resizes under a running measurement,
// and one arm can be measured windowed while the next is full screen.
import { describe, expect, it } from 'vitest';
import {
  SETTLE_FRAMES,
  SETTLE_MAX_MS,
  type ViewportSize,
  viewportSettled,
} from '../src/probe/viewport_settle_core';

const size = (width: number, height: number): ViewportSize => ({ width, height });
const repeat = (value: ViewportSize, times: number): ViewportSize[] =>
  Array.from({ length: times }, () => value);

describe('viewportSettled', () => {
  it('holds until the window has been the same size for the whole window of frames', () => {
    const full = size(2560, 1440);
    expect(viewportSettled(repeat(full, SETTLE_FRAMES - 1))).toBe(false);
    expect(viewportSettled(repeat(full, SETTLE_FRAMES))).toBe(true);
  });

  it('is not fooled by the intermediate sizes a mode change reports', () => {
    // The transition steps through sizes before it lands.
    const samples = [size(1264, 688), size(1264, 688), size(2560, 1400), size(2560, 1440)];
    expect(viewportSettled(samples, 3)).toBe(false);
  });

  it('reads only the tail, so an earlier steady stretch does not count', () => {
    const samples = [...repeat(size(1264, 688), 10), size(2560, 1440)];
    expect(viewportSettled(samples, 3)).toBe(false);
    expect(viewportSettled([...samples, size(2560, 1440), size(2560, 1440)], 3)).toBe(true);
  });

  it('needs a height change too, not width alone', () => {
    const samples = [size(2560, 1440), size(2560, 1440), size(2560, 1200)];
    expect(viewportSettled(samples, 3)).toBe(false);
  });

  it('is never settled on fewer samples than the window asks for', () => {
    expect(viewportSettled([], 3)).toBe(false);
    expect(viewportSettled([size(800, 600)], 3)).toBe(false);
    expect(viewportSettled(repeat(size(800, 600), 3), 4)).toBe(false);
  });

  it('carries a bound, so a viewport that never holds still cannot hang a run', () => {
    expect(SETTLE_MAX_MS).toBeGreaterThan(0);
    expect(Number.isFinite(SETTLE_MAX_MS)).toBe(true);
    expect(SETTLE_FRAMES).toBeGreaterThan(1);
  });
});
