// Placing the dressing: which frame a click authors a prop in, what a pointer
// is over, what a transform does to a record entry, and how a dragged rectangle
// or ellipse becomes a scatter or a pond.
//
// It authors, it never resolves. Where a piece ENDS UP is
// `src/sim/realm_racers_props_resolve.ts` and nothing else, including here: the
// page commits the record and reads the placements back off the one resolver,
// so the tool cannot draw a fountain anywhere but where the game puts it. That
// is the whole defect class the resolver exists for, and a second placement
// formula inside the editor would reopen it.
//
// Pure core: DOM-free, deterministic, no clock, no rng. Every function returns a
// NEW record entry; nothing here mutates its input, so the page's undo stack is
// just the previous value.

import type {
  RallyPond,
  RallyProp,
  RallyPropAt,
  RallyScatter,
  RealmRacersCircuit,
} from '../../sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../../sim/geometry2d';
import type { RallyPoint } from '../../sim/realm_racers_layout';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import type { RallyPlacedPond, RallyPlacedProp } from '../../sim/realm_racers_props_resolve';
import { rallyFootprintRadius } from '../../sim/realm_racers_props_resolve';
import {
  REALM_RACERS_PROJECTION_ENVELOPE,
  REALM_RACERS_PROJECTION_WINDOW,
  realmRacersTrack,
} from '../../sim/realm_racers_spline';
import {
  PLACEMENT_SCALE_MAX,
  PLACEMENT_SCALE_MIN,
  rotateStep,
  scaleStep,
} from '../placement_transform_core';

/** Which of the record's two placement frames a prop is authored in. */
export type PropFrame = 'track' | 'absolute';

/**
 * How far off the centerline a click still authors TRACK-SPACE: the spline's
 * own projection envelope, and not a number of this tool's own.
 *
 * The frames are a design choice (trackside furniture follows the road when the
 * centerline moves, an infield landmark stays where it was put), but WHERE they
 * change over is not: a track-space placement is a lap fraction plus an offset,
 * and both come out of a projection the sim only trusts inside this envelope.
 * Past it the nearest stretch is genuinely ambiguous, which on the Express
 * Tour's eleven yard corridor means a piece dragged across the strip comes back
 * anchored to the facing stretch. So the tool stops authoring track-space
 * exactly where the projection stops being an answer.
 */
export const PROP_TRACK_SPACE_BAND = REALM_RACERS_PROJECTION_ENVELOPE;

/** Smallest pond radius the tool will author, yards: under this it is a puddle
 *  nothing reads as water and the shore ring degenerates. */
export const POND_MIN_RADIUS = 2;

/** Yards between the pond's own outline and its rotate handle, so the handle is
 *  never sitting on top of the radius handle it shares an axis with. */
export const POND_ROTATE_HANDLE_GAP = 4;

/** What a pointer is over, or what the inspector is editing. */
export type DressingSelection = {
  kind: 'prop' | 'scatter' | 'pond';
  index: number;
};

/** The frame a prop is authored in. */
export function propFrameOf(prop: RallyProp): PropFrame {
  return 's' in prop.at ? 'track' : 'absolute';
}

/**
 * A placement, plus the projection index that produced it.
 *
 * The index is the caller's DRAG HINT and the reason this returns a pair. Two
 * stretches of a circuit can run eleven yards apart facing opposite ways, and
 * an unhinted projection of a point in that strip picks whichever stretch the
 * search reached first: dragging a bench across the corridor would teleport it
 * onto the far stretch at a mirrored offset. Feeding the prop's own previous
 * index back in keeps the drag on the stretch it started on.
 */
export interface AuthoredPlacement {
  at: RallyPropAt;
  hint: number;
}

/**
 * Where a click authors a piece: track-space near the road, circuit-local out
 * in the open, or whichever the caller demands.
 *
 * `x`/`z` are CIRCUIT-LOCAL, the frame the canvas already works in and the one
 * `controlPoints` are authored in. The projection needs world coordinates, so
 * the origin goes on for the call and comes straight back off.
 */
export function authorPlacement(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  frame: PropFrame | 'auto' = 'auto',
  hint?: number,
): AuthoredPlacement {
  const track = realmRacersTrack(circuit);
  const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z, hint);
  const trackside =
    Math.abs(projection.lateral) <= PROP_TRACK_SPACE_BAND &&
    stayedNear(projection.index, hint, track.samples.length);
  const useTrack = frame === 'auto' ? trackside : frame === 'track';
  return {
    at: useTrack ? { s: projection.s / track.length, offset: projection.lateral } : { x, z },
    hint: projection.index,
  };
}

