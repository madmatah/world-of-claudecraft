# Phase P17b: Bundle-budget gate + selective lazy-load + cross-engine E2E + axe CI + packet close

Land the only behavior-affecting source change of the close-out: MEASURE the initial bundle (the eager
module graph of the play entry via build chunk metadata), add the JS bundle-budget CI gate (sibling to
`asset:budget`), and SELECTIVELY dynamic-import only the measured-heavy + rarely-opened cold windows
(options/market/leaderboard candidates) while keeping bags/char eager, with an a11y-correct loading
state. Then wire the opt-in browser-mode suite + the per-window axe checks into a STANDING CI job across
the big-3 desktop + mobile Safari/WebKit, update the docs/CLAUDE.md, and mark the packet
implementation-complete (P0-P17b), with the final QA the only remaining step.

## Starter Prompt

```
This is Phase P17b of the Frontend Modernization v0.16.0 packet: Bundle-budget gate + selective
lazy-load + cross-engine E2E + axe CI + packet close. Deps: P0-P16, P17a (the standing harness floor).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a surgical close-out phase (measure the bundle, add one gate, selectively
lazy-load a small set of measured-heavy windows, wire two CI jobs, close the packet). The lazy-load
slice is the only source touch and is evidence-driven (measure first). No batch fan-out; the slices
share the same bundle-cost audit and CI config. A single review pass at the end.

Goal: close the two open infrastructure items the packet committed to: bundle discipline (decision 13)
and the cross-engine + webkit-in-CI matrix (decision 14), then close the packet. Concretely:
- MEASURE the initial bundle precisely (the eager module graph of the play entry via build chunk
  metadata, across the 4 entries + shared chunks), attributing each cold-window painter module's cost.
- Add a JS bundle-budget CI gate as a sibling to asset:budget (npm script + CI step, fail-on-exceed).
- SELECTIVELY convert ONLY the measured-heavy + rarely-opened windows (options/market/leaderboard
  candidates) to dynamic import; keep frequently-opened ones (bags/char) eager. Each lazy window carries
  an a11y contract (aria-busy / role=status loading state + focus-return across the async swap), a
  forced-colors/screenshot proof of the loading AND resolved states, and a ClientWorld-vs-Sim parity
  re-check.
- Wire the opt-in browser-mode suite + the per-window axe a11y checks into a STANDING CI job across the
  big-3 desktop + mobile Safari/WebKit; bare vitest run must NOT launch a browser; CI provisions
  browsers explicitly.
- Update progress.md, state.md, CLAUDE.md; mark the packet implementation-complete (P0-P17b) with the
  final QA the only remaining step.

P17a already stood up the standing test floor (client_shell repointed, hud_perf_budget standing,
UI_PURE_CORES completeness-checked, first all-together perf_tour run). Do not redo it; build on it.

STEP 0 - PRE-FLIGHT:
- git status clean. If not clean, ASK the user (this is a shared checkout; a concurrent session may
  share the tree). Stage only this phase's explicit paths, never git add -A.
- Memory scan: MEMORY.md plus the FB-equivalent close entries:
  [[frontend-phase9-testing-docs-sweep]] (the OPT-IN browser-mode split = a SEPARATE
  vitest.browser.config.ts + npm run test:browser so bare vitest run cannot launch a browser; the
  @vitest/browser-playwright provider() function + browser.instances array; the EXACT peer pin on
  vitest + required playwright peer; NO install hook so npm ci never downloads browsers = npx playwright
  install to provision; the OPEN webkit-in-CI item THIS phase closes; chromium/firefox/webkit x 3 = 27
  green is the FB shape, here we ADD mobile WebKit as a first-class instance),
  [[frontend-phase8-graphics-tier-effects]] (live computed-style proof > static CSS-text guards; the
  forced-colors snapshot precedent), [[frontend-phase5-mobile-landscape]] (notch/safe-area + the
  real-CDP-vs-CSS-text lesson, relevant to the loading-state screenshot proof). Also
  [[phased-packet-qa-cadence]].
- Confirm you are in the feature/frontend-modernization-v016 worktree.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, and keep its summary (not raw dumps):
- docs/frontend-modernization/state.md: locked decisions 4 (cold-window extraction presentation-only),
  10 (WCAG 2.2 AA chrome; the loading-state IS a control), 12 (no-magic-values; the loading label is a
  t() key, the loading-state classes are tokens/constants), 13 (BUNDLE: measure first, evidence-driven,
  selective; the candidates list options/market/leaderboard is a HYPOTHESIS the measurement confirms or
  refutes; bags/char eager), 14 (BROWSER MATRIX: big-3 + mobile Safari/WebKit, forced-colors, the
  cross-engine CI close), 15 (ClientWorld-vs-Sim parity), the validation matrix (esp. the BUNDLE row +
  the WINDOW/CONTROL a11y row), the review dispatch matrix, and the Key file paths list.
- This phase file.
- The "### P17" close-out section of v016-recon-and-packet.md plus "Load-bearing structural findings"
  (the cold-window seam + the build/entry findings) and "Top risks".
- The BUNDLE surface: how the build emits the 4 entries (vite.config.ts after the P1 Lightning flip;
  the play + index + admin + guide chunks; the shared chunks). Have the agent return: the build's chunk
  metadata source (the Rollup/Vite chunk map or a metafile equivalent) and HOW to read per-module cost
  from it; any existing asset:budget gate (the npm script + CI step it lives in) so the new JS gate
  MIRRORS its fail-on-exceed shape; and the eager module graph of the PLAY entry today (which cold-window
  painter modules P7a-P9b are eagerly imported and their measured byte cost). Have it return the
  per-window measured cost table (options / market / leaderboard / bags / char / the rest), NOT file
  bodies.
- The cold-window open path: how a cold window is currently opened (the window-open dispatch in hud.ts;
  renderOptions ~12783, renderMarket ~8343, renderLeaderboard ~10673 (async already), renderBags ~8839,
  renderChar ~9116). Have the agent return the EXACT open-path seam so the dynamic import routes through
  it (do not invent a new seam), and the existing focus-return / focusFirstInteractive helpers
  (hud.ts:2570-2604) the loading state reuses for focus management across the async swap.
- The cross-engine surface: the opt-in browser-mode config (vitest.browser.config.ts +
  tests/browser/*.browser.test.ts + npm run test:browser) and the per-window axe a11y checks P15a/P15b
  added, and how ci.yml runs (or does not yet run) them. Have the agent return the current
  browser.instances shape and whether mobile WebKit is present.
- The forced-colors / screenshot proof surface: the scripts/*_shot.mjs visual-baseline harness and the
  forced-colors snapshot precedent P15a/P8 used, so the loading-state proof reuses it.
THE 40% RULE: keep the working set small; this is a close-out. If the bundle-cost audit is large, have
the agent return ONLY the per-window measured byte cost table + the open-path seam + the CI config
shape, not file bodies.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Sequential, three slices (no fan-out; they share the bundle-cost audit and the CI config):

- Slice A - JS bundle-budget gate + selective lazy-load (decision 13; the only source touch):
  - First MEASURE precisely: build (4 entries) and read the build chunk metadata to attribute the
    INITIAL bundle = the EAGER MODULE GRAPH OF THE PLAY ENTRY (the modules loaded before any window is
    opened), across the 4 entries + shared chunks. Record each cold-window painter module's contribution.
    Identify the genuinely heavy + rarely-opened windows (options/market/leaderboard are CANDIDATES, not
    a mandate) vs the frequently-opened eager ones (bags/char). The candidate list is a hypothesis the
    measurement confirms or refutes (see STOPPING RULES).
  - Add the JS bundle-budget gate as a sibling to asset:budget (an npm script + a CI step that fails
    when the play-entry initial bundle exceeds the budget). Set the budget from the measured
    post-lazy-load size, with the SAME fail-on-exceed shape as asset:budget. The budget is a named
    constant in the gate script, not a magic literal scattered around (decision 12 spirit).
  - SELECTIVELY convert ONLY the measured-heavy + rarely-opened windows to dynamic import (the painter
    module loads on first window-open, behind a loading state); keep bags/char eager. Route it through
    the EXISTING window-open seam (STEP 1), do not invent a new seam. This is the ONLY behavior-affecting
    edit in the phase.
  - LOADING-STATE A11Y CONTRACT (decision 10): the loading state is a CONTROL, so it carries
    aria-busy="true" on the window container while loading and a role="status" live region announcing
    the load (the loading label is a t() key in src/ui/i18n.catalog/hud_chrome.ts, English-only, never a
    concat / ?? fallback), and focus is MANAGED across the async swap: focus does not get stranded on a
    removed node, and on resolve focus lands on the window's first interactive element via the existing
    focusFirstInteractive helper (focus-return on close still works). No :focus-visible is animated away.
  - Prove (added to the standing suite from P17a):
    - a build-size assertion: the play-entry initial bundle shrinks by the measured cost of each lazy
      window and the bundle-budget gate passes;
    - a browser-mode open-on-first-use test per lazy window: the window OPENS (loading state shows, then
      resolves to content) on first open, in a real engine;
    - a forced-colors + screenshot proof of BOTH the loading state AND the resolved state per lazy window
      (reuse the scripts/*_shot.mjs harness + the forced-colors snapshot precedent): borders/focus
      survive forced-colors and the loading state is not meaning-by-background-only;
    - a ClientWorld-vs-Sim parity RE-CHECK for each lazified window: its *_view core test is fed BOTH a
      Sim-shaped and a ClientWorld-mirror-shaped IWorld stub (decision 15), since the async open path is
      exactly where an online-only field-shape or async-cadence assumption (leaderboard/market) silently
      misrenders.
  - NO-MAGIC-VALUES (decision 12): the loading-state DOM driven via tokens/CSS vars + named constants
    (the spinner/skeleton styling, any timeout), never a raw hex/px in TS; the loading label is t().

- Slice B - cross-engine E2E + standing axe a11y gate into CI (decision 14, closing FB's webkit-in-CI
  item): wire the opt-in browser-mode suite (vitest.browser.config.ts + npm run test:browser +
  tests/browser/*.browser.test.ts) AND the per-window axe a11y checks P15a/P15b added into a STANDING
  (or scheduled) CI job in ci.yml, with mobile Safari/WebKit as a FIRST-CLASS instance alongside the
  big-3 desktop engines (the browser.instances array). Provision browsers in the CI job (npx playwright
  install; there is NO install hook by design, so npm ci never downloads browsers). The axe checks run
  as a standing a11y regression gate so a future change cannot silently break the WCAG 2.2 AA chrome
  P15a/P15b consolidated. Keep the suite OPT-IN locally (bare vitest run must NOT launch a browser; CI
  invokes npm run test:browser explicitly). The new per-lazy-window open-on-first-use + forced-colors
  tests from Slice A live in tests/browser/ and run under this job.

- Slice C - packet close (docs): STEP 6.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only: do NOT extend IWorld or touch src/sim / server / src/net / headless. The only
  source edit is the selective dynamic-import of measured-heavy cold-window painters (Slice A), routed
  through the existing window-open seam, plus its loading-state a11y wiring; if anything else seems to
  need a source change, STOP (scope change).
- Lazy-load discipline (decision 13): evidence-driven, never blanket splitting. Only the MEASURED-heavy
  + rarely-opened windows go dynamic; frequently-opened ones (bags/char) stay eager. The budget gate
  proves both the play-entry shrink and that each lazy window still opens on first use.
- Loading-state a11y (decision 10): aria-busy + role=status + focus-return across the async swap; the
  loading label is a t() key; :focus-visible never animated away; forced-colors survives.
- No-magic-values (decision 12): the loading-state DOM drives tokens/vars + named constants; no raw
  hex/px/color literal in the new TS.
- ClientWorld-vs-Sim parity (decision 15): each lazified window's *_view core test is fed BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
- Browser matrix (decision 14): mobile Safari/WebKit is a first-class CI instance; the opt-in suite
  stays opt-in locally (bare vitest run cannot launch a browser); CI provisions browsers explicitly.
- Determinism: no Math.random/Date.now/performance.now in any registered pure core (unchanged here).
- i18n: the lazy-window loading label is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only);
  any existing label assertion still expects the t() key path; no concat / ?? fallback.
- No generated-file hand-edits; regenerate via the build if anything generated drifts.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).

Out of scope (do NOT do in this phase):
- Any new extraction or any hud.ts/CSS/painter source edit BEYOND the Slice A selective lazy-load + its
  loading-state a11y wiring. Every element and window was extracted in P6-P14b.
- Re-doing the P17a test floor (client_shell repoint, hud_perf_budget standing, UI_PURE_CORES
  completeness, the first all-together perf_tour). Build on it; add only the new per-lazy-window proofs.
- Any per-element tiering change (P14a owns it) or new perf optimization. The budget gate ASSERTS a
  budget, it does not tighten the per-frame budget.
- Blanket route-splitting or lazy-loading windows that measure cheap or open frequently (decision 13
  forbids it).
- New a11y FIXES to the windows themselves (P15a/P15b own the WCAG 2.2 AA chrome work); this phase only
  adds the loading-state a11y contract for the windows it lazifies + wires the axe gate that guards
  P15's result.
- The full QA pass: that is the separate qa-checklist run that follows this phase (the packet's final
  QA). This phase delivers the implementation; QA reviews it.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (from state.md):
- Baseline: npx tsc --noEmit.
- New .ts module added (the bundle-gate script + any lazy-load loading-state module): biome check on
  the new/changed .ts.
- Test-harness / standing-suite change: npx vitest run tests/architecture.test.ts +
  tests/hud_perf_budget.test.ts (still green after the lazy-load wiring) + the new bundle-size + per
  lazy-window tests; then full npm test green.
- BUNDLE GATE (decision 13, state.md BUNDLE row): npm run build (all 4 entries); the JS bundle-budget
  gate passes; for each window switched to a dynamic import, the play-entry INITIAL bundle shrinks by
  its measured cost and the window still OPENS (with the a11y-correct loading state, then content) on
  first use, proven by the per-lazy-window browser-mode test.
- WINDOW/CONTROL a11y (decision 10, MANDATORY because this phase adds a control: the loading state):
  the WCAG 2.2 AA chrome checks on each lazy window's loading + resolved states - axe-core over the
  built loading state AND the resolved window; keyboard reachability + focus-return across the async
  swap (focus is not stranded; resolve lands focus via focusFirstInteractive; close returns focus);
  visible :focus-visible never animated away; a forced-colors: active snapshot of BOTH states;
  target-size >= 24px and >= 40x40 on mobile touch controls. These run under the Slice B CI job.
- NO-MAGIC-VALUES painter guard (decision 12, MANDATORY because this phase adds loading-state DOM):
  the loading-state DOM drives tokens/CSS vars; every other literal is a named constant; the standing
  no-magic-values guard the per-frame phases installed stays green over the new code.
- CLIENTWORLD-vs-SIM parity (decision 15, MANDATORY): each lazified window's *_view core test feeds
  BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
- CROSS-ENGINE + A11Y (decision 14, state.md WINDOW/CONTROL row): the standing CI job runs the opt-in
  browser-mode suite across the big-3 desktop + mobile Safari/WebKit AND the per-window axe a11y checks;
  bare vitest run still does NOT launch a browser; CI runs npx playwright install.
- Player text changed (the loading label): npx vitest run tests/localization_fixes.test.ts; the new
  English-only hud_chrome.ts label does not trip the release tier.
- Pre-merge / CI mirror: npm run i18n:gen && npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build (all 4 entries), then the bundle-budget gate, then the
  cross-engine + axe CI job, then biome ci --changed (lints the new bundle-gate script + the loading
  state + the browser tests).
Review dispatch (spawn ONLY matching rows): qa-checklist only. No privacy-security-review (no
server/admin/net/secret/Math.random in sim; the lazy-load is a client-side load-timing change), no
migration-safety (no DDL/JSONB), no cross-platform-sync (IWorld untouched; consuming a landed member
and changing a window's load timing is not an IWorld change; the parity obligation is covered by the
per-core parity test, not by spawning this reviewer). Prompt the reviewer for COVERAGE not filtering
(is the lazy set evidence-driven and bags/char still eager; does each lazy window open on first use;
is the loading state a11y-correct under forced-colors + keyboard; does bare vitest run avoid launching
a browser; is mobile WebKit a first-class instance). Do not commit until it reports no BLOCKING. If it
truncates, resume with the state.md STEP 3 resume line.

STEP 4 - COMMIT CADENCE (3-5 Conventional Commits, scope + EXPLICIT paths):
- perf(ui): lazy-load measured-heavy cold windows behind an a11y loading state
  (src/ui/hud.ts, src/ui/i18n.catalog/hud_chrome.ts, the loading-state module if any)
- build(ui): add JS bundle-budget gate sibling to asset:budget
  (package.json, vite.config.ts, scripts/bundle_budget.mjs, tests/bundle_budget.test.ts,
  tests/browser/lazy_windows.browser.test.ts)
- ci(ui): run cross-engine browser-mode + axe a11y as a standing CI job
  (.github/workflows/ci.yml, vitest.browser.config.ts, tests/browser/)
- docs(frontend): close the v0.16.0 packet ledger (implementation-complete, P0-P17b)
  (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md, CLAUDE.md)

STEP 5 - ACCEPTANCE CRITERIA:
(see the checkbox list below)

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P17b done; mark the packet IMPLEMENTATION-COMPLETE (P0-P17b) and name the final QA
  as the only remaining step.
- state.md: update the phase ledger (P17b status), the Key-file-paths list (the JS bundle-budget gate +
  which windows are now lazy + bags/char stay eager; the cross-engine + axe standing CI job; the
  loading-state a11y contract), and the "Current phase" line to PACKET IMPLEMENTATION-COMPLETE,
  pre-final-QA.
- CLAUDE.md: update the pointers / guard list so a future contributor knows the JS bundle-budget gate
  guards the play-entry initial-bundle size (and which windows are lazy + that bags/char stay eager),
  the cross-engine + axe job is the standing browser/a11y gate (mobile WebKit first-class; bare vitest
  run does not launch a browser; CI runs npx playwright install), and a lazy window carries an
  aria-busy/role=status loading-state a11y contract.
- Memory: record any surprising rule (the measured per-window bundle cost + which windows went lazy +
  which CANDIDATE turned out cheap or which frequent window was heavy; the CI browser-provisioning step;
  the loading-state a11y contract shape; the forced-colors loading-state proof; the exact play-entry
  initial-bundle shrink).

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), the validation results (tsc, the vitest files +
the bundle-size + per-lazy-window browser tests, biome check, the bundle-budget shrink per lazy window,
the cross-engine + axe CI job result across the big-3 + mobile WebKit, build all 4 entries, biome ci
--changed, localization_fixes for the loading label), the measured per-window bundle-cost table + which
windows went lazy + why (and any candidate that stayed eager because it measured cheap), the
qa-checklist reviewer verdict, and any deferrals. End with exactly:
Next: (packet complete; run the final QA over the closed packet)

STOPPING RULES (phase-specific):
- STOP if the bundle measurement shows a candidate window (options/market/leaderboard) is NOT actually
  heavy, or a "frequently opened" window (bags/char) IS heavy: follow the evidence (decision 13), do NOT
  lazy-load a cheap window and do NOT blanket-split; record the measured costs and the decision.
- STOP if a lazy window does NOT open on first use (the loading state never resolves to content): the
  dynamic-import wiring is broken, fix it before committing; never ship a window that cannot open.
- STOP if the loading state fails the a11y row (focus stranded on the removed node, no role=status /
  aria-busy, the loading label not a t() key, or forced-colors loses the border/focus): fix the loading
  state before committing; the lazy window is a control and must meet the WCAG 2.2 AA chrome bar.
- STOP if making the bundle gate green would require editing a source/painter file BEYOND the Slice A
  lazy-load + its loading-state wiring: that is a scope change. Surface it.
- STOP if a lazified window's *_view core misrenders under the ClientWorld-mirror-shaped stub but passes
  under Sim (decision 15): that is the exact online-only async-cadence break the parity re-check exists
  to catch; fix the core's assumption (if in-phase) or route it to the owning extraction phase.
- STOP if wiring the cross-engine job makes bare vitest run launch a browser: the opt-in split is broken
  (the suite must stay a SEPARATE config); restore the split before committing.
- STOP if CI cannot provision mobile WebKit (the install or the browser.instances entry fails): mobile
  Safari/WebKit is a first-class target (decision 14), not optional; fix the provisioning before the job
  is considered standing.
```

