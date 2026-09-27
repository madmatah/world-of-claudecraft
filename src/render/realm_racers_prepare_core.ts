// When the race-only GPU producers prepare, whether a preparation proved
// itself, and how far it has got (the race lobby's progress bar and ready
// proof). The painter is realm_racers_prepare.ts; this half is Three-free so a
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

export type RealmRacersPrepareState = 'idle' | 'preparing' | 'proven' | 'unproven';

/** A client's own step count, for a client that prepares in several steps. */
export interface RealmRacersPrepareUnits {
  done: number;
  total: number;
}

/**
 * How far the seam has got, as prepared units over total units across every
 * client, and whether every client has its verdict. A client that reports no
 * units counts as one, done at its verdict. `settled` is the loading lobby's
 * ready proof: it needs the seam started, so a seam that never fired is not
 * settled even with no clients. It never reads a clock.
 */
export interface RealmRacersPrepareProgress {
  done: number;
  total: number;
  settled: boolean;
}

export function realmRacersPrepareSettledState(state: RealmRacersPrepareState): boolean {
  return state === 'proven' || state === 'unproven';
}

function wholeUnits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Reset `out` before the clients are added: nothing counted yet, and settled
 *  only if the seam has started. */
export function beginRealmRacersPrepareTally(
  out: RealmRacersPrepareProgress,
  started: boolean,
): RealmRacersPrepareProgress {
  out.done = 0;
  out.total = 0;
  out.settled = started;
  return out;
}

/** Add one client to the tally. Allocation-free. */
export function addRealmRacersPrepareTally(
  out: RealmRacersPrepareProgress,
  state: RealmRacersPrepareState,
  units: RealmRacersPrepareUnits | null,
): void {
  const total = Math.max(1, wholeUnits(units?.total ?? 1));
  out.total += total;
  if (realmRacersPrepareSettledState(state)) {
    out.done += total;
    return;
  }
  out.settled = false;
  out.done += Math.min(total, wholeUnits(units?.done ?? 0));
}

/** The client that links the procedural programs every circuit draws, at the
 *  commitment trigger, before any circuit is drawn. */
export const REALM_RACERS_COMMON_PREPARE_ID = 'rallyCommon';

const CIRCUIT_PREPARE_PREFIX = 'rallyCircuit:';

/** The client of one drawn circuit: its dressing models, its view, its sky. */
export function realmRacersCircuitPrepareId(circuitId: string): string {
  return `${CIRCUIT_PREPARE_PREFIX}${circuitId}`;
}

/** The circuit this viewer needs prepared now: their own match's once it is
 *  known (from the lobby on), else the lane they stand on in the band (a
 *  bystander, or a login at the fence). */
export function realmRacersPrepareCircuit(
  matchCircuitId: string | null,
  laneCircuitId: string | null,
): string | null {
  return matchCircuitId ?? laneCircuitId;
}

/**
 * Whether a circuit's view stays hidden on the viewer's own lane: only while
 * its preparation has no verdict AND something covers the world (an arrival
 * cover, or the viewer's own race still in its loading lobby). Hiding the road
 * in the open would hide what a pilot reacts to, so an uncovered circuit draws
 * cold rather than late.
 */
export function realmRacersRevealHeld(state: RealmRacersPrepareState, covered: boolean): boolean {
  return covered && !realmRacersPrepareSettledState(state);
}

/** A circuit client's steps: each dressing fill, the gate, the first draw of
 *  the linked view (its buffer uploads), the sky. */
export function realmRacersCircuitUnits(
  out: RealmRacersPrepareUnits,
  fillsDone: number,
  fillsTotal: number,
  gated: boolean,
  drawn: boolean,
  skyReady: boolean,
): RealmRacersPrepareUnits {
  const total = Math.max(0, fillsTotal);
  out.total = total + 3;
  out.done =
    Math.min(total, Math.max(0, fillsDone)) +
    (gated ? 1 : 0) +
    (drawn ? 1 : 0) +
    (skyReady ? 1 : 0);
  return out;
}
