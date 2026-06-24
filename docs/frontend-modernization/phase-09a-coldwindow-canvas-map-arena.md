# Phase P9a: Cold-window canvas pair: map + arena

Extract the two canvas-drawing windows (map and arena) into pure `*_view.ts` data/geometry cores
plus thin canvas painters composed through the P6 PainterHost. The 2D context STAYS in the painter;
the core is DOM/Three-free. Both windows are drawn from `hud.update()`'s mediumHud band, NOT purely
cold, so the painters MUST preserve that call site, the 250ms redraw cadence, and the cached
background.

## Starter Prompt

```
This is Phase P9a of the Frontend Modernization v0.16.0 packet: Cold-window canvas pair (map + arena).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. Two independent canvas windows that share one split discipline (data/geometry core + thin 2D-context painter); two parallel slices plus sequential tsc-checked integration is enough. Reserve ultracode for the DOM trio that follows (P9b).

Goal: move the two canvas-drawing classic windows out of hud.ts into the Humble-Object shape this packet uses everywhere: a presentation-only data/geometry core (`src/ui/map_window_view.ts`, `src/ui/arena_window_view.ts`) that maps IWorld state to a pure draw model (no DOM, no Three, no 2D context), plus a thin canvas painter that owns the CanvasRenderingContext2D and does the actual draw. Preserve every behavior exactly: the mediumHud call site, the 250ms canvas redraw cadence, and the cached background. Presentation-only: do NOT extend IWorld or touch src/sim, server, src/net, or headless.

CRITICAL FRAMING (deep-review correction, verified against live source): map (updateMapWindow, hud.ts:5561) and arena (renderArenaWindow, hud.ts:5300) are NOT purely cold. Both are invoked from hud.update()'s mediumHud band via the `if (display === 'block')` guarded calls, so they redraw while open on the >=250ms medium frame divider. The painters MUST preserve that exact call site and the 250ms cadence. Do NOT move these into an open-once cold path; they redraw-while-visible. This is the load-bearing difference from the DOM trio (P9b), which paints once on open.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the FB precedents that ported the cold-window cores: [[frontend-phase7-hud-window-extraction]] (the canonical pure-core + painter + PainterHost seam; the forbiddenUiCoreImport guard; the sed-clips-interleaved-keeps + run-FULL-suite-for-source-guards lessons), and [[frontend-phase6-window-encapsulation]] only for the delve_map_painter precedent (P6 landed it). Note the FB lesson: a canvas core that "needs" a 2D context to compute a layout is wrong; the layout is geometry the core returns, the context is the painter's.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn one Explore agent to read + summarize, returning a compact summary the orchestrator keeps (not raw dumps):
- docs/frontend-modernization/state.md (cite by section: locked decisions 4 (presentation-only), 9 (component contract), 10 (WCAG 2.2 AA chrome), 12 (no-magic-values, the canvas-token getComputedStyle-once policy), 15 (ClientWorld-vs-Sim parity), 17 (persistent-monolith owned); the validation matrix CANVAS-painter row; the Review Dispatch Matrix; the Key file paths block, esp. updateMapWindow 5561 + renderArenaWindow 5300 both called from hud.update()'s mediumHud band; the minimap 3-branch canvas note for the delve-vs-overworld map distinction).
- docs/frontend-modernization/progress.md (the P9a row + the P6 row for the PainterHost + delve_map_painter seam shape).
- This phase file in full.
- The "### P7-P9 Cold-window extraction" section of docs/frontend-modernization/v016-recon-and-packet.md, plus "Load-bearing structural findings", "Reuse from FB", and "Top risks" (esp. risk 7, canvas painters vs no-magic-values).
- The SPECIFIC V16 source ranges this phase touches, read narrowly by line range only:
  - hud.ts updateMapWindow (5561) - canvas window; trace its caller in hud.update() (the mediumHud band, near the 5561 call site, with the `display === 'block'` guard) and the 250ms cadence.
  - hud.ts renderArenaWindow (5300) - canvas window; same: trace its mediumHud caller and cadence, and note its offline/disconnected behavior (arena may be unavailable offline).
  - The P6-landed src/ui/painter_host.ts surface (the presentation dep-bag facet: icon/money/tooltip) and src/render/delve_map_painter.ts (the P6 canvas painter to REUSE where map call sites overlap, not duplicate).
  - One already-extracted reference: src/ui/vendor_view.ts + vendor_window.ts (the Humble-Object template) and any P7/P8 canvas-adjacent painter already landed.
  - tests/architecture.test.ts UI_PURE_CORES allowlist + forbiddenUiCoreImport guard, and tests/client_shell.test.ts where it greps hud.ts for window DOM ids (map/arena canvas element ids).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Two parallel slices (one window each), then integrate sequentially (one window at a time) and run tsc between integrations (the FB lesson: sed clips interleaved, keeps; verify each splice with tsc). Slices:
  1. MAP window (updateMapWindow, hud.ts:5561): extract src/ui/map_window_view.ts producing the pure canvas draw model from IWorld (markers, player position, zone bounds, the delve-schematic-vs-overworld branch as DATA - the core returns which mode and the geometry, not a drawn canvas). Thin src/ui/map_window_painter.ts (or src/render/ if it draws via Canvas-2D like delve_map_painter) owning the 2D context, doing the draw, keeping the existing 250ms redraw cadence and cached background. REUSE src/render/delve_map_painter.ts where the delve-mode draw overlaps; do NOT duplicate its marker drawing.
  2. ARENA window (renderArenaWindow, hud.ts:5300): extract src/ui/arena_window_view.ts (the pure data model: bracket/match state, the OFFLINE/unavailable state as an explicit discriminator the core returns) + thin painter owning the 2D context, same canvas-context-stays-in-painter split as map. Preserve the offline note rendering (arena shows an unavailable state when disconnected).
Register both new *_view.ts cores in the tests/architecture.test.ts UI_PURE_CORES allowlist. Each painter composes through the P6 PainterHost presentation dep-bag; do NOT invent a new seam.

CANVAS-TOKEN POLICY (locked decision 12, MANDATORY for both painters): a 2D context cannot read CSS custom properties directly. Each painter resolves the --color-* tokens it needs via getComputedStyle ONCE per redraw, caches them for that redraw, and NEVER reads getComputedStyle per-marker or per-frame. Every other literal in the painter (sizes, cadence ms, marker radii) is a NAMED CONSTANT, not an inline hex/px. The 250ms cadence is a named constant. The cores carry zero magic values (geometry is computed from IWorld inputs, not hardcoded pixels where avoidable; any unavoidable layout constant is named).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (locked decision 4): consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, or headless. If a slice finds it needs to, STOP and surface it (scope change).
- PRESERVE THE MEDIUMHUD CALL SITE + 250ms CADENCE + CACHED BACKGROUND. These windows redraw while open from hud.update(); the painter is invoked from the same mediumHud band with the same `display === 'block'` guard and the same cadence. Do not regress them to open-once.
- Determinism / purity: both *_view.ts cores are DOM/Three-free with NO Math.random / Date.now / performance.now. The architecture purity guard (forbiddenUiCoreImport / UI_PURE_CORES) enforces this - the core must not import three, a *_painter, painter_host, or DOM globals, and must not touch a 2D context.
- PainterHost is a THIN compose-in host: the new painters CONSUME the P6 presentation dep-bag, they do not reshape it.
- i18n: any new player-visible label (e.g. the arena offline note, a map zone label) is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. Keep the existing t() calls these windows already use. The i18n-free cores emit a discriminator (offline/loading), the painter resolves it via t().
- No em dashes, en dashes, or emojis anywhere (code, comments, commits).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The DOM trio (questlog + spellbook + leaderboard) - that is P9b, the very next phase.
- Per-frame / hot-path extraction (xp bar, swing timer, player/target frames, cast bars, party frames, action bar, auras, minimap markers, FCT) - P10-P13. Do NOT touch hud.update()'s every-frame / fast / slow bands; you touch ONLY the mediumHud band's map/arena calls.
- Per-element graphics tiering / fxLevel knobs - P14.
- Any IWorld extension, sim/server/net change, or new wire field.
- CSS extraction for these windows (landed P3). Do not move CSS here.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- Pure core added (both): `npx vitest run tests/map_window_view.test.ts` and `npx vitest run tests/arena_window_view.test.ts` + `npx vitest run tests/architecture.test.ts` (the UI-purity guard) + a same-input-same-output assertion per core.
- ClientWorld-vs-Sim PARITY (locked decision 15, MANDATORY): each *_view core test feeds the core BOTH a Sim-shaped IWorld stub AND a ClientWorld-mirror-shaped IWorld stub and asserts the same draw model out. The map core gets BOTH a delve-mode and an overworld-mode fixture under both stubs; the arena core gets BOTH a live-match fixture and an OFFLINE/unavailable fixture (the offline path is the online-only-shape trap this assertion exists to catch).
- Per-state tests (MANDATORY): map core - delve-schematic mode vs overworld mode (assert the correct discriminator + geometry for each). Arena core - active-match state vs offline/unavailable state (assert the offline discriminator under the ClientWorld stub).
- CANVAS painter gate (locked decision 12; canvas painters are NOT gated on the elided-writer routing test): assert the painter resolves --color-* via getComputedStyle once per redraw (a test counting getComputedStyle calls per draw == the token count, not per-marker), the 250ms cadence is preserved (the mediumHud call site still drives it), and the cached background is reused across redraws (not rebuilt per frame).
- WCAG 2.2 AA chrome row (locked decision 10, MANDATORY): axe-core (or equivalent) over the built map and arena windows; keyboard reachability of the window controls + focus-return on close; visible :focus-visible never animated/blurred away; a forced-colors: active snapshot (borders/focus survive); target-size >=24px on window controls, >=40x40px on any mobile touch control. A11y DECISION for the canvas itself: the canvas element is NOT screen-readable, so add an accessible name (aria-label via t()) on the canvas plus a concise text SUMMARY of the view (e.g. current zone / match state) in an adjacent sr-only live-ish element; state the boundary honestly (the 3D-style canvas content is out of SR scope per decision 10). Add this label+summary now (do NOT defer to P15); P15b only audits it.
- No-magic-values painter guard (locked decision 12): the guard confirms the painters reference named constants + resolved tokens, no inline hex/px literals except inside a named constant.
- biome check on the new/changed .ts (map_window_view.ts, arena_window_view.ts, the two painters, the hud.ts splice).
- DOM ids moved: `npx vitest run tests/client_shell.test.ts` (it greps hud.ts for the map/arena canvas element ids now reached via painters; update its expectations for the moved ids).
- Whole-suite + build: `npm test` and `npm run build` (all 4 entries) green. Run the FULL suite at the end (FB lesson: source guards need the full suite to catch a perturbation, and a // comment is stripped by stripComments so any guard-perturbation proof must inject a REAL code line).
This is presentation-only and touches no IWorld signature, so per the Review Dispatch Matrix NO cross-platform-sync / privacy-security / migration row fires. Review dispatch: qa-checklist only (the default). Prompt it for COVERAGE not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with the state.md resume line.

STEP 4 - COMMIT CADENCE:
2-4 Conventional Commits, scoped, EXPLICIT paths (never git add -A). Suggested split:
- `feat(ui): extract map window to canvas view core + painter` (src/ui/map_window_view.ts, the map painter, hud.ts splice, tests/map_window_view.test.ts).
- `feat(ui): extract arena window to canvas view core + painter` (src/ui/arena_window_view.ts, the arena painter, hud.ts splice, tests/arena_window_view.test.ts).
- `test(ui): register map+arena cores in UI-purity allowlist; update client_shell ids` (tests/architecture.test.ts, tests/client_shell.test.ts).
- `docs(frontend): mark P9a complete in progress.md + state.md ledger`.

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] map_window_view.ts and arena_window_view.ts are pure cores (DOM/Three/2D-context-free), registered in UI_PURE_CORES, and pass the architecture purity guard.
- [ ] Both canvas windows redraw from the SAME hud.update() mediumHud call site with the SAME `display === 'block'` guard and the SAME 250ms cadence; the cached background is preserved.
- [ ] The map painter REUSES src/render/delve_map_painter.ts where the delve-mode draw overlaps (no duplicated marker drawing).
- [ ] Each core test feeds BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub and asserts identical draw models (decision 15).
- [ ] Per-state tests pass: map delve-mode vs overworld-mode; arena active-match vs offline/unavailable.
- [ ] Canvas-token policy holds: each painter resolves --color-* via getComputedStyle once per redraw (cached), never per-marker; the cadence and all other literals are named constants (no-magic-values guard green).
- [ ] WCAG 2.2 AA chrome row green: axe clean, keyboard-reachable controls + focus-return, visible :focus-visible, forced-colors snapshot, target-size >=24px (>=40x40 mobile). Canvas has an accessible name (t() aria-label) + a text summary; the canvas-content-out-of-SR-scope boundary is stated.
- [ ] biome check clean on the new/changed .ts.
- [ ] tsc, both core tests, architecture guard, client_shell, full npm test, and build (all 4 entries) green.
- [ ] qa-checklist reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
Update progress.md (mark P9a done, list the 2 new canvas cores + painters, note both preserve the mediumHud call site + 250ms cadence + cached background) and the state.md phase ledger (P9a -> done). Record any surprising rule in memory (e.g. the mediumHud-not-cold gotcha for these two windows, the delve_map_painter reuse seam, or a getComputedStyle-once cadence subtlety).

STEP 7 - FINAL RESPONSE: report status, the new files (absolute paths), validation results (tsc, both core tests + parity + per-state, architecture guard, canvas-token + cadence gate, WCAG row, no-magic-values guard, biome, client_shell, full npm test, build all 4 entries), the qa-checklist verdict, any deferrals, and end with exactly: "Next: phase-09b-coldwindow-dom-questlog-spellbook-leaderboard.md".

STOPPING RULES:
- STOP and surface a scope change if either slice finds it needs to EXTEND IWorld or touch src/sim / server / src/net / headless (presentation-only is a hard line).
- STOP if a canvas window cannot be split without the core touching a 2D context or a DOM global - the canvas context MUST stay in the painter; if the data/geometry model cannot be made DOM-free, surface it rather than weakening the purity guard.
- STOP if preserving the mediumHud call site + 250ms cadence + cached background is not possible through the painter (e.g. the cadence is entangled with state you cannot route) - report it rather than regressing the redraw behavior.
- STOP if the purity guard cannot be made to pass for a core without removing it from the allowlist - the allowlist is the contract, not a place to except a leaky core.
- STOP if the canvas-token getComputedStyle-once policy cannot be honored (e.g. a token genuinely needed per-marker) - surface it; do not fall back to per-marker getComputedStyle or inline hex.
```

## Notes for the planner

This is the canvas half of the old P9, split out because the two canvas windows collide head-on with
the no-magic-values rule (decision 12): a 2D context cannot read CSS vars, so the painters carry the
getComputedStyle-once-per-redraw token-cache discipline that the DOM trio does not. The deep review's
load-bearing correction is that map (5561) and arena (5300) are NOT purely cold: both are called from
hud.update()'s mediumHud band behind a `display === 'block'` guard and redraw on the 250ms divider, so
the painters must preserve that exact call site, cadence, and the cached background rather than collapse
them to an open-once cold path (the trap that would have shipped a visibly stale or thrashing map). The
ULTRACODE flag is no: two windows sharing one split discipline is a light two-slice job, and reserving
ultracode for the DOM trio keeps each half well under the 40% context ceiling including its WCAG +
no-magic-values + ClientWorld-parity rows and in-session remediation. The arena offline state and the
map delve-vs-overworld branch are the explicit per-state + parity fixtures because the offline/online
shape difference is exactly the silent-online-misrender trap decision 15 exists to catch. The canvas
a11y decision is to ADD the label + summary now (canvas content stays out of SR scope honestly), not
defer it, so P15b only audits.
