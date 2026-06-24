# Phase P17a: Harness floor (test-only): client_shell re-author + standing perf budget + purity sweep + first all-together perf run

Re-author the test harness around the post-extraction painter layout and stand it up as the permanent
floor: repoint the `client_shell` DOM-id greps at the painter modules that now own them, add the
STANDING `tests/hud_perf_budget.test.ts` (host-split assertions: a static source-scan for raw-write
rejection, a jsdom skip-rate-budget loop, the perf_tour-delegated frameP95 + allocation-budget +
bounded-node cap), complete the `UI_PURE_CORES` allowlist with a COMPLETENESS check, and run the FIRST
all-together `perf_tour` (desktop + mobile). This phase is TEST-ONLY: no source/painter edit; a
surfaced perf regression routes back to the offending phase, never to a relaxed budget.

## Starter Prompt

```
This is Phase P17a of the Frontend Modernization v0.16.0 packet: Harness floor (test-only):
client_shell re-author + standing perf budget + purity sweep + first all-together perf run. Deps:
P0-P16.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a surgical, TEST-ONLY close-out floor (re-author one guard test, add the
standing budget test, complete one allowlist sweep, run the first all-together perf_tour). No source
or painter edit lands here (that is P17b). No batch fan-out; the slices share the same moved-id audit
and the same test files. A single review pass at the end.

Goal: make the harness reflect the post-extraction reality and become the STANDING floor for it, so
the per-frame invariants P10a-P14b each proved once at their own perf gate can never silently regress.
Concretely:
- Re-author tests/client_shell.test.ts where it greps hud.ts for DOM ids that now live in painters
  (the ids moved P7a-P14b; the grep targets must follow them into the painter modules). Do NOT loosen
  any assertion; an id that dissolved into a keyed pool gets a NEW-SHAPE assertion against the painter,
  not a deleted one.
- Add a STANDING tests/hud_perf_budget.test.ts that codifies the write-elision + allocation budgets and
  runs every npm test, with its assertions SPLIT BY HOST (static source-scan, jsdom, perf_tour-delegated)
  so each runs where it can actually be measured.
- Do the FINAL UI_PURE_CORES COMPLETENESS sweep: assert every on-disk *_view core is registered (not
  just that the listed ones are consistent), and re-verify forbiddenUiCoreImport rejects
  three/*_painter/painter_host/DOM globals by injecting a REAL import line.
- Run the FIRST all-together perf_tour (desktop + mobile); this is the first time every extraction is
  measured together. A surfaced regression routes back to the offending phase, NOT to a relaxed budget.
- Update progress.md, state.md ledger, CLAUDE.md pointers for the standing floor.

This phase is the TEST FLOOR. The behavior-affecting work (bundle-budget gate + selective lazy-load),
the cross-engine/axe CI job, and the packet close are P17b. Do not start them here.

STEP 0 - PRE-FLIGHT:
- git status clean. If not clean, ASK the user (this is a shared checkout; a concurrent session may
  share the tree). Stage only this phase's explicit paths, never git add -A.
- Memory scan: MEMORY.md plus the FB-equivalent close entries:
  [[frontend-phase9-testing-docs-sweep]] (the FB Phase 9 final-impl + QA, the closest analog; note the
  vitest exact-pin lesson and that the pure cores stay Node-tested while only the browser-mode suite
  runs in a real engine; the cross-engine/axe CI wiring itself is P17b, not here),
  [[frontend-phase7-hud-window-extraction]] (the forbiddenUiCoreImport guard hardening that also
  rejects a pure core importing a *_painter/painter_host, and the "purity-guard perturbation must
  inject a REAL code line, a // comment is stripped by stripComments" gotcha),
  [[frontend-phase8-graphics-tier-effects]] (live computed-style proof > static CSS-text guards; the
  governor two-controller guard). Also [[phased-packet-qa-cadence]].
- Confirm you are in the feature/frontend-modernization-v016 worktree.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, and keep its summary (not raw dumps):
- docs/frontend-modernization/state.md: the locked decisions (esp. 5/5a write-elision + the writer
  extension that P10a landed, 9 the component-contract FAMILY, 12 no-magic-values, 15 ClientWorld-vs-Sim
  parity, 17 persistent-monolith owned), the validation matrix (esp. the PER-FRAME phase row + the
  WINDOW/CONTROL a11y row), the review dispatch matrix, and the Key file paths list (the per-frame
  element line map + the cold-window inline list + the existing pure cores to REUSE list).
- This phase file.
- The "### P17" / "### P15" close-out section of v016-recon-and-packet.md plus the "Load-bearing
  structural findings" (esp. the perf-harness + write-elision findings) and "Top risks" sections (risk
  1 write-elision regression; risk 8 ClientWorld-vs-Sim drift).
- The CURRENT shape of tests/client_shell.test.ts: every place it greps hud.ts for a DOM id, and which
  of those ids the P7a-P14b painters now own. Cross-reference the recon Key-file-paths cold-window list
  and per-frame element list. Have the agent return a MOVED-ID TABLE: each grepped id -> the painter
  module that now owns it (or "still inline in hud.ts", or "dissolved into a keyed pool, new shape =
  ...").
- tests/architecture.test.ts: the UI_PURE_CORES allowlist + the forbiddenUiCoreImport guard as they
  stand after P0/P5-P14b. Have the agent list (a) every core CURRENTLY in the allowlist and (b) every
  on-disk *_view / *_core module under src/ui and src/render that is a registered pure core, so the
  COMPLETENESS gap (any on-disk core NOT in the allowlist) is visible.
- tests/hud_perf_budget.test.ts: P0 created the perf BASELINE artifact; this phase makes the BUDGET
  test standing. Have the agent report whether a stub exists yet and its current shape.
- scripts/perf_tour.mjs: the recorded P0 baseline fields and HOW the baseline is persisted. We need the
  COMMITTED P0 baseline file name (the artifact P0 wrote: e.g. a perf-baseline JSON under
  docs/frontend-modernization/ or scripts/) and the env wiring that points the budget test at it. Have
  the agent name the exact file + the field names (frameP95, inputIntentToFrameP95, hudHotDomSkipRate,
  and any min-skip-rate floor), and the desktop + mobile invocation flags.
- The write-elision surface: hud.ts:1322-1372 (setText/setDisplay/setTransform/setWidth + hotWriteCache)
  PLUS the P10a writer EXTENSION (setStyleProp/toggleClass on the PainterHost write-elision facet,
  decision 5a) and perfStats() (hotDomWrites / hotDomSkippedWrites / hotDomSkipRate).
- The PainterHost write-elision facet (P6 + P10a): how the four-plus-two elided writers are bound and
  how a painter is structurally checked for raw-write violations (the static check the per-frame phases
  used). Have the agent return the exact check shape so Slice B reuses it, not a new one.
THE 40% RULE: keep the working set small; this is a TEST-ONLY floor, the orchestrator should stay well
under the ceiling. If the client_shell grep audit is large, have the agent return ONLY the moved-id
table + the on-disk-core list, not file bodies.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Sequential, three slices (no fan-out; they share the moved-id audit and the same test files):

- Slice A - tests/client_shell.test.ts re-author: for each DOM id the test greps in hud.ts that a
  P7a-P14b painter now owns, repoint the grep at the painter module that renders it (the recon
  Key-file-paths list names where each window/element moved). Ids still produced inline stay pointed at
  hud.ts. Keep the test's intent (the id exists and is wired) identical; only the file it asserts
  against changes. Do NOT loosen an assertion to make it pass. If an id is genuinely GONE (folded into
  a pool / keyed node, e.g. the party-frame per-member ids P11c pooled, the aura slots P12b pooled, the
  FCT nodes P13b pooled), update the assertion to the NEW structure (assert the keyed-pool template /
  the painter's node factory produces the keyed shape) and note it in the test comment + the final
  response. The COVERAGE rule: no grepped id may be silently dropped; every one is either repointed,
  kept inline, or re-shaped with a note.

- Slice B - tests/hud_perf_budget.test.ts (STANDING): codify the per-frame invariants P10a-P13b proved
  into a permanent test, with assertions SPLIT BY HOST so each runs where it is actually measurable:
  - (1) STATIC SOURCE-SCAN (Node, no DOM, fast, runs in npm test): the raw-write rejection. Re-use the
    same static/structural check the per-frame phases used (from the PainterHost facet, STEP 1) to
    assert every hot-path painter routes ALL writes through the host's elided writers
    (setText/setDisplay/setTransform/setWidth + the P10a setStyleProp/toggleClass), with NO raw
    style/textContent/setAttribute/classList on the hot path beyond any DOCUMENTED allowed write
    (decision 5a). This is a source scan, not a runtime probe; it does not need the perf_tour harness.
  - (2) JSDOM SKIP-RATE BUDGET (jsdom, runs in npm test): drive the painters through a scripted update
    loop against a jsdom document + a Sim-shaped IWorld stub AND a ClientWorld-mirror-shaped IWorld stub
    (decision 15 parity), then assert hotDomSkipRate from perfStats() stays >= the committed P0
    min-skip-rate floor. This proves the write-elision did not collapse without needing a real browser.
    NAME the committed P0 baseline file (from STEP 1) and read the min-skip-rate key from it; the test
    must FAIL if the baseline file is missing or the key is absent (do not default to 0).
  - (3) PERF_TOUR-DELEGATED (gated behind an env flag; runs in the perf row, not bare npm test): the
    frameP95 <= P0 baseline assertion, the P12a allocation-budget proxy (action-bar + aura per-frame
    garbage bounded; the exact proxy the P12a spike settled on, fallback = perf_tour frameP95 +
    longtasks), and the P13b bounded-node cap (the FCT pool never exceeds its max-concurrent under a
    scripted AoE/boss burst). This block DELEGATES to scripts/perf_tour.mjs (reuse it, do not invent a
    new measurement path) and reads the same committed P0 baseline file; it is skipped when the env
    flag is unset so bare npm test stays fast and host-portable.
  Document at the top of the file WHICH host runs each block and WHY, and name the committed P0 baseline
  file + the env flag once, so a future contributor does not move an assertion to the wrong host.

- Slice C - final UI_PURE_CORES COMPLETENESS sweep: this is a COMPLETENESS check, not consistency-only.
  - Make UI_PURE_CORES in tests/architecture.test.ts list EVERY pure core registered across P5-P14b:
    ui_effects_profile (P5), the *_view cores from P7a-P9b, swing_timer + the unit_frame FAMILY core
    (P10b, player first instance), target + party unit_frame instances (P11a/b/c), the cast_bar reuse
    (P11a), minimapMarkers (P12b), fct_core (P13a/b), nameplate_view (P14b), plus the reused V16 cores
    (xp_bar, absorb_bar, party_frames selector, rest_indicator, low_health, low_resource, clock,
    compass, coords, quest_tracker, delve_map, raid_lockout_view, vendor_view).
  - ADD a COMPLETENESS assertion: scan the on-disk *_view / *_core pure-core modules (the same dirs the
    architecture guard already scans) and assert each one IS in UI_PURE_CORES, so a future extraction
    that forgets to register its core FAILS this test rather than silently escaping the purity guard.
    This closes the gap that a consistency-only allowlist (the listed entries are pure) leaves open (an
    unlisted on-disk core is never checked).
  - Re-verify forbiddenUiCoreImport still rejects three / *_painter / painter_host / DOM globals: inject
    a REAL code line (an actual `import` statement, NOT a // comment, which stripComments removes) into
    a registered core, confirm the guard FAILS, then revert the injection. If the injection does NOT
    make the guard fail, the guard is broken: fix the guard (it is a test file, in scope) before
    relying on it.

Then the FIRST all-together perf_tour run (part of STEP 3 validation) and the docs slice (STEP 6).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- TEST-ONLY: no source/painter/CSS/hud.ts edit lands here. The only editable surfaces are tests/,
  docs/frontend-modernization/, and CLAUDE.md. If making client_shell or the purity guard green would
  require editing a source/painter file, that is a scope change (or an earlier-phase bug): STOP and
  surface it; do not edit source to make a test pass.
- Determinism: the registered pure cores stay DOM/Three-free; no Math.random/Date.now/performance.now
  in any registered pure core (the COMPLETENESS sweep re-checks this via forbiddenUiCoreImport + the
  existing determinism guard). The FCT painter may use Math.random for jitter; the fct_core may not.
- Write-elision routing (decision 5/5a): the static source-scan must verify the hot path routes through
  the elided writers that EXIST after P10a (the four original PLUS setStyleProp/toggleClass), and
  document any allowed raw write; it must not assert against a writer that does not exist.
- ClientWorld-vs-Sim parity (decision 15): the jsdom skip-rate loop drives the painters with BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub; a core that assumes a Sim-only field shape
  fails the parity arm.
- Persistent-monolith owned (decision 17): client_shell repointing does NOT mean hud.ts must shrink to
  nothing; ids still produced inline stay pointed at hud.ts. Do not "fix" an inline-id grep by forcing
  an extraction.
- i18n: any label assertion still expects the t() key path; the action-bar aria-label test keeps the
  t() call (no concat / ?? fallback). No new player strings here.
- No generated-file hand-edits; regenerate via the build if anything generated drifts.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).

Out of scope (do NOT do in this phase):
- The JS bundle-budget gate, the selective lazy-load, the cross-engine/axe CI job, and the packet close.
  All of that is P17b. This phase only stands up the test floor and runs the first all-together perf
  measurement.
- Any new extraction or any hud.ts/CSS/painter source edit. Every element and window was extracted in
  P6-P14b; this phase re-authors the harness around them.
- Any per-element tiering change (P14a owns it) or new perf optimization. The budget test ASSERTS the
  existing budget, it does not tighten it.
- New a11y FIXES (P15a/P15b own the WCAG 2.2 AA chrome work).
- The full QA pass: that is the separate qa-checklist run that follows P17b (the packet's final QA).

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (from state.md):
- Baseline: npx tsc --noEmit.
- New .ts module added (tests/hud_perf_budget.test.ts): biome check on the new/changed .ts.
- Test-harness change: npx vitest run tests/client_shell.test.ts + npx vitest run
  tests/architecture.test.ts (the UI-purity guard, after the COMPLETENESS sweep) + npx vitest run
  tests/hud_perf_budget.test.ts (the static source-scan + jsdom skip-rate arms; the perf_tour-delegated
  arm is exercised via the perf row below). Then full npm test green.
- PER-FRAME PERF GATE (this phase makes it the STANDING floor and runs it ALL-TOGETHER for the first
  time): npm run the perf_tour harness DESKTOP and MOBILE (the exact invocations from STEP 1) and assert
  frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline min-skip-rate floor, reading the
  COMMITTED P0 baseline file. The perf_tour-delegated arm of hud_perf_budget.test.ts encodes the
  allocation-budget proxy (action-bar + aura garbage bounded) and the P13b bounded-node cap (FCT pool <=
  max-concurrent under the scripted AoE burst). This is the first time every extraction runs together;
  a regression here is a REAL earlier-phase regression (see STOPPING RULES), not a harness bug.
- WINDOW/CONTROL a11y (decision 10): no NEW window/control work lands here, so no new axe run is
  required; but the COMPLETENESS sweep must not drop any *_view core whose painter carries the per-window
  a11y contract from its own phase. (The standing axe CI gate is wired in P17b.)
- No-magic-values painter guard (decision 12): not re-run here (no painter edit); the standing guard
  that the per-frame phases installed remains green under npm test.
Review dispatch (spawn ONLY matching rows): qa-checklist only. No privacy-security-review (no
server/admin/net/secret/Math.random in sim; test-only), no migration-safety (no DDL/JSONB), no
cross-platform-sync (IWorld untouched; this is test-only). Prompt the reviewer for COVERAGE not
filtering (did any moved id get silently dropped or any assertion loosened; is the COMPLETENESS sweep
actually complete; does each budget arm run on a host where it is measurable; is the P0 baseline file
actually read, not defaulted). Do not commit until it reports no BLOCKING. If it truncates, resume with
the state.md STEP 3 resume line.

STEP 4 - COMMIT CADENCE (2-4 Conventional Commits, scope + EXPLICIT paths):
- test(ui): repoint client_shell DOM-id greps at the painter modules
  (tests/client_shell.test.ts)
- test(ui): add standing hud_perf_budget (host-split: static + jsdom + perf_tour)
  (tests/hud_perf_budget.test.ts)
- test(ui): complete the UI_PURE_CORES allowlist with an on-disk completeness check
  (tests/architecture.test.ts)
- docs(frontend): record the standing harness floor + first all-together perf result
  (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md, CLAUDE.md)

STEP 5 - ACCEPTANCE CRITERIA:
(see the checkbox list below)

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P17a done; note hud_perf_budget.test.ts is now the STANDING floor, client_shell
  greps the painters, the UI_PURE_CORES allowlist is COMPLETENESS-checked, and the first all-together
  perf_tour result (desktop + mobile numbers vs the P0 baseline). Name P17b as next.
- state.md: update the phase ledger (P17a status), the Key-file-paths list (hud_perf_budget.test.ts is
  STANDING with host-split arms + the named P0 baseline file + the env flag; client_shell greps the
  painters; UI_PURE_CORES is COMPLETENESS-checked against on-disk cores), and the "Current phase" line.
- CLAUDE.md: update the pointers / guard list so a future contributor knows client_shell greps painters,
  UI_PURE_CORES is the full COMPLETENESS-checked per-element allowlist, and hud_perf_budget is the
  standing per-frame floor (and which host runs each arm + that it reads the committed P0 baseline).
- Memory: record any surprising rule (an id that fully dissolved into a keyed pool so the grep had to
  change SHAPE not just target; the perf_tour mobile invocation; the committed P0 baseline file name +
  the min-skip-rate key + the env flag that gates the perf_tour-delegated arm; the allocation-budget
  proxy the P12a spike settled on; which on-disk cores the COMPLETENESS sweep newly forced into the
  allowlist).

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), the validation results (tsc, the vitest files,
biome check on hud_perf_budget.test.ts, perf_tour desktop+mobile numbers vs the P0 baseline, full npm
test), the moved-id table (each grepped id and where it now points; any id that changed SHAPE), the
COMPLETENESS-sweep result (any on-disk core newly forced into the allowlist), the qa-checklist reviewer
verdict, and any deferrals. End with exactly:
Next: phase-17b-bundle-lazy-cross-engine-close.md

STOPPING RULES (phase-specific):
- STOP if a perf_tour run shows frameP95 above the P0 baseline OR hudHotDomSkipRate below the P0
  min-skip-rate floor: that is a REAL per-frame regression from an earlier phase that this all-together
  run has surfaced for the first time, not a harness bug. Report which element/phase regressed; route it
  back to the offending phase; do NOT relax the budget test to make it pass.
- STOP if making client_shell or the purity guard green would require editing a source/painter file
  (not a test): this is TEST-ONLY. That is either a scope change or an earlier-phase bug; surface it,
  do not edit source.
- STOP if the committed P0 baseline file is missing or lacks the min-skip-rate key: the jsdom + perf
  arms cannot be grounded. Do not default the floor to 0; report the missing baseline (P0's artifact)
  and have it regenerated/committed before the budget can be standing.
- STOP if the COMPLETENESS sweep finds an on-disk *_view/*_core that is NOT in UI_PURE_CORES: do not
  just add it blindly; confirm it is genuinely a registered pure core (DOM/Three-free), add it, and note
  it. If it is NOT pure (it imports three/painter), that is an earlier-phase purity break: surface it.
- STOP if a purity-guard injection (the REAL import line) does NOT make the guard fail: the guard is
  broken, fix the guard (it is a test file, in scope) before relying on it for the sweep.
- STOP if an assertion can only be made green by loosening it (e.g. dropping a moved id, weakening the
  skip-rate floor, or moving the jsdom arm to perf_tour to skip it): that defeats the floor. Keep the
  assertion strict and route the failure to its cause.
```

