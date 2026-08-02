// IWorldRealmRacers: the four-pilot vehicle-racing minigame. The model is
// host-agnostic and snapshot-friendly so offline Sim and online ClientWorld
// expose the same surface.

import type { RallyDriverTier } from '../sim/realm_racers_driver';
import type { PlayerClass } from '../sim/types';

export type RealmRacersPhase = 'countdown' | 'racing' | 'finished';
export type RealmRacersResult = 'won' | 'lost' | 'draw' | 'forfeit' | null;

export type { RallyDriverTier };

export interface RealmRacersRacerInfo {
  pid: number;
  name: string;
  /** Drives the standings row's portrait, the party-frame class crest. */
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

export interface RealmRacersMatchInfo {
  id: number;
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
  elapsed: number;
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
  /** Absolute forward speed, yd/s, for the compact rally readout. */
  speed: number;
  wrongWay: boolean;
  resetLocked: boolean;
  /** How many laps this race runs (practice may differ from a queued race). */
  totalLaps: number;
  /** True for a private practice race on its own copy of the circuit. */
  practice: boolean;
  result: RealmRacersResult;
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
}

export interface IWorldRealmRacers {
  realmRacersInfo: RealmRacersInfo;
  joinRealmRacersQueue(): void;
  leaveRealmRacersQueue(): void;
  forfeitRealmRacers(): void;
  /** Recover to the last crossed spline recovery anchor during a live race. */
  resetRealmRacersPosition(): void;
  /** Race a full grid of house pilots at `tier` immediately, with no queue and
   *  no wait. Refuses silently (like the queue join) when no practice copy of
   *  the circuit is free or the player is not in a state to race. */
  startRealmRacersPractice(tier: RallyDriverTier): void;
}
