// IWorldRealmRacers: the four-pilot vehicle-racing minigame. The model is
// host-agnostic and snapshot-friendly so offline Sim and online ClientWorld
// expose the same surface.

import type { RallyDriverTier } from '../sim/realm_racers_driver';
import type { PlayerClass } from '../sim/types';

export type RealmRacersPhase = 'loading' | 'countdown' | 'racing' | 'finished';
/** `void`: the race was decided before GO (the field emptied in the lobby or
 *  the countdown), so nobody won it and it counts for nothing. */
export type RealmRacersResult = 'won' | 'lost' | 'draw' | 'forfeit' | 'void' | null;

export type { RallyDriverTier };

export interface RealmRacersRacerInfo {
  pid: number;
  name: string;
  /**
   * Who is in the seat, cosmetically: the class has no effect on the machine.
   * Drives the PODIUM's party-frame class crest. The live standings rows
   * deliberately draw no portrait, because on that panel the crest cost the
   * pilot's name the width it needed.
   */
  cls: PlayerClass;
  lap: number;
  finished: boolean;
  /** The tier this racer drives at when it is a house pilot; null for a human. */
  botTier: RallyDriverTier | null;
  /** 1-based live placing, 1 is the leader. */
  position: number;
  /**
   * Seconds from the flag to this racer crossing the line, or null while they
   * have not. Sub-tick precise: the crossing fraction inside the tick that
   * detected it is folded in, so two machines that finish on the same tick get
   * two different times rather than a coin flip.
   */
  finishSeconds: number | null;
  /** True once this racer has quit (forfeit or disconnect) rather than finished. */
  retired: boolean;
}

/**
 * One oil slick on the circuit: where it is, and who it is across snapshots.
 *
 * The id is what lets presentation animate a patch appearing and expiring
 * without an animation jumping from a patch that has gone to the one that took
 * its place in the list.
 */
export interface RealmRacersSlickInfo {
  id: number;
  x: number;
  z: number;
  /** The race tick (ticks since GO) the patch is gone on. Fixed for its whole
   *  life, so it costs the delta-gated readout nothing per tick; the online
   *  own-kart prediction reads it to stop a replayed tick crossing dried oil. */
  endsAt: number;
  /** The pilot who dropped it, present only while that pilot is still immune
   *  (they have not driven out of it yet). */
  immunePid?: number;
}

/**
 * What a LANE shows to anyone looking at it: the viewer-independent slice of a
 * race the renderer needs to draw the circuit honestly (the start lights, the
 * boxes already taken, the oil on the road). `RealmRacersMatchInfo` carries all
 * of it, so a seated pilot's own readout satisfies this structurally; the
 * trackside readout below carries ONLY it. A hazard is actionable information,
 * so a bystander at the fence sees the same oil a pilot does.
 */
export interface RealmRacersLaneView {
  circuitId: string;
  phase: RealmRacersPhase;
  countdownTicks: number;
  elapsed: number;
  pickupsTaken: readonly number[];
  slicks: readonly RealmRacersSlickInfo[];
}

/**
 * The loading lobby a race opens in: every pilot is seated and held while each
 * client prepares the circuit. The countdown starts for the whole field on the
 * same tick, when every pilot still in the race is ready or `secondsLeft` runs out.
 */
export interface RealmRacersLoadingInfo {
  /** Whole seconds (rounded up) until the lobby closes regardless of who is
   *  ready. Seconds rather than ticks keep the per-tick readout unchanged
   *  between whole seconds, so the lobby re-sends it about once a second. */
  secondsLeft: number;
  /**
   * The pilots already ready, in grid order (a subset of `participantIds`).
   * House pilots are ready from the seat; a human once their client sends
   * `readyRealmRacers()`, and again after a reconnect.
   */
  readyIds: number[];
}

