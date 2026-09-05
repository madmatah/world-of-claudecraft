import { describe, expect, it } from 'vitest';
import { summarizeUploadPass, UPLOAD_PATHS } from '../src/probe/upload_section_core';

describe('the upload section core', () => {
  it('summarizes each path apart and marks a skipped one', () => {
    const samples = [
      { path: 'canvas' as const, callMs: 3, frameMs: 20, bytes: 1024 },
      { path: 'canvas' as const, callMs: 5, frameMs: 40, bytes: 1024 },
      { path: 'buffer' as const, callMs: 1, frameMs: 17, bytes: 8_000_000 },
    ];
    const summary = summarizeUploadPass(samples, [20, 40, 17], 16.7, ['compressed']);
    expect(summary.paths.map((p) => p.path)).toEqual([...UPLOAD_PATHS]);
    const [compressed, canvas, buffer] = summary.paths;
    expect(compressed.skipped).toBe(true);
    expect(compressed.count).toBe(0);
    expect(Number.isNaN(compressed.medianCallMs)).toBe(true);
    expect(canvas).toMatchObject({
      count: 2,
      medianCallMs: 4,
      maxCallMs: 5,
      medianFrameMs: 30,
      maxFrameMs: 40,
      bytesPerUpload: 1024,
      skipped: false,
    });
    expect(buffer.bytesPerUpload).toBe(8_000_000);
    expect(summary.frames.longFrames).toBe(1);
  });
});
