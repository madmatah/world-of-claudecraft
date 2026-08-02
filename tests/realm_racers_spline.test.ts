import { describe, expect, it, vi } from 'vitest';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_MIN_HALF_WIDTH,
  REALM_RACERS_SAMPLE_STEP,
} from '../src/sim/realm_racers_layout';
import { rallyForwardDot, realmRacersTrack } from '../src/sim/realm_racers_spline';

const track = realmRacersTrack(GARDEN_CIRCUIT);

/**
 * A projection as the two quantities the sim consumes (arc position and signed
 * offset). Exactly on a sample the two neighbouring segments tie and which one
 * wins depends on where the scan started, so s is taken modulo the lap: s = 0
 * and s = the lap length are the same place. The tangents of those two segments
 * differ by a fraction of a degree, checked separately below.
 */
function projectedPoint(x: number, z: number, hint?: number) {
  const p = track.project(x, z, hint);
  const wrapped = p.s % track.length;
  return {
    s: Math.min(wrapped, track.length - wrapped) < 1e-6 ? 0 : Number(wrapped.toFixed(6)),
    lateral: Number(p.lateral.toFixed(6)),
  };
}

function tangentAgreement(x: number, z: number, hint: number): number {
  const hinted = track.project(x, z, hint);
  const full = track.project(x, z);
  return hinted.tangentX * full.tangentX + hinted.tangentZ * full.tangentZ;
}

describe('Realm Racers spline', () => {
  it('resamples the closed centerline at a uniform arc-length step', () => {
    const gaps: number[] = [];
    for (let i = 0; i < track.samples.length; i++) {
      const a = track.samples[i];
      const b = track.samples[(i + 1) % track.samples.length];
      gaps.push(Math.hypot(b.x - a.x, b.z - a.z));
    }
    expect(gaps).toHaveLength(track.samples.length);
    const spread = Math.max(...gaps) - Math.min(...gaps);
    expect(spread / track.step).toBeLessThan(0.05);
    expect(track.step).toBeCloseTo(REALM_RACERS_SAMPLE_STEP, 1);
  });

  it('lands the lap inside the 430 to 470 yard design window', () => {
    expect(track.length).toBeGreaterThan(430);
    expect(track.length).toBeLessThan(470);
  });

  it('never narrows the road below the floor and hits every authored breakpoint', () => {
    for (const sample of track.samples) {
      expect(sample.halfWidth).toBeGreaterThanOrEqual(REALM_RACERS_MIN_HALF_WIDTH);
    }
    for (const band of GARDEN_CIRCUIT.widthBands) {
      expect(track.halfWidthAt(band.s * track.length)).toBeCloseTo(band.halfWidth, 6);
    }
    // The floor is real, not vacuous: the chicane actually reaches it.
    expect(Math.min(...track.samples.map((s) => s.halfWidth))).toBeCloseTo(
      REALM_RACERS_MIN_HALF_WIDTH,
      6,
    );
  });

  it('projects a point on the line to zero lateral and signs the two sides apart', () => {
    const sample = track.samples[120];
    expect(Math.abs(track.project(sample.x, sample.z).lateral)).toBeLessThan(1e-6);
    const normalX = -sample.tz;
    const normalZ = sample.tx;
    const left = track.project(sample.x + normalX * 4, sample.z + normalZ * 4);
    const right = track.project(sample.x - normalX * 4, sample.z - normalZ * 4);
    expect(left.lateral).toBeCloseTo(4, 3);
    expect(right.lateral).toBeCloseTo(-4, 3);
    expect(rallyForwardDot(left, sample.tx, sample.tz)).toBeCloseTo(1, 3);
    expect(rallyForwardDot(left, -sample.tx, -sample.tz)).toBeCloseTo(-1, 3);
  });

  it('matches the full scan on a good hint and recovers from a stale one', () => {
    // A good hint must be lossless: the windowed search agrees with the full
    // scan everywhere on the road, or a racer's continuous progress would drift
    // depending only on where they happened to be last tick.
    for (let i = 0; i < track.samples.length; i += 7) {
      const sample = track.samples[i];
      const x = sample.x - sample.tz * 3;
      const z = sample.z + sample.tx * 3;
      expect(projectedPoint(x, z, i)).toEqual(projectedPoint(x, z));
      expect(tangentAgreement(x, z, i)).toBeGreaterThan(0.9999);
    }
    // The hairpin folds the lap back on itself, so a stale hint from the far
    // side is exactly the case a windowed search would answer wrongly.
    const hairpin = track.samples.reduce((best, sample) => (sample.x < best.x ? sample : best));
    const hairpinIndex = track.samples.indexOf(hairpin);
    const entry = track.samples[(hairpinIndex + track.samples.length - 60) % track.samples.length];
    const exit = track.samples[(hairpinIndex + 60) % track.samples.length];
    expect(Math.hypot(entry.x - exit.x, entry.z - exit.z)).toBeGreaterThan(20);
    const staleHint = track.samples.indexOf(exit);
    expect(projectedPoint(entry.x, entry.z, staleHint)).toEqual(projectedPoint(entry.x, entry.z));
    expect(Math.abs(track.project(entry.x, entry.z, staleHint).lateral)).toBeLessThan(1e-6);

    // A teleport (the grid placement, a dev command) can strand the hint most
    // of a lap away while the local window's best still looks plausible: the
    // window's own rim, not the offset, is what gives that away.
    const teleported = track.samples[52];
    expect(projectedPoint(teleported.x, teleported.z, 447)).toEqual(
      projectedPoint(teleported.x, teleported.z),
    );
    expect(Math.abs(track.project(teleported.x, teleported.z, 447).lateral)).toBeLessThan(1e-6);
  });

  it('builds byte-identical samples on a fresh module instance (deterministic)', async () => {
    vi.resetModules();
    const rebuilt = (await import('../src/sim/realm_racers_spline')).realmRacersTrack(
      GARDEN_CIRCUIT,
    );
    expect(rebuilt.length).toBe(track.length);
    expect(rebuilt.samples).toEqual(track.samples);
  });
});
