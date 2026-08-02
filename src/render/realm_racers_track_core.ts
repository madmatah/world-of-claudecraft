// Placement decisions for the Realm Racers circuit: which stretches of road
// get kerbs, where the start arch and its banners stand, where the garden is
// sown, and where the perimeter fence runs. Everything here is geometry the
// painter then turns into meshes, so it stays Three-free, DOM-free and
// deterministic and a plain Vitest can assert the load-bearing properties.
//
// There are two of those, and both are about a racer who has left the road.
// Everything inside the perimeter is drivable, so nothing solid may stand
// there: the dressing lives outside the wall and the infield landmark out in
// the water. And nothing is SOWN on a band racers use either, so the beds start
// past the border line rather than merely off the tarmac.
//
// All positions are WORLD coordinates, straight off the shared sim spline, so
// the drawn circuit and the driven circuit come from one source.

import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import {
  REALM_RACERS_BORDER_OFFSET,
  REALM_RACERS_BORDER_SPACING,
  REALM_RACERS_ORIGIN,
} from '../sim/realm_racers_layout';
import {
  rallyBasinDepthAt,
  rallyBasinEdgeOffsetAt,
  rallyGardenEdgeOffsetAt,
  realmRacersBasinOutline,
  realmRacersTrack,
} from '../sim/realm_racers_spline';
import { hash2 } from '../sim/rng';
import { TICK_RATE } from '../sim/types';
import type { RealmRacersPhase } from '../world_api/realm_racers';

/**
 * A contiguous run of centerline samples that gets a kerb. `from` is a real
 * sample index; `to` is exclusive and may exceed the sample count, meaning the
 * run crosses the start line, so the painter walks it modulo the count.
 */
export interface RallyKerbRun {
  from: number;
  to: number;
}

export type RallyDressingKind = 'bedRound' | 'bedSquareA' | 'bedSquareB' | 'tree' | 'statue';

export interface RallyDressingSpot {
  kind: RallyDressingKind;
  x: number;
  z: number;
  rot: number;
  /** Footprint radius, yards: what keeps a piece clear of the perimeter. */
  radius: number;
}

export interface RallyPerimeterPiece {
  x: number;
  z: number;
  yaw: number;
  pillar: boolean;
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
  /** Index into RALLY_FLOWER_COLOURS. Constant across a patch, which is what
   *  makes the garden read as sown beds rather than confetti. */
  colour: number;
}

