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
// Height is the box's full vertical extent rounded to the centimetre; a
// footprint is trimmed DOWN to it, never up.
//
// WHAT MAY BE ADDED HERE, and this is a promise a test keeps: only a model the
// game client ALREADY fetches at world entry for every player. `props.ts`
// registers EVERY `PROP_ASSET_DEFS` entry in the deferred preload lane that
// `startGame` opens, so a catalog key pointing at one of those files adds no
// download to world entry. Three other world lanes keep the same promise and
// are the only others admitted: the env-prop templates (`ignivar_env_props.ts`),
// the ember zone's own set (`ember_prop_urls.ts`) and the jungle zone's
// (`jungle_prop_urls.ts`), all registered in that same deferred lane when the
// renderer's modules load. A model that arrives on zone
// proximity or on instance entry is a different promise, and
// `tests/realm_racers_props.test.ts` fails on one. The RESIDENT half of that
// promise is the rally track builder's business rather than this file's: it
// fetches a dressing model when a circuit is actually built and keeps only what
// an authored circuit places, so a catalog this wide costs nobody who never
// races anything at all.
//
// Kinds of already-loaded key that are deliberately still absent:
//  - anything whose scale-1 box leaves the suite's envelope (height >= 20 or
//    radius >= 10);
//  - the keys carrying a `PropAssetDef` yaw or strip correction (house2,
//    stand1, stand2, cart, tentOpen, tentSmall), which the rally draw path does
//    not apply, so a promoted one would face or wear the wrong thing;
//  - the WALL-MOUNTED and origin-sunk pieces, which the rally path would seat
//    wrong for the reason the render mirror's header states: it seats a model
//    at its authored origin instead of re-basing it to its lowest vertex the
//    way `propAsset` does for the world's placed props. The shelves, the
//    sword-and-shield plaque and the delve portal are authored around a wall
//    that is not there, so half of each is under the lawn; the three castle
//    banners hang from a fixing and float half a yard above it. Fixing the
//    draw path is a separate piece of work; until then they are not authorable.
//
// Pure leaf: data only, no SimContext, no rng, no clock.

import {
  STREETLAMP_COLLIDER_RADIUS,
  STREETLAMP_FIXTURE_HEIGHT,
  type StreetlampStyleId,
} from '../streetlamp_style';

/** A footprint in yards, at scale 1 and in the prop's own frame. */
export type RallyPropFootprint =
  | { kind: 'circle'; r: number }
  | { kind: 'obb'; hw: number; hd: number };

export interface RallyPropDef {
  footprint: RallyPropFootprint;
  /**
   * Whether this kind stops a machine unless the record says otherwise.
   *
   * Three things make it false, and the third is a HEIGHT rule rather than a
   * judgement about what the piece is:
   *
   *  - foliage, flowers and anything a wheel would flatten: a racer driving
   *    through a flower bed is the Evergarden, and an invisible wall on a tuft
   *    is the surprise workstream 02 outlawed;
   *  - ground a wheel rolls over, the flagstone slabs being the case in point;
   *  - ANYTHING 0.15 YARDS OR LOWER at scale 1. The collider builder applies no
   *    height threshold of its own, so a solid piece that low is an ankle-high
   *    wall a pilot cannot see coming, which is the same surprise by another
   *    route. Fifteen centimetres is where the flagstone slab sits, and the
   *    rule is what keeps a sack, a trough or a beached dinghy from stopping a
   *    machine dead.
   */
  solid: boolean;
  /** Visual height at scale 1, yards. Read by the legibility check (a solid
   *  piece too low to see is a trap) and by the collider's `cameraTopY`. */
  height: number;
}

/**
 * The world's own streetlamp fixtures, as circuit dressing: one key per style.
 *
 * A circuit lit after dark is lit by the same lamps its zone lights its roads
 * with, and the reason is not thrift. Every fixture carries an AUTHORED light
 * socket, authored emissive materials and a modelled flame
 * (`src/render/streetlamp_assets.ts`), which is what lets a lamp on a verge
 * light the road through the night light field rather than glow at it; a new
 * model would have to be given all three by hand before it lit anything.
 *
 * They meet this table's own promise about downloads: all fourteen are
 * registered in the deferred preload lane at world entry for every player
 * (`streetlamp_assets.ts`), so a circuit placing one adds no fetch.
 *
 * One key per STYLE rather than one generic key, because the footprint below is
 * the pinned, measured collider radius of that fixture
 * (`STREETLAMP_COLLIDER_RADIUS`) and the styles differ by more than a factor of
 * two. A generic key would have to carry the widest of them, which is exactly
 * the too-generous footprint this file's header calls a bug. What keeps the
 * editor's palette from growing fourteen tiles is the theme: each theme offers
 * its own zone's lamp and nothing else (`realm_racers_themes.ts`).
 */
