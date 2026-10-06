import { describe, expect, it } from 'vitest';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
} from '../src/sim/content/mortar_overdrive/circuits';
import { vehicleProfile } from '../src/sim/content/vehicles';
import { DUNGEON_OVERFLOW_X_BASE, YUMI_BAND_X_MAX } from '../src/sim/data';
import {
  isAtMortarOverdrive,
  MORTAR_OVERDRIVE_BAND_X_MAX,
  MORTAR_OVERDRIVE_BAND_X_MIN,
  MORTAR_OVERDRIVE_GATE_MARGIN,
  MORTAR_OVERDRIVE_GRID_SIZE,
  MORTAR_OVERDRIVE_LANES,
  MORTAR_OVERDRIVE_MIN_GATES,
  MORTAR_OVERDRIVE_ORIGIN,
  MORTAR_OVERDRIVE_RUNOFF_WIDTH,
  MORTAR_OVERDRIVE_VERGE_MARGIN,
  mortarOverdriveGateCrossingFraction,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOrigin,
} from '../src/sim/mortar_overdrive/layout';
import { MORTAR_OVERDRIVE_NITRO_SPEED_MULT } from '../src/sim/mortar_overdrive/pickup_effects';
import { MORTAR_OVERDRIVE_VEHICLE_KEY } from '../src/sim/mortar_overdrive/race';
import { MORTAR_OVERDRIVE_SLICK_SLIP_CAP } from '../src/sim/mortar_overdrive/slicks';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveGates,
  mortarOverdriveStarts,
  mortarOverdriveTrack,
} from '../src/sim/mortar_overdrive/spline';
import { TICK_RATE } from '../src/sim/types';

const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
const gates = mortarOverdriveGates(GARDEN_CIRCUIT);
const starts = mortarOverdriveStarts(GARDEN_CIRCUIT);

