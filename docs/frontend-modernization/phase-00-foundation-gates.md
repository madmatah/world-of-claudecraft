# Phase P0: Foundation Gates: CSS-corpus + UI-purity guard + perf/visual/mobile baseline

Re-establish the verifiable gates the whole packet leans on, on a green v0.16.0, before any
HUD or CSS code moves: the CSS-corpus completeness guard, the UI-purity import guard, and the recorded
non-regression floor every later phase regresses against (perf_tour, a screenshot baseline, and a
mobile-layout E2E baseline).

## Starter Prompt

```
This is Phase P0 of the Frontend Modernization v0.16.0 packet: Foundation Gates (CSS-corpus + UI-purity guard + perf baseline).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. A small set of independent surgical artifacts (one new test file, one parameterized guard, and three recorded baselines); a single sequential orchestrator with at most a 4-way Agent fan-out is enough. No batch fan-out, no adversarial verify loop.

Goal: Stand up the gates the packet's acceptance criteria depend on, while moving ZERO product code. Add tests/css_corpus.test.ts (a section-by-section completeness guard over the inline <style> blocks in index.html and play.html UNION src/styles/*.css, keyed on the LIVE 10-dash `/* ---------- name ---------- */` section markers) so later CSS phases can prove no rule was dropped as sections migrate out of the inline blocks. Parameterize the existing UI-purity machinery in tests/architecture.test.ts into a UI_PURE_CORES allowlist that rejects three / *_painter / painter_host / DOM-global imports inside a registered pure core, seeded with V16's already-existing cores. Record THREE non-regression floors as checked-in doc artifacts: (1) a perf_tour baseline (hudHotDomSkipRate as the durable anchor, frameP95 + inputIntentToFrameP95 as same-machine-relative numbers) on desktop and mobile, with the dev-server prerequisite and the machine spec recorded; (2) a screenshot baseline via the existing scripts/*_shot.mjs suite; (3) a mobile-layout baseline (run the V16 mobile_* E2E scripts and record their PASS state). Leave all three reproducible and checked in.

STEP 0 - PRE-FLIGHT:
- Run `git status`. It MUST be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are on branch feature/frontend-modernization-v016 in /Users/fernando/Documents/wocc-v0.16.0.
- Memory scan: read MEMORY.md and the Frontend Phase 1 foundation-gates entry (frontend-phase1-foundation-gates.md: cssCorpus/normalizeCss CSS tests + the vite/lightningcss pin), the Phase 7 entry (frontend-phase7-hud-window-extraction.md: the forbiddenUiCoreImport / UI_PURE_CORES guard shape, the "guard perturbation must inject a REAL code line, a // comment is stripped by stripComments" gotcha, and "run the FULL suite for source-guards"), and the phased-packet QA cadence entry. These are the FB originals this phase ports forward.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize:
- state.md (locked decisions, esp. decisions 16 (responsive gated) and 18 (admin/guide survival-only); non-negotiable constraints; the canonical workflow; the validation matrix; the review dispatch matrix).
- this phase file.
- the `### P0` section of v016-recon-and-packet.md plus its "Load-bearing structural findings", "Reuse from FB", and "Top risks" sections.
- the SPECIFIC source ranges: in tests/architecture.test.ts the existing walk() / stripComments() / IMPORT_RE machinery and any existing sim-purity scan it parameterizes; the inline <style> sections of index.html and play.html ONLY to enumerate the LIVE 10-dash `/* ---------- name ---------- */` section markers (there are ~47 in index.html, ~45 in play.html; do not dump the CSS bodies, and note that a bare prose comment that is NOT wrapped in 10 dashes is section BODY, never a boundary); scripts/perf_tour.mjs (its current output keys: frameP95, inputIntentToFrameP95, hudHotDomSkipRate) and the hud perf bucket + perfStats() at hud.ts:1322-1372; the scripts/*_shot.mjs screenshot suite (which scenes it shoots, what it needs running); the V16 mobile_* E2E scripts (mobile_input_zoom_check, mobile_button_size, mobile_joystick_size, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area) and what they assert; the FB originals of css_corpus.test.ts and the cssCorpus/normalizeCss helpers and the FB UI_PURE_CORES guard to port them forward.
The orchestrator KEEPS the distilled summary (the 10-dash section-marker list per entry, guard machinery shape, perf_tour output schema, the screenshot-scene list, the mobile-script list), not raw dumps.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Four slices. They touch disjoint files, so fan out up to 4 Agents in parallel (no shared-file overlap, so no worktree isolation needed), then the orchestrator integrates and runs the suite.
- Slice A (css_corpus guard): port FB's tests/css_corpus.test.ts + the cssCorpus / normalizeCss helpers forward. The CORPUS SOURCE is the inline <style> of index.html and play.html UNION the contents of src/styles/*.css (none of those files exist in V16 today, so the union is just the two inline blocks NOW; the union is what makes coverage CONSERVED as P1-P4b migrate sections out of the inline blocks into src/styles/). The guard splits the corpus into sections on the LIVE 10-dash `/* ---------- name ---------- */` markers (NOT a 4-dash `/* ---- name ---- */` pattern: a 4-dash regex matches nothing in V16, which is a vacuous pass; verify your regex actually captures all ~47 index + ~45 play markers from the STEP 1 summary). A bare prose comment NOT wrapped in 10 dashes is section BODY, not a section boundary, so it must NOT start a new section. Normalize whitespace/comment-insensitively but rule-preservingly, and assert every enumerated section name is accounted for in the union. The guard must pass NOW (full corpus inline) and stay meaningful as sections move into src/styles/ (a section disappearing from the inline block but reappearing in src/styles/ keyed on the SAME marker keeps the union complete; a section that vanishes from both fails). Enumerate the real section markers from the STEP 1 summary; do NOT invent section names.
- Slice B (UI-purity guard): in tests/architecture.test.ts, parameterize the existing walk() / stripComments() / IMPORT_RE scan into a UI_PURE_CORES allowlist. A registered pure core MUST NOT import three (or three/*), any *_painter module, painter_host, or DOM globals (document/window/HTMLElement/etc). Seed the allowlist with V16's already-existing per-element + window cores listed in the recon (xp_bar, cast_bar, absorb_bar, party_frames selector, rest_indicator, low_health, low_resource, clock, compass, coords, quest_tracker, delve_map, raid_lockout_view, vendor_view, and the existing *_view cores). The guard is over the EXISTING green cores, so it MUST pass with no edits to product code.
- Slice C (perf baseline): run scripts/perf_tour.mjs in both desktop and mobile profiles, capture frameP95, inputIntentToFrameP95, hudHotDomSkipRate, and write them as a recorded non-regression floor into a checked-in doc artifact (docs/frontend-modernization/perf-baseline-v016.md). RECORD: the dev-server prerequisite (perf_tour drives a real browser against `npm run dev`, often `npm run server` too; state the exact processes that must be up and on which ports), the exact command + profile flags, and the MACHINE SPEC (CPU, core count, RAM, OS version) because absolute wall-clock ms is NOT portable across machines. The DURABLE anchor is hudHotDomSkipRate (a ratio, machine-independent: every per-frame phase asserts the skip-rate has not dropped). frameP95 and inputIntentToFrameP95 are recorded as SAME-MACHINE-RELATIVE numbers only: a later phase compares them against a fresh same-machine re-run of this baseline, never against the literal P0 ms on different hardware. State this framing explicitly in the artifact. This is the floor P10a-P14b gate against. Do NOT edit perf_tour itself in P0 (its re-author is P17a); only run and record.
- Slice D (visual + mobile-layout baseline, decision 16 + the visual-regression item): two recorded non-regression floors that css_corpus cannot catch (a dvh->100vh swap, a dropped safe-area-inset, a lost @media breakpoint are all CSS-TEXT-complete yet layout-broken).
  (D1 screenshot baseline) run the existing scripts/*_shot.mjs suite and check the produced reference images in (or, if they are large/binary, record their stable hashes + the exact command in docs/frontend-modernization/visual-baseline-v016.md). These are the references P4a/P4b and every cascade-risking CSS phase screenshot-diff against. Do NOT author a new screenshot tool; use the suite that ships.
  (D2 mobile-layout baseline) run the V16 mobile_* E2E scripts (mobile_input_zoom_check, mobile_button_size, mobile_joystick_size, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area) and record their CURRENT PASS state into docs/frontend-modernization/mobile-baseline-v016.md (which scripts, the command, the dev-server/CDP prerequisite, and the green/red of each). This recorded PASS set is the blocking RESPONSIVE floor P4a/P4b and the per-frame phases gate against (decision 16). Capture the IN-GAME profile in LANDSCAPE (the game is landscape-only on web mobile, decision 16a) and also record the in-game PORTRAIT state (the `#rotate-device` overlay should be the visible response, not a broken HUD) so P4b has a portrait-overlay floor to compare against. If any script is RED on the untouched green tree, record it as RED (a pre-existing finding, not something P0 fixes) and STOP-surface it per the stopping rules. Do NOT edit the mobile scripts; only run and record.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation/test-only: move ZERO product code. No hud.ts, no CSS, no src/sim / server / src/net / headless edits. If a gate cannot pass without a product-code change, STOP and surface it (scope change).
