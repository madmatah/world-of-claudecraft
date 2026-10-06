// The RACE tool's one canvas gesture, and what it does to the record.
//
// The point of the core is that the page holds no rules: which fraction a click
// means, whether it landed on a row already there, and what a placement does to
// the list are all decisions with edges (the road's, the wrap at the start line,
// the ceiling), and every one of them is checked here rather than in a browser.

import { describe, expect, it } from 'vitest';
import {
  circuitFromTypeScript,
  circuitToTypeScript,
  validateCircuitPayload,
} from '../src/editor/circuit/export_core';
import {
  addPickupRow,
  MAX_PICKUP_ROWS,
  movedPickupRow,
  nudgedPickupFraction,
  PICKUP_ROW_MIN_GAP,
  pickupNudgeDirection,
  pickupRowAtPoint,
  pickupRowFractionAt,
  removedPickupRow,
} from '../src/editor/circuit/pickup_rows_core';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN,
  type MortarOverdriveCircuit,
} from '../src/sim/content/mortar_overdrive/circuits';
import { MORTAR_OVERDRIVE_ORIGIN } from '../src/sim/mortar_overdrive/layout';
import { mortarOverdrivePickupBoxes } from '../src/sim/mortar_overdrive/pickups';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveTrack,
} from '../src/sim/mortar_overdrive/spline';

const track = mortarOverdriveTrack(GARDEN);

/** The distance between two lap fractions the short way round, which is how
 *  every gap in this tool is measured. */
function gapOnLap(a: number, b: number): number {
  const raw = Math.abs(a - b);
  return Math.min(raw, 1 - raw);
}

/** A circuit-local point at a lap fraction, offset along the left normal. */
function pointAt(fraction: number, lateral = 0): { x: number; z: number } {
  const p = track.pointAt(fraction * track.length);
  return {
    x: p.x - MORTAR_OVERDRIVE_ORIGIN.x - p.tz * lateral,
    z: p.z - MORTAR_OVERDRIVE_ORIGIN.z + p.tx * lateral,
  };
}

describe('where a click on the plan lays a pickup row', () => {
  it('reads a click on the road as the lap fraction under it', () => {
    const point = pointAt(0.32, 4);
    expect(pointAt(0.32).x).not.toBe(point.x);
    expect(pickupRowFractionAt(GARDEN, point.x, point.z)).toBeCloseTo(0.32, 3);
  });

  it('refuses a click that is not on the road at all', () => {
    // Out past the garden edge, which is the outermost thing a click could
    // plausibly have meant.
    const s = 0.32 * track.length;
    const outside = pointAt(0.32, mortarOverdriveGardenEdgeOffsetAt(GARDEN, s) + 6);
    expect(pickupRowFractionAt(GARDEN, outside.x, outside.z)).toBeNull();
  });

  it('draws the boundary at the ROAD edge, not at the garden edge', () => {
    // The boundary the gesture uses has to be the one the readout judges a row
    // by and the one the status line names. The verge is inside the garden edge
    // and outside the road, so it is the yard that tells the two apart: a click
    // there used to author a row while the tool said "click inside the road
    // edge" and the readout measured the road.
    const s = 0.32 * track.length;
    const halfWidth = track.halfWidthAt(s);
    expect(mortarOverdriveGardenEdgeOffsetAt(GARDEN, s)).toBeGreaterThan(halfWidth + 1);
    const inside = pointAt(0.32, halfWidth - 1);
    const verge = pointAt(0.32, halfWidth + 1);
    expect(pickupRowFractionAt(GARDEN, inside.x, inside.z)).toBeCloseTo(0.32, 3);
    expect(pickupRowFractionAt(GARDEN, verge.x, verge.z)).toBeNull();
    // Both sides, since a road has two edges and only one of them was tested by
    // the arm above.
    const otherVerge = pointAt(0.32, -(halfWidth + 1));
    expect(pickupRowFractionAt(GARDEN, otherVerge.x, otherVerge.z)).toBeNull();
  });

  it('finds the row a click landed on, at any box of it', () => {
    const boxes = mortarOverdrivePickupBoxes(GARDEN);
    for (const box of [boxes[0], boxes[3], boxes[boxes.length - 1]]) {
      const x = box.x - MORTAR_OVERDRIVE_ORIGIN.x;
      const z = box.z - MORTAR_OVERDRIVE_ORIGIN.z;
      expect(pickupRowAtPoint(GARDEN, x, z, 2)).toBe(box.row);
    }
  });

  it('finds nothing where no row stands', () => {
    const boxes = mortarOverdrivePickupBoxes(GARDEN);
    const far = pointAt((boxes[0].s / track.length + 0.5) % 1);
    expect(pickupRowAtPoint(GARDEN, far.x, far.z, 2)).toBe(-1);
  });
});

