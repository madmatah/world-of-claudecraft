// The infield water, once it stopped being a mechanic at all.
//
// It has been three things: a lake deep enough to stop a racer, then a
// containment line wearing water or a hedge, and now decoration. Track limits
// are a REFEREE (`tests/realm_racers_track_limits.test.ts`), the garden is open
// and drivable to the perimeter on both sides, and the only decision the shore
// line still carries is whether a span of it has a pond behind it.
//
// So this suite pins the DERIVATION and the FEEL, and nothing about fairness:
// where the shore sits, which spans carry water, one polygon per pond, and
// which slow band a racer standing somewhere is charged.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  RALLY_WATER_KINDS,
  type RallyWaterKind,
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
  realmRacersLaneOffset,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import {
  rallyBankDepthAt,
  rallyBasinDepthAt,
  rallyShoreOffsetAt,
  rallyWaterKindAt,
  realmRacersTrack,
  realmRacersWaterOutlines,
} from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WATER_BAND,
  realmRacersOffTrackBand,
  realmRacersOnTrack,
} from '../src/sim/social/realm_racers';

const SEED = 42;

/** Every shipped circuit with its water table REMOVED, which is the shape they
 *  all had before the field existed: one lake, all the way round. */
const DEFAULTS: readonly RealmRacersCircuit[] = REALM_RACERS_CIRCUIT_LIST.map((circuit) => ({
  ...circuit,
  id: `${circuit.id}_no_water_bands`,
  waterBands: undefined,
}));

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

const kindsOf = (circuit: RealmRacersCircuit): RallyWaterKind[] =>
  realmRacersTrack(circuit).samples.map((sample) => rallyWaterKindAt(circuit, sample.s));

describe('Realm Racers water: no water table means one lake all the way round', () => {
  it('covers every shipped circuit', () => {
    // The cardinality floor for everything below: an `it.each` over a list that
    // quietly emptied registers no cases at all.
    expect(DEFAULTS).toHaveLength(2);
    expect(DEFAULTS.every((circuit) => circuit.waterBands === undefined)).toBe(true);
  });

  it('names exactly the two kinds the record, the spline and the painter agree on', () => {
    // Pinned as a list rather than a length: a kind added to the union without
    // being added here reads back as `water` from every stepwise lookup, which
    // is a dry span that silently floods.
    expect(RALLY_WATER_KINDS).toEqual(['water', 'dry']);
  });

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s puts its shore at the road plus its whole apron, carrying water everywhere',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      for (const sample of track.samples) {
        // Exactly, not approximately: the shore IS that sum, and a tolerance
        // here would hide a re-association of it.
        expect(rallyShoreOffsetAt(circuit, sample.s)).toBe(
          track.halfWidthAt(sample.s) + track.apronAt(sample.s),
        );
        expect(rallyWaterKindAt(circuit, sample.s)).toBe('water');
      }
    },
  );

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s derives one water polygon, point for point the offset ring',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const ring = track.samples.map((sample) => {
        const offset = track.halfWidthAt(sample.s) + track.apronAt(sample.s);
        return { x: sample.x - sample.tz * offset, z: sample.z + sample.tx * offset };
      });
      const outlines = realmRacersWaterOutlines(circuit);
      expect(outlines).toHaveLength(1);
      expect(outlines[0]).toEqual(ring);
    },
  );

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s charges every band the depth deserves, road out to open water',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const seen = new Set<string>();
      for (let i = 0; i < track.samples.length; i += 5) {
        const sample = track.samples[i];
        const shore = rallyShoreOffsetAt(circuit, sample.s);
        for (const lateral of [
          0,
          sample.halfWidth + 0.5,
          sample.halfWidth + 3,
          sample.halfWidth + 6,
          shore - 0.5,
          shore + 0.5,
          shore + 3,
          -(sample.halfWidth + 6),
        ]) {
          const band = realmRacersOffTrackBand(circuit, probe(circuit, i, lateral));
          const over = Math.abs(lateral) - sample.halfWidth;
          const expected =
            over <= REALM_RACERS_VERGE_MARGIN
              ? null
              : over <= REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH
                ? REALM_RACERS_VERGE_BAND.name
                : lateral > shore
                  ? REALM_RACERS_WATER_BAND.name
                  : REALM_RACERS_GARDEN_BAND.name;
          expect(band?.name ?? null, `sample ${i} at ${lateral}`).toBe(expected);
          seen.add(band?.name ?? 'road');
        }
      }
      // All four outcomes really were exercised, or the agreement above is
      // agreement about one arm.
      expect(seen).toEqual(
        new Set([
          'road',
          REALM_RACERS_VERGE_BAND.name,
          REALM_RACERS_GARDEN_BAND.name,
          REALM_RACERS_WATER_BAND.name,
        ]),
      );
    },
  );

  it('counts the road and its verge as ON TRACK, and everything past them as off', () => {
    // The referee's own on/off question, and the reason clipping an apex is
    // ordinary racing: every lap clips one, so an excursion that armed inside
    // the verge would arm on every corner of every lap.
    expect(realmRacersOnTrack(null)).toBe(true);
    expect(realmRacersOnTrack(REALM_RACERS_VERGE_BAND)).toBe(true);
    expect(realmRacersOnTrack(REALM_RACERS_GARDEN_BAND)).toBe(false);
    expect(realmRacersOnTrack(REALM_RACERS_WATER_BAND)).toBe(false);
  });
});

/** The garden circuit's curve under a draft id, with two spans painted dry. */
const MIXED: RealmRacersCircuit = {
  ...GARDEN,
  id: 'water_mixed_spans',
  waterBands: [
    { s: 0, kind: 'water' },
    // On the start/finish straight, so a probe driven at it is measured against
    // the stretch it was aimed at rather than the far side of a corner.
    { s: 0.05, kind: 'dry' },
    { s: 0.12, kind: 'water' },
    { s: 0.6, kind: 'dry' },
    { s: 0.7, kind: 'water' },
  ],
};

