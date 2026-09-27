// The interim loading-lobby ready trigger. While this viewer's race is loading
// and the lobby does not list them ready, the client says it is ready. It reads
// state, never a per-match latch, so a pilot whose flag the server cleared (a
// linkdead drop, then a resume) sends again on their own. The next lot replaces
// the trigger with the circuit preparation proof; the send stays the same.

import type { RealmRacersInfo } from '../world_api/realm_racers';

export interface RealmRacersReadySender {
  lastKey: string | null;
}

export function createRealmRacersReadySender(): RealmRacersReadySender {
  return { lastKey: null };
}

/**
 * The key a ready send is due under, or null when none is due. The key moves
 * with the match and the whole seconds left, so one send per key retries an
 * unanswered ready about once a second and never once a frame.
 */
export function realmRacersReadyDueKey(info: RealmRacersInfo): string | null {
  const match = info.match;
  if (!match || match.phase !== 'loading' || !match.loading) return null;
  if (match.loading.readyIds.includes(match.me.pid)) return null;
  return `${match.id}|${match.loading.secondsLeft}`;
}

/** Send once per newly due key. Returns whether this step sent. */
export function stepRealmRacersReady(
  sender: RealmRacersReadySender,
  info: RealmRacersInfo,
  send: () => void,
): boolean {
  const key = realmRacersReadyDueKey(info);
  const due = key !== null && key !== sender.lastKey;
  sender.lastKey = key;
  if (due) send();
  return due;
}