export const REALM_RACERS_LAMP_STYLES: Readonly<Record<string, StreetlampStyleId>> = {
  lampEastbrookCivic: 'eastbrook_civic',
  lampMirefenWitchflame: 'mirefen_witchflame',
  lampThornpeakBeacon: 'thornpeak_beacon',
  lampVeiledCrystal: 'veiled_crystal',
  lampDrakelandsBrazier: 'drakelands_brazier',
  lampFrostveilIcicle: 'frostveil_icicle',
  lampAmberfallCrystal: 'amberfall_crystal',
  lampWillowfenReed: 'willowfen_reed',
  lampNightbloomMoonflower: 'nightbloom_moonflower',
  lampWraithwoodGhost: 'wraithwood_ghost',
  lampPalmreachTotem: 'palmreach_totem',
  lampEvergardenFlower: 'evergarden_flower',
  lampGalecrestMast: 'galecrest_mast',
  lampFarshoreCoral: 'farshore_coral',
};

/**
 * Their defs, DERIVED rather than re-measured: the height is the one every
 * fixture is scaled to and the radius is the collider the world already walks
 * into, both from `src/sim/streetlamp_style.ts` and both pinned there against
 * the shipped GLBs. Measuring them a second time here is how the two halves of
 * one lamp drift apart.
 */
