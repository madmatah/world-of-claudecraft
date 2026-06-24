# Phase P1: CSS A: Lightning CSS flip + tokens + base

Flip the Vite CSS pipeline to Lightning CSS, declare the single `@layer` order, set the big-3
browser floor, stand up the CSS-import seam V16 lacks (a `src/styles/index.css` barrel imported once
from the two game entries' TS), and lift the design tokens (`:root` custom properties) and the
reset/forms/base layer out of the inline `<style>` into `src/styles/tokens.css` + `src/styles/base.css`.
Presentation only; no HUD logic, no cascade change.

## Starter Prompt

```
This is Phase P1 of the Frontend Modernization v0.16.0 packet: CSS A: Lightning CSS flip + tokens + base.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a small, surgical, sequential CSS lift (two files, one build-config flip, one
order declaration). It is not batch-heavy: tokens and base are one contiguous slice each and must be
diffed against the inline source rule-for-rule, so a single careful orchestrator beats fan-out here.

Goal: re-establish the Lightning CSS build and the foundational style layer FB invented, on the
larger v0.16.0 base. Flip `vite.config.ts` to Lightning CSS (set `css.transformer: 'lightningcss'`
and derive `css.lightningcss.targets` explicitly via `browserslistToTargets(browserslist(...))` from
the new `.browserslistrc`, NOT a hand-typed target object), reconcile the now-dead PostCSS
Tailwind-defeat block at `vite.config.ts:134-139` (it becomes contradictory once the transformer is
`lightningcss`, since `css.postcss` and `css.transformer` are mutually exclusive in Vite: remove the
dead PostCSS config rather than leave a config Vite will ignore or error on), add a `.browserslistrc`
big-3 floor, declare the single `@layer` order one time, stand up the CSS-import seam V16 does not
have yet (a `src/styles/index.css` barrel that `@import`s the layer files in order, imported ONCE
from each game entry's TS), and extract the design tokens (the index `:root` block, KEEPING the
theme.ts-written `--color-*` and the resizer-written `--app-vw`/`--app-vh` as `:root` defaults so the
runtime overrides still apply) into `src/styles/tokens.css`, and the reset / scrollbar / `@supports`
/ forms block (which includes the slider rule carrying the inline `var(--range-fill, 0%)` fallback)
into `src/styles/base.css`. The visual result must be byte-for-byte unchanged; this phase only
relocates rules and wires the pipeline. P0's css_corpus guard must account for the two new sections.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This is a SHARED checkout; if it is dirty, STOP and ask the user before
  touching anything (a concurrent session may own those changes).
- Confirm you are in the `/Users/fernando/Documents/wocc-v0.16.0` worktree on branch
  `feature/frontend-modernization-v016`.
- Memory scan: read MEMORY.md and the relevant entries:
  - "Frontend Phase 4 Lightning CSS flip" (pr759 / frontend-phase4-lightningcss-flip): the
    lightningcss Vite config, the big-3 `.browserslistrc` floor, and the backdrop-filter
    -webkit-first minify gotcha. Port that shape.
  - "Frontend Phase 2 CSS extraction" (frontend-phase2-css-extraction): the play.html
    preserve-both-exactly discipline (NOTE: the per-entry .extra split is P4, not here) and the single
    `@layer components` order convention.
  - "Frontend Phase 1 foundation gates" (frontend-phase1-foundation-gates): cssCorpus/normalizeCss
    pinning and the lightningcss 1.32.0 pin.
- Confirm P0 is landed (css_corpus guard + UI-purity guard + perf baseline exist and are green); P1
  depends on P0.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps):
- `docs/frontend-modernization/state.md` (locked decisions, the validation matrix CSS row, the
  Review Dispatch Matrix, the Key file paths block).
- THIS phase file.
- The `### P1 CSS A` section of `docs/frontend-modernization/v016-recon-and-packet.md` plus the
  "Reuse from FB" paragraph and Top risk #6 (CSS cascade/rule-drop + JS-written custom props in
  `:root`).
