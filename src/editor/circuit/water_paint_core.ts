// Painting where the WATER goes: the stepwise `waterBands` table, and the one
// rule that has to hold with it (a circuit authors a basin if and only if some
// span of its shore line carries water).
//
// It painted BARRIERS for one shipped revision, when what stood on the derived
// containment line (water, two hedges, a kneewall) was what stopped a racer
// cutting the infield. Track limits are a referee now
// (`src/sim/realm_racers_track_limits.ts`), so nothing on that curve stops
// anyone and the only decision left on it is decorative: pond, or lawn.
//
// It is not `paintSpan` with a different value type. That one paints a NUMBER
// into a piecewise-linear table and its whole difficulty is the transition: a
// plateau with smoothstep shoulders, because a band table read linearly has no
// local edit without them. A kind is not interpolable, so there is no shoulder
// to shape and no ramp to size: the edit is exactly "these cells of lap are dry
// now", and the only work is collapsing the result back into the fewest
// breakpoints that say so.
//
// Pure core: DOM-free, deterministic, no clock, no rng. Every function returns
// a NEW record or list; nothing here mutates its input, so the page's undo
// stack is just the previous value.

import type {
  RallyWaterKind,
  RealmRacersBasin,
  RealmRacersCircuit,
} from '../../sim/content/realm_racers_circuits';
import { FRACTION_SNAP } from './handles_core';

export interface WaterBand {
  s: number;
  kind: RallyWaterKind;
}

/** The table a circuit with no `waterBands` behaves as, spelled out. */
export const DEFAULT_WATER_BANDS: readonly WaterBand[] = [{ s: 0, kind: 'water' }];

/**
 * Paints a kind over the stretch of lap a STROKE touched, leaving the rest of
 * the table alone.
 *
 * `fractions` is every lap fraction the pointer visited and `bands` is the
 * table as it stood BEFORE the stroke began, the same contract `paintSpan`
 * takes and for the same reason: re-applying the whole stroke to the original
 * table is what lets a live drag extend without denting against its own earlier
 * points. The cells BETWEEN two consecutive samples were dragged over, so they
 * are painted too, the short way round the lap.
 */
export function paintWaterSpan(
  bands: readonly WaterBand[],
  fractions: readonly number[],
  kind: RallyWaterKind,
  snap = FRACTION_SNAP,
): WaterBand[] {
  const cells = Math.max(4, Math.round(1 / snap));
  const wrap = (cell: number): number => ((cell % cells) + cells) % cells;
  const visited = fractions
    .filter((fraction) => Number.isFinite(fraction))
    .map((fraction) => wrap(Math.floor((((fraction % 1) + 1) % 1) * cells)));
  const painted = new Set<number>(visited);
  for (let i = 1; i < visited.length; i++) {
    const from = visited[i - 1];
    const to = visited[i];
    const forward = wrap(to - from);
    const step = forward <= cells - forward ? 1 : -1;
    for (let cell = from; cell !== to; cell = wrap(cell + step)) painted.add(cell);
  }
  if (painted.size === 0) return bands.map((band) => ({ ...band }));

  const before = readWaterCells(bands, cells);
  const after = before.map((was, cell) => (painted.has(cell) ? kind : was));
  return bandsFromCells(after);
}

/** The kind in force in each snapped cell of lap, read the way the spline reads
 *  the table: the LAST entry at or before the cell owns it, wrapping. */
function readWaterCells(bands: readonly WaterBand[], cells: number): RallyWaterKind[] {
  const table = bands.length > 0 ? bands : DEFAULT_WATER_BANDS;
  const out: RallyWaterKind[] = [];
  for (let cell = 0; cell < cells; cell++) {
    const fraction = cell / cells;
    let kind = table[table.length - 1].kind;
    for (let i = table.length - 1; i >= 0; i--) {
      if (fraction >= table[i].s) {
        kind = table[i].kind;
        break;
      }
    }
    out.push(kind);
  }
  return out;
}

/**
 * The fewest breakpoints that describe a run of cells: one at every change, and
 * one at s = 0 whatever happens there, because that is the record's own rule
 * (the first entry opens the table and the last one wraps back round to it).
 */
function bandsFromCells(kinds: readonly RallyWaterKind[]): WaterBand[] {
  const cells = kinds.length;
  const out: WaterBand[] = [{ s: 0, kind: kinds[0] }];
  for (let cell = 1; cell < cells; cell++) {
    if (kinds[cell] === kinds[cell - 1]) continue;
    out.push({ s: Number((cell / cells).toFixed(6)), kind: kinds[cell] });
  }
  return out;
}

/**
 * The record a painted table implies, basin and all.
 *
 * The basin is not a second thing to keep in step by hand: it is REQUIRED by a
 * water span and meaningless without one, so painting the last pond away drops
 * it and painting one back restores it. `fallbackBasin` is what a circuit that
 * has never had one gets; a circuit that had one keeps its own numbers, which
 * is why the page hands back the last basin it saw rather than a constant.
 *
 * A table that came back to all-water is dropped entirely rather than kept as
 * a one-row table meaning the same thing, so a circuit that authors nothing
 * exports in the default shape.
 */
export function applyWaterBands(
  circuit: RealmRacersCircuit,
  bands: readonly WaterBand[],
  fallbackBasin: RealmRacersBasin,
): RealmRacersCircuit {
  const table = bands.length > 0 ? bands : DEFAULT_WATER_BANDS;
  const anyWater = table.some((band) => band.kind === 'water');
  const allWater = table.every((band) => band.kind === 'water');
  return {
    ...circuit,
    waterBands: allWater ? undefined : table.map((band) => ({ ...band })),
    basin: anyWater ? (circuit.basin ?? fallbackBasin) : undefined,
  };
}

/** Yards of lap each kind holds, for the readout that says what a stroke did. */
export function waterSpanYards(
  bands: readonly WaterBand[],
  lapLength: number,
  snap = FRACTION_SNAP,
): Record<RallyWaterKind, number> {
  const cells = Math.max(4, Math.round(1 / snap));
  const kinds = readWaterCells(bands, cells);
  const out: Record<RallyWaterKind, number> = { water: 0, dry: 0 };
  for (const kind of kinds) out[kind] += lapLength / cells;
  return out;
}
