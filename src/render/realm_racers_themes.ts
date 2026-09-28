// What a Realm Racers circuit is DRESSED IN: one record per theme, holding
// every id and parameter the track build used to hardcode as the Evergarden's.
//
// The long-term direction is one themed circuit per game zone, wearing that
// zone's art and music. The music half of that seam already existed (a circuit
// carries its own `musicTrack`); this is the art half. Authoring the Frostveil
// circuit should be: draw it in the editor, set `theme: 'frostveil'`, add the
// record below, and every derived visual follows.
//
// THE RULE, because it is a repo invariant in disguise: a theme changes VISUALS
// ONLY, never physics. The off-track bands, the track-limits referee and the
// apron rule all live on the circuit record and the shared constants, never
// here. An ice circuit that wants slippery runoff authors that on its own
// record, as a deliberate balance change; it never arrives through a skin.
//
// Data-as-code, deliberately declarative: it holds IDS, COLOURS and SIZES, and
// no geometry logic at all (that stays in `realm_racers_track.ts` and its core,
// which is why this module is three-free and a plain Vitest can walk it). The
// keys are checked both ways against `REALM_RACERS_THEME_IDS`, the sim-side list
// the editor and the metrics readout resolve against without importing render
// code; `tests/realm_racers_themes.test.ts` pins the whole contract.

import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_DEFAULT_THEME_ID,
  type RealmRacersCircuit,
} from '../sim/content/realm_racers_circuits';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import type { BiomeId } from '../sim/types';
import type { FlowerKind } from './textures';

/**
 * Which dome a theme flies.
 *
 * A `BiomeId` for thirteen of the fourteen realms, because a realm's sky IS its
 * biome's. The Farshore is the exception the world already carries: its isle
 * flies a PLACE-keyed dome (`sky.ts` overrides the biome pick inside the isle's
 * rect), so the only honest answer for a Farshore circuit is that same key, and
 * the biome under it (`vale`) is a different question.
 *
 * Spelled out rather than borrowed from `sky.ts`'s own `SkyKey`, which is the
 * same union today: a place-keyed dome added there for another purpose (the
 * retired Vale Cup's practice sky was one) must not become a circuit option by
 * accident. It has to stay a SUBSET of `SkyKey`, so every consumer over there
 * takes it unchanged.
 */
export type RallySkyKey = BiomeId | 'farshore';

/**
 * The realm whose day/night grade a theme's sky borrows.
 *
 * Only the place-keyed dome needs an answer at all: the grade tables are keyed
 * by biome, and the Farshore isle's own biome is the vale it sits in.
 */
export function rallySkyDayNightBiome(key: RallySkyKey): BiomeId {
  return key === 'farshore' ? 'vale' : key;
}

/** The red/white stripe pair the kerb texture is drawn from. */
export interface RallyThemeKerb {
  base: number;
  stripe: number;
}

/** The two squares of the start/finish chequer. */
export interface RallyThemeStartGrid {
  light: number;
  dark: number;
}

export interface RallyCircuitTheme {
  /** Which biome's ground tints the lawn, the road and the run-off wear. The
   *  SURFACES are the world's own splat material either way; a theme only says
   *  what colour the ground under this circuit is. */
  ground: BiomeId;
  kerb: RallyThemeKerb;
  startGrid: RallyThemeStartGrid;
  /**
   * The barrier kits that BELONG on a circuit in this zone, in the order the
   * editor should offer them: keys of `src/sim/content/realm_racers_barriers.ts`.
   *
   * An authoring aid and only that, exactly like `props` below. It filters
   * nothing at runtime and forbids nothing: a record may name any kit in the
   * catalog, and the readout judges the placement rather than the vocabulary.
   *
   * It replaced a mandatory `perimeter` kit, and the replacement is the whole
   * point. That field dressed a derived rectangle: one kit, four straight faces
   * and four right angles, which is what made every circuit read as a box
   * however different its road was. Nothing draws that box any more, so what a
   * circuit's edge looks like is authored (`fences` on the record) and a theme's
   * job here is to say which two or three of the kits look like this zone.
   */
  barriers: readonly string[];
  /**
   * The start line's one visible fixture. Only the IDS live here: the arch's
   * authored bounds stay in `realm_racers_track_core.ts`, where the placement
   * arithmetic that reads them is, and they describe THESE two models. A theme
   * that swaps the arch MESH (rather than the banner's colourway, which is all
   * any theme does today) has to bring its bounds with it.
   */
  startFixture: { archUrl: string; bannerUrl: string };
  /**
   * The border and bed flowers: one pale card tinted PER INSTANCE from the
   * palette, which is how the Evergarden paints its own beds (a coloured
   * texture would multiply against the tint and muddy every hue).
   */
  flowers: { card: FlowerKind[]; colours: readonly number[] };
  /** What is planted along a pond's rim, or null for a realm whose own lakes
   *  the world leaves bare (`water_flora_core.ts` skips its biome). */
  reedUrl: string | null;
  /**
   * The zone's own scenery vocabulary: catalog keys of
   * `src/sim/content/realm_racers_props.ts` that BELONG on a circuit wearing
   * this theme, in the order the editor should offer them.
   *
   * An authoring aid, and only that. It filters nothing at runtime and forbids
   * nothing: a record may place any key in the catalog, and the readout judges
   * the placement rather than the vocabulary. What it saves is the real cost of
   * hand-dressing a circuit, which is finding the six pieces that look like
   * this zone inside a catalog that holds every zone's.
   *
   * It exists because the DERIVED dressing ring was deleted. That ring walked
   * the perimeter and repeated a fixed list, so it followed the wall rather
   * than the design and was a rule tuned on one circuit's shape; the pieces it
   * used to place are now placed by hand, and this is where a theme says which
   * ones those are.
   *
   * The GRASS is not here for the same reason its colour is not: how thickly a
   * realm grows wild blades is `GRASS_BIOME_DENSITY`'s answer, and the
   * Evergarden's is zero because it is mown lawn.
   *
   * Every theme LEADS with its own zone's streetlamp fixture, and that placement
   * in the list is the point: the catalog carries all fourteen of them (one per
   * style, because the collider radius of a fixture is measured per style), and
   * without a theme naming one an author dressing a night circuit would be
   * scrolling fourteen near-identical lamp tiles to find the one that belongs
   * in this realm. It is still only an aid: a circuit may place any zone's lamp.
   */
  props: readonly string[];
  /**
   * The water's own colour ramp, if this theme wants one. Absent leaves the
   * world's shipped ramp, which is what every pond outside the rally uses.
   */
  water?: { shallow: number; deep: number };
  /**
   * The ambiance half: which sky the band flies and what the fog does under it.
   *
   * The sky is an ALIAS of a shipped biome dome rather than a new one, exactly
   * as `sky.ts` already does for its paint-only biomes. It is authored rather
   * than sampled from the world because the band's own `zoneBiomeAt` answer
   * depends on which LANE a copy of the circuit sits in (the public lane reads
   * vale, the practice copies read marsh, jungle, night, amber, ember), so a
   * practice lap used to be lit by a different sky than the race it practises
   * for.
   *
   * The fog's COLOUR is the themed half. Its DEPTH is not: how far down the
   * road a pilot can see a rival, a corner or the wall is a fairness number, so
   * every theme holds the band the raced circuit shipped with, and a circuit
   * that genuinely wants another one changes it out loud rather than through
   * its art. `tests/realm_racers_themes.test.ts` holds every theme to it.
   */
  sky: { biome: RallySkyKey; fog: { color: number; near: number; far: number } };
}