/**
 * Whether a hinted projection came back from the LOCAL window or from the
 * whole-lap fallback.
 *
 * A hinted `project` searches a window around the hint and quietly falls back to
 * scanning the whole lap whenever that window cannot vouch for its own answer.
 * The fallback is right for a racer, who really is somewhere else; it is wrong
 * for a DRAG, because the piece being dragged did not leave its stretch, the
 * pointer merely wandered into ground two stretches share. An index further from
 * the hint than the window reaches is the fallback, and the tool stops
 * authoring track-space rather than anchoring the piece to a stretch nobody
 * pointed at. Unhinted (a fresh click) there is nothing to have wandered from.
 */
function stayedNear(index: number, hint: number | undefined, count: number): boolean {
  if (hint === undefined || !Number.isFinite(hint)) return true;
  const gap = Math.abs(index - Math.round(hint));
  return Math.min(gap, count - gap) <= REALM_RACERS_PROJECTION_WINDOW;
}

/** The projection index a track-space prop sits at, for a drag to start from. */
export function propProjectionHint(
  circuit: RealmRacersCircuit,
  prop: RallyProp,
): number | undefined {
  if (!('s' in prop.at)) return undefined;
  const track = realmRacersTrack(circuit);
  const fraction = ((prop.at.s % 1) + 1) % 1;
  return Math.round((fraction * track.length) / track.step) % track.samples.length;
}

/**
 * The same piece, moved to a point.
 *
 * An ABSOLUTE piece stays absolute, however near the road it is dragged: that
 * frame is the operator's own call (the inspector toggle says so), and a
 * fountain that re-anchored itself to the nearest stretch because a drag passed
 * close to one would be the tool overruling them.
 *
 * A TRACK-SPACE piece is re-decided against the band, which is the arm that
 * matters: dragged out past the projection envelope it becomes absolute at the
 * exact point it was dropped, rather than being re-anchored on whichever
 * stretch an untrusted projection reached first. The piece stops following the
 * road, which is what a piece out in the open should do anyway.
 */
export function movedProp(
  circuit: RealmRacersCircuit,
  prop: RallyProp,
  x: number,
  z: number,
  hint?: number,
): RallyProp {
  const frame = propFrameOf(prop) === 'absolute' ? 'absolute' : 'auto';
  return { ...prop, at: authorPlacement(circuit, x, z, frame, hint).at };
}

/**
 * The same piece in the OTHER frame, standing exactly where it stands now.
 *
 * The position is handed in rather than recomputed, because the caller already
 * has it from the resolver and re-deriving it here is the second placement
 * formula this module refuses to hold.
 */
export function convertedProp(
  circuit: RealmRacersCircuit,
  prop: RallyProp,
  placedX: number,
  placedZ: number,
): RallyProp {
  const frame: PropFrame = propFrameOf(prop) === 'track' ? 'absolute' : 'track';
  const hint = propProjectionHint(circuit, prop);
  return { ...prop, at: authorPlacement(circuit, placedX, placedZ, frame, hint).at };
}

/** One rotation tick, in the wheel/keypress direction. A piece that was facing
 *  the racing direction takes its CURRENT angle as the start, which is what the
 *  caller reads off the resolver, so `'tangent'` never rotates back to zero. */
export function rotatedProp(prop: RallyProp, placedYaw: number, deltaY: number): RallyProp {
  return { ...prop, yaw: rotateStep(placedYaw, deltaY) };
}

/** Face the racing direction where it stands. */
export function tangentProp(prop: RallyProp): RallyProp {
  return { ...prop, yaw: 'tangent' };
}

/** One scale tick, clamped to the shared placement bounds. */
export function scaledProp(prop: RallyProp, deltaY: number): RallyProp {
  const scale = scaleStep(prop.scale ?? 1, deltaY);
  return { ...prop, scale };
}

/** Whether a scale is one the tool will author. */
export function propScaleInRange(scale: number): boolean {
  return scale >= PLACEMENT_SCALE_MIN && scale <= PLACEMENT_SCALE_MAX;
}

/**
 * Solid or not, the two states an author actually picks between.
 *
 * The record can carry a bespoke footprint literal too, but that is a number a
 * key press cannot aim: what a keyboard cycles is whether this piece stops a
 * machine, and the catalog owns the shape either way. An explicit footprint the
 * operator typed into the inspector survives untouched until they cycle it.
 */
export function toggledCollide(prop: RallyProp): RallyProp {
  if (prop.collide !== 'none') return { ...prop, collide: 'none' };
  return {
    asset: prop.asset,
    at: prop.at,
    ...(prop.yaw === undefined ? {} : { yaw: prop.yaw }),
    ...(prop.scale === undefined ? {} : { scale: prop.scale }),
  };
}

