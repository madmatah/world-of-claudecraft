# Phase P6: PainterHost (two facets) seam + cold-window pilot

Introduce `PainterHost` as a THIN shared host factored into TWO facets (locked decision 8): a
presentation dep-bag (icon/money/tooltip) the cold windows COMPOSE into, and a write-elision facet
that binds Hud's four private elided writers as closures for the per-frame phases to reuse. Then
prove the core-to-painter split by extracting the first new painter (`delve_map_painter`, Canvas-2D)
from the existing `src/ui/delve_map.ts` core and deduping the two inline delve render sites. This is
the pilot that de-risks the cold-window batches P7-P9 and locks the host contract P10-P13 lean on.

## Starter Prompt

```
This is Phase P6 of the Frontend Modernization v0.16.0 packet: PainterHost (two facets) seam + cold-window pilot.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is a small surgical seam phase (one new host module with two facets + one window
composing the presentation facet + one new Canvas painter and a dedupe). It does not warrant
deterministic Workflow fan-out; a couple of parallel Explore/Agent slices are enough.

Goal: Define `src/ui/painter_host.ts`, a thin shared host factored into TWO facets (locked decision 8):
1) a PRESENTATION dep-bag exposing the icon / money / tooltip helpers (the shape vendor already needs:
   `itemIcon` / `moneyHtml` / `attachTooltip` / `itemTooltip`), which the cold windows COMPOSE into; and
2) a WRITE-ELISION facet that binds Hud's four PRIVATE elided writers (`setText` / `setDisplay` /
   `setTransform` / `setWidth` at `hud.ts:1322-1372`) as closures over Hud's `hotWriteCache`, per the
   vendor-template glue pattern (NO visibility change to the `private` writers; Hud constructs the
   facet from inside the class and hands it to the host).
Then have V16's existing bespoke windows COMPOSE the presentation facet where (and ONLY where) they
actually use it, so the already-tested vendor (incl sell-junk), lockpick, and raid_lockout windows
keep their behavior verbatim. Then extract `src/ui/delve_map_painter.ts` (Canvas-2D) from the two
inline delve render sites, painting from the existing `src/ui/delve_map.ts` pure core, and delete the
duplication. Presentation-only: consume V16's already-landed `IWorld`, do not extend it.

REALITY CHECK (verified against live V16 source; the host must FIT these, not the other way round):
- vendor (`src/ui/vendor_window.ts`, `VendorWindowDeps`) is the ONLY one that uses icon/money/tooltip:
  `itemIcon(item)` / `moneyHtml(copper)` / `attachTooltip(row, fn)` / `itemTooltip(item)`, all via
  `innerHTML`. The presentation dep-bag is exactly its glue shape; vendor COMPOSES it.
- lockpick (`src/ui/lockpick_window.ts`, `LockpickWindowDeps`) does NOT use icon/money/tooltip. Its
  deps are CALLBACKS: `getState()` / `tierName(tier)` / `onEngage` / `onAction` / `onAbort` / `onClose`,
  plus its own `getElementById('lockpick-panel')`. It does not compose the presentation facet (nothing
  to compose); leave its bespoke deps untouched. Do NOT invent icon/money/tooltip usage to "adopt" it.
- raid_lockout (`src/ui/raid_lockout_view.ts`) is a PURE HTML-STRING builder: `raidLockoutPanelHtml(
  lockouts, i18n: RaidLockoutI18n)`, consumed by `hud.ts:4166` via `innerHTML`. It has no icon/money/
  tooltip dep and no DOM writes of its own. It does not compose the presentation facet either.
So the honest claim is: ONE bespoke window (vendor) composes the presentation dep-bag; the host's
SECOND facet (the elided writers) is what the delve pilot and the per-frame phases consume. Do NOT
restate this as "3 windows migrate onto a unified bag" (that is the FB-carryover error this phase fixes).

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This is a shared checkout; if it is dirty, STOP and ask the user
  before touching anything (a concurrent session may be mid-edit).
- Memory scan: read MEMORY.md plus the relevant entries:
  - [[frontend-phase7-hud-window-extraction]] (FB's PainterHost seam + the cold-window core+painter
    template + the purity-guard hardening that rejects a pure core importing a *_painter/painter_host).
  - [[frontend-architecture-vanilla-stack]] (the packet shape + worktree).
  - [[phased-packet-qa-cadence]] (phase -> its phase-NN-qa.md -> next).
  - [[pr901-webgl-context-release]] (delve "movement stick"/joystick vocab, only if any label surfaces).
- Confirm you are in the `feature/frontend-modernization-v016` worktree on the right branch.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize:
- `docs/frontend-modernization/state.md` (locked decisions, the canonical workflow, the validation
  matrix, the Review Dispatch Matrix, the key file paths).
- this phase file.
- the `### P6` section of `docs/frontend-modernization/v016-recon-and-packet.md` (the authoritative
  scope) plus the "Load-bearing structural findings" and "Top risks" sections.
