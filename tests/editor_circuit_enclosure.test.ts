// The TERRAIN tool's gestures on the WALL.
//
// The wall was numbers-only until packet 28: a form field and a `Fit wall`
// button, on a canvas where a pond has had draggable handles since the water
// was placeable. What makes it worth its own core is that a wall is authored as
// half-extents around the origin with no position at all, so two things a
// dragging tool normally does are not available and must not be faked:
//
// - a resize moves BOTH edges, because there is one number for the pair;
// - the box cannot be moved, so the centre grip slides the circuit instead.
//
// Each of those has a wrong answer that reads as a working tool, which is what
// these cases are about.

import { describe, expect, it } from 'vitest';
import {
  circuitMovedFromPress,
  type EnclosureGrab,
  type EnclosureGrip,
  enclosureGrab,
  enclosureGrips,
  enclosureHitAt,
  enclosureResized,
  MIN_PERIMETER_HALF,
} from '../src/editor/circuit/enclosure_core';
import { MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z } from '../src/editor/circuit/envelope_core';
import { roundCircuit } from '../src/editor/circuit/export_core';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN,
  type MortarOverdriveCircuit,
  type MortarOverdrivePerimeter,
} from '../src/sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
} from '../src/sim/mortar_overdrive/layout';

const WALL: MortarOverdrivePerimeter = { halfX: 120, halfZ: 90, halfThickness: 0.4, height: 2.2 };

const gripOf = (id: EnclosureGrip['id']): EnclosureGrip => {
  const grip = enclosureGrips(WALL.halfX, WALL.halfZ).find((entry) => entry.id === id);
  if (!grip) throw new Error(`no ${id} grip`);
  return grip;
};

/** Grabbed dead on its own dot, so the offset is zero and the case below is
 *  about the arithmetic rather than about the grab. */
const grab = (id: EnclosureGrip['id']): EnclosureGrab => {
  const grip = gripOf(id);
  return enclosureGrab(grip, grip.x, grip.z);
};

