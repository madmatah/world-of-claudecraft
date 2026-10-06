// What a Mortar Overdrive barrier kit LOOKS like: one entry per catalog key, saying
// which model a run is tiled from, how much run one module covers, and what
// stands where two runs meet.
//
// The keys are the sim catalog's (`src/sim/content/mortar_overdrive/barriers.ts`),
// which carries the thickness and the height a collider needs;
// `tests/mortar_overdrive_barriers.test.ts` fails on a key only one of the two knows.
//
// Every entry but the two Drakelands kits is one of the fourteen kit
// configurations the THEME registry used to carry as its `perimeter` field,
// promoted verbatim along with the reasoning each one was chosen for; those two
// were added from the zone as the world builds it today. That field dressed a
// DERIVED rectangle: one kit, four straight faces, four right angles, which is
// what made every circuit read as a box however different its road was.
// Nothing draws that box any more, so these are what an operator reaches for
// instead.
//
// URLS ARE WRITTEN OUT, which is the KIT convention rather than the dressing
// one, and the difference is worth stating because the two rules look
// contradictory. The dressing catalog may only name a model the client already
// fetches at world entry, and mints every entry through a helper typed against
// `PROP_ASSET_DEFS` so that promise holds by construction. A KIT is structure: it
// is fetched when the circuit authoring it starts its build, exactly as the
// theme kits are, so membership of the world's prop registry buys it nothing.
// What guards it
// instead is `MORTAR_OVERDRIVE_BARRIER_ASSET_URLS` below, walked against disk and the
// media manifest by `tests/render_glb_replacement_assets.test.ts`, which is the
// same guard `MORTAR_OVERDRIVE_THEME_ASSET_URLS` has always had.
//
// Three numbers travel together and none is optional:
//
//  - `panelYards` is one module's run AT THE SCALE IT IS DRAWN AT, which is what
//    decides how many pieces a run is cut into. A module measured at scale 1 and
//    drawn at another leaves gaps between panels.
//  - `scale` is that scale, and it is part of the kit rather than a knob: the
//    module is the same one at any size, so what a kit fixes is the proportion
//    that was looked at. A record wanting a lower wall says so with its OWN
//    `scale`, which is why two kits differing only by scale are not two kits.
//  - `lengthAxis` is which of the module's OWN axes the run lies along. The
//    world's kits disagree, so it is authored rather than assumed. Assuming +x
//    for every kit is what once stood every module of the Galecrest wall
//    broadside to the wall it was meant to be.
//
// `corner` is the fourth, and THE RULE IS THAT IT IS A DIFFERENT MODULE OR
// NOTHING. A rigid GLB cannot be mitred, so two runs meeting at an angle either
// need a piece SHAPED like a joint (a pillar, a post) or need to overlap.
// Repeating the PANEL there is the third option and it is always wrong: a wall
// module centred on the joint lies diagonally across the corner, sticking out
// both ways, which is what nine kits did in the first seat test of this feature.
//
// The registry this replaced hid that, and the hiding is instructive: ten of the
// fourteen themes already put the same url in `fenceUrl` and `pillarUrl`, and
// nobody saw it, because a derived RECTANGLE only ever has 90 degree corners
// inside a uniform box. An authored run turns wherever the operator drew it, and
// the defect is immediate. `tests/mortar_overdrive_barriers.test.ts` refuses a kit
// whose corner url is its own panel url, so it cannot come back.
//
// ONE CONFIGURATION WAS DROPPED RATHER THAN PROMOTED, and it is recorded here so
// the finding is not lost. The Galecrest's `hexn_fence_stone` is authored a
// whole unit off its own origin (its bounding box centres on x = -1.00), so at
// that theme's scale of 4.2 every module stood 4.2 yards to one side of the line
// it was placed along. On a RECTANGLE that is invisible: all four faces shift by
// the same amount and the result is still a rectangle, just not the one the
// collider set holds. On an authored run it is a wall standing four yards away
// from where it was drawn. Correcting it would mean a lateral offset field one
// kit in the registry uses, so the Galecrest takes the harbour parapet instead.

import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import { GARDEN_MAZE_WALL_URL } from '../garden_maze_core';