/** The game's own race arch: `props.ts` already plants this exact model as the
 *  start gate of the show-jumping course at the Galecrest Stables
 *  (`MOUNT_RACE_COURSE`), so a rally start line inherits a fixture the world has
 *  established rather than inventing one. */
const COURSE_ARCH_URL = '/models/props/course_arch.glb';
/** Reeds are reeds: every theme that plants a rim plants the same one, by
 *  design, and the suite holds the exemption open so it stays auditable rather
 *  than accidental. */
const REEDS_URL = '/models/props/reeds.glb';

/**
 * The Evergarden: the default theme, worn by the two garden circuits, and the
 * one every number here was measured on. It reproduces the pre-theme track
 * build exactly, which is what `tests/realm_racers_render.test.ts` pins.
 */
const EVERGARDEN: RallyCircuitTheme = {
  ground: 'garden',
  // One red block plus one white block per repeat, so the arc-length uv lays a
  // classic alternating kerb down the outside of a corner.
  kerb: { base: 0xe8e2d4, stripe: 0xb8402f },
  startGrid: { light: 0xf2efe6, dark: 0x22201d },
  barriers: ['ironwork', 'hedge', 'stoneWall'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patterna_white.glb',
  },
  flowers: {
    // The Evergarden's own flower card: near-white petals, butter centre.
    card: [{ p: [244, 242, 240], c: [252, 226, 140] }],
    colours: [
      0xf6f2ea, // white
      0xf4b8cf, // pink
      0xf6dd7a, // butter
      0xc9b4e8, // lilac
      0xf3a973, // apricot
    ],
  },
  reedUrl: REEDS_URL,
  // The garden's own vocabulary: stonework, ironwork, beds and specimen trees.
  // `greatTree` IS the Evergarden's specimen elder, the same model and the same
  // scale band `garden_features.ts` raises over the lawns.
  props: [
    'lampEvergardenFlower',
    'oak',
    'greatTree',
    'shrub',
    'bedRound',
    'bedSquareA',
    'bedSquareB',
    'statue',
    'fountain',
    'well',
    'gardenArch',
    'gardenIronFence',
    'gardenIronPillar',
    'bench',
    'postLantern',
    'leafyFoxStatue',
    'column',
    'columnBroken',
    'statueHead',
    'statueBlock',
    'reeds',
    'lilyRaft',
    // Hedgewick and the mill lawn: the buildings `evergarden.ts` itself places
    // in the zone, so a circuit here can put a village behind the barrier
    // rather than only a lawn. The gate is the exception and an aesthetic pick
    // off the already-loaded registry: no zone places it, and it finishes the
    // ironwork set the fence and the pillar start.
    'gardenIronGate',
    'hexWindmill',
    'hexHomeA',
    'hexHomeB',
    'hexChurch',
    'hexTavern',
    'hexMarket',
    'hexWall',
  ],
  sky: {
    // The Evergarden's OWN dome (`/env/evergarden_day_2k.ktx2`), which is what a
    // circuit wearing this zone's art should always have flown. It used to name
    // `vale` instead, to keep the shipped circuit lit byte for byte as it was
    // the day the theme seam was extracted; that was conservatism rather than a
    // design call, and it stopped being tenable when the vale became Eastbrook's
    // own theme. The fog under it is unchanged, so the dominant haze a pilot
    // reads has not moved.
    biome: 'garden',
    fog: { color: 0xa7c995, near: 85, far: 430 },
  },
};

/**
 * Galecrest: coastal stone and pine over wind-dried downs.
 *
 * It ships with NO circuit on it, deliberately. It is the proof that the seam
 * has no Evergarden assumptions left in it: every consumer below reads a theme
 * rather than a garden constant, and a second record is the only thing that can
 * say so. The editor's theme picker offers it, so a draft can be drawn against
 * it and driven through `/dev rallydraft` before a Galecrest circuit is
 * authored for real.
 *
 * Minimal on purpose: it re-skins what the Evergarden theme already covers, out
 * of kits the zone itself is built from (the scalloped stone fence, the
 * Wickharbor quarter, the Galecrest golden horse), and invents nothing that
 * would need a seat pass of its own to judge.
 */