- the SPECIFIC V16 source ranges this phase touches (read ONLY these ranges, not the whole files):
  - the elided writers + cache: `hud.ts:1322-1372` (`setText`/`setDisplay`/`setTransform`/`setWidth`,
    all `private`, over `hotWriteCache`) and `perfStats()` immediately after. These are the four the
    write-elision FACET binds as closures; P10a EXTENDS the facet with `setStyleProp`/`toggleClass`
    (locked decision 5a), NOT this phase.
  - `renderVendor` at `hud.ts:8126` (ALREADY delegates to `vendor_window.ts`; this is the COMPOSE
    template, incl sell-junk) and its `VendorWindowDeps` shape (`itemIcon`/`moneyHtml`/`attachTooltip`/
    `itemTooltip`/`sellJunk`): the icon/money/tooltip subset is exactly the presentation dep-bag.
  - the lockpick window: `src/ui/lockpick_window.ts` (`LockpickWindowDeps` = callbacks getState/
    tierName/onEngage/onAction/onAbort/onClose + its own getElementById) + `lockpick_panel.ts`. CONFIRM
    it has no icon/money/tooltip dep (it does not), so it does not compose the presentation facet.
  - the raid lockout: `src/ui/raid_lockout_view.ts` (`raidLockoutPanelHtml(lockouts, i18n)` pure
    HTML-string builder + `RaidLockoutI18n`) and its caller at `hud.ts:4149-4166` (innerHTML). CONFIRM
    it has no DOM-write or icon/money/tooltip dep (it does not), so it does not compose the facet.
  - the existing pure core: `src/ui/delve_map.ts` (exports `delveAreaLabel`, `delveSchematicStatic`,
    `delveSchematicPlayer`, `playerDelveLocal`, the `SchematicPrimitive` union). NOTE the canvas-drawing
    helper `drawSchematicPrimitives(ctx, prims)` is NOT in the core: it is a PRIVATE function inside
    `hud.ts` (`hud.ts:14119`) that the painter should ABSORB (it is the imperative half the dedupe pulls out).
  - the two inline delve render sites to dedupe: minimap `hud.ts:5034-5106` (`delveAreaLabel` ->
    `#zone-label`; `delveSchematicStatic` -> `drawSchematicPrimitives` on the bg ctx at 5063; then the
    `delveSchematicPlayer` arrow at 5106 onto the live minimap canvas) and world-map `hud.ts:5567-5645`
    (`delveSchematicStatic` -> `drawSchematicPrimitives` on the bg ctx at 5584; `delveAreaLabel`). They
    share the core builders but differ (minimap also paints the live player arrow at ~10Hz; world-map
    is the static schematic only). The painter must preserve BOTH paint behaviors, not collapse them
    (see STOPPING RULES). Move `drawSchematicPrimitives` into the painter as the single canvas drawer.
  - VERIFY before relying on it: `delveRun`, `entities`, and `partyInfo` are on `IWorld`
    (`src/world_api.ts`); they are at lines 483, 343, 413 respectively in V16, so the painter reads them
    via `IWorld`, never a concrete world. If any is missing, STOP (scope change).
