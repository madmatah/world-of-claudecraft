# Phase P12a: Per-frame: action bar (multi-bar descriptor) + the allocation-budget spike

Lift the action bar (hud.ts:3829-3931) into a pure core plus thin painter behind the elision cache,
built THROUGH a bar-descriptor seam so a 2nd/3rd bar later is `new ActionBarPainter(descriptor)` with
no code change, and elide the per-frame aria-label WITHOUT dropping its `t()` call. This phase also
RESOLVES the packet's one open spike: the allocation-budget proxy (recon open-decision 4) that every
later per-frame phase reuses.

## Starter Prompt

```
This is Phase P12a of the Frontend Modernization v0.16.0 packet: Per-frame extraction, the action bar
through a multi-bar descriptor seam, plus the allocation-budget spike.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. This is a per-frame slice that carries TWO of the packet's named top-risks (the
action-bar aria-label i18n+a11y+allocation triple-hazard, and the write-elision regression) PLUS the
packet's only unresolved spike (the allocation-budget proxy). Fan out: one subagent on the core +
painter + tests, one subagent spiking the allocation-budget proxy in parallel (it is independent of
the core shape), then integrate and gate together. Adversarial verify the elision and the proxy.

Goal: Extract the action bar (hud.ts:3829-3931) out of the Hud monolith into a pure core
(src/ui/action_bar_view.ts) plus a thin painter (src/ui/action_bar_painter.ts), each routing every DOM
write through the existing write-elision helpers (hud.ts:1322-1372) via PainterHost. The core takes a
BAR DESCRIPTOR (the slot set: each slot's ability-id source; the per-slot keybind label; NO DOM in the
core, the descriptor carries slot identity not element refs) plus IWorld, and returns a REUSED
preallocated per-slot state array (mutate in place, no per-frame array/object garbage). The four slot
kinds are attack / empty / item / ability. Each slot state carries the slot kind, the ability or item
id, the icon key, cooldown remaining/total, usable/range state, the keybind label, and the rendered
aria-label string (resolved by the core via an INJECTED t(), so the painter never concats). The painter
is constructed as new ActionBarPainter(descriptor) (the descriptor carries the container element + the
per-slot button elements + the keybind set), so multiplicity is a constructor arg, not a hardcoded id;
this phase builds ONLY the one existing bar through that seam. The painter elides the aria-label via a
per-button cache keyed on the rendered t() string while KEEPING the t() call (no concat, no ?? 'English'
fallback, no default param). This phase ALSO RESOLVES the allocation-budget proxy spike (recon
open-decision 4): determine whether a Node-measurable per-frame-garbage proxy is viable, and if not,
settle the fallback (perf_tour frameP95 + longtasks) as the budget that every later per-frame phase
(P12b, P13b, P17) inherits. Reuse the existing elision helpers and the PainterHost from P6; do not
re-derive infra.

STEP 0 - PRE-FLIGHT:
- Run git status; it MUST be clean. This worktree may be shared by a concurrent session; if it is
  dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch
  feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the frontend phase entries, especially
  [Frontend Phase 7 HUD window extraction] (the PainterHost seam + the forbiddenUiCoreImport guard +
  the "inject a REAL code line, a // comment is stripped" purity-guard gotcha + run the FULL suite for
  source-guards), [Frontend Phase 8 graphics-tier effects] (write-elision + live computed-style proof
  discipline), and [Phased-packet QA cadence] (phase then its QA, never skip). Note [No em dashes or
  emojis].
- This phase depends on P0 (perf baseline recorded), P6 (PainterHost seam present), and P10a (the
  write-elision facet EXTENSION with setStyleProp/toggleClass, state.md decision 5a). Confirm all three
  landed: scripts/perf_tour.mjs has a recorded baseline, src/ui/painter_host.ts exists, and the host
  exposes setStyleProp/toggleClass. If P0's baseline is missing, STOP: the perf gate cannot run.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps) the
orchestrator keeps:
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 9, 10, 12, 15; the non-negotiable
  constraints, ESPECIALLY the action-bar aria-label t()-must-survive rule; decision 9's
  instance-parameterized FAMILY contract, the action-bar descriptor seam, the second/third bar is a
  follow-on FEATURE not this phase; decision 10's WCAG 2.2 AA controls + target-size >=24px and >=40x40
  on mobile; decision 12's no-magic-values-in-painters; decision 15's ClientWorld-vs-Sim parity; the
  canonical workflow STEP 0-7; the validation matrix incl the PER-FRAME row, the P12a allocation-budget
  assertion, the WINDOW/CONTROL a11y row, and the no-magic-values painter guard; the Review Dispatch
  Matrix; Top risks 1, 4). Cite state.md by section; do not re-derive these.
- This phase file.
- The "### P12" section of docs/frontend-modernization/v016-recon-and-packet.md, plus the "Load-bearing
  structural findings" and "Top risks" sections (especially risk 1: write-elision regression; risk 4:
  the action-bar aria-label). Reference recon sections by NAME (its line numbers shifted after the
  AMENDED note block was inserted near the top). NOTE: the recon's allocation-budget item is OPEN
  (open-decision 4); this phase CLOSES it.
- The specific V16 source ranges this phase touches, read narrowly with offset+limit:
  - hud.ts:1322-1372 (the write-elision helpers setText/setDisplay/setTransform/setWidth +
    hotWriteCache), perfStats() / the hotDomWrites / hotDomSkippedWrites / hotDomSkipRate counters, and
    the P10a setStyleProp/toggleClass extension.
  - hud.ts:3627 (Hud.update frame divider) and how the every-frame / fastHud (>=100ms) / mediumHud
    (>=250ms) / slowHud (>=500ms) tiers gate the action-bar block.
  - hud.ts:3829-3931 (action bar: slot iteration, the four slot kinds attack/empty/item/ability, the
    icon write, the cooldown overlay write, the usable/range dimming, the per-frame aria-label
    setAttribute via t(), the keybind label, the slot container/button element ids the descriptor must
    capture).
  - src/ui/painter_host.ts (the P6 dep-bag: icon/money/tooltip helpers + the elided writers + the P10a
    setStyleProp/toggleClass facet).
  - tests/architecture.test.ts (UI_PURE_CORES allowlist + forbiddenUiCoreImport + the no-magic-values
    painter guard) and tests/hud_perf_budget.test.ts + scripts/perf_tour.mjs (the P0 baseline +
    skip-rate + longtasks counters; this is where the allocation proxy lands or is documented).
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Use ultracode with a Workflow fan-out: slice A on the action-bar core + painter + tests, slice B on the
allocation-budget spike (independent of the core shape, so run in parallel), then integrate into hud.ts
and run the shared perf + alloc gate. hud.ts is the only shared file; integrate it sequentially at the
end.

Slice A - Action bar (hud.ts:3829-3931), built through the multi-bar descriptor seam:
- Add src/ui/action_bar_view.ts: a pure core taking a BAR DESCRIPTOR (the slot set: each slot's
  ability-id source; the keybind set: per-slot keybind label; NO DOM in the core, the descriptor
  carries slot identity, not element refs) plus IWorld, and returning a REUSED preallocated per-slot
  state array (mutate in place, no per-frame array/object garbage). Each slot state carries the slot
  KIND (a discriminated union of the four kinds attack / empty / item / ability), the ability or item
  id, the icon key, cooldown remaining/total, usable/range state, the keybind label, and the rendered
  aria-label string. The core resolves the aria-label string via an INJECTED t() (passed in as a
  dependency so the core stays i18n-mechanism-free yet still produces the final localized string, and
  the painter never concats). The descriptor is the FAMILY parameter (decision 9): the core is
  instance-free, so a 2nd/3rd bar is another descriptor, not a code fork. Register in the UI_PURE_CORES
  allowlist (tests/architecture.test.ts). Allocation-light: the returned array is the SAME reference
  across calls.
- Add src/ui/action_bar_painter.ts: a thin painter consuming the core via PainterHost, constructed as
  new ActionBarPainter(descriptor) (the descriptor carries the container element + the per-slot button
  elements + the keybind set), so multiplicity is a constructor arg, not a hardcoded id. It elides the
  aria-label via a per-button cache keyed on the rendered t() string (the core supplies the string; the
  painter compares to the cached value and only setAttribute on change). KEEP the t() call (no concat,
  no ?? 'English' fallback, no default param, no setAttribute('aria-label', ...) outside the elided
  path). Elide icon writes (cache lastIcon) and cooldown overlay writes (cache cdOverlay) through the
  host's elided writers; route any class toggle (usable/dimmed/on-cooldown) through the P10a
  toggleClass facet and any CSS-var write (cooldown sweep fraction) through setStyleProp. No raw
  el.style / el.textContent / el.setAttribute that the helpers do not own (document any unavoidable raw
  write per decision 5a).
- A11y (decision 10, WCAG 2.2 AA): each action button is a proper control (a real <button> or
  role="button"; the elided aria-label; keyboard-activatable; visible :focus-visible never animated
  away) with a target-size >=24px absolute, and prefer the existing 40x40px touch floor on mobile, do
  NOT weaken it. If the existing markup is already a button, KEEP its semantics and only ensure the
  label/focus/target-size hold; do not regress them.
- No-magic-values (decision 12): the painter drives tokens / CSS custom properties, never a literal
  hex/px/color in TS; every threshold (cooldown sweep cutoff, the 24px and 40px target-size floors, the
  dim/usable opacity) is a NAMED CONSTANT, not an inline number. The no-magic-values painter guard must
  pass.
- Add tests/action_bar_view.test.ts: same-input-same-output; the returned array is the SAME reference
  across calls (no realloc); a SECOND descriptor produces an independent core/state (proves the family
  seam, no single-instance global); the four slot kinds (attack/empty/item/ability) each classify
  correctly; and the ClientWorld-vs-Sim parity assertion (decision 15): drive the core with BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub and assert identical slot state (the ability
  cooldown / usable / range fields are exactly the online-mirror shape, not a Sim-only field).
- Add tests/action_bar_painter.test.ts (DOM-light harness): the painter routes ALL writes through the
  host's elided writers (no raw style / textContent / setAttribute beyond the documented allowed
  write); and the aria-label elision test: NO per-frame setAttribute when the rendered string is
  unchanged, while t() is STILL invoked each frame (assert the injected t() spy was called and the
  setAttribute spy was not).

Slice B - The allocation-budget proxy spike (recon open-decision 4, RESOLVED HERE):
- Determine whether a Node-measurable proxy for per-frame garbage is viable. Candidate approaches, in
  order of preference: (1) drive the action-bar core N times in a Vitest with a counting allocator or a
  before/after object-count assertion (the core returns the SAME array reference, so a correct core
  allocates zero new per-frame arrays/objects; assert that directly); (2) a process.memoryUsage()
  heapUsed delta across many core calls with forced GC (--expose-gc) as a coarse proxy; (3) if neither
  is reliable in-process, FALL BACK to the perf_tour frameP95 + longtasks signal in scripts/perf_tour.mjs
  and document that the allocation budget degrades to that fallback.
- WHICHEVER resolves: write it down as the canonical allocation-budget assertion in state.md and
  progress.md so P12b (auras), P13b (FCT), and P17 reuse THE SAME proxy. The acceptance for THIS phase
  is that the action-bar core demonstrably allocates no new per-frame array/object (the reused-array
  reference test is the floor; the chosen proxy is the gate).
- If the in-process proxy is viable, add it as a small reusable helper (e.g. a test util) the later
  per-frame phases import; if it falls back to perf_tour, ensure perf_tour emits the longtasks figure
  the budget reads.

Then integrate into hud.ts: replace the inline action-bar block at 3829-3931 with a call into the new
painter wired through PainterHost (the painter constructed with the single existing bar's descriptor),
removing the dead inline code. Update client_shell.test.ts if any DOM id moved into the painter
(decision 17: hud.ts stays the wiring hub; the line count drops as the inline block becomes a painter
call).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only (decision 4). CONSUME V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim / server / src/net / headless. If you find you need to, STOP and surface it (scope change).
- Per-frame writes route through the existing write-elision cache (hotWriteCache +
  setText/setDisplay/setTransform/setWidth, hud.ts:1322-1372) plus the P10a setStyleProp/toggleClass
  facet (decision 5a) via PainterHost. No raw style/textContent/setAttribute the helpers do not own; if
  one write is genuinely unavoidable, document it per decision 5a and the routing test asserts only the
  writers that exist. No reactivity, Shadow DOM, or signals.
- Pure core is allocation-light (no per-frame garbage) and DOM/Three-free; no Math.random / Date.now /
  performance.now in the registered core (guarded by tests/architecture.test.ts). Same input gives same
  output.
- DECISION 9 (component contract): the action_bar core + painter are INSTANCE-PARAMETERIZED by a bar
  descriptor (no hardcoded element ids, no single-instance assumption). This phase builds ONLY the one
  existing bar through that seam. It does NOT add a second/third bar (that is a follow-on FEATURE
  inheriting this seam; out of scope, see below).
- DECISION 10 (WCAG 2.2 AA chrome): action buttons are proper controls (role/label/keyboard, visible
  :focus-visible, target-size >=24px and >=40x40 on mobile). The aria-label elision KEEPS the t() call:
  no concat, no ?? 'English' fallback, no default param. Any NEW control label goes in
  src/ui/i18n.catalog/hud_chrome.ts (English-only); never edit i18n.locales/<lang>.ts.
- DECISION 12 (no magic values in painters): the action-bar painter drives tokens / CSS custom
  properties, never a literal hex/px/color in TS; every threshold and cadence is a NAMED CONSTANT. The
  no-magic-values painter guard must pass.
- DECISION 15 (ClientWorld-vs-Sim parity): the action_bar_view test feeds BOTH a Sim-shaped and a
  ClientWorld-mirror-shaped IWorld stub; do not assume a Sim-only field shape.
- No generated-file hand-edits; regenerate via the build.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).

Out of scope (do NOT do in this phase):
- ADDING a second/third action bar or any new bar instance: the descriptor seam is built here, but
  actually wiring extra bars / extra slot sets is a follow-on FEATURE that inherits this seam (per
  decision 9), NOT this refactor. Build the one existing bar only.
- Auras keyed pool + minimap markers (P12b).
- FCT pool + per-frame driver (P13a/P13b).
- Per-element graphics tiering of the action bar (P14a).
- xp bar / swing timer / player frame + unit_frame family (P10a/P10b), cast bars / target frame / party
  frames (P11a/P11b/P11c).
- Any CSS changes (P1-P4) or ui_effects_profile changes (P5).
- Extending IWorld or any sim/server/net change.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: npx tsc --noEmit.
- Pure core added: npx vitest run tests/action_bar_view.test.ts + npx vitest run
  tests/architecture.test.ts (the UI-purity guard + the no-magic-values painter guard) + the
  same-input-same-output assertion + the SAME-array-reference (no-realloc) assertion + the
  ClientWorld-vs-Sim parity assertion (decision 15; both stub shapes). Verify the purity guard FAILS
  when you inject a REAL DOM/import code line into the core (a // comment is stripped by stripComments;
  inject an actual code line).
- New .ts module added: biome check on the new/changed .ts (src/ui/action_bar_view.ts,
  src/ui/action_bar_painter.ts, and any new test util); do not accrue lint debt.
- WINDOW/CONTROL a11y row (the action buttons are CONTROLS, decision 10): the WCAG 2.2 AA checks on the
  built bar (automated axe-core or equivalent: real buttons with the elided aria-label; keyboard
  reachability + focus-return; visible :focus-visible never animated away; a forced-colors: active
  snapshot keeps borders/meaning; target-size >=24px, and >=40x40 on the mobile touch layout). Plus the
  no-magic-values painter guard (decision 12; the painter references tokens/vars, not literal hex/px).
- PER-FRAME perf gate: npm run the perf_tour harness (desktop + mobile) and assert frameP95 <= the P0
  baseline AND hudHotDomSkipRate >= the P0 baseline. PLUS the allocation-budget assertion settled by
  the slice-B spike: the action-bar core allocates no new per-frame array/object (the reused-array
  reference test is the floor), measured by the chosen proxy (in-process counter if viable, else
  perf_tour frameP95 + longtasks per the documented fallback).
- A unit test that the painter routes ALL writes through the host's elided writers (no raw
  style / textContent / setAttribute beyond a documented allowed write), and the aria-label elision
  test (no per-frame setAttribute when unchanged, t() still called).
Review dispatch (Review Dispatch Matrix): qa-checklist only. This is presentation-only; it consumes the
already-landed IWorld in a painter, so cross-platform-sync, privacy-security-review, and
migration-safety do NOT fire (the ClientWorld-vs-Sim obligation is covered by the per-core parity test,
not by spawning cross-platform-sync). Prompt the reviewer for COVERAGE not filtering; resume a
truncated reviewer per the state.md script. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths (no git add -A). Suggested:
- feat(ui): extract action_bar_view core, descriptor-parameterized, core-resolved aria-label
  (paths: src/ui/action_bar_view.ts, tests/action_bar_view.test.ts, tests/architecture.test.ts)
- feat(ui): add ActionBarPainter, elided aria-label keeps t(), elided icon/cooldown/class writes
  (paths: src/ui/action_bar_painter.ts, tests/action_bar_painter.test.ts)
- test(ui): resolve the allocation-budget proxy spike (reused-array + chosen proxy)
  (paths: tests/..., scripts/perf_tour.mjs if the fallback emits longtasks)
- refactor(ui): wire ActionBarPainter into hud.update, drop the inline action-bar block
  (paths: src/ui/hud.ts, tests/client_shell.test.ts)
- docs(frontend): record P12a + the resolved allocation-budget proxy in progress.md + state.md
  (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)
TAG the green-perf-gate commit (decision 6 / Step 6) so a later cumulative regression bisects to this
phase.

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes.
- [ ] The action bar is driven by a pure core (action_bar_view) plus a thin painter
  (ActionBarPainter); the inline block at hud.ts:3829-3931 is replaced by a painter call.
- [ ] The core takes a BAR DESCRIPTOR and returns a REUSED preallocated per-slot state array (SAME
  reference across calls; no per-frame array/object garbage); the four slot kinds attack/empty/item/
  ability each classify correctly; the aria-label string is resolved IN the core via the injected t().
- [ ] DECISION 9: the core + painter are INSTANCE-PARAMETERIZED (no hardcoded element id, no
  single-instance assumption); a test proves a SECOND descriptor yields an independent core/state. This
  phase builds ONLY the one existing bar; no second/third bar is wired (deferred feature).
- [ ] The aria-label is elided via a per-button cache keyed on the rendered t() string and KEEPS the
  t() call: a test asserts NO per-frame setAttribute when unchanged while t() is STILL invoked, and
  there is no concat / ?? fallback / default param / out-of-band setAttribute.
- [ ] action_bar_view is registered in UI_PURE_CORES; npx vitest run tests/architecture.test.ts passes;
  the purity guard provably FAILS on an injected real DOM-import line in the core.
- [ ] DECISION 15: the core test drives BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub
  with identical output.
- [ ] A painter routing test asserts no raw style / textContent / setAttribute on the hot path beyond a
  documented allowed write (decision 5a); class/CSS-var writes route through setStyleProp/toggleClass.
- [ ] DECISION 10 a11y: action buttons are real controls (role/label/keyboard, visible :focus-visible,
  target-size >=24px and >=40x40 on mobile); the forced-colors snapshot keeps borders/meaning; the
  chrome a11y checks pass.
- [ ] DECISION 12 no-magic-values: the painter drives tokens / CSS custom properties with no literal
  hex / px / color in TS; the no-magic-values painter guard passes.
- [ ] biome check passes on the new/changed .ts.
- [ ] The ALLOCATION-BUDGET PROXY is RESOLVED (recon open-decision 4): the chosen proxy (in-process
  counter or the documented perf_tour frameP95 + longtasks fallback) is recorded in state.md and
  progress.md, and the action-bar core meets it.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND
  hudHotDomSkipRate >= P0 baseline; the numbers are recorded; the green-perf-gate commit is tagged.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; no new i18n keys (or a single English-only
  hud_chrome.ts key if a label was unavoidable).

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P12a done with the new files (action_bar_view, action_bar_painter + tests), the
  perf-gate numbers vs the P0 baseline, and the RESOLVED allocation-budget proxy (what it is, where it
  lives).
- state.md: ledger row P12a -> done; add action_bar_view to the "Existing pure cores to REUSE" list;
  note the action-bar descriptor seam is in place (decision 9 multiplicity ready, extra bars are a
  follow-on feature); and RECORD the allocation-budget proxy decision (recon open-decision 4 resolved)
  so P12b/P13b/P17 reuse it (NOT a P15 reference; the consumers are P13/P17 plus P12b).
- Memory: record the surprising rules: the exact aria-label elision shape that keeps t() (per-button
  cache keyed on the rendered string, core resolves the string); the bar-descriptor seam shape; and
  whether a Node-measurable allocation proxy was viable or it fell back to perf_tour longtasks.

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), validation results (tsc, the core + painter test
files, architecture guard incl no-magic-values, biome, the a11y checks on the action buttons, the perf
gate numbers incl the resolved allocation-budget assertion), the qa-checklist verdict, and any
deferrals (adding extra bars -> follow-on feature; action-bar tiering -> P14a). End with exactly:
Next: phase-12b-perframe-auras-minimap.md

STOPPING RULES:
- STOP if the action-bar extraction regresses perf_tour frameP95 above the P0 baseline OR drops
  hudHotDomSkipRate below the P0 baseline; do not commit a perf regression, diagnose the raw-write or
  cache-key cause first.
- STOP if the action-bar aria-label cannot be elided without dropping the t() call or adding a concat /
  ?? fallback; the t() must survive.
- STOP if no Node-measurable allocation proxy is viable AND perf_tour cannot demonstrate the garbage
  reduction; surface it (recon open-decision 4) rather than claim the budget green. The fallback
  (perf_tour frameP95 + longtasks) is acceptable, but it must be RECORDED as the decision, not silently
  assumed.
- STOP if the P0 perf baseline is missing (the gate cannot run).
- STOP and surface a scope change if the phase finds it needs to extend IWorld or touch sim/server/net,
  OR if building the descriptor seam tempts you to add a real second bar (that is a follow-on feature,
  not this phase).
- If the working set approaches the ~40% context ceiling, STOP and split further before continuing.
```

