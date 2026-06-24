# Phase P11b: Per-frame: target frame (unit_frame instance)

Reshape the target frame (hud.ts:3672-3749) as an INSTANCE of the P10b unit_frame FAMILY (the player was
its first instance), not a bespoke target_frame_view core. Preserve the lastPortraitTarget portrait
change-gate, the combo-pip lazy-build, the elite/boss tag, and the target debuffs; route the classList
toggles and the raw target-name color write through the P10a elided setStyleProp/toggleClass; cache the
target absorb node per instance instead of the hardcoded `#tf-absorb` per-call query; and consume P11a's
cast_bar target instance for the target cast bar.

## Starter Prompt

```
This is Phase P11b of the Frontend Modernization v0.16.0 packet: Per-frame: target frame (unit_frame instance).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. The target frame is one richer instance with multiple stateful sub-parts (the portrait change-gate, the lazy-built combo pips, the elite/boss tag, the target debuffs, the per-instance absorb node, the consumed cast instance), each a write-elision and a11y hazard, plus a per-frame perf gate. Fan out the family-instance wiring, the portrait/combo/absorb sub-parts, and the a11y/no-magic verification as parallel sub-tasks and adversarially verify against the perf gate and the portrait-redraw-only-on-target-change test. It is a per-frame slice, the case state.md names for ultracode + Workflow.

Goal: Move the target frame (src/ui/hud.ts:3672-3749) out of hud.ts as an INSTANCE of the P10b unit_frame family core+painter (NOT a new bespoke target_frame_view module). P10b landed unit_frame as a parameterized core+painter with the player as its first instance and validated the descriptor against the FULL target/party field set (decision 9), so this slice instantiates the family for the target with NO core change. The target instance layers target-only concerns on the shared frame: the elite/boss tag, the target debuffs (via the existing auras paint), the target cast bar (P11a's cast_bar painter target instance, CONSUMED not rebuilt), the combo-pip lazy-build, and the lastPortraitTarget portrait change-gate. No behavior change, presentation-only, with a hard perf gate, WCAG 2.2 AA on the target frame, and token-driven painter values.

STEP 0 - PRE-FLIGHT:
- git status must be clean. This checkout is shared with concurrent sessions; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the relevant entries. Relevant: [[frontend-phase7-hud-window-extraction]] (Humble Object pure-core-plus-painter behind PainterHost; the purity-guard perturbation must inject a REAL code line), [[frontend-phase8-graphics-tier-effects]] (write-elision and applier wiring; live computed-style proofs), [[phased-packet-qa-cadence]] (never skip the QA pass after this phase), [[no-em-dashes-or-emojis]], [[shared-worktree-commit-care]], and this packet's state.md locked decisions (esp. 3 + 5 + 5a write-elision and the writer extension, 9 component contract / unit_frame family, 10 accessibility, 12 no-magic-values-in-painters, 15 ClientWorld-vs-Sim parity).
- This phase depends on P10b (the unit_frame FAMILY core+painter, player as first instance), P10a (the write-elision EXTENSION setStyleProp/toggleClass), P11a (the cast_bar painter target instance), and the P0 perf baseline. Confirm: the unit_frame family core+painter exist and its descriptor was validated against the FULL target field set; the write-elision facet exposes setStyleProp(el, prop, val) + toggleClass(el, cls, on); P11a's cast_bar painter exposes a target instance; the absorbBarView core exists; the P0 frameP95 + hudHotDomSkipRate baseline is recorded. If the unit_frame family, the P10a writer extension, P11a's target cast instance, or the P0 baseline is missing, STOP: this slice builds the target instance ON the family and gates against the baseline.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn one Explore agent to read + summarize, returning a compact orchestrator brief (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 9, 10, 12, 15; the non-negotiable constraints; the per-frame perf-gate row AND the WINDOW/CONTROL a11y row of the validation matrix; the Review Dispatch Matrix; the write-elision file refs at hud.ts:1322-1372 and the P10a extension).
- This phase file.
- The '### P11' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the "Load-bearing structural findings" and "Top risks" sections (risk 1 write-elision byte-identity and risk 3 portrait/listener drops are this slice's).
- The unit_frame FAMILY core+painter EXACTLY as P10b landed it (the parameterized instance shape: how the player instance is constructed, the per-instance descriptor and which fields it already covers for the target, where the family registers in UI_PURE_CORES). Do NOT re-derive the family.
- P11a's cast_bar painter target instance (how to drive it from the target frame). Do NOT rebuild the cast bar.
- The SPECIFIC V16 source ranges this phase touches, by exact line number:
  - Hud.update() entry + frame divider: src/ui/hud.ts:3627.
  - Write-elision helpers + cache: src/ui/hud.ts:1322-1372 (setText/setDisplay/setTransform/setWidth + hotWriteCache) and perfStats() (hotDomWrites/hotDomSkippedWrites/hotDomSkipRate).
  - Target frame: src/ui/hud.ts:3672-3749. Note the EXACT sub-parts:
    - The show/hide + classList.toggle('elite', ...) at 3675-3676 (the elite class is NOT covered by the four original writers; route through toggleClass).
    - The elite/boss tag text 3677-3680 (t('hud.core.boss')/t('hud.core.elite') resolved in hud, must stay a t() call in the painter, never concat).
    - The name + level + HP scale + HP text 3681-3688 (setText/setTransform via the existing writers).
    - The absorb update 3684: this.updateAbsorb('#tf-absorb', ...) uses a HARDCODED selector + a per-call document query. Replace with a CACHED per-instance absorb node (resolve the node ONCE at instance construction, drive absorbBarView through the elided writers), drop the '#tf-absorb' string.
    - The raw target-name color write 3689-3691: this.targetNameEl.style.color = targetNameColor (var(--color-hostile)/var(--color-friendly)). This raw style write is NOT covered by the four original writers; route through the P10a setStyleProp(el, 'color', val).
    - The lastPortraitTarget portrait change-gate 3692-3708: portrait redraws ONLY when target.id changes (drawClass for players, drawCrest for mobs); preserve it exactly, and the reset to -999 on no target at 3748.
    - The target debuffs 3709: this.renderAuras(this.targetDebuffsEl, target, 'debuffs') (CONSUME the existing auras paint, do NOT rewrite the auras pool, that is P12).
    - The target cast bar 3712-3727: CONSUME P11a's cast_bar painter target instance (it already moved there in P11a); do not re-inline it.
    - The combo pips 3729-3745: the lazy-build (build 5 pips once when comboRowEl.children.length !== 5, then toggle 'on' per point); preserve the lazy-build (built once, then updated, never rebuilt per frame); the combo count is p.comboTargetId === target.id ? p.comboPoints : 0.
    - The no-target branch 3746-3749 (hide the frame, reset lastPortraitTarget).
  - The existing cores to REUSE: the unit_frame family (P10b), absorbBarView, P11a's cast_bar target instance. Do NOT re-derive these.
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode + a Workflow. Fan out three parallel sub-tasks, then the orchestrator integrates sequentially (re-running tsc after each merge) since they converge on hud.ts and the family painter:

  Sub-task 1 - Construct the target frame as a unit_frame INSTANCE (NOT a bespoke core).
  - Instantiate the P10b unit_frame family core+painter with a TARGET instance descriptor (the player was the first instance). Pass the target's element refs (frame, name, level, HP, HP text, portrait). Do NOT add a parallel target_frame_view module. If the family genuinely cannot express a target-only field without a change, EXTEND the family's instance descriptor (one shared family, the descriptor P10b validated against the full target field set should already cover it), do not fork it. If you find you must fork, STOP (decision-9 gap).
  - Route the shared-frame writes through the elided writers exactly as the player instance does (setText name/level/HP-text, setTransform HP scale). The elite class toggle goes through toggleClass(frameEl, 'elite', isElite); the target-name color goes through setStyleProp(nameEl, 'color', var-token). No raw classList/style writes.

  Sub-task 2 - The target-only sub-parts on the instance.
  - Elite/boss tag: setText the tag with t('hud.core.boss') / t('hud.core.elite') (resolved in the painter, never concat); toggle the 'elite' class via toggleClass.
  - Absorb: CACHE the target absorb node per instance (resolve once at construction, no '#tf-absorb' selector, no per-call query); drive absorbBarView through the elided writers.
  - Portrait change-gate: preserve the lastPortraitTarget gate verbatim (portrait redraws ONLY when target.id changes; drawClass vs drawCrest; reset to the no-target sentinel on hide). The gate state lives on the instance, not a shared field.
  - Combo pips: preserve the lazy-build (build the 5 pips once, then toggle 'on'; never rebuild per frame); the pip 'on' toggle goes through toggleClass.
  - Target debuffs: CONSUME the existing renderAuras('debuffs') paint (do NOT rewrite the auras pool, P12).
  - Target cast bar: CONSUME P11a's cast_bar painter target instance.
  - Painter values token-driven (decision 12): the hostile/friendly name color is var(--color-hostile)/var(--color-friendly) (already tokens), the boss skull glyph + the HP precision + the no-target sentinel (-999) are named constants, never bare literals.

  Sub-task 3 - Wire the instance into hud.update() and delete the inline block.
  - Replace the inline target-frame block (hud.ts:3672-3749) with the target unit_frame instance's paint call plus the consumed cast/auras paints. Construct the instance once (Hud ctor / one-time init); do not re-query the DOM per frame. Preserve the no-target hide + sentinel reset.

A11y (decision 10, the WINDOW/CONTROL row): the target frame gets role + an accessible name via a t() key (never concat or a ?? fallback): e.g. a group/region naming "Target" with the target name in a live status. If a single polite live region announcing the new target name lands cleanly inside this slice, implement it; otherwise DEFER the live region to P15a (the consolidated Accessibility phase) and state that deferral explicitly in the final response. The target frame is a click target (it selects on click in some flows): if it is interactive it must be keyboard-reachable and meet target-size (SC 2.5.8 >=24px, >=40x40 on mobile); if it is purely informational, state that. visible :focus-visible (if interactive) is never animated/blurred away. A forced-colors snapshot keeps the elite/boss/hostile cues distinguishable without relying on color alone (the elite class + the name color must not be the ONLY signal). The 3D world/canvas stays OUT of a11y scope (state the boundary). Any new aria key goes in src/ui/i18n.catalog/hud_chrome.ts (English-only); reuse existing keys.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only. Consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, headless. If the slice finds it needs to, STOP and surface it (scope change). Extending the unit_frame family's own instance descriptor is in scope; extending IWorld is not.
- Component contract (decision 9): the target frame is an INSTANCE of the ONE unit_frame family core+painter, instance-parameterized (no hardcoded element ids, no single-instance assumption), NOT a bespoke target_frame_view module. Reuse the family, do not fork it.
- Per-frame write-elision (decisions 3, 5, 5a): every imperative DOM write goes through the host's elided writers (setText/setDisplay/setTransform/setWidth + the P10a-added setStyleProp/toggleClass reading hotWriteCache); the cache keys on the EXACT string/value, so a non-byte-identical key or a raw el.style/classList/textContent/setAttribute silently collapses the skip-rate. The elite class -> toggleClass; the combo-pip 'on' -> toggleClass; the target-name color -> setStyleProp. No raw writes.
- The absorb node is CACHED per instance (no '#tf-absorb' selector, no per-call document query).
- No magic values in painters (decision 12): painter color/size/threshold values are CSS custom properties or named constants (the boss skull glyph, the HP precision, the no-target sentinel -999), never a bare literal in TS.
- Determinism for cores: the unit_frame family core and absorbBarView stay DOM/Three-free with no Math.random/Date.now/performance.now. Same input gives same output.
- ClientWorld-vs-Sim parity (decision 15): the target cast remaining and the combo pips are Sim-vs-ClientWorld sensitive (the online mirror's targetId/comboTargetId/comboPoints/castRemaining cadence may differ from the offline Sim). The unit_frame family core test for the target instance (and any combo/cast helper) feeds BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub so an offline-only shape cannot ship broken online.
- Accessibility (decision 10): the target frame is labelled with a t() key; if interactive it is keyboard-reachable + target-size; the canvas stays out of a11y scope.
- i18n: any new player-visible label is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. Reuse the elite/boss/dead keys.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The cast_bar core/painter itself (P11a, done; you CONSUME the target cast instance).
- The party frames (P11c).
- The auras pool rewrite (P12; you CONSUME the existing renderAuras('debuffs') paint for target debuffs).
- Action bar, minimap markers (P12), FCT (P13).
- xp bar, swing timer, player frame, the unit_frame family itself (P10, done; you instantiate it).
- The consolidated cross-window a11y audit + skip links + global focus management (P15); only the per-frame labelling/focus/target-size for THIS frame lands here.
- Any IWorld extension, sim/server/net edit, or new graphics-governor wiring.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows (state.md):
- Baseline: npx tsc --noEmit.
- biome check on the new/changed .ts (src/ui/unit_frame*.ts if the descriptor changed, src/ui/hud.ts, any new test): the V16 ratchet; no new lint debt.
- Pure core changed (only if the family descriptor is extended): npx vitest run the unit_frame family core test (the target instance fields) + npx vitest run tests/architecture.test.ts (the UI-purity guard; the family stays in UI_PURE_CORES and the guard FAILS on an injected REAL DOM-import line in the core, not a // comment) + a same-input-same-output assertion + the ClientWorld-vs-Sim parity assertion (decision 15: drive the core with BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub; assert the target cast remaining + combo pips match).
- PER-FRAME perf gate: run the perf_tour harness (scripts/perf_tour.mjs) desktop + mobile and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline (target-frame writes are now counted/elided, so skip-rate should hold or improve). Plus a unit test that the target painter routes ALL writes through the host's elided writers (incl toggleClass for elite + combo 'on', setStyleProp for the name color), NO raw style/classList/textContent/setAttribute (decision 5a). Plus the phase-specific bounded assertions: the portrait redraws ONLY on a target-id change (not per frame) and the combo pips are built once then updated (no per-frame rebuild); the absorb node is resolved once (no per-call query).
- WINDOW/CONTROL a11y row (for the target frame): automated axe-core (or equivalent) over the built frame clean; the frame is labelled (t() key); if interactive it is keyboard-reachable + target-size >=24px (>=40x40 on mobile); visible :focus-visible never animated away; a forced-colors: active snapshot keeps the elite/boss/hostile cues distinguishable. Plus the no-magic-values painter guard (the painter references tokens/var(--color-*), not a literal hex/px).
Review dispatch (spawn ONLY matching rows): qa-checklist only. This diff is presentation-only and does not touch server/, src/admin/, src/net/, src/world_api.ts, src/sim/, or migrations, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire (the ClientWorld-vs-Sim parity obligation is covered by the per-core parity test, not by spawning cross-platform-sync). Prompt the reviewer for COVERAGE, not filtering; resume a truncated reviewer per the state.md script; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths. Suggested:
- feat(ui): render the target frame as a unit_frame instance (src/ui/unit_frame*.ts, src/ui/hud.ts)
- feat(ui): preserve portrait change-gate + lazy combo pips + cache the target absorb node (src/ui/hud.ts, src/ui/unit_frame_painter.ts)
- feat(ui): route the elite class + target-name color through the P10a elided writers (src/ui/hud.ts, src/ui/unit_frame_painter.ts)
- feat(ui): a11y label + forced-colors cues on the target frame (src/ui/unit_frame_painter.ts, src/ui/i18n.catalog/hud_chrome.ts)
- test(ui): target-instance portrait-gate + combo lazy-build + routing + ClientWorld-vs-Sim parity (tests/unit_frame*.test.ts)
- docs(frontend): update progress.md + state.md ledger for P11b (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes; biome check is clean on every new/changed .ts.
- [ ] The target frame is an INSTANCE of the P10b unit_frame family (no bespoke target_frame_view core was added; the family is reused, extended only at its instance descriptor if needed); the inline block at hud.ts:3672-3749 is replaced by the instance paint plus the consumed cast/auras paints.
- [ ] The lastPortraitTarget portrait change-gate is preserved (portrait redraws ONLY on a target-id change; reset on hide); a test proves no per-frame portrait redraw.
- [ ] The combo pips use the lazy-build (built once, then updated, never rebuilt per frame); a test proves it.
- [ ] The target absorb node is CACHED per instance (the '#tf-absorb' hardcoded selector + per-call document query are gone); absorbBarView drives it through the elided writers.
- [ ] The elite/boss tag, target debuffs (via the existing auras paint), and the target cast bar (via P11a's cast_bar target instance) render correctly without rebuilding the auras pool or the cast bar.
- [ ] Every write routes through the elided writers (setText/setDisplay/setTransform/setWidth + the P10a toggleClass for elite + combo 'on' + setStyleProp for the name color); a routing test asserts no raw style/classList/textContent/setAttribute.
- [ ] No magic values in the painter: the boss skull glyph, HP precision, no-target sentinel (-999), and colors are CSS custom properties / named constants; the no-magic-values guard passes.
- [ ] A11y: the target frame is labelled with a t() key (no concat / ?? fallback); axe-core over the built frame is clean; if interactive it is keyboard-reachable + meets target-size; a forced-colors snapshot keeps the elite/boss/hostile cues distinguishable; the target-change live region is either implemented OR explicitly deferred to P15a.
- [ ] ClientWorld-vs-Sim parity: the core/helper test drives BOTH a Sim-shaped and a ClientWorld-mirror-shaped stub and the target cast remaining + combo pips match.
- [ ] The unit_frame family core stays registered in UI_PURE_CORES; tests/architecture.test.ts passes and FAILS on an injected real DOM-import line; no Math.random/Date.now/performance.now in any core.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND hudHotDomSkipRate >= P0 baseline; the new skip-rate is recorded.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; any new label is a single English-only hud_chrome.ts key.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P11b row: the target-as-unit_frame-instance decision, the cached absorb node, the recorded hudHotDomSkipRate, whether the live region landed or deferred to P15a).
- Update state.md ledger (mark P11b; any unit_frame instance descriptor additions + the new tests; the target unit_frame instance; the consumed P11a cast instance + the existing auras paint; perf-gate result vs baseline; the a11y additions).
- Record surprising rules in memory: the target instance descriptor shape vs the player, the per-instance absorb-node cache replacing '#tf-absorb', the portrait change-gate + combo lazy-build preservation, any skip-rate movement, the worktree-isolation integration order, and the live-region land-or-defer outcome.

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, the unit_frame family core test incl the parity assertion, architecture guard, perf_tour frameP95 + skip-rate vs baseline, the a11y/axe result), reviewer verdict, and deferrals (incl whether the target-change live region landed or moved to P15a). End with exactly:
Next: phase-11c-perframe-party-pool.md

STOPPING RULES:
- STOP if the target frame cannot be expressed as a unit_frame INSTANCE without forking the family into a bespoke core; surface it as a component-contract (decision 9) gap rather than adding a parallel module.
- STOP if the portrait change-gate or the combo-pip lazy-build cannot be preserved (a per-frame portrait redraw or pip rebuild); diagnose rather than ship a per-frame redraw.
- STOP if the per-frame extraction regresses perf_tour frameP95 above the P0 baseline OR drops hudHotDomSkipRate below the P0 baseline; do not commit a perf regression, diagnose the raw-write or cache-key cause first.
- STOP if the elite class, the combo 'on' toggle, or the target-name color cannot be routed through the elided writers without a raw write (the P10a toggleClass/setStyleProp should cover them; if not, that is a 5a writer-coverage gap, surface it).
- STOP and surface (scope change) if the slice finds it needs to extend IWorld or touch sim/server/net.
- STOP if the working set approaches the ~40% context ceiling; this slice is already a single split, so escalate to the user rather than degrade.
```

