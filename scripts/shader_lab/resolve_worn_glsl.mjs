// Pull the RESOLVED program texts (every Three.js #include expanded, the exact
// source the GPU compiled) for every family x tier out of the lab page.
//   node scripts/shader_lab/resolve_worn_glsl.mjs --base http://localhost:5199 --out scripts/shader_lab/baseline
// Writes <out>/worn_<family>_<tier>.vert.glsl and .frag.glsl. Run it once on
// the current code (the baseline) and once on a candidate.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from '../browser_path_resolve.mjs';

const args = { base: 'http://localhost:5199', out: 'scripts/shader_lab/baseline' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--base') args.base = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
}
const FAMILIES = ['stone', 'rock', 'wood', 'plaster', 'bark', 'fabric', 'metal'];
const TIERS = ['high', 'ultra', 'insane'];
fs.mkdirSync(args.out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_PATH ?? findBrowserPath(),
  headless: false,
  args: ['--window-size=800,500'],
  defaultViewport: { width: 800, height: 500 },
});
const page = await browser.newPage();
try {
  for (const tier of TIERS) {
    for (const family of FAMILIES) {
      await page.goto(
        `${args.base}/scripts/shader_lab/worn_stone_lab.html?gfx=${tier}&family=${family}&nopanel=1`,
        {
          waitUntil: 'load',
        },
      );
      await page.waitForFunction(() => /programs=[1-9]/.test(document.body.textContent ?? ''), {
        timeout: 60000,
      });
      await new Promise((r) => setTimeout(r, 300));
      const src = await page.evaluate(() => window.wornLab.composedSources());
      if (!src.fragment.includes('wornTriR') && !src.fragment.includes('uWornNormal')) {
        throw new Error(`${family} ${tier}: the composed fragment carries no worn layer`);
      }
      fs.writeFileSync(path.join(args.out, `worn_${family}_${tier}.vert.glsl`), src.vertex);
      fs.writeFileSync(path.join(args.out, `worn_${family}_${tier}.frag.glsl`), src.fragment);
      console.log(`${family} ${tier}: ${src.fragment.length} bytes`);
    }
  }
} finally {
  await browser.close();
}
