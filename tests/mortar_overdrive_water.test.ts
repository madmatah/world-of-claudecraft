// The infield water, once it stopped being a mechanic AND stopped being derived.
//
// It has been four things: a lake deep enough to stop a racer, then a
// containment line wearing water or a hedge, then a stepwise table saying which
// spans of the shore line carried a pond, and now placed decoration. Track
// limits are a REFEREE (`tests/mortar_overdrive_track_limits.test.ts`), the garden
// is open and drivable to the perimeter on both sides, and a pond is a shape an
// author put somewhere.
//
// So this suite pins the DERIVATION and the FEEL, and nothing about fairness:
// where the shore line sits now that nothing is cut along it, what a pond's
// outline is, and which slow band a racer standing somewhere is charged.

import { describe, expect, it } from 'vitest';
import { suggestGroundOutline } from '../src/editor/circuit/envelope_core';
import {
  MORTAR_OVERDRIVE_SEA_BASIN,
  mortarOverdriveSeaBasin,
  mortarOverdriveSeaMesh,
  mortarOverdriveShoreSpots,
} from '../src/render/mortar_overdrive/track_core';
import { resolvePosition } from '../src/sim/colliders';
import {
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN,
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  type MortarOverdriveCircuit,
  mortarOverdriveCompetitionCircuits,
} from '../src/sim/content/mortar_overdrive/circuits';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import { mortarOverdriveFenceRuns } from '../src/sim/mortar_overdrive/fences';
import { mortarOverdriveGroundShape } from '../src/sim/mortar_overdrive/ground';
import {
  MORTAR_OVERDRIVE_LAWN_OVERSHOOT,
  MORTAR_OVERDRIVE_ORIGIN,
  MORTAR_OVERDRIVE_RUNOFF_WIDTH,
  MORTAR_OVERDRIVE_VERGE_MARGIN,
  mortarOverdriveLaneOffset,
  mortarOverdrivePublicLane,
} from '../src/sim/mortar_overdrive/layout';
import {
  mortarOverdriveFootprintRadius,
  mortarOverdrivePlacedPonds,
  mortarOverdrivePlacedProps,
} from '../src/sim/mortar_overdrive/props_resolve';
import {
  MORTAR_OVERDRIVE_GARDEN_BAND,
  MORTAR_OVERDRIVE_VERGE_BAND,
  mortarOverdriveOffTrackBand,
  mortarOverdriveOnTrack,
} from '../src/sim/mortar_overdrive/race';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveTrack,
} from '../src/sim/mortar_overdrive/spline';

const SEED = 42;

/** The projection shape `offTrackBand` reads, built at a chosen offset off a
 *  sample so a case can name the lateral it means. */
function probe(circuit: MortarOverdriveCircuit, index: number, lateral: number) {
  const sample = mortarOverdriveTrack(circuit).samples[index];
  return {
    index,
    s: sample.s,
    lateral,
    tangentX: sample.tx,
    tangentZ: sample.tz,
  };
}

