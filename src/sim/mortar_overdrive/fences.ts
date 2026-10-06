// Where a circuit's authored barriers actually STAND: the one function that
// turns `fences` into runs, and the only one allowed to.
//
// Same contract as `mortar_overdrive/props_resolve.ts`, and for the same reason: the
// renderer tiles what this returns, `mortar_overdrive/colliders.ts` appends what it
// returns, and the readout measures what it returns. A renderer working out a
// position for itself is how the tiered fountain came to be drawn in the middle
// of a road the collision set knew nothing about.
//
// IT EMITS RUNS, NOT PANELS, and the line is deliberate. How much run one module
// covers is a fact about a MODEL (`panelYards` in the render catalog), so a sim
// leaf that emitted panels would be a sim leaf holding a rendering number. What
// a run is, where it ends and what it collides with are geometry, and they live
// here; `mortarOverdriveFencePieces` in `src/render/mortar_overdrive/track_core.ts` cuts a run
// into modules.
//
// ONE COLLIDER PER RUN, never one per module. A run is straight, so a single OBB
// covers it exactly; a twenty-panel hedge that cost twenty colliders would be
// paying for its own art.
//
// Coordinates in and out are CIRCUIT-LOCAL, the frame `controlPoints` are
// authored in and the frame the collision set builds in.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM, no three.

import {
  type MortarOverdriveBarrierDef,
  mortarOverdriveBarrierDef,
} from '../content/mortar_overdrive/barriers';
import type {
  MortarOverdriveCircuit,
  MortarOverdriveFence,
} from '../content/mortar_overdrive/circuits';
import type { MortarOverdrivePoint } from './layout';
import { memoizePerCircuit } from './spline';

/**
 * One straight stretch of barrier, with the box that stops a machine.
 *
 * `length` is the run the operator AUTHORED, which is what an inspector shows.
 * `hw` is the half length of the COLLIDER, which reaches a half thickness past
 * any end that meets another run: the same trick the perimeter box has always
 * used at its corners (`hw: px + t`), so a joint has no wedge to squeeze
 * through and no daylight under the corner piece.
 */
export interface MortarOverdriveFenceRun {
  /** The authored endpoints, circuit-local. */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /**
   * The DRAWN endpoints: the authored ones pushed out a half thickness at every
   * end that meets another run, which is the same reach `hw` covers.
   *
   * Two pairs rather than one because they answer two questions. The authored
   * pair is what the operator drew, so it is what an inspector reports and what
   * the readout measures. The drawn pair is what the modules are laid along, and
   * it has to match the COLLIDER or a corner shows daylight the machine still
   * hits: with no corner piece, closing a joint IS the two runs overlapping
   * there.
   */
  dax: number;
  daz: number;
  dbx: number;
  dbz: number;
  /** The drawn length, which is what a module count is derived from. */
  drawnLength: number;
  /** The collider: centre, half extents, and a yaw laying `hw` along the run. */
  x: number;
  z: number;
  hw: number;
  hd: number;
  rot: number;
  /** The authored length, yards. */
  length: number;
}

/**
 * A joint or an end: where a corner piece stands, and which way it faces.
 *
 * The yaw BISECTS the two runs that meet there, rather than taking either one's:
 * a corner piece exists to cover a joint, and a piece square to one arm leaves
 * the other's daylight showing. At an open end there is only one arm and the
 * bisector collapses onto it.
 */
export interface MortarOverdriveFenceCorner {
  x: number;
  z: number;
  yaw: number;
}

export interface MortarOverdrivePlacedFence {
  /**
   * Which entry of the record's own `fences` list this came from.
   *
   * Carried rather than implied by position, because the two lists are NOT
   * parallel: a fence naming a kit nothing authors is SKIPPED here and reported
   * in `unknownKits`, so every placement after it sits one index early. A
   * consumer correlating by position would then draw one barrier's runs under
   * another's authored points, highlight the wrong one, and report the wrong
   * numbers for the selection, on exactly the record `unknown_barrier_kit`
   * exists to describe.
   */
  index: number;
  /** Catalog key, for the renderer to resolve a visual with. */
  kit: string;
  /** The record's own multiplier on the kit's scale. */
  scale: number;
  /** Visual height at the placed scale, yards. */
  height: number;
  runs: readonly MortarOverdriveFenceRun[];
  corners: readonly MortarOverdriveFenceCorner[];
}

export interface MortarOverdriveFencePlacements {
  fences: readonly MortarOverdrivePlacedFence[];
  /**
   * Kit keys the record names that nothing authors, deduped, in the order they
   * were met. The resolver SKIPS them rather than throwing, so a half-typed
   * draft still draws; naming them is the readout's job (`unknown_barrier_kit`).
   */
  unknownKits: readonly string[];
}

/** The yaw that lays a module's own +x axis along (ux, uz). The three.js
 *  rotation.y convention, which maps local +x to (cos, -sin) in (x, z), and the
 *  same one an OBB collider's `rot` is read in, so one number serves both. */
function runYaw(ux: number, uz: number): number {
  return Math.atan2(-uz, ux);
}

function unit(
  a: MortarOverdrivePoint,
  b: MortarOverdrivePoint,
): { ux: number; uz: number; length: number } | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  // A repeated point is not a run. Skipped rather than refused: a record may
  // legitimately arrive from a hand edit, and a division by zero here would put
  // NaN into a collider the physics then tests every tick.
  if (!(length > 0)) return null;
  return { ux: dx / length, uz: dz / length, length };
}

