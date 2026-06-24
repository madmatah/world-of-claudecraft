# Phase P11c: Per-frame: party frames (keyed pool)

Complete the party-frames painter over the already-pure `selectPartyFrameMembers` selector (in
`src/ui/party_frames.ts`; the call site is `hud.ts:11508-11562`). Replace the innerHTML-wipe plus the
per-rebuild click/contextmenu listener churn with a KEYED node pool: one persistent node per member key,
click/contextmenu attached ONCE per pooled row, data updated in place, no duplicate listeners; and hoist
the selector allocation to AFTER the per-frame signature short-circuit so an unchanged party allocates
nothing. A test asserts no duplicate listener across rebuilds.

## Starter Prompt

```
This is Phase P11c of the Frontend Modernization v0.16.0 packet: Per-frame: party frames (keyed pool).

Model: Opus 4.8, xhigh effort. Harness: Claude Code.

Worktree: /Users/fernando/Documents/wocc-v0.16.0 (branch feature/frontend-modernization-v016, off release/v0.16.0).

ULTRACODE: yes. This is the high-churn innerHTML-wipe to keyed-node-pool rewrite (risk 3) over N party-member instances, with a listener-leak hazard, a per-frame perf gate, and a per-row a11y obligation. Fan out the keyed-pool painter build, the member-instance wiring, and the a11y/no-magic verification as parallel sub-tasks and adversarially verify against the perf gate and the no-duplicate-listener test. It is a per-frame slice over N instances, the case state.md names for ultracode + Workflow.

Goal: Replace the inline party-frames render (src/ui/hud.ts:11508-11562) with a party-frames PAINTER that renders each party member as a unit_frame family INSTANCE (decision 9: N instances, no single-instance assumption) over the #party-frames container, using a KEYED node pool instead of the innerHTML-wipe + per-rebuild listener re-attach. The pure selector selectPartyFrameMembers is ALREADY pure (it lives in src/ui/party_frames.ts and is imported into hud.ts; do NOT rewrite it). No behavior change, presentation-only, with a hard perf gate, WCAG 2.2 AA on the party frames, and token-driven painter values.

STEP 0 - PRE-FLIGHT:
- git status must be clean. This checkout is shared with concurrent sessions; if it is dirty, STOP and ask the user before touching anything.
- Confirm you are in /Users/fernando/Documents/wocc-v0.16.0 on branch feature/frontend-modernization-v016.
- Memory scan: read MEMORY.md and the relevant entries. Relevant: [[frontend-phase7-hud-window-extraction]] (Humble Object pure-core-plus-painter behind PainterHost; the purity-guard perturbation must inject a REAL code line), [[frontend-phase8-graphics-tier-effects]] (write-elision and applier wiring; live computed-style proofs), [[phased-packet-qa-cadence]] (never skip the QA pass after this phase), [[no-em-dashes-or-emojis]], [[shared-worktree-commit-care]], and this packet's state.md locked decisions (esp. 3 + 5 + 5a write-elision and the writer extension, 9 component contract / unit_frame family, 10 accessibility, 12 no-magic-values-in-painters, 15 ClientWorld-vs-Sim parity). NOTE the keyed-pool hazard in state.md top-risk 3: the innerHTML-wipe to keyed-pool rewrite can silently drop listeners/tooltips, and any tooltip/click closure must read a LIVE MUTABLE slot record (the pooled row's current member), not capture a member by value (stale after the row is recycled to a different member).
- This phase depends on P10b (the unit_frame FAMILY core+painter), P10a (the write-elision EXTENSION setStyleProp/toggleClass), and the P0 perf baseline. Confirm: the unit_frame family core+painter exist and its descriptor was validated against the FULL party member field set (decision 9); the write-elision facet exposes setStyleProp(el, prop, val) + toggleClass(el, cls, on); selectPartyFrameMembers exists and is pure in src/ui/party_frames.ts; the P0 frameP95 + hudHotDomSkipRate baseline is recorded. If the unit_frame family, the P10a writer extension, the pure selector, or the P0 baseline is missing, STOP: this slice builds the party instances ON the family and gates against the baseline.

STEP 1 - LOAD CONTEXT (do NOT read hud.ts (14,377 lines) or the HTML entries whole):
Spawn one Explore agent to read + summarize, returning a compact orchestrator brief (not raw dumps):
- docs/frontend-modernization/state.md (locked decisions 3, 5, 5a, 9, 10, 12, 15; the non-negotiable constraints; the per-frame perf-gate row AND the WINDOW/CONTROL a11y row of the validation matrix; the Review Dispatch Matrix; the write-elision file refs at hud.ts:1322-1372 and the P10a extension; top-risk 3 the keyed-pool/listener/stale-closure hazard).
- This phase file.
- The '### P11' section of docs/frontend-modernization/v016-recon-and-packet.md, plus the "Load-bearing structural findings" and "Top risks" sections (risk 1 write-elision byte-identity and risk 3 keyed-pool listener drops are this slice's).
- The pure selector EXACTLY as it stands: src/ui/party_frames.ts (selectPartyFrameMembers, PARTY_FRAME_RANGE_YD, the PartyFrameMember oor flag). Confirm it is pure and imported into hud.ts; do NOT rewrite it.
- The unit_frame FAMILY core+painter as P10b landed it (the parameterized instance shape, the per-instance descriptor, which member fields it already covers). Do NOT re-derive the family.
- The SPECIFIC V16 source ranges this phase touches, by exact line number:
  - Hud.update() entry + frame divider: src/ui/hud.ts:3627 (the party frames repaint on the slowHud >=500ms band).
  - Write-elision helpers + cache: src/ui/hud.ts:1322-1372 (setText/setDisplay/setTransform/setWidth + hotWriteCache) and perfStats() (hotDomWrites/hotDomSkippedWrites/hotDomSkipRate).
  - Party frames CALL SITE: src/ui/hud.ts:11508-11562 (updatePartyFrames). Note the EXACT shape:
    - The container #party-frames lookup at 11509 + the below-target class toggle 11512 (route through toggleClass).
    - The no-party clear 11514-11518 (innerHTML wipe + lastPartySig reset).
    - The selector CALL at 11520: selectPartyFrameMembers(info, playerId, player.pos). This is the CALL SITE; the selector itself is pure in party_frames.ts (NOT inline at 11520). The signature build at 11522 and the short-circuit at 11523 (if sig === lastPartySig return).
    - The innerHTML wipe at 11525 + the per-member loop 11526-11555: a new <div> per member each rebuild, frame.style.setProperty('--cls', ...), an innerHTML string, and frame.addEventListener('click') + frame.addEventListener('contextmenu') RE-ATTACHED every rebuild (the listener churn this slice removes), then el.appendChild.
    - The leave button rebuilt every time at 11556-11561 (its click listener re-attached too; pool it).
  - The existing cores to REUSE: selectPartyFrameMembers (party selector), the unit_frame family (P10b). Do NOT re-derive these.
The orchestrator keeps the summary.

STEP 2 - CHOOSE ORCHESTRATION + EXECUTE:
ultracode + a Workflow. Fan out three parallel sub-tasks, then the orchestrator integrates sequentially (re-running tsc after each merge) since they converge on hud.ts and a new party_frames_painter.ts:

  Sub-task 1 - Build the party-frames keyed-pool painter (src/ui/party_frames_painter.ts).
  - Render each party member as a unit_frame family INSTANCE (decision 9: N instances over #party-frames, no single-instance assumption). Maintain a KEYED node pool: a Map from member key (pid) to a persistent pooled row record (the row element + its bound member-slot record + its child element refs). On each rebuild: reconcile the pool against the selected members (create rows for new keys, reuse rows for kept keys, detach/recycle rows for departed keys); update each kept row's data IN PLACE through the elided writers; never innerHTML-wipe the container.
  - Attach click/contextmenu ONCE per pooled row at creation (and the tooltip if any), bound to a LIVE MUTABLE slot record (the row's current member), NOT a member captured by value (top-risk 3: a captured member is stale after the row is recycled to a different pid). The leave button is created ONCE and kept; its click listener is attached once.
  - Route EVERY write through the elided writers: setText for name/level/badge text, setTransform/setWidth for the HP + resource bars, setStyleProp(row, '--cls', classCss(m.cls)) for the class color custom property (the inline frame.style.setProperty('--cls', ...) at 11532 is NOT covered by the four original writers, so it MUST go through setStyleProp), toggleClass(row, 'dead'|'combat'|'oor', on) for the row state classes (NOT a className string rebuild), toggleClass(container, 'below-target', on). No raw el.style / el.className / el.innerHTML / el.setAttribute / addEventListener-per-rebuild in the painter.
  - Painter values token-driven (decision 12): the class color is the --cls custom property (already a token), the bar scale precision (3) and any threshold (PARTY_FRAME_RANGE_YD comes from the selector) are named constants, never bare literals; the dead/combat/oor badge icons are the existing svgIcon/iconDataUrl helpers, not inline literals.

  Sub-task 2 - Hoist the selector allocation AFTER the sig short-circuit.
  - The current order computes the signature from the selector result, so the selector is allocated BEFORE the short-circuit can fire. Restructure so an UNCHANGED party allocates nothing: compute the cheap signature inputs first (or cache the prior selector result) so that when the party has not changed, selectPartyFrameMembers is NOT called and no array is allocated. If the signature genuinely needs the selector output, cache the prior result and the prior sig together and short-circuit on the cheap inputs before re-running the selector. A test proves an unchanged party allocates nothing (no selector alloc before the sig short-circuit).

  Sub-task 3 - Wire the painter into updatePartyFrames() and delete the inline render.
  - Replace the inline loop + innerHTML wipe + per-rebuild listeners (hud.ts:11525-11561) with the keyed-pool painter call. Preserve the no-party clear (hide/empty the pool) and the lastPartySig reset semantics. Construct the painter once (Hud ctor / one-time init); do not re-query the DOM per frame.

A11y (decision 10, the WINDOW/CONTROL row): each party-member row gets role + an accessible name via a t() key (never concat or a ?? fallback) naming the member (and group in raid). Each row is keyboard-focusable and a valid click target reachable in tab order (it selects on click and opens the context menu on contextmenu), meeting target-size (SC 2.5.8 >=24px absolute floor, >=40x40 on mobile touch controls; do NOT weaken the existing mobile floor). The contextmenu action also needs a keyboard path (a context-menu key or an equivalent). visible :focus-visible is never animated/blurred away. The leave button keeps its t() label and is keyboard-reachable. A forced-colors snapshot keeps the dead/combat/oor cues distinguishable without relying on a background color alone. The 3D world/canvas stays OUT of a11y scope (state the boundary). Any new aria key goes in src/ui/i18n.catalog/hud_chrome.ts (English-only); reuse the existing dead/combat/oor/leaveParty keys.

INVARIANTS THIS PHASE MUST KEEP (from state.md locked decisions + non-negotiable constraints):
- Presentation-only. Consume V16's already-landed IWorld; do NOT extend IWorld or touch src/sim, server, src/net, headless. If the slice finds it needs to, STOP and surface it (scope change). Extending the unit_frame family's own instance descriptor is in scope; extending IWorld is not.
- Component contract (decision 9): party members are N INSTANCES of the ONE unit_frame family core+painter, instance-parameterized (no hardcoded element ids, no single-instance assumption), NOT a bespoke party core. Reuse the family + the pure selectPartyFrameMembers; do not fork the family.
- Per-frame write-elision (decisions 3, 5, 5a): every imperative DOM write goes through the host's elided writers (setText/setDisplay/setTransform/setWidth + the P10a-added setStyleProp/toggleClass reading hotWriteCache); the cache keys on the EXACT string/value, so a non-byte-identical key or a raw el.style/className/innerHTML/setAttribute silently collapses the skip-rate. The --cls custom property -> setStyleProp; the dead/combat/oor/below-target classes -> toggleClass. No raw writes; no per-rebuild addEventListener.
- Keyed node pool (top-risk 3): one persistent node per member key, click/contextmenu/tooltip attached ONCE per pooled row, bound to a LIVE MUTABLE slot record (never a member captured by value), no duplicate listeners across rebuilds, no dropped member-row listener, no innerHTML wipe of the container.
- No magic values in painters (decision 12): painter color/size/threshold values are CSS custom properties or named constants (the --cls token, the bar precision, PARTY_FRAME_RANGE_YD from the selector), never a bare literal in TS.
- Determinism for cores: the unit_frame family core and selectPartyFrameMembers stay DOM/Three-free with no Math.random/Date.now/performance.now. Same input gives same output.
- ClientWorld-vs-Sim parity (decision 15): the party out-of-range shape (the oor flag from the selector, computed from the member x/z vs the player pos) is Sim-vs-ClientWorld sensitive (the online mirror's party member position/range cadence may differ from the offline Sim). The selector/family core test for the party instance feeds BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub so an offline-only out-of-range shape cannot ship broken online.
- Accessibility (decision 10): each party row is labelled with a t() key, keyboard-focusable, a valid click + contextmenu target, and meets target-size; the canvas stays out of a11y scope.
- i18n: any new player-visible label is a t() key in src/ui/i18n.catalog/hud_chrome.ts (English-only). Never edit i18n.locales/<lang>.ts. Reuse the dead/combat/oor/leaveParty keys.
- No em dashes, en dashes, or emojis anywhere (code, comments, docs, commits).
- Shared worktree: commit with EXPLICIT paths, never git add -A.

Out of scope (do NOT do in this phase):
- The cast bars (P11a, done) and the target frame (P11b, done).
- The auras pool rewrite (P12; the party frames do not render auras here).
- Action bar, minimap markers (P12), FCT (P13).
- xp bar, swing timer, player frame, the unit_frame family itself (P10, done; you instantiate it).
- Rewriting selectPartyFrameMembers (it is already pure in src/ui/party_frames.ts; you consume it).
- The consolidated cross-window a11y audit + skip links + global focus management (P15); only the per-row labelling/focus/target-size for THESE frames lands here.
- Any IWorld extension, sim/server/net edit, or new graphics-governor wiring.

STEP 3 - VALIDATION + REVIEW:
Validation-matrix rows (state.md):
- Baseline: npx tsc --noEmit.
- biome check on the new/changed .ts (src/ui/party_frames_painter.ts, src/ui/hud.ts, any new test): the V16 ratchet; no new lint debt.
- Pure core changed (only if the family descriptor is extended): npx vitest run the unit_frame family core test (the party member instance fields) + npx vitest run tests/architecture.test.ts (the UI-purity guard; the family + selector stay in UI_PURE_CORES and the guard FAILS on an injected REAL DOM-import line in a registered core, not a // comment) + a same-input-same-output assertion + the ClientWorld-vs-Sim parity assertion (decision 15: drive the selector/core with BOTH a Sim-shaped and a ClientWorld-mirror-shaped IWorld stub; assert the party out-of-range shape matches).
- PER-FRAME perf gate: run the perf_tour harness (scripts/perf_tour.mjs) desktop + mobile and assert frameP95 <= the P0 baseline AND hudHotDomSkipRate >= the P0 baseline (party writes are now counted/elided, so skip-rate should hold or improve). Plus a unit test that the party painter routes ALL writes through the host's elided writers (incl setStyleProp for --cls + toggleClass for dead/combat/oor/below-target), NO raw style/className/innerHTML/setAttribute (decision 5a). Plus the phase-specific bounded assertions: the painter does NOT duplicate click/contextmenu (or tooltip) handlers across rebuilds and drops no member-row listener (the keyed-pool test, exercising a member leaving and a new member with a recycled pid to prove the closure reads the live slot, not a stale captured member); and the selector is NOT allocated before the per-frame sig short-circuit (an unchanged party allocates nothing).
- WINDOW/CONTROL a11y row (for the party frames): automated axe-core (or equivalent) over the built frames clean; each row is labelled (t() key), keyboard-reachable + a valid click + contextmenu target + target-size >=24px (>=40x40 on mobile); visible :focus-visible never animated away; a forced-colors: active snapshot keeps the dead/combat/oor cues distinguishable. Plus the no-magic-values painter guard (the painter references the --cls token + named constants, not a literal hex/px).
Review dispatch (spawn ONLY matching rows): qa-checklist only. This diff is presentation-only and does not touch server/, src/admin/, src/net/, src/world_api.ts, src/sim/, or migrations, so privacy-security-review, migration-safety, and cross-platform-sync do NOT fire (the ClientWorld-vs-Sim parity obligation is covered by the per-core parity test, not by spawning cross-platform-sync). Prompt the reviewer for COVERAGE, not filtering; resume a truncated reviewer per the state.md script; do not commit until it reports no BLOCKING.

STEP 4 - COMMIT CADENCE:
2-5 Conventional Commits, scoped, EXPLICIT paths. Suggested:
- feat(ui): keyed-pool party frames as unit_frame instances, listeners attached once (src/ui/party_frames_painter.ts, src/ui/hud.ts)
- perf(ui): hoist the party selector allocation after the sig short-circuit (src/ui/hud.ts)
- feat(ui): a11y label + focus + target-size + forced-colors cues on party rows (src/ui/party_frames_painter.ts, src/ui/i18n.catalog/hud_chrome.ts)
- test(ui): party keyed-pool no-duplicate-listener + live-slot closure + no-pre-sig-alloc + ClientWorld-vs-Sim parity (tests/party_frames_painter.test.ts)
- docs(frontend): update progress.md + state.md ledger for P11c (docs/frontend-modernization/progress.md, docs/frontend-modernization/state.md)

STEP 5 - ACCEPTANCE CRITERIA (all verifiable and green):
- [ ] npx tsc --noEmit passes; biome check is clean on every new/changed .ts.
- [ ] Each party member is an INSTANCE of the P10b unit_frame family (no bespoke party core was added; the family + the pure selectPartyFrameMembers are reused); the inline render at hud.ts:11525-11561 is replaced by the keyed-pool painter call.
- [ ] The painter uses a KEYED node pool: one persistent node per member key, reused across rebuilds; the innerHTML-wipe is gone.
- [ ] click/contextmenu (and tooltip) are attached ONCE per pooled row, bound to a LIVE MUTABLE slot record (not a member captured by value), with no duplicate listeners across rebuilds and no dropped member-row listener; a test proves no handler duplication AND that a recycled row reads the new member (not the stale one). The leave button is created once with its listener attached once.
- [ ] The party selector is NOT allocated before the per-frame signature short-circuit; a test proves an unchanged party allocates nothing.
- [ ] Every write routes through the elided writers (setText/setDisplay/setTransform/setWidth + the P10a setStyleProp for --cls + toggleClass for dead/combat/oor/below-target); a routing test asserts no raw style/className/innerHTML/setAttribute and no per-rebuild addEventListener.
- [ ] No magic values in the painter: the --cls token, bar precision, and PARTY_FRAME_RANGE_YD are CSS custom properties / named constants; the no-magic-values guard passes.
- [ ] A11y: each party row is labelled with a t() key (no concat / ?? fallback), keyboard-focusable, a valid click + contextmenu target, in tab order, and meets target-size >=24px (>=40x40 on mobile); axe-core over the built frames is clean; a forced-colors snapshot keeps the dead/combat/oor cues distinguishable.
- [ ] ClientWorld-vs-Sim parity: the selector/core test drives BOTH a Sim-shaped and a ClientWorld-mirror-shaped stub and the party out-of-range shape matches.
- [ ] The unit_frame family core + selectPartyFrameMembers stay registered in UI_PURE_CORES; tests/architecture.test.ts passes and FAILS on an injected real DOM-import line; no Math.random/Date.now/performance.now in any core.
- [ ] PERF GATE: scripts/perf_tour.mjs desktop AND mobile show frameP95 <= P0 baseline AND hudHotDomSkipRate >= P0 baseline; the new skip-rate is recorded.
- [ ] qa-checklist reviewer reports no BLOCKING.
- [ ] No IWorld / sim / server / net / CSS-rule changes; any new label is a single English-only hud_chrome.ts key.

STEP 6 - DOC UPDATES + MEMORY:
- Update progress.md (P11c row: the keyed-pool party painter, the listener-once + live-slot pattern, the hoisted selector alloc, the recorded hudHotDomSkipRate, the a11y additions).
- Update state.md ledger (mark P11c; new file: src/ui/party_frames_painter.ts + tests/party_frames_painter.test.ts; the party unit_frame instances; the hoisted selector alloc; perf-gate result vs baseline; the a11y additions).
- Record surprising rules in memory: the party keyed-pool listener-once + live-mutable-slot pattern (the closure must read the slot, not a captured member, or it goes stale after recycle), the selector-alloc-after-sig hoist, the --cls via setStyleProp + row-state via toggleClass routing, any skip-rate movement, and the worktree-isolation integration order. This keyed-pool discipline de-risks the larger auras pool (P12) and the FCT pool (P13).

STEP 7 - FINAL RESPONSE:
Report status, files changed (absolute paths), validation results (tsc, biome, the unit_frame family core + selector test incl the parity assertion, architecture guard, perf_tour frameP95 + skip-rate vs baseline, the a11y/axe result, the no-duplicate-listener + no-pre-sig-alloc tests), reviewer verdict, and deferrals. End with exactly:
Next: phase-12a-perframe-action-bar.md

STOPPING RULES:
- STOP if the keyed-pool rewrite cannot preserve the click/contextmenu/tooltip listeners without duplication, or a recycled row would read a stale captured member; surface it rather than ship a listener leak or a stale-closure bug.
- STOP if the per-frame extraction regresses perf_tour frameP95 above the P0 baseline OR drops hudHotDomSkipRate below the P0 baseline; do not commit a perf regression, diagnose the raw-write or cache-key cause first.
- STOP if the --cls custom property or the row-state classes cannot be routed through the elided writers without a raw write (the P10a setStyleProp/toggleClass should cover them; if not, that is a 5a writer-coverage gap, surface it).
- STOP if a party member cannot be expressed as a unit_frame INSTANCE without forking the family into a bespoke core; surface it as a component-contract (decision 9) gap rather than adding a parallel module.
- STOP and surface (scope change) if the slice finds it needs to extend IWorld or touch sim/server/net.
- STOP if the working set approaches the ~40% context ceiling; this slice is already a single split, so escalate to the user rather than degrade.
```

