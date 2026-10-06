// The Drakelands prop models (built by build_drakelands_props.mjs), apart from
// the builder that places them so a consumer can name one without importing
// the whole ember zone build.
//
// `ember_features.ts` fetches every one of them in the deferred lane at world
// entry and keeps each parsed scene for the session, drawing its raw glTF
// materials; the Mortar Overdrive dressing draws the same files through that same
// parse (mortar_overdrive/dressing_material.ts, the `worldRaw` route).

export const EMBER_PROP_URLS = {
  // the lava vocabulary is exactly three pieces: a pool, the river middle
  // that connects, and the river end that terminates a spill
  pool: '/models/props/lava_pool.glb',
  riverMid: '/models/props/lava_river_mid.glb',
  riverEnd: '/models/props/lava_river_end.glb',
  hoard: '/models/props/dragon_hoard.glb',
  eggs: '/models/props/dragon_eggs.glb',
  lily: '/models/props/ember_lily.glb',
} as const;

export type EmberPropKey = keyof typeof EMBER_PROP_URLS;
