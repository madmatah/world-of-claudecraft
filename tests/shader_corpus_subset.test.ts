// The shipped-corpus selection (scripts/lib/shader_corpus_subset.mjs): the post
// chain in full, the heaviest depth twins, the heaviest colour programs, in
// that order, with the shortfall report the regen script prints.
import { describe, expect, it } from 'vitest';
import {
  buildProbeCorpus,
  DEFAULT_HEAVY_COUNT,
  DEFAULT_TWIN_COUNT,
  PROBE_CORPUS_FORMAT,
  probeCorpusMinimums,
  probeCorpusShortfalls,
  programWeight,
  selectProbeCorpus,
} from '../scripts/lib/shader_corpus_subset.mjs';

const program = (
  key: string,
  weight: number,
  type = 'MeshStandardMaterial',
  name = '',
): {
  vertex: string;
  fragment: string;
  index0Attribute: string;
  type: string;
  name: string;
  cacheKey: string;
} => ({
  vertex: 'v'.repeat(Math.ceil(weight / 2)),
  fragment: 'f'.repeat(Math.floor(weight / 2)),
  index0Attribute: 'position',
  type,
  name,
  cacheKey: key,
});

describe('selectProbeCorpus', () => {
  it('keeps every post pass, the heaviest twins, the heaviest colour programs, in that order', () => {
    const programs = [
      program('c1', 100),
      program('c2', 300),
      program('c3', 200),
      program('t1', 50, 'MeshDepthMaterial'),
      program('t2', 80, 'MeshDistanceMaterial'),
      program('p1', 10, 'ShaderMaterial', 'bloom.compositeMaterial'),
      program('p2', 20, 'ShaderMaterial', 'OutputGradeShader'),
      program('p3', 5, 'ShaderMaterial', 'n8ao.effectCompositerQuad'),
    ];
    const kept = selectProbeCorpus(programs, { heavyCount: 2, twinCount: 1 });
    expect(kept.map((p) => p.cacheKey)).toEqual(['p2', 'p1', 'p3', 't2', 'c2', 'c3']);
    expect(kept[0]).toEqual({
      type: 'ShaderMaterial',
      name: 'OutputGradeShader',
      cacheKey: 'p2',
      index0Attribute: 'position',
      vertex: programs[6].vertex,
      fragment: programs[6].fragment,
    });
  });

  it('breaks weight ties by cache key so the selection is deterministic', () => {
    const kept = selectProbeCorpus([program('b', 10), program('a', 10), program('c', 10)], {
      heavyCount: 2,
    });
    expect(kept.map((p) => p.cacheKey)).toEqual(['a', 'b']);
  });

  it('defaults to the documented counts', () => {
    const many = Array.from({ length: 40 }, (_, i) => program(`c${i}`, 10 + i));
    const twins = Array.from({ length: 12 }, (_, i) =>
      program(`t${i}`, 5 + i, 'MeshDepthMaterial'),
    );
    const kept = selectProbeCorpus([...many, ...twins]);
    expect(kept.filter((p) => p.type === 'MeshDepthMaterial')).toHaveLength(DEFAULT_TWIN_COUNT);
    expect(kept.filter((p) => p.type !== 'MeshDepthMaterial')).toHaveLength(DEFAULT_HEAVY_COUNT);
  });

  it('weighs a program by its two sources', () => {
    expect(programWeight({ vertex: 'abc', fragment: 'de' })).toBe(5);
  });
});

describe('buildProbeCorpus', () => {
  it('stamps the format, the tier, the inputs hash and the provenance', () => {
    const corpus = buildProbeCorpus(
      {
        tier: 'ultra',
        savedAt: 1234,
        extensions: ['EXT_color_buffer_float'],
        contextAttributes: { antialias: false },
        programs: [program('c1', 10)],
      },
      { inputsHash: 'h'.repeat(64), buildId: 'b1', adapter: 'GPU', heavyCount: 1 },
    );
    expect(corpus).toEqual({
      format: PROBE_CORPUS_FORMAT,
      tier: 'ultra',
      inputsHash: 'h'.repeat(64),
      recordedAt: 1234,
      recordedFrom: { buildId: 'b1', adapter: 'GPU' },
      extensions: ['EXT_color_buffer_float'],
      contextAttributes: { antialias: false },
      programs: [
        {
          type: 'MeshStandardMaterial',
          name: '',
          cacheKey: 'c1',
          index0Attribute: 'position',
          vertex: 'vvvvv',
          fragment: 'fffff',
        },
      ],
    });
  });
});

describe('probeCorpusMinimums', () => {
  it('asks for twins and a post chain only where the tier renders them', () => {
    expect(probeCorpusMinimums('low')).toEqual({ heavy: 12, twins: 0, post: 0 });
    expect(probeCorpusMinimums('medium')).toEqual({ heavy: 12, twins: 0, post: 0 });
    expect(probeCorpusMinimums('high')).toEqual({ heavy: 12, twins: 1, post: 1 });
    expect(probeCorpusMinimums('ultra')).toEqual({ heavy: 12, twins: 1, post: 1 });
  });
});

describe('probeCorpusShortfalls', () => {
  it('names what a thin corpus lacks, and is empty for a complete one', () => {
    const thin = { programs: [program('c1', 1), program('p1', 1, 'ShaderMaterial', 'smaa.x')] };
    expect(probeCorpusShortfalls(thin)).toEqual(['heavy programs: 1 of 12', 'depth twins: 0 of 1']);
    const full = {
      programs: [
        ...Array.from({ length: 12 }, (_, i) => program(`c${i}`, 1)),
        program('t', 1, 'MeshDepthMaterial'),
        program('p', 1, 'ShaderMaterial', 'bloom.blendMaterial'),
      ],
    };
    expect(probeCorpusShortfalls(full)).toEqual([]);
  });
});