describe('Mortar Overdrive water: the shore line carries none of it any more', () => {
  it('covers every shipped circuit, and every one but the dry Rampart Run places its water', () => {
    // The cardinality floor for everything below: an `it.each` over a list that
    // quietly emptied registers no cases at all.
    expect(MORTAR_OVERDRIVE_CIRCUIT_LIST).toHaveLength(5);
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      // The Drakelands Rampart Run is the one DRY circuit, which the record
      // allows: the waste's melt is lava, a modelled solid piece, and a
      // circuit's water is decoration it may leave out altogether.
      const dry = circuit.id === 'drakelands_rampart_run';
      expect((circuit.ponds?.length ?? 0) > 0, circuit.id).toBe(!dry);
      // The record's own IFF: water is placed, and the bank profile exists
      // exactly where something is made of it.
      expect(Boolean(circuit.basin), circuit.id).toBe(!dry);
    }
  });

  it.each(MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s puts its one lateral boundary at the road plus its two off-track bands',
    (_id, circuit) => {
      const track = mortarOverdriveTrack(circuit);
      for (const sample of track.samples) {
        // Exactly, not approximately: the garden edge IS that sum, and a
        // tolerance here would hide a re-association of it.
        expect(mortarOverdriveGardenEdgeOffsetAt(circuit, sample.s)).toBe(
          track.halfWidthAt(sample.s) +
            MORTAR_OVERDRIVE_VERGE_MARGIN +
            MORTAR_OVERDRIVE_RUNOFF_WIDTH,
        );
      }
    },
  );

  it.each(MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s charges every band the distance deserves, road out to open garden',
    (_id, circuit) => {
      const track = mortarOverdriveTrack(circuit);
      const seen = new Set<string>();
      for (let i = 0; i < track.samples.length; i += 5) {
        const sample = track.samples[i];
        const edge = mortarOverdriveGardenEdgeOffsetAt(circuit, sample.s);
        for (const lateral of [
          0,
          sample.halfWidth + 0.5,
          sample.halfWidth + 3,
          sample.halfWidth + 6,
          edge - 0.5,
          edge + 0.5,
          edge + 3,
          -(sample.halfWidth + 6),
        ]) {
          const band = mortarOverdriveOffTrackBand(circuit, probe(circuit, i, lateral));
          const over = Math.abs(lateral) - sample.halfWidth;
          const expected =
            over <= MORTAR_OVERDRIVE_VERGE_MARGIN
              ? null
              : over <= MORTAR_OVERDRIVE_VERGE_MARGIN + MORTAR_OVERDRIVE_RUNOFF_WIDTH
                ? MORTAR_OVERDRIVE_VERGE_BAND.name
                : MORTAR_OVERDRIVE_GARDEN_BAND.name;
          expect(band?.name ?? null, `sample ${i} at ${lateral}`).toBe(expected);
          seen.add(band?.name ?? 'road');
        }
      }
      // All three outcomes really were exercised, or the agreement above is
      // agreement about one arm. Three, not four: the wading band is gone with
      // the water it charged for, and the offsets above deliberately still
      // probe well past the garden edge, which is where it used to be charged.
      expect(seen).toEqual(
        new Set(['road', MORTAR_OVERDRIVE_VERGE_BAND.name, MORTAR_OVERDRIVE_GARDEN_BAND.name]),
      );
    },
  );

  it('charges the garden band inside a pond, because a pond is decoration', () => {
    // The v1 decision, pinned where it can be read: a machine drives through
    // water exactly as it drives over the lawn around it. It cost speed and
    // grip while the depth was the only thing keeping anyone out of the
    // infield; the referee does that job now.
    const track = mortarOverdriveTrack(GARDEN);
    const pond = mortarOverdrivePlacedPonds(GARDEN)[0];
    let inside = 0;
    for (let i = 0; i < track.samples.length; i++) {
      const sample = track.samples[i];
      for (const offset of [20, 30, 40, 50]) {
        const x = sample.x - MORTAR_OVERDRIVE_ORIGIN.x - sample.tz * offset;
        const z = sample.z - MORTAR_OVERDRIVE_ORIGIN.z + sample.tx * offset;
        if (!polygonContainsPoint(pond.outline, x, z)) continue;
        inside++;
        expect(mortarOverdriveOffTrackBand(GARDEN, probe(GARDEN, i, offset))?.name).toBe(
          MORTAR_OVERDRIVE_GARDEN_BAND.name,
        );
      }
    }
    // The probe really did reach the water, or the case above is about points
    // that are nowhere near a pond.
    expect(inside).toBeGreaterThan(10);
  });

  it('counts the road and its verge as ON TRACK, and everything past them as off', () => {
    // The referee's own on/off question, and the reason clipping an apex is
    // ordinary racing: every lap clips one, so an excursion that armed inside
    // the verge would arm on every corner of every lap.
    expect(mortarOverdriveOnTrack(null)).toBe(true);
    expect(mortarOverdriveOnTrack(MORTAR_OVERDRIVE_VERGE_BAND)).toBe(true);
    expect(mortarOverdriveOnTrack(MORTAR_OVERDRIVE_GARDEN_BAND)).toBe(false);
  });
});