The orchestrator keeps the summary (file names, the real deps each window needs, the exact two
delve hunks and how they differ), not raw dumps.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Lightest tool: a short sequential build with two parallel read slices, no Workflow.
- Slice A (define the host, TWO facets): write `src/ui/painter_host.ts`. It exposes:
  1) `PainterHostPresentation` (the presentation dep-bag interface): exactly the icon / money /
     tooltip surface vendor needs (`itemIcon(item)`, `moneyHtml(copper)`, `attachTooltip(el, fn)`,
     `itemTooltip(item)`). This is the shared BASE that `VendorWindowDeps` COMPOSES into (extends or
     embeds), NOT a replacement for it; vendor keeps any vendor-specific members (`sellJunk`) on top.
  2) `PainterHostWriters` (the write-elision facet interface): the four functions `setText(el, s)`,
     `setDisplay(el, s)`, `setTransform(el, s)`, `setWidth(el, s)`, each elided through a cache. Plus
     a factory `makeWriterFacet(cache: Map<HTMLElement, string>, onWrite, onSkip)` that returns the
     four closures so Hud can build the facet from `this.hotWriteCache` / `this.hotDomWrites++` /
     `this.hotDomSkippedWrites++` WITHOUT changing the visibility of its `private` writers (Hud keeps
     its own four methods AND constructs an equivalent facet object to hand to painters; the facet
     closures share the SAME `hotWriteCache` so the skip-rate is one number). No window-specific logic
     and no DOM-id lives in `painter_host.ts`; it is host-agnostic and Node-importable (no `window`).
- Slice B (compose, the HONEST set: ONE window composes the presentation facet):
  - vendor: adopt V16's `vendor_window` AS-IS (do not re-derive). Have `VendorWindowDeps` compose
    `PainterHostPresentation` (so the icon/money/tooltip subset is the shared base, `sellJunk` rides
    on top). Keep sell-junk exactly. Call site `hud.ts:8126` unchanged in behavior; Hud builds the
    presentation bag once and passes it where it already passes the vendor deps.
  - lockpick: leave `lockpick_window`/`lockpick_panel` and `LockpickWindowDeps` UNTOUCHED. It has no
    icon/money/tooltip dep (callbacks + its own getElementById), so there is nothing to compose. Do
    NOT force it onto the host; record in STEP 6 that it does not (and why).
  - raid_lockout: leave `raid_lockout_view.ts` UNTOUCHED. `raidLockoutPanelHtml` is a pure HTML-string
    builder consumed via `innerHTML` at `hud.ts:4166`; it owns no DOM writes and no icon/money/tooltip
    dep, so it does not compose the host either. Do NOT route its string build through the host.
- Slice C (the pilot painter + dedupe): extract `src/ui/delve_map_painter.ts`, a Canvas-2D painter
  that consumes the existing `src/ui/delve_map.ts` pure core and paints via the host's WRITE-ELISION
  facet for the DOM bits it touches (the `#zone-label` text is a `setText` write) and the Canvas-2D
  context for the schematic. It absorbs the private `drawSchematicPrimitives` helper (`hud.ts:14119`)
  as its single canvas drawer and exposes two paint entry points so it preserves BOTH behaviors:
  `paintMinimapDelve(...)` (the static schematic via `delveSchematicStatic`+`drawSchematicPrimitives`
  onto the bg ctx, PLUS the live `delveSchematicPlayer` arrow at ~10Hz, the 5034-5106 site) and
  `paintWorldMapDelve(...)` (the static schematic only, the 5567-5645 site). Replace BOTH inline sites
  with calls to it and delete the duplicated inline drawing (including the now-orphaned private
  `drawSchematicPrimitives`). Add `tests/delve_map_painter.test.ts`.
  - NOTE the pilot proves the CORE-TO-PAINTER split + the presentation/host wiring, NOT the DOM
    write-elision routing as a general rule: the schematic itself is Canvas-2D (a 2D context cannot be
    elided per locked decision 12), so the painter's canvas draws are NOT routed through the writers,
    only the `#zone-label` text is. State this boundary in the painter's header comment.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (locked decision 4): consume V16's already-extended `IWorld` only. Do NOT
  extend `IWorld` or touch `src/sim`/`server`/`src/net`/`headless`. If you find you need to, STOP
  and surface it as a scope change. (You verified `delveRun`/`entities`/`partyInfo` already exist.)
