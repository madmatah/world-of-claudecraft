# Realm Racers

The design reference for the Realm Racers vehicle race. It describes what the code does
today; when this file and the code disagree, the code wins and this file is the bug.

## What it is

Realm Racers is a queued vehicle race. A heat seats a full grid of `REALM_RACERS_GRID_SIZE`
pilots, each on the same loaned machine (`REALM_RACERS_VEHICLE_KEY`, a `VEHICLE_PROFILES`
record in `src/sim/content/vehicles.ts`), on a circuit that stands in its own reserved band of
the instance plane (`REALM_RACERS_ORIGIN` and the lane table in
`src/sim/realm_racers_layout.ts`). It is the one shared `src/sim/` code on every host: the
offline browser world, the online server and the headless env run the same match body. Online
the server is authoritative: clients send driving input and commands, and the server decides
seating, laps, contact, weapons, pickups, the referee and every result. The match lifecycle is
`src/sim/social/realm_racers.ts`, reached from the coordinator through
`src/sim/social/realm_racers_context.ts` (`updateRealmRacersPhase`, run after all movement in
the tick).

## Match lifecycle

### Queue

A player opens the Realm Racers window (`src/ui/realm_racers_window.ts`, the `rally`
interface keybind and its micro-menu button) and joins the queue (`IWorld.joinRealmRacersQueue`, the
`realm_racers_join` command, `realmRacersQueueJoin`). The queue is a plain FIFO of pids.

One eligibility test (`eligible` in `src/sim/social/realm_racers.ts`) serves the queue join,
the queue pop and Practice. It refuses a player who is:

- leaving the world, dead, or a ghost;
- anywhere on the instance plane (past `DUNGEON_X_THRESHOLD`);
- in or queued for an arena match, in a duel or a trade, or queued for or playing a card duel;
- held by another activity (`realmRacersHeldElsewhere`, `src/sim/social/realm_racers_busy.ts`):
  jailed, in a vehicle seat, in the wisp maze, the shadow trial or a glide, carrying world quest
  delivery cargo, on a ferry or a ship deck (or with a ferry-parked pet), or in a battleground
  match, group or proposal;
- already seated in a race.

There is no level gate. A queued player who stops being eligible is dropped with an
unqueued event (`pruneQueue`). There is one public race at a time (`RealmRacersState.match`):
when no public race is running and the queue holds a full grid, the head of the queue is
seated (`tryMatch`). A queued race draws its circuit from the competition pool with one
`ctx.rng` draw at seat time (`drawCompetitionCircuit`), after every refusal has run.

### Backfill

Backfill is online only: it runs when `cfg.realmRacersBackfill` is set, which
`server/sim_boot_config.ts` does and the offline world does not (offline, Practice covers solo
play). When no public race is running, the queue is not empty but short of a full grid, and
the oldest waiter at its head has waited `REALM_RACERS_BACKFILL_TICKS`, `maybeBackfill`
(`src/sim/social/realm_racers_bots.ts`) spawns house pilots at `REALM_RACERS_BACKFILL_TIER`
into the empty seats and seats the grid on the circuit's public lane.

House pilots are real players added with `{ bot: true }` and marked in
`RealmRacersState.bots`. They hold the same controls a human holds, written into
`meta.moveInput` by the brain in `src/sim/realm_racers_driver.ts` (`driveRealmRacers`), so
they run through the same vehicle kernel, collision and surface penalties. Their decisions
draw no rng.
One rule reaps them: a house pilot seated in no live race is despawned on that tick.

The window reports `queueViable` false when neither backfill nor enough connected players
can ever fill a grid.

### Loading lobby

Every race opens in the `loading` phase (`src/sim/social/realm_racers_loading.ts`). The
pilots are seated on the grid and held: controls locked, the drive zeroed every tick, no race
clock running. The countdown starts on one tick for the whole field once every pilot still
seated is ready (`realm_racers_ready`, `markRealmRacersReady`) or once
`REALM_RACERS_LOADING_MAX_TICKS` runs out, whichever comes first. House pilots are ready
from the seat. A client sends ready only when its race preparation has a verdict for every
producer (`src/ui/realm_racers_ready_core.ts`), never on a clock. On the server a dropped
socket clears that pilot's ready and empties their input for the linkdead grace
(`server/disconnected_player_input.ts`, `realmRacersUnready`); the pilot stays seated, so a
dead client costs the others the cap and nothing more.

