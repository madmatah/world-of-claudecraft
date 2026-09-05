// Drive the GPU backend probe page in a plain browser, one ANGLE backend per
// run, and print what it measured: the step-1 harness of the probe
// (tmp/DESIGN_backend-probe.md, "Build order"), where the sections and
// their margins are calibrated before any shell work.
//
//   npx vite --port 5177 --strictPort --force        (a fresh server: see scripts/CLAUDE.md)
//   node scripts/backend_probe_run.mjs --angle vulkan [--tier ultra] [--url http://localhost:5177]
//
// `--angle` is the ANGLE backend Chrome runs (`gl-egl`, `vulkan` on Linux;
// `d3d11`, `vulkan`, `gl` on Windows; `metal` on macOS); `--parallel` adds
// the ANGLE parallel-compile feature the shell's top Vulkan rung ships.
// Deliberately NOT SwiftShader: a backend probe measures the real GPU.

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { BROWSER_PATH } from './browser_path.mjs';

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
};
const flag = (name) => process.argv.includes(name);

const angle = arg('--angle', 'gl-egl');
const tier = arg('--tier', 'ultra');
const baseUrl = arg('--url', 'http://localhost:5177');
const timeoutMs = Number(arg('--timeout', '240000'));
const parallel = flag('--parallel');
const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = arg('--out', path.join(repoRoot, 'tmp', 'backend-probe'));

const args = [
  '--window-size=1280,720',
  '--ignore-gpu-blocklist',
  '--enable-gpu',
  '--use-gl=angle',
  `--use-angle=${angle}`,
];
if (angle === 'vulkan') {
  args.push('--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE');
  if (process.env.PROBE_HEADLESS !== '0') args.push('--disable-vulkan-surface');
}
if (parallel) args.push('--enable-angle-features=enableParallelCompileAndLink');