## Notes for the planner

This is the first half of the old P12 split: it isolates the action bar (the single highest-risk hot
element of the batch, carrying Top risk 4, the aria-label i18n+a11y+allocation triple-hazard) and the
packet's one unresolved spike, the allocation-budget proxy (recon open-decision 4), so both land
together with a fresh-session budget that comfortably fits under the 40% ceiling including QA and
in-session remediation. The framing is decision 9 multiplicity: the action bar lands as an
instance-parameterized FAMILY (core + painter take a bar descriptor) so a 2nd/3rd bar later is
`new ActionBarPainter(descriptor)`, but this phase builds ONLY the one existing bar through that seam;
adding bars is a follow-on feature. The aria-label rule is the load-bearing correctness constraint: the
core resolves the localized string via an injected t() and the painter elides the setAttribute via a
per-button cache keyed on that rendered string, so t() keeps being called every frame (CLAUDE.md i18n)
while the DOM write only fires on change (the perf win), and there is never a concat or ?? fallback. The
allocation-budget spike is pulled forward HERE deliberately: P12a is the first phase whose core RETURNS
a reused preallocated array, so it is the natural place to prove a Node-measurable per-frame-garbage
proxy (the reused-array reference test is the floor) and to settle the fallback (perf_tour frameP95 +
longtasks) if no clean in-process proxy exists. Whatever resolves becomes the canonical assertion that
P12b (auras pool), P13b (FCT pool), and P17 (the standing budget) all reuse, so it is recorded in
state.md as a packet-level decision, not a phase-local note. Decision 10 a11y (real buttons, the elided
label, target-size >=24px and >=40x40 on mobile, a forced-colors snapshot), decision 12 no-magic-values,
and decision 15 ClientWorld-vs-Sim parity are all built IN here, not deferred to P15, so the first bar
sets the bar every later control inherits.