**The void rule.** A race decided before GO is void: `endMatch` sets `voided` when the phase
is `loading` or `countdown`. A race is decided (`raceIsDecided`) when nobody is still
driving, when only house pilots are still driving, or when one pilot is left because the
others quit and nobody has finished. Before GO that happens through forfeits, a player
leaving the world (online, once the linkdead grace ends), death, or a moderation jail. A void
heat has no winner, moves no
`rrWins` and credits no deed. Every pilot gets a `void` result and goes home on the normal
return clock. Pinned by the void block of `tests/realm_racers_loading_lobby.test.ts`.

**The client failsafe.** The lobby curtain (`src/ui/hud/realm_racers/`, see its
`CLAUDE.md`) shows only while the viewer's own match is in `loading`, and lifts for the whole
grid on the server's switch to the countdown. It lifts early on a lost connection, and
`stepRealmRacersLobbyFailsafe` bounds it on the client clock: each newly received
`secondsLeft` becomes a deadline plus `REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS`, so a frozen
readout cannot hold the curtain up. The failsafe is presentation only; it never sends ready.

### Countdown

When the lobby closes, `beginRealmRacersCountdown` writes `goTick` (`REALM_RACERS_COUNTDOWN_TICKS`
ahead) and `deadlineTick` (the circuit's `timeLimitSeconds` past GO). Pilots stay locked and
zeroed until `goTick`, when the phase turns to `racing` and every pilot gets a
`realmRacersGo` event. The client plays its establishing shot over the countdown
(`src/game/realm_racers_start_camera.ts`).

### Race

A racing tick runs, in order (`tickMatch`): recovery ghosts settle, rival contacts resolve,
the off-track bands and the referee run, lap progress advances, then oil, pickup boxes and
Ground Blast impacts. Lap progress is arc length along the circuit spline
(`stepRealmRacersProgress`); the ordered recovery anchors (`realmRacersGates`) only record
where a recovery puts the machine back.

Crossing the line does not end the race. It ends at the earliest of the deadline, the chase
window the first finisher opens (`REALM_RACERS_CHASE_TICKS`), or the race being decided. A
pilot still driving who forfeits (`realm_racers_forfeit`), leaves the world, dies or is jailed
is retired:
classified last, while the race goes on for everyone else. While the race runs, a pilot who
finished keeps the wheel and may drive off; a retired pilot is held where they stopped.

Recovery puts a machine back on the centerline at the last ordered anchor, stopped and facing
along the track, with its lap bookkeeping rewound (`resetRacerTo`). It comes from the manual
control (`realm_racers_reset`, lock `REALM_RACERS_RESET_LOCK_TICKS`), from a machine stuck off
the road under `REALM_RACERS_STUCK_SPEED` for `REALM_RACERS_STUCK_TICKS`, or from the
referee's loiter verdict (below); the stuck and loiter arms lock for
`REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS`.

### Results

One comparator orders the grid, live and final (`rallyClassification`,
`src/sim/realm_racers_standings.ts`): finishers by crossing tick and sub-tick fraction, then
pilots still driving by distance travelled, then quitters with the latest quitter first; the
frozen grid slot breaks any tie. The winner is first in that order, except in a void heat or
a dead heat for the lead (`rallyLeadIsDeadHeat`: the top two both still driving and within
`REALM_RACERS_DEAD_HEAT_YARDS`), where there is no winner. Each pilot gets one
`realmRacersResult` event (placing, grid size, won, forfeited, voided); a quitter gets theirs
when they quit.

### Return

Pilots still seated are returned `REALM_RACERS_RETURN_TICKS` after the race ends
(`teardownMatch`). A quitter is returned the same delay after quitting. A pilot who leaves the
world, dies or is jailed is returned at once, so a leave restores the character before it is
saved. The return
(`restoreRacer`) closes what the seat opened (`standardizeRacer`):

- position and facing: the spot the pilot held when seated, not a fixed point;
- mount: the mount they had when seated; the drive state is removed;
- kit: the class abilities, recomputed;
- auras: the clean-slate wipe (`resetForArena`) runs at the seat and again at the return, so
  the race itself is buff-free, but every aura the seat stripped comes back
  (`src/sim/social/realm_racers_auras.ts`, snapshot `RealmRacersMatch.strippedAuras`): a timed
  aura with its remaining time minus the ticks between the seat and the return, dropped if
  that runs out; an untimed one (permanent, or an engine aura the aura pass never ages) as it
  was. The recovery sicknesses ride the pools below instead, the Cheater mark is never
  stripped, and nothing the race applied (ward, ghost, surface slows) is ever in the snapshot.
  A druid's parked mana and Cat energy deficit come back with the form;
- pools: `restoreArenaReturnPools` hands back the HP, resource, cooldowns, ability charges,
  crowd-control diminishing returns and any recovery sickness owed on the way in;
- the pet stowed at the seat comes back.

A save taken while seated writes the pre-race return spot (`realmRacersSaveOverlay`), never a
point on the circuit, and the race kit is never persisted. It writes the pre-race pools too,
including the mana a druid seated in a form had parked. Auras are session state that no save
path writes, so a leave restores the stripped auras on the live body before the save, and a
linkdead pilot keeps that body through the grace.

## Rated vs practice

"Rated" in the code and the deed text means a heat seated from the queue on a circuit's
public lane (`match.practice === null`), backfilled heats included. There is no rating number.

Practice (`startRealmRacersPractice`, the `realm_racers_practice` command,
`IWorld.startRealmRacersPractice`):

- starts from the window at a tier the player picks (`RallyDriverTier`), offline or online,
  with no queue and no wait; a queued player who starts Practice leaves the queue and is
  seated;
- always runs the practice circuit (`REALM_RACERS_PRACTICE_CIRCUIT`, the one record with the
  `practice` role) on a private lane copy (`realmRacersFreePracticeSlot`), and is refused while
  every copy is in use (`practiceAvailable`);
- runs the circuit's `practiceLaps` instead of `laps`, and draws no circuit rng;
- plays the same rules as a rated heat: the same tick body, referee, pickups and weapons;
- credits nothing: no `rrWins` and no deed (the practice gates in `endMatch`,
  `onRallyRaceEndForDeeds` and `onRallyLapForDeeds`).

In a rated heat a human winner's `rrWins` goes up by one if at least one other human raced it
(`src/sim/social/realm_racers_credit.ts`): seated on the roster the race records when its phase
turns to racing (`seatedAtGo`), then finished or completed at least lap 1. The deed hooks run for
every human on the grid. A solo queuer backfilled against
house pilots races a rated heat for the finish deeds and the flying laps, but banks no win and no
win deed.

The dev-only `/dev rally <circuit> [tier]` (`startRealmRacersDevRace`) seats a named
circuit's public lane with house pilots, so it is a rated heat; it is unreachable without
`ctx.devCommands`.

## Rewards policy

- **Deeds**: the `pvp_rr_*` family in `src/sim/content/deeds.ts`, every one at Renown 0 and
  still counted toward Book completion. The only reward in the family is a cosmetic title on
  `pvp_rr_wins_25`. Rules and pins: "Realm Racers deeds" in `docs/design/deeds.md`.
- **`rrWins`**: rated first-place finishes with a human rival who raced
  (`RealmRacersPlayerMeta.rrWins`), the only Realm
  Racers field that persists (`CharacterState.rrWins`, written once non-zero). It feeds the
  win-threshold deeds and nothing else reads it. There is no loss counter: a heat has a full
  finishing order, not a win/lose pair.
- **No XP, no money, no items, no reputation.** The rally modules make none of these grants.
- **Never earns**: a house pilot (no `rrWins`, no deed, even as the winner), any practice
  heat, any void heat. A pilot who quits, or who is still out when the classification closes,
  keeps nothing from the race end (the finish deed needs the line), though a fast lap already
  posted was granted at its lap. A win against house pilots alone, or against humans who never
  completed a lap, banks nothing.

## Track limits

**Off-track bands.** `realmRacersOffTrackBand` classifies a machine by how far it is past the
local road edge: inside `REALM_RACERS_VERGE_MARGIN` is road, then the verge out to
`REALM_RACERS_RUNOFF_WIDTH` (`REALM_RACERS_VERGE_BAND`), then garden all the way to the
perimeter wall (`REALM_RACERS_GARDEN_BAND`). A band is a slow aura
(`REALM_RACERS_OFF_TRACK_AURA`) plus grip and drag multipliers on the drive surface. Only the
perimeter wall and authored fences stop a machine; water is decoration.

**The referee** is `src/sim/realm_racers_track_limits.ts`, a pure leaf; `refereeTrackLimits` in
`src/sim/social/realm_racers.ts` applies its verdicts. On track means road plus verge
(`realmRacersOnTrack`), so clipping an apex is not an excursion. For an excursion,
`stepRealmRacersTrackLimits` keeps the exit arc position, the ticks off and the ground driven,
and judges the unearned gain: the forward arc from the exit to now, minus
`REALM_RACERS_OFF_ROAD_EXCHANGE_RATE` times the ground driven. It never reads which side the
machine left on.

- **Cut**: unearned gain above `REALM_RACERS_CUT_TOLERANCE_YD`. The machine is put back at its
  exit point, stopped, with its lap bookkeeping restored to what it was at the exit, locked for
  `REALM_RACERS_CUT_LOCK_TICKS`, and the HUD shows a banner for `REALM_RACERS_CUT_NOTICE_TICKS`.
  The cut is undone; no time penalty is added on top.
- **Loiter**: off the surface for `REALM_RACERS_LOITER_TICKS`, moving or not. The machine goes
  to the last recovery anchor; the HUD counts down the final `REALM_RACERS_LOITER_WARN_TICKS`
  (`rallyLoiterCountdownTicks`).

The referee runs before lap progress in the tick, so a cut tick credits no arc and no gate. It
skips pilots who finished or quit and machines under a reset lock. Rules pinned by
`tests/realm_racers_track_limits.test.ts`; the sweep of candidate cuts over every shipped
circuit is `scripts/realm_racers_limits_probe.ts`.

## Pickups and weapons model

**The kit.** While seated, the class kit is replaced by `resolveRealmRacersKit`
(`src/sim/content/realm_racers.ts`): the machine's signature weapon (`weaponAbilityId` on the
vehicle profile, `REALM_RACERS_ABILITY_ID` today) with a per-race budget
(`REALM_RACERS_WEAPON_CHARGES`) that only a pickup refills, plus any held pickup effect as a
one-charge ability. Bar positions are pinned by `REALM_RACERS_BAR_SLOTS`. Every rally ability
goes down the ordinary cast path; a cast outside the `racing` phase, or by a pilot who has
finished or quit, spends no charge.