const GALECREST: RallyCircuitTheme = {
  ground: 'gale',
  // Weathered grey and a faded harbour red, against the downs' sage.
  kerb: { base: 0xdcd8cd, stripe: 0xa04a3c },
  startGrid: { light: 0xe9e6dc, dark: 0x272b2e },
  barriers: ['stoneWall', 'woodPaling', 'ironwork'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patterna_blue.glb',
  },
  flowers: {
    // Sea thrift and gorse: pinker and yellower than the garden's pastels.
    card: [{ p: [240, 236, 228], c: [236, 178, 96] }],
    colours: [
      0xeef0ea, // salt white
      0xe89ab4, // thrift pink
      0xe8c65e, // gorse
      0xa8c4d8, // harbour blue
    ],
  },
  reedUrl: REEDS_URL,
  // A working coast: the harbour's own furniture, the golden horse, and the
  // planting that survives salt wind.
  props: [
    'lampGalecrestMast',
    'oak',
    'shrub',
    'goldenHorseStatue',
    'well',
    'bench',
    'postLantern',
    'banner',
    'haybale',
    'column',
    'columnBroken',
    'statueBlock',
    'bedRound',
    'reeds',
    // Wickharbor's own quarter and its working harbour: the blue colourway,
    // the moored fleet and the cargo on the quay, all keys `galecrest.ts`
    // already places in the zone this theme wears, and the scalloped stone
    // fence its own `stone` fence runs are drawn in. Two are aesthetic picks
    // off the already-loaded registry instead: the pier deck, which no
    // Galecrest dock places, and the rowboat, which Palmreach and Eastbrook
    // moor and is here because a harbour circuit wants a dinghy on the shingle.
    'hexbHomeA',
    'hexbHomeB',
    'hexbTavern',
    'hexbMarket',
    'hexbWindmill',
    'hexFenceStone',
    'shipMonument',
    'hexShipBlue',
    'hexBoat',
    'hexBoatrack',
    'hexAnchor',
    'hexCrateBig',
    'hexCrateOpen',
    'hexSack',
    'dockPlatform',
    'rowboat',
  ],
  water: { shallow: 0x3f7f92, deep: 0x123043 },
  sky: {
    biome: 'gale',
    fog: { color: 0x9fb7bd, near: 85, far: 430 },
  },
};

/**
 * Nightbloom: a violet dream wood, and the theme that says how far this seam
 * can actually travel.
 *
 * Galecrest proved the seam is general; it did not prove it is INTERESTING,
 * because a coastal down beside a walled garden is two greens. The Nightbloom
 * is the other end of the shipped world: a saturated violet meadow under the
 * dream sky, lit by glowing growth rather than planted with beds, and nothing
 * about the circuit's geometry changes to get there.
 *
 * The glowing growth is BORROWED, and that is recorded rather than implied: the
 * zone's own glow is procedural (the lumen blossoms of `night_features.ts`) and
 * has no catalog piece, so the giant fungus and the amethyst are the Veiled
 * Hollow's. Their sizes are MEASURED rather than eyed, off the placements that
 * zone makes (`src/sim/content/realm.ts` seats the giant mushroom at scale 10
 * for a 1.9 yard radius and a 10 yard height, and the amethyst cluster at
 * scale 1 for 2.4 by 6), so a piece in the ring is the size the world draws it
 * at rather than a guess that would need its own seat pass.
 */
const NIGHTBLOOM: RallyCircuitTheme = {
  ground: 'night',
  // The kerb has to READ, and it reads against a violet meadow rather than a
  // green one: a near-white block against deep violet, where the garden uses
  // bone against red.
  kerb: { base: 0xf2ecff, stripe: 0x4a2a8c },
  startGrid: { light: 0xf2ecff, dark: 0x201233 },
  barriers: ['hedge', 'woodPaling', 'ornateRailing'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    // Gold cloth, the one banner colourway that carries against violet.
    bannerUrl: '/models/dungeon/banner_patterna_yellow.glb',
  },
  flowers: {
    // The Nightbloom's own blooms, the palette `foliage.ts` already tints the
    // zone's flowering bushes from (NIGHT_BLOOM_TINTS): pale petals that pop
    // against dark ground rather than soften toward it.
    card: [{ p: [238, 240, 252], c: [150, 224, 255] }],
    colours: [
      0x9fdcff, // glacier blue
      0xffffff, // moon white
      0xc8a8ff, // pale violet
      0xa0ffd8, // witch green
    ],
  },
  reedUrl: REEDS_URL,
  // Still water under a violet sky: dark to nearly black at depth, with a cold
  // moonlit shallow.
  // The glowing growth, plus the little civic furniture a night meadow
  // carries. The four glowing kinds are the reason this list exists: they are
  // what the deleted ring used to plant, and nothing else in the catalog looks
  // remotely like them (they are the Veiled Hollow's, see the header).
  props: [
    'lampNightbloomMoonflower',
    'giantMushroom',
    'glowCluster',
    'amethyst',
    'glowFlower',
    'shrub',
    'postLantern',
    'bench',
    'banner',
    'statueBlock',
    'reeds',
    'lilyRaft',
    // The Veiled Hollow's own landmarks, every one of them placed by
    // `realm.ts`: the pixie village, the crystal mound, the fallen star, the
    // stags' shrine and the dungeon stone its wall is built from. The last four
    // are aesthetic picks off the already-loaded registry: the dusk-violet
    // houses (the Hollow raises those through `BuildingDef` kinds rather than
    // as props) and the two small fungi, the only knee-high growth in the
    // catalog (the Hollow's flora scatters them, and props.ts builds the mud
    // huts of three zones out of the red one).
    'pixieMushroomHouse',
    'crystalMoundCave',
    'starHeartCrystal',
    'stagShrine',
    'kkWall',
    'kkPillar',
    'kmedHomeA',
    'kmedTavern',
    'mushroomRed',
    'mushroomTan',
  ],
  water: { shallow: 0x4a7fb0, deep: 0x171238 },
  sky: {
    biome: 'night',
    fog: { color: 0x7a5fb0, near: 85, far: 430 },
  },
};

/**
 * The Veiled Hollow: pink-and-violet dusk under the Hollow's own ruin masonry.
 *
 * The zone's landmark set is the reason this record is short: `realm.ts` seats
 * the pixie village, the crystal mound, the fallen star and the stags' shrine
 * itself, so the vocabulary is the Hollow's own furniture rather than a
 * borrowed one. The four GLOWING kinds are deliberately absent although the
 * Hollow places them itself (`realm.ts`): the Nightbloom theme leads with them,
 * and a Hollow circuit lit by them would read as the dream wood.
 */
