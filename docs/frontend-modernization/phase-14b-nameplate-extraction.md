# Phase P14b: Nameplate extraction (nameplate_view core + painter + tier-driven interval)

Carve a NEW nameplate_view pure core (the data/projection model) out of renderer.ts updateNameplates
(renderer.ts:4413) plus a thin painter that owns the Three/DOM nameplate elements, and convert today's
mobile-vs-desktop update interval (renderer.ts:4113) into a single tier-driven interval read from the
static fxLevel.

## Starter Prompt

```
This is Phase P14b of the Frontend Modernization v0.16.0 packet: Nameplate extraction (nameplate_view core + painter + tier-driven interval).
Model: Opus 4.8, xhigh effort. Harness: Claude Code.
Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).
ULTRACODE: no. This is ONE real Three/DOM-entangled extraction (a single nameplate_view core + one painter) plus one interval conversion. It is per-frame and structurally delicate, but it is a single module pair, not a multi-slice fan-out; one focused agent with the perf gate is the right tool, not ultracode.

Goal: Formalize nameplates into the same Humble Object shape every other hot element now uses. Lift the data and projection model out of renderer.ts updateNameplates (renderer.ts:4413) into a NEW nameplate_view pure core (DOM/Three-free: per-entity visibility, screen projection inputs, threat/combo state selection), and put the Three/DOM element ownership (the nameplate sprites/labels, their show/hide and positioning) behind a thin painter the renderer composes. The existing src/render nameplate_combo / nameplate_projection / nameplate_threat are only NARROW helpers, not the core; the nameplate_view core is NEW and may CALL those helpers. Separately, replace today's mobile-vs-desktop fixed interval (renderer.ts:4113, 1/15 mobile vs 1/24 desktop) with a single tier-driven interval read from the static graphicsPresetLabel-derived fxLevel, NEVER governor.state(). The mobile 1/15 floor must NOT regress.

STEP 0 - PRE-FLIGHT:
- git status clean. This is a shared checkout; if there are unexpected staged/modified files, ASK before touching anything. Confirm you are on branch feature/frontend-modernization-v016 in /Users/fernando/Documents/wocc-v0.16.0.
- Memory scan: read MEMORY.md, plus [[pr901-webgl-context-release]] (the mobile-vs-desktop nameplate interval context and the WebGL-context lesson), [[frontend-phase8-graphics-tier-effects]] (the static-preset two-controller hazard), and [[frontend-phase9-testing-docs-sweep]] (perf/test cadence).
- Confirm P5 (ui_effects_profile resolver + applier, fxLevel output) and P14a (the static-preset tier-knobs module) are landed on this branch; the nameplate interval reuses the SAME static fxLevel plumb P14a established. If the tier-knobs module / fxLevel plumb does not exist, STOP: the interval has nothing static to read.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines), renderer.ts whole, or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps):
- docs/frontend-modernization/state.md (locked decision 6 the static-preset rule + ui band governable:false; locked decision 9 the component contract pure-core + thin-painter shape; locked decision 12 no-magic-values incl the canvas getComputedStyle-once rule; locked decision 15 ClientWorld-vs-Sim parity; the validation matrix PER-FRAME + WINDOW-or-CONTROL rows; the Tier key-file paths, including "Nameplate src/render has only narrow helpers; a real nameplate_view core is NEW (P14b)").
- This phase file.
- The "### P14" section of docs/frontend-modernization/v016-recon-and-packet.md, plus "Load-bearing structural findings" and "Top risks" (risk 5 two-controller, risk 7 canvas vs no-magic-values).
- The SPECIFIC V16 source ranges P14b touches: src/render/renderer.ts updateNameplates (the method body at renderer.ts:4413) and the interval site at renderer.ts:4113 (this.nameplateTimer / nameplateInterval = this.isMobileRuntime() ? 1/15 : 1/24 / fullNameplatePass); the three existing helpers src/render/nameplate_combo.ts, src/render/nameplate_projection.ts, src/render/nameplate_threat.ts (what each already does, so the new core CALLS them and does not re-implement); src/game/ui_effects_profile.ts (the fxLevel output) and the P14a tier-knobs module (the static-preset plumb to reuse); src/render/gfx.ts (graphicsPresetLabel, the ui band governable:false).
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
One focused implementation agent (this is a single core+painter pair, not a fan-out). The work:
  1. NEW pure core src/render/nameplate_view.ts (DOM/Three-free): the data/projection model. Given the world view + viewport + the per-entity entries, it computes per-entity nameplate state (visible/hidden, projected position inputs, threat band, combo state) by delegating to the existing nameplate_combo / nameplate_projection / nameplate_threat helpers. It is allocation-light (no per-frame garbage) and registered in the architecture-guard UI_PURE_CORES allowlist. It takes the per-tier interval as an INPUT (computed upstream from fxLevel), it does not read gfx itself.
  2. A thin painter that owns the Three/DOM nameplate elements: it consumes the nameplate_view core output and shows/hides/positions the sprites/labels. This is where the Three.js entanglement lives; the renderer composes it where updateNameplates used to run.
  3. Replace the interval at renderer.ts:4113: a single tier-driven nameplateInterval read from the static graphicsPresetLabel-derived fxLevel (via the P14a plumb), NEVER governor.state(). The mobile 1/15 must remain the FLOOR (the slowest tier interval at least as fast as 1/15 is fine; it must not become slower than the pre-extraction mobile cadence). Name the per-tier interval values as constants (no bare 1/15, 1/24, etc.).
This is a delicate extraction: preserve the exact visibility, projection, and threat/combo behavior updateNameplates has today. Diff the rendered nameplates against the P0 visual baseline. Do NOT touch src/sim/server/net or extend IWorld; if the core seems to need new world state, STOP (scope change).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Component contract (locked decision 9): pure DOM/Three-free view-core + thin painter; the core is Node-tested and allocation-light (hot path). No hardcoded single-instance assumptions in the core.
- Two-controller hazard (locked decision 6, Top risk 5): the nameplate interval reads the STATIC graphicsPresetLabel-derived fxLevel; NEVER governor.state().levels. The ui gfx bucket stays governable:false. Assert by import-absence (the nameplate_view core and the interval computation import no governor) AND a behavioral test (flipping the static preset is the only thing that moves the interval).
- Mobile floor (Top risk, the PR901 lesson): the mobile 1/15 throttle must NOT regress; the slowest tier interval must be at least as frequent as the previous mobile cadence. Add a mobile-floor test asserting the mobile/lowest-tier interval is <= 1/15 s of cadence (never slower than 1/15).
- No-magic-values (locked decision 12): every interval value (the per-tier seconds) is a NAMED constant. The painter, if it draws to a 2D canvas surface, resolves --color-* via getComputedStyle ONCE per redraw (cached), never per-marker; if it is pure Three sprite/label ownership, that rule is N/A but state which.
- ClientWorld-vs-Sim parity (locked decision 15): nameplates project the SAME entity-view shape online (ClientWorld mirror) and offline (Sim). The nameplate_view core test MUST feed BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld/entity-view stub and assert identical output.
- Presentation-only: consume the already-landed IWorld / the renderer's existing entity views; do NOT extend IWorld or touch src/sim, server, src/net, headless.
- Determinism: the nameplate_view core is pure, DOM/Three-free, no Math.random/Date.now/performance.now.
- i18n: no new player-visible strings expected; nameplate labels already resolve through existing paths, do not introduce a new concat/fallback. If a label is unavoidable, English key in src/ui/i18n.catalog/hud_chrome.ts, never i18n.locales.
- ASCII only: no em dashes, en dashes, or emojis in code, comments, or docs.
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The per-element tier knobs (FCT / minimap / auras / party-target cadence). Those were P14a; here you only convert the nameplate interval and extract the nameplate core+painter.
- The ui_effects_profile resolver/applier or the CSS --fx-* tokens (P5; here you consume fxLevel).
- The standing hud_perf_budget.test.ts and the purity sweep (P17a).
- Any FPS-governor change or new gfx bucket; the ui band governable:false is fixed.
- Reworking nameplate_combo / nameplate_projection / nameplate_threat beyond calling them from the new core (they are narrow helpers; do not merge or rewrite them).

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md):
- Baseline: npx tsc --noEmit.
- New .ts module added (nameplate_view core + the painter): biome check on the new/changed .ts (the V16 ratchet).
- Pure core added/changed: npx vitest run tests/nameplate_view.test.ts + npx vitest run tests/architecture.test.ts (the UI-purity guard; register nameplate_view in the UI_PURE_CORES allowlist) + a same-input-same-output assertion + the ClientWorld-vs-Sim parity assertion (drive the core with BOTH a Sim-shaped and a ClientWorld-mirror-shaped stub).
- PER-FRAME phase (this is P14b): run the perf_tour harness and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline. Nameplates are Three/DOM, so this is the nameplate phase's OWN perf gate at the nameplate cadence (15/24Hz desktop/mobile equivalent per tier); confirm the extraction added no per-frame allocation on the hot path (the core is allocation-light).
- Mobile-floor test (the PR901 lesson): the mobile / lowest-tier nameplate interval must not regress below the previous 1/15 mobile cadence; assert the computed interval at the mobile/lowest tier is <= 1/15 s.
- Two-controller assertions: import-absence (the nameplate_view core and the interval computation import no governor) + a behavioral test (only the static preset moves the interval; driving the governor leaves it fixed).
- WINDOW or CONTROL row (decision 10): nameplates are part of the 3D world surface, which is OUT of WCAG screen-reader scope; state that boundary HONESTLY (nameplates are not a focusable chrome control and are not screen-readable). Do NOT skip the row silently; record the explicit out-of-scope determination. Run the no-magic-values painter guard (decision 12) on the painter: every interval value is a named constant; if the painter touches a 2D canvas, it resolves tokens once per redraw.
- Screenshot-diff against the P0 visual baseline: nameplate visibility, position, threat/combo state must match pre-extraction.
Review dispatch (state.md matrix): qa-checklist only. This is presentation-only and touches no server/net/admin/IWorld/sim, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire. Prompt the reviewer for COVERAGE, not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with the state.md one-liner.

STEP 4 - COMMIT CADENCE: 2 to 5 Conventional Commits with a scope and EXPLICIT paths. Suggested:
- feat(render): add nameplate_view pure core (delegates to combo/projection/threat helpers)
- feat(render): move updateNameplates element ownership behind a thin nameplate painter
- feat(render): tier-drive the nameplate interval from static fxLevel (named per-tier constants)
- test(render): nameplate_view purity + ClientWorld-vs-Sim parity + mobile-floor + two-controller import-absence

STEP 5 - ACCEPTANCE CRITERIA (every item green before the phase is done):
- [ ] A NEW src/render/nameplate_view.ts pure core exists (DOM/Three-free, allocation-light) and delegates to the existing nameplate_combo / nameplate_projection / nameplate_threat helpers; it does not re-implement them.
- [ ] A thin painter owns the Three/DOM nameplate elements; the renderer composes it where updateNameplates ran. updateNameplates behavior (visibility, projection, threat/combo) is preserved.
- [ ] The interval at renderer.ts:4113 is a single tier-driven value read from the STATIC fxLevel (named per-tier constants), never governor.state(); the ui gfx bucket stays governable:false.
- [ ] Mobile-floor test: the mobile / lowest-tier interval is <= 1/15 s (no regression below the previous 1/15 mobile cadence).
- [ ] tsc clean; biome check clean on the new/changed .ts; architecture.test.ts green (nameplate_view registered in UI_PURE_CORES); same-input-same-output holds.
- [ ] ClientWorld-vs-Sim parity: nameplate_view produces identical output under a Sim-shaped and a ClientWorld-mirror-shaped stub.
- [ ] Import-absence test: nameplate_view core + the interval computation import no governor. Behavioral test: only the static preset moves the interval.
- [ ] perf_tour: frameP95 <= P0 baseline AND hudHotDomSkipRate >= P0 baseline at the nameplate cadence; no new per-frame allocation on the hot path.
- [ ] No-magic-values: every interval value is a named constant; canvas (if any) resolves tokens once per redraw.
- [ ] Screenshot-diff against the P0 baseline matches (nameplate visibility/position/threat/combo unchanged).
- [ ] WCAG row recorded as explicitly out of scope (3D world not screen-readable), stated honestly, not skipped silently.
- [ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update docs/frontend-modernization/progress.md (P14b row: status, the new nameplate_view + painter, the per-tier interval values, the perf numbers) and state.md (mark P14b done in the ledger, note nameplate_view + its purity-allowlist registration, record that the nameplate interval is now static-preset-tiered with the mobile 1/15 floor preserved).
- Record surprising rules in memory: any place the updateNameplates extraction was harder than a thin lift (the Three-entanglement gotchas), the mobile-floor wiring, and any place the static-vs-governor interval wiring was tempting to cross.

STEP 7 - FINAL RESPONSE: status, files changed (absolute paths), validation results (tsc, biome, vitest incl the parity + mobile-floor + import-absence tests, the perf_tour numbers, the screenshot-diff), reviewer verdict, deferrals, and end with exactly: Next: phase-15a-a11y-infra.md

STOPPING RULES:
- STOP if the P14a tier-knobs module / static fxLevel plumb does not exist; the nameplate interval has nothing static to read (surface it, do not read the governor).
- STOP if the extraction regresses frameP95 above the P0 baseline, drops hudHotDomSkipRate below baseline, or the screenshot-diff shows a nameplate regression; revert and report.
- STOP if the mobile / lowest-tier interval would become slower than 1/15 s (mobile-floor regression).
- STOP if the interval cannot be driven without reading governor.state().levels, or if the nameplate_view core needs new world state; that is a scope change (surface it, do not extend IWorld).
- STOP if the extraction would require touching src/sim/server/net or extending IWorld.
- STOP if the working set approaches the ~40% context ceiling; surface it rather than degrade (this phase is a single core+painter and should fit comfortably).
```

## Notes for the planner

P14b is the one genuine extraction the old P14 carried, carved out from the knob-wiring (P14a) because
it is NOT a thin add-on: renderer.ts updateNameplates is Three/DOM-entangled and the existing src/render
nameplate_combo / nameplate_projection / nameplate_threat are only narrow helpers, so a real
nameplate_view core is brand new and must delegate to those helpers rather than re-implement them. The
interval conversion reuses the static-preset plumb P14a established (which is why P14a runs first), and
the load-bearing risks are the two-controller hazard (the interval must read the static preset, never the
governor) and the mobile 1/15 floor from the PR901 WebGL-context work (the lowest tier must never become
slower than the old mobile cadence). The WCAG row is explicitly out of scope because the 3D world is not
screen-readable, but the phase records that boundary honestly rather than skipping the row. Keeping this
its own single-pair extraction holds it well under the 40% ceiling and leaves the accessibility phases
(P15a/P15b) to start clean.
