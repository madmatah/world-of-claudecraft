// Placement decisions for the Realm Racers circuit: which stretches of road
// get kerbs, where the start arch and its banners stand, where the garden is
// sown, how an authored barrier is cut into modules, and where the water sits
// along the shore line. Everything here is geometry the painter then turns into
// meshes, so it stays Three-free, DOM-free and deterministic and a plain Vitest
// can assert the load-bearing properties.
//
// There are two of those, and both are about a racer who has left the road.
// Everything inside the perimeter is drivable, so nothing solid may stand
// there: the dressing lives outside the wall and the infield landmark out in
// the water. And nothing is SOWN on a band racers use either, so the beds start
// past the border line rather than merely off the tarmac.
//
// All positions are WORLD coordinates, straight off the shared sim spline, so
// the drawn circuit and the driven circuit come from one source.
//
// What each piece IS (which model, which colours, how big) belongs to the
// circuit's THEME (`realm_racers_themes.ts`) and never to this file: the
// decisions here are geometric and the same on every circuit in every zone.

import type { RealmRacersBasin, RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import { realmRacersFencePlacements } from '../sim/realm_racers_fences';
import { realmRacersGroundShape, realmRacersOnGround } from '../sim/realm_racers_ground';
import {
  REALM_RACERS_BORDER_OFFSET,
  REALM_RACERS_BORDER_SPACING,
  REALM_RACERS_LAWN_OVERSHOOT,
  REALM_RACERS_ORIGIN,
} from '../sim/realm_racers_layout';
import { realmRacersPlacedPonds } from '../sim/realm_racers_props_resolve';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../sim/realm_racers_spline';
import { hash2 } from '../sim/rng';
import { TICK_RATE } from '../sim/types';
import type { RealmRacersPhase } from '../world_api/realm_racers';
import { realmRacersBarrierVisual } from './realm_racers_barrier_visuals';
import { realmRacersTheme } from './realm_racers_themes';

/**
 * A contiguous run of centerline samples that gets a kerb. `from` is a real
 * sample index; `to` is exclusive and may exceed the sample count, meaning the
 * run crosses the start line, so the painter walks it modulo the count.
 */
export interface RallyKerbRun {
  from: number;
  to: number;
}

/**
 * One module of an authored barrier, in WORLD coordinates: either a panel cut
 * out of a run, or the piece covering a joint.
 */
export interface RallyBarrierPiece {
  x: number;
  z: number;
  yaw: number;
  corner: boolean;
}

/** Everything one authored fence draws: its modules and the kit they wear. */
export interface RallyFenceDrawing {
  kit: string;
  /** The kit's own scale times the record's multiplier: what a spot is drawn at. */
  scale: number;
  panels: readonly RallyBarrierPiece[];
  corners: readonly RallyBarrierPiece[];
}

export interface RallyBannerPlacement {
  x: number;
  z: number;
  /** Height of the banner NODE above the ground plane, yards. */
  lift: number;
  yaw: number;
  scale: number;
}

export interface RallyStartArchPlacement {
  x: number;
  z: number;
  /** Yaw putting the arch's long axis ACROSS the road. */
  yaw: number;
  /** Model scale along its long (z) axis: what makes the arch span the road. */
  spanScale: number;
  /** Model scale on x and y: height-capped, and applied to the DEPTH too so the
   *  posts keep their authored section instead of being stretched with the span. */
  uprightScale: number;
  /** Distance the arch spans, road plus margin, yards. */
  span: number;
  /** Half a post's depth along the road, yards: what a banner has to clear. */
  postHalfDepth: number;
  /** Unit road normal, the axis the posts are spaced along. */
  normalX: number;
  normalZ: number;
  /** One banner per post, fully placed. */
  banners: RallyBannerPlacement[];
}

export interface RallyStartLightPlacement {
  x: number;
  z: number;
  lift: number;
  /** Faces back down the approach straight. */
  yaw: number;
}

export interface RealmRacersStartLightSignal {
  colour: 'off' | 'red' | 'green';
  litCount: number;
}

/** The authoritative three-lamp decision, including the one-second green GO. */
export function realmRacersStartLightSignal(
  phase: RealmRacersPhase | null,
  countdownTicks: number,
  elapsedSeconds: number,
): RealmRacersStartLightSignal {
  if (phase === 'racing' && elapsedSeconds === 0) return { colour: 'green', litCount: 3 };
  if (phase !== 'countdown' || countdownTicks > 3 * TICK_RATE)
    return { colour: 'off', litCount: 0 };
  const elapsed = 3 * TICK_RATE - Math.max(0, countdownTicks);
  return {
    colour: 'red',
    litCount: Math.max(1, Math.min(3, 1 + Math.floor(elapsed / TICK_RATE))),
  };
}

export interface RallyFlowerSpot {
  x: number;
  z: number;
  rot: number;
  scale: number;
  /** Index into the theme's `flowers.colours`. Constant across a patch, which
   *  is what makes the garden read as sown beds rather than confetti. */
  colour: number;
}

/** Corners tighter than this radius get a kerb; anything straighter does not.
 *  Kept tight on purpose: a circuit reads as a circuit because a MINORITY of it
 *  is painted, and a generous threshold kerbs the gentle sweeps too. */
const KERB_RADIUS = 45;
/** Samples of lead-in and run-out added around a detected corner. */
const KERB_FEATHER = 5;
/** Corners separated by less than this many samples merge into one kerb. */
const KERB_MERGE_GAP = 10;
/** Shortest kerb worth drawing, in samples (one sample is about a yard). */
const KERB_MIN_LENGTH = 10;

/**
 * Which stretches of road get kerbs: the corners. A circuit reads as a circuit
 * because its corners are painted and its straights are not, so this is a
 * curvature test with a feather, a gap merge and a minimum length, never a
 * per-sample flicker.
 */
export function rallyKerbRuns(circuit: RealmRacersCircuit): RallyKerbRun[] {
  const track = realmRacersTrack(circuit);
  const samples = track.samples;
  const count = samples.length;
  const span = track.step * 2;
  const corner: boolean[] = new Array(count).fill(false);
  for (let i = 0; i < count; i++) {
    const a = samples[(i + count - 1) % count];
    const b = samples[(i + 1) % count];
    const turn = Math.acos(Math.min(1, Math.max(-1, a.tx * b.tx + a.tz * b.tz)));
    if (turn > 0 && span / turn < KERB_RADIUS) corner[i] = true;
  }
  const feathered: boolean[] = new Array(count).fill(false);
  for (let i = 0; i < count; i++) {
    if (!corner[i]) continue;
    for (let k = -KERB_FEATHER; k <= KERB_FEATHER; k++) feathered[(i + k + count) % count] = true;
  }
  if (feathered.every((on) => on)) return [{ from: 0, to: count }];
  const origin = feathered.indexOf(false);
  if (origin < 0) return [];

  // Walking from a straight means no run ever splits across the array end.
  const runs: RallyKerbRun[] = [];
  let open = -1;
  for (let k = 0; k <= count; k++) {
    const on = k < count && feathered[(origin + k) % count];
    if (on && open < 0) open = k;
    if (!on && open >= 0) {
      runs.push({ from: open, to: k });
      open = -1;
    }
  }
  const merged: RallyKerbRun[] = [];
  for (const run of runs) {
    const last = merged[merged.length - 1];
    if (last && run.from - last.to < KERB_MERGE_GAP) last.to = run.to;
    else merged.push({ ...run });
  }
  return merged
    .filter((run) => run.to - run.from >= KERB_MIN_LENGTH)
    .map((run) => ({
      from: (origin + run.from) % count,
      to: ((origin + run.from) % count) + (run.to - run.from),
    }));
}

/**
 * Clear grass each side of the road the start arch has to reach over. Generous
 * on purpose: at a tight margin the legs stand on the racing surface's very
 * edge and clip a racer taking the line wide through the line.
 */
const ARCH_SPAN_MARGIN = 6;
/** Tallest the arch may stand, yards. */
const ARCH_MAX_HEIGHT = 11;
/** Authored bounds of course_arch.glb, yards at scale 1: its LONG axis is z,
 *  its depth along the road is x, and it stands from y = 0. */
const ARCH_SOURCE_SPAN = 5.82;
const ARCH_SOURCE_DEPTH = 1.88;
const ARCH_SOURCE_HEIGHT = 4.5;
/** Authored bounds of banner_patterna_white.glb. The cloth lies in local x-y,
 *  hangs from minY 0.53, and sits 0.53 forward of the node origin along local
 *  +z, which its vertex normals also face. */
const BANNER_SOURCE_WIDTH = 1.5;
const BANNER_SOURCE_HEIGHT = 3.2;
const BANNER_SOURCE_FACE_Z = 0.53;
/** How wide a banner hangs, yards. */
const BANNER_WIDTH = 3.2;
/** Clear air between the post's approach face and the cloth, yards. */
const BANNER_POST_CLEARANCE = 0.2;
/** How far the cloth's top hangs below the arch's own top, yards. */
const BANNER_BEAM_DROP = 0.9;

/**
 * Where and how the one visible fixture stands, decided HERE rather than in the
 * painter, because every mistake this fixture has shipped was an orientation or
 * a scale, and a number in the core is a number a Vitest can pin:
 *
 * - course_arch's long axis is its local z, and a three.js yaw maps local +z to
 *   (sin, cos). Spanning the road means putting that axis on the road's NORMAL,
 *   so the arch's yaw is a quarter turn off the racing direction (the same
 *   `dir + PI/2` props.ts uses to plant this arch at Highwatch). Face it down
 *   the road instead and it straddles the racing line rather than framing it.
 * - Only that long axis is stretched. Scaling uniformly to reach across 18
 *   yards of road also made the posts nearly ten yards deep, under a height cap
 *   that left the whole gate squat.
 * - The banner is a ONE-SIDED cloth whose front faces its own local +z (mean
 *   vertex normal +0.78 z, and the material carries no doubleSided flag), so
 *   pointing that +z down the road culls it away from precisely the racer it is
 *   there for: its yaw is the racing direction REVERSED.
 */
/**
 * The road's edge markers: a sown line of flowering tufts down both sides,
 * the way an Evergarden walk is bordered. Nothing built, nothing solid; a racer
 * drives straight through them into the garden, and they only say where the
 * racing surface stops.
 */
export function rallyBorderFlowerSpots(circuit: RealmRacersCircuit): RallyFlowerSpot[] {
  const track = realmRacersTrack(circuit);
  const out: RallyFlowerSpot[] = [];
  const palette = realmRacersTheme(circuit).flowers.colours.length;
  const steps = Math.round(track.length / REALM_RACERS_BORDER_SPACING);
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * track.length;
    const point = track.pointAt(s);
    // One colour per RUN of the border rather than per flower, so the edge
    // reads as planted stretches the way an Evergarden walk does.
    const colour =
      Math.floor(hash2(Math.floor(i / BORDER_RUN_LENGTH), 0, 0xb105) * palette) % palette;
    for (const side of [1, -1]) {
      const roll = hash2(i, side, 0x5eed);
      // Sown on the VERGE/GARDEN boundary, not at the road edge: at the edge
      // they overhang the racing surface, and the line reads better marking
      // where the gentle band ends than where the road does.
      const offset =
        rallyGardenEdgeOffsetAt(circuit, point.s) + REALM_RACERS_BORDER_OFFSET + roll * 1.1;
      const x = point.x - point.tz * offset * side;
      const z = point.z + point.tx * offset * side;
      // Off the authored land, nothing is sown. The border follows the ROAD, so
      // it mostly bites where the road itself is running out of island, which the
      // readout calls an error. Not only there, though, and the difference is
      // worth knowing: the border sits up to a couple of yards PAST the garden
      // edge the rule probes at, so a shore cut that fine clips flowers while
      // the readout stays clean. The line stops rather than being planted over
      // the water, which is the right way round.
      if (!realmRacersOnGround(circuit, x - REALM_RACERS_ORIGIN.x, z - REALM_RACERS_ORIGIN.z)) {
        continue;
      }
      out.push({
        x,
        z,
        rot: roll * Math.PI * 2,
        scale: 0.7 + roll * 0.5,
        colour,
      });
    }
  }
  return out;
}

