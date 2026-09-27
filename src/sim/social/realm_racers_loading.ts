// The Realm Racers loading lobby: the `loading` phase a race opens in, before
// its countdown. Every pilot is already seated and held on the grid; the lobby
// only decides WHEN the countdown starts, which is the same tick for the whole
// field: once every human pilot still in the race has said they are ready
// (their client finished preparing the circuit), or once the cap runs out.
// House pilots are ready from the seat. A pilot whose client is gone counts as
// not ready, so the cap is what a dropped socket costs the others.
//
// The countdown and everything after it derive from `goTick`/`deadlineTick`,
// which is why they are written here, at the transition, rather than at the
// seat: GO is always a full countdown after the lobby closes.
//
// Draws no rng. The match state lives on the match; `realm_racers.ts` owns the
// match lookup and calls in.

import type { RealmRacersLoadingInfo } from '../../world_api/realm_racers';
import type { SimContext } from '../sim_context';
import { TICK_RATE } from '../types';
import type { RealmRacersMatch } from './realm_racers';

export const REALM_RACERS_LOADING_MAX_TICKS = 15 * TICK_RATE;

/** Still on the grid and still the lobby's business: not quit, not sent home. */
function stillSeated(match: RealmRacersMatch, pid: number): boolean {
  const progress = match.progress.get(pid);
  return !!progress && !progress.returned && progress.retiredTick === null;
}

/** Record a pilot's ready. Refused (false) outside the lobby, for anyone not on
 *  this grid, and for a pilot who has already quit. Idempotent. */
export function markRealmRacersReady(match: RealmRacersMatch, pid: number): boolean {
  if (match.phase !== 'loading' || !stillSeated(match, pid)) return false;
  match.ready.add(pid);
  return true;
}

/** A pilot whose client dropped is not ready until it says so again. */
export function clearRealmRacersReady(match: RealmRacersMatch, pid: number): void {
  if (match.phase === 'loading') match.ready.delete(pid);
}

/** Every pilot still on the grid is ready, or the cap has run out. */
export function realmRacersLoadingDone(ctx: SimContext, match: RealmRacersMatch): boolean {
  if (ctx.tickCount >= match.loadingUntilTick) return true;
  for (const pid of match.pids) {
    if (stillSeated(match, pid) && !match.ready.has(pid)) return false;
  }
  return true;
}

/** Close the lobby and start the countdown on this tick. */
export function beginRealmRacersCountdown(
  ctx: SimContext,
  match: RealmRacersMatch,
  countdownTicks: number,
  timeLimitTicks: number,
): void {
  match.phase = 'countdown';
  match.goTick = ctx.tickCount + countdownTicks;
  match.deadlineTick = match.goTick + timeLimitTicks;
  match.ready.clear();
}

/** The viewer-independent lobby readout, or null outside the lobby. */
export function realmRacersLoadingInfo(
  ctx: SimContext,
  match: RealmRacersMatch,
): RealmRacersLoadingInfo | null {
  if (match.phase !== 'loading') return null;
  return {
    secondsLeft: Math.ceil(Math.max(0, match.loadingUntilTick - ctx.tickCount) / TICK_RATE),
    readyIds: match.pids.filter((pid) => match.ready.has(pid)),
  };
}