function buildRun(
  a: MortarOverdrivePoint,
  b: MortarOverdrivePoint,
  halfThickness: number,
  extendA: boolean,
  extendB: boolean,
): MortarOverdriveFenceRun | null {
  const step = unit(a, b);
  if (!step) return null;
  const { ux, uz, length } = step;
  const back = extendA ? halfThickness : 0;
  const forward = extendB ? halfThickness : 0;
  const full = length + back + forward;
  const centre = full / 2 - back;
  return {
    ax: a.x,
    az: a.z,
    bx: b.x,
    bz: b.z,
    dax: a.x - ux * back,
    daz: a.z - uz * back,
    dbx: b.x + ux * forward,
    dbz: b.z + uz * forward,
    drawnLength: full,
    x: a.x + ux * centre,
    z: a.z + uz * centre,
    hw: full / 2,
    hd: halfThickness,
    rot: runYaw(ux, uz),
    length,
  };
}

/** The direction a corner piece faces: the bisector of the arms meeting there.
 *  A reversal (the run doubling back on itself) has no bisector, so the outgoing
 *  arm wins rather than a zero vector producing an arbitrary yaw. */
function cornerYaw(
  incoming: { ux: number; uz: number } | null,
  outgoing: { ux: number; uz: number } | null,
): number {
  if (incoming && outgoing) {
    const bx = incoming.ux + outgoing.ux;
    const bz = incoming.uz + outgoing.uz;
    if (Math.hypot(bx, bz) > 1e-6) return runYaw(bx, bz);
    return runYaw(outgoing.ux, outgoing.uz);
  }
  const only = outgoing ?? incoming;
  return only ? runYaw(only.ux, only.uz) : 0;
}

function resolveFence(
  fence: MortarOverdriveFence,
  def: MortarOverdriveBarrierDef,
  index: number,
): MortarOverdrivePlacedFence {
  const scale = fence.scale ?? 1;
  const halfThickness = def.halfThickness * scale;
  const points = fence.points;
  // A ring needs three points to enclose anything; closing two would lay the
  // same run twice, back to back, and double every collider on it.
  const closed = Boolean(fence.closed) && points.length >= 3;
  const runs: MortarOverdriveFenceRun[] = [];
  const last = closed ? points.length : points.length - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    // Every joint is extended; the two ends of an OPEN run are not, or a fence
    // would collide a half thickness past the point it was drawn to.
    const run = buildRun(a, b, halfThickness, closed || i > 0, closed || i < last - 1);
    if (run) runs.push(run);
  }
  const corners: MortarOverdriveFenceCorner[] = [];
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const previous = i > 0 ? points[i - 1] : closed ? points[points.length - 1] : null;
    const next = i < points.length - 1 ? points[i + 1] : closed ? points[0] : null;
    const incoming = previous ? unit(previous, point) : null;
    const outgoing = next ? unit(point, next) : null;
    if (!incoming && !outgoing) continue;
    corners.push({ x: point.x, z: point.z, yaw: cornerYaw(incoming, outgoing) });
  }
  return { index, kit: fence.kit, scale, height: def.height * scale, runs, corners };
}

/**
 * Every authored barrier, resolved. Memoized per circuit id and held only while
 * the RECORD behind that id is the same object: the discipline the spline, the
 * dressing and the collision set already run on, so a draft redrawn on every
 * drag gets the geometry of the record it actually passed.
 */
export const mortarOverdriveFencePlacements: (
  circuit: MortarOverdriveCircuit,
) => MortarOverdriveFencePlacements = memoizePerCircuit((circuit) => {
  const unknownKits: string[] = [];
  const fences: MortarOverdrivePlacedFence[] = [];
  const authored = circuit.fences ?? [];
  for (let index = 0; index < authored.length; index++) {
    const fence = authored[index];
    const def = mortarOverdriveBarrierDef(fence.kit);
    if (!def) {
      if (!unknownKits.includes(fence.kit)) unknownKits.push(fence.kit);
      continue;
    }
    fences.push(resolveFence(fence, def, index));
  }
  return { fences, unknownKits };
});

/** Every placed barrier run, flattened: what the collision set appends and what
 *  the readout measures. */
export function mortarOverdriveFenceRuns(
  circuit: MortarOverdriveCircuit,
): readonly { run: MortarOverdriveFenceRun; height: number }[] {
  const out: { run: MortarOverdriveFenceRun; height: number }[] = [];
  for (const fence of mortarOverdriveFencePlacements(circuit).fences) {
    for (const run of fence.runs) out.push({ run, height: fence.height });
  }
  return out;
}

/**
 * Points along a run's centre line, at most `spacing` yards apart, both ends
 * included.
 *
 * The readout measures a run by SAMPLING it rather than by its endpoints, and
 * that is the whole content of the rule: a straight run whose two ends sit
 * safely in the lawn can still cut the inside of a corner between them. Sampling
 * density is the readout's business rather than the kit's, which is why it is a
 * spacing here and not the module length.
 */
export function mortarOverdriveFenceRunSamples(
  run: MortarOverdriveFenceRun,
  spacing: number,
): MortarOverdrivePoint[] {
  const steps = Math.max(1, Math.ceil(run.length / Math.max(0.01, spacing)));
  const out: MortarOverdrivePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push({ x: run.ax + (run.bx - run.ax) * t, z: run.az + (run.bz - run.az) * t });
  }
  return out;
}