## Notes for the planner

This phase is the second half of the old P17 split: the behavior-affecting close-out. It lands the only
source change of the whole close-out (the selective lazy-load) plus the two open infrastructure items
the packet committed to: bundle discipline (decision 13) and the cross-engine + webkit-in-CI matrix
(decision 14), then closes the packet. It depends on P17a having already stood up the standing test
floor, so this phase builds on that floor (adding the bundle-size + per-lazy-window proofs to it) rather
than re-authoring it.

The lazy-load is deliberately evidence-driven and the deep-review fixes are baked in. The initial bundle
is defined PRECISELY (the eager module graph of the play entry via build chunk metadata, across the 4
entries + shared chunks), not hand-waved, so the per-window cost attribution is real and the candidate
list (options/market/leaderboard) is a hypothesis the measurement confirms or refutes (the stopping rule
routes a cheap candidate or a heavy frequent window back to the evidence). The loading state is treated
as a CONTROL with a full a11y contract (aria-busy / role=status + focus-return across the async swap +
a forced-colors/screenshot proof of both the loading and resolved states), because the async open path
is exactly where focus gets stranded and where forced-colors regressions hide. Each lazified window also
gets a ClientWorld-vs-Sim parity re-check, since the async windows (leaderboard/market) are the most
likely to carry an online-only field-shape or async-cadence assumption that passes every offline gate.

The cross-engine job reuses FB's opt-in browser-mode split exactly (a SEPARATE
`vitest.browser.config.ts` so bare `vitest run` never launches a browser) and adds mobile WebKit as a
first-class instance plus the standing axe gate, so a future change cannot silently break the WCAG 2.2
AA chrome or a target engine; CI provisions browsers explicitly (`npx playwright install`) because there
is no install hook by design. By the end, the bundle has a budget, the heavy rarely-opened windows load
on demand behind an accessible loading state, the browser matrix and the axe gate are standing in CI,
and the only remaining step is the packet's final QA.
