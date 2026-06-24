# Phase P13a: Per-frame: FCT core + per-frame driver

Stand up the net-new floating-combat-text (FCT) infrastructure in two safe halves; this is the first.
Add a pure `fct_core` spawn-descriptor model (jitter INJECTED, no `Math.random` in the core) and
introduce the per-frame FCT driver folded into `hud.update()` behind a TEMPORARY adapter, so the
driver exists and ticks WITHOUT changing any behavior yet: the per-event `createElement`+`setTimeout`
path still runs untouched. No spawn-site removal, no pooled painter, no `fct()` deletion here; that is
all P13b. This split exists because the core + driver wiring + its mandatory QA pass plus in-session
remediation already approaches the ~40% Opus-degradation ceiling on its own (state.md, OLD->NEW map).

## Starter Prompt

```
This is Phase P13a of the Frontend Modernization v0.16.0 packet: Per-frame: FCT core + per-frame
driver. It is the FIRST of the two FCT halves (P13a core+driver, then P13b pooled painter + spawn-site
migration + bounded-AoE perf gate). FCT is the single highest-risk per-frame surface because it is the
only hot element with NO existing core or painter on V16 (today it is per-event
createElement+setTimeout); this half lands the determinism-critical core and the driver scaffolding
with ZERO behavior change so P13b can flip the spawn path on a proven foundation.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. Net-new per-frame infra (a pure descriptor core plus the first per-frame FCT driver):
use ultracode + a Workflow. One slice builds and tests the pure core, one wires the temporary driver
adapter into hud.update(), then an adversarial verify pass over core determinism + purity and the
no-behavior-change guarantee (the old per-event path must still run).

Goal: lift the DESCRIPTOR MODEL of FCT off the per-event path onto the repo's per-frame Humble Object
pattern, and create the per-frame DRIVER that P13b's painter will be stepped from, WITHOUT yet removing
or rerouting any spawn site. Two deliverables:
  1. A pure src/ui/fct_core.ts: input is an FCT event (kind + already-resolved text string + world
     anchor + flags like crit and color-class discriminator) plus an INJECTED jitter value (0..1) and
     any injected per-frame clock/dt; output is a spawn DESCRIPTOR (the resolved text, a color CLASS
     TOKEN discriminator, rise distance, ttl, horizontal jitter offset). NO Math.random, NO
     Date.now/performance.now, NO DOM in the core. Determinism: same event + same injected jitter gives
     the same descriptor, byte-for-byte.
  2. The per-frame FCT driver folded into hud.update() (hud.ts:3627) behind a TEMPORARY adapter: a
     step(now) call site on the EVERY-FRAME tier that, this phase, drives an empty/no-op pool stub (or
     a stub painter that holds zero live entries). The driver EXISTS and ticks every frame, but the
     per-event createElement+setTimeout fct() (hud.ts:7258-7276) and showSelfNote (7255) STILL RUN
     UNCHANGED. No spawn-site removal, no fct() deletion, no pooled DOM, no class-token color migration
     here. The point is that P13b only has to swap the spawn implementation, not also invent the driver.

STEP 0 - PRE-FLIGHT:
- Run git status; it MUST be clean. This is a shared checkout (concurrent sessions). If it is not
  clean, STOP and ASK the user; do not stash or revert someone else's work.
- Confirm you are in the /Users/fernando/Documents/wocc-v0.16.0 worktree on branch
  feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the frontend-modernization entries:
  frontend-architecture-vanilla-stack, phased-packet-qa-cadence, and the prior per-frame batch
  entries (P10/P11/P12 if recorded) for the write-elision + keyed-pool + PainterHost lessons. Also
  no-em-dashes-or-emojis and shared-worktree-commit-care.
- This phase depends on P0 (gates + perf baseline recorded), P6 (PainterHost two-facet seam present),
  and P10a (the PainterHost elided-writer EXTENSION setStyleProp/toggleClass, decision 5a). Confirm
  they landed: tests/css_corpus.test.ts + the UI-purity allowlist exist, scripts/perf_tour.mjs has a
  recorded P0 baseline, src/ui/painter_host.ts exists and exposes BOTH facets (the presentation
  dep-bag and the write-elision facet incl setStyleProp/toggleClass). If the P0 perf baseline is not
  recorded, STOP: P13b cannot run its perf gate and you must not build the driver against a missing
  budget.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize back a tight summary (the orchestrator keeps the
summary, not raw dumps):
- docs/frontend-modernization/state.md: locked decisions 3 (write-elision), 5 + 5a (the per-frame
  Humble Object pattern + the elided-writer EXTENSION), 8 (the FCT-driver-folds-into-hud.update
  default), 9 (component contract: a parameterized, instance-clean core), 10 (WCAG 2.2 AA chrome), 12
  (no magic values in painters), 15 (ClientWorld-vs-Sim parity); the non-negotiable constraints (the
  determinism note that the FCT CORE may NOT use Math.random while the PAINTER may, P13b); the
  canonical workflow; the validation matrix (the PER-FRAME row + the pure-core row + the ClientWorld
  parity assertion); the Review Dispatch Matrix. Cite state.md by section; do not re-derive.
- This phase file.
- The '### P13' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the
  'Load-bearing structural findings' and 'Top risks' sections (risk 2 is the FCT extraction; note it
  explicitly calls out getUiScale positioning, the hex->class-token migration, and the
  showSelfNote/main.ts:1727 precondition as easy-to-miss, all of which are P13b but you must NOT
  break them here). Reference recon sections by NAME (its line numbers shifted after the AMENDED note
  block was inserted near the top).
- The SPECIFIC V16 source ranges only (by exact line number; read just these, not surrounding files
  whole):
  - The current FCT helper private fct() at src/ui/hud.ts:7258-7276 (it createElement's a div, sets
    className 'fct'/'fct crit', writes el.style.color = color, projects via this.renderer.worldToScreen
    at 7259, behind-culls at 7264, divides left/top by getUiScale() at 7270 into author space, adds a
    Math.random()*30-15 horizontal jitter at 7271, textContent = text, appends to #ui, and removes via
    setTimeout(..., 1250)). This is the BEHAVIOR your core descriptor must reproduce exactly so P13b's
    painter is a faithful swap; you do NOT edit it this phase.
  - showSelfNote at src/ui/hud.ts:7254-7256 (calls this.fct(this.sim.player, text, color='#ff8c66',
    false); it is the 8th spawn site, with a cross-file caller at src/main.ts:1727). Note it; do not
    migrate it (that is P13b's fct()-removal precondition).
  - The 7 fct() calls in the SimEvent switch at src/ui/hud.ts:6100-6422 so you can enumerate the
    descriptor KINDS the core must model and the COLOR LITERALS each passes (these become class-token
    discriminators in P13b): miss/dodge (6100-6105, '#bbb' on self else '#fff'), player damage done
    (6123-6124, ability '#ffe97a' else autoattack '#fff', crit flag), damage taken (6138, '#ff5544',
    crit flag), heal (6155, '#3ce63c'), xp (6166, '#b974ff'), rested xp (6168-6172, '#4a9eff'), and
    the heal-crit at 6422 ('#3ce63c', crit flag). Model the descriptor KIND/flags so P13b maps every
    one to a color class token. You do NOT touch these call sites this phase.
  - The per-frame entry Hud.update() at src/ui/hud.ts:3627 and its frame-divider (every-frame +
    fastHud >=100ms + mediumHud >=250ms + slowHud >=500ms; called from main.ts:2079 offline / 2171
    online) so you fold the driver step(now) onto the EVERY-FRAME tier (FCT animates every frame; this
    is the locked default in decision 8, NOT a second rAF).
  - getUiScale at src/ui/hud.ts:288 (import) and its use inside fct() at 7270 (the author-space
    divide). The core does NOT consume getUiScale (it is a painter projection concern in P13b), but you
    must MODEL the descriptor so the rise/jitter are expressed in a space the painter can divide by the
    scale; document that the painter, not the core, applies getUiScale.
  - The write-elision helpers + hotWriteCache at src/ui/hud.ts:1322-1372 (setText/setDisplay/
    setTransform/setWidth) and the P10a EXTENSION (setStyleProp/toggleClass) on the PainterHost
    write-elision facet, plus perfStats(). The driver and the stub it steps must be shaped so P13b's
    painter writes ONLY through these; do not introduce a raw-write path the driver depends on.
  - renderer.worldToScreen signature + return shape ({x, y, behind} per the live source) so the
    descriptor carries the world anchor the painter will project. The core takes the ANCHOR
    (target.pos + the 2.2*scale head-offset the live fct() uses at 7261), NOT the projected point;
    projection is the painter's job in P13b. Capture the 2.2 head-offset as a NAMED constant in the
    core (decision 12), not a literal.
  - The existing per-frame painter + PainterHost pattern landed by P10/P11/P12 (how a painter receives
    the PainterHost two facets and the elided writers) so the driver scaffolding matches the seam P13b
    plugs into.
Apply THE 40% RULE: this phase is already the core+driver HALF of the FCT split precisely so it fits
under ~40% INCLUDING its QA pass + remediation. If the working set still approaches the ceiling, STOP
and surface it rather than degrade (do not silently start P13b's painter work here).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (ultracode Workflow, fan out EXPLICITLY):
Slice A (pure core, src/ui/fct_core.ts):
- A host-agnostic, allocation-light pure core. Define an FctEvent input (kind discriminator: miss,
  dodge, damageDone-ability, damageDone-auto, damageTaken, heal, xp, restedXp, selfNote; plus the
  already-resolved text STRING the caller passes, the world ANCHOR {x,y,z} and head-offset, and flags
  like crit) and an FctDescriptor output (the resolved text, a COLOR CLASS TOKEN discriminator keyed by
  kind+flags (NOT a hex; the hex->token mapping table is built in P13b's painter), rise distance, ttl,
  horizontal jitter offset). describe(event, jitter01, clock) is a PURE function: NO Math.random, NO
  Date.now/performance.now, NO DOM. The injected jitter (0..1) maps to the horizontal offset exactly as
  the live fct() does (Math.random()*30-15 becomes jitter01*JITTER_RANGE - JITTER_RANGE/2 with
  JITTER_RANGE a named constant = 30). ttl is a named constant (FCT_TTL_MS = 1250, the live setTimeout
  value). The head-offset (FCT_ANCHOR_HEAD_OFFSET = 2.2, scaled by entity scale) is a named constant.
  NO magic literals (decision 12).
- Register fct_core in the UI_PURE_CORES allowlist in tests/architecture.test.ts. The painter is NOT
  registered (P13b's painter may use Math.random for jitter).
- Add tests/fct_core.test.ts:
  - Same event + same injected jitter gives the same descriptor (byte-for-byte; the same-input-
    same-output assertion).
  - crit vs non-crit of the same kind differ ONLY where the live behavior differs (crit class flag;
    color class token unchanged by crit for the same kind, matching the live fct() which keys color by
    the call-site argument and crit only by the 'crit' class).
  - Each kind maps to its own color class token discriminator; ttl/rise are pure functions of kind.
  - The injected jitter01 of 0 and 1 produce the documented min/max horizontal offset
    (-JITTER_RANGE/2 .. +JITTER_RANGE/2); no Math.random anywhere in the core.
  - ClientWorld-vs-Sim parity (decision 15): drive describe() with an FctEvent built from BOTH a
    Sim-shaped IWorld stub and a ClientWorld-mirror-shaped IWorld stub (the anchor entity fields
    target.pos/scale must read identically off either world shape); assert identical descriptors. FCT
    events arrive via the SimEvent stream the online ClientWorld mirrors, so the anchor-field
    assumption is exactly the cross-world drift risk this assertion exists to catch.

Slice B (driver wiring, temporary adapter, src/ui/hud.ts):
- Introduce the per-frame FCT driver by adding a step(now) call on the EVERY-FRAME tier of
  Hud.update() (hud.ts:3627). This phase it steps a NO-OP/empty stub (an FctDriver that holds a pure
  core reference + a zero-entry pool stub, or a tiny stub painter with no live entries). The stub
  consumes the PainterHost (so P13b only fills in the pool body, not the seam). Do NOT add a second
  rAF (decision 8: fold into hud.update() so the existing `hud` perf bucket covers it).
- CRITICAL no-behavior-change guarantee: the existing per-event fct() (7258-7276) and showSelfNote
  (7254-7256) STILL RUN UNCHANGED, the 7 spawn sites at 6100-6422 are UNTOUCHED, and the stub the
  driver steps spawns NOTHING. Visible FCT this phase is byte-identical to before. Document in the
  driver module that it is dormant until P13b migrates the spawn sites onto it.

Verify pass (adversarial): a fresh subagent reviews the diff for (a) core PURITY (no Math.random/
Date.now/performance.now/DOM; allocation-light; same-input-same-output), (b) the no-behavior-change
guarantee (old per-event path intact; the stub spawns nothing; no spawn site rerouted), and (c) that
the driver is folded into hud.update() (no second rAF) and the stub consumes the PainterHost (ready
for P13b's pool body). Prompt for COVERAGE not filtering.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): consume V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim, server, src/net, or headless. Server authority untouched. If this phase finds it needs to
  extend IWorld, STOP and surface it (scope change).
- Determinism for cores (decision 5 / the non-negotiable note): the FCT CORE has NO Math.random/
  Date.now/performance.now and NO DOM; it is registered in UI_PURE_CORES and allocation-light. The FCT
  PAINTER (P13b) MAY use Math.random for jitter; this phase ships no painter Math.random.
- Per-frame routing readiness (decisions 3, 5, 5a): the driver and stub are shaped so P13b's painter
  writes ONLY through the PainterHost elided writers (setText/setDisplay/setTransform/setWidth +
  setStyleProp/toggleClass). Do not bake a raw-write path into the driver.
- Fold the driver into hud.update() (decision 8); NO second rAF.
- Component contract (decision 9): fct_core is instance-clean (no hardcoded element id, no
  single-instance assumption); the descriptor is the seam the P13b pool consumes.
- ClientWorld-vs-Sim parity (decision 15): the core test feeds BOTH a Sim-shaped and a
  ClientWorld-mirror-shaped IWorld stub.
- i18n: the core takes the text ALREADY RESOLVED (the caller t()-resolves at the spawn site, as the
  live fct() callers already do at 6102/6124/6166/etc.); the i18n-free core emits a discriminator +
  the resolved string, never a t() call (mirrors the cast_bar core rule). No new labels expected; any
  unavoidable label is a single English-only key in src/ui/i18n.catalog/hud_chrome.ts (keep the t()
  call, no concat / no ?? fallback).
- No em dashes, en dashes, or emojis anywhere. Commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase; P13b or later):
- The pooled-div ring painter, worldToScreen projection, getUiScale author-space divide, behind-cull,
  the hex->class-token color migration (dropping el.style.color), FIFO-by-sequence eviction, the
  max-concurrent cap, and migrating the 8 spawn sites + showSelfNote + verifying main.ts:1727 + the
  fct() deletion -> P13b.
- The combat-text live region (decision 10) -> P13b BUILDS it or explicitly defers it to P15a.
- The bounded-node AoE-burst perf gate + FIFO eviction test -> P13b.
- Per-element graphics tiering of FCT (max-concurrent/lifetime/drop-non-crit per fxLevel) -> P14a.
- Nameplate formalization -> P14b.
- The standing hud_perf_budget.test.ts + the final purity sweep -> P17a.
- Any cold-window or CSS work, any new IWorld member or wire field (none in this packet).

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (pure-core added + per-frame driver scaffolding; this phase
ships a core and a dormant driver, NOT a live painter, so the bounded-node + skip-rate gates are P13b's
bar, but the per-frame baseline must not regress from merely adding a no-op step call):
- Baseline: npx tsc --noEmit.
- New .ts module guard: biome check on the new/changed .ts (src/ui/fct_core.ts and the driver
  module/edit in src/ui/hud.ts) (the V16 ratchet).
- Pure core: npx vitest run tests/fct_core.test.ts + npx vitest run tests/architecture.test.ts (the
  UI-purity guard: fct_core IS in the allowlist, the driver/painter stub is NOT) + the same-input-
  same-output (injected-jitter) assertion + the ClientWorld-vs-Sim parity assertion (decision 15: the
  core test drives describe() with BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub).
  Verify the purity guard provably FAILS when a real DOM-import line is injected into fct_core (the
  perturbation must be a real code line; a // comment is stripped by stripComments).
- NO MAGIC VALUES (decision 12): the core's literals (JITTER_RANGE=30, FCT_TTL_MS=1250,
  FCT_ANCHOR_HEAD_OFFSET=2.2, rise distance) are NAMED constants; assert no bare numeric/color literal
  in the descriptor math. (The painter no-magic-values + class-token color guard is P13b.)
- PER-FRAME baseline hold: run scripts/perf_tour.mjs desktop AND mobile and assert frameP95 <= the P0
  baseline AND hudHotDomSkipRate >= the P0 baseline. Adding a no-op step(now) on the every-frame tier
  must not regress either; if it does, the stub is doing work it should not. (The bounded-node
  AoE-burst gate is P13b.)
- WINDOW/CONTROL A11Y ROW (decision 10): FCT is the COMBAT-TEXT live region surface (decision 10
  names a live region for combat text). This phase ships NO visible FCT change (the old path still
  runs), so there is no new rendered control to axe here; the live region is BUILT or explicitly
  DEFERRED in P13b. State this boundary honestly in the phase report; do NOT silently skip the row,
  record that the live-region a11y obligation is carried into P13b.
Review dispatch (only the rows the diff touches): qa-checklist (default; this completes the
core+driver deliverable). privacy-security-review does NOT fire (no server/net/admin; the core adds
NO Math.random and is a registered pure core; the painter Math.random is P13b). cross-platform-sync
does NOT fire (IWorld unchanged; consuming the landed IWorld in a core does not change it; the
ClientWorld parity obligation is covered by the per-core test, not by spawning the reviewer).
migration-safety N/A. Prompt the reviewer for COVERAGE not filtering; resume a truncated reviewer per
the state.md script. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-4 Conventional Commits, scope + EXPLICIT paths):
- feat(ui): add fct_core pure spawn-descriptor with injected jitter
  (paths: src/ui/fct_core.ts, tests/fct_core.test.ts, tests/architecture.test.ts)
- feat(ui): introduce dormant per-frame FCT driver folded into hud.update (no behavior change)
  (paths: src/ui/hud.ts, and the driver module if separate)
- docs(frontend): record P13a in progress.md and state.md ledger
  (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
[ ] npx tsc --noEmit passes.
[ ] biome check passes on src/ui/fct_core.ts and the changed src/ui/hud.ts.
[ ] tests/fct_core.test.ts green: a pure fct_core with INJECTED jitter (same event + same injected
    jitter gives the same descriptor, byte-for-byte), NO Math.random/Date.now/performance.now, NO
    DOM; crit only flips the crit class; each kind maps to its own color class token discriminator;
    jitter01 of 0 and 1 give the documented min/max horizontal offset.
[ ] tests/architecture.test.ts green: fct_core registered in UI_PURE_CORES and passing the purity
    guard; the driver/painter stub is NOT in the allowlist; the guard provably FAILS on an injected
    real DOM-import line in fct_core.
[ ] ClientWorld-vs-Sim parity (decision 15): the core test drives describe() with BOTH a Sim-shaped
    and a ClientWorld-mirror-shaped IWorld stub and asserts identical descriptors.
[ ] NO MAGIC VALUES (decision 12): JITTER_RANGE, FCT_TTL_MS, FCT_ANCHOR_HEAD_OFFSET, and the rise
    distance are named constants in the core; no bare literal in the descriptor math.
[ ] The per-frame FCT driver runs from Hud.update() on the EVERY-FRAME tier (NO second rAF), and it
    steps a NO-OP/empty stub that consumes the PainterHost.
[ ] NO BEHAVIOR CHANGE: the per-event fct() (7258-7276) and showSelfNote (7254-7256) still run
    unchanged; the 7 spawn sites at 6100-6422 are untouched; the stub spawns nothing; visible FCT is
    byte-identical to before this phase.
[ ] PER-FRAME baseline hold: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= the P0
    baseline AND hudHotDomSkipRate >= the P0 baseline (adding the no-op step does not regress).
[ ] The combat-text live-region a11y obligation (decision 10) is explicitly recorded as carried into
    P13b (no visible FCT control changes this phase to axe).
[ ] No IWorld / sim / server / net change; no new i18n keys (or a single English-only hud_chrome.ts
    key if a label was unavoidable, with the t() call kept).
[ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P13a done; record src/ui/fct_core.ts + the driver scaffolding added, and that the
  per-event FCT path still runs (no behavior change yet).
- state.md: update the ledger row P13a -> done; note fct_core is registered in UI_PURE_CORES, the
  per-frame FCT driver now exists on the every-frame tier of hud.update() but is DORMANT (steps a
  no-op stub) until P13b, and that the core's named constants (JITTER_RANGE=30, FCT_TTL_MS=1250,
  FCT_ANCHOR_HEAD_OFFSET=2.2) mirror the live fct() values P13b's painter will honor.
- Memory: record any surprising rule (the exact worldToScreen return shape {x,y,behind}; the
  spawn-site KIND/color enumeration; that the core stays Math.random-free while P13b's painter
  jitters; that showSelfNote is the 8th site with a cross-file caller at main.ts:1727 that P13b must
  migrate before deleting fct()).

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, fct_core +
architecture tests incl the ClientWorld-vs-Sim parity assertion, the no-magic-values core check, the
per-frame baseline-hold numbers), the qa-checklist verdict, and the deferrals carried into P13b (the
pooled painter, the spawn-site migration, the hex->class-token color migration, the bounded-AoE perf
gate, and the combat-text live region). End with exactly:
Next: phase-13b-perframe-fct-painter-migration.md

STOPPING RULES (phase-specific):
- STOP if adding the no-op driver step regresses frameP95 above the P0 baseline OR drops
  hudHotDomSkipRate below it; the stub must do no real work this phase.
- STOP if any visible FCT behavior changes (the old per-event path MUST remain intact this phase); if
  a slice starts migrating spawn sites or building the pool, that is P13b, do not pull it forward.
- STOP if the fct_core cannot be made pure (Math.random/Date.now/performance.now/DOM creeps in) or
  allocation-light; the determinism guard is non-negotiable for a registered core.
- STOP if the descriptor shape cannot express what the live fct() does (color-by-kind class token,
  crit class, the 2.2 head-offset anchor, the jitter range, the 1250ms ttl); re-shape the descriptor
  before proceeding so P13b's painter is a faithful swap, not a behavior change.
- STOP if the phase finds it needs to extend IWorld or touch src/sim/server/net (scope change):
  surface it, do not proceed.
- STOP if loading the working set approaches ~40% context: this is already the core+driver half;
  surface it rather than degrade (do not start P13b's painter work here).
```