**Ground Blast** (`src/sim/realm_racers_ground_blast.ts`): a position-targeted shot. The aim is
clamped authoritatively to a forward cone and a range band (`resolveGroundBlastAim`); the
impact point and tick are fixed at fire time, and the shell lands after a distance-based flight
(`groundBlastFlightSeconds`). On landing, every pilot still driving inside `GROUND_BLAST_RADIUS`,
the shooter excepted, is hit with a falloff that is full inside `GROUND_BLAST_CORE_RADIUS`: an
upward pop, a shove away from the blast and a spin (`resolveGroundBlastImpact`), a grip shock
(`GROUND_BLAST_SHOCK_GRIP` for `GROUND_BLAST_SHOCK_TICKS`) and a slow aura
(`GROUND_BLAST_CONTROL_SPEED_MULT` for `GROUND_BLAST_CONTROL_SECONDS`). A ward absorbs the hit
before anything is applied.

**Boxes** (`src/sim/realm_racers_pickups.ts`). A circuit authors `pickupRows` as lap fractions;
each row resolves into `REALM_RACERS_PICKUP_LANES` boxes across the road, spread over
`REALM_RACERS_PICKUP_SPREAD` of its width. A box is taken by an eligible machine whose path this
tick passes within `REALM_RACERS_PICKUP_REACH` of it (the nearest box, lowest index on a tie;
grid order between machines). The taker then cannot take another for
`REALM_RACERS_PICKUP_COOLDOWN_TICKS`. Every taken box comes back when the leader (the most
travelled pilot still driving) starts a new lap. Pilots who finished or quit, and machines
under a reset lock, cannot take.

