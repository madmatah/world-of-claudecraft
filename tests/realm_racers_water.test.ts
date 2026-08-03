// The infield water, once it stopped being a mechanic AND stopped being derived.
//
// It has been four things: a lake deep enough to stop a racer, then a
// containment line wearing water or a hedge, then a stepwise table saying which
// spans of the shore line carried a pond, and now placed decoration. Track
// limits are a REFEREE (`tests/realm_racers_track_limits.test.ts`), the garden
// is open and drivable to the perimeter on both sides, and a pond is a shape an
// author put somewhere.
//
// So this suite pins the DERIVATION and the FEEL, and nothing about fairness:
// where the shore line sits now that nothing is cut along it, what a pond's
// outline is, and which slow band a racer standing somewhere is charged.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
  realmRacersLaneOffset,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import { realmRacersPlacedPonds } from '../src/sim/realm_racers_props_resolve';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_VERGE_BAND,
  realmRacersOffTrackBand,
  realmRacersOnTrack,
} from '../src/sim/social/realm_racers';

const SEED = 42;

/** The projection shape `offTrackBand` reads, built at a chosen offset off a
 *  sample so a case can name the lateral it means. */
function probe(circuit: RealmRacersCircuit, index: number, lateral: number) {
  const sample = realmRacersTrack(circuit).samples[index];
  return {
    index,
    s: sample.s,
    lateral,
    tangentX: sample.tx,
    tangentZ: sample.tz,
  };
}

