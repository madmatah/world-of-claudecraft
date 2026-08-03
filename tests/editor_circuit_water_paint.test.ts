// Painting where the shore line carries water.
//
// The rule that costs the most to get wrong is not the painting: it is that a
// circuit authors a basin if and only if some span of its shore is water. Two
// things that must agree by hand is how a record ends up authoring a lake
// nothing draws, so the basin follows the paint rather than sitting beside it.

import { describe, expect, it } from 'vitest';
import { FRACTION_SNAP } from '../src/editor/circuit/handles_core';
import {
  applyWaterBands,
  DEFAULT_WATER_BANDS,
  paintWaterSpan,
  type WaterBand,
  waterSpanYards,
} from '../src/editor/circuit/water_paint_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersBasin,
} from '../src/sim/content/realm_racers_circuits';
import { rallyWaterKindAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

const BASIN: RealmRacersBasin = { waterY: -0.55, bankSlope: 0.8, depthMax: 6, wadeYards: 4 };

/** Every lap fraction from `from` to `to`, at the density a real drag lands. */
const stroke = (from: number, to: number, step = FRACTION_SNAP / 2): number[] => {
  const out: number[] = [];
  for (let f = from; f <= to + 1e-9; f += step) out.push(f);
  return out;
};

describe('circuit editor water paint: the stroke', () => {
  it('paints only the stretch the pointer visited, leaving the rest water', () => {
    const bands = paintWaterSpan(DEFAULT_WATER_BANDS, stroke(0.3, 0.4), 'dry');
    expect(bands[0]).toEqual({ s: 0, kind: 'water' });
    // Two breakpoints for one painted stretch: where it starts and where it
    // stops. A table read stepwise needs nothing else.
    expect(bands).toHaveLength(3);
    expect(bands[1].kind).toBe('dry');
    expect(bands[1].s).toBeCloseTo(0.3, 2);
    expect(bands[2].kind).toBe('water');
    expect(bands[2].s).toBeCloseTo(0.405, 2);
  });

  it('fills the cells a fast pointer skipped between two samples', () => {
    // A pointer emits samples, not a path. Painting only the cells it landed in
    // leaves a comb of separate spans with untouched gaps between them.
    const bands = paintWaterSpan(DEFAULT_WATER_BANDS, [0.3, 0.36, 0.42], 'dry');
    const kinds = bands.map((band) => band.kind);
    expect(kinds).toEqual(['water', 'dry', 'water']);
    expect(bands[1].s).toBeCloseTo(0.3, 2);
    // The span reaches the last cell the pointer landed in rather than stopping
    // at 0.36, which is where a comb of separate spans would have left it.
    expect(bands[2].s).toBe(0.42);
  });

  it('takes the short way round when a stroke crosses the start line', () => {
    const bands = paintWaterSpan(DEFAULT_WATER_BANDS, [0.96, 0.03], 'dry');
    // The span wraps, so the table opens ON the painted kind and closes back to
    // water twice round: once after the wrap and once where it started.
    expect(bands[0].kind).toBe('dry');
    expect(bands.some((band) => band.kind === 'water')).toBe(true);
    expect(bands.filter((band) => band.kind === 'dry')).toHaveLength(2);
    // Never the LONG way: the ninety percent of lap between 0.03 and 0.96 is
    // untouched.
    const spans = waterSpanYards(bands, 1000);
    expect(spans.dry).toBeLessThan(120);
    expect(spans.water).toBeGreaterThan(880);
  });

  it('re-applies to the table as it stood, so a live drag extends rather than dents', () => {
    // Every pointermove re-applies the WHOLE stroke to the pre-stroke table,
    // which is the contract the two numeric brushes take for the same reason.
    const first = paintWaterSpan(DEFAULT_WATER_BANDS, stroke(0.2, 0.25), 'dry');
    const longer = paintWaterSpan(DEFAULT_WATER_BANDS, stroke(0.2, 0.4), 'dry');
    expect(waterSpanYards(longer, 1000).dry).toBeGreaterThan(waterSpanYards(first, 1000).dry);
    // ...and re-painting shore over it puts the table back exactly as it was.
    const undone = paintWaterSpan(longer, stroke(0.19, 0.41), 'water');
    expect(undone).toEqual([{ s: 0, kind: 'water' }]);
  });

  it('merges a stroke that meets a span of the same kind', () => {
    const first = paintWaterSpan(DEFAULT_WATER_BANDS, stroke(0.2, 0.3), 'dry');
    const merged = paintWaterSpan(first, stroke(0.3, 0.4), 'dry');
    expect(merged.map((band) => band.kind)).toEqual(['water', 'dry', 'water']);
    expect(merged[2].s).toBeCloseTo(0.405, 2);
  });

  it('changes nothing at all when the stroke touched no cell', () => {
    const bands: WaterBand[] = [
      { s: 0, kind: 'water' },
      { s: 0.5, kind: 'dry' },
    ];
    expect(paintWaterSpan(bands, [], 'dry')).toEqual(bands);
    expect(paintWaterSpan(bands, [Number.NaN], 'dry')).toEqual(bands);
  });

  it('derives a table the SPLINE reads back as what was painted', () => {
    // The decisive one: the tool and the game have to agree about which yards
    // of lap carry a pond, and only the spline's own stepwise reader says.
    const bands = paintWaterSpan(DEFAULT_WATER_BANDS, stroke(0.25, 0.45), 'dry');
    const circuit = { ...GARDEN, id: 'water_paint_readback', waterBands: bands };
    const track = realmRacersTrack(circuit);
    let dried = 0;
    for (const sample of track.samples) {
      const fraction = sample.s / track.length;
      const kind = rallyWaterKindAt(circuit, sample.s);
      if (fraction > 0.26 && fraction < 0.44) {
        expect(kind, `at ${fraction.toFixed(3)}`).toBe('dry');
        dried++;
      } else if (fraction < 0.24 || fraction > 0.47) {
        expect(kind, `at ${fraction.toFixed(3)}`).toBe('water');
      }
    }
    expect(dried).toBeGreaterThan(50);
  });
});

describe('circuit editor water paint: what the readout counts', () => {
  it('accounts for every yard of lap, and only once', () => {
    // The panel reads these numbers back to the operator, so they have to be a
    // partition of the lap rather than two independent tallies.
    expect(waterSpanYards(DEFAULT_WATER_BANDS, 1000)).toEqual({ water: 1000, dry: 0 });
    const mixed: WaterBand[] = [
      { s: 0, kind: 'water' },
      { s: 0.25, kind: 'dry' },
      { s: 0.75, kind: 'water' },
    ];
    expect(waterSpanYards(mixed, 1000)).toEqual({ water: 500, dry: 500 });
    // A wrapping span is counted once, on the far side of the start line too.
    const wrapping: WaterBand[] = [
      { s: 0, kind: 'dry' },
      { s: 0.1, kind: 'water' },
      { s: 0.9, kind: 'dry' },
    ];
    const spans = waterSpanYards(wrapping, 1000);
    expect(spans.dry).toBeCloseTo(200, 6);
    expect(spans.water).toBeCloseTo(800, 6);
  });
});

describe('circuit editor water paint: the water follows the paint', () => {
  it('drops the basin when the last pond is painted away', () => {
    const dry = applyWaterBands(GARDEN, [{ s: 0, kind: 'dry' }], BASIN);
    expect(dry.basin).toBeUndefined();
    expect(dry.waterBands).toEqual([{ s: 0, kind: 'dry' }]);
  });

  it('restores the circuit OWN basin when a pond is painted back', () => {
    const dry = applyWaterBands(GARDEN, [{ s: 0, kind: 'dry' }], BASIN);
    const wet = applyWaterBands(
      dry,
      [
        { s: 0, kind: 'dry' },
        { s: 0.5, kind: 'water' },
      ],
      BASIN,
    );
    // The fallback is what a circuit that never had water gets; one that did
    // keeps its own numbers, which is why the page hands back the last basin it
    // saw rather than a constant.
    expect(wet.basin).toEqual(BASIN);
    const bespoke = applyWaterBands({ ...dry, basin: undefined }, [{ s: 0, kind: 'water' }], {
      waterY: -1,
      bankSlope: 0.5,
      depthMax: 4,
      wadeYards: 2,
    });
    expect(bespoke.basin).toEqual({ waterY: -1, bankSlope: 0.5, depthMax: 4, wadeYards: 2 });
  });

  it('drops the table entirely when everything came back to water', () => {
    // A one-row all-water table means exactly what no table means, and a
    // circuit that authors nothing should export in the default shape.
    const back = applyWaterBands(GARDEN, [{ s: 0, kind: 'water' }], BASIN);
    expect(back.waterBands).toBeUndefined();
    expect(back.basin).toEqual(GARDEN.basin);
  });

  it('never leaves a record the metrics would refuse', () => {
    // Every reachable combination of paint and basin, checked against the rule
    // the game holds records to rather than against this module's own opinion.
    for (const bands of [
      [{ s: 0, kind: 'water' }],
      [
        { s: 0, kind: 'water' },
        { s: 0.4, kind: 'dry' },
      ],
      [{ s: 0, kind: 'dry' }],
      [
        { s: 0, kind: 'dry' },
        { s: 0.6, kind: 'water' },
      ],
    ] as WaterBand[][]) {
      const next = applyWaterBands(GARDEN, bands, BASIN);
      const anyWater = bands.some((band) => band.kind === 'water');
      expect(Boolean(next.basin), JSON.stringify(bands)).toBe(anyWater);
    }
  });
});
