import { describe, expect, it } from 'vitest';
import { vehicleProfile } from '../src/sim/content/vehicles';
import {
  isAtRealmRacers,
  REALM_RACERS_GATE_FRACTIONS,
  REALM_RACERS_GATE_MARGIN,
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_START_BACK,
  REALM_RACERS_START_SPACING,
  rallyGateCrossingFraction,
} from '../src/sim/realm_racers_layout';
import {
  rallyBasinEdgeOffsetAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../src/sim/realm_racers_spline';

const track = realmRacersTrack();
const gates = realmRacersGates();
const starts = realmRacersStarts();

describe('Realm Racers recovery gates', () => {
  it('over-covers the road at every gate (the 4.8-vs-5.5 recovery bug)', () => {
    // The shipped circuit banded gates NARROWER than the road, so a racer
    // hugging the outer edge crossed the road without crossing the gate and
    // silently missed the recovery anchor.
    for (const gate of gates) {
      expect(gate.halfWidth).toBeGreaterThanOrEqual(
        track.halfWidthAt(gate.s) + REALM_RACERS_GATE_MARGIN,
      );
    }
  });

  it('carries no physical fixture of its own', () => {
    // The shipped circuit planted posts at gate.halfWidth + 0.35, INSIDE the
    // 5.5 road half-width: solid obstacles on the racing surface. Recovery
    // anchors are pure sim geometry, so a gate record describes a crossing band and
    // nothing a racer can hit; only the start line gets a built fixture.
    for (const gate of gates) {
      expect(Object.keys(gate).sort()).toEqual(
        ['dirX', 'dirZ', 'halfWidth', 'index', 's', 'x', 'z'].sort(),
      );
      // The crossing band stays well inside the water's edge, so a gate is
      // always something a racer crosses on drivable ground.
      expect(gate.halfWidth).toBeLessThan(rallyBasinEdgeOffsetAt(gate.s));
    }
  });

  it('orders the recovery anchors by arc length, starting on the finish line', () => {
    expect(gates).toHaveLength(REALM_RACERS_GATE_FRACTIONS.length);
    expect(gates.map((gate) => gate.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(gates[0].s).toBe(0);
    for (let i = 1; i < gates.length; i++) expect(gates[i].s).toBeGreaterThan(gates[i - 1].s);
    expect(gates[gates.length - 1].s).toBeLessThan(track.length);
  });

  it('parks every start slot on the road, behind the line, along the tangent', () => {
    expect(starts).toHaveLength(REALM_RACERS_GRID_SIZE);
    const line = track.pointAt(0);
    const grid = track.pointAt(track.length - REALM_RACERS_START_BACK);
    starts.forEach((slot, i) => {
      expect(isAtRealmRacers(slot)).toBe(true);
      const projection = track.project(slot.x, slot.z);
      // The row is symmetric about the centerline and evenly spaced, derived
      // rather than pinned, so a spacing edit is caught here.
      const expected = Math.abs(
        (i - (REALM_RACERS_GRID_SIZE - 1) / 2) * REALM_RACERS_START_SPACING,
      );
      expect(Math.abs(projection.lateral)).toBeCloseTo(expected, 2);
      expect(Math.abs(projection.lateral)).toBeLessThan(track.halfWidthAt(projection.s));
      // Behind the line: the remaining arc up to s = 0 is the authored setback.
      expect(track.length - projection.s).toBeCloseTo(REALM_RACERS_START_BACK, 1);
      expect(slot.facing).toBeCloseTo(Math.atan2(grid.tx, grid.tz), 6);
      // The grid sits on straight road, so it lines up with the finish line to
      // within a couple of degrees.
      expect(Math.abs(slot.facing - Math.atan2(line.tx, line.tz))).toBeLessThan(0.04);
      expect(slot.facing).toBe(starts[0].facing);
    });
  });

  // Derived from the spacing, the hull radius and the width bands rather than
  // pinned as numbers, so tightening the grid fails the test instead of quietly
  // parking the outer machine on the grass or inside its neighbour.
  it('fits the whole row between the road edges with a real gap between hulls', () => {
    const bodyRadius = vehicleProfile('rally_loaner').bodyRadius;
    // No two hulls overlap, and none of them merely touches.
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const apart = Math.hypot(starts[i].x - starts[j].x, starts[i].z - starts[j].z);
        expect(apart).toBeGreaterThan(2 * bodyRadius);
      }
    }
    expect(REALM_RACERS_START_SPACING - 2 * bodyRadius).toBeGreaterThan(0.5);
    // The outermost hull edge stays inside the LOCAL road half-width, which on
    // the start straight is the widest the circuit ever gets.
    for (const slot of starts) {
      const projection = track.project(slot.x, slot.z);
      expect(Math.abs(projection.lateral) + bodyRadius).toBeLessThan(
        track.halfWidthAt(projection.s),
      );
    }
  });

  it('accepts a forward crossing but rejects reverse, outside-width, and teleport skips', () => {
    const gate = gates[3];
    const forward = rallyGateCrossingFraction(
      { x: gate.x - gate.dirX, z: gate.z - gate.dirZ },
      { x: gate.x + gate.dirX, z: gate.z + gate.dirZ },
      gate,
    );
    expect(forward).not.toBeNull();
    expect(forward).toBeCloseTo(0.5, 5);
    expect(
      rallyGateCrossingFraction(
        { x: gate.x + gate.dirX, z: gate.z + gate.dirZ },
        { x: gate.x - gate.dirX, z: gate.z - gate.dirZ },
        gate,
      ),
    ).toBeNull();
    const normalX = -gate.dirZ;
    const normalZ = gate.dirX;
    const outside = gate.halfWidth + 0.5;
    expect(
      rallyGateCrossingFraction(
        {
          x: gate.x - gate.dirX + normalX * outside,
          z: gate.z - gate.dirZ + normalZ * outside,
        },
        {
          x: gate.x + gate.dirX + normalX * outside,
          z: gate.z + gate.dirZ + normalZ * outside,
        },
        gate,
      ),
    ).toBeNull();
    expect(
      rallyGateCrossingFraction(
        { x: gate.x - gate.dirX * 20, z: gate.z - gate.dirZ * 20 },
        { x: gate.x + gate.dirX * 20, z: gate.z + gate.dirZ * 20 },
        gate,
      ),
    ).toBeNull();
  });
});
