// What a Realm Racers prop LOOKS like: one entry per catalog key, resolving
// either to a model in the world's own prop registry or to a procedural builder
// the Evergarden already uses elsewhere.
//
// It is a lookup, not a registry. Every GLB-backed entry points at
// `PROP_ASSET_DEFS` (`props.ts`), so a circuit wears the vocabulary the zone
// itself is built from, the media manifest keeps covering it, and a piece
// missing from that catalog is registered THERE rather than here. The keys are
// the sim catalog's (`src/sim/content/realm_racers_props.ts`), which is what
// carries footprints and heights; `tests/realm_racers_props.test.ts` fails on a
// key only one of the two knows.
//
// The two shapes matter for DISPOSAL, and they are not interchangeable:
//
//  - `group` mints its geometry per instance, so the track group owns it and
//    `realm_racers_track_dispose_core.ts` frees it;
//  - `instanced` draws a geometry and material out of a shared cache, so it may
//    only ever be drawn through an `InstancedMesh`. Drawing one as a plain Mesh
//    would let a disposed draft take every authored circuit's statues with it.
//
// Most of the table is one line per key because that is all a mirror should
// be: the SIZE lives sim side and the URL lives in `PROP_ASSET_DEFS`, so an
// entry here only says which of the world's models a catalog key wears. Every
// entry is minted through `gltf()`, never a hand-written url: the helper is
// typed against `PROP_ASSET_DEFS`, which is what makes "the client already
// fetches this at world entry" true by construction rather than by review.
// The Drakelands entries take the same guarantee from their own world tables,
// through `ember()` and `worldKit()`: the ember zone's set and the env-prop
// templates, both loaded in the deferred lane at world entry. The Palmreach's
// palms and coconuts take it through `jungle()` from the jungle zone's table,
// loaded in that same lane.
//
// A model is seated at its own authored origin, not re-based to its lowest
// vertex the way `propAsset` re-bases the world's placed props, so a piece whose
// GLB sinks below y = 0 (the torch does, by about four tenths of a yard) sits
// that much low in the lawn. That is also the rule that decides what is NOT
// authorable: a WALL-MOUNTED piece (a shelf, a plaque, a hung banner) is
// authored around a wall that a circuit does not have, so it would draw half
// buried or hanging in mid air. The sim catalog's header lists the ones held
// back for it. Several kit pieces are also authored near UNIT size rather than
// at world scale, so a record places them with an explicit `scale`; the sim
// catalog's heights and footprints are the same authored size, so both scale
// together and the readout measures what is drawn.

import type * as THREE from 'three';
import { REALM_RACERS_LAMP_STYLES } from '../sim/content/realm_racers_props';
import type { StreetlampStyleId } from '../sim/streetlamp_style';
import { EMBER_PROP_URLS, type EmberPropKey } from './ember_prop_urls';
import { buildTieredFountain, gardenStatueGeo, gardenStatueMaterial } from './garden_stonework';
import type { IgnivarEnvPropKey } from './ignivar_dressing_plan_core';
import { IGNIVAR_ENV_PROP_URLS } from './ignivar_env_props';
import { JUNGLE_PALM_URLS, JUNGLE_PROP_URLS } from './jungle_prop_urls';
import { PROP_ASSET_DEFS } from './props';
import { STREETLAMP_ASSET_DEFS } from './streetlamp_assets';

