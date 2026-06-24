# Phase P2: CSS B1: in-world HUD chrome (full section map incl Fiesta HUD + tooltip)

Extract the in-world HUD chrome CSS (nameplates, unit frames, bars, the tooltip block, FCT, the
Interface/Comfort + adaptive-effects + perf overlay, the 2v2 Fiesta HUD, and the center-message /
vignette / death overlays) from the inline `<style>` block in `index.html` into `src/styles/hud.css`,
under the `@layer` order P1 established, with zero rule loss proven by the css_corpus
section-by-section guard. This phase carries the full P2 / P3 / P4a / P4b section map so no marker in
the chrome band falls into a gap (the deep-review BLOCKING fix: the Fiesta HUD at index 2303 and the
non-canonically-commented tooltip block at index 2143 were orphaned, assigned to no phase; both are
P2).

## Starter Prompt

```
This is Phase P2 of the Frontend Modernization v0.16.0 packet: CSS B1: in-world HUD chrome (full
section map incl Fiesta HUD + tooltip).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is a CSS B-tier extraction over TWO disjoint runs of the in-world chrome band
(index 626-1050 + 1169-1300; the interior exclusions delve board 1051-1084 and lockpick 1085-1168 are
P3) PLUS a set of scattered later blocks: the tooltip block 2143-2160, FCT 2162-2172,
Interface/Comfort + adaptive-effects + perf overlay 2174-2302, the 2v2 Fiesta HUD 2303-2415, and the
center-messages / vignette / death overlays 2416-2455. Fan out per section with adversarial verify
against the css_corpus guard; the cascade-drop risk is the whole point of the parallel
section-by-section check.

Goal: Move the in-world HUD chrome rules out of index.html's inline <style> into a new
src/styles/hud.css module under the single @layer order from P1, byte-for-byte (modulo Lightning's
deterministic minify), so the in-world HUD renders identically and css_corpus accounts for every
moved section. This is a pure CSS relocation: no selector rewrites, no value changes, no new tokens.
It de-risks the per-element work later by getting all hot-element styling into one reviewable module.

The deep review found that the previous draft of this phase skipped two real chrome sections, leaving
them assigned to no phase (an orphan band): the 2v2 Fiesta HUD (index 2303) and a tooltip block
(index 2143) whose comment is the lowercase /* tooltip */ form, NOT the canonical 10-dash
/* ---------- name ---------- */ marker css_corpus keys on. Both are now P2. To prevent any future
gap, this phase carries an EXPLICIT section map (below) that tags every /* ---- name ---- */ marker
in index 626-2455 as P2, P3, P4a, or P4b, so the union of the four CSS phases is exactly the chrome
band with nothing left behind.

STEP 0 - PRE-FLIGHT:
- git status MUST be clean. This is a shared checkout; if dirty, ask the user before touching anything.
- Memory scan: MEMORY.md index plus the FB CSS-phase entries that carry the gotchas:
  [[frontend-phase2-css-extraction]] (play.html preserve-both-exactly, single @layer components
  order), [[frontend-phase4-lightningcss-flip]] (backdrop-filter -webkit-first minify gotcha),
  [[frontend-phase1-foundation-gates]] (cssCorpus/normalizeCss guard shape). These are FB-era but
  the rules port forward.
- Confirm you are in the feature/frontend-modernization-v016 worktree on the right branch.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn ONE Explore agent to read+summarize:
- docs/frontend-modernization/state.md (locked decisions 1,2,7; the CSS-row of the validation
  matrix; constraint: JS-written custom props stay in :root; no em dashes/emojis; explicit-path commits).
- this phase file (phase-02-css-hud-chrome.md).
- the "### P2" section of docs/frontend-modernization/v016-recon-and-packet.md plus the
  "Load-bearing structural findings" + risk 6 (CSS cascade/rule-drop, which names the orphan band) +
  "Reuse from FB" rows. Trust LIVE index.html over any FB-carryover line number (the recon is
  superseded where it differs; verify the marker ranges against the live file).
- the SPECIFIC index.html inline <style> ranges this phase moves (read these ranges only, not the
  whole file): the two disjoint in-world runs 626-1050 + 1169-1300; the tooltip block 2143-2160; FCT
  2162-2172; Interface/Comfort + adaptive-effects + perf overlay 2174-2302; the 2v2 Fiesta HUD
  2303-2415; center messages + vignette + death overlay 2416-2455. Also skim the two interior
  EXCLUSIONS (delve board 1051-1084, lockpick 1085-1168) only enough to confirm they are P3, not P2.
- the P1 output: the @layer declaration, src/styles/tokens.css and base.css, and how css_corpus
  keys sections on the /* ---------- name ---------- */ (10-dash) comments.
The orchestrator keeps the EXPLICIT SECTION MAP below (which /* ---- name ---- */ marker falls in P2
vs P3 vs P4a vs P4b), not raw dumps.

SECTION MAP (every marker in index 626-2455; verify against live source before moving anything):
P2 (this phase, in-world chrome + overlays + tooltip + FCT + Fiesta + adaptive/perf):
  626 nameplates, 677 chat bubbles (/say, /yell), 684 new-adventurer tutorial, 714 unit frames,
  824 buff bar, 833 cast bar, 862 bottom cluster, 953 chat frame, 1003 bug report (options sub-view),
  1016 quest tracker, 1039 delve tracker, 1169 combat meters, 1198 minimap, 1268 community HUD,
  2143 tooltip (NOTE: lowercase /* tooltip */, NOT a 10-dash marker; see the comment-less stopping
  rule), 2162 floating combat text, 2174 Interface & Comfort settings, 2219 Adaptive browser-effects
  tiers, 2249 Performance overlay, 2303 2v2 Fiesta HUD (was orphaned), 2416 center messages,
  2427 low-health screen vignette, 2446 death overlay.
P3 (CSS B2, modal + feature windows, NOT this phase): 1051 delve board, 1085 lockpicking minigame,
  1301 windows (centering + per-window shells), 1846 Ashen Coliseum (arena), 1900 The World Market,
  1973 options / game menu (Esc), 2040 UI theme picker, 2108 emote wheel.
P4a (CSS C-1, pre-game shell, NOT this phase): 2456 start screen layout overhaul (and the shell /
  char-select rules that follow it).
P4b (CSS C-2, mobile-touch + per-entry .extra, NOT this phase): the body.mobile-touch / @media
  mobile blocks scattered across the file (e.g. the Fiesta mobile-touch overrides at 2409-2415 ride
  WITH the Fiesta section in P2 because they are part of that section's body, but a freestanding
  mobile-touch section is P4b). If a mobile override sits inside a P2 section's own body, it moves
  with that section; a standalone mobile/responsive section is P4b. When unsure, STOP (see rules).
NOTE on 620 (UI chrome icons): it sits just above 626 and is P1/base-tier glyph styling, not P2; do
  not pull it in unless the section map row above lists it. If the P1 output already claimed it,
  leave it where P1 put it.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
Default parallel Workflow fan-out, one slice per source section. Use isolation: "worktree" only if
slices touch the same lines of index.html (they should not; each owns a disjoint range). Slices
(each owns the markers from the SECTION MAP above, in source order; preserve that order in hud.css):
  1. In-world chrome run A, index 626-1050: nameplates, chat bubbles, new-adventurer tutorial, unit
     frames, buff bar, cast bar, bottom cluster, chat frame, bug report, quest tracker, delve tracker.
     This run STOPS at 1050: the delve board (1051) starts here and is P3, so this slice ends BEFORE
     it. Do not move 1051-1168.
  2. In-world chrome run B, index 1169-1300: combat meters, minimap, community HUD. This run STARTS
     after the lockpick exclusion ends (1168) and STOPS before the windows block (1301, P3).
  3. The tooltip block, index 2143-2160 (the lowercase /* tooltip */ section, orphaned by the prior
     draft). Move it verbatim AND upgrade its comment to a canonical 10-dash marker
     /* ---------- tooltip ---------- */ so css_corpus keys on it (this is the ONE allowed comment
     edit; see the comment-less stopping rule, it is the documented exception, NOT a precedent to
     re-comment other sections).
  4. FCT (floating combat text) block, index 2162-2172.
  5. Interface/Comfort + adaptive-effects + perf-overlay block, index 2174-2302 (three 10-dash
     markers: Interface & Comfort 2174, Adaptive browser-effects 2219, Performance overlay 2249).
  6. 2v2 Fiesta HUD, index 2303-2415 (orphaned by the prior draft; includes its @keyframes, its
     prefers-reduced-motion @media, and its trailing body.mobile-touch overrides 2409-2415 which are
     part of THIS section's body and move WITH it).
  7. Center messages + low-health vignette + death overlay, index 2416-2455.
Each slice: cut the rules from index.html's inline <style>, paste into src/styles/hud.css under the
correct @layer (the P1 component layer), keep the /* ---------- name ---------- */ section comments
verbatim (except slice 3's documented upgrade) so css_corpus can key on them, and emit
backdrop-filter -webkit-first if any moved rule uses it (Lightning minify gotcha). Do NOT alter
selectors, values, or specificity. Do NOT move any window-shell rule (P3) or shell/mobile section
(P4a/P4b). Relocate every comment BYTE-FOR-BYTE: the no-em-dash rule is for NEW text only, so a moved
comment that already contains an em/en dash (e.g. a px-range comment that uses an en dash) is
preserved as-is, NOT rewritten.

INVARIANTS THIS PHASE MUST KEEP:
- Presentation-only: no hud.ts/TS edit, no IWorld touch, no sim/server/net change. CSS relocation only.
- @layer order from P1 is the single source of cascade order; moved rules go in the layer P1 assigned
  the component tier. Do not introduce a new layer or reorder layers.
- JS-written custom props (--range-fill, --app-vw, --app-vh, theme.ts --color-*) stay declared as
  :root defaults (P1 owns :root in tokens.css); do not relocate any :root custom-prop default into hud.css.
- Relocate comments BYTE-FOR-BYTE (no-em-dash rule is NEW text only): a moved comment that already
  has an em/en dash is preserved verbatim, never rewritten. The ONE exception is slice 3 upgrading
  the lowercase /* tooltip */ comment to the canonical 10-dash marker so css_corpus keys on it.
- backdrop-filter survival is a BUILT-CSS check, not a source reorder: do NOT hand-reorder
  -webkit-first in the source hud.css. After the move, run npm run build and assert the BUILT
  (Lightning-minified) CSS emits the -webkit-prefixed backdrop-filter first (the FB minify gotcha).
  Any moved backdrop rule is verified at the build artifact, P2 on (a no-op in P1).
- No new i18n strings (CSS only). No new tokens, no value changes.
- No em dashes, en dashes, or emojis in NEW text (see the byte-for-byte comment rule above).
- Commit with EXPLICIT paths (shared worktree), never git add -A.

Out of scope (do NOT do in this phase; leave these rules in place for the named phase):
- The P3 windows + feature windows: delve board 1051-1084, lockpick 1085-1168, windows 1301 (the
  modal centering + per-window shells), arena 1846, market 1900, options 1973, theme picker 2040,
  emote wheel 2108. That is P3 (CSS B2).
- The P4a shell: start screen layout overhaul 2456 and the pre-game shell / char-select rules.
- The P4b mobile-touch / per-entry .extra sections, and play.html (P4 diffs and splits it; do not
  touch play.html here). NOTE the Fiesta section's OWN trailing body.mobile-touch overrides
  (2409-2415) are part of slice 6 and move WITH it; only a freestanding mobile section is P4b.
- Wiring --fx-* consumption into these rules (P5). This phase only relocates existing rules; the
  Interface/Comfort + adaptive-effects markers move byte-for-byte, their var() reads are NOT rewired.

STEP 3 - VALIDATION + REVIEW:
Run the CSS-row of the validation matrix (this is a presentation-only CSS relocation: it is NOT a
cold-window or per-frame phase, so the WCAG-chrome / no-magic-values-painter / ClientWorld-vs-Sim
rows do NOT apply here; the a11y of these windows is audited in P15b and no painter or core .ts is
added by this phase):
- npx vitest run tests/css_corpus.test.ts (the completeness guard, keyed on the LIVE 10-dash
  /* ---------- name ---------- */ markers over inline <style> UNION src/styles/*.css: every moved
  section must be accounted for, zero rule loss, and the upgraded tooltip marker now counted).
- npx vitest run tests/client_shell.test.ts.
- npm run build (all 4 entries resolve under @layer; admin.html/guide.html are survival-only,
  decision 18, but must still build).
- the backdrop-filter survival check on the BUILT (Lightning-minified) CSS: any moved backdrop rule
  emits -webkit-prefixed FIRST in the build artifact (the FB minify gotcha; a built-CSS assertion,
  not a source reorder). Meaningful from P2 on.
- biome check on the new src/styles/hud.css (the V16 ratchet; do not let new modules accrue lint
  debt). NOTE this phase adds NO .ts module, so there is no new-.ts biome target beyond the .css.
- npx tsc --noEmit (baseline).
- a screenshot-diff against the P0 visual baseline (risk 6: this phase moves cascade-sensitive
  chrome, so the rendered HUD must match pixel-for-pixel modulo deterministic minify).
Review dispatch: qa-checklist only (presentation-only CSS; no server/net/IWorld/sim surface, so no
privacy-security-review, migration-safety, or cross-platform-sync per the Review Dispatch Matrix).
Prompt it for COVERAGE: did any section get dropped, reordered into a different layer, lose a backdrop
-webkit prefix in the built CSS, or did any section in the 626-2455 band end up in NO phase (verify
the section map: P2 union P3 union P4a union P4b covers every 10-dash marker plus the tooltip block).

STEP 4 - COMMIT CADENCE: 2-5 Conventional Commits, scoped, explicit paths. Examples:
- style(css): extract in-world HUD chrome run A (nameplates, frames, bars, chat, trackers) to hud.css
    -- src/styles/hud.css index.html
- style(css): extract in-world HUD chrome run B (meters, minimap, community HUD) to hud.css
    -- src/styles/hud.css index.html
- style(css): move tooltip + FCT + adaptive-effects/perf-overlay + Fiesta HUD + overlays to hud.css
    -- src/styles/hud.css index.html
- test(css): cover hud.css sections (incl tooltip + Fiesta) in css_corpus guard
    -- tests/css_corpus.test.ts

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green before marking P2 done):
- [ ] All P2 sections from the SECTION MAP are moved into src/styles/hud.css in source order under
      the P1 component @layer: the two in-world runs (626-1050 + 1169-1300), the tooltip block, FCT,
      Interface/Comfort + adaptive-effects + perf overlay, the 2v2 Fiesta HUD, and center messages +
      vignette + death overlay. Nothing P2 is left in index.html's inline <style>.
- [ ] The two orphan fixes are closed: the Fiesta HUD (was 2303) and the tooltip block (was 2143)
      are in hud.css, and the tooltip comment is the canonical 10-dash marker so css_corpus counts it.
- [ ] The P3/P4a/P4b sections are UNTOUCHED in index.html (delve board, lockpick, windows, arena,
      market, options, theme, emote, shell, standalone mobile); P2 did not move them.
- [ ] tests/css_corpus.test.ts is green: every 10-dash section (inline UNION src/styles/*.css) is
      accounted for, zero rule loss; the section map's P2+P3+P4a+P4b union covers the whole band.
- [ ] tests/client_shell.test.ts green; npx tsc --noEmit green.
- [ ] npm run build succeeds for all 4 entries (index/play/admin/guide); admin+guide still build.
- [ ] The backdrop-filter survival check passes on the BUILT CSS (-webkit-first), not by source edit.
- [ ] biome check on src/styles/hud.css passes.
- [ ] The screenshot-diff against the P0 visual baseline shows no rendered HUD change.
- [ ] No selector, value, specificity, or token changed; no .ts edit; no IWorld/sim/server/net touch.
- [ ] All comments relocated byte-for-byte (em/en dashes in moved comments preserved); the only
      comment edit is the documented tooltip-marker upgrade; no em/en dash or emoji in NEW text.
- [ ] qa-checklist reports no BLOCKING.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P2 row) and state.md ledger (mark P2 done; add src/styles/hud.css to the new
  CSS files list; record that the Fiesta HUD + tooltip orphans are now closed under P2 and the
  section-map P2/P3/P4a/P4b tagging is the canonical hand-off for the remaining CSS phases).
- Record any surprising rule in memory (e.g. a section that straddles the P2/P3 boundary, the
  tooltip-marker upgrade, or a moved comment whose en/em dash was preserved byte-for-byte).

STEP 7 - FINAL RESPONSE: status, files changed (absolute paths), validation results (css_corpus +
client_shell + build all 4 entries + built-CSS backdrop check + biome + tsc + screenshot-diff),
qa-checklist verdict, confirmation the Fiesta + tooltip orphans are closed and the section map's
union covers the whole band, any deferrals, and end with: Next: phase-03-css-windows.md

STOPPING RULES:
- STOP if a rule cannot be moved without changing the cascade (specificity collision, source-order
  dependency a moved section relies on). Surface it; do not "fix" it by reordering.
- STOP if a section straddles the P2/P3 boundary (a selector mixes HUD chrome and a window shell).
  Surface the boundary; do not guess the split.
- STOP if you find a section in the 626-2455 band that the SECTION MAP does not tag as P2/P3/P4a/P4b
  (a NEW orphan the deep review did not catch). Do not silently absorb it into P2; surface it and
  assign it explicitly. The Fiesta HUD and tooltip orphans are already assigned (P2); a new one is a
  spec gap to report.
- STOP if a section has NO leading comment, or only a non-canonical comment (the lowercase
  /* tooltip */ form), so css_corpus cannot key on it. The tooltip block is the ONE pre-authorized
  upgrade (slice 3); for any OTHER comment-less or non-canonically-commented section, surface it and
  confirm the marker form before moving, do not re-comment sections at will.
- STOP if css_corpus reports a section it cannot account for after the move (rule loss); fix the
  move, do not weaken the guard.
- STOP if this phase finds it needs any hud.ts/TS edit or an IWorld change. That is a scope change.
```

