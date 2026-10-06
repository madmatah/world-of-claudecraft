// Repairing "a corner is tighter than its own road" by narrowing the road,
// everywhere at once.
//
// Fixing those corners by hand is miserable and the reason is arithmetic: the
// road is authored as a handful of breakpoints, the constraint is per SAMPLE,
// and a corner's requirement is nowhere in the number the operator edits. Every
// check the readout runs is cheap, so the tool can simply solve it.
//
// THE ONE FACT THAT MAKES THIS SOUND: `turnRadius` is a property of the
// centerline alone (`mortar_overdrive/spline.ts` derives it from the resampled
// positions and nothing else). Narrowing the road cannot move a corner's
// radius, so the repair converges in ONE pass with no risk of chasing its own
// tail. It is monotone in every other direction too: a narrower road pulls the
// basin shore in with it and shrinks the road's footprint, so it can only help
// the shore-overlap and enclosure checks.
//
// Two things it deliberately does NOT do. It never moves a control point:
// widening a corner changes the shape the operator drew, which is their design
// and not a repair, so where the road's own floor is not enough the corners come
// back by name. And it never touches a circuit no corner constrains: a repair
// button that edits a circuit with nothing wrong is a broken button.
//
// Pure core: DOM-free, deterministic, no clock, no rng.

import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import {
  MORTAR_OVERDRIVE_RADIUS_OVER_WIDTH_WARN,
  type MortarOverdriveCircuitProblem,
  mortarOverdriveCircuitMetrics,
} from '../../sim/mortar_overdrive/circuit_metrics';
import { MORTAR_OVERDRIVE_MIN_HALF_WIDTH } from '../../sim/mortar_overdrive/layout';
import { mortarOverdriveTrack } from '../../sim/mortar_overdrive/spline';

/**
 * What the repair aims for: a hair over the WARNING threshold, not the floor.
 * Solving onto the floor leaves every repaired corner one rounding away from
 * failing again (the whole complaint this exists for), and the warning tier is
 * there because a corner that close to its road is worth avoiding anyway. The
 * three percent is the headroom that absorbs the cell grid and the rounding of
 * the emitted numbers.
 */
const TARGET_RATIO = MORTAR_OVERDRIVE_RADIUS_OVER_WIDTH_WARN * 1.03;

/**
 * Lap fraction per breakpoint the repair may emit. One percent of the lap is
 * about 10 yards on a garden circuit and 11 on a 1100 yard one: fine enough to
 * hug a corner, coarse enough that the table stays a table.
 */
const CELL = 0.01;

/** Widths closer than this in yards are the same width. */
const WIDTH_EPSILON = 0.05;

export interface WidthFixResult {
  widthBands: { s: number; halfWidth: number }[];
  /**
   * The corners still folding their road afterwards. Always the road floor's
   * fault: their radius is under `MORTAR_OVERDRIVE_MIN_HALF_WIDTH`, so no legal road
   * is narrow enough and the CURVE has to open up. Taken from the real readout
   * run over the repaired record, never from a second copy of the rule here.
   */
  remaining: readonly MortarOverdriveCircuitProblem[];
  /** Yards of lap the repair narrowed. Zero means it left the record alone. */
  narrowedYards: number;
}

/**
 * A road profile that clears every corner the road's floor can reach, for this
 * centerline. Only ever NARROWS: the authored width is the ceiling at every
 * fraction, so a repair cannot widen a chicane the operator tightened on
 * purpose.
 */