export type RallyPropVisual =
  | { kind: 'gltf'; url: string }
  /**
   * A piece the world draws from one of its env-prop TEMPLATES (the Drakelands
   * rebuild kit and the Forgefather fortress kit): the circuit instances that
   * template's own geometry and material rather than the file
   * (realm_racers_dressing_material.ts, the `worldKit` route). The url is the
   * file the template is baked from, so anything that only wants to look at the
   * model (the editor's thumbnail rig) can treat it as a plain gltf.
   */
  | { kind: 'worldKit'; url: string }
  /**
   * A streetlamp FIXTURE: the world's own lit posts, which are not props at all
   * (`streetlamp_assets.ts` prepares them, with an authored light socket,
   * authored emissive materials and a modelled flame) and cannot come through
   * `gltf()`, whose whole job is to point only at `PROP_ASSET_DEFS`.
   *
   * It carries the url as well as the style so anything that only wants to LOOK
   * at the model (the editor's thumbnail rig) can treat it as a plain gltf; the
   * style is what the draw path needs, because a lamp is instanced from its
   * prepared parts and its light is registered from its prepared socket.
   */
  | { kind: 'streetlamp'; style: StreetlampStyleId; url: string }
  | { kind: 'group'; build(x: number, y: number, z: number, scale: number): THREE.Group }
  | {
      kind: 'instanced';
      geometry(): THREE.BufferGeometry;
      material(): THREE.Material;
    };

const gltf = (key: keyof typeof PROP_ASSET_DEFS): RallyPropVisual => ({
  kind: 'gltf',
  url: PROP_ASSET_DEFS[key].url,
});

/** The ember zone's own models, drawn with the parse the world keeps. */
const ember = (key: EmberPropKey): RallyPropVisual => ({ kind: 'gltf', url: EMBER_PROP_URLS[key] });

/** The Palmreach's own models, drawn with the parse the jungle zone keeps. */
const jungle = (
  url: (typeof JUNGLE_PALM_URLS)[number] | typeof JUNGLE_PROP_URLS.coconuts,
): RallyPropVisual => ({ kind: 'gltf', url });

const worldKit = (key: Exclude<IgnivarEnvPropKey, 'street_lamp'>): RallyPropVisual => ({
  kind: 'worldKit',
  url: IGNIVAR_ENV_PROP_URLS[key],
});

/** Every lamp key the sim catalog authors, mirrored off the SAME table, so the
 *  two halves cannot disagree about which fixture a key wears. */
const LAMP_VISUALS: Record<string, RallyPropVisual> = Object.fromEntries(
  Object.entries(REALM_RACERS_LAMP_STYLES).map(([key, style]) => [
    key,
    { kind: 'streetlamp', style, url: STREETLAMP_ASSET_DEFS[style].url },
  ]),
);

