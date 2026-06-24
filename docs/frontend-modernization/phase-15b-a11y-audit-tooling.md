# Phase P15b: Accessibility audit: chrome-wide axe + keyboard E2E + per-window fixes

AUDIT-and-FIX accessibility across every extracted window and per-frame control, on the infra P15a
shipped. Wire axe-core plus a keyboard-nav E2E (trap + Esc + focus-return) into the OPT-IN browser
suite (vitest.browser.config.ts / npm run test:browser) so a bare vitest run never launches a browser;
run the audit against a populated/seeded world reachable in BOTH Sim and ClientWorld (parity); fix the
gaps each window-group surfaces; assert :focus-visible is never animated/blurred/transitioned away; and
add a mobile-viewport target-size pass requiring >=40x40 on touch controls. Cross-engine CI turn-on is
P17b. The 3D world/canvas stays OUT of scope (not screen-readable).

## Starter Prompt

```
This is Phase P15b of the Frontend Modernization v0.16.0 packet: Accessibility audit: chrome-wide axe + keyboard E2E + per-window fixes.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is a multi-slice AUDIT-then-FIX fan-out: one slice per window-group plus a chrome-wide slice plus a mobile-viewport target-size pass plus the axe + keyboard-nav tooling slice. Use ultracode + a Workflow: parallel auditors over the extracted windows/controls, then adversarial verify, then fold the fixes into the right per-window or shared-infra module. The tooling slice (axe + Playwright into the opt-in browser suite) integrates once.

Goal: AUDIT every extracted window and per-frame control to WCAG 2.2 AA (decisions 10, 11, 14) and FIX the gaps the audit surfaces, on the infra P15a shipped (the shared focus manager, skip links, live regions, forced-colors, print reset). Per-window roles/aria were built IN during P7-P14 (the WINDOW/CONTROL acceptance row), so this phase AUDITS and fills GAPS, it does not rebuild green work. Wire axe-core + a keyboard-navigation E2E (trap + Esc + focus-return) into the OPT-IN browser suite (vitest.browser.config.ts + npm run test:browser); a bare `vitest run` must NOT launch a browser. Run the audit against a POPULATED / seeded world reachable in BOTH the offline Sim and the online ClientWorld (decision 15 parity) so an offline-only-shape window is caught. Guard that :focus-visible is NEVER animated/blurred/transitioned/filtered away (the FB lesson). Add a MOBILE-viewport target-size pass asserting >=40x40px on touch controls (the action bar + joystick + mobile chrome), not merely the >=24px desktop floor; run the IN-GAME mobile audit in LANDSCAPE (the game is landscape-only on web mobile, decision 16a) and confirm the `#rotate-device` portrait overlay is itself reachable/announced. The 3D world/canvas is OUT of scope (not screen-readable): state that boundary honestly, do not fake aria over the game world. Cross-engine WebKit-in-CI turn-on of the whole suite is P17b.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything. Do not stash or revert a concurrent session's work.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the frontend-modernization entries: frontend-architecture-vanilla-stack and frontend-phase9-testing-docs-sweep (the Vitest 4 Browser Mode pattern: a SEPARATE vitest.browser.config.ts, the @vitest/browser-playwright provider + the playwright() function + browser.instances, pure cores stay Node, the opt-in suite is npm run test:browser and bare vitest run stays Node-only); the P7-P14 phase entries (what a11y each window already carries, so the audit fills gaps not rebuilds); frontend-phase5-mobile-landscape and the mobile-button/joystick-size E2E (the 40x40 touch floor, the real-CDP-insets gotcha: a touch-target check must use real rendered geometry, not a CSS-text assertion); phased-packet-qa-cadence; no-em-dashes-or-emojis; shared-worktree-commit-care. KEY FB LESSON to carry and to GUARD this phase: a visible :focus-visible ring must NEVER be animated, blurred, transitioned, or filtered away.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read + summarize back (the orchestrator keeps the summary, not raw dumps):
- docs/frontend-modernization/state.md - locked decision 10 (the WINDOW/CONTROL a11y acceptance row is MANDATORY per phase and CONSOLIDATED/audited here; target-size SC 2.5.8 >=24px absolute floor PLUS the >=40x40px mobile touch floor, do NOT weaken it; :focus-visible never animated away), decision 11 (forced-colors only, no light theme), decision 14 (browser matrix incl mobile WebKit, the opt-in browser suite, cross-engine CI on in P17b), decision 12 (no magic values; canvas painters out of axe but their host window still gets a label + honest summary), decision 15 (ClientWorld-vs-Sim PARITY: the audit world must be reachable in both), decision 16 (responsive is mobile-E2E-gated), the non-negotiable constraints (presentation-only, i18n, EXPLICIT paths, no em/en dashes), the canonical workflow, the validation matrix WINDOW/CONTROL + RESPONSIVE rows, and the Review Dispatch Matrix.
- docs/frontend-modernization/phase-15a-a11y-infra.md - the infra this phase audits on top of (the focus manager API + the FOCUSABLE_SELECTOR constant the keyboard-nav E2E asserts, the skip-link ids + targets, the live-region ids + the COMBAT_ANNOUNCE_INTERVAL_MS, the forced-colors + print sections).
- docs/frontend-modernization/progress.md - the P7-P14 rows AND the P15a row, so the audit knows what a11y each window/control already carries and what infra is in place.
- this phase file in full.
- v016-recon-and-packet.md "Load-bearing structural findings" + the P7-P9 / P10-P14 detail (the full inventory of windows + controls that now exist as painters, to audit).
- the SPECIFIC V16 source ranges only, read narrowly:
  - The window/control inventory to audit (from the recon + the landed painters): cold windows talents / social / bags (P7), options / market / char (P8), map / arena / questlog / spellbook / leaderboard (P9); per-frame controls player/target/party unit frames, cast/swing/xp bars, action bar (the elided aria-label landed in P12a MUST keep its t() call), auras, minimap, FCT, nameplates (P10-P14).
  - The action-bar buttons + the mobile touch controls for the target-size pass: the action-bar button geometry and the mobile joystick / touch-button geometry (cross-reference the V16 mobile_button_size / mobile_joystick_size scripts for the existing 40x40 selectors so the new mobile target-size axe/geometry pass uses the same elements).
  - The focus-visible CSS now in src/styles/components.css / base.css (the .x-btn / .action-btn / .chat-tab / range / checkbox rules + the P15a skip-link rule) for the no-animated-focus GUARD (grep these for a transition / animation / filter / blur on a :focus-visible selector and assert none).
  - The two canvas windows (map, arena) + the canvas controls (minimap, nameplates, FCT): for the honest "canvas is not screen-readable, label + summary only" boundary; the HOST window/control still gets an accessible name + an honest text summary, the canvas pixels do not get fake per-marker aria.
  - vitest.browser.config.ts and tests/browser/*.browser.test.ts (NEW in this packet per the FB pattern; if P15a/earlier did not create the config, this phase creates it as the OPT-IN suite), package.json scripts (the test:browser script), and package.json devDependencies (axe-core / @axe-core/playwright + @vitest/browser-playwright + playwright are added here if not already present).
  - A seeded/populated world entry the audit can drive in BOTH Sim and ClientWorld: the dev seed / debug hook that opens every window with content (so an empty window does not pass axe vacuously), reachable offline (Sim) and via the online client mirror (ClientWorld). If no single seeded entry reaches both, surface it; the parity requirement is that the SAME audited windows render under both world shapes.
  - tests/css_corpus.test.ts (no NEW CSS sections expected unless a fix adds one), tests/client_shell.test.ts (any id a fix touches), tests/architecture.test.ts (no new pure core expected; if a fix extracts one it registers in UI_PURE_CORES).
Have the agent return: the deduplicated window/control audit inventory grouped (AUDIT-A..D below), the mobile touch-control selector set + their current rendered sizes, the :focus-visible selector set in the extracted CSS (to guard), the seeded-world entry that reaches both Sim and ClientWorld, and whether vitest.browser.config.ts / the test:browser script / the axe + playwright deps already exist.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (ultracode Workflow, fan out EXPLICITLY):
Audit-and-fix slices (PARALLEL, one per window-GROUP plus a chrome-wide slice plus a mobile slice; each auditor FIXES the gaps it finds and folds the fix into the right per-window or shared-infra module, then an adversarial verifier confirms the fix and that no green work regressed):
  AUDIT-A Cold windows group 1 (P7: talents, social, bags) - roles/aria/labels/target-size + keyboard reachability + focus-trap-and-return (via the P15a manager) audit and fixes.
  AUDIT-B Cold windows group 2 (P8: options, market, char) - same. The options 9-sub-panel dispatch and the char 3D preview HOST get labels; the 3D preview canvas itself is OUT (label + honest summary).
  AUDIT-C Cold windows group 3 (P9: map, arena, questlog, leaderboard, spellbook) - same; the two canvas windows (map, arena) get the honest "canvas not screen-readable, label + summary only" boundary, NOT fake per-marker aria. The async leaderboard's loading state carries aria-busy / role=status + focus-return across the async swap.
  AUDIT-D Per-frame controls (P10-P14: player/target/party unit frames, cast/swing/xp bars, action bar incl the elided aria-label, auras, minimap, FCT, nameplates) - roles/aria; target-size SC 2.5.8 (>=24px CSS or adequate spacing) on the action-bar buttons + every clickable frame. The action-bar aria-label MUST still route through t() (decision: no concat, no `??` fallback, no default param); this phase must not regress P12a. The minimap / nameplate / FCT canvas surfaces are OUT (host gets a label + honest summary, canvas pixels do not get per-marker aria).
  AUDIT-E Chrome-wide slice: skip links reachable + ordered (first focusable, both entries); the P15a focus manager TRAPS + RETURNS on every open window (no surviving ad-hoc caller); live regions announce on the chosen per-type politeness with no double-announce; forced-colors survives; print reset present. THE :FOCUS-VISIBLE GUARD: grep the extracted CSS for any transition / animation / filter / blur applied to (or inherited onto) a :focus-visible selector and ASSERT NONE (a css_corpus-style text guard or a computed-style check); the focus ring must be steady.
  MOBILE-VIEWPORT target-size pass (the deep-review-added slice): under a mobile viewport profile, assert every TOUCH control (the action-bar buttons, the joystick, the mobile chrome buttons) renders >=40x40px (the PREFERRED mobile floor, decision 10), not merely the >=24px absolute desktop floor. Resolve the 40-vs-24 tension explicitly: 24px is the ABSOLUTE SC 2.5.8 floor enforced everywhere; 40x40 is the stronger floor REQUIRED on mobile touch controls, and the existing V16 mobile_button_size / mobile_joystick_size geometry must not be weakened. Use the rendered geometry (real CDP / browser-mode measurement), never a CSS-text assertion.
Tooling slice (wire the automated gate; integrate once, not in the fan-out):
  TOOL-1 Wire axe-core (via @axe-core/playwright or the equivalent vanilla checker) into the OPT-IN browser suite: ensure vitest.browser.config.ts exists with the FB-pattern provider (@vitest/browser-playwright + the playwright() function + browser.instances) and the npm run test:browser script; add tests/browser/a11y.browser.test.ts that, for each BUILT window, OPENS the window in a seeded world, runs axe, and asserts ZERO serious/critical violations. Run the audit world in BOTH a Sim-backed and a ClientWorld-mirror-backed mode (decision 15 parity) so an offline-only-shape window is caught. Add a keyboard-navigation E2E: Tab through a representative open window, assert the P15a trap holds (Tab/Shift+Tab cycles inside, focus does not escape), Esc closes, and focus RETURNS to the opener. axe + Playwright stay in the OPT-IN suite (npm run test:browser), NOT inline test projects, so a bare `vitest run` never launches a browser. Cross-engine (WebKit) turn-on in CI is P17b; this phase wires the suite and may run it locally on Chromium, but does NOT add it to the default CI matrix.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY: no IWorld / src/sim / server / src/net / headless change. A11y fixes are DOM + CSS + presentation wiring only. Server authority untouched. If a fix needs to extend IWorld or touch sim/server, STOP and surface it (scope change).
- i18n: every NEW aria / label string a fix adds is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. The P12a action-bar aria-label elision MUST keep its t() call (no concat, no `??` fallback, no default param); this phase must not regress it.
- forced-colors only; NO light theme / NO prefers-color-scheme branch (decision 11).
- :focus-visible is visible on every interactive element and is NEVER animated, blurred, transitioned, or filtered away (the FB lesson): the AUDIT-E guard enforces it.
- Target-size: 24px absolute floor everywhere (SC 2.5.8); 40x40px PREFERRED floor on mobile touch controls, never weakened.
- No magic values in any CSS a fix adds (decision 12): reference token vars, not literal hex/px where a token exists.
- The 3D world/canvas (and the per-marker pixels of map/arena/minimap/nameplate/FCT) are OUT of a11y scope (not screen-readable): the HOST gets a label + honest summary, the pixels do not get fake aria. State the boundary in comments + the docs.
- The opt-in browser suite must NOT leak into the default run: bare `vitest run` stays Node-only, no browser launched.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits). Commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The shared a11y INFRA (focus manager, skip links, live regions, forced-colors, print, viewport-lock drop): that landed in P15a; this phase audits and fixes ON it, it does not rebuild it.
- Re-building per-window roles/aria that P7-P14 already shipped: AUDIT and fill GAPS only.
- Any new IWorld member, wire field, sim/server/net change (none in this packet).
- A light theme / prefers-color-scheme (decision 11 forbids it).
- Standards codification into CLAUDE.md (the a11y contract write-up): that is P16.
- Turning the browser suite ON across engines (WebKit) in CI + the bundle-budget close: that is P17b. This phase wires the opt-in suite and may run it locally; CI cross-engine turn-on is P17b.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- New .ts module added (any pure helper a fix extracts; the browser test files): `biome check` on the new/changed .ts.
- WINDOW or CONTROL changed (the whole phase, decision 10 MANDATORY rows):
  (a) WCAG 2.2 AA chrome row: axe-core zero serious/critical violations on EVERY built window (npm run test:browser); keyboard reachability + focus-return on close (the keyboard-nav E2E, asserting the P15a trap + Esc + return-to-opener); a forced-colors: active snapshot; visible :focus-visible present AND the no-animated/blurred/transitioned/filtered-away guard; target-size >=24px on every control, and >=40x40 on mobile touch controls (the mobile-viewport pass).
  (b) No-magic-values painter guard: any CSS a fix adds references tokens/vars; the canvas hosts (map/arena/minimap/nameplate/FCT) keep their cached-once-per-redraw token resolution (a fix here does not regress it) and get a label + honest summary, not per-marker aria.
  (c) ClientWorld-vs-Sim PARITY: the audit world is driven in BOTH a Sim-shaped and a ClientWorld-mirror-shaped mode so an offline-only-shape window (async leaderboard/market, target cast remaining, combo pips, party out-of-range) is exercised under both; an offline-only assumption fails the parity run, not just ships broken online.
- CSS changed (only if a fix adds/edits a section): `npx vitest run tests/css_corpus.test.ts` + `npx vitest run tests/client_shell.test.ts` + `npm run build` (all 4 entries) + the backdrop-filter survival check + `biome check` on the changed CSS.
- RESPONSIVE / mobile changed (the mobile target-size pass): run the V16 mobile E2E scripts as a blocking row (decision 16: mobile_button_size, mobile_joystick_size, mobile_input_zoom_check, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area); a real-CDP / browser-mode geometry check, not a CSS-text assertion.
- Player text changed (any new aria/label in hud_chrome.ts, English-only): `npx vitest run tests/localization_fixes.test.ts` - a new label must NOT trip the release tier.
- Whole-suite + build: `npm test` and `npm run build` (4 entries) green; CONFIRM a bare `vitest run` does NOT launch a browser (the axe + Playwright suite is opt-in only).
Review dispatch (only the rows the diff touches): qa-checklist (default; this completes a deliverable set). privacy-security-review does NOT fire (no server/net/admin, no new randomness in sim/a core). cross-platform-sync does NOT fire (IWorld unchanged; the parity obligation is covered by the per-window parity audit run, not by spawning the reviewer). migration-safety N/A. Prompt the reviewer for COVERAGE not filtering; resume a truncated reviewer with the state.md resume line. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope + EXPLICIT paths, never git add -A):
- test(ui): wire axe-core + keyboard-nav E2E into the opt-in browser suite
  (vitest.browser.config.ts, tests/browser/a11y.browser.test.ts, tests/browser/keyboard_nav.browser.test.ts, package.json)
- fix(ui): chrome-wide a11y audit fixes (cold windows + per-frame controls)
  (src/ui/<window/painter modules the audit touched>, src/ui/i18n.catalog/hud_chrome.ts)
- fix(ui): mobile touch target-size >=40x40 + the no-animated-focus-visible guard
  (src/styles/components.css, tests/<focus-visible guard>.test.ts, tests/browser/target_size.browser.test.ts)
- docs(frontend): record P15b a11y audit + opt-in axe/keyboard tooling in progress.md + state.md ledger
  (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)
(Use the ACTUAL file names you create/touch; the names above are illustrative. Some commits may be empty if a window-group needed no fix; do not invent edits to fill a commit.)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
[ ] npx tsc --noEmit passes.
[ ] biome check clean on every new/changed .ts (the browser test files + any helper a fix extracts).
[ ] axe-core (or equivalent) runs over EVERY built window in the OPT-IN browser suite and reports ZERO serious/critical violations (npm run test:browser), against a seeded/populated world.
[ ] The audit world is driven in BOTH a Sim-shaped and a ClientWorld-mirror-shaped mode (decision 15): every window passes axe + keyboard-nav under both world shapes, so an offline-only-shape window (async leaderboard/market, target cast remaining, combo pips, party out-of-range) is caught.
[ ] A keyboard-navigation E2E proves the P15a trap holds (Tab/Shift+Tab cycles inside the open window, focus does not escape), Esc closes, and focus RETURNS to the opener.
[ ] :focus-visible is present on every interactive element and is NEVER animated/blurred/transitioned/filtered away: a guard asserts no transition/animation/filter/blur on a :focus-visible selector in the extracted CSS.
[ ] Target-size: every control is >=24px CSS or has adequate spacing (SC 2.5.8); EVERY mobile touch control (action-bar buttons, joystick, mobile chrome) is >=40x40px under a mobile viewport (the mobile-viewport pass), measured from rendered geometry; the V16 mobile_button_size / mobile_joystick_size floors are not weakened.
[ ] The forced-colors: active snapshot passes and the minimal @media print reset is present (P15a infra, re-asserted by the audit).
[ ] The two canvas windows (map, arena) + the canvas controls (minimap, nameplate, FCT) carry an honest "canvas not screen-readable, label + summary only" boundary: the host has an accessible name + summary, the pixels have no fake per-marker aria.
[ ] The async leaderboard (P9b) loading state carries aria-busy / role=status + focus-return across the async swap.
[ ] The P12a action-bar aria-label still routes through t() (no concat / `??` fallback / default param): not regressed.
[ ] PRESENTATION-ONLY held: no IWorld/sim/server/net change.
[ ] The opt-in browser suite does NOT leak into the default run: a bare `vitest run` launches no browser.
[ ] css_corpus (if a section changed), client_shell, architecture, localization_fixes, the V16 mobile E2E row, full npm test, and npm run build (4 entries) all green.
[ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P15b done; list the per-window-group fixes applied (and which groups needed none), the new browser test files (a11y axe, keyboard-nav, target-size), the mobile >=40x40 pass result, the :focus-visible guard, and that the audit runs under both Sim and ClientWorld.
- state.md: update the ledger row P15b -> done; note that the axe + keyboard suite is OPT-IN (npm run test:browser, bare vitest run stays Node-only), cross-engine CI turn-on deferred to P17b; record the 24-vs-40 target-size resolution (24px absolute, 40x40 mobile-preferred) and the audit-world parity approach (both Sim and ClientWorld); record any per-window fix that changed a landed painter.
- Memory: record surprising rules (the canvas-out-of-scope label+summary boundary wording, the no-animated-focus guard mechanism, the seeded-world-reachable-in-both approach, the 24-vs-40 floor split, and that bare vitest run must stay browser-free).

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, axe per-window under both world shapes, the keyboard-nav E2E, the :focus-visible guard, the forced-colors snapshot, the mobile >=40x40 target-size pass, css_corpus/client_shell/architecture/localization tests, the V16 mobile E2E row, full npm test, build, and the bare-vitest-no-browser confirmation), the qa-checklist verdict, any deferrals (cross-engine WebKit-in-CI turn-on -> P17b; the CLAUDE.md a11y contract -> P16), and end with exactly:
Next: phase-16-standards-codification.md

STOPPING RULES (phase-specific):
- STOP and surface a scope change if any fix needs to EXTEND IWorld or touch src/sim / server / src/net / headless (presentation-only is a hard line).
- STOP if the only way to pass axe on a window is faking aria over the 3D canvas (or per-marker over map/arena/minimap/nameplate/FCT): the canvas is OUT of scope by decision; give the host a label + honest summary, do not invent screen-reader text for the game world.
- STOP if a :focus-visible ring is animated/blurred/transitioned/filtered away anywhere (the FB lesson): fix it before committing; the focus ring must be steady and visible.
- STOP if a mobile touch control measures below 40x40px (or a fix weakens the existing V16 mobile_button_size / mobile_joystick_size floor): raise it before shipping; 40x40 is the mobile floor, 24px is only the desktop absolute floor.
- STOP if a window passes axe under Sim but fails (or cannot be reached) under the ClientWorld mirror: that is the offline-only-shape bug decision 15 targets; fix the assumption, do not gate the audit on Sim alone.
- STOP if wiring axe + Playwright makes a bare `vitest run` launch a browser: the suite is opt-in (npm run test:browser) only; cross-engine CI turn-on is P17b.
- STOP if an audit fix would regress the P12a action-bar aria-label off t() (a concat / `??` fallback / default param): keep the t() call.
```

## Notes for the planner

P15b is the second half of the old P15 split: the chrome-wide AUDIT-and-FIX plus the axe + keyboard
tooling, kept separate from P15a's infra so neither half plus its mandatory QA exceeds the 40% ceiling.
It runs ON the infra P15a shipped (the shared focus manager, skip links, live regions, forced-colors,
print) and audits the full window/control inventory P7-P14 produced, fixing only the GAPS rather than
rebuilding green per-window work. The deep-review fixes concentrated here: the mobile-viewport
target-size pass that asserts >=40x40px on touch controls (not merely the >=24px desktop floor) with
the 40-vs-24 tension resolved explicitly (24px absolute, 40x40 mobile-preferred, the V16
mobile_button_size / mobile_joystick_size floors never weakened); the ClientWorld-vs-Sim audit parity
(the audit world is driven under both world shapes, so an offline-only-shape window like the async
leaderboard or target-cast-remaining is caught, not silently shipped broken online); the
:focus-visible-never-animated guard (the carried FB lesson, an explicit assert over the extracted CSS);
and the canvas-out-of-scope honesty (map/arena/minimap/nameplate/FCT hosts get a label + honest summary,
the pixels get no fake per-marker aria). The axe + Playwright tooling lands in the OPT-IN browser suite
(vitest.browser.config.ts + npm run test:browser, the FB Vitest-4-Browser-Mode pattern) so a bare
vitest run never launches a browser; cross-engine WebKit-in-CI turn-on of the whole suite is explicitly
P17b. Everything is presentation-only (no IWorld/sim/server touch) and any new label is hud_chrome
English-only, so the review surface is qa-checklist alone, and the P12a action-bar aria-label-on-t()
must not regress. The next file is phase-16-standards-codification.md.