export interface RallyFountainSpot {
  x: number;
  z: number;
  /** Footprint radius, yards, at the scale the painter draws it. */
  radius: number;
  scale: number;
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

/** Arc spacing between dressing pieces, yards. */
const DRESSING_SPACING = 16;
/**
 * Clear grass between the perimeter wall and the dressing ring, yards.
 *
 * It is sized by the CAMERA, not by taste. A machine pinned against the wall
 * with its nose to the infield puts the chase camera outside the wall, and the
 * boom reaches `camDist` (clamped to 22 in src/game/input.ts) times the rally
 * profile's 1.16 distance scale, so 25.5 yards. At the old 2.5 the camera sat
 * inside a tree canopy every time. The ring's own `outward` adds each piece's
 * radius on top of this, so 30 is the CLEAR grass and the nearest trunk stands
 * further out still.
 */
const DRESSING_MARGIN = 30;
/** Keep the authored opening orbit out of the south dressing ring. The tree
 * previously generated here sat directly on the camera path for both grid slots. */
const START_PANORAMA_TREE_CLEARANCE = {
  x: REALM_RACERS_ORIGIN.x - 16,
  z: REALM_RACERS_ORIGIN.z - 87,
  radius: 8,
};

const DRESSING_KINDS: readonly { kind: RallyDressingKind; radius: number }[] = [
  { kind: 'bedSquareA', radius: 4.5 },
  { kind: 'tree', radius: 2.6 },
  { kind: 'bedRound', radius: 3.1 },
  { kind: 'bedSquareB', radius: 4.5 },
  { kind: 'statue', radius: 1.4 },
  { kind: 'tree', radius: 2.6 },
];

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

function insideRegion(circuit: RealmRacersCircuit, x: number, z: number, pad: number): boolean {
  return (
    Math.abs(x - REALM_RACERS_ORIGIN.x) + pad <= circuit.regionHalfX &&
    Math.abs(z - REALM_RACERS_ORIGIN.z) + pad <= circuit.regionHalfZ
  );
}

/**
 * The dressing ring, and the rule that decides where it may stand: OUTSIDE the
 * perimeter wall. Everything inside the perimeter is drivable now, so a bed or
 * a statue in there would be an obstacle a racer hits without being told, or
 * worse, drives through. The garden a racer can reach carries only the lawn.
 */
export function rallyDressingSpots(circuit: RealmRacersCircuit): RallyDressingSpot[] {
  const out: RallyDressingSpot[] = [];
  const halfX = circuit.perimeter.halfX + circuit.perimeter.halfThickness;
  const halfZ = circuit.perimeter.halfZ + circuit.perimeter.halfThickness;
  const ring = 2 * (halfX + halfZ) * 2;
  const steps = Math.floor(ring / DRESSING_SPACING);
  for (let i = 0; i < steps; i++) {
    const spec = DRESSING_KINDS[i % DRESSING_KINDS.length];
    const roll = hash2(i, spec.radius, 0x9a11e);
    // Walk the perimeter rectangle, then step out along the face's own NORMAL
    // by the piece's footprint plus a jittered margin, so the ring never reads
    // as a fence line and every piece really is `DRESSING_MARGIN` clear.
    const along = ((i + 0.5) / steps) * ring;
    const [ex, ez, nx, nz] = perimeterPoint(along, halfX, halfZ);
    const outward = DRESSING_MARGIN + spec.radius + roll * 6;
    const x = REALM_RACERS_ORIGIN.x + ex + nx * outward;
    const z = REALM_RACERS_ORIGIN.z + ez + nz * outward;
    if (
      spec.kind === 'tree' &&
      Math.hypot(x - START_PANORAMA_TREE_CLEARANCE.x, z - START_PANORAMA_TREE_CLEARANCE.z) <
        START_PANORAMA_TREE_CLEARANCE.radius
    ) {
      continue;
    }
    out.push({
      kind: spec.kind,
      x,
      z,
      rot: roll * Math.PI * 2,
      radius: spec.radius,
    });
  }
  return out.filter((spot) => insideRegion(circuit, spot.x, spot.z, spot.radius));
}

/**
 * A point at `along` yards around the perimeter rectangle, region-local, plus
 * the OUTWARD NORMAL of the face it sits on.
 *
 * The normal is what the caller steps along. Stepping radially from the centre
 * instead looks equivalent and is not: on a long face the radial direction is
 * oblique to the wall, so a piece placed 30 yards "out" ends up barely 18 clear
 * of it, which is how the chase camera kept finding itself inside a tree.
 */
function perimeterPoint(
  along: number,
  halfX: number,
  halfZ: number,
): [number, number, number, number] {
  const w = halfX * 2;
  const h = halfZ * 2;
  let d = along % (2 * (w + h));
  if (d < w) return [-halfX + d, -halfZ, 0, -1];
  d -= w;
  if (d < h) return [halfX, -halfZ + d, 1, 0];
  d -= h;
  if (d < w) return [halfX - d, halfZ, 0, 1];
  return [-halfX, halfZ - (d - w), -1, 0];
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
  const steps = Math.round(track.length / REALM_RACERS_BORDER_SPACING);
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * track.length;
    const point = track.pointAt(s);
    // One colour per RUN of the border rather than per flower, so the edge
    // reads as planted stretches the way an Evergarden walk does.
    const colour =
      Math.floor(
        hash2(Math.floor(i / BORDER_RUN_LENGTH), 0, 0xb105) * RALLY_FLOWER_COLOURS.length,
      ) % RALLY_FLOWER_COLOURS.length;
    for (const side of [1, -1]) {
      const roll = hash2(i, side, 0x5eed);
      // Sown on the VERGE/GARDEN boundary, not at the road edge: at the edge
      // they overhang the racing surface, and the line reads better marking
      // where the gentle band ends than where the road does.
      const offset =
        rallyGardenEdgeOffsetAt(circuit, point.s) + REALM_RACERS_BORDER_OFFSET + roll * 1.1;
      out.push({
        x: point.x - point.tz * offset * side,
        z: point.z + point.tx * offset * side,
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

/**
 * The garden's flower colours, applied per INSTANCE over one near-white card.
 * That is how the Evergarden does its beds: a coloured texture would multiply
 * against the tint and muddy every hue, so the card stays pale and the colour
 * comes from here.
 */
export const RALLY_FLOWER_COLOURS: readonly number[] = [
  0xf6f2ea, // white
  0xf4b8cf, // pink
  0xf6dd7a, // butter
  0xc9b4e8, // lilac
  0xf3a973, // apricot
];

/** Pitch of the patch grid, yards: one colour per cell. */
const PATCH_PITCH = 11;
/** Flowers per patch, and how far they spread from its centre. */
const PATCH_COUNT = 9;
const PATCH_SPREAD = 3.4;
/** Clear grass a patch leaves beyond the border line before it starts. */
const FLOWER_BORDER_CLEARANCE = 1.6;

/** Spacing of the reed clumps around the water's edge, yards. */
const REED_SPACING = 7;

/** Shore points per water ring, and how many rings run in to the middle. */
const BASIN_RING_STRIDE = 4;
const BASIN_RINGS = 10;

export interface RallyBasinMesh {
  /** Ring-major xz positions, `rings + 1` rings of `columns` points, then the
   *  single middle point last. Float64 on purpose: the band sits at
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
 * The basin's water surface, as concentric rings lerped from the shore toward
 * the middle.
 *
 * A triangulated outline polygon would be simpler and is not usable: every one
 * of its vertices sits ON the shore, so the per-vertex shore depth the water
 * shader reads would be zero everywhere. The whole surface would render as the
 * shallowest possible water, with the foam band covering all of it. Rings put
 * real vertices in the middle, which is where the depth has to be.
 *
 * Depth comes from the sim's own bank profile, so the water a racer sees is
 * exactly the water the sim decides they are wading in.
 */
export function rallyBasinMesh(circuit: RealmRacersCircuit): RallyBasinMesh {
  const outline = realmRacersBasinOutline(circuit);
  const shore: { x: number; z: number }[] = [];
  for (let i = 0; i < outline.length; i += BASIN_RING_STRIDE) shore.push(outline[i]);
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
      // The shore ring reads exactly 0 by construction, so pin it rather than
      // letting the projection's polyline sagitta hand back a hair either way.
      // Unhinted on purpose: this is a one-time build, and a hinted projection
      // answers a sagitta apart from a full scan, which would put the drawn
      // water a few millimetres off the depth the sim reads at the same point.
      depths[v] = ring === 0 ? 0 : Math.max(0, rallyBasinDepthAt(circuit, x, z));
    }
  }
  const middle = count - 1;
  positions[middle * 2] = cx;
  positions[middle * 2 + 1] = cz;
  depths[middle] = Math.max(0, rallyBasinDepthAt(circuit, cx, cz));

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
 * Reeds around the water's edge. The shore used to be a stone rim and the reeds
 * grew along its pieces; with the rim gone they are the only thing marking
 * where the lawn stops, so they follow the shore itself.
 */
export function rallyReedSpots(
  circuit: RealmRacersCircuit,
): { x: number; z: number; rot: number; scale: number }[] {
  const track = realmRacersTrack(circuit);
  const out: { x: number; z: number; rot: number; scale: number }[] = [];
  const steps = Math.round(track.length / REED_SPACING);
  for (let i = 0; i < steps; i++) {
    const s = (i / steps) * track.length;
    const point = track.pointAt(s);
    const offset = rallyBasinEdgeOffsetAt(circuit, s);
    const roll = hash2(i, 0, 0x2ee6);
    out.push({
      x: point.x - point.tz * offset,
      z: point.z + point.tx * offset,
      // Along the shore, so a clump reads as a bank rather than a bristle.
      rot: Math.atan2(point.tx, point.tz),
      scale: 0.8 + roll * 0.5,
    });
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
      const colour = Math.floor(hash2(col, row, 0xb105) * RALLY_FLOWER_COLOURS.length);
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
          colour: Math.min(colour, RALLY_FLOWER_COLOURS.length - 1),
        });
      }
    }
  }
  return out;
}

/** Where the infield landmark sits, relative to the region origin. */
const FOUNTAIN_SCALE = 2.2;
/** Authored basin radius of the tiered fountain at scale 1. */
const FOUNTAIN_SOURCE_RADIUS = 3.3;

/**
 * The infield's one landmark: a tiered fountain on its own island, out in the
 * middle of the water where nothing can reach it. It used to be flanked by four
 * statues; those stood on the APRON, which is drivable, so racers drove through
 * them. The infield now carries the lake, the island, and nothing else.
 */
export function rallyFountainSpot(circuit: RealmRacersCircuit): RallyFountainSpot | null {
  const at = circuit.landmark;
  if (!at) return null;
  return {
    x: REALM_RACERS_ORIGIN.x + at.x,
    z: REALM_RACERS_ORIGIN.z + at.z,
    radius: FOUNTAIN_SOURCE_RADIUS * FOUNTAIN_SCALE,
    scale: FOUNTAIN_SCALE,
  };
}

/**
 * The wrought-iron perimeter: panels around the garden wall with a pillar at
 * every corner. This is the circuit's OUTER bound, so what is drawn here is
 * exactly what `realm_racers_colliders.ts` stops a racer against.
 */
export function rallyPerimeterPieces(
  circuit: RealmRacersCircuit,
  panel: number,
): RallyPerimeterPiece[] {
  const out: RallyPerimeterPiece[] = [];
  const halfX = circuit.perimeter.halfX;
  const halfZ = circuit.perimeter.halfZ;
  const corners: [number, number][] = [
    [-halfX, -halfZ],
    [halfX, -halfZ],
    [halfX, halfZ],
    [-halfX, halfZ],
  ];
  for (let c = 0; c < corners.length; c++) {
    const a = corners[c];
    const b = corners[(c + 1) % corners.length];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const run = Math.hypot(dx, dz);
    const ux = dx / run;
    const uz = dz / run;
    const yaw = Math.atan2(-uz, ux);
    const panels = Math.max(1, Math.round(run / panel));
    const step = run / panels;
    out.push({
      x: a[0] + REALM_RACERS_ORIGIN.x,
      z: a[1] + REALM_RACERS_ORIGIN.z,
      yaw,
      pillar: true,
    });
    for (let i = 0; i < panels; i++) {
      const along = step * (i + 0.5);
      out.push({
        x: a[0] + ux * along + REALM_RACERS_ORIGIN.x,
        z: a[1] + uz * along + REALM_RACERS_ORIGIN.z,
        yaw,
        pillar: false,
      });
    }
  }
  return out;
}
