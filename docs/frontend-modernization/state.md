# Frontend Modernization v0.16.0: State (cross-phase cheat sheet)

The single reference every phase loads first. Holds locked decisions, the canonical workflow
blocks, the validation matrix, and the running ledger of what each phase adds. Update this at the
end of every phase (Step 6).

Branch: `feature/frontend-modernization-v016` (worktree `/Users/fernando/Documents/wocc-v0.16.0`),
branched off `origin/release/v0.16.0` (`e31eb05d`).
Current phase: PACKET AUTHORED + AMENDED + fidelity-reviewed + DEEP-REVIEWED-AND-RESTRUCTURED
(2026-06-24). A 23-reviewer + synthesis Workflow ground-truthed every phase against live source and
found the architecture sound and the ordering correct, but flagged: two BLOCKING spec errors (P5, P6),
a set of stale line-refs (P0/P1/P3/P4/P11/P13), the WCAG-2.2-AA + no-magic-values rows missing from the
cold-window and per-frame phases, and several cross-cutting gaps (ClientWorld-vs-Sim painter parity, a
responsive rendered-layout gate, the write-elision writer coverage gap, admin/guide CSS scope,
`user-scalable=no`). To retire the 40% context risk up front (user directive: "rather take longer and
get it perfect than degrade by context usage"), the 18-phase packet was RESTRUCTURED into 30 phases via
sub-letter splits (see the OLD->NEW map below). No product code has moved. P0 (foundation gates) is
DONE 2026-06-24: the css_corpus + UI-purity guards landed (tests/css_corpus.test.ts,
tests/architecture.test.ts) and the three non-regression floors are recorded
(perf-/visual-/mobile-baseline-v016.md). Surfaced for later phases: perf_tour's mobile profile cannot
boot (portrait viewport + undismissed #mobile-preflight, landscape-only d16a) so mobile perf is deferred
to P17a; mobile_button_size + mobile_joystick_size are RED (pre-existing preflight-dismissal gap) and only
2 of 6 mobile E2E scripts truly assert, all for P4b. NEXT: phase-01-css-lightning-tokens-base.md.

## Provenance (read these once for the why)

This packet is a RESTART of the completed `feature/frontend-modernization` (FB) refactor onto the
much larger `release/v0.16.0`. The decision and its evidence:
- `feasibility-v0.16.0.md`: why we restart (Option B) instead of merging FB forward.
- `v016-restart-direction.md`: the expanded scope (per-frame extraction + per-element perf) and the
  process learnings (smaller phases for the 40% rule; perf-gated acceptance for hot-path work).
- `v016-recon-and-packet.md`: the deep line-number RECON of v0.16.0's frontend. It is the
  line-number source, NOT the authoritative plan: its 16-phase table is SUPERSEDED by the 30-phase
  ledger in THIS file wherever they differ. The phase files elaborate THIS state.md.

FB itself is a read-only SOURCE: ~70% of its artifacts port forward file-for-file (build config,
`src/styles/*.css` shape, the cold-window cores/painters V16 lacks, the pure cores, the guards).
"Restart" = re-run the extraction on the bigger base, reusing FB's files where they fit; it is NOT a
retype-from-scratch. CAUTION (from the deep review): several phase docs were written against FB source
and not fully re-grounded on V16, which is the root of the stale-ref cluster below; trust LIVE source
over an FB carryover whenever they disagree.

---

## OLD -> NEW phase map (the 18 -> 30 restructure, 2026-06-24)

Sub-letter suffixes only; kept-whole phases keep their id 1:1. Splits exist because each half plus its
mandatory QA pass plus in-session remediation of findings exceeds the ~40% Opus-degradation ceiling.

| Old id | New id(s) | Why split |
|---|---|---|
| P0 | P0 | kept whole |
| P1 | P1 | kept whole |
| P2 | P2 | kept whole |
| P3 | P3 | kept whole |
| P4 | P4a (shell) + P4b (mobile + per-entry .extra) | largest single CSS move + two-entry diff; mobile gotchas are a distinct risk set |
| P5 | P5 | kept whole (correctness rewrite, not a budget split) |
| P6 | P6 | kept whole (correctness rewrite, not a budget split) |
| P7 | P7a (talents) + P7b (social + bags) | talents is an interactive mutable-buffer window; +WCAG/+no-magic/+QA pushes the trio over 40% |
| P8 | P8a (options) + P8b (market + char) | options is ~1180 lines / 9 sub-panels; char carries a Three.js preview + a skin-event Math.random |
| P9 | P9a (canvas: map + arena) + P9b (DOM: questlog + spellbook + leaderboard) | canvas painters collide with no-magic-values; the async leaderboard is its own state machine |
| P10 | P10a (xp + swing leak-fix + the PainterHost elided-writer extension) + P10b (unit_frame FAMILY) | the load-bearing family + first perf gate + a11y + the writer extension is the full novelty load |
| P11 | P11a (cast bars) + P11b (target frame) + P11c (party keyed pool) | 2 BLOCKING core-design decisions serialize the slices; the party pool is a high-churn rewrite |
| P12 | P12a (action bar + the allocation-budget spike) + P12b (auras + minimap) | 3 named top-risks + the unresolved alloc spike + a heavy canvas no-magic-values surface |
| P13 | P13a (FCT core + driver wiring) + P13b (FCT pooled painter + migration + perf gate) | net-new infra; split at the unwired-painter boundary |
| P14 | P14a (per-element tier knobs) + P14b (nameplate_view extraction) | the nameplate extraction is a real Three/DOM-entangled extraction, not a thin add-on |
| P15 | P15a (shared a11y infra) + P15b (chrome-wide audit + axe/keyboard tooling) | 5 infra slices + 5 audit-and-FIX slices across ~17 windows + the tooling slice |
| P16 | P16 | kept whole |
| P17 | P17a (harness floor, test-only) + P17b (bundle + lazy-load + cross-engine + close) | the only behavior-affecting source change + 3 new CI gates + the first all-together perf run |

Execution order (the linear "Next:" chain): P0, P1, P2, P3, P4a, P4b, P5, P6, P7a, P7b, P8a, P8b, P9a,
P9b, P10a, P10b, P11a, P11b, P11c, P12a, P12b, P13a, P13b, P14a, P14b, P15a, P15b, P16, P17a, P17b, then
the packet's final QA.

---

## Locked decisions (record once, never re-litigate)

1. Vanilla HTML/CSS/TS. No Svelte/React/Tailwind/Lit/signals. One build-time dependency added:
   Lightning CSS (devDependency). The per-frame HUD stays framework-free.
2. This packet supersedes the FB packet for v0.16.0. It is the only frontend plan going forward.
3. The per-frame HUD stays framework-free with a hard perf gate; imperative DOM writes go through
   the existing write-elision cache (`hotWriteCache` + `setText`/`setDisplay`/`setTransform`/
   `setWidth`, `hud.ts:1322-1372`) reading `IWorld`. No reactivity, no Shadow DOM, no signals.
4. HUD cold-window extraction is PRESENTATION-ONLY: consume V16's already-extended `IWorld`; the
   only signature consumed that changed is `leaderboard(): Promise<LeaderboardPage>` (one painter,
   P9b). Do not extend `IWorld` or touch `src/sim`/`server`/`src/net`/`headless`. If a phase finds
   it needs to, STOP and surface it (scope change).
5. Per-frame extraction uses the same Humble Object pattern (pure core from `IWorld` + thin painter)
   but HOT path: the pure core is allocation-light (no per-frame garbage); the painter preserves
   write-elision (DOM write only on change, routed through the host's elided writers); every
   per-frame phase carries a frame-budget perf gate, not just tsc + tests.
   - 5a WRITE-ELISION WRITER COVERAGE (added by the deep review). The four existing elided writers
     (`setText`/`setDisplay`/`setTransform`/`setWidth`) cache one string per element and CANNOT
     express `setProperty('--var', v)`, `classList.toggle`, or `style.color` writes that the hot
     paths need (xp `--xp-fill`, `.rested`, target `style.color`, elite/channel/party class toggles).
     P6 exposes the four existing writers as the write-elision facet; P10a EXTENDS the facet with
     elided `setStyleProp(el, prop, val)` + `toggleClass(el, cls, on)` keyed per `(element, prop)`.
     Until that lands, the "all writes elided" rule and the "no raw style/textContent on the hot path"
     routing test are mutually unsatisfiable, so the routing test asserts only the writers that exist
     and documents any allowed raw write.
6. Graphics-tier UI is driven from the STATIC preset (`graphicsPresetLabel`), NEVER the FPS
   governor (two-controller hazard; the `ui` gfx bucket stays `governable:false`). `data-fx-level`
   + `--fx-*` are INTERNAL (no `t()`). The resolver module lives in `src/game/` (a render-importable
   leaf), NOT `src/ui/`, because `src/render/gfx.ts` imports the shared `EFFECTS_QUALITY_LOW_CUTOFF`
   from it and render must not import `ui` (see decision 8 and the P5 fix).
7. Encapsulation is a CSS problem: `@layer` + `#id`-prefix isolation (the `@scope` future-layer is
   deferred on the browser floor, as in FB). `src/styles/shell.css` is NEW in V16 (FB had no single
   `shell.css`; its shell rules were distributed); it gets a layer assignment in P1, not a port of a
   non-existent FB file.
8. The design decisions settled as defaults (revisit only at the named phase):
   - 'advanced' graphics preset -> HUD fx: HONOR its `effectsQuality` slider for a distinct HUD-fx
     level (not collapse to 'high'), so the expert path sheds HUD cost independently. (P5)
   - ui_effects_profile API is the FULL 5-axis FB contract (`tier` / `motion` / `heavyShadows` /
     `ambientAnim` / `allowFctCrit`) + `uiEffectsTokens` (with the 0.001-not-0 motion-scale floor) +
     `uiEffectsProfilesEqual` + `uiEffectsAllowFctCrit`, NOT the `{fxLevel, tokens}` shorthand. The
     resolver DEFINES `EFFECTS_QUALITY_LOW_CUTOFF = 0.5` and `gfx.ts:308` is refactored to import it
     (the constant does NOT exist in V16 today; `gfx.ts:308` is a bare `0.5`). (P5)
   - The resolver also reads `reducedMotion = OS matchMedia('(prefers-reduced-motion)') OR
     settings('reduceMotion')` with a change listener, debounces the `effectsQuality` apply ~180ms,
     and gates the apply on `uiEffectsProfilesEqual` so a no-op never re-stamps `data-fx-level`. (P5)
   - PainterHost: a THIN shared host the already-tested bespoke windows COMPOSE into, factored into
     TWO facets: a presentation dep-bag (icon/money/tooltip) for cold windows, and a write-elision
     facet (the four `private` Hud writers bound as closures, per the vendor template, no visibility
     change) for hot painters. The delve pilot proves the core-to-painter split + dep-bag, NOT the
     DOM write path (it is Canvas-2D); a tiny unit test exercises the elided writers against a fake
     cache. (P6)
   - FCT per-frame driver: fold into `hud.update()` so the existing `hud` perf bucket covers it,
     not a second rAF. (P13a)
   - Every tier knob reads the static preset, never `governor.state().levels`. (P5/P14a)
9. COMPONENT CONTRACT (every extracted component). Pure view-core (DOM/Three-free, Node-tested,
   allocation-light if hot) + thin write-elided painter + INSTANCE-PARAMETERIZED for reuse and
   multiplicity (no hardcoded element ids, no single-instance assumptions). Build reusable FAMILIES,
   not bespoke per-instance modules, on the rule of three: ONE `unit_frame` core+painter reused
   across player/target/party (ready for focus/raid/boss); the action bar instance-parameterized so
   a second/third bar is `new ActionBarPainter(barDescriptor)`. Actually ADDING the extra bars or
   raid frames is a follow-on FEATURE that inherits this seam, NOT part of this refactor. The
   `unit_frame` descriptor (P10b) MUST be validated against the FULL target/party field set, not a
   token stub, so P11a/b/c reuse it with no core change.
10. ACCESSIBILITY (WCAG 2.2 AA on the HUD CHROME). Windows, buttons, forms, menus, chat, tooltips:
    semantic roles + aria, focus management (trap + return on window open/close), visible
    `:focus-visible` never animated/blurred/transitioned away, skip links, live regions for chat +
    combat text, target-size minimums (SC 2.5.8, >=24px absolute floor; prefer the existing 40x40px
    touch floor on mobile controls, do NOT weaken it). The 3D world/canvas is OUT of scope (not
    screen-readable); state the boundary honestly. A11y is built IN per window/element phase (the
    WINDOW/CONTROL validation row is MANDATORY, not deferred to P15) and consolidated + audited in
    the dedicated Accessibility phases (P15a infra, P15b audit). Also drop the `user-scalable=no` /
    `maximum-scale=1.0` viewport lock (live at `index.html:5` and `play.html:5`); it fails SC 1.4.4 /
    1.4.10, and the 16px input-font floor is the anti-zoom guard. Keep that the only contrast
    adaptation: see decision 11.
11. THEMING. ONE dark MMORPG aesthetic (theme.ts runtime `--color-*` accent theming stays). NO
    light / `prefers-color-scheme` theme. DO support `forced-colors: active` (Windows high-contrast):
    borders/focus survive, meaning is never carried by a background-image alone.
12. NO MAGIC VALUES IN PAINTERS. DOM painters drive CSS custom properties / tokens, never a literal
    hex/px/color in TS; thresholds + cadences (the 100/250/500ms frame-divider, breakpoints, the
    combat-announce cadence) are named constants. A guard enforces it. CANVAS painters
    (map/arena/minimap/delve/nameplate) cannot read CSS vars directly: they resolve the `--color-*`
    tokens via `getComputedStyle` ONCE per redraw (cached), never per-marker/per-frame, and every
    other literal is a named constant.
13. BUNDLE DISCIPLINE. A JS bundle-budget CI gate (sibling to `asset:budget`). Measure the
    cold-window cost first (the eager module graph of the play entry via build chunk metadata), then
    SELECTIVELY lazy-load (dynamic import) only the genuinely heavy + rarely-opened cold windows
    (options/market/leaderboard are candidates) while keeping frequently-opened ones (bags/char)
    eager. Each lazy window's loading state carries an a11y contract (aria-busy/role=status +
    focus-return across the async swap). Evidence-driven, never blanket splitting. (P17b)
14. BROWSER MATRIX. Big-3 desktop PLUS mobile Safari/WebKit as a first-class target (the game is
    mobile-playable); a `forced-colors` pass; a MINIMAL `@media print` reset. Cross-engine E2E incl
    WebKit is wired into CI in the close phase (P17b), closing FB's open webkit-in-CI item.
15. CLIENTWORLD-vs-SIM PAINTER PARITY (added by the deep review). Every painter consumes `IWorld`,
    which BOTH the offline `Sim` and the online `ClientWorld` mirror satisfy, but the perf harness
    exercises only the offline `Sim`. A core that assumes a Sim-only field shape or cadence (target
    cast remaining, combo pips, party out-of-range, async leaderboard/market) passes every offline
    gate and silently misrenders online. Every `*_view` core test MUST feed BOTH a Sim-shaped and a
    ClientWorld-mirror-shaped `IWorld` stub.
16. RESPONSIVE IS GATED, NOT JUST PRESERVED (added by the deep review). The CSS extraction preserves
    rules verbatim, but `css_corpus` is CSS-TEXT completeness only and cannot catch a `dvh`->`100vh`
    swap, a dropped `safe-area-inset`, or a lost `@media` breakpoint. P0 records a mobile-layout
    baseline and P4a/P4b wire the EXISTING V16 mobile E2E scripts (`mobile_input_zoom_check`,
    `mobile_button_size`, `mobile_joystick_size`, `mobile_chat_safe_area`, `mobile_minimap_safe_area`,
    `mobile_community_hud_safe_area`) as a blocking RESPONSIVE row.
    - 16a ORIENTATION: the IN-GAME view is LANDSCAPE-ONLY on web mobile, NEVER portrait. V16 already
      implements this and the extraction MUST preserve it intact: the `#rotate-device` overlay shows
      under `body.mobile-touch.game-active` + `@media (orientation: portrait)` (play.html ~4920 +
      5934-5953, index.html ~5761 + 6837-6866), backed by `requestMobileFullscreenLandscape()`
      (`screen.orientation.lock('landscape')` + fullscreen, `main.ts:482`), the `orientationchange`
      listener (`main.ts:474`), and the `mobilePreflight.baseLandscape` "Rotate your device to
      landscape" copy. There is NO in-game portrait layout by design; portrait shows the rotate
      overlay. The PRE-GAME SHELL (start/login/char-select), the `/wiki` guide, and the admin
      dashboard stay PORTRAIT-CAPABLE / normally responsive (the overlay is gated on `game-active`).
      This is exactly why P4a (shell, portrait-OK) and P4b (in-game mobile, landscape-only) are split.
      HAZARD: the `#rotate-device` orientation rules DIFFER between index.html and play.html (index
      sets `display:none` under portrait in one block; play sets `display:flex`); P4b must
      preserve-both-exactly into the per-entry `.extra`, never merge them. The mobile E2E row (16)
      runs the IN-GAME profile in LANDSCAPE, and adds a portrait-in-game assertion that `#rotate-device`
      is shown (not a broken portrait HUD); the shell profile is tested in both orientations.
17. PERSISTENT-MONOLITH OUTCOME (owned, not a defect). `hud.ts` stays the per-frame wiring hub and
    cold-window dispatcher after the packet; the win is that every behavior now lives in a tested
    core + thin painter that `hud.ts` composes, not that `hud.ts` shrinks to nothing. Reviewers
    should not expect the file to disappear; the line count drops as inline blocks become painter
    calls, but the seam, not the size, is the deliverable.
18. ADMIN / GUIDE CSS SCOPE (decided by the deep review). The Lightning flip (P1) becomes the
    project-wide transformer and WILL reprocess `admin.html` (a 254-line inline `<style>`) and
    `guide.html` (a 1621-line `styles.css` with backdrop-filters). This packet's EXTRACTION scope is
    the game HUD (`index.html` + `play.html`) only; `admin.html`/`guide.html` keep their current CSS
    shape. The obligation P1/P4 carry is a SURVIVAL gate (their CSS still builds and their
    `backdrop-filter`s survive minification `-webkit`-first), not an extraction. `admin`/`guide` a11y
    beyond what they ship today is out of this packet's scope; state the boundary, do not silently
    claim "both inline blocks empty" for all entries.

## Non-negotiable constraints (carry every phase)

- Determinism: pure cores stay DOM/Three-free; no `Math.random`/`Date.now`/`performance.now` in any
  registered pure core. (The FCT painter MAY use `Math.random` for jitter; the FCT CORE may not. The
  char skin-event `Math.random` at `hud.ts:9596` stays on the painter, like FCT, or is out of P8b's
  core scope.)
- Server authority untouched; do not move any outcome to the client.
- i18n: every NEW player-visible string is a `t()` key; new control labels go in
  `src/ui/i18n.catalog/hud_chrome.ts` (English-only). Never edit `i18n.locales/<lang>.ts`. The
  action-bar aria-label elision (P12a) must keep the `t()` call (no concat / `??` fallback). New
  async-failure copy (leaderboard/market) and the cast eat/drink label resolve via `t()` in the
  PAINTER (the i18n-free `src/render/cast_bar.ts` core emits a discriminator, never a `t()` call).
- No generated-file hand-edits; regenerate via the build.
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.
- No em dashes, en dashes, or emojis anywhere. NOTE the byte-for-byte CSS-move phases (P2/P3/P4):
  the no-dash rule applies to NEW text only; relocating an existing comment that already contains a
  dash is allowed, and where a moved comment's dash is gratuitous it may be normalized (comments
  only, never a selector/value).

---

## Canonical workflow (every implementation phase follows this)

EFFORT + VERIFICATION + FAN-OUT are three SEPARATE axes (decided 2026-06-24; quality is the goal,
token cost is not a constraint). Do not conflate them under the `ULTRACODE` tag:
- EFFORT: every phase runs on Opus 4.8 at `xhigh`. Reserve `max` for a genuinely stuck moment (it
  overthinks / oscillates on structured tasks); do not default to it.
- VERIFICATION: every phase, regardless of its `ULTRACODE` tag, ends with an adversarial verification
  pass (a fresh-subagent diff review prompted for COVERAGE, plus a "what is missing" critic) on top of
  the STEP 3 review-dispatch and the QA pass. This is the highest-leverage quality lever; always do it.
- GENERATION FAN-OUT (what the `ULTRACODE: yes` tag actually gates): use a Workflow to fan out parallel
  generation ONLY where the phase decomposes into independent work items (the CSS section cohorts, the
  cold-window batches, the per-frame element slices). For a single-module, sequential, or docs phase
  (P5, P6, P7a, P9a, P16, P17a, P17b), DO NOT force generation fan-out: it fragments a design that one
  mind should hold and collides on shared files. Single coherent author pass + the verification above.
  P16 in particular MUST stay single-author (parallel CLAUDE.md prose self-conflicts).
- CONTEXT HYGIENE: a Workflow SHELL (push heavy reading/editing to a subagent that returns a summary)
  is encouraged on EVERY phase to keep the orchestrator under the 40% ceiling, even when generation is
  not parallelized. This helps the budget independently of fan-out.
The per-phase `ULTRACODE` tag in each phase file marks only the GENERATION-fan-out axis; xhigh effort
and the adversarial verification pass apply to all phases either way.

- STEP 0 Pre-flight: `git status` clean (ask the user if not; concurrent session may share the
  checkout). Memory scan (MEMORY.md + the entries the phase lists). Confirm you are in the
  `feature/frontend-modernization-v016` worktree.
- STEP 1 Load context (do NOT read `hud.ts` (14,377 lines) or the HTML entries whole): spawn an
  Explore agent to read+summarize this `state.md`, the phase's `progress.md` row, the phase file,
  `v016-recon-and-packet.md` (the line numbers), and the specific source ranges the phase lists.
  The orchestrator keeps the summary, not raw dumps. THE 40% RULE: the packet is already pre-split so
  each phase fits well under ~40% context INCLUDING its mandatory QA pass plus in-session remediation
  of every BLOCKING/SHOULD-FIX/NICE-TO-HAVE finding (that remediation load is why the splits exist).
  If a phase's working set STILL approaches the ceiling, split again rather than degrade.
- STEP 2 Choose orchestration + execute: pick the lightest tool. Default to parallel Agent/Workflow
  fan-out, one slice per window/element. Use `isolation: "worktree"` only if agents edit
  overlapping files. Request fan-out EXPLICITLY.
- STEP 3 Validation + review dispatch: run the validation-matrix rows for the change type. Spawn
  review agents only for the surface the diff touches (Review Dispatch Matrix). Prompt each for
  COVERAGE not filtering; do not commit until each reports no BLOCKING. Resume a truncated reviewer
  with: "Stop reading more files. Output the full report now based on what you've already seen. No
  more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."
- STEP 4 Commit cadence: 2-5 Conventional Commits with a scope, EXPLICIT paths.
- STEP 5 Acceptance: the phase file's checklist, all items verifiable and green (incl the perf gate
  for per-frame phases). A failed perf gate BLOCKS marking the phase complete (decision 5 / risk 1).