- Determinism: the guards and any test helper stay DOM/Three-free and use no Math.random / Date.now / performance.now in registered-core scanning logic.
- i18n: no new player-visible strings in this phase (gates only).
- No generated-file hand-edits; if a guard reads a generated artifact, read it, never edit it.
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commit text).

Out of scope (do NOT do in this phase):
- The Lightning CSS flip, .browserslistrc, the @layer order, and any src/styles/* extraction (all P1+).
- Moving any CSS section out of the inline <style> blocks (P1-P4); the corpus guard must pass with everything STILL inline.
- ui_effects_profile.ts and the data-fx-level applier (P5).
- PainterHost and any window/per-frame extraction (P6+).
- Re-authoring perf_tour.mjs or adding the standing hud_perf_budget.test.ts (P17a).
- Editing the scripts/*_shot.mjs screenshot suite or the mobile_* E2E scripts (P0 only RUNS and RECORDS them; the responsive row is wired into P4a/P4b/P15b, decision 16).

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- CSS/test guard added: `npx vitest run tests/css_corpus.test.ts` (passes with the full corpus inline; confirm it captured ALL ~47 index + ~45 play 10-dash markers, not zero, so it is not a vacuous pass).
- Purity guard added: `npx vitest run tests/architecture.test.ts`.
- biome check on the new/changed .ts (tests/css_corpus.test.ts + the tests/architecture.test.ts edit): `biome check` clean (the V16 ratchet).
- Run the FULL suite for source-grep guards: `npm test` green (architecture/source guards can false-pass on a narrow run).
- NEGATIVE PROOF (required): perturb each new guard and confirm it FAILS, then revert.
  - css_corpus: delete one section's content from the corpus fixture and confirm the section-loss assertion fires; restore. ALSO assert the marker regex is non-vacuous: temporarily point it at a 4-dash pattern and confirm it captures ZERO sections (proving the guard would have silently passed on the wrong pattern), then revert to the correct 10-dash pattern.
  - UI-purity: inject a REAL import line `import './x_painter'` (NOT a // comment, which stripComments removes per the Phase 7 gotcha) into a registered core, confirm the guard fails, then revert.
- No PER-FRAME perf gate runs as an acceptance bar here (P0 only RECORDS the baseline; it has no baseline to beat). Capturing the perf, screenshot, and mobile-layout baselines IS the deliverable. The mobile_* scripts must be recorded as PASS on the untouched tree (or any RED surfaced per the stopping rules, not silently absorbed).
Review dispatch (state.md Review Dispatch Matrix): this is test/doc-only, presentation-adjacent. Spawn qa-checklist ONLY (correctness + test-coverage + dead-code), prompted for COVERAGE. No privacy-security-review / migration-safety / cross-platform-sync (no server/net/IWorld/sim surface touched). Do not commit until qa-checklist reports no BLOCKING.

STEP 4 - COMMIT CADENCE: 2-5 Conventional Commits, scoped, EXPLICIT paths. Example:
- `test(css): add css_corpus section-completeness guard over inline + src/styles union (tests/css_corpus.test.ts)`
- `test(arch): parameterize UI-purity guard with UI_PURE_CORES allowlist (tests/architecture.test.ts)`
- `docs(frontend): record v0.16.0 perf + visual + mobile baselines (docs/frontend-modernization/perf-baseline-v016.md, visual-baseline-v016.md, mobile-baseline-v016.md)`
- `docs(frontend): update progress.md + state.md ledger for P0`
Group the three baseline artifacts into one commit or split per artifact; keep paths explicit, never `git add -A`.

STEP 5 - ACCEPTANCE CRITERIA: every item green and verifiable.
- [ ] tests/css_corpus.test.ts exists, reads the inline <style> of index.html + play.html UNION src/styles/*.css, splits on the LIVE 10-dash `/* ---------- name ---------- */` markers, and PASSES with the full corpus inline.
- [ ] The corpus guard captured ALL ~47 index + ~45 play markers (count asserted; not a vacuous zero-match pass), and bare prose comments are treated as body, not boundaries.
- [ ] tests/architecture.test.ts carries a UI_PURE_CORES allowlist seeded with V16's existing cores; it rejects three / *_painter / painter_host / DOM-global imports in a registered core and PASSES with no product-code edit.
- [ ] `npx tsc --noEmit` clean; `npm test` green (full suite, for the source-grep guards); `biome check` clean on the new/changed .ts.
- [ ] Negative proof fired then reverted for BOTH guards, plus the 4-dash vacuous-marker check confirming the corpus regex would have silently passed on the wrong pattern.
- [ ] perf-baseline-v016.md recorded: hudHotDomSkipRate (durable anchor) + frameP95 + inputIntentToFrameP95 for desktop and mobile, WITH the dev-server prerequisite, exact command + flags, and the machine spec, and the same-machine-relative framing on the ms numbers stated.
- [ ] visual-baseline-v016.md recorded: the scripts/*_shot.mjs reference images (or their stable hashes) + the exact command, as the screenshot-diff floor for later CSS phases.
- [ ] mobile-baseline-v016.md recorded: each of the six V16 mobile_* E2E scripts run, command + prerequisite captured, and each PASS state recorded (any RED surfaced per the stopping rules, never absorbed).
- [ ] ZERO product code moved (no hud.ts, no CSS, no src/sim / server / src/net / headless edit); perf_tour, the screenshot suite, and the mobile scripts were RUN, not edited.
- [ ] qa-checklist reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY: update progress.md (P0 row -> done, with the baseline numbers + the mobile-script PASS set) and state.md (mark P0 status done in the ledger; note the THREE recorded baseline file paths; record the gate file names so later phases cite them). Record surprising rules in memory (the stripComments-strips-comments perturbation gotcha if re-hit; the 10-dash-vs-4-dash vacuous-pass trap; the exact perf_tour command + profile flags + machine spec; whether any mobile_* script was RED on the green tree).

STEP 7 - FINAL RESPONSE: status, files changed/added, validation results (tsc, biome, both guards green + each negative proof fired then reverted incl the vacuous-marker check, qa-checklist verdict), the recorded perf numbers (with the hudHotDomSkipRate anchor and the same-machine framing on frameP95), the screenshot-baseline location, the mobile-script PASS set, any deferrals, and end with the handoff line: "Next: phase-01-css-lightning-tokens-base.md".

STOPPING RULES:
- STOP and surface if either guard cannot pass on the current green tree WITHOUT editing product code (means an existing core already violates purity, or a CSS section is unaccounted for; that is a finding, not a fix-it-here task).
- STOP and surface if the css_corpus marker regex captures ZERO (or far fewer than the ~47 + ~45 expected) sections: a vacuous pass is a false green, not a deliverable.
- STOP if perf_tour cannot run in a given profile (desktop or mobile) and record which profile is missing rather than fabricating a number; same for any scripts/*_shot.mjs scene that cannot render.
- STOP and surface if any mobile_* E2E script is RED on the untouched green tree (record it as RED; do not fix it here and do not absorb it into a "PASS" baseline; a broken responsive floor is a finding for the user, decision 16).
- STOP if implementing a gate requires extending IWorld or touching src/sim / server / src/net (scope change per state.md decision 4).
```