/** Border flowers per single-colour run. */
const BORDER_RUN_LENGTH = 14;

export function rallyStartArchPlacement(circuit: RealmRacersCircuit): RallyStartArchPlacement {
  const line = realmRacersTrack(circuit).pointAt(0);
  const span = (line.halfWidth + ARCH_SPAN_MARGIN) * 2;
  const spanScale = span / ARCH_SOURCE_SPAN;
  const uprightScale = Math.min(spanScale, ARCH_MAX_HEIGHT / ARCH_SOURCE_HEIGHT);
  const postHalfDepth = (ARCH_SOURCE_DEPTH * uprightScale) / 2;
  const bannerScale = BANNER_WIDTH / BANNER_SOURCE_WIDTH;
  // The cloth hangs this far forward of its own node, so the node has to sit
  // that much further back for the cloth to land just proud of the post. Miss
  // this and the banner is either buried inside the leg or adrift up the road.
  const approach = postHalfDepth + BANNER_POST_CLEARANCE - BANNER_SOURCE_FACE_Z * bannerScale;
  const lift =
    ARCH_SOURCE_HEIGHT * uprightScale - BANNER_SOURCE_HEIGHT * bannerScale - BANNER_BEAM_DROP;
  const normalX = -line.tz;
  const normalZ = line.tx;
  return {
    x: line.x,
    z: line.z,
    yaw: Math.atan2(-line.tz, line.tx),
    spanScale,
    uprightScale,
    span,
    postHalfDepth,
    normalX,
    normalZ,
    // Centred on each post, and backed up the road just clear of it.
    banners: [1, -1].map((side) => ({
      x: line.x + normalX * (span / 2) * side - line.tx * approach,
      z: line.z + normalZ * (span / 2) * side - line.tz * approach,
      lift: Math.max(0, lift),
      yaw: Math.atan2(-line.tx, -line.tz),
      scale: bannerScale,
    })),
  };
}

