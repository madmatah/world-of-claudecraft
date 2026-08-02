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
  FRACTION_SNAP,
  fromApronBands,
  fromWidthBands,
  hitTestControlPoint,
  insertControlPoint,
  MIN_CONTROL_POINTS,
  moveControlPoint,
  nearestSegment,
  paintBand,
  toApronBands,
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

describe('circuit editor: the band tables', () => {
  const flat: CircuitBand[] = [
    { s: 0, value: 10 },
    { s: 1, value: 10 },
  ];

  it('spans the whole lap after every paint', () => {
    const painted = paintBand(flat, 0.42, 8.5, WIDTH_BRUSH);
    expect(painted[0].s).toBe(0);
    expect(painted[painted.length - 1].s).toBe(1);
    expect(painted).toEqual([...painted].sort((a, b) => a.s - b.s));
    expect(painted.find((band) => band.s > 0 && band.s < 1)?.value).toBeCloseTo(8.5, 6);
  });

  it('keeps the two ends equal, because s=0 and s=1 are the same yard of road', () => {
    const painted = paintBand(flat, 0, 12, WIDTH_BRUSH);
    expect(painted[0].value).toBe(12);
    expect(painted[painted.length - 1].value).toBe(12);
    // ...and painting at the far end does the same thing.
    const other = paintBand(flat, 1, 9, WIDTH_BRUSH);
    expect(other[0].value).toBe(other[other.length - 1].value);
  });

  it('holds the painted value inside the brush range', () => {
    expect(paintBand(flat, 0.4, 2, WIDTH_BRUSH).find((b) => b.s > 0 && b.s < 1)?.value).toBe(8);
    expect(paintBand(flat, 0.4, 999, WIDTH_BRUSH).find((b) => b.s > 0 && b.s < 1)?.value).toBe(40);
  });

  it('replaces rather than piles up when a drag paints the same place twice', () => {
    // A pointer drag emits dozens of events across one snapped fraction; without
    // this the table would grow a breakpoint per event.
    let bands = flat;
    for (let i = 0; i < 40; i++) bands = paintBand(bands, 0.42 + i * 1e-4, 9, WIDTH_BRUSH);
    expect(bands.length).toBeLessThanOrEqual(4);
    expect(bands.every((band, i) => i === 0 || band.s > bands[i - 1].s)).toBe(true);
  });

  it('snaps to the fraction grid', () => {
    const painted = paintBand(flat, 0.4237, 9, WIDTH_BRUSH);
    const inner = painted.find((band) => band.s > 0 && band.s < 1);
    expect(inner).toBeDefined();
    expect(Math.round((inner?.s ?? 0) / FRACTION_SNAP) * FRACTION_SNAP).toBeCloseTo(
      inner?.s ?? 0,
      9,
    );
  });

  it('round-trips both record shapes through the neutral band', () => {
    const width = [
      { s: 0, halfWidth: 10.5 },
      { s: 1, halfWidth: 10.5 },
    ];
    expect(toWidthBands(fromWidthBands(width))).toEqual(width);
    const apron = [
      { s: 0, maxApron: 15 },
      { s: 1, maxApron: 15 },
    ];
    expect(toApronBands(fromApronBands(apron))).toEqual(apron);
  });
});
