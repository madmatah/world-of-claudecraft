# Phase P13b: Per-frame: FCT pooled painter + spawn-site migration + bounded-AoE gate

Flip floating combat text (FCT) onto the per-frame driver P13a stood up: build the pooled-div painter
(a fixed-size ring projected via `renderer.worldToScreen` with the `getUiScale` author-space divide,
behind-cull, class-token colors, FIFO-by-sequence eviction, a max-concurrent cap), migrate all 8 spawn
sites (the 7 `fct()` calls in 6100-6422 PLUS `showSelfNote` whose cross-file caller is `main.ts:1727`),
build (or explicitly defer) the combat-text live region, and prove the worst case with a scripted
AoE/boss burst that shows a bounded node count and `frameP95 <= baseline`. This is the half that
carries the dominant pool-lifecycle risk and the real acceptance bar (the perf gate).

## Starter Prompt

```
This is Phase P13b of the Frontend Modernization v0.16.0 packet: Per-frame: FCT pooled painter +
spawn-site migration + bounded-AoE gate. It is the SECOND of the two FCT halves (P13a landed the pure
fct_core + the dormant per-frame driver; this half builds the pooled painter, migrates every spawn
site onto it, and proves the bounded-node perf gate). FCT is the single highest-risk per-frame surface
because it is the only hot element with NO prior painter on V16; the dominant risk is POOL LIFECYCLE (a
recycle or eviction bug silently drops or duplicates combat text), and the AoE/boss worst case is the
bounded-node perf-gate scenario, so the gate is the real acceptance bar, not tsc + tests.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. The pooled painter + the 8-site spawn migration + the bounded-AoE perf gate is a
multi-surface hot-path change. Use ultracode + a Workflow: one slice builds the pooled painter (ring +
projection + eviction + cap + class-token colors), one migrates the spawn sites and verifies the
showSelfNote/main.ts:1727 precondition before deleting fct(), one builds/defers the combat-text live
region, then an adversarial verify pass over pool lifecycle (drop/duplicate/eviction) and the
bounded-node gate.

Goal: lift FCT off the per-event createElement+setTimeout path entirely onto the per-frame driver from
P13a. Build src/ui/fct_painter.ts: a painter on the PainterHost seam owning a FIXED-SIZE pooled-div
ring (preallocated DOM nodes, no per-event createElement). spawn(descriptor) claims a free slot or
EVICTS the oldest by sequence when at cap; the driver's step(now) advances each live entry, PROJECTS
its world anchor via renderer.worldToScreen, applies the getUiScale author-space divide for positioning
under zoom, BEHIND-CULLS, and recycles on TTL, writing ONLY through the PainterHost elided writers
(setTransform/setText/setDisplay + the P10a setStyleProp/toggleClass extension; NO raw
style/textContent/setAttribute). Migrate all 8 spawn sites (the 7 fct() calls at hud.ts:6100-6422 PLUS
showSelfNote at 7254-7256) to fctPainter.spawn(fct_core.describe(event, host.jitter())); migrate the 6
hardcoded FCT hex colors to CSS CLASS TOKENS and DROP el.style.color; VERIFY the main.ts:1727 caller of
showSelfNote keeps working; then delete the dead fct() helper (7258-7276). BUILD the combat-text live
region (a named-constant announce cadence + coalescing, never raw per-damage streaming) OR explicitly
DEFER it to P15a with a note (decision 10). Math.random for horizontal jitter is allowed HERE (on the
painter, feeding the injected value into the pure core).

STEP 0 - PRE-FLIGHT:
- Run git status; it MUST be clean. This is a shared checkout (concurrent sessions). If it is not
  clean, STOP and ASK the user; do not stash or revert someone else's work.
- Confirm you are in the /Users/fernando/Documents/wocc-v0.16.0 worktree on branch
  feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the frontend-modernization entries:
  frontend-architecture-vanilla-stack, phased-packet-qa-cadence, the prior per-frame batch entries
  (P10/P11/P12 if recorded; especially the keyed-pool lessons: a tooltip/listener closure must read a
  live MUTABLE slot record, not capture-by-value, or it goes stale after recycle), and the P13a entry
  (the fct_core descriptor shape + named constants + the spawn-site KIND/color enumeration). Also
  no-em-dashes-or-emojis and shared-worktree-commit-care.
- This phase depends on P0 (perf baseline recorded), P6 (PainterHost two facets), P10a (the elided-
  writer EXTENSION setStyleProp/toggleClass, decision 5a), and P13a (fct_core registered + the dormant
  per-frame driver on the every-frame tier of hud.update()). Confirm all landed: scripts/perf_tour.mjs
  has a recorded P0 baseline, src/ui/painter_host.ts exposes both facets incl setStyleProp/toggleClass,
  src/ui/fct_core.ts exists and is in UI_PURE_CORES, and the FCT driver step(now) is already called on
  the every-frame tier (stepping a no-op stub). If the P0 perf baseline is missing, STOP: the
  bounded-AoE + frameP95 gate cannot run.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize back a tight summary (the orchestrator keeps the
summary, not raw dumps):
- docs/frontend-modernization/state.md: locked decisions 3 (write-elision), 5 + 5a (the per-frame
  Humble Object pattern + the elided-writer EXTENSION setStyleProp/toggleClass), 8 (FCT driver folds
  into hud.update, every-frame tier), 9 (component contract), 10 (WCAG 2.2 AA chrome + the combat-text
  LIVE REGION), 12 (no magic values in painters; the class-token color migration), 15
  (ClientWorld-vs-Sim parity); the non-negotiable constraints (the FCT PAINTER MAY use Math.random for
  jitter, the CORE may not); the canonical workflow; the validation matrix (the PER-FRAME row with the
  P13b bounded-node AoE-burst assertion + the elided-writer routing test, the WINDOW/CONTROL a11y row,
  the no-magic-values painter guard, the ClientWorld parity assertion); the Review Dispatch Matrix.
  Cite state.md by section; do not re-derive.
- This phase file.
- The '### P13' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the
  'Load-bearing structural findings' and 'Top risks' sections (risk 2 is this phase and explicitly
  flags getUiScale positioning, the 6-hex->class-token migration, and the showSelfNote/main.ts:1727
  precondition as easy-to-miss). Reference recon sections by NAME (its line numbers shifted after the
  AMENDED note block was inserted near the top).
- The SPECIFIC V16 source ranges only (by exact line number):
  - The current FCT helper private fct() at src/ui/hud.ts:7258-7276 (createElement div, className
    'fct'/'fct crit', el.style.color = color at 7267, worldToScreen at 7259, behind-cull at 7264,
    left/top divided by getUiScale() at 7270, Math.random()*30-15 jitter at 7271, textContent, append
    to #ui, setTimeout(..., 1250) remove). This is the EXACT behavior the painter must reproduce; you
    DELETE it once nothing references it.
  - showSelfNote at src/ui/hud.ts:7254-7256 (this.fct(this.sim.player, text, color='#ff8c66', false)),
    the 8TH spawn site, with the cross-file caller at src/main.ts:1727
    (hud.showSelfNote(t('hud.combat.cannotMove'))). You MUST migrate showSelfNote AND verify main.ts:1727
    still works BEFORE deleting fct().
  - The 7 fct() calls in the SimEvent switch at src/ui/hud.ts:6100-6422 with their COLOR LITERALS to
    migrate to class tokens: miss/dodge (6100-6105, '#bbb' on self else '#fff'), player damage done
    (6122-6124, ability '#ffe97a' else autoattack '#fff', crit flag), damage taken (6138, '#ff5544',
    crit flag), heal (6155, '#3ce63c'), xp (6166, '#b974ff'), rested xp (6168-6172, '#4a9eff'), heal
    crit (6422, '#3ce63c', crit flag). These hexes (the FCT palette: '#bbb','#fff','#ffe97a','#ff5544',
    '#3ce63c','#b974ff','#4a9eff','#ff8c66') become CSS class tokens keyed by descriptor kind; the
    painter sets the class (via the elided toggleClass), NOT el.style.color (decision 12).
  - Hud.update() at src/ui/hud.ts:3627 and the FCT driver step(now) call P13a added on the EVERY-FRAME
    tier (you fill in the pool body it steps; the call site already exists).
  - getUiScale at src/ui/hud.ts:288 (import) and its use at 7270 (the author-space divide); this is
    LOAD-BEARING for FCT positioning under zoom. The painter divides the projected x/y by getUiScale()
    exactly as the live fct() does, and a positioning test must assert it.
  - The write-elision helpers + hotWriteCache at src/ui/hud.ts:1322-1372 (setText/setDisplay/
    setTransform/setWidth) plus the P10a EXTENSION setStyleProp/toggleClass on the PainterHost
    write-elision facet, and perfStats() (hotDomWrites/hotDomSkippedWrites/hotDomSkipRate). Every
    painter write routes through these.
  - renderer.worldToScreen signature + return shape ({x, y, behind}); the painter projects each live
    entry's world anchor every frame.
  - The existing per-frame painter + PainterHost pattern landed by P10/P11/P12 (how a painter receives
    the two facets + the elided writers; the keyed-pool tooltip/listener live-slot rule from P11c/P12b)
    so this painter matches the seam and avoids the stale-closure bug.
- Apply THE 40% RULE: this is already the painter+migration HALF of the FCT split. If the working set
  still approaches the ceiling, STOP and surface it rather than degrade.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (ultracode Workflow, fan out EXPLICITLY):
Slice A (pooled painter, src/ui/fct_painter.ts):
- A painter built on the PainterHost seam (the two facets from P6 + the P10a elided-writer extension).
  Owns a FIXED-SIZE pooled-div ring: FCT_POOL_CAP preallocated DOM nodes (a named constant; choose by
  the AoE worst case, e.g. comfortably above a boss pull's simultaneous floaters), NO per-event
  createElement. Each slot is a MUTABLE record (live entry: descriptor, spawn sequence number, spawn
  time, world anchor, slot element). spawn(descriptor) claims a free slot or, when at cap, EVICTS the
  oldest by SEQUENCE (FIFO-by-sequence) and reuses its slot; assign a monotonically increasing sequence
  number per spawn (this is the eviction key). The driver's step(now) iterates live slots: PROJECT the
  anchor via renderer.worldToScreen, BEHIND-CULL (hide via the elided setDisplay if v.behind), apply the
  getUiScale() author-space divide to x/y (positioning under zoom, exactly as fct() did at 7270),
  advance the rise toward TTL, and RECYCLE the slot on TTL expiry (return it to the free list, clear via
  the elided writers). Color comes from a CSS CLASS TOKEN keyed by descriptor kind (toggled via the
  elided toggleClass); DROP el.style.color entirely. Crit stays the 'crit' class. Positioning, text,
  visibility, transform, and color-class are ALL written through the host's elided writers
  (setTransform/setText/setDisplay/setStyleProp/toggleClass); NO raw style/textContent/setAttribute on
  the per-frame path.
- Math.random for the horizontal jitter is allowed HERE: host.jitter() (or a painter-local Math.random)
  produces the 0..1 value fed into fct_core.describe(); the CORE stays Math.random-free. Document this.
- A tooltip/listener-free element is simplest; if any per-slot listener is needed it reads the LIVE
  mutable slot record, never a captured-by-value snapshot (the P11c/P12b stale-closure hazard).
Slice B (spawn-site migration + fct() deletion, src/ui/hud.ts + src/main.ts verification):
- Migrate each of the 7 fct() calls at hud.ts:6100-6422 to build an FctEvent (kind + the
  already-t()-resolved text + the world anchor entity + crit flag) and call
  fctPainter.spawn(fct_core.describe(event, host.jitter())). The per-kind COLOR moves from the hex
  argument to the descriptor's color-class discriminator; the painter applies the class token.
- Migrate showSelfNote (7254-7256) to the same path (kind selfNote). VERIFY the cross-file caller at
  src/main.ts:1727 (hud.showSelfNote(t('hud.combat.cannotMove'))) still compiles and renders; keep
  showSelfNote's public signature (text, optional color) so main.ts is unaffected, mapping the optional
  color to the selfNote class token.
- ONLY after all 8 sites are migrated and main.ts:1727 verified: DELETE the dead private fct()
  (7258-7276) and confirm no setTimeout-based teardown remains (the pool TTL replaces it).
Slice C (combat-text live region, decision 10):
- FCT IS the combat-text live region surface named in decision 10. EITHER build it now: a polite
  aria-live region (role=status / aria-live=polite) fed a COALESCED, named-constant announce cadence
  (a FCT_ANNOUNCE_CADENCE_MS divider that batches recent combat text into a periodic summary, NEVER raw
  per-damage streaming which would flood a screen reader), the live-region label an English-only
  hud_chrome.ts t() key. OR explicitly DEFER it to P15a with a clear NOTE in the phase report and a
  one-line TODO marker referencing P15a (decision 10 allows building it here or deferring to P15a, but
  the choice must be explicit, not silent). If you build it, the announce text is t()-resolved; if you
  defer, record exactly what P15a must build.
Verify pass (adversarial): a fresh subagent reviews the diff for (a) POOL LIFECYCLE (no dropped or
duplicated combat text under rapid spawn; correct TTL recycle; FIFO-by-sequence eviction never exceeds
the cap; no stale-closure slot read), (b) that EVERY painter write goes through the host's elided
writers (no raw style/textContent/setAttribute; el.style.color is GONE), (c) that all 8 sites are
migrated and fct() is deleted with main.ts:1727 verified, and (d) the getUiScale author-space divide is
applied (positioning under zoom). Prompt for COVERAGE not filtering.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): consume V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim, server, src/net, or headless. Server authority untouched. If this phase finds it needs to
  extend IWorld, STOP and surface it (scope change).
- Determinism for cores: the FCT CORE (fct_core, from P13a) stays Math.random/Date.now/performance.now
  -free and is in UI_PURE_CORES; the FCT PAINTER MAY use Math.random for jitter (explicitly allowed,
  feeding the injected value into the core). The painter is NOT in the purity allowlist.
- Write-elision routing (decisions 3, 5, 5a): ALL painter DOM writes go through the host's elided
  writers (setText/setDisplay/setTransform/setWidth + the P10a setStyleProp/toggleClass). NO raw
  el.style/textContent/setAttribute on the per-frame path; el.style.color is REMOVED in favor of a
  class token; cache keys stay byte-identical so the skip-rate holds.
- NO MAGIC VALUES (decision 12): the painter drives CSS class tokens / custom properties, NEVER a hex
  in TS; FCT_POOL_CAP, FCT_ANNOUNCE_CADENCE_MS (if the live region is built), and any other threshold
  are named constants. The 6 hex FCT colors are migrated to class tokens; no color literal survives in
  the painter. The no-magic-values painter guard must pass.
- ACCESSIBILITY (decision 10): the combat-text live region is either BUILT (polite, coalesced, named-
  constant cadence, t()-labelled) or explicitly DEFERRED to P15a with a note. FCT divs themselves are
  decorative transient text, not focusable; do not introduce a focus trap. The 3D canvas stays out of
  a11y scope. The WINDOW/CONTROL a11y row applies to the live region surface this phase touches.
- Component contract (decision 9): the painter is instance-clean (the pool is parameterized by cap +
  the #ui mount, no hardcoded element ids beyond the mount).
- ClientWorld-vs-Sim parity (decision 15): the painter's core consumption is tested with BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub (the anchor entity + the SimEvent kinds that
  spawn FCT mirror identically online); a positioning test asserts the getUiScale divide on both.
- Fold the driver into hud.update() (decision 8); NO second rAF (the step call already exists from
  P13a; you fill in the pool body).
- i18n: any player-visible FCT text is the already-t()-resolved string the spawn site passes (as the
  live callers do at 6102/6124/6166/etc.); the i18n-free core emits a discriminator, the painter never
  re-localizes. New live-region label (if built) is a single English-only key in
  src/ui/i18n.catalog/hud_chrome.ts; keep the t() call, no concat / no ?? fallback.
- No em dashes, en dashes, or emojis anywhere. Commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase; P14a or later):
- Per-element graphics tiering of FCT (max-concurrent/lifetime/drop-non-crit per fxLevel) -> P14a turns
  the pool's cap/lifetime/drop-non-crit knobs into pure functions of the static fxLevel.
- Nameplate formalization -> P14b.
- Any cold-window or CSS work; any new IWorld member or wire field (none in this packet).
- The standing hud_perf_budget.test.ts and the final purity sweep -> P17a.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (per-frame painter + pure-core consumption + a control/live
-region a11y surface):
- Baseline: npx tsc --noEmit.
- New .ts module guard: biome check on the new/changed .ts (src/ui/fct_painter.ts, src/ui/hud.ts, and
  src/main.ts if touched) (the V16 ratchet).
- Pure core (fct_core already registered): npx vitest run tests/architecture.test.ts (fct_core stays in
  UI_PURE_CORES; fct_painter is NOT) + the ClientWorld-vs-Sim parity assertion (decision 15: the
  painter's core consumption + the positioning test feed BOTH a Sim-shaped and a ClientWorld-mirror-
  shaped IWorld stub).
- PAINTER ROUTING TEST: tests/fct_painter.test.ts asserts the painter routes ALL writes through the
  host's elided writers (no raw style/textContent/setAttribute; el.style.color is GONE; color is a
  class token via toggleClass) AND the pool lifecycle: a FIXED cap (live node count NEVER exceeds
  FCT_POOL_CAP), correct TTL recycle, FIFO-by-sequence eviction reuses the oldest slot, no dropped or
  duplicated text under rapid spawn. A POSITIONING test asserts the projected x/y are divided by
  getUiScale() (positioning under zoom) and behind-culled when v.behind.
- NO MAGIC VALUES (decision 12): the no-magic-values painter guard passes; FCT_POOL_CAP / the
  announce cadence / any threshold are named constants; no hex color literal in fct_painter.ts; the FCT
  colors are CSS class tokens.
- WINDOW/CONTROL A11Y ROW (decision 10): if the combat-text live region is built, the WCAG 2.2 AA
  chrome checks over it (axe-core or equivalent: role=status/aria-live=polite present, coalesced not
  flooding, the label a t() key, a forced-colors: active snapshot keeps it readable, target-size N/A
  for a non-interactive live region). If deferred to P15a, record the boundary HONESTLY and note what
  P15a must build; do NOT silently skip the row.
- PER-FRAME PERF GATE (mandatory; the real acceptance bar): run scripts/perf_tour.mjs desktop AND
  mobile and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline. PLUS the
  P13b-specific BOUNDED-NODE AoE-BURST assertion authored in scripts/perf_tour.mjs: a scripted AoE/boss
  burst (many simultaneous combat events) shows the live FCT node count BOUNDED by FCT_POOL_CAP (never
  grows unbounded; the old createElement churn is eliminated) and frameP95 <= baseline. A unit-level
  FIFO-by-sequence eviction test backs the harness assertion (over-cap spawns evict the oldest by
  sequence, the cap is never exceeded). A failed perf gate BLOCKS marking the phase complete.
Review dispatch (only the rows the diff touches): qa-checklist (default; this completes the FCT
deliverable). privacy-security-review does NOT fire (no server/net/admin; the new Math.random is on a
UI painter, not src/sim or a registered pure core). cross-platform-sync does NOT fire (IWorld
unchanged; the ClientWorld parity obligation is covered by the per-core/positioning parity test).
migration-safety N/A. Prompt the reviewer for COVERAGE not filtering; resume a truncated reviewer per
the state.md script. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope + EXPLICIT paths):
- feat(ui): add pooled FCT painter with fixed-size FIFO recycling ring and class-token colors
  (paths: src/ui/fct_painter.ts, tests/fct_painter.test.ts)
- refactor(ui): migrate FCT spawn sites + showSelfNote to the pooled painter and remove fct()
  (paths: src/ui/hud.ts; src/main.ts if the showSelfNote caller needs verifying-only no edit)
- feat(ui): combat-text live region with coalesced announce cadence
  (paths: src/ui/fct_painter.ts or the live-region module, src/ui/i18n.catalog/hud_chrome.ts), OR
  the deferral note in the docs commit if deferred to P15a
- test(ui): perf-gate FCT AoE burst bounded-node count + FIFO eviction
  (paths: scripts/perf_tour.mjs, tests/fct_painter.test.ts)
- docs(frontend): record P13b in progress.md and state.md ledger; tag the green-perf-gate commit
  (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
[ ] npx tsc --noEmit passes.
[ ] biome check passes on src/ui/fct_painter.ts, the changed src/ui/hud.ts, and src/main.ts if touched.
[ ] The painter owns a FIXED-SIZE pooled-div ring (FCT_POOL_CAP preallocated nodes, no per-event
    createElement); the live FCT node count NEVER exceeds FCT_POOL_CAP.
[ ] All 8 spawn sites are migrated: the 7 fct() calls at hud.ts:6100-6422 PLUS showSelfNote
    (7254-7256) now call fctPainter.spawn(fct_core.describe(...)); the main.ts:1727 caller of
    showSelfNote is verified working; the old private fct() (7258-7276) and its setTimeout teardown are
    removed.
[ ] The 6 hardcoded FCT hex colors are migrated to CSS CLASS TOKENS keyed by descriptor kind; the
    painter applies the class via the elided toggleClass and el.style.color is GONE (decision 12).
[ ] The painter projects via renderer.worldToScreen, behind-culls, and applies the getUiScale()
    author-space divide for positioning under zoom (a positioning test asserts the divide and the cull).
[ ] A painter routing test asserts ALL writes go through the host's elided writers (setTransform/
    setText/setDisplay/setStyleProp/toggleClass); no raw style/textContent/setAttribute on the FCT path.
[ ] Pool lifecycle: no dropped or duplicated combat text under rapid spawn; correct TTL recycle;
    over-cap spawns EVICT the oldest by sequence (FIFO-by-sequence) and never exceed the cap; the
    eviction test is green.
[ ] The per-frame FCT driver runs from Hud.update() (every-frame tier) with the pool body filled in;
    NO second rAF.
[ ] Combat-text live region (decision 10): BUILT (polite role=status/aria-live, coalesced named-
    constant announce cadence, never raw per-damage streaming, t()-labelled) OR explicitly DEFERRED to
    P15a with a recorded note of what P15a must build. The a11y row is honestly tracked, not skipped.
[ ] NO MAGIC VALUES (decision 12): FCT_POOL_CAP, the announce cadence, and all thresholds are named
    constants; no hex color literal in fct_painter.ts; the no-magic-values painter guard passes.
[ ] ClientWorld-vs-Sim parity (decision 15): the painter's core consumption + the positioning test are
    driven with BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub.
[ ] Any player-visible FCT text remains the already-t()-resolved string from the spawn site; no new
    label leaks outside hud_chrome.ts.
[ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= the P0 baseline AND
    hudHotDomSkipRate >= the P0 baseline.
[ ] PERF GATE (P13b-specific): a scripted AoE/boss burst shows the live FCT node count BOUNDED by
    FCT_POOL_CAP (unbounded createElement churn eliminated) with frameP95 <= baseline; the green-perf-
    gate commit is tagged so a later cumulative regression (first surfaced at P17a) bisects to P13b.
[ ] No IWorld / sim / server / net change.
[ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P13b done; record src/ui/fct_painter.ts added, the FCT spawn path now fully on the
  pool, fct() removed, and the perf_tour AoE-burst numbers vs the P0 baseline (node count bounded by
  FCT_POOL_CAP, frameP95).
- state.md: update the ledger row P13b -> done; note the per-frame FCT driver now drives the live
  pooled painter on the every-frame tier of hud.update(), the FCT_POOL_CAP value chosen, that the 6
  FCT hex colors are now class tokens (el.style.color removed), whether the combat-text live region was
  built or deferred to P15a, and that fct() (7258-7276) is removed. Note that P14a tiers the pool's
  cap/lifetime/drop-non-crit knobs off the static fxLevel.
- Memory: record any surprising rule (the exact worldToScreen return shape {x,y,behind}; the getUiScale
  author-space divide being load-bearing for FCT positioning under zoom; that showSelfNote was the 8th
  site with a cross-file caller at main.ts:1727; the FIFO-by-sequence eviction policy under cap; the
  FCT color-class token vocabulary; whether the live region was built or deferred).

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, the architecture guard,
the painter routing + pool-lifecycle + positioning tests incl the ClientWorld-vs-Sim parity assertion,
the no-magic-values + a11y rows, and the perf gate numbers incl the bounded-node AoE assertion and the
skip-rate), the qa-checklist verdict, whether the combat-text live region was built or deferred to
P15a, and any deferrals (FCT tier knobs -> P14a). End with exactly:
Next: phase-14a-graphics-tiering.md

STOPPING RULES (phase-specific):
- STOP if the FCT extraction regresses frameP95 above the P0 baseline OR drops hudHotDomSkipRate below
  it; investigate write-elision routing / cache-key byte-identity (the class-token toggle and the
  setTransform position must produce stable keys) before proceeding.
- STOP if the AoE-burst node count is NOT bounded by FCT_POOL_CAP (a pool-lifecycle bug); fix the
  recycle/FIFO-eviction before committing. The perf gate is the real acceptance bar.
- STOP if pool lifecycle drops or duplicates combat text under rapid spawn; the slotted pool must
  spawn-without-loss and recycle-without-double, and any per-slot closure must read the LIVE mutable
  slot record (the P11c/P12b stale-closure hazard).
- STOP if you cannot delete fct() because showSelfNote or the main.ts:1727 caller is not yet migrated;
  migrate and verify both BEFORE deleting (the fct()-removal precondition).
- STOP if a write cannot be routed through the elided writers without changing the rendered output (a
  non-byte-identical cache key silently collapses the skip-rate); resolve the key, do not bypass the
  helper or reintroduce el.style.color.
- STOP if the phase finds it needs to extend IWorld or touch src/sim/server/net (scope change):
  surface it, do not proceed.
- STOP if loading the working set approaches ~40% context: this is already the painter+migration half;
  surface it rather than degrade.
```

