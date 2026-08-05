// The TERRAIN tool's canvas gestures: drawing a barrier run point by point,
// picking one back up, moving a point, and centring the whole circuit inside its
// enclosure.
//
// A barrier is a list of circuit-local points and a kit, so everything the
// gesture decides is here: which point of which fence a click landed on, what
// each click of a drawing gesture does to the run in progress, and what a point
// drag, a delete or a scale edit do to the record's list.
//
// Where the MODULES end up is not decided here and must not be:
// `src/sim/realm_racers_fences.ts` resolves a fence into runs and joints, the
// game tiles what it returns and the plan draws the same thing. That is the rule
// the dressing already paid for once, a tool drawing a placement the game did
// not have.
//
// A run is ANGULAR, so there is no curve fitting in this file and there should
// never be one: every barrier kit's module is a straight segment, and a smoothed
// run would be a chain of chords with a wedge of daylight at every joint.
//
// Pure and DOM-free, deterministic, no rng. Dev tool, so English lives here.

import { REALM_RACERS_BARRIER_KEYS } from '../../sim/content/realm_racers_barriers';
import type { RallyFence, RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { realmRacersFencePlacements } from '../../sim/realm_racers_fences';
import type { RallyPoint } from '../../sim/realm_racers_layout';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../../sim/realm_racers_spline';

/** How many barriers a circuit may carry, and how many points one may have.
 *  Ceilings rather than designs: past either, something upstream is wrong. */
export const MAX_FENCES = 64;
export const MAX_FENCE_POINTS = 128;

/** How near a point the pointer has to be to grab it, in yards at zoom 1. The
 *  caller scales it, exactly as the props tool scales its own tolerance. */
export const FENCE_POINT_TOLERANCE_YD = 2.5;

/** Multiplier range a record's own `scale` may take. Wide enough for a kneewall
 *  cut out of a curtain wall and for a hedge grown to a windbreak, and bounded so
 *  a typo cannot author a barrier the size of the band. */
export const FENCE_SCALE_MIN = 0.25;
export const FENCE_SCALE_MAX = 4;

/** What a click found on the plan: a whole fence, and which of its points. */
export interface FenceHit {
  fence: number;
  /** The point index under the pointer, or null for a hit on a RUN between two. */
  point: number | null;
}

/**
 * A run being drawn: the kit, the points committed so far, and whether the next
 * click would close the ring.
 *
 * It lives OUTSIDE the record on purpose. A half-drawn barrier is not a barrier:
 * it has no runs, it collides with nothing and the readout has nothing to say
 * about it, so writing it to the record would put an entry on the circuit that
 * every consumer has to special-case. It reaches the record in one commit, which
 * is also what makes the whole gesture one undo step.
 */
export interface FenceDraft {
  kit: string;
  points: readonly RallyPoint[];
}

/** Is this a kit the catalog authors? The palette only offers real ones, but a
 *  draft loaded off disk may name anything. */
export function isBarrierKit(kit: string): boolean {
  return REALM_RACERS_BARRIER_KEYS.includes(kit);
}

function distance(a: RallyPoint, b: RallyPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Distance from a point to a segment, which is what a click on the RUN between
 * two authored points is tested against: a fence is mostly line and only
 * occasionally corner, so a tool that could only be grabbed by its points would
 * be a tool that misses most of what it draws.
 */
function distanceToSegment(p: RallyPoint, a: RallyPoint, b: RallyPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t));
}

/**
 * What a click at (x, z) landed on, or null for empty plan.
 *
 * POINTS BEAT RUNS, and the nearest point beats a farther one. The order is the
 * props tool's own hit-test-first rule at one more level of detail: at a working
 * zoom the tolerance around a corner reaches the two runs meeting there as well,
 * and "whichever run was declared first" would make the corner itself
 * ungrabbable, which is the one part of a fence an operator most wants to drag.
 */
export function fenceHitAt(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  tolerance: number,
): FenceHit | null {
  const fences = circuit.fences ?? [];
  const at = { x, z };
  let best: { hit: FenceHit; distance: number; isPoint: boolean } | null = null;
  for (let f = 0; f < fences.length; f++) {
    const fence = fences[f];
    for (let p = 0; p < fence.points.length; p++) {
      const d = distance(at, fence.points[p]);
      if (d > tolerance) continue;
      if (best?.isPoint && best.distance <= d) continue;
      best = { hit: { fence: f, point: p }, distance: d, isPoint: true };
    }
    if (best?.isPoint) continue;
    const last =
      fence.closed && fence.points.length >= 3 ? fence.points.length : fence.points.length - 1;
    for (let p = 0; p < last; p++) {
      const d = distanceToSegment(at, fence.points[p], fence.points[(p + 1) % fence.points.length]);
      if (d > tolerance) continue;
      if (best && best.distance <= d) continue;
      best = { hit: { fence: f, point: null }, distance: d, isPoint: false };
    }
  }
  return best?.hit ?? null;
}