- PainterHost is a THIN, TWO-FACET compose-in host (locked decision 8), not a unified bag the windows
  migrate onto. Minimize churn to the already-tested windows: only vendor composes the presentation
  facet; lockpick and raid_lockout are left untouched because they have nothing to compose.
- The write-elision facet binds the four EXISTING writers (`setText`/`setDisplay`/`setTransform`/
  `setWidth`) and is what per-frame phases P10-P13 consume. The DOM writes a painter elides go through
  these four; CANVAS draws do NOT (a 2D context cannot be elided, locked decision 12). So "all writes
  routed through the writers" is true ONLY of DOM text/display/transform/width, never raw
  `style`/`textContent`/`setAttribute` for those four cases, and never of the Canvas schematic. Do NOT
  add `setStyleProp`/`toggleClass` here; that facet EXTENSION is P10a (locked decision 5a).
- Determinism: `delve_map.ts` (the pure core) and `delve_map_painter.ts`'s pure parts stay DOM-free /
  RNG-free; no `Math.random`/`Date.now`/`performance.now`. The painter may touch the DOM and the
  Canvas-2D context. `painter_host.ts` itself stays host-agnostic (no `window`, Node-importable).
- i18n: any NEW player-visible label goes in `src/ui/i18n.catalog/hud_chrome.ts` (English-only) via
  `t()`. Do not edit `i18n.locales/<lang>.ts`. None expected here (reusing existing windows + the
  existing `delveAreaLabel`/`#zone-label` text path).
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.

Out of scope (do NOT do in this phase):
- Extracting any of the 10 still-inline cold windows (talents/social/bags = P7; options/market/char
  = P8; map/arena/questlog/leaderboard/spellbook = P9). P6 only adopts the 3 ALREADY-extracted
  bespoke windows + the delve painter pilot.
- Any per-frame element (xp/swing/player/cast/target/party/action/auras/minimap/FCT = P10-P13).
- The `leaderboard()` paged-painter consume (P9). The effects resolver/applier (P5). Per-element
  tiering or nameplate formalization (P14).
- Any CSS work (P1-P4).

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (a pure core path + a new Canvas painter + a window
composing the host + new `.ts` modules):
- `npx tsc --noEmit` (baseline, every phase).
- `biome check` on the new/changed `.ts` (`src/ui/painter_host.ts`, `src/ui/delve_map_painter.ts`,
  `src/ui/vendor_window.ts`, the touched `hud.ts` hunks) -- the V16 lint ratchet (validation matrix).
- `npx vitest run tests/delve_map_painter.test.ts` (new) + the existing window tests must stay green:
  `vendor_view.test.ts`, `lockpick_window.test.ts`/`lockpick_panel.test.ts`, `raid_lockout_view.test.ts`,
  and the delve core `delve_map.test.ts`/`delve_render.test.ts`.
- `npx vitest run tests/architecture.test.ts` (the UI-purity guard: `painter_host.ts` and
  `delve_map_painter.ts` must not import `render`/`game`/`net`; and the hardened rule that a pure core
  must not import `painter_host`/a `*_painter` -- `delve_map.ts` must NOT import the new painter).
