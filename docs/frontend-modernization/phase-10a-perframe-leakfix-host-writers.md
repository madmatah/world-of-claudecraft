# Phase P10a: Per-frame: xp + swing leak-fix + the PainterHost elided-writer extension

Stand up the first per-frame extractions on the safest surface (xp bar, swing timer) AND land the
load-bearing infrastructure every later per-frame phase depends on: EXTEND the PainterHost
write-elision facet with elided `setStyleProp` + `toggleClass` writers (decision 5a), then route the
xp and swing hot paths through the full writer set, fixing the two real write-elision leaks (xp's raw
`--xp-fill` / `.rested` writes and swing's per-frame `querySelector` + raw style writes) as a
measurable skip-rate WIN. This is the first per-frame phase and the first perf gate.

## Starter Prompt

```
This is Phase P10a of the Frontend Modernization v0.16.0 packet: Per-frame: xp + swing leak-fix + the
PainterHost elided-writer extension.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. Two independent hot slices (xp, swing) PLUS a shared infrastructure extension (the
PainterHost elided-writer facet) that both slices and every later per-frame phase consume; fan out the
two slices with adversarial verify after the writer extension lands, and gate on the perf harness.

Goal: Land the write-elision writer EXTENSION (decision 5a) and use it to extract the two lowest-risk
per-frame hot elements (xp bar, swing timer) onto the Humble-Object pattern: a pure, allocation-light
core reading IWorld plus a thin painter that writes DOM ONLY through the host's elided writers. The
EXTENSION is the headline novelty: the four existing writers (setText / setDisplay / setTransform /
setWidth, hud.ts:1322-1372) cache ONE string per element and cannot express the writes these slices
actually need: setProperty('--xp-fill', v) x2, the .rested left/width, classList.toggle x3 on #xpbar,
and the swing block's display / .fill width / .ready toggle / .label text. So the "all writes elided"
rule and the "no raw style/textContent on the hot path" routing test are mutually unsatisfiable UNTIL
the facet is extended. THIS phase OWNS that extension. While here, FIX two real leaks: (1) xp writes
--xp-fill and the .rested overlay with RAW style.setProperty / style.left / style.width every frame,
uncounted and unelided (hud.ts:3933-3952); (2) the swing-timer block re-queries #swingbar via $() and
.querySelector('.fill'|'.label') every frame and writes raw style (hud.ts:3800-3827). Caching the
refs once and routing through the (now extended) helpers should IMPROVE hudHotDomSkipRate, which is
the whole reason this is the first per-frame phase.

STEP 0 - PRE-FLIGHT:
- Run git status; it MUST be clean. This is a shared checkout (concurrent sessions). If it is not
  clean, STOP and ask the user before touching anything.
- Confirm you are in the /Users/fernando/Documents/wocc-v0.16.0 worktree on branch
  feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the frontend ledger entries. The directly relevant prior-art is FB
  Phase 7 HUD window extraction (the pure-core + painter + PainterHost seam template and the
  purity-guard perturbation gotcha: inject a REAL code line, a // comment is stripped by stripComments),
  FB Phase 8 graphics-tier effects (write-elision + live computed-style proof discipline), and the
  phased-packet QA cadence note (every phase is followed by its own QA pass; never skip).
- This phase depends on P0 (gates + perf baseline recorded) and P6 (PainterHost seam present, the four
  existing writers exposed as the write-elision facet). Confirm both landed: tests/css_corpus.test.ts +
  the UI-purity allowlist exist, scripts/perf_tour.mjs has a recorded baseline, and src/ui/painter_host.ts
  exists with the write-elision facet binding the four existing writers as closures. If P0's perf
  baseline is not recorded, STOP: you cannot run the perf gate. If P6's write-elision facet is not
  present, STOP: this phase EXTENDS it and cannot start without it.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a tight summary (not raw dumps) the
orchestrator keeps:
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 6, 9, 10, 12, 15; the non-negotiable
  constraints; the canonical workflow; the validation matrix incl the PER-FRAME row AND the WINDOW/
  CONTROL a11y row AND the no-magic-values painter guard AND the ClientWorld-vs-Sim parity assertion;
  the Review Dispatch Matrix). Do not re-derive these; cite state.md. Decision 5a is the SPINE of this
  phase: read it verbatim.
- This phase file.
- The '### P10' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the
  "Load-bearing structural findings" and "Top risks" sections (especially risk 1: write-elision
  regression). (Reference recon sections by NAME; its line numbers shifted after the AMENDED note block
  was inserted near the top.)
- The SPECIFIC V16 source ranges this phase touches, by exact line number:
  - Write-elision helpers + hotWriteCache: hud.ts:1322-1372 (the four writers setText/setDisplay/
    setTransform/setWidth, each keyed differently: setText keys on the raw string, the others on a
    `prefix:value` string), and perfStats() (hotDomWrites / hotDomSkippedWrites / hotDomSkipRate).
  - The P6 write-elision facet in src/ui/painter_host.ts: the four writers bound as closures, no
    visibility change on Hud. This is what you EXTEND.
  - Hud.update() frame entry + divider: hud.ts:3627 (every-frame + fastHud >=100ms + mediumHud
    >=250ms + slowHud >=500ms; called from main.ts:2079 offline / 2171 online).
  - Swing timer block: hud.ts:3800-3827. CONFIRM the live shape: `const sw = $('#swingbar')` every
    frame; sw.style.display; (sw.querySelector('.fill')).style.width; sw.classList.toggle('ready', ...);
    (sw.querySelector('.label')).textContent. swingPeriod / lastSwingTimer are Hud edge-tracking state
    recovered across frames.
  - Xp bar block: hud.ts:3933-3952. CONFIRM the live shape: consumes xpBarView; setWidth(this.xpFillEl);
    then RAW $('#xpbar').style.setProperty('--xp-fill', ...) AND $('#player-frame').style.setProperty(
    '--xp-fill', ...) (two elements); restedEl.style.left / .width; setText(this.xpLabelEl, bar.label);
    $('#xpbar').classList.toggle('overflow'|'rested'). Note the xpFillEl / xpLabelEl refs already exist
    (hud.ts:787-788); the #xpbar / .rested / #player-frame refs are re-queried per frame (the leak).
  - The existing reused core: xpBarView (src/ui/xp_bar.ts) and how hud.ts imports it today
    (hud.ts:302 `import { formatXp, xpBarView } from './xp_bar'`). DO NOT re-derive it.
  - tests/architecture.test.ts UI_PURE_CORES allowlist + forbiddenUiCoreImport (where to register the
    new swing_timer core).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode + a Workflow. The writer EXTENSION is the prerequisite and lands FIRST (serialized); then two
independent slices (xp, swing) fan out, then integrate into Hud.update() sequentially (they share the
single hud.ts monolith, so integration is serialized to avoid clobbering edits; use isolation:
"worktree" for the parallel slice work if agents touch overlapping hud.ts regions, then the
orchestrator merges).

  - Slice 0 (THE WRITER EXTENSION, decision 5a; do this FIRST, it unblocks the others):
      - In Hud (hud.ts, next to the four existing private writers at 1322-1372), add TWO new private
        elided writers, each cached in hotWriteCache and counting hotDomWrites / hotDomSkippedWrites
        exactly like the existing four:
          - setStyleProp(el, prop, val): keys on `prop:val` (so two different custom properties on the
            SAME element do not collide; the existing writers key one slot per element, which is fine
            because each writes a different DOM facet, but a single element can hold MANY custom props,
            so the key MUST include prop). Writes el.style.setProperty(prop, val) only on change. This
            is the only writer that may hold MORE than one cache slot per element, so it CANNOT share
            the single-slot Map shape the four existing writers use: add a SECOND cache (e.g.
            hotStylePropCache: Map<HTMLElement, Map<string, string>>) keyed by (element, prop), or a
            composite string key; document the choice. Do NOT collapse it into the single-slot cache or
            the four existing writers' elision silently breaks.
          - toggleClass(el, cls, on): keys on `class:${cls}` -> 'on'|'off'; writes el.classList.toggle(
            cls, on) only on change. Same multi-slot consideration: an element can carry many toggled
            classes, so key by (element, cls), same second-cache decision as above.
      - In src/ui/painter_host.ts, bind these two new writers into the write-elision facet exactly as
        P6 bound the four existing ones (as closures over the Hud instance; no Hud visibility change).
        The facet now exposes SIX writers: setText, setDisplay, setTransform, setWidth, setStyleProp,
        toggleClass.
      - A focused unit test against a fake cache proves: setStyleProp writes on first call, skips on a
        repeat with the same (el, prop, val), writes again on a changed val, and does NOT skip when a
        DIFFERENT prop is written to the same element (the multi-slot key); toggleClass writes/skips
        symmetrically and tracks on AND off transitions. This is the regression guard for the cache-key
        bug that Top risk 1 warns about.
  - Slice A (xp bar): build src/ui/xp_bar_painter.ts consuming the EXISTING xpBarView core (do NOT
    re-derive the core). The painter is constructed against the xp element set and CACHES the element
    refs ONCE in its constructor: #xpbar, the #xpbar .fill (reuse the existing xpFillEl), #xpbar .rested,
    #xpbar .label (reuse xpLabelEl), and #player-frame (the second --xp-fill target). Replace the inline
    hud.ts:3933-3952 block with a painter.paint(bar) call that routes EVERY write through the host's
    elided writers: setWidth for the fill; setStyleProp('--xp-fill', ...) on BOTH #xpbar and
    #player-frame; setStyleProp for the .rested left and width (custom-prop or the existing left/width
    facet via setStyleProp); setText for the label; toggleClass for 'overflow' and 'rested'. NO raw
    style / setProperty / classList on the hot path after this. The xp label stays a t() key (it comes
    from xpBarView's bar.label, already localized upstream; do not re-localize). showOverflow is read
    from optionsHooks as today and passed into xpBarView; that read stays at the call site (it is a
    settings read, not a paint write).
  - Slice B (swing timer): add src/ui/swing_timer.ts pure core (IWorld-shaped input -> swing state:
    { visible, frac, ready, labelKind }). The core takes the player auto-attack state + target state
    + the swingPeriod / lastSwingTimer edge-tracking values and returns the computed frac, the ready
    boolean, and a DISCRIMINATOR for the label (ready vs seconds) plus the seconds VALUE; it does NOT
    call t() (i18n-free core, like cast_bar): the painter resolves t('hudChrome.swing.ready') vs
    t('hudChrome.swing.seconds', { seconds: formatNumber(...) }) from the discriminator + value. The
    swingPeriod / lastSwingTimer edge recovery is part of the core's RETURNED next-state (the core is
    pure: it takes prevPeriod/prevTimer and returns the new ones; Hud holds the two scalars and feeds
    them back next frame, so the core stays allocation-light and Date.now-free). Build
    src/ui/swing_timer_painter.ts. FIX the leak: cache the #swingbar element and its .fill / .label
    children ONCE in the painter constructor (NOT per-frame $()/querySelector), and route every write
    through the elided helpers: setDisplay('block'|'none'); setWidth on .fill; toggleClass('ready', ...);
    setText on .label (with the painter resolving the t() string). Replace hud.ts:3800-3827 with the
    painter call. This is the headline leak-fix; the skip-rate must improve.

Register the NEW swing_timer core in the UI_PURE_CORES allowlist in tests/architecture.test.ts (xp_bar
is already registered from a prior phase; do not double-register). Each painter composes the P6
PainterHost (the source of the now-six elided writers + tooltip/icon helpers); painters never reach
into Hud private state directly beyond the host bag.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only (decision 4). Consume V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim, server, src/net, or headless. If a slice finds it needs a new IWorld member, STOP and
  surface it (scope change). The writer extension is a Hud-private + PainterHost change, NOT an IWorld
  change.
- Per-frame routing (decisions 3, 5, 5a): every imperative DOM write goes through the host's elided
  writers (now six: setText / setDisplay / setTransform / setWidth / setStyleProp / toggleClass, all
  reading hotWriteCache). No raw el.style / textContent / setAttribute / setProperty / classList on the
  hot path. No reactivity, no Shadow DOM, no signals. The routing test asserts only the writers that
  EXIST; after this phase that is all six.
- Pure cores stay DOM/Three-free and allocation-light (no per-frame garbage); no Math.random /
  Date.now / performance.now in swing_timer. Same input gives same output (the edge-tracking is
  parameter-in / next-state-out, not hidden mutable state in the core).
- CLIENTWORLD-vs-SIM PARITY (decision 15): the swing_timer core test feeds BOTH a Sim-shaped and a
  ClientWorld-mirror-shaped IWorld stub (autoAttack / swingTimer / weapon.speed / the target shape).
  Swing depends on weapon.speed + a live target; confirm the online mirror exposes the same fields and
  the core does not assume a Sim-only field.
- ACCESSIBILITY (decision 10, WCAG 2.2 AA chrome). The swing timer and xp bar are non-interactive HUD
  indicators: they convey state by WIDTH + a TEXT label (swing seconds / ready; xp via its label),
  never color alone, so forced-colors and screen-reader users get meaning. They carry no focusable
  control, so target-size and focus-return do not apply here; STATE that boundary honestly in the a11y
  row rather than claiming a control was audited. A forced-colors: active snapshot must keep the bar
  border/fill meaning visible. The 3D canvas stays out of a11y scope.
- NO MAGIC VALUES IN PAINTERS (decision 12): the painters drive CSS custom properties / tokens, never
  a literal hex / px / color in TS. The percent formatting (the .toFixed(1) width strings, the .toFixed(4)
  --xp-fill) is a VALUE not a style literal and stays, but any cadence / threshold is a named constant.
  The no-magic-values guard must pass on the new painters.
- i18n: the swing label is the ONLY player-visible string here and it stays a t() key resolved in the
  PAINTER from the core's discriminator (hudChrome.swing.ready / hudChrome.swing.seconds already exist;
  do not add new keys). Do not concat, do not add a ?? 'English' fallback. The xp label is already
  localized by xpBarView.
- No em dashes, en dashes, or emojis anywhere (note the existing swing comment uses an em dash at
  hud.ts:3800; when you relocate or rewrite that comment, normalize it to a comma or colon).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The unit_frame FAMILY / player frame extraction (P10b) -> it consumes the SIX-writer facet you land
  here; do not build it now.
- Target frame, party frames, cast bars (P11); action bar, auras, minimap (P12); FCT (P13); per-element
  tiering / nameplate (P14); the consolidated cross-window a11y audit (P15).
- Any new IWorld member, sim/server/net change, or CSS rule move. Do NOT add a third or fourth elided
  writer beyond setStyleProp + toggleClass unless a slice provably cannot route a write through the six;
  if so, surface it rather than inventing writers.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (per-frame + pure-core added + a non-interactive chrome
surface + a new .ts module):
- Baseline: npx tsc --noEmit.
- biome check on the new/changed .ts (src/ui/xp_bar_painter.ts, src/ui/swing_timer.ts,
  src/ui/swing_timer_painter.ts, src/ui/painter_host.ts, src/ui/hud.ts).
- Pure core: npx vitest run the swing_timer core test, plus npx vitest run tests/architecture.test.ts
  (the UI-purity guard), plus a same-input-same-output assertion for swing_timer. Verify the purity
  guard FAILS when you inject a REAL DOM-import line into swing_timer (perturbation must be a real code
  line, not a // comment which stripComments removes).
- CLIENTWORLD-vs-SIM PARITY (decision 15): the swing_timer core test drives the core with BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped IWorld stub and asserts identical output; document the
  field set both stubs supply.
- WRITER-EXTENSION UNIT TEST: against a fake cache, setStyleProp writes-then-skips per (el, prop, val)
  and does NOT collapse two different props on one element; toggleClass writes-then-skips on both the
  on and off transitions. This is the cache-key regression guard.
- PAINTER ROUTING TEST: a unit test asserting each painter (xp, swing) routes ALL writes through the
  host's six elided writers, with NO raw style / textContent / setAttribute / setProperty / classList
  on the hot path. The routing test asserts only the writers that EXIST (all six after this phase) and
  documents any allowed raw write (there should be none).
- PER-FRAME PERF GATE (mandatory): run scripts/perf_tour.mjs desktop AND mobile and assert frameP95
  <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline. Because the swing writes AND the xp
  --xp-fill / .rested writes are now COUNTED through the helpers (previously raw and uncounted), the
  skip-rate should IMPROVE, not merely hold; record the new number. (More frames now flow through the
  cache, so the skip ratio rises once steady-state is reached.)
- WINDOW/CONTROL A11Y ROW (non-interactive indicators): a forced-colors: active snapshot over the built
  swing bar and xp bar keeps the fill/border meaning visible; axe-core or equivalent reports no new
  violation; STATE the no-focusable-control boundary honestly. Plus the no-magic-values painter guard
  (the new painters reference tokens/vars, percent VALUES excepted; no literal hex/px color in TS).
Review dispatch: qa-checklist only (presentation-only; no server/net/IWorld surface; the writer
extension is Hud-private + PainterHost, which does NOT change IWorld). Do NOT spawn
privacy-security-review, migration-safety, or cross-platform-sync; none of their trigger rows are
touched. Prompt the reviewer for COVERAGE, not filtering; resume a truncated reviewer per the state.md
script. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths. Suggested:
- feat(ui): extend the write-elision facet with elided setStyleProp + toggleClass (paths:
  src/ui/hud.ts, src/ui/painter_host.ts)
- refactor(ui): extract xp bar to painter over xpBarView, cache refs + route --xp-fill/.rested through
  elided writers (paths: src/ui/xp_bar_painter.ts, src/ui/hud.ts)
- fix(ui): cache #swingbar + children and route swing-timer writes through elided helpers (paths:
  src/ui/swing_timer.ts, src/ui/swing_timer_painter.ts, src/ui/hud.ts)
- test(ui): writer-extension cache-key guard + swing core + parity stub + painter no-raw-write guard +
  UI_PURE_CORES allowlist (paths: tests/*, tests/architecture.test.ts)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes; biome check passes on every new/changed .ts.
- [ ] The write-elision facet is EXTENDED (decision 5a): Hud has elided setStyleProp(el, prop, val) +
  toggleClass(el, cls, on), each keyed per (element, prop) / (element, cls) in a multi-slot cache that
  does NOT collide with or weaken the four existing single-slot writers; painter_host.ts binds all SIX
  writers into the write-elision facet. A unit test proves the multi-slot cache writes/skips correctly
  and never collapses two props on one element.
- [ ] xp bar and swing timer are each driven by a pure core (xpBarView / swing_timer) plus a thin
  painter; the inline blocks at hud.ts:3800-3827 and 3933-3952 are replaced by painter calls.
- [ ] Both LEAKS are fixed: xp's #xpbar / .rested / #player-frame refs are cached once (no per-frame
  $()) and its --xp-fill / .rested / class writes route through setStyleProp / toggleClass; #swingbar
  and its .fill / .label children are cached once (no per-frame querySelector) and all swing writes go
  through the elided helpers.
- [ ] swing_timer is registered in UI_PURE_CORES; npx vitest run tests/architecture.test.ts passes, and
  the purity guard provably FAILS on an injected real DOM-import line in swing_timer.
- [ ] swing_timer core test passes with a same-input-same-output assertion AND the ClientWorld-vs-Sim
  parity assertion (both stub shapes give identical output); no Math.random / Date.now / performance.now
  in the core; the edge-tracking is parameter-in / next-state-out, not hidden core state.
- [ ] A painter routing test asserts no raw style / textContent / setAttribute / setProperty / classList
  on the hot path for both painters (routing only through the six writers that exist).
- [ ] A11Y (decision 10): swing bar and xp bar convey state via width + text, not color alone; the
  forced-colors snapshot keeps meaning; the no-focusable-control boundary is stated honestly; the chrome
  a11y checks report no new violation.
- [ ] NO MAGIC VALUES (decision 12): the new painters drive tokens / CSS custom properties, with no
  literal hex / px / color in TS (percent VALUE strings excepted); the no-magic-values painter guard
  passes.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND
  hudHotDomSkipRate >= P0 baseline (skip-rate should IMPROVE now that swing + xp --xp-fill/.rested are
  counted); the new skip-rate is recorded.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; no new i18n keys (the swing label reuses the
  existing hudChrome.swing.* keys).

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (mark P10a status, list the new modules, record the new hudHotDomSkipRate).
- Update state.md: ledger row P10a -> done; add src/ui/{xp_bar_painter,swing_timer,swing_timer_painter}.ts
  to the file map; note the write-elision facet now exposes SIX writers (decision 5a landed) so every
  later per-frame phase routes setProperty / classList writes through setStyleProp / toggleClass; note
  swing_timer registered in the purity allowlist; record the perf-gate delta. TAG the green-perf-gate
  commit so a later cumulative regression bisects to this phase.
- Record any surprising rule in memory (the exact multi-slot cache-key shape for setStyleProp /
  toggleClass, the swing-timer edge-recovery parameter-in/next-state-out shape, and that the skip-rate
  RISES because previously-raw writes are now counted).

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), the validation results (tsc, biome, core tests,
architecture guard, the writer-extension cache-key guard, the parity assertion, the a11y +
no-magic-values guards, the perf_tour frameP95 + skip-rate numbers vs baseline), the qa-checklist
verdict, and any deferrals. End with exactly:
Next: phase-10b-perframe-unit-frame-family.md

STOPPING RULES:
- STOP if P6's write-elision facet is not present: this phase EXTENDS it and cannot start without it.
- STOP if any per-frame extraction regresses frameP95 above the P0 baseline OR drops hudHotDomSkipRate
  below the P0 baseline; do not commit a perf regression, diagnose the raw-write or cache-key cause
  first.
- STOP if the P0 perf baseline is missing (the gate cannot run).
- STOP if setStyleProp / toggleClass are forced into the single-slot cache the four existing writers
  use (it would silently break elision when an element holds more than one prop / toggled class);
  give them a multi-slot (element, key) cache.
- STOP and surface it as a scope change if a slice finds it needs to extend IWorld or touch
  sim/server/net, or needs a SEVENTH writer beyond the six.
- STOP if a write cannot be routed through the elided helpers without changing the rendered string (a
  non-byte-identical cache key silently collapses the skip-rate); resolve the key, do not bypass the
  helper.
```

## Notes for the planner

This is the first half of the original P10 split. It carries the full novelty load: the PainterHost
write-elision writer EXTENSION (decision 5a), which is the load-bearing infrastructure every later
per-frame phase depends on, plus the first perf gate, plus the two real write-elision leaks that make
this the safest place to prove the pattern (a measurable skip-rate WIN, not a risk). The deep review
verified against live source that the four existing writers (setText / setDisplay / setTransform /
setWidth, hud.ts:1322-1372) cannot express the writes the xp and swing slices need: the xp block
(hud.ts:3933-3952) does setProperty('--xp-fill') on TWO elements (#xpbar and #player-frame), raw
.rested left/width, and three classList.toggle calls; the swing block (hud.ts:3800-3827) re-queries
#swingbar and its .fill/.label children every frame and writes raw display / width / class / text. So
the "all writes elided" rule and the "no raw write on the hot path" routing test were mutually
unsatisfiable until the facet grows setStyleProp + toggleClass. The single most important
implementation subtlety, and a STOP rule: setStyleProp and toggleClass need a MULTI-SLOT cache keyed by
(element, prop) / (element, cls), because one element legitimately holds many custom properties and
toggled classes, whereas the four existing writers each own one DOM facet per element and use a
single-slot Map; collapsing the new writers into that single slot silently breaks elision and is
exactly the Top-risk-1 regression. The swing core is shaped i18n-free (a discriminator the painter
resolves through t(), like cast_bar) and edge-tracking is parameter-in / next-state-out so the core
stays pure and allocation-light. P10b (the unit_frame family) consumes the six-writer facet this phase
lands, including for the player frame's resource className swap and the absorb overshield toggle, so
this phase must land cleanly first. The next file is phase-10b-perframe-unit-frame-family.md.