/**
 * What one click does to the run being drawn.
 *
 * Three answers, and the third is the one worth naming: a click back on the
 * FIRST point closes the ring, which is the only way to author a closed barrier
 * and the gesture every drawing tool uses for it. It needs three points before it
 * will close, because two points closed would lay the same run twice back to back
 * and double every collider on it, which is the same guard the resolver keeps.
 */
export type FenceDraftStep =
  | { kind: 'point'; draft: FenceDraft }
  | { kind: 'close'; fence: RallyFence }
  | { kind: 'ignored'; reason: string };

export function fenceDraftClick(
  draft: FenceDraft,
  x: number,
  z: number,
  tolerance: number,
): FenceDraftStep {
  const at = { x, z };
  const first = draft.points[0];
  if (first && draft.points.length >= 3 && distance(at, first) <= tolerance) {
    return { kind: 'close', fence: { kit: draft.kit, points: [...draft.points], closed: true } };
  }
  if (draft.points.length >= MAX_FENCE_POINTS) {
    return { kind: 'ignored', reason: `a barrier may hold ${MAX_FENCE_POINTS} points` };
  }
  // A click on the point just laid is a double click, or a hand that did not
  // move. Authoring it would put a zero-length run in the record, which the
  // resolver then skips: a point that does nothing and cannot be seen.
  const previous = draft.points[draft.points.length - 1];
  if (previous && distance(at, previous) <= tolerance) {
    return { kind: 'ignored', reason: 'that is the point you just placed' };
  }
  return { kind: 'point', draft: { kit: draft.kit, points: [...draft.points, at] } };
}

/**
 * Finish an open run.
 *
 * Null when there is nothing to finish, which is the case an operator reaches by
 * arming a kit and pressing enter: one point is not a run, and a record entry
 * with one point resolves to no geometry at all.
 */
export function finishFenceDraft(draft: FenceDraft): RallyFence | null {
  if (draft.points.length < 2) return null;
  return { kit: draft.kit, points: [...draft.points] };
}

/** Add a finished barrier, refusing past the ceiling. */
export function addFence(
  fences: readonly RallyFence[],
  fence: RallyFence,
): { fences: readonly RallyFence[]; index: number } | null {
  if (fences.length >= MAX_FENCES) return null;
  const out = [...fences, fence];
  return { fences: out, index: out.length - 1 };
}

/** Move one authored point. The list order is the record's own, so an index
 *  never changes under a move: unlike a pickup row, a barrier has no ordering
 *  rule for a drag to break. */
export function moveFencePoint(
  fences: readonly RallyFence[],
  index: number,
  point: number,
  x: number,
  z: number,
): readonly RallyFence[] {
  const fence = fences[index];
  if (!fence || point < 0 || point >= fence.points.length) return fences;
  const points = fence.points.map((held, i) => (i === point ? { x, z } : held));
  return fences.map((held, i) => (i === index ? { ...fence, points } : held));
}

/** Move a whole barrier by an offset: the arrow nudge, and what `Center circuit`
 *  does to every fence at once. */
export function moveFence(
  fences: readonly RallyFence[],
  index: number,
  dx: number,
  dz: number,
): readonly RallyFence[] {
  const fence = fences[index];
  if (!fence) return fences;
  const points = fence.points.map((point) => ({ x: point.x + dx, z: point.z + dz }));
  return fences.map((held, i) => (i === index ? { ...fence, points } : held));
}

/**
 * Delete one authored POINT, or the whole barrier when it is down to its last
 * two.
 *
 * A run needs two points, so removing one from a two-point fence is a request to
 * remove the fence: answering it by refusing would leave `del` doing nothing at
 * all on the commonest barrier there is, a single straight run.
 */
export function removeFencePoint(
  fences: readonly RallyFence[],
  index: number,
  point: number,
): readonly RallyFence[] {
  const fence = fences[index];
  if (!fence) return fences;
  if (fence.points.length <= 2) return fences.filter((_, i) => i !== index);
  const points = fence.points.filter((_, i) => i !== point);
  return fences.map((held, i) => (i === index ? { ...fence, points } : held));
}

export function removeFence(fences: readonly RallyFence[], index: number): readonly RallyFence[] {
  return fences.filter((_, i) => i !== index);
}

/** Set one barrier's scale multiplier, clamped. */
export function setFenceScale(
  fences: readonly RallyFence[],
  index: number,
  scale: number,
): readonly RallyFence[] {
  const fence = fences[index];
  if (!fence) return fences;
  const clamped = Math.min(FENCE_SCALE_MAX, Math.max(FENCE_SCALE_MIN, scale));
  // 1 is the default, and an explicit 1 on the record is noise the export would
  // carry forever.
  const next: RallyFence = clamped === 1 ? { ...fence } : { ...fence, scale: clamped };
  if (clamped === 1) delete (next as { scale?: number }).scale;
  return fences.map((held, i) => (i === index ? next : held));
}