/** Three physical lamps tucked under the start arch's beam. */
export function rallyStartLightPlacements(circuit: RealmRacersCircuit): RallyStartLightPlacement[] {
  const place = rallyStartArchPlacement(circuit);
  const line = realmRacersTrack(circuit).pointAt(0);
  const lift = ARCH_SOURCE_HEIGHT * place.uprightScale - 0.8;
  return Array.from({ length: 3 }, (_, index) => {
    const across = ((index - 1) / 3) * place.span * 0.55;
    return {
      x: place.x + place.normalX * across,
      z: place.z + place.normalZ * across,
      lift,
      yaw: Math.atan2(-line.tx, -line.tz),
    };
  });
}

/** Pitch of the patch grid, yards: one colour per cell. */
const PATCH_PITCH = 11;
/** Flowers per patch, and how far they spread from its centre. */
const PATCH_COUNT = 9;
const PATCH_SPREAD = 3.4;
/** Clear grass a patch leaves beyond the border line before it starts. */
const FLOWER_BORDER_CLEARANCE = 1.6;

/** Bare ground a bed keeps from the shore, yards: a card is about a yard across
 *  and the sampled outline is a chord of the real curve, so a bed sown right on
 *  the line reads as flowers floating on the surf. */
const FLOWER_SHORE_CLEARANCE = 2;