describe('where the wall grips are', () => {
  it('puts one on every corner and every edge, on the box itself', () => {
    const grips = enclosureGrips(120, 90);
    expect(grips.map((grip) => grip.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    for (const grip of grips) {
      // On the box: each coordinate is either the half-extent or the middle.
      expect([-120, 0, 120]).toContain(grip.x);
      expect([-90, 0, 90]).toContain(grip.z);
    }
    // All eight distinct, or two of them would sit on top of each other and one
    // would be unreachable at every zoom.
    const places = grips.map((grip) => `${grip.x},${grip.z}`);
    expect(new Set(places).size).toBe(8);
  });

  it('gives an EDGE grip one axis and a corner both', () => {
    // The difference is the whole reason there are eight rather than four: a
    // corner is "make it bigger" and an edge is "make it deeper without making
    // it wider". An edge grip writing both would silently undo the other axis
    // every time it was used.
    expect(gripOf('e').axis).toBe('x');
    expect(gripOf('w').axis).toBe('x');
    expect(gripOf('n').axis).toBe('z');
    expect(gripOf('s').axis).toBe('z');
    for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
      expect(gripOf(id).axis, id).toBe('both');
    }
  });
});

describe('what a click on the wall landed on', () => {
  it('takes the grip under the pointer', () => {
    const hit = enclosureHitAt(WALL.halfX, WALL.halfZ, 121, 89, 5);
    expect(hit).toEqual({ kind: 'grip', grip: gripOf('se') });
  });

  it('takes the NEAREST grip, not the first one declared', () => {
    // On a shallow wall at a zoom that shows the whole circuit, the north edge
    // grip and both corners beside it are inside one tolerance at once.
    // Declaration order would make two of the three unreachable, and which two
    // would depend on where the operator clicked.
    const shallow = enclosureHitAt(120, 20, 118, -19, 40);
    expect(shallow?.kind).toBe('grip');
    if (shallow?.kind !== 'grip') throw new Error('a click near a corner is a grip');
    expect(shallow.grip.id).toBe('ne');
    // ...and a click nearer the middle of that same edge takes the edge grip,
    // off the same tolerance: the answer follows the pointer, not the table.
    const middle = enclosureHitAt(120, 20, 10, -19, 40);
    if (middle?.kind !== 'grip') throw new Error('a click near the edge is a grip');
    expect(middle.grip.id).toBe('n');
  });

  it('reads the centre as MOVE, which is a different verb from the eight', () => {
    expect(enclosureHitAt(WALL.halfX, WALL.halfZ, 2, -1, 5)).toEqual({ kind: 'move' });
  });

  it('prefers a grip to the centre even when the centre is NEARER', () => {
    // The costs are not symmetric, which is what decides the order: a resize
    // taken as a move picks the whole circuit up and slides it, and the eight
    // dots drawn on the box are what the operator was aiming at.
    //
    // The pointer is dead on the ORIGIN here, so the centre is at distance 0 and
    // the nearest grip is 8 yards away. A test that put the pointer nearer the
    // grip would pass on distance alone and stay green with the two tests
    // swapped, which is the ordering rule going unpinned.
    const hit = enclosureHitAt(120, 8, 0, 0, 30);
    expect(hit?.kind).toBe('grip');
    if (hit?.kind !== 'grip') throw new Error('the box wins');
    expect(['n', 's']).toContain(hit.grip.id);
  });

  it('answers a miss with nothing, so the click can mean something else', () => {
    expect(enclosureHitAt(WALL.halfX, WALL.halfZ, 60, 40, 5)).toBeNull();
    expect(enclosureHitAt(WALL.halfX, WALL.halfZ, 400, 400, 5)).toBeNull();
  });
});

describe('dragging a wall grip', () => {
  it('writes the axes its grip owns and leaves the other one alone', () => {
    const east = enclosureResized(WALL, grab('e'), 150, 999);
    expect(east.halfX).toBe(150);
    expect(east.halfZ).toBe(WALL.halfZ);
    // Well under the depth ceiling, which is tighter than the width one: the
    // lane budget binds on z long before the instance band does on x.
    const north = enclosureResized(WALL, grab('n'), 999, -120);
    expect(north.halfX).toBe(WALL.halfX);
    expect(north.halfZ).toBe(120);
    const corner = enclosureResized(WALL, grab('se'), 150, 130);
    expect([corner.halfX, corner.halfZ]).toEqual([150, 130]);
  });

  it('keeps the wall dressing, which is not what this gesture is about', () => {
    const next = enclosureResized(WALL, grab('se'), 150, 140);
    expect(next.halfThickness).toBe(WALL.halfThickness);
    expect(next.height).toBe(WALL.height);
  });

  it('is SYMMETRIC: the far edge follows, and dragging through the origin grows', () => {
    // The record holds one number per axis, so there is no reading of this
    // gesture where the near edge moves alone. Pulling the WEST grip east past
    // the origin therefore goes on growing the box rather than inverting it,
    // which is what `Math.abs` means here and not a defence against bad input.
    const west = enclosureResized(WALL, grab('w'), -150, 0);
    expect(west.halfX).toBe(150);
    const through = enclosureResized(WALL, grab('w'), 150, 0);
    expect(through.halfX).toBe(150);
    expect(through.halfX).toBeGreaterThan(0);
  });

  it('authors whole yards, like every wall a fit ever wrote', () => {
    const next = enclosureResized(WALL, grab('se'), 149.4718, 90.5);
    expect(next.halfX).toBe(149);
    expect(next.halfZ).toBe(91);
    expect(Number.isInteger(next.halfX)).toBe(true);
    expect(Number.isInteger(next.halfZ)).toBe(true);
  });

  it('stops at the ceiling the readout would refuse past', () => {
    const huge = enclosureResized(WALL, grab('se'), 5000, 5000);
    expect(huge.halfX).toBe(MAX_PERIMETER_HALF_X);
    expect(huge.halfZ).toBe(MAX_PERIMETER_HALF_Z);
    // And the ceiling really is inside the instance volume, which is the rule
    // that ceiling exists for: a wall level with the volume's edge is a machine
    // that leans on it and meets world terrain.
    expect(huge.halfX).toBeLessThan(MORTAR_OVERDRIVE_MAX_REGION_HALF_X);
    expect(huge.halfZ).toBeLessThan(MORTAR_OVERDRIVE_MAX_REGION_HALF_Z);
  });

  it('stops at a floor rather than collapsing the box to a dot', () => {
    const tiny = enclosureResized(WALL, grab('se'), 0, 0);
    expect(tiny.halfX).toBe(MIN_PERIMETER_HALF);
    expect(tiny.halfZ).toBe(MIN_PERIMETER_HALF);
    expect(MIN_PERIMETER_HALF).toBeGreaterThan(0);
  });

  it('lets a wall be dragged INSIDE its own road, because the readout judges that', () => {
    // The floor is about geometry, never about design. Whether a wall contains
    // its road is the readout's verdict (`road_outside_perimeter`), the same way
    // a bench on the racing surface is; a drag that refused would be the tool
    // overruling the panel, and an operator shrinking a wall on purpose before
    // redrawing a smaller circuit would find the gesture stuck for no stated
    // reason.
    const inside = enclosureResized(WALL, grab('e'), 20, 0);
    expect(inside.halfX).toBe(20);
    expect(inside.halfX).toBeGreaterThan(MIN_PERIMETER_HALF);
  });

  it('does not JUMP: a grip grabbed off-centre keeps its offset', () => {
    // Without the offset the edge snaps under the pointer on the first
    // pointermove, and the lurch is the click tolerance in yards: about 4 at a
    // default fit and 20 at the widest zoom out. Grabbed 7 yards short of the
    // east grip, the wall must not move at all until the pointer does.
    const grip = gripOf('e');
    const offset = enclosureGrab(grip, grip.x - 7, grip.z + 3);
    expect(enclosureResized(WALL, offset, grip.x - 7, grip.z + 3)).toEqual(WALL);
    // ...and then it follows the pointer by what the pointer moved, not to where
    // the pointer is.
    expect(enclosureResized(WALL, offset, grip.x - 7 + 12, grip.z + 3).halfX).toBe(WALL.halfX + 12);
  });

  it('clamps to ceilings that are real numbers, not to whatever the module says', () => {
    // Every other case here compares the clamp against the same constant the
    // clamp is written with, which is the implementation restated. These two
    // lines are the only place the exported ceilings are pinned to a value, so a
    // ceiling quietly collapsing to 50 fails here and nowhere else.
    expect([MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z]).toEqual([299, 149]);
    expect(MIN_PERIMETER_HALF).toBe(6);
  });

  it('is deterministic, so the same drag lands in the same place', () => {
    const held = grab('se');
    expect(enclosureResized(WALL, held, 143.2, 88.6)).toEqual(
      enclosureResized(WALL, held, 143.2, 88.6),
    );
  });
});

describe('sliding the circuit inside its wall', () => {
  const PRESS = { x: 40, z: -20 };
  const island: MortarOverdriveCircuit = {
    ...GARDEN,
    id: 'enclosure_move',
    groundOutline: [
      { x: -120, z: -90 },
      { x: 120, z: -90 },
      { x: 120, z: 90 },
      { x: -120, z: 90 },
    ],
  };

  it('moves everything circuit-local, and nothing that is lap-relative', () => {
    const moved = circuitMovedFromPress(island, PRESS, { x: PRESS.x + 30, z: PRESS.z + 10 });
    expect(moved.controlPoints[0]).toEqual({
      x: island.controlPoints[0].x + 30,
      z: island.controlPoints[0].z + 10,
    });
    expect(moved.groundOutline?.[0]).toEqual({ x: -90, z: -80 });
    // A pickup row is a lap fraction and follows the road for free: moving it
    // too would move it twice.
    expect(moved.pickupRows).toEqual(island.pickupRows);
    // The boxes around it do not move at all, since they have no position.
    expect(moved.perimeter).toEqual(island.perimeter);
    expect([moved.regionHalfX, moved.regionHalfZ]).toEqual([
      island.regionHalfX,
      island.regionHalfZ,
    ]);
  });

  it('does not DRIFT: a hundred frames land exactly where one does', () => {
    // The property the page had and no test held. A commit rounds control points
    // to a tenth of a yard, so an implementation that stepped from the last
    // frame would round a hundred times instead of once.
    const path = Array.from({ length: 100 }, (_, i) => ({
      x: PRESS.x + (i + 1) * 0.06,
      z: PRESS.z + (i + 1) * 0.02,
    }));
    const replayed = path.reduce(
      (_carry, point) => circuitMovedFromPress(island, PRESS, point),
      island,
    );
    const once = circuitMovedFromPress(island, PRESS, path[path.length - 1]);
    expect(replayed).toEqual(once);

    // ...and the arm that makes the line above mean something: the stepping
    // implementation really does land somewhere else, so a test satisfied by
    // both would be proving nothing. Six hundredths a frame rounds UP to a
    // tenth every frame, so it travels 10 yards where the pointer went 6.
    let stepped = island;
    let previous = PRESS;
    for (const point of path) {
      stepped = circuitMovedFromPress(stepped, previous, point);
      previous = point;
    }
    expect(stepped).not.toEqual(once);
    const travelled = stepped.controlPoints[0].x - island.controlPoints[0].x;
    const honest = once.controlPoints[0].x - island.controlPoints[0].x;
    expect(honest).toBeCloseTo(6, 1);
    expect(travelled).toBeGreaterThan(honest + 3);
  });

  it('is a no-op while the pointer has not left the press', () => {
    expect(circuitMovedFromPress(island, PRESS, PRESS)).toEqual(roundCircuit(island));
  });
});