export interface RealmRacersMatchInfo {
  id: number;
  /**
   * Which circuit this race is on, as a `REALM_RACERS_CIRCUITS` id. Presentation
   * reads it to name the circuit and to anchor anything built on its geometry;
   * it is the id rather than the record because this seam stays data-only.
   */
  circuitId: string;
  /**
   * Every seated pilot in frozen grid order, including the local player. Grid
   * IDENTITY, which is what the renderer's match-visibility pins read; live
   * order is `standings` below and reorders around it every tick.
   */
  participantIds: number[];
  phase: RealmRacersPhase;
  countdown: number;
  /** Authoritative sub-second remainder used by the physical start lights. */
  countdownTicks: number;
  /** Seconds since the flag, floored to whole seconds for the readout. */
  elapsed: number;
  /**
   * Ticks since the flag: the sub-second twin of `elapsed`, 0 during the
   * countdown. `elapsed` is floored for the readout, so anything that has to
   * MOVE with the race (the start camera's handoff back to the chase pose)
   * reads this instead, the same way the start lights read `countdownTicks`.
   */
  elapsedTicks: number;
  /**
   * Seconds left to get home before the winner's chase window shuts, or 0 while
   * nobody has finished. A pilot still driving is told, so the flag falling on
   * them is a clock they watched rather than a race that stopped without notice.
   */
  chaseIn: number;
  returnIn: number;
  me: RealmRacersRacerInfo;
  /** Every racer including `me`, sorted by live position. */
  standings: RealmRacersRacerInfo[];
  /** Frozen grid size, so the readout reads "3/4" before anyone has moved. */
  gridSize: number;
  /**
   * Whether the RACE is over, as opposed to `phase`, which is this viewer's own
   * (a pilot who quit reads `finished` while three rivals are still driving).
   * It is what says the classification in `standings` is final, so it is the one
   * thing the podium may key on.
   */
  decided: boolean;
  /** The race was decided before GO, so it is void for every pilot of the
   *  heat, a pilot who quit included: no podium, no winner, no credit. Present
   *  only when true, so an ordinary race's per-tick readout pays nothing. */
  voided?: true;
  /** Absolute forward speed, yd/s, for the compact rally readout. */
  speed: number;
  wrongWay: boolean;
  /**
   * Seconds this pilot has left off the racing surface before the track-limits
   * referee returns them to the last recovery anchor, or 0 while the warning
   * has not armed. A clock the pilot watches, never a teleport that happens to
   * them.
   */
  offTrackIn: number;
  /** True for a few seconds after the referee returned this pilot to the point
   *  they left the road, because their excursion gained arc on the field. */
  cutReturned: boolean;
  resetLocked: boolean;
  /** How many laps this race runs (practice may differ from a queued race). */
  totalLaps: number;
  /**
   * The pickup boxes this race has already given away, as indices into the
   * circuit's own box list (`realmRacersPickupBoxes`, resolved from the circuit
   * id above). Empty while every box is standing.
   *
   * The TAKEN set rather than the present one, because it is the shorter list at
   * every moment of a race and because presentation needs both transitions: a
   * box entering it pops, a box leaving it grows back.
   */
  pickupsTaken: number[];
  /**
   * The oil slicks standing on this race's circuit right now, in the SAME frame
   * the pickup boxes resolve in (the circuit's own; the renderer's track group
   * is already built in it). Empty on a clean circuit, which is most of a race.
   *
   * Everyone in the race sees every patch, including the one they dropped: a
   * hazard is actionable information, so no viewer and no graphics tier may be
   * shown fewer of them than another.
   */
  slicks: RealmRacersSlickInfo[];
  /**
   * Whether the VIEWER is carrying a ward right now: the one-shot buff that eats
   * the next Ground Blast or patch of oil. Self-only, like `offTrackIn` and
   * `cutReturned` beside it, because a rival's shield is not this pilot's
   * business; the race strip shows it as a pip so a shield is something the
   * player can plan around rather than a toast they may have missed.
   */
  warded: boolean;
  /** Whole seconds the viewer's ward has left, rounded up; present only while
   *  `warded`, so a race without one pays nothing per tick. */
  wardIn?: number;
  /** True for a private practice race on its own copy of the circuit. */
  practice: boolean;
  result: RealmRacersResult;
  /** Present only while this viewer's `phase` is `loading`; absent keeps the
   *  per-tick readout the same size for the rest of the race. */
  loading?: RealmRacersLoadingInfo;
}

export interface RealmRacersInfo {
  queued: boolean;
  queuePosition: number;
  queueSize: number;
  match: RealmRacersMatchInfo | null;
  /**
   * Whether a practice race can start right now. Practice runs on its own copy
   * of the circuit, so another player's race never blocks it; this goes false
   * only when the viewer is already racing or the realm has handed out every
   * copy it has.
   */
  practiceAvailable: boolean;
  /**
   * Whether joining the queue can ever seat a race here: house pilots may
   * backfill the grid, or enough humans are connected to fill it. False in the
   * offline world, where the queue would hold a player forever and Practice is
   * the way onto the circuit; the window disables the join affordance on it.
   */
  queueViable: boolean;
}

export interface IWorldRealmRacers {
  realmRacersInfo: RealmRacersInfo;
  /**
   * The race on the lane the viewer is STANDING on while not seated in it, or
   * null anywhere else. It is what lets a bystander at the fence (a returned
   * quitter watching the end, a spectating moderator) see the start lights run,
   * the boxes pop and the oil land, instead of a circuit that lies clean while
   * machines slide on nothing.
   */
  realmRacersTrackside: RealmRacersLaneView | null;
  joinRealmRacersQueue(): void;
  leaveRealmRacersQueue(): void;
  forfeitRealmRacers(): void;
  /** Recover to the last crossed spline recovery anchor during a live race. */
  resetRealmRacersPosition(): void;
  /** Race a full grid of house pilots at `tier` immediately, with no queue and
   *  no wait. Refuses silently (like the queue join) when no practice copy of
   *  the circuit is free or the player is not in a state to race; a player in
   *  combat is refused with the in-combat error, again like the queue join. */
  startRealmRacersPractice(tier: RallyDriverTier): void;
  /** Tell the loading lobby this client has prepared the circuit. Ignored
   *  outside the lobby and for anyone not seated in it. */
  readyRealmRacers(): void;
}