/** Spacing of the reed clumps around the water's edge, yards. */
const REED_SPACING = 7;

/** Target spacing of the clumps along an authored shore, yards, and how far off
 *  the bank one may wander. Wider than a pond's rim because a shore is a hundred
 *  times longer, and a rim's density around a whole island reads as a hedge. */
const SHORE_SPACING = 11;
const SHORE_JITTER = 4;

/** Shore points per water ring, and how many rings run in to the middle. */
const BASIN_RING_STRIDE = 4;
const BASIN_RINGS = 10;

export interface RallyBasinMesh {
  /** Ring-major xz positions, `rings + 1` rings of `columns` points, plus a
   *  single middle point last for a pond (the sea walks OUTWARD and has no
   *  middle, so it emits the rings alone). Float64 on purpose: the band sits at
   *  x = 113_700, where a float32 resolves about 7mm, and near a spot where two
   *  parts of the shore compete for "nearest" that is enough to flip which one
   *  wins and step the depth. The painter narrows to float32 for the GPU, where
   *  the same 7mm is only a vertex position and invisible. */
  positions: Float64Array;
  /** Yards of water under each position: what drives the colour ramp and,
   *  through the slope, the foam band. */
  depths: Float64Array;
  index: number[];
  columns: number;
  rings: number;
}

/**
 * The ponds' water surfaces, one per pond, as concentric rings lerped from the
 * pond's own outline toward its middle.
 *
 * A triangulated outline polygon would be simpler and is not usable: every one
 * of its vertices sits ON the edge, so the per-vertex shore depth the water
 * shader reads would be zero everywhere. The whole surface would render as the
 * shallowest possible water, with the foam band covering all of it. Rings put
 * real vertices in the middle, which is where the depth has to be.
 *
 * Depth ramps in from the outline at the basin's authored slope, to its floor.
 * There is nothing else it could come from: a pond stands wherever the author
 * put it, so the road's own offset curve says nothing about how deep it is.
 */
export function rallyPondMeshes(circuit: RealmRacersCircuit): RallyBasinMesh[] {
  const basin = circuit.basin;
  if (!basin) return [];
  return realmRacersPlacedPonds(circuit).map((pond) => {
    const outline = pond.outline.map((point) => ({
      x: point.x + REALM_RACERS_ORIGIN.x,
      z: point.z + REALM_RACERS_ORIGIN.z,
    }));
    const stride = Math.min(BASIN_RING_STRIDE, Math.max(1, Math.floor(outline.length / 8)));
    return basinMeshOf(outline, stride, (_x, _z, inward) =>
      Math.min(basin.depthMax, basin.bankSlope * Math.max(0, inward)),
    );
  });
}

/**
 * Reed clumps around every pond's edge. They are what says there is water
 * behind them, and a pond with a bare rim reads as a painted puddle: the shore
 * used to be a stone rim and the reeds grew along its pieces, and with the rim
 * gone they are the only thing marking where the lawn stops.
 */
export function rallyPondReedSpots(
  circuit: RealmRacersCircuit,
): { x: number; z: number; rot: number; scale: number }[] {
  const out: { x: number; z: number; rot: number; scale: number }[] = [];
  if (!circuit.basin) return out;
  for (const [index, pond] of realmRacersPlacedPonds(circuit).entries()) {
    const points = pond.outline;
    let walked = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      walked += Math.hypot(b.x - a.x, b.z - a.z);
      if (walked < REED_SPACING) continue;
      walked = 0;
      const roll = hash2(i, index, 0x2ee6);
      out.push({
        x: a.x + REALM_RACERS_ORIGIN.x,
        z: a.z + REALM_RACERS_ORIGIN.z,
        // Along the bank, so a clump reads as an edge rather than a bristle.
        rot: Math.atan2(b.x - a.x, b.z - a.z),
        scale: 0.8 + roll * 0.5,
      });
    }
  }
  return out;
}