/** A list with one entry replaced, and one with an entry removed: the two edits
 *  every dressing gesture ends in. */
export function replacedAt<T>(list: readonly T[] | undefined, index: number, value: T): T[] {
  const out = [...(list ?? [])];
  out[index] = value;
  return out;
}

export function removedAt<T>(list: readonly T[] | undefined, index: number): T[] | undefined {
  const out = [...(list ?? [])];
  out.splice(index, 1);
  return out.length > 0 ? out : undefined;
}

/**
 * The placed piece a pointer is over, or -1.
 *
 * Measured against the piece's own FOOTPRINT rather than a fixed radius, so a
 * fountain is grabbed anywhere on its basin and a lantern is not grabbed from
 * three yards away. `minRadius` is the caller's pixel tolerance in yards, which
 * is what makes a banner clickable at all at a wide zoom. Walked backwards so
 * the piece drawn last, on top, is the one picked up.
 */
export function hitTestPlaced(
  placed: readonly RallyPlacedProp[],
  x: number,
  z: number,
  minRadius = 0,
): number {
  for (let i = placed.length - 1; i >= 0; i--) {
    const prop = placed[i];
    const radius = Math.max(minRadius, rallyFootprintRadius(prop.footprint));
    if (Math.hypot(prop.x - x, prop.z - z) <= radius) return i;
  }
  return -1;
}

/** The pond a pointer is inside, or -1. Tested against the resolved OUTLINE,
 *  wobble and all, rather than against the authored ellipse: the outline is
 *  what is drawn, and a shape that grabs somewhere it is not drawn reads as a
 *  broken tool. */
export function hitTestPonds(ponds: readonly RallyPlacedPond[], x: number, z: number): number {
  for (let i = ponds.length - 1; i >= 0; i--) {
    if (polygonContainsPoint(ponds[i].outline, x, z)) return i;
  }
  return -1;
}

/** A pond's three handles: the two radii and the rotation. */
export type PondHandle = 'rx' | 'rz' | 'rot';

export const POND_HANDLES: readonly PondHandle[] = ['rx', 'rz', 'rot'];

/** Where each handle sits, circuit-local. */
export function pondHandlePoints(pond: RallyPond): Record<PondHandle, RallyPoint> {
  const rot = pond.rot ?? 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const at = (localX: number, localZ: number): RallyPoint => ({
    x: pond.x + localX * cos - localZ * sin,
    z: pond.z + localX * sin + localZ * cos,
  });
  return {
    rx: at(pond.rx, 0),
    rz: at(0, pond.rz),
    rot: at(pond.rx + POND_ROTATE_HANDLE_GAP, 0),
  };
}

/** The handle a pointer is on, or null. */
export function hitTestPondHandle(
  pond: RallyPond,
  x: number,
  z: number,
  tolerance: number,
): PondHandle | null {
  const points = pondHandlePoints(pond);
  for (const handle of POND_HANDLES) {
    const point = points[handle];
    if (Math.hypot(point.x - x, point.z - z) <= tolerance) return handle;
  }
  return null;
}

/** The pond a handle drag leaves behind. The two radius handles read the
 *  pointer in the pond's OWN frame, so a rotated pond still resizes along the
 *  axis the handle is on rather than along the world's. */
export function pondWithHandleAt(
  pond: RallyPond,
  handle: PondHandle,
  x: number,
  z: number,
): RallyPond {
  const rot = pond.rot ?? 0;
  const dx = x - pond.x;
  const dz = z - pond.z;
  if (handle === 'rot') {
    return { ...pond, rot: Math.atan2(dz, dx) };
  }
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;
  return handle === 'rx'
    ? { ...pond, rx: Math.max(POND_MIN_RADIUS, Math.abs(localX)) }
    : { ...pond, rz: Math.max(POND_MIN_RADIUS, Math.abs(localZ)) };
}

/** The pond a corner-to-corner drag describes: centred on the drag, radii from
 *  its half-extents, so the outline fills the box the operator drew. */
export function pondFromDrag(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  seed: number,
): RallyPond {
  return {
    x: (x0 + x1) / 2,
    z: (z0 + z1) / 2,
    rx: Math.max(POND_MIN_RADIUS, Math.abs(x1 - x0) / 2),
    rz: Math.max(POND_MIN_RADIUS, Math.abs(z1 - z0) / 2),
    seed,
  };
}

