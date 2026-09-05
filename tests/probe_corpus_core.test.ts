import { describe, expect, it } from 'vitest';
import {
  heavyPrograms,
  isProbeCorpus,
  nearestCorpusTier,
  PROBE_CORPUS_FORMAT,
  type ProbeCorpus,
  programRole,
} from '../src/probe/corpus_core';

const program = (over: Partial<ProbeCorpus['programs'][number]> = {}) => ({
  type: 'MeshStandardMaterial',
  name: '',
  cacheKey: 'abcdef0123456789',
  index0Attribute: 'position',
  vertex: 'void main(){}',
  fragment: 'void main(){}',
  ...over,
});

const corpus = (over: Partial<ProbeCorpus> = {}): ProbeCorpus => ({
  format: PROBE_CORPUS_FORMAT,
  tier: 'ultra',
  inputsHash: 'h'.repeat(64),
  recordedAt: 1,
  recordedFrom: { buildId: 'b', adapter: 'a' },
  extensions: ['EXT_color_buffer_float'],
  contextAttributes: { antialias: false },
  programs: [program()],
  ...over,
});

describe('isProbeCorpus', () => {
  it('accepts the shipped shape and refuses each broken field', () => {
    expect(isProbeCorpus(corpus())).toBe(true);
    expect(isProbeCorpus(null)).toBe(false);
    expect(isProbeCorpus(corpus({ format: PROBE_CORPUS_FORMAT + 1 }))).toBe(false);
    expect(isProbeCorpus(corpus({ tier: 'x'.repeat(300) }))).toBe(false);
    expect(isProbeCorpus(corpus({ recordedAt: Number.NaN }))).toBe(false);
    expect(isProbeCorpus(corpus({ extensions: [1] as unknown as string[] }))).toBe(false);
    expect(isProbeCorpus(corpus({ contextAttributes: 'x' as unknown as null }))).toBe(false);
    expect(isProbeCorpus(corpus({ programs: [program({ vertex: '' })] }))).toBe(false);
    expect(
      isProbeCorpus(corpus({ programs: [program({ cacheKey: 5 as unknown as string })] })),
    ).toBe(false);
    expect(isProbeCorpus(corpus({ programs: Array.from({ length: 257 }, () => program()) }))).toBe(
      false,
    );
  });
});

describe('nearestCorpusTier', () => {
  it('takes the wanted tier when shipped, else the nearest by preset order, downward on a tie', () => {
    expect(nearestCorpusTier('ultra', ['low', 'ultra'])).toBe('ultra');
    expect(nearestCorpusTier('medium', ['low', 'ultra'])).toBe('low');
    expect(nearestCorpusTier('high', ['low', 'ultra'])).toBe('ultra');
    expect(nearestCorpusTier('insane', ['low', 'ultra'])).toBe('ultra');
    expect(nearestCorpusTier('high', ['medium', 'ultra'])).toBe('medium');
    expect(nearestCorpusTier('bogus', ['ultra', 'low'])).toBe('low');
    expect(nearestCorpusTier('low', [])).toBeNull();
    expect(nearestCorpusTier('low', ['bogus'])).toBeNull();
  });
});

describe('program roles', () => {
  it('sorts post passes, depth twins and the heavy set apart', () => {
    expect(programRole({ type: 'ShaderMaterial', name: 'bloom.compositeMaterial' })).toBe('post');
    expect(programRole({ type: 'RawShaderMaterial', name: 'OutputGradeShader' })).toBe('post');
    expect(programRole({ type: 'MeshDepthMaterial', name: 'prewarm-depth:x' })).toBe('twin');
    expect(programRole({ type: 'MeshStandardMaterial', name: 'Bark' })).toBe('heavy');
    const set = corpus({
      programs: [
        program({ cacheKey: 'small', vertex: 'v', fragment: 'f' }),
        program({ cacheKey: 'big', vertex: 'v'.repeat(10), fragment: 'f' }),
        program({ cacheKey: 'twin', type: 'MeshDepthMaterial' }),
      ],
    });
    expect(heavyPrograms(set).map((p) => p.cacheKey)).toEqual(['big', 'small']);
  });
});