const VEILED_HOLLOW: RallyCircuitTheme = {
  ground: 'dusk',
  // Pale violet stone against heather: the kerb reads by hue here, not by the
  // garden's red, which would sit dead against a mauve meadow.
  kerb: { base: 0xece4f2, stripe: 0x7a4a86 },
  startGrid: { light: 0xece4f2, dark: 0x2a2038 },
  barriers: ['ruinWall', 'crackedWall', 'woodPaling'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    // Pattern B in moon white: the pale cloth a violet dusk carries, in a
    // different cut from the Evergarden's pattern A so no two grids read alike.
    bannerUrl: '/models/dungeon/banner_patternb_white.glb',
  },
  flowers: {
    // The Hollow's own card, copied byte for byte from `FLOWER_PALETTES.dusk`
    // in `foliage.ts`: pinks, purples and whites.
    card: [
      { p: [238, 150, 190], c: [180, 90, 40] },
      { p: [190, 150, 235], c: [240, 220, 120] },
      { p: [246, 242, 250], c: [244, 200, 70] },
    ],
    // DUSK_BLOOM_TINTS, the palette the zone's own flowering bushes take.
    colours: [0x9e94ba, 0xd88fb0, 0xe8d8a0, 0x8fb8d8, 0xc88fd8],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampVeiledCrystal',
    'pixieMushroomHouse',
    'crystalMoundCave',
    'starHeartCrystal',
    'stagShrine',
    'kkWall',
    'kkPillar',
    'kmedHomeA',
    'kmedHomeB',
    'kmedTavern',
    'kmedChurch',
    'mushroomRed',
    'mushroomTan',
    'shrub',
    'oak',
    'postLantern',
    'bench',
    'statueBlock',
    'reeds',
  ],
  water: { shallow: 0x5a7fb8, deep: 0x1d1c3a },
  sky: {
    biome: 'dusk',
    fog: { color: 0x9c86bc, near: 85, far: 430 },
  },
};

/**
 * Thornpeak Heights: bare mountain stone, and what a quarry road carries: ore,
 * boulders, cut timber and crates.
 *
 * The show-jumping fixtures are NOT here, though this record once led with
 * them: the course they belong to left Highwatch for the Galecrest Stables
 * (`MOUNT_RACE_COURSE`), so on a Thornpeak circuit they would be another zone's
 * furniture.
 */
