// The editing rules for the record's ordered lists: the control-point ring and
// the two band tables. What these tests hold is the REFUSAL side: an edit that
// would leave the record unauthorable has to be declined by the core, because
// the alternative is the operator finding out from a readout, or worse from the
// game.
//
// The recovery anchors used to be edited here too. They are derived from the
// curve now, so there is nothing left to refuse; `realm_racers_circuits.test.ts`
// holds the derivation instead.

import { describe, expect, it } from 'vitest';
import {
  type CircuitBand,
  deleteControlPoint,
  fromWidthBands,
  hitTestControlPoint,
  insertControlPoint,
  MIN_CONTROL_POINTS,
  moveControlPoint,
  nearestSegment,
  paintSpan,
  toWidthBands,
} from '../src/editor/circuit/handles_core';
import type { RallyPoint } from '../src/sim/realm_racers_layout';

/** A square ring of `n` points, so every index is somewhere obvious. */
function ring(n: number, radius = 100): RallyPoint[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (i / n) * Math.PI * 2;
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  });
}

const WIDTH_BRUSH = { min: 8, max: 40 };

describe('circuit editor: the control-point ring', () => {
  it('picks the nearest handle inside the radius, and nothing outside it', () => {
    const points = ring(10);
    expect(hitTestControlPoint(points, points[3].x + 1, points[3].z - 1, 5)).toBe(3);
    expect(hitTestControlPoint(points, 0, 0, 5)).toBe(-1);
  });

  it('prefers the nearer of two overlapping handles', () => {
    const points: RallyPoint[] = [
      { x: 0, z: 0 },
      { x: 3, z: 0 },
      { x: 50, z: 50 },
      { x: -50, z: 50 },
    ];
    expect(hitTestControlPoint(points, 2.6, 0, 10)).toBe(1);
    expect(hitTestControlPoint(points, 0.4, 0, 10)).toBe(0);
  });

  it('finds the segment a click on the line belongs to, and where on it', () => {
    const points: RallyPoint[] = [
      { x: 0, z: 0 },
      { x: 100, z: 0 },
      { x: 100, z: 100 },
      { x: 0, z: 100 },
    ];
    const hit = nearestSegment(points, 40, 3);
    expect(hit.index).toBe(0);
    expect(hit.distance).toBeCloseTo(3);
    expect(hit.point).toEqual({ x: 40, z: 0 });
    // The closing segment is a segment too: the ring wraps.
    expect(nearestSegment(points, -2, 50).index).toBe(3);
  });

  it('inserts INTO the segment that was clicked, never at the end', () => {
    const points = ring(10);
    const inserted = insertControlPoint(points, 4, { x: 1, z: 2 });
    expect(inserted).toHaveLength(11);
    expect(inserted[5]).toEqual({ x: 1, z: 2 });
    expect(inserted[4]).toEqual(points[4]);
    expect(inserted[6]).toEqual(points[5]);
  });

  it('moves one handle and leaves every other alone', () => {
    const points = ring(10);
    const moved = moveControlPoint(points, 2, { x: 7, z: 8 });
    expect(moved[2]).toEqual({ x: 7, z: 8 });
    expect(moved.filter((_, i) => i !== 2)).toEqual(points.filter((_, i) => i !== 2));
    // Nothing mutates its input: the page's undo stack is the previous value.
    expect(points[2]).not.toEqual({ x: 7, z: 8 });
  });

  it('refuses to delete below the floor a closed loop needs', () => {
    const atFloor = ring(MIN_CONTROL_POINTS);
    expect(deleteControlPoint(atFloor, 0)).toEqual(atFloor);
    const above = ring(MIN_CONTROL_POINTS + 1);
    expect(deleteControlPoint(above, 0)).toHaveLength(MIN_CONTROL_POINTS);
  });
});