## Notes for the planner

This phase is the first half of the old P17 split: the TEST-ONLY harness floor. It does the
non-behavioral work that has no source risk of its own (re-author `client_shell`, stand up the standing
budget test, complete the purity allowlist) and runs the FIRST all-together `perf_tour`, which is the
single most valuable event in the close-out: every per-frame extraction P10a-P14b is measured together
for the first time, so a cumulative regression surfaces here and the stopping rule routes it back to the
phase that caused it rather than letting the close-out paper over it.

The deep-review fixes are baked in. The standing budget assertions are SPLIT BY HOST (static
source-scan for raw-write rejection, jsdom for the skip-rate loop, perf_tour-delegated behind an env
flag for frameP95 + allocation-budget + bounded-node cap) so each arm runs where it can actually be
measured and bare `npm test` stays fast and portable. The skip-rate and frameP95 gates are grounded in
the COMMITTED P0 baseline file (named, env-wired, never defaulted to 0), and the perf_tour-delegated arm
reads a min-skip-rate floor key from it. The `UI_PURE_CORES` sweep is COMPLETENESS-checked (assert every
on-disk `*_view`/`*_core` is registered), not consistency-only, so a future extraction that forgets to
register its core fails the guard instead of silently escaping it. The jsdom skip-rate loop carries the
ClientWorld-vs-Sim parity arm (decision 15) so an offline-only field-shape assumption is caught here.

P17a deliberately ships NO source change: the bundle-budget gate, the selective lazy-load, the
cross-engine/axe CI job, and the packet close are all P17b. That split keeps each half plus its QA
under the 40% ceiling and isolates the one behavior-affecting slice (the lazy-load) from the pure test
floor. The handoff names `phase-17b-bundle-lazy-cross-engine-close.md`.
