// The lighting rig one frame stands under, as one answer rather than seven
// fields assigned through nested branches in the renderer.
//
// What is pinned here is the RELATIONSHIPS between those seven values, since
// that is what made them one answer: the moon is the sun's antipode, both are
// compressed by the same realm amplitude, the stars follow the same dayness the
// grade does, and the pinned-daylight arm is the cycle switched off rather than
// a time of day.

import { describe, expect, it } from 'vitest';
import {
  aboveHorizon,
  globalDayness,
  NEUTRAL_DAY_GRADE,
  REALM_DAYNIGHT_AMPLITUDE,
  sunDirection,
} from '../src/render/day_night_core';
import { type Direction3, dayNightRig } from '../src/render/day_night_rig_core';
import type { BiomeId } from '../src/sim/types';

const FIXED_SUN: Direction3 = [0.32, 0.62, 0.72];

const rig = (phase: number, over: Partial<Parameters<typeof dayNightRig>[0]> = {}) =>
  dayNightRig({
    phase,
    biome: 'vale',
    moonLitFrac: 0.5,
    pinDay: false,
    nightLayers: true,
    fixedSun: FIXED_SUN,
    ...over,
  });

describe('the day/night rig', () => {
  it('puts the sun up at noon and the moon up at midnight', () => {
    const noon = rig(0.5);
    const midnight = rig(0);
    expect(noon.sunUp).toBeGreaterThan(0.9);
    expect(noon.moonUp).toBe(0);
    expect(midnight.sunUp).toBe(0);
    expect(midnight.moonUp).toBeGreaterThan(0.9);
  });

  it('reads the moon as the sun half a cycle away, which is why they never meet', () => {
    const midnight = rig(0);
    expect([...midnight.moon]).toEqual([...sunDirection(0.5)]);
  });

  it('darkens the grade and lights the stars as the cycle runs to midnight', () => {
    const noon = rig(0.5);
    const dusk = rig(0.75);
    const midnight = rig(0);
    expect(noon.grade.lightScale).toBeGreaterThan(dusk.grade.lightScale);
    expect(dusk.grade.lightScale).toBeGreaterThan(midnight.grade.lightScale);
    expect(noon.starAmt).toBe(0);
    expect(midnight.starAmt).toBe(1);
    // The star field follows the same dayness the grade does, rather than a
    // second curve that could disagree about when night is.
    expect(dusk.starAmt).toBeLessThan(1);
    expect(dusk.starAmt).toBeGreaterThanOrEqual(0);
  });

  it('reports the night the READABILITY layers key off, and zeroes it on a tier that has none', () => {
    expect(rig(0).globalNight).toBeCloseTo(1, 6);
    expect(rig(0.5).globalNight).toBeCloseTo(0, 6);
    // Same midnight, a tier that never applies the grade: its lamps must not
    // light under a sky it never darkened.
    expect(rig(0, { nightLayers: false }).globalNight).toBe(0);
  });

  it('lifts a full-moon night above a new-moon one, and only the night', () => {
    const full = rig(0, { moonLitFrac: 1 });
    const none = rig(0, { moonLitFrac: 0 });
    expect(full.grade.lightScale).toBeGreaterThan(none.grade.lightScale);
    expect(full.grade.ambientScale).toBeGreaterThan(none.grade.ambientScale);
    // Day is the identity either way: the moon shapes the night dip only.
    expect(rig(0.5, { moonLitFrac: 1 }).grade).toEqual(rig(0.5, { moonLitFrac: 0 }).grade);
  });

  it('compresses both bodies by the SAME realm amplitude', () => {
    // One realm's amplitude, applied to the sun and the moon alike: a realm that
    // held one back and not the other would light bodies from a sky it dimmed.
    for (const biome of ['vale', 'night', 'ember'] as BiomeId[]) {
      const noon = rig(0.5, { biome });
      expect(noon.sunUp).toBeCloseTo(
        aboveHorizon(sunDirection(0.5)[1]) * REALM_DAYNIGHT_AMPLITUDE[biome],
        6,
      );
    }
  });

  it('holds the authored daylight look when the cycle is switched off', () => {
    // Not a time of day: the cycle not running. The fixed sun stands where the
    // authored rig put it, the moon is under the horizon and no star shows,
    // whatever phase the clock happens to report.
    for (const phase of [0, 0.25, 0.5, 0.9]) {
      const pinned = rig(phase, { pinDay: true });
      expect(pinned.grade).toEqual(NEUTRAL_DAY_GRADE);
      expect([...pinned.sun]).toEqual([...FIXED_SUN]);
      expect(pinned.moon[1]).toBeLessThan(0);
      expect(pinned.moonUp).toBe(0);
      expect(pinned.starAmt).toBe(0);
      expect(pinned.globalNight).toBe(0);
    }
  });

  it('is pure: the same inputs give the same rig', () => {
    expect(rig(0.62)).toEqual(rig(0.62));
    expect(globalDayness(0.62)).toBe(globalDayness(0.62));
  });
});