describe('Mortar Overdrive water: what a placed pond derives', () => {
  // Every circuit that places water: all of them but the dry Rampart Run, which
  // the case above pins by name.
  const WET = MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((circuit) => (circuit.ponds?.length ?? 0) > 0);
  it('measures the ponds of every wet circuit', () => {
    expect(WET.map((circuit) => circuit.id)).toEqual(
      MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.id !== 'drakelands_rampart_run').map(
        (c) => c.id,
      ),
    );
  });

  it.each(WET.map((circuit) => [circuit.id, circuit] as const))(
    '%s keeps every pond clear of the ground the race is run on',
    (_id, circuit) => {
      const track = mortarOverdriveTrack(circuit);
      const ponds = mortarOverdrivePlacedPonds(circuit);
      expect(ponds.length).toBeGreaterThan(0);
      for (const pond of ponds) {
        for (const point of pond.outline) {
          const projection = track.project(
            point.x + MORTAR_OVERDRIVE_ORIGIN.x,
            point.z + MORTAR_OVERDRIVE_ORIGIN.z,
          );
          expect(Math.abs(projection.lateral)).toBeGreaterThan(
            mortarOverdriveGardenEdgeOffsetAt(circuit, projection.s),
          );
        }
      }
    },
  );

  it('closes each outline and reports the radius that bounds it', () => {
    for (const pond of mortarOverdrivePlacedPonds(GARDEN)) {
      expect(pond.outline.length).toBeGreaterThan(16);
      // The first point is NOT repeated: every consumer closes the ring itself,
      // and a duplicated point would put a zero-length edge in the mesh.
      const first = pond.outline[0];
      const last = pond.outline[pond.outline.length - 1];
      expect(Math.hypot(first.x - last.x, first.z - last.z)).toBeGreaterThan(0.01);
      for (const point of pond.outline) {
        expect(Math.hypot(point.x - pond.x, point.z - pond.z)).toBeLessThanOrEqual(
          pond.radius + 1e-9,
        );
      }
      expect(polygonContainsPoint(pond.outline, pond.x, pond.z)).toBe(true);
    }
  });

  it('derives the same water twice, and different water from a different seed', () => {
    const of = (seed: number, id: string) =>
      mortarOverdrivePlacedPonds({
        ...GARDEN,
        id,
        ponds: [{ x: 0, z: 0, rx: 12, rz: 9, seed }],
      })[0].outline;
    expect(of(3, 'pond_seed_a')).toEqual(of(3, 'pond_seed_b'));
    expect(of(3, 'pond_seed_c')).not.toEqual(of(4, 'pond_seed_d'));
  });

  it('has no water at all on a circuit that places none', () => {
    const DRY: MortarOverdriveCircuit = {
      ...GARDEN,
      id: 'water_dry_circuit',
      ponds: undefined,
      basin: undefined,
    };
    expect(mortarOverdrivePlacedPonds(DRY)).toEqual([]);
  });
});

