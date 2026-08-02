// The infield's anti-cut boundary, once the water stopped being the mechanic.
//
// The load-bearing block is the FIRST one. The containment line is unchanged
// (`halfWidth + apron`) and a circuit that authors no `barrierBands` must still
// derive the same clamp limit, the same water polygon and the same off-track
// band it did when the only thing on that line was a shore. That equivalence is
// written out against the OLD formulas, spelled here rather than called through
// the new ones, so it is evidence rather than the new code agreeing with itself.

import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  RALLY_BARRIER_KINDS,
  type RallyBarrierKind,
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
  realmRacersCompetitionCircuits,
} from '../src/sim/content/realm_racers_circuits';
import {
  type RallyPoint,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
  realmRacersLaneOffset,
  realmRacersPublicLane,
} from '../src/sim/realm_racers_layout';
import {
  rallyBankDepthAt,
  rallyBarrierKindAt,
  rallyBasinDepthAt,
  rallyContainmentGraceAt,
  rallyContainmentLimitAt,
  rallyContainmentLineAt,
  realmRacersTrack,
  realmRacersWaterOutlines,
  resolveRealmRacersContainment,
} from '../src/sim/realm_racers_spline';
import {
  REALM_RACERS_GARDEN_BAND,
  REALM_RACERS_VERGE_BAND,
  REALM_RACERS_WATER_BAND,
  realmRacersOffTrackBand,
} from '../src/sim/social/realm_racers';

const SEED = 42;

/** Every shipped circuit with its barrier table REMOVED, which is the shape
 *  they all had before the field existed and the shape this suite pins. */
const DEFAULTS: readonly RealmRacersCircuit[] = REALM_RACERS_CIRCUIT_LIST.map((circuit) => ({
  ...circuit,
  id: `${circuit.id}_no_barrier_bands`,
  barrierBands: undefined,
}));

/**
 * The clamp exactly as it stood before this packet: walk back along the
 * projection's own segment normal until the racer is inside
 * `shore + wadeYards`, four passes. Re-implemented here on purpose, so the
 * equivalence below is measured against the old rule rather than the new one.
 */
function wadeClampAsItWas(circuit: RealmRacersCircuit, x: number, z: number): RallyPoint {
  const track = realmRacersTrack(circuit);
  let px = x;
  let pz = z;
  let hint: number | undefined;
  for (let pass = 0; pass < 4; pass++) {
    const projection = track.project(px, pz, hint);
    hint = projection.index;
    const shore = track.halfWidthAt(projection.s) + track.apronAt(projection.s);
    const back = projection.lateral - (shore + (circuit.basin?.wadeYards ?? 0));
    if (back <= 0) break;
    px -= -projection.tangentZ * back;
    pz -= projection.tangentX * back;
  }
  return { x: px, z: pz };
}

/** The off-track band exactly as it stood before this packet. */
function bandAsItWas(circuit: RealmRacersCircuit, lateral: number, s: number): string | null {
  const track = realmRacersTrack(circuit);
  const over = Math.abs(lateral) - track.halfWidthAt(s);
  if (over <= REALM_RACERS_VERGE_MARGIN) return null;
  if (over <= REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH) {
    return REALM_RACERS_VERGE_BAND.name;
  }
  const shore = track.halfWidthAt(s) + track.apronAt(s);
  return lateral > shore ? REALM_RACERS_WATER_BAND.name : REALM_RACERS_GARDEN_BAND.name;
}

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