describe('Mortar Overdrive recovery gates', () => {
  it('over-covers the road at every gate (the 4.8-vs-5.5 recovery bug)', () => {
    // The shipped circuit banded gates NARROWER than the road, so a racer
    // hugging the outer edge crossed the road without crossing the gate and
    // silently missed the recovery anchor.
    for (const gate of gates) {
      expect(gate.halfWidth).toBeGreaterThanOrEqual(
        track.halfWidthAt(gate.s) + MORTAR_OVERDRIVE_GATE_MARGIN,
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
      expect(gate.halfWidth).toBeLessThan(
        mortarOverdriveGardenEdgeOffsetAt(GARDEN_CIRCUIT, gate.s),
      );
    }
  });

  it('orders the recovery anchors by arc length, starting on the finish line', () => {
    expect(gates.length).toBeGreaterThanOrEqual(MORTAR_OVERDRIVE_MIN_GATES);
    expect(gates.map((gate) => gate.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(gates[0].s).toBe(0);
    for (let i = 1; i < gates.length; i++) expect(gates[i].s).toBeGreaterThan(gates[i - 1].s);
    expect(gates[gates.length - 1].s).toBeLessThan(track.length);
  });

  it('parks every start slot on the road, behind the line, along the tangent', () => {
    expect(starts).toHaveLength(MORTAR_OVERDRIVE_GRID_SIZE);
    const line = track.pointAt(0);
    const grid = track.pointAt(track.length - GARDEN_CIRCUIT.startBack);
    starts.forEach((slot, i) => {
      expect(isAtMortarOverdrive(slot)).toBe(true);
      const projection = track.project(slot.x, slot.z);
      // The row is symmetric about the centerline and evenly spaced, derived
      // rather than pinned, so a spacing edit is caught here.
      const expected = Math.abs(
        (i - (MORTAR_OVERDRIVE_GRID_SIZE - 1) / 2) * GARDEN_CIRCUIT.startSpacing,
      );
      expect(Math.abs(projection.lateral)).toBeCloseTo(expected, 2);
      expect(Math.abs(projection.lateral)).toBeLessThan(track.halfWidthAt(projection.s));
      // Behind the line: the remaining arc up to s = 0 is the authored setback.
      expect(track.length - projection.s).toBeCloseTo(GARDEN_CIRCUIT.startBack, 1);
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
    const bodyRadius = vehicleProfile('mo_loaner').bodyRadius;
    // No two hulls overlap, and none of them merely touches.
    for (let i = 0; i < starts.length; i++) {
      for (let j = i + 1; j < starts.length; j++) {
        const apart = Math.hypot(starts[i].x - starts[j].x, starts[i].z - starts[j].z);
        expect(apart).toBeGreaterThan(2 * bodyRadius);
      }
    }
    expect(GARDEN_CIRCUIT.startSpacing - 2 * bodyRadius).toBeGreaterThan(0.5);
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
    const forward = mortarOverdriveGateCrossingFraction(
      { x: gate.x - gate.dirX, z: gate.z - gate.dirZ },
      { x: gate.x + gate.dirX, z: gate.z + gate.dirZ },
      gate,
    );
    expect(forward).not.toBeNull();
    expect(forward).toBeCloseTo(0.5, 5);
    expect(
      mortarOverdriveGateCrossingFraction(
        { x: gate.x + gate.dirX, z: gate.z + gate.dirZ },
        { x: gate.x - gate.dirX, z: gate.z - gate.dirZ },
        gate,
      ),
    ).toBeNull();
    const normalX = -gate.dirZ;
    const normalZ = gate.dirX;
    const outside = gate.halfWidth + 0.5;
    expect(
      mortarOverdriveGateCrossingFraction(
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
      mortarOverdriveGateCrossingFraction(
        { x: gate.x - gate.dirX * 20, z: gate.z - gate.dirZ * 20 },
        { x: gate.x + gate.dirX * 20, z: gate.z + gate.dirZ * 20 },
        gate,
      ),
    ).toBeNull();
  });

  it('still detects a crossing at the fastest displacement a race can produce', () => {
    // Nitro forward speed with an oil-raised slip ceiling is the fastest a
    // machine legally moves in one tick. The plausibility cap must sit ABOVE
    // it, or every gate crossed in that state is silently missed and the
    // recovery anchor goes a whole lap stale.
    const profile = vehicleProfile(MORTAR_OVERDRIVE_VEHICLE_KEY);
    const perTick =
      Math.hypot(
        profile.maxSpeed * MORTAR_OVERDRIVE_NITRO_SPEED_MULT,
        profile.maxSlip * MORTAR_OVERDRIVE_SLICK_SLIP_CAP,
      ) / TICK_RATE;
    expect(perTick).toBeGreaterThan(4); // the old cap, kept as the regression witness
    const gate = gates[3];
    const half = perTick / 2;
    const crossing = mortarOverdriveGateCrossingFraction(
      { x: gate.x - gate.dirX * half, z: gate.z - gate.dirZ * half },
      { x: gate.x + gate.dirX * half, z: gate.z + gate.dirZ * half },
      gate,
    );
    expect(crossing).not.toBeNull();
  });

  it('covers the whole legal racing surface with the crossing band', () => {
    // The verge and the run-off are legitimate road: a racer shoved wide on a
    // straight still crosses the gate plane there, and missing it leaves no
    // later gate to resync on. The band must reach at least as far as the
    // surface the referee treats as on-track.
    const gate = gates[3];
    const surfaceEdge =
      track.halfWidthAt(gate.s) + MORTAR_OVERDRIVE_VERGE_MARGIN + MORTAR_OVERDRIVE_RUNOFF_WIDTH;
    const normalX = -gate.dirZ;
    const normalZ = gate.dirX;
    const wide = surfaceEdge - 0.25;
    expect(
      mortarOverdriveGateCrossingFraction(
        { x: gate.x - gate.dirX + normalX * wide, z: gate.z - gate.dirZ + normalZ * wide },
        { x: gate.x + gate.dirX + normalX * wide, z: gate.z + gate.dirZ + normalZ * wide },
        gate,
      ),
    ).not.toBeNull();
  });
});

describe('Mortar Overdrive band window', () => {
  it('matches the gap the neighbouring instance bands actually leave', () => {
    // The two edges are authored in `mortar_overdrive/layout.ts` rather than
    // imported, because `data.ts` reaches the whole content tree and that file
    // is a leaf the spline and the renderer both sit on. This is what keeps the
    // authored pair honest: move a neighbouring band and it fails HERE rather
    // than by letting a circuit's region overlap someone else's instances.
    expect(MORTAR_OVERDRIVE_BAND_X_MIN).toBe(YUMI_BAND_X_MAX);
    // The overflow dungeon band's own guard (`instanceAt` claims x from
    // `DUNGEON_OVERFLOW_X_BASE - 300`).
    expect(MORTAR_OVERDRIVE_BAND_X_MAX).toBe(DUNGEON_OVERFLOW_X_BASE - 300);
    // And the band the circuits are authored around really is inside it.
    expect(MORTAR_OVERDRIVE_ORIGIN.x).toBeGreaterThan(MORTAR_OVERDRIVE_BAND_X_MIN);
    expect(MORTAR_OVERDRIVE_ORIGIN.x).toBeLessThan(MORTAR_OVERDRIVE_BAND_X_MAX);
  });

  it('answers the open world before any lane lookup, without cutting into a lane', () => {
    // The lane test short-circuits on the band's x window: off it there is no
    // lane, and every lane's own x window still answers at both of its edges.
    for (const lane of MORTAR_OVERDRIVE_LANES) {
      const at = mortarOverdriveLaneOrigin(lane.index);
      expect(mortarOverdriveLaneAt(at.x, at.z)).toBe(lane);
      expect(mortarOverdriveLaneAt(at.x - lane.circuit.regionHalfX, at.z)).toBe(lane);
      expect(mortarOverdriveLaneAt(at.x + lane.circuit.regionHalfX, at.z)).toBe(lane);
      expect(mortarOverdriveLaneAt(MORTAR_OVERDRIVE_BAND_X_MIN - 0.01, at.z)).toBeNull();
      expect(mortarOverdriveLaneAt(MORTAR_OVERDRIVE_BAND_X_MAX + 0.01, at.z)).toBeNull();
      expect(mortarOverdriveLaneAt(0, at.z)).toBeNull();
    }
  });

  it('leaves every shipped circuit region inside it', () => {
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      expect(MORTAR_OVERDRIVE_ORIGIN.x - circuit.regionHalfX, circuit.id).toBeGreaterThanOrEqual(
        MORTAR_OVERDRIVE_BAND_X_MIN,
      );
      expect(MORTAR_OVERDRIVE_ORIGIN.x + circuit.regionHalfX, circuit.id).toBeLessThanOrEqual(
        MORTAR_OVERDRIVE_BAND_X_MAX,
      );
    }
  });
});
