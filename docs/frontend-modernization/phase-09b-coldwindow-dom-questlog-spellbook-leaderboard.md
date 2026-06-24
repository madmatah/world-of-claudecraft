# Phase P9b: Cold-window DOM trio: questlog + spellbook + leaderboard

Extract the last three inline DOM windows (questlog, spellbook, leaderboard) into pure `*_view.ts`
cores plus thin painters composed through the P6 PainterHost. This phase closes the entire
cold-window seam and lands the single IWorld-painter touch of the packet: `renderLeaderboard`
consumes V16's already-landed paged `leaderboard(): Promise<LeaderboardPage>` (consumed, never
changed).

## Starter Prompt

```
This is Phase P9b of the Frontend Modernization v0.16.0 packet: Cold-window DOM trio (questlog + spellbook + leaderboard).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. Three independent DOM windows including an async state machine (leaderboard) with multiple failure states; fan out parallel subagents + adversarial verify, the proven cold-window cadence (P7/P8/P9a), then integrate sequentially with tsc between splices.

Goal: move the last three inline classic DOM windows out of hud.ts into the Humble-Object shape this packet uses everywhere: a presentation-only `src/ui/<window>_view.ts` pure core (registered in the UI-purity allowlist) that maps IWorld state to a render model, plus a thin painter composed through the P6 PainterHost. This phase carries the single IWorld-painter touch of the packet: renderLeaderboard (hud.ts:10673, async) consumes V16's already-landed paged leaderboard(): Promise<LeaderboardPage>. Preserve every behavior exactly: questlog rows + tracker linkage (no duplicate listeners), spellbook grid + icon resolution via the PainterHost, leaderboard async paging with all of its loading/empty/error/clamp/promise-rejection states. Closing this trio completes the entire cold-window seam (P6-P9b). Presentation-only: do NOT extend IWorld or touch src/sim, server, src/net, or headless.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the FB precedents that ported the cold-window cores: [[frontend-phase7-hud-window-extraction]] (the canonical pure-core + painter + PainterHost seam; the forbiddenUiCoreImport guard; the sed-clips-interleaved-keeps + run-FULL-suite-for-source-guards lessons; the purity-perturbation-must-inject-real-code note), and [[pr785-quest-tracker-review-fixes]] for the quest-tracker kbd-a11y precedent (window keybinds hijacking Enter/Space on focused buttons). Note the FB lesson: equipItem EXISTS in IWorld but is unused (equip via useItem) - do not wire dead members.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn one Explore agent to read + summarize, returning a compact summary the orchestrator keeps (not raw dumps):
- docs/frontend-modernization/state.md (cite by section: locked decisions 4 (presentation-only, the leaderboard() is THE one consumed-new signature), 9 (component contract), 10 (WCAG 2.2 AA chrome + drop user-scalable=no is P4/P15, here it is per-window roles/aria/focus), 12 (no-magic-values, DOM painters drive tokens/vars), 15 (ClientWorld-vs-Sim parity), 17 (persistent-monolith owned); the validation matrix WINDOW row; the Review Dispatch Matrix; the Key file paths block, esp. renderLeaderboard 10673 async, renderSpellbook 10766, renderQuestLog 11398; the "New i18n keys" note that async-failure copy for leaderboard is English-only hud_chrome.ts).
- docs/frontend-modernization/progress.md (the P9b row + the P6/P7/P8/P9a rows for the established seam shape).
- This phase file in full.
- The "### P7-P9 Cold-window extraction" section of docs/frontend-modernization/v016-recon-and-packet.md, plus "Load-bearing structural findings", "Reuse from FB", and "Top risks".
- The SPECIFIC V16 source ranges this phase touches, read narrowly by line range only:
  - hud.ts renderQuestLog (11398) - DOM window; trace its row listeners and the quest_tracker linkage (quest_tracker is already a pure core in src/ui; reuse it, do not re-derive).
  - hud.ts renderSpellbook (10766) - DOM window; trace its grid layout and icon resolution.
  - hud.ts renderLeaderboard (10673, ASYNC) - trace the full async flow: the leaderboard() Promise call, page controls, the in-flight/loading state, empty state, error/rejection handling, and any page clamp on out-of-range page index.
  - The P6-landed src/ui/painter_host.ts surface (the presentation dep-bag: icon/money/tooltip; the icon helper is what spellbook reuses).
  - One already-extracted reference: src/ui/vendor_view.ts + vendor_window.ts (the Humble-Object template) and any P7/P8/P9a *_view.ts already landed in src/ui.
  - The IWorld leaderboard(): Promise<LeaderboardPage> signature and the LeaderboardPage type in src/world_api.ts (read the type only; do NOT change it).
  - tests/architecture.test.ts UI_PURE_CORES allowlist + forbiddenUiCoreImport guard, and tests/client_shell.test.ts where it greps hud.ts for window DOM ids (questlog/spellbook/leaderboard element ids).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Ultracode Workflow, three parallel slices (one window each). Each slice produces a pure core + a thin painter + a core test, then the orchestrator integrates sequentially (one window at a time) and runs tsc between integrations (the FB lesson: sed clips interleaved, keeps; verify each splice with tsc). Slices:
  1. QUESTLOG window (renderQuestLog, hud.ts:11398): extract src/ui/questlog_view.ts (the row model: quest rows, completion/turn-in state, the quest_tracker linkage - REUSE the existing quest_tracker pure core, do not re-derive tracker rows) + thin painter. Preserve row listeners exactly: bind ONCE, do NOT duplicate on re-open (the FB row-listener-churn trap); the painter owns listener lifecycle. Mind the quest-tracker kbd-a11y precedent: window-level keybinds must not hijack Enter/Space on a focused row button.
  2. SPELLBOOK window (renderSpellbook, hud.ts:10766): extract src/ui/spellbook_view.ts (the spell/ability grid model from IWorld: known abilities, ranks, layout order) + thin painter resolving icons via the PainterHost icon helper. Preserve grid layout and icon resolution.
  3. LEADERBOARD window (renderLeaderboard, hud.ts:10673, ASYNC): extract src/ui/leaderboard_view.ts mapping a resolved LeaderboardPage (and the loading/empty/error/clamp DISCRIMINATORS) to a pure render model + a thin painter that calls IWorld leaderboard(), awaits the promise, and renders the page. THIS slice carries the one IWorld-consume touch of the packet: consume the paged leaderboard(): Promise<LeaderboardPage> exactly as V16 already exposes it (consume, never change). The core is async-free: it maps an already-resolved page (or an explicit loading/empty/error state value) to the render model; the painter owns the Promise, the await, the page-control wiring, and the failure handling.
Register every new *_view.ts core in the tests/architecture.test.ts UI_PURE_CORES allowlist. Each painter composes through the P6 PainterHost presentation dep-bag; do NOT invent a new seam. Update tests/client_shell.test.ts and the client_shell DOM ids for the moved window ids.

NO-MAGIC-VALUES (locked decision 12, DOM painters): these painters drive CSS custom properties / tokens, never an inline hex/px/color literal in TS; any threshold (e.g. the leaderboard page size, the clamp bounds) is a NAMED CONSTANT. The cores carry zero presentation literals.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (locked decision 4): consume V16's already-extended IWorld; the ONLY changed signature consumed in the WHOLE packet is leaderboard(): Promise<LeaderboardPage>, consumed here, never changed. Do NOT extend IWorld or touch src/sim, server, src/net, or headless. If a slice finds it needs to, STOP and surface it (scope change).
- Determinism / purity: every *_view.ts core is DOM/Three-free with NO Math.random / Date.now / performance.now. The leaderboard core is ASYNC-FREE (it maps a resolved page or an explicit state discriminator; the painter owns the Promise). The architecture purity guard (forbiddenUiCoreImport / UI_PURE_CORES) enforces this - the core must not import three, a *_painter, painter_host, or DOM globals.
- PainterHost is a THIN compose-in host: the new painters CONSUME the P6 presentation dep-bag (icon/money/tooltip), they do not reshape it.
- i18n: any new player-visible label (the leaderboard loading/empty/error copy) is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. The i18n-free core emits a discriminator (loading/empty/error); the painter resolves it via t() (no concat, no ?? fallback). Keep the existing t() calls these windows already use.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The canvas pair (map + arena) - that was P9a, the immediately preceding phase. The cold-window seam is COMPLETE after this phase.
- Per-frame / hot-path extraction (xp bar, swing timer, player/target frames, cast bars, party frames, action bar, auras, minimap markers, FCT) - P10-P13. These three windows are COLD (paint-on-open); do not touch hud.update()'s per-frame path.
- Per-element graphics tiering / fxLevel knobs - P14.
- Any IWorld EXTENSION, sim/server/net change, or new wire field. The leaderboard paging member already exists; consume it, do not modify it.
- CSS extraction for these windows (landed P3). Do not move CSS here.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- Pure core added (all 3): `npx vitest run tests/questlog_view.test.ts`, `npx vitest run tests/spellbook_view.test.ts`, `npx vitest run tests/leaderboard_view.test.ts` + `npx vitest run tests/architecture.test.ts` (the UI-purity guard) + a same-input-same-output assertion per core.
- ClientWorld-vs-Sim PARITY (locked decision 15, MANDATORY): each *_view core test feeds the core BOTH a Sim-shaped IWorld stub AND a ClientWorld-mirror-shaped IWorld stub and asserts the same render model. The leaderboard core is the high-risk one (async/paged is the classic online-only-shape that passes offline and misrenders online): feed BOTH stubs across every leaderboard state.
- LEADERBOARD per-state tests (MANDATORY, the async state machine): loading/in-flight, populated page, empty page, error/rejected promise, OFFLINE (leaderboard() unavailable or rejecting offline), and page-index CLAMP (request beyond the last page -> clamped, not a crash or blank). Assert the core maps each state to its discriminator and the painter renders each (loading -> aria-busy/role=status, error -> a t()-resolved message, clamp -> last valid page). Drive the rejection/offline path explicitly (a stub whose leaderboard() rejects).
- QUESTLOG / SPELLBOOK per-state tests: questlog - empty log, active quests, completed/turn-in-ready rows, tracker linkage round-trips (a tracked quest shows tracked); listeners bound ONCE (re-open does not double-bind). Spellbook - empty (no abilities), populated grid, icon resolution via the host helper.
- WCAG 2.2 AA chrome row (locked decision 10, MANDATORY, per-window, NOT deferred to P15): axe-core (or equivalent) over each built window; keyboard reachability of rows/grid cells/page controls + focus-return on window close; visible :focus-visible never animated/blurred away; a forced-colors: active snapshot (borders/focus survive, meaning never carried by background alone); target-size >=24px on controls (>=40x40 mobile); the leaderboard loading state carries aria-busy + role=status (the lazy-load a11y contract precedent, decision 13); the quest-row kbd-a11y guard (Enter/Space on a focused row not hijacked by window keybinds).
- No-magic-values painter guard (locked decision 12): DOM painters reference tokens/CSS vars + named constants only; no inline hex/px in TS.
- biome check on the new/changed .ts (questlog_view.ts, spellbook_view.ts, leaderboard_view.ts, the three painters, the hud.ts splice).
- DOM ids moved: `npx vitest run tests/client_shell.test.ts` (it greps hud.ts for the questlog/spellbook/leaderboard window DOM ids now living in painters; update its expectations for the moved ids).
- Player text changed (new leaderboard async-failure copy): `npx vitest run tests/localization_fixes.test.ts`. The new English-only hud_chrome.ts labels do not trip the release tier.
- Whole-suite + build: `npm test` and `npm run build` (all 4 entries) green. Run the FULL suite at the end (FB lesson: source guards need the full suite to catch a perturbation; a // comment is stripped by stripComments so any guard-perturbation proof must inject a REAL code line).
This is presentation-only and CONSUMES an already-landed IWorld member (does not change a signature), so per the Review Dispatch Matrix NO cross-platform-sync / privacy-security / migration row fires (consuming the landed leaderboard() does not change IWorld). Review dispatch: qa-checklist only (the default). Prompt it for COVERAGE not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with the state.md resume line.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths (never git add -A). Suggested split:
- `feat(ui): extract questlog and spellbook windows to view cores + painters` (src/ui/questlog_view.ts, src/ui/spellbook_view.ts, the two painters, hud.ts splice, tests/questlog_view.test.ts, tests/spellbook_view.test.ts).
- `feat(ui): extract leaderboard window consuming paged leaderboard()` (src/ui/leaderboard_view.ts, the leaderboard painter, hud.ts splice, tests/leaderboard_view.test.ts, the new hud_chrome.ts async-failure labels).
- `test(ui): register batch-3b cores in UI-purity allowlist; update client_shell ids` (tests/architecture.test.ts, tests/client_shell.test.ts).
- `docs(frontend): mark P9b complete + cold-window seam closed in progress.md + state.md ledger`.

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] questlog_view.ts, spellbook_view.ts, leaderboard_view.ts are pure cores (DOM/Three-free; leaderboard core async-free), registered in UI_PURE_CORES, and pass the architecture purity guard.
- [ ] Questlog preserves row listeners (bound ONCE, no double-bind on re-open) and the quest_tracker linkage (reuses the existing pure core).
- [ ] Spellbook preserves the grid layout and resolves icons via the PainterHost icon helper.
- [ ] Leaderboard consumes IWorld leaderboard(): Promise<LeaderboardPage> exactly (the ONE consumed-new signature of the packet; consumed, never changed), with the core async-free and the painter owning the Promise + page controls.
- [ ] Leaderboard per-state tests pass: loading, populated, empty, error/rejection, offline, and page-clamp.
- [ ] Each core test feeds BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub and asserts identical render models (decision 15), leaderboard across all states.
- [ ] WCAG 2.2 AA chrome row green per window: axe clean, keyboard-reachable rows/grid/page-controls + focus-return, visible :focus-visible, forced-colors snapshot, target-size >=24px (>=40x40 mobile), leaderboard loading state has aria-busy + role=status, quest-row Enter/Space not hijacked.
- [ ] No-magic-values guard green: DOM painters drive tokens/vars + named constants; no inline hex/px in TS.
- [ ] biome check clean on the new/changed .ts.
- [ ] localization_fixes green; new leaderboard copy is English-only hud_chrome.ts and resolves via t() (no concat / ?? fallback).
- [ ] tsc, all three core tests, architecture guard, client_shell, full npm test, and build (all 4 entries) green.
- [ ] qa-checklist reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
Update progress.md (mark P9b done, list the 3 new DOM cores + painters, note the COLD-WINDOW SEAM IS NOW COMPLETE: P6 pilot through P9b, no inline cold windows remain) and the state.md phase ledger (P9b -> done; note leaderboard() is the only IWorld member consumed-new in the whole packet, consumed not changed). Record any surprising rule in memory (e.g. a leaderboard rejection/clamp edge, a quest-row listener double-bind trap, or a client_shell id grep that needed widening).

STEP 7 - FINAL RESPONSE: report status, the new files (absolute paths), validation results (tsc, three core tests + parity + per-state incl leaderboard loading/empty/error/clamp/rejection, architecture guard, WCAG row, no-magic-values guard, biome, client_shell, localization_fixes, full npm test, build all 4 entries), the qa-checklist verdict, the note that the cold-window seam is now complete, any deferrals, and end with exactly: "Next: phase-10a-perframe-leakfix-host-writers.md".

STOPPING RULES:
- STOP and surface a scope change if any slice finds it needs to EXTEND IWorld or touch src/sim / server / src/net / headless (presentation-only is a hard line; consuming leaderboard() is allowed, changing it is not).
- STOP if the leaderboard core cannot be made async-free (the Promise must stay in the painter; the core maps a resolved page or an explicit state discriminator) - surface it rather than putting a Promise or await in a registered pure core.
- STOP if the purity guard cannot be made to pass for a core without removing it from the allowlist - the allowlist is the contract, not a place to except a leaky core.
- STOP if extracting a window would change observable behavior (lost row listener, double-bound listener, broken async paging, dropped clamp/error state, broken tracker linkage) you cannot preserve in the painter; report it rather than shipping a regression.
```

