# Phase P11a: Per-frame: cast bars (player + target)

Unify the player and target cast bars on the existing `castBarState` core (in `src/render/cast_bar.ts`),
extend the core with an i18n-free eat/drink MODE DISCRIMINATOR the painter localizes via `t()`, and build
one instance-parameterized cast_bar painter that drives both bars through the host's elided writers. The
eat/drink overlay is a PLAYER-instance-only concern: the generic-Entity core stays a pure cast/channel
function and the player instance layers eat/drink on top, because the target never enters eat/drink.

## Starter Prompt

```
This is Phase P11a of the Frontend Modernization v0.16.0 packet: Per-frame: cast bars (player + target).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This slice carries two BLOCKING core-design decisions (the eat/drink discriminator in an i18n-free core; eat/drink as a player-only overlay over a generic-Entity core) plus a per-frame perf gate and the P10a write-elision-extension routing rule, so fan out the core change, the painter build, and the two-instance wiring as parallel sub-tasks and adversarially verify against the perf gate and the no-raw-write routing test. It is a per-frame slice, the case state.md names for ultracode + Workflow.

Goal: Move BOTH cast bars (player at src/ui/hud.ts:3752-3798, target at src/ui/hud.ts:3712-3727) out of hud.ts onto the repo's per-frame Humble Object pattern: one pure allocation-light core (the existing castBarState, extended) plus one thin instance-parameterized painter that routes every DOM write through the host's elided writers. Two specifics drive this slice:
1. Extend the EXISTING castBarState core (src/render/cast_bar.ts, NOT src/ui/cast_bar.ts) with an eat/drink MODE DISCRIMINATOR. The core is contractually i18n-free (its file header states it, and the architecture guard enforces it): it must emit a STABLE discriminator the painter localizes via t(), never a t() call in the core. The existing `label` field already works this way (it emits the raw castingAbility id and the painter resolves it); follow that exact precedent for eat/drink.
2. eat/drink is a PLAYER-INSTANCE-ONLY overlay. castBarState takes a generic Entity and the target NEVER enters eat/drink (only players eat/drink). So the eat/drink branch is layered on the PLAYER cast-bar instance, not baked into the shared generic-Entity core path. The core change must not make the target instance render eat/drink.

No behavior change, presentation-only, with a hard perf gate, WCAG 2.2 AA on the cast-bar controls, and token-driven painter values.

STEP 0 - PRE-FLIGHT:
- git status must be clean. This checkout is shared with concurrent sessions; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the relevant entries. Relevant: [[frontend-phase7-hud-window-extraction]] (Humble Object pure-core-plus-painter behind PainterHost; the purity-guard perturbation must inject a REAL code line, not a comment, since stripComments removes comments), [[frontend-phase8-graphics-tier-effects]] (write-elision and applier wiring; live computed-style proofs), [[phased-packet-qa-cadence]] (never skip the QA pass after this phase), [[no-em-dashes-or-emojis]], [[shared-worktree-commit-care]], and this packet's state.md locked decisions (esp. 3 + 5 + 5a write-elision and the writer extension, 9 component contract, 10 accessibility, 12 no-magic-values-in-painters, 15 ClientWorld-vs-Sim parity).
- This phase depends on P6 (the PainterHost two facets), P10a (the write-elision writer EXTENSION setStyleProp/toggleClass and the first perf gate), and the P0 perf baseline. Confirm the PainterHost write-elision facet exposes setText/setDisplay/setTransform/setWidth AND the P10a-added setStyleProp(el, prop, val) + toggleClass(el, cls, on), and that the P0 frameP95 + hudHotDomSkipRate baseline is recorded. The cast_bar core (castBarState in src/render/cast_bar.ts, i18n-free) exists on V16. If the P10a writer extension or the P0 perf baseline is missing, STOP: this slice routes classList toggles through toggleClass and gates against the baseline.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn one Explore agent to read + summarize, returning a compact orchestrator brief (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 6/8 the i18n-free render leaf rule, 9, 10, 12, 15; the non-negotiable constraints incl the cast eat/drink label resolves via t() in the PAINTER and the core emits a discriminator; the per-frame perf-gate row AND the WINDOW/CONTROL a11y row of the validation matrix; the Review Dispatch Matrix; the write-elision file refs at hud.ts:1322-1372 and the P10a extension).
- This phase file.
- The '### P11' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the "Load-bearing structural findings" and "Top risks" sections (risk 1 write-elision cache-key byte-identity is this slice's).
- The cast_bar core EXACTLY as it stands: src/render/cast_bar.ts (the CastBarState interface, the HIDDEN sentinel, the `label` discriminator + `fishing` flag precedent the painter already localizes). Confirm it is i18n-free and takes a generic Entity.
- The P10a write-elision facet shape as P10a landed it (the four existing writers PLUS setStyleProp + toggleClass), so the painter routes classList('channel') + the fill width through them. Do NOT re-derive the facet.
- The SPECIFIC V16 source ranges this phase touches, by exact line number:
  - Hud.update() entry + frame divider: src/ui/hud.ts:3627 (every-frame + fastHud >=100ms + mediumHud >=250ms + slowHud >=500ms tiers).
  - Write-elision helpers + cache: src/ui/hud.ts:1322-1372 (setText/setDisplay/setTransform/setWidth + hotWriteCache) and perfStats() (hotDomWrites/hotDomSkippedWrites/hotDomSkipRate).
  - Player cast bar: src/ui/hud.ts:3752-3798 (the cast branch at 3752-3766, the eat/drink branch at 3767-3791 using CONSUME_DURATION + t('hud.core.eating'|'drinking'|'eatingDrinking'), the hidden branch at 3792-3797).
  - Target cast bar: src/ui/hud.ts:3712-3727 (inside the target-frame block; NO eat/drink branch, the target never eats/drinks).
  - The existing core to REUSE: castBarState in src/render/cast_bar.ts; do NOT re-derive it.
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode + a Workflow. Fan out three parallel sub-tasks, then the orchestrator integrates sequentially (re-running tsc after each merge) since they converge on hud.ts and src/render/cast_bar.ts:

  Sub-task 1 - Extend the castBarState core with the eat/drink mode discriminator (BLOCKING design).
  - In src/render/cast_bar.ts, keep the existing cast/channel/fishing behavior byte-for-byte for the non-eat/drink path. Add eat/drink as a MODE the core can REPORT without any t() call: the core stays i18n-free. Two concrete options, pick the one that keeps the core a pure function of its argument(s):
    (a) Add a discriminated `mode` field to CastBarState (e.g. 'cast' | 'channel' | 'eat' | 'drink' | 'eatdrink') so the painter switches on the mode to pick the t() key, replacing the painter inferring it from `channel`. The existing `label`/`fishing` discriminators stay; the painter localizes eat/drink from `mode`, never from a string the core built.
    (b) Keep CastBarState as the cast/channel result and add a SEPARATE pure helper (still in src/render/cast_bar.ts, still i18n-free) that, given the player's eating/drinking timers + CONSUME_DURATION, returns the eat/drink fill + a mode discriminator, which the painter localizes.
  - Whichever option: the core NEVER calls t(), tEntity, or builds visible text; it emits the STABLE discriminator only (the file header rule + the architecture guard). CONSUME_DURATION is a sim/types constant the core may read; it must not introduce a magic literal.
  - Same input gives same output. No Math.random/Date.now/performance.now. Stays DOM/Three-free.

  Sub-task 2 - Build the cast_bar painter (src/ui/cast_bar_painter.ts), instance-parameterized.
  - ONE painter, TWO instances (decision 9: no hardcoded element ids, no single-instance assumption): a PLAYER instance (bound to castbarEl/castbarFillEl/castbarLabelEl/castbarTimerEl) and a TARGET instance (bound to targetCastbarEl/targetCastbarFillEl/targetCastbarLabelEl/targetCastbarTimerEl). The instance descriptor carries its four element refs plus a flag/closure for whether this instance renders the eat/drink overlay (player: yes; target: no).
  - The painter consumes castBarState's result (the discriminator) and resolves the visible LABEL via t() in the PAINTER: the existing castDisplayName(label)/fishing label for casts, and for the player's eat/drink mode the t('hud.core.eating'|'drinking'|'eatingDrinking') keys (REUSE the existing keys at hud.ts:3780-3783; do not add new keys). The painter localizes; the core never does.
  - Route EVERY write through the host's elided writers: setDisplay for show/hide, setWidth for the fill `${(fill*100).toFixed(1)}%`, setText for the label + the formatNumber timer, and toggleClass(el, 'channel', on) for the channel class (the P10a-added writer; the inline classList.toggle/add/remove at hud.ts:3754/3769/3794 is NOT covered by the four original writers, so it MUST go through toggleClass). No raw el.style / el.classList / el.textContent / el.setAttribute in the painter.
  - Painter values are token-driven (decision 12): the cast-vs-channel-vs-eat/drink fill color comes from CSS custom properties / the existing castbar CSS classes (`.channel`), never a literal hex in TS; the toFixed precision (1) and the percent are named constants, CONSUME_DURATION comes from sim/types.

  Sub-task 3 - Wire both instances into hud.update() and delete the inline blocks.
  - Replace the inline player cast-bar block (hud.ts:3752-3798, including the eat/drink branch) with the player painter instance's paint call.
  - Replace the inline target cast-bar block (hud.ts:3712-3727) with the target painter instance's paint call (NO eat/drink; the target instance descriptor has it off).
  - The painter instances are constructed once (in the Hud ctor / a one-time init), reusing the existing element refs and the PainterHost write-elision facet; do NOT re-query the DOM per frame.

A11y (decision 10, the WINDOW/CONTROL row): the cast bars are progress indicators. Give each bar role="progressbar" (or an equivalent live status) with aria-valuemin/valuemax/valuenow reflecting the fill, an accessible name via a t() key (never concat or a ?? fallback), and aria-hidden NOT set when visible. The fill text + timer must be announced or available; visible :focus-visible is not relevant to a non-interactive bar, but a forced-colors snapshot must keep the bar border/fill distinguishable (the fill cannot rely on a background color alone). The 3D world/canvas stays OUT of a11y scope (state the boundary). Any new aria-name key goes in src/ui/i18n.catalog/hud_chrome.ts (English-only); reuse the eat/drink label keys.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only. Consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, headless. If the slice finds it needs to, STOP and surface it (scope change). Extending the castBarState core's own return shape (the mode discriminator) is in scope; extending IWorld is not.
- i18n-free CORE (decisions 6/8 render-leaf rule + the file header): src/render/cast_bar.ts NEVER calls t()/tEntity or builds visible text. The eat/drink label is resolved by the PAINTER via t(); the core emits a stable discriminator only. (This is BLOCKING design decision 1.)
- eat/drink is PLAYER-only (BLOCKING design decision 2): the generic-Entity core path stays cast/channel; the eat/drink overlay lives on the player instance; the target instance never renders eat/drink.
- Component contract (decision 9): ONE painter, instance-parameterized (player + target), no hardcoded element ids, no single-instance assumption.
- Per-frame write-elision (decisions 3, 5, 5a): every imperative DOM write goes through the host's elided writers (setText/setDisplay/setTransform/setWidth + the P10a-added setStyleProp/toggleClass reading hotWriteCache); the cache keys on the EXACT string/value, so producing a non-byte-identical key or writing el.style/classList/textContent/setAttribute directly silently collapses the skip-rate. No raw writes in the painter; the channel class goes through toggleClass.
- No magic values in painters (decision 12): painter color/size/threshold values are CSS custom properties or named constants, never a literal hex/px/color in TS.
- Determinism for cores: castBarState stays DOM/Three-free with no Math.random/Date.now/performance.now. Same input gives same output.
- ClientWorld-vs-Sim parity (decision 15): the cast bar reads castingAbility/castRemaining/castTotal/channeling and the player eating/drinking timers, all of which the online ClientWorld mirror must satisfy. The core test feeds BOTH a Sim-shaped and a ClientWorld-mirror-shaped Entity/player stub so an offline-only field shape cannot ship broken online.
- Accessibility (decision 10): the bars are labelled with t() keys and survive forced-colors; the canvas stays out of a11y scope.
- i18n: any new player-visible label (a bar aria-name) is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. Reuse the existing eat/drink and cast-name keys.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The target FRAME (elite/boss tag, portrait change-gate, combo pips, target debuffs, target absorb): that is P11b. You only move the target CAST BAR sub-block (hud.ts:3712-3727) here, as the cast_bar painter's target instance. The rest of the target-frame block stays inline until P11b consumes your target cast instance.
- The party frames (P11c), action bar / auras / minimap (P12), FCT (P13).
- xp bar, swing timer, player frame, the unit_frame family (P10, done).
- Any IWorld extension, sim/server/net edit, or new graphics-governor wiring.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows (state.md):
- Baseline: npx tsc --noEmit.
- biome check on the new/changed .ts (src/render/cast_bar.ts, src/ui/cast_bar_painter.ts, src/ui/hud.ts): the V16 ratchet; no new lint debt.
- Pure core changed: npx vitest run tests/cast_bar.test.ts (extend it for the new eat/drink discriminator branch on top of the existing cast/channel/fishing coverage; same-input-same-output) + npx vitest run tests/architecture.test.ts (the UI-purity + i18n-free guard; the core stays registered and the guard FAILS on an injected REAL DOM-import OR a t() call in the core, not a // comment) + the ClientWorld-vs-Sim parity assertion (decision 15: drive the core with BOTH a Sim-shaped and a ClientWorld-mirror-shaped Entity/player stub, asserting the eat/drink mode + fill match).
- PER-FRAME perf gate: run the perf_tour harness (scripts/perf_tour.mjs) desktop + mobile and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline (both cast bars' writes are now counted/elided, so the skip-rate should hold or improve). Plus a unit test that the cast_bar painter routes ALL writes through the host's elided writers (setText/setDisplay/setWidth/toggleClass) with NO raw style/classList/textContent/setAttribute (decision 5a; document any allowed raw write, there should be none).
- WINDOW/CONTROL a11y row (for both cast bars): automated axe-core (or equivalent) over the built bars clean; the bars carry role=progressbar + aria-value* + a t() accessible name; a forced-colors: active snapshot keeps the fill/border distinguishable (fill not by background alone); target-size is N/A for a non-interactive bar (state it). Plus the no-magic-values painter guard (the painter references tokens/the .channel class, not a literal hex/px).
Review dispatch (spawn ONLY matching rows): qa-checklist only. This diff is presentation-only and does not touch server/, src/admin/, src/net/, src/world_api.ts, src/sim/, or migrations, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire (the ClientWorld-vs-Sim parity obligation is covered by the per-core parity test, not by spawning cross-platform-sync). Prompt the reviewer for COVERAGE, not filtering; resume a truncated reviewer per the state.md script; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths. Suggested:
- feat(render): add an i18n-free eat/drink mode discriminator to castBarState (src/render/cast_bar.ts, tests/cast_bar.test.ts)
- feat(ui): cast_bar painter driving player + target bars via instances through the elided writers (src/ui/cast_bar_painter.ts, src/ui/hud.ts)
- feat(ui): progressbar a11y + aria name on the cast bars (src/ui/cast_bar_painter.ts, src/ui/i18n.catalog/hud_chrome.ts)
- test(ui): cast_bar painter routing + ClientWorld-vs-Sim parity + axe row (tests/cast_bar.test.ts, tests/cast_bar_painter.test.ts)
- docs(frontend): update progress.md + state.md ledger for P11a (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes; biome check is clean on every new/changed .ts.
- [ ] Both cast bars are driven by ONE cast_bar painter over the castBarState core, instance-parameterized (player + target instances, no hardcoded element ids); the inline blocks at hud.ts:3752-3798 (player) and 3712-3727 (target) are replaced by painter calls.
- [ ] The eat/drink mode is a STABLE discriminator emitted by the i18n-free core (src/render/cast_bar.ts); the core calls NO t()/tEntity and builds NO visible text; the PAINTER resolves the eat/drink label via the existing t('hud.core.eating'|'drinking'|'eatingDrinking') keys. (BLOCKING design 1.)
- [ ] eat/drink is rendered ONLY by the player instance; the target instance never renders eat/drink (the generic-Entity core path stays cast/channel). (BLOCKING design 2.)
- [ ] The painter routes ALL writes through the host's elided writers (setText/setDisplay/setWidth + the P10a toggleClass for the .channel class); a routing test asserts no raw style/classList/textContent/setAttribute.
- [ ] No magic values in the painter: color/precision/percent/CONSUME_DURATION values are CSS custom properties or named constants; the no-magic-values guard passes.
- [ ] A11y: each cast bar carries role=progressbar + aria-value* + a t()-keyed accessible name (no concat / ?? fallback); axe-core over the built bars is clean; a forced-colors snapshot keeps the fill/border distinguishable.
- [ ] castBarState stays registered in the pure-core set; tests/architecture.test.ts passes and FAILS on an injected real DOM-import OR a t() call in the core; no Math.random/Date.now/performance.now.
- [ ] ClientWorld-vs-Sim parity: tests/cast_bar.test.ts drives the core with BOTH a Sim-shaped and a ClientWorld-mirror-shaped stub and the eat/drink mode + fill match.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND hudHotDomSkipRate >= P0 baseline; the new skip-rate is recorded.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; any new label is a single English-only hud_chrome.ts key.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P11a row: the eat/drink discriminator added to castBarState, the cast_bar_painter two-instance shape, the recorded hudHotDomSkipRate, the a11y additions).
- Update state.md ledger (mark P11a; new files: src/ui/cast_bar_painter.ts + tests/cast_bar_painter.test.ts; the eat/drink discriminator addition to src/render/cast_bar.ts; perf-gate result vs baseline; the progressbar a11y addition).
- Record surprising rules in memory: the eat/drink-as-discriminator-not-t()-in-core pattern, the eat/drink-as-player-only-overlay decision, any cast-bar edge case, the toggleClass-for-.channel routing, and any skip-rate movement.

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, the cast_bar core test incl the parity assertion, architecture guard, perf_tour frameP95 + skip-rate vs baseline, the a11y/axe result), reviewer verdict, and deferrals. End with exactly:
Next: phase-11b-perframe-target-frame.md

STOPPING RULES:
- STOP if the eat/drink branch cannot be expressed as an i18n-free core discriminator the painter localizes (e.g. it would require a t() call in src/render/cast_bar.ts); surface it as a decision-6/8 (i18n-free render leaf) conflict rather than calling t() in the core.
- STOP if the per-frame extraction regresses perf_tour frameP95 above the P0 baseline OR drops hudHotDomSkipRate below the P0 baseline; do not commit a perf regression, diagnose the raw-write or cache-key cause first.
- STOP if the .channel class toggle or the fill cannot be routed through the elided writers without a raw write (the P10a toggleClass should cover it; if it does not, that is a 5a writer-coverage gap, surface it).
- STOP and surface (scope change) if the slice finds it needs to extend IWorld or touch sim/server/net.
- STOP if the working set approaches the ~40% context ceiling; this slice is already a single split, so escalate to the user rather than degrade.
```