**The draw** (`src/sim/realm_racers_pickup_effects.ts`): one `ctx.rng` value per take, from the
table for the taker's rank among pilots still driving (`rallyPickupBand`: leader, midfield,
backmarker; `REALM_RACERS_PICKUP_TABLES`). A field of one is its own leader. A stacking rule
runs after the draw: a held effect drawn while one is already held, or a ward drawn while
warded, becomes a refill. The effects:

- `charge`: adds `REALM_RACERS_PICKUP_CHARGE_GRANT` to the weapon budget, uncapped.
- `ward`: grants the ward (below).
- `nitro`, held: when cast, raises the top-speed cap to `REALM_RACERS_NITRO_SPEED_MULT` for
  `REALM_RACERS_NITRO_TICKS` and adds `REALM_RACERS_NITRO_KICK` of forward speed at once.
- `slick`, held: when cast, drops an oil patch under the machine
  (`src/sim/realm_racers_slicks.ts`). A patch lasts `REALM_RACERS_SLICK_LIFETIME_TICKS`, at most
  `REALM_RACERS_SLICK_CAP` stand per race (oldest evicted), and it spares its owner until they
  have driven out of it once. A machine that drives in resolves one contact per crossing: grip
  falls to `REALM_RACERS_SLICK_GRIP` for `REALM_RACERS_SLICK_GRIP_TICKS`, a lateral shove scaled
  by speed (`realmRacersSlickThrow`) lands, and the slide ceiling rises to
  `REALM_RACERS_SLICK_SLIP_CAP`. A ward absorbs it.

