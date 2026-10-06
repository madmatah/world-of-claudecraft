// When the race-only GPU producers prepare, whether a preparation proved
// itself, and how far it has got (the race lobby's progress bar and ready
// proof). The painter is mortar_overdrive/prepare.ts; this half is Three-free so a
// plain Vitest drives every trigger.
//
// A race-only program is worth nothing to a player who never races, so nothing
// here runs at boot: the trigger is the moment the player COMMITS to racing
// (joining the queue, or a practice race seating them), early enough for the
// queue wait or the practice teleport to hide the work. A player who logs in or
// reconnects already seated, or already standing in the Mortar Overdrive band (a returned
// quitter at the fence sees every shot too), prepares on the first frame that
// says so. The last resort is a client that already had to build itself for a
// draw (a shot seen before any of the above): the seam still links the rest.
// The latch fires once for the life of one renderer: a graphics rebuild mints
// a new renderer, whose programs are all new, so it starts over.
//
// One more trigger is not the seam's: a BLOCKING ARRIVAL that lands in the band
// (a rift exit, a teleport, a mid-race reconnect's jump) awaits a whole-scene
// compile under its loading screen, and landing there is a Mortar Overdrive trigger in
// its own right, so that one compile lifts the Mortar Overdrive groups' exclusion
// (`mortarOverdriveArrivalLifts`, compile_exclusion.ts). Everywhere else they stay out of
// it, and the lobby path stays the seam's alone.

import { isAtMortarOverdriveXZ } from '../../sim/mortar_overdrive/layout';

/** The compile owner the Mortar Overdrive groups declare (compile_exclusion.ts): the race
 *  preparation seam, which links them. */
export const MORTAR_OVERDRIVE_COMPILE_OWNER = 'mortar-overdrive-prepare';

const MORTAR_OVERDRIVE_LIFT: readonly string[] = Object.freeze([MORTAR_OVERDRIVE_COMPILE_OWNER]);
const NO_LIFT: readonly string[] = Object.freeze([]);

/** The exclusion owners a blocking arrival's whole-scene compile lifts for a
 *  landing at (x, z): the Mortar Overdrive groups when the landing is in the Mortar Overdrive band,
 *  none anywhere else. */
export function mortarOverdriveArrivalLifts(x: number, z: number): readonly string[] {
  return isAtMortarOverdriveXZ(x, z) ? MORTAR_OVERDRIVE_LIFT : NO_LIFT;
}

/** Why the preparation started, in the order the checks run: the reason is
 *  telemetry only, every reason prepares the same set. */
export type MortarOverdrivePrepareReason = 'queue' | 'practice' | 'seated' | 'band' | 'shot';

/** The slice of the viewer's Mortar Overdrive state the trigger reads. */
export interface MortarOverdriveCommitment {
  queued: boolean;
  match: { practice: boolean } | null;
  /** The viewer stands inside the Mortar Overdrive band (sim `isAtMortarOverdriveXZ`). */
  inBand: boolean;
  /** A client already built itself for a draw that came first. */
  shot: boolean;
}

/** Whether this viewer has committed to racing right now, and why. */
export function mortarOverdrivePrepareReason(
  commitment: MortarOverdriveCommitment,
): MortarOverdrivePrepareReason | null {
  if (commitment.queued) return 'queue';
  if (commitment.match) return commitment.match.practice ? 'practice' : 'seated';
  if (commitment.inBand) return 'band';
  if (commitment.shot) return 'shot';
  return null;
}

/** Whether an in-flight preparation may hold the arrival curtain: only while
 *  the viewer is on the circuit (seated, or standing in the band). A queue
 *  join in a town is not an arrival anywhere near the race. */
export function mortarOverdrivePrepareHolds(commitment: MortarOverdriveCommitment): boolean {
  return commitment.match !== null || commitment.inBand;
}

export interface MortarOverdrivePrepareLatch {
  reason: MortarOverdrivePrepareReason | null;
}

export function createMortarOverdrivePrepareLatch(): MortarOverdrivePrepareLatch {
  return { reason: null };
}

/** The reason to start preparing on THIS frame, or null: non-null exactly once
 *  per latch, on the first frame the viewer is committed. */
export function takeMortarOverdrivePrepare(
  latch: MortarOverdrivePrepareLatch,
  commitment: MortarOverdriveCommitment,
): MortarOverdrivePrepareReason | null {
  if (latch.reason !== null) return null;
  const reason = mortarOverdrivePrepareReason(commitment);
  if (reason !== null) latch.reason = reason;
  return reason;
}

export type MortarOverdrivePrepareState = 'idle' | 'preparing' | 'proven' | 'unproven';

