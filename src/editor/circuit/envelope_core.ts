// What enclosure fits a road: the perimeter wall around it and the collision
// region around that, derived from the road's measured footprint.
//
// This is a CONVENIENCE, not a rule. The rules (road inside the wall, wall
// inside the region, region inside the band and inside the lane's depth budget)
// live in `src/sim/mortar_overdrive/circuit_metrics.ts`, because the game depends on
// them; what this module owns is only the question the operator would otherwise
// answer by hand every time they redraw: given a road this big, what numbers
// should the two boxes carry?
//
// It clamps to the same limits the metrics core checks, so a suggestion is never
// one the readout would immediately reject. When a road is too big for the band
// the suggestion is clamped rather than stretched, and the readout says so: the
// tool must not quietly hand back an envelope that cuts the circuit off.
//
// Pure core: DOM-free, deterministic, no clock, no rng.

import type {
  MortarOverdriveCircuit,
  MortarOverdrivePerimeter,
} from '../../sim/content/mortar_overdrive';
import {
  MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
  MORTAR_OVERDRIVE_ORIGIN,
  type MortarOverdrivePoint,
} from '../../sim/mortar_overdrive/layout';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveTrack,
} from '../../sim/mortar_overdrive/spline';
import { fitStrokeToControlPoints } from './stroke_fit_core';

/**
 * Lawn between the garden edge and the wrought-iron wall, yards. Taken from the
 * garden circuit's own proportions (a 99 yd road inside a 118 yd wall), because
 * the wall reads as the far side of a garden rather than as a fence around the
 * tarmac.
 */
const WALL_MARGIN = 20;

/** Whatever else, the region has to be strictly wider than the wall, so the
 *  ceiling a WALL may reach is one yard under the region's own. */
const REGION_OVER_PERIMETER = 1;

/** The widest and deepest a wall may be: the instance volume's ceiling, less the
 *  yard that keeps the wall strictly inside it. */
export const MAX_PERIMETER_HALF_X = MORTAR_OVERDRIVE_MAX_REGION_HALF_X - REGION_OVER_PERIMETER;
export const MAX_PERIMETER_HALF_Z = MORTAR_OVERDRIVE_MAX_REGION_HALF_Z - REGION_OVER_PERIMETER;

export interface EnvelopeSuggestion {
  perimeter: MortarOverdrivePerimeter;
  /**
   * Which ceiling clamped the suggestion, if any. `band` is the x window between
   * the neighbouring instance bands; `lane` is the depth budget between two
   * copies of a circuit. A clamped suggestion may leave the road outside its own
   * wall, which the readout then reports: that is the honest answer, and the fix
   * is a smaller circuit, not a bigger box.
   */
  clampedBy: readonly ('band' | 'lane')[];
}

/**
 * The WALL for a road of this measured footprint (`roadHalfX` / `roadHalfZ` from
 * the metrics readout: out to the garden edge, both sides, from the circuit's
 * origin).
 *
 * It used to propose the collision region too, out of a constant margin past the
 * wall, and that margin is exactly why the region stopped being authored at all:
 * a number nobody chooses is not a decision, and a second box on the plan cost
 * an author more than it ever bought. Every circuit carries the region's
 * ceiling now, so the only box a fit has an opinion about is this one.
 */
export function suggestEnvelope(
  roadHalfX: number,
  roadHalfZ: number,
  existing?: MortarOverdrivePerimeter,
): EnvelopeSuggestion {
  const clampedBy: ('band' | 'lane')[] = [];

  let halfX = Math.ceil(roadHalfX + WALL_MARGIN);
  if (halfX > MAX_PERIMETER_HALF_X) {
    halfX = MAX_PERIMETER_HALF_X;
    clampedBy.push('band');
  }
  let halfZ = Math.ceil(roadHalfZ + WALL_MARGIN);
  if (halfZ > MAX_PERIMETER_HALF_Z) {
    halfZ = MAX_PERIMETER_HALF_Z;
    clampedBy.push('lane');
  }

  return {
    perimeter: {
      // The wall keeps whatever thickness and height the circuit already
      // authored: those are dressing, and nothing here has an opinion on them.
      halfThickness: existing?.halfThickness ?? 0.4,
      height: existing?.height ?? 2.2,
      halfX,
      halfZ,
    },
    clampedBy,
  };
}

/**
 * The record with its instance volume at the ceiling.
 *
 * The volume has exactly ONE legal value since packet 28, so this is a
 * migration rather than a decision: a draft on disk or in the autosave from
 * before that rule still carries a smaller one, and with the two fields gone
 * from every panel there is no way left to type it up. Applied on LOAD and again
 * on a fit, which are the two doors a record comes through.
 *
 * Returns the same object when there is nothing to do, so a load that changes
 * nothing cannot look like an edit to the undo stack.
 */