const THORNPEAK: RallyCircuitTheme = {
  ground: 'peaks',
  // Snow-bleached stone and slate: cold where the garden's pair is warm.
  kerb: { base: 0xdfe4e2, stripe: 0x4f6b78 },
  startGrid: { light: 0xe6eae8, dark: 0x24302f },
  barriers: ['mountainWall', 'stoneWall', 'woodPaling'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    // Highland leather brown, the one warm colour on a grey mountain.
    bannerUrl: '/models/dungeon/banner_patterna_brown.glb',
  },
  flowers: {
    // AUTHORED: the peaks have no zone card of their own. Alpine planting,
    // which is small, pale and blue: snow saxifrage, gentian, moss campion.
    card: [
      { p: [236, 240, 248], c: [240, 206, 96] },
      { p: [124, 152, 214], c: [232, 238, 250] },
      { p: [228, 158, 182], c: [176, 96, 120] },
    ],
    colours: [
      0xe8eef4, // snow white
      0x7f9ad2, // gentian blue
      0xdca8bc, // moss campion
      0xc8cfae, // lichen
      0xe0c878, // alpine gold
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampThornpeakBeacon',
    'oreRocks',
    'rockTallA',
    'rockTallH',
    'rockLargeD',
    'rockLargeF',
    'kcasRocks',
    'crateWooden',
    'hexLumber',
    'hexWheelbarrow',
    'column',
    'columnBroken',
    'statueBlock',
    'bonfire',
    'oak',
    'shrub',
  ],
  water: { shallow: 0x6fa8b4, deep: 0x163040 },
  sky: {
    biome: 'peaks',
    fog: { color: 0xb6c2c4, near: 85, far: 430 },
  },
};

/**
 * The Drakelands: the ember storm over the far north, dressed as the world
 * builds the zone today.
 *
 * Almost nothing here is castle-set stock any more, because almost nothing in
 * the zone is: Wyrmwatch and the Last Keep were rebuilt out of the owner's
 * rebuild kit (`/models/drakelands_kit/`) and the Forgefather's Isle is the
 * fortress kit (`ignivar_prop_*`), all placed from
 * `FORGEFATHER_FORTRESS_PLACEMENTS`, and the waste carries the ember zone's own
 * lava, dragon dens and ember lilies (`ember_features.ts`). A circuit draws
 * both families through the world's own templates and parse (the `worldKit`
 * and `worldRaw` dressing routes), so it wears the exact materials the zone
 * does, the kit's warm grade included, and links no program the zone does not.
 *
 * Three things are left bare because the world leaves them bare:
 *  - the grass: `GRASS_BIOME_DENSITY.ember` is zero, so the lawn is ash;
 *  - the pond rim: the world's water flora skips the ember biome
 *    (`water_flora_core.ts`), so Greenshade Pool and the Last Spring carry no
 *    reeds and no lilies, and neither does a pond here;
 *  - the water's colour: the zone's lakes are the world's own water. Its LAVA
 *    is a modelled piece rather than water, and the pool a circuit may place
 *    (`lavaPool`) is solid scenery with no mechanic, exactly as the world's own
 *    pools carry none. A lava-tinted pond would be a lie a racer could swim in.
 */
const DRAKELANDS: RallyCircuitTheme = {
  ground: 'ember',
  // The zone's own basalt (`emberBasalt`, terrain_palette.ts) under the melt
  // orange its lava pools glow with (ember_features.ts): the darkest kerb base
  // in the registry, because a bone-pale block on black ash reads as a hole.
  kerb: { base: 0x4e3c34, stripe: 0xff5a18 },
  startGrid: { light: 0xefe0cc, dark: 0x1c1512 },
  // The fortress curtain and the Last Keep's palisade: what the zone is walled
  // with, both drawn from the world's own templates.
  barriers: ['fortressWall', 'keepFence'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    // Red cloth in pattern A: the colour the Last Keep's own hall banners fly
    // (`KEEP_DRESSING_KEYS`, lastkeep_dressing.ts).
    bannerUrl: '/models/dungeon/banner_patterna_red.glb',
  },
  flowers: {
    // The zone's own card, copied byte for byte from `FLOWER_PALETTES.ember`:
    // the firebloom of the always-bloom meadows round Wyrmwatch and down the
    // Gatewood road (`DRAKELANDS_FLOWER_MEADOWS`). It is the only flower the
    // zone grows, and it grows nowhere on the waste.
    card: [
      { p: [244, 70, 48], c: [130, 28, 16] },
      { p: [250, 142, 46], c: [150, 72, 20] },
      { p: [238, 96, 60], c: [125, 40, 22] },
    ],
    // The card's own three petals, plus the cinder-bloom the zone's flora glows
    // with after dark (`FLORA_TINT.ember`, night_accents_core.ts).
    colours: [0xf44630, 0xfa8e2e, 0xee603c, 0xff8a4a],
  },
  reedUrl: null,
  props: [
    'lampDrakelandsBrazier',
    // Wyrmwatch and the Last Keep: the rebuild kit's halls, houses, chapel,
    // stables, dragon statues, churchyard stones and training yard.
    'dkBuilding1',
    'dkBuilding2',
    'dkBuildingBase',
    'dkBuildingBaseRoof',
    'dkChurch',
    'dkStables',
    'dkDragonStatue',
    'dkGravestone2',
    'dkGravestone3',
    'dkDummy',
    'dkShieldRack',
    // The Forgefather's Isle: the fortress kit's towers, dragon pillars,
    // cannon, gear walls and bridge piers.
    'ffTowerPillar',
    'ffTowerBase',
    'ffDragonPillar',
    'ffCannon',
    'ffGearWall',
    'ffBridgePillar',
    // The waste: the melt, the dragon dens and the ember lilies.
    'lavaPool',
    'dragonHoard',
    'dragonEggs',
    'emberLily',
    // What the zone still places out of the world's prop catalog: Smith Mara's
    // forge, the two cannon stations, the ruin rings, the churchyards, the
    // forge quest's well and Scout Yerrin's campfire.
    'hexrBlacksmith',
    'hexCannon',
    'hexCannonballs',
    'kcasCratesStacked',
    'hexCrateBig',
    'hexSack',
    'column',
    'columnBroken',
    'statueHead',
    'statueBlock',
    'graveRound',
    'graveCross',
    'well',
    'bonfire',
  ],
  sky: {
    // The ember storm dome, under the zone's own haze colour
    // (`Renderer.BIOME_FOG.ember`); the depth is the band's, as for every theme.
    biome: 'ember',
    fog: { color: 0x9a5844, near: 85, far: 430 },
  },
};

/**
 * The Wraithwood: a graveyard circuit under a green gloom.
 *
 * The four headstones are separate catalog kinds precisely so a record can lay
 * a real burial ground rather than one repeated silhouette, and this is the
 * theme they exist for. The wall is the ruin kit's CRACKED panel, drawn a
 * tenth over size so it sags where the Hollow's stands square.
 */
const WRAITHWOOD: RallyCircuitTheme = {
  ground: 'haunt',
  // Bone against mildew: the zone's own sickly pale grass is the reason the
  // stripe is green rather than red, which would read as fresh paint here.
  kerb: { base: 0xd8dcc8, stripe: 0x4c5a3e },
  startGrid: { light: 0xdfe3d2, dark: 0x1e2419 },
  barriers: ['crackedWall', 'ruinWall', 'woodPaling'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    // Pattern C in brown: rotted cloth, the one colourway that reads as having
    // hung there a long time.
    bannerUrl: '/models/dungeon/banner_patternc_brown.glb',
  },
  flowers: {
    // AUTHORED: the haunt has no zone card. Grave planting, which is pale and
    // half dead: bone-white lilies, a bruised violet, fungal grey-green.
    card: [
      { p: [228, 232, 214], c: [168, 176, 120] },
      { p: [186, 170, 204], c: [120, 108, 140] },
      { p: [206, 214, 190], c: [150, 158, 110] },
    ],
    colours: [
      0xd8dcc4, // bone white
      0xa8b08c, // mildew
      0xb49ec8, // bruise violet
      0x8fa0a8, // mist grey
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampWraithwoodGhost',
    'graveRound',
    'graveCross',
    'graveBevel',
    'graveDecor',
    'kkWallCracked',
    'kkWall',
    'kkPillar',
    'kcasRubbleHalf',
    'column',
    'columnBroken',
    'statueHead',
    'bellTower',
    'postLantern',
    'bonfire',
    'banner',
    'oak',
    // the overgrown giants the Wraithwood is named for: the same elder model
    // `haunt_features.ts` clones dark over the wood's own greatTrees spots
    'greatTree',
    'shrub',
    'mushroomTan',
  ],
  water: { shallow: 0x4d6053, deep: 0x121a14 },
  sky: {
    biome: 'haunt',
    fog: { color: 0x8c9a86, near: 85, far: 430 },
  },
};

/**
 * Eastbrook Vale: the starting valley, and the one circuit a new player would
 * recognise before they had raced anything.
 *
 * The town is the rebuilt harbour village of `eastbrook_layout.ts`: the
 * blue-roofed hexagon-kit homes, inn, bank, smithy and market round the hex
 * chapel, a stone hut on the dock, the village's own wooden rail along the
 * smithy yard and the market edge, and the clutter and churchyard a working
 * town keeps. Its two landmarks, the town wall wing and the Realm Builder
 * monument, are bespoke models the rally catalog does not carry.
 */
const EASTBROOK: RallyCircuitTheme = {
  ground: 'vale',
  // Limewash and barn ochre, the two colours the village paints with.
  kerb: { base: 0xf0e8d2, stripe: 0x9c5a2c },
  startGrid: { light: 0xf4eeda, dark: 0x2c2419 },
  barriers: ['paddockRail', 'stoneWall', 'hedge'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patterna_green.glb',
  },
  flowers: {
    // AUTHORED: the vale has no zone card, which is the oldest gap in the
    // world's flower tables rather than a decision. Hedgerow planting, which
    // is white and butter and clover pink.
    card: [
      { p: [246, 246, 250], c: [244, 200, 70] },
      { p: [245, 195, 60], c: [150, 90, 20] },
      { p: [238, 150, 190], c: [180, 90, 40] },
    ],
    colours: [
      0xf4f2e8, // daisy white
      0xf2d264, // buttercup
      0xe8a8bc, // clover pink
      0xbcd08c, // meadow green
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampEastbrookCivic',
    'hexbHomeA',
    'hexbHomeB',
    'hexbTavern',
    'hexbTownhall',
    'hexbWorkshop',
    'hexbMarket',
    'hexChurch',
    'house3',
    'fence',
    'timberPillar',
    'crateWooden',
    'barrel',
    'bonfire',
    'graveRound',
    'bench',
    'oak',
    'shrub',
  ],
  sky: {
    biome: 'vale',
    fog: { color: 0xb8cba0, near: 85, far: 430 },
  },
};

/**
 * Mirefen Marsh: peat, reeds and standing water under an overcast.
 *
 * The honest limitation, recorded because it is the only thing about this
 * record worth arguing with: the marsh's own dressing is not in the rally
 * catalog. The delve's pieces (the dead tree, the sluice post, the corpse
 * candle, the bell gallows) DO load at world entry for every player
 * (`delve_marsh_dressing.ts` registers them in the deferred lane), and so do
 * Fenbridge's bespoke `fenbridge_*` buildings, but neither set is a
 * `PROP_ASSET_DEFS` key, so reaching them is a registration of their own, not
 * a change here. The vocabulary below is what the marsh reads as out of the
 * catalog: waterside planting, clutter, and a palisade and timber picked for
 * the look, since the zone itself lays no fence.
 */
const MIREFEN: RallyCircuitTheme = {
  ground: 'marsh',
  // Bog-bleached wood over peat: the wettest, brownest pair in the registry.
  kerb: { base: 0xcfd4b2, stripe: 0x5c4a2e },
  startGrid: { light: 0xd8dcbc, dark: 0x231d13 },
  barriers: ['woodPaling', 'paddockRail', 'crackedWall'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternb_brown.glb',
  },
  flowers: {
    // AUTHORED: the marsh has no zone card. Wetland planting: bog cotton,
    // marsh orchid, kingcup.
    card: [
      { p: [214, 222, 186], c: [168, 150, 86] },
      { p: [186, 168, 208], c: [120, 100, 150] },
      { p: [236, 228, 178], c: [176, 150, 72] },
    ],
    colours: [
      0xd2dcae, // bog cotton
      0xb49cc8, // marsh orchid
      0xe4d488, // kingcup
      0x8ca878, // sedge green
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampMirefenWitchflame',
    'reeds',
    'lilyRaft',
    'hexnPalisade',
    'timberPillar',
    'fence',
    'crateWooden',
    'barrel',
    'hexTrough',
    'hexSack',
    'bonfire',
    'postLantern',
    'graveBevel',
    'rockLargeD',
    'rockLargeF',
    'mushroomRed',
    'mushroomTan',
    'oak',
    'shrub',
  ],
  water: { shallow: 0x5c6b3e, deep: 0x1e2413 },
  sky: {
    biome: 'marsh',
    fog: { color: 0xa6ae86, near: 85, far: 430 },
  },
};

/**
 * The Willowfen: still green water, lily rafts and a living hedge.
 *
 * Walled first in something that GROWS. The Great Maze's hedge module is a
 * yard long and half a yard tall, so at scale 3 it runs just under three yards
 * and stands over one and a half, and its runs overlap at a joint rather than
 * taking a cap: a wetland circuit fenced in cut stone would read as anywhere
 * else.
 */
const WILLOWFEN: RallyCircuitTheme = {
  ground: 'fen',
  // River chalk against willow: pale and green, where the garden is bone and
  // red.
  kerb: { base: 0xe4eedc, stripe: 0x3f7a58 },
  startGrid: { light: 0xe8f0e2, dark: 0x1b2b22 },
  barriers: ['hedge', 'woodPaling', 'paddockRail'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternc_blue.glb',
  },
  flowers: {
    // The zone's own card, copied byte for byte from `FLOWER_PALETTES.fen`: a
    // mixed wildflower field, which the world builds in BALANCED mode so its
    // blue and orange heads are guaranteed a place among the pastels.
    card: [
      { p: [130, 160, 235], c: [230, 236, 250] },
      { p: [250, 245, 210], c: [210, 170, 60] },
      { p: [242, 150, 110], c: [180, 90, 50] },
      { p: [200, 170, 230], c: [160, 120, 200] },
      { p: [245, 250, 255], c: [220, 220, 150] },
      { p: [244, 168, 200], c: [200, 110, 150] },
    ],
    // FEN_BLOOM_TINTS.
    colours: [0xf2a8c8, 0xf2e0a0, 0xffffff, 0xa8d8f2, 0xf2a88f],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampWillowfenReed',
    'lilyRaft',
    'reeds',
    'rowboat',
    'dockPlatform',
    'hexBoat',
    'hexBoatrack',
    'hexTrough',
    'fence',
    'timberPillar',
    'kmedHomeB',
    'bench',
    'postLantern',
    'bonfire',
    'bedRound',
    'mushroomRed',
    'mushroomTan',
    'oak',
    'shrub',
  ],
  water: { shallow: 0x4f8f6b, deep: 0x123024 },
  sky: {
    biome: 'fen',
    fog: { color: 0xa8c8a0, near: 85, far: 430 },
  },
};

/**
 * The Palmreach: a tropical shore behind rough timber.
 *
 * The stockade this record was first written around is gone: it was the hex
 * wall module at a larger scale, and that module is one kit (`stoneWall`) whose
 * size a record sets. The zone itself lays no fence, so the paling, the log
 * palisade and the timber posts offered here are picks for the look, and the
 * shore's own pieces are its rowboats, its dock and its banyans.
 */
const PALMREACH: RallyCircuitTheme = {
  ground: 'jungle',
  // Coral sand against lagoon teal.
  kerb: { base: 0xf4ecd0, stripe: 0x1f8a72 },
  startGrid: { light: 0xf6f0d8, dark: 0x123028 },
  barriers: ['woodPaling', 'paddockRail', 'stoneWall'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternb_green.glb',
  },
  flowers: {
    // The zone's own card, copied byte for byte from `FLOWER_PALETTES.jungle`:
    // hibiscus orange and morning-glory blue leading over plumeria white and
    // jungle pink.
    card: [
      { p: [245, 120, 60], c: [200, 70, 30] },
      { p: [100, 150, 240], c: [225, 235, 252] },
      { p: [245, 120, 60], c: [200, 70, 30] },
      { p: [100, 150, 240], c: [225, 235, 252] },
      { p: [250, 248, 240], c: [245, 200, 80] },
      { p: [240, 130, 170], c: [200, 80, 120] },
    ],
    // AUTHORED off that card: the jungle has no bloom-tint table of its own.
    colours: [0xf5783c, 0x6496f0, 0xfaf8f0, 0xf082aa, 0xf5c84c],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampPalmreachTotem',
    'hexnPalisade',
    'timberPillar',
    'rowboat',
    'dockPlatform',
    'hexShipGreen',
    'hexBoat',
    'hexAnchor',
    'hexCrateBig',
    'hexCrateOpen',
    'hexSack',
    'barrel',
    'crateWooden',
    'bonfire',
    'banner',
    'rockLargeF',
    'mushroomRed',
    'oak',
    // the vine-hung banyans of the strand: `jungle_features.ts` raises the same
    // elder model at the Palmreach's own greatTrees spots
    'greatTree',
    'shrub',
  ],
  water: { shallow: 0x2fa8a0, deep: 0x0d3a4a },
  sky: {
    biome: 'jungle',
    fog: { color: 0x8fc4a8, near: 85, far: 430 },
  },
};

/**
 * The Farshore: the isle, and the theme that made the sky field a `SkyKey`.
 *
 * Two things here are not like the others, and both are the zone being honest
 * rather than the record being odd:
 *
 *  - its DOME is `farshore`, a place-keyed sky rather than a biome one. The
 *    world already flies it over the isle's rect (`sky.ts` overrides the biome
 *    pick there), so a Farshore circuit under the vale's day sky would be lit
 *    by the mainland;
 *  - its GROUND is `beach` rather than the isle's own `vale`. The isle is a
 *    sand shore, `beach` is a fully-tabled paint-only biome, and it leaves the
 *    vale free for Eastbrook under the one-ground-per-theme rule.
 *
 * The isle's own models are NOT in the rally catalog: the manifested `beach_*`
 * set (the dock, the ship, the house, the cannon, the palms) and the salvage
 * quest's wreck kit (`farshore_shipwreck.ts`) sit outside `PROP_ASSET_DEFS`.
 * The palms (fetched by `jungle_features.ts`) and the wreck kit do load at
 * world entry for every player, so reaching them is a registration rather than
 * a download; the rest would be a fetch of their own. The harbour vocabulary
 * below is the catalog's, which is Wickharbor's rather than the isle's.
 */
const FARSHORE: RallyCircuitTheme = {
  ground: 'beach',
  // Sailcloth over deep water.
  kerb: { base: 0xf6efdc, stripe: 0x2a6c93 },
  startGrid: { light: 0xf8f2e4, dark: 0x14293a },
  barriers: ['stoneWall', 'paddockRail', 'ornateRailing'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternc_white.glb',
  },
  flowers: {
    // AUTHORED: neither the beach nor the isle has a zone card. Dune planting:
    // sea holly, sand verbena, sailcloth white.
    card: [
      { p: [236, 242, 244], c: [240, 214, 120] },
      { p: [168, 196, 204], c: [120, 150, 160] },
      { p: [244, 186, 150], c: [190, 110, 70] },
    ],
    colours: [
      0xeef2f0, // sail white
      0x9fc4cc, // sea holly
      0xf2c07e, // sand verbena
      0xe8dcb4, // dune gold
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampFarshoreCoral',
    'hexShipRed',
    'hexShipGreen',
    'hexBoat',
    'hexBoatrack',
    'hexAnchor',
    'dockPlatform',
    'rowboat',
    'shipMonument',
    'hexbShipyard',
    'hexCrateBig',
    'hexCrateOpen',
    'hexSack',
    'hexBarrel',
    'barrel',
    'hexWall',
    'bonfire',
    'oak',
    'shrub',
  ],
  water: { shallow: 0x35a0c0, deep: 0x0e3350 },
  sky: {
    biome: 'farshore',
    fog: { color: 0xa8c8d8, near: 85, far: 430 },
  },
};

/**
 * The Amberfall: the warmest air in the world, and a vocabulary that is
 * deliberately generic.
 *
 * Recorded so a later pass does not read it as an oversight: the Amberfall has
 * no signature GLB and is not supposed to have one. Its identity is COLOUR,
 * the autumn tint on its trees and the warmest fog anywhere, and the zone's
 * god-rays were removed on purpose rather than lost. So this record leans on
 * the amber card, the amber bloom tints and an ornate iron railing, and its
 * scenery is lanterns, ruin columns and campfires: what stands under the
 * turning wood, not what replaces it.
 */
const AMBERFALL: RallyCircuitTheme = {
  ground: 'amber',
  // Birch pale against burnt amber.
  kerb: { base: 0xf2e2c0, stripe: 0xc86a1e },
  startGrid: { light: 0xf4e8cc, dark: 0x30210f },
  barriers: ['ornateRailing', 'stoneWall', 'hedge'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternb_yellow.glb',
  },
  flowers: {
    // The zone's own card, copied byte for byte from `FLOWER_PALETTES.amber`:
    // oranges, yellows and whites.
    card: [
      { p: [245, 150, 50], c: [150, 80, 20] },
      { p: [248, 205, 70], c: [160, 100, 25] },
      { p: [248, 244, 235], c: [230, 170, 60] },
    ],
    // AMBER_BLOOM_TINTS: near-white, which is the zone letting its LIGHT do
    // the colouring rather than its petals.
    colours: [0xffffff, 0xfaf6ec, 0xf4eedd],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampAmberfallCrystal',
    'postLantern',
    'lanternWall',
    'bench',
    'well',
    'column',
    'columnBroken',
    'statueBlock',
    'statueHead',
    'bonfire',
    'banner',
    'haybale',
    'farmCrate',
    'kmedHomeA',
    'kmedTavern',
    'kmedChurch',
    'bedRound',
    'oak',
    'shrub',
  ],
  sky: {
    biome: 'amber',
    fog: { color: 0xd8a86a, near: 85, far: 430 },
  },
};

/**
 * The Frostveil Reach: the honest gap in this registry.
 *
 * NAMED rather than papered over, because the next person to open this file
 * should not spend an afternoon looking for what is missing: the catalog holds
 * no frost piece. The world has exactly one, the ice spire the Reach is planted
 * with (`frostveil_ice_spire.glb`, `frost_ice_fields.ts`, fetched at world
 * entry for every player), and it is not a `PROP_ASSET_DEFS` key. There is no
 * snowed model and no frost flower card, and `GRASS_BIOME_DENSITY.frost` is
 * zero, so the circuit's lawn is bare. What carries the zone here is the
 * ground and the air: a near-white surface under the frost twilight dome, the
 * coldest fog in the registry, and borrowed castle masonry standing in for a
 * wall nobody has carved.
 *
 * If the seat verdict is that this is not good enough, the first follow-up is
 * registering the spire (a catalog row, no new art); past that it is an asset
 * job (the image-to-glb pipeline, a handful of snow-laden pieces).
 */
const FROSTVEIL: RallyCircuitTheme = {
  ground: 'frost',
  // Snow against glacier blue: the palest pair in the registry, which is the
  // one place a kerb has to work by VALUE rather than by hue.
  kerb: { base: 0xf4f9ff, stripe: 0x5f86b4 },
  startGrid: { light: 0xf6faff, dark: 0x1c2a3c },
  barriers: ['curtainWall', 'stoneWall', 'ironwork'],
  startFixture: {
    archUrl: COURSE_ARCH_URL,
    bannerUrl: '/models/dungeon/banner_patternb_blue.glb',
  },
  flowers: {
    // AUTHORED: the frost has no zone card, and a snowfield has no flowers
    // either, so this card is deliberately almost colourless. It is what the
    // border sows, and a border of white on white is the correct answer for
    // this zone rather than a missing one.
    card: [
      { p: [240, 246, 252], c: [196, 220, 240] },
      { p: [204, 224, 244], c: [240, 248, 252] },
      { p: [224, 236, 248], c: [168, 198, 228] },
    ],
    colours: [
      0xf2f7fc, // snow white
      0xc8dcf0, // glacier
      0xa8c4e0, // ice blue
      0xdce8f4, // rime
    ],
  },
  reedUrl: REEDS_URL,
  props: [
    'lampFrostveilIcicle',
    'kkWall',
    'kkPillar',
    'kkWallCracked',
    'kcasRocks',
    'kcasRubbleHalf',
    'column',
    'columnBroken',
    'statueBlock',
    'rockTallA',
    'rockTallH',
    'rockLargeD',
    'crateWooden',
    'barrel',
    'bonfire',
    'postLantern',
    'graveBevel',
    'oak',
    'shrub',
  ],
  water: { shallow: 0x8fc2d8, deep: 0x1b3a52 },
  sky: {
    biome: 'frost',
    fog: { color: 0xc8d8e8, near: 85, far: 430 },
  },
};

/**
 * One record per world-map ZONE, which is the whole point of the seam: a
 * circuit drawn anywhere wears the art of the realm it is meant to be in, and
 * adding a realm's circuit is adding a `theme:` string to its record.
 *
 * `tests/realm_racers_themes.test.ts` holds the registry to the zone table
 * both ways, so a fifteenth realm cannot ship without one.
 */
export const CIRCUIT_THEMES: Record<string, RallyCircuitTheme> = {
  evergarden: EVERGARDEN,
  galecrest: GALECREST,
  nightbloom: NIGHTBLOOM,
  veiled_hollow: VEILED_HOLLOW,
  thornpeak: THORNPEAK,
  drakelands: DRAKELANDS,
  wraithwood: WRAITHWOOD,
  eastbrook: EASTBROOK,
  mirefen: MIREFEN,
  willowfen: WILLOWFEN,
  palmreach: PALMREACH,
  farshore: FARSHORE,
  amberfall: AMBERFALL,
  frostveil: FROSTVEIL,
};

/**
 * The theme a circuit wears, or the default for an id no theme authors.
 *
 * It FALLS BACK rather than throwing because this runs inside a world build: a
 * bad id is already an error the readout names (`unknown_theme`, which the
 * editor shows live and `tests/realm_racers_circuits.test.ts` fails on for a
 * shipped circuit), and a crash mid-build would take the whole client down over
 * a typo in a dev draft.
 */
export function realmRacersTheme(circuit: RealmRacersCircuit): RallyCircuitTheme {
  return CIRCUIT_THEMES[circuit.theme] ?? CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID];
}

/** The theme in force at a world point: whichever circuit owns the lane the
 *  viewer stands on, and the default between lanes. */
export function realmRacersThemeAt(x: number, z: number): RallyCircuitTheme {
  const lane = realmRacersLaneAt(x, z);
  return lane ? realmRacersTheme(lane.circuit) : CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID];
}

/**
 * A theme's own kit: the start fixture and what it plants along a shore.
 *
 * It used to open with the perimeter wall's two urls, and that pairing is what
 * the barrier catalog took over: a circuit's visible boundary is authored now
 * (`fences` on the record, drawn from
 * `src/render/realm_racers_barrier_visuals.ts`), so the models it wears follow
 * the RECORD rather than the theme, and they ride their own lane below.
 *
 * NOT the prop palette either, which rides the authored-dressing catalog's own
 * lane.
 */
function themeKitUrls(theme: RallyCircuitTheme): readonly string[] {
  return [
    theme.startFixture.archUrl,
    theme.startFixture.bannerUrl,
    ...(theme.reedUrl ? [theme.reedUrl] : []),
  ];
}

/**
 * Every model ANY theme can ask for.
 *
 * What the disk and media-manifest guards cover, so a record naming a file
 * nobody shipped fails before anyone drives it. It is deliberately NOT the boot
 * lane any more (see below).
 */
export const REALM_RACERS_THEME_ASSET_URLS: readonly string[] = [
  ...new Set(Object.values(CIRCUIT_THEMES).flatMap(themeKitUrls)),
];

/**
 * The kits that ride the BOOT lane: the ones a shipped circuit actually wears.
 *
 * It used to be every theme's, on the reasoning that structure a circuit cannot
 * draw late (the wall, the arch, the grid banner) must be resident before the
 * lights. That reasoning still holds; what stopped holding is the assumption
 * underneath it, that the registry is a handful of records. At one theme per
 * world zone it is fourteen, and a lane holding all fourteen kits would pin
 * about forty parsed scenes for the whole session, on a map that never clears,
 * for a player who may never race at all. That is the exact retention the
 * dressing catalog was kept out of the lane to avoid.
 *
 * So the lane is scoped to what is actually raced. The default theme is in it
 * unconditionally, because an unknown theme id falls back to it mid-build. A
 * theme with no circuit on it (the registry is meant to be written a zone ahead
 * of its circuit, and all but the worn ones are) reaches the draw path through
 * `instanceModel`'s fetch-and-fill arm instead: one bounded fetch at circuit
 * build, on the dev routes that are the only way to see such a circuit today
 * (the editor's preview and `/dev rallydraft`).
 */
export const REALM_RACERS_THEME_BOOT_URLS: readonly string[] = [
  ...new Set(
    [
      CIRCUIT_THEMES[REALM_RACERS_DEFAULT_THEME_ID],
      ...REALM_RACERS_CIRCUIT_LIST.map((circuit) => realmRacersTheme(circuit)),
    ].flatMap(themeKitUrls),
  ),
];