- The EXACT source ranges this phase touches, read with offsets only (never the whole file):
  - `index.html` inline `<style>`: the tokens block `:root` at lines 186-269, and the
    reset/scrollbar/@supports/forms block at lines 270-625. Capture every selector and declaration
    verbatim. Note which `:root` custom properties are runtime-written and so must stay as `:root`
    DEFAULTS: the `src/ui/theme.ts` `--color-*` accents, and the resizer-written `--app-vw`/`--app-vh`.
    SEPARATELY confirm the deep-review BLOCKING correction: `--range-fill` is NOT a `:root` token. It
    is the inline fallback in `var(--range-fill, 0%)` on the slider track rule at `index.html:356`
    (inside the 270-625 BASE block, not the 186-269 tokens block), and it is written per-element on
    the slider by `hud.ts:12899`, never on `:root`. It must ride into `base.css` exactly as written,
    inside the slider rule with its `0%` inline fallback; do NOT lift it to `:root` and do NOT add a
    `:root` default for it (that would change the slider's default fill and break byte-for-byte parity).
  - `vite.config.ts` (current CSS handling: the entries map AND the PostCSS Tailwind-defeat block at
    lines 134-139 that the flip must reconcile).
  - `package.json` (confirm `browserslist` is available to import in `vite.config.ts`; it ships with
    Vite, but verify before using `browserslistToTargets`).
  - `src/ui/theme.ts` (which `--color-*` vars it sets at runtime, and the `:root` target).
  - `index.html` and `play.html` script entry points: where each game entry's TS bootstraps, so the
    `src/styles/index.css` barrel import can land in exactly the two game entries (NOT admin/guide).
  - Whether `src/styles/` exists yet (FB created it; on V16 it does not, per state.md Key file paths).
The orchestrator KEEPS the summary; do not re-read these whole afterward.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (sequential, single orchestrator; no fan-out):
Slice 1 - Build pipeline flip (`vite.config.ts`, `.browserslistrc`, `package.json`, `tsconfig.json`):
  - Add Lightning CSS as a devDependency (pin to the version FB used, 1.32.0 per memory) and flip
    Vite's CSS transformer to `lightningcss` (`css.transformer: 'lightningcss'`).
  - Derive `css.lightningcss.targets` EXPLICITLY from the browserslist: import `browserslist` and
    `browserslistToTargets` (from `lightningcss`) in `vite.config.ts` and set
    `targets: browserslistToTargets(browserslist())` so the `.browserslistrc` is the single source of
    the floor. Do NOT hand-type a target object (that drifts from `.browserslistrc`).
  - RECONCILE the now-dead PostCSS Tailwind-defeat at `vite.config.ts:134-139`: `css.postcss` and
    `css.transformer: 'lightningcss'` are mutually exclusive in Vite, so once the transformer flips,
    that PostCSS block is contradictory dead config. Remove it (this packet is vanilla, no Tailwind, so
    the defeat is moot). Do not leave a `css.postcss` Vite will ignore.
  - Add `.browserslistrc` with the big-3 floor (the same Chrome/Firefox/Safari minimums FB shipped;
    state.md decision 14 adds mobile Safari/WebKit as first-class, so include the iOS Safari floor too).
  - Do NOT change the entries map or any non-CSS Vite option.
Slice 2 - `@layer` order declaration + the CSS-import seam (V16 has NONE; create it):
  - V16 has no `src/styles/` and no CSS-import seam (FB's was distributed). Create
    `src/styles/index.css` as the barrel: it declares the single canonical `@layer` order ONE time
    (the FB order: `tokens, base, layout, components, hud`, then the per-entry extras as named in
    state.md's CSS module list `index.extra`/`play.extra`) at the TOP, then `@import`s the layer files
    in that order. Only `tokens` and `base` get content THIS phase; the later layers are
    declared-but-empty placeholders so the cascade order is fixed up front and P2-P4 only fill them
    (the extras are P4's split, so they are named in the `@layer` statement but not imported here).
  - Import the barrel ONCE from each of the TWO game entries' TS bootstrap (the modules that
    `index.html` and `play.html` load), NOT from `admin.html`/`guide.html` (decision 18: those keep
    their current CSS shape and are survival-only). A single `import './styles/index.css'` (path
    relative to the entry TS) per game entry; Vite resolves and orders it via the `@import` chain.
    State in the final response exactly which two entry TS files received the import.
Slice 3 - `src/styles/tokens.css`:
  - Move the `:root` custom-property block (index 186-269) verbatim into `tokens.css` under
    `@layer tokens`.
  - KEEP the runtime-written custom props as `:root` DEFAULTS in tokens.css: `--app-vw`, `--app-vh`,
    and theme.ts's `--color-*`. They must remain present as defaults so the runtime overrides
    (theme.ts inline `:root` writes + the resizer) still cascade on top. Do NOT delete them and do NOT
    move them out of `:root`.
  - `--range-fill` is NOT in this block and must NOT be added here (deep-review BLOCKING correction):
    it is the slider track's inline `var(--range-fill, 0%)` fallback in the BASE block, written
    per-element by `hud.ts:12899`, never a `:root` token. Adding a `:root --range-fill` default would
    change the slider default and break byte-for-byte parity. It travels with the slider rule in
    Slice 4, untouched.
  - Wire is handled by the Slice 2 barrel; tokens.css is `@import`ed first in the `@layer tokens` slot.
Slice 4 - `src/styles/base.css`:
  - Move the reset / scrollbar / `@supports` / forms block (index 270-625) verbatim into `base.css`
    under `@layer base`. This block INCLUDES the slider track rule at index 356 with its inline
    `var(--range-fill, 0%)` fallback: move it byte-for-byte, fallback intact, do NOT promote
    `--range-fill` to `:root`.
  - backdrop-filter -webkit-first survival check is N/A in P1: there are ZERO `backdrop-filter`
    declarations in the 270-625 base block (all of them live at index 2217+, so the gotcha first bites
    in P2). Do not invent a backdrop-filter to test; if a grep of base.css finds none, that is correct.
    The check becomes meaningful in P2.
  - Remove the now-moved blocks from `index.html`'s inline `<style>` (and play.html if it shares the
    identical token/base block; if play.html differs, DO NOT reconcile here, that delta is P4's
    .extra split). Leave the rest of the inline `<style>` intact for P2-P4.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation only: no `hud.ts` logic edit, no `IWorld` change, no `src/sim`/`server`/`src/net`/
  `headless` touch. If you find you need any of these, STOP (scope change).
- Vanilla only: the one allowed build-time dependency is Lightning CSS (devDependency). Add nothing
  else.
- Encapsulation is `@layer` + `#id`-prefix; the `@scope` future-layer stays deferred (browser floor).
- Keep runtime-written `:root` custom props (`--app-vw`/`--app-vh`/theme.ts `--color-*`) present in
  `:root` so runtime overrides still apply (Top risk #6). `--range-fill` is the EXCEPTION: it is NOT a
  `:root` token, it is the slider's inline `var(--range-fill, 0%)` fallback (BASE block, written
  per-element at `hud.ts:12899`); it stays inside the slider rule, never promoted to `:root`.
- backdrop-filter -webkit-first is N/A this phase (no backdrop-filter in the 270-625 base block; the
  gotcha first applies in P2). Carry the rule forward, do not exercise it on empty input.
- Lightning targets come from `.browserslistrc` via `browserslistToTargets`, not a hand-typed object;
  the dead `css.postcss` Tailwind-defeat at `vite.config.ts:134-139` is removed, not left to be ignored.
- No new player-visible strings in this phase, so no `t()` work; if you somehow touch a label, it is a
  `t()` key in `src/ui/i18n.catalog/hud_chrome.ts` (English-only) and never an `i18n.locales` edit.
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.
- No em dashes, en dashes, or emojis anywhere (CSS, comments, commits, docs).

Out of scope (do NOT do in this phase):
- The in-world HUD chrome CSS (frames/bars/nameplates/FCT/vignette) -> P2.
- Modal + feature-window CSS -> P3.
- The pre-game shell + mobile CSS, and the index.extra/play.extra preserve-both-exactly split -> P4.
- The `ui_effects_profile` resolver, `data-fx-level`, `--fx-*` consumption -> P5.
- Any per-frame / painter / PainterHost work -> P6+.
- Emptying the inline `<style>` blocks fully; this phase only removes the tokens+base sections.

STEP 3 - VALIDATION + REVIEW:
Run the CSS / HTML-entry row of the state.md validation matrix:
- `npx tsc --noEmit` (baseline).
- `npx vitest run tests/css_corpus.test.ts` (the P0 completeness guard now accounts for tokens+base).
- `npx vitest run tests/client_shell.test.ts`.
- `npm run build` (all 4 entries: index, play, admin, guide) resolves under the `@layer` order; the
  two game entries pull `src/styles/index.css` and admin/guide build unchanged (decision 18 survival).
- backdrop-filter survival check: N/A in P1. Grep the built tokens.css/base.css to CONFIRM there is no
  `backdrop-filter` to reorder (all live at index 2217+, moved in P2). State this explicitly as
  "0 backdrop-filters in P1 scope, check deferred to P2"; do not report a vacuous pass as a real one.
- `biome check` on the new `src/styles/*.css` (the V16 ratchet on every new file).
- Confirm theme.ts runtime overrides still apply (the `--color-*` defaults in tokens.css are
  overridden by theme.ts's `:root` writes; the `--app-vw`/`--app-vh` defaults remain writable at
  runtime). Confirm SEPARATELY that the slider still renders its `var(--range-fill, 0%)` fallback (no
  `:root --range-fill` was added) and `hud.ts:12899`'s per-element write still drives the track fill.
This is NOT a per-frame phase, so NO perf gate runs here.
Review dispatch: `qa-checklist` only. No `privacy-security-review` (no server/net/admin/secret/sim
touch), no `migration-safety` (no DDL), no `cross-platform-sync` (no IWorld/sim/wire/i18n-matcher
change). Prompt the reviewer for COVERAGE; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope + explicit paths; never `git add -A`):
- `build(css): flip Vite to Lightning CSS, browserslist targets, drop dead PostCSS`
  paths: `vite.config.ts .browserslistrc package.json package-lock.json tsconfig.json`
  (this commit both flips the transformer with `browserslistToTargets` and removes the now-dead
  `css.postcss` Tailwind-defeat at lines 134-139.)
- `style(css): declare the single @layer order + add the styles barrel import seam`
  paths: `src/styles/index.css` + the two game-entry TS files that gain the `import './styles/index.css'`
  (name them explicitly, e.g. the `index.html` and `play.html` bootstrap modules)
- `refactor(css): extract :root design tokens into src/styles/tokens.css`
  paths: `src/styles/tokens.css index.html`
- `refactor(css): extract reset/scrollbar/@supports/forms into src/styles/base.css`
  paths: `src/styles/base.css index.html`
Keep each commit to its explicit file list.

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
[ ] `npx tsc --noEmit` clean.
[ ] `vite.config.ts` uses `css.transformer: 'lightningcss'` with
    `css.lightningcss.targets = browserslistToTargets(browserslist())` (derived from `.browserslistrc`,
    not hand-typed); the dead `css.postcss` Tailwind-defeat at lines 134-139 is REMOVED.
[ ] `.browserslistrc` exists with the big-3 floor PLUS the iOS Safari/WebKit floor (decision 14);
    Lightning CSS is a devDependency only (no other new dependency).
[ ] The single `@layer` order is declared exactly once in `src/styles/index.css` (tokens, base,
    layout, components, hud, then the per-entry extras), with tokens+base filled and the later layers
    declared-but-empty; `index.css` `@import`s tokens.css then base.css in order.
[ ] `src/styles/index.css` is imported exactly ONCE from each of the two GAME entries' TS bootstrap
    (not admin.html/guide.html). The two entry files are named in the final response.
[ ] `src/styles/tokens.css` holds the index 186-269 `:root` tokens verbatim under `@layer tokens`;
    the runtime-written `--app-vw`, `--app-vh`, and theme.ts `--color-*` remain as `:root` defaults
    and are NOT removed or relocated. NO `:root --range-fill` default was added (it is not in this
    block).
[ ] `src/styles/base.css` holds the index 270-625 reset/scrollbar/@supports/forms verbatim under
    `@layer base`, INCLUDING the index 356 slider rule with its inline `var(--range-fill, 0%)`
    fallback intact (not promoted to `:root`).
[ ] The tokens and base blocks are removed from the inline `<style>` and now load from `src/styles/`;
    the rest of the inline `<style>` (HUD/windows/shell) is untouched.
[ ] `npx vitest run tests/css_corpus.test.ts` green: the corpus accounts for the tokens + base
    sections (zero rule loss vs the inline source).
[ ] `npx vitest run tests/client_shell.test.ts` green.
[ ] `npm run build` builds all 4 entries (index, play, admin, guide) and resolves under `@layer`; the
    two game entries load `src/styles/index.css`, admin/guide build unchanged (survival, decision 18).
[ ] backdrop-filter survival is N/A in P1 (zero in the 270-625 base block, verified by grep of the
    built base.css); the check is deferred to P2 and stated as such, not reported as a real pass.
[ ] `biome check` clean on `src/styles/*.css`.
[ ] theme.ts runtime `--color-*` overrides and the `--app-vw`/`--app-vh` runtime writes still apply
    (defaults present, overridable); the slider track still fills from `hud.ts:12899`'s per-element
    `--range-fill` write over the `0%` inline fallback.
[ ] `qa-checklist` reviewer verdict: no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update `progress.md`: mark P1 done, record the new files (`src/styles/index.css`,
  `src/styles/tokens.css`, `src/styles/base.css`, `.browserslistrc`), the Lightning CSS pin, the
  declared `@layer` order, the two game-entry TS files that gained the barrel import, and that the dead
  `css.postcss` block was removed.
- Update `state.md`: flip the P1 ledger row to done; note in the Key file paths block that the
  Lightning flip (targets via `browserslistToTargets`), `.browserslistrc`, and the
  `src/styles/index.css` barrel import seam have landed, that the `@layer` order is now declared (later
  CSS phases only fill layers), and that `--range-fill` stayed in the slider rule (not `:root`).
- Record any surprising rule in memory (e.g. a Lightning targets value V16 needs that FB did not, a
  token V16 added since FB that must stay a `:root` default, or the exact two game-entry TS files where
  the barrel import lives for later phases to reuse).

STEP 7 - FINAL RESPONSE:
Report: status (done / blocked), the files changed (absolute paths, including the two named game-entry
TS files that gained the barrel import), the validation results (tsc, css_corpus, client_shell,
build x4, the N/A backdrop note, biome), the `qa-checklist` reviewer verdict, and any deferrals. End
with exactly:
Next: phase-02-css-hud-chrome.md

STOPPING RULES (phase-specific):
- STOP if a token or base rule cannot be moved without changing the cascade (a duplicate selector, an
  ordering dependency on a later block, or a specificity that the `@layer` order would alter). Surface
  it; do not silently reorder.
- STOP and ask if `git status` is dirty at pre-flight (shared checkout).
- STOP (scope change) if the work appears to require editing `hud.ts`, `IWorld`, `src/sim`,
  `server`, `src/net`, or `headless`, or adding any dependency other than Lightning CSS.
- STOP if you find yourself about to add a `:root --range-fill` default or lift `--range-fill` out of
  the slider rule: that is the deep-review BLOCKING error. It stays an inline `var(--range-fill, 0%)`
  fallback in the slider rule, written per-element at `hud.ts:12899`; surface any pressure to move it.
- STOP if removing the `css.postcss` block breaks the build (it should not, since the transformer flip
  makes it inert): if Vite still depends on it, surface the coupling rather than forcing the flip.
- STOP if play.html's token/base block diverges from index.html's: do NOT reconcile it here, that
  delta belongs to P4's index.extra/play.extra split. Note it and move on.
- STOP if css_corpus cannot be made green without weakening the guard; the guard is the safety net,
  not an obstacle to route around.
```

## Notes for the planner

P1 is shaped as the smallest, lowest-risk CSS slice on purpose: it lands the build pipeline (Lightning
flip), the CSS-import seam V16 lacks (the `src/styles/index.css` barrel, imported once per game entry,
since FB's seam was distributed and does not port as a file), and the cascade contract (the one
`@layer` order, declared but mostly empty) so that P2-P4 each just fill a layer against a fixed order,
never re-litigating cascade. The deep review corrected four things now baked in here: (1) BLOCKING,
`--range-fill` is NOT a `:root` token but the slider's inline `var(--range-fill, 0%)` fallback written
per-element at `hud.ts:12899`, so it rides into base.css inside the slider rule and is never promoted
to `:root` (doing so would change the slider default and break byte-for-byte parity); (2) the
backdrop-filter -webkit-first survival check is N/A in P1 because the 270-625 base block has zero
backdrop-filters (they live at index 2217+ and first bite in P2), so the check is carried forward, not
exercised on empty input; (3) the Lightning targets are derived from `.browserslistrc` via
`browserslistToTargets`, not hand-typed; (4) the now-dead `css.postcss` Tailwind-defeat at
`vite.config.ts:134-139` is removed since `css.postcss` and `css.transformer: 'lightningcss'` are
mutually exclusive. The remaining key risk is silent cascade/rule-drop (Top risk #6): moving the
`:root` tokens while keeping the resizer and theme.ts custom props as overridable `:root` defaults. It
is intentionally NOT ultracode and NOT fanned out, because tokens and base are two contiguous blocks
that must be diffed rule-for-rule against the inline source, which a single careful orchestrator does
better than parallel agents. De-risks every later CSS phase by proving the Lightning build, the
css_corpus accounting, the import seam, and the layer order before any HUD/window CSS moves.
