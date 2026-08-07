# Realm Racers: contact under latency, the last mile

Status: DECIDED, Option B chosen and implemented, in its FORWARD form:
`resolveVehicleContactEarly` in `src/sim/vehicle_contact.ts`, wired into
`tickContacts` behind `REALM_RACERS_CONTACT_EARLY_TICKS`. The window fires
the touch a pair is ABOUT to make within the horizon at its current motion,
impulse-only (no depenetration, no position writes), gated on the
announceable-bump closing-speed floor.

Why forward rather than the history sketch below: the first implementation
compared the attacker's present hull against the rival's recorded past
segments, and review measured the flaw before it shipped. Testing against
where the rival stood K ticks ago forgives the rival's OWN displacement,
several yards per tick at race speed, so a straight-line follower took a full
bump from 7 to 12 yards back at 4 yd/s of closing while a genuinely close one
got nothing (the reach around discrete past segments forms an annulus, not a
disc). The forward window forgives only the CLOSING distance covered inside
the horizon, under a yard for a tailgater and a couple of yards in a real
lunge, which is the actual perception gap; a slipstream with ~zero closing
can never trip it, and no position history, teleport invalidation, or probe
ordering exists at all. Awaiting the user's in-game verdict on whether it
stays.

## Where the problem stands

Racer-versus-racer contact resolves server side, in `tickContacts`
(`src/sim/social/realm_racers.ts`), by testing both machines at the same
server tick against their combined body radius (3.4 yards for two loaners).
Three latency fixes have already landed on `feature/realm-racers`:

1. Remote machines are drawn projected to the present through the real
   vehicle kernel (`src/render/remote_vehicle_display_core.ts`), removing the
   downlink-plus-interval display lag (~110 ms at a 120 ms RTT) and the
   jitter stutter.
2. The pilot's own machine was already predicted to the present
   (`src/render/self_motion.ts`).
3. The contact test is swept over the tick's motion
   (`resolveVehicleContactSwept` in `src/sim/vehicle_contact.ts`), so a pair
   whose closing speed crosses the whole reach inside one 50 ms tick (a
   head-on, a shell launch) can no longer tunnel through the discrete test.

What remains is structural: at a round trip of E, the server's copy of the
LOCAL machine trails the pose its pilot is steering by roughly the uplink
half plus tick quantization (E/2 + up to 50 ms; about 85 ms at E = 120 ms).
Both pilots see themselves at the present and their rival near the present,
but the server compares two poses of which each pilot's OWN is stale. A lunge
that visually connects can therefore still miss server side by
`speed * (E/2 + q)`: about 2.5 yards at 30 yd/s, under but close to the
3.4 yard reach, and more at speed. No client-side display work can close this
gap; only the server's contact rule can.

## Options

### Option A: accept the residual

Do nothing further. The gap is now under one body radius at typical corner
speeds and pings, and every other latency symptom is addressed.

- Cost: zero. Risk: zero.
- Verdict: the honest baseline. Reject only if play testing still reads
  contact as unfair.

### Option B: time-window contact (recommended)

Keep a short per-racer position history on the match (sim state, a ring of
the last N tick segments, N around 4). Declare contact when machine A's
segment at tick t and machine B's segment at tick s come within reach for any
pair with `|t - s| <= K` ticks, with K a small constant (start at 2, i.e.
100 ms). Resolve at the touch configuration of the offending pair of
segments, with the same impulse pipeline the swept test uses today.

The rule is symmetric by construction: it never asks whose view was right,
it asks whether the two hulls crossed the same ground within K ticks of each
other, which is exactly the situation both pilots read as "we touched". It
needs no per-session latency estimate, draws no rng, and adds no new tick
phase (it extends the existing contact pass), so determinism and the parity
gate are untouched: the history is ordinary sim state and K is a constant.

- Cost: a bounded history ring per seated racer, and the pair test grows
  from one segment pair to at most (2K+1) segment pairs; with four racers
  and K = 2 that is at most 30 sweep tests per tick, all pure arithmetic.
- Risk: ghost contacts. A pair that genuinely missed by less than
  `relative speed * K ticks` reads as a touch. At K = 2 and a 20 yd/s
  relative pass that is up to 2 yards of tolerance: the same order as the
  perception gap it forgives. K is the single knob; lower it if contact
  feels grabby, and K = 0 degrades exactly to today's swept test.
- Fairness note: the tolerance applies identically to every pilot whatever
  their ping, which is both its virtue (no per-player asymmetry to exploit)
  and its limit (a 300 ms pilot still misses more than a 40 ms one; the
  window narrows the difference rather than erasing it).

### Option C: per-viewer rewind (classic lag compensation)

Keep the same position history, estimate each session's one-way delay, and
evaluate the contact for each pilot against the rival rewound to that
pilot's view time.

- Cost: per-session latency estimation feeding the sim (a new impurity to
  fence), and a genuine design problem: contact is symmetric, so when the
  rewound evaluation succeeds for one pilot and fails for the other, the
  server must pick a winner. Every choice (favor the initiator, favor the
  lower ping, apply half) creates an outcome one pilot demonstrably did not
  see, and "initiator" is not even well defined for two machines leaning on
  each other.
- Risk: high-ping advantage (the classic favor-the-shooter complaint,
  symmetrized), plus parity-gate and determinism plumbing for the latency
  input.
- Verdict: the heavy option. Only worth specifying further if Option B's
  uniform window proves insufficient in play.

## Recommendation

Option B with K = 2, behind a named constant beside the other contact
tuning in `src/sim/vehicle_contact.ts` or the rally module, with the
degenerate K = 0 pinned equal to the swept test in the leaf's suite. Ship it,
play test under netem at 60 to 150 ms, and only then decide whether Option C
is worth its complexity.
