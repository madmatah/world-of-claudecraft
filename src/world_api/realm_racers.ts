// IWorldRealmRacers: the two-player vehicle-racing minigame. The model is
// host-agnostic and snapshot-friendly so offline Sim and online ClientWorld
// expose the same surface.

import type { RallyDriverTier } from '../sim/realm_racers_driver';

export type RealmRacersPhase = 'countdown' | 'racing' | 'finished';
export type RealmRacersResult = 'won' | 'lost' | 'draw' | 'forfeit' | null;

export type { RallyDriverTier };

export interface RealmRacersRacerInfo {
  pid: number;
  name: string;
  lap: number;
  finished: boolean;
  /** The tier this racer drives at when it is a house pilot; null for a human. */
  botTier: RallyDriverTier | null;
}

export interface RealmRacersMatchInfo {
  id: number;
  phase: RealmRacersPhase;
  countdown: number;
  /** Authoritative sub-second remainder used by the physical start lights. */
  countdownTicks: number;
  elapsed: number;
  returnIn: number;
  me: RealmRacersRacerInfo;
  opponent: RealmRacersRacerInfo;
  position: 1 | 2;
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
  /** Race a house pilot at `tier` immediately, with no queue and no wait.
   *  Refuses silently (like the queue join) when the circuit is busy or the
   *  player is not in a state to race. */
  startRealmRacersPractice(tier: RallyDriverTier): void;
}