export function circuitWithCeilingVolume(circuit: MortarOverdriveCircuit): MortarOverdriveCircuit {
  if (
    circuit.regionHalfX === MORTAR_OVERDRIVE_MAX_REGION_HALF_X &&
    circuit.regionHalfZ === MORTAR_OVERDRIVE_MAX_REGION_HALF_Z
  ) {
    return circuit;
  }
  return {
    ...circuit,
    regionHalfX: MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
    regionHalfZ: MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
  };
}

/**
 * The record a `Fit wall` leaves behind, plus what the fit had to say.
 *
 * One function rather than four lines in the page, because it carries a decision
 * the page was holding alone: a fit writes the ceiling volume as well as the
 * wall, and that pairing is the only migration path a legacy draft has through
 * the tool's own buttons.
 */
export function fittedCircuit(
  circuit: MortarOverdriveCircuit,
  roadHalfX: number,
  roadHalfZ: number,
): { circuit: MortarOverdriveCircuit; suggestion: EnvelopeSuggestion } {
  const suggestion = suggestEnvelope(roadHalfX, roadHalfZ, circuit.perimeter);
  return {
    circuit: circuitWithCeilingVolume({ ...circuit, perimeter: suggestion.perimeter }),
    suggestion,
  };
}

/**
 * Lawn between the garden edge and the water, yards.
 *
 * A little more than the wall's own margin, because what stands between a road
 * and a shore is the whole of a circuit's dressing: benches, a barrier run, the
 * clumps the shore itself is planted with. At the wall's 20 the water lapped the
 * run-off on the garden circuit's hairpin.
 */
const GROUND_MARGIN = 26;

/** How far inside the offset a point may sit and still be read as ON it rather
 *  than in a fold, yards. It absorbs the centerline's own one-yard resample; a
 *  fold is deeper than this by a wide margin, since it is as deep as the corner
 *  is tight. */
const FOLD_TOLERANCE = 0.5;

/**
 * An outline around the road, for `Fit ground` to propose.
 *
 * The road's own OUTER offset curve: every centerline sample pushed out past the
 * garden edge, which gives an island holding the road, its infield and a margin
 * of lawn either side. It is a proposal in exactly the sense `suggestEnvelope`
 * is one, and the operator drags it afterwards.
 *
 * The side is decided by AREA rather than by winding, and that is not
 * defensiveness for its own sake: the inner offset of a loop folds through
 * itself at any corner tighter than the offset, and picking the bigger of the
 * two rings is the one test that cannot be got the wrong way round by a circuit
 * drawn clockwise.
 *
 * The ring then goes through the CIRCUIT's own stroke fit, so a proposed outline
 * is the same kind of object a drawn one is: a handful of draggable control
 * points, not a thousand samples nobody can edit.
 */
export function suggestGroundOutline(circuit: MortarOverdriveCircuit): MortarOverdrivePoint[] {
  const samples = mortarOverdriveTrack(circuit).samples;
  const sides: MortarOverdrivePoint[][] = [[], []];
  for (const sample of samples) {
    const offset = mortarOverdriveGardenEdgeOffsetAt(circuit, sample.s) + GROUND_MARGIN;
    const x = sample.x - MORTAR_OVERDRIVE_ORIGIN.x;
    const z = sample.z - MORTAR_OVERDRIVE_ORIGIN.z;
    sides[0].push({ x: x - sample.tz * offset, z: z + sample.tx * offset });
    sides[1].push({ x: x + sample.tz * offset, z: z - sample.tx * offset });
  }
  const area = (ring: readonly MortarOverdrivePoint[]): number => {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      sum += a.x * b.z - b.x * a.z;
    }
    return Math.abs(sum) / 2;
  };
  const outer = area(sides[0]) >= area(sides[1]) ? sides[0] : sides[1];
  // Then the FOLDS are cut out, and this is the half without which the repair
  // hands back a shape nobody can use: an offset curve crosses itself at every
  // corner tighter than the offset, and the garden circuit's hairpin is tighter
  // than 26 yards. A self-intersecting ring is not a cosmetic problem, because
  // point-in-polygon is even-odd: the loop reads as a HOLE, so the meadow, the
  // beds and the scatters all get punched out over ground that is drawn as lawn.
  //
  // A point is in a fold exactly when it is nearer the road than the offset it
  // was built at, which the real projection answers: no geometry of its own, and
  // it drops a point that strayed within the margin of ANOTHER stretch too,
  // which is the same defect one bend further round.
  const track = mortarOverdriveTrack(circuit);
  const kept = outer.filter((point) => {
    const projection = track.project(
      point.x + MORTAR_OVERDRIVE_ORIGIN.x,
      point.z + MORTAR_OVERDRIVE_ORIGIN.z,
    );
    const offset = mortarOverdriveGardenEdgeOffsetAt(circuit, projection.s) + GROUND_MARGIN;
    return Math.abs(projection.lateral) >= offset - FOLD_TOLERANCE;
  });
  return fitStrokeToControlPoints(kept.length >= 8 ? kept : outer);
}