const browser = await puppeteer.launch({
  executablePath: BROWSER_PATH,
  headless: process.env.PROBE_HEADLESS === '0' ? false : 'new',
  args,
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (error) => console.error('[probe] page error:', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warn') {
      console.error(`[probe] console ${message.type()}:`, message.text());
    }
  });
  const run = `${angle}${parallel ? '-par' : ''}-${Date.now().toString(36)}`;
  const url = `${baseUrl}/backend-probe.html?view=probe&tier=${tier}&run=${run}&lang=en`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('[data-probe-ended]') !== null, {
    timeout: timeoutMs,
  });
  const result = await page.evaluate(() => window.__probeResult);
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${run}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  console.log(`[probe] ${result.ended}: ${result.identity?.renderer ?? 'no renderer'}`);
  console.log(
    `[probe] backend ${result.identity?.backend}, parallel compile ${result.identity?.parallelCompile}, ` +
      `corpus ${result.corpusTier} (${result.corpusHash?.slice(0, 12)})`,
  );
  const links = result.sections?.links;
  if (links) {
    links.passes.forEach((pass, i) => {
      const fmt = (s) =>
        `n=${s.count} med=${s.medianMs.toFixed(1)} (link ${s.medianLinkMs.toFixed(1)} draw ${s.medianDrawMs.toFixed(1)}) ` +
        `max=${s.maxMs.toFixed(1)} trim=${s.trimmedMeanMs.toFixed(1)}${s.capped ? ' CAPPED' : ''}${s.failed ? ` failed=${s.failed}` : ''}`;
      console.log(`[probe] links pass ${i}: cold ${fmt(pass.cold)} | hit ${fmt(pass.hit)}`);
    });
  }
  const parallelSection = result.sections?.parallel;
  console.log(
    `[probe] refresh ${result.refreshMs?.toFixed(2)} ms, load ${result.load?.passes} passes ` +
      `(target ${result.load?.targetMs?.toFixed(1)} ms)`,
  );
  if (parallelSection) {
    parallelSection.passes.forEach((pass, i) => {
      const s = pass.summary;
      console.log(
        `[probe] parallel pass ${i}: ${s.blocking ? 'BLOCKING' : 'async'} n=${s.count} ` +
          `asyncFrac=${s.asyncFraction.toFixed(2)} pendFrames=${s.medianFramesPending} ` +
          `med=${s.medianMs.toFixed(0)}ms | frames ${s.frames.frames} p95=${s.frames.p95Ms.toFixed(1)} ` +
          `max=${s.frames.maxMs.toFixed(1)} long=${s.frames.longFrames} lost=${s.frames.lostMs.toFixed(0)}ms` +
          `${pass.capped ? ' CAPPED' : ''}`,
      );
    });
    console.log(
      `[probe] floors: links p95=${links?.floor.p95Ms.toFixed(1)} parallel p95=${parallelSection.floor.p95Ms.toFixed(1)}`,
    );
  }
  const workerSection = result.sections?.worker;
  if (workerSection) {
    workerSection.passes.forEach((pass, i) => {
      const s = pass.summary;
      console.log(
        `[probe] worker pass ${i}: ready=${s.readyMs === null ? 'never' : s.readyMs.toFixed(0) + 'ms'}` +
          `${s.refusal ? ` refused=${s.refusal}` : ''} warmed=${s.warmed} failed=${s.failed} ` +
          `workerLink=${s.medianWorkerLinkMs.toFixed(0)}ms | frames ${s.framesDuringWarm.frames} ` +
          `max=${s.framesDuringWarm.maxMs.toFixed(0)} long=${s.framesDuringWarm.longFrames} lost=${s.framesDuringWarm.lostMs.toFixed(0)}ms | ` +
          `hit=${s.medianHitMs.toFixed(1)}ms cold=${s.coldMedianMs.toFixed(0)} ratio=${s.hitOverCold.toFixed(2)}${s.capped ? ' CAPPED' : ''}`,
      );
    });
  }
  const uploads = result.sections?.uploads;
  if (uploads) {
    uploads.passes.forEach((pass, i) => {
      const line = pass.summary.paths
        .map((p) =>
          p.skipped
            ? `${p.path}:skipped`
            : `${p.path}:${(p.bytesPerUpload / 1024).toFixed(0)}K call=${p.medianCallMs.toFixed(1)}/${p.maxCallMs.toFixed(1)} frame=${p.medianFrameMs.toFixed(1)}/${p.maxFrameMs.toFixed(1)}`,
        )
        .join(' | ');
      console.log(
        `[probe] uploads pass ${i}: ${line} || lost=${pass.summary.frames.lostMs.toFixed(0)}ms`,
      );
    });
  }
  const capability = result.capability;
  if (capability) {
    console.log(
      `[probe] capability: critical=[${capability.critical.join('; ')}] degraded=[${capability.degraded.join('; ')}] ` +
        `missing=[${capability.missingExtensions.join(',')}] maxTex=${capability.limits.maxTextureSize} aniso=${capability.limits.maxAnisotropy}`,
    );
  }
  const frame = result.sections?.frame;
  if (frame) {
    frame.passes.forEach((pass, i) => {
      const s = pass.summary;
      console.log(
        `[probe] frame pass ${i}: ${s.drawsPerFrame} draws, submit med=${s.medianSubmitMs.toFixed(1)} p95=${s.p95SubmitMs.toFixed(1)} ` +
          `(share ${(s.submitShare * 100).toFixed(0)}%) | frames med=${s.frames.medianMs.toFixed(1)} p95=${s.frames.p95Ms.toFixed(1)} ` +
          `max=${s.frames.maxMs.toFixed(1)} long=${s.frames.longFrames} | checksum ${s.checksum.ok ? 'ok' : 'WRONG'} (d${s.checksum.worstDelta}) ` +
          `texture ${s.textureChecksum.ok ? 'ok' : 'WRONG'} (d${s.textureChecksum.worstDelta})`,
      );
    });
  }
  const pacing = result.sections?.pacing;
  if (pacing) {
    pacing.passes.forEach((pass, i) => {
      const w = pass.windowed;
      console.log(
        `[probe] pacing pass ${i}: frames ${w.frames} med=${w.medianMs.toFixed(2)} p99=${w.p99Ms.toFixed(1)} ` +
          `max=${w.maxMs.toFixed(1)} onCadence=${(w.onCadence * 100).toFixed(0)}% long=${w.longFrames}`,
      );
    });
  }
  console.log(`[probe] wrote ${path.relative(repoRoot, file)}`);
} finally {
  await browser.close();
}