function basinMeshOf(
  outline: readonly { x: number; z: number }[],
  stride: number,
  depthAt: (x: number, z: number, inward: number) => number,
): RallyBasinMesh {
  const shore: { x: number; z: number }[] = [];
  for (let i = 0; i < outline.length; i += stride) shore.push(outline[i]);
  const columns = shore.length;
  let cx = 0;
  let cz = 0;
  for (const point of shore) {
    cx += point.x / columns;
    cz += point.z / columns;
  }
  const count = columns * (BASIN_RINGS + 1) + 1;
  const positions = new Float64Array(count * 2);
  const depths = new Float64Array(count);
  for (let ring = 0; ring <= BASIN_RINGS; ring++) {
    // Squared, so the rings CROWD the shore. Everything the shader varies (the
    // colour ramp to the basin floor, the surf band) happens within a few yards
    // of the waterline, and evenly spaced rings across a basin this wide put
    // the first one past all of it.
    const t = (ring / BASIN_RINGS) ** 2;
    for (let col = 0; col < columns; col++) {
      const point = shore[col];
      const x = point.x + (cx - point.x) * t;
      const z = point.z + (cz - point.z) * t;
      const v = ring * columns + col;
      positions[v * 2] = x;
      positions[v * 2 + 1] = z;
      // How far in from the shore this vertex sits, along its own ray: the one
      // thing a free-form pond can answer about its depth, and enough for the
      // shore profile too, which pins its own ring at zero.
      // The shore reader is UNHINTED on purpose: this is a one-time build, and
      // a hinted projection answers a sagitta apart from a full scan, which
      // would put the drawn water a few millimetres off the depth the sim reads
      // at the same point.
      depths[v] = depthAt(x, z, t * Math.hypot(cx - point.x, cz - point.z));
    }
  }
  const middle = count - 1;
  positions[middle * 2] = cx;
  positions[middle * 2 + 1] = cz;
  depths[middle] = depthAt(cx, cz, Number.POSITIVE_INFINITY);

  const index: number[] = [];
  for (let ring = 0; ring < BASIN_RINGS; ring++) {
    for (let col = 0; col < columns; col++) {
      const next = (col + 1) % columns;
      const a = ring * columns + col;
      const b = ring * columns + next;
      const c = (ring + 1) * columns + col;
      const d = (ring + 1) * columns + next;
      index.push(a, c, b, b, c, d);
    }
  }
  for (let col = 0; col < columns; col++) {
    const next = (col + 1) % columns;
    index.push(BASIN_RINGS * columns + col, middle, BASIN_RINGS * columns + next);
  }
  return { positions, depths, index, columns, rings: BASIN_RINGS };
}

/**
 * Twice the signed area of a closed ring, in whatever plane it is given.
 *
 * The sign is the only thing anyone here wants: two surfaces built off the
 * ground outline take their triangle orientation from the order of its points,
 * and an operator's hand decides that order. One helper rather than a shoelace
 * per site, because the two sites disagree about the plane (the lawn contour
 * lives in the shape's own `(x, -z)`, the sea's columns in `(x, z)`) and reading
 * two hand-written loops to notice that is how one of them ends up culled.
 */
