// The root HTML entries `vite build` bundles, as one function of the build
// flavour, so a desktop-only page can exist without ever reaching the site.
//
// Why a module: vite.config.ts used to list its `rollupOptions.input` inline,
// unconditionally, and two other places copy the same file names by hand (the
// site Dockerfile's COPY line, and the CI change classifier's root-html set).
// The desktop shell needs a page the website must never serve (the GPU backend
// probe: it is only meaningful inside the packaged Electron app, and dist/ is
// deployed verbatim to the live site), so the entry list has to know which
// flavour is building. Pure and dependency-free so tests/vite_entries.test.ts
// can pin both arms, and so the config's import closure stays inside the
// `!scripts/lib/` allowlist of .dockerignore (tests/dockerignore_context.test.ts).

/** The pages every build bundles, keyed by their rollup input name. */
export const SITE_ENTRIES = Object.freeze({
  main: 'index.html',
  admin: 'admin.html',
  play: 'play.html',
  guide: 'guide.html',
  editor: 'editor.html',
  walletHandoff: 'wallet-handoff.html',
});

/** The pages only the desktop bundle carries (`VITE_DESKTOP_APP=1`, set by
 *  scripts/electron-build.mjs and scripts/electron-dev.mjs). */
export const DESKTOP_ONLY_ENTRIES = Object.freeze({
  backendProbe: 'backend-probe.html',
});

/**
 * The rollup input map for one build flavour: input name to root html file
 * name (relative to the repo root; the config resolves them to paths).
 */
export function viteEntryFiles({ desktop }) {
  return desktop === true ? { ...SITE_ENTRIES, ...DESKTOP_ONLY_ENTRIES } : { ...SITE_ENTRIES };
}
