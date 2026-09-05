<!-- src/probe/: the GPU backend probe page ("WoC config detector"). Root CLAUDE.md
     (module-first, i18n, determinism, no dashes) applies and is not repeated. -->

# src/probe/: the GPU backend probe

The desktop-only page the Electron shell opens with `--test-backends`: it measures the
Windows graphics backends (ANGLE D3D11, Vulkan, OpenGL) on the player's machine and the
shell records which one to launch and whether the shader warm worker is worth running.
Design and rules: `docs/desktop-release.md`, "GPU backend on Windows: the probe" (the
measurement rules the sections encode; the shader corpus tracks the game by regeneration).

## Layout
- `index.ts` is the barrel and the ONLY import path from outside (`src/backend_probe.ts`,
  the root entry of `backend-probe.html`, imports nothing else from here).
- `*_core.ts` are DOM-free pure cores, registered in `PROBE_PURE_CORES`
  (`tests/architecture.test.ts`, which also sweeps this directory so an unregistered core
  fails): `probe_view_core` (the view switch), `corpus_core` (the shipped corpus format and
  the tier choice), `salt_core` (the per-stage nonce that keeps every link cold),
  `stats_core` (medians, spreads, the pass rule), `frame_stats_core` (frame intervals
  relative to the refresh, the noise floor), one `<section>_core` per measuring section
  (`link`, `parallel`, `worker`, `upload`, `frame`, `capability`), and `decision_core`
  (the design's decision rule, provisional floors included). They import no `electron`,
  no Node built-in, no `three`, no host layer, no `window.wocDesktop`.
- The thin runners own every GL and bridge call, one per section (`link_section.ts`,
  `parallel_section.ts`, `worker_section.ts`, `upload_section.ts`, `frame_section.ts`,
  `pacing_section.ts`, `capability_section.ts`) over shared rigs (`probe_context.ts`,
  `load_scene.ts`, `frame_runner.ts`, `sampler_rig.ts`, `corpus_loader.ts`,
  `interference.ts`); `probe_run.ts` sequences them (two passes per section, a noise
  floor before each, a disturbed pass replayed once) and `probe_page.ts` is the DOM host.
- `corpus/<tier>.corpus.json.gz` are the shipped corpora, recorded by
  `scripts/shader_corpus_record.mjs` on a real GPU and pinned by
  `tests/shader_corpus_freshness.test.ts`.

## Measurement facts the runners encode (measured 2026-09-05, Intel ARL, Mesa)
- A WebGL context created before the page's first composite is lost at once on a
  surface-less Vulkan: `probe_run.ts` waits two painted frames first.
- On ANGLE Vulkan the resolve answers in milliseconds and the driver compiles the
  pipeline in the background, so the cost lands on the next synchronous GL call: the
  cold-link cost is the resolve PLUS an immediate full-screen draw with a readback.
- A draw with a corpus program is refused unless every sampler sits on its own unit
  with a texture of its kind (`sampler_rig.ts`); a refused draw pays nothing.
- The salt is a nonce literal in a USED expression in BOTH stages, per section and per
  pass; a comment or a name alone does not survive the translators.

## The shell side (electron/)
- `electron/entry.cjs` (the package main) hands a probe CHILD to
  `electron/backend_probe_child.cjs` before `main.cjs` runs; with `--test-backends`
  `main.cjs` runs the PARENT branch (`electron/backend_probe_parent.cjs`, one window on
  this page, hardware acceleration off). Pure cores beside them: `backend_probe_plan.cjs`
  (arms, env, exit taxonomy), `backend_probe_orchestrator.cjs` (spawn, liveness, rounds),
  `backend_probe_result.cjs` (the result envelope), `backend_probe_verdict.cjs` (the
  prefs field and its streaks), `gpu_backend_windows.cjs` (the Windows launch decision,
  judge and rescue ladder). Pins: `tests/electron_backend_probe_*.test.ts`,
  `tests/electron_gpu_backend_windows.test.ts`.
- The page decides (`decision_core.ts` is TypeScript): the verdict view reads the rounds
  over the bridge, runs `decide`, posts the decision back; the parent runs a second
  round on the triggers and writes the verdict. Bridge members: `probe*` on
  `DesktopBridge` (`src/runtime.ts`), thin wrappers in `shell_bridge.ts`.
- A Linux dry run of the whole flow (the arms that cannot bind report so):
  `WOC_BACKEND_PROBE_FORCE=1 WOC_BACKEND_PROBE_AUTOSTART=1 VITE_DEV_SERVER_URL=<vite>
  npx electron . --no-sandbox --test-backends` after `scripts/electron-vendor.mjs` built
  the vendor bundles.

## Rules
- Every visible string is a `t()` key in `src/ui/i18n.catalog/probe.ts` (the `probe.*`
  namespace, an en-only-typed domain); the title is `probe.title`, a product name kept
  identical in every language.
- The page is external-module only: the desktop CSP hashes `dist/index.html`'s inline
  scripts alone (`tests/vite_entries.test.ts` pins it).
- The entry exists in the desktop bundle only (`scripts/lib/vite_entries.mjs`); the site
  never serves it.
- Drive it in a plain browser with `scripts/backend_probe_run.mjs` (one ANGLE backend per
  run, never SwiftShader); the browser suite smoke is `tests/browser/backend_probe.browser.test.ts`.