/** A dragged rectangle, circuit-local, in whatever order it was drawn. */
export interface DressingRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * The scatter a dragged rectangle describes.
 *
 * A `RallyScatter` is a SIDE plus a lap window, never a box: the resolver fills
 * one side of the road over a stretch of lap, which is what makes a fill
 * survive a centerline edit. So the rectangle is read for those two things and
 * then thrown away, and the readout is what tells the operator how many pieces
 * actually landed.
 *
 * The window is the smallest one covering the rectangle's own corners the short
 * way round the lap, so a box straddling the start line comes back as a
 * wrapping span rather than as the whole loop.
 */
export function scatterFromRect(
  circuit: RealmRacersCircuit,
  rect: DressingRect,
  asset: string,
  spacing: number,
  seed: number,
): RallyScatter {
  const track = realmRacersTrack(circuit);
  const minX = Math.min(rect.x0, rect.x1);
  const maxX = Math.max(rect.x0, rect.x1);
  const minZ = Math.min(rect.z0, rect.z1);
  const maxZ = Math.max(rect.z0, rect.z1);
  const corners: [number, number][] = [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
    [(minX + maxX) / 2, (minZ + maxZ) / 2],
  ];
  const fractions: number[] = [];
  let lateral = 0;
  for (const [x, z] of corners) {
    const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
    fractions.push(projection.s / track.length);
    lateral += projection.lateral;
  }
  return {
    asset,
    zone: lateral >= 0 ? 'infield' : 'outfield',
    span: shortestSpan(fractions),
    spacing,
    seed,
  };
}

/**
 * The smallest wrapping window of lap containing every fraction: sort them, find
 * the widest GAP between neighbours, and the window is everything else.
 *
 * Wrapping is not a corner case here, it is the pit straight: the start line
 * sits mid-straight on every circuit this tool has drawn, so a box over the grid
 * covers fractions near 0.99 and near 0.01 and any non-wrapping reading of that
 * is the whole lap.
 */
function shortestSpan(fractions: readonly number[]): { s0: number; s1: number } {
  const sorted = [...fractions].sort((a, b) => a - b);
  let widest = 0;
  let after = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[(i + 1) % sorted.length];
    const gap = i === sorted.length - 1 ? next + 1 - sorted[i] : next - sorted[i];
    if (gap > widest) {
      widest = gap;
      after = i;
    }
  }
  return { s0: sorted[(after + 1) % sorted.length], s1: sorted[after] };
}

/** A palette entry: a catalog key and the group it is filed under. */
export interface PropPaletteEntry {
  asset: string;
  group: string;
  /** Whether it is one of the pieces the palette offers first. */
  featured: boolean;
}

/**
 * The palette, grouped.
 *
 * The GROUPS are the tool's own vocabulary and the featured flag is the short
 * list a themed circuit reaches for first; the KEYS come from the sim catalog,
 * so a piece added to the game appears here with no edit at all. A key missing
 * from the tables below still shows, under `other`, which is what keeps this a
 * presentation detail rather than a second registry the game can drift from.
 */
const PALETTE_GROUPS: readonly { group: string; assets: readonly string[] }[] = [
  { group: 'landmark', assets: ['fountain', 'statue', 'well', 'gardenArch'] },
  {
    group: 'stonework',
    assets: [
      'column',
      'columnBroken',
      'statueBlock',
      'statueHead',
      'leafyFoxStatue',
      'goldenHorseStatue',
    ],
  },
  { group: 'furniture', assets: ['bench', 'postLantern', 'banner', 'haybale'] },
  { group: 'ironwork', assets: ['gardenIronFence', 'gardenIronPillar'] },
  { group: 'planting', assets: ['oak', 'shrub', 'bedRound', 'bedSquareA', 'bedSquareB'] },
  { group: 'waterside', assets: ['reeds', 'lilyRaft'] },
];

/** The pieces offered before the full catalog is unfolded. */
const FEATURED = new Set([
  'fountain',
  'statue',
  'gardenArch',
  'bench',
  'postLantern',
  'banner',
  'oak',
  'shrub',
  'bedRound',
  'reeds',
  'lilyRaft',
]);

/** Every authorable key, grouped and flagged, in palette order. `catalog` is the
 *  SIM catalog, handed in so this stays a pure function of it. */
export function propPalette(catalog: Readonly<Record<string, unknown>>): PropPaletteEntry[] {
  const out: PropPaletteEntry[] = [];
  const seen = new Set<string>();
  for (const { group, assets } of PALETTE_GROUPS) {
    for (const asset of assets) {
      if (!(asset in catalog) || seen.has(asset)) continue;
      seen.add(asset);
      out.push({ asset, group, featured: FEATURED.has(asset) });
    }
  }
  for (const asset of Object.keys(catalog)) {
    if (seen.has(asset)) continue;
    out.push({ asset, group: 'other', featured: false });
  }
  return out;
}
