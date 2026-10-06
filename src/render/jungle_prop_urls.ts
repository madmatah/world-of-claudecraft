// The Palmreach's own models, apart from the builder that places them so a
// consumer can name one without importing the whole jungle zone build.
//
// `jungle_features.ts` fetches every one of them in the deferred lane at world
// entry and keeps each parsed scene for the session, drawing its raw glTF
// materials; the Mortar Overdrive dressing draws the palms and the coconuts through
// that same parse (mortar_overdrive/dressing_material.ts, the `worldRaw` route).

/** The three beach-palm variants, indexed by `ReachPalm.variant`. */
export const JUNGLE_PALM_URLS = [
  '/models/biome/beach_palm_1.glb',
  '/models/biome/beach_palm_2.glb',
  '/models/biome/beach_palm_3.glb',
] as const;

/** The ground props: the maintainer's generated fallen-coconut clusters (built
 *  by build_palmreach_props.mjs), plus the Willowfen's lily rafts and river
 *  reeds reused on the Palmreach's still water. */
export const JUNGLE_PROP_URLS = {
  coconuts: '/models/props/fallen_coconuts.glb',
  lilies: '/models/props/fen_lilies.glb',
  reeds: '/models/props/fen_reeds.glb',
} as const;

export type JunglePropKey = keyof typeof JUNGLE_PROP_URLS;
