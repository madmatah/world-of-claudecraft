# Phase P8a: Cold-window extraction: options (about 1180 lines, 9 sub-panels)

Extract the single largest cold window, `renderOptions` (`hud.ts:12783`, about 1180 lines), out of
the `hud.ts` monolith into a pure `options_view.ts` core plus a thin painter composed through the P6
PainterHost, presentation-only, consuming V16's already-landed `IWorld`. This is the densest
control-dispatch surface in the packet: nine sub-panels behind a nine-member `OptionsHooks` dispatch,
so the deliverable is a per-surface preservation matrix, not one blanket dispatch test.

## Starter Prompt

```
This is Phase P8a of the Frontend Modernization v0.16.0 packet: Cold-window extraction: options (about 1180 lines, 9 sub-panels).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. renderOptions is about 1180 lines across nine sub-panels; fan out one subagent per sub-panel cluster (the four control primitives, then bug-report, graphics, audio, language, and the remaining toggles/keybinds) with a parallel Workflow + adversarial verify, exactly as the canonical workflow prescribes for the densest cold-window surface. The pure-core extraction and the painter must land as one coherent module pair even though the dispatch matrix is verified per sub-panel.

Goal: Move the inline options window out of the hud.ts monolith into the repo's Humble-Object cold-window seam. Add a pure src/ui/options_view.ts core (DOM/Three-free, registered in the UI-purity allowlist) that derives the options window's view-model from IWorld plus the settings source, plus a thin src/ui/options_window.ts painter that composes through the P6 PainterHost (icon/money/tooltip dep-bag + the elided writers) and renders. renderOptions at hud.ts:12783 contains nine sub-panels reachable through a nine-member OptionsHooks dispatch object: the four control primitives settingSlider / settingToggle / settingBoolToggle / settingChoice, plus renderBugReport, renderGraphics, renderAudio, the language picker (changeLanguage), and the remaining toggle/keybind rows. This is PRESENTATION-ONLY: consume V16's already-extended IWorld; do not extend IWorld or touch src/sim, server, src/net, or headless. These are cold (open-on-demand) windows, NOT per-frame; no frame-budget perf gate applies, but the window must NOT be wired into Hud.update().

STEP 0 - PRE-FLIGHT:
- git status must be clean. This is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in the feature/frontend-modernization-v016 worktree (git branch --show-current).
- Memory scan: read MEMORY.md and the Frontend Phase 7 HUD window extraction entry (the FB cold-window cores+painters behind the PainterHost seam, the purity-guard hardening, the purity-perturbation-must-inject-real-code lesson) and the Frontend Phase 6 window-encapsulation entry (the #id-prefix isolation the windows rely on, and the container-query inline-size contracts). These are the closest prior art for this seam. Also read the PR #730 ingame language switch and PR #899 / PR #901 mobile-tutorial entries (the changeLanguage / language-picker hardening and the touch-control vocabulary, both of which touch the options surface).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
- Spawn ONE Explore agent to read and summarize: state.md (locked decisions, esp. 4 presentation-only, 6/8 the tier resolver boundary that this phase must NOT cross, 9 the component contract, 10 WCAG 2.2 AA built in per window, 12 no-magic-values, 15 ClientWorld-vs-Sim parity; the non-negotiable constraints; the canonical workflow; the validation matrix incl the MANDATORY WINDOW-or-CONTROL row; the review dispatch matrix; the V16 Key file paths); this phase file; the "### P7-P9 Cold-window extraction" section of v016-recon-and-packet.md plus the "Load-bearing structural findings" and "Reuse from FB" sections; and ONLY this source range from hud.ts: renderOptions 12783 read to its close (about 1180 lines, the full nine-sub-panel body including the OptionsHooks dispatch object and the four control primitives). Also have it locate and summarize the P6 PainterHost surface (src/ui/painter_host.ts, BOTH facets: the presentation dep-bag and the write-elision facet) and one existing reference pair (vendor_view.ts + vendor_window.ts) as the template, plus the existing settings source (src/game/settings.ts) and the changeLanguage call path (per the PR #730 prior art).
- The orchestrator keeps the summary, not raw dumps. THE 40% RULE: this is the single largest cold window in the packet (about 1180 lines) and it is split out of the old P8 precisely so it fits under ~40% context INCLUDING the mandatory WCAG + no-magic-values + parity validation rows plus in-session remediation of every finding. If loading the full renderOptions body plus its nine-panel dispatch pushes the orchestrator toward the ceiling, summarize per sub-panel cluster and extract panel-by-panel in separate commits rather than degrade.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: one module pair, verified per sub-panel. Fan out one subagent per sub-panel cluster (request fan-out EXPLICITLY), all landing into the single options_view core + options_window painter:
- Cluster 1 (control primitives): factor the four reusable control builders settingSlider / settingToggle / settingBoolToggle / settingChoice into the pure core as view-model descriptors (id, kind, current value, range/choice set, the action discriminator) so the painter builds the DOM control and binds the SAME change/click handler each fires inline today. Do NOT collapse the four kinds into one; each is a distinct control with a distinct value contract (slider numeric, toggle on/off, boolToggle tri-state-or-bool, choice enumerated).
- Cluster 2 (bug-report): renderBugReport -> a sub-panel descriptor + painter section; preserve the submit action, the field set, and the screenshot/meta attach behavior (server-bound action stays identical; this phase does not touch server).
- Cluster 3 (graphics): renderGraphics -> sub-panel descriptor; preserve the graphics preset picker and every slider/toggle it owns. DO NOT add per-element tier knobs or read the FPS governor (that is P5/P14a; state.md decisions 6/8). The graphics preset label is read as a plain setting value here, nothing more.
- Cluster 4 (audio): renderAudio -> sub-panel descriptor; preserve every volume slider + mute toggle and the WebAudio bind action.
- Cluster 5 (language + remaining): the language picker (changeLanguage) plus the remaining toggle/keybind rows. Preserve changeLanguage EXACTLY (per PR #730: the picker hardening, the t() call on every option label, the re-render after switch). Keybind rebind rows keep their exact capture-and-bind dispatch.
- Register src/ui/options_view.ts in the UI-purity allowlist (UI_PURE_CORES in tests/architecture.test.ts). Update tests/client_shell.test.ts for any DOM ids that moved from hud.ts into the painter.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, or headless. If a sub-panel needs IWorld extended, STOP and surface it (scope change).
- TIER BOUNDARY (decisions 6/8): the graphics sub-panel reads the static graphics preset as a setting value. Do NOT define EFFECTS_QUALITY_LOW_CUTOFF, do NOT import or build the ui_effects_profile resolver, do NOT read governor.state().levels. That resolver is P5; per-element tiering is P14a.
- PainterHost is a THIN compose-in host (decision 8, two facets): the painter consumes the presentation dep-bag (icon/money/tooltip) and the write-elision facet (the four elided writers Hud exposes). Do not invent a new seam. The setProperty/classList elided extension is P10a; until then a documented raw write in this cold painter is acceptable (cold windows are not on the per-frame skip-rate gate).
- COMPONENT CONTRACT (decision 9): the core is instance-parameterized (no hardcoded single-instance element ids baked into the core; the painter owns the ids). The four control primitives are a reusable control FAMILY within the core, not four bespoke copies.
- Determinism / purity: options_view.ts is DOM/Three-free with no Math.random / Date.now / performance.now. The purity guard (tests/architecture.test.ts) enforces this; register the core.
- i18n: every NEW player-visible label is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only); never concat, never a ?? 'English' fallback, never edit i18n.locales/<lang>.ts. The language-picker option labels keep their t() calls.
- No generated-file hand-edits; regenerate via the build.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits, docs).

Out of scope (do NOT do in this phase):
- market + char: those are P8b. Do not touch renderMarket or renderChar.
- The other cold windows: talents/social/bags are P7a/P7b; map/arena/questlog/leaderboard/spellbook are P9a/P9b. Do not touch them.
- Any per-frame element (player/target frames, bars, action bar, auras, minimap, FCT, party): P10-P14. Do not wire options into Hud.update().
- Per-element graphics tiering (P14a) and the ui_effects_profile resolver/applier (P5). Do not add tier knobs or define the cutoff here.
- The PainterHost elided-writer extension (setStyleProp/toggleClass): that is P10a.
- Any CSS move (P1-P4b); this phase touches TS only. The options window CSS already lives in the extracted stylesheets from the CSS phases.

STEP 3 - VALIDATION + REVIEW (validation-matrix rows that match a pure-core + UI + WINDOW change; no frame-budget perf gate, options is a cold window):
- npx tsc --noEmit (baseline, every phase).
- biome check on the new/changed .ts (src/ui/options_view.ts, src/ui/options_window.ts) (decision: do not let new modules accrue lint debt).
- Pure core added: npx vitest run tests/options_view.test.ts + npx vitest run tests/architecture.test.ts (the UI-purity guard must pass with options_view in the allowlist, and must still FAIL on an injected forbidden import) + a same-input-same-output assertion.
- CLIENTWORLD-vs-SIM PARITY (decision 15, MANDATORY): drive options_view with BOTH a Sim-shaped IWorld stub and a ClientWorld-mirror-shaped IWorld stub. Options reads settings + a small slice of IWorld (e.g. account/character flags surfaced in the window); assert the view-model is identical from both stubs, so an offline-only field shape does not silently misrender online.
- FULL OPTIONS CONTROL-DISPATCH MATRIX (the core deliverable; NOT one blanket dispatch test): one preservation assertion PER SUB-PANEL, asserting the exact action fired:
  * settingSlider: a slider value change fires the same setting-write action with the same value coercion.
  * settingToggle: a toggle fires the same on/off action.
  * settingBoolToggle: the tri-state-or-bool toggle cycles to the same next value and fires the same action.
  * settingChoice: selecting each enumerated option fires the same action with the same chosen key.
  * renderBugReport: submit fires the same bug-report action with the same field set; the loading/empty/error states (submit-in-flight, no-text, submit-failure) each render the documented state.
  * renderGraphics: the preset picker and each owned slider/toggle fire the same actions; NO governor read.
  * renderAudio: each volume slider + mute toggle fires the same WebAudio bind action.
  * changeLanguage: selecting each locale fires changeLanguage with the same locale key AND triggers the documented re-render; assert the loading/empty/error states (locale-load pending, unknown-locale, load-failure) each render their documented state (per PR #730 hardening).
  * remaining toggles/keybinds: each rebind row captures and binds to the same keybind action.
- WCAG 2.2 AA WINDOW ROW (decision 10, MANDATORY): run axe-core (or equivalent) over the BUILT options window. Assert: every control has a programmatic label/role (sliders are role=slider with aria-valuenow/min/max, toggles expose pressed/checked state, the language picker is a labeled listbox/select); keyboard reachability through all nine panels with focus-return to the opener on close; visible :focus-visible on every control, never animated/blurred/transitioned away; a forced-colors: active snapshot where borders/focus survive and no meaning is carried by background alone; target-size >= 24px on every control (and >= 40x40 on any mobile touch control the options window exposes). The window/control a11y is NOT deferred to P15; only the cross-window audit (skip links, global focus, live regions) is.
- NO-MAGIC-VALUES GUARD (decision 12, MANDATORY): options_window is a DOM painter, so it drives tokens/CSS custom properties, never a literal hex/px/color in TS; any threshold or cadence is a named constant. Run the no-magic-values guard over the new painter.
- UI change: npx vitest run tests/client_shell.test.ts (greps hud.ts for DOM ids; update where ids moved into the painter) + npm run build (all 4 entries resolve) + biome check on the new .css is N/A (no CSS here).
- Review dispatch (spawn ONLY matching rows): qa-checklist (default reviewer for a completed deliverable set). Do NOT spawn cross-platform-sync (IWorld unchanged; consuming it in a painter does not change it), privacy-security-review (no server/net/admin/secret/RNG; the bug-report SUBMIT action is unchanged and server-side), or migration-safety (no DDL). Prompt the reviewer for COVERAGE not filtering; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE: 2-5 Conventional Commits with a scope and EXPLICIT paths. Suggested:
- refactor(ui): extract options window to options_view core + painter
  paths: src/ui/options_view.ts src/ui/options_window.ts src/ui/hud.ts tests/options_view.test.ts tests/architecture.test.ts
- test(ui): lock the full options control-dispatch matrix per sub-panel
  paths: tests/options_view.test.ts
- test(ui): update client_shell ids for the moved options window
  paths: tests/client_shell.test.ts
- docs(frontend): record P8a options cold-window extraction in progress + state ledger
  paths: docs/frontend-modernization/progress.md docs/frontend-modernization/state.md

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] renderOptions delegates to src/ui/options_view.ts (pure core) + src/ui/options_window.ts (painter composed through PainterHost); the inline window body (all nine sub-panels) is gone from hud.ts.
- [ ] src/ui/options_view.ts is DOM/Three-free, registered in UI_PURE_CORES, and passes the purity guard; the guard still FAILS on an injected forbidden import.
- [ ] The core has a same-input-same-output (deterministic) assertion AND the ClientWorld-vs-Sim parity assertion (driven by BOTH stub shapes) green.
- [ ] FULL control-dispatch matrix: a per-sub-panel preservation test for ALL nine sub-panels (the four control primitives, bug-report, graphics, audio, changeLanguage, remaining toggles/keybinds) is green; each asserts the exact action fired.
- [ ] Async/edge states covered: renderBugReport submit-in-flight / no-text / submit-failure, and changeLanguage locale-load-pending / unknown-locale / load-failure each render their documented state.
- [ ] WCAG 2.2 AA window row green: axe-core over the built window clean; keyboard reachable across all nine panels with focus-return on close; :focus-visible visible and never animated away; forced-colors snapshot recorded; target-size >= 24px (>= 40x40 on any mobile touch control).
- [ ] No-magic-values guard green over options_window (tokens/vars driven, named constants for any threshold/cadence).
- [ ] Tier boundary respected: NO EFFECTS_QUALITY_LOW_CUTOFF definition, NO ui_effects_profile resolver import, NO governor.state().levels read in this phase.
- [ ] Any new label is a hud_chrome.ts t() key (English-only); the language-picker option labels keep their t() calls.
- [ ] IWorld is NOT extended; no edits under src/sim, server, src/net, headless.
- [ ] npx tsc --noEmit clean; biome check clean on the new .ts; npm test green incl architecture + client_shell; npm run build green on all 4 entries.
- [ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P8a row -> done, list src/ui/options_view.ts + src/ui/options_window.ts + tokens) and state.md (mark P8a done in the ledger; add options_view to the "Existing pure cores to REUSE" list; note any new hud_chrome label keys; record the full per-sub-panel dispatch matrix as the proven preservation pattern for P8b/P9b).
- Record surprising rules in memory: any control whose dispatch did not factor cleanly into a pure-core descriptor (which one and why), any sub-panel that needed a documented raw style/textContent write in the cold painter (allowed pre-P10a), the changeLanguage re-render hook, and any DOM id the client_shell grep flagged.

STEP 7 - FINAL RESPONSE: status, the files changed (absolute paths), validation results (tsc / biome / test / purity guard / parity / full dispatch matrix / WCAG axe / no-magic-values / build), the qa-checklist reviewer verdict, any deferrals, and end with exactly: Next: phase-08b-coldwindow-market-char.md

STOPPING RULES:
- STOP and surface as a scope change if the options window cannot be extracted without extending IWorld or touching src/sim / server / src/net / headless.
- STOP if any control's behavior cannot be preserved through a pure core + PainterHost painter without changing what action it dispatches (do not silently alter dispatch).
- STOP if the graphics sub-panel cannot be extracted without reading the FPS governor or defining the effects cutoff (that means tier logic is leaking in; it belongs to P5/P14a, surface it).
- STOP if the purity guard cannot be made to pass with the core registered (means the core still has a DOM/Three/RNG dependency that must be lifted out first).
- STOP if loading the full renderOptions body plus its nine-panel dispatch pushes the orchestrator toward the ~40% ceiling; extract panel-by-panel in separate commits, re-summarize, then continue.
```

