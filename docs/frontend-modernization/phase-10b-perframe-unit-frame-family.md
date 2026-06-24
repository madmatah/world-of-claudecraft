# Phase P10b: Per-frame: the unit_frame FAMILY (player as first instance)

Introduce the parameterized unit_frame FAMILY (decision 9): one pure core + one thin write-elided
painter that take a UNIT DESCRIPTOR, with the PLAYER frame as the first instance through that seam (NOT
a bespoke player_frame module). Validate the core against the FULL target/party descriptor field set so
P11a/P11b/P11c reuse it with no core change, and land the missing #player-frame group role + aria-name
so the frame is a labelled group for screen readers.

## Starter Prompt

```
This is Phase P10b of the Frontend Modernization v0.16.0 packet: Per-frame: the unit_frame FAMILY
(player as first instance).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off
release/v0.16.0).

ULTRACODE: yes. The load-bearing reusable FAMILY that P11a/b/c (target + party) inherit, plus a
per-frame perf gate, plus the a11y group markup, plus the ClientWorld-vs-Sim parity contract; the
descriptor design is the single highest-leverage decision in the per-frame batches, so build it with
adversarial verify and gate on the perf harness.

Goal: Stand up the parameterized unit_frame FAMILY (decision 9): a pure, allocation-light core
(src/ui/unit_frame.ts) that takes a UNIT DESCRIPTOR (the fields the inline player block at
hud.ts:3656-3667 computes plus the fields target/party need) and returns the values a frame paints,
with NO hardcoded #player-frame id and NO single-instance assumption; plus a thin write-elided painter
(src/ui/unit_frame_painter.ts) constructed against a frame's element set. The PLAYER frame is the FIRST
instance: `new UnitFramePainter(playerElements)` driven by the core with a player-shaped descriptor,
replacing the inline hud.ts:3656-3667 block. Make the descriptor the one target and party can fill in
P11 with NO core change (validate it against the FULL target/party field set in this phase, not a token
stub). The frame's absorb fraction reuses the existing absorbBarView core (the player block calls
updateAbsorb('#pf-absorb', p), which itself does a raw style.transform + overshield classList.toggle:
fold that into the painter through the elided writers). The player resource className swap
(pfResourceEl.className = 'bar rage'|'energy'|'mana') and the absorb overshield toggle route through the
SIX-writer facet P10a landed (setStyleProp / toggleClass). Also land the missing a11y: #player-frame
today has class unitframe but NO role and NO accessible name (play.html:7398); add the group role +
aria-name and a REQUIRED English-only hud_chrome key.

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
- This phase depends on P0 (gates + perf baseline) and P10a (the SIX-writer write-elision facet:
  setText / setDisplay / setTransform / setWidth / setStyleProp / toggleClass). Confirm P10a landed:
  src/ui/painter_host.ts exposes setStyleProp + toggleClass, and the perf baseline + its new skip-rate
  are recorded. If P10a's setStyleProp / toggleClass are not present, STOP: the player resource
  className swap and the absorb overshield toggle cannot be elided without them.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a tight summary (not raw dumps) the
orchestrator keeps:
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 9, 10, 12, 15; the non-negotiable
  constraints; the canonical workflow; the validation matrix incl the PER-FRAME row AND the WINDOW/
  CONTROL a11y row AND the no-magic-values painter guard AND the ClientWorld-vs-Sim parity assertion;
  the Review Dispatch Matrix). Do not re-derive these; cite state.md. Decision 9 (the FAMILY contract,
  including "the unit_frame descriptor MUST be validated against the FULL target/party field set, not a
  token stub") is the SPINE of this phase.
- This phase file.
- The '### P10' AND '### P11' sections of docs/frontend-modernization/v016-recon-and-packet.md, plus the
  "Load-bearing structural findings" and "Top risks" sections (especially risk 1: write-elision
  regression). The '### P11' section describes target/party reusing the EXACT unit_frame seam you build
  here, so design the descriptor for them now; P11 must need no core change. (Reference recon sections by
  NAME; its line numbers shifted after the AMENDED note block was inserted near the top.)
- The SPECIFIC V16 source ranges this phase touches, by exact line number:
  - Player frame block: hud.ts:3656-3667. The exact writes today (CONFIRM live):
      setText(pfLevelEl, String(p.level)); setTransform(pfHpEl, scaleX(hp/maxHp));
      updateAbsorb('#pf-absorb', p); setText(pfHpTextEl, `${hp} / ${maxHp}`);
      updateLowHealthVignette(hp, maxHp); resFrac = resource/maxResource;
      setTransform(pfResEl, scaleX(resFrac)); setText(pfResTextEl, `${round(resource)} / ${maxResource}`);
      resClass = `bar ${rage|energy|mana}`; if (pfResourceEl.className !== resClass) pfResourceEl.className
      = resClass (this RAW className write becomes toggleClass-style routing via setStyleProp/toggleClass,
      or a className elided write through the facet); updateLowResource(p).
  - The player-frame element refs (hud.ts:762-767, 787-788): pfLevelEl(#pf-level), pfHpEl(#pf-hp),
    pfHpTextEl(#pf-hp-text), pfResEl(#pf-res), pfResTextEl(#pf-res-text), pfResourceEl(#pf-resource);
    pf-name (#pf-name), pf-portrait (#pf-portrait canvas), pf-absorb (#pf-absorb). These become the
    player instance's element set passed to the painter constructor.
  - updateAbsorb (hud.ts:4112-4117): `el.style.transform = scaleX(v.fillFrac)` +
    `el.classList.toggle('overshield', v.overshield)` over absorbBarView(e). Fold this INTO the
    unit_frame painter through the elided writers (setTransform + toggleClass), do NOT keep the raw
    helper on the player hot path. Leave the target/non-player updateAbsorb callers as-is (P11 migrates
    #tf-absorb).
  - play.html player-frame markup (around play.html:7396-7414): `<div id="player-frame" class="unitframe">`
    with .portrait-wrap (#pf-portrait canvas, #pf-level, #pf-combat, #pf-rest) and .uf-bars (#pf-name,
    .bar hp with #pf-hp/#pf-absorb/#pf-hp-text, .bar mana #pf-resource with #pf-res/#pf-res-text/
    #pf-low-resource). It has NO role and NO accessible name today. (CONFIRM the live markup before
    editing; do not assume from this summary.)
  - The existing reused core: absorbBarView (src/ui/absorb_bar.ts, imported at hud.ts:127). DO NOT
    re-derive it.
  - src/ui/painter_host.ts: the SIX-writer write-elision facet (P10a) + the presentation dep-bag from P6.
  - src/ui/i18n.catalog/hud_chrome.ts: where the new English-only group aria-name key goes.
  - tests/architecture.test.ts UI_PURE_CORES allowlist + forbiddenUiCoreImport (where to register the
    new unit_frame core).

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode + a Workflow. This is ONE coherent deliverable (the family + its first instance), but fan out
the descriptor-design + core, the painter, the play.html markup + i18n key, and the two-descriptor test
as parallel slices that converge; integration into the single hud.ts monolith is serialized.

  - Slice A (the descriptor + pure core): create src/ui/unit_frame.ts. Define the UNIT DESCRIPTOR type
    and a pure, allocation-light core that maps a descriptor to the values a frame paints. The
    descriptor MUST carry the FULL field set player AND target AND party need (decision 9), at minimum:
      - hpFrac (number), hpText (string), maxHp/hp NOT required if hpFrac+hpText suffice (keep it
        allocation-light: pass computed fracs + preformatted text, not raw entity references);
      - resFrac (number), resText (string), resClass (a discriminator: 'rage' | 'energy' | 'mana' | a
        none/absent case for units with no resource bar, which target/party need);
      - level (number or a present/absent flag: target/party may hide it), name (string), portraitKey
        (the portrait identity so the painter can decide whether to repaint the canvas; target uses
        lastPortraitTarget gating in P11, so the descriptor exposes the key, the painter owns the gate);
      - absorbFrac + absorbOvershield (from absorbBarView, computed at the call site and passed in, OR
        the descriptor carries the entity-shaped absorb input the core resolves via absorbBarView; pick
        the shape that keeps the core allocation-light and lets target/party feed the same input);
      - OPTIONAL presence flags target/party need that the player always has: a dead/empty flag (target
        can be dead or absent -> the painter hides or blanks), an out-of-range flag (party), a
        combo/elite/channel concern that belongs to OTHER cores (cast_bar / combo pips) and is NOT
        unit_frame's job (state that boundary; do not over-stuff the descriptor).
      The core has NO hardcoded #player-frame id and NO single-instance assumption: it is a pure
      function of the descriptor. Same descriptor gives the same output. No Math.random / Date.now /
      performance.now. The point is that P11 fills this descriptor for target and party with NO core
      change, so deliberately include the target/party-only fields NOW even though the player instance
      leaves some at their always-present values.
  - Slice B (the thin write-elided painter): create src/ui/unit_frame_painter.ts. The painter is
    constructed against a frame's ELEMENT SET (level, hp fill, hp text, res fill, res text, the
    resource container whose class encodes the resource type, name, portrait canvas, absorb element) and
    a PainterHost. paint(coreOutput) routes EVERY write through the six elided writers: setText for
    level / hp text / res text / name; setTransform for the hp + res scaleX and the absorb scaleX;
    toggleClass / setStyleProp for the resource-type class and the absorb 'overshield' class; setDisplay
    for a hide/blank case (target dead/absent, party empty) so target/party reuse it. NO raw style /
    textContent / className / classList on the hot path. The painter owns the portrait repaint gate
    (compare portraitKey, repaint the canvas only on change) so target's lastPortraitTarget gating in
    P11 is the same code path. The PLAYER instance is `new UnitFramePainter(playerElements, host)`; the
    player-only side effects that are NOT part of the unit frame (updateLowHealthVignette,
    updateLowResource) stay at the Hud call site, called alongside the painter, NOT folded into the
    family core (they are player-only and have their own cores).
  - Slice C (the player instance integration): replace the inline hud.ts:3656-3667 block with: build a
    player descriptor from p (the same fracs / text / resClass / level / name / portraitKey / absorb the
    inline block computed), call the player UnitFramePainter.paint(unitFrameView(playerDescriptor)),
    then call updateLowHealthVignette + updateLowResource as today. The raw updateAbsorb('#pf-absorb', p)
    on the player path is REPLACED by the painter's elided absorb write; leave the helper for the
    non-player callers (#tf-absorb in P11).
  - Slice D (a11y markup + i18n key): in play.html, give #player-frame role="group" and a localized
    accessible name. Add a REQUIRED (not optional) English-only key to src/ui/i18n.catalog/hud_chrome.ts
    (e.g. hudChrome.unitFrame.playerLabel = "Player frame" or "Your character") and wire it via the
    existing data-i18n-aria mechanism (data-i18n-aria + aria-label, matching the community-link / combat
    pattern at play.html:7376/7402) so it localizes through t() at hydration. play.html IS a changed
    file this phase. Convey hp and resource as TEXT inside the frame (the existing #pf-hp-text /
    #pf-res-text already do this; confirm they are not aria-hidden) so meaning never rides on color or
    bar width alone (forced-colors + screen-reader). Do NOT add a new locale overlay; English-only,
    maintainer fills at release.

Register the NEW unit_frame core in the UI_PURE_CORES allowlist in tests/architecture.test.ts. The
painter composes the P6/P10a PainterHost (the source of the six elided writers + the portrait/icon
helpers); it never reaches into Hud private state directly beyond the host bag.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only (decision 4). Consume V16's already-landed IWorld; do NOT extend IWorld or touch
  src/sim, server, src/net, or headless. If a slice finds it needs a new IWorld member, STOP and
  surface it (scope change).
- Per-frame routing (decisions 3, 5, 5a): every imperative DOM write goes through the six elided
  writers reading hotWriteCache. No raw el.style / textContent / className / classList / setAttribute /
  setProperty on the hot path. No reactivity, no Shadow DOM, no signals.
- COMPONENT CONTRACT / FAMILY (decision 9): unit_frame core+painter is a parameterized FAMILY, NOT a
  bespoke per-instance module. The core carries NO hardcoded element id and NO single-instance
  assumption; the player frame is ONE instance constructed from a descriptor. The descriptor is
  validated against the FULL target/party field set in THIS phase (not a token stub), so P11a/b/c need
  NO core change. Building target/party instances is P11; do NOT add them here, but the seam must be
  ready with no core change.
- Pure core stays DOM/Three-free and allocation-light (no per-frame garbage); no Math.random /
  Date.now / performance.now. Same input gives same output.
- CLIENTWORLD-vs-SIM PARITY (decision 15): the unit_frame core test feeds BOTH a Sim-shaped and a
  ClientWorld-mirror-shaped IWorld stub. The player descriptor is Sim-derived; the target/party
  descriptors P11 will build are partly ClientWorld-mirror-derived (target cast remaining, party
  out-of-range), so PROVE NOW that a ClientWorld-mirror-shaped descriptor (the full field set with the
  online mirror's field availability) drives the core identically; document the field set both stubs
  supply.
- ACCESSIBILITY (decision 10, WCAG 2.2 AA chrome). The unit frame is a LABELLED GROUP: #player-frame
  gets role="group" + a t()-localized accessible name; hp and resource are conveyed as TEXT in the
  frame (#pf-hp-text / #pf-res-text), never color or width alone, so forced-colors and screen-reader
  users get meaning. The frame carries no focusable control in this phase, so target-size / focus-return
  do not apply to it; STATE that boundary. A forced-colors: active snapshot keeps borders/meaning. The
  3D portrait canvas + the 3D world stay OUT of a11y scope (not screen-readable); the text name/level
  carry the identity. The full cross-window a11y audit is P15; build the per-frame group contract IN
  here.
- NO MAGIC VALUES IN PAINTERS (decision 12): the painter drives CSS custom properties / tokens, never a
  literal hex / px / color in TS. The scaleX fracs and the hp/res text are VALUES, not style literals;
  the resource-type class strings are DISCRIMINATORS the core emits, not magic colors. Any threshold /
  cadence is a named constant. The no-magic-values guard must pass.
- i18n: the group aria-name is the ONLY new player-visible string and it is a SINGLE REQUIRED
  English-only key in src/ui/i18n.catalog/hud_chrome.ts, rendered via t() (data-i18n-aria + aria-label).
  Do not concat, do not add a ?? 'English' fallback, do not edit a locale overlay. The hp/res text are
  values, not labels.
- No em dashes, en dashes, or emojis anywhere.
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- Target frame, party frames, cast bars (P11) -> they REUSE the unit_frame family you build here; do
  not build their instances now, only prove the descriptor fits them.
- The #tf-absorb / non-player updateAbsorb callers (P11); leave them on the existing helper.
- Action bar, auras pool, minimap markers (P12); FCT (P13); per-element tiering / nameplate (P14); the
  consolidated cross-window a11y audit (P15).
- Any new IWorld member, sim/server/net change, or CSS rule move. The play.html change is ATTRIBUTE-only
  (role + data-i18n-aria + aria-label on #player-frame), NOT a CSS rule move.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (per-frame + pure-core added + a chrome a11y surface + a new
.ts module + an HTML-entry attribute change):
- Baseline: npx tsc --noEmit.
- biome check on the new/changed .ts (src/ui/unit_frame.ts, src/ui/unit_frame_painter.ts, src/ui/hud.ts,
  src/ui/i18n.catalog/hud_chrome.ts).
- Pure core: npx vitest run the unit_frame core test, plus npx vitest run tests/architecture.test.ts
  (the UI-purity guard), plus a same-input-same-output assertion. THE TWO-DESCRIPTOR TEST (decision 9):
  drive the core with a player-shaped descriptor AND a target/party-shaped descriptor that exercises the
  FULL field set (resClass = none, level absent/hidden, a dead/absent target -> hidden, an out-of-range
  party flag, the absorb input). Assert the core has NO id assumption and produces correct output for
  BOTH (this is the proof P11 reuse needs no core change; do NOT use a token stub). Verify the purity
  guard FAILS when you inject a REAL DOM-import line into unit_frame (real code line, not a // comment).
- CLIENTWORLD-vs-SIM PARITY (decision 15): the two-descriptor test includes a ClientWorld-mirror-shaped
  descriptor (the online field availability) and asserts identical core output; document the field set.
- CSS / HTML entry changed: because play.html changed, run npx vitest run tests/css_corpus.test.ts +
  npx vitest run tests/client_shell.test.ts + npm run build (all 4 entries) to prove the attribute
  addition did not disturb the entry. (No CSS rule moved, so the cascade risk is low, but the entry
  guards must stay green.)
- PER-FRAME PERF GATE (mandatory): run scripts/perf_tour.mjs desktop AND mobile and assert frameP95
  <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline (>= P10a's recorded number; folding the
  raw updateAbsorb transform + overshield toggle and the resource className swap into the elided writers
  should hold or improve the rate). Record the new number.
- WINDOW/CONTROL A11Y ROW (the unit frame is HUD chrome): the WCAG 2.2 AA chrome checks over the built
  player frame (axe-core or equivalent: the frame is a role=group with an accessible name; hp/resource
  conveyed as text; a forced-colors: active snapshot keeps borders/meaning; the no-focusable-control
  boundary stated honestly). Plus the no-magic-values painter guard (the painter references tokens/vars
  and emits discriminators, not literal hex/px).
- PAINTER ROUTING TEST: a unit test asserting the unit_frame painter routes ALL writes through the six
  elided writers (no raw style / textContent / className / classList / setAttribute / setProperty on the
  hot path), including the folded absorb transform + overshield toggle and the resource-type class.
- Player text changed (the new aria key): npx vitest run tests/localization_fixes.test.ts; the new
  hudChrome.ts English-only key does not trip the release tier.
Review dispatch: qa-checklist only (presentation-only; the play.html change is an attribute add, not an
IWorld / server / net change; consuming the already-landed IWorld in a painter does NOT change it). Do
NOT spawn privacy-security-review, migration-safety, or cross-platform-sync. Prompt the reviewer for
COVERAGE, not filtering; resume a truncated reviewer per the state.md script. Do not commit until it
reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths. Suggested:
- feat(ui): add parameterized unit_frame family core + painter (paths: src/ui/unit_frame.ts,
  src/ui/unit_frame_painter.ts)
- refactor(ui): drive the player frame as the first unit_frame instance, fold absorb into elided writes
  (paths: src/ui/hud.ts)
- feat(ui): label the player frame as a group for screen readers (paths: play.html,
  src/ui/i18n.catalog/hud_chrome.ts)
- test(ui): unit_frame two-descriptor + parity core test + painter no-raw-write guard + UI_PURE_CORES
  allowlist (paths: tests/*, tests/architecture.test.ts)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes; biome check passes on every new/changed .ts.
- [ ] The unit_frame core+painter is a PARAMETERIZED FAMILY (decision 9): the core takes a UNIT
  DESCRIPTOR (hpFrac, hpText, resFrac, resText, resClass incl a none case, level incl an absent case,
  name, portraitKey, absorb), has NO hardcoded #player-frame id and NO single-instance assumption, and
  the player frame is the FIRST instance through it (not a bespoke player_frame core).
- [ ] The TWO-DESCRIPTOR test drives the core with a player-shaped AND a target/party-shaped descriptor
  exercising the FULL field set (not a token stub), proving P11a/b/c reuse needs no core change; AND it
  includes a ClientWorld-mirror-shaped descriptor (decision 15) with identical output.
- [ ] The inline player block at hud.ts:3656-3667 is replaced by the player instance's painter call;
  the raw updateAbsorb on the player path is folded into the painter's elided writes; the resource
  className swap routes through setStyleProp / toggleClass (no raw className on the player hot path);
  updateLowHealthVignette + updateLowResource stay at the call site (player-only, own cores).
- [ ] unit_frame is registered in UI_PURE_CORES; npx vitest run tests/architecture.test.ts passes, and
  the purity guard provably FAILS on an injected real DOM-import line in unit_frame.
- [ ] A painter routing test asserts no raw style / textContent / className / classList / setAttribute /
  setProperty on the hot path for the unit_frame painter (incl absorb + resource-type class).
- [ ] A11Y (decision 10): #player-frame is role="group" with a t()-localized accessible name (a single
  REQUIRED English-only hudChrome key via data-i18n-aria); hp/resource conveyed as text not color/width
  alone; the forced-colors snapshot keeps meaning; the 3D portrait/world boundary is stated honestly;
  the chrome a11y checks pass.
- [ ] NO MAGIC VALUES (decision 12): the painter drives tokens / CSS custom properties and emits
  discriminators, with no literal hex / px / color in TS; the guard passes.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND
  hudHotDomSkipRate >= the P10a recorded number (folding the raw absorb + className writes into the
  elided path holds or improves it); the new skip-rate is recorded.
- [ ] css_corpus + client_shell + npm run build (4 entries) stay green after the play.html attribute
  add; localization_fixes passes and the new English-only key does not trip the release tier.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; one new REQUIRED English-only hud_chrome key
  (the group aria-name) and one play.html attribute add.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (mark P10b status, list the new modules, record the new hudHotDomSkipRate).
- Update state.md: ledger row P10b -> done; add src/ui/{unit_frame,unit_frame_painter}.ts to the file
  map; register unit_frame in the purity allowlist note; note that the unit_frame FAMILY is now the seam
  P11a (cast bars adjacency), P11b (target frame), and P11c (party frames) REUSE with no core change;
  record the descriptor field set (so P11 fills it, not re-derives it); record the perf-gate delta; note
  the new hudChrome.unitFrame.* aria key under "New i18n keys". TAG the green-perf-gate commit so a
  later cumulative regression bisects to this phase.
- Record any surprising rule in memory (the EXACT unit_frame descriptor field set target/party need, the
  portrait-key repaint-gate ownership living in the painter, and that updateLowHealthVignette /
  updateLowResource are player-only side effects that stay OUT of the shared family).

STEP 7 - FINAL RESPONSE:
Report status, the files changed (absolute paths), the validation results (tsc, biome, core tests incl
the two-descriptor + parity assertions, architecture guard, the frame a11y + no-magic-values guards, the
css_corpus/client_shell/build status after the play.html change, the perf_tour frameP95 + skip-rate
numbers vs baseline), the qa-checklist verdict, and any deferrals. End with exactly:
Next: phase-11a-perframe-cast-bars.md

STOPPING RULES:
- STOP if P10a's setStyleProp / toggleClass are not present: the player resource className swap and the
  absorb overshield toggle cannot be elided without them.
- STOP if the unit_frame core bakes in a #player-frame id or a single-instance assumption (it would
  break P11's target/party reuse); re-shape the descriptor before proceeding.
- STOP if the two-descriptor test uses a TOKEN stub instead of the FULL target/party field set
  (decision 9): a token stub does not prove P11 reuse and is a known spec failure mode.
- STOP if any per-frame extraction regresses frameP95 above the P0 baseline OR drops hudHotDomSkipRate
  below the P10a recorded number; do not commit a perf regression, diagnose the raw-write or cache-key
  cause first.
- STOP if the P0 perf baseline is missing (the gate cannot run).
- STOP and surface it as a scope change if a slice finds it needs to extend IWorld or touch
  sim/server/net.
- STOP if a write cannot be routed through the elided helpers without changing the rendered string (a
  non-byte-identical cache key silently collapses the skip-rate); resolve the key, do not bypass the
  helper.
```

