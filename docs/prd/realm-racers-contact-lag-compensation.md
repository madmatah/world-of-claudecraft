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

## The bump drawn at the seen touch (shipped, a drawn-pose model change)

Play the bump on the screen at the drawn touch, before the server's contact
reaches it, so the reaction does not wait a round trip. This reverses the
earlier "we never predict a bump" rule for what is DRAWN (outcomes stay the
server's), so it is a change to the drawn-pose model of
`docs/design/movement-reconciliation.md` and `src/net/CLAUDE.md`, named for
the maintainer.

When the local bump bang fires (the drawn hulls meet with a real closing
speed, `own_bump_feedback_core.ts`), the sim's own resolver
(`resolveVehicleContact`) run on copies of the two drawn machines gives each
one's velocity change, capped at 24 yd/s; both are drawn moving by it, the
shift capped at 3 yd, half the rival projection's snap distance, so folding it
in does not by itself snap a rival (`src/render/realm_racers_contact_kick_core.ts`,
one kick at a time, started in
`src/render/realm_racers_scene.ts`). The self shift is its own term of the
self display's drawn pose (`self_render_position_core.ts` steps it before it
draws, so it is exact at any frame rate); the rival's is added to its drawn
pose. The kick retires on the acknowledgement that can carry the server's
contact (the first replay after the touch frame's acknowledgement, early
contacts included, or the touch tick plus two with none), never on the bump
event, so a contact under the event
threshold or inside its throttle cannot be drawn twice: the shift is handed to
the glides that carry the authoritative correction (the self handoff offset,
the rival's drawn pose), where the replayed contact cancels it, and a touch the
server never had glides back out. Nothing reaches the prediction, the mirror or
the wire, and every pose a command is aimed from (the Ground Blast aim clamp,
the own shot and oil cues) reads the pose WITHOUT the shift
(`displayedAimPose`). `?contactkick=0` turns it off (A/B arm).

Measured on the two-human duel harness, the same race with the kick off and
on (scripted side jinks, brake checks and close passes; two link seeds;
contacts are server bumps a screen drew a touch for; error is a drawn machine
against the server at the instant the local kart is drawn, 150 ms before to
600 ms after the contact; yards):

| RTT / jitter (60 fps) | Self error mean, off to on | Self error max, off to on | Rival error mean, off to on | False touches (share of drawn touches) |
|---|---|---|---|---|
| 60 ms / 10 ms | 0.10 to 0.07 | 0.98 to 0.98 | 0.14 to 0.12 | 4 pct |
| 60 ms / 30 ms | 0.25 to 0.18 | 2.13 to 1.56 | 0.25 to 0.19 | 0 pct |
| 120 ms / 10 ms | 0.21 to 0.13 | 1.58 to 1.59 | 0.33 to 0.24 | 0 pct |
| 120 ms / 30 ms | 0.56 to 0.46 | 3.26 to 2.48 | 0.68 to 0.57 | 9 pct |
| 200 ms / 10 ms | 0.91 to 0.77 | 3.20 to 3.05 | 1.02 to 0.84 | 4 pct |
| 200 ms / 30 ms | 0.99 to 0.87 | 4.54 to 4.47 | 1.04 to 0.98 | 2 pct |

| Frame rate (120 ms / 10 ms) | Self error mean, off to on | Self error max, off to on | False touches |
|---|---|---|---|
| 20 fps | 0.28 to 0.13 | 2.18 to 1.42 | 6 pct |
| 30 fps | 0.17 to 0.09 | 1.41 to 0.65 | 12 pct |
| 60 fps | 0.21 to 0.13 | 1.58 to 1.59 | 0 pct |
| 144 fps | 0.18 to 0.10 | 1.81 to 1.06 | 0 pct |

The false touches are near misses that stay within 0.2 yd of the reach, and
grazes under the bump threshold; one costs up to 2.3 yd at 200 ms (under the
3 yd cap), gliding back out. The drawn bump starts a median 80 to 230 ms
before the server's contact reaches the screen. The bump is drawn as the
velocity step it is, so the largest frame-to-frame change of the drawn self
over a contact is up to about 0.25 yd sharper than with the late correction
alone. The pins are `tests/realm_racers_contact_kick.test.ts` (prediction,
mirror and race unchanged frame for frame; the start before the server's
contact; the error against the late correction alone, by a margin, at every
RTT and frame rate; drawn identically with and without a bump event; an
under-threshold contact not drawn twice; an unconfirmed touch capped and
handed back) and `tests/realm_racers_contact_kick_core.test.ts`.