const IRON_FENCE_URL = '/models/props/garden_iron_fence.glb';
const IRON_PILLAR_URL = '/models/props/garden_iron_pillar.glb';
const ORNAMENT_URL = '/models/biome/city_fence_ornament.glb';
const MAZE_HEDGE_URL = GARDEN_MAZE_WALL_URL;
const CITY_FENCE_WOOD_URL = '/models/biome/city_fence_wood.glb';
const VILLAGE_RAIL_URL = '/models/props/fence.glb';
const HEX_WALL_URL = '/models/biome/hex_wall.glb';
const RUIN_WALL_URL = '/models/dungeon/wall.glb';
const RUIN_PILLAR_URL = '/models/dungeon/pillar.glb';
const CRACKED_WALL_URL = '/models/dungeon/wall_cracked.glb';
const MOUNTAIN_WALL_URL = '/models/biome/dungeon_wall_stone.glb';
const BATTLEMENT_URL = '/models/biome/kcas_barrier.glb';
const CURTAIN_WALL_URL = '/models/biome/kcas_wall.glb';
const FORTRESS_WALL_URL = '/models/dungeon/ignivar_prop_fortress_wall.glb';
const FORTRESS_TOWER_URL = '/models/dungeon/ignivar_prop_tower_pillar.glb';
const KEEP_FENCE_URL = '/models/drakelands_kit/fence.glb';

export interface MortarOverdriveBarrierVisual {
  panelUrl: string;
  /** One module's run at `scale`, yards. */
  panelYards: number;
  scale: number;
  /** Which of the module's own axes the run lies along. */
  lengthAxis: 'x' | 'z';
  /**
   * What stands at an authored point where two runs meet, and at both ends of an
   * open run. `'none'` covers the joint by overlapping the two runs instead.
   *
   * `yards` is the corner module's own run at `scale`, and it is what the panels
   * make ROOM for: a run wearing a corner piece is tiled INSIDE the joint by
   * half of it at each end, so the pillar sits in the gap. Without it the two
   * arms are tiled past each other and the railing crosses straight through the
   * pillar, which is what the first seat test of the corner rework showed.
   */
  corner: { url: string; yards: number } | 'none';
  /**
   * Drawn from the world's own env-prop templates (the `worldKit` dressing
   * route, mortar_overdrive/dressing_material.ts) rather than from its files, which
   * are resident from world entry: a circuit build never fetches such a kit.
   * `tests/mortar_overdrive_barriers.test.ts` holds the flag to the route.
   */
  worldTemplate?: true;
}

export const MORTAR_OVERDRIVE_BARRIER_VISUALS: Record<string, MortarOverdriveBarrierVisual> = {
  // --- ironwork and railings ---
  // Cut at 3.5 against a 4.0 module, so neighbouring panels overlap slightly
  // rather than butt.
  ironwork: {
    panelUrl: IRON_FENCE_URL,
    panelYards: 3.5,
    scale: 1,
    lengthAxis: 'x',
    corner: { url: IRON_PILLAR_URL, yards: 0.5 },
  },
  ornateRailing: {
    panelUrl: ORNAMENT_URL,
    panelYards: 1.95,
    scale: 1,
    lengthAxis: 'x',
    corner: 'none',
  },

  // --- growing things ---
  // A hedge is a mass, so the overlap at a joint reads as growth. Its own arch
  // is a gateway rather than a cap, which is why it is not the corner here.
  hedge: {
    panelUrl: MAZE_HEDGE_URL,
    panelYards: 2.9,
    scale: 3,
    lengthAxis: 'x',
    corner: 'none',
  },

  // --- timber ---
  woodPaling: {
    panelUrl: CITY_FENCE_WOOD_URL,
    panelYards: 3.3,
    scale: 1.6,
    lengthAxis: 'x',
    corner: 'none',
  },
  // The village rail the world runs round the Galecrest Stables paddock and
  // along Eastbrook's smithy yard. Its own timber post would stand three times
  // the rail's height, so the joint overlaps.
  paddockRail: {
    panelUrl: VILLAGE_RAIL_URL,
    panelYards: 2.35,
    scale: 3,
    lengthAxis: 'x',
    corner: 'none',
  },

  // --- masonry ---
  // The hex kit's wall at 2.4: a harbour parapet rather than a fortification.
  //
  // It absorbed two kits that were the SAME MODEL under other names. The world
  // ships `hex_wall.glb` and `hexn_palisade.glb` as separate files whose binary
  // chunks are byte for byte identical, and the theme registry described them as
  // a town wall and a log palisade, so the promotion produced three kits
  // (`stoneWall`, `palisade`, `stockade`) that drew one model at three scales.
  // The seat test caught it in one look. A scale is a RECORD field, so the two
  // sizes are still reachable and neither is a kit.
  stoneWall: {
    panelUrl: HEX_WALL_URL,
    panelYards: 4.8,
    scale: 2.4,
    lengthAxis: 'x',
    corner: 'none',
  },
  // The one kit whose own matching pier is the right height for it: both the
  // wall and the pillar measure 4 yards, so the run needs no scale at all.
  ruinWall: {
    panelUrl: RUIN_WALL_URL,
    panelYards: 4,
    scale: 1,
    lengthAxis: 'x',
    corner: { url: RUIN_PILLAR_URL, yards: 1.5 },
  },
  crackedWall: {
    panelUrl: CRACKED_WALL_URL,
    panelYards: 4.4,
    scale: 1.1,
    lengthAxis: 'x',
    corner: { url: RUIN_PILLAR_URL, yards: 1.5 },
  },
  // Mountain masonry, half of whose module is authored below its own origin. Its
  // kit's 4 yard pier would stand half again as tall as the wall it capped, so
  // the joint overlaps.
  mountainWall: {
    panelUrl: MOUNTAIN_WALL_URL,
    panelYards: 3.6,
    scale: 1.8,
    lengthAxis: 'x',
    corner: 'none',
  },
  // NOT the castle kit's own `kcas_barrier_corner`, and that is a measurement
  // rather than a preference: that module is an L, with arms reaching to -2.00
  // on its local x and +2.00 on its local z. A corner piece is seated centred on
  // the joint under one yaw, which is the one thing an L cannot take: one arm
  // would stand off the line while the run leaving the joint went uncapped.
  battlement: {
    panelUrl: BATTLEMENT_URL,
    panelYards: 6,
    scale: 1.5,
    lengthAxis: 'x',
    corner: 'none',
  },
  // Same reasoning as the battlement: `kcas_wall_corner` is an L too.
  curtainWall: {
    panelUrl: CURTAIN_WALL_URL,
    panelYards: 4.8,
    scale: 1.2,
    lengthAxis: 'x',
    corner: 'none',
  },
  // The Forgefather fortress curtain, capped the way the fortress caps it: a
  // tower pillar at every joint, the kit's own most placed piece. Both modules
  // are the world's env-prop templates (the `worldKit` route), seated and
  // turned as the fortress has them, so the numbers are the template's.
  fortressWall: {
    panelUrl: FORTRESS_WALL_URL,
    panelYards: 4.9,
    scale: 5,
    lengthAxis: 'x',
    corner: { url: FORTRESS_TOWER_URL, yards: 2.6 },
    worldTemplate: true,
  },

  // --- the Drakelands rebuild kit ---
  // The Last Keep's palisade. Its run overlaps at a joint, as the keep's own
  // fence lines do.
  keepFence: {
    panelUrl: KEEP_FENCE_URL,
    panelYards: 4.9,
    scale: 5,
    lengthAxis: 'x',
    corner: 'none',
    worldTemplate: true,
  },
};

