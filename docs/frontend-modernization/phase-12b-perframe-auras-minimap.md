# Phase P12b: Per-frame: auras keyed pool + minimap canvas

Lift the two remaining hard per-frame HUD elements into pure core plus thin painter: the buff/debuff
auras (renderAuras hud.ts:4186-4245), replacing the `__sig` + innerHTML-wipe with a typed keyed
per-aura node pool whose pooled slot is a MUTABLE record the tooltip closure reads live; and the
minimap (hud.ts:5022-5258), with a pure core returning a DISCRIMINATED Marker union feeding a thin
canvas painter that keeps the 10Hz cadence and the cached background.

## Starter Prompt

```
This is Phase P12b of the Frontend Modernization v0.16.0 packet: Per-frame extraction, the buff/debuff
auras keyed pool and the minimap canvas.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. This is a per-frame batch (two independent hot elements, each its own core + painter +
tests) carrying Top risk 3 (innerHTML-wipe to keyed-pool listener/tooltip preservation) and the
canvas no-magic-values surface. The two slices touch disjoint hud.ts ranges and disjoint new modules,
so fan out one subagent per element with adversarial verify, then integrate sequentially into hud.ts;
the perf gate is the shared acceptance.

Goal: Extract the buff/debuff auras (renderAuras hud.ts:4186-4245) and the minimap (hud.ts:5022-5258)
out of the Hud monolith into pure cores plus thin painters. Auras: a pure core (src/ui/auras_view.ts)
returning the ordered keyed aura list with the debuff allowlist moved INTO the core, plus a painter
(src/ui/auras_painter.ts) that replaces the __sig + innerHTML-wipe with a typed keyed per-aura node
pool. The pooled slot is a MUTABLE record the tooltip closure reads LIVE (not capture-by-value, which
goes stale after the pool recycles a slot to a different aura); listeners attach ONCE per pooled node.
Minimap: a pure core (src/ui/minimap_markers.ts) returning a DISCRIMINATED Marker union (delve
schematic / NPC glyph / proximity-scaled party disc+arrow / player), plus a thin canvas painter
(src/ui/minimap_painter.ts) keeping the existing 10Hz cadence and the cached background, with the
#zone-label text routed through setText. Reuse the existing elision helpers and PainterHost from P6 +
the P10a setStyleProp/toggleClass facet; reuse the allocation-budget proxy RESOLVED in P12a (do not
re-derive it). Do not re-derive infra.

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
- This phase depends on P0 (perf baseline recorded), P6 (PainterHost seam present), P10a (the
  write-elision facet extension setStyleProp/toggleClass, decision 5a), and P12a (the RESOLVED
  allocation-budget proxy). Confirm all landed: scripts/perf_tour.mjs has a recorded baseline,
  src/ui/painter_host.ts exists with setStyleProp/toggleClass, and the allocation-budget proxy from
  P12a is recorded in state.md. If P0's baseline or the P12a proxy is missing, STOP: the gate cannot
  run.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps) the
orchestrator keeps:
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 9, 10, 12, 15; the non-negotiable
  constraints; decision 10's WCAG 2.2 AA controls; decision 12's no-magic-values-in-painters AND the
  CANVAS-painter sub-rule, resolve --color-* via getComputedStyle ONCE per redraw, cached, never
  per-marker; decision 15's ClientWorld-vs-Sim parity; the canonical workflow STEP 0-7; the validation
  matrix incl the PER-FRAME row, the allocation-budget assertion REUSING the P12a proxy, the
  WINDOW/CONTROL a11y row, the no-magic-values painter guard, AND the rule that CANVAS painters are
  EXEMPT from the elided-writer routing test and are gated on cadence + cached background + frameP95;
  the Review Dispatch Matrix; Top risk 3 and Top risk 7). Cite state.md by section; do not re-derive.
- This phase file.
- The "### P12" section of docs/frontend-modernization/v016-recon-and-packet.md, plus the "Load-bearing
  structural findings" and "Top risks" sections (especially risk 3: innerHTML-wipe to keyed-pool;
  risk 7: canvas painters vs no-magic-values). Reference recon sections by NAME (its line numbers
  shifted after the AMENDED note block was inserted near the top). NOTE: the recon and the OLD P12 text
  claimed the minimap builds friend/guild/party Sets OFF the hot path and collapses a double-scan;
  those claims are WRONG against live source (see below) and must NOT be carried forward.
- The specific V16 source ranges this phase touches, read narrowly with offset+limit:
  - hud.ts:1322-1372 (the write-elision helpers + hotWriteCache), perfStats() counters, and the P10a
    setStyleProp/toggleClass extension.
  - hud.ts:3627 (Hud.update frame divider) and how the every-frame / fastHud (>=100ms) / mediumHud
    (>=250ms) / slowHud (>=500ms) tiers gate the auras (buff bar) and the minimap (the minimap runs on
    a ~10Hz cadence, NOT every frame; confirm the exact divider that gates updateMinimap).
  - hud.ts:4186-4245 (renderAuras: the __sig cache, the innerHTML wipe, the debuff allowlist, the
    attachTooltip closures, any click/hover listeners, the stack-count / duration / icon writes).
  - hud.ts:5022-5258 (updateMinimap, a CANVAS routine). Read it CAREFULLY and note the LIVE shape: it
    is TWO top-level branches (in-delve schematic vs overworld). The friend/guild/party membership Sets
    are ALREADY built ONCE per call (friendNames/guildNames/partyPids around 5139-5145), NOT
    per-marker, so there is no "build Sets off the hot path" work to do. The entity loop iterates
    this.sim.entities and the party loop iterates this.sim.partyInfo.members, two DIFFERENT
    collections, so there is no double-scan to collapse. The marker kinds are: delve schematic
    (mob/party/arrow), overworld NPC glyph (a 'bold 11px Georgia' font label in '#ffd100'),
    proximity-scaled party discs + the player arrow, and the player. The #zone-label is written via
    .textContent (in-delve delve module name, else zone name). The delve schematic background is a
    cached offscreen canvas rebuilt only on module change (delveSchematicBg / delveSchematicBgModuleId).
    There are about 15 hex literals (e.g. #0e0c0a, #ff8800, #e74c3c, #9a9a9a, #4ade80, #60a5fa,
    #ffd100, #c084ff, #ffe97a, #ffffffcc, #fff, #000), a font literal, and several numeric radii / pad
    constants.
  - src/ui/painter_host.ts (the P6 dep-bag: icon/money/tooltip helpers + the elided writers + the P10a
    setStyleProp/toggleClass facet).
  - tests/architecture.test.ts (UI_PURE_CORES allowlist + forbiddenUiCoreImport + the no-magic-values
    painter guard incl the canvas-token sub-rule) and tests/hud_perf_budget.test.ts +
    scripts/perf_tour.mjs (the P0 baseline + skip-rate counters + the P12a allocation proxy).
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Use ultracode with a Workflow fan-out, one slice per element (two slices). The slices touch disjoint
hud.ts ranges and create disjoint new modules, so run them in parallel; integrate sequentially into
hud.ts at the end (the only shared file).

Slice A - Auras keyed pool (renderAuras, hud.ts:4186-4245):
- Add src/ui/auras_view.ts: a pure core taking IWorld and returning the ORDERED keyed aura list
  (buff/debuff), with the DEBUFF ALLOWLIST moved INTO the core (it is presentation/domain
  classification; lift it out of the painter). Register in UI_PURE_CORES. Allocation-light: stable
  per-aura keys, the returned list reuses a preallocated buffer where feasible (the P12a allocation
  proxy is the budget); no per-frame garbage churn. Same input gives same output; no Math.random /
  Date.now / performance.now.
- Add src/ui/auras_painter.ts: replace the __sig + innerHTML wipe with a typed keyed per-aura node
  pool. Reuse existing DOM nodes keyed by aura key; create a slot on first appearance, recycle the slot
  on disappearance; NEVER innerHTML-wipe. CRITICAL (Top risk 3): the pooled slot is a MUTABLE RECORD
  (the slot holds the live aura data and the node refs); the attachTooltip closure and any hover/click
  listener attach ONCE per pooled node and READ the slot's live fields, NOT a captured-by-value aura
  object (capture-by-value goes STALE after the pool recycles a slot to a different aura, so the
  tooltip would show the wrong aura). Update the slot's fields in place each frame; the closure reads
  them live. Route stack-count / duration / icon writes through the elided helpers (setText/setDisplay/
  setWidth) plus the P10a toggleClass for any debuff/expiring class and setStyleProp for any CSS-var
  (duration-fraction) write. No raw style/textContent/setAttribute the helpers do not own (document any
  unavoidable raw write per decision 5a).
- A11y (decision 10, WCAG 2.2 AA): the aura strip conveys meaning as text/aria, not color alone (a
  debuff vs buff is not color-only); stack count and remaining duration are accessible; if an aura is
  interactive (cancellable on click) it is a real control with a visible :focus-visible never animated
  away and a target-size >=24px (>=40x40 on mobile). A forced-colors: active snapshot keeps the
  buff/debuff distinction (border/outline, never background-image alone).
- No-magic-values (decision 12, DOM painter): the painter drives tokens / CSS custom properties, never
  a literal hex/px in TS; any threshold (the expiring-soon duration cutoff, the max visible count) is a
  NAMED CONSTANT.
- Add tests/auras_view.test.ts: same-input-same-output + the debuff allowlist classification + the
  ClientWorld-vs-Sim parity assertion (decision 15: feed BOTH a Sim-shaped and a ClientWorld-mirror-
  shaped IWorld stub; the aura stack/duration fields are the online-mirror shape, not a Sim-only
  field). Add tests/auras_painter.test.ts (a DOM-light harness): the keyed pool drops no tooltip and
  does NOT re-attach a duplicate listener across rebuilds; AND a STALE-CAPTURE regression test, recycle
  a pooled slot from aura A to aura B and assert the tooltip reads B's live data, not A's (the
  mutable-record rule); AND the no-raw-write routing assertion.

Slice B - Minimap canvas (updateMinimap, hud.ts:5022-5258):
- Add src/ui/minimap_markers.ts: a pure core that, given the world view, returns a DISCRIMINATED Marker
  UNION (NOT a flat Marker[]), one variant per draw kind: a delve-schematic marker (mob / party / the
  player arrow within the schematic), an overworld NPC-glyph marker (the labelled glyph), a
  proximity-scaled party disc + arrow marker, and the player marker. The discriminant carries exactly
  the fields each draw branch needs (position in canvas space or the data the painter projects, the
  classification, the proximity scale for party discs, the facing angle for arrows). Move the
  friend/guild/party MEMBERSHIP CLASSIFICATION into the core (the core decides friend vs guild vs party
  vs neutral vs hostile), but do NOT claim to "build the Sets off the hot path" or "collapse a
  double-scan": the live code already builds friendNames/guildNames/partyPids ONCE per 10Hz call and
  the entity vs party loops iterate DIFFERENT collections, so neither claim applies. Register in
  UI_PURE_CORES. Same input gives same output; no Math.random / Date.now / performance.now.
- Add src/ui/minimap_painter.ts (a thin CANVAS painter): consumes the core; KEEPS the existing 10Hz
  cadence gate and the cached delve-schematic background (rebuilt only on module change, as today); the
  #zone-label text routes through setText (it is a DOM write, not canvas). The canvas painter is EXEMPT
  from the elided-writer routing assertion (a 2D context cannot route through the DOM writers); its gate
  is the 10Hz cadence + the cached background + frameP95. No behavioral change to cadence or visuals.
- No-magic-values (decision 12, CANVAS sub-rule): the marker colors come from the --color-* tokens
  resolved via getComputedStyle ONCE per redraw (cached on the painter, NEVER per-marker / per-frame);
  every other literal (the ~15 hex values today, the 'bold 11px Georgia' font, the canvas size S=162,
  the pad, the marker radii 3 / 3.5 / 4, the clip inset) is a NAMED CONSTANT. The no-magic-values
  painter guard (canvas sub-rule) must pass.
- Add tests/minimap_markers.test.ts: same-input-same-output; the Marker UNION discriminant is correct
  per draw kind (a delve-context world yields delve-schematic markers; an overworld yields NPC-glyph +
  party-disc + player markers); the friend/guild/party CLASSIFICATION is correct (a friend name maps to
  the friend variant, a guild name to guild, a party pid to the party disc, a stranger to neutral);
  AND the ClientWorld-vs-Sim parity assertion (decision 15: feed BOTH a Sim-shaped and a ClientWorld-
  mirror-shaped IWorld stub, the party/social/entity fields are the online-mirror shape).

Then integrate both into hud.ts: replace the inline blocks at 4186-4245 and 5022-5258 with calls into
the new painters wired through PainterHost (auras via the elided writers; the minimap via the thin
canvas painter), removing the dead inline code and the ad-hoc __sig cache. Update client_shell.test.ts
if any DOM id moved into a painter (decision 17: hud.ts stays the wiring hub; the line count drops as
the inline blocks become painter calls).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only (decision 4). CONSUME V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim / server / src/net / headless. If you find you need to, STOP and surface it (scope change).
- The AURAS painter routes per-frame writes through the existing write-elision cache (hotWriteCache +
  setText/setDisplay/setTransform/setWidth, hud.ts:1322-1372) plus the P10a setStyleProp/toggleClass
  facet (decision 5a) via PainterHost. No raw style/textContent/setAttribute the helpers do not own;
  document any unavoidable raw write per decision 5a. No reactivity, Shadow DOM, or signals. The
  MINIMAP canvas painter is EXEMPT from the elided-writer routing rule (a 2D context cannot route
  through DOM writers); it is gated on the 10Hz cadence + cached background + frameP95, and its one DOM
  write (#zone-label) routes through setText.
- Pure cores are allocation-light (no per-frame garbage; the P12a allocation proxy is the budget) and
  DOM/Three-free; no Math.random / Date.now / performance.now in any registered core (guarded by
  tests/architecture.test.ts). Same input gives same output.
- AURAS keyed pool (Top risk 3): the pooled slot is a MUTABLE RECORD; the tooltip/listener attach ONCE
  per pooled node and READ the slot live; never capture-by-value (stale after recycle); never
  innerHTML-wipe; never drop or duplicate a tooltip/listener.
- MINIMAP core (deep-review correction): model the markers as a DISCRIMINATED Marker UNION (delve
  schematic / NPC glyph / proximity-scaled party disc+arrow / player). Do NOT carry the OLD "build Sets
  off the hot path" or "collapse the double-scan" claims; they are false against live source.
- DECISION 10 (WCAG 2.2 AA chrome): the aura strip conveys meaning beyond color (text/aria); any
  interactive aura is a real control with a visible :focus-visible and target-size >=24px (>=40x40 on
  mobile). The 3D world canvas is out of a11y scope; state the minimap-canvas a11y boundary honestly
  (it is a canvas; the zone label is the textual surface).
- DECISION 12 (no magic values): the auras DOM painter drives tokens; the minimap CANVAS painter
  resolves --color-* via getComputedStyle ONCE per redraw (cached, never per-marker) and names every
  other literal (hex, font, S=162, pad, radii). The no-magic-values painter guard (incl the canvas
  sub-rule) must pass.
- DECISION 15 (ClientWorld-vs-Sim parity): the auras_view and minimap_markers tests each feed BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub; do not assume a Sim-only field shape (the
  party / social / entity / aura cadences are the most likely to differ online).
- No generated-file hand-edits; regenerate via the build.
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).

Out of scope (do NOT do in this phase):
- Action bar + the allocation-budget spike (P12a; this phase REUSES the proxy P12a resolved).
- FCT pool + per-frame driver (P13a/P13b).
- Per-element graphics tiering (the minimap 10Hz->4Hz cadence-per-tier and the aura visible-count/tick
  granularity are P14a). This phase keeps the existing 10Hz minimap cadence and the existing aura
  visible-count.
- xp bar / swing timer / player frame + unit_frame family (P10a/P10b), cast bars / target frame / party
  frames (P11a/P11b/P11c).
- Any CSS changes (P1-P4) or ui_effects_profile changes (P5).
- Extending IWorld or any sim/server/net change.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: npx tsc --noEmit.
- Pure cores added: npx vitest run tests/auras_view.test.ts tests/minimap_markers.test.ts + npx vitest
  run tests/architecture.test.ts (the UI-purity guard + the no-magic-values painter guard incl the
  canvas sub-rule) + the same-input-same-output assertions + the ClientWorld-vs-Sim parity assertion
  for BOTH cores (decision 15; both stub shapes). Verify the purity guard FAILS when you inject a REAL
  DOM/import code line into a core (a // comment is stripped by stripComments; inject an actual code
  line).
- New .ts module added: biome check on the new/changed .ts (src/ui/auras_view.ts,
  src/ui/auras_painter.ts, src/ui/minimap_markers.ts, src/ui/minimap_painter.ts); do not accrue lint
  debt.
- WINDOW/CONTROL a11y row (decision 10): the WCAG 2.2 AA checks on the built aura strip (automated
  axe-core or equivalent: meaning beyond color; any interactive aura is a real control with keyboard
  reachability + focus-return; visible :focus-visible never animated away; a forced-colors: active
  snapshot keeps the buff/debuff distinction; target-size >=24px, and >=40x40 if a mobile touch
  control). State the minimap-canvas a11y boundary (canvas; the zone label is the textual surface).
  Plus the no-magic-values painter guard (decision 12; the auras DOM painter references tokens/vars,
  the minimap canvas painter resolves --color-* once per redraw and names every literal).
- PER-FRAME perf gate: npm run the perf_tour harness (desktop + mobile) and assert frameP95 <= the P0
  baseline AND hudHotDomSkipRate >= the P0 baseline. PLUS the allocation-budget assertion REUSING the
  P12a proxy: the auras core allocates no new per-frame array/object (the reused-buffer reference is
  the floor); the minimap core, gated on its 10Hz cadence, does not allocate per-marker garbage on the
  hot path (measured by the same proxy or the documented perf_tour fallback).
- A unit test that the AURAS painter routes ALL writes through the host's elided writers (no raw
  style / textContent / setAttribute beyond a documented allowed write); plus the keyed-pool stale-
  capture + no-duplicate-listener tests. The MINIMAP canvas painter is EXEMPT from the routing test;
  its gate is the 10Hz cadence + cached background + frameP95 (assert the background is rebuilt only on
  module change, and #zone-label routes through setText).
Review dispatch (Review Dispatch Matrix): qa-checklist only. This is presentation-only; it consumes the
already-landed IWorld in painters, so cross-platform-sync, privacy-security-review, and migration-safety
do NOT fire (the ClientWorld-vs-Sim obligation is covered by the per-core parity test, not by spawning
cross-platform-sync). Prompt the reviewer for COVERAGE not filtering; resume a truncated reviewer per
the state.md script. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths (no git add -A). Suggested:
- feat(ui): replace auras innerHTML-wipe with keyed-pool core + painter, mutable-slot tooltip
  (paths: src/ui/auras_view.ts, src/ui/auras_painter.ts, tests/auras_view.test.ts,
  tests/auras_painter.test.ts, tests/architecture.test.ts)
- feat(ui): extract minimap_markers core (discriminated Marker union) + thin canvas painter
  (paths: src/ui/minimap_markers.ts, src/ui/minimap_painter.ts, tests/minimap_markers.test.ts,
  tests/architecture.test.ts)
- refactor(ui): wire auras + minimap painters into hud.update, drop inline blocks and __sig
  (paths: src/ui/hud.ts, tests/client_shell.test.ts)
- docs(frontend): record P12b in progress.md + state.md ledger
  (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)
TAG the green-perf-gate commit (decision 6 / Step 6) so a later cumulative regression bisects to this
phase.

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes.
- [ ] The auras strip and the minimap are each driven by a pure core (auras_view / minimap_markers)
  plus a thin painter; the inline blocks at hud.ts:4186-4245 and 5022-5258 are replaced by painter
  calls and the ad-hoc __sig cache is gone.
- [ ] AURAS: the painter is a typed keyed per-aura node pool (no innerHTML-wipe); the debuff allowlist
  lives in the core; the pooled slot is a MUTABLE record the tooltip/listener read LIVE; a stale-capture
  regression test (recycle slot A->B) and a no-duplicate-listener test pass; the painter routes all
  writes through the elided helpers (no raw write beyond a documented one).
- [ ] MINIMAP: the core returns a DISCRIMINATED Marker UNION (delve schematic / NPC glyph / proximity-
  scaled party disc+arrow / player); the friend/guild/party classification is correct; the OLD "Sets
  off the hot path" / "collapse double-scan" claims are NOT present (they are false against live
  source); the canvas painter keeps the 10Hz cadence + the cached background (rebuilt only on module
  change) and routes #zone-label through setText.
- [ ] Both cores are registered in UI_PURE_CORES; npx vitest run tests/architecture.test.ts passes; the
  purity guard provably FAILS on an injected real DOM-import line in a core.
- [ ] DECISION 15: both core tests drive a Sim-shaped AND a ClientWorld-mirror-shaped IWorld stub with
  identical output.
- [ ] DECISION 10 a11y: the aura strip conveys meaning beyond color; any interactive aura is a real
  control (keyboard, visible :focus-visible, target-size >=24px, >=40x40 on mobile); the forced-colors
  snapshot keeps the buff/debuff distinction; the minimap-canvas a11y boundary is stated; the chrome
  a11y checks pass.
- [ ] DECISION 12 no-magic-values: the auras DOM painter drives tokens; the minimap canvas painter
  resolves --color-* via getComputedStyle ONCE per redraw (cached, never per-marker) and names every
  other literal (hex, font, S=162, pad, radii); the no-magic-values painter guard (incl the canvas
  sub-rule) passes.
- [ ] biome check passes on the new/changed .ts.
- [ ] ALLOCATION BUDGET: the auras and minimap cores meet the allocation-budget proxy RESOLVED in P12a
  (reused buffers / no per-frame garbage on the hot path); the proxy is the SAME one P12a recorded, not
  a new one.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND
  hudHotDomSkipRate >= P0 baseline; the minimap canvas gate (10Hz cadence + cached background +
  frameP95) holds; the numbers are recorded; the green-perf-gate commit is tagged.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; no new i18n keys (or a single English-only
  hud_chrome.ts key if a label was unavoidable).

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P12b done with the new files (auras_view/painter, minimap_markers/painter + tests),
  the perf-gate numbers vs the P0 baseline, and that the allocation budget reused the P12a proxy.
- state.md: ledger row P12b -> done; add auras_view and minimap_markers to the "Existing pure cores to
  REUSE" list; note the minimap canvas painter keeps the 10Hz cadence (P14a will tier it 10Hz->4Hz) and
  the aura visible-count (P14a tiers it); confirm the allocation-budget proxy decision is the P12a one
  (no new proxy introduced).
- Memory: record the surprising rules: the keyed-pool MUTABLE-SLOT tooltip-reads-live pattern (capture-
  by-value goes stale after recycle); the minimap Marker DISCRIMINATED-UNION shape; that the OLD recon
  "build Sets off hot path / collapse double-scan" claim was false against live source (the Sets are
  already built once per 10Hz call and the loops iterate different collections); and the canvas-token
  getComputedStyle-once policy.

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), validation results (tsc, the two core test files +
the auras painter tests, architecture guard incl no-magic-values + the canvas sub-rule, biome, the
a11y checks on the aura strip + the minimap boundary, the perf gate numbers incl the reused
allocation-budget assertion and the minimap cadence gate), the qa-checklist verdict, and any deferrals
(minimap cadence-per-tier + aura visible-count tiering -> P14a). End with exactly:
Next: phase-13a-perframe-fct-core-driver.md

STOPPING RULES:
- STOP if any per-frame extraction regresses perf_tour frameP95 above the P0 baseline OR drops
  hudHotDomSkipRate below the P0 baseline; do not commit a perf regression, diagnose the raw-write or
  cache-key cause first.
- STOP if the auras keyed pool drops or duplicates a tooltip or listener, OR if the tooltip captures an
  aura by value (it must read the MUTABLE slot live, so it stays correct after a recycle); do not ship
  an innerHTML-wipe or stale-capture regression.
- STOP if the minimap core cannot be modeled as a discriminated Marker union without changing visuals
  or cadence; do not flatten it to a single Marker[] that loses a draw branch.
- STOP if a canvas literal cannot be named or a --color-* token cannot be resolved once per redraw
  (cached) without going per-marker; do not weaken the no-magic-values canvas sub-rule.
- STOP if the P0 perf baseline or the P12a allocation proxy is missing (the gate cannot run).
- STOP and surface a scope change if the phase finds it needs to extend IWorld or touch sim/server/net.
- If the working set approaches the ~40% context ceiling, STOP and split further before continuing.
```

