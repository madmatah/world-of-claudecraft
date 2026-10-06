// The loading-lobby ready trigger. While this viewer's race is loading, the
// lobby does not list them ready, and this client's race preparation has a
// verdict for every producer (src/render/mortar_overdrive/prepare.ts, `settled`),
// the client says it is ready. The proof is the preparation finishing, never a
// clock: a machine still linking stays unready and the server's cap starts the
// race without it. It reads state, never a per-match latch, so a pilot whose
// flag the server cleared (a linkdead drop, then a resume) sends again on
// their own.

import type { MortarOverdriveInfo } from '../../../world_api/mortar_overdrive';

export interface MortarOverdriveReadySender {
  lastKey: string | null;
}

/** The slice of the preparation readout the trigger reads. */
export interface MortarOverdriveReadyProof {
  settled: boolean;
}

export function createMortarOverdriveReadySender(): MortarOverdriveReadySender {
  return { lastKey: null };
}

/**
 * The key a ready send is due under, or null when none is due. The key moves
 * with the match and the server's whole seconds left, so one send per key
 * retries an unanswered ready about once a second and never once a frame.
 */
export function mortarOverdriveReadyDueKey(
  info: MortarOverdriveInfo,
  proof: MortarOverdriveReadyProof,
): string | null {
  const match = info.match;
  if (!match || match.phase !== 'loading' || !match.loading) return null;
  if (!proof.settled) return null;
  if (match.loading.readyIds.includes(match.me.pid)) return null;
  return `${match.id}|${match.loading.secondsLeft}`;
}

/** Send once per newly due key. Returns whether this step sent. */
export function stepMortarOverdriveReady(
  sender: MortarOverdriveReadySender,
  info: MortarOverdriveInfo,
  proof: MortarOverdriveReadyProof,
  send: () => void,
): boolean {
  const key = mortarOverdriveReadyDueKey(info, proof);
  const due = key !== null && key !== sender.lastKey;
  sender.lastKey = key;
  if (due) send();
  return due;
}
