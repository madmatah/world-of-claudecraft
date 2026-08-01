import { characterViewOutsideHysteresis } from './character_view_core';

/**
 * Whether `entityId` is another pilot in the local player's current race.
 * Match membership, not distance or graphics quality, is the visibility rule.
 */
export function isRealmRacersCoPilot(
  participantIds: readonly number[],
  localPlayerId: number,
  entityId: number,
): boolean {
  return entityId !== localPlayerId && participantIds.includes(entityId);
}

/** Normal destruction range with the match-membership fairness exception applied. */
export function isOutsideRealmRacersRetainRange(
  participantIds: readonly number[],
  localPlayerId: number,
  entityId: number,
  distanceSq: number,
  destroyRangeSq: number,
): boolean {
  return (
    !isRealmRacersCoPilot(participantIds, localPlayerId, entityId) && distanceSq > destroyRangeSq
  );
}

/** Normal draw hysteresis with the same match-membership exception applied. */
export function isOutsideRealmRacersDrawRange(
  participantIds: readonly number[],
  localPlayerId: number,
  entityId: number,
  wasVisible: boolean,
  distanceSq: number,
  createRangeSq: number,
  destroyRangeSq: number,
): boolean {
  return (
    !isRealmRacersCoPilot(participantIds, localPlayerId, entityId) &&
    characterViewOutsideHysteresis(wasVisible, distanceSq, createRangeSq, destroyRangeSq)
  );
}