/** The visual for a kit key, or undefined for one nothing authors. */
export function mortarOverdriveBarrierVisual(
  kit: string,
): MortarOverdriveBarrierVisual | undefined {
  return MORTAR_OVERDRIVE_BARRIER_VISUALS[kit];
}

function kitUrls(visual: MortarOverdriveBarrierVisual): readonly string[] {
  return visual.corner === 'none' ? [visual.panelUrl] : [visual.panelUrl, visual.corner.url];
}

/** Every model any barrier kit can ask for: what the disk and media-manifest
 *  guards cover. Nothing preloads it: a circuit fetches the kits it authors
 *  when its build starts (`mortarOverdriveBarrierKitUrls`). */
export const MORTAR_OVERDRIVE_BARRIER_ASSET_URLS: readonly string[] = [
  ...new Set(Object.values(MORTAR_OVERDRIVE_BARRIER_VISUALS).flatMap(kitUrls)),
];

/**
 * The barrier models these circuits fetch when their builds start: the kits
 * their records author, and only those.
 *
 * A circuit's STRUCTURE has to be there before the lights, because a wall that
 * arrived a frame late would be a wall that appeared during the countdown, so
 * the track builder starts these fetches with the build (the race
 * preparation's commitment to that circuit) and the circuit's preparation waits
 * for them under the lobby or arrival cover. It is walked off the RECORDS, so a
 * circuit that authors no barrier asks for nothing.
 *
 * A kit drawn from the world's env-prop templates is never in it, whoever
 * authors it: the template is resident from world entry, and a parse of its
 * file here would be a second copy nothing draws.
 */
export function mortarOverdriveBarrierKitUrls(
  circuits: readonly MortarOverdriveCircuit[],
): readonly string[] {
  return [
    ...new Set(
      circuits
        .flatMap((circuit) => circuit.fences ?? [])
        .map((fence) => MORTAR_OVERDRIVE_BARRIER_VISUALS[fence.kit])
        .filter(
          (visual): visual is MortarOverdriveBarrierVisual =>
            Boolean(visual) && !visual.worldTemplate,
        )
        .flatMap(kitUrls),
    ),
  ];
}
