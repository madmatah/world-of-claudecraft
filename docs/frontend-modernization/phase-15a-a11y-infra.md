# Phase P15a: Accessibility infra: focus manager + skip links + live regions + forced-colors + minimal print

The GLOBAL accessibility pieces no single window owns: ONE shared focus manager that subsumes every
ad-hoc restoreFocus / focusFirstInteractive / dropdown-focus-return call site into a real trap + return
+ Esc system; skip links (reusing the src/guide/chrome.ts:85 precedent); chat + combat live regions
with politeness chosen per type behind a pure helper; a forced-colors pass; a minimal print reset; and
dropping the user-scalable=no viewport lock. The chrome-wide axe + keyboard E2E audit and the
per-window fixes are P15b. The 3D world/canvas is OUT of scope (not screen-readable) and that boundary
is stated honestly, not papered over.

## Starter Prompt

```
This is Phase P15a of the Frontend Modernization v0.16.0 packet: Accessibility infra: focus manager + skip links + live regions + forced-colors + minimal print.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: no. This is shared-infra integration: five GLOBAL slices (focus manager, skip links, live regions, forced-colors CSS, print reset) plus the viewport-lock drop, integrated SEQUENTIALLY into hud.ts wiring + the extracted CSS + both HTML entries. It is a single coherent layer (one focus manager, one set of live regions), not a per-window fan-out, so do not spawn parallel impl agents; one Explore agent for context, sequential implementation, then the reviewer.

Goal: add the GLOBAL accessibility pieces that no single window owns. (1) ONE shared focus manager (src/ui/focus_manager.ts): trap Tab/Shift+Tab inside an open window, route Esc to close, RETURN focus to the opener on close, subsuming EVERY existing ad-hoc focus call site so there is one system not two. (2) Skip links ("skip to main HUD", "skip to chat") as the first focusable elements, reusing the src/guide/chrome.ts:85 precedent. (3) Chat (#chatlog polite) + combat live regions with politeness picked PER TYPE behind a pure helper, reconciled against the existing aria-live nodes so nothing double-announces, on a NAMED combat-announce cadence constant. (4) A @media (forced-colors: active) block (decision 11). (5) A minimal @media print reset (decision 14). (6) Drop the user-scalable=no / maximum-scale=1.0 viewport lock (decision 10). The 3D world/canvas is OUT of a11y scope (not screen-readable): state that boundary in code comments and the docs, do not fake aria over the game world. The chrome-wide axe + keyboard E2E AUDIT and the per-window roles/aria fixes are P15b; this phase ships the infra those tests exercise.

STEP 0 - PRE-FLIGHT:
- `git status` must be clean. This worktree is a shared checkout; if it is dirty, STOP and ask the user before touching anything. Do not stash or revert a concurrent session's work.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md plus the frontend-modernization entries: frontend-architecture-vanilla-stack (the opt-in Vitest 4 Browser Mode suite at vitest.browser.config.ts / npm run test:browser is set up in P15b, not here), the P7-P14 phase entries for what a11y each window already carries (so the live-region + focus-manager wiring does not fight a per-window aria-live), phased-packet-qa-cadence, no-em-dashes-or-emojis, and shared-worktree-commit-care. KEY FB LESSON to carry: a visible :focus-visible ring must NEVER be animated, blurred, transitioned, or filtered away; the skip-link reveal CSS this phase adds must keep its :focus-visible ring steady (the guard that asserts this lands in P15b's chrome-wide slice).

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read + summarize back (the orchestrator keeps the summary, not raw dumps):
- docs/frontend-modernization/state.md - locked decision 10 (accessibility scope; focus management trap+return; skip links; live regions; target-size SC 2.5.8 >=24px absolute floor PLUS the 40x40px mobile touch floor; and the directive to DROP the user-scalable=no / maximum-scale=1.0 viewport lock live at index.html:5 / play.html:5, the 16px input-font floor being the anti-zoom guard), decision 11 (forced-colors support, NO light theme / NO prefers-color-scheme branch), decision 14 (browser matrix + the MINIMAL @media print reset), decision 12 (NO MAGIC VALUES: the combat-announce cadence is a NAMED constant, CSS references token vars not literals), the non-negotiable constraints (presentation-only, i18n, EXPLICIT commit paths, no em/en dashes), the canonical workflow, and the Review Dispatch Matrix.
- docs/frontend-modernization/progress.md - the P1-P4b rows (where the focus-visible CSS for chrome controls now lives, so the skip-link/forced-colors/print sections EXTEND the extracted src/styles rather than re-author them) and the P7-P14 rows (what aria-live / focus each window already carries).
- this phase file in full.
- v016-recon-and-packet.md "Load-bearing structural findings" + the focus-a11y key-paths block (the ad-hoc focus helpers at hud.ts:2570-2604).
- the SPECIFIC V16 source ranges only, read narrowly by line range:
  - The existing ad-hoc focus helpers the shared manager UNIFIES (do not leave two systems): src/ui/hud.ts:2570-2604 (canRestoreFocusTo 2570, currentFocusableElement 2574, restoreFocus 2583, focusFirstInteractive 2593 with the canonical focusable selector spelled inline at 2598). LIFT that selector string to ONE named constant; do not re-spell it in the new module.
  - THE FULL CALLER SET (the deep review found the draft's "6 callers" inventory INCOMPLETE; this is the two-systems hazard, so GREP the full set, do not trust a fixed list). On V16 today this is ~6 restoreFocus callers, ~9 focusFirstInteractive callers, PLUS a distinct dropdown / button focus-return idiom. As a STARTING grep (re-run it, line numbers will have shifted under P1-P14): `grep -n 'restoreFocus\|focusFirstInteractive\|\.focus(' src/ui/hud.ts`. The known set to account for: restoreFocus callers closeDelveBoard 4513/4519, closeLockpick 4675/4687, closeQuestDialog 7894/7901, the social rebuild path 9204, closePlayerCardModal 10004/10012, closeQuestLog 11390/11395; focusFirstInteractive callers 4456, 4538, 7699, 7779, 7849, 7891, 9877, 11501, 13393; and the dropdown/btn focus-return idiom that is NOT restoreFocus (the options dropdown close `btn.focus()` ~10509, the roving `items[focusIndex].focus()` ~10501/10558, the skin-swatch focus ~9819, the dropdown anchor.focus ~10648/10656, the quest-tracker header refocus ~4326). Every one of these is either a TRAP-member or a RETURN-to-opener, and must route through the one manager (or its decision documented if it legitimately cannot).
  - The per-window Escape handlers already present (lockpick 4621/4640, the inline close() patterns 9044/9090) so Esc-closes is unified, not duplicated.
  - The chat + combat panes that become live regions: this.chatLogEl = #chatlog (hud.ts:742), this.combatLogEl = #combatlog (hud.ts:748); the combatLog() emitter and its callers (hud.ts ~6112-6425); the chatlog DOM in play.html / index.html (chatlog-wrap / chatlog-tabs / chatlog-frame). The FCT path landed in P13a/P13b (src/ui/fct_painter.ts) for the combat-text announcement question.
  - The existing aria-live nodes to RECONCILE (do not double-announce): hud.ts:7923 (root polite), 9859 (.pc-status polite), 11874 (#report-error role=alert + aria-live polite), 13129 (a note that role=alert already implies assertive, so no second aria-live), 13369/13373 (the async-locale status polite); play.html / index.html login/charselect aria-live fields. The combat live region must NOT re-announce text a role=alert node at 11874 already speaks.
  - The user-scalable=no / maximum-scale=1.0 viewport <meta> at index.html:5 and play.html:5 (this phase drops the scale-lock; KEEP width=device-width, initial-scale=1.0, viewport-fit=cover).
  - The src/guide/chrome.ts:85 skip-link precedent to REUSE: `<a class="guide-skip" href="#guide-main">${esc(t('guide.skipToContent'))}</a>` plus its CSS pattern (visually hidden until :focus-visible). The HUD skip links mirror this shape (a different label key, a HUD target id).
  - The focus-visible CSS already extracted to src/styles in P1-P4b (the .x-btn / .action-btn / .chat-tab / range / checkbox focus-visible rules now in components.css/base.css) so the skip-link + forced-colors + print sections EXTEND them in the same files, accounted by css_corpus.
  - tests/architecture.test.ts UI_PURE_CORES allowlist (the new live-region politeness pure helper REGISTERS here), tests/css_corpus.test.ts (the new skip-link + forced-colors + print CSS sections must be accounted by a 10-dash marker), tests/client_shell.test.ts (the new skip-link + live-region DOM ids assert here).
Have the agent return: the FULL deduplicated caller inventory (every site, classified trap-member vs return-to-opener vs Esc-close), the aria-live reconciliation map (which existing node speaks what, so the new combat region does not overlap), the current viewport <meta> on both entries, and the exact src/styles file + 10-dash section the focus-visible chrome rules currently live in.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE (sequential, single orchestrator; no impl fan-out):
INFRA-1 Focus manager (src/ui/focus_manager.ts): a single small INSTANCE-PARAMETERIZED module (decision 9: no hardcoded element ids, no single-instance assumption). On window OPEN it records the opener (the element to return to, reuse the currentFocusableElement idiom), TRAPS Tab/Shift+Tab within the open window's focusable set (using the ONE lifted FOCUSABLE_SELECTOR constant, never a re-spelled string), routes Esc to a supplied close callback, and on close RETURNS focus to the recorded opener (subsuming restoreFocus). The trap touches document.activeElement and listens on the document, so it is WIRING, NOT a registered pure core. The DOM-FREE piece is a pure focusable-ORDER helper (given an array of element descriptors, return the cycle order / the next/prev index on Tab/Shift+Tab so trap order matches reading order) and the live-region politeness picker (INFRA-3): those register in UI_PURE_CORES. Document the wiring-vs-core split in a header comment. Migrate EVERY caller from STEP 1's full inventory: the restoreFocus callers and the dropdown/btn focus-return idioms become `focusManager.open(window, { onClose })` / the manager's return path; the focusFirstInteractive callers become the manager's "focus first interactive in the trapped set" entry point (keep the existing preferredSelector behavior). After migration there must be NO surviving ad-hoc restoreFocus / focusFirstInteractive / raw return-to-opener .focus() on a window-close path; if one legitimately cannot migrate (e.g. a non-window control), document WHY in a comment and surface it in STEP 7. Logical tab order: ensure the trap order matches DOM reading order.
INFRA-2 Skip links: add "skip to main HUD" and "skip to chat" links as the FIRST focusable elements in play.html + index.html, REUSING the src/guide/chrome.ts:85 precedent shape (an <a> visually hidden until :focus-visible, href to the target id). Labels via t() keys in src/ui/i18n.catalog/hud_chrome.ts (English-only; control labels are the hud_chrome English-only exception); do NOT reuse guide.skipToContent verbatim, add HUD-domain keys. Targets: the main HUD container id and #chatlog (add an id/tabindex=-1 landing target if #chatlog is not directly focusable). The visible-on-focus skip-link CSS goes in the extracted src/styles (a NEW css_corpus-accounted 10-dash section), NOT inline, and references token vars not literal hex/px (decision 12). The :focus-visible reveal ring must be steady (no transition/animation/filter on it).
INFRA-3 Live regions: make chat (#chatlog) announced POLITE and add a combat live region whose politeness is chosen PER TYPE by a PURE helper (the live-region politeness picker, registered in UI_PURE_CORES, DOM-free, same-input-same-output): routine combat damage is visual-only and noisy, so announce it sparingly via an OFF-SCREEN polite combat summary on a throttle, NEVER assertive spam; reserve assertive purely for the genuinely urgent alerts already using role=alert (hud.ts:11874/13129). Define a NAMED constant COMBAT_ANNOUNCE_INTERVAL_MS (decision 12: the cadence is a named constant, not a literal) governing how often the polite combat summary updates so a damage burst does not flood the screen reader. RECONCILE with the existing aria-live nodes (hud.ts:7923, 9859, 11874, 13369/13373; the entry login/charselect fields) so nothing double-announces: if a node already speaks an event, the new region must not repeat it. The 3D world stays OUT (not screen-readable): state it in a comment near the live-region wiring.
INFRA-4 forced-colors (decision 11): a `@media (forced-colors: active)` block in the extracted CSS so borders + the focus ring SURVIVE high-contrast, no meaning is carried by a background-image / background-color alone (icons/state-dots that encode state get a text or border fallback), and system-color keywords (CanvasText, Highlight, ButtonBorder, ButtonText) are used where a forced palette applies. There is NO light theme and NO prefers-color-scheme branch (decision 11): forced-colors is the ONLY contrast adaptation. A snapshot test asserts the block is present + shape-correct. NEW 10-dash css_corpus section.
INFRA-5 Minimal print (decision 14): a `@media print` reset that HIDES the game canvas + the HUD chrome (a full-screen real-time game has no print layout). Minimal by design: hide, do not reflow. NEW 10-dash css_corpus section.
INFRA-6 Drop the viewport scale-lock (decision 10): edit index.html:5 and play.html:5 to REMOVE `maximum-scale=1.0, minimum-scale=1.0, user-scalable=no` (keep `width=device-width, initial-scale=1.0, viewport-fit=cover`). This fails SC 1.4.4 / 1.4.10; the 16px input-font floor (the anti-zoom guard already noted in the inline comments at play.html / index.html) is what prevents iOS focus-zoom, so removing the lock is safe. This DROP lands HERE (P15a), not in P4b. Re-run the mobile E2E zoom/input row (it must still pass with the lock gone).

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- PRESENTATION-ONLY: no IWorld / src/sim / server / src/net / headless change. A11y is DOM + CSS + presentation wiring only. Server authority untouched. If a slice finds it needs to extend IWorld or touch sim/server, STOP and surface it (scope change).
- i18n: every NEW skip-link / live-region-prefix / aria string is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only; control labels are the hud_chrome English-only exception). Never edit i18n.locales/<lang>.ts. No concat, no `??` fallback, no default param for player-visible strings.
- forced-colors SUPPORTS high-contrast but there is NO light theme and NO prefers-color-scheme branch (decision 11): the one dark aesthetic stays; forced-colors is the only contrast adaptation.
- NO MAGIC VALUES (decision 12): COMBAT_ANNOUNCE_INTERVAL_MS is a named constant; the skip-link / forced-colors / print CSS references token vars, not literal hex/px where a token exists.
- The new pure helpers (focusable-order resolver, live-region politeness picker) are DOM/Three-free, deterministic (no Math.random/Date.now/performance.now), and registered in UI_PURE_CORES; the focus-manager TRAP is wiring (touches document) and is NOT registered.
- The 3D world/canvas is OUT of a11y scope (not screen-readable). Do NOT invent fake aria over the game world; state the boundary in a comment + the docs.
- No em dashes, en dashes, or emojis anywhere (code, comments, commits). Commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The chrome-wide axe-core run + the keyboard-nav E2E + the per-window roles/aria fixes + the :focus-visible-never-animated GUARD + the mobile target-size >=40x40 pass: ALL of that is P15b. This phase ships the infra those tests exercise.
- Re-building per-window roles/aria that P7-P14 already shipped.
- Any new IWorld member, wire field, sim/server/net change (none in this packet).
- A light theme / prefers-color-scheme (decision 11 forbids it): forced-colors only.
- Standards codification into CLAUDE.md (the a11y contract write-up): that is P16.
- Setting up vitest.browser.config.ts / npm run test:browser and wiring axe + Playwright: that is P15b.

STEP 3 - VALIDATION + REVIEW:
Run the validation-matrix rows that match (state.md):
- Baseline: `npx tsc --noEmit`.
- New .ts module added (focus_manager.ts + the pure helper module(s)): `biome check` on the new/changed .ts (the V16 ratchet).
- Pure helper added (focusable-order resolver + live-region politeness picker): `npx vitest run tests/<helper>.test.ts` + `npx vitest run tests/architecture.test.ts` (the UI-purity guard; the helpers ARE registered cores, the focus-manager trap is NOT a registered core, document the split) + a same-input-same-output assertion. PARITY (decision 15): the politeness picker is fed combat-event descriptors shaped as BOTH a Sim-emitted event and a ClientWorld-mirror event so it picks the same politeness online and offline.
- Single-announce ACCEPTANCE TEST (the live-region reconciliation): a DOM test that emitting one combat event of a type updates exactly ONE live region (the polite combat summary OR the existing role=alert, never both), proving no double-announce against hud.ts:7923/9859/11874/13369; and that a burst of routine-damage events does not exceed one announcement per COMBAT_ANNOUNCE_INTERVAL_MS (the throttle holds, no assertive spam).
- CSS changed (skip-link + forced-colors + print sections): `npx vitest run tests/css_corpus.test.ts` (the three new 10-dash sections accounted) + `npx vitest run tests/client_shell.test.ts` (the new skip-link + live-region DOM ids + the focus-landing target id) + `npm run build` (all 4 entries) + the backdrop-filter survival check + `biome check` on the new CSS.
- RESPONSIVE / mobile changed (the viewport-lock drop): run the V16 mobile E2E scripts as a blocking row (decision 16: mobile_input_zoom_check especially must still pass with user-scalable=no removed; plus mobile_button_size, mobile_joystick_size, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area); a real-CDP check, not a CSS-text assertion.
- Player text changed (new skip-link / live-region labels in hud_chrome.ts, English-only): `npx vitest run tests/localization_fixes.test.ts` - a new label in hud_chrome.ts must NOT trip the release tier.
- Whole-suite + build: `npm test` and `npm run build` (4 entries) green. Confirm `vitest run` (bare, no browser) still does NOT launch a browser (the opt-in browser suite is P15b; nothing this phase adds should pull Playwright into the default run).
Review dispatch (only the rows the diff touches): qa-checklist (default; this completes a deliverable set). privacy-security-review does NOT fire (no server/net/admin, no new randomness in sim/a core). cross-platform-sync does NOT fire (IWorld unchanged). migration-safety N/A. Prompt the reviewer for COVERAGE not filtering; resume a truncated reviewer with the state.md resume line. Do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope + EXPLICIT paths, never git add -A):
- feat(ui): add shared focus manager (trap + return-to-opener + Esc) unifying the ad-hoc focus call sites
  (src/ui/focus_manager.ts, src/ui/focus_order.ts, tests/focus_order.test.ts, src/ui/hud.ts, tests/architecture.test.ts)
- feat(ui): add skip links + chat/combat live regions with per-type politeness
  (index.html, play.html, src/ui/hud.ts, src/ui/live_region_politeness.ts, tests/live_region_politeness.test.ts, src/ui/i18n.catalog/hud_chrome.ts, src/styles/components.css, tests/client_shell.test.ts)
- feat(ui): forced-colors pass + minimal print reset
  (src/styles/base.css, src/styles/components.css, tests/css_corpus.test.ts)
- fix(ui): drop the user-scalable=no viewport scale-lock (SC 1.4.4/1.4.10)
  (index.html, play.html)
- docs(frontend): record P15a a11y infra in progress.md + state.md ledger
  (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)
(Use the ACTUAL file names you create; the helper module/test names above are illustrative.)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
[ ] npx tsc --noEmit passes.
[ ] biome check clean on every new/changed .ts (focus_manager + the pure helpers + hud.ts wiring).
[ ] ONE shared focus manager: every open window TRAPS focus (Tab/Shift+Tab cycle inside), Esc closes, and focus RETURNS to the opener on close. EVERY site from STEP 1's full inventory (the ~6 restoreFocus callers, the ~9 focusFirstInteractive callers, AND the dropdown/btn focus-return idioms) now routes through the manager; there is NO surviving ad-hoc restoreFocus / raw return-to-opener .focus() on a window-close path (any documented exception is surfaced with its reason). No two focus systems live at once.
[ ] The canonical focusable selector is ONE named FOCUSABLE_SELECTOR constant, lifted from hud.ts:2598, used everywhere (not re-spelled).
[ ] The DOM-free focusable-order helper + the live-region politeness picker are registered in UI_PURE_CORES and pass architecture.test.ts; the focus-manager trap is documented as wiring, NOT registered.
[ ] Skip links ("skip to main HUD", "skip to chat") are the FIRST focusable elements on both entries, visually hidden until :focus-visible (REUSING the src/guide/chrome.ts:85 pattern), labels via t() in hud_chrome.ts (English-only), both targets reachable.
[ ] Live regions: chat (#chatlog) announces polite; the combat region's politeness is chosen PER TYPE by the pure helper (routine damage throttled via an off-screen polite summary on COMBAT_ANNOUNCE_INTERVAL_MS, NEVER assertive-spammed; assertive reserved for the existing role=alert urgents).
[ ] SINGLE-ANNOUNCE acceptance test passes: one combat event updates exactly one live region (no double-announce against hud.ts:7923/9859/11874/13369); a routine-damage burst yields at most one announcement per COMBAT_ANNOUNCE_INTERVAL_MS.
[ ] COMBAT_ANNOUNCE_INTERVAL_MS is a NAMED constant (no magic cadence literal); the skip-link / forced-colors / print CSS references token vars, not literal hex/px where a token exists.
[ ] forced-colors: active block present + shape-correct (snapshot test): borders + focus survive, no meaning carried by a background-image/background-color alone, system-color keywords used where a forced palette applies. NO light theme / prefers-color-scheme branch.
[ ] A minimal @media print reset hides the canvas + HUD chrome (hide, do not reflow).
[ ] The user-scalable=no / maximum-scale=1.0 viewport scale-lock is REMOVED from index.html:5 and play.html:5 (width=device-width / initial-scale=1.0 / viewport-fit=cover kept); the mobile_input_zoom_check E2E still passes with the lock gone (the 16px input floor holds).
[ ] The 3D world/canvas is documented OUT of a11y scope (not screen-readable); no fake aria over it.
[ ] PRESENTATION-ONLY held: no IWorld/sim/server/net change.
[ ] css_corpus (three new sections), client_shell (new ids), architecture (UI-purity), localization_fixes, the V16 mobile E2E row, full npm test, and npm run build (4 entries) all green; biome clean on new CSS; a bare `vitest run` does NOT launch a browser.
[ ] qa-checklist reviewer reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- progress.md: mark P15a done; list the new modules (focus_manager.ts, the focusable-order helper, the live-region politeness helper), the full caller-migration count (how many ad-hoc sites collapsed into the manager), the skip-link + live-region + forced-colors + print additions, the COMBAT_ANNOUNCE_INTERVAL_MS value, and the viewport-lock drop.
- state.md: update the ledger row P15a -> done; note the shared focus manager subsumes the ad-hoc restoreFocus / focusFirstInteractive helpers (hud.ts:2570-2604) AND the dropdown/btn focus-return idioms (the full inventory was larger than the draft's 6), the chosen combat-text politeness policy + the COMBAT_ANNOUNCE_INTERVAL_MS cadence, that forced-colors is the only contrast adaptation, and that the user-scalable=no viewport lock is now dropped (landed here, not P4b).
- Memory: record surprising rules (the full focus-caller inventory was ~15 sites plus a distinct dropdown idiom, not 6; the combat-text per-type politeness + the named cadence; the forced-colors system-color keyword set used; the canvas-out-of-scope boundary wording; that the viewport-lock drop is safe because of the 16px input floor).

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, the focusable-order + politeness unit tests, the single-announce acceptance test, the forced-colors snapshot, css_corpus/client_shell/architecture/localization tests, the mobile E2E row, full npm test, build), the qa-checklist verdict, the full focus-caller migration count (and any documented non-migratable site with its reason), any deferrals (the chrome-wide axe + keyboard E2E + per-window fixes + the :focus-visible-never-animated guard + the mobile target-size pass -> P15b; the CLAUDE.md a11y contract -> P16), and end with exactly:
Next: phase-15b-a11y-audit-tooling.md

STOPPING RULES (phase-specific):
- STOP and surface a scope change if any slice finds it needs to EXTEND IWorld or touch src/sim / server / src/net / headless (presentation-only is a hard line).
- STOP if unifying the focus manager would leave TWO focus systems live at once (the new manager and a surviving ad-hoc restoreFocus / return-to-opener .focus() caller): migrate every site from the FULL grep inventory, or document precisely why one cannot and surface it. Do not trust a fixed 6-caller list; the live set is larger.
- STOP if making chat/combat a live region would announce routine combat damage assertively (the spam hazard): re-pick politeness per type and hold the COMBAT_ANNOUNCE_INTERVAL_MS throttle before shipping; never assertive-spam.
- STOP if the new combat region double-announces text an existing aria-live node (hud.ts:7923/9859/11874/13369) already speaks: reconcile first.
- STOP if dropping the viewport scale-lock makes mobile_input_zoom_check fail (iOS focus-zoom): confirm the 16px input floor is intact before removing the lock.
- STOP if the only way to make a window screen-reader-complete is faking aria over the 3D canvas: the canvas is OUT of scope by decision; state the boundary, do not invent screen-reader text for the game world.
```

