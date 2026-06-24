# Phase P4a: CSS C-1: pre-game shell + char-select into shell.css

Move the DESKTOP pre-game shell sections (start screen, loading, login/auth, backdrop, controls
drawer, char-select) out of the inline `<style>` of `index.html` into the NEW `src/styles/shell.css`,
under the P1 `@layer` order with source order preserved. This is the first half of the old P4; it
leaves the mobile-touch block (and the per-entry `.extra` split, and the actual emptying of both
inline blocks) to P4b. Presentation-only, zero rule loss, zero cascade change.

## Starter Prompt

```
This is Phase P4a of the Frontend Modernization v0.16.0 packet: CSS C-1: pre-game shell + char-select into shell.css.

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is a batch-heavy CSS move of the desktop shell sections (start screen, loading, login/auth, backdrop, controls drawer, char-select) into one NEW file with a section-by-section adversarial verify against the css_corpus guard; fan out parallel slices, one per cohesive section cohort.

Goal: Create src/styles/shell.css (NEW in V16; FB had no single shell.css, so this is a fresh file with a P1 layer assignment, NOT a port of an FB file) and move every DESKTOP pre-game shell section out of index.html's inline <style> into it, verbatim, source order preserved within the P1 @layer order. The sections in scope are: start screen, loading screen, login/auth, backdrop, controls drawer, and char-select. After this phase shell.css carries all of those and css_corpus accounts for each one; the inline <style> still holds only the mobile-touch block at hand-off (P4b empties it). The handoff to P4b is explicit: css_corpus completeness over the moved shell sections is the contract P4b builds on.

STEP 0 - PRE-FLIGHT:
- Run `git status`. The tree must be clean. This checkout is shared with concurrent sessions; if it is dirty, STOP and ask the user rather than stashing or resetting.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the entries:
  - frontend-phase2-css-extraction (preserve-both-exactly index/play split, single @layer components order).
  - frontend-phase4-lightningcss-flip (backdrop-filter -webkit-first minify gotcha; big-3 .browserslistrc floor).
  - frontend-architecture-vanilla-stack (vanilla direction, src/styles module shape).
  - phased-packet-qa-cadence (always run the phase-NN-qa pass after impl; never skip QA; end by naming the next phase file).
- Confirm P1 (the Lightning flip + tokens.css/base.css + the single @layer declaration + the CSS-import seam) and P2/P3 (hud.css chrome + layout.css/components.css windows) have already landed on this branch. P4a APPENDS shell.css under the existing @layer order; it does NOT redeclare or reorder the layer.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read and summarize, returning a tight digest to the orchestrator (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 1, 2, 7 (shell.css is NEW in V16, gets a P1 layer assignment, NOT an FB port), 18 (admin/guide survival-only); the non-negotiable CSS constraints; the canonical workflow; the validation matrix CSS row; Top risk 6 cascade/rule-drop).
- docs/frontend-modernization/phase-04a-css-shell.md (this file).
- The "### P4 CSS C" section of docs/frontend-modernization/v016-recon-and-packet.md plus the "Load-bearing structural findings" CSS items and "Top risks" item 6.
- The SPECIFIC index.html inline <style> shell sections this phase moves. Key the slicing on the LIVE 10-dash section markers `/* ---------- name ---------- */`, NOT on line numbers: the recon's 2456-8274 envelope and any per-section line numbers are ESTIMATES-to-verify (they were numbered pre-P2/P3 and have shifted as those phases emptied the chrome and window blocks above). Have the agent emit the current ordered list of `/* ---------- name ---------- */` section comments that remain inline AFTER P2/P3, and classify each as: shell-desktop (in P4a scope), mobile-touch (deferred to P4b), or NOT-P4 (a chrome/window section that P2/P3 should already have moved). Do NOT have it dump the full CSS text, only the section list with start/end markers.
The orchestrator keeps the section list, not the raw CSS.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ULTRACODE Workflow, fan out one slice per cohesive shell-section cohort, then a single sequential integration + a section-by-section adversarial verify. Each slice cuts its sections from index.html's inline <style> and pastes them, unchanged, under the correct @layer in src/styles/shell.css. Slices (all keyed on the live `/* ---------- name ---------- */` markers, not line numbers):
- Slice A (entry/auth): start screen, loading screen, login/auth.
- Slice B (backdrop + drawer): backdrop, controls drawer.
- Slice C (char-select): the character-select screen sections (char list, slot cards, create/delete flow). Per decision 7, char-select folds into shell.css (a few rows that are mobile-only fold into hud.mobile.css in P4b instead; if a char-select rule is inside a mobile @media, leave it inline for P4b and note it).
Because all slices write the same new shell.css and cut from the same index.html <style>, either run them with isolation: "worktree" (overlapping edits) OR serialize the integration: have each slice EMIT its exact cut-range (by section marker) plus the destination text block, and let the orchestrator apply them in one deterministic pass to avoid a merge race on index.html. After integration, run css_corpus and diff each moved `/* ---------- name ---------- */` section's normalized rule set old-vs-new.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- CSS-only, presentation-only: no behavior change, no hud.ts edit, no IWorld touch, no sim/server/net. If making the shell render needs a JS change, STOP (scope change, surface it).
- shell.css is NEW in V16 (decision 7). Do NOT attempt to port an FB src/styles/shell.css; it does not exist in FB (FB distributed its shell rules across other modules). Create shell.css fresh, give it the P1 layer assignment, and fill it from V16's actual inline sections.
- Zero rule loss and zero cascade change: every selector, declaration, and source order preserved within the @layer (Lightning minification aside). JS-written custom props (--app-vw/--app-vh, theme.ts --color-*; --range-fill is the inline slider fallback, not a shell prop and not in this phase's range) stay as :root defaults; do not move, drop, or reparent them.
- backdrop-filter must be emitted -webkit-first (Lightning minify gotcha): keep -webkit-backdrop-filter before the unprefixed backdrop-filter in any moved backdrop/drawer rule. The backdrop section is the highest-risk rule here; the survival check covers it.
- Single @layer order from P1; append shell.css under the existing layer, do NOT introduce a new @layer name or reorder.
- i18n: no player-visible string changes here (CSS only); add no t() key. A moved rule that references a label leaves that label in hud_chrome.ts (English-only), untouched.
- No em dashes, en dashes, or emojis in CSS, comments, or commits. For this byte-for-byte move the no-dash rule applies to NEW text only: a relocated existing comment that already contains a dash may stay or be normalized (comments only, never a selector or value).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The mobile-touch block (touch controls, mobile layout, landscape rules): that is P4b. Leave it inline.
- The per-entry index.extra/play.extra split and the actual emptying of the inline <style> blocks: that is P4b. At P4a hand-off the inline <style> still holds the mobile-touch block (and any other not-yet-moved section); do NOT empty it.
- The in-world HUD chrome (chat, party frames, context menu, elite/target frame, tooltip, nameplates, bars, FCT, vignette): that was P2 (CSS B1). If you find a chat / party-frames / context-menu / elite-target-frame / tooltip section still inline, it belongs to P2, NOT P4; re-classify and surface it rather than moving it into shell.css.
- The modal + feature-window CSS (vendor/bags/social/map/arena/auction/options/emote/talents/delve/lockpick): that was P3 (CSS B2). Do not move it here.
- tokens.css/base.css + the Lightning flip + the @layer declaration + the CSS-import seam: that was P1.
- The ui_effects_profile resolver and any --fx-* consumption (P5): do not add --fx-* hooks to moved rules.
- --keyboard-inset and svh units: V16 has ZERO occurrences of either (they are FB-only). A verbatim move cannot introduce or preserve what is not in the source. They are OUT of scope; do not add them, and do not flag their absence as a regression.

STEP 3 - VALIDATION + REVIEW:
Run the CSS / HTML-entry row of the validation matrix (state.md):
- `npx tsc --noEmit` (baseline).
- `npx vitest run tests/css_corpus.test.ts` (the section-by-section completeness guard, keyed on the live 10-dash markers, over inline <style> UNION src/styles/*.css so coverage is conserved as the move lands: every moved shell section must be accounted for in shell.css, zero rule loss). css_corpus completeness over the moved shell sections IS the explicit hand-off contract to P4b.
- `npx vitest run tests/client_shell.test.ts` (entry/shell DOM ids unchanged).
- `npm run build` (all 4 entries: index, play, admin, guide) resolves under the single @layer order. admin/guide are survival-only (decision 18): confirm they still build and their backdrop-filters survive minify; do not extract them.
- The backdrop-filter survival check on the BUILT CSS: -webkit-backdrop-filter precedes the unprefixed property for the moved backdrop/drawer rules (Lightning -webkit-first gotcha).
- `biome check` on the new src/styles/shell.css.
- Smoke: start screen, loading, login/auth, backdrop, controls drawer, and char-select render unchanged against the P0 visual baseline (a screenshot-diff for this cascade-risk move).
This is NOT a per-frame phase: no perf_tour gate, no WCAG-chrome / no-magic-values / ClientWorld-parity rows (those are for cold-window and per-frame phases, decisions 10/12/15; this is a pure CSS relocation).
Review dispatch (Review Dispatch Matrix): qa-checklist only. No server/admin/net/IWorld/sim surface is touched, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire. Prompt the reviewer for COVERAGE (every dropped or reordered rule, every section the css_corpus guard does not cover, any backdrop-filter ordering miss, any shell rule misclassified out of a P2 chrome section), not filtering; do not commit until it reports no BLOCKING. Resume a truncated reviewer with: "Stop reading more files. Output the full report now based on what you've already seen. No more tool calls. Format: BLOCKING / SHOULD-FIX / NICE-TO-HAVE / VERDICT."

STEP 4 - COMMIT CADENCE (2-5 Conventional Commits, scope `css`, EXPLICIT paths):
- `style(css): create src/styles/shell.css with the P1 layer assignment` (paths: src/styles/shell.css, plus the P1 @layer/import barrel if it must register shell.css)
- `style(css): move pre-game shell sections (start/loading/login/backdrop/drawer) into shell.css` (paths: src/styles/shell.css, index.html)
- `style(css): move char-select sections into shell.css` (paths: src/styles/shell.css, index.html)
- `test(css): account for the shell sections in css_corpus` (paths: tests/css_corpus.test.ts, only if the guard needs the new sections registered)
- `docs(frontend): record P4a in progress.md and state.md ledger` (paths: docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable + green):
- [ ] src/styles/shell.css exists as a NEW file (not an FB port) with the P1 layer assignment, wired into the single @layer order from P1.
- [ ] The desktop shell sections (start screen, loading, login/auth, backdrop, controls drawer, char-select) are moved out of index.html's inline <style> into shell.css, verbatim, source order preserved within the @layer.
- [ ] The inline <style> at hand-off still holds the mobile-touch block (it is NOT emptied here; P4b empties it). No chrome (P2) or window (P3) section was moved into shell.css.
- [ ] `npx vitest run tests/css_corpus.test.ts` green and accounts for 100% of the moved shell sections (zero rule loss); this completeness is the explicit hand-off to P4b.
- [ ] `npx vitest run tests/client_shell.test.ts` green.
- [ ] `npm run build` resolves all 4 entries (index, play, admin, guide) under the single @layer order; admin/guide still build (survival-only, decision 18).
- [ ] `biome check` clean on src/styles/shell.css.
- [ ] backdrop-filter rules in the moved backdrop/drawer sections still emit -webkit-first after Lightning minify (survival check passes).
- [ ] JS-written custom props (--app-vw/--app-vh, theme.ts --color-*) remain :root defaults; none dropped or reparented. No --keyboard-inset / svh added (V16 has none; out of scope).
- [ ] Shell + char-select smoke render unchanged vs the P0 visual baseline (no cascade diff).
- [ ] `npx tsc --noEmit` green.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md: mark P4a complete, list the new file (shell.css), the section markers moved into it, and note the inline <style> still holds the mobile-touch block awaiting P4b.
- Update the state.md ledger: flip the P4a row to done; under "Key file paths" note shell.css now exists and carries the desktop shell sections, and that the inline entry styles are NOT yet empty (P4b finishes that).
- Record surprising rules in memory: any V16-vs-FB section drift in the shell range, any shell section the FB distribution did not have as a discrete block, any css_corpus section the guard required registering, and any char-select rule that turned out to be mobile-only and was deferred to P4b.

STEP 7 - FINAL RESPONSE:
Status, files changed (absolute paths), validation results (tsc, css_corpus, client_shell, build x4, biome, backdrop survival, visual-diff), the qa-checklist reviewer verdict, and any deferrals. End with exactly:
Next: phase-04b-css-mobile-extra.md

STOPPING RULES:
- STOP if a shell rule cannot be moved out of the inline <style> without changing the rendered cascade (an order-of-declaration or specificity dependency on a rule still inline or already in hud.css/layout.css/components.css that you cannot preserve under @layer). Surface it; do not guess a reorder.
- STOP if css_corpus reports a moved section it cannot account for after a good-faith reconcile (a rule was dropped or duplicated), or if covering a section would require weakening the guard (it must stay a real completeness check).
- STOP and surface as a SCOPE CHANGE if making the shell render correctly requires editing hud.ts, IWorld, or any non-CSS source.
- STOP if a section in the shell range turns out to belong to the in-world HUD (P2) or the windows block (P3); re-classify and surface rather than forcing it into shell.css.
- STOP if backdrop-filter survival regresses (emitted -webkit-last after minify).
- STOP if a section is mobile-touch (touch controls, mobile layout, landscape, or a mobile @media): it is P4b, leave it inline and note it.
```

## Notes for the planner

P4a is the larger and lower-variance half of the old P4: a verbatim section-cut of the desktop
pre-game shell into one new file, which fans out cleanly per `/* ---------- name ---------- */`
section and lets the css_corpus guard prove completeness section by section, exactly as P2 and P3
did for the chrome and window blocks. The two corrections that distinguish it from the FB-era draft
are load-bearing: shell.css is NEW in V16 (decision 7), not a port of a non-existent FB file, so the
slice CREATES it with a P1 layer assignment; and chat / party-frames / context-menu / elite-target
sections were P2-owned chrome (not shell), so they are explicitly out of scope and a re-classify
trigger if found inline. All section slicing keys on the live 10-dash markers, because the recon's
2456-8274 envelope and per-section numbers are pre-P2/P3 estimates that shifted once those phases
emptied the blocks above. The deliberate seam with P4b is css_corpus completeness over the moved
shell sections: P4a leaves the mobile-touch block inline and proves every shell section landed in
shell.css, so P4b inherits a clean shell file and only has the mobile move plus the two-entry
.extra split and the inline-block emptying to finish.