Every pilot sees every patch and every taken box. The race end sweeps shells in flight, oil,
held effects, wards and nitro. The rally's own modules draw rng at exactly two sites: the
competition circuit at seat time and one value per pickup take.

## Ward and ghost

**Ward** (`REALM_RACERS_WARD_AURA`, aura kind `rally_ward`). A real aura on the machine for
`REALM_RACERS_WARD_AURA_SECONDS`, physical school so no dispel strips it, with no stat effect.
It absorbs, and is spent by, the next Ground Blast hit or oil contact. It has no effect on
machine-to-machine contact, and a recovery leaves it in place. It is removed when the pilot
crosses the finish line, quits, or the race ends. The readout's `warded` and `wardIn` are
derived from the aura. A dev kit grant never includes one.

**Ghost** (`src/sim/realm_racers_ghost.ts`, `REALM_RACERS_GHOST_AURA`). Every recovery (manual,
stuck, loiter, cut return, all through `resetRacerTo`) makes the machine a ghost: the contact
pass skips any pair that holds a ghost. Ground Blast and oil keep their own rules. The window
(`rallyGhostWindow`) opens at the recovery: the ghost may end once the lock is over and
`REALM_RACERS_GHOST_MIN_TICKS` have passed, and only while the machine is clear of every other
machine over the whole tick (`rallyHullsMeetInTick`); it ends regardless
`REALM_RACERS_GHOST_MARGIN_TICKS` later. If that cap ends it inside a rival, the pair is
parting: they collide, but those contacts do not count against the clean-race deed until they
separate or `rallyPartingEndTick` passes. A second recovery replaces the window rather than
extending it. The ghost begins and ends silently (no aura event). Pinned by
`tests/realm_racers_ghost.test.ts`.

## Circuits

Circuits are authored records in `src/sim/content/realm_racers_circuits.ts`
(`REALM_RACERS_CIRCUITS`); the geometry that follows from a record (centerline, widths, gates,
start slots, colliders) is derived in `src/sim/realm_racers_spline.ts` and its siblings. A
record's `roles` puts it in practice (exactly one record) or in the competition pool
(`realmRacersCompetitionCircuits`).

**One theme per world-map zone.** `REALM_RACERS_THEME_IDS` holds one id per world-map zone in
the zone table's order; a circuit names one in `theme`, which `src/render/realm_racers_themes.ts`
resolves (`CIRCUIT_THEMES`), and `tests/realm_racers_themes.test.ts` pins the two lists against
each other and against the zone table. Circuits are authored for some zones today; adding a
zone's circuit is a new record naming its theme. A theme is visuals only: the off-track bands,
the referee and every handling number stay on the record and the shared constants. A circuit
also names its music (`musicTrack`, pinned by `tests/instance_music.test.ts`) and resolves to a
zone for map and presence surfaces (`src/sim/realm_racers_zone.ts`).

