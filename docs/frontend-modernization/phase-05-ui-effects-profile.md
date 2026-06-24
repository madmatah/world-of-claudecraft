# Phase P5: ui_effects_profile resolver (src/game, 5-axis, defines the cutoff) + token applier

Port FB's single governor-independent effects resolver as a render-importable leaf in `src/game/`:
a pure function of (graphicsPresetLabel, effectsQuality, reduceMotion) returning the FULL 5-axis
`UiEffectsProfile` (tier / motion / heavyShadows / ambientAnim / allowFctCrit) plus `uiEffectsTokens`,
`uiEffectsProfilesEqual`, and `uiEffectsAllowFctCrit`. It DEFINES `EFFECTS_QUALITY_LOW_CUTOFF = 0.5`
(the constant does not exist in V16; `gfx.ts:308` is a bare `0.5`) and `gfx.ts:308` is refactored to
import it. A dumb theme.ts-style applier sets `data-fx-level` + `--fx-*` (debounced, diff-guarded,
OS reduced-motion reconciled), then the extracted CSS (glass/glow/FCT-crit/vignette) consumes those
custom props. Presentation-only, governor-independent; no per-frame work.

## Starter Prompt

```
This is Phase P5 of the Frontend Modernization v0.16.0 packet: ui_effects_profile resolver (src/game, 5-axis, defines the cutoff) + token applier.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a small surgical phase (one new pure module + a one-line gfx.ts import refactor + one dumb applier + a focused CSS wiring pass over already-extracted files). It is not a batch-heavy CSS or cold-window or per-frame phase, so a single orchestrated pass with one review agent is the right weight. Do not fan out.

Goal: Port FB's effects resolver as the one static-tier resolver and place it at `src/game/ui_effects_profile.ts` (a render-importable LEAF), NOT `src/ui/`, because `src/render/gfx.ts` will import a shared constant from it and render must never import ui (locked decision 6 and 8). The resolver is a pure function of (graphicsPresetLabel, effectsQuality, reduceMotion) returning the FULL 5-axis `UiEffectsProfile` contract from FB: `{ tier, motion, heavyShadows, ambientAnim, allowFctCrit }`, plus the `uiEffectsTokens(profile)` flat `--fx-*` map, `uiEffectsProfilesEqual(a, b)`, and `uiEffectsAllowFctCrit(profile)`. NOT the `{fxLevel, tokens}` shorthand. It reads the STATIC preset, NEVER the FPS governor. The module DEFINES `EFFECTS_QUALITY_LOW_CUTOFF = 0.5` (this constant does NOT exist in V16 today; `gfx.ts:308` is a bare `0.5` literal in the PRESET_ADVANCED arm) and you refactor `gfx.ts:308` to import it from the resolver. Honor the locked 'advanced' decision: do NOT collapse 'advanced' to 'high'; honor its effectsQuality slider against EFFECTS_QUALITY_LOW_CUTOFF for a distinct HUD-fx tier so the expert path sheds HUD cost independently. Add a dumb theme.ts-style applier that sets `data-fx-level` + each `--fx-*` token, reconciled with the OS `prefers-reduced-motion` matchMedia channel and the existing `body.reduce-motion` toggle (main.ts:1235-1236) so they do not fight; the applier debounces the effectsQuality apply ~180ms and gates on `uiEffectsProfilesEqual` so a no-op never re-stamps `data-fx-level`. Then wire the `--fx-*` custom props into the CSS extracted in P2/P3 (glass, glow, FCT-crit, vignette). `data-fx-level` and `--fx-*` are INTERNAL, no t().

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and these entries: [[frontend-phase8-graphics-tier-effects]] (the FB resolver/applier shape, the 5-axis profile, the EFFECTS_QUALITY_LOW_CUTOFF shared with gfx.ts, the two-controller hazard: static preset drives fx not the FPS governor, the ui gfx band governable:false, paused-vignette special case, the bucket-set B1-B7 mapping), [[frontend-phase9-testing-docs-sweep]] (gfx.ts shares EFFECTS_QUALITY_LOW_CUTOFF, the deferred render->game leaf import note), [[frontend-architecture-vanilla-stack]] (vanilla stack, --fx-* internal).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize: state.md (locked decisions 6 and 8, non-negotiable constraints, validation matrix, review dispatch, the Key file paths "Tier:" row), this phase file, the "### P5" section of v016-recon-and-packet.md plus open-decision 1 and top-risk 5, and these SPECIFIC V16 source ranges (VERIFY them live; the recon line numbers can drift):
- `src/render/gfx.ts`: `graphicsPresetLabel` at line 245 (returns 5 labels: low/medium/high/ultra/advanced; PRESET_ADVANCED constant at gfx.ts:107, the label case arm at 251), `effectsQuality?` field at line 55, the bare `0.5` PRESET_ADVANCED effects-quality literal at line 308 (this is the one you replace with an imported EFFECTS_QUALITY_LOW_CUTOFF; the sibling 0.5 literals at 306/307/309 are terrainDetail/foliageDensity/shadowQuality knobs and are OUT of scope, leave them), `GfxTier` at line 12 (4 labels), `GFX_BUCKET_BANDS` 169+ (the `ui` band is governable:false; do not touch it).
- `src/game/settings.ts`: `reduceMotion` (the boolean comfort setting).
- `src/main.ts`: the existing `body.reduce-motion` toggle at line 1235-1236 (settings.set('reduceMotion', ...) -> classList.toggle), and the pre-existing em dash in its preceding comment at line 1234 ("No sim involvement — purely presentational.") which you will normalize in the same hunk.
- `src/ui/theme.ts`: the applier shape (how it writes `--color-*` custom props at runtime, and how/where it is invoked on a settings change) to mirror for the dumb applier.
- The P2/P3-extracted CSS files (`src/styles/hud.css`, `src/styles/components.css`) where glass/glow/FCT-crit/vignette rules now live (grep for backdrop-filter, the glow box-shadows, the FCT crit selector, the vignette/death overlay).
- FB's effects resolver module, its test, and the FB applier wiring as the PORT SOURCE (read-only; locate the completed feature/frontend-modernization tree, e.g. the wocc-v0.14.0 worktree). Port the FULL 5-axis contract, not a shorthand.
The orchestrator keeps the summary, not raw dumps.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE: single orchestrated pass, three sequential slices.
- Slice A (resolver, the core, BLOCKING-corrected from the draft):
  - Create `src/game/ui_effects_profile.ts` (NOT src/ui/; render imports it, so it must be a render-importable leaf in src/game and must not import from src/render or src/ui).
  - DEFINE and export `export const EFFECTS_QUALITY_LOW_CUTOFF = 0.5;`. Then refactor `src/render/gfx.ts:308` to import this constant and use it in place of the bare `0.5` (the `(hints.effectsQuality ?? 1) < 0.5` comparison becomes `< EFFECTS_QUALITY_LOW_CUTOFF`). This is the single source of truth for the effects-quality low boundary, shared by the renderer's composer/ao gate and the HUD-fx tier. Do not touch the sibling terrainDetail/foliageDensity/shadowQuality 0.5 literals.
  - Export the FULL 5-axis FB contract, exactly (do NOT substitute the `{fxLevel, tokens}` shorthand):
    - `type UiEffectsTier` (the internal HUD-fx levels FB used, e.g. 'low' | 'medium' | 'high' | 'ultra'; keep FB's exact label set).
    - `interface UiEffectsProfile { tier: UiEffectsTier; motion: number; heavyShadows: boolean; ambientAnim: boolean; allowFctCrit: boolean; }` (match FB field-for-field).
    - `function resolveUiEffectsProfile(input: { presetLabel, effectsQuality, reduceMotion }): UiEffectsProfile`. `tier` is derived from the 5 preset labels collapsed against `effectsQuality`: advanced HONORS effectsQuality, dropping to a distinct lower tier when `effectsQuality < EFFECTS_QUALITY_LOW_CUTOFF` (per locked decision 8 and open-decision 1; do NOT collapse advanced->high). `reduceMotion === true` forces `motion` to the floor and `ambientAnim`/`allowFctCrit` off.
    - `function uiEffectsTokens(profile): Record<string, string>` returning the flat `--fx-*` map the applier writes. Carry FB's motion-scale FLOOR: when motion is disabled the `--fx-*` motion-scale token is `0.001`, NOT `0` (the 0.001-not-0 floor avoids a div-by-zero / zero-duration animation collapse in the CSS; locked decision 8).
    - `function uiEffectsProfilesEqual(a, b): boolean` (a structural compare of all 5 axes; the applier's diff-guard).
    - `function uiEffectsAllowFctCrit(profile): boolean` (the FCT-crit accessor P13 will consume).
  - No DOM, no Three, no governor import, no `src/render`/`src/ui` import (this module is the import-absence assertion target on two counts: no governor, and no render/ui). No `Math.random`/`Date.now`/`performance.now`.
  - Register `src/game/ui_effects_profile.ts` in the P0 `UI_PURE_CORES` purity allowlist (it is a registered pure core even though it lives in src/game).
- Slice B (applier, the dumb host):
  - Add a theme.ts-style applier (mirror theme.ts's runtime custom-prop write and its settings-change invocation) that takes a resolved `UiEffectsProfile`, calls `uiEffectsTokens(profile)`, sets `data-fx-level` on the document element (the value is `profile.tier`, an INTERNAL string, NO t()), and sets each `--fx-*` token on `:root`.
  - DIFF-GUARD: keep the last applied profile; on a new apply, if `uiEffectsProfilesEqual(next, last)` is true, return early and do NOT re-stamp `data-fx-level` or rewrite tokens (locked decision 8). The applier owns this cache (the pure core stays stateless).
  - DEBOUNCE: the `effectsQuality` slider fires rapidly while dragging; debounce the apply ~180ms (locked decision 8) so a drag does not thrash `data-fx-level`. The preset-change and reduce-motion-change paths may apply immediately (they are discrete), but routing them through the same debounced applier is acceptable as long as the leading/trailing edge still lands a final correct apply.
  - OS REDUCED-MOTION CHANNEL: add an OS `window.matchMedia('(prefers-reduced-motion: reduce)')` channel with a `change` listener. The resolver input `reduceMotion` is `OS prefers-reduced-motion === reduce OR settings.get('reduceMotion')` (either source forces motion off). On the matchMedia `change` event, re-resolve and re-apply (through the debounced+diff-guarded applier).
  - RECONCILE WITH main.ts:1235-1236: the resolver already accounts for reduceMotion, so make motion a SINGLE source of truth: route the `reduceMotion` setting change through the resolver+applier, and keep `body.reduce-motion` only as the CSS hook it already is (do NOT invent a second motion flag, do NOT let the applier and the body-class toggle contradict). Wire the applier to run wherever the graphics preset / effectsQuality / reduceMotion settings change (the same settings-change seam theme.ts uses). In the SAME hunk that touches main.ts, normalize the pre-existing em dash in the comment at main.ts:1234 to a comma or period (e.g. "No sim involvement, purely presentational.").
- Slice C (CSS consumption): in the P2/P3-extracted CSS, replace the relevant hardcoded glass/glow/FCT-crit/vignette values with `var(--fx-*)` reads so the applier's tokens take effect. Keep JS-written custom props as `:root` defaults (a sensible default when the applier has not run, including the 0.001 motion-scale floor as the reduced default where appropriate). Match the FB bucket-set mapping (B1 glass / B2 vignette + ambient / B4 glow / B6 FCT crit) from memory [[frontend-phase8-graphics-tier-effects]]; honor the paused-vignette special case (paused vignette holds the 55% 0%-keyframe, not full tint). backdrop-filter stays -webkit-first (the Lightning minify gotcha).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Two-controller hazard (locked decision 6, top-risk 5): the resolver reads the STATIC graphicsPresetLabel ONLY; it MUST NOT import or read `governor.state().levels`. Assert by import-absence.
- Resolver placement (locked decision 6): `src/game/ui_effects_profile.ts`, render-importable, never `src/ui/`; the module imports NOTHING from `src/render` or `src/ui` (so the gfx.ts -> resolver import is a render -> game leaf import, never render -> ui). Assert by import-absence on src/render and src/ui too.
- The `ui` gfx bucket stays governable:false; do not edit GFX_BUCKET_BANDS.
- `data-fx-level` and `--fx-*` are INTERNAL strings: NO t() (locked decision 6). (No new player-visible label is expected this phase; if one appears, it goes English-only in src/ui/i18n.catalog/hud_chrome.ts and never into i18n.locales.)
- Pure core stays DOM/Three-free and deterministic: no Math.random / Date.now / performance.now in ui_effects_profile.ts.
- Presentation-only: do not touch src/sim, server, src/net, headless, or src/world_api.ts (IWorld).
- Shared worktree: commit with EXPLICIT paths, never git add -A.
- No em dashes, en dashes, or emojis anywhere (and normalize the pre-existing one at main.ts:1234 while you are in that hunk).

Out of scope (do NOT do in this phase):
- Per-element graphics tiering (FCT max-concurrent, minimap cadence, aura visible-count, party/target cadence) and nameplate formalization: that is P14a/P14b, which CONSUME this resolver's profile (tier + uiEffectsAllowFctCrit). P5 only ships the resolver + the gfx.ts import refactor + applier + CSS token wiring.
- Any per-frame extraction or write-elision work (P10a-P13b).
- Any cold-window or PainterHost work (P6-P9b).
- Extending IWorld or any sim/server change.
- Touching the sibling 0.5 literals at gfx.ts:306/307/309 (terrainDetail/foliageDensity/shadowQuality) or any other gfx tier band.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- Pure core added: `npx vitest run tests/ui_effects_profile.test.ts` + `npx vitest run tests/architecture.test.ts` (the UI-purity guard, now also covering src/game/ui_effects_profile.ts) + a same-input-same-output (determinism) assertion in the test.
- New `.ts` module added: `biome check` on the new/changed `.ts` (src/game/ui_effects_profile.ts, src/render/gfx.ts, the applier module, src/main.ts) (the V16 ratchet).
- CSS changed: `npx vitest run tests/css_corpus.test.ts` + `npx vitest run tests/client_shell.test.ts` + `npm run build` (all 4 entries) + the backdrop-filter -webkit-first survival check + `biome check` on the touched CSS + a screenshot-diff against the P0 visual baseline (the CSS wiring risks a cascade change).
- No per-frame phase here, so NO perf gate is required for P5. No WINDOW/CONTROL row and no canvas painter here, so the WCAG 2.2 AA chrome row and the no-magic-values painter guard are NOT triggered by P5 (this phase adds no window, control, or painter; it ships a resolver, an applier, and CSS token wiring). State that boundary explicitly in the final response.
Review dispatch (state.md Review Dispatch Matrix): `qa-checklist` only. Nothing touches server/net/admin/sim/world_api, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire (the gfx.ts edit is a one-line constant import, not an IWorld/wire/dispatch change). Prompt the reviewer for COVERAGE (every correctness/requirement gap with confidence + severity), not filtering. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE: 2 to 4 Conventional Commits with scope and EXPLICIT paths. Examples:
- `feat(game): add ui_effects_profile resolver + define EFFECTS_QUALITY_LOW_CUTOFF` -- src/game/ui_effects_profile.ts, tests/ui_effects_profile.test.ts, tests/architecture.test.ts (allowlist)
- `refactor(render): import EFFECTS_QUALITY_LOW_CUTOFF in gfx.ts` -- src/render/gfx.ts
- `feat(ui): apply data-fx-level + --fx-* tokens (debounced, diff-guarded, OS reduced-motion)` -- the applier module + its wiring + src/main.ts (reduce-motion reconcile + em-dash normalize)
- `style(css): consume --fx-* in glass/glow/fct-crit/vignette rules` -- src/styles/hud.css, src/styles/components.css
- `docs(frontend): record P5 in progress.md + state.md ledger` -- docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md

STEP 5 - ACCEPTANCE CRITERIA (every item verifiable and green):
- [ ] `src/game/ui_effects_profile.ts` exists as a pure module at that path (src/game, NOT src/ui): exports `EFFECTS_QUALITY_LOW_CUTOFF = 0.5`, `UiEffectsProfile` (5 axes: tier / motion / heavyShadows / ambientAnim / allowFctCrit), `resolveUiEffectsProfile`, `uiEffectsTokens` (with the 0.001-not-0 motion-scale floor), `uiEffectsProfilesEqual`, and `uiEffectsAllowFctCrit`. No DOM, no Three, no Math.random/Date.now/performance.now; registered in the P0 UI_PURE_CORES allowlist; tests/architecture.test.ts passes.
- [ ] `src/render/gfx.ts:308` imports `EFFECTS_QUALITY_LOW_CUTOFF` from `src/game/ui_effects_profile.ts` and uses it in place of the bare `0.5` in the PRESET_ADVANCED effectsQuality gate; the sibling terrainDetail/foliageDensity/shadowQuality 0.5 literals are untouched; this is a render -> game leaf import (render never imports ui).
- [ ] `tests/ui_effects_profile.test.ts` covers ALL 5 preset labels x reduce-motion x effectsQuality, INCLUDING the advanced-honors-effectsQuality decision (advanced is NOT collapsed to high; advanced drops to a distinct lower tier below EFFECTS_QUALITY_LOW_CUTOFF), the reduceMotion-forces-motion-off behavior, the 0.001-not-0 motion-scale floor in uiEffectsTokens, `uiEffectsProfilesEqual` true/false cases, and a same-input-same-output (determinism) assertion.
- [ ] The resolver provably reads the static preset and NOT the governor: an import-absence assertion proves it does not import or read governor.state().levels, AND does not import from src/render or src/ui (so the render -> game import direction holds).
- [ ] The dumb applier sets data-fx-level (= profile.tier) + every --fx-* token; it mirrors theme.ts's runtime custom-prop write; data-fx-level and --fx-* carry NO t() (internal). The applier diff-guards on uiEffectsProfilesEqual (a no-op never re-stamps data-fx-level) and debounces the effectsQuality apply ~180ms.
- [ ] reduce-motion is a single source of truth: the OS prefers-reduced-motion matchMedia channel + change listener AND the settings('reduceMotion') boolean both feed the resolver input; the existing body.reduce-motion toggle (main.ts:1235-1236) stays only as the CSS hook; they do not fight and there is no second motion flag.
- [ ] The extracted CSS (glass/glow/FCT-crit/vignette in src/styles/hud.css + components.css) consumes var(--fx-*); JS-written custom props remain :root defaults; backdrop-filter stays -webkit-first; the paused-vignette special case is preserved; the P0 screenshot baseline diff shows no unintended cascade change.
- [ ] The pre-existing em dash at src/main.ts:1234 is normalized to a comma/period in the same hunk.
- [ ] `npx tsc --noEmit` clean; `npx vitest run tests/ui_effects_profile.test.ts` + `tests/architecture.test.ts` + `tests/css_corpus.test.ts` + `tests/client_shell.test.ts` green; `npm run build` (all 4 entries) green; `biome check` clean on the touched .ts and .css.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] The `ui` gfx bucket is still governable:false (GFX_BUCKET_BANDS untouched); no sim/server/net/IWorld change.

STEP 6 - DOC UPDATES + MEMORY: update progress.md (mark P5 done with the files added) and state.md (set P5 status in the ledger; list src/game/ui_effects_profile.ts + the applier as new modules and the gfx.ts import refactor; record that EFFECTS_QUALITY_LOW_CUTOFF is now DEFINED in src/game/ui_effects_profile.ts and imported by gfx.ts:308; note the advanced-honors-effectsQuality decision and the OS-matchMedia + 180ms-debounce + diff-guard are now realized in code). Record any surprising rule in memory (e.g. the exact advanced collapse boundary, the 0.001-not-0 motion-scale floor, the reduce-motion single-source reconcile across OS matchMedia + setting + body class, the paused-vignette special case if it bit, the render -> game leaf-import direction that forced the resolver into src/game).

STEP 7 - FINAL RESPONSE: status, files changed, validation results (tsc, the vitest runs, build x4, biome on .ts and .css, screenshot-diff), the explicit statement that no WCAG/no-magic-values/perf rows apply (no window, control, painter, or per-frame work this phase), reviewer verdict, any deferrals (e.g. tier knobs left for P14a/P14b that consume profile.tier + uiEffectsAllowFctCrit), and end with: Next: phase-06-painterhost-seam-pilot.md

STOPPING RULES:
- STOP if the resolver cannot derive the profile without reading the governor (you would be forced to import governor state): that is a design break, surface it.
- STOP if placing the resolver in src/game and importing EFFECTS_QUALITY_LOW_CUTOFF into gfx.ts trips the architecture purity guard or creates a render -> ui edge (it must not): surface it rather than moving the module into src/ui or src/render.
- STOP if a CSS rule cannot be converted to a `var(--fx-*)` read without changing the cascade or default appearance (css_corpus or the visual diff regresses): leave it hardcoded and report it rather than altering the cascade.
- STOP and surface as a SCOPE CHANGE if the phase finds it needs to extend IWorld or touch src/sim / server / src/net.
- STOP if the reduce-motion reconcile would require a second motion flag or contradicts the existing body.reduce-motion CSS hook, or if the OS matchMedia channel and the setting cannot be unified into one resolver input.
```

