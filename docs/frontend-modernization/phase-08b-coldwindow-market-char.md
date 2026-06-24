# Phase P8b: Cold-window extraction: market + char

Extract the two remaining old-P8 cold windows, `renderMarket` (`hud.ts:8343`, async) and `renderChar`
(`hud.ts:9116`), out of the `hud.ts` monolith into pure `*_view.ts` cores plus thin painters composed
through the P6 PainterHost, presentation-only, consuming V16's already-landed `IWorld`. The market core
reuses the already-extracted `market_filters` helper and must cover the async loading/empty/error
states; the char core is scoped to the PAPERDOLL data only, with the Three.js model preview and the
skin-event `Math.random` (`hud.ts:9596`) staying on the painter.

## Starter Prompt

```
This is Phase P8b of the Frontend Modernization v0.16.0 packet: Cold-window extraction: market + char.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is a batch of two independent cold windows (market, char) with distinct hazards (market is async with loading/empty/error states; char carries a Three.js preview and a skin-event Math.random); fan out one subagent per window with a parallel Workflow + adversarial verify, exactly as the canonical workflow prescribes for the cold-window batches.

Goal: Move the market and char inline windows out of the hud.ts monolith into the repo's Humble-Object cold-window seam. For each of renderMarket (hud.ts:8343) and renderChar (hud.ts:9116), add a pure src/ui/<name>_view.ts core (DOM/Three-free, registered in the UI-purity allowlist) that derives the window's view-model from IWorld, plus a thin painter that composes through the P6 PainterHost (icon/money/tooltip dep-bag + the elided writers) and renders. This is PRESENTATION-ONLY: consume V16's already-extended IWorld; do not extend IWorld or touch src/sim, server, src/net, or headless. These are cold (open-on-demand) windows, NOT per-frame; no frame-budget perf gate applies, but they must NOT be wired into Hud.update().

STEP 0 - PRE-FLIGHT:
- git status must be clean. This is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in the feature/frontend-modernization-v016 worktree (git branch --show-current).
- Memory scan: read MEMORY.md and the Frontend Phase 7 HUD window extraction entry (the FB cold-window cores+painters behind the PainterHost seam, the purity-guard hardening, the purity-perturbation-must-inject-real-code lesson) and the Frontend Phase 6 window-encapsulation entry (the #id-prefix isolation the windows rely on). These are the closest prior art for this seam.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
- Spawn ONE Explore agent to read and summarize: state.md (locked decisions, esp. 4 presentation-only, 9 component contract, 10 WCAG 2.2 AA built in per window, 12 no-magic-values, 15 ClientWorld-vs-Sim parity, and the non-negotiable note that the char skin-event Math.random at hud.ts:9596 stays on the painter or out of the core scope; the canonical workflow; the validation matrix incl the MANDATORY WINDOW-or-CONTROL row; the review dispatch matrix; the V16 Key file paths); this phase file; the "### P7-P9 Cold-window extraction" section of v016-recon-and-packet.md plus the "Load-bearing structural findings" and "Reuse from FB" sections; and ONLY these source ranges from hud.ts: renderMarket 8343 read to its close (the async data load, the loading/empty/error states, the buy/list/cancel actions, the filter wiring) and renderChar 9116 read to its close (the paperdoll equipment slots, the stat panel, the Three.js model preview, and the skin-event Math.random at 9596). Also have it locate and summarize the already-extracted market_filters helper, the P6 PainterHost surface (src/ui/painter_host.ts, both facets), and one existing reference pair (vendor_view.ts + vendor_window.ts) as the template.
- The orchestrator keeps the summary, not raw dumps. THE 40% RULE: two windows is within budget INCLUDING the mandatory WCAG + no-magic-values + parity rows plus in-session remediation; but renderChar carries a Three.js preview block that the core does NOT absorb (it stays a painter concern), so summarize the preview separately and do not let its size pull the orchestrator toward the ceiling.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: two slices, fan out one subagent per window (request fan-out EXPLICITLY). Each slice produces a pure core + a thin painter + a core test, following the vendor_view/vendor_window template and composing through PainterHost.
- Slice A (market, async): extract renderMarket (hud.ts:8343) -> src/ui/market_view.ts (pure: derive the listing/filter view-model from IWorld and the loaded market data) + src/ui/market_window.ts painter. REUSE the already-extracted market_filters helper for filtering; do NOT re-derive filter logic in the new core. The core must MODEL the async states explicitly: a loading state (data in flight), an empty state (no listings match), and an error state (load failure), each as a distinct view-model variant the painter renders; the painter owns the actual async fetch and feeds the core the resolved/loading/error input. Preserve buy/list/cancel actions and money formatting (route money/icon through PainterHost helpers; any new async-failure copy resolves via t() in the PAINTER, English-only in hud_chrome.ts).
- Slice B (char, paperdoll only): extract renderChar (hud.ts:9116) -> src/ui/char_view.ts (pure: the PAPERDOLL data model ONLY, equipment slot/stat view-model derived from IWorld) + src/ui/char_window.ts painter. SCOPE THE CORE TO THE PAPERDOLL DATA: the Three.js model preview stays a painter concern (the core emits no Three types and does not build the preview), and the skin-event Math.random at hud.ts:9596 stays on the PAINTER (like the FCT painter) or out of the core scope entirely; the core stays deterministic and pure. Preserve the paperdoll (every equipment slot, the stat panel, slot tooltips routed through PainterHost's tooltip helper) and the model/skin preview behavior on the painter side.
- Register each new *_view.ts core in the UI-purity allowlist (UI_PURE_CORES in tests/architecture.test.ts). Update tests/client_shell.test.ts for any DOM ids that moved from hud.ts into a painter.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, or headless. If a slice needs IWorld extended, STOP and surface it (scope change).
- PainterHost is a THIN compose-in host (decision 8, two facets): the painters consume the presentation dep-bag (icon/money/tooltip) and the write-elision facet. Do not invent a new seam. The setProperty/classList elided extension is P10a; a documented raw write in these cold painters is acceptable pre-P10a (cold windows are not on the per-frame skip-rate gate).
- DETERMINISM / PURITY (decision 9 + the non-negotiable constraint): each *_view.ts core is DOM/Three-free with NO Math.random / Date.now / performance.now. The char skin-event Math.random (hud.ts:9596) MUST stay on the painter (like FCT) or be out of char_view's scope; char_view derives only the deterministic paperdoll data model. The Three.js preview emits no Three types into the core. The purity guard (tests/architecture.test.ts) enforces this; register each core.
- COMPONENT CONTRACT (decision 9): each core is instance-parameterized (no hardcoded single-instance element ids in the core; the painter owns the ids).
- i18n: every NEW player-visible label is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only); never concat, never a ?? 'English' fallback, never edit i18n.locales/<lang>.ts. The market async-failure copy resolves via t() in the painter.
- No generated-file hand-edits; regenerate via the build.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits, docs).

Out of scope (do NOT do in this phase):
- options: that is P8a. Do not touch renderOptions.
- The other cold windows: talents/social/bags are P7a/P7b; map/arena/questlog/leaderboard/spellbook are P9a/P9b (P9b owns the one leaderboard() Promise<LeaderboardPage> painter fix). Do not touch them.
- Any per-frame element (player/target frames, bars, action bar, auras, minimap, FCT, party): P10-P14. Do not wire market or char into Hud.update().
- Per-element graphics tiering (P14a) and the ui_effects_profile resolver/applier (P5). Do not add tier knobs here.
- The PainterHost elided-writer extension (setStyleProp/toggleClass): that is P10a.
- Pulling the Three.js model preview into the core, or moving the skin-event Math.random off the painter into the core: explicitly forbidden (the core stays pure/deterministic).
- Any CSS move (P1-P4b); this phase touches TS only. The window CSS already lives in the extracted stylesheets from the CSS phases.

STEP 3 - VALIDATION + REVIEW (validation-matrix rows that match a pure-core + UI + WINDOW change; no frame-budget perf gate, these are cold windows):
- npx tsc --noEmit (baseline, every phase).
- biome check on the new/changed .ts (src/ui/market_view.ts, src/ui/market_window.ts, src/ui/char_view.ts, src/ui/char_window.ts).
- Pure core added: npx vitest run tests/market_view.test.ts tests/char_view.test.ts + npx vitest run tests/architecture.test.ts (the UI-purity guard must pass with the two new cores in the allowlist, and must still FAIL on an injected forbidden import) + a same-input-same-output assertion per core. Add an explicit assertion that char_view contains NO Math.random / Date.now / performance.now and emits no Three types (the purity guard covers RNG; assert the Three-free shape too).
- CLIENTWORLD-vs-SIM PARITY (decision 15, MANDATORY): drive EACH core with BOTH a Sim-shaped IWorld stub and a ClientWorld-mirror-shaped IWorld stub. Market: the listing/inventory/money slice (an offline Sim shape vs a mirrored snapshot must yield the same listing view-model and the same buy/list affordances). Char: the equipment/stat slice (the paperdoll view-model is identical from both stubs). Assert identical view-models so an offline-only field shape does not silently misrender online.
- MARKET ASYNC STATE COVERAGE (MANDATORY): a test per async state: loading (data in flight -> loading view-model), empty (no matching listings -> empty view-model), error (load failure -> error view-model with the t()-resolved failure copy on the painter). Assert filtering goes through market_filters (no duplicated filter logic) and that buy/list/cancel + money formatting are preserved.
- WCAG 2.2 AA WINDOW ROW (decision 10, MANDATORY, per window): run axe-core (or equivalent) over the BUILT market window AND the built char window. Assert: every control/list item has a programmatic label/role; the market listing table/list is navigable and the filter controls are labeled; the char equipment slots are labeled controls with accessible names and the stat panel is readable; keyboard reachability with focus-return to the opener on close; visible :focus-visible never animated/blurred/transitioned away; a forced-colors: active snapshot where borders/focus survive and meaning is never carried by background alone; target-size >= 24px on every control (and >= 40x40 on any mobile touch control). The 3D model preview canvas is OUT of a11y scope (not screen-readable); state that boundary honestly. Window/control a11y is NOT deferred to P15.
- NO-MAGIC-VALUES GUARD (decision 12, MANDATORY): market_window and char_window are DOM painters, so they drive tokens/CSS custom properties, never a literal hex/px/color in TS; any threshold or cadence is a named constant. Run the no-magic-values guard over both painters. The char 3D preview painter resolves any color it needs from tokens (not inline literals) the same as the DOM side.
- UI change: npx vitest run tests/client_shell.test.ts (greps hud.ts for DOM ids; update where ids moved into painters) + npm run build (all 4 entries resolve).
- Player text changed (the new market async-failure copy): npx vitest run tests/localization_fixes.test.ts; the new hud_chrome.ts label is English-only and does not trip the release tier.
- Review dispatch (spawn ONLY matching rows): qa-checklist (default reviewer for a completed deliverable set). Do NOT spawn cross-platform-sync (IWorld unchanged; consuming it in a painter does not change it), privacy-security-review (no server/net/admin/secret/RNG; the market buy/list/cancel actions are unchanged and server-side), or migration-safety (no DDL). Prompt the reviewer for COVERAGE not filtering; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE: 2-5 Conventional Commits with a scope and EXPLICIT paths. Suggested:
- refactor(ui): extract market window to market_view core + painter
  paths: src/ui/market_view.ts src/ui/market_window.ts src/ui/hud.ts tests/market_view.test.ts tests/architecture.test.ts
- refactor(ui): extract char paperdoll window to char_view core + painter
  paths: src/ui/char_view.ts src/ui/char_window.ts src/ui/hud.ts tests/char_view.test.ts tests/architecture.test.ts
- test(ui): update client_shell ids for the moved market and char windows
  paths: tests/client_shell.test.ts
- docs(frontend): record P8b market + char cold-window extraction in progress + state ledger
  paths: docs/frontend-modernization/progress.md docs/frontend-modernization/state.md

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] renderMarket and renderChar each delegate to a new *_view.ts pure core + a painter composed through PainterHost; the inline window bodies are gone from hud.ts.
- [ ] src/ui/market_view.ts and src/ui/char_view.ts are DOM/Three-free, registered in UI_PURE_CORES, and pass the purity guard; the guard still FAILS on an injected forbidden import.
- [ ] char_view is scoped to the PAPERDOLL data only: it contains NO Math.random / Date.now / performance.now and emits no Three types; the Three.js model preview stays on the painter and the skin-event Math.random (hud.ts:9596) stays on the painter.
- [ ] Each core has a same-input-same-output (deterministic) assertion AND the ClientWorld-vs-Sim parity assertion (driven by BOTH stub shapes) green.
- [ ] Market async states covered: loading / empty / error each render their documented view-model; filtering reuses market_filters (no duplicated filter logic); buy/list/cancel + money formatting preserved via PainterHost helpers; the async-failure copy is a t() key in the painter (English-only).
- [ ] Char: the paperdoll renders every equipment slot + the stat panel from the view-model; slot tooltips route through PainterHost's tooltip helper; the model/skin preview behavior is preserved on the painter.
- [ ] WCAG 2.2 AA window row green for BOTH windows: axe-core clean; keyboard reachable with focus-return on close; :focus-visible visible and never animated away; forced-colors snapshot recorded; target-size >= 24px (>= 40x40 on any mobile touch control); the 3D preview canvas out-of-scope boundary stated.
- [ ] No-magic-values guard green over market_window and char_window (tokens/vars driven, named constants for any threshold/cadence).
- [ ] IWorld is NOT extended; no edits under src/sim, server, src/net, headless.
- [ ] npx tsc --noEmit clean; biome check clean on the new .ts; npm test green incl architecture + client_shell + localization_fixes; npm run build green on all 4 entries.
- [ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P8b row -> done, list market_view/market_window/char_view/char_window + tokens) and state.md (mark P8b done in the ledger; add market_view + char_view to the "Existing pure cores to REUSE" list; note any new hud_chrome label keys incl the market async-failure copy).
- Record surprising rules in memory: how the char skin-event Math.random was kept off the core (painter-side or out-of-scope), how the Three.js preview stayed a painter concern without leaking Three types into the core, any market_filters edge the core had to respect, any market async-state shape the core had to model, and any DOM id the client_shell grep flagged.

STEP 7 - FINAL RESPONSE: status, the files changed (absolute paths), validation results (tsc / biome / test / purity guard / parity / market async states / WCAG axe / no-magic-values / build / localization_fixes), the qa-checklist reviewer verdict, any deferrals, and end with exactly: Next: phase-09a-coldwindow-canvas-map-arena.md

STOPPING RULES:
- STOP and surface as a scope change if either window cannot be extracted without extending IWorld or touching src/sim / server / src/net / headless.
- STOP if market filtering cannot reuse the existing market_filters helper without re-deriving it (surface why before duplicating).
- STOP if char_view cannot be made pure without absorbing the Three.js preview or the skin-event Math.random (that means the paperdoll data did not separate cleanly from the preview; surface it, do not put RNG/Three in the core).
- STOP if a control's behavior cannot be preserved through a pure core + PainterHost painter without changing what action it dispatches (do not silently alter dispatch).
- STOP if the purity guard cannot be made to pass with a core registered (means the core still has a DOM/Three/RNG dependency that must be lifted out first).
- STOP if renderChar's Three.js preview block is large enough that loading it pushes the orchestrator toward the ~40% ceiling; summarize the preview separately, extract char in its own commit, re-summarize, then continue.
```

## Notes for the planner

This is the second half of the old P8 split: the two windows (market, char) that are not the
1180-line options behemoth but each carry a distinct hazard the deep review flagged. Market is async,
so its core must MODEL the loading / empty / error states as explicit view-model variants (the painter
owns the fetch and the t()-resolved failure copy), and filtering must reuse the already-extracted
`market_filters` helper rather than re-derive it. Char is the sharper purity hazard: `renderChar` mixes
deterministic paperdoll data with a Three.js model preview and a skin-event `Math.random` at
`hud.ts:9596`, so the core is scoped to the PAPERDOLL DATA ONLY, the 3D preview stays a painter
concern (no Three types leak into the core), and the `Math.random` stays on the painter exactly like
the FCT painter precedent, keeping `char_view` deterministic and registrable in the purity allowlist.
Both halves now carry the three rows the old P8 omitted: the WCAG 2.2 AA window row (with the honest
"3D preview canvas is out of a11y scope" boundary), the no-magic-values painter guard, and the
ClientWorld-vs-Sim parity assertion driven by both stub shapes. With P8a (options) and P8b done, the
PainterHost seam is proven across the full variety of cold windows (dense control surface, async
window, Three-entangled window), de-risking P9a/P9b (the canvas pair and the async leaderboard).