- STEP 6 Docs + memory: update `progress.md` and this `state.md` (new files, tokens, decisions).
  Record surprising rules in memory. Per-frame phases TAG the green-perf-gate commit so a later
  cumulative regression (surfaced first at P17a) bisects to a phase, not to "relax the budget."
- STEP 7 Final response: status, files, validation results, reviewer verdict, deferrals, and the
  one-line handoff naming the next phase file (per the execution order above).

Each implementation phase is followed by a QA pass using `qa-checklist.md` (the shared QA starter:
correctness + test-coverage + dead-code agents, then the dispatch matrix, then fix BLOCKING/
SHOULD-FIX, then update docs). Never skip QA; end each phase by naming the next.

---

## Validation matrix (run the rows that match the change type)

- Baseline (every phase): `npx tsc --noEmit`.
- Pure core added/changed: `npx vitest run tests/<core>.test.ts` + `npx vitest run
  tests/architecture.test.ts` (the UI-purity guard) + a same-input-same-output assertion + the
  ClientWorld-vs-Sim parity assertion (decision 15: drive the core with BOTH a Sim-shaped and a
  ClientWorld-mirror-shaped `IWorld` stub).
- New `.ts` module added (every phase that adds a core/painter): `biome check` on the new/changed
  `.ts` (the V16 ratchet; do not let ~30 new modules accrue lint debt for the close session).