export function rallyRingSignedArea(ring: readonly { x: number; z: number }[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum;
}

/**
 * The lawn's outline as a flat contour, region-local, wound so the surface built
 * from it faces UP.
 *
 * A DECISION rather than a drawing, which is why it is here and not in the
 * painter: an outline is drawn in whichever direction the operator's hand went,
 * where the centerline has an authored winding the readout enforces, so the
 * ORDER of these points is not something the rest of the build can assume.
 *
 * What depends on it is the SEA, whose ring index is hand built from the same
 * outline and does face down when the columns run the other way (proven by
 * building both windings). The lawn itself would survive either: three's own
 * `ShapeGeometry` normalizes a contour before it triangulates, which is worth
 * writing down so the next reader does not take this helper for the thing
 * holding the lawn up. It is here so the two surfaces are cut from one
 * orientation rather than from two conventions that happen to agree.
 *
 * The `y` of each point is the world `-z`, which is where a ShapeGeometry
 * rotated -PI/2 about X puts it. The derived rectangle passes through unchanged
 * from the contour the builder used before an outline could be authored.
 */
export function rallyLawnContour(circuit: RealmRacersCircuit): { x: number; y: number }[] {
  const outline = realmRacersGroundShape(circuit).outline;
  const contour = outline.map((point) => ({ x: point.x, y: -point.z }));
  // Read in the contour's OWN plane, where `y` plays the part `z` plays on the
  // plan, which is exactly the flip that makes this necessary.
  const area = rallyRingSignedArea(contour.map((point) => ({ x: point.x, z: point.y })));
  return area < 0 ? contour.reverse() : contour;
}

/**
 * The bank profile the SEA is shaded with.
 *
 * A circuit's own `basin` whenever it has one, so an island's shore and its
 * ponds are the same water read the same way. A circuit may author a ground
 * shape and no pond at all, though (the record's basin rule is an iff with the
 * ponds), and then there is no authored profile to read: the fallback is the
 * garden circuit's own, which is the profile every pond in the game is already
 * shaded with rather than a number invented here.
 */
export const REALM_RACERS_SEA_BASIN: RealmRacersBasin = {
  waterY: -0.55,
  bankSlope: 0.8,
  depthMax: 6,
  wadeYards: 4,
};

export function rallySeaBasin(circuit: RealmRacersCircuit): RealmRacersBasin {
  return circuit.basin ?? REALM_RACERS_SEA_BASIN;
}

/** Where the sea stops: the region, plus the same overshoot the derived ground
 *  rectangle uses, so the water reaches exactly as far as the lawn used to. */
function seaHalfExtents(circuit: RealmRacersCircuit): { halfX: number; halfZ: number } {
  return {
    halfX: circuit.regionHalfX + REALM_RACERS_LAWN_OVERSHOOT,
    halfZ: circuit.regionHalfZ + REALM_RACERS_LAWN_OVERSHOOT,
  };
}

/**
 * The sea around an authored island, as rings walking OUTWARD from the shore to
 * the edge of the region.
 *
 * The mirror of `rallyPondMeshes`, and rings for the same reason: the water
 * shader reads a per-vertex shore depth, so a plain rectangle with the island
 * punched out of it would carry real depth only at its four far corners and
 * would ramp from the shore to them across a hundred and sixty yards, smearing
 * the whole shallow band and its foam over the horizon. Rings put vertices where
 * the depth actually changes, which is the first few yards off the beach.
 *
 * Null on a circuit that authored no ground shape: its ground is the rectangle
 * the region has always been, so there is no shore for water to lap at and
 * nothing to draw.
 */
export function rallySeaMesh(circuit: RealmRacersCircuit): RallyBasinMesh | null {
  const ground = realmRacersGroundShape(circuit);
  if (!ground.authored) return null;
  const basin = rallySeaBasin(circuit);
  const { halfX, halfZ } = seaHalfExtents(circuit);
  const stride = Math.min(BASIN_RING_STRIDE, Math.max(1, Math.floor(ground.outline.length / 8)));
  const shore: { x: number; z: number }[] = [];
  for (let i = 0; i < ground.outline.length; i += stride) shore.push(ground.outline[i]);
  const columns = shore.length;
  if (columns < 3) return null;
  // The columns are walked in a KNOWN direction, because the triangle winding
  // below follows them: an outline drawn the other way round the plan would
  // build the whole sea face-down and it would be culled away in silence, which
  // is the same defect the mirrored road ribbons shipped with once. The lawn's
  // own contour is normalized the same way, off the same helper.
  if (rallyRingSignedArea(shore) < 0) shore.reverse();
  let cx = 0;
  let cz = 0;
  for (const point of shore) {
    cx += point.x / columns;
    cz += point.z / columns;
  }
  // Where the ray from the middle of the island through this shore point leaves
  // the region: the slab intersection, held at the shore itself so an outline
  // drawn wider than its own region collapses the water rather than folding it
  // back inside the island.
  const outward = (point: { x: number; z: number }): { x: number; z: number; reach: number } => {
    const dx = point.x - cx;
    const dz = point.z - cz;
    // A shore point sitting exactly on the middle has no outward direction, and
    // the slab arithmetic below would answer `0 * Infinity`, which is NaN in
    // every position of the column and a NaN bounding sphere for the sheet.
    if (dx === 0 && dz === 0) return { x: point.x, z: point.z, reach: 0 };
    const tx = dx > 0 ? (halfX - cx) / dx : dx < 0 ? (-halfX - cx) / dx : Number.POSITIVE_INFINITY;
    const tz = dz > 0 ? (halfZ - cz) / dz : dz < 0 ? (-halfZ - cz) / dz : Number.POSITIVE_INFINITY;
    const t = Math.max(1, Math.min(tx, tz));
    return { x: cx + dx * t, z: cz + dz * t, reach: Math.hypot(dx, dz) * (t - 1) };
  };
  const count = columns * (BASIN_RINGS + 1);
  const positions = new Float64Array(count * 2);
  const depths = new Float64Array(count);
  for (let col = 0; col < columns; col++) {
    const point = shore[col];
    const far = outward(point);
    for (let ring = 0; ring <= BASIN_RINGS; ring++) {
      // Squared, so the rings CROWD the shore, exactly as a pond's do: every
      // thing the shader varies happens within a few yards of the waterline.
      const t = (ring / BASIN_RINGS) ** 2;
      const v = ring * columns + col;
      positions[v * 2] = point.x + (far.x - point.x) * t + REALM_RACERS_ORIGIN.x;
      positions[v * 2 + 1] = point.z + (far.z - point.z) * t + REALM_RACERS_ORIGIN.z;
      depths[v] = Math.min(basin.depthMax, basin.bankSlope * t * far.reach);
    }
  }
  const index: number[] = [];
  for (let ring = 0; ring < BASIN_RINGS; ring++) {
    for (let col = 0; col < columns; col++) {
      const next = (col + 1) % columns;
      const a = ring * columns + col;
      const b = ring * columns + next;
      const c = (ring + 1) * columns + col;
      const d = (ring + 1) * columns + next;
      // Wound the other way round from a pond's, because the rings run outward
      // rather than inward: the same order would face this surface down, and a
      // water sheet wound the wrong way is culled exactly as silently as a kerb.
      index.push(a, b, c, b, d, c);
    }
  }
  return { positions, depths, index, columns, rings: BASIN_RINGS };
}

/**
 * The shore's own dressing: clumps along the authored outline.
 *
 * SCATTERED rather than tiled, and that is the whole difference between this and
 * a fence: a straight module cannot follow a curve, which is exactly why a
 * barrier run is angular and the land's own edge is not. So the pieces are
 * jittered off the outline by a hash rather than laid end to end, and a gap
 * between two of them reads as a beach rather than as a missing panel.
 */
export function rallyShoreSpots(
  circuit: RealmRacersCircuit,
): { x: number; z: number; rot: number; scale: number }[] {
  const ground = realmRacersGroundShape(circuit);
  const out: { x: number; z: number; rot: number; scale: number }[] = [];
  if (!ground.authored) return out;
  const points = ground.outline;
  // Which side of an edge the WATER is on. For a ring of positive signed area
  // the interior lies on the LEFT normal, which is the one taken below, so the
  // water is the other way; a ring drawn the other way round flips both.
  const water = rallyRingSignedArea(points) >= 0 ? -1 : 1;
  let walked = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    if (length <= 0) continue;
    walked += length;
    // The remainder is CARRIED rather than dropped: resetting it laid one clump
    // on a segment however long it was, so an authored span longer than the
    // spacing thinned the shore by however much longer it was.
    while (walked >= SHORE_SPACING) {
      walked -= SHORE_SPACING;
      const along = Math.max(0, Math.min(1, (length - walked) / length));
      // Out into the WATER, never inland: a clump is anchored at the water's own
      // height, so one jittered onto the lawn stands sunk in it. A reed bed grows
      // at the waterline and out into the shallows.
      const across = hash2(i, Math.round(walked), 0x51a3) * SHORE_JITTER * water;
      const nx = -dz / length;
      const nz = dx / length;
      out.push({
        x: a.x + dx * along + nx * across + REALM_RACERS_ORIGIN.x,
        z: a.z + dz * along + nz * across + REALM_RACERS_ORIGIN.z,
        rot: Math.atan2(dx, dz),
        scale: 0.8 + hash2(i, 2, 0x51a3) * 0.6,
      });
    }
  }
  return out;
}

