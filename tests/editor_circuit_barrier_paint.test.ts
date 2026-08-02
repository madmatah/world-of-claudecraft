// Painting what stands on the containment line.
//
// The rule that costs the most to get wrong is not the painting: it is that a
// circuit authors water if and only if some span of its line is a shore. Two
// things that must agree by hand is how a record ends up authoring a lake
// nothing draws, so the basin follows the paint rather than sitting beside it.

import { describe, expect, it } from 'vitest';
import {
  applyBarrierBands,
  type BarrierBand,
  barrierSpanYards,
  DEFAULT_BARRIER_BANDS,
  paintBarrierSpan,
} from '../src/editor/circuit/barrier_paint_core';
import { FRACTION_SNAP } from '../src/editor/circuit/handles_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersBasin,
} from '../src/sim/content/realm_racers_circuits';
import { rallyBarrierKindAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

const BASIN: RealmRacersBasin = { waterY: -0.55, bankSlope: 0.8, depthMax: 6, wadeYards: 4 };

/** Every lap fraction from `from` to `to`, at the density a real drag lands. */
const stroke = (from: number, to: number, step = FRACTION_SNAP / 2): number[] => {
  const out: number[] = [];
  for (let f = from; f <= to + 1e-9; f += step) out.push(f);
  return out;
};

describe('circuit editor barrier paint: the stroke', () => {
  it('paints only the stretch the pointer visited, leaving the rest shore', () => {
    const bands = paintBarrierSpan(DEFAULT_BARRIER_BANDS, stroke(0.3, 0.4), 'hedge_low');
    expect(bands[0]).toEqual({ s: 0, kind: 'shore' });
    // Two breakpoints for one painted stretch: where it starts and where it
    // stops. A table read stepwise needs nothing else.
    expect(bands).toHaveLength(3);
    expect(bands[1].kind).toBe('hedge_low');
    expect(bands[1].s).toBeCloseTo(0.3, 2);
    expect(bands[2].kind).toBe('shore');
    expect(bands[2].s).toBeCloseTo(0.405, 2);
  });

  it('fills the cells a fast pointer skipped between two samples', () => {
    // A pointer emits samples, not a path. Painting only the cells it landed in
    // leaves a comb of separate spans with untouched gaps between them.
    const bands = paintBarrierSpan(DEFAULT_BARRIER_BANDS, [0.3, 0.36, 0.42], 'wall_low');
    const kinds = bands.map((band) => band.kind);
    expect(kinds).toEqual(['shore', 'wall_low', 'shore']);
    expect(bands[1].s).toBeCloseTo(0.3, 2);
    // The span reaches the last cell the pointer landed in rather than stopping
    // at 0.36, which is where a comb of separate spans would have left it.
    expect(bands[2].s).toBe(0.42);
  });

  it('takes the short way round when a stroke crosses the start line', () => {
    const bands = paintBarrierSpan(DEFAULT_BARRIER_BANDS, [0.96, 0.03], 'hedge_tall');
    // The span wraps, so the table opens ON the painted kind and closes back to
    // shore twice round: once after the wrap and once where it started.
    expect(bands[0].kind).toBe('hedge_tall');
    expect(bands.some((band) => band.kind === 'shore')).toBe(true);
    expect(bands.filter((band) => band.kind === 'hedge_tall')).toHaveLength(2);
    // Never the LONG way: the ninety percent of lap between 0.03 and 0.96 is
    // untouched.
    const spans = barrierSpanYards(bands, 1000);
    expect(spans.hedge_tall).toBeLessThan(120);
    expect(spans.shore).toBeGreaterThan(880);
  });

  it('re-applies to the table as it stood, so a live drag extends rather than dents', () => {
    // Every pointermove re-applies the WHOLE stroke to the pre-stroke table,
    // which is the contract the two numeric brushes take for the same reason.
    const first = paintBarrierSpan(DEFAULT_BARRIER_BANDS, stroke(0.2, 0.25), 'hedge_low');
    const longer = paintBarrierSpan(DEFAULT_BARRIER_BANDS, stroke(0.2, 0.4), 'hedge_low');
    expect(barrierSpanYards(longer, 1000).hedge_low).toBeGreaterThan(
      barrierSpanYards(first, 1000).hedge_low,
    );
    // ...and re-painting shore over it puts the table back exactly as it was.
    const undone = paintBarrierSpan(longer, stroke(0.19, 0.41), 'shore');
    expect(undone).toEqual([{ s: 0, kind: 'shore' }]);
  });

  it('merges a stroke that meets a span of the same kind', () => {
    const first = paintBarrierSpan(DEFAULT_BARRIER_BANDS, stroke(0.2, 0.3), 'hedge_low');
    const merged = paintBarrierSpan(first, stroke(0.3, 0.4), 'hedge_low');
    expect(merged.map((band) => band.kind)).toEqual(['shore', 'hedge_low', 'shore']);
    expect(merged[2].s).toBeCloseTo(0.405, 2);
  });

  it('changes nothing at all when the stroke touched no cell', () => {
    const bands: BarrierBand[] = [
      { s: 0, kind: 'shore' },
      { s: 0.5, kind: 'wall_low' },
    ];
    expect(paintBarrierSpan(bands, [], 'hedge_low')).toEqual(bands);
    expect(paintBarrierSpan(bands, [Number.NaN], 'hedge_low')).toEqual(bands);
  });

  it('derives a table the SPLINE reads back as what was painted', () => {
    // The decisive one: the tool and the game have to agree about which yards
    // of lap carry the hedge, and only the spline's own stepwise reader says.
    const bands = paintBarrierSpan(DEFAULT_BARRIER_BANDS, stroke(0.25, 0.45), 'hedge_low');
    const circuit = { ...GARDEN, id: 'barrier_paint_readback', barrierBands: bands };
    const track = realmRacersTrack(circuit);
    let hedged = 0;
    for (const sample of track.samples) {
      const fraction = sample.s / track.length;
      const kind = rallyBarrierKindAt(circuit, sample.s);
      if (fraction > 0.26 && fraction < 0.44) {
        expect(kind, `at ${fraction.toFixed(3)}`).toBe('hedge_low');
        hedged++;
      } else if (fraction < 0.24 || fraction > 0.47) {
        expect(kind, `at ${fraction.toFixed(3)}`).toBe('shore');
      }
    }
    expect(hedged).toBeGreaterThan(50);
  });
});

describe('circuit editor barrier paint: what the readout counts', () => {
  it('accounts for every yard of lap, and only once', () => {
    // The panel reads these numbers back to the operator, so they have to be a
    // partition of the lap rather than four independent tallies.
    expect(barrierSpanYards(DEFAULT_BARRIER_BANDS, 1000)).toEqual({
      shore: 1000,
      hedge_low: 0,
      hedge_tall: 0,
      wall_low: 0,
    });
    const mixed: BarrierBand[] = [
      { s: 0, kind: 'shore' },
      { s: 0.25, kind: 'hedge_low' },
      { s: 0.5, kind: 'wall_low' },
      { s: 0.75, kind: 'hedge_tall' },
    ];
    expect(barrierSpanYards(mixed, 1000)).toEqual({
      shore: 250,
      hedge_low: 250,
      hedge_tall: 250,
      wall_low: 250,
    });
    // A wrapping span is counted once, on the far side of the start line too.
    const wrapping: BarrierBand[] = [
      { s: 0, kind: 'hedge_low' },
      { s: 0.1, kind: 'shore' },
      { s: 0.9, kind: 'hedge_low' },
    ];
    const spans = barrierSpanYards(wrapping, 1000);
    expect(spans.hedge_low).toBeCloseTo(200, 6);
    expect(spans.shore).toBeCloseTo(800, 6);
  });
});

describe('circuit editor barrier paint: the water follows the paint', () => {
  it('drops the basin when the last shore span is painted away', () => {
    const dry = applyBarrierBands(GARDEN, [{ s: 0, kind: 'hedge_tall' }], BASIN);
    expect(dry.basin).toBeUndefined();
    expect(dry.barrierBands).toEqual([{ s: 0, kind: 'hedge_tall' }]);
  });

  it('restores the circuit OWN basin when a shore span is painted back', () => {
    const dry = applyBarrierBands(GARDEN, [{ s: 0, kind: 'wall_low' }], BASIN);
    const wet = applyBarrierBands(
      dry,
      [
        { s: 0, kind: 'wall_low' },
        { s: 0.5, kind: 'shore' },
      ],
      BASIN,
    );
    // The fallback is what a circuit that never had water gets; one that did
    // keeps its own numbers, which is why the page hands back the last basin it
    // saw rather than a constant.
    expect(wet.basin).toEqual(BASIN);
    const bespoke = applyBarrierBands({ ...dry, basin: undefined }, [{ s: 0, kind: 'shore' }], {
      waterY: -1,
      bankSlope: 0.5,
      depthMax: 4,
      wadeYards: 2,
    });
    expect(bespoke.basin).toEqual({ waterY: -1, bankSlope: 0.5, depthMax: 4, wadeYards: 2 });
  });

  it('drops the table entirely when everything came back to shore', () => {
    // A one-row all-shore table means exactly what no table means, and a
    // circuit that authors nothing should export in the default shape.
    const back = applyBarrierBands(GARDEN, [{ s: 0, kind: 'shore' }], BASIN);
    expect(back.barrierBands).toBeUndefined();
    expect(back.basin).toEqual(GARDEN.basin);
  });

  it('never leaves a record the metrics would refuse', () => {
    // Every reachable combination of paint and basin, checked against the rule
    // the game holds records to rather than against this module's own opinion.
    for (const bands of [
      [{ s: 0, kind: 'shore' }],
      [
        { s: 0, kind: 'shore' },
        { s: 0.4, kind: 'hedge_low' },
      ],
      [{ s: 0, kind: 'hedge_low' }],
      [
        { s: 0, kind: 'wall_low' },
        { s: 0.6, kind: 'hedge_tall' },
      ],
    ] as BarrierBand[][]) {
      const next = applyBarrierBands(GARDEN, bands, BASIN);
      const anyShore = bands.some((band) => band.kind === 'shore');
      expect(Boolean(next.basin), JSON.stringify(bands)).toBe(anyShore);
    }
  });
});