## Notes for the planner

P13a is the first of the two FCT halves and is deliberately ZERO behavior change. FCT is the only hot
HUD element with no existing core or painter on V16 (today it is per-event createElement+setTimeout at
hud.ts:7258-7276), so the riskiest part is the pool lifecycle that P13b owns; this half de-risks that
by landing the determinism-critical pure core (jitter INJECTED so it stays Math.random-free and passes
the UI-purity guard, per the non-negotiable note) and the per-frame driver scaffolding folded into
hud.update() (decision 8, not a second rAF) WITHOUT touching a single spawn site, so P13b only has to
swap the spawn implementation onto a proven, already-ticking driver. The load-bearing decision here is
the DESCRIPTOR SHAPE: it must capture everything the live fct() does (the per-kind color as a CLASS
TOKEN discriminator rather than a hex, the crit class flag, the 2.2*scale head-offset anchor as a named
constant, the 30px jitter range, the 1250ms ttl) so P13b's painter is a faithful swap and not a
behavior change. The ClientWorld-vs-Sim parity assertion (decision 15) matters specifically here
because FCT events ride the SimEvent stream the online ClientWorld mirrors, so an anchor-field
assumption that holds offline could silently misrender online. The combat-text live region (decision
10) and getUiScale author-space projection are explicitly P13b concerns, recorded as carried forward so
the a11y row is honestly tracked rather than skipped. Landing the core + dormant driver first keeps
each half plus its mandatory QA under the ~40% ceiling.