describe('what a placement does to the list of rows', () => {
  it('inserts in lap order and reports where it went', () => {
    const first = addPickupRow([{ s: 0.5 }], 0.2);
    expect(first.outcome).toBe('added');
    expect(first.rows).toEqual([{ s: 0.2 }, { s: 0.5 }]);
    expect(first.index).toBe(0);
    const second = addPickupRow(first.rows, 0.8);
    expect(second.rows).toEqual([{ s: 0.2 }, { s: 0.5 }, { s: 0.8 }]);
    expect(second.index).toBe(2);
  });

  it('refuses a row on top of one that is already there, and names it', () => {
    const rows = [{ s: 0.2 }, { s: 0.5 }];
    const refused = addPickupRow(rows, 0.5 + PICKUP_ROW_MIN_GAP / 2);
    expect(refused.outcome).toBe('tooClose');
    expect(refused.rows).toBe(rows);
    expect(refused.index).toBe(1);
    // And just past the gap it is a row of its own.
    expect(addPickupRow(rows, 0.5 + PICKUP_ROW_MIN_GAP * 1.5).outcome).toBe('added');
  });

  it('measures that gap the short way round the lap', () => {
    // A click at 0.001 and a row at 0.999 are a couple of yards apart on a
    // circuit, not a whole lap.
    expect(addPickupRow([{ s: 0.999 }], 0.001).outcome).toBe('tooClose');
  });

  it('stops at the ceiling rather than filling a lap with boxes', () => {
    const full = Array.from({ length: MAX_PICKUP_ROWS }, (_, i) => ({
      s: (i + 0.5) / MAX_PICKUP_ROWS,
    }));
    const refused = addPickupRow(full, 0.001);
    expect(refused.outcome).toBe('full');
    expect(refused.rows).toBe(full);
  });

  it('removes one entry and leaves the rest in order', () => {
    expect(removedPickupRow([{ s: 0.2 }, { s: 0.5 }, { s: 0.8 }], 1)).toEqual([
      { s: 0.2 },
      { s: 0.8 },
    ]);
  });
});