describe('Realm Racers containment: a circuit with no barrier table is the circuit it was', () => {
  it('covers every shipped circuit', () => {
    // The cardinality floor for everything below: an `it.each` over a list that
    // quietly emptied registers no cases at all, and the whole equivalence pin
    // would pass by running nothing.
    expect(DEFAULTS).toHaveLength(2);
    expect(DEFAULTS.every((circuit) => circuit.barrierBands === undefined)).toBe(true);
  });

  it('names exactly the four kinds the record, the spline and the painter agree on', () => {
    // Pinned as a list rather than a length: a kind added to the union without
    // being added here reads back as `shore` from every stepwise lookup, which
    // is a barrier that silently becomes water.
    expect(RALLY_BARRIER_KINDS).toEqual(['shore', 'hedge_low', 'hedge_tall', 'wall_low']);
  });

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s clamps at exactly the old shore-plus-wading limit',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const wade = circuit.basin?.wadeYards ?? 0;
      expect(wade).toBeGreaterThan(0);
      for (let i = 0; i < track.samples.length; i++) {
        const sample = track.samples[i];
        // Exactly, not approximately: the whole claim is that this path did not
        // move, and a tolerance here would hide a re-association of the sum.
        expect(rallyContainmentLimitAt(circuit, sample.s)).toBe(
          track.halfWidthAt(sample.s) + track.apronAt(sample.s) + wade,
        );
        expect(rallyContainmentLineAt(circuit, sample.s)).toBe(
          track.halfWidthAt(sample.s) + track.apronAt(sample.s),
        );
        expect(rallyContainmentGraceAt(circuit, sample.s)).toBe(wade);
        expect(rallyBarrierKindAt(circuit, sample.s)).toBe('shore');
      }
    },
  );

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s resolves every probe to the same point the old wade clamp did',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      let moved = 0;
      for (let i = 0; i < track.samples.length; i += 7) {
        const sample = track.samples[i];
        for (const offset of [-40, 0, 12, 22, 30, 60, 140]) {
          const x = sample.x - sample.tz * offset;
          const z = sample.z + sample.tx * offset;
          const now = resolveRealmRacersContainment(circuit, x, z);
          const before = wadeClampAsItWas(circuit, x, z);
          expect(now.x, `sample ${i} at ${offset}`).toBe(before.x);
          expect(now.z, `sample ${i} at ${offset}`).toBe(before.z);
          if (Math.hypot(now.x - x, now.z - z) > 1e-9) moved++;
        }
      }
      // Not vacuous: plenty of those probes really were out past the limit and
      // really were walked back.
      expect(moved).toBeGreaterThan(100);
    },
  );

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s derives one water polygon, point for point the old offset ring',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const before = track.samples.map((sample) => {
        const offset = track.halfWidthAt(sample.s) + track.apronAt(sample.s);
        return { x: sample.x - sample.tz * offset, z: sample.z + sample.tx * offset };
      });
      const outlines = realmRacersWaterOutlines(circuit);
      expect(outlines).toHaveLength(1);
      expect(outlines[0]).toEqual(before);
    },
  );

  it.each(DEFAULTS.map((circuit) => [circuit.id, circuit] as const))(
    '%s reads the same off-track band at every depth it did',
    (_id, circuit) => {
      const track = realmRacersTrack(circuit);
      const seen = new Set<string>();
      for (let i = 0; i < track.samples.length; i += 5) {
        const sample = track.samples[i];
        const line = rallyContainmentLineAt(circuit, sample.s);
        for (const lateral of [
          0,
          sample.halfWidth + 0.5,
          sample.halfWidth + 3,
          sample.halfWidth + 6,
          line - 0.5,
          line + 0.5,
          line + 3,
          -(sample.halfWidth + 6),
        ]) {
          const band = realmRacersOffTrackBand(circuit, probe(circuit, i, lateral));
          expect(band?.name ?? null, `sample ${i} at ${lateral}`).toBe(
            bandAsItWas(circuit, lateral, sample.s),
          );
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
});

/** The garden circuit's curve under a draft id, with two solid spans on it. */
const MIXED: RealmRacersCircuit = {
  ...GARDEN,
  id: 'containment_mixed_spans',
  barrierBands: [
    { s: 0, kind: 'shore' },
    // On the start/finish straight, so a probe driven at it is measured
    // against the stretch it was aimed at rather than the far side of a corner.
    { s: 0.05, kind: 'hedge_low' },
    { s: 0.12, kind: 'shore' },
    { s: 0.6, kind: 'wall_low' },
    { s: 0.7, kind: 'shore' },
  ],
};

const kindsOf = (circuit: RealmRacersCircuit): RallyBarrierKind[] =>
  realmRacersTrack(circuit).samples.map((sample) => rallyBarrierKindAt(circuit, sample.s));

describe('Realm Racers containment: what an authored span puts on the line', () => {
  it('reads the table stepwise, with every boundary inside one sample', () => {
    const track = realmRacersTrack(MIXED);
    const count = track.samples.length;
    const kinds = kindsOf(MIXED);
    for (const [fraction, kind] of [
      [0.05, 'hedge_low'],
      [0.12, 'shore'],
      [0.6, 'wall_low'],
      [0.7, 'shore'],
    ] as const) {
      const at = Math.round(fraction * count);
      // The sample the boundary lands on is within one of the authored
      // fraction on both sides, and the kind really does change there.
      expect(kinds[(at + 1) % count], `after ${fraction}`).toBe(kind);
      expect(kinds[(at - 2 + count) % count], `before ${fraction}`).not.toBe(kind);
    }
    // Never interpolated: a stepwise table only ever reads back one of its own
    // authored kinds.
    expect(new Set(kinds)).toEqual(new Set(['shore', 'hedge_low', 'wall_low']));
  });

  it('gives a solid span no grace at all, and the shore its full margin', () => {
    const track = realmRacersTrack(MIXED);
    const wade = GARDEN.basin?.wadeYards ?? 0;
    let atFullMargin = 0;
    for (const sample of track.samples) {
      const kind = rallyBarrierKindAt(MIXED, sample.s);
      const grace = rallyContainmentGraceAt(MIXED, sample.s);
      // Never more than the authored margin anywhere, which is what keeps the
      // taper from reopening anything.
      expect(grace).toBeLessThanOrEqual(wade);
      expect(grace).toBeGreaterThanOrEqual(0);
      if (kind !== 'shore') expect(grace, `grace at ${sample.s.toFixed(1)}`).toBe(0);
      if (grace === wade) atFullMargin++;
      expect(rallyContainmentLimitAt(MIXED, sample.s)).toBeCloseTo(
        rallyContainmentLineAt(MIXED, sample.s) + grace,
        9,
      );
    }
    // Most of the lap is open shore at the full margin: the taper is a hem on
    // the solid spans, not a new ceiling on the whole circuit.
    expect(atFullMargin).toBeGreaterThan(track.samples.length / 2);
  });

  it('eases the wading margin out into a solid span instead of stepping it', () => {
    // The defect the taper exists for: a racer four yards into the water who
    // crosses into a hedge span would be walked four yards sideways in one
    // tick, which is a teleport out of the back of a hedge.
    const track = realmRacersTrack(MIXED);
    const count = track.samples.length;
    const solidStart = kindsOf(MIXED).indexOf('hedge_low');
    expect(solidStart).toBeGreaterThan(0);
    let worstStep = 0;
    for (let k = 1; k <= 40; k++) {
      const before = rallyContainmentGraceAt(
        MIXED,
        track.samples[(solidStart - k + count) % count].s,
      );
      const after = rallyContainmentGraceAt(
        MIXED,
        track.samples[(solidStart - k + 1 + count) % count].s,
      );
      // Monotone toward the barrier: approaching it never GIVES grace back.
      expect(after).toBeLessThanOrEqual(before + 1e-9);
      worstStep = Math.max(worstStep, before - after);
    }
    // A tenth of a yard per yard of lap, against the four the step would be.
    expect(worstStep).toBeLessThan(0.5);
    expect(rallyContainmentGraceAt(MIXED, track.samples[solidStart].s)).toBe(0);

    // Bounded on BOTH sides: half the margin about half the ramp back, so the
    // taper is neither a step in disguise nor a ceiling over the whole lap.
    const wade = GARDEN.basin?.wadeYards ?? 0;
    const halfway = track.samples[(solidStart - 6 + count) % count];
    expect(rallyContainmentGraceAt(MIXED, halfway.s)).toBeCloseTo(wade / 2, 1);
    const past = track.samples[(solidStart - 14 + count) % count];
    expect(rallyContainmentGraceAt(MIXED, past.s)).toBe(wade);
  });

  it('walks a wading racer out of a barrier by inches, not by the whole margin', () => {
    // The taper's claim measured at the BEHAVIOR rather than at the derivation:
    // a racer sitting exactly on the wade limit one sample before a barrier is
    // displaced a fraction of a yard when the clamp resolves them, against the
    // four yards a stepped limit would teleport them.
    const track = realmRacersTrack(MIXED);
    const count = track.samples.length;
    const solidStart = kindsOf(MIXED).indexOf('hedge_low');
    const sample = track.samples[(solidStart - 1 + count) % count];
    const offset = rallyContainmentLimitAt(MIXED, sample.s);
    const x = sample.x - sample.tz * offset;
    const z = sample.z + sample.tx * offset;
    const held = resolveRealmRacersContainment(MIXED, x, z);
    expect(Math.hypot(held.x - x, held.z - z)).toBeLessThan(0.5);
  });

  it('derives one water polygon per contiguous shore span and none over a barrier', () => {
    const track = realmRacersTrack(MIXED);
    const kinds = kindsOf(MIXED);
    const outlines = realmRacersWaterOutlines(MIXED);
    // Two solid spans cut the ring into two, and the run crossing the start
    // line is ONE run rather than two halves of one.
    expect(outlines).toHaveLength(2);
    const points = outlines.reduce((sum, outline) => sum + outline.length, 0);
    expect(points).toBe(kinds.filter((kind) => kind === 'shore').length);
    // Every polygon point sits ON the containment line, and only over shore.
    for (const outline of outlines) {
      expect(outline.length).toBeGreaterThan(20);
      for (const point of outline) {
        const projection = track.project(point.x, point.z);
        expect(projection.lateral).toBeCloseTo(rallyContainmentLineAt(MIXED, projection.s), 1);
        expect(rallyBarrierKindAt(MIXED, projection.s)).toBe('shore');
      }
    }
  });
});

describe('Realm Racers containment: driving into a solid span', () => {
  const track = realmRacersTrack(MIXED);
  /** A few yards into the hedge span, which sits on the start straight. */
  const hedgeIndex = kindsOf(MIXED).indexOf('hedge_low') + 8;
  /** Open shore, far enough from either barrier to be at the full margin. */
  const shoreIndex = 5;

  it('stops a racer ON the line, keeps their arc position, and slides them along it', () => {
    const sample = track.samples[hedgeIndex];
    const line = rallyContainmentLineAt(MIXED, sample.s);
    let clamped = 0;
    for (const depth of [0.5, 2, 6, 20]) {
      const offset = line + depth;
      const x = sample.x - sample.tz * offset;
      const z = sample.z + sample.tx * offset;
      const held = resolveRealmRacersContainment(MIXED, x, z);
      const projection = track.project(held.x, held.z);
      // ON the line to the millimetre: a hedge gives no grace at all, which is
      // the stronger half of "solid is strictly stronger than water". At the
      // same offsets a shore span would have let the first two through.
      expect(projection.lateral, `depth ${depth}`).toBeLessThanOrEqual(
        rallyContainmentLineAt(MIXED, projection.s) + 1e-3,
      );
      // ...and pushed straight out rather than shoved down the circuit: the arc
      // position is what a shortcut would be stealing.
      expect(Math.abs(projection.s - sample.s), `depth ${depth}`).toBeLessThan(1);
      if (Math.hypot(held.x - x, held.z - z) > 1e-6) clamped++;
    }
    expect(clamped).toBe(4);
    expect(rallyContainmentLimitAt(MIXED, sample.s)).toBe(line);
  });

  it('settles a racer from the middle of the infield inside SOME stretch limit', () => {
    // Deep in the infield the nearest stretch is genuinely another part of the
    // lap (this infield is under a hundred yards across), so the clamp's claim
    // is convergence, not that the racer comes back out where they went in: the
    // point it returns satisfies the limit of the stretch it ends up on. A
    // one-pass clamp fails exactly here, because the walked-back point's
    // nearest segment is not the one it was measured against.
    for (const index of [hedgeIndex, shoreIndex, 200, 300]) {
      const sample = track.samples[index];
      for (const depth of [40, 90]) {
        const held = resolveRealmRacersContainment(
          MIXED,
          sample.x - sample.tz * (rallyContainmentLineAt(MIXED, sample.s) + depth),
          sample.z + sample.tx * (rallyContainmentLineAt(MIXED, sample.s) + depth),
        );
        const projection = track.project(held.x, held.z);
        expect(projection.lateral, `sample ${index} at ${depth}`).toBeLessThanOrEqual(
          rallyContainmentLimitAt(MIXED, projection.s) + 1e-3,
        );
      }
    }
  });

  it('still lets a racer wade the authored margin where the span is shore', () => {
    const sample = track.samples[shoreIndex];
    const limit = rallyContainmentLimitAt(MIXED, sample.s);
    expect(limit).toBeGreaterThan(rallyContainmentLineAt(MIXED, sample.s) + 3);
    const offset = limit - 0.2;
    const x = sample.x - sample.tz * offset;
    const z = sample.z + sample.tx * offset;
    const held = resolveRealmRacersContainment(MIXED, x, z);
    expect(Math.hypot(held.x - x, held.z - z)).toBeLessThan(1e-9);
  });

  it('reports no WATER behind a barrier, while the bank profile still ramps', () => {
    // The bank profile is geometry and answers a depth anywhere past the line;
    // the water question is what a solid span makes false. Only the second one
    // may say there is water three yards behind a hedge, in the dry strip a
    // racer cannot even reach.
    const sample = track.samples[hedgeIndex];
    const offset = rallyContainmentLineAt(MIXED, sample.s) + 3;
    const x = sample.x - sample.tz * offset;
    const z = sample.z + sample.tx * offset;
    expect(rallyBankDepthAt(MIXED, x, z)).toBeGreaterThan(1);
    expect(rallyBasinDepthAt(MIXED, x, z)).toBe(0);

    // ...and over a shore span the two still agree exactly, which is what keeps
    // every all-shore circuit reading as it always did.
    const shore = track.samples[shoreIndex];
    const wet = rallyContainmentLineAt(MIXED, shore.s) + 3;
    const wx = shore.x - shore.tz * wet;
    const wz = shore.z + shore.tx * wet;
    expect(rallyBasinDepthAt(MIXED, wx, wz)).toBe(rallyBankDepthAt(MIXED, wx, wz));
    expect(rallyBasinDepthAt(MIXED, wx, wz)).toBeGreaterThan(1);
  });

  it('charges the garden band, never Wading, on the infield side of a barrier', () => {
    // Past a solid line is unreachable by construction, so the water arm must
    // not fire there even at a lateral the clamp would never allow.
    const sample = track.samples[hedgeIndex];
    const line = rallyContainmentLineAt(MIXED, sample.s);
    expect(realmRacersOffTrackBand(MIXED, probe(MIXED, hedgeIndex, line - 0.5))?.name).toBe(
      REALM_RACERS_GARDEN_BAND.name,
    );
    expect(realmRacersOffTrackBand(MIXED, probe(MIXED, hedgeIndex, line + 2))?.name).toBe(
      REALM_RACERS_GARDEN_BAND.name,
    );
    // ...while the shore span a few hundred yards away still charges Wading.
    const shore = track.samples[shoreIndex];
    expect(
      realmRacersOffTrackBand(
        MIXED,
        probe(MIXED, shoreIndex, rallyContainmentLineAt(MIXED, shore.s) + 2),
      )?.name,
    ).toBe(REALM_RACERS_WATER_BAND.name);
  });
});

describe('Realm Racers containment: a circuit with no water at all', () => {
  const DRY: RealmRacersCircuit = {
    ...GARDEN,
    id: 'containment_dry_circuit',
    barrierBands: [{ s: 0, kind: 'hedge_tall' }],
    basin: undefined,
  };

  it('is authorable, derives no water, and clamps on the bare line', () => {
    const track = realmRacersTrack(DRY);
    expect(realmRacersWaterOutlines(DRY)).toEqual([]);
    for (let i = 0; i < track.samples.length; i += 11) {
      const sample = track.samples[i];
      expect(rallyContainmentGraceAt(DRY, sample.s)).toBe(0);
      expect(rallyContainmentLimitAt(DRY, sample.s)).toBe(rallyContainmentLineAt(DRY, sample.s));
      // Nothing is underwater on a dry circuit, however far in it is measured.
      const offset = rallyContainmentLineAt(DRY, sample.s) + 20;
      expect(
        rallyBasinDepthAt(DRY, sample.x - sample.tz * offset, sample.z + sample.tx * offset),
      ).toBe(0);
    }
  });

  it('holds a racer out of its whole infield', () => {
    const track = realmRacersTrack(DRY);
    for (let i = 0; i < track.samples.length; i += 13) {
      const sample = track.samples[i];
      const offset = rallyContainmentLineAt(DRY, sample.s) + 12;
      const held = resolveRealmRacersContainment(
        DRY,
        sample.x - sample.tz * offset,
        sample.z + sample.tx * offset,
      );
      const projection = track.project(held.x, held.z);
      expect(projection.lateral).toBeLessThanOrEqual(
        rallyContainmentLineAt(DRY, projection.s) + 1e-3,
      );
    }
  });
});

describe('Realm Racers containment: the collision entry point drives it', () => {
  it('holds a racer on the line of a SOLID span, through resolvePosition', () => {
    // `resolvePosition` is the one caller that matters, and every case it has
    // ever been driven on is a shore: the arm that gives no grace at all had
    // never been exercised through the real entry point.
    //
    // Run on the SHIPPED flipped circuit rather than a fixture, because it has
    // to be: the entry point resolves which circuit it is clamping against off
    // the LANE table, so a record the band does not carry is silently held to
    // whichever circuit stands on lane 0.
    const express = realmRacersCompetitionCircuits().find(
      (circuit) => circuit.barrierBands !== undefined,
    );
    if (!express) throw new Error('a competition circuit authors barrier bands');
    const track = realmRacersTrack(express);
    const lane = realmRacersLaneOffset(realmRacersPublicLane(express));
    let held = 0;
    let moved = 0;
    for (let i = 0; i < track.samples.length; i++) {
      const sample = track.samples[i];
      if (rallyBarrierKindAt(express, sample.s) === 'shore') continue;
      const line = rallyContainmentLineAt(express, sample.s);
      for (const depth of [0.5, 3]) {
        const x = sample.x - sample.tz * (line + depth);
        const z = sample.z + sample.tx * (line + depth);
        const resolved = resolvePosition(SEED, x + lane.x, z + lane.z, 0.5);
        const projection = track.project(resolved.x - lane.x, resolved.z - lane.z);
        // Held inside the limit of wherever it settled, always...
        expect(projection.lateral, `sample ${i} at ${depth}`).toBeLessThanOrEqual(
          rallyContainmentLimitAt(express, projection.s) + 1e-3,
        );
        // ...and ON the bare line whenever that is a solid span, which is the
        // arm with no grace at all. A probe at a span's first sample can settle
        // one sample back into the shore beside it, where the taper still gives
        // a few inches; that is the same joint the last hedge piece stands on.
        if (rallyBarrierKindAt(express, projection.s) !== 'shore') {
          expect(projection.lateral, `sample ${i} at ${depth}`).toBeLessThanOrEqual(
            rallyContainmentLineAt(express, projection.s) + 1e-3,
          );
          held++;
        }
        // ...and it really was MOVED: nothing here is passing by standing still.
        if (Math.hypot(resolved.x - lane.x - x, resolved.z - lane.z - z) > 0.1) moved++;
      }
    }
    expect(held).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(100);
  });

  it('holds a racer out of the practice circuit exactly as it always did', () => {
    // `resolvePosition` is the one caller that matters, and the practice
    // circuit is unflipped: this is the shipped path, unchanged.
    const track = realmRacersTrack(GARDEN);
    for (let i = 0; i < track.samples.length; i += 29) {
      const sample = track.samples[i];
      const offset = rallyContainmentLimitAt(GARDEN, sample.s) + 20;
      const x = sample.x - sample.tz * offset;
      const z = sample.z + sample.tx * offset;
      const resolved = resolvePosition(SEED, x, z, 0.5);
      const projection = track.project(resolved.x, resolved.z);
      expect(projection.lateral).toBeLessThanOrEqual(
        rallyContainmentLimitAt(GARDEN, projection.s) + 1e-3,
      );
    }
  });
});
