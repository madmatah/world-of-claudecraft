# Phase P14a: Per-element graphics tiering (tier knobs read the static preset)

Drive each per-element hot-path cost knob (FCT, minimap cadence, aura visible-count, party/target
non-self cadence) from the STATIC ui_effects_profile fxLevel, never the FPS governor. Each knob is a
pure function of fxLevel; the ui gfx bucket stays governable:false.

## Starter Prompt

```
This is Phase P14a of the Frontend Modernization v0.16.0 packet: Per-element graphics tiering (tier knobs read the static preset).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).
ULTRACODE: no. This is four independent per-element knob-wirings (FCT, minimap, auras, party/target cadence) onto already-extracted painters; no new core infrastructure and no DOM/Three extraction. A small parallel Agent fan-out (one slice per knob) plus the per-tier perf gate is enough; ultracode is not warranted for pure knob-wiring.

Goal: Now that every hot element is core+painter (P10-P13), make each per-element cost a pure function of the STATIC ui_effects_profile.fxLevel (from P5): FCT max-concurrent / per-text lifetime (TTL) / drop-non-crit; minimap redraw cadence per tier (10Hz at ultra/high down to ~4Hz at low); aura visible-count cap and tick granularity (low shows fewer auras / coarser tick); and party/target NON-SELF refresh cadence on low (self/player stays full-rate). Every knob reads the static graphicsPresetLabel-derived fxLevel and NEVER governor.state().levels. Ultra must stay byte-equivalent in HUD cost to pre-tiering (the tier branch is a no-op at ultra); low must measurably shed HUD cost with frameP95 still within the P0 baseline on every tier. Nameplate extraction is NOT in this phase (it is P14b).

STEP 0 - PRE-FLIGHT:
- git status clean. This is a shared checkout; if there are unexpected staged/modified files, ASK before touching anything. Confirm you are on branch feature/frontend-modernization-v016 in /Users/fernando/Documents/wocc-v0.16.0.
- Memory scan: read MEMORY.md, plus [[frontend-phase8-graphics-tier-effects]] (the FB tier resolver + two-controller hazard + paused-vignette special cases) and [[frontend-phase9-testing-docs-sweep]] (perf/test cadence). The two-controller hazard is the headline risk here.
- Confirm P5 (ui_effects_profile resolver + applier, fxLevel output), P12a (action bar) + P12b (auras keyed pool + minimap markers core/painter), and P13a/P13b (FCT core + per-frame driver + pooled painter) are landed on this branch; P14a tiers the knobs those phases exposed. If any of those cores do not exist yet, STOP: P14a has nothing to tier.
- CONFIRM P13b actually EXPOSED the FCT cap / TTL / drop-non-crit knobs as painter-settable parameters. The pre-P13 inline fct() (hud.ts:7258-7276) had NO max-concurrent cap, no configurable per-text TTL, and no crit-gate; those are introduced by the P13a/P13b extraction. If the P13b FCT painter does NOT yet take a (maxConcurrent, ttl, dropNonCrit) parameter surface, STOP and surface it: Slice A cannot tier knobs P13b never created (this is a scope dependency, not a P14a invention).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 6 and 8: the static-preset rule + the full UiEffectsProfile API; locked decision 12 no-magic-values; locked decision 15 ClientWorld-vs-Sim parity; the validation matrix PER-FRAME row + the WINDOW-or-CONTROL row; the two-controller hazard in Top risks (risk 5); the Tier key-file paths).
- This phase file.
- The "### P14" section of docs/frontend-modernization/v016-recon-and-packet.md, plus "Load-bearing structural findings" and "Top risks" (risk 5 two-controller, risk 1 write-elision).
- The SPECIFIC V16 source ranges P14a touches: src/game/ui_effects_profile.ts (the P5 resolver: fxLevel output + tokens); src/render/gfx.ts (graphicsPresetLabel at 245, GFX_BUCKET_BANDS, the ui band governable:false); the P13a/P13b FCT pool/painter/driver and the original fct() at hud.ts:7258-7276 + the 7 SimEvent spawn sites 6100-6422 PLUS showSelfNote (7255, caller main.ts:1727) = the 8th site (for the max-concurrent / TTL / drop-non-crit knobs); the P12b minimap painter (hud.ts:5022-5258, the existing 10Hz gate) and aura painter (renderAuras hud.ts:4186-4245, visible-count); the party-frames painter call site (hud.ts:11508-11562, selector in src/ui/party_frames.ts) and target frame (hud.ts:3672-3749) for the non-self cadence.
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Parallel Agent fan-out, one slice per independent knob. Slices:
  Slice A - FCT tiering: route the P13b FCT painter's pool cap (max-concurrent), per-text lifetime/TTL, and drop-non-crit gate from fxLevel (low sheds non-crit text, caps max-concurrent tighter, shortens TTL). The pure tier->knob mapping lives in a small host-agnostic function; the painter consumes it. Touches the P13a/P13b pool/painter parameter surface ONLY (do not re-extract).
  Slice B - Minimap cadence: convert the P12b minimap painter's fixed ~10Hz redraw gate (hud.ts:5022-5258) into a tier-driven cadence (10Hz at ultra/high down to ~4Hz at low). The marker pure core is UNCHANGED; only the painter's redraw interval reads fxLevel.
  Slice C - Auras tiering: drive the P12b aura painter's visible-count cap and tick granularity from fxLevel (low shows fewer auras / coarser tick). The debuff allowlist already moved into the core in P12b; here ONLY the count/granularity is a function of fxLevel.
  Slice D - Party/target cadence: on low fxLevel, slow the NON-SELF party-frame (hud.ts:11508-11562) and target-frame (hud.ts:3672-3749) refresh cadence; self/player stays full-rate. Cadence is a pure function of fxLevel.
Each tier->knob mapping is a PURE function of fxLevel that a Vitest imports directly; the painter is a thin consumer. Where two or more slices want the same mapping shape, follow rule-of-three: do not pre-abstract, but a single small src/game tier-knobs module (render-importable leaf, sibling to ui_effects_profile.ts) is acceptable once three or more knobs share it. Request the fan-out explicitly; use isolation: "worktree" only if two slices edit the same painter file (FCT and auras may both live near the per-frame painters).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Two-controller hazard (locked decision 6 + 8, Top risk 5): EVERY knob reads the static graphicsPresetLabel-derived ui_effects_profile fxLevel; NEVER governor.state().levels. The renderer.ts plumb passes the STATIC preset-derived fxLevel down, NOT governor.state(). The ui gfx bucket stays governable:false. Assert by import-absence (no governor import in the tier-knob mapping) AND a behavioral test (flipping the static preset is the ONLY thing that moves a knob; driving the governor leaves every knob fixed).
- No-magic-values (locked decision 12): every tier threshold and cadence is a NAMED constant (the per-tier FCT cap, the per-tier TTL, the minimap 10Hz..4Hz cadence values, the aura visible-count cap, the non-self cadence divisor). No bare numeric literal for a tier knob; name them in the tier-knobs module.
- ClientWorld-vs-Sim parity (locked decision 15): the tier-knob mapping is a pure function of fxLevel and is world-agnostic, but the painters it feeds consume IWorld. Any *_view core test these painters exercise must already feed BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub (inherited from P12/P13); P14a adds no new world assumption, but assert the tiered painter behaves identically under both shapes at a fixed fxLevel.
- Presentation-only: consume the already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, headless. If a knob seems to need new world state, STOP (scope change).
- Per-frame write-elision (locked decision 3/5/5a, Top risk 1): every painter write still routes through the host's elided writers (setText/setDisplay/setTransform/setWidth, plus the P10a setStyleProp/toggleClass extension via hotWriteCache); changing a cadence must not introduce a raw style/textContent/setAttribute write or a non-byte-identical cache key. A skipped redraw on low must SKIP the write path, not write the same value.
- Determinism: the tier-knob mapping is pure, DOM/Three-free, no Math.random/Date.now/performance.now (the FCT painter may keep its jitter; the mapping may not).
- i18n: no new player-visible strings expected; data-fx-level + --fx-* are INTERNAL (no t()). If a label is unavoidable, English key in src/ui/i18n.catalog/hud_chrome.ts, never i18n.locales.
- ASCII only: no em dashes, en dashes, or emojis in code, comments, or docs.
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- Nameplate extraction (renderer.ts updateNameplates -> nameplate_view core + painter + tier-driven interval). That is P14b; do not start it here.
- Re-extracting any hot element into core+painter (that was P10-P13; here you only tier the knobs they exposed). Do not invent new cores.
- The ui_effects_profile resolver/applier or the CSS --fx-* tokens (P5; here you consume fxLevel, you do not change how it is resolved).
- The standing hud_perf_budget.test.ts and the purity sweep (P17a).
- Any FPS-governor change or new gfx bucket; the ui band governable:false is fixed.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md):
- Baseline: npx tsc --noEmit.
- New .ts module added (the tier-knobs module): biome check on the new/changed .ts (the V16 ratchet).
- Pure core added/changed: npx vitest run on the new tier-knobs core test(s) + npx vitest run tests/architecture.test.ts (the UI-purity guard; register the tier-knobs module in the UI_PURE_CORES allowlist) + a same-input-same-output assertion per pure tier function.
- PER-FRAME phase (this is P14a): run the perf_tour harness and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline, on EVERY tier (run perf_tour at low, high, ultra). Add the phase-specific assertions: low tier shows measurably reduced HUD cost vs ultra (fewer FCT nodes, fewer minimap redraws, fewer aura nodes, slower non-self cadence); ultra is byte-equivalent in HUD cost to pre-tiering (no new per-frame work on ultra; the tier branch is a no-op there). Keep the unit test that the touched painters route ALL writes through the host's elided writers (no raw style/textContent/setAttribute; canvas minimap is gated on cadence + cached background, not the elided-writer routing test, per decision 12).
- WINDOW or CONTROL row (MANDATORY, decision 10): the touched per-element surfaces are HUD controls (FCT, auras, party/target frames). Run the WCAG 2.2 AA chrome checks over the affected built surfaces: axe-core (or equivalent) over the party/target frames and aura strip; keyboard reachability + focus-return on any focusable element they own; visible :focus-visible never animated away (and confirm a low-tier motion knob does not remove a focus outline); a forced-colors: active snapshot of the frames + auras; target-size >=24px and >=40x40 on any mobile touch control these slices affect. The 3D world/nameplates are OUT of scope here. Plus the no-magic-values painter guard (decision 12): DOM painters reference tokens/vars; the canvas minimap resolves --color-* once per redraw (cached), and every tier threshold is a named constant.
- Two-controller assertions (the headline gate): an import-absence test that the tier-knob mapping never imports the governor, plus a behavioral test that flipping the static preset (not the governor) is the only thing that changes a knob.
Review dispatch (state.md matrix): qa-checklist only. This is presentation-only and touches no server/net/admin/IWorld/sim, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire. Prompt the reviewer for COVERAGE, not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with the state.md one-liner.

STEP 4 - COMMIT CADENCE: 2 to 5 Conventional Commits with a scope and EXPLICIT paths. Suggested:
- feat(ui): add static-preset tier-knobs module (named per-tier constants)
- feat(ui): tier FCT pool cap, TTL, and drop-non-crit from static fxLevel
- feat(ui): tier minimap redraw cadence and aura visible-count from fxLevel
- feat(ui): slow non-self party/target refresh on low tier
- test(ui): tier-knob purity + import-absence + behavioral two-controller + per-tier perf gate

STEP 5 - ACCEPTANCE CRITERIA (every item green before the phase is done):
- [ ] FCT max-concurrent, per-text TTL, and drop-non-crit are each a pure function of fxLevel; low caps concurrency tighter, shortens TTL, and drops non-crit text; ultra is unchanged from pre-tiering.
- [ ] Minimap redraw cadence reads fxLevel (10Hz ultra/high down to ~4Hz low); the marker pure core is byte-unchanged; the canvas resolves tokens once per redraw.
- [ ] Aura visible-count cap and tick granularity read fxLevel; low shows fewer auras / coarser tick.
- [ ] Non-self party-frame and target-frame refresh cadence slow on low; self/player frame stays full-rate.
- [ ] Every tier threshold/cadence/cap is a NAMED constant in the tier-knobs module (no bare literals; no-magic-values guard passes).
- [ ] Import-absence test: the tier-knob mapping imports no governor module. Behavioral test: only the static preset moves a knob; driving governor.state() moves nothing. The ui gfx bucket stays governable:false.
- [ ] tsc clean; biome check clean on the new/changed .ts; architecture.test.ts green (tier-knobs module registered in UI_PURE_CORES); same-input-same-output holds per tier function.
- [ ] perf_tour at low, high, ultra: frameP95 <= P0 baseline AND hudHotDomSkipRate >= P0 baseline on every tier; low shows measurably reduced HUD cost vs ultra; ultra byte-equivalent to pre-tiering.
- [ ] The touched DOM painters route ALL writes through the host's elided writers (routing test green); the canvas minimap is gated on cadence + cached background.
- [ ] WCAG 2.2 AA chrome row green on the affected frames/auras (axe, keyboard + focus-return, :focus-visible preserved under low-tier motion knobs, forced-colors snapshot, target-size).
- [ ] ClientWorld-vs-Sim: the tiered painters behave identically under a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub at a fixed fxLevel.
- [ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/frontend-modernization/progress.md (P14a row: status, the new tier-knobs module, the per-tier perf numbers) and state.md (mark P14a done in the ledger, note the tier-knobs module + its purity-allowlist registration, record the low/high/ultra frameP95 deltas and which knob moved the needle most).
- Record surprising rules in memory: which knobs actually moved the perf needle on low, any paused/edge special case (the FB paused-vignette lesson), and any place the static-vs-governor wiring was tempting to cross.

STEP 7 - FINAL RESPONSE: status, files changed (absolute paths), validation results (tsc, biome, vitest, the per-tier perf_tour numbers, the import-absence + behavioral two-controller tests, the WCAG row, the parity assertion), reviewer verdict, deferrals, and end with exactly: Next: phase-14b-nameplate-extraction.md

STOPPING RULES:
- STOP if P13b did NOT expose a settable FCT (maxConcurrent, ttl, dropNonCrit) surface; Slice A cannot tier knobs that do not exist (surface it as a P13b scope dependency, do not invent the knobs inline in fct()).
- STOP if tiering a knob regresses frameP95 above the P0 baseline on ANY tier, or drops hudHotDomSkipRate below the baseline; revert that slice and report.
- STOP if ultra is no longer byte-equivalent in HUD cost to pre-tiering (a tier branch added per-frame work on ultra); the tier branch must be a no-op at ultra.
- STOP if any knob cannot be driven without reading governor.state().levels, or if a knob needs new world state; that is a scope change (surface it, do not extend IWorld).
- STOP if the working set approaches the ~40% context ceiling; the four slices are independent and split cleanly.
```

## Notes for the planner

P14a is the pure knob-wiring half of the old P14: now that P10-P13 made every hot element a
core+painter, each per-element cost becomes a pure function of the static fxLevel with no new
infrastructure. It is shaped as four independent slices (FCT, minimap, auras, party/target cadence)
because the knobs do not share state and fan out cleanly onto already-extracted painters. The single
load-bearing risk is the two-controller hazard: every knob must read the static preset and never the
FPS governor, so the gate is an import-absence plus behavioral test on top of the per-tier perf gate.
The one cross-phase dependency to verify up front is that P13b actually exposed the FCT cap/TTL/crit
knobs (the pre-P13 fct() lacked them); Slice A tiers what P13b created, it does not invent it. The
nameplate extraction was carved out into P14b because it is a real Three/DOM-entangled extraction, not
a knob-wiring; keeping it separate holds P14a well under the 40% ceiling.
