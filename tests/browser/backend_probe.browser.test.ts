// The GPU backend probe's sections on a real browser context: the shipped
// corpus loads and validates, every salted program of a shortened link pass
// links and draws, the parallel pass resolves its batch (with or without the
// completion query: headless Chromium may bind SwiftShader or the real
// adapter), the game-shaped frame runs and its checksums hold, and the
// uploads go through. The software disqualification is bypassed on purpose:
// this pins the mechanics, not a verdict.
import { afterEach, describe, expect, it } from 'vitest';
import { heavyPrograms } from '../../src/probe/corpus_core';
import { loadProbeCorpus } from '../../src/probe/corpus_loader';
import { runFrameLoop } from '../../src/probe/frame_runner';
import { linkCorpusProgram, runFramePass } from '../../src/probe/frame_section';
import { estimateRefreshMs } from '../../src/probe/frame_stats_core';
import { runLinkPass } from '../../src/probe/link_section';
import { createLoadScene } from '../../src/probe/load_scene';
import { runParallelPass } from '../../src/probe/parallel_section';
import { createProbeContext, type ProbeContext } from '../../src/probe/probe_context';
import { passNonce, saltPrograms } from '../../src/probe/salt_core';
import { runUploadPass } from '../../src/probe/upload_section';

let context: ProbeContext | null = null;

afterEach(() => {
  context?.canvas.remove();
  context?.dispose();
  context = null;
});

async function contextOrSkip(): Promise<ProbeContext | null> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  context = createProbeContext(320, 240);
  if (context) document.body.append(context.canvas);
  return context;
}

describe('the backend probe on a real context', () => {
  it('loads the shipped corpus for the tier and salts its heavy set', async () => {
    const loaded = await loadProbeCorpus('ultra');
    expect(loaded).not.toBeNull();
    expect(loaded?.tier).toBe('ultra');
    const programs = heavyPrograms(loaded?.corpus as NonNullable<typeof loaded>['corpus']);
    expect(programs.length).toBeGreaterThanOrEqual(12);
    expect(saltPrograms(programs, 'smoke')).toHaveLength(programs.length);
  });

  it('links and draws every salted program of a shortened link pass, cold then hit', async () => {
    const ctx = await contextOrSkip();
    if (!ctx) return;
    const loaded = await loadProbeCorpus('ultra');
    const programs = heavyPrograms(loaded?.corpus as NonNullable<typeof loaded>['corpus']).slice(
      0,
      3,
    );
    const salted = saltPrograms(programs, passNonce('smoke', 1, 'links', 0));
    const result = await runLinkPass(ctx.gl, salted, { minimum: 3 });
    expect(result.aborted).toBe(false);
    expect(result.cold.failed).toBe(0);
    expect(result.cold.count).toBe(3);
    expect(result.hit.count).toBe(3);
    for (const sample of result.coldSamples) {
      expect(sample.linked, sample.cacheKey).toBe(true);
      expect(sample.ms).toBeGreaterThan(0);
    }
  }, 60_000);

  it('resolves a parallel batch under load, query or not', async () => {
    const ctx = await contextOrSkip();
    if (!ctx) return;
    const loaded = await loadProbeCorpus('ultra');
    const programs = heavyPrograms(loaded?.corpus as NonNullable<typeof loaded>['corpus']).slice(
      0,
      2,
    );
    const scene = createLoadScene(ctx.gl);
    const refresh = estimateRefreshMs(
      (await runFrameLoop({ gl: ctx.gl, scene: null, passes: 0, frames: 20 })).intervalsMs,
    );
    const result = await runParallelPass(saltPrograms(programs, passNonce('smoke', 1, 'p', 0)), {
      gl: ctx.gl,
      scene,
      loadPasses: 1,
      parallelCompile: ctx.parallelCompile,
      refreshMs: Number.isFinite(refresh) ? refresh : 16.7,
    });
    expect(result.summary.failed).toBe(0);
    expect(result.summary.count).toBe(2);
    expect(result.summary.blocking).toBe(!ctx.parallelCompile);
    scene?.dispose();
  }, 60_000);

  it('runs the game-shaped frame and its checksums hold', async () => {
    const ctx = await contextOrSkip();
    if (!ctx) return;
    const loaded = await loadProbeCorpus('ultra');
    const corpus = loaded?.corpus as NonNullable<typeof loaded>['corpus'];
    const programs = heavyPrograms(corpus)
      .slice(0, 2)
      .map((program) => linkCorpusProgram(ctx.gl, program))
      .filter((program): program is WebGLProgram => program !== null);
    expect(programs).toHaveLength(2);
    const result = await runFramePass({
      gl: ctx.gl,
      refreshMs: 16.7,
      colourPrograms: programs,
      shadowProgram: null,
      shape: { shadowDraws: 10, colourDraws: 20, skeletons: 2, drawsPerSkeleton: 5, postPasses: 2 },
      frames: 6,
      width: 320,
      height: 240,
    });
    expect(result.summary.checksum.ok, `pattern delta ${result.summary.checksum.worstDelta}`).toBe(
      true,
    );
    expect(
      result.summary.textureChecksum.ok,
      `texture delta ${result.summary.textureChecksum.worstDelta}`,
    ).toBe(true);
    expect(result.summary.drawsPerFrame).toBe(42);
    for (const program of programs) ctx.gl.deleteProgram(program);
  }, 60_000);

  it('uploads over every path the context offers', async () => {
    const ctx = await contextOrSkip();
    if (!ctx) return;
    const result = await runUploadPass({
      gl: ctx.gl,
      scene: null,
      loadPasses: 0,
      refreshMs: 16.7,
      perPath: 2,
      textureSize: 256,
      bufferBytes: 1024 * 1024,
    });
    const byPath = new Map(result.summary.paths.map((p) => [p.path, p]));
    expect(byPath.get('canvas')?.count).toBe(2);
    expect(byPath.get('buffer')?.count).toBe(2);
    const compressed = byPath.get('compressed');
    expect(compressed?.skipped === true || compressed?.count === 2).toBe(true);
  }, 60_000);
});