- `npx vitest run tests/client_shell.test.ts` if any DOM id moved into the painter (`#zone-label`,
  the minimap/bg canvas ids).
- WRITE-ELISION FACET UNIT TEST (decision 5 / 5a, the host contract this phase locks): in
  `tests/delve_map_painter.test.ts` (or a sibling `painter_host.test.ts`), drive `makeWriterFacet`
  against a FAKE cache (a plain `Map`) and assert: a repeat `setText(el, "x")` writes once then is
  elided (skip counter increments, no second DOM write); `setDisplay`/`setTransform`/`setWidth` key
  independently per element; the facet shares the supplied cache so a host with one cache has one
  skip-rate. This proves the writer facet the per-frame phases lean on, since the Canvas pilot does
  not exercise the DOM elision path at scale.
- NO-MAGIC-VALUES CANVAS GUARD (decision 12, MANDATORY: the painter is Canvas-2D): assert
  `delve_map_painter.ts` carries no literal hex / rgb / px color in TS; it resolves any `--color-*`
  token via `getComputedStyle` ONCE per redraw (cached), never per-marker / per-schematic-primitive,
  and every other literal (radius, pad, stroke width) is a NAMED constant. If the existing inline
  delve sites used raw hex, those literals become named constants or token reads in the painter.
- CLIENTWORLD-vs-SIM PARITY (decision 15, MANDATORY): feed `delve_map_painter`'s pure path BOTH a
  Sim-shaped and a ClientWorld-mirror-shaped `IWorld` stub for `delveRun`/`entities`/`partyInfo` and
  assert identical schematic primitives + `#zone-label` text from each. The minimap player schematic
  (party discs/arrows) is exactly the kind of field-shape that misrenders online if assumed Sim-only.
- WCAG 2.2 AA CHROME ROW (decision 10, MANDATORY for the window this phase touches): run axe-core (or
  equivalent) over the BUILT vendor window now that it composes the host, and assert no regression:
  keyboard reachability + focus-return on open/close, a visible `:focus-visible` never animated away,
  a `forced-colors: active` snapshot, target-size >=24px (>=40x40 on any mobile touch control). The
  delve schematic Canvas is the 3D-world-class surface that is OUT of a11y scope (not screen-readable);
  the `#zone-label` text it writes is in scope and must stay a real text node. State that boundary.
- A same-input-same-output assertion for the `delve_map` core path (both call sites produce the
  identical primitives from the same world+viewport+pad+scale).
- No PER-FRAME perf gate this phase (P6 is cold-window; the perf gate begins at P10a). Do NOT skip it
  later: the write-elision facet defined here is what those gates lean on.
Review dispatch (spawn ONLY the rows the diff touches): `qa-checklist` only. `cross-platform-sync`
should NOT fire (consuming the already-landed IWorld in a painter does not change it; the parity
obligation is met by the per-core test above, not by spawning the reviewer);
`privacy-security-review`/`migration-safety` do not apply (no server/net/admin/db/secret/RNG).
Prompt the reviewer for COVERAGE not filtering; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scoped, EXPLICIT paths):
- `feat(ui): add two-facet PainterHost (presentation bag + write-elision facet)` --
  `src/ui/painter_host.ts`.
- `refactor(ui): compose PainterHost presentation bag into vendor window` -- `src/ui/vendor_window.ts`
  `src/ui/hud.ts` (the vendor call site at 8126 + where Hud builds the writer facet from
  `hotWriteCache`; lockpick/raid are intentionally NOT changed).
- `refactor(ui): extract delve_map_painter and dedupe minimap+world-map delve` --
  `src/ui/delve_map_painter.ts` `src/ui/hud.ts` (the 5034-5106 + 5567-5645 hunks).
- `test(ui): cover delve_map_painter, write-elision facet, and Sim/ClientWorld parity` --
  `tests/delve_map_painter.test.ts`.
