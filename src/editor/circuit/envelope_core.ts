// What enclosure fits a road: the perimeter wall around it and the collision
// region around that, derived from the road's measured footprint.
//
// This is a CONVENIENCE, not a rule. The rules (road inside the wall, wall
// inside the region, region inside the band and inside the lane's depth budget)
// live in `src/sim/realm_racers_circuit_metrics.ts`, because the game depends on
// them; what this module owns is only the question the operator would otherwise
// answer by hand every time they redraw: given a road this big, what numbers
// should the two boxes carry?
//
// It clamps to the same limits the metrics core checks, so a suggestion is never
// one the readout would immediately reject. When a road is too big for the band
// the suggestion is clamped rather than stretched, and the readout says so: the
// tool must not quietly hand back an envelope that cuts the circuit off.
//
// Pure core: DOM-free, deterministic, no clock, no rng.

import type { RealmRacersPerimeter } from '../../sim/content/realm_racers_circuits';
import {
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
} from '../../sim/realm_racers_layout';

/**
 * Lawn between the garden edge and the wrought-iron wall, yards. Taken from the
 * garden circuit's own proportions (a 99 yd road inside a 118 yd wall), because
 * the wall reads as the far side of a garden rather than as a fence around the
 * tarmac.
 */
const WALL_MARGIN = 20;

/**
 * Dressing ring beyond the wall that the collision region still has to cover,
 * yards. Also the garden's (a 118 yd wall inside a 170 yd region): everything
 * built out there is inside the rally, and a region that stopped at the wall
 * would drop it through to interior collision.
 */
const DRESSING_MARGIN = 48;

/** Whatever else, the region has to be strictly wider than the wall. */
const REGION_OVER_PERIMETER = 1;

export interface EnvelopeSuggestion {
  perimeter: RealmRacersPerimeter;
  regionHalfX: number;
  regionHalfZ: number;
  /**
   * Which limit clamped the suggestion, if any. `band` is the x window between
   * the neighbouring instance bands; `lane` is the depth budget between two
   * copies of a circuit. A clamped suggestion may leave the road outside its own
   * wall, which the readout then reports: that is the honest answer, and the fix
   * is a smaller circuit, not a bigger box.
   */
  clampedBy: readonly ('band' | 'lane')[];
}

/**
 * The enclosure for a road of this measured footprint (`roadHalfX` / `roadHalfZ`
 * from the metrics readout: out to the garden edge, both sides, from the
 * circuit's origin).
 */
export function suggestEnvelope(
  roadHalfX: number,
  roadHalfZ: number,
  existing?: RealmRacersPerimeter,
): EnvelopeSuggestion {
  const clampedBy: ('band' | 'lane')[] = [];

  let regionHalfX = Math.ceil(roadHalfX + WALL_MARGIN + DRESSING_MARGIN);
  if (regionHalfX > REALM_RACERS_MAX_REGION_HALF_X) {
    regionHalfX = REALM_RACERS_MAX_REGION_HALF_X;
    clampedBy.push('band');
  }
  let regionHalfZ = Math.ceil(roadHalfZ + WALL_MARGIN + DRESSING_MARGIN);
  if (regionHalfZ > REALM_RACERS_MAX_REGION_HALF_Z) {
    regionHalfZ = REALM_RACERS_MAX_REGION_HALF_Z;
    clampedBy.push('lane');
  }

  return {
    perimeter: {
      // The wall keeps whatever thickness and height the circuit already
      // authored: those are dressing, and nothing here has an opinion on them.
      halfThickness: existing?.halfThickness ?? 0.4,
      height: existing?.height ?? 2.2,
      halfX: Math.min(Math.ceil(roadHalfX + WALL_MARGIN), regionHalfX - REGION_OVER_PERIMETER),
      halfZ: Math.min(Math.ceil(roadHalfZ + WALL_MARGIN), regionHalfZ - REGION_OVER_PERIMETER),
    },
    regionHalfX,
    regionHalfZ,
    clampedBy,
  };
}
