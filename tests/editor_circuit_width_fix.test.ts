// The corner repair: narrowing the road wherever a corner is tighter than it.
//
// Three properties carry the whole feature, and each one is a way the button
// could be worse than useless. It must CLEAR the corners in one pass (a repair
// that leaves one behind is the hand-editing loop it replaces). It must LEAVE A
// CLEAN CIRCUIT ALONE (a repair that edits a circuit with nothing wrong cannot
// be trusted with one that does). And it must SAY what it could not fix, rather
// than quietly clamping at the road floor and reporting success.

import { describe, expect, it } from 'vitest';
import { suggestWidthBands } from '../src/editor/circuit/width_fix_core';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_MIN_HALF_WIDTH } from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

/** A lobed shape: `lobes` tight corners at the tips, evenly spaced round the
 *  lap, so "reports every corner" has more than one corner to report. */
function flower(lobes: number, base: number, amplitude: number, points = 48) {
  return Array.from({ length: points }, (_, i) => {
    const angle = (i / points) * Math.PI * 2;
    const radius = base + amplitude * Math.cos(lobes * angle);
    return { x: radius * Math.cos(angle), z: radius * Math.sin(angle) };
  });
}

function circuit(
  id: string,
  controlPoints: readonly { x: number; z: number }[],
  halfWidth: number,
): RealmRacersCircuit {
  return {
    ...GARDEN,
    id,
    controlPoints,
    widthBands: [
      { s: 0, halfWidth },
      { s: 1, halfWidth },
    ],
    regionHalfX: 280,
    regionHalfZ: 150,
    perimeter: { halfX: 250, halfZ: 140, halfThickness: 0.4, height: 2.2 },
  };
}

const applied = (base: RealmRacersCircuit, widthBands: { s: number; halfWidth: number }[]) =>
  realmRacersCircuitMetrics({ ...base, id: `${base.id}_applied`, widthBands });

const cornerCodes = (metrics: { problems: readonly { code: string }[] }) =>
  metrics.problems.filter(
    (p) => p.code === 'corner_folds_road' || p.code === 'corner_near_road_width',
  );