**Lanes.** Every circuit copy stacks along z in the band, one lane each
(`REALM_RACERS_LANES`): a competition circuit gets a public lane, and the practice circuit gets
`practiceCopies` private lanes. Lanes sit `REALM_RACERS_LANE_DZ` apart with
`REALM_RACERS_LANE_CLEARANCE` of clear air past the interest radius, so one copy never sees
another. A race carries its lane origin and reads all geometry in the circuit's canonical frame
(`realmRacersToCanonical`).

**The authored hour.** An optional `timeOfDay` from `REALM_RACERS_TIME_OF_DAY_IDS`, resolved
render-side by `src/render/realm_racers_daylight_core.ts` (pinned by
`tests/realm_racers_daylight.test.ts`); absent means the world clock. Visuals only: the sim
never reads it.

**The lazy build.** Nothing of a circuit is built at boot. At the commitment trigger
(`realmRacersPrepareReason`: queued, seated in practice, seated in a rated heat, standing in
the band, or a shot seen before any of these), the `rallyCommon` client links one representative of each procedural program the
circuits use (`src/render/realm_racers_common_pieces.ts`). Once the circuit is known (the
viewer's own match from its lobby on, or the lane underfoot), the `rallyCircuit:<id>` client
(`src/render/realm_racers_circuit_prepare.ts`) builds it: in pieces on the GPU work queue with
a task turn between them while the lobby curtain covers the world, and all at once elsewhere
(`buildNow`). The build's start also starts the fetch of what that circuit wears (its theme's
start arch, grid banner and shore reed, and the barrier kits its record authors,
`realmRacersCircuitKitUrls`); nothing of a kit is fetched at boot
(`tests/realm_racers_boot_cost.test.ts`). It then waits for the fill models, gates the view,
prepares the theme sky and waits for the upload frame. The seam (`src/render/realm_racers_prepare.ts`, triggers in
`src/render/realm_racers_prepare_core.ts`) records each verdict as a `prepare` gpu-prep event;
the lobby's progress bar is its unit tally, and the ready send waits for every verdict. A
circuit is asked once per renderer, but a new lobby (a new match id) on a circuit whose last
verdict lapsed (unproven, or its cover ended before its upload frame drew) runs that client
again under the new cover, keeping the build (`rerunDue`). Pinned
by `tests/realm_racers_lazy_build.test.ts`, `tests/realm_racers_circuit_prepare.test.ts` and
`tests/realm_racers_prepare.test.ts`.

**The circuit editor** (`src/editor/circuit/`, page `circuit_editor.html` at the repo root).
A dev tool, served by the dev server only and absent from every production build. It draws a
circuit against the live readout (`src/sim/realm_racers_circuit_metrics.ts`, also run over
every shipped circuit by `tests/realm_racers_circuits.test.ts`) and exports a record to paste;
drafts save to the gitignored `tmp/circuit-drafts/`, never to the content module. An offline
dev client races a draft with `/dev rallydraft <id> [tier]` (`src/game/realm_racers_draft_dev.ts`,
`src/sim/realm_racers_drafts.ts`, refused without `ctx.devCommands`). Details:
`src/editor/circuit/CLAUDE.md`.

## Online model

