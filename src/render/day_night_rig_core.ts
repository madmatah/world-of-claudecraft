// The LIGHTING RIG one frame stands under: the whole day/night state the
// renderer holds, computed from a cycle phase and a realm.
//
// It came out of `renderer.ts`'s ambience pass, which is where every one of
// these seven values was assigned field by field through two nested branches.
// They are one answer, not seven: the sun and the moon are the same arc half a
// cycle apart, the star field follows the same dayness the grade does, and the
// pinned-daylight arm is the same answer with the cycle switched off. Reading
// them off one function is what makes that visible, and it is what lets a
// Vitest drive midnight without a renderer.
//
// A render pure core: no Three, no DOM, no clock. The caller passes the phase
// (the world's, or a Realm Racers circuit's authored hour), the realm, the
// moon's illumination and the fixed sun its pinned look stands under.

import type { BiomeId } from '../sim/types';
import {
  aboveHorizon,
  type DayNightGrade,
  dayNightGrade,
  duskWarmAmount,
  effectiveDayness,
  globalDayness,
  moonDirection,
  NEUTRAL_DAY_GRADE,
  nightStarAmount,
  REALM_DAYNIGHT_AMPLITUDE,
  sunDirection,
  warmDuskGrade,
} from './day_night_core';
import { nightLightAmount } from './night_lighting_core';

/** The lowest a realm's moon is allowed to read as "up", so a compressed realm
 *  still gets moonlit shading rather than a flat night. */
const MIN_MOON_AMPLITUDE = 0.6;

export type Direction3 = readonly [number, number, number];

/** Everything a frame's lighting is built from, in one answer. */
export interface DayNightRig {
  /** The grade every surface multiplies by (fog, sky, light and ambient). */
  grade: DayNightGrade;
  /** How far into night the shared WORLD clock is, for the after-dark
   *  readability layers (lamps, ground glow, rim lift); 0 when they are off. */
  globalNight: number;
  sun: Direction3;
  moon: Direction3;
  /** How far above the horizon each body reads, already realm-compressed. */
  sunUp: number;
  moonUp: number;
  starAmt: number;
}

export interface DayNightRigInput {
  /** Cycle phase: 0 midnight, 0.25 sunrise, 0.5 noon, 0.75 sunset. */
  phase: number;
  biome: BiomeId;
  /** 0 new moon, 1 full: swings the night floors around their half-moon
   *  reference, so a full-moon night is brighter than a new-moon one. */
  moonLitFrac: number;
  /**
   * Hold the world at its authored daylight look and switch the cycle off (the
   * `DAY_ONLY` kill switch). The moon is below the horizon and the stars are
   * out, because this is not a time of day: it is the cycle not running.
   */
  pinDay: boolean;
  /**
   * Whether the after-dark readability layers run this frame.
   *
   * False on a tier that never applies the grade: a world that stays at noon has
   * nothing to compensate for, and lighting its lamps under a bright sky would
   * read as a bug rather than as night.
   */
  nightLayers: boolean;
  /** The fixed sun a pinned look stands under (the renderer's `SUN_DIR`). */
  fixedSun: Direction3;
}

/** The rig for one frame. Pure: same inputs, same seven values. */
export function dayNightRig(input: DayNightRigInput): DayNightRig {
  const { phase, biome, pinDay, fixedSun } = input;
  const amplitude = REALM_DAYNIGHT_AMPLITUDE[biome];
  if (pinDay) {
    return {
      grade: NEUTRAL_DAY_GRADE,
      globalNight: 0,
      sun: fixedSun,
      moon: [0, -1, 0],
      sunUp: aboveHorizon(fixedSun[1]) * amplitude,
      moonUp: 0,
      starAmt: 0,
    };
  }
  const dayness = globalDayness(phase);
  const sun = sunDirection(phase);
  const moon = moonDirection(phase);
  return {
    // The whole grade warms as the sun crosses the horizon, so the fog, the sky
    // dome and the water take the sunrise and sunset orange rather than the key
    // light taking it alone.
    grade: warmDuskGrade(
      dayNightGrade(effectiveDayness(dayness, biome), biome, input.moonLitFrac),
      duskWarmAmount(sun[1]),
    ),
    // The readability layers read the WORLD clock rather than the realm's
    // compressed grade, so every realm lights its lamps at the same instant.
    globalNight: nightLightAmount(1 - dayness, input.nightLayers),
    sun,
    moon,
    sunUp: aboveHorizon(sun[1]) * amplitude,
    moonUp: aboveHorizon(moon[1]) * Math.max(amplitude, MIN_MOON_AMPLITUDE),
    starAmt: nightStarAmount(dayness),
  };
}