describe('Realm Racers water: what an authored span leaves on the shore line', () => {
  it('reads the table stepwise, with every boundary inside one sample', () => {
    const track = realmRacersTrack(MIXED);
    const count = track.samples.length;
    const kinds = kindsOf(MIXED);
    for (const [fraction, kind] of [
      [0.05, 'dry'],
      [0.12, 'water'],
      [0.6, 'dry'],
      [0.7, 'water'],
    ] as const) {
      const at = Math.round(fraction * count);
      // The sample the boundary lands on is within one of the authored fraction
      // on both sides, and the kind really does change there.
      expect(kinds[(at + 1) % count], `after ${fraction}`).toBe(kind);
      expect(kinds[(at - 2 + count) % count], `before ${fraction}`).not.toBe(kind);
    }
    // Never interpolated: a stepwise table only ever reads back one of its own
    // authored kinds.
    expect(new Set(kinds)).toEqual(new Set(['water', 'dry']));
  });

  it('derives one water polygon per contiguous pond and none over a dry span', () => {
    const track = realmRacersTrack(MIXED);
    const kinds = kindsOf(MIXED);
    const outlines = realmRacersWaterOutlines(MIXED);
    // Two dry spans cut the ring into two, and the run crossing the start line
    // is ONE run rather than two halves of one.
    expect(outlines).toHaveLength(2);
    const points = outlines.reduce((sum, outline) => sum + outline.length, 0);
    expect(points).toBe(kinds.filter((kind) => kind === 'water').length);
    // Every polygon point sits ON the shore line, and only over water.
    for (const outline of outlines) {
      expect(outline.length).toBeGreaterThan(20);
      for (const point of outline) {
        const projection = track.project(point.x, point.z);
        expect(projection.lateral).toBeCloseTo(rallyShoreOffsetAt(MIXED, projection.s), 1);
        expect(rallyWaterKindAt(MIXED, projection.s)).toBe('water');
      }
    }
  });

  it('reports no WATER over a dry span, while the bank profile still ramps', () => {
    // The two questions are different, and the split matters to the renderer: a
    // vertex out in the middle of a pond can be nearest to the dry stretch
    // across the strip and is still open water, so the surface reads the RAMP
    // and only a point whose pond membership nobody established reads the other.
    const track = realmRacersTrack(MIXED);
    const dryIndex = kindsOf(MIXED).indexOf('dry') + 8;
    const sample = track.samples[dryIndex];
    const offset = rallyShoreOffsetAt(MIXED, sample.s) + 3;
    const x = sample.x - sample.tz * offset;
    const z = sample.z + sample.tx * offset;
    expect(rallyBankDepthAt(MIXED, x, z)).toBeGreaterThan(0);
    expect(rallyBasinDepthAt(MIXED, x, z)).toBe(0);
  });

  it('charges the garden band, never Wading, past a dry span', () => {
    const track = realmRacersTrack(MIXED);
    const dryIndex = kindsOf(MIXED).indexOf('dry') + 8;
    const dry = track.samples[dryIndex];
    expect(
      realmRacersOffTrackBand(MIXED, probe(MIXED, dryIndex, rallyShoreOffsetAt(MIXED, dry.s) + 3))
        ?.name,
    ).toBe(REALM_RACERS_GARDEN_BAND.name);
    // ...and the shore beside it still charges Wading, or the case above is
    // measuring an offset nothing reaches rather than the dry span.
    const wetIndex = 5;
    const wet = track.samples[wetIndex];
    expect(rallyWaterKindAt(MIXED, wet.s)).toBe('water');
    expect(
      realmRacersOffTrackBand(MIXED, probe(MIXED, wetIndex, rallyShoreOffsetAt(MIXED, wet.s) + 3))
        ?.name,
    ).toBe(REALM_RACERS_WATER_BAND.name);
  });
});

describe('Realm Racers water: a circuit with none at all', () => {
  const DRY: RealmRacersCircuit = {
    ...GARDEN,
    id: 'water_dry_circuit',
    waterBands: [{ s: 0, kind: 'dry' }],
    basin: undefined,
  };

  it('is authorable and derives no water anywhere', () => {
    const track = realmRacersTrack(DRY);
    expect(realmRacersWaterOutlines(DRY)).toEqual([]);
    for (let i = 0; i < track.samples.length; i += 11) {
      const sample = track.samples[i];
      const offset = rallyShoreOffsetAt(DRY, sample.s) + 20;
      const x = sample.x - sample.tz * offset;
      const z = sample.z + sample.tx * offset;
      // Nothing is underwater on a dry circuit, however far in it is measured,
      // and the bank has no ramp to hand back either.
      expect(rallyBasinDepthAt(DRY, x, z)).toBe(0);
      expect(rallyBankDepthAt(DRY, x, z)).toBe(0);
    }
  });

  it('charges its whole infield the garden band, never Wading', () => {
    const track = realmRacersTrack(DRY);
    for (let i = 0; i < track.samples.length; i += 13) {
      const sample = track.samples[i];
      const band = realmRacersOffTrackBand(
        DRY,
        probe(DRY, i, rallyShoreOffsetAt(DRY, sample.s) + 12),
      );
      expect(band?.name, `sample ${i}`).toBe(REALM_RACERS_GARDEN_BAND.name);
    }
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
          rallyShoreOffsetAt(circuit, sample.s) + 3,
          rallyShoreOffsetAt(circuit, sample.s) + 25,
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
