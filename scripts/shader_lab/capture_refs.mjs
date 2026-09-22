// Capture the worn-stone lab at pinned viewpoints: one PNG per family x
// viewpoint (left column bare, right column with the layer), the reference set
// a candidate layer is judged against. Needs a Vite dev server for this checkout.
//   node scripts/shader_lab/capture_refs.mjs --base http://localhost:5199 --out tmp/worn_refs [--gfx ultra]
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
import { findBrowserPath } from '../browser_path_resolve.mjs';

const args = { base: 'http://localhost:5199', out: 'scripts/shader_lab/refs', gfx: 'ultra' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--base') args.base = process.argv[++i];
  else if (a === '--out') args.out = process.argv[++i];
  else if (a === '--gfx') args.gfx = process.argv[++i];
}
const FAMILIES = ['stone', 'rock', 'wood', 'plaster', 'bark', 'fabric', 'metal'];
const VIEWS = [
  { name: 'near-wall', dist: 5.5, sun: 31, focus: 'wall' },
  { name: 'near-rock', dist: 5.5, sun: 31, focus: 'rock' },
  { name: 'near-barrel', dist: 5, sun: 31, focus: 'barrel' },
  { name: 'mid', dist: 18, sun: 31, focus: '' },
  { name: 'far', dist: 40, sun: 31, focus: '' },
];
fs.mkdirSync(args.out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.BROWSER_PATH ?? findBrowserPath(),
  headless: false,
  args: ['--window-size=1280,720', '--use-angle=default'],
  defaultViewport: { width: 1280, height: 720 },
});
const page = await browser.newPage();
try {
  for (const family of FAMILIES) {
    for (const view of VIEWS) {
      for (const layer of ['on']) {
        const url = `${args.base}/scripts/shader_lab/worn_stone_lab.html?gfx=${args.gfx}&family=${family}&dist=${view.dist}&sun=${view.sun}&layer=${layer}&focus=${view.focus}&nopanel=1`;
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => /programs=[1-9]/.test(document.body.textContent ?? ''), {
          timeout: 60000,
        });
        await new Promise((r) => setTimeout(r, 600));
        const file = path.join(args.out, `${family}_${args.gfx}_${view.name}_${layer}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
    }
  }
} finally {
  await browser.close();
}
