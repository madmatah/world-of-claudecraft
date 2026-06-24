# Phase P7a: Cold-window: talents (interactive, mutable edit buffer)

Extract the talents window (`renderTalents`, `hud.ts:10909`) out of the `hud.ts` monolith into a pure
`talents_view.ts` core plus a thin painter composed through the PainterHost seam P6 introduced. This
window is interactive and mutable: it edits a LOCAL `talentStage` buffer (a `cloneAllocation` of
`sim.talents`), so the core takes that buffer plus class plus total points as INPUTS, it is NOT
IWorld-derived. Presentation-only: do not touch sim/server/net.

## Starter Prompt

```
This is Phase P7a of the Frontend Modernization v0.16.0 packet: Cold-window extraction, the talents window (interactive, mutable edit buffer).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a single window (talents) with a mutable local edit buffer and a tree/spec-tab/footer fan-out. It is one focused extraction, not a multi-slice batch, so run it as one careful pass with a review fan-out at the end, not a parallel Workflow.

Goal: Move renderTalents (hud.ts:10909) and its helpers (renderSpecTab, renderTalentTree, talentFooterHtml, wireTalentFooter, stageSetSpec and the talentStage lifecycle) out of the hud.ts monolith into the FB Humble-Object shape: a pure host-agnostic src/ui/talents_view.ts core that derives the talent-tree render model (which tiers/points are spendable, per-node state avail/filled/maxed/locked/dormant, tree/spec layout, footer counts), plus a thin src/ui/talents_window.ts painter that paints that model into the DOM through the PainterHost dep-bag from P6 (icon/tooltip helpers + the elided writers). Register talents_view in the P0 UI-purity allowlist. client_shell.test.ts must be updated for any DOM ids that move from hud.ts into the painter.

CRITICAL FRAMING - the talents core is NOT IWorld-derived. renderTalents edits a mutable LOCAL edit buffer: this.talentStage is a cloneAllocation(this.sim.talents) (created at hud.ts:10928, hud.ts:10890; nulled on close at hud.ts:10960/10886/1629), mutated in place by stageSetSpec / node spend / footer reset, and only committed to the sim on Apply. So the pure core's INPUTS are (talentStage: TalentAllocation, the mutable buffer) + (cls: the player class) + (total: this.sim.talentPoints().total) + the static content table talentsFor(cls). The core derives the render model from those inputs; it does NOT read combat/world state off IWorld and must not pretend talentStage comes from IWorld. The painter owns the mutation callbacks (spend/reset/setSpec) that write back into the same buffer object and re-derive. Keep cloneAllocation / validateAllocation / dormantNodes / pointsSpent usage exactly as the inline version computes spendability, so the gating is byte-identical.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This is a shared checkout; if it is not clean, STOP and ask the user before touching anything.
- Memory scan: read MEMORY.md and the entries [[frontend-phase7-hud-window-extraction]] (the FB cold-window extraction, the proven core+painter+PainterHost seam pattern, the purity-guard hardening that rejects a pure core importing a *_painter/painter_host, and the sed-clip hazard), [[frontend-phase6-window-encapsulation]] (window @layer/#id isolation), and [[pr741-sunder-armor-display]] (aura/stack display notes).
- Confirm you are in the feature/frontend-modernization-v016 worktree (off release/v0.16.0).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps):
- docs/frontend-modernization/state.md. Cite by section: locked decisions 4 (presentation-only), 6 (PainterHost two facets), 9 (component contract: instance-parameterized core + thin painter), 10 (WCAG 2.2 AA on the window, built IN here not deferred to P15), 12 (no magic values in painters), 15 (ClientWorld-vs-Sim parity for cores); the non-negotiable constraints; the validation matrix (the WINDOW-or-CONTROL row is MANDATORY); the review dispatch matrix; and the Key file paths (renderTalents 10909, mutable talentStage edit buffer, NOT IWorld-derived).
- This phase file (phase-07a-coldwindow-talents.md).
- The "### P7-P9 Cold-window extraction" section of docs/frontend-modernization/v016-recon-and-packet.md plus its "Load-bearing structural findings" + "Top risks" sections.
- The SPECIFIC source ranges this phase touches, with their real V16 line numbers:
  - renderTalents body: hud.ts:10909-10973 (talentStage gating, tab fan-out, footer wire).
  - The helpers: renderSpecTab (~10975), renderTalentTree (~11043, the layout constants + arrow/node state), talentFooterHtml + wireTalentFooter (grep them near 11162-11360), stageSetSpec (~11029), and the talentStage lifecycle (10886/10890/10928/10960/1629).
  - For the seam: src/ui/painter_host.ts (from P6) and the FB-ported vendor_window.ts/vendor_view.ts as the template the new window must match.
  - tests/architecture.test.ts UI_PURE_CORES allowlist and tests/client_shell.test.ts (moved DOM ids).
The orchestrator keeps the summary, not the raw file dumps. The talents window is one window with a deep helper tree; it fits well under 40% but if the working set approaches the ceiling, STOP and split (the painter is the bigger half; land the pure core + its test first, then the painter).

STEP 2 - ORCHESTRATION + EXECUTE (one careful pass):
- Create src/ui/talents_view.ts (pure core, DOM/Three-free, deterministic, no Math.random/Date.now/performance.now). It takes (talentStage, cls, total) + talentsFor(cls) and returns a render model:
  - The header counts (available = max(0, total - spent), total, spent via pointsSpent), the per-tree spent counts (class/spec) for the tab pips.
  - The spec list (each spec's selected flag, role, signature/mastery name+description discriminators - NOT the t() strings; the painter localizes).
  - The tree layout: cols/rows and per-node (cx, cy, shape square/octagon/circle, state one of dormant/maxed/filled/avail/locked, ranks, chosen-choice id) using cloneAllocation + validateAllocation + dormantNodes exactly as the inline version. The arrows (from->to + filled flag).
  - Spendability MUST match the inline logic byte-for-byte (canAdd = ranks < n.maxRank && validateAllocation(cls, cand, total).ok). This is the gating; a test pins it.
- Create src/ui/talents_window.ts (thin painter via PainterHost: icon/tooltip dep-bag + elided writers). The painter:
  - Renders the header/tabs/tree/spec-cards/footer from the core model and owns the mutation callbacks (stageSetSpec, node spend/right-click choice, footer spend/reset) that mutate the SAME talentStage object the host passed in, then re-derive + repaint. Do NOT clone a second buffer in the painter; the host owns the one buffer.
  - Preserves the talentStage gating: the early-return when the window is hidden AND talentStage is null; create-on-first-open; null-on-close.
  - Wires the footer (talent-point spend/reset/Apply) exactly once per render and does NOT duplicate listeners (the tab/spec/node listeners are attached on freshly-created elements each render, which is fine; do not double-attach to a reused element).
  - NO MAGIC VALUES (decision 12): tokenize the inline literals. The class-name accent #998d6a (hud.ts:10917/10938), the filled-arrow #f5c843 and unfilled #5a4a22 (hud.ts:11080), and the signature gold #ffd100 (hud.ts:11001) become named constants resolved from --color-* tokens (these are DOM/SVG painter writes, so drive them via CSS custom properties / a class, not a TS hex literal). The tree layout constants CW=86, CH=70, NS=46, TOP=6 (hud.ts:11060-11063) become named constants in the core (TALENT_CELL_W etc.), not bare numbers in the painter.
  - STRIP em-dash literals from moved markup: the mastery lines use a literal "—" (hud.ts:11002 the tooltip mastery line, hud.ts:11021 the tal-mastery block). Replace with a comma or " - " (ASCII) in the NEW painter text. No em/en dashes anywhere in the new files.
- Register talents_view in tests/architecture.test.ts UI_PURE_CORES.
- Replace the inline renderTalents body (and move its helpers) with a thin delegate call into the painter. Run tsc after the edit (the FB lesson: interleaved clips compile-break silently).
- Add tests/talents_view.test.ts.

INVARIANTS THIS PHASE MUST KEEP (state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): the buffer is local; reading sim.talents / sim.talentPoints() to SEED the buffer is the existing inline behavior and is fine, but do NOT extend IWorld or touch src/sim, server, src/net, or headless. If the window appears to need a new IWorld member, STOP and surface it.
- PainterHost is a THIN compose-in host (decision 6): compose its dep-bag (icon/tooltip + elided writers); do not invent a new seam.
- Pure core stays DOM/Three-free and deterministic: no Math.random / Date.now / performance.now (guarded by tests/architecture.test.ts + UI_PURE_CORES; the guard also rejects a pure core importing a *_painter / painter_host).
- i18n: every player-visible label stays a t() key; the core emits discriminators (spec/mastery/signature ids), the painter calls t()/tTalent(). Any NEW control label goes in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. No concat, no `?? 'English'` fallback for labels.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits). Strip the mastery "—" as above.
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.

Out of scope (do NOT do in this phase):
- social + bags = P7b; options/market/char = P8a/P8b; map/arena/questlog/leaderboard/spellbook = P9a/P9b.
- Any per-frame / hot-path element = P10-P14. Talents is COLD (open-on-demand); do not add it to hud.update()'s frame divider.
- CSS extraction for this window (handled in P3); do not move CSS here.
- Per-element graphics tiering (P14). No fxLevel knobs on this window.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md "Validation matrix"):
- Baseline: `npx tsc --noEmit`.
- Pure core added: `npx vitest run tests/talents_view.test.ts` + `npx vitest run tests/architecture.test.ts` (UI-purity guard, confirms talents_view is in UI_PURE_CORES and DOM/Three-free) + a same-input-same-output assertion on the gating model.
- ClientWorld-vs-Sim parity (decision 15, MANDATORY): the talents core is fed via a (talentStage, cls, total) input bag rather than IWorld directly, but the SEED values come from a world (sim.talents / sim.talentPoints()). Drive the talents_view test with BOTH a Sim-shaped and a ClientWorld-mirror-shaped source for those seed inputs (same TalentAllocation shape, same talentPoints().total cadence) and assert identical render models. Document in the test that the buffer itself is a local clone, so the parity surface is the seed read, not a per-frame IWorld field.
- New .ts module added: `biome check` on src/ui/talents_view.ts + src/ui/talents_window.ts (the V16 ratchet; do not accrue lint debt).
- DOM ids moved: `npx vitest run tests/client_shell.test.ts` (update greps for any id now living in the painter).
- WINDOW or CONTROL changed (MANDATORY, decision 10): the WCAG 2.2 AA chrome checks over the BUILT talents window: automated axe-core (or equivalent) clean; keyboard reachability of the close button, the class/spec tablist (role=tablist/tab/tabpanel, arrow-key tab nav), the spec radiogroup (role=radiogroup/radio, roving tabindex), and the tree nodes (role=button, tabindex 0, keyboardActivate on Enter/Space); focus-return to the opener on close; a visible :focus-visible that is never animated/transitioned away; a forced-colors: active snapshot (node state must survive when background-image meaning is stripped, so state is also carried by border/text, not color alone); target-size >= 24px for tabs/nodes/footer buttons and >= 40x40 on any mobile touch control. Keep the existing role/aria/tabindex wiring (it is already on the inline version at 10941-10943, 10982-10996, 11107-11108); do not regress it.
- No-magic-values painter guard (MANDATORY, decision 12): the painter references tokens / CSS custom properties / named constants for the class-accent / arrow / signature colors and the CW/CH/NS/TOP layout; no raw hex or bare layout number survives in the painter. A guard or a grep in the test asserts no `#` hex literal in talents_window.ts.
- Full pre-commit sanity: `npm test` (the guards live in the suite).
This is NOT a per-frame phase, so there is NO perf gate (no perf_tour, no skip-rate assertion): talents is cold/open-on-demand, not in hud.update()'s every-frame path.
Review dispatch (state.md Review Dispatch Matrix): spawn qa-checklist only. privacy-security-review / migration-safety / cross-platform-sync do NOT fire (no server/net/IWorld/sim/wire change; consuming/seeding from the landed sim in a painter is not an IWorld change). Prompt the reviewer for COVERAGE not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 4 - COMMIT CADENCE:
2 to 4 Conventional Commits with a scope and EXPLICIT paths (never `git add -A`). Suggested:
- `refactor(ui): extract talents window to talents_view core + painter` (src/ui/talents_view.ts src/ui/talents_window.ts src/ui/hud.ts).
- `test(ui): talents_view gating + ClientWorld-vs-Sim seed parity` (tests/talents_view.test.ts tests/architecture.test.ts).
- `test(ui): update client_shell ids for talents painter` (tests/client_shell.test.ts) - only if ids moved.
- `docs(frontend): record P7a talents extraction in progress.md + state.md ledger` (docs/frontend-modernization/progress.md docs/frontend-modernization/state.md).

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] `npx tsc --noEmit` is clean.
- [ ] talents has a pure src/ui/talents_view.ts core (no DOM/Three import, no Math.random/Date.now/performance.now) and a thin src/ui/talents_window.ts painter composed through PainterHost.
- [ ] talents_view is registered in UI_PURE_CORES and `npx vitest run tests/architecture.test.ts` passes (purity guard green, incl rejecting a *_painter/painter_host import from the core).
- [ ] The core takes the mutable talentStage edit buffer + cls + total as INPUTS (NOT IWorld-derived); the painter owns the spend/reset/setSpec callbacks that mutate that same buffer and re-derive.
- [ ] talentStage gating is preserved byte-for-byte: spendable tiers/points, per-node state, and the early-return / create-on-open / null-on-close lifecycle match the inline version (covered by tests/talents_view.test.ts).
- [ ] tests/talents_view.test.ts passes with a same-input-same-output assertion AND the ClientWorld-vs-Sim seed-parity assertion (both world-shaped seed sources yield identical render models).
- [ ] WCAG 2.2 AA chrome row green: axe clean; tablist/radiogroup/tree keyboard-reachable with roving tabindex and Enter/Space activation; focus returns to opener on close; visible :focus-visible never animated away; forced-colors snapshot keeps node state legible; target-size >= 24px (>= 40x40 mobile).
- [ ] No-magic-values guard green: #998d6a / #f5c843 / #5a4a22 / #ffd100 and CW/CH/NS/TOP are named constants / tokens; no raw hex in talents_window.ts.
- [ ] No em dashes anywhere; the moved mastery lines use a comma or ASCII " - ".
- [ ] `npx vitest run tests/client_shell.test.ts` passes with any moved DOM ids updated.
- [ ] `biome check` on the two new .ts modules is clean.
- [ ] `npm test` is green.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] hud.ts renderTalents is now a thin delegate; no IWorld/sim/server/net/headless file changed; no i18n.locales overlay edited.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md: mark P7a complete with the module list (talents_view, talents_window), the test file, the hud.ts line-count delta, and any deferral.
- Update state.md: flip the P7a ledger row to done; if UI_PURE_CORES or the client_shell id list grew, note it in Key file paths / ledger.
- Record surprising rules in memory: the talentStage-is-a-local-mutable-buffer framing (the core takes it as input, not from IWorld), the exact spend/reset/setSpec mutation ownership chosen (painter mutates the host's single buffer), and any sed-clip / interleaved-edit hazard hit.

STEP 7 - FINAL RESPONSE:
Report: status (done / done-with-deferral), files created/changed (absolute paths), validation results (tsc, talents_view test incl parity, architecture guard, WCAG row, no-magic-values guard, biome, client_shell, npm test), the qa-checklist verdict, and any deferral. End with exactly:
Next: phase-07b-coldwindow-social-bags.md

STOPPING RULES:
- STOP and surface a scope change if the talents window appears to need a NEW IWorld member or a sim/server/net change (presentation-only; seeding the local buffer from the landed sim is fine, extending IWorld is not).
- STOP if the window cannot be made a pure core + thin painter without leaking DOM/Three into the core (do not weaken the purity guard to make it pass).
- STOP and split the phase if the working set approaches the ~40% context ceiling (land the pure core + its test first, defer the painter to a follow-up slice).
- Do NOT touch any per-frame / hot path; if you find yourself editing hud.update()'s frame divider, you are in the wrong phase.
```

## Notes for the planner

P7a carves the interactive, mutable-buffer window off the old P7 trio so it gets a full session for the
one piece that does NOT fit the IWorld-derived cold-window mold. The load-bearing correctness point is
the framing: `talentStage` is a `cloneAllocation` of `sim.talents` (hud.ts:10928/10890), mutated in
place by spend/reset/setSpec and only committed on Apply, so the core takes the buffer plus class plus
total as INPUTS and the painter owns the write-back. Getting the gating byte-identical
(validateAllocation/dormantNodes/pointsSpent) is what a test must pin. The deep-review additions are the
WCAG row (the inline version already carries the tablist/radiogroup/tree-button aria, so the obligation
is to preserve it and add the keyboard/focus-return/forced-colors proofs), the no-magic-values tokenizing
of the four inline hexes and the CW/CH/NS/TOP layout constants, stripping the mastery em-dash literals,
and the ClientWorld-vs-Sim seed-parity assertion. Landing talents alone first validates the P6 seam
under the hardest cold-window before the simpler social+bags pair in P7b.