const LAMP_PROP_DEFS: Record<string, RallyPropDef> = Object.fromEntries(
  Object.entries(REALM_RACERS_LAMP_STYLES).map(([key, style]) => [
    key,
    {
      footprint: { kind: 'circle', r: STREETLAMP_COLLIDER_RADIUS[style] },
      solid: true,
      height: STREETLAMP_FIXTURE_HEIGHT,
    },
  ]),
);

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
  // The specimen elder the Evergarden's lawns are landmarked with, and the
  // same giant three other zones raise. Its box is 13.3 by 16.4 by 11.5, and
  // the height is that box; the radius is the TRUNK, taken from the world's own
  // answer for this model rather than guessed: `colliders.ts` gives a great
  // tree `r * 1.45` at a scale of `r * 2.4` to `r * 2.9`, which is 0.55 at
  // scale 1, the same trim the oak's 1.9 yard crown takes. A circuit places it
  // at the scale the zones do, 6 to 9.
  greatTree: { footprint: { kind: 'circle', r: 0.55 }, solid: true, height: 16.4 },
  shrub: { footprint: { kind: 'circle', r: 0.45 }, solid: false, height: 0.45 },
  bedRound: { footprint: { kind: 'circle', r: 0.47 }, solid: false, height: 0.5 },
  bedSquareA: { footprint: { kind: 'obb', hw: 0.49, hd: 0.49 }, solid: false, height: 0.17 },
  bedSquareB: { footprint: { kind: 'obb', hw: 0.49, hd: 0.49 }, solid: false, height: 0.2 },
  reeds: { footprint: { kind: 'circle', r: 0.34 }, solid: false, height: 1.0 },
  lilyRaft: { footprint: { kind: 'circle', r: 0.49 }, solid: false, height: 0.22 },

  // --- THE PROMOTED SET: everything the world already loads at entry ---
  //
  // The three hexagon-pack towns (green Evergarden, blue Wickharbor, red
  // Drakelands) plus the Hollow's own colourway and the Quaternius village.
  // Every one of them is authored near hex-tile size, which is why a zone
  // seats them with a scale of seven to eleven: at scale 1 a castle is four
  // yards tall, so these are trackside models a circuit sizes for itself.
  house1: { footprint: { kind: 'obb', hw: 1.07, hd: 1.32 }, solid: true, height: 3.39 },
  house3: { footprint: { kind: 'obb', hw: 0.96, hd: 1.06 }, solid: true, height: 1.07 },
  blacksmith: { footprint: { kind: 'obb', hw: 1.94, hd: 1.64 }, solid: true, height: 3.0 },
  inn: { footprint: { kind: 'obb', hw: 2.01, hd: 2.01 }, solid: true, height: 3.49 },
  kmedHomeA: { footprint: { kind: 'obb', hw: 0.39, hd: 0.42 }, solid: true, height: 0.93 },
  kmedHomeB: { footprint: { kind: 'obb', hw: 0.43, hd: 0.54 }, solid: true, height: 1.28 },
  kmedTavern: { footprint: { kind: 'obb', hw: 0.58, hd: 0.66 }, solid: true, height: 1.4 },
  kmedChurch: { footprint: { kind: 'obb', hw: 0.51, hd: 0.57 }, solid: true, height: 1.65 },
  kmedBlacksmith: { footprint: { kind: 'obb', hw: 0.64, hd: 0.62 }, solid: true, height: 0.99 },
  kmedMarket: { footprint: { kind: 'obb', hw: 0.9, hd: 0.65 }, solid: true, height: 0.98 },
  hexWindmill: { footprint: { kind: 'obb', hw: 0.56, hd: 0.4 }, solid: true, height: 1.46 },
  hexCastle: { footprint: { kind: 'obb', hw: 0.98, hd: 1.12 }, solid: true, height: 3.98 },
  hexTower: { footprint: { kind: 'circle', r: 0.49 }, solid: true, height: 2.19 },
  hexChurch: { footprint: { kind: 'obb', hw: 0.51, hd: 0.57 }, solid: true, height: 1.65 },
  hexTavern: { footprint: { kind: 'obb', hw: 0.58, hd: 0.66 }, solid: true, height: 1.4 },
  hexBlacksmith: { footprint: { kind: 'obb', hw: 0.64, hd: 0.62 }, solid: true, height: 0.99 },
  hexHomeA: { footprint: { kind: 'obb', hw: 0.39, hd: 0.42 }, solid: true, height: 0.93 },
  hexHomeB: { footprint: { kind: 'obb', hw: 0.43, hd: 0.54 }, solid: true, height: 1.28 },
  hexMarket: { footprint: { kind: 'obb', hw: 0.9, hd: 0.65 }, solid: true, height: 0.98 },
  hexWatchtower: { footprint: { kind: 'circle', r: 0.52 }, solid: true, height: 1.11 },
  hexCannonTower: { footprint: { kind: 'circle', r: 0.46 }, solid: true, height: 2.04 },
  hexBarracks: { footprint: { kind: 'obb', hw: 0.72, hd: 0.78 }, solid: true, height: 1.64 },
  hexbHomeA: { footprint: { kind: 'obb', hw: 0.39, hd: 0.42 }, solid: true, height: 0.93 },
  hexbHomeB: { footprint: { kind: 'obb', hw: 0.43, hd: 0.54 }, solid: true, height: 1.28 },
  hexbTavern: { footprint: { kind: 'obb', hw: 0.58, hd: 0.66 }, solid: true, height: 1.4 },
  hexbTownhall: { footprint: { kind: 'obb', hw: 0.71, hd: 0.78 }, solid: true, height: 1.89 },
  hexbWorkshop: { footprint: { kind: 'obb', hw: 0.83, hd: 0.83 }, solid: true, height: 1.15 },
  hexbMarket: { footprint: { kind: 'obb', hw: 0.9, hd: 0.65 }, solid: true, height: 0.98 },
  hexbShipyard: { footprint: { kind: 'obb', hw: 0.96, hd: 0.94 }, solid: true, height: 1.24 },
  hexbStables: { footprint: { kind: 'obb', hw: 0.92, hd: 1.06 }, solid: true, height: 0.61 },
  hexbTowerBase: { footprint: { kind: 'circle', r: 0.46 }, solid: true, height: 1.5 },
  hexbTowerA: { footprint: { kind: 'circle', r: 0.49 }, solid: true, height: 2.19 },
  hexrTowerA: { footprint: { kind: 'circle', r: 0.49 }, solid: true, height: 2.19 },
  hexbTowerB: { footprint: { kind: 'circle', r: 0.59 }, solid: true, height: 2.49 },
  hexbWindmill: { footprint: { kind: 'obb', hw: 0.56, hd: 0.4 }, solid: true, height: 1.46 },
  hexrTent: { footprint: { kind: 'obb', hw: 0.75, hd: 0.67 }, solid: true, height: 0.85 },
  hexrWatchtower: { footprint: { kind: 'circle', r: 0.52 }, solid: true, height: 1.11 },
  hexrCastle: { footprint: { kind: 'obb', hw: 0.98, hd: 1.12 }, solid: true, height: 3.98 },
  hexrTownhall: { footprint: { kind: 'obb', hw: 0.71, hd: 0.78 }, solid: true, height: 1.89 },
  hexrBarracks: { footprint: { kind: 'obb', hw: 0.72, hd: 0.78 }, solid: true, height: 1.64 },
  hexrChurch: { footprint: { kind: 'obb', hw: 0.51, hd: 0.57 }, solid: true, height: 1.65 },
  hexrTavern: { footprint: { kind: 'obb', hw: 0.58, hd: 0.66 }, solid: true, height: 1.4 },
  hexrStables: { footprint: { kind: 'obb', hw: 0.92, hd: 1.06 }, solid: true, height: 0.61 },
  hexrHomeA: { footprint: { kind: 'obb', hw: 0.39, hd: 0.42 }, solid: true, height: 0.93 },
  hexrHomeB: { footprint: { kind: 'obb', hw: 0.43, hd: 0.54 }, solid: true, height: 1.28 },
  hexrMarket: { footprint: { kind: 'obb', hw: 0.9, hd: 0.65 }, solid: true, height: 0.98 },
  hexrBlacksmith: { footprint: { kind: 'obb', hw: 0.64, hd: 0.62 }, solid: true, height: 0.99 },
  hexrWindmill: { footprint: { kind: 'obb', hw: 0.56, hd: 0.4 }, solid: true, height: 1.46 },
  hexrArcheryrange: { footprint: { kind: 'obb', hw: 0.83, hd: 0.77 }, solid: true, height: 1.79 },
  hexrTowerCatapult: { footprint: { kind: 'circle', r: 0.46 }, solid: true, height: 1.96 },
  hexrTowerBase2: { footprint: { kind: 'circle', r: 0.46 }, solid: true, height: 1.5 },

  // --- walls and fencing: the run pieces a circuit lines a lawn with. Length
  // runs along the piece's own long axis, so a row is authored along the road
  // rather than across it ---
  fence: { footprint: { kind: 'obb', hw: 0.39, hd: 0.01 }, solid: true, height: 0.33 },
  kkWall: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kkWallCracked: { footprint: { kind: 'obb', hw: 2.0, hd: 0.63 }, solid: true, height: 4.0 },
  kkPillar: { footprint: { kind: 'obb', hw: 0.75, hd: 0.75 }, solid: true, height: 4.0 },
  hexWall: { footprint: { kind: 'obb', hw: 1.0, hd: 0.4 }, solid: true, height: 1.1 },
  hexFenceStone: { footprint: { kind: 'obb', hw: 0.1, hd: 0.57 }, solid: true, height: 0.27 },
  hexnPalisade: { footprint: { kind: 'obb', hw: 1.0, hd: 0.4 }, solid: true, height: 1.1 },
  kcasWall: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallHalf: { footprint: { kind: 'obb', hw: 1.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallCorner: { footprint: { kind: 'obb', hw: 1.25, hd: 1.25 }, solid: true, height: 4.0 },
  kcasWallGated: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallDoorway: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallBroken: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallCracked: { footprint: { kind: 'obb', hw: 2.0, hd: 0.63 }, solid: true, height: 4.0 },
  kcasWallWindow: { footprint: { kind: 'obb', hw: 2.0, hd: 0.5 }, solid: true, height: 4.0 },
  kcasWallPillar: { footprint: { kind: 'obb', hw: 2.0, hd: 0.75 }, solid: true, height: 4.0 },
  kcasBarrier: { footprint: { kind: 'obb', hw: 2.0, hd: 0.25 }, solid: true, height: 1.1 },
  kcasBarrierHalf: { footprint: { kind: 'obb', hw: 1.0, hd: 0.25 }, solid: true, height: 1.1 },
  kcasBarrierCorner: { footprint: { kind: 'obb', hw: 1.19, hd: 1.19 }, solid: true, height: 1.4 },

  // --- castle stonework. The two floor slabs are ground rather than obstacle:
  // a wheel rolls over fifteen centimetres of flagstone, and a collider there
  // would be the invisible wall workstream 02 outlawed ---
  timberPillar: { footprint: { kind: 'circle', r: 0.08 }, solid: true, height: 1.0 },
  kcasStairsWide: { footprint: { kind: 'obb', hw: 3.5, hd: 2.0 }, solid: true, height: 5.1 },
  kcasStairsWalled: { footprint: { kind: 'obb', hw: 2.5, hd: 2.0 }, solid: true, height: 4.0 },
  kcasColumn: { footprint: { kind: 'circle', r: 0.35 }, solid: true, height: 1.4 },
  kcasPillar: { footprint: { kind: 'obb', hw: 1.11, hd: 0.85 }, solid: true, height: 4.0 },
  kcasFoundation: { footprint: { kind: 'obb', hw: 1.1, hd: 1.1 }, solid: true, height: 2.0 },
  kcasFloorLarge: { footprint: { kind: 'obb', hw: 2.0, hd: 2.0 }, solid: false, height: 0.15 },
  kcasFloorWeeds: { footprint: { kind: 'obb', hw: 1.0, hd: 1.0 }, solid: false, height: 0.3 },

  // --- landmarks: the one piece a circuit is remembered by ---
  bellTower: { footprint: { kind: 'obb', hw: 0.96, hd: 1.11 }, solid: true, height: 4.76 },
  pixieMushroomHouse: { footprint: { kind: 'circle', r: 1.65 }, solid: true, height: 4.0 },
  crystalMoundCave: { footprint: { kind: 'circle', r: 5.67 }, solid: true, height: 11.0 },
  starHeartCrystal: { footprint: { kind: 'circle', r: 4.63 }, solid: true, height: 5.5 },
  stagShrine: { footprint: { kind: 'obb', hw: 2.0, hd: 1.51 }, solid: true, height: 4.2 },
  shipMonument: { footprint: { kind: 'circle', r: 0.48 }, solid: true, height: 0.89 },
  kcasShrine: { footprint: { kind: 'circle', r: 0.55 }, solid: true, height: 1.79 },

  // --- the garden's ironwork, completing the set the fence and pillar started ---
  gardenIronGate: { footprint: { kind: 'obb', hw: 2.0, hd: 0.25 }, solid: true, height: 3.0 },

  // --- the show-jumping fixtures. The rally start arch is already this exact
  // model (`realm_racers_themes.ts` flies it over every grid), so a circuit
  // that wants a second gate mid-lap has the world's own ---
  courseArch: { footprint: { kind: 'obb', hw: 0.94, hd: 2.91 }, solid: true, height: 4.5 },
  jumpVertical: { footprint: { kind: 'obb', hw: 0.23, hd: 1.07 }, solid: true, height: 1.1 },
  jumpOxer: { footprint: { kind: 'obb', hw: 0.25, hd: 1.09 }, solid: true, height: 1.2 },

  // --- the keep's furniture. A bedroll is planting by the same rule a flower
  // bed is: a wheel flattens it. The red pennant takes the green one's own
  // reading (`banner` above, the same 28 centimetre model in another colourway)
  // rather than a second answer about one piece of cloth ---
  lanternWall: { footprint: { kind: 'obb', hw: 0.17, hd: 0.65 }, solid: true, height: 1.34 },
  hexFlagRed: { footprint: { kind: 'circle', r: 0.13 }, solid: false, height: 0.28 },
  kcasTorchMounted: { footprint: { kind: 'circle', r: 0.27 }, solid: true, height: 1.06 },
  kcasChestGold: { footprint: { kind: 'obb', hw: 1.1, hd: 0.92 }, solid: true, height: 1.3 },
  kcasTableLong: { footprint: { kind: 'obb', hw: 1.02, hd: 2.0 }, solid: true, height: 1.89 },
  kcasTableCloth: { footprint: { kind: 'obb', hw: 1.0, hd: 2.0 }, solid: true, height: 1.0 },
  kcasTableRoundSmall: { footprint: { kind: 'circle', r: 0.5 }, solid: true, height: 1.0 },
  kcasTableRoundMedium: { footprint: { kind: 'circle', r: 0.96 }, solid: true, height: 1.0 },
  kcasBookcase: { footprint: { kind: 'obb', hw: 2.0, hd: 0.27 }, solid: true, height: 3.0 },
  kcasKeg: { footprint: { kind: 'circle', r: 0.9 }, solid: true, height: 2.05 },
  kcasBarrel: { footprint: { kind: 'circle', r: 0.9 }, solid: true, height: 2.0 },
  kcasBedRoyal: { footprint: { kind: 'obb', hw: 1.3, hd: 1.52 }, solid: true, height: 1.7 },
  kcasBedDouble: { footprint: { kind: 'obb', hw: 1.75, hd: 1.5 }, solid: true, height: 1.5 },
  kcasBedSingle: { footprint: { kind: 'obb', hw: 1.0, hd: 1.5 }, solid: true, height: 1.5 },
  kcasBedBunk: { footprint: { kind: 'obb', hw: 1.0, hd: 1.6 }, solid: true, height: 3.0 },
  kcasBedCot: { footprint: { kind: 'obb', hw: 1.0, hd: 1.5 }, solid: true, height: 1.0 },
  kcasBedroll: { footprint: { kind: 'obb', hw: 0.75, hd: 1.5 }, solid: false, height: 0.56 },
  kcasChair: { footprint: { kind: 'obb', hw: 0.37, hd: 0.37 }, solid: true, height: 1.23 },
  kcasStool: { footprint: { kind: 'circle', r: 0.37 }, solid: true, height: 0.5 },
  kcasBarA: { footprint: { kind: 'obb', hw: 1.0, hd: 0.6 }, solid: true, height: 1.0 },
  kcasBarB: { footprint: { kind: 'obb', hw: 1.0, hd: 0.62 }, solid: true, height: 1.0 },
  kcasBarC: { footprint: { kind: 'obb', hw: 1.0, hd: 0.65 }, solid: true, height: 1.0 },
  kcasBartopMedium: { footprint: { kind: 'obb', hw: 1.0, hd: 0.25 }, solid: true, height: 2.2 },
  kcasCandleTriple: { footprint: { kind: 'circle', r: 0.19 }, solid: true, height: 0.87 },

  // --- yard clutter: what a working town leaves lying about. The pieces below
  // fifteen centimetres take the height rule above and stop nothing ---
  bonfire: { footprint: { kind: 'circle', r: 0.18 }, solid: false, height: 0.11 },
  crateWooden: { footprint: { kind: 'obb', hw: 0.42, hd: 0.45 }, solid: true, height: 0.93 },
  farmCrate: { footprint: { kind: 'obb', hw: 0.35, hd: 0.2 }, solid: true, height: 0.24 },
  barrel: { footprint: { kind: 'circle', r: 0.34 }, solid: true, height: 0.9 },
  anvil: { footprint: { kind: 'obb', hw: 0.54, hd: 0.2 }, solid: true, height: 0.56 },
  weaponStand: { footprint: { kind: 'obb', hw: 0.69, hd: 0.49 }, solid: true, height: 1.11 },
  hexCannonballs: { footprint: { kind: 'circle', r: 0.16 }, solid: true, height: 0.33 },
  hexLumber: { footprint: { kind: 'obb', hw: 0.34, hd: 0.16 }, solid: true, height: 0.21 },
  hexWeaponRack: { footprint: { kind: 'obb', hw: 0.1, hd: 0.06 }, solid: true, height: 0.24 },
  hexWheelbarrow: { footprint: { kind: 'obb', hw: 0.11, hd: 0.25 }, solid: true, height: 0.19 },
  hexSack: { footprint: { kind: 'circle', r: 0.05 }, solid: false, height: 0.06 },
  hexCrateBig: { footprint: { kind: 'obb', hw: 0.1, hd: 0.1 }, solid: true, height: 0.21 },
  hexCrateOpen: { footprint: { kind: 'obb', hw: 0.16, hd: 0.1 }, solid: true, height: 0.21 },
  hexTrough: { footprint: { kind: 'obb', hw: 0.1, hd: 0.1 }, solid: false, height: 0.1 },
  hexBarrel: { footprint: { kind: 'circle', r: 0.1 }, solid: true, height: 0.21 },
  hexTarget: { footprint: { kind: 'obb', hw: 0.12, hd: 0.07 }, solid: true, height: 0.3 },
  hexCannon: { footprint: { kind: 'obb', hw: 0.33, hd: 0.54 }, solid: true, height: 0.51 },
  kcasCrateLarge: { footprint: { kind: 'obb', hw: 1.0, hd: 0.7 }, solid: true, height: 0.8 },
  kcasCrateSmall: { footprint: { kind: 'obb', hw: 0.75, hd: 0.5 }, solid: true, height: 0.6 },
  kcasCratesStacked: { footprint: { kind: 'obb', hw: 1.04, hd: 1.12 }, solid: true, height: 2.14 },

  // --- loose stone: the world's own boulders and the castle's rubble ---
  oreRocks: { footprint: { kind: 'circle', r: 0.13 }, solid: false, height: 0.08 },
  rockTallA: { footprint: { kind: 'circle', r: 0.34 }, solid: true, height: 1.0 },
  rockTallH: { footprint: { kind: 'circle', r: 0.28 }, solid: true, height: 0.71 },
  rockLargeD: { footprint: { kind: 'circle', r: 0.51 }, solid: true, height: 0.57 },
  rockLargeF: { footprint: { kind: 'circle', r: 0.45 }, solid: true, height: 0.48 },
  kcasRubbleLarge: { footprint: { kind: 'obb', hw: 4.06, hd: 1.59 }, solid: true, height: 3.5 },
  kcasRubbleHalf: { footprint: { kind: 'obb', hw: 2.0, hd: 1.5 }, solid: true, height: 3.5 },
  kcasRocks: { footprint: { kind: 'circle', r: 1.36 }, solid: true, height: 1.56 },

  // --- the four headstones, kept as separate kinds because their silhouettes
  // differ and the plan draws the footprint it will collide ---
  graveRound: { footprint: { kind: 'obb', hw: 0.22, hd: 0.12 }, solid: true, height: 0.57 },
  graveCross: { footprint: { kind: 'obb', hw: 0.22, hd: 0.16 }, solid: true, height: 0.91 },
  graveBevel: { footprint: { kind: 'obb', hw: 0.22, hd: 0.12 }, solid: true, height: 0.53 },
  graveDecor: { footprint: { kind: 'obb', hw: 0.25, hd: 0.12 }, solid: true, height: 0.59 },

  // --- the harbour line: hulls, piers and what is stacked on them ---
  dockPlatform: { footprint: { kind: 'obb', hw: 1.25, hd: 1.25 }, solid: true, height: 1.31 },
  rowboat: { footprint: { kind: 'obb', hw: 1.37, hd: 1.18 }, solid: true, height: 0.85 },
  hexShipBlue: { footprint: { kind: 'obb', hw: 0.5, hd: 1.12 }, solid: true, height: 2.24 },
  hexShipRed: { footprint: { kind: 'obb', hw: 0.5, hd: 1.12 }, solid: true, height: 2.24 },
  hexShipGreen: { footprint: { kind: 'obb', hw: 0.5, hd: 1.12 }, solid: true, height: 2.24 },
  hexBoat: { footprint: { kind: 'obb', hw: 0.15, hd: 0.3 }, solid: false, height: 0.12 },
  hexBoatrack: { footprint: { kind: 'obb', hw: 0.19, hd: 0.19 }, solid: false, height: 0.15 },
  hexAnchor: { footprint: { kind: 'obb', hw: 0.1, hd: 0.02 }, solid: true, height: 0.29 },

  // --- planting, added to the block above: drivable by design ---
  mushroomRed: { footprint: { kind: 'circle', r: 0.08 }, solid: false, height: 0.2 },
  mushroomTan: { footprint: { kind: 'circle', r: 0.09 }, solid: false, height: 0.15 },

  // --- the Drakelands as the world builds it today. Two families from outside
  // `PROP_ASSET_DEFS`, both fetched at world entry for every player: the
  // Wyrmwatch and Last Keep rebuild kit plus the Forgefather fortress kit
  // (the env-prop templates, `ignivar_env_props.ts`), and the ember zone's own
  // set (`ember_prop_urls.ts`). Every kit piece is authored at unit size and
  // measured in its TEMPLATE's frame, which is the one a circuit draws: long
  // axis on x, centred, seated at y = 0. Only pieces the world itself draws
  // instanced are offered, so a circuit shares that program. The world seats
  // the buildings at scale seven to twelve, the statues and graves at two to
  // six, the pillars at six to fourteen. The lily takes the world's own rocky
  // bed collider (ember_lilies.ts: a fifth of its footprint on the big tiers) ---
  dkBuilding1: { footprint: { kind: 'obb', hw: 0.49, hd: 0.4 }, solid: true, height: 0.84 },
  dkBuilding2: { footprint: { kind: 'obb', hw: 0.36, hd: 0.36 }, solid: true, height: 1.0 },
  dkBuildingBase: { footprint: { kind: 'obb', hw: 0.49, hd: 0.41 }, solid: true, height: 0.55 },
  dkBuildingBaseRoof: { footprint: { kind: 'obb', hw: 0.49, hd: 0.44 }, solid: true, height: 0.45 },
  dkChurch: { footprint: { kind: 'obb', hw: 0.37, hd: 0.27 }, solid: true, height: 1.0 },
  dkStables: { footprint: { kind: 'obb', hw: 0.49, hd: 0.36 }, solid: true, height: 0.69 },
  dkDragonStatue: { footprint: { kind: 'obb', hw: 0.3, hd: 0.26 }, solid: true, height: 1.0 },
  dkGravestone2: { footprint: { kind: 'obb', hw: 0.42, hd: 0.16 }, solid: true, height: 1.0 },
  dkGravestone3: { footprint: { kind: 'obb', hw: 0.49, hd: 0.14 }, solid: true, height: 0.85 },
  dkDummy: { footprint: { kind: 'obb', hw: 0.29, hd: 0.19 }, solid: true, height: 1.0 },
  dkShieldRack: { footprint: { kind: 'obb', hw: 0.49, hd: 0.19 }, solid: true, height: 0.81 },
  ffTowerPillar: { footprint: { kind: 'circle', r: 0.26 }, solid: true, height: 1.0 },
  ffTowerBase: { footprint: { kind: 'obb', hw: 0.48, hd: 0.41 }, solid: true, height: 1.0 },
  ffDragonPillar: { footprint: { kind: 'obb', hw: 0.27, hd: 0.22 }, solid: true, height: 1.0 },
  ffCannon: { footprint: { kind: 'obb', hw: 0.49, hd: 0.47 }, solid: true, height: 0.96 },
  ffGearWall: { footprint: { kind: 'obb', hw: 0.49, hd: 0.17 }, solid: true, height: 0.67 },
  ffBridgePillar: { footprint: { kind: 'obb', hw: 0.34, hd: 0.24 }, solid: true, height: 1.0 },
  lavaPool: { footprint: { kind: 'circle', r: 0.44 }, solid: true, height: 0.32 },
  dragonHoard: { footprint: { kind: 'circle', r: 0.46 }, solid: true, height: 0.34 },
  dragonEggs: { footprint: { kind: 'circle', r: 0.39 }, solid: true, height: 0.49 },
  emberLily: { footprint: { kind: 'circle', r: 0.19 }, solid: true, height: 0.58 },

  // --- the Palmreach strand, out of the jungle zone's own set
  // (`jungle_prop_urls.ts`). A palm stands on its trunk at the origin with its
  // crown leaning off it, so the footprint is the trunk the world collides
  // (`PALM_TRUNK_R`, world.ts) and the height is the model's box
  // (`PALM_NATIVE_H`); the world seats them at scale three to four and a half.
  // Literals rather than imports, since this leaf stays off world.ts's graph;
  // `tests/realm_racers_props.test.ts` pins them to those constants. The
  // coconuts are clutter the world gives no collider ---
  beachPalm1: { footprint: { kind: 'circle', r: 0.17 }, solid: true, height: 2.69 },
  beachPalm2: { footprint: { kind: 'circle', r: 0.17 }, solid: true, height: 2.69 },
  beachPalm3: { footprint: { kind: 'circle', r: 0.17 }, solid: true, height: 3.59 },
  fallenCoconuts: { footprint: { kind: 'obb', hw: 0.44, hd: 0.36 }, solid: false, height: 0.32 },

  // --- the fourteen streetlamp fixtures, so a circuit can be LIT after dark
  // rather than only darkened (see REALM_RACERS_LAMP_STYLES above) ---
  ...LAMP_PROP_DEFS,
};

/** The def for a key, or undefined for a key nothing authors. */
export function realmRacersPropDef(asset: string): RallyPropDef | undefined {
  return REALM_RACERS_PROPS[asset];
}
