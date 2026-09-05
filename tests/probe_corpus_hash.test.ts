import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  PROBE_CORPUS_HASH_SOURCE,
  readProbeCorpusHash,
} from '../scripts/lib/probe_corpus_hash.mjs';

describe('readProbeCorpusHash', () => {
  it('reads the committed corpus hash, a non-empty label', () => {
    expect(readProbeCorpusHash()).toMatch(/^[0-9a-f]{8,}$/);
  });

  it('answers empty for a missing, unreadable or hashless corpus', () => {
    const dir = mkdtempSync(join(tmpdir(), 'probe-corpus-'));
    expect(readProbeCorpusHash(dir)).toBe('');
    writeFileSync(join(dir, PROBE_CORPUS_HASH_SOURCE), 'not gzip');
    expect(readProbeCorpusHash(dir)).toBe('');
    writeFileSync(join(dir, PROBE_CORPUS_HASH_SOURCE), gzipSync('{"tier":"ultra"}'));
    expect(readProbeCorpusHash(dir)).toBe('');
    writeFileSync(join(dir, PROBE_CORPUS_HASH_SOURCE), gzipSync('{"inputsHash":"abc"}'));
    expect(readProbeCorpusHash(dir)).toBe('abc');
  });
});
