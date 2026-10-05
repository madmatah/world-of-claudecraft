import type { SimContext } from '../src/sim/sim_context';
import { realmRacersMatchOf } from '../src/sim/social/realm_racers';

const NO_REALM_RACERS_INTEREST_PINS: readonly number[] = [];

/**
 * Every seated pilot except the entity used as the snapshot anchor. The order
 * stays the match's frozen grid order so the four-pilot rollout can extend the
 * roster without changing the visibility policy.
 */
export function otherRealmRacersParticipantIds(
  participantIds: readonly number[],
  anchorEntityId: number,
): number[] {
  const pins: number[] = [];
  for (const pid of participantIds) {
    if (pid === anchorEntityId || pins.includes(pid)) continue;
    pins.push(pid);
  }
  return pins;
}

/** Match-scoped interest pins for a player or the player observed by a spectator.
 *  The snapshot loop streams a pin past canObserveEntity, which is sound only
 *  because a seated racer can never be stealthed (pinned in the interest test). */
export function realmRacersInterestParticipantIds(
  ctx: SimContext,
  anchorPid: number,
  anchorEntityId: number,
): readonly number[] {
  const match = realmRacersMatchOf(ctx, anchorPid);
  if (!match) return NO_REALM_RACERS_INTEREST_PINS;
  // Only pilots still inside the gameplay parenthesis. A returned quitter is
  // back in the open world while the race runs on: pinning them would stream
  // their live position to ex-rivals at full rate anywhere in the world, past
  // both the distance cutoff and the stealth policy the pin bypasses.
  const seated = match.pids.filter((pid) => match.progress.get(pid)?.returned === false);
  return otherRealmRacersParticipantIds(seated, anchorEntityId);
}