## Notes for the planner

This is the second of three P11 sub-phases. It is the proof of the decision-9 family contract: the target is
the FIRST richer instance (the player instance was the simple one), so if the P10b descriptor was validated
against the full target field set as decision 9 requires, this slice instantiates it with NO core change and
forks nothing. The deep-review correction that lands here is the absorb node: the live code at hud.ts:3684
calls this.updateAbsorb('#tf-absorb', target) with a HARDCODED selector and a per-call document query, which
violates both decision 9 (hardcoded element id) and per-frame discipline (a query per frame), so the slice
caches the node per instance. The two raw writes the four original writers cannot express, the
classList.toggle('elite') at 3676 and the this.targetNameEl.style.color assignment at 3689-3691, are exactly
why P10a's toggleClass/setStyleProp extension is a hard dependency (risk 1: a raw write silently collapses the
skip-rate). The portrait change-gate (3692-3708) and the combo-pip lazy-build (3731-3742) are the risk-3
hazards: redrawing the portrait or rebuilding the pips every frame would pass tsc and tests but tank the
skip-rate, so the explicit "redraw only on target-id change" and "pips built once then updated" tests are
non-optional. The target cast bar already moved to P11a's cast_bar target instance, so this slice CONSUMES
it rather than re-inlining 3712-3727. Decision 15 matters specifically because the target cast remaining and
the combo pips (comboTargetId/comboPoints) are the field shapes most likely to diverge between the offline
Sim and the online ClientWorld mirror.