## Notes for the planner

P0 is shaped as gates-before-motion because every later phase's acceptance ("css_corpus zero rule
loss", "purity guard passes", "skip-rate held", "no responsive regression", "no visual diff") is
meaningless until these artifacts exist and are proven to bite. The dominant risk is a false-green
guard, and the deep review found the original draft carried two: a 4-dash marker pattern that matches
nothing in V16's actual 10-dash `/* ---------- name ---------- */` markers (a vacuous pass), and a
corpus keyed on the inline blocks alone, which would report "rule lost" the moment P1-P4b legitimately
move a section into src/styles/. Both are fixed here: the corpus is the inline UNION src/styles/*.css
keyed on the same 10-dash markers so coverage is CONSERVED across the migration, and the negative-proof
step now also asserts the marker regex is non-vacuous. The perf floor is split by portability: the
durable anchor is the machine-independent hudHotDomSkipRate ratio, while frameP95 / inputIntentToFrameP95
are recorded only as same-machine-relative numbers (with the dev-server prerequisite and machine spec
captured) because wall-clock ms does not travel across hardware. Two new baselines close the gap that
css_corpus is CSS-TEXT-complete yet layout-blind (decision 16): a screenshot baseline via the shipped
scripts/*_shot.mjs suite, and a mobile-layout baseline recording the six V16 mobile_* E2E scripts' PASS
state as the blocking RESPONSIVE floor P4a/P4b and the per-frame phases gate against. Keeping it strictly
test/doc-only de-risks every downstream phase: P1-P4b inherit a corpus guard plus a screenshot + mobile
floor that catch a dropped rule, a cascade shift, or a lost breakpoint; P6-P9b inherit a purity allowlist
that catches a core importing a painter; and P10a-P14b inherit a recorded perf floor to regress the DOM
skip-rate (and same-machine frameP95) against. The perf_tour re-author and the standing
hud_perf_budget.test.ts are P17a, not P0.
