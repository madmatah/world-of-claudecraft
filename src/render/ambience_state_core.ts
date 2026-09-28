// The camera-follow ambience readout: where the local player is standing, as
// the audio sink's ambience() wants it (dungeon or not, the biome, the
// weather that biome carries, and whether the player is at the water's edge).
// Sampled at the AVATAR eye, never at the Action Cam's shifted aim, so a
// shoulder offset cannot flip rain, water or dungeon state early at an edge.
// A Realm Racers circuit samples as nowhere a bed plays (no biome, no
// dungeon), so its music, engines and effects are the whole mix.
// Pure and allocation-free: the renderer owns one state and refills it per
// frame. Extracted from renderer.ts updateCamera.

import { DUNGEON_X_THRESHOLD } from '../sim/data';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import type { BiomeId } from '../sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';

export interface AmbienceState {
  inDungeon: boolean;
  /** Null where no bed plays at all: a Realm Racers circuit. */
  biome: BiomeId | null;
  precip: 'snow' | 'rain' | null;
  nearWater: boolean;
}

/** How far above the ground the water must sit for the shore loop (yards). */
export const NEAR_WATER_MARGIN = 0.4;

export function createAmbienceState(): AmbienceState {
  return { inDungeon: false, biome: zoneBiomeAt(0, 0), precip: null, nearWater: false };
}

/** The ambient precipitation a biome carries, or null (weather off, indoors). */
export function biomePrecipitation(
  biome: BiomeId,
  inDungeon: boolean,
  weatherOn: boolean,
): 'snow' | 'rain' | null {
  if (!weatherOn || inDungeon) return null;
  if (biome === 'peaks' || biome === 'frost') return 'snow';
  // The haunted wood drips under a permanent drizzle.
  if (biome === 'marsh' || biome === 'haunt') return 'rain';
  return null;
}

/** Refill `out` for the player at (x, z). Writes into `out` and returns it. */
export function sampleAmbienceInto(
  out: AmbienceState,
  x: number,
  z: number,
  seed: number,
  weatherOn: boolean,
): AmbienceState {
  if (realmRacersLaneAt(x, z)) {
    out.inDungeon = false;
    out.biome = null;
    out.precip = null;
    out.nearWater = false;
    return out;
  }
  const biome = zoneBiomeAt(x, z);
  out.inDungeon = x > DUNGEON_X_THRESHOLD;
  out.biome = biome;
  out.precip = biomePrecipitation(biome, out.inDungeon, weatherOn);
  // Only at the water's edge / in it, sampled at the player, so a loose
  // threshold made the loop bleed across the low marsh from far off.
  out.nearWater =
    !out.inDungeon && groundHeight(x, z, seed) < waterLevelAt(x, z, seed) + NEAR_WATER_MARGIN;
  return out;
}