## Notes for the planner

This is the first half of the old P8 split, carved off because `renderOptions` alone is about 1180
lines across nine sub-panels behind a nine-member `OptionsHooks` dispatch, and adding the now-mandatory
WCAG 2.2 AA window row, the no-magic-values painter guard, the ClientWorld-vs-Sim parity assertion, and
in-session remediation pushes the single window over the 40% Opus-degradation ceiling on its own. The
load-bearing change versus the old blanket-dispatch plan is the per-sub-panel preservation matrix: the
deep review found that one "a changed control still invokes the same action" test cannot prove nine
distinct control kinds (slider, toggle, boolToggle, choice) plus four functional sub-panels (bug-report,
graphics, audio, language) each keep their exact dispatch, so the acceptance criterion is now nine
named assertions. The two specific async traps are `renderBugReport` (submit-in-flight / no-text /
submit-failure) and `changeLanguage` (locale-load-pending / unknown-locale / load-failure, per the PR
#730 picker hardening), both of which need explicit loading/empty/error coverage. The tier boundary is
the other watch item: the graphics sub-panel must read the static preset as a plain setting value only,
never define `EFFECTS_QUALITY_LOW_CUTOFF` or touch the governor, because that resolver is P5 and
per-element tiering is P14a. This phase proves the PainterHost seam scales to the densest single
control surface in the packet before P8b takes on market (async) and char (the Three.js preview and the
skin-event `Math.random`).