describe('circuit editor corner repair', () => {
  it('clears every corner in ONE pass, which is the whole point', () => {
    // Four tight lobes against a wide road: the shape that made fixing by hand
    // a loop of "fix one, meet the next".
    const drawn = circuit('widthfix_four_lobes', flower(4, 110, 26), 13);
    expect(cornerCodes(realmRacersCircuitMetrics(drawn))).toHaveLength(4);
    const fix = suggestWidthBands(drawn);
    expect(fix.remaining).toEqual([]);
    expect(cornerCodes(applied(drawn, fix.widthBands))).toEqual([]);
    expect(fix.narrowedYards).toBeGreaterThan(0);
  });

  it('is safe to run twice: the second pass finds nothing left to do', () => {
    const drawn = circuit('widthfix_idempotent', flower(4, 110, 26), 13);
    const first = suggestWidthBands(drawn);
    const once: RealmRacersCircuit = {
      ...drawn,
      id: 'widthfix_idempotent_once',
      widthBands: first.widthBands,
    };
    const second = suggestWidthBands(once);
    expect(second.narrowedYards).toBe(0);
    expect(second.widthBands).toEqual(first.widthBands);
  });

  it('leaves a circuit no corner constrains completely alone', () => {
    // A repair button that edits a clean circuit cannot be trusted with a dirty
    // one. The garden circuit's own hand-authored profile has to come back
    // byte for byte, not re-derived into a machine table that happens to match.
    const fix = suggestWidthBands(GARDEN);
    expect(fix.widthBands).toEqual(GARDEN.widthBands.map((band) => ({ ...band })));
    expect(fix.narrowedYards).toBe(0);
    expect(fix.remaining).toEqual([]);
  });

  it('only ever narrows: no sample comes back with more road than it had', () => {
    const drawn = circuit('widthfix_monotone', flower(3, 100, 30), 12);
    const fix = suggestWidthBands(drawn);
    const before = realmRacersTrack(drawn).samples;
    const after = realmRacersTrack({
      ...drawn,
      id: 'widthfix_monotone_after',
      widthBands: fix.widthBands,
    }).samples;
    after.forEach((sample, i) => {
      expect(sample.halfWidth, `sample ${i}`).toBeLessThanOrEqual(before[i].halfWidth + 1e-9);
    });
  });

  it('never narrows past the floor a road is allowed to reach', () => {
    const drawn = circuit('widthfix_floor', flower(4, 90, 34), 10);
    const fix = suggestWidthBands(drawn);
    for (const band of fix.widthBands) {
      expect(band.halfWidth, `band at s=${band.s}`).toBeGreaterThanOrEqual(
        REALM_RACERS_MIN_HALF_WIDTH,
      );
    }
  });

  it('names the corners no legal road can rescue instead of claiming success', () => {
    // Radius 6 against a road floor of 8: no width in the record's own range
    // clears these, so the CURVE has to open up and the operator has to be told
    // which corners and where.
    const drawn = circuit('widthfix_unfixable', flower(4, 90, 34), 10);
    const fix = suggestWidthBands(drawn);
    expect(fix.remaining).toHaveLength(4);
    for (const problem of fix.remaining) {
      expect(problem.code).toBe('corner_folds_road');
      expect(problem.s).toBeGreaterThanOrEqual(0);
    }
    // And what it reports really is what the readout says afterwards.
    const after = applied(drawn, fix.widthBands).problems.filter(
      (p) => p.code === 'corner_folds_road',
    );
    expect(after.map((p) => p.s)).toEqual(fix.remaining.map((p) => p.s));
  });

  it('clears the ERROR where the floor is just enough, leaving only the warning', () => {
    // The middle case: a corner the floor can lift over the fold threshold but
    // not all the way clear of the warning tier.
    const drawn = circuit('widthfix_partial', flower(4, 96, 30), 11);
    const fix = suggestWidthBands(drawn);
    const before = realmRacersCircuitMetrics(drawn).problems.map((p) => p.code);
    expect(before).toContain('corner_folds_road');
    const after = applied(drawn, fix.widthBands).problems.map((p) => p.code);
    expect(after).not.toContain('corner_folds_road');
    expect(fix.remaining).toEqual([]);
  });

  it('keeps the authored profile away from the corners it had to touch', () => {
    // One tight corner must not flatten the road the operator shaped everywhere
    // else: the repair is local, or it is a rewrite wearing a repair's name.
    const shaped: RealmRacersCircuit = {
      ...circuit('widthfix_local', flower(1, 110, 22), 12),
      widthBands: [
        { s: 0, halfWidth: 13 },
        { s: 0.4, halfWidth: 13 },
        { s: 0.5, halfWidth: 9 },
        { s: 0.6, halfWidth: 13 },
        { s: 1, halfWidth: 13 },
      ],
    };
    const fix = suggestWidthBands(shaped);
    const before = realmRacersTrack(shaped);
    const after = realmRacersTrack({
      ...shaped,
      id: 'widthfix_local_after',
      widthBands: fix.widthBands,
    });
    // The authored dip at half distance survives.
    expect(after.halfWidthAt(0.5 * after.length)).toBeCloseTo(9, 1);
    // And the stretches the repair did not have to touch keep their width.
    let untouched = 0;
    after.samples.forEach((sample, i) => {
      if (Math.abs(sample.halfWidth - before.samples[i].halfWidth) < 0.05) untouched++;
    });
    expect(untouched / after.samples.length).toBeGreaterThan(0.5);
  });

  it('preserves an authored chicane narrower than one repair cell', () => {
    // The repair emits breakpoints on a 1-percent-of-lap grid and used to cap
    // each against the authored ceiling sampled at the GRID fractions only, so
    // a dip authored inside one cell was erased by the interpolation between
    // two boundaries that never saw it, and "only ever narrows" broke exactly
    // there: the road at the chicane came back WIDER than the operator drew it.
    // The four-lobes shape the one-pass test proves is constrained, with a
    // hand-authored chicane parked between two of its corners.
    const shaped: RealmRacersCircuit = {
      ...circuit('widthfix_subcell', flower(4, 110, 26), 13),
      widthBands: [
        { s: 0, halfWidth: 13 },
        { s: 0.622, halfWidth: 13 },
        { s: 0.625, halfWidth: 9 },
        { s: 0.628, halfWidth: 13 },
        { s: 1, halfWidth: 13 },
      ],
    };
    const fix = suggestWidthBands(shaped);
    // The rebuild really ran: the corner constrains the road, so this is not
    // the leave-it-alone early return hiding the defect.
    expect(fix.narrowedYards).toBeGreaterThan(0);
    const before = realmRacersTrack(shaped);
    const after = realmRacersTrack({
      ...shaped,
      id: 'widthfix_subcell_after',
      widthBands: fix.widthBands,
    });
    after.samples.forEach((sample, i) => {
      expect(sample.halfWidth, `sample ${i}`).toBeLessThanOrEqual(
        before.samples[i].halfWidth + 1e-9,
      );
    });
    // The authored sub-cell dip itself survives at its own fraction.
    expect(after.halfWidthAt(0.625 * after.length)).toBeLessThanOrEqual(9 + 0.05);
  });

  it('is deterministic', () => {
    const drawn = circuit('widthfix_deterministic', flower(4, 110, 26), 13);
    expect(suggestWidthBands(drawn).widthBands).toEqual(suggestWidthBands(drawn).widthBands);
  });

  it('emits a table a human can still read and edit', () => {
    const drawn = circuit('widthfix_readable', flower(4, 110, 26), 13);
    const bands = suggestWidthBands(drawn).widthBands;
    expect(bands.length).toBeLessThan(40);
    expect(bands[0].s).toBe(0);
    expect(bands[bands.length - 1].s).toBe(1);
    for (let i = 1; i < bands.length; i++) expect(bands[i].s).toBeGreaterThan(bands[i - 1].s);
  });
});
