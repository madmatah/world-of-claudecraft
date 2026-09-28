# Realm Racers: contact under latency, the last mile

Status: DECIDED, and the forward window is RETIRED. Racer contact is the
same-tick swept test (`resolveVehicleContactSwept` in
`src/sim/vehicle_contact.ts`, called from `tickContacts` in
`src/sim/social/realm_racers.ts`) on every host, offline, online and headless
alike. The earlier Option B, a forward window that fired a touch up to two
ticks before the hulls met (`resolveVehicleContactEarly` behind
`REALM_RACERS_CONTACT_EARLY_TICKS`), was implemented, measured once the display
was right, and removed. The pin is the "holds an imminent lunge until the hulls
meet" case in `tests/realm_racers_match.test.ts`, plus the "lot 7 flipped"
block in `tests/realm_racers_rival_frames.test.ts`.

## Where the problem stands

Racer-versus-racer contact resolves server side, in `tickContacts`, by testing
both machines at the same server tick against their combined body radius (3.4
yards for two loaners). The contact test is swept over the tick's motion, so a
pair whose closing speed crosses the whole reach inside one 50 ms tick (a
head-on, a shell launch) cannot tunnel through the discrete test.

What each pilot's screen shows, on movement wire v2 (every browser):

1. The pilot's own kart IS predicted in the browser. The v2 pipeline
   (`src/render/self_prediction.ts` with `self_prediction_core.ts`) steps the
   shared kernel over the same per-tick input frames the client sent, seeded
   and reconciled from the full-precision drive recon `rdv`, so the kart is
   drawn about the uplink AHEAD of the server's copy. Driver prediction is on by
   default (`MovementPredictionPipeline.predictDrivers`); `?drivepredict=0` is
   the playtest opt-out that draws the kart from the interpolated mirror. The
   earlier premise of this document, "the pilot's own machine was already
   predicted to the present (`src/render/self_motion.ts`)", described the v1
   extrapolator, which no browser runs: before the drive-aware v2 prediction
   the browser either stepped a kart with the runner kernel (a 20 Hz surge and
   snap) or, stood down, drew it from the mirror, behind the server.
2. Rivals are projected through the real vehicle kernel into the SAME time
   frame as the local kart (`remoteRacerHorizon` in
   `src/render/remote_vehicle_display_core.ts`): the horizon is the local
   display's predicted client tick over the acknowledged one
   (`selfFrameLeadMs`), read off the predictor's own bookkeeping, with no ping
   estimate. So a rival drawn next to your kart is where the server will have it
   when the server reaches the instant your kart shows.

With both machines drawn in one frame, the touch a pilot sees is the touch the
server computes about one uplink later. The remaining latency is the reaction:
a bump is a server outcome, so it reaches the screen through the reconcile
replay about one round trip after the drawn touch. That is inherent to
server-authoritative contact and is not a contact-rule problem.

## The forward window, measured and retired

The window assumed a client geometry that was false when it shipped (no browser
predicted the local kart) and it runs as a sim constant, so it also fired early
offline and between house pilots, where there is no latency at all. Once the
local kart was predicted and rivals shared its frame, it was measured with the
two-human duel harness (`tests/helpers/rival_frames.ts` `runDuel`, driver
prediction on, the rear ram and the side swipe at 60 / 120 / 200 ms, 10 ms
jitter), at its shipped value (two ticks), at one tick, and removed:

| Window | Server gap at the bump, yd (reach 3.40) | Screens: first drawn touch vs the server bump, ms |
|---|---|---|
| 2 ticks | 3.61 to 5.19 (every bump over the reach) | +150 to -50; the 60 ms rear ram never draws a touch at all (closest 3.53 / 3.59 yd) |
| 1 tick | 3.40 to 4.23 | +150 to -67 |
| none | 3.40 exactly (every bump) | -17 to -100: every screen draws the touch first, by at most its own lead plus a tick |

Every contact still happened with the window removed (no missed bump in any
scenario or RTT). With the window, bumps fired while both screens still drew a
gap ("bounce off air"); without it, each screen shows the hulls meeting and the
server bumps at the touch. An online-only residue would need a per-session
latency input fed into the sim, which is Option C's cost (below) for a benefit
the measurement does not show, so none is kept.

One side effect worth knowing: with no early impulse, a grid-start side contact
between two house pilots is a real touch with depenetration, so a pilot can be
shoved into the barrier off the grid and spend a few seconds backing out. That
is ordinary racing behavior, not a regression of the contact rule.

## Options that stay parked

### Option C: per-viewer rewind (classic lag compensation)

Keep a position history, estimate each session's one-way delay, and evaluate
the contact for each pilot against the rival rewound to that pilot's view time.

- Cost: per-session latency estimation feeding the sim (a new impurity to
  fence), and a genuine design problem: contact is symmetric, so when the
  rewound evaluation succeeds for one pilot and fails for the other, the server
  must pick a winner, and every choice creates an outcome one pilot
  demonstrably did not see.
- Risk: high-ping advantage, plus parity-gate and determinism plumbing for the
  latency input.
- Verdict: not needed while rivals are drawn in the local kart's frame.

### Display-only contact impulse

Play the bump on the screen at the drawn touch, before the server confirms it,
so the reaction does not wait a round trip. It reverses the "we never predict a
bump" rule, and a false positive (a rival steering away at the last moment)
bounces the rival and then snaps it back. Parked: to be tried behind a flag
after the flag-on playtest, and kept only if such mispredictions are rare.
