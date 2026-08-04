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
  REALM_RACERS_DEFAULT_THEME_ID,
  type RealmRacersCircuit,
} from '../sim/content/realm_racers_circuits';
import { realmRacersLaneAt } from '../sim/realm_racers_layout';
import type { BiomeId } from '../sim/types';
import type { FlowerKind } from './textures';

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
   * The perimeter wall's kit. Three numbers that travel together, because each
   * one is meaningless without the others: `panelYards` is one panel's run at
   * `scale` (a module measured at scale 1 and drawn at another leaves gaps),
   * and `lengthAxis` is which of the module's OWN axes that run lies along.
   * The shipped kits disagree on that last one (the garden's ironwork is +x,
   * the world's stone wall is +z), so it is authored rather than assumed.
   */
  perimeter: {
    fenceUrl: string;
    pillarUrl: string;
    panelYards: number;
    scale: number;
    lengthAxis: 'x' | 'z';
  };
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
  /** What is planted along a pond's rim. */
  reedUrl: string;
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
  sky: { biome: BiomeId; fog: { color: number; near: number; far: number } };
}

const IRON_FENCE_URL = '/models/props/garden_iron_fence.glb';
const IRON_PILLAR_URL = '/models/props/garden_iron_pillar.glb';
/** The game's own race arch: `props.ts` already plants this exact model as the
 *  Highwatch show-jumping start gate, so a rally start line inherits a fixture
 *  the world has established rather than inventing one. */
const COURSE_ARCH_URL = '/models/props/course_arch.glb';

/**
 * The Evergarden: the theme both shipped circuits wear, and the one every
 * number here was measured on. It reproduces the pre-theme track build exactly,
 * which is what `tests/realm_racers_render.test.ts` pins.
 */
const EVERGARDEN: RallyCircuitTheme = {
  ground: 'garden',
  // One red block plus one white block per repeat, so the arc-length uv lays a
  // classic alternating kerb down the outside of a corner.
  kerb: { base: 0xe8e2d4, stripe: 0xb8402f },
  startGrid: { light: 0xf2efe6, dark: 0x22201d },
  perimeter: {
    fenceUrl: IRON_FENCE_URL,
    pillarUrl: IRON_PILLAR_URL,
    panelYards: 3.5,
    scale: 1,
    lengthAxis: 'x',
  },
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
  reedUrl: '/models/props/reeds.glb',
  // The garden's own vocabulary: stonework, ironwork, beds and specimen trees.
  props: [
    'oak',
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
    // The public lane's own answer today, so the circuit everyone races on is
    // lit exactly as it shipped and only the private practice copies change.
    biome: 'vale',
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
 * of kits the zone itself is built from (the coastal stone wall, the pine, the
 * Galecrest golden horse), and invents nothing that would need a seat pass of
 * its own to judge.
 */
const GALECREST: RallyCircuitTheme = {
  ground: 'gale',
  // Weathered grey and a faded harbour red, against the downs' sage.
  kerb: { base: 0xdcd8cd, stripe: 0xa04a3c },
  startGrid: { light: 0xe9e6dc, dark: 0x272b2e },
  perimeter: {
    // The world's own coastal wall module, at the scale `props.ts` builds its
    // stone runs with (1.155 yards of module at scale 4.2). The corner takes
    // the same piece rather than a pier of unknown height: a mismatched cap
    // reads worse than a corner that is simply more wall.
    fenceUrl: '/models/biome/hexn_fence_stone.glb',
    pillarUrl: '/models/biome/hexn_fence_stone.glb',
    panelYards: 4.851,
    scale: 4.2,
    // This kit's run is along its own +z, unlike the garden's ironwork.
    lengthAxis: 'z',
  },
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
  reedUrl: '/models/props/reeds.glb',
  // A working coast: the harbour's own furniture, the golden horse, and the
  // planting that survives salt wind.
  props: [
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
    // already places in the zone this theme wears. Three are aesthetic picks
    // off the already-loaded registry instead: the coastal fence module (which
    // this theme's own perimeter wall is built from, though no zone places it
    // as a prop), the pier deck, and the rowboat, which belongs to Palmreach
    // and is here because a harbour circuit wants a dinghy on the shingle.
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
 * dream sky, lit by giant fungus and amethyst rather than planted with beds,
 * and nothing about the circuit's geometry changes to get there.
 *
 * Every size below is MEASURED rather than eyed, off the placements the zone
 * itself already makes (`src/sim/content/realm.ts` seats the giant mushroom at
 * scale 10 for a 1.9 yard radius and a 10 yard height, and the amethyst cluster
 * at scale 1 for 2.4 by 6), so a piece in the ring is the size the world draws
 * it at rather than a guess that would need its own seat pass.
 */
const NIGHTBLOOM: RallyCircuitTheme = {
  ground: 'night',
  // The kerb has to READ, and it reads against a violet meadow rather than a
  // green one: a near-white block against deep violet, where the garden uses
  // bone against red.
  kerb: { base: 0xf2ecff, stripe: 0x4a2a8c },
  startGrid: { light: 0xf2ecff, dark: 0x201233 },
  perimeter: {
    // The world's own log palisade, at the length `props.ts` builds its
    // palisade runs at (2 yards of module, drawn here at 2.5). A dream wood is
    // fenced with the wood, not with the garden's wrought iron.
    fenceUrl: '/models/biome/hexn_palisade.glb',
    pillarUrl: '/models/biome/hexn_palisade.glb',
    panelYards: 5,
    scale: 2.5,
    lengthAxis: 'x',
  },
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
  reedUrl: '/models/props/reeds.glb',
  // Still water under a violet sky: dark to nearly black at depth, with a cold
  // moonlit shallow.
  // The dream wood's own growth, plus the little civic furniture a night
  // meadow carries. The four glowing kinds are the reason this list exists:
  // they are what the deleted ring used to plant, and nothing else in the
  // catalog looks remotely like them.
  props: [
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
    // houses (the zone raises those through `BuildingDef` kinds rather than as
    // props) and the two small fungi, which no zone places at all but which are
    // the only knee-high growth in the catalog.
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

export const CIRCUIT_THEMES: Record<string, RallyCircuitTheme> = {
  evergarden: EVERGARDEN,
  galecrest: GALECREST,
  nightbloom: NIGHTBLOOM,
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

/** Every model any theme can ask for: its wall kit, its start fixture and what
 *  it plants along a shore. The track builder preloads the whole set, because a
 *  themed piece whose url misses the preload lane draws nothing at all on a
 *  cold client and fails no test that does not look. (A theme's prop PALETTE is
 *  not here: those models ride the authored-dressing catalog's own lane.) */
export const REALM_RACERS_THEME_ASSET_URLS: readonly string[] = [
  ...new Set(
    Object.values(CIRCUIT_THEMES).flatMap((theme) => [
      theme.perimeter.fenceUrl,
      theme.perimeter.pillarUrl,
      theme.startFixture.archUrl,
      theme.startFixture.bannerUrl,
      theme.reedUrl,
    ]),
  ),
];