## Notes for the planner

This is the second half of the old P12 split: it isolates the two remaining hard per-frame elements
(the auras keyed pool, Top risk 3, and the minimap canvas, Top risk 7) so they land with a fresh-session
budget under the 40% ceiling including QA and in-session remediation, reusing the allocation-budget
proxy that P12a resolved (no second spike). The auras correctness constraint is the keyed-pool
mutable-slot rule: replacing the __sig + innerHTML-wipe with a per-aura node pool is only safe if the
tooltip/listener attach ONCE and READ the slot's live fields, because a closure that captures the aura
by value goes stale the moment the pool recycles that slot to a different aura, which tsc and a naive
unit test do not catch; the stale-capture regression test (recycle A->B, assert the tooltip shows B) is
the explicit guard. The minimap framing carries the deep-review corrections verified against live source:
the markers are a DISCRIMINATED union (delve schematic / NPC glyph / proximity-scaled party disc+arrow /
player), NOT a flat array, and the OLD "build the friend/guild/party Sets off the hot path" and
"collapse the double-scan" claims are dropped because the live code already builds those Sets once per
10Hz call and the entity vs party loops iterate different collections, so there was never a double-scan
to collapse. The minimap painter is a CANVAS painter, so it is EXEMPT from the elided-writer routing
test (a 2D context cannot route through the DOM writers); its gate is the 10Hz cadence + the cached
delve-schematic background + frameP95, while its one DOM write (#zone-label) routes through setText.
Decision 12's canvas sub-rule is the load-bearing painter constraint here: roughly 15 hex literals, a
font literal, the canvas size, the pad, and the marker radii all become named constants, and the
--color-* tokens resolve via getComputedStyle ONCE per redraw (cached on the painter), never per-marker.
Decision 10 a11y and decision 15 ClientWorld-vs-Sim parity are built IN, with the minimap-canvas a11y
boundary stated honestly rather than over-claimed. Finishing the hard batch here leaves every element as
a clean core+painter that P14a can attach a static-preset tier knob to (minimap cadence, aura
visible-count) without re-touching the hot path.
