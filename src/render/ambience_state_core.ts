// The camera-follow ambience readout: where the local player is standing, as
// the audio sink's ambience() wants it (dungeon or not, the biome, the
// weather that biome carries, and whether the player is at the water's edge).
// Sampled at the AVATAR eye, never at the Action Cam's shifted aim, so a
// shoulder offset cannot flip rain, water or dungeon state early at an edge.
// A Realm Racers circuit is the one place on the instance plane that reads as
// outdoors: it plays the beds of the zone its theme is dressed as.
// Pure and allocation-free: the renderer owns one state and refills it per
// frame. Extracted from renderer.ts updateCamera.

import {
  REALM_RACERS_DEFAULT_THEME_ID,
  realmRacersThemeIdForZone,
} from '../sim/content/realm_racers_circuits';
import { DUNGEON_X_THRESHOLD, ZONES } from '../sim/data';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import type { BiomeId } from '../sim/types';
import { groundHeight, waterLevelAt, zoneBiomeAt } from '../sim/world';

export interface AmbienceState {
  inDungeon: boolean;
  biome: BiomeId;
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

// The built-in zone table on purpose: a theme names a shipped zone, which an
// editor play-test map does not redefine.
const THEME_ZONE_BIOMES: ReadonlyMap<string, BiomeId> = new Map(
  ZONES.map((zone) => [realmRacersThemeIdForZone(zone.id), zone.biome]),
);

/** Refill `out` for the player at (x, z). Writes into `out` and returns it. */
export function sampleAmbienceInto(
  out: AmbienceState,
  x: number,
  z: number,
  seed: number,
  weatherOn: boolean,
): AmbienceState {
  const lane = realmRacersLaneAt(x, z);
  if (lane) {
    out.inDungeon = false;
    // An unknown theme draws as the default one, so it sounds like it too.
    out.biome =
      THEME_ZONE_BIOMES.get(lane.circuit.theme) ??
      THEME_ZONE_BIOMES.get(REALM_RACERS_DEFAULT_THEME_ID) ??
      zoneBiomeAt(x, z);
    // The band draws no weather of its own, and the world's water table does
    // not know the circuit's ponds.
    out.precip = null;
    out.nearWater = false;
    return out;
  }
  out.inDungeon = x > DUNGEON_X_THRESHOLD;
  out.biome = zoneBiomeAt(x, z);
  out.precip = biomePrecipitation(out.biome, out.inDungeon, weatherOn);
  // Only at the water's edge / in it, sampled at the player, so a loose
  // threshold made the loop bleed across the low marsh from far off.
  out.nearWater =
    !out.inDungeon && groundHeight(x, z, seed) < waterLevelAt(x, z, seed) + NEAR_WATER_MARGIN;
  return out;
}