- CSS / HTML entry changed: `npx vitest run tests/css_corpus.test.ts` (the completeness guard, keyed
  on the LIVE 10-dash `/* ---------- name ---------- */` markers, over inline `<style>` UNION
  `src/styles/*.css` so coverage is conserved as P1-P4 migrate) + `npx vitest run
  tests/client_shell.test.ts` + `npm run build` (all 4 entries) + the backdrop-filter survival check
  (built CSS, `-webkit`-first; meaningful from P2 on, a no-op in P1) + `biome check` on the new `.css`
  + a screenshot-diff against the P0 visual baseline for any phase that risks a cascade change.
- RESPONSIVE / mobile changed (P4a/P4b, P15b): run the V16 mobile E2E scripts as a blocking row
  (decision 16: `mobile_input_zoom_check`, `mobile_button_size`, `mobile_joystick_size`,
  `mobile_chat_safe_area`, `mobile_minimap_safe_area`, `mobile_community_hud_safe_area`); a
  real-CDP mobile-inset check, not a CSS-text assertion.
- PER-FRAME phase (P10a-P14b): `npm run` the perf_tour harness and assert frameP95 <= the P0 baseline
  AND hudHotDomSkipRate >= the P0 baseline; for P12a/P12b, the allocation-budget assertion (the proxy
  the P12a spike settles, fallback = perf_tour frameP95 + longtasks); for P13b, the bounded-node-count
  AoE-burst assertion. A unit test that the painter routes ALL writes through the host's elided
  writers that EXIST (decision 5a; no raw `style`/`textContent`/`setAttribute` beyond a documented
  allowed write). CANVAS painters (P9a, P12b minimap, P14b nameplate) are gated on cadence + cached
  background + frameP95, NOT the elided-writer routing test (decision 12).
- WINDOW or CONTROL changed (MANDATORY on every cold-window + per-frame + chrome phase, decision 10):
  the WCAG 2.2 AA chrome checks (automated axe-core or equivalent over the built window; keyboard
  reachability + focus-return; a `forced-colors: active` snapshot; visible `:focus-visible`;
  target-size >=24px, and >=40x40 on mobile touch controls). Plus the no-magic-values painter guard
  (decision 12; DOM painters reference tokens/vars; canvas painters resolve tokens once per redraw).
  The full cross-window a11y audit (skip links, global focus management, live regions) runs in
  P15a/P15b; the PER-WINDOW roles/aria/labels/target-size are NOT deferred there.
- BUNDLE changed (P17b): the JS bundle-budget gate; for any window switched to a dynamic import, the
  initial bundle (the eager module graph of the play entry) shrinks by its measured cost and the
  window still opens (with an a11y-correct loading state) on first use.
- Player text changed: `npx vitest run tests/localization_fixes.test.ts`. New label in
  `hud_chrome.ts` (English-only) does not trip the release tier.
- Pre-merge / CI mirror: `npm run i18n:gen && npm test && npx tsc --noEmit && npm run build:env &&
  npm run build:server && npm run build`, then the i18n freshness check; on `release/**` the
  release-tier gate (`I18N_RELEASE_TIER=1`) pending=0; and `biome ci --changed` (the forward
  ratchet that lints the new files).

## Review Dispatch Matrix (spawn ONLY the rows the diff touches)

- `privacy-security-review`: only if the diff touches `server/`, `src/admin/`, `src/net/`, a
  deploy/secret file, or introduces SQL/auth/secret/new `Math.random`|`Date.now`|`performance.now`
  in `src/sim/` or a pure core. Should rarely fire (presentation-only).
- `migration-safety`: only if `server/*_db.ts` DDL or `characters.state` JSONB changed. Never here.
- `cross-platform-sync`: only if `src/world_api.ts` (IWorld), `src/sim/`, `src/net/online.ts`,
  `server/game.ts` wire/dispatch, or the i18n matchers changed. Consuming the already-landed IWorld
  in a painter does NOT change it; this should not fire. (The ClientWorld-vs-Sim parity obligation,
  decision 15, is covered by the per-core parity test, not by spawning this reviewer.)
- `qa-checklist`: every phase that completes a deliverable set (the default reviewer).

If no row matches (docs/test-only), spawn no review agent.

---

## Phase ledger (30 phases; fill in as phases complete)

Full per-phase scope/acceptance is in the `phase-NN-*.md` files; line numbers in
`v016-recon-and-packet.md` (the recon, superseded where it differs from this ledger).