export const REALM_RACERS_PROP_VISUALS: Record<string, RallyPropVisual> = {
  ...LAMP_VISUALS,

  // Adapted rather than handed over directly: the stonework builder takes
  // (x, z, y), the garden's own order, and this seam takes (x, y, z) like every
  // other placement in the renderer. Two argument orders that both compile is
  // exactly the kind of mistake nothing but a position test can see.
  fountain: {
    kind: 'group',
    build: (x, y, z, scale) => buildTieredFountain(x, z, y, scale),
  },
  statue: { kind: 'instanced', geometry: gardenStatueGeo, material: gardenStatueMaterial },

  well: gltf('well'),
  column: gltf('column'),
  columnBroken: gltf('columnBroken'),
  statueBlock: gltf('statueBlock'),
  statueHead: gltf('statueHead'),
  gardenArch: gltf('gardenArch'),
  gardenIronFence: gltf('gardenIronFence'),
  gardenIronPillar: gltf('gardenIronPillar'),
  bench: gltf('kcasBench'),
  postLantern: gltf('kcasTorch'),
  banner: gltf('hexFlag'),
  haybale: gltf('hexHaybale'),
  leafyFoxStatue: gltf('leafyFoxStatue'),
  goldenHorseStatue: gltf('goldenHorseStatue'),

  giantMushroom: gltf('mushroomGiantPurple'),
  amethyst: gltf('crystalAmethystCluster'),
  glowCluster: gltf('mushroomGlowCluster'),
  glowFlower: gltf('flowerGlow'),

  oak: gltf('oakTree'),
  greatTree: gltf('greatTree'),
  shrub: gltf('shrubFlowering'),
  bedRound: gltf('flowerBedRound'),
  bedSquareA: gltf('flowerBedSquareA'),
  bedSquareB: gltf('flowerBedSquareB'),
  reeds: gltf('marshReeds'),
  lilyRaft: gltf('fenLilies'),

  // village
  house1: gltf('house1'),
  house3: gltf('house3'),
  blacksmith: gltf('blacksmith'),
  inn: gltf('inn'),
  kmedHomeA: gltf('kmedHomeA'),
  kmedHomeB: gltf('kmedHomeB'),
  kmedTavern: gltf('kmedTavern'),
  kmedChurch: gltf('kmedChurch'),
  kmedBlacksmith: gltf('kmedBlacksmith'),
  kmedMarket: gltf('kmedMarket'),
  hexWindmill: gltf('hexWindmill'),
  hexCastle: gltf('hexCastle'),
  hexTower: gltf('hexTower'),
  hexChurch: gltf('hexChurch'),
  hexTavern: gltf('hexTavern'),
  hexBlacksmith: gltf('hexBlacksmith'),
  hexHomeA: gltf('hexHomeA'),
  hexHomeB: gltf('hexHomeB'),
  hexMarket: gltf('hexMarket'),
  hexWatchtower: gltf('hexWatchtower'),
  hexCannonTower: gltf('hexCannonTower'),
  hexBarracks: gltf('hexBarracks'),
  hexbHomeA: gltf('hexbHomeA'),
  hexbHomeB: gltf('hexbHomeB'),
  hexbTavern: gltf('hexbTavern'),
  hexbTownhall: gltf('hexbTownhall'),
  hexbWorkshop: gltf('hexbWorkshop'),
  hexbMarket: gltf('hexbMarket'),
  hexbShipyard: gltf('hexbShipyard'),
  hexbStables: gltf('hexbStables'),
  hexbTowerBase: gltf('hexbTowerBase'),
  hexbTowerA: gltf('hexbTowerA'),
  hexrTowerA: gltf('hexrTowerA'),
  hexbTowerB: gltf('hexbTowerB'),
  hexbWindmill: gltf('hexbWindmill'),
  hexrTent: gltf('hexrTent'),
  hexrWatchtower: gltf('hexrWatchtower'),
  hexrCastle: gltf('hexrCastle'),
  hexrTownhall: gltf('hexrTownhall'),
  hexrBarracks: gltf('hexrBarracks'),
  hexrChurch: gltf('hexrChurch'),
  hexrTavern: gltf('hexrTavern'),
  hexrStables: gltf('hexrStables'),
  hexrHomeA: gltf('hexrHomeA'),
  hexrHomeB: gltf('hexrHomeB'),
  hexrMarket: gltf('hexrMarket'),
  hexrBlacksmith: gltf('hexrBlacksmith'),
  hexrWindmill: gltf('hexrWindmill'),
  hexrArcheryrange: gltf('hexrArcheryrange'),
  hexrTowerCatapult: gltf('hexrTowerCatapult'),
  hexrTowerBase2: gltf('hexrTowerBase2'),

  // walling
  fence: gltf('fence'),
  kkWall: gltf('kkWall'),
  kkWallCracked: gltf('kkWallCracked'),
  kkPillar: gltf('kkPillar'),
  hexWall: gltf('hexWall'),
  hexFenceStone: gltf('hexFenceStone'),
  hexnPalisade: gltf('hexnPalisade'),
  kcasWall: gltf('kcasWall'),
  kcasWallHalf: gltf('kcasWallHalf'),
  kcasWallCorner: gltf('kcasWallCorner'),
  kcasWallGated: gltf('kcasWallGated'),
  kcasWallDoorway: gltf('kcasWallDoorway'),
  kcasWallBroken: gltf('kcasWallBroken'),
  kcasWallCracked: gltf('kcasWallCracked'),
  kcasWallWindow: gltf('kcasWallWindow'),
  kcasWallPillar: gltf('kcasWallPillar'),
  kcasBarrier: gltf('kcasBarrier'),
  kcasBarrierHalf: gltf('kcasBarrierHalf'),
  kcasBarrierCorner: gltf('kcasBarrierCorner'),

  // stonework
  timberPillar: gltf('timberPillar'),
  kcasStairsWide: gltf('kcasStairsWide'),
  kcasStairsWalled: gltf('kcasStairsWalled'),
  kcasColumn: gltf('kcasColumn'),
  kcasPillar: gltf('kcasPillar'),
  kcasFoundation: gltf('kcasFoundation'),
  kcasFloorLarge: gltf('kcasFloorLarge'),
  kcasFloorWeeds: gltf('kcasFloorWeeds'),

  // landmark
  bellTower: gltf('bellTower'),
  pixieMushroomHouse: gltf('pixieMushroomHouse'),
  crystalMoundCave: gltf('crystalMoundCave'),
  starHeartCrystal: gltf('starHeartCrystal'),
  stagShrine: gltf('stagShrine'),
  shipMonument: gltf('shipMonument'),
  kcasShrine: gltf('kcasShrine'),

  // ironwork
  gardenIronGate: gltf('gardenIronGate'),

  // fixture
  courseArch: gltf('courseArch'),
  jumpVertical: gltf('jumpVertical'),
  jumpOxer: gltf('jumpOxer'),

  // furniture
  lanternWall: gltf('lanternWall'),
  hexFlagRed: gltf('hexFlagRed'),
  kcasTorchMounted: gltf('kcasTorchMounted'),
  kcasChestGold: gltf('kcasChestGold'),
  kcasTableLong: gltf('kcasTableLong'),
  kcasTableCloth: gltf('kcasTableCloth'),
  kcasTableRoundSmall: gltf('kcasTableRoundSmall'),
  kcasTableRoundMedium: gltf('kcasTableRoundMedium'),
  kcasBookcase: gltf('kcasBookcase'),
  kcasKeg: gltf('kcasKeg'),
  kcasBarrel: gltf('kcasBarrel'),
  kcasBedRoyal: gltf('kcasBedRoyal'),
  kcasBedDouble: gltf('kcasBedDouble'),
  kcasBedSingle: gltf('kcasBedSingle'),
  kcasBedBunk: gltf('kcasBedBunk'),
  kcasBedCot: gltf('kcasBedCot'),
  kcasBedroll: gltf('kcasBedroll'),
  kcasChair: gltf('kcasChair'),
  kcasStool: gltf('kcasStool'),
  kcasBarA: gltf('kcasBarA'),
  kcasBarB: gltf('kcasBarB'),
  kcasBarC: gltf('kcasBarC'),
  kcasBartopMedium: gltf('kcasBartopMedium'),
  kcasCandleTriple: gltf('kcasCandleTriple'),

  // clutter
  bonfire: gltf('bonfire'),
  crateWooden: gltf('crateWooden'),
  farmCrate: gltf('farmCrate'),
  barrel: gltf('barrel'),
  anvil: gltf('anvil'),
  weaponStand: gltf('weaponStand'),
  hexCannonballs: gltf('hexCannonballs'),
  hexLumber: gltf('hexLumber'),
  hexWeaponRack: gltf('hexWeaponRack'),
  hexWheelbarrow: gltf('hexWheelbarrow'),
  hexSack: gltf('hexSack'),
  hexCrateBig: gltf('hexCrateBig'),
  hexCrateOpen: gltf('hexCrateOpen'),
  hexTrough: gltf('hexTrough'),
  hexBarrel: gltf('hexBarrel'),
  hexTarget: gltf('hexTarget'),
  hexCannon: gltf('hexCannon'),
  kcasCrateLarge: gltf('kcasCrateLarge'),
  kcasCrateSmall: gltf('kcasCrateSmall'),
  kcasCratesStacked: gltf('kcasCratesStacked'),

  // rocks
  oreRocks: gltf('oreRocks'),
  rockTallA: gltf('rockTallA'),
  rockTallH: gltf('rockTallH'),
  rockLargeD: gltf('rockLargeD'),
  rockLargeF: gltf('rockLargeF'),
  kcasRubbleLarge: gltf('kcasRubbleLarge'),
  kcasRubbleHalf: gltf('kcasRubbleHalf'),
  kcasRocks: gltf('kcasRocks'),

  // graveyard
  graveRound: gltf('graveRound'),
  graveCross: gltf('graveCross'),
  graveBevel: gltf('graveBevel'),
  graveDecor: gltf('graveDecor'),

  // harbour
  dockPlatform: gltf('dockPlatform'),
  rowboat: gltf('rowboat'),
  hexShipBlue: gltf('hexShipBlue'),
  hexShipRed: gltf('hexShipRed'),
  hexShipGreen: gltf('hexShipGreen'),
  hexBoat: gltf('hexBoat'),
  hexBoatrack: gltf('hexBoatrack'),
  hexAnchor: gltf('hexAnchor'),

  // planting
  mushroomRed: gltf('mushroomRed'),
  mushroomTan: gltf('mushroomTan'),

  // the Drakelands: the Wyrmwatch and Last Keep rebuild kit, the Forgefather
  // fortress kit, and the ember zone's lava, dens and lilies
  dkBuilding1: worldKit('building_1'),
  dkBuilding2: worldKit('building_2'),
  dkBuildingBase: worldKit('building_base'),
  dkBuildingBaseRoof: worldKit('building_base_roof'),
  dkChurch: worldKit('church'),
  dkStables: worldKit('stables'),
  dkDragonStatue: worldKit('dragon_statue'),
  dkGravestone2: worldKit('gravestone_2'),
  dkGravestone3: worldKit('gravestone_3'),
  dkDummy: worldKit('dummy'),
  dkShieldRack: worldKit('shield_rack'),
  ffTowerPillar: worldKit('tower_pillar'),
  ffTowerBase: worldKit('tower_base'),
  ffDragonPillar: worldKit('dragon_pillar'),
  ffCannon: worldKit('cannon'),
  ffGearWall: worldKit('gear_wall_rusty'),
  ffBridgePillar: worldKit('bridge_pillar'),
  lavaPool: ember('pool'),
  dragonHoard: ember('hoard'),
  dragonEggs: ember('eggs'),
  emberLily: ember('lily'),

  // the Palmreach: the strand's three beach palms and its fallen coconuts
  beachPalm1: jungle(JUNGLE_PALM_URLS[0]),
  beachPalm2: jungle(JUNGLE_PALM_URLS[1]),
  beachPalm3: jungle(JUNGLE_PALM_URLS[2]),
  fallenCoconuts: jungle(JUNGLE_PROP_URLS.coconuts),
};

/**
 * Every model a circuit's dressing can ask for.
 *
 * NOT a preload set, and it stopped being one on purpose: the track builder
 * fetches a dressing model when a circuit places it, so this list is what MAY
 * be asked for rather than what is resident. What keeps a cold client honest is
 * upstream instead, that every url here is one `props.ts` already fetches at
 * world entry (`tests/realm_racers_props.test.ts`).
 */
export const REALM_RACERS_PROP_URLS: readonly string[] = Object.values(REALM_RACERS_PROP_VISUALS)
  .filter((visual): visual is { kind: 'gltf'; url: string } => visual.kind === 'gltf')
  .map((visual) => visual.url);

/** Every file a `worldKit` entry's template is baked from: nothing the rally
 *  fetches (the template is the world's), and what the disk and manifest
 *  guards cover for that family. */
export const REALM_RACERS_WORLD_KIT_URLS: readonly string[] = Object.values(
  REALM_RACERS_PROP_VISUALS,
)
  .filter((visual): visual is { kind: 'worldKit'; url: string } => visual.kind === 'worldKit')
  .map((visual) => visual.url);
