# Phase P7b: Cold-window: social + bags

Extract two still-inline classic windows (social, bags) out of the `hud.ts` monolith into a pure
`*_view.ts` core plus a thin painter composed through the PainterHost seam P6 introduced, one slice
each. Social is not purely cold: it repaints on the 500ms `slowHud` divider with per-refresh listener
churn, so the painter must use event delegation / attach-once. Bags reuses the already-extracted
`bag_filter.ts`. Presentation-only: do not touch sim/server/net.

## Starter Prompt

```
This is Phase P7b of the Frontend Modernization v0.16.0 packet: Cold-window extraction, social + bags.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. Two independent windows (social, bags) touch disjoint hud.ts ranges and share no private state, so this is the multi-slice batch shape state.md flags for ultracode + a Workflow (parallel fan-out, one slice per window, plus adversarial verify).

Goal: Move renderSocial (hud.ts:12025) and renderBags (hud.ts:8839) out of the hud.ts monolith into the FB Humble-Object shape: a pure host-agnostic src/ui/<name>_view.ts core that derives a render model from IWorld (registered in the P0 UI-purity allowlist), plus a thin src/ui/<name>_window.ts painter that paints that model into the DOM through the PainterHost dep-bag from P6 (icon/money/tooltip helpers + the elided writers). Each window is presentation-only: it consumes V16's already-landed IWorld and changes no signature. Preserve the load-bearing behaviors exactly: social-list event listeners not duplicated on re-render (social repaints on a timer, see below), and bag filtering (bag_filter.ts is already extracted on V16, reuse it). client_shell.test.ts must be updated for any DOM ids that move from hud.ts into a painter.

CRITICAL - SOCIAL IS NOT PURELY COLD. renderSocial repaints on the 500ms slowHud frame divider: hud.update() at hud.ts:4087 calls this.renderSocial() when #social-window is open and the socialStructSig() changes (a JSON struct-sig diff over sim.socialInfo + sim.partyInfo). So it re-renders on a cadence, NOT only on open, and the inline path re-attaches row listeners on each repaint = the innerHTML-wipe -> listener-churn hazard. The painter MUST use event delegation (one listener on the list container, dispatch on data-* row attributes) OR attach-once with a keyed update, so a repaint does NOT re-attach per-row click/contextmenu handlers. Keep the socialStructSig() diff-gate so a no-op cadence tick does not repaint. Treat the 500ms cadence as a named constant, not a bare 500.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This is a shared checkout; if it is not clean, STOP and ask the user before touching anything.
- Memory scan: read MEMORY.md and the entries [[frontend-phase7-hud-window-extraction]] (the FB cold-window extraction, the proven core+painter+PainterHost seam pattern, the purity-guard hardening that rejects a pure core importing a *_painter/painter_host, and the sed-clip hazard), [[frontend-phase6-window-encapsulation]] (window @layer/#id isolation), and [[frontend-phase8-graphics-tier-effects]] (live computed-style proof > static CSS-text guards).
- Confirm you are in the feature/frontend-modernization-v016 worktree (off release/v0.16.0).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a compact brief (not raw dumps):
- docs/frontend-modernization/state.md. Cite by section: locked decisions 4 (presentation-only), 6 (PainterHost two facets), 9 (component contract: instance-parameterized core + thin painter), 10 (WCAG 2.2 AA on the window, built IN here not deferred to P15), 12 (no magic values in painters), 15 (ClientWorld-vs-Sim parity for cores); the non-negotiable constraints; the validation matrix (the WINDOW-or-CONTROL row is MANDATORY); the review dispatch matrix; and the Key file paths (renderBags 8839, renderSocial 12025 repaints on the 500ms slowHud divider with listener churn).
- This phase file (phase-07b-coldwindow-social-bags.md).
- The "### P7-P9 Cold-window extraction" section of docs/frontend-modernization/v016-recon-and-packet.md plus its "Load-bearing structural findings" + "Top risks" sections.
- The SPECIFIC source ranges this phase touches, with their real V16 line numbers:
  - renderBags: hud.ts:8839 (scroll-offset preservation at ~8843; the qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff' at hud.ts:8889; and the already-extracted bag_filter.ts it must reuse, imported at hud.ts:138).
  - renderSocial: hud.ts:12025 (and the cadence call site at hud.ts:4087-4097: slowHud + #social-window open + socialStructSig() diff). Find where it attaches click/contextmenu/etc listeners to social rows.
  - For the seam: src/ui/painter_host.ts (from P6) and the FB-ported vendor_window.ts/vendor_view.ts as the template the new windows must match.
  - tests/architecture.test.ts UI_PURE_CORES allowlist and tests/client_shell.test.ts (moved DOM ids).
The orchestrator keeps the summary, not the raw file dumps. Two windows is the planned batch size and fits well under 40%; if the working set approaches the ceiling, land social first (it carries the listener-churn risk), then bags.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode Workflow, fan out TWO parallel slices (request fan-out explicitly), one per window, because the two hud.ts ranges are disjoint and the windows share no private state. Use isolation: "worktree" only if both slices would edit the same shared file concurrently (architecture.test.ts allowlist and client_shell.test.ts are shared sink files; have the slices return their allowlist/id edits and let the orchestrator apply them serially, OR isolate). Each slice:
  - Slice A - SOCIAL (hud.ts:12025): create src/ui/social_view.ts (pure core: derive the friends/guild/ignore/raid list render model from IWorld - sim.socialInfo + sim.partyInfo - including the socialStructSig() shape, host-agnostic, no DOM/Three) + src/ui/social_window.ts (thin painter via PainterHost). CRITICAL: the painter must NOT duplicate row click/contextmenu listeners on a repaint (social re-renders on the 500ms slowHud cadence, not just on open). Use event delegation (one container listener dispatching on data-* row ids) OR attach-once with a keyed update. Keep the socialStructSig() diff-gate so a no-op tick does not repaint. The 500ms cadence is a named constant. Register social_view in UI_PURE_CORES. Add tests/social_view.test.ts (struct-sig stable across no-op ticks; render model derives the right tab list).
  - Slice B - BAGS (hud.ts:8839): create src/ui/bags_view.ts (pure core: derive the bag-grid render model from IWorld) + src/ui/bags_window.ts (thin painter). REUSE the already-extracted bag_filter.ts for filtering, do not re-derive it. Preserve the .bag-grid scroll-offset capture-and-reapply (hud.ts:8843; otherwise using an item snaps the list to the top). NO MAGIC VALUES: the item-quality color qColor = QUALITY_COLOR[item.quality ?? 'common'] ?? '#fff' (hud.ts:8889) keeps QUALITY_COLOR but the bare '#fff' fallback becomes a named constant / token (a --color-quality-default custom property), not a raw hex in the painter. Register bags_view in UI_PURE_CORES. Add tests/bags_view.test.ts (filtering preserved via bag_filter).
After fan-out, the orchestrator integrates serially: apply each slice, run tsc after each (the FB lesson: interleaved sed-style clips compile-break silently, so tsc x N), wire the delegate calls in hud.ts (renderBags AND the renderSocial cadence call site at 4087), and reconcile the shared sink edits (UI_PURE_CORES allowlist + client_shell.test.ts ids).

INVARIANTS THIS PHASE MUST KEEP (state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY (decision 4): consume V16's already-extended IWorld; do NOT extend IWorld or touch src/sim, server, src/net, or headless. If a window appears to need a new IWorld member, STOP and surface it.
- PainterHost is a THIN compose-in host (decision 6): the new windows compose its dep-bag (icon/money/tooltip + elided writers); do not invent a new seam.
- Pure cores stay DOM/Three-free and deterministic: no Math.random / Date.now / performance.now in any registered *_view core (guarded by tests/architecture.test.ts + UI_PURE_CORES; the guard also rejects a pure core importing a *_painter / painter_host).
- i18n: every player-visible label rendered by these windows stays a t() key; any NEW control label goes in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. No concat, no `?? 'English'` fallback for labels.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits).
- Shared worktree: commit with EXPLICIT paths, never `git add -A`.

Out of scope (do NOT do in this phase):
- talents = P7a; options/market/char = P8a/P8b; map/arena/questlog/leaderboard/spellbook = P9a/P9b.
- Any per-frame / hot-path element (xp bar, frames, bars, action bar, auras, minimap, FCT) = P10-P14. Social's 500ms cadence repaint stays exactly that (a slow-divider cold-ish repaint), do NOT move it into the every-frame or fast/medium band; keep the diff-gate.
- CSS extraction for these windows (handled in P3 components.css); do not move CSS here.
- Per-element graphics tiering (P14). No fxLevel knobs on these windows.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md "Validation matrix"):
- Baseline: `npx tsc --noEmit`.
- Pure cores added (two): `npx vitest run tests/social_view.test.ts tests/bags_view.test.ts` + `npx vitest run tests/architecture.test.ts` (UI-purity guard, confirms both new cores are in UI_PURE_CORES and DOM/Three-free) + a same-input-same-output assertion per core.
- ClientWorld-vs-Sim parity (decision 15, MANDATORY): feed EACH *_view core BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub and assert identical render models. For social this matters most: sim.socialInfo / sim.partyInfo cadence and shape must mirror online (party out-of-range and presence fields are the offline-only-shape trap); the struct-sig must be stable across both. For bags, drive the grid model from both world shapes.
- New .ts modules added: `biome check` on src/ui/social_view.ts + src/ui/social_window.ts + src/ui/bags_view.ts + src/ui/bags_window.ts (the V16 ratchet; do not accrue lint debt).
- DOM ids moved: `npx vitest run tests/client_shell.test.ts` (update greps for any id now living in a painter).
- WINDOW or CONTROL changed (MANDATORY, decision 10): the WCAG 2.2 AA chrome checks over the BUILT social + bags windows: automated axe-core (or equivalent) clean; keyboard reachability of the close button, the social tablist (friends/guild/ignore/raid) and each actionable row (add-friend / invite / ignore / context actions reachable without a right-click-only path); focus-return to the opener on close; a visible :focus-visible never animated/transitioned away; a forced-colors: active snapshot (item-quality and online/offline state survive when carried by color alone - add a non-color cue); target-size >= 24px for tabs/rows/bag-cells and >= 40x40 on any mobile touch control. The bag cells and social rows are the target-size focus.
- No-magic-values painter guard (MANDATORY, decision 12): DOM painters reference tokens / CSS custom properties / named constants. The social 500ms cadence and the bags '#fff' quality fallback become named constants / tokens; QUALITY_COLOR stays (it is the shared quality map) but no NEW raw hex/px/cadence literal survives in either painter. A guard or grep in the tests asserts no raw `#` hex literal and no bare `500` in the painters.
- Full pre-commit sanity: `npm test` (the guards live in the suite).
This is NOT a per-frame phase, so there is NO perf gate (no perf_tour, no skip-rate assertion): bags is open-on-demand and social repaints only on the slow 500ms divider behind a diff-gate, neither is in hud.update()'s every-frame path.
Review dispatch (state.md Review Dispatch Matrix): spawn qa-checklist only. privacy-security-review / migration-safety / cross-platform-sync do NOT fire (no server/net/IWorld/sim/wire change; consuming the already-landed IWorld in a painter is not an IWorld change). Prompt the reviewer for COVERAGE not filtering; do not commit until it reports no BLOCKING. If a reviewer truncates, resume with: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 4 - COMMIT CADENCE:
2 to 5 Conventional Commits with a scope and EXPLICIT paths (never `git add -A`). Suggested:
- `refactor(ui): extract social window to social_view core + delegated painter` (src/ui/social_view.ts src/ui/social_window.ts src/ui/hud.ts).
- `refactor(ui): extract bags window to bags_view core + painter` (src/ui/bags_view.ts src/ui/bags_window.ts src/ui/hud.ts).
- `test(ui): register social/bags cores in UI_PURE_CORES + ClientWorld-vs-Sim parity` (tests/social_view.test.ts tests/bags_view.test.ts tests/architecture.test.ts).
- `test(ui): update client_shell ids for social/bags painters` (tests/client_shell.test.ts) - only if ids moved.
- `docs(frontend): record P7b social+bags extraction in progress.md + state.md ledger` (docs/frontend-modernization/progress.md docs/frontend-modernization/state.md).