- `docs(frontend): record P6 two-facet PainterHost seam in state/progress` -- the two doc files (STEP 6).

STEP 5 - ACCEPTANCE CRITERIA (all items verifiable and green):
- [ ] `src/ui/painter_host.ts` exists with TWO facets: a `PainterHostPresentation` dep-bag
      (icon/money/tooltip, the vendor glue shape) and a write-elision facet (the four writers +
      `makeWriterFacet` factory over a supplied cache). No window-specific logic, no DOM id, no
      `window` access; Node-importable.
- [ ] `VendorWindowDeps` COMPOSES `PainterHostPresentation` (the icon/money/tooltip subset is the
      shared base; `sellJunk` rides on top). Vendor behavior incl sell-junk is byte-identical;
      `vendor_view.test.ts` is green.
- [ ] `lockpick_window.ts`/`lockpick_panel.ts`/`LockpickWindowDeps` are UNCHANGED, and
      `raid_lockout_view.ts` is UNCHANGED (both have nothing to compose). STEP 6 records why.
- [ ] Hud builds the write-elision facet from its own `hotWriteCache`/counters WITHOUT changing the
      visibility of its four `private` writers, and the facet shares the SAME cache (one skip-rate).
- [ ] `src/ui/delve_map_painter.ts` exists (Canvas-2D), consumes the `src/ui/delve_map.ts` pure core,
      exposes `paintMinimapDelve` + `paintWorldMapDelve`, and its header comment states the Canvas
      schematic is NOT routed through the write-elision facet (only the `#zone-label` text is).
- [ ] BOTH inline delve render sites (`hud.ts:5034-5106` and `hud.ts:5567-5645`) are replaced with
      painter calls and the duplicated inline drawing is deleted; both paint behaviors are preserved.
- [ ] `delveRun`/`entities`/`partyInfo` are confirmed present on `IWorld`; nothing in `src/sim`/
      `server`/`src/net`/`headless`/`world_api.ts` is touched.
- [ ] `npx tsc --noEmit` clean; `biome check` clean on every new/changed `.ts`.
- [ ] `tests/delve_map_painter.test.ts` green and includes: the write-elision facet unit test against
      a fake cache (write-once-then-elide per key), the no-magic-values canvas assertion
      (getComputedStyle-once token resolution, no literal colors, every other literal a named const),
      the ClientWorld-vs-Sim parity assertion (Sim-shaped + ClientWorld-mirror-shaped `IWorld` stubs
      produce identical primitives + label), and the both-sites-same-output assertion.
- [ ] `tests/architecture.test.ts` green (purity guard: new modules import no render/game/net; the
      pure core does not import the painter/host).
- [ ] WCAG 2.2 AA chrome row green over the BUILT vendor window (axe-core no regression; keyboard
      reach + focus-return; visible non-animated `:focus-visible`; forced-colors snapshot; target-size
      >=24px, >=40x40 on mobile touch controls). The delve Canvas a11y boundary is stated honestly.
- [ ] `qa-checklist` reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update `docs/frontend-modernization/progress.md` (mark P6 done, list new files).
- Update `state.md`: ledger row P6 -> done; add `src/ui/painter_host.ts` + `src/ui/delve_map_painter.ts`
  to the key file paths; note the TWO-FACET PainterHost contract for the later phases to reuse:
  (1) the presentation dep-bag (icon/money/tooltip), composed by vendor only, the shape P7-P9 cold
  windows reuse; (2) the write-elision facet binding the four existing writers over `hotWriteCache`,
  the shape P10a EXTENDS with `setStyleProp`/`toggleClass` (decision 5a) and P10-P13 consume. Record
  that lockpick and raid_lockout do NOT compose the host (callbacks-only / pure-string-builder, nothing
  to compose) so a later reader does not "fix" them.
