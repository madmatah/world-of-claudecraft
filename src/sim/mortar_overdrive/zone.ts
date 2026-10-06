// Which world zone a Mortar Overdrive circuit belongs to, for every surface that
// names where a player is (the minimap label, the map window, the continent
// highlight).
//
// The Mortar Overdrive band sits on the instance plane far east of the map, so the
// overworld lookup (`zoneAt`) answers a lane with whichever zone band its z
// happens to share: the Palmreach Lagoon Run read The Drakelands, and the six
// Evergarden practice copies read six different realms. A circuit belongs to
// the zone its THEME is named after instead, which is also the art it wears.
//
// A sibling of the lane leaf rather than part of it: this reads the zone
// table in `data.ts`, which reaches the whole content tree, and the leaf is
// kept off that graph on purpose.

import {
  MORTAR_OVERDRIVE_DEFAULT_THEME_ID,
  MORTAR_OVERDRIVE_THEME_IDS,
} from '../content/mortar_overdrive/circuits';
import { ZONES } from '../data';
import type { ZoneDef } from '../types';
import {
  MORTAR_OVERDRIVE_BAND_X_MAX,
  MORTAR_OVERDRIVE_BAND_X_MIN,
  mortarOverdriveLaneAt,
} from './layout';

// The theme ids are the zone ids with their trailing landform dropped
// (`eastbrook` for `eastbrook_vale`, `farshore` for `farshore_isle`), the
// naming rule `MORTAR_OVERDRIVE_THEME_IDS` documents. Keyed by that list rather
// than by every zone, so an id the renderer has no theme for (a zone without a
// circuit kit) falls back here exactly as it does there.
const ZONE_BY_THEME: ReadonlyMap<string, ZoneDef> = new Map(
  MORTAR_OVERDRIVE_THEME_IDS.flatMap((themeId) => {
    const zone = ZONES.find((z) => z.id.replace(/_(vale|marsh|heights|isle)$/, '') === themeId);
    return zone ? [[themeId, zone] as const] : [];
  }),
);

const DEFAULT_THEME_ZONE: ZoneDef = (() => {
  const zone = ZONE_BY_THEME.get(MORTAR_OVERDRIVE_DEFAULT_THEME_ID);
  if (!zone) throw new Error(`no zone for the default theme ${MORTAR_OVERDRIVE_DEFAULT_THEME_ID}`);
  return zone;
})();

/** The zone a circuit theme is named after, or the default theme's zone for an
 *  id no zone answers to (a draft's typo), the way the renderer falls back. */
export function mortarOverdriveThemeZone(themeId: string): ZoneDef {
  return ZONE_BY_THEME.get(themeId) ?? DEFAULT_THEME_ZONE;
}

/**
 * The zone a player standing at (x, z) is in while on the Mortar Overdrive band: the zone
 * of the circuit on that lane, and the default theme's zone between lanes
 * (where the renderer also draws the default theme's sky). Null off the band,
 * where the caller's own zone lookup stands.
 *
 * A pure function of position and static content, so both worlds answer it
 * from the player's position alone. A draft lane this host has no record of
 * reads as the space between lanes.
 */
export function mortarOverdriveZoneAt(x: number, z: number): ZoneDef | null {
  if (x < MORTAR_OVERDRIVE_BAND_X_MIN || x > MORTAR_OVERDRIVE_BAND_X_MAX) return null;
  const lane = mortarOverdriveLaneAt(x, z);
  return lane ? mortarOverdriveThemeZone(lane.circuit.theme) : DEFAULT_THEME_ZONE;
}