describe('what a MOVE does to the list of rows', () => {
  const rows = [{ s: 0.2 }, { s: 0.5 }, { s: 0.8 }];

  it('takes a row to where it was asked for and reports where that is', () => {
    const moved = movedPickupRow(rows, 1, 0.55);
    expect(moved.outcome).toBe('moved');
    expect(moved.rows).toEqual([{ s: 0.2 }, { s: 0.55 }, { s: 0.8 }]);
    expect(moved.index).toBe(1);
  });

  it('holds the row by its VALUE, so crossing a neighbour renumbers both', () => {
    // The whole reason the move cannot be an in-place write at `index`: past
    // 0.2 the moved row is row 0 and the row it passed is row 1.
    const moved = movedPickupRow(rows, 1, 0.1);
    expect(moved.outcome).toBe('moved');
    expect(moved.index).toBe(0);
    expect(moved.rows.map((row) => row.s)).toEqual([0.1, 0.2, 0.8]);
  });

  it('never parks a row where a click could not have authored one', () => {
    // Dropped right on top of its neighbour: it lands one whole gap away, on
    // the side the pointer was, and `addPickupRow` agrees that spot is free.
    const onTop = movedPickupRow(rows, 1, 0.2 + PICKUP_ROW_MIN_GAP / 3);
    expect(onTop.outcome).toBe('moved');
    const landed = onTop.rows[onTop.index].s;
    expect(landed).toBeGreaterThan(0.2);
    expect(landed - 0.2).toBeGreaterThanOrEqual(PICKUP_ROW_MIN_GAP);
    expect(addPickupRow([{ s: 0.2 }, { s: 0.8 }], landed).outcome).toBe('added');
  });

  it('parks a pushed row where the commit rounding cannot drag it back into the band', () => {
    // Every commit rounds a fraction to 4 decimals (`FRACTION_PLACES` in
    // export_core, applied to the live record on every commit), and a slack
    // under half that resolution is rounded straight back ONTO the band edge,
    // where the gap measures short in doubles: the record durably held a pair
    // the core's own clearance rule refuses, the exact state the slack claims
    // cannot exist.
    expect(0.21 - 0.2).toBeLessThan(PICKUP_ROW_MIN_GAP);
    const round4 = (s: number) => Math.round(s * 1e4) / 1e4;
    const pushed = movedPickupRow(rows, 1, 0.2 + PICKUP_ROW_MIN_GAP / 3);
    expect(pushed.outcome).toBe('moved');
    const landed = pushed.rows[pushed.index].s;
    // Rounded as the commit rounds BOTH of them, the pair is still one a click
    // could author: the same clearance the move parked the row with.
    expect(addPickupRow([{ s: round4(0.2) }], round4(landed)).outcome).toBe('added');
  });

  it('parks on the side the pointer is, and hops when it passes the neighbour', () => {
    // The two halves of one rule, which is what makes a drag past a neighbour a
    // SWAP rather than a wall. Approaching from below it stops short of 0.2...
    const before = movedPickupRow(rows, 1, 0.2 - PICKUP_ROW_MIN_GAP / 4);
    expect(before.rows[before.index].s).toBeLessThan(0.2);
    expect(before.index).toBe(0);
    // ...and one step past 0.2 it is on the far side, having changed places.
    const after = movedPickupRow(rows, 1, 0.2 + PICKUP_ROW_MIN_GAP / 4);
    expect(after.rows[after.index].s).toBeGreaterThan(0.2);
    expect(after.index).toBe(1);
  });

  it('wraps across the start line, taking the row from last to first', () => {
    const wrapped = movedPickupRow(rows, 2, 1.01);
    expect(wrapped.outcome).toBe('moved');
    expect(wrapped.index).toBe(0);
    // Close rather than exact: the wrap is a modulo on a double, and the record
    // rounds to `FRACTION_PLACES` on commit anyway.
    expect(wrapped.rows[0].s).toBeCloseTo(0.01, 9);
    expect(wrapped.rows.map((row) => row.s).slice(1)).toEqual([0.2, 0.5]);
    // And the wrap is measured the short way round, so a row driven to just
    // under the line still respects the one sitting just over it.
    const crowded = movedPickupRow([{ s: 0.005 }, { s: 0.5 }], 1, 0.999);
    expect(gapOnLap(crowded.rows[crowded.index].s, 0.005)).toBeGreaterThanOrEqual(
      PICKUP_ROW_MIN_GAP,
    );
  });

  it('refuses an index that is not a row', () => {
    for (const index of [-1, rows.length]) {
      const refused = movedPickupRow(rows, index, 0.3);
      expect(refused.outcome).toBe('blocked');
      expect(refused.rows).toBe(rows);
    }
  });
});

