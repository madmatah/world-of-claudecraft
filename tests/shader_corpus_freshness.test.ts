// The shipped shader corpora of the GPU backend probe (src/probe/corpus/) are
// recorded from a live session on a real GPU (scripts/shader_corpus_record.mjs),
// which no build step can run, so they are committed. This pins that each one
// still describes THIS tree: its inputs hash equals the hash of the GLSL
// producers (scripts/lib/shader_corpus_inputs.mjs), it carries enough programs
// for the probe's sections, and it stays inside the size budget a repo can
// carry per regen. A stale corpus fails with the regen command.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { hashShaderCorpusInputs } from '../scripts/lib/shader_corpus_inputs.mjs';
import {
  PROBE_CORPUS_FORMAT,
  type ProbeCorpus,
  probeCorpusMinimums,
  probeCorpusShortfalls,
} from '../scripts/lib/shader_corpus_subset.mjs';

const repoRoot = join(__dirname, '..');
const corpusDir = join(repoRoot, 'src', 'probe', 'corpus');

/** The gzipped bytes one tier may cost the repository per regeneration. */
const CORPUS_BUDGET_BYTES = 1024 * 1024;

/** The tiers a corpus must exist for: the ends of the preset ladder at least. */
const REQUIRED_TIERS = ['low', 'ultra'];

function corpusFiles(): string[] {
  return readdirSync(corpusDir)
    .filter((name) => name.endsWith('.corpus.json.gz'))
    .sort();
}

function readCorpus(name: string): ProbeCorpus {
  return JSON.parse(gunzipSync(readFileSync(join(corpusDir, name))).toString('utf8'));
}

describe('the shipped shader corpora', () => {
  it('exist for the required tiers', () => {
    const tiers = corpusFiles().map((name) => name.replace('.corpus.json.gz', ''));
    for (const tier of REQUIRED_TIERS) expect(tiers, `missing ${tier}`).toContain(tier);
  });

  it('describe this tree (regenerate with `node scripts/shader_corpus_record.mjs --tier <tier>`)', () => {
    const expected = hashShaderCorpusInputs(repoRoot);
    for (const name of corpusFiles()) {
      const corpus = readCorpus(name);
      expect(corpus.format, name).toBe(PROBE_CORPUS_FORMAT);
      expect(corpus.tier, name).toBe(name.replace('.corpus.json.gz', ''));
      expect(
        corpus.inputsHash,
        `${name} was recorded from other shader producers; regenerate it`,
      ).toBe(expected);
    }
  });

  it('carry enough programs for every probe section', () => {
    for (const name of corpusFiles()) {
      const corpus = readCorpus(name);
      expect(probeCorpusShortfalls(corpus, probeCorpusMinimums(corpus.tier)), name).toEqual([]);
      for (const program of corpus.programs) {
        expect(program.vertex.length, `${name} ${program.cacheKey}`).toBeGreaterThan(0);
        expect(program.fragment.length, `${name} ${program.cacheKey}`).toBeGreaterThan(0);
        expect(typeof program.type).toBe('string');
        expect(typeof program.name).toBe('string');
      }
    }
  });

  it('stay inside the per-tier size budget', () => {
    for (const name of corpusFiles()) {
      expect(statSync(join(corpusDir, name)).size, name).toBeLessThanOrEqual(CORPUS_BUDGET_BYTES);
    }
  });
});