## Notes for the planner

This is the third and last P11 sub-phase, and the highest-churn of the three: the live code at
hud.ts:11525-11561 wipes #party-frames with innerHTML='' and re-attaches click + contextmenu listeners on a
freshly created <div> every rebuild, which is exactly state.md top-risk 3 (an innerHTML-wipe to keyed-pool
rewrite silently dropping listeners/tooltips). The non-obvious correctness trap is the closure: a naive pool
that binds click to a member captured by value goes stale the moment the row is recycled to a different pid,
so the listener must read a LIVE MUTABLE slot record, and the test must prove it by recycling a row to a new
member. The deep-review line-ref correction lives here: the selector is selectPartyFrameMembers in
src/ui/party_frames.ts (imported), NOT inline at hud.ts:11520 (11520 is the CALL SITE), so this slice
consumes the selector and does not rewrite it. The selector-alloc hoist is a real allocation win: today the
signature is built from the selector output, so the short-circuit cannot avoid the selector alloc; restructure
so an unchanged party allocates nothing. The two raw writes the four original writers cannot express, the
frame.style.setProperty('--cls', ...) at 11532 and the row-state className construction at 11528-11531, are
why P10a's setStyleProp/toggleClass extension is a hard dependency. Getting this keyed-pool pattern right
de-risks the larger auras pool (P12) and the FCT pool (P13), which reuse the same pooled-node discipline
under worse worst-case churn. Decision 15 matters because the party out-of-range (oor) flag is computed from
member positions vs the player pos, a cadence the offline Sim and the online ClientWorld mirror can diverge on.