Online, the server runs the one shared `Sim` and decides every outcome. A seated pilot's
client sends input flags (throttle, steering, handbrake), and the server refuses streamed
facing from a driver (`acceptsStreamedFacing`, `server/movement_input_timeline_v2.ts`). On
movement wire v2, a client that advertises the `driveReconWire` capability predicts its own
machine by stepping the shared kernel over its own input frames (`src/render/self_prediction.ts`,
`self_prediction_core.ts`), seeded and reconciled from `rdv`, the full-precision drive state at
the acknowledged tick (encoder `server/drive_recon_wire.ts`, decoder
`src/net/drive_recon_wire.ts`); a malformed `rdv` stands the prediction down, and
`?drivepredict=0` is the playtest opt-out. The server's override epoch
(`server/movement_override_epoch.ts`) restarts prediction at seat and unseat, stands it down
while the pilot is locked (`realmRacersMovementLockedAt`: any phase but `racing`, a retired
pilot, a recovery lock), and sizes a driver's legal step by the machine
(`vehicleStepCeilingYd`). Rivals are projected through the vehicle kernel from their wire `drv`
into the local kart's time frame (`remoteRacerHorizon`,
`src/render/remote_vehicle_display_core.ts`). Contact, Ground Blast hits, nitro and pickups are
server outcomes that reach the client through the reconcile replay; none is predicted. Oil is:
the slide is a pure function of the mirrored patches, the race clock and the pilot's `og`/`oc`/`ou`
standing on `rdv`, so the prediction runs the race's own crossing code on it
(`src/render/self_slick_prediction_core.ts`).
Contact is the same-tick swept test on every host with no forward window
(`resolveVehicleContactSwept` from `tickContacts`), measured and decided in
`docs/prd/realm-racers-contact-lag-compensation.md`. Every seated pilot of a match is pinned in
the snapshot interest set (`server/realm_racers_interest.ts`), and the race readout rides the
self record as `rr`, `rrt` and `rrkit` (`server/realm_racers_self_wire.ts`). Proofs:
`tests/realm_racers_prediction_proof.test.ts`, `tests/realm_racers_v2_prediction.test.ts`,
`tests/realm_racers_drive_recon_online.test.ts`, `tests/realm_racers_rival_frames.test.ts`.

## Balance basis

No classic-era formula applies to driving a machine round a circuit, so none is used. The
numbers are feel values set in the seat and checked by measurement (house-pilot races, the cut
probe, the two-client rival harness in `tests/helpers/rival_frames.ts`). Every one lives in a
named module, never inline in the match body:

| Module | What it tunes |
|---|---|
| `src/sim/content/vehicles.ts` | `VEHICLE_PROFILES`: every handling number (speed, acceleration, steering, grip, slip, spin decay, body radius, mass, signature weapon) |
| `src/sim/vehicle_contact.ts` | `MAX_BUMP_IMPULSE`, `BUMP_NOSE_BONUS`, `BUMP_SPIN`, `BUMP_SPIN_ATTACKER`, `BUMP_SPIN_VICTIM` |
| `src/sim/vehicle_motion.ts` | `MAX_VEHICLE_SPIN` and the driving model the profile feeds |
| `src/sim/social/realm_racers.ts` | `REALM_RACERS_VERGE_BAND`, `REALM_RACERS_GARDEN_BAND`, `REALM_RACERS_COUNTDOWN_TICKS`, `REALM_RACERS_CHASE_TICKS`, `REALM_RACERS_RETURN_TICKS`, `REALM_RACERS_RESET_LOCK_TICKS`, `REALM_RACERS_AUTO_RECOVERY_LOCK_TICKS`, `REALM_RACERS_STUCK_TICKS`, `REALM_RACERS_STUCK_SPEED`, `REALM_RACERS_WARD_AURA_SECONDS`, `REALM_RACERS_DEAD_HEAT_YARDS`, `REALM_RACERS_BUMP_EVENT_MIN_IMPACT` |
| `src/sim/social/realm_racers_loading.ts` | `REALM_RACERS_LOADING_MAX_TICKS` |
| `src/sim/social/realm_racers_bots.ts` | `REALM_RACERS_BACKFILL_TICKS`, `REALM_RACERS_BACKFILL_TIER` |
| `src/sim/realm_racers_driver.ts` | `rallyDriverProfile`: the house-pilot tiers |
| `src/sim/realm_racers_layout.ts` | `REALM_RACERS_GRID_SIZE`, `REALM_RACERS_VERGE_MARGIN`, `REALM_RACERS_RUNOFF_WIDTH`, `REALM_RACERS_GATE_SPACING`, `REALM_RACERS_MIN_HALF_WIDTH` |
| `src/sim/realm_racers_track_limits.ts` | `REALM_RACERS_OFF_ROAD_EXCHANGE_RATE`, `REALM_RACERS_CUT_TOLERANCE_YD`, `REALM_RACERS_LOITER_TICKS`, `REALM_RACERS_LOITER_WARN_TICKS`, `REALM_RACERS_CUT_LOCK_TICKS` |
| `src/sim/realm_racers_ground_blast.ts` | the `GROUND_BLAST_*` constants (range, cone, flight, radius, pop, push, spin, shock, slow) |
| `src/sim/content/realm_racers.ts` | `REALM_RACERS_WEAPON_CHARGES` and the weapon cooldown on `REALM_RACERS_ABILITIES` |
| `src/sim/realm_racers_pickups.ts` | `REALM_RACERS_PICKUP_LANES`, `REALM_RACERS_PICKUP_SPREAD`, `REALM_RACERS_PICKUP_REACH`, `REALM_RACERS_PICKUP_COOLDOWN_TICKS`, `REALM_RACERS_PICKUP_CHARGE_GRANT` |
| `src/sim/realm_racers_pickup_effects.ts` | `REALM_RACERS_PICKUP_TABLES`, `REALM_RACERS_NITRO_TICKS`, `REALM_RACERS_NITRO_SPEED_MULT`, `REALM_RACERS_NITRO_KICK` |
| `src/sim/realm_racers_slicks.ts` | the `REALM_RACERS_SLICK_*` constants (radius, lifetime, grip, push, slip cap, cap) |
| `src/sim/realm_racers_ghost.ts` | `REALM_RACERS_GHOST_MIN_TICKS`, `REALM_RACERS_GHOST_MARGIN_TICKS` |
| `src/sim/content/realm_racers_circuits.ts` | per circuit: `laps`, `practiceLaps`, `timeLimitSeconds`, `widthBands`, `pickupRows` |
| `src/sim/deeds.ts` | `RALLY_FAST_LAP_DEEDS`: each fast-lap threshold, scaled from measured house-pilot laps |