## Notes for the planner

P13b is the second of the two FCT halves and carries the dominant risk and the real acceptance bar. The
descriptor core and the dormant driver landed in P13a; this phase only has to fill in the pooled-div
ring, flip the spawn sites onto it, and prove the worst case. The single biggest hazard is POOL
LIFECYCLE: a recycle or eviction bug silently drops or duplicates combat text, and the AoE/boss worst
case is exactly the bounded-node perf-gate scenario, so the FIFO-by-sequence eviction + the bounded-node
AoE-burst assertion in perf_tour are the load-bearing checks, not tsc + tests. Three live-source
corrections from the deep review are baked in. First, getUiScale (hud.ts:288 used at 7270) is
load-bearing: worldToScreen returns the UNZOOMED viewport point and #ui is scaled by zoom, so the
painter MUST divide x/y by getUiScale() into author space or FCT mispositions under zoom; a positioning
test asserts it. Second, the 6 hardcoded FCT hex colors move to CSS CLASS TOKENS keyed by descriptor
kind (decision 12) and el.style.color is dropped; the painter sets the class via the elided toggleClass,
which is exactly why P10a's setStyleProp/toggleClass writer extension (decision 5a) had to land first.
Third, the spawn-site count is 8, not 7: the 7 fct() calls at 6100-6422 PLUS showSelfNote (7254-7256,
whose only cross-file caller is main.ts:1727); the fct()-removal precondition is to migrate showSelfNote
AND verify main.ts:1727 first, so keep showSelfNote's public signature stable. FCT IS the combat-text
live region named in decision 10, so this phase BUILDS it (a coalesced, named-constant announce cadence,
never raw per-damage streaming that would flood a screen reader) or explicitly DEFERS it to P15a with a
note; the choice must be explicit. Landing this last de-risks P14a, which only then turns the pool's
cap/lifetime/drop-non-crit knobs into pure functions of the static fxLevel.