describe('Mortar Overdrive water: the sea outside an authored shore', () => {
  const ISLAND: MortarOverdriveCircuit = {
    ...GARDEN,
    id: 'water_island',
    groundOutline: suggestGroundOutline(GARDEN),
  };

  it('draws none at all where the land is the rectangle it has always been', () => {
    // The default ground covers the region and then some, so there is no shore
    // for a sea to lap at: every shipped circuit but the one island keeps
    // exactly its own pools.
    const mainland = MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.id !== 'palmreach_lagoon_run');
    expect(mainland).toHaveLength(MORTAR_OVERDRIVE_CIRCUIT_LIST.length - 1);
    for (const circuit of mainland) {
      expect(circuit.groundOutline, circuit.id).toBeUndefined();
      expect(mortarOverdriveSeaMesh(circuit), circuit.id).toBeNull();
      expect(mortarOverdriveShoreSpots(circuit), circuit.id).toEqual([]);
    }
  });

  it('draws the sea all round the one shipped island, on the bank its lagoon authors', () => {
    const lagoon = MORTAR_OVERDRIVE_CIRCUIT_LIST.find((c) => c.id === 'palmreach_lagoon_run');
    if (!lagoon) throw new Error('the Lagoon Run ships');
    expect(mortarOverdriveGroundShape(lagoon).authored).toBe(true);
    const sea = mortarOverdriveSeaMesh(lagoon);
    if (!sea) throw new Error('an authored shore has a sea outside it');
    expect(mortarOverdriveSeaBasin(lagoon)).toBe(lagoon.basin);
    expect(Math.min(...Array.from(sea.depths))).toBe(0);
    expect(Math.max(...Array.from(sea.depths))).toBeCloseTo(lagoon.basin?.depthMax ?? 0, 6);
    expect(mortarOverdriveShoreSpots(lagoon).length).toBeGreaterThan(0);
  });

  it('covers the ground from the shore out to the edge of the region', () => {
    const sea = mortarOverdriveSeaMesh(ISLAND);
    if (!sea) throw new Error('an authored shore has a sea outside it');
    const outline = mortarOverdriveGroundShape(ISLAND).outline;
    const reach = {
      x: ISLAND.regionHalfX + MORTAR_OVERDRIVE_LAWN_OVERSHOOT,
      z: ISLAND.regionHalfZ + MORTAR_OVERDRIVE_LAWN_OVERSHOOT,
    };
    let onShore = 0;
    let atTheEdge = 0;
    for (let i = 0; i < sea.depths.length; i++) {
      const x = sea.positions[i * 2] - MORTAR_OVERDRIVE_ORIGIN.x;
      const z = sea.positions[i * 2 + 1] - MORTAR_OVERDRIVE_ORIGIN.z;
      // Nothing reaches past the region, which is exactly as far as the lawn
      // used to run: a sea drawn wider would be water over empty band.
      expect(Math.abs(x), 'sea x').toBeLessThanOrEqual(reach.x + 1e-6);
      expect(Math.abs(z), 'sea z').toBeLessThanOrEqual(reach.z + 1e-6);
      if (sea.depths[i] === 0) onShore++;
      if (Math.abs(Math.abs(x) - reach.x) < 1e-6 || Math.abs(Math.abs(z) - reach.z) < 1e-6) {
        atTheEdge++;
      }
    }
    // The innermost ring IS the shore (a vertex per column at zero depth), and
    // the outermost really does reach the region: both ends present, or the
    // sheet is a band floating between them.
    expect(onShore).toBe(sea.columns);
    expect(atTheEdge).toBeGreaterThanOrEqual(sea.columns);
    // Every column sits ON the outline at the shore, so the water meets the land
    // rather than starting a few yards off it.
    for (let col = 0; col < sea.columns; col++) {
      const x = sea.positions[col * 2] - MORTAR_OVERDRIVE_ORIGIN.x;
      const z = sea.positions[col * 2 + 1] - MORTAR_OVERDRIVE_ORIGIN.z;
      const on = outline.some((point) => Math.hypot(point.x - x, point.z - z) < 1e-9);
      expect(on, `sea column ${col} is on the shore`).toBe(true);
    }
  });

  it('ramps the shore down the basin the circuit authored, to the depth it authored', () => {
    const sea = mortarOverdriveSeaMesh(ISLAND);
    if (!sea) throw new Error('an authored shore has a sea outside it');
    const basin = GARDEN.basin;
    if (!basin) throw new Error('the garden circuit authors its basin');
    expect(mortarOverdriveSeaBasin(ISLAND)).toBe(basin);
    const depths = Array.from(sea.depths);
    expect(Math.min(...depths)).toBe(0);
    // The floor is the basin's, never deeper: the same clamp a pond takes.
    expect(Math.max(...depths)).toBeCloseTo(basin.depthMax, 6);
    // And the ramp is the authored SLOPE rather than a shape of its own: a
    // vertex a yard off the shore is a yard's worth of bank under it.
    for (let col = 0; col < sea.columns; col++) {
      const shoreX = sea.positions[col * 2];
      const shoreZ = sea.positions[col * 2 + 1];
      for (let ring = 1; ring <= sea.rings; ring++) {
        const v = ring * sea.columns + col;
        const out = Math.hypot(sea.positions[v * 2] - shoreX, sea.positions[v * 2 + 1] - shoreZ);
        expect(sea.depths[v], `column ${col} ring ${ring}`).toBeCloseTo(
          Math.min(basin.depthMax, basin.bankSlope * out),
          6,
        );
      }
    }
  });

  it('falls back to a bank profile on an island that authors no pond at all', () => {
    // The record's basin rule is an iff with the PONDS, so a circuit may draw a
    // shore and author no basin. The water still has to be shaded by something,
    // and the fallback is the profile every pond in the game already uses rather
    // than a number invented for the case.
    const dry: MortarOverdriveCircuit = {
      ...ISLAND,
      id: 'water_island_dry',
      ponds: undefined,
      basin: undefined,
    };
    expect(mortarOverdriveSeaBasin(dry)).toBe(MORTAR_OVERDRIVE_SEA_BASIN);
    expect(MORTAR_OVERDRIVE_SEA_BASIN).toEqual(GARDEN.basin);
    const sea = mortarOverdriveSeaMesh(dry);
    if (!sea) throw new Error('a shore has a sea whether or not a pond does');
    expect(Math.max(...Array.from(sea.depths))).toBeCloseTo(MORTAR_OVERDRIVE_SEA_BASIN.depthMax, 6);
  });

  it('plants the shore with scattered clumps rather than a tiled line', () => {
    const spots = mortarOverdriveShoreSpots(ISLAND);
    expect(spots.length).toBeGreaterThan(20);
    const outline = mortarOverdriveGroundShape(ISLAND).outline;
    const offsets = spots.map((spot) => {
      let best = Number.POSITIVE_INFINITY;
      for (const point of outline) {
        best = Math.min(
          best,
          Math.hypot(
            point.x - (spot.x - MORTAR_OVERDRIVE_ORIGIN.x),
            point.z - (spot.z - MORTAR_OVERDRIVE_ORIGIN.z),
          ),
        );
      }
      return best;
    });
    // Off the line, by different amounts: a straight module cannot follow a
    // curve, which is the whole reason a shore is scattered and a fence is not.
    expect(Math.max(...offsets)).toBeGreaterThan(0.5);
    expect(new Set(offsets.map((offset) => offset.toFixed(3))).size).toBeGreaterThan(5);
    // Off it on the WATER side only. A clump is anchored at the water's own
    // height, half a yard under the lawn, so one jittered inland stands sunk in
    // the grass: a reed bed grows at the waterline and out into the shallows.
    let inland = 0;
    for (const spot of spots) {
      if (
        polygonContainsPoint(
          outline,
          spot.x - MORTAR_OVERDRIVE_ORIGIN.x,
          spot.z - MORTAR_OVERDRIVE_ORIGIN.z,
        )
      ) {
        inland++;
      }
    }
    // Not zero: a clump ON the line is inside by an even-odd hair, and a bay
    // narrower than the jitter can put one back over the land. A quarter is far
    // under the half a two-sided jitter produced.
    expect(inland).toBeLessThan(spots.length / 4);
    // ...and the spacing is kept over a LONG segment rather than one clump per
    // segment however long: the shore of an island this size carries about its
    // own perimeter divided by the spacing.
    let perimeter = 0;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      perimeter += Math.hypot(b.x - a.x, b.z - a.z);
    }
    expect(spots.length).toBeGreaterThan((perimeter / 11) * 0.9);
    // Deterministic: the same shore plants the same clumps, on every host.
    expect(mortarOverdriveShoreSpots({ ...ISLAND, id: 'water_island_twin' })).toEqual(spots);
  });
});