## Where it lives

| Layer | Path |
|---|---|
| Sim: match, bots, lobby, eligibility | `src/sim/social/realm_racers.ts`, `realm_racers_bots.ts`, `realm_racers_loading.ts`, `realm_racers_busy.ts`, `realm_racers_context.ts` |
| Sim: pure leaves | `src/sim/realm_racers_*.ts` (layout, spline, progress, standings, track limits, pickups, pickup effects, slicks, ground blast, ghost, driver, circuit metrics, drafts, zone) |
| Sim: content | `src/sim/content/realm_racers.ts` (kit, house-pilot roster), `realm_racers_circuits.ts`, `realm_racers_props.ts`, `realm_racers_barriers.ts`, `vehicles.ts` |
| Sim: deeds | `onRallyRaceEndForDeeds`, `onRallyLapForDeeds` in `src/sim/deeds.ts`; the `pvp_rr_*` records in `src/sim/content/deeds.ts` |
| IWorld facet | `src/world_api/realm_racers.ts` |
| Server | `server/realm_racers_commands.ts`, `realm_racers_self_wire.ts`, `realm_racers_interest.ts`, `realm_racers_drive_wire.ts`, `drive_recon_wire.ts`, `movement_override_epoch.ts`, `disconnected_player_input.ts` |
| Net (online mirror) | `src/net/realm_racers_wire_state.ts`, `realm_racers_self_wire.ts`, `realm_racers_drive_wire.ts`, `drive_recon_wire.ts` |
| Render | `src/render/realm_racers_scene.ts` (the renderer's entry), `realm_racers_track.ts`, `realm_racers_themes.ts`, `realm_racers_prepare.ts`, `realm_racers_prepare_core.ts`, `realm_racers_circuit_prepare.ts`, and the other `src/render/realm_racers_*.ts` |
| Game | `src/game/realm_racers_start_camera.ts`, `realm_racers_sfx.ts`, `realm_racers_draft_dev.ts`, `realm_racers_client_wiring.ts` |
| UI | `src/ui/realm_racers.ts` (the composer), `realm_racers_window.ts` (the window), `realm_racers_strip_painter.ts` (the race strip), the standings and podium painters, their `realm_racers_*_view.ts` cores, `src/ui/hud/realm_racers/` (lobby curtain, event router) |
| Editor | `src/editor/circuit/` |
| Tests | `tests/realm_racers_*.test.ts` (start with `realm_racers_match`, `realm_racers_loading_lobby`, `realm_racers_bots`, `realm_racers_track_limits`), `tests/editor_circuit_*.test.ts`, `tests/deeds_sites_pin.test.ts`, the `realm_racers` parity scenario (`tests/parity/scenarios.ts`, golden `tests/parity/golden/realm_racers.json`) |
