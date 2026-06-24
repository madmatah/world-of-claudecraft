# Phase P4b: CSS C-2: mobile-touch into hud.mobile.css + per-entry .extra; empty both inline blocks

Move the mobile-touch block (touch controls, mobile layout, landscape rules) out of the inline
`<style>` into the NEW `src/styles/hud.mobile.css`, diff `index.html` vs `play.html` and split the
index-only and play-only deltas into `index.extra.css`/`play.extra.css` (preserve-both-exactly),
then EMPTY both inline `<style>` blocks and wire shell + hud.mobile + the matching `.extra` per entry
under the single P1 `@layer`. This is the second half of the old P4 and completes the CSS extraction
(P1 to P4b). It also runs the V16 mobile E2E scripts as a blocking responsive gate (decision 16).

## Starter Prompt

```
This is Phase P4b of the Frontend Modernization v0.16.0 packet: CSS C-2: mobile-touch into hud.mobile.css + per-entry .extra; empty both inline blocks.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is a batch-heavy CSS move (the mobile-touch block) plus a two-entry index-vs-play diff/split plus the final inline-block emptying and @layer wiring, with a real-CDP responsive E2E gate; fan out parallel slices with adversarial section-by-section verification against css_corpus and the V16 mobile scripts.

Goal: Finish the CSS extraction. Create src/styles/hud.mobile.css (NEW in V16; FB had an equivalent but re-derive against V16's actual mobile sections) and move the mobile-touch block (touch controls, mobile layout, landscape rules) out of the inline <style> verbatim. Diff index.html's inline <style> against play.html's, put index-only deltas into src/styles/index.extra.css and play-only deltas into src/styles/play.extra.css under the preserve-both-exactly rule, then EMPTY both inline <style> blocks and wire shell.css + hud.mobile.css + the matching .extra per entry under the single P1 @layer. After this phase both inline <style> blocks are empty, css_corpus is 100% across both entries, and all CSS lives under the single @layer order. The mobile rendered layout is gated by the V16 mobile_* E2E scripts (decision 16), not just preserved as CSS text.

STEP 0 - PRE-FLIGHT:
- Run `git status`. The tree must be clean. This checkout is shared with concurrent sessions; if it is dirty, STOP and ask the user rather than stashing or resetting.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the entries:
  - frontend-phase2-css-extraction (play.html preserve-both-exactly: index.extra/play.extra split, single @layer order, NEVER merge an index rule onto play).
  - frontend-phase5-mobile-landscape (mobile-landscape rules: canvas carve-out, 16px anti-zoom floor, dvh-vs-svh split, --keyboard-inset chat lift, orientation rules, the CDP-real-insets E2E gotcha (notch checks must use real CDP insets, never a CSS-text assertion)). NOTE this entry is FB-era: V16 has ZERO --keyboard-inset and ZERO svh (see the OUT-of-scope note below).
  - frontend-phase4-lightningcss-flip (backdrop-filter -webkit-first minify gotcha, big-3 .browserslistrc floor).
  - frontend-architecture-vanilla-stack (vanilla direction, src/styles module shape).
  - phased-packet-qa-cadence (always run the phase-NN-qa pass after impl; never skip QA).
- Confirm P1 (Lightning flip + tokens.css/base.css + the single @layer + the CSS-import seam) and P4a (shell.css with the desktop shell sections moved, css_corpus accounting for them, inline <style> still holding the mobile-touch block) have landed on this branch. P4b builds directly on P4a's css_corpus completeness over the shell sections.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a tight digest (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 1, 2, 7, 16 (responsive is E2E-gated), 18 (admin/guide survival-only); the non-negotiable CSS constraints incl --range-fill is the inline slider fallback not a :root token; the canonical workflow; the validation matrix CSS row AND the RESPONSIVE/mobile row; Top risk 6 cascade/rule-drop).
- docs/frontend-modernization/phase-04b-css-mobile-extra.md (this file).
- docs/frontend-modernization/phase-04a-css-shell.md (the hand-off: which sections P4a already moved into shell.css, so the agent knows what remains inline).
- The "### P4 CSS C" section of docs/frontend-modernization/v016-recon-and-packet.md plus the "Load-bearing structural findings" CSS items and "Top risks" item 6.
- The SPECIFIC source. Key everything on the LIVE 10-dash section markers `/* ---------- name ---------- */`, NOT on line numbers: the recon's mobile-touch range (cited as ~5758-7027) and the per-entry delta sizes (cited as ~976 index-only lines / ~60 play-only lines) are ESTIMATES-to-verify (numbered pre-P2/P3, shifted by the prior phases). Have the agent emit: (1) the ordered list of `/* ---------- name ---------- */` mobile-touch sections still inline in index.html after P4a (touch controls, mobile layout, landscape); and (2) the index.html-inline-<style> vs play.html-inline-<style> DELTA MAP: which sections/rules are identical (shared, move to shell.css/hud.mobile.css), which are index-only, which are play-only. Do NOT dump the full CSS text, only the section list and the delta map.
- src/styles/shell.css as landed by P4a (read it to know the layer assignment and where the shared rules already are, so the .extra split puts only true per-entry deltas in the .extra files).
The orchestrator keeps the section list + delta map, not the raw CSS.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ULTRACODE Workflow, fan out one slice per cohesive cohort, then a single sequential integration + a section-by-section adversarial verify. Slices (all keyed on the live `/* ---------- name ---------- */` markers, not line numbers):
- Slice A (hud.mobile.css): move the mobile-touch block verbatim into src/styles/hud.mobile.css (NEW file, P1 layer assignment): touch controls, mobile layout, landscape rules, and any mobile @media blocks (including any char-select rules P4a deferred as mobile-only). Preserve the 16px anti-zoom font floor, the canvas carve-out, the dvh-based heights, and the orientation rules EXACTLY. THE LANDSCAPE GATE IS LOAD-BEARING (decision 16a, in-game is landscape-only, never portrait): move the `#rotate-device` overlay rules verbatim (play.html ~4920 + 5934-5953, index.html ~5761 + 6837-6866), including the `body.mobile-touch.game-active #rotate-device` display rules and their `@media (orientation: portrait)` / `@media (orientation: landscape)` wrappers. Do NOT alter, simplify, or drop the orientation gate; the rotate-to-landscape overlay (driven by `requestMobileFullscreenLandscape()` + the orientationchange listener in main.ts, which are NOT touched here) is how portrait is handled, there is no in-game portrait layout to preserve. NOTE: V16 has no svh and no --keyboard-inset; a verbatim move neither adds nor removes them (see OUT of scope). Keep -webkit-backdrop-filter before backdrop-filter in any moved rule.
- Slice B (per-entry .extra split): from the delta map, write src/styles/index.extra.css (index-only deltas) and src/styles/play.extra.css (play-only deltas). PRESERVE BOTH EXACTLY: never collapse an index rule onto play or vice versa. Shared rules belong in shell.css/hud.mobile.css; a selector that differs by even one property between the two entries goes to BOTH .extra files exactly as each entry had it. If a rule is ambiguous ("almost" shared), default to the safe split (put each entry's version in its own .extra file), do NOT merge, and note it.
- Integration (sequential, after A/B; reserve the entry-file edits for here so the slices do not race index.html/play.html): EMPTY both inline <style> blocks (every shell/mobile/char-select/.extra section is now in a module). Wire the CSS-import seam so EACH entry loads its files under the single P1 @layer: index.html gets shell.css + hud.mobile.css + index.extra.css; play.html gets shell.css + hud.mobile.css + play.extra.css. Run css_corpus across BOTH entries' module sets and reconcile any section the guard reports unaccounted.
Request fan-out EXPLICITLY: spawn Slice A and Slice B in parallel (plain agents writing distinct src/styles/*.css; the entry-file emptying + wiring is the sequential integration step, NOT in a slice). Use isolation: "worktree" only if a slice must touch a shared file.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- CSS-only, presentation-only: no behavior change, no hud.ts edit, no IWorld touch, no sim/server/net. If a mobile rule needs a JS change to render, STOP (scope change, surface it).
- hud.mobile.css is NEW in V16; re-derive its contents from V16's actual inline mobile sections rather than assuming the FB file is byte-identical.
- preserve-both-exactly: index.html and play.html inline blocks are NOT merged; their deltas split into the matching .extra file. This is the central correctness rule of this phase. SPECIFIC HAZARD (decision 16a): the `#rotate-device` orientation rules DIFFER between the two entries (index sets the portrait display one way, play another); they are an index-vs-play delta and go into the matching `.extra` file each exactly as that entry had it, NEVER merged onto one shared rule.
- Zero rule loss and zero cascade change: source order within a @layer is preserved; JS-written custom props (--app-vw/--app-vh, theme.ts --color-*) stay as :root defaults, do not move or drop them. --range-fill is NOT a :root token: it is the inline var(--range-fill, 0%) FALLBACK on the slider track (written per-element by hud.ts); it rides into base.css inside the slider rule, do NOT promote it to :root and do NOT touch it here.
- backdrop-filter must be emitted -webkit-first (Lightning minify gotcha): keep -webkit-backdrop-filter before the unprefixed property in any moved rule.
- Single @layer order from P1; wire the new files under the existing layer, do NOT introduce a new @layer name or reorder.
- i18n: no player-visible string changes here (CSS only); add no t() key.
- No em dashes, en dashes, or emojis in CSS, comments, or commits. For this byte-for-byte move the no-dash rule applies to NEW text only: a relocated existing comment that already contains a dash may stay or be normalized (comments only, never a selector or value).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The desktop shell sections (start/loading/login/backdrop/drawer/char-select): P4a already moved those into shell.css. Do not re-move or re-derive them.
- The in-world HUD chrome (chat, party frames, context menu, elite/target frame, tooltip, nameplates, bars, FCT, vignette): that was P2. If you find such a section still inline, it belongs to P2, NOT P4; re-classify and surface it.
- The modal + feature-window CSS: that was P3.
- The ui_effects_profile resolver and any --fx-* consumption (P5): do not add --fx-* hooks to moved rules.
- --keyboard-inset and svh units: V16 has ZERO occurrences of either (FB-only). A verbatim move cannot introduce or preserve what is not in the source. They are OUT of scope; do not add them, and do not treat their absence as a regression. The 16px input-font floor (anti-zoom) and dvh heights are what V16 actually ships; keep those exactly.
- Any mobile-landscape BEHAVIOR change beyond moving existing rules verbatim.

STEP 3 - VALIDATION + REVIEW:
Run the CSS / HTML-entry row AND the RESPONSIVE/mobile row of the validation matrix (state.md):
- `npx tsc --noEmit` (baseline).
- `npx vitest run tests/css_corpus.test.ts` (the section-by-section completeness guard, keyed on the live 10-dash markers, over inline <style> UNION src/styles/*.css; now both inline blocks are empty, so coverage is 100% from the modules ACROSS BOTH ENTRIES, zero rule loss).
- `npx vitest run tests/client_shell.test.ts` (entry/shell DOM integrity with both inline blocks emptied and the per-entry .extra wired).
- `npm run build` (all 4 entries: index, play, admin, guide) resolves under the single @layer order. admin/guide are survival-only (decision 18): confirm they still build and their backdrop-filters survive minify; do not extract them and do not claim "both inline blocks empty" for admin/guide (the claim is for index/play only).
- The backdrop-filter survival check on the BUILT CSS: -webkit-backdrop-filter precedes the unprefixed property for the moved mobile rules.
- `biome check` on the new src/styles/hud.mobile.css, src/styles/index.extra.css, src/styles/play.extra.css.
- RESPONSIVE GATE (BLOCKING, decision 16): run the V16 mobile_* E2E scripts as a blocking row, with `npm run dev` (and `npm run server` if a script needs it) up: mobile_input_zoom_check, mobile_button_size, mobile_joystick_size, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area. These assert the RENDERED mobile layout (touch-control sizes, real-CDP safe-area insets, the anti-zoom font floor) that css_corpus (CSS-text only) cannot catch. The notch/inset checks MUST use real CDP insets, never a CSS-text assertion (the phase5 gotcha). A red mobile script BLOCKS the phase. ORIENTATION assertion (decision 16a): with a mobile-touch viewport in the IN-GAME state (`body.mobile-touch.game-active`), assert the layout works in LANDSCAPE and that PORTRAIT shows the `#rotate-device` overlay (not a broken portrait HUD); the pre-game shell is verified to still render in portrait (the lock is in-game only).
- Smoke: mobile (touch controls, landscape) and the full pre-game shell render unchanged vs the P0 visual + mobile baseline; both inline <style> blocks are empty.
This is NOT a per-frame phase: no perf_tour gate, no WCAG-chrome / no-magic-values / ClientWorld-parity rows (those are for cold-window and per-frame phases, decisions 10/12/15; this is a pure CSS relocation). The mobile target-size minimums are checked here by the existing mobile_button_size/mobile_joystick_size scripts, not by a new axe pass.
Review dispatch (Review Dispatch Matrix): qa-checklist only. No server/admin/net/IWorld/sim surface is touched, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire. Prompt the reviewer for COVERAGE (every dropped/reordered rule, every .extra-split error where an index rule was merged onto play or vice versa, any cascade or backdrop-ordering miss, any responsive rule that the mobile E2E proves regressed), not filtering; do not commit until it reports no BLOCKING. Resume a truncated reviewer with: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope `css`, EXPLICIT paths):
- `style(css): extract mobile touch CSS into src/styles/hud.mobile.css` (paths: src/styles/hud.mobile.css, index.html)
- `style(css): split index-only/play-only deltas into per-entry .extra` (paths: src/styles/index.extra.css, src/styles/play.extra.css)
- `refactor(css): empty inline <style> blocks and wire shell/mobile/.extra per entry under @layer` (paths: index.html, play.html, plus the P1 CSS-import seam / barrel if it must register the per-entry files)
- `test(css): account for mobile and .extra sections in css_corpus` (paths: tests/css_corpus.test.ts, only if the guard needs the new sections registered)
- `docs(frontend): record P4b in progress.md and state.md ledger` (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
- [ ] src/styles/hud.mobile.css exists (NEW file, P1 layer assignment) and carries the mobile-touch block (touch controls, mobile layout, landscape), verbatim, source order preserved within the @layer.
- [ ] index.html and play.html inline `<style>` blocks are both EMPTY (all shell/mobile/char-select CSS now lives in modules). admin.html/guide.html keep their current CSS (survival-only, decision 18); the empty-inline claim is for index/play only.
- [ ] index-only deltas live in src/styles/index.extra.css and play-only deltas in src/styles/play.extra.css; preserve-both-exactly (no index rule merged onto play or vice versa). The ~976/~60 line figures were estimates; report the ACTUAL split sizes.
- [ ] Each entry is wired under the single P1 @layer: index.html loads shell + hud.mobile + index.extra; play.html loads shell + hud.mobile + play.extra.
- [ ] `npx vitest run tests/css_corpus.test.ts` green and 100% across BOTH entries' module sets (zero rule loss).
- [ ] `npx vitest run tests/client_shell.test.ts` green.
- [ ] `npm run build` resolves all 4 entries under the single @layer order; admin/guide still build (survival-only).
- [ ] `biome check` clean on hud.mobile.css, index.extra.css, play.extra.css.
- [ ] backdrop-filter rules still emit -webkit-first after Lightning minify (survival check passes).
- [ ] The V16 mobile_* E2E scripts (mobile_input_zoom_check, mobile_button_size, mobile_joystick_size, mobile_chat_safe_area, mobile_minimap_safe_area, mobile_community_hud_safe_area) all pass as a blocking RESPONSIVE row, using real-CDP insets (decision 16).
- [ ] The `#rotate-device` landscape gate is preserved intact (decision 16a): `body.mobile-touch.game-active #rotate-device` + its `@media (orientation: portrait/landscape)` rules moved verbatim; the index-vs-play `#rotate-device` delta is split into the matching `.extra` (never merged); in-game portrait shows the rotate overlay and the shell still renders in portrait.
- [ ] JS-written custom props (--app-vw/--app-vh, theme.ts --color-*) remain :root defaults; --range-fill stays the inline slider fallback in base.css (not promoted to :root). No --keyboard-inset / svh added (V16 has none; out of scope).
- [ ] Mobile + shell smoke render unchanged vs the P0 visual + mobile baseline.
- [ ] `npx tsc --noEmit` green.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md: mark P4b complete, list the new files (hud.mobile.css, index.extra.css, play.extra.css), and note both inline <style> blocks are now empty so the CSS extraction (P1 to P4b) is done; record the actual index-only/play-only split sizes.
- Update the state.md ledger: flip the P4b row to done; under "Key file paths" note the inline entry styles are now empty and the full src/styles set exists (tokens/base/layout/components/hud/hud.mobile/shell/index.extra/play.extra). Note the mobile E2E gate is wired and green.
- Record surprising rules in memory: any V16-vs-FB section drift in the mobile range, any new index-only or play-only delta the FB split did not have, any css_corpus section the guard required registering, and any mobile rule whose rendered behavior the E2E caught that CSS-text completeness alone would have missed.

STEP 7 - FINAL RESPONSE:
Status, files changed (absolute paths), validation results (tsc, css_corpus, client_shell, build x4, biome, backdrop survival, and the mobile_* E2E responsive gate), the qa-checklist reviewer verdict, and any deferrals. End with exactly:
Next: phase-05-ui-effects-profile.md

STOPPING RULES:
- STOP if a CSS rule cannot be moved out of the inline <style> without changing the rendered cascade (an order-of-declaration or specificity dependency you cannot preserve under @layer). Surface it; do not guess a reorder.
- STOP if css_corpus reports a section it cannot account for after a good-faith reconcile (a rule was dropped or duplicated).
- STOP if the index-vs-play diff is ambiguous (a rule that is "almost" shared): default to the safe split (put it in BOTH .extra files exactly as each entry had it) rather than merging, and note it. Never merge to resolve ambiguity.
- STOP and surface as a SCOPE CHANGE if making a mobile rule render correctly requires editing hud.ts, IWorld, or any non-CSS source.
- STOP if backdrop-filter survival regresses (emitted -webkit-last after minify).
- STOP if a mobile_* E2E script goes red after the move: the rendered mobile layout regressed even though css_corpus may be green; do not mark the phase complete on a red responsive gate (decision 16).
- STOP if a section still inline turns out to be P2 chrome or P3 windows; re-classify and surface rather than forcing it into hud.mobile.css or an .extra file.
```

## Notes for the planner

P4b is the higher-variance half of the old P4: it inherits P4a's clean shell.css and css_corpus
completeness, so its only genuinely new work is the mobile-touch move plus the two-entry delta map
on the larger V16 base, the inline-block emptying, and the per-entry wiring. The per-entry .extra
split is its own slice with an explicit "split, never merge" rule because that is the one
non-mechanical judgement here; the preserve-both-exactly memory from P2 is the proven precedent. Two
deep-review corrections shape it: V16 has ZERO --keyboard-inset and ZERO svh (those are FB-only), so
they are out of scope rather than rules to "preserve exactly," and the ~976/~60 delta sizes plus the
~5758-7027 range are pre-P2/P3 estimates, so all slicing keys on the live 10-dash markers. The
decisive addition over a pure CSS-text move is the blocking RESPONSIVE gate (decision 16): css_corpus
proves CSS-text completeness but cannot catch a dropped safe-area inset or a dvh swap, so the V16
mobile_* E2E scripts run with real CDP insets as a hard gate, which is why the mobile gotchas earned
their own half. Completing P4b empties both inline `<style>` blocks, the precondition that lets P5
add --fx-* consumption to clean, layered CSS files instead of an inline monolith.