describe('circuit editor: painting a band table', () => {
  const flat: CircuitBand[] = [
    { s: 0, value: 10 },
    { s: 1, value: 10 },
  ];

  /** The table read the way the spline reads it, sampled all the way round. */
  const profile = (bands: readonly CircuitBand[], steps = 400): number[] =>
    Array.from({ length: steps }, (_, i) => {
      const f = i / steps;
      for (let k = 1; k < bands.length; k++) {
        const a = bands[k - 1];
        const b = bands[k];
        if (f > b.s) continue;
        const span = b.s - a.s;
        const t = span <= 0 ? 0 : (f - a.s) / span;
        return a.value + (b.value - a.value) * t;
      }
      return bands[bands.length - 1].value;
    });

  it('keeps a stroke LOCAL, which is the whole reason it takes a span', () => {
    // The defect this replaces: a band table is read piecewise linearly, so
    // setting one breakpoint at 30 percent of the lap re-sloped the road all
    // the way round it. 452 of a 454 yard lap came back changed by one click.
    const painted = paintSpan(flat, [0.3], 8, WIDTH_BRUSH);
    const before = profile(flat);
    const after = profile(painted);
    const changed = after.filter((v, i) => Math.abs(v - before[i]) > 0.01).length;
    // A one-cell stroke plus a cell of ramp each side: three cells of 0.005.
    expect(changed / after.length).toBeLessThan(0.03);
    // ...and it really did paint something.
    expect(Math.min(...after)).toBeCloseTo(8, 6);
  });

  it('leaves the far side of the lap untouched to the last decimal', () => {
    const painted = paintSpan(flat, [0.3], 8, WIDTH_BRUSH);
    const after = profile(painted);
    // Half a lap away from a stroke at 0.3, nothing moved at all.
    for (let i = 0; i < after.length; i++) {
      const f = i / after.length;
      if (f > 0.28 && f < 0.32) continue;
      expect(after[i], `lap fraction ${f}`).toBeCloseTo(10, 6);
    }
  });

  it('paints a plateau with a shoulder each side, not a spike', () => {
    const painted = paintSpan(flat, [0.3, 0.32, 0.34, 0.36], 8, WIDTH_BRUSH);
    const after = profile(painted, 1000);
    const at = (f: number) => after[Math.round(f * 1000)];
    expect(at(0.31)).toBeCloseTo(8, 6);
    expect(at(0.35)).toBeCloseTo(8, 6);
    // The shoulders sit one cell outside and carry the ORIGINAL value.
    expect(at(0.29)).toBeCloseTo(10, 6);
    expect(at(0.37)).toBeCloseTo(10, 6);
  });

  it('does not dent against its own earlier points as a drag extends', () => {
    // Applied to the PRE-STROKE table each time, so a drag is one plateau
    // rather than a sawtooth of every point it passed through.
    let bands = flat;
    const visited: number[] = [];
    for (let i = 0; i <= 20; i++) {
      visited.push(0.3 + i * 0.002);
      bands = paintSpan(flat, visited, 8, WIDTH_BRUSH);
    }
    const after = profile(bands, 1000);
    const inside = after.filter((_, i) => i / 1000 > 0.302 && i / 1000 < 0.338);
    expect(Math.max(...inside)).toBeCloseTo(8, 6);
    expect(Math.min(...inside)).toBeCloseTo(8, 6);
  });

  it('preserves an authored profile the stroke never reached', () => {
    // A stroke must not flatten a shape it did not paint over.
    const shaped: CircuitBand[] = [
      { s: 0, value: 10.5 },
      { s: 0.18, value: 10.5 },
      { s: 0.24, value: 9.5 },
      { s: 0.35, value: 9.5 },
      { s: 1, value: 10.5 },
    ];
    const painted = paintSpan(shaped, [0.7], 8, WIDTH_BRUSH);
    const before = profile(shaped);
    const after = profile(painted);
    for (let i = 0; i < after.length; i++) {
      const f = i / after.length;
      if (f > 0.68 && f < 0.72) continue;
      // To the precision the table is EXPORTED at. A stroke plants breakpoints
      // carrying the original value rounded to two decimals, so landing one
      // inside an authored ramp re-slopes it by up to half a centimetre of
      // road. Asserting more than the record can carry would be asserting
      // noise.
      expect(after[i], `lap fraction ${f}`).toBeCloseTo(before[i], 2);
    }
    // Including the ramp between two authored breakpoints, not just the flats.
    expect(after[Math.round(0.21 * after.length)]).toBeCloseTo(10, 1);
  });

  it('keeps an authored breakpoint just past the ramp on BOTH sides of a stroke', () => {
    // The off-by-one this pins: a breakpoint inside cell c was judged against
    // its LEFT cell boundary only, so a stroke deleted authored rows one cell
    // further to its right than to its left. A row is inside the transition
    // only when BOTH boundaries of the cell it sits in are, and these two rows
    // are mirror images of each other around the stroke, so either both go or
    // both stay.
    const shaped: CircuitBand[] = [
      { s: 0, value: 10 },
      { s: 0.4825, value: 8.5 },
      { s: 0.5175, value: 8.5 },
      { s: 1, value: 10 },
    ];
    const painted = paintSpan(shaped, [0.5025], 12, WIDTH_BRUSH);
    expect(painted).toContainEqual({ s: 0.4825, value: 8.5 });
    expect(painted).toContainEqual({ s: 0.5175, value: 8.5 });
    // And the stroke really painted: the plateau sits at the painted value.
    expect(profile(painted, 2000)[Math.round(0.5025 * 2000)]).toBeCloseTo(12, 6);
  });

  it('spans the whole lap and keeps its two ends equal', () => {
    // s = 0 and s = 1 are the same yard of road: a table whose ends differ puts
    // a step across the start/finish line.
    for (const fractions of [[0.42], [0.0], [0.99, 0.0, 0.01], [0.5, 0.9]]) {
      const painted = paintSpan(flat, fractions, 8.5, WIDTH_BRUSH);
      expect(painted[0].s).toBe(0);
      expect(painted[painted.length - 1].s).toBe(1);
      expect(painted[0].value).toBe(painted[painted.length - 1].value);
      expect(painted).toEqual([...painted].sort((a, b) => a.s - b.s));
    }
  });

  it('walks a stroke across the start line as one plateau', () => {
    const painted = paintSpan(flat, [0.985, 0.99, 0.995, 0.0, 0.005], 8, WIDTH_BRUSH);
    const after = profile(painted, 1000);
    expect(after[0]).toBeCloseTo(8, 6);
    expect(after[990]).toBeCloseTo(8, 6);
    // ...and the other side of the lap is untouched.
    expect(after[500]).toBeCloseTo(10, 6);
  });

  it('runs the transition over the ramp it is given, not over one cell', () => {
    // What "less brutal" means, measured: the steepest step in the road edge.
    // A one-cell ramp is 0.5 percent of the lap, so a two yard change over it
    // is a wall; the hand-authored profiles transition over 5 to 7 percent.
    const steepest = (bands: readonly CircuitBand[]): number => {
      const p = profile(bands, 2000);
      let worst = 0;
      for (let i = 0; i < p.length; i++)
        worst = Math.max(worst, Math.abs(p[(i + 1) % p.length] - p[i]));
      return worst;
    };
    const stroke = [0.3, 0.302, 0.304, 0.306];
    const oneCell = paintSpan(flat, stroke, 8, WIDTH_BRUSH);
    const gentle = paintSpan(flat, stroke, 8, { ...WIDTH_BRUSH, ramp: 0.055 });
    expect(steepest(gentle)).toBeLessThan(steepest(oneCell) / 3);
    // Both really did paint the same value; only the approach changed.
    expect(Math.min(...profile(gentle))).toBeCloseTo(8, 1);
  });

  it('ends the transition ON the original profile, however long the ramp', () => {
    // A longer ramp must not be a longer LEAK. The outermost breakpoint of each
    // ramp carries the original value and is never thinned away, so the road
    // beyond it is untouched rather than leaning toward the stroke.
    const painted = paintSpan(flat, [0.3], 8, { ...WIDTH_BRUSH, ramp: 0.055 });
    const after = profile(painted, 1000);
    for (let i = 0; i < after.length; i++) {
      const f = i / after.length;
      if (f > 0.23 && f < 0.37) continue;
      expect(after[i], `lap fraction ${f}`).toBeCloseTo(10, 6);
    }
  });

  it('describes a smooth transition in a table a human can still edit', () => {
    // Emitted per cell and then thinned to what the shape actually needs, so a
    // gentle ramp does not cost one row per cell of it.
    const painted = paintSpan(flat, [0.3, 0.31, 0.32], 8, { ...WIDTH_BRUSH, ramp: 0.055 });
    expect(painted.length).toBeLessThan(16);
    expect(painted.length).toBeGreaterThan(4);
  });

  it('holds the painted value inside the brush range', () => {
    const low = paintSpan(flat, [0.4], 2, WIDTH_BRUSH);
    expect(Math.min(...profile(low))).toBeCloseTo(8, 6);
    const high = paintSpan(flat, [0.4], 999, WIDTH_BRUSH);
    expect(Math.max(...profile(high))).toBeCloseTo(40, 6);
  });

  it('leaves a readable table behind, whatever the stroke did', () => {
    let bands = flat;
    const visited: number[] = [];
    for (let i = 0; i < 300; i++) {
      visited.push(0.2 + i * 0.001);
      bands = paintSpan(flat, visited, 8, WIDTH_BRUSH);
    }
    expect(bands.length).toBeLessThan(12);
    expect(bands.every((band, i) => i === 0 || band.s > bands[i - 1].s)).toBe(true);
  });

  it('fills the cells a fast pointer skipped over', () => {
    // A pointer emits samples, not a path. Four cells apart is an ordinary
    // quick drag, and without the fill it painted a comb of plateaus with the
    // dragged-over gaps left at their old width.
    const sparse = paintSpan(flat, [0.3, 0.32, 0.34, 0.36], 8, WIDTH_BRUSH);
    const dense = paintSpan(
      flat,
      Array.from({ length: 61 }, (_, i) => 0.3 + i * 0.001),
      8,
      WIDTH_BRUSH,
    );
    expect(sparse).toEqual(dense);
  });

  it('is deterministic, and a drag walked backwards paints the same stretch', () => {
    const forward = paintSpan(flat, [0.3, 0.31, 0.32], 8, WIDTH_BRUSH);
    expect(paintSpan(flat, [0.3, 0.31, 0.32], 8, WIDTH_BRUSH)).toEqual(forward);
    expect(paintSpan(flat, [0.32, 0.31, 0.3], 8, WIDTH_BRUSH)).toEqual(forward);
  });

  it('returns the table untouched when the stroke touched nothing', () => {
    expect(paintSpan(flat, [], 8, WIDTH_BRUSH)).toEqual(flat);
    expect(paintSpan(flat, [Number.NaN], 8, WIDTH_BRUSH)).toEqual(flat);
  });

  it('round-trips the record shape through the neutral band', () => {
    const width = [
      { s: 0, halfWidth: 10.5 },
      { s: 1, halfWidth: 10.5 },
    ];
    expect(toWidthBands(fromWidthBands(width))).toEqual(width);
  });
});
