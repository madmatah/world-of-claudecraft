// The loading-lobby ready trigger. While this viewer's race is loading, the
// lobby does not list them ready, and this client's race preparation has a
// verdict for every producer (src/render/realm_racers_prepare.ts, `settled`),
// the client says it is ready. The proof is the preparation finishing, never a
// clock: a machine still linking stays unready and the server's cap starts the
// race without it. It reads state, never a per-match latch, so a pilot whose
// flag the server cleared (a linkdead drop, then a resume) sends again on
// their own.

import type { RealmRacersInfo } from '../world_api/realm_racers';

export interface RealmRacersReadySender {
  lastKey: string | null;
}

/** The slice of the preparation readout the trigger reads. */
export interface RealmRacersReadyProof {
  settled: boolean;
}

export function createRealmRacersReadySender(): RealmRacersReadySender {
  return { lastKey: null };
}

/**
 * The key a ready send is due under, or null when none is due. The key moves
 * with the match and the server's whole seconds left, so one send per key
 * retries an unanswered ready about once a second and never once a frame.
 */
export function realmRacersReadyDueKey(
  info: RealmRacersInfo,
  proof: RealmRacersReadyProof,
): string | null {
  const match = info.match;
  if (!match || match.phase !== 'loading' || !match.loading) return null;
  if (!proof.settled) return null;
  if (match.loading.readyIds.includes(match.me.pid)) return null;
  return `${match.id}|${match.loading.secondsLeft}`;
}

/** Send once per newly due key. Returns whether this step sent. */
export function stepRealmRacersReady(
  sender: RealmRacersReadySender,
  info: RealmRacersInfo,
  proof: RealmRacersReadyProof,
  send: () => void,
): boolean {
  const key = realmRacersReadyDueKey(info, proof);
  const due = key !== null && key !== sender.lastKey;
  sender.lastKey = key;
  if (due) send();
  return due;
}
