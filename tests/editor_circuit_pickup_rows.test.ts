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
  PICKUP_ROW_MIN_GAP,
  pickupRowAtPoint,
  pickupRowFractionAt,
  removedPickupRow,
} from '../src/editor/circuit/pickup_rows_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_ORIGIN } from '../src/sim/realm_racers_layout';
import { realmRacersPickupBoxes } from '../src/sim/realm_racers_pickups';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

const track = realmRacersTrack(GARDEN);

/** A circuit-local point at a lap fraction, offset along the left normal. */
function pointAt(fraction: number, lateral = 0): { x: number; z: number } {
  const p = track.pointAt(fraction * track.length);
  return {
    x: p.x - REALM_RACERS_ORIGIN.x - p.tz * lateral,
    z: p.z - REALM_RACERS_ORIGIN.z + p.tx * lateral,
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
    const outside = pointAt(0.32, rallyGardenEdgeOffsetAt(GARDEN, s) + 6);
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
    expect(rallyGardenEdgeOffsetAt(GARDEN, s)).toBeGreaterThan(halfWidth + 1);
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
    const boxes = realmRacersPickupBoxes(GARDEN);
    for (const box of [boxes[0], boxes[3], boxes[boxes.length - 1]]) {
      const x = box.x - REALM_RACERS_ORIGIN.x;
      const z = box.z - REALM_RACERS_ORIGIN.z;
      expect(pickupRowAtPoint(GARDEN, x, z, 2)).toBe(box.row);
    }
  });

  it('finds nothing where no row stands', () => {
    const boxes = realmRacersPickupBoxes(GARDEN);
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

describe('the rows survive the round trip out of the tool', () => {
  const drawn: RealmRacersCircuit = { ...GARDEN, id: 'pickup_round_trip' };

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