/** A client's own step count, for a client that prepares in several steps. */
export interface MortarOverdrivePrepareUnits {
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
export interface MortarOverdrivePrepareProgress {
  done: number;
  total: number;
  settled: boolean;
}

export function mortarOverdrivePrepareSettledState(state: MortarOverdrivePrepareState): boolean {
  return state === 'proven' || state === 'unproven';
}

function wholeUnits(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Reset `out` before the clients are added: nothing counted yet, and settled
 *  only if the seam has started. */
export function beginMortarOverdrivePrepareTally(
  out: MortarOverdrivePrepareProgress,
  started: boolean,
): MortarOverdrivePrepareProgress {
  out.done = 0;
  out.total = 0;
  out.settled = started;
  return out;
}

/** Add one client to the tally. Allocation-free. */
export function addMortarOverdrivePrepareTally(
  out: MortarOverdrivePrepareProgress,
  state: MortarOverdrivePrepareState,
  units: MortarOverdrivePrepareUnits | null,
): void {
  const total = Math.max(1, wholeUnits(units?.total ?? 1));
  out.total += total;
  if (mortarOverdrivePrepareSettledState(state)) {
    out.done += total;
    return;
  }
  out.settled = false;
  out.done += Math.min(total, wholeUnits(units?.done ?? 0));
}

/** The client that links the procedural programs every circuit draws, at the
 *  commitment trigger, before any circuit is drawn. */
export const MORTAR_OVERDRIVE_COMMON_PREPARE_ID = 'mortarOverdriveCommon';

const CIRCUIT_PREPARE_PREFIX = 'mortarOverdriveCircuit:';

/** The client of one drawn circuit: its build, its dressing models, its view,
 *  its sky. */
export function mortarOverdriveCircuitPrepareId(circuitId: string): string {
  return `${CIRCUIT_PREPARE_PREFIX}${circuitId}`;
}

/** The circuit this viewer needs prepared now: their own match's once it is
 *  known (from the lobby on), else the lane they stand on in the band (a
 *  bystander, or a login at the fence). */
export function mortarOverdrivePrepareCircuit(
  matchCircuitId: string | null,
  laneCircuitId: string | null,
): string | null {
  return matchCircuitId ?? laneCircuitId;
}

/**
 * Whether a circuit's build runs to the end at once rather than a piece per
 * task. Only one wait is worth spreading a build over: the viewer's own race
 * lobby while its curtain still covers the world (the pilots load, the bar
 * moves, chat stays live). Everywhere else the circuit is on screen, or about
 * to be, for someone who reads it: the viewer's own race past its lobby (a
 * login, a reconnect or a graphics rebuild mid-race, a lobby whose curtain fell
 * at its cap or on a lost connection) and a viewer standing on the lane (the
 * band IS the lanes: a login at the fence, an arrival, a step onto a lane).
 * There one long task beats a road, a wall or a hedge that is not drawn yet.
 * The first frame of a renderer still runs under the world-entry loading
 * screen or the graphics curtain.
 */
export function mortarOverdriveBuildNow(
  circuitId: string,
  match: { circuitId?: string; phase?: string } | null,
  laneCircuitId: string | null,
  lobbyCovered: boolean,
): boolean {
  if (match?.circuitId === circuitId) return match.phase !== 'loading' || !lobbyCovered;
  return laneCircuitId === circuitId;
}

/**
 * Whether a circuit's view stays hidden on the viewer's own lane: only while
 * its preparation has no verdict AND something covers the world (an arrival
 * cover, or the viewer's own race still in its loading lobby). Hiding the road
 * in the open would hide what a pilot reacts to, so an uncovered circuit draws
 * cold rather than late.
 */
export function mortarOverdriveRevealHeld(
  state: MortarOverdrivePrepareState,
  covered: boolean,
): boolean {
  return covered && !mortarOverdrivePrepareSettledState(state);
}

/** A circuit client's steps after its build: each dressing fill, the gate,
 *  the upload frame of the linked view (its buffer uploads), the sky. */
export function mortarOverdriveCircuitUnits(
  out: MortarOverdrivePrepareUnits,
  fillsDone: number,
  fillsTotal: number,
  gated: boolean,
  drawn: boolean,
  skyReady: boolean,
): MortarOverdrivePrepareUnits {
  const total = Math.max(0, fillsTotal);
  out.total = total + 3;
  out.done =
    Math.min(total, Math.max(0, fillsDone)) +
    (gated ? 1 : 0) +
    (drawn ? 1 : 0) +
    (skyReady ? 1 : 0);
  return out;
}

/** Add a build's pieces to a client's steps: a build not started yet counts
 *  as one piece, and a build grows as its loops plan their bands. */
export function addMortarOverdriveBuildUnits(
  out: MortarOverdrivePrepareUnits,
  buildDone: number,
  buildTotal: number,
): MortarOverdrivePrepareUnits {
  const pieces = Math.max(1, wholeUnits(buildTotal));
  out.total += pieces;
  out.done += Math.min(pieces, wholeUnits(buildDone));
  return out;
}
