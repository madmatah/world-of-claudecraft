// The root HTML entry list is a function of the build flavour
// (scripts/lib/vite_entries.mjs): the desktop bundle carries the GPU backend
// probe page, the site build never does, because dist/ deploys verbatim to the
// live site and the site Dockerfile copies the root html entries by name. This
// pins both arms, welds the config to the module, and keeps the probe entry
// external-module only: the desktop shell's CSP hashes the inline scripts of
// dist/index.html alone (electron/main.cjs registerAppProtocol) and applies one
// policy to every served path, so an inline script here would be blocked.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DESKTOP_ONLY_ENTRIES,
  SITE_ENTRIES,
  viteEntryFiles,
} from '../scripts/lib/vite_entries.mjs';

const root = join(__dirname, '..');

describe('viteEntryFiles', () => {
  it('bundles every site page in both flavours', () => {
    const site = viteEntryFiles({ desktop: false });
    const desktop = viteEntryFiles({ desktop: true });
    for (const [name, file] of Object.entries(SITE_ENTRIES)) {
      expect(site[name]).toBe(file);
      expect(desktop[name]).toBe(file);
    }
  });

  it('adds the backend probe page to the desktop bundle only', () => {
    expect(DESKTOP_ONLY_ENTRIES.backendProbe).toBe('backend-probe.html');
    expect(viteEntryFiles({ desktop: true }).backendProbe).toBe('backend-probe.html');
    expect(Object.values(viteEntryFiles({ desktop: false }))).not.toContain('backend-probe.html');
  });

  it('names files that exist at the repo root', () => {
    for (const file of Object.values(viteEntryFiles({ desktop: true }))) {
      expect(existsSync(join(root, file)), `${file} missing at the repo root`).toBe(true);
    }
  });

  it('is what vite.config.ts builds from', () => {
    const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
    expect(config).toContain("from './scripts/lib/vite_entries.mjs'");
    expect(config).toContain('viteEntryFiles({ desktop: isDesktopDevBuild })');
    // The old inline list must not come back beside the module: two lists drift.
    expect(config).not.toContain("main: fileURLToPath(new URL('index.html'");
  });

  it('keeps the site Dockerfile in step with the site entries', () => {
    // The Dockerfile copies the root html entries by name; a site entry it does
    // not copy fails `pnpm run build` inside the image, and a desktop-only entry
    // it does copy would be served publicly.
    const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
    for (const file of Object.values(SITE_ENTRIES)) expect(dockerfile).toContain(file);
    for (const file of Object.values(DESKTOP_ONLY_ENTRIES)) expect(dockerfile).not.toContain(file);
  });
});

describe('backend-probe.html', () => {
  const html = readFileSync(join(root, 'backend-probe.html'), 'utf8');

  it('carries no inline script (the desktop CSP hashes index.html alone)', () => {
    const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag, 'inline script body').toMatch(/<script\b[^>]*>\s*<\/script>/);
      expect(tag).toContain('type="module"');
      expect(tag).toContain('src="/src/backend_probe.ts"');
    }
  });

  it('localizes its title at runtime', () => {
    const entry = readFileSync(join(root, 'src/backend_probe.ts'), 'utf8');
    expect(html).toContain('<title></title>');
    expect(entry).toContain("document.title = t('probe.title')");
  });

  it('is classified as a code path by CI', () => {
    const classify = readFileSync(join(root, 'scripts/lib/ci_change_classify.mjs'), 'utf8');
    expect(classify).toContain("'backend-probe.html',");
  });
});