## Notes for the planner

This is the second half of the original P10 split. It carries the load-bearing reusable FAMILY
(decision 9): the player frame is the cheapest, safest place to stand up the parameterized unit_frame
core+painter, with the player as the first instance, so P11a/P11b/P11c build target and party as further
instances of the EXACT seam with no core change. Getting the descriptor field set right HERE is the
single highest-leverage decision in the per-frame batches; the deep review made the two-descriptor test
assert the FULL target/party field set (resClass none-case, level-absent case, dead/absent target,
out-of-range party, the absorb input), NOT a token stub, precisely because a token stub would let a
hidden single-instance assumption slip through and force a P11 rewrite (the recon '### P11' section
documents target/party reusing this seam). The phase depends on P10a's SIX-writer facet: the live player
block does a raw pfResourceEl.className swap (hud.ts:3666) and calls updateAbsorb (hud.ts:4112-4117)
which itself does a raw style.transform + classList.toggle('overshield'), none expressible by the four
original writers, so they fold into setStyleProp / toggleClass / setTransform here. The deep review also
verified the missing a11y: #player-frame at play.html:7398 has class unitframe but NO role and NO
accessible name, so this phase adds role="group" + a REQUIRED (not optional) English-only hud_chrome
aria key and lists play.html as a changed file. updateLowHealthVignette and updateLowResource are
player-only side effects with their own cores and deliberately stay at the Hud call site, OUT of the
shared family, so target/party do not inherit a player-only concern. The portrait-repaint gate lives in
the painter (not the core) so target's lastPortraitTarget gating in P11b is the same code path. The next
file is phase-11a-perframe-cast-bars.md.