- Record any surprising rule in memory (the FB-carryover "3 windows migrate onto a unified bag" was
  wrong: only vendor uses icon/money/tooltip; the delve pilot is Canvas-2D so it proves the
  core-to-painter split + the facet wiring, not the DOM elision path at scale; the minimap-vs-world-map
  delve call-site difference the dedupe had to preserve).

STEP 7 - FINAL RESPONSE:
Report status (done / blocked), the files touched (absolute paths), validation results (tsc + biome +
each vitest file + purity guard + the write-elision facet test + the no-magic-values canvas guard +
the Sim/ClientWorld parity assertion + the WCAG row over the vendor window), the qa-checklist verdict,
any deferrals, and end with exactly:
Next: phase-07a-coldwindow-talents.md

STOPPING RULES:
- STOP and surface as a scope change if the phase finds it needs to extend `IWorld` or touch
  `src/sim`/`server`/`src/net`/`headless`/`world_api.ts` to make vendor compose the host or to feed
  the delve painter (locked decision 4). (You verified `delveRun`/`entities`/`partyInfo` exist; if any
  is actually absent, that is the scope change.)
- STOP if `VendorWindowDeps` cannot compose the thin presentation facet WITHOUT migrating it onto a
  unified bag (that would violate locked decision 8); re-confirm the thin two-facet shape before forcing it.
- STOP if you find yourself adding icon/money/tooltip usage to lockpick or raid_lockout to "adopt"
  them: they have nothing to compose (callbacks-only / pure HTML-string builder); leave them untouched.
- STOP if the two delve call sites are NOT actually duplicable (a real semantic difference beyond the
  known one: both draw the static schematic, but only the minimap also paints the live player arrow at
  ~10Hz) rather than papering over it; preserve both behaviors via the painter's two entry points.
- STOP if composing vendor collapses or bypasses the write-elision path (raw style/textContent for a
  text/display/transform/width write) instead of routing through the facet's elided writers. (The
  Canvas-2D schematic is the documented exception per locked decision 12, not a bypass.)
- STOP if you reach for `setStyleProp`/`toggleClass` on the facet here: that EXTENSION is P10a
  (locked decision 5a). P6 binds only the four existing writers.
```

## Notes for the planner

P6 is shaped as a small surgical pilot, not a batch, because the candidate target windows are ALREADY
extracted on V16, so the real work is just defining the two-facet host and proving one new painter end
to end. The deep review corrected the FB-carryover error in the original draft: the host shape
(icon/money/tooltip + the four elided writers) does NOT fit all three named windows. Verified against
live source, ONLY vendor uses icon/money/tooltip (`itemIcon`/`moneyHtml`/`attachTooltip`/`itemTooltip`,
via innerHTML); lockpick's deps are pure callbacks (`getState`/`tierName`/`onEngage`/`onAction`/
`onAbort`/`onClose`) plus its own `getElementById`; and `raid_lockout_view` is a pure HTML-string
builder (`raidLockoutPanelHtml` + `RaidLockoutI18n`) consumed via innerHTML. So the host is factored
into TWO facets (locked decision 8): a presentation dep-bag vendor composes, and a write-elision facet
that binds the four `private` Hud writers as closures (per the vendor-template glue, no visibility
change) for the per-frame phases. The delve pilot is deliberately Canvas-2D, so it proves the
core-to-painter split + the dep-bag wiring, NOT the DOM write-elision path at scale; a tiny unit test
exercises the writer facet against a fake cache so the contract P10-P13 lean on is still validated
here. The minimap-vs-world-map delve dedupe is the low-stakes place to discover the call-site
asymmetry (live player schematic at ~10Hz vs static bg-canvas schematic once) before the higher-churn
batches. The two facets are the load-bearing deliverable: P7-P9 reuse the presentation bag, and P10a
EXTENDS the write-elision facet with `setStyleProp`/`toggleClass` (locked decision 5a) that the hot
paths need but the four existing writers cannot express.
