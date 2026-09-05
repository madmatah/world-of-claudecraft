// Record the shipped shader corpus of the GPU backend probe from a live game
// session, on a REAL GPU, and write it under src/probe/corpus/.
//
//   npm run dev
//   node scripts/shader_corpus_record.mjs [--tier ultra] [--url http://localhost:5173]
//
// The probe (src/probe/) links a curated subset of the game's real programs to
// compare the graphics backends; that subset comes from the session recorder
// the game already has (src/game/shader_cache_warmup.ts records every program
// the world context linked, 25 s after the reveal, into IndexedDB). This
// script enters the offline world at the requested tier, waits for that
// record, reads it straight out of IndexedDB, keeps the subset
// (scripts/lib/shader_corpus_subset.mjs) and writes it gzipped with the
// producers' hash (scripts/lib/shader_corpus_inputs.mjs), which
// tests/shader_corpus_freshness.test.ts checks against the tree.
//
// DELIBERATE exception to the scripts/CLAUDE.md `--use-angle=swiftshader`
// convention: the recorded extension set and the compressed-texture programs
// depend on the adapter, and a SwiftShader corpus would describe a machine no
// player has. Run it on the machine's real GPU (the flags below), and expect a
// small, adapter-dependent difference between two GPUs' corpora: the probe
// links the GLSL text, which is what matters.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';
import { enterOfflineGame } from './enter_offline_game.mjs';
import { hashShaderCorpusInputs } from './lib/shader_corpus_inputs.mjs';
import {
  buildProbeCorpus,
  probeCorpusMinimums,
  probeCorpusShortfalls,
} from './lib/shader_corpus_subset.mjs';

const TIERS = ['low', 'medium', 'high', 'ultra', 'insane'];

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const tier = arg('--tier', process.env.CORPUS_TIER ?? 'ultra');
if (!TIERS.includes(tier)) {
  console.error(`unknown tier ${tier}; one of ${TIERS.join(', ')}`);
  process.exit(1);
}
const baseUrl = arg('--url', process.env.GAME_URL ?? 'http://localhost:5173');
// The recorder fires RECORD_DELAY_MS (25 s) after the reveal; the wait covers
// it plus the boot on a loaded machine.
const waitMs = Number(arg('--wait', process.env.CORPUS_WAIT_MS ?? 90_000));
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = arg('--out', path.join(repoRoot, 'src', 'probe', 'corpus'));

// The ANGLE backend that reaches the real GPU from a headless Chrome on each
// platform (`--use-gl=angle` alone leaves the GPU process with no GL backend on
// Linux and the page with no WebGL context); CORPUS_ANGLE overrides it.
const ANGLE_BY_PLATFORM = { linux: 'gl-egl', win32: 'd3d11', darwin: 'metal' };
const angle = process.env.CORPUS_ANGLE ?? ANGLE_BY_PLATFORM[process.platform] ?? 'default';

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: process.env.CORPUS_HEADFUL ? false : 'new',
  args: [
    '--window-size=1600,900',
    '--ignore-gpu-blocklist',
    '--enable-gpu',
    '--use-gl=angle',
    `--use-angle=${angle}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (error) => console.error('[corpus] page error:', error.message));
  let recorded = false;
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error') console.error('[corpus] console error:', text);
    else if (text.startsWith('[shader-warmup]')) {
      console.log('[corpus] page:', text);
      if (text.includes('recorded')) recorded = true;
    }
  });
  const startedAt = Date.now();
  // `shaderwarm=all` keeps the recorder ON whatever the stored option says;
  // `gfx` pins the tier the identity records.
  await page.goto(`${baseUrl}/?gfx=${tier}&shaderwarm=all`, { waitUntil: 'domcontentloaded' });
  // A fresh checkout's first boot at the ultra tier compiles and links for a
  // while on the real GPU; the default 30 s boot wait is for SwiftShader smoke runs.
  const booted = await enterOfflineGame(page, {
    charName: 'Corpus',
    settleMs: 4000,
    gameBootTimeoutMs: 180_000,
    selectorTimeoutMs: 60_000,
  });
  if (!booted) throw new Error('the world never booted');
  const adapter = await page.evaluate(() => {
    const game = window.__game;
    const gl = game?.renderer?.webgl?.getContext?.();
    const info = gl?.getExtension?.('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
  });
  console.log(
    `[corpus] tier ${tier} on ${adapter || 'an unknown adapter'}; waiting for the record`,
  );

  // Never touch the store before the recorder has written it: an
  // `indexedDB.open` with no version would mint an empty database the
  // recorder's own versioned open then finds without its object store, and
  // its write would fail in silence. The recorder's console line is the cue.
  const deadline = Date.now() + waitMs;
  while (!recorded && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!recorded) throw new Error(`the recorder did not report within ${waitMs} ms`);
  const record = await waitForRecord(page, startedAt, 20_000);
  const corpus = buildProbeCorpus(record, {
    inputsHash: hashShaderCorpusInputs(repoRoot),
    buildId: await page.evaluate(() => window.__game?.buildId ?? ''),
    adapter,
  });
  const shortfalls = probeCorpusShortfalls(corpus, probeCorpusMinimums(tier));
  mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, `${tier}.corpus.json.gz`);
  const bytes = gzipSync(Buffer.from(JSON.stringify(corpus), 'utf8'), { level: 9 });
  writeFileSync(target, bytes);
  console.log(
    `[corpus] ${record.programs.length} recorded, ${corpus.programs.length} shipped, ` +
      `${(bytes.byteLength / 1024).toFixed(0)} KiB -> ${path.relative(repoRoot, target)}`,
  );
  for (const line of shortfalls) console.warn(`[corpus] SHORT: ${line}`);
  process.exitCode = shortfalls.length > 0 ? 2 : 0;
} finally {
  await browser.close();
}

/** Poll the recorder's IndexedDB store until a record newer than the session
 *  start appears, and inflate it in the page (the store holds gzip bytes). */
async function waitForRecord(page, since, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const record = await page.evaluate(async (sinceMs) => {
      const stored = await new Promise((resolve, reject) => {
        const open = indexedDB.open('woc-shader-warmup');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('corpus')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('corpus', 'readonly');
          const get = tx.objectStore('corpus').get('corpus');
          get.onerror = () => reject(get.error);
          get.onsuccess = () => {
            db.close();
            resolve(get.result ?? null);
          };
        };
      });
      if (!stored || !stored.bytes) return null;
      const blob = new Blob([stored.bytes]);
      const text = stored.gzip
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await blob.text();
      const parsed = JSON.parse(text);
      return typeof parsed?.savedAt === 'number' && parsed.savedAt >= sinceMs ? parsed : null;
    }, since);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`no corpus recorded within ${timeoutMs} ms`);
}
