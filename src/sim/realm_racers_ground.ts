// The shape of the LAND a circuit sits on: the one function that turns an
// authored `groundOutline` into the closed polygon everything else reads, and
// the only one allowed to.
//
// Same contract as `realm_racers_fences.ts` and `realm_racers_props_resolve.ts`:
// the renderer cuts the lawn along what this returns, the readout measures the
// road against what this returns, and neither works out a shape of its own. A
// renderer deriving its own outline would draw an island the readout knows
// nothing about, which is the defect class the resolvers exist for.
//
// The DEFAULT is the whole of the interesting behaviour. A circuit that authors
// no outline gets the rectangle the ground has always been (`regionHalf*` plus
// `REALM_RACERS_LAWN_OVERSHOOT`), so both shipped circuits are byte-identical to
// what they were before the field existed and the rule below can never fire on
// them.
//
// Coordinates in and out are CIRCUIT-LOCAL, the frame `controlPoints` are
// authored in.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM, no three.

import type { RealmRacersCircuit } from './content/realm_racers_circuits';
import { polygonContainsPoint } from './geometry2d';
import type { RallyPoint } from './realm_racers_layout';
import { REALM_RACERS_LAWN_OVERSHOOT } from './realm_racers_layout';
import { memoizePerCircuit, sampleClosedCatmullRom } from './realm_racers_spline';

/**
 * How many positions the curve is sampled at per authored span.
 *
 * The shore is seen from a machine on the road, so it is judged as a silhouette
 * rather than as a line under the eye: eight a span puts a vertex every few
 * yards on an outline of the size a circuit is drawn at, which is the density a
 * pond's own outline already reads smooth at.
 */
export const REALM_RACERS_GROUND_SAMPLES_PER_SPAN = 8;

/**
 * A closed ring needs three points to enclose anything.
 *
 * Exported because it is the floor all three layers have to agree on: this
 * resolver falls back to the rectangle under it, the editor's validator refuses
 * a payload under it, and the tool refuses to delete a handle that would take a
 * shape under it. The tool used to keep the CENTERLINE's floor of eight instead,
 * which made a nine-handle proposal deletable exactly once.
 */
export const REALM_RACERS_MIN_GROUND_POINTS = 3;

/**
 * Is this a ring the geometry below can answer about at all?
 *
 * ARITY and FINITENESS, and the second half is the one worth naming. A single
 * non-finite handle reaches a long way from here: `distanceToOutline` takes a
 * `Math.min` over every edge, so one NaN endpoint poisons the clearance for
 * EVERY point on the land and the derived fills empty out; and the crossings in
 * `realmRacersGroundSpansAt` are sorted with a subtraction comparator, which a
 * NaN turns into an implementation-defined ordering. That last one is a
 * determinism hazard rather than a cosmetic one: this is `src/sim`, and the
 * browser, the server and the RL env would be free to disagree about where the
 * land is. A malformed draft falls back to the rectangle, which is what the rest
 * of this module already does with a ring too short to enclose anything.
 */
function isDrawable(points: readonly RallyPoint[]): boolean {
  return (
    points.length >= REALM_RACERS_MIN_GROUND_POINTS &&
    points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z))
  );
}

export interface RallyGroundShape {
  /** The closed outline, circuit-local, first point never repeated at the end.
   *  Deeply readonly: it comes out of a module-global memo that the sim, the
   *  renderer and the editor all read, so a consumer offsetting a point in place
   *  would poison the land for every other one. */
  outline: readonly Readonly<RallyPoint>[];
  /** False when this is the derived rectangle, which is what lets a consumer
   *  skip the sea and the shore entirely rather than drawing a shoreline around
   *  the whole instance band. */
  authored: boolean;
}

/** The rectangle the ground is when nobody drew one: the region, plus the
 *  overshoot that keeps the horizon lawn rather than empty band. */
export function realmRacersGroundRectangle(circuit: RealmRacersCircuit): RallyPoint[] {
  const halfX = circuit.regionHalfX + REALM_RACERS_LAWN_OVERSHOOT;
  const halfZ = circuit.regionHalfZ + REALM_RACERS_LAWN_OVERSHOOT;
  return [
    { x: -halfX, z: -halfZ },
    { x: halfX, z: -halfZ },
    { x: halfX, z: halfZ },
    { x: -halfX, z: halfZ },
  ];
}

/**
 * The land under one circuit, resolved. Memoized per circuit id and held only
 * while the RECORD behind that id is the same object: the discipline the spline,
 * the dressing and the barriers already run on, so a draft redrawn on every drag
 * gets the shape of the record it actually passed.
 */
export const realmRacersGroundShape: (circuit: RealmRacersCircuit) => RallyGroundShape =
  memoizePerCircuit((circuit) => {
    const authored = circuit.groundOutline ?? [];
    if (!isDrawable(authored)) {
      return { outline: realmRacersGroundRectangle(circuit), authored: false };
    }
    return {
      outline: sampleClosedCatmullRom(authored, REALM_RACERS_GROUND_SAMPLES_PER_SPAN),
      authored: true,
    };
  });

/**
 * May something STAND here?
 *
 * The one question every derived fill on a circuit has to ask before it places a
 * piece: the meadow, the flower beds and the seeded scatters are all generated
 * over a box (the perimeter), and a box is not a shape. Without this they carpet
 * the sea around an island, which is what a derived fill does whenever the thing
 * it derives from is not the thing an author drew.
 *
 * `margin` is how much land the piece needs AROUND the point, yards: a bench
 * whose footprint hangs over the shore is standing on water as surely as one
 * dropped in it. Zero for something the size of a blade.
 *
 * Always true where no outline is authored, and that arm is the cheap one: the
 * derived rectangle covers the whole region, so the answer is known without
 * walking anything.
 */
export function realmRacersOnGround(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  margin = 0,
): boolean {
  const shape = realmRacersGroundShape(circuit);
  if (!shape.authored) return true;
  if (!polygonContainsPoint(shape.outline, x, z)) return false;
  if (margin <= 0) return true;
  return distanceToOutline(shape.outline, x, z) >= margin;
}

/**
 * The x spans of LAND along one line of constant z, in order, or null where the
 * whole line is land.
 *
 * What a caller filling a GRID asks instead of testing every cell: the grass
 * mask is a byte per square yard over the perimeter box, so a point test per
 * cell is tens of thousands of walks of the outline where this is one walk per
 * ROW. Same even-odd rule as the point test, so the two cannot disagree about
 * where the shore is.
 */
export function realmRacersGroundSpansAt(
  circuit: RealmRacersCircuit,
  z: number,
): readonly { x0: number; x1: number }[] | null {
  const shape = realmRacersGroundShape(circuit);
  if (!shape.authored) return null;
  const crossings: number[] = [];
  const outline = shape.outline;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    // The half-open rule (one end counted, the other not) is what stops a vertex
    // exactly on the line being counted twice and turning inside into outside.
    if (a.z > z === b.z > z) continue;
    crossings.push(a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));
  }
  crossings.sort((left, right) => left - right);
  const spans: { x0: number; x1: number }[] = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    spans.push({ x0: crossings[i], x1: crossings[i + 1] });
  }
  return spans;
}

/** How far a point sits from the shore, yards. Only ever asked of a point
 *  already known to be on the land, so it is a clearance rather than a signed
 *  distance. */
function distanceToOutline(outline: readonly RallyPoint[], x: number, z: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length2 = dx * dx + dz * dz;
    const t =
      length2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / length2));
    best = Math.min(best, Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t)));
  }
  return best;
}