## Notes for the planner

P2 is shaped as a pure section-by-section relocation because the dominant risk (recon risk 6) is a
silent cascade or rule drop across the ~8.1k deduped CSS lines, and the only defense is the
css_corpus completeness guard keyed on the existing `/* ---------- name ---------- */` comments, so
the phase preserves those comments and moves whole sections rather than re-grouping rules. The deep
review's BLOCKING finding was an orphan band: the prior draft described P2 as 626-1268-minus-windows
and named only four scattered blocks, which left the 2v2 Fiesta HUD (index 2303) and the
non-canonically-commented tooltip block (index 2143) assigned to no phase, and mis-stated the
in-world run as one contiguous range when it is actually two disjoint runs (626-1050 + 1169-1300)
with the delve board and lockpick as interior P3 exclusions and the windows shell starting only at
1301. The fix is the EXPLICIT section map: every 10-dash marker in 626-2455 is tagged P2/P3/P4a/P4b
so the union of the four CSS phases is provably the whole band, with a stopping rule for any new
orphan and for any comment-less or non-canonically-commented section (the tooltip-marker upgrade is
the one pre-authorized exception). The backdrop -webkit-first Lightning gotcha is checked on the
BUILT, Lightning-minified CSS, not by hand-reordering source, because the minifier is what reorders
prefixes; that is the one easy-to-miss correctness item, hence its own validation row. P2 is split
from P3 along the windows boundary so each CSS phase has a tractable, guard-verifiable surface, and
getting all in-world HUD chrome into one `hud.css` module de-risks P5 (the `--fx-*` wiring lands in
one place) and the per-frame phases (hot-element styling is co-located and reviewable). This is a
CSS relocation phase, not a cold-window or per-frame phase, so the WCAG-chrome / no-magic-values /
ClientWorld-vs-Sim mandatory rows do not attach here; those windows are audited for a11y in P15b.