export function suggestWidthBands(circuit: MortarOverdriveCircuit): WidthFixResult {
  const track = mortarOverdriveTrack(circuit);
  const samples = track.samples;
  const cells = Math.max(4, Math.round(1 / CELL));

  /** What a sample's corner allows, or Infinity on a straight. */
  const neededAt = (index: number): number => {
    const radius = Math.abs(samples[index].turnRadius);
    return Number.isFinite(radius) ? radius / TARGET_RATIO : Number.POSITIVE_INFINITY;
  };

  // Nothing to do unless some corner genuinely asks for less road than the
  // circuit already authors there. This is the guard that keeps the button from
  // touching a clean circuit: without it the rebuild below would re-derive a
  // hand-authored profile into a machine one for no reason at all.
  let constrained = false;
  for (let i = 0; i < samples.length && !constrained; i++) {
    constrained = neededAt(i) < samples[i].halfWidth - WIDTH_EPSILON;
  }
  if (!constrained) {
    return {
      widthBands: circuit.widthBands.map((band) => ({ ...band })),
      remaining: mortarOverdriveCircuitMetrics(circuit).problems.filter(
        (problem) => problem.code === 'corner_folds_road',
      ),
      narrowedYards: 0,
    };
  }

  // The tightest requirement inside each cell of the lap.
  const cellNeed = new Array<number>(cells).fill(Number.POSITIVE_INFINITY);
  for (let i = 0; i < samples.length; i++) {
    const cell = Math.min(cells - 1, Math.floor((samples[i].s / track.length) * cells));
    cellNeed[cell] = Math.min(cellNeed[cell], neededAt(i));
  }

  // A breakpoint takes the smaller of the two cells it borders, and never more
  // road than the circuit authors at that exact fraction. Taking the AUTHORED
  // value at the boundary rather than its minimum over the cell is what keeps
  // the operator's own profile intact away from the corners.
  //
  // Why the interpolation between two of these is safe: for any sample in cell
  // k, both bracketing breakpoints are at or under `cellNeed[k]`, which is at or
  // under that sample's own requirement, and a straight line between two values
  // under a bound stays under it.
  const at = (k: number): number => {
    const fraction = (k % cells) / cells;
    const authored = track.halfWidthAt(fraction * track.length);
    const need = Math.min(cellNeed[(k - 1 + cells) % cells], cellNeed[k % cells]);
    return Math.max(MORTAR_OVERDRIVE_MIN_HALF_WIDTH, Math.min(authored, need));
  };

  const breakpoints: { s: number; halfWidth: number }[] = [];
  for (let k = 0; k < cells; k++) {
    breakpoints.push({ s: Number((k / cells).toFixed(4)), halfWidth: round2(at(k)) });
  }
  breakpoints.push({ s: 1, halfWidth: round2(at(0)) });

  // The authored breakpoints come along too, capped at their OWN fractions.
  // The grid rows alone sample the authored ceiling only at cell boundaries, so
  // a chicane authored inside one cell was erased by the interpolation between
  // two boundaries that never saw it: the repair WIDENED a road the operator
  // tightened on purpose, the one thing the contract above forbids. A row on a
  // boundary is skipped, because the grid row there already caps against the
  // authored table at that exact fraction. Capping at the containing cell's
  // requirement keeps the interpolation argument sound: every row inside cell k
  // stays at or under `cellNeed[k]`.
  for (const band of circuit.widthBands) {
    const scaled = band.s * cells;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) continue;
    const need = cellNeed[Math.min(cells - 1, Math.floor(scaled))];
    breakpoints.push({
      s: band.s,
      halfWidth: round2(Math.max(MORTAR_OVERDRIVE_MIN_HALF_WIDTH, Math.min(band.halfWidth, need))),
    });
  }
  breakpoints.sort((a, b) => a.s - b.s);

  // Drop a breakpoint its two neighbours already explain, so a road that holds
  // one width for half the lap says so once instead of fifty times.
  const widthBands: { s: number; halfWidth: number }[] = [];
  for (let i = 0; i < breakpoints.length; i++) {
    const previous = breakpoints[i - 1];
    const next = breakpoints[i + 1];
    const flat =
      previous &&
      next &&
      Math.abs(previous.halfWidth - breakpoints[i].halfWidth) < WIDTH_EPSILON &&
      Math.abs(next.halfWidth - breakpoints[i].halfWidth) < WIDTH_EPSILON;
    if (!flat) widthBands.push(breakpoints[i]);
  }

  // What the readout says about the result, measured rather than predicted.
  const repaired: MortarOverdriveCircuit = {
    ...circuit,
    id: `${circuit.id}__width_fix`,
    widthBands,
  };
  const repairedTrack = mortarOverdriveTrack(repaired);
  let narrowedYards = 0;
  for (let i = 0; i < samples.length; i++) {
    if (repairedTrack.samples[i].halfWidth < samples[i].halfWidth - WIDTH_EPSILON) {
      narrowedYards += track.step;
    }
  }
  const remaining = mortarOverdriveCircuitMetrics(repaired).problems.filter(
    (problem) => problem.code === 'corner_folds_road',
  );

  return { widthBands, remaining, narrowedYards };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