## Notes for the planner

P15a is the first half of the old P15 split: the GLOBAL accessibility infrastructure that no single
window owns, kept separate from P15b's chrome-wide audit so neither half plus its mandatory QA exceeds
the 40% context ceiling. The load-bearing deep-review fix is the focus-manager caller inventory: the
draft listed only 6 restoreFocus callers, but the live source has ~6 restoreFocus callers, ~9
focusFirstInteractive callers, AND a distinct dropdown / button focus-return idiom (the options-menu
close, the roving-item focus, the skin-swatch focus, the dropdown anchor focus, the quest-tracker
header refocus). Leaving any of those un-migrated is exactly the two-systems hazard the stopping rule
forbids, so STEP 1 GREPS the full set rather than trusting a fixed list, and the acceptance criterion
is "no surviving ad-hoc return-to-opener on a window-close path." Three other deep-review fixes land
here: a single-announce acceptance test plus a NAMED COMBAT_ANNOUNCE_INTERVAL_MS constant (decision 12)
and a pure politeness helper registered in UI_PURE_CORES (the throttled off-screen polite combat
summary is how routine damage is announced sparingly without assertive spam); the skip links REUSE the
src/guide/chrome.ts:85 `.guide-skip` precedent shape rather than inventing a new one; and the
user-scalable=no / maximum-scale=1.0 viewport scale-lock drop (decision 10) lands HERE, not in P4b,
guarded by the still-passing mobile_input_zoom_check (the 16px input floor is the real anti-zoom guard).
Everything is presentation-only (no IWorld/sim/server touch) and every new label is hud_chrome
English-only, so the review surface is qa-checklist alone. The chrome-wide axe-core run, the
keyboard-nav E2E, the per-window roles/aria fixes, the :focus-visible-never-animated guard, and the
mobile target-size >=40x40 pass are explicitly deferred to P15b, which exercises the infra this phase
ships. The next file is phase-15b-a11y-audit-tooling.md.
