import { describe, expect, it } from 'vitest';
import {
  CHECKSUM_TOLERANCE,
  checksumVerdict,
  drawsPerFrame,
  GAME_FRAME_SHAPE,
  patternReference,
  summarizeFramePass,
} from '../src/probe/frame_section_core';

describe('the game-shaped frame core', () => {
  it('counts the draws the frame shape submits', () => {
    expect(drawsPerFrame(GAME_FRAME_SHAPE)).toBe(300 + 400 + 20 * 20 + 4);
  });

  it('judges the checksum with a tolerance, reserving wrong for gross failures', () => {
    const near = [
      {
        expected: [10, 20, 30] as [number, number, number],
        actual: [12, 20, 27] as [number, number, number],
      },
    ];
    expect(checksumVerdict(near)).toEqual({ ok: true, worstDelta: 3, samples: 1 });
    const noise = [
      {
        expected: [10, 20, 30] as [number, number, number],
        actual: [200, 20, 30] as [number, number, number],
      },
    ];
    expect(checksumVerdict(noise).ok).toBe(false);
    expect(checksumVerdict(noise).worstDelta).toBe(190);
    expect(checksumVerdict([]).ok).toBe(false);
    expect(CHECKSUM_TOLERANCE).toBeGreaterThan(0);
  });

  it('summarizes the frames, the submit share and the shape', () => {
    const ok = { ok: true, worstDelta: 1, samples: 16 };
    const summary = summarizeFramePass({
      intervalsMs: [16.7, 16.7, 33.4, 16.7],
      submitMs: [8, 9, 20, 8],
      refreshMs: 16.7,
      shape: GAME_FRAME_SHAPE,
      checksum: ok,
      textureChecksum: ok,
    });
    expect(summary.medianSubmitMs).toBe(8.5);
    expect(summary.submitShare).toBeCloseTo(8.5 / 16.7, 5);
    expect(summary.frames.longFrames).toBe(1);
    expect(summary.drawsPerFrame).toBe(1104);
    expect(summary.checksum.ok).toBe(true);
  });

  it('the pattern reference is the gradient the shader draws', () => {
    expect(patternReference(0, 0)).toEqual([0, 0, 128]);
    expect(patternReference(1, 0.5)).toEqual([255, 128, 128]);
  });
});