## Notes for the planner

This is the first of three P11 sub-phases (the old P11 split into 11a/11b/11c because the two BLOCKING
core-design decisions serialize the slices and the party pool is a high-churn rewrite). It is the smallest
of the three but carries the two design landmines the deep review surfaced: the castBarState core is
contractually i18n-free (file header plus the architecture guard), so eat/drink must ride as a stable mode
discriminator the painter localizes, exactly like the existing `label` (raw ability id) and `fishing`
discriminators already do; and eat/drink is player-only over a generic-Entity core, so it is a player-instance
overlay rather than a core-path branch the target would inherit. Both the player block (hud.ts:3752-3798,
which already calls t('hud.core.eating'|'drinking'|'eatingDrinking') inline) and the target cast sub-block
(hud.ts:3712-3727, no eat/drink) collapse onto one instance-parameterized painter. The target instance built
here is then CONSUMED by P11b's target frame (P11b does not rebuild the cast bar). The .channel classList
toggle and the player block's classList.add/remove are why P10a's toggleClass extension is a hard dependency:
the four original writers cannot express it, and a raw classList write would silently collapse the skip-rate
(risk 1). The decision-15 parity test matters because castRemaining/castTotal cadence and the eat/drink timers
are exactly the kind of field shape that an offline Sim and the online ClientWorld mirror can diverge on.