describe('Realm Racers water: the shore line carries none of it any more', () => {
  it('covers every shipped circuit, and every one of them places its water', () => {
    // The cardinality floor for everything below: an `it.each` over a list that
    // quietly emptied registers no cases at all.
    expect(REALM_RACERS_CIRCUIT_LIST).toHaveLength(2);
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      expect((circuit.ponds?.length ?? 0) > 0, circuit.id).toBe(true);
      // The record's own IFF: water is placed, and the bank profile exists
      // exactly where something is made of it.
      expect(Boolean(circuit.basin), circuit.id).toBe(true);
    }
  });

  it.each(REALM_RACERS_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s puts its one lateral boundary at the road plus its two off-track bands',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      for (const sample of track.samples) {
        // Exactly, not approximately: the garden edge IS that sum, and a
        // tolerance here would hide a re-association of it.
        expect(rallyGardenEdgeOffsetAt(circuit, sample.s)).toBe(
          track.halfWidthAt(sample.s) + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH,
        );
      }
    },
  );

  it.each(REALM_RACERS_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s charges every band the distance deserves, road out to open garden',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const seen = new Set<string>();
      for (let i = 0; i < track.samples.length; i += 5) {
        const sample = track.samples[i];
        const edge = rallyGardenEdgeOffsetAt(circuit, sample.s);
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
          const band = realmRacersOffTrackBand(circuit, probe(circuit, i, lateral));
          const over = Math.abs(lateral) - sample.halfWidth;
          const expected =
            over <= REALM_RACERS_VERGE_MARGIN
              ? null
              : over <= REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH
                ? REALM_RACERS_VERGE_BAND.name
                : REALM_RACERS_GARDEN_BAND.name;
          expect(band?.name ?? null, `sample ${i} at ${lateral}`).toBe(expected);
          seen.add(band?.name ?? 'road');
        }
      }
      // All three outcomes really were exercised, or the agreement above is
      // agreement about one arm. Three, not four: the wading band is gone with
      // the water it charged for, and the offsets above deliberately still
      // probe well past the garden edge, which is where it used to be charged.
      expect(seen).toEqual(
        new Set(['road', REALM_RACERS_VERGE_BAND.name, REALM_RACERS_GARDEN_BAND.name]),
      );
    },
  );

  it('charges the garden band inside a pond, because a pond is decoration', () => {
    // The v1 decision, pinned where it can be read: a machine drives through
    // water exactly as it drives over the lawn around it. It cost speed and
    // grip while the depth was the only thing keeping anyone out of the
    // infield; the referee does that job now.
    const track = realmRacersTrack(GARDEN);
    const pond = realmRacersPlacedPonds(GARDEN)[0];
    let inside = 0;
    for (let i = 0; i < track.samples.length; i++) {
      const sample = track.samples[i];
      for (const offset of [20, 30, 40, 50]) {
        const x = sample.x - REALM_RACERS_ORIGIN.x - sample.tz * offset;
        const z = sample.z - REALM_RACERS_ORIGIN.z + sample.tx * offset;
        if (!polygonContainsPoint(pond.outline, x, z)) continue;
        inside++;
        expect(realmRacersOffTrackBand(GARDEN, probe(GARDEN, i, offset))?.name).toBe(
          REALM_RACERS_GARDEN_BAND.name,
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
    expect(realmRacersOnTrack(null)).toBe(true);
    expect(realmRacersOnTrack(REALM_RACERS_VERGE_BAND)).toBe(true);
    expect(realmRacersOnTrack(REALM_RACERS_GARDEN_BAND)).toBe(false);
  });
});

describe('Realm Racers water: what a placed pond derives', () => {
  it.each(REALM_RACERS_CIRCUIT_LIST.map((circuit) => [circuit.id, circuit] as const))(
    '%s keeps every pond clear of the ground the race is run on',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const ponds = realmRacersPlacedPonds(circuit);
      expect(ponds.length).toBeGreaterThan(0);
      for (const pond of ponds) {
        for (const point of pond.outline) {
          const projection = track.project(
            point.x + REALM_RACERS_ORIGIN.x,
            point.z + REALM_RACERS_ORIGIN.z,
          );
          expect(Math.abs(projection.lateral)).toBeGreaterThan(
            rallyGardenEdgeOffsetAt(circuit, projection.s),
          );
        }
      }
    },
  );

  it('closes each outline and reports the radius that bounds it', () => {
    for (const pond of realmRacersPlacedPonds(GARDEN)) {
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
      realmRacersPlacedPonds({
        ...GARDEN,
        id,
        ponds: [{ x: 0, z: 0, rx: 12, rz: 9, seed }],
      })[0].outline;
    expect(of(3, 'pond_seed_a')).toEqual(of(3, 'pond_seed_b'));
    expect(of(3, 'pond_seed_c')).not.toEqual(of(4, 'pond_seed_d'));
  });

  it('has no water at all on a circuit that places none', () => {
    const DRY: RealmRacersCircuit = {
      ...GARDEN,
      id: 'water_dry_circuit',
      ponds: undefined,
      basin: undefined,
    };
    expect(realmRacersPlacedPonds(DRY)).toEqual([]);
  });
});

describe('Realm Racers water: the collision entry point contains nobody', () => {
  it('leaves a racer out in the middle of the infield exactly where they are', () => {
    // The whole of 16b in one assertion. `resolvePosition` used to clamp a racer
    // back onto the containment line here; the garden is open now, on BOTH
    // sides, so a machine blasted into the lake keeps going and rejoins wherever
    // it can. Run over the SHIPPED circuits at their real lanes rather than over
    // a fixture, because the entry point resolves which circuit it is against
    // off the LANE table.
    let probed = 0;
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      const track = realmRacersTrack(circuit);
      const lane = realmRacersLaneOffset(realmRacersPublicLane(circuit));
      for (let i = 0; i < track.samples.length; i += 7) {
        const sample = track.samples[i];
        for (const offset of [
          rallyGardenEdgeOffsetAt(circuit, sample.s) + 3,
          rallyGardenEdgeOffsetAt(circuit, sample.s) + 25,
          -(sample.halfWidth + 9),
        ]) {
          const x = sample.x - sample.tz * offset + lane.x;
          const z = sample.z + sample.tx * offset + lane.z;
          const resolved = resolvePosition(SEED, x, z, 0.5);
          expect(
            Math.hypot(resolved.x - x, resolved.z - z),
            `${circuit.id} sample ${i} at ${offset.toFixed(1)}`,
          ).toBeLessThan(1e-6);
          probed++;
        }
      }
    }
    expect(probed).toBeGreaterThan(300);
  });

  it('still closes the garden at the perimeter wall, which is the ONLY thing that does', () => {
    // Vacuity guard for the case above: something in this region must still
    // push, or "nothing stopped the racer" would prove nothing (the region once
    // short-circuited to `return { x, z }` and collided with nothing at all).
    const express = realmRacersCompetitionCircuits()[0];
    const lane = realmRacersLaneOffset(realmRacersPublicLane(express));
    const origin = { x: REALM_RACERS_ORIGIN.x + lane.x, z: REALM_RACERS_ORIGIN.z + lane.z };
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