STEP 5 - ACCEPTANCE CRITERIA:
- [ ] `npx tsc --noEmit` is clean.
- [ ] social and bags each have a pure src/ui/<name>_view.ts core (no DOM/Three import, no Math.random/Date.now/performance.now) and a thin src/ui/<name>_window.ts painter composed through PainterHost.
- [ ] Both new view cores are registered in UI_PURE_CORES and `npx vitest run tests/architecture.test.ts` passes (purity guard green, incl rejecting a *_painter/painter_host import from a core).
- [ ] tests/social_view.test.ts and tests/bags_view.test.ts each pass with a same-input-same-output assertion AND the ClientWorld-vs-Sim parity assertion (both Sim-shaped and ClientWorld-mirror-shaped stubs yield identical render models).
- [ ] Social repaints on the 500ms slowHud divider behind the socialStructSig() diff-gate, and the painter does NOT duplicate row click/contextmenu listeners across repaints (event delegation / attach-once, verified by a test or in review). The 500ms cadence is a named constant.
- [ ] Bag filtering is preserved by reusing bag_filter.ts (not re-derived); the .bag-grid scroll offset is captured and reapplied; bags_view test exercises a filtered render.
- [ ] WCAG 2.2 AA chrome row green for both windows: axe clean; tabs/rows/cells/actions keyboard-reachable (no right-click-only path); focus-return on close; visible :focus-visible never animated away; forced-colors snapshot keeps quality + online/offline legible via a non-color cue; target-size >= 24px (>= 40x40 mobile).
- [ ] No-magic-values guard green: the social 500ms cadence and the bags '#fff' quality fallback are named constants / tokens; no new raw hex or bare 500 in either painter.
- [ ] `npx vitest run tests/client_shell.test.ts` passes with any moved DOM ids updated.
- [ ] `biome check` on the four new .ts modules is clean.
- [ ] `npm test` is green.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] hud.ts renderSocial/renderBags are now thin delegates (the 4087 cadence call site delegates too); no IWorld/sim/server/net/headless file changed; no i18n.locales overlay edited.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md: mark P7b complete with the module list (social_view/window, bags_view/window), the test files, the hud.ts line-count delta, and any deferral.
- Update state.md: flip the P7b ledger row to done; if UI_PURE_CORES or the client_shell id list grew, note it in Key file paths / ledger.
- Record surprising rules in memory: that renderSocial is a 500ms-cadence repaint (not purely cold) and the exact listener pattern chosen (delegated vs attach-once), the bag-grid scroll-offset preservation, whether either window needed isolation: "worktree" to avoid a shared-sink-file clash, and any sed-clip / interleaved-edit hazard hit.