## Notes for the planner

This is the DOM half of the old P9, split out because the async leaderboard is its own state machine
(loading / populated / empty / error / rejection / offline / page-clamp) and carries the single
IWorld-consume touch of the entire packet (the paged leaderboard(): Promise<LeaderboardPage>, consumed
never changed, locked decision 4). Keeping it with questlog and spellbook lets the ultracode fan-out
amortize the shared Humble-Object cadence while isolating the genuinely novel async surface in one slice
with its own per-state + parity coverage. ULTRACODE is yes: three independent windows plus a multi-state
async machine plus the mandatory WCAG + no-magic-values + ClientWorld-parity rows is a real fan-out load,
and it still fits under 40% because the canvas pair already left to P9a. The leaderboard is the textbook
decision-15 trap (async/paged is online-only shape that passes every offline gate and misrenders online),
so its parity test feeds both a Sim-shaped and a ClientWorld-mirror-shaped stub across every state,
including a stub whose leaderboard() rejects. The questlog carries the FB row-listener-churn trap and the
PR #785 quest-tracker kbd-a11y precedent (Enter/Space on a focused row not hijacked by window keybinds),
so listeners bind once and the keyboard path is in the WCAG row. Completing this trio closes the entire
cold-window seam (P6 pilot through P9b), so P10a onward faces only the hot per-frame layer with no inline
cold windows left to disturb.