/**
 * Is this run clear of the racing surface?
 *
 * The GHOST's tint, and it asks the readout's own question rather than one of its
 * own: `fence_blocks_racing_surface` measures a run by sampling it, so a ghost
 * derived from its endpoints would be free to draw green over a run the panel is
 * about to refuse. Sampling here is the same walk at the same spacing.
 */
export function fenceRunClearOfSurface(
  circuit: RealmRacersCircuit,
  a: RallyPoint,
  b: RallyPoint,
  halfThickness: number,
  sampleYards = 2,
): boolean {
  const track = realmRacersTrack(circuit);
  const length = distance(a, b);
  const steps = Math.max(1, Math.ceil(length / Math.max(0.01, sampleYards)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
    const clear = Math.abs(projection.lateral) - halfThickness;
    if (clear < rallyGardenEdgeOffsetAt(circuit, projection.s)) return false;
  }
  return true;
}

/** How many colliders a circuit's barriers cost, for the inspector to report.
 *  One per straight run, which is what makes a long fence cheap and a
 *  many-cornered one worth seeing the number of. */
export function fenceColliderCount(circuit: RealmRacersCircuit): number {
  return realmRacersFencePlacements(circuit).fences.reduce(
    (total, fence) => total + fence.runs.length,
    0,
  );
}

/**
 * The offset that centres the ROAD in its enclosure.
 *
 * The enclosure is authored as half-extents around the origin, so centring the
 * road IS the operation: nothing about the box moves. What the caller must do
 * with the answer is move EVERYTHING circuit-local by it, the control points and
 * the fences and the ponds and the circuit-local props alike. Moving the road
 * alone would walk it out from under its own dressing, which is the defect class
 * the one resolver exists to prevent, one level up.
 *
 * Track-space props need nothing: they are expressed against the centerline and
 * follow it for free.
 */
export function centerCircuitOffset(circuit: RealmRacersCircuit): { dx: number; dz: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const track = realmRacersTrack(circuit);
  for (const sample of track.samples) {
    // The ROAD's footprint rather than the centerline's: a lap whose centerline
    // is centred but whose road is wider on one side is not centred, and the
    // garden edge is the one lateral boundary a circuit has.
    const span = rallyGardenEdgeOffsetAt(circuit, sample.s);
    const x = sample.x - REALM_RACERS_ORIGIN.x;
    const z = sample.z - REALM_RACERS_ORIGIN.z;
    minX = Math.min(minX, x - span);
    maxX = Math.max(maxX, x + span);
    minZ = Math.min(minZ, z - span);
    maxZ = Math.max(maxZ, z + span);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minZ)) return { dx: 0, dz: 0 };
  return { dx: -(minX + maxX) / 2, dz: -(minZ + maxZ) / 2 };
}

/**
 * Every circuit-local thing on a record, slid by the same offset.
 *
 * The list is exhaustive by construction rather than by memory: a field that
 * carries circuit-local coordinates and is not moved here is a piece left behind
 * when the road moves, which is exactly how the blank-canvas clearing lost
 * `pickupRows` once. `tests/editor_circuit_fences.test.ts` walks a record with
 * one of every kind and checks all of them moved together.
 */
export function moveCircuitContent(
  circuit: RealmRacersCircuit,
  dx: number,
  dz: number,
): RealmRacersCircuit {
  const out: RealmRacersCircuit = {
    ...circuit,
    controlPoints: circuit.controlPoints.map((point) => ({ x: point.x + dx, z: point.z + dz })),
  };
  if (circuit.props) {
    out.props = circuit.props.map((prop) =>
      // A track-space prop is authored against the centerline, which is moving
      // with it, so its two numbers are already correct.
      'x' in prop.at ? { ...prop, at: { x: prop.at.x + dx, z: prop.at.z + dz } } : prop,
    );
  }
  if (circuit.ponds) {
    out.ponds = circuit.ponds.map((pond) => ({ ...pond, x: pond.x + dx, z: pond.z + dz }));
  }
  if (circuit.fences) {
    out.fences = circuit.fences.map((fence) => ({
      ...fence,
      points: fence.points.map((point) => ({ x: point.x + dx, z: point.z + dz })),
    }));
  }
  if (circuit.groundOutline) {
    out.groundOutline = circuit.groundOutline.map((point) => ({
      x: point.x + dx,
      z: point.z + dz,
    }));
  }
  // `scatters` are authored as a span of LAP and a side, and `pickupRows` as a
  // lap fraction: both follow the centerline for free, like a track-space prop.
  return out;
}