STEP 7 - FINAL RESPONSE:
Report: status (done / done-with-deferral), files created/changed (absolute paths), validation results (tsc, the two core tests incl parity, architecture guard, WCAG row, no-magic-values guard, biome, client_shell, npm test), the qa-checklist verdict, and any deferral. End with exactly:
Next: phase-08a-coldwindow-options.md

STOPPING RULES:
- STOP and surface a scope change if either window appears to need a NEW IWorld member or a sim/server/net change (the phase is presentation-only; consuming the landed IWorld is fine, extending it is not).
- STOP if a window cannot be made a pure core + thin painter without leaking DOM/Three into the core (do not weaken the purity guard to make it pass).
- STOP and split the phase if the working set approaches the ~40% context ceiling (land social first, defer bags to a follow-up slice).
- Do NOT touch any per-frame / hot path; if you find yourself editing hud.update()'s every-frame / fast / medium band, you are in the wrong phase (social's 500ms slow-divider diff-gated repaint is the only cadence touch allowed).
```

## Notes for the planner

P7b pairs the two IWorld-derived cold windows that share the same FB Humble-Object port-and-adapt shape,
so it stays ultracode-parallelizable across the two disjoint `hud.ts` ranges. The key correctness point
the deep review surfaced is that social is NOT purely cold: hud.update() repaints it on the 500ms
slowHud divider behind a `socialStructSig()` diff-gate (hud.ts:4087), so the inline path re-attaches row
listeners on every cadence tick. The painter must use event delegation or attach-once so a repaint never
churns per-row click/contextmenu handlers, and the 500ms cadence becomes a named constant. The other
deep-review additions are the WCAG row (tablist + actionable rows + bag cells keyboard-reachable, a
forced-colors non-color cue for item quality and online/offline, target-size on cells/rows), the
no-magic-values tokenizing of the social cadence and the bags `#fff` quality fallback (keeping the shared
QUALITY_COLOR map), and the ClientWorld-vs-Sim parity assertion (social's `socialInfo`/`partyInfo` shape
and the party out-of-range/presence fields are the offline-only-shape trap). Bags reuses the already
extracted `bag_filter.ts` and must preserve the .bag-grid scroll-offset capture-and-reapply.