describe('Mortar Overdrive water: the collision entry point contains nobody', () => {
  it('leaves a racer out in the middle of the infield exactly where they are', () => {
    // The whole of 16b in one assertion. `resolvePosition` used to clamp a racer
    // back onto the containment line here; the garden is open now, on BOTH
    // sides, so a machine blasted into the lake keeps going and rejoins wherever
    // it can. Run over the SHIPPED circuits at their real lanes rather than over
    // a fixture, because the entry point resolves which circuit it is against
    // off the LANE table.
    //
    // What it is NOT about is what an author PLACED. A probe landing inside a
    // solid piece of furniture, or inside a hedge, is moved by that piece, which
    // is what those pieces are for; the claim here is about a containment LINE,
    // something that pushes a machine back everywhere along the lap rather than
    // at one bench. So the sweep skips a point standing in one, hit-tested off
    // the same two resolvers the collision set is built from. It was written
    // when no shipped circuit dressed its lawn or drew a barrier, and read as
    // "nothing collides out here", which the first bench three yards past the
    // verge contradicted without anything having gone wrong.
    const MOVER_RADIUS = 0.5;
    let probed = 0;
    let skipped = 0;
    for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
      const track = mortarOverdriveTrack(circuit);
      const lane = mortarOverdriveLaneOffset(mortarOverdrivePublicLane(circuit));
      // Props as CIRCLES over their own reach, deliberately generous: this
      // decides what the sweep declines to judge, so over-covering costs a probe
      // and under-covering would report an author's hedge as a containment line.
      const authored = mortarOverdrivePlacedProps(circuit)
        .filter((prop) => prop.solid)
        .map((prop) => ({
          x: prop.x + MORTAR_OVERDRIVE_ORIGIN.x + lane.x,
          z: prop.z + MORTAR_OVERDRIVE_ORIGIN.z + lane.z,
          // The piece's own reach plus the mover's, since a body that OVERLAPS
          // one is pushed exactly as one standing in its centre is.
          r: mortarOverdriveFootprintRadius(prop.footprint) + MOVER_RADIUS,
        }));
      // Fences as SEGMENTS, which is the shape their collider actually has. A
      // circle over a run's length was generous enough for a hedge, and wrong
      // for a paling drawn round the whole enclosure: one such run is six
      // hundred yards long, and a circle over it swallows every probe on the
      // circuit, leaving the case agreeing about nothing.
      const fences = mortarOverdriveFenceRuns(circuit).map(({ run }) => ({
        ax: run.dax + MORTAR_OVERDRIVE_ORIGIN.x + lane.x,
        az: run.daz + MORTAR_OVERDRIVE_ORIGIN.z + lane.z,
        bx: run.dbx + MORTAR_OVERDRIVE_ORIGIN.x + lane.x,
        bz: run.dbz + MORTAR_OVERDRIVE_ORIGIN.z + lane.z,
        r: run.hd + MOVER_RADIUS,
      }));
      const nearFence = (x: number, z: number): boolean =>
        fences.some((fence) => {
          const dx = fence.bx - fence.ax;
          const dz = fence.bz - fence.az;
          const length2 = dx * dx + dz * dz;
          const t =
            length2 === 0
              ? 0
              : Math.max(0, Math.min(1, ((x - fence.ax) * dx + (z - fence.az) * dz) / length2));
          return Math.hypot(x - (fence.ax + dx * t), z - (fence.az + dz * t)) < fence.r;
        });
      for (let i = 0; i < track.samples.length; i += 7) {
        const sample = track.samples[i];
        for (const offset of [
          mortarOverdriveGardenEdgeOffsetAt(circuit, sample.s) + 3,
          mortarOverdriveGardenEdgeOffsetAt(circuit, sample.s) + 25,
          -(sample.halfWidth + 9),
        ]) {
          const x = sample.x - sample.tz * offset + lane.x;
          const z = sample.z + sample.tx * offset + lane.z;
          if (
            authored.some((piece) => Math.hypot(x - piece.x, z - piece.z) < piece.r) ||
            nearFence(x, z)
          ) {
            skipped++;
            continue;
          }
          const resolved = resolvePosition(SEED, x, z, MOVER_RADIUS);
          expect(
            Math.hypot(resolved.x - x, resolved.z - z),
            `${circuit.id} sample ${i} at ${offset.toFixed(1)}`,
          ).toBeLessThan(1e-6);
          probed++;
        }
      }
    }
    // Counts what was JUDGED, not what was walked, so the floor is the whole
    // non-vacuity guarantee whatever the skip does.
    expect(probed).toBeGreaterThan(300);
    // ...and the skip stays an exception rather than becoming the sweep. A hedge
    // maze on the infield is a legitimate handful (the Express Tour's eats about
    // one probe in thirteen); a lawn dressed densely enough to swallow most of
    // them would leave this case agreeing about the few points left over.
    expect(skipped).toBeLessThan(probed / 5);
  });

  it('still closes the garden at the perimeter wall, which is the ONLY thing that does', () => {
    // Vacuity guard for the case above: something in this region must still
    // push, or "nothing stopped the racer" would prove nothing (the region once
    // short-circuited to `return { x, z }` and collided with nothing at all).
    const express = mortarOverdriveCompetitionCircuits()[0];
    const lane = mortarOverdriveLaneOffset(mortarOverdrivePublicLane(express));
    const origin = { x: MORTAR_OVERDRIVE_ORIGIN.x + lane.x, z: MORTAR_OVERDRIVE_ORIGIN.z + lane.z };
    const inside = express.perimeter.halfX - 0.2;
    const pushed = resolvePosition(SEED, origin.x + inside, origin.z, 0.5);
    expect(pushed.x - origin.x).toBeLessThan(inside);
    for (const [dx, dz] of [
      [express.perimeter.halfX + 4, 0],
      [-express.perimeter.halfX - 4, 0],
      [0, express.perimeter.halfZ + 4],
      [0, -express.perimeter.halfZ - 4],
    ]) {
      const resolved = resolvePosition(SEED, origin.x + dx, origin.z + dz, 0.5);
      expect(Math.abs(resolved.x - origin.x)).toBeLessThanOrEqual(express.perimeter.halfX + 4);
      expect(Math.abs(resolved.z - origin.z)).toBeLessThanOrEqual(express.perimeter.halfZ + 4);
    }
  });
});
