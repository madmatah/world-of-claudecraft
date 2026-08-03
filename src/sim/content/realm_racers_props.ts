// What a piece of Realm Racers scenery IS, as far as the sim is concerned: a
// footprint, whether it stops a machine, and how tall it stands.
//
// It exists because `src/sim/` cannot import the render catalog and a collider
// needs dimensions a boolean cannot carry. What it is NOT is a second render
// registry: every key here resolves render side through
// `src/render/realm_racers_prop_visuals.ts`, which itself resolves through the
// world's own `PROP_ASSET_DEFS` (or a named procedural builder), so an
// Evergarden circuit wears the Evergarden's vocabulary and the media manifest
// and preload guards keep working. `tests/realm_racers_props.test.ts` pins both
// halves against each other.
//
// The table covers EVERY authorable kind rather than only the collidable ones,
// because the check that would have caught the tiered fountain standing in the
// Express Tour's road (`prop_blocks_racing_surface`) measures a footprint, and
// that fountain is decorative. A decorative piece with no dimensions is a piece
// the readout has to guess at, and a guess is what put it there.
//
// SIZES ARE MEASURED, not guessed, exactly as `prop_layout.ts` measures the
// world's own sub-props: each footprint and height below is the shipped GLB's
// own bounding box at scale 1 (or, for the two procedural pieces, the geometry
// their builder mints), trimmed a little on the radius because a forgiving
// footprint costs a racer nothing while a too-generous one reads as a bug.
//
// Pure leaf: data only, no SimContext, no rng, no clock.

/** A footprint in yards, at scale 1 and in the prop's own frame. */
export type RallyPropFootprint =
  | { kind: 'circle'; r: number }
  | { kind: 'obb'; hw: number; hd: number };

export interface RallyPropDef {
  footprint: RallyPropFootprint;
  /**
   * Whether this kind stops a machine unless the record says otherwise.
   *
   * Foliage, flowers and anything a wheel would flatten are false: a racer
   * driving through a flower bed is the Evergarden, and an invisible wall on a
   * tuft is the surprise workstream 02 outlawed.
   */
  solid: boolean;
  /** Visual height at scale 1, yards. Read by the legibility check (a solid
   *  piece too low to see is a trap) and by the collider's `cameraTopY`. */
  height: number;
}

/**
 * The authorable set. Adding a kind means adding it HERE and in the render
 * catalog; the test fails on a key that only one of the two knows.
 */
export const REALM_RACERS_PROPS: Record<string, RallyPropDef> = {
  // --- the two procedural pieces the Evergarden already builds in code ---
  // buildTieredFountain: a 3.3 yard basin under a 3.4 yard column and finial.
  fountain: { footprint: { kind: 'circle', r: 3.3 }, solid: true, height: 3.8 },
  // gardenStatueGeo: a 1.5 yard plinth under a robed figure, 3.5 to the head.
  statue: { footprint: { kind: 'obb', hw: 0.75, hd: 0.75 }, solid: true, height: 3.5 },

  // --- the garden's own stonework and ironwork (PROP_ASSET_DEFS keys) ---
  well: { footprint: { kind: 'circle', r: 0.42 }, solid: true, height: 1.25 },
  column: { footprint: { kind: 'circle', r: 0.15 }, solid: true, height: 1.0 },
  columnBroken: { footprint: { kind: 'circle', r: 0.15 }, solid: true, height: 0.7 },
  statueBlock: { footprint: { kind: 'obb', hw: 0.2, hd: 0.2 }, solid: true, height: 0.4 },
  statueHead: { footprint: { kind: 'obb', hw: 0.36, hd: 0.27 }, solid: true, height: 1.0 },
  gardenArch: { footprint: { kind: 'obb', hw: 2.1, hd: 0.38 }, solid: true, height: 4.41 },
  gardenIronFence: { footprint: { kind: 'obb', hw: 2.0, hd: 0.25 }, solid: true, height: 2.2 },
  gardenIronPillar: { footprint: { kind: 'obb', hw: 0.25, hd: 0.25 }, solid: true, height: 2.2 },
  bench: { footprint: { kind: 'obb', hw: 0.87, hd: 0.37 }, solid: true, height: 0.5 },
  postLantern: { footprint: { kind: 'circle', r: 0.27 }, solid: true, height: 1.13 },
  banner: { footprint: { kind: 'circle', r: 0.13 }, solid: false, height: 0.28 },
  haybale: { footprint: { kind: 'obb', hw: 0.2, hd: 0.11 }, solid: true, height: 0.18 },
  leafyFoxStatue: { footprint: { kind: 'circle', r: 0.35 }, solid: true, height: 0.98 },
  goldenHorseStatue: { footprint: { kind: 'circle', r: 0.48 }, solid: true, height: 0.9 },

  // --- the Nightbloom's growth: what a dream wood is dressed with, and what
  // the deleted dressing ring used to plant out there. Measured the same way as
  // everything above, off the shipped GLB. The mushroom takes the radius the
  // ZONE itself collides it with (`realm.ts` seats it at scale 10 for a 1.9
  // yard radius, which is its STALK, not its cap, the same trunk-tight trim
  // `oak` takes); the amethyst is trimmed under its own 2.20 half-extent rather
  // than taking the zone's 2.4, which would be the too-generous footprint this
  // table's header warns reads as a bug ---
  giantMushroom: { footprint: { kind: 'circle', r: 0.19 }, solid: true, height: 0.98 },
  amethyst: { footprint: { kind: 'circle', r: 2.2 }, solid: true, height: 6.0 },
  glowCluster: { footprint: { kind: 'circle', r: 0.38 }, solid: false, height: 0.97 },
  glowFlower: { footprint: { kind: 'circle', r: 0.42 }, solid: false, height: 0.72 },

  // --- planting: drivable by design, whatever its size ---
  oak: { footprint: { kind: 'circle', r: 0.55 }, solid: true, height: 9.44 },
  shrub: { footprint: { kind: 'circle', r: 0.45 }, solid: false, height: 0.45 },
  bedRound: { footprint: { kind: 'circle', r: 0.47 }, solid: false, height: 0.5 },
  bedSquareA: { footprint: { kind: 'obb', hw: 0.49, hd: 0.49 }, solid: false, height: 0.17 },
  bedSquareB: { footprint: { kind: 'obb', hw: 0.49, hd: 0.49 }, solid: false, height: 0.2 },
  reeds: { footprint: { kind: 'circle', r: 0.34 }, solid: false, height: 1.0 },
  lilyRaft: { footprint: { kind: 'circle', r: 0.49 }, solid: false, height: 0.22 },
};

/** The def for a key, or undefined for a key nothing authors. */
export function realmRacersPropDef(asset: string): RallyPropDef | undefined {
  return REALM_RACERS_PROPS[asset];
}