## Notes for the planner

P5 is small and surgical on purpose: it ships only the resolver, the one-line `gfx.ts` constant
import, the dumb applier, and the CSS token wiring, deliberately leaving every cost knob (FCT
concurrency, minimap cadence, aura count, frame cadence, nameplates) to P14a/P14b which consume this
profile's `tier` and `uiEffectsAllowFctCrit`. The deep review caught two BLOCKING spec errors in the
original draft: (1) it said to import `EFFECTS_QUALITY_LOW_CUTOFF` from `gfx.ts`, but that constant
does not exist in V16 (`gfx.ts:308` is a bare `0.5`), so the resolver must DEFINE it and `gfx.ts` must
import it; (2) because `gfx.ts` (render) then depends on the resolver, the module cannot live in
`src/ui/` (render must never import ui), so it moves to `src/game/` as a render-importable leaf. The
draft's `{fxLevel, tokens}` shorthand was also a regression from FB's proven 5-axis `UiEffectsProfile`
contract; the full contract (`tier`/`motion`/`heavyShadows`/`ambientAnim`/`allowFctCrit` +
`uiEffectsTokens` with the 0.001 motion-scale floor + `uiEffectsProfilesEqual` + `uiEffectsAllowFctCrit`)
is restored so P11/P13/P14 reuse it with no core change. The single load-bearing risk remains the
two-controller hazard (top-risk 5): the import-absence assertion (no governor, no render/ui import) is
the heart of the acceptance. The applier additions (OS `prefers-reduced-motion` matchMedia channel +
change listener unified with the `reduceMotion` setting and the existing `body.reduce-motion` CSS hook,
the 180ms `effectsQuality` debounce, and the `uiEffectsProfilesEqual` diff-guard) come straight from
FB and are what keep a no-op from re-stamping `data-fx-level`. It carries no perf gate, no WCAG chrome
row, and no no-magic-values painter guard because nothing here runs per frame and no window, control,
or painter is added; the em dash at `main.ts:1234` is normalized in the same hunk that wires the
applier. It depends on P1/P2/P3 having extracted the glass/glow/FCT-crit/vignette CSS this phase points
at `--fx-*`.
