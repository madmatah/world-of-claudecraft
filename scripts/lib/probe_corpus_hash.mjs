// The shipped probe corpus's inputs hash (the freshness hash of the GLSL
// producers it was recorded from), read off the committed ultra corpus:
// scripts/electron-build.mjs stamps it into the packaged metadata so the
// shell can tell at launch whether a stored verdict was measured on the
// corpus this build ships (electron/backend_probe_verdict.cjs). Every tier
// is recorded from the same producers in one pass, so one tier's hash is
// the corpus's. Empty when the corpus is missing or unreadable: the shell
// then skips the corpus check rather than refusing every verdict.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
export const PROBE_CORPUS_DIR = join(repoRoot, 'src', 'probe', 'corpus');
export const PROBE_CORPUS_HASH_SOURCE = 'ultra.corpus.json.gz';

export function readProbeCorpusHash(dir = PROBE_CORPUS_DIR) {
  try {
    const raw = gunzipSync(readFileSync(join(dir, PROBE_CORPUS_HASH_SOURCE)));
    const corpus = JSON.parse(raw.toString('utf8'));
    return typeof corpus?.inputsHash === 'string' ? corpus.inputsHash : '';
  } catch {
    return '';
  }
}
