// Load the shipped corpus for a tier: the gzipped JSON rides the bundle as a
// `?url` asset (the desktop shell's app protocol sends no Content-Encoding,
// so the page inflates it itself), and whatever comes back is validated
// before a program is linked. The tier choice is corpus_core's: the nearest
// shipped tier to the one the game would run.

import lowUrl from './corpus/low.corpus.json.gz?url';
import ultraUrl from './corpus/ultra.corpus.json.gz?url';
import { isProbeCorpus, nearestCorpusTier, type ProbeCorpus } from './corpus_core';

/** The tiers the bundle ships, with their asset URLs. */
export const SHIPPED_CORPORA: Readonly<Record<string, string>> = Object.freeze({
  low: lowUrl,
  ultra: ultraUrl,
});

export interface LoadedCorpus {
  corpus: ProbeCorpus;
  /** The shipped tier that was loaded (may differ from the wanted one). */
  tier: string;
}

/** Whether the bytes are still gzip (the magic pair): a server that sends
 *  the asset with `Content-Encoding: gzip` hands the page inflated JSON. */
export function isGzip(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(2, bytes.byteLength));
  return head.length === 2 && head[0] === 0x1f && head[1] === 0x8b;
}

async function inflate(bytes: ArrayBuffer): Promise<string> {
  if (!isGzip(bytes)) return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Fetch, inflate and validate the corpus nearest to `wantedTier`; null when
 *  nothing ships for it or the bytes do not validate. */
export async function loadProbeCorpus(
  wantedTier: string,
  fetchImpl: typeof fetch = fetch,
  shipped: Readonly<Record<string, string>> = SHIPPED_CORPORA,
): Promise<LoadedCorpus | null> {
  const tier = nearestCorpusTier(wantedTier, Object.keys(shipped));
  if (!tier) return null;
  try {
    const response = await fetchImpl(shipped[tier]);
    if (!response.ok) return null;
    const parsed: unknown = JSON.parse(await inflate(await response.arrayBuffer()));
    return isProbeCorpus(parsed) ? { corpus: parsed, tier } : null;
  } catch {
    return null;
  }
}