/**
 * The garden's flower beds, sown in single-colour patches. Grass tufts used to
 * be scattered here too; they are not part of the Evergarden's own language and
 * read as clutter, so the lawn carries flowers and nothing else.
 *
 * They grow ONLY in the outer garden, past the border line the border flowers
 * mark. The verge is the racing surface's own run-off and the apron is the
 * whole inner half of it, so a patch in either is a flowerbed sown where racers
 * drive; the previous pass only kept them off the road itself, which left
 * strays over both.
 *
 * Jittered off a fixed grid rather than sampled at random, so the density is
 * even, the result is deterministic, and `density` (a cosmetic tier knob) only
 * ever thins the SAME patches rather than reshuffling them.
 */
export function rallyFlowerSpots(circuit: RealmRacersCircuit, density = 1): RallyFlowerSpot[] {
  const track = realmRacersTrack(circuit);
  const out: RallyFlowerSpot[] = [];
  const palette = realmRacersTheme(circuit).flowers.colours.length;
  const halfX = circuit.perimeter.halfX;
  const halfZ = circuit.perimeter.halfZ;
  const cols = Math.floor((halfX * 2) / PATCH_PITCH);
  const rows = Math.floor((halfZ * 2) / PATCH_PITCH);
  const keep = Math.max(0, Math.min(1, density));
  let hint: number | undefined;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const roll = hash2(col, row, 0x7a5f);
      if (roll > keep) continue;
      const jitter = hash2(row, col, 0x31c7);
      const colour = Math.floor(hash2(col, row, 0xb105) * palette);
      const cx = REALM_RACERS_ORIGIN.x - halfX + (col + 0.2 + roll * 0.6) * PATCH_PITCH;
      const cz = REALM_RACERS_ORIGIN.z - halfZ + (row + 0.2 + jitter * 0.6) * PATCH_PITCH;
      for (let k = 0; k < PATCH_COUNT; k++) {
        const a = hash2(k, col * 131 + row, 0x2f1d);
        const b = hash2(row * 131 + col, k, 0x91ab);
        const angle = a * Math.PI * 2;
        const radius = Math.sqrt(b) * PATCH_SPREAD;
        const x = cx + Math.cos(angle) * radius;
        const z = cz + Math.sin(angle) * radius;
        const projection = track.project(x, z, hint);
        hint = projection.index;
        // The infield is apron all the way to the water, so nothing is sown on
        // that side at all; outward, the outer garden starts past the border.
        if (projection.lateral > 0) continue;
        // The land, by the piece rather than by the patch: a bed straddling a
        // shore would otherwise put half its cards in the sea. This grid covers
        // the perimeter BOX, and an island is not a box.
        //
        // Tested AFTER the projection, cheap as an earlier bail would be, and
        // for the reason the seeded scatter keeps the same order: the walk
        // carries a projection HINT from cell to cell, so a candidate that
        // returned early would leave the next one hinted from somewhere else,
        // and the clip would change which beds are SOWN rather than only which
        // are dropped.
        if (
          !realmRacersOnGround(
            circuit,
            x - REALM_RACERS_ORIGIN.x,
            z - REALM_RACERS_ORIGIN.z,
            FLOWER_SHORE_CLEARANCE,
          )
        ) {
          continue;
        }
        if (
          -projection.lateral <
          rallyGardenEdgeOffsetAt(circuit, projection.s) + FLOWER_BORDER_CLEARANCE
        ) {
          continue;
        }
        out.push({
          x,
          z,
          rot: a * Math.PI * 2,
          scale: 0.75 + b * 0.5,
          colour: Math.min(colour, palette - 1),
        });
      }
    }
  }
  return out;
}