| Phase | Title | Risk | Kind | Status |
|---|---|---|---|---|
| P0 | Foundation gates: CSS-corpus + UI-purity guard + perf/visual/mobile baseline | low | port+extend | done (tests/css_corpus.test.ts + tests/architecture.test.ts UI_PURE_CORES/RENDER_PURE_CORES; baselines perf-/visual-/mobile-baseline-v016.md; mobile perf + 2 mobile E2E scripts surfaced for P17a/P4b) |
| P1 | CSS A: Lightning flip + tokens + base + the CSS-import seam | low | port | done (Lightning flip via browserslistToTargets + zero-dep .browserslistrc parser, no browserslist npm dep; dead css.postcss removed; src/styles/{index,tokens,base}.css; one @layer order declared in index.css, imported once from src/main.ts -> both game entries; --range-fill stays the slider inline fallback; play.html 3 cursor url()s absolutized to survive the flip; biome src/styles override; 3 commits b9fe99b2/0a120e9f/0892c250; tsc + vitest 3906 + build x4 green; qa-checklist no BLOCKING) |
| P2 | CSS B1: in-world HUD chrome (full section map incl Fiesta HUD + tooltip) | medium | port | done (NEW src/styles/hud.css under @layer components, barrel @imports it after tokens+base; runs A+B + tooltip + FCT + Interface/adaptive/perf + Fiesta + center/vignette/death; Fiesta+tooltip ORPHANS CLOSED, tooltip upgraded to a 10-dash marker -> css_corpus 48 index/46 play. CASCADE fixes for the unlayered-beats-@layer intermediate hazard: UI-chrome-icons (.ui-icon/.x-btn .ui-icon/.micro-btn .ui-icon/.pfm-crest) moved to base.css @layer base, closing the P1 base-tier gap so #mm-music .ui-icon component-override wins; and 5 .btn.fiesta-practice/.arena-bracket*.fiesta glue rules DEFERRED inline to P3 with their unlayered .btn/.arena-bracket bases. backdrop -webkit-first on the 2 real rules + PORTED scripts/check_backdrop_survival.mjs build gate (P0 gap, first phase with teeth) + 12-case test. Lossless token-multiset proof; css_corpus/client_shell/backdrop + tsc + full vitest 3931 + build x4 + survival(both twins) + biome + live HUD screenshot all green; commits local) |
| P3 | CSS B2: modal + feature windows (arena/market/options/theme/emote ranges fixed) | medium | port | done (NEW src/styles/layout.css `@layer layout` = the `.window` shell only; NEW src/styles/components.css `@layer components` = all feature-window bodies in source order: delve, lockpick, windows lead chrome (quest dialog/.btn/loot/item-quality), character window, spellbook, quest log, leaderboard, talents, modals and dropdown, vendor, bags, social, map, arena, market, options, theme picker, emote, + the 5 deferred Fiesta glue rules now beside their .btn/.arena-bracket bases. Barrel imports both, order tokens,base,layout,hud,components -> components.css last so window bodies win ties over hud.css (both `@layer components`); both load via the one src/main.ts barrel so index.html AND play.html get them. index.html inline emptied 187-1158; play.html inline windows untouched (P4b reconciles; its unlayered inline still wins, zero visual change). CASCADE safe: only other bare `.window` is hud.css `.panel,.window{opacity}` (disjoint), `body.frosted-panels .window` + base.css `.window .panel-title`/`.window.window-dragging`/`#start-screen :is(.btn,...)` are more specific; no equal-specificity tie flip. NO backdrop in P3 content. css_corpus split the coarse "windows" banner into per-window banners +11 (window shell/character window/spellbook/quest log/leaderboard/talents/modals and dropdown/vendor/bags/social/map) -> 59 index/57 play. 6 moved-comment em dashes normalized. 3 tests repointed (client_shell, mobile_window_transform via inline-UNION-modules, social_status_dots). Lossless: 625 rules identical (biome cosmetics absorbed). tsc + css_corpus + client_shell + full vitest 3931 + build x4 + survival + biome(new .css) all green; adversarial 4-lens review no BLOCKING; commits local) |
| P4a | CSS C-1: pre-game shell + char-select -> shell.css | medium | port | done (NEW `src/styles/shell.css` `@layer shell`, barrel `@import`s it after components.css, @layer order UNCHANGED. Moved 12 of 19 inline banners verbatim: start screen, loading, play console, Skin picker `.skin-*` rows, login form, animated + cinematic backdrops, controls drawer, Clean up styles char-select rows, class details panel, unified char-select layout (whole, incl its 860 block + interspersed body.mobile-touch shell rules), skin-select overlay. DISCOVERY: index.html NOT cleanly partitioned after P2/P3 - chat/party frames/context menu/prompts/trade window/elite target frame + `#tf-debuffs` + paperdoll `.equip-slot` + `#bags.drop-target` are P2/P3 chrome NEVER extracted (absent from src/styles); HELD inline + SURFACED as a P2/P3 cleanup follow-up; the two grab-bag banners (Skin picker, Clean up styles) SPLIT so char-select/shell rows moved (base+override together), only genuine chrome held. CASCADE: whole-section moves into @layer shell, source order preserved; held mobile-touch SECTION + chrome cluster stay inline-unlayered. ONE flip caught+fixed: `#hero-view #login/realm-panel{margin-top:10px}` (2,0,0) in @layer shell lost to held `body.mobile-touch[data-start-panel] #X-panel{margin-top:0}` (1,2,1 unlayered, dead in original) -> relocated that held rule into @layer shell so #hero-view wins (10px preserved). Backdrop -webkit-first: 3 std-first pairs reordered, survival 11 twins. css_corpus NO change (all 59 banners present: 12 in shell.css, 7 inline). 2 tests repointed (client_shell + charselect_sort_parity -> shellCss). Key file paths: src/styles/shell.css NOW EXISTS and carries the desktop shell sections; the inline `<style>` blocks are NOT yet empty (P4b finishes that) - index.html still holds the chrome cluster + #tf-debuffs + paperdoll/bags + the mobile-touch SECTION; play.html untouched. P4b NOTE: 2 bare HUD rules (#community-hud/#quest-tracker) rode along in the char-select 860 block (cascade-neutral, re-home then). Lossless 4526 pairs identical + puppeteer computed-style diff 0 across 6 states. tsc + css_corpus + client_shell + charselect_sort_parity + full vitest 3931 + build x4 + survival + biome(shell.css) all green; adversarial coverage Workflow (cascade/lossless/classification/qa + synthesis) 1 BLOCKING = the margin-top flip now fixed+verified, all else cleared; commits local) |
| P4b | CSS C-2: mobile-touch -> hud.mobile.css + per-entry .extra; empty both inline blocks | medium | port | done (CSS extraction P1->P4b COMPLETE: both inline `<style>` blocks EMPTY, all game CSS under one flat @layer order. NEW src/styles/hud.mobile.css (@layer hud-mobile) = the in-game mobile-touch block. Folded in the P4a-surfaced orphan cleanup: chrome (chat/party frames/context menu/prompts/trade window/elite target frame + #tf-debuffs) -> hud.css; paperdoll + #bags.drop-target -> components.css; pre-start #ui hide -> base.css; re-homed #community-hud/#quest-tracker from shell.css's 860 block -> hud.mobile.css. RECONCILE (Fernando "do what is best for the project"): play.html was PURE stale drift of index (237 rules missing/41 drifted/0 intentional), so instead of preserve-both-exactly it was reconciled to the canonical modules (empty inline -> falls back to the shared barrel both entries load via src/main.ts). Only per-entry diff preserved = #rotate-device orientation gate (decision 16a): NEW src/styles/index.extra.css (@layer index-extra, suppress in-game) + play.extra.css (@layer play-extra, show in portrait), each via a per-entry `<link>`; so the .extra files are TINY (just #rotate-device), not the ~976/~60 recon estimate. LAYER-NAME BUG fixed: dotted `hud.mobile`/`index.extra`/`play.extra` are SUBLAYERS (hud.mobile = mobile under early hud -> lost to shell); renamed FLAT hud-mobile/index-extra/play-extra, ordered tokens,base,layout,components,hud,shell,hud-mobile,index-extra,play-extra (hud-mobile AFTER shell). Lossless multiset (index OLD==NEW; play differs only by #rotate-device) + negative-control-validated computed-style diff = 0 real flips on index (caught+fixed the mobile mode-select/play-console/btn-play flip). tsc + full vitest 3931 pass/8 skip + build x4 + survival(11 twins) + biome(3 new files) green. Mobile E2E (index): input_zoom 28/0, minimap/community/chat safe-area pass; button_size/joystick_size pre-existing RED (stale #offline-select entry-flow harness, screenshot-only/no assertions, not P4b). 6 tests updated (client_shell 41/41, charselect, styles_extraction, + the NEW per_entry_css_wiring.test.ts guarding the per-entry `<link>` + #rotate-device gate; the "3931 / 5 tests" above predates that final commit, true count 3938). RE-AUDIT 2026-06-24 (ultracode): all gates re-green (tsc; full vitest 3939 pass/8 skip after hardening, 377 files; build x4 + survival 11 twins; biome) + mobile E2E row (input_zoom 28/0, chat/minimap/community-hud real-CDP safe-area pass); 6-finder adversarial Workflow + independent selector-set diff re-confirmed the RECONCILE LOSSLESS (2034/2034 play selectors present, 0 unique dropped) and the #rotate-device split cascade-safe. Verdict PASS-WITH-FIXES (0 BLOCKING); fixed: index.html dotted-`hud.mobile` comment trap, hardened styles_extraction barrel @import-completeness+order guard (teeth-proven, closes silent-un-styling), extended the dotted-name guard to both .extra files, tightened the barrel header. Follow-ups: FIXED shell.css .se-preview-hint invalid `color: var(--color-text-muted) b0` -> `color-mix(... 69% ...)` + NEW tests/css_value_validity.test.ts bug-class guard (commit c7fd1364, full vitest now 3949/8 across 378 files); FIXED the cross-cutting mobile harness entry-flow drift (commit d8318b5e): NEW scripts/enter_offline_game.mjs canonical entry (in-page #btn-offline click + name/class/start, dismiss mobile preflight, wait for window.__game boot) routed through all 23 mobile_* scripts; 21/23 fully pass, touch_opacity exits 1 only on the environmental 502 (no local server), joystick_deadzone has a separate pre-existing settings-nav issue. commits local) |
| P5 | ui_effects_profile resolver (src/game, 5-axis, defines the cutoff) + applier | medium | port+extend | done (NEW src/game/ui_effects_profile.ts pure leaf DEFINES EFFECTS_QUALITY_LOW_CUTOFF=0.5 + the full 5-axis FB contract: resolveUiEffectsProfile({presetLabel,effectsQuality,reduceMotion}) / uiEffectsTokens flat --fx-* Record / uiEffectsProfilesEqual / uiEffectsAllowFctCrit(string); imports NOTHING. gfx.ts:308 now imports the constant (render->game leaf; the bare 0.5 replaced, sibling terrainDetail/foliageDensity/shadowQuality 0.5s left). NEW src/ui/ui_effects_applier.ts host: prefers-reduced-motion matchMedia channel + 180ms effectsQuality debounce + uiEffectsProfilesEqual diff-guard, stamps data-fx-level (=tier, internal, no t()) + the --fx-* tokens on documentElement, mirrors theme.ts. main.ts constructs it after applyTheme(), applyNow() at boot, routes reduceMotion(immediate)+graphicsPreset(immediate)+effectsQuality(debounced); reduce-motion is single-source = OS matchMedia OR settings('reduceMotion'), body.reduce-motion stays only the CSS hook (no second flag), em dash at the reduceMotion comment normalized. Registered in UI_PURE_CORES (forbiddenUiCoreImport fits the zero-import leaf) + an import-absence test pins no-governor/no-render/no-ui (two-controller hazard); GFX_BUCKET_BANDS `ui` band still governable:false (untouched). advanced HONORS effectsQuality -> distinct LOW tier below the cutoff (NOT collapsed to high). CSS (tokens.css :root full-Ultra seeds + B1 glass low whole-rule drop; hud.css B2 ambient play-state+motion-scale x5, vignette full-tint hold on reduce-motion + low axes, B4 glow calc x4, B6 fct-crit->fct-rise low gate, all -webkit-first/inert at default). DECISIONS: object resolver input + flat token map (theme.ts-style) adapt FB's positional/structured shapes; uiEffectsAllowFctCrit keeps FB's STRING (dataset.fxLevel) signature, not (profile), since P14 reads the published attribute; B6 is a minimal data-fx-level CSS gate (FB did B6 in JS; the per-element uiEffectsAllowFctCrit JS consumption is P14a/b). Validation: tsc; full vitest 3977 pass/8 skip; css_corpus+client_shell+css_value_validity+architecture+resolver green; build x4 + backdrop survival 12 twins; biome clean on the 3 new files (gfx.ts/main.ts/hud.css carry only pre-existing grandfathered biome debt, 0 new); built-bundle computed-style proof: default=byte-identical, low sheds every bucket, reduce-motion vignette holds full tint while ultra keeps glass+glow. NEW tests/ui_effects_wiring.test.ts pins the load-bearing CSS rules + applier/main.ts wiring (folded from QA, since the computed-style proof is a gitignored tmp script). No WCAG/no-magic/perf rows (no window/control/painter/per-frame). qa-checklist 0 BLOCKING / 3 SHOULD-FIX (doc+test-hardening, folded) / 3 NICE-TO-HAVE. commits local) |
| P6 | PainterHost (two facets) seam + cold-window pilot | medium | port+extend | done (NEW src/ui/painter_host.ts: FACET 1 PainterHostPresentation {itemIcon,moneyHtml,itemTooltip,attachTooltip} the cold windows compose; FACET 2 PainterHostWriters + makeWriterFacet(cache,onWrite,onSkip) binding the 4 elided writers as closures over a SUPPLIED Map (key scheme byte-identical to Hud's private setText/setDisplay/setTransform/setWidth; host-agnostic, no window, Node-importable). NEW src/ui/delve_map_painter.ts (Canvas-2D pilot): pure delveDrawModel(IWorld,size,pad,names) -> {layoutId,schematic,mobs,party,player,arrow,areaLabel} (reads ONLY delveRun/entities/player/partyInfo, no DOM/i18n/color) + class DelveMapPainter with paintMinimapDelve (writes #zone-label through the facet + circular minimap) / paintWorldMapDelve (rectangular map + on-canvas title); absorbed the orphaned private drawSchematicPrimitives; resolves 6 --color-delve-* tokens via getComputedStyle ONCE/redraw (D12, zero literal hex). src/ui/delve_map.ts now EXPORTS delveLocalToCanvas (the former private toCanvas) so the painter's marker math is the core's, not a duplicate (kills the painter's 23/46 magic numbers). ONLY vendor composes FACET 1 (VendorWindowDeps extends PainterHostPresentation, Hud builds presentationBag once + the call site spreads ...presentationBag); lockpick (callbacks getState/tierName/onEngage/... + its own getElementById) and raid_lockout_view (pure HTML-string builder raidLockoutPanelHtml) have nothing to compose -> UNTOUCHED (D8; the FB-carryover "3 windows onto a unified bag" was wrong). hud.ts: writerFacet+delvePainter+presentationBag fields by the portraits field; both delve branches -> painter calls; overworld #zone-label now this.setText (so all #zone-label writes share hotWriteCache = coherent skip-rate); deleted the 4 bg-cache fields + drawSchematicPrimitives + dead delve_map/DELVE_MODULE_LAYOUTS imports (-211 net lines). DISCOVERY (recon/phase-file were WRONG): the world-map delve site is NOT "static schematic only" -- BOTH sites paint mobs+party+arrow and differ ONLY by size(162 vs canvas.width)/pad(8 vs round(S*0.06))/circular-clip(minimap)/marker-size(3 vs 4)/disc-radius(4 vs 5)/lw(1.5 vs 2)/label-sink(#zone-label DOM vs on-canvas title); both preserved via the two parameterized entry points. Validation: tsc clean; biome clean on every new/changed .ts (vendor_window bounded pass: import sort + 2 concat->template, behavior-identical; delve_map_painter has 1 grandfathered noNonNullAssertion warn-level getContext! matching icons.ts/hud.ts/player_card.ts/unit_portrait_painter.ts, non-gating); full vitest 4008 pass/8 skip (381 files); architecture purity (delve_map.ts stays a pure UI core in UI_PURE_CORES, must not + does not import the painter) + no-magic-values canvas guard + write-elision-facet fake-cache unit test (write-once-then-elide, per-element keying, type-prefix namespacing, two-facets-one-cache coherence) + Sim/ClientWorld parity (two stubs, D15) + both-sites-same-output + client_shell + S3 i18n guard green; one source-text guard repointed (#zone-label this.setText). No sim/server/net/headless/world_api touched (D4). REVIEWERS: fork adversarial render-parity PARITY HELD (0 visible deviations, line-by-line vs the deleted inline code: room/mob/aggro/dead/label/outline tokens == old hex, delveLocalToCanvas math identical, the offscreen-bg-build-order + per-member-stroke + redundant-player-skip deviations all RENDER-NEUTRAL/NON-ISSUE); qa-checklist 0 BLOCKING / 3 NICE-TO-HAVE (the getContext! warn, canvas-draw parity code-read-only since a 2D ctx isn't in the Node suite, the outline token short-hex correctly in CSS). WCAG: vendor change is compositional (byte-identical markup) so a11y preserved; the source-scan asserting focusable <button> rows + aria-labels survive composition is the axe-equivalent (no DOM/axe in the Node suite); delve Canvas is OUT of a11y scope, the #zone-label stays a real text node IN scope. commits local) |
| P7a | Cold-window: talents (interactive, mutable edit buffer) | medium | port | done (NEW src/ui/talents_view.ts: pure buildTalentsView(stage,cls,total) -> header counts + tab pips + spec list + class/spec TreeVM {per-node shape/state/disabled/left/top/chosen + arrow x1,y1,x2,y2,filled}; named consts TALENT_CELL_W=86/CELL_H=70/NODE_SIZE=46/TOP_PAD=6; gating reuses cloneAllocation+validateAllocation+dormantNodes+pointsSpent byte-for-byte; DOM/Three-free, in UI_PURE_CORES. NEW src/ui/talents_window.ts: class TalentsWindow (open/close/render + paintSpecTab/paintTree/talentTooltip/openChoicePopup/setSpec/nodeClick/nodeRemove/footerHtml/wireFooter/keyboardActivate); composes PainterHostPresentation (only attachTooltip used) + a Hud deps bag (root/getStage/setStage/playerClass/totalPoints/currentAllocation/activeLoadout/loadouts/currentBar/saveLoadout/switchLoadout/deleteLoadout/applyLoadoutBar/buildDropdown/inputDialog/confirmDialog/showError + captureFocus/restoreFocus). CRUX: the core is NOT IWorld-derived -- it takes the mutable talentStage edit buffer as an INPUT; Hud OWNS the single buffer (talentStage field) and the painter reads/replaces via getStage/setStage + mutates in place, re-derives, repaints (no second buffer). hud.ts: thin toggleTalents delegate + TalentsWindow lazy-closure field by presentationBag; removed the inline talents methods + openChoicePopup + private roleLabel + keyboardActivate + talentTab field; KEPT applyLoadoutBar; pruned dead talents imports; closeManagedWindow 'talents-window' case routes through talentsWindow.close(); net -518 (14172->13654). talent_i18n.ts EXPORTS roleLabel (shared w/ char sheet, same game.talents.role* keys). tokens.css +6 --color-talent-* (exact pre-existing hex), classAccent=--color-text-muted, signature=--gold. DECISION 12: painter has ZERO hex (var(--color-*)); SVG arrow stroke moved attr->inline style (var() needs a style decl, not an SVG presentation attr) = the one DOM-attr-shape delta, visually identical. WCAG: added focus-return (captureFocus/restoreFocus on open + ALL close paths) -- the inline had none; preserved all role/aria/tabindex/keyboard wiring byte-faithfully; live axe/forced-colors/target-size pixel snapshot deferred to manual (no DOM/axe in the Node suite, byte-faithful DOM == inline baseline) per P6/P7 precedent. em-dashes -> ASCII " - ". NEW tests/talents_view.test.ts (gating==validateAllocation + geometry + dormant + same-input-same-output + ClientWorld-vs-Sim seed parity + hasTree=false) + tests/talents_window.test.ts (no-hex/token/no-dash source guards). Validation: tsc clean; full vitest 4022/8 (383 files); architecture purity + client_shell green; biome clean on both new files; no sim/server/net/headless/world_api touched (D4); no i18n.locales edits. REVIEWERS: qa-checklist 0 BLOCKING / 1 SHOULD-FIX FOLDED (Escape close path now routes through talentsWindow.close() for buffer drop + focus-return, matching delve/quest) / 3 NICE-TO-HAVE; independent parity reviewer PARITY HELD (only the 3 intended changes + the required SVG attr->style; no correctness bug, no dangling ref, no wiring hazard). No perf gate (cold/open-on-demand). commits local) |
| P7b | Cold-window: social + bags | medium | port | done (TWO disjoint windows extracted in one ultracode slice. NEW src/ui/social_view.ts (pure core, UI_PURE_CORES): socialStructSig(tab,social,party) the full-rebuild-vs-refresh gate + socialDot + friendRows/ignoreRows/guildView(perms resolved vs viewer rank)/raidView; raidView returns canConvert AND canUnconvert -- the V16-current convert-party (raid->party unconvert) footer the older FB social port had DROPPED, restored here. NEW src/ui/bags_view.ts (pure core, UI_PURE_CORES): bagItemAction (6-way priority trade>marketSell>vendor>petFeed>quest>use, byte-faithful) + bagTooltipHintKey + bagQualityKey (item.quality??'common') + buildBagGrid(inv,lookup,filter)->{state:empty|noMatch|items,visible} REUSING applyBagFilter from bag_filter.ts (no re-derive). NEW src/ui/social_window.ts (class SocialWindow): owns tab/lastStruct/lastContent/notice/suggest state; toggle/close/selectRaidTab/refreshIfChanged/render/refreshList + the friend/guild/raid/ignore Html + footer/addRow/wireChrome + typeahead (wireSuggest/renderSuggest/moveSuggest/highlightSuggest)/resolveAndAct/notice. SocialWindowDeps is STANDALONE (no PainterHostPresentation -- social renders no item rows, uses title=/CSS dots not the floating tooltip): world()/closeOthers/hideTooltip/captureFocus/restoreFocus/showPrompt/startWhisper. CRUX (social is NOT purely cold): hud.update slow-divider calls refreshIfChanged() behind the struct/content diff-gate, so the painter uses ONE delegated click listener on .soc-body (onBodyClick, closest('[data-act],[data-whisper]')) wired once per render(); refreshList() only swaps body.innerHTML so a cadence tick re-attaches NOTHING (vs the inline wireSocialRows re-wiring per refresh = the listener-churn hazard). All dispatch branches byte-identical (unfriend/unblock/gkick/promote/demote/gtransfer/raid-move/convert-raid/convert-party + data-whisper). NEW src/ui/bags_window.ts (class BagsWindow): BagsWindowDeps EXTENDS PainterHostPresentation (icon/money/tooltip/attachTooltip) + bags surface (world/wocBalanceHtml/vendorOpen/tradeOpen/isMarketSell/pendingPetFeed/closeVendor/addItemToTrade/stageMarketSell/showError/setPendingPetFeed/resetPetBarSig/isHotbarItemId/setDragAction/clearActionDropTargets/cancelPetFeed/renderCharIfOpen); render/buildFilterBar/fillGrid(buildBagGrid switch)/refreshGrid(search, keeps focus)/sellBagItem/showDiscardItemPrompt/showSellQuantityPrompt/writeDraggedAction. OWNS the bag-filter state moved off hud (same localStorage key woc_bag_filter, same parse/serialize); .bag-grid scroll-offset captured+reapplied in render() AND refreshGrid(). hud.ts -889 (13654->12765): socialWindow+bagsWindow lazy-closure deps fields by talentsWindow (bags spreads ...presentationBag, social standalone); toggleSocial->socialWindow.toggle, renderBags->bagsWindow.render thin delegators; cadence site (slowHud)->socialWindow.refreshIfChanged(); chat convert-raid/party->sim.convert*()+socialWindow.selectRaidTab(); closeManagedWindow social->socialWindow.close(); deleted ~900 lines inline social+bags methods + the social state fields + bagFilter field + BAG_*_LABEL_KEYS maps + bag_filter import, via an ANCHORED ASSERTED string-splice (mustContain/mustNotContain guards, not sed -- avoids the FB sed-clip neighbour-swallow hazard); startWhisper KEPT in hud (used by chat ctx menu). D12 no-magic: bags qColor '#fff' fallback -> var(--color-quality-default) (tokens.css, exact prior value), QUALITY_COLOR map unchanged; social 500ms = the named shared slow-HUD divider in hud.update (NOT in the painter); typeahead 160/150 named consts. WCAG: social adds capture/restoreFocus on toggle/X/closeManagedWindow close paths (the inline had none; routes through the same Hud helpers as delve/talents); rows/cells stay focusable <button>s w/ aria-labels; live axe/forced-colors/target-size deferred to manual per P6/P7a (CSS lives in P3 components.css, outside this diff). social_status_dots.test.ts source guard repointed hud.ts -> social_window.ts (=== 'off' ? '' :). NEW tests: tests/social_view.test.ts + tests/bags_view.test.ts (struct-sig stability across no-op ticks + tab/permission/raid models + filtered grid states + same-input-same-output + ClientWorld-vs-Sim mirror parity via JSON round-trip) + tests/social_window.test.ts + tests/bags_window.test.ts (no-hex/no-500/no-dash + delegation-not-rewired + bag-grid scroll + token-defined source guards). Validation: tsc clean; full vitest 4056 pass/8 skip (387 files); architecture purity (both cores DOM/Three-free + registered) + client_shell + social_status_dots green; biome clean on the 4 new files (0 errors; 4 grandfathered noNonNullAssertion warns = getElementById('prompt-stack')!/dataTransfer!/view.groups!, same idiom as delve_map_painter). Presentation-only (D4): git diff of world_api.ts/sim/server/net/headless/i18n.locales EMPTY. REVIEWERS: qa-checklist PASS 0 BLOCKING / 0 SHOULD-FIX / 3 NICE-TO-HAVE (social tabs keep aria-pressed not role=tablist = byte-faithful carry-over, defer to P15; bags closeManagedWindow keeps inline close not a bagsWindow.close() = harmless asymmetry, no painter state to drop; live-axe chrome row = needs a running browser); adversarial parity Workflow (2 slices social+bags, each finding then per-deviation adversarial re-verify) PARITY HELD = 5 claimed deviations 0 confirmed regressions (the focus-return additive, the delegation render-neutral w/ every branch byte-identical incl no element carries both data-act+data-whisper, two comment-only #100->issue-100 edits, the qColor token swap byte-identical key-lookup). No perf gate (cold + 500ms-divider diff-gated, not in the every-frame path). commits local) |
| P8a | Cold-window: options (~1180 lines / 9 sub-panels, full dispatch matrix) | medium | port | done (the densest single cold window in the packet. NEW src/ui/options_view.ts (pure core, UI_PURE_CORES): the four control-descriptor primitives (slider/toggle/boolToggle/choice) + the per-kind pure dispatch-value fns (sliderDispatchValue=Number(raw), toggleNextValue=current>=0.5?0:1, toggleIsOn, boolToggleNextValue=!current) so the painter calls the SAME coercion and the matrix proves no dispatch drift with no DOM; per-panel builders buildGraphicsControls (advanced-preset=5 reveal + useTouchInterface + !isNativeAppShell gating, the interleaved browserEffects/interfaceMode notes inline, the preset+interfaceMode choices flagged rerender) / buildAudioControls (3 volume sliders + a musicToggle position-marker + 3 bool toggles) / buildControllerControls / buildInterfaceControls; buildOptionsMenu (the main-menu routing, online-only bug-report row) + buildBugReportInfo (the ONE IWorld slice -> the decision-15 parity surface). DOM/Three/GAME-free: forbiddenUiCoreImport blocks ../game/* even type-only (IMPORT_RE does not distinguish), so setting keys are plain `string` in the descriptors and the painter narrows them; label keys are a type-only TranslationKey from ./i18n.catalog (a pure types barrel). NEW src/ui/options_window.ts (class OptionsWindow): STANDALONE OptionsWindowDeps -- composes NO PainterHostPresentation (options renders no item rows, the social/decision-6 precedent); imports `type {OptionsHooks,BugReportHooks} from './hud'` type-only (isolatedModules erases it, runtime edge is hud->options_window only, acyclic). Owns the #options-menu DOM + the view/capturingKey/keybindNote/perfSettings state + lifecycle (toggle/close/isOpen/onPerfOverlayMoved) + the 4 control builders (descriptor-driven) + the bespoke controls the 4 primitives do not cover (music toggle reads music.enabled; the PR#730-hardened language picker; theme; chat-timestamps 12/24 seg; keybind capture; gamepad remap; the bug-report form; the perf delegate). hud.ts -1237 (12765->11528): thin delegators + a lazy-closure deps bag; ~1237 inline lines + LANGUAGE_ENDONYMS + BIND_CATEGORY_LABEL_KEYS + BIND_ACTION_LABEL_KEYS + the optionsView/capturingKey/keybindNote/perfSettings fields removed via an anchored, asserted string-splice (mustContain/mustNotContain + a no-dangling-this.<method> sweep, NOT sed); 16 now-dead imports pruned (gamepad_map/mobile_controls whole lines, keybinds->type Keybinds only, theme/perf/i18n members, settings normalizeClickMoveButton). D12 no-magic: the painter carries ZERO hex -- the gold log tint '#ffd100' stays Hud-side in the log() dep closure; BUG_DESC_MAX_LEN/RANGE_FILL_FULL_PCT named; the slider --range-fill percent math uses the named full-scale const. TIER BOUNDARY HELD (decisions 6/8): graphics reads s.num('graphicsPreset') as a plain rounded setting value; NO governor read, NO EFFECTS_QUALITY_LOW_CUTOFF, NO ui_effects_profile import (guard-asserted). WCAG focus-return ADDED (inline had none): captureFocus() BEFORE closeOthers() in toggle(); restoreFocus on close() AND the closeManagedWindow->closeOptions->close() path; native range inputs (role=slider) + aria-label/aria-pressed + role=status/alert live regions preserved byte-faithfully. A re-run senior-quality audit (2026-06-25, ultracode 6-finder adversarial Workflow over the COMMITTED extraction, 18/43 findings confirmed, 0 BLOCKING) then added two a11y fixes the inline original lacked: the gamepad remap listboxes now carry the physical-button aria-label (WCAG 4.1.2; the language picker already did) and sliders set aria-valuetext to the formatted readout (50%/90 degrees) so a screen reader announces the meaningful value, not the raw number. chatTimestamps/chatClock stay Hud fields (the chat renderer reads them); the painter mutates via get/set deps that do field+localStorage Hud-side. A 14th endonym ru_RU:'Русский' is required by Record<SupportedLanguage,string> exhaustiveness (tsc-caught). NEW tests: options_view.test.ts (full per-sub-panel dispatch matrix + same-input-same-output + ClientWorld-vs-Sim bug-report parity via two DISTINCT world shapes -- offline Sim prototyped instance + extra fields + '' realm vs online ClientWorld plain wire object + populated realm, decision 15, NOT a JSON self-clone) + options_window.test.ts (no-color(hex+rgb/hsl)/named-const(2000 pinned to its def line)/no-dash + tier-boundary + WCAG roles+gamepad-listbox-name+slider-aria-valuetext + changeLanguage hardening + bug-report async states + keybind dispatch + per-primitive dispatch-expression + applyControls-routing + cold-window guards); tests/architecture.test.ts registered options_view; tests/client_shell.test.ts (menu-dedup guard repointed inline add() -> options_view labelKey) + tests/localization_fixes.test.ts (S3/R2 localizeBugReportError guard repointed hud.ts -> options_window.ts). Validation: tsc clean; full vitest 4087 pass/8 skip (after the audit hardening); biome clean on the 4 new files; build all 4 entries; architecture purity (teeth proven: an injected ../game import reds options_view, green after revert) + client_shell + S3 green. Presentation-only (D4): git diff of world_api.ts/sim/server/net/headless/i18n.locales EMPTY. REVIEWERS: adversarial parity Workflow (6 sub-panel clusters + per-finding adversarial verify) PARITY HELD = 6/6 clusters, 0 material findings, 0 confirmed regressions; qa-checklist PASS 0 BLOCKING / 0 SHOULD-FIX / 1 NICE-TO-HAVE. HONEST WCAG SCOPE (corrected by the re-run audit): the per-window roles/aria/labels/focus-return ARE proven here by source guards + the two audit a11y fixes above; the live-axe-over-the-built-window, forced-colors snapshot, computed target-size (>=24px desktop, 40x40 mobile), and :focus-visible rows need a running browser/DOM and are DEFERRED to P15b (the opt-in vitest.browser.config.ts), consistent with P6/P7a/P7b. The dispatch matrix is proven at the descriptor + pure-coercion-fn level plus exact-dispatch-expression source guards; full live-DOM event-driving is the same P15b deferral. No perf gate (cold; not in Hud.update). The full per-sub-panel dispatch matrix (a pure descriptor + pure coercion fn per control, source guards for the bespoke controls) is the proven preservation pattern for P8b/P9b. commits local) |
| P8b | Cold-window: market + char (skin-event Math.random stays on painter; 3D preview scoped) | medium | port | pending |
| P9a | Cold-window canvas pair: map + arena (preserve mediumHud call site + cadence) | medium | port | pending |
| P9b | Cold-window DOM trio: questlog + spellbook + leaderboard (the one IWorld-consume) | medium | port | pending |
| P10a | Per-frame: xp + swing leak-fix + the PainterHost elided-writer extension | high | port+extend | pending |
| P10b | Per-frame: unit_frame FAMILY core+painter (player first instance) | high | port+extend | pending |
| P11a | Per-frame: cast bars (eat/drink discriminator, i18n-free core) | high | port+extend | pending |
| P11b | Per-frame: target frame (unit_frame instance) | high | port+extend | pending |
| P11c | Per-frame: party frames (innerHTML-wipe -> keyed pool) | high | port+extend | pending |
| P12a | Per-frame: action bar (multi-bar descriptor) + the allocation-budget spike | high | port+extend | pending |
| P12b | Per-frame: auras keyed pool + minimap markers (canvas) | high | port+extend | pending |
| P13a | Per-frame: FCT core + per-frame driver (folded into hud.update) | high | new | pending |
| P13b | Per-frame: FCT pooled painter + spawn-site migration + bounded-AoE gate | high | new | pending |
| P14a | Per-element graphics tiering (tier knobs read the static preset) | medium | port+extend | pending |
| P14b | Nameplate extraction: nameplate_view core + painter + tier-driven interval | medium | port+extend | pending |
| P15a | Accessibility infra: focus manager + skip links + live regions + forced-colors + print | medium | new | pending |
| P15b | Accessibility audit: chrome-wide axe + keyboard E2E + per-window fixes | medium | new | pending |
| P16 | Standards codification into CLAUDE.md (component/token/a11y/perf/browser/bundle) | low | new | pending |
| P17a | Harness floor (test-only): client_shell re-author + standing perf budget + purity sweep + first all-together perf run | low | port+extend | pending |
| P17b | Bundle-budget gate + selective lazy-load + cross-engine E2E + axe CI + packet close | low | port+extend | pending |

### New `IWorld` members / `SimEvent`s / wire fields / endpoints / DB tables
None. This packet adds none. It CONSUMES V16's already-landed IWorld (delve/lockpick/raid + the
paged `leaderboard()`); the only change vs FB is one painter consuming the paged leaderboard (P9b).

### New i18n keys
None expected beyond English-only `hud_chrome.ts` control labels: a unit-frame group aria-name (P10b),
the cast eat/drink label resolved in the painter (P11a), skip-link + live-region-prefix labels (P15a),
async-failure copy for leaderboard/market (P9b/P8b), and a lazy-window loading label (P17b).

### Key file paths (V16 line numbers from the recon; the deep-review corrections are inline)
- Per-frame entry: `Hud.update()` at `src/ui/hud.ts:3627` (frame-divider: every-frame +
  fast >=100ms + medium >=250ms + slow >=500ms). Write-elision: `hud.ts:1322-1372` (the four writers
  are `private` on `Hud`; P6 bound them as closures via `makeWriterFacet` in `src/ui/painter_host.ts`,
  sharing the same `hotWriteCache`) + `perfStats()`.
- Hot elements: player frame 3656-3667, buff bar 3670 (renderAuras 4186-4245), target frame
  3672-3749 (lastPortraitTarget gate 3692-3708, combo pips), player cast bar 3752-3798, swing timer
  3800-3827 (the `#swingbar` per-frame `$()` + raw style LEAK), action bar 3829-3931 (per-frame
  aria-label via t()), xp bar 3933-3952; minimap 5022-5258 (3-branch canvas: delve schematic / NPC
  glyphs / proximity-scaled party discs+arrows; Sets already built once per 10Hz call, NOT a
  double-scan to collapse); party frames CALL SITE 11508-11562 (the pure selector lives in
  `src/ui/party_frames.ts`, NOT inline at 11520); FCT `fct()` 7258-7276 + 7 SimEvent spawn sites in
  6100-6422 PLUS `showSelfNote` (7255, caller at `main.ts:1727`) = the 8th site; `getUiScale`
  (`hud.ts:288`/7270) is load-bearing for FCT positioning under zoom; nameplates `renderer.ts`
  updateNameplates 4413 (mobile interval at renderer.ts:4113, 1/15 vs 1/24).
- Cold windows (inline unless noted): renderVendor 8126 (ALREADY delegates to vendor_window),
  renderMarket 8343, renderBags 8839, renderChar 9116 (skin-event Math.random 9596; Three.js preview),
  renderLeaderboard 10673 (async), renderSpellbook 10766, renderTalents 10909 (mutable `talentStage`
  edit buffer, NOT IWorld-derived), renderQuestLog 11398, renderSocial 12025 (repaints on the 500ms
  slowHud divider with listener churn), renderOptions 12783 (~1180 lines, 9 sub-panels behind a
  9-member OptionsHooks), updateMapWindow 5561 + renderArenaWindow 5300 (BOTH called from
  `hud.update()`'s mediumHud band, NOT purely cold).
- Existing pure cores to REUSE: `xp_bar`, `cast_bar` (in `src/render/cast_bar.ts`, i18n-free),
  `absorb_bar`, `party_frames` (selector, `src/ui/party_frames.ts`), `rest_indicator`, `low_health`,
  `low_resource`, `clock`, `compass`, `coords`, `quest_tracker`, `delve_map`, `raid_lockout_view`,
  `vendor_view`. Plus the cold-window cores extracted in P7-P8: `talents_view` (P7a),
  `social_view` + `bags_view` (P7b), `options_view` (P8a, the declarative options model: control
  descriptors + pure dispatch-value fns + per-panel builders + buildBugReportInfo). Nameplate
  `src/render` has only narrow helpers (`nameplate_combo`/`_projection`/`_threat`); a real
  `nameplate_view` core is NEW (P14b).
- PainterHost (NEW, P6): `src/ui/painter_host.ts` is the THIN two-facet host. FACET 1
  `PainterHostPresentation` (`itemIcon`/`moneyHtml`/`itemTooltip`/`attachTooltip`) is the shared
  icon/money/tooltip dep-bag the cold windows COMPOSE into (P7-P9 reuse it); today ONLY the vendor
  window composes it (`VendorWindowDeps extends PainterHostPresentation`, Hud builds one
  `presentationBag` and spreads it). lockpick + raid_lockout compose NOTHING (callbacks-only / pure
  string builder) -- do NOT "fix" them onto the host. FACET 2 `PainterHostWriters` +
  `makeWriterFacet(cache, onWrite, onSkip)` binds the four existing elided writers as closures over
  Hud's SAME `hotWriteCache` + counters (one skip-rate; Hud's `private` writers keep their visibility);
  this is what P10-P13 consume and P10a EXTENDS with `setStyleProp`/`toggleClass` (D5a). The host is
  host-agnostic (no `window`), Node-importable.
- Delve painter (NEW, P6): `src/ui/delve_map_painter.ts` is the Canvas-2D pilot: pure
  `delveDrawModel(IWorld, size, pad, names)` (the parity-tested core path) + `DelveMapPainter`
  (`paintMinimapDelve` writes `#zone-label` via the writer facet; `paintWorldMapDelve` paints its title
  on-canvas), consuming `src/ui/delve_map.ts` (which now also exports `delveLocalToCanvas`). It resolves
  the `--color-delve-*` tokens (`src/styles/tokens.css`) via `getComputedStyle` once/redraw (D12).
  Template for the per-frame painter halves: pure core from `IWorld` + thin painter, DOM via the facet,
  Canvas NOT routed through the facet (a 2D context cannot be elided, D12).
- Build: `vite.config.ts` (Lightning flip in P1; reconcile the now-dead `css.postcss` Tailwind-defeat
  at 134-139; derive Lightning targets via `browserslistToTargets`), `package.json`, `.browserslistrc`
  (new P1), `biome.json`, `tsconfig.json`. V16 has NO existing CSS-import seam (unlike FB): P1 defines
  it (a barrel imported once from the game entries' TS) and which entries load it. CSS (new):
  `src/styles/{tokens,base,layout,components,hud,shell,hud-mobile,index-extra,play-extra}.css` (the file
  is `hud.mobile.css` but its LAYER is `hud-mobile`; likewise `index.extra.css`->`@layer index-extra`,
  `play.extra.css`->`@layer play-extra` - flat hyphenated names, NOT dotted, because a dot in a @layer name
  is a SUBLAYER, see P4b).
  ALL FILLED as of P4b: tokens/base (P1), hud (P2, `@layer components`), layout.css (`@layer layout`, the
  `.window` shell only) + components.css (`@layer components`, every feature-window body + the P4b paperdoll/
  bags chrome) (P3/P4b), shell.css (`@layer shell`, pre-game shell + char-select) (P4a), hud.mobile.css
  (`@layer hud-mobile`, the in-game mobile-touch block) + index.extra.css/play.extra.css (the per-entry
  #rotate-device gate) (P4b). FLAT @layer order: tokens, base, layout, components, hud, shell, hud-mobile,
  index-extra, play-extra (hud-mobile AFTER shell so mobile overrides of shell elements win; index/play extra
  last). Barrel import order tokens,base,layout,hud,components,shell,hud.mobile (components.css before-but-
  same-layer as hud.css; per-entry .extra load via a `<link>` in each entry's `<head>`, NOT the barrel).
  Entries: `index.html`, `play.html` (BOTH inline `<style>` blocks now EMPTY; play.html reconciled to the
  canonical modules in P4b), `admin.html`, `guide.html` (survival-only, decision 18).
  `--range-fill` is NOT a `:root` token: it is the inline `var(--range-fill, 0%)` fallback on the
  slider track at `index.html:356`, written per-element at `hud.ts:12899`; it rides into `base.css`
  inside the slider rule, do NOT promote it to `:root`.
  P1 LANDED (commits b9fe99b2/0a120e9f/0892c250, local): the Lightning flip (`css.transformer` +
  `cssMinify` = lightningcss, targets via `browserslistToTargets` fed by a zero-dep `.browserslistrc`
  parser at `scripts/browserslist_targets.mjs`, NO `browserslist` npm dep), `.browserslistrc`, and the
  `src/styles/index.css` barrel seam are in. The dead `css.postcss` block is removed (no
  `tsconfig.json` change was needed; the CSS import type-checks via the existing `vite/client` types).
  The single `@layer` order is declared once; as of P4b it is the FLAT-named
  (`tokens, base, layout, components, hud, shell, hud-mobile, index-extra, play-extra`) order (P1 declared a
  dotted variant with hud.mobile before shell; P4b corrected both the dot-as-sublayer bug and the order so
  hud-mobile lands after shell); later CSS phases only fill layers. The barrel is imported once from `src/main.ts`, the SHARED bootstrap for
  both game entries (V16 has no separate per-entry TS, unlike the recon's assumption), so one import
  styles `index.html` AND `play.html`. `--range-fill` stayed in the slider rule (not `:root`). GOTCHA
  for P2-P4: the global Lightning flip hard-errors on a relative `url()` inside a custom property, so
  any inline CSS a later phase touches must use root-absolute `url('/...')`; P1 had to absolutize
  `play.html`'s 3 inline cursor `url()`s as a build-survival fix (its token/base extraction itself is
  still deferred to P4, its block diverges 327 vs 433 lines). A `biome.json` override scoped to
  `src/styles/**` disables `noImportantStyles` + `noDescendingSpecificity` (they fire on verbatim
  load-bearing `!important` and source order; reuse it as later phases extract more legacy CSS).
- Tier: `src/render/gfx.ts` (`graphicsPresetLabel` at 245, 5 labels; `GFX_BUCKET_BANDS`; the `ui`
  band `governable:false`; `gfx.ts:308` bare `0.5` -> import `EFFECTS_QUALITY_LOW_CUTOFF`),
  `src/game/settings.ts`, `src/game/ui_effects_profile.ts` (new P5, render-importable),
  `src/ui/theme.ts` (applier shape).
- Focus a11y (P15a): the ad-hoc helpers `hud.ts:2570-2604` (canRestoreFocusTo / currentFocusableElement
  / restoreFocus / focusFirstInteractive, canonical focusable selector at 2598). The full restoreFocus /
  focusFirstInteractive / dropdown-focus-return caller set is ~15 sites (grep the FULL set; the 6 listed
  in the draft were incomplete), plus the `src/guide/chrome.ts:85` skip-link precedent to reuse.
- Guards: `tests/client_shell.test.ts`, `tests/architecture.test.ts`, `tests/css_corpus.test.ts`
  (new, 10-dash markers), `tests/hud_perf_budget.test.ts` (new, STANDING in P17a),
  `scripts/perf_tour.mjs`, `scripts/*_shot.mjs` (visual baseline), the V16 `mobile_*` E2E scripts,
  `vitest.browser.config.ts` (opt-in axe/keyboard, P15b; cross-engine CI on in P17b).

## Top risks
1. Per-frame write-elision regression (non-byte-identical cache keys / raw writes silently collapse
   the skip-rate). Mitigation: the PainterHost elided-writer facet + the writer EXTENSION (decision 5a)
   + a unit test rejecting raw writes + the skip-rate perf gate every per-frame phase. A failed gate
   blocks completion and bisects to the offending phase (the first all-together run is P17a).
2. FCT extraction (P13a/P13b): net-new pool + per-frame driver; pool lifecycle errors drop/duplicate
   text; AoE worst-case is the perf-gate scenario; `getUiScale` positioning + the 6 hex->class-token
   migration + the `showSelfNote`/`main.ts:1727` precondition are easy to miss. Isolated last.
3. innerHTML-wipe -> keyed-pool rewrites (auras P12b, party P11c) silently dropping listeners/tooltips;
   the tooltip closure must read a live MUTABLE slot record, not capture-by-value (stale after recycle).
4. Action-bar aria-label (P12a): per-frame i18n+a11y+allocation triple-hazard; elide WITHOUT dropping
   `t()` or adding a fallback.
5. Two-controller hazard (P5/P14a): tier knobs read the static preset, never the governor.
6. CSS cascade/rule-drop (P2-P4b): mitigated by the css_corpus section-by-section guard every CSS
   phase + the backdrop -webkit-first gotcha + JS-written custom props kept in `:root` + a
   screenshot-diff against the P0 visual baseline. Orphan band now CLOSED: P2 took Fiesta HUD (2303);
   P3 took arena (1846) / market (1900) / options (1973) / theme (2040) / emote (2108) into
   components.css, so the 1846-2161 window band is fully assigned. P3 had NO backdrop-filter in its
   moved content, so the -webkit-first gotcha was a no-op there (gate still runs).
7. Canvas painters vs no-magic-values (P9a, P12b, P14b): a 2D context cannot read CSS vars; resolve
   tokens via `getComputedStyle` once per redraw (decision 12), do not weaken the guard.
8. ClientWorld-vs-Sim drift (decision 15): an offline-only-shape assumption ships broken online; the
   per-core parity test is the mitigation.
9. Spec-vs-live drift in the phase docs (the FB-carryover root cause): the deep review corrected the
   known set; if a phase finds a NEW stale ref, trust live source and surface it.
10. Scope creep into sim/server/net: the only IWorld interaction is consuming V16's landed members.
