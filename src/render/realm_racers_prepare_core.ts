// When the race-only GPU producers prepare, and whether a preparation proved
// itself. The painter is realm_racers_prepare.ts; this half is Three-free so a
// plain Vitest drives every trigger.
//
// A race-only program is worth nothing to a player who never races, so nothing
// here runs at boot: the trigger is the moment the player COMMITS to racing
// (joining the queue, or a practice race seating them), early enough for the
// queue wait or the practice teleport to hide the work. A player who logs in or
// reconnects already seated, or already standing in the rally band (a returned
// quitter at the fence sees every shot too), prepares on the first frame that
// says so. The last resort is a client that already had to build itself for a
// draw (a shot seen before any of the above): the seam still links the rest.
// The latch fires once for the life of one renderer: a graphics rebuild mints
// a new renderer, whose programs are all new, so it starts over.

/** Why the preparation started, in the order the checks run: the reason is
 *  telemetry only, every reason prepares the same set. */
export type RealmRacersPrepareReason = 'queue' | 'practice' | 'seated' | 'band' | 'shot';

/** The slice of the viewer's Realm Racers state the trigger reads. */
export interface RealmRacersCommitment {
  queued: boolean;
  match: { practice: boolean } | null;
  /** The viewer stands inside the rally band (sim `isAtRealmRacersXZ`). */
  inBand: boolean;
  /** A client already built itself for a draw that came first. */
  shot: boolean;
}

/** Whether this viewer has committed to racing right now, and why. */
export function realmRacersPrepareReason(
  commitment: RealmRacersCommitment,
): RealmRacersPrepareReason | null {
  if (commitment.queued) return 'queue';
  if (commitment.match) return commitment.match.practice ? 'practice' : 'seated';
  if (commitment.inBand) return 'band';
  if (commitment.shot) return 'shot';
  return null;
}

/** Whether an in-flight preparation may hold the arrival curtain: only while
 *  the viewer is on the circuit (seated, or standing in the band). A queue
 *  join in a town is not an arrival anywhere near the race. */
export function realmRacersPrepareHolds(commitment: RealmRacersCommitment): boolean {
  return commitment.match !== null || commitment.inBand;
}

export interface RealmRacersPrepareLatch {
  reason: RealmRacersPrepareReason | null;
}

export function createRealmRacersPrepareLatch(): RealmRacersPrepareLatch {
  return { reason: null };
}

/** The reason to start preparing on THIS frame, or null: non-null exactly once
 *  per latch, on the first frame the viewer is committed. */
export function takeRealmRacersPrepare(
  latch: RealmRacersPrepareLatch,
  commitment: RealmRacersCommitment,
): RealmRacersPrepareReason | null {
  if (latch.reason !== null) return null;
  const reason = realmRacersPrepareReason(commitment);
  if (reason !== null) latch.reason = reason;
  return reason;
}