/**
 * The authored barriers, cut into modules: what the renderer instances.
 *
 * The generalization of the perimeter walker this replaced. That one took four
 * derived corners and one kit baked into the theme, and it was the last derived
 * thing standing on a circuit: one kit for a rectangle's whole length, which is
 * what made every circuit read as a box. This one takes the points an operator
 * drew and the kit they chose, and the old behaviour is the case where those
 * points happen to be a rectangle.
 *
 * The RUNS come from the sim (`realm_racers_fences.ts`), so a module stands on
 * the line a machine collides with. What is added here is the only part that is
 * about MODELS rather than geometry:
 *
 *  - `panelYards` is one module's run AT THE SCALE IT IS DRAWN AT, which is what
 *    decides how many pieces a run is cut into. A module measured at scale 1
 *    and drawn at another leaves gaps between panels. The count is ROUNDED and
 *    the step re-derived from it, so a run of any length comes out even rather
 *    than ending on a fraction of a module.
 *  - `lengthAxis` is which of the module's own axes that run lies along, and
 *    the world's kits disagree: the garden's ironwork runs along local +x, the
 *    coastal stone along local +z (`props.ts` says so where it builds the town
 *    fences, and builds each kind with its own yaw for exactly this reason).
 *    Assuming +x for both is what stood the Galecrest wall's every module
 *    broadside to the wall it was supposed to be.
 *
 * A kit whose `corner` is `'none'` emits no corner pieces at all: its joint is
 * covered by the runs themselves, which already overlap there.
 */
export function rallyFencePieces(circuit: RealmRacersCircuit): RallyFenceDrawing[] {
  const out: RallyFenceDrawing[] = [];
  for (const fence of realmRacersFencePlacements(circuit).fences) {
    const visual = realmRacersBarrierVisual(fence.kit);
    // Unknown kits are the readout's business (`unknown_barrier_kit`); a draft
    // half way through being typed still has to draw the rest of itself.
    if (!visual) continue;
    // A three.js yaw maps local +x to (cos, -sin) and local +z to (sin, cos),
    // so a kit whose module runs along +z needs a quarter turn on top of the
    // run's own yaw to lay the same module along the same line.
    const turn = visual.lengthAxis === 'z' ? Math.PI / 2 : 0;
    const scale = visual.scale * fence.scale;
    const panelYards = visual.panelYards * fence.scale;
    // WHERE THE MODULES ARE LAID depends on whether the kit has a corner piece,
    // and the two answers are opposite because the joint is closed two different
    // ways:
    //
    //  - with NO corner piece, the runs themselves close it, so they are tiled
    //    along the DRAWN span, which reaches a half thickness past every joint.
    //    They overlap there, and that overlap is the seal;
    //  - with a corner piece, the PIECE closes it, so the runs are tiled inside
    //    the joint by half the piece and stop short. Tiled past each other
    //    instead, the two arms cross straight through the pillar standing
    //    between them, which is what the first seat test of this rework showed.
    const inset = visual.corner === 'none' ? 0 : (visual.corner.yards * fence.scale) / 2;
    const panels: RallyBarrierPiece[] = [];
    for (const run of fence.runs) {
      const fromX = visual.corner === 'none' ? run.dax : run.ax;
      const fromZ = visual.corner === 'none' ? run.daz : run.az;
      const span = (visual.corner === 'none' ? run.drawnLength : run.length) - inset * 2;
      const ux = (run.dbx - run.dax) / run.drawnLength;
      const uz = (run.dbz - run.daz) / run.drawnLength;
      // A run shorter than the two corner pieces meeting on it has no room for a
      // panel at all, and the pieces alone are the barrier there.
      if (!(span > 0)) continue;
      const count = Math.max(1, Math.round(span / panelYards));
      const step = span / count;
      for (let i = 0; i < count; i++) {
        const along = inset + step * (i + 0.5);
        panels.push({
          x: fromX + ux * along + REALM_RACERS_ORIGIN.x,
          z: fromZ + uz * along + REALM_RACERS_ORIGIN.z,
          yaw: run.rot + turn,
          corner: false,
        });
      }
    }
    const corners: RallyBarrierPiece[] =
      visual.corner === 'none'
        ? []
        : fence.corners.map((corner) => ({
            x: corner.x + REALM_RACERS_ORIGIN.x,
            z: corner.z + REALM_RACERS_ORIGIN.z,
            yaw: corner.yaw + turn,
            corner: true,
          }));
    out.push({ kit: fence.kit, scale, panels, corners });
  }
  return out;
}