describe('how far an arrow key moves a row', () => {
  it('steps a length in YARDS, so a nudge means the same on any circuit', () => {
    // The rule a fraction-based step would break: the shipped circuits differ by
    // nearly two to one in lap length, and an operator's arrow key has to mean
    // one distance.
    const short = 454;
    const long = 829;
    const onShort = nudgedPickupFraction(0.5, short, 1, false) - 0.5;
    const onLong = nudgedPickupFraction(0.5, long, 1, false) - 0.5;
    expect(onShort * short).toBeCloseTo(onLong * long, 9);
    expect(onShort).toBeGreaterThan(onLong);
  });

  it('has a big step and a small one, and both directions', () => {
    const small = nudgedPickupFraction(0.5, 454, 1, false) - 0.5;
    const big = nudgedPickupFraction(0.5, 454, 1, true) - 0.5;
    expect(big).toBeGreaterThan(small);
    expect(nudgedPickupFraction(0.5, 454, -1, false) - 0.5).toBeCloseTo(-small, 12);
  });

  it('leaves a lap with no length alone rather than dividing by it', () => {
    expect(nudgedPickupFraction(0.5, 0, 1, true)).toBe(0.5);
  });

  it('maps the two horizontal arrows along the lap and nothing else', () => {
    expect(pickupNudgeDirection('ArrowRight')).toBe(1);
    expect(pickupNudgeDirection('ArrowLeft')).toBe(-1);
    // A row has one degree of freedom, so the vertical pair would have to invent
    // a lateral the record cannot carry.
    expect(pickupNudgeDirection('ArrowUp')).toBeNull();
    expect(pickupNudgeDirection('ArrowDown')).toBeNull();
    expect(pickupNudgeDirection('r')).toBeNull();
  });
});

describe('the rows survive the round trip out of the tool', () => {
  const drawn: MortarOverdriveCircuit = { ...GARDEN, id: 'pickup_round_trip' };

  it('exports and reads back every authored row', () => {
    const back = circuitFromTypeScript(circuitToTypeScript(drawn));
    expect(back?.pickupRows).toEqual(drawn.pickupRows);
  });

  it('keeps a circuit with no rows carrying none', () => {
    const bare = circuitFromTypeScript(circuitToTypeScript({ ...drawn, pickupRows: undefined }));
    expect(bare).not.toBeNull();
    expect(bare?.pickupRows).toBeUndefined();
  });

  it('refuses a payload whose rows are not lap fractions', () => {
    const payload = JSON.parse(JSON.stringify({ ...drawn, pickupRows: [{ s: 1.4 }] }));
    expect(validateCircuitPayload(payload)).toBeNull();
    // The same payload with a legal fraction is accepted, so the refusal is
    // about the row rather than about anything else in the record.
    expect(validateCircuitPayload({ ...payload, pickupRows: [{ s: 0.4 }] })).not.toBeNull();
  });

  it('refuses every other way the rows can arrive malformed', () => {
    const payload = JSON.parse(JSON.stringify(drawn)) as Record<string, unknown>;
    const withRows = (pickupRows: unknown) => validateCircuitPayload({ ...payload, pickupRows });
    // One negative per DIMENSION, because the reader checks three and a single
    // bad-fraction case would leave the other two unproven.
    expect(withRows('0.4')).toBeNull();
    expect(withRows({ s: 0.4 })).toBeNull();
    expect(withRows([{ s: 'half' }])).toBeNull();
    expect(withRows([{}])).toBeNull();
    expect(withRows([{ s: Number.NaN }])).toBeNull();
    expect(withRows([{ s: -0.1 }])).toBeNull();
    // And the ceiling is the TOOL's own, so a payload the editor could never
    // have produced is not one the save endpoint writes.
    const full = Array.from({ length: MAX_PICKUP_ROWS }, (_, i) => ({ s: i / MAX_PICKUP_ROWS }));
    expect(withRows(full)).not.toBeNull();
    expect(withRows([...full, { s: 0.999 }])).toBeNull();
  });
});
