// The TERRAIN tool's gestures on the LAND.
//
// The ground is the barriers' opposite number in that mode, and it gets the same
// treatment their gestures do: the decisions live in a core so a Vitest reaches
// them, and the page keeps the pointer, the undo stack and the status line.
//
// Two decisions, and both have a wrong answer that reads as a working tool: a
// click that resolves to the CURVE when it landed on a handle turns every drag
// into an insert, and a delete that goes one handle under the floor leaves a
// ring the curve cannot be read from at all.

import { describe, expect, it } from 'vitest';
import {
  groundHitAt,
  groundPointRemoved,
  MIN_GROUND_POINTS,
} from '../src/editor/circuit/ground_core';
import { MIN_CONTROL_POINTS } from '../src/editor/circuit/handles_core';
import { MORTAR_OVERDRIVE_MIN_GROUND_POINTS } from '../src/sim/mortar_overdrive/ground';
import type { MortarOverdrivePoint } from '../src/sim/mortar_overdrive/layout';

/** A ten-handle ring, big enough to delete from and regular enough that every
 *  distance below can be checked by eye. */
const RING: MortarOverdrivePoint[] = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2;
  return { x: Math.round(Math.cos(angle) * 100), z: Math.round(Math.sin(angle) * 100) };
});

describe('what a click on the ground shape landed on', () => {
  it('answers nothing at all when there is no shape', () => {
    expect(groundHitAt([], 0, 0, 5, 8)).toBeNull();
  });

  it('grabs the handle under the pointer', () => {
    const hit = groundHitAt(RING, RING[3].x + 1, RING[3].z - 1, 5, 8);
    expect(hit).toEqual({ kind: 'handle', index: 3 });
  });

  it('takes the HANDLE over the curve where both are in reach', () => {
    // The order is the whole decision. At any working zoom the two tolerances
    // overlap around a handle, so a tool that tested the curve first would
    // answer every grab with an insert and the shape could never be dragged.
    const on = RING[0];
    const hit = groundHitAt(RING, on.x, on.z, 6, 40);
    expect(hit).toEqual({ kind: 'handle', index: 0 });
  });

  it('inserts on the curve between two handles, at the point on the line', () => {
    const a = RING[0];
    const b = RING[1];
    const middle = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    // A hair off the chord, well outside any handle's reach.
    const hit = groundHitAt(RING, middle.x + 0.5, middle.z + 0.5, 5, 8);
    expect(hit?.kind).toBe('insert');
    if (hit?.kind !== 'insert') throw new Error('a click on the chord inserts');
    // The segment OPENING at handle 0, and the point snapped ONTO the line
    // rather than left where the pointer was: an inserted handle that started
    // off the curve moves the shape on the click that made it.
    expect(hit.index).toBe(0);
    const along = { x: b.x - a.x, z: b.z - a.z };
    const off = { x: hit.at.x - a.x, z: hit.at.z - a.z };
    expect(along.x * off.z - along.z * off.x).toBeCloseTo(0, 6);
    expect(Math.hypot(hit.at.x - middle.x, hit.at.z - middle.z)).toBeLessThan(1);
  });

  it('answers a miss with nothing, so the click can go on to mean something else', () => {
    expect(groundHitAt(RING, 0, 0, 5, 8)).toBeNull();
    expect(groundHitAt(RING, 400, 400, 5, 8)).toBeNull();
  });
});

describe('removing one ground handle', () => {
  it('drops it, and leaves every other one where it was', () => {
    const next = groundPointRemoved(RING, 4);
    expect(next).toHaveLength(RING.length - 1);
    expect(next).toEqual(RING.filter((_, i) => i !== 4));
  });

  it('refuses at the floor rather than leaving a ring no curve can be read from', () => {
    const floor = RING.slice(0, MIN_GROUND_POINTS);
    expect(floor).toHaveLength(MIN_GROUND_POINTS);
    expect(groundPointRemoved(floor, 0)).toBeNull();
    // One above it still gives way, so the refusal is a floor and not a wall.
    expect(groundPointRemoved(RING.slice(0, MIN_GROUND_POINTS + 1), 0)).toHaveLength(
      MIN_GROUND_POINTS,
    );
  });

  it("keeps the SIM's floor, not the road's", () => {
    // The land and the centerline are read as the same curve, and they still do
    // not share this number: a road has to be a road (eight handles), and a
    // ground shape is a triangle at worst. The resolver and the save endpoint
    // both accept three, so borrowing the road's floor here refused a shape the
    // record allows and made a nine-handle proposal deletable exactly once.
    expect(MIN_GROUND_POINTS).toBe(MORTAR_OVERDRIVE_MIN_GROUND_POINTS);
    expect(MIN_GROUND_POINTS).toBe(3);
    expect(MIN_CONTROL_POINTS).toBeGreaterThan(MIN_GROUND_POINTS);
    // A four-handle ring gives one up; a three-handle one is the floor.
    expect(groundPointRemoved(RING.slice(0, 4), 0)).toHaveLength(3);
    expect(groundPointRemoved(RING.slice(0, 3), 0)).toBeNull();
  });

  it('refuses an index that is not on the ring', () => {
    expect(groundPointRemoved(RING, -1)).toBeNull();
    expect(groundPointRemoved(RING, RING.length)).toBeNull();
  });
});
