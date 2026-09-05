<!-- src/probe/: the GPU backend probe page ("WoC config detector"). Root CLAUDE.md
     (module-first, i18n, determinism, no dashes) applies and is not repeated. -->

# src/probe/: the GPU backend probe

The desktop-only page the Electron shell opens with `--test-backends`: it measures the
Windows graphics backends (ANGLE D3D11, Vulkan, OpenGL) on the player's machine and the
shell records which one to launch and whether the shader warm worker is worth running.
Design and rules: `tmp/DESIGN_backend-probe.md` in the maintainer's checkout (the
measurement rules are frozen there; the shader corpus tracks the game by regeneration).

## Layout
- `index.ts` is the barrel and the ONLY import path from outside (`src/backend_probe.ts`,
  the root entry of `backend-probe.html`, imports nothing else from here).
- `*_core.ts` are DOM-free pure cores: the view switch, the statistics, the minimum-sample
  and pass rules, the outcome taxonomy, the salt injector, the decision. They import no
  `electron`, no Node built-in, no `window.wocDesktop`; the thin runners own every bridge
  and GL call. Registered in `PROBE_PURE_CORES` (`tests/architecture.test.ts`), which also
  sweeps this directory so an unregistered core fails.
- `probe_page.ts` is the thin DOM host; one section runner per measuring section beside
  its core.

## Rules
- Every visible string is a `t()` key in `src/ui/i18n.catalog/probe.ts` (the `probe.*`
  namespace, an en-only-typed domain); the title is `probe.title`, a product name kept
  identical in every language.
- The page is external-module only: the desktop CSP hashes `dist/index.html`'s inline
  scripts alone (`tests/vite_entries.test.ts` pins it).
- The entry exists in the desktop bundle only (`scripts/lib/vite_entries.mjs`); the site
  never serves it.
