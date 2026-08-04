// The placement flow's decisions: where a dropped piece actually lands, whether
// the drop is legal, and what a drag ALONG the road lays down.
//
// It sits beside `props_core.ts` rather than in it because the two answer
// different questions. `props_core` answers "which frame does this coordinate
// get authored in", which is a rule about the RECORD; this answers "which
// coordinate did the operator mean", which is a rule about the GESTURE. The
// second one is allowed to be opinionated (a lantern dragged near the verge
// wants the verge, not the exact pixel) and the first one must never be.
//
// The legality verdict is NOT re-derived here. It comes from
// `realmRacersPropStanding`, the same predicate `prop_blocks_racing_surface` is
// raised from, so a ghost that tints green cannot be a placement the readout
// then refuses: that disagreement is the whole reason the ghost goes through the
// one resolver in the first place.
//
// Pure and DOM-free, deterministic, no rng.

import type { RallyProp, RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { realmRacersPropStanding } from '../../sim/realm_racers_circuit_metrics';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import type { RallyPlacedProp } from '../../sim/realm_racers_props_resolve';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../../sim/realm_racers_spline';
import { type PlacementMode, snapPoint } from './layout_core';

/** How a placement decided where to sit. */
export type SnapKind = 'free' | 'grid' | 'roadEdge';

export interface SnapResult {
  x: number;
  z: number;
  kind: SnapKind;
  /** What the ghost's readout says, so the operator knows WHY it moved. */
  label: string;
}

/**
 * How far the piece stands clear of the racing surface when it snaps to the road
 * edge, yards.
 *
 * Not zero: the garden edge IS the racing surface's boundary, and a footprint
 * centred exactly on it half overlaps the surface and is refused by the readout.
 * A yard and a half is roughly a bench's own half-depth, so the common case
 * lands legal on the first try.
 */
export const ROAD_EDGE_CLEARANCE = 1.5;

/**
 * How far OUTSIDE the road edge the magnet still bites, yards.
 *
 * A band rather than always-on: snapping a fountain to the verge because the
 * infield happens to project onto a nearby stretch would be the tool overruling
 * a placement nobody made near the road at all.
 *
 * Inside the edge there is no band, because there is no ambiguity: everything
 * from the centerline out to the garden edge is racing surface, and a piece
 * dropped there is a piece the readout is about to refuse. The operator meant
 * the roadside, so the roadside is what they get.
 */
export const ROAD_EDGE_SNAP_BAND = 7;

export interface SnapOptions {
  /** The grid toggle, from the layout store. */
  grid: boolean;
  /** `alt` held: place exactly where the pointer is, whatever is nearby. */
  free: boolean;
}

/**
 * Where a dropped piece lands.
 *
 * Three targets in one order, and the order is the design: `alt` wins outright
 * because it is the operator saying "not that, THERE"; the road edge wins next
 * because the pointer being within a bench's length of the verge is a statement
 * of intent that a 10 yard grid cannot express; and the grid rounds whatever is
 * left, which is what makes a row of beds line up out in the lawn.
 */
export function resolveSnap(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  options: SnapOptions,
): SnapResult {
  if (options.free) return { x, z, kind: 'free', label: 'free (alt)' };

  const track = realmRacersTrack(circuit);
  const projection = track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z);
  const edge = rallyGardenEdgeOffsetAt(circuit, projection.s);
  const lateral = projection.lateral;
  const side = lateral >= 0 ? 1 : -1;
  const wanted = edge + ROAD_EDGE_CLEARANCE;
  if (Math.abs(lateral) <= wanted + ROAD_EDGE_SNAP_BAND) {
    // Laid back out along the road's own normal at that lap position, so the
    // piece sits parallel to the verge rather than at whatever angle the pointer
    // approached from.
    const point = track.pointAt(projection.s);
    const offset = wanted * side;
    return {
      x: point.x - REALM_RACERS_ORIGIN.x - point.tz * offset,
      z: point.z - REALM_RACERS_ORIGIN.z + point.tx * offset,
      kind: 'roadEdge',
      label: `road edge, ${wanted.toFixed(1)} yd`,
    };
  }

  if (options.grid) {
    const snapped = snapPoint({ x, z }, true);
    return { x: snapped.x, z: snapped.z, kind: 'grid', label: 'grid' };
  }
  return { x, z, kind: 'free', label: 'free' };
}

/** What a placed piece's legality is, straight off the readout's own rule. */
export interface PlacementLegality {
  legal: boolean;
  /** Lateral clearance less the footprint radius, yards. */
  clear: number;
  /** The garden edge it is measured against, yards. */
  surface: number;
  /** One line, ready for the ghost's readout. */
  label: string;
}

export function placementLegality(
  circuit: RealmRacersCircuit,
  placed: RallyPlacedProp | null,
): PlacementLegality | null {
  if (!placed) return null;
  const standing = realmRacersPropStanding(circuit, placed);
  return {
    legal: standing.clearOfSurface,
    clear: standing.clear,
    surface: standing.surface,
    label: standing.clearOfSurface
      ? `clear by ${(standing.clear - standing.surface).toFixed(1)} yd`
      : `on the racing surface by ${(standing.surface - standing.clear).toFixed(1)} yd`,
  };
}

/**
 * How far a press may wander and still count as a CLICK, pixels.
 *
 * Past it the gesture was a drag, and the click the browser sends after every
 * drop would toggle the arm the drop had just used, so the second piece could
 * not be placed by clicking at all.
 */
export const TILE_DRAG_SLOP = 4;

/** Whether the press that just ended was a drag rather than a click. A press
 *  with no recorded start is a click: there was nothing to wander from. */
export function pressWasDrag(
  from: { x: number; y: number } | null,
  to: { x: number; y: number },
  slop = TILE_DRAG_SLOP,
): boolean {
  if (!from) return false;
  return Math.hypot(to.x - from.x, to.y - from.y) > slop;
}

// Re-exported so a caller reasoning about a PLACEMENT reads one module. The
// union is declared in `layout_core.ts` because the banner has to name it and
// this module already imports that one for the grid snap.
export type { PlacementMode } from './layout_core';

/**
 * The yaw the NEXT piece goes down at, before it is a piece.
 *
 * Null is the catalog's own default, a number is an angle, and `'tangent'` is a
 * different KIND of answer: re-read wherever the piece ends up rather than fixed
 * at the moment it was chosen.
 */
export type PendingYaw = number | 'tangent' | null;

/**
 * What a rotate chord does to the piece the cursor is carrying.
 *
 * `R` steps the angle; `shift+R` TOGGLES facing the racing direction rather than
 * accumulating, because "face the road" is not one more step and pressing it
 * twice has to give the angle back. Rotating before the drop is the point: doing
 * it after means place, look, select, rotate, which is four gestures for a
 * decision the operator had already made.
 */
export function rotatedPendingYaw(
  current: PendingYaw,
  faceRacing: boolean,
  step: (from: number, deltaY: number) => number,
): PendingYaw {
  if (faceRacing) return current === 'tangent' ? null : 'tangent';
  return step(typeof current === 'number' ? current : 0, 1);
}

/** What the status bar says about it. */
export function pendingYawText(yaw: PendingYaw): string {
  if (yaw === 'tangent') return 'the next piece faces the racing direction';
  if (yaw === null) return 'the next piece takes its own default facing';
  return `the next piece goes down at ${yaw.toFixed(2)} rad`;
}

// ---- laying a row along the road ----

/** The closest two pieces of a row may stand, yards. Under this a "row" is one
 *  solid hedge of overlapping footprints. */
export const ALONG_ROAD_MIN_SPACING = 1;

/**
 * The closest a SCATTER will sow, yards, and it is not the row's floor.
 *
 * A row lays what the drag covers; a scatter walks a grid of
 * `(2*halfX/spacing) x (2*halfZ/spacing)` cells over the whole perimeter with a
 * spline projection in each, so halving the spacing QUADRUPLES the work. At one
 * yard on an 1100 yard circuit that is a page that stops answering, which is why
 * the field it replaced carried a floor of two and why sharing one number
 * between the two gestures was the wrong economy.
 */
export const SCATTER_MIN_SPACING = 2;

/** The floor the spacing control takes in each mode. `single` has no spacing at
 *  all; it answers the row's floor so the control has a legal value to hold
 *  while it is hidden. */
export function spacingFloor(mode: PlacementMode): number {
  return mode === 'scatter' ? SCATTER_MIN_SPACING : ALONG_ROAD_MIN_SPACING;
}

/** How many pieces one gesture will lay. Half a lap at the minimum spacing is
 *  north of two hundred props, which is a record nobody meant to author and a
 *  canvas nobody can select in. */
export const ALONG_ROAD_MAX_PIECES = 120;

export interface AlongRoadOptions {
  asset: string;
  /** Yards between PIECES, measured along the row's own offset curve rather than
   *  along the lap: an offset curve is shorter than the centerline inside a
   *  corner and longer outside one, and the operator asked for the gap they can
   *  see. */
  spacing: number;
  /** Lateral offset from the centerline, signed: which side, and how far out. */
  offset: number;
  /** Whether each piece re-reads the road's tangent where it stands. */
  alignToRoad: boolean;
  /** Whether the pieces stop a machine. Off authors `collide: 'none'`. */
  solid: boolean;
}

export interface AlongRoadRun {
  props: RallyProp[];
  /** What the status bar reports, including anything the cap dropped. */
  label: string;
}

/**
 * A row of one piece, laid along the road between two lap positions.
 *
 * The whole point of the gesture, and the reason it is track-space rather than a
 * line of absolute points: a row of lanterns authored at a constant `{s, offset}`
 * FOLLOWS the road when the centerline is edited afterwards, which is what makes
 * it worth one gesture instead of twelve. A straight line of world coordinates
 * would be a row that leaves the verge the first time a corner moves.
 *
 * Laid in the drag's own direction, wrapping across the start line when that is
 * the short way the operator dragged: the pit straight is where a row of banners
 * belongs, and it is exactly the stretch the lap fraction wraps on.
 */
export function alongRoadProps(
  circuit: RealmRacersCircuit,
  fromS: number,
  toS: number,
  options: AlongRoadOptions,
): AlongRoadRun {
  const track = realmRacersTrack(circuit);
  const lap = track.length;
  const spacing = Math.max(ALONG_ROAD_MIN_SPACING, options.spacing);
  // Signed run in the direction dragged, taken the SHORT way round: a drag from
  // 0.98 to 0.02 of a lap is a short hop over the line, never a lap minus that.
  let run = toS - fromS;
  if (run > lap / 2) run -= lap;
  if (run < -lap / 2) run += lap;
  const direction = run >= 0 ? 1 : -1;
  const total = Math.abs(run);

  /**
   * Where a piece at this lap position actually stands, at the row's offset.
   *
   * The spacing is measured HERE and not along the lap, which is the difference
   * between a row and a row that looks wrong. An offset curve is shorter than
   * the centerline on the inside of a corner and longer on the outside, so
   * stepping the lap by the spacing bunched a row of lanterns to five yards
   * through a hairpin and spread it past nine on the way out. What the operator
   * asked for is the gap between PIECES.
   */
  const at = (s: number): { x: number; z: number } => {
    const point = track.pointAt(((s % lap) + lap) % lap);
    return {
      x: point.x - REALM_RACERS_ORIGIN.x - point.tz * options.offset,
      z: point.z - REALM_RACERS_ORIGIN.z + point.tx * options.offset,
    };
  };
  const piece = (s: number): RallyProp => {
    const prop: RallyProp = {
      asset: options.asset,
      at: { s: (((s % lap) + lap) % lap) / lap, offset: options.offset },
    };
    if (options.alignToRoad) prop.yaw = 'tangent';
    if (!options.solid) prop.collide = 'none';
    return prop;
  };

  // Fine enough that the walk's own chords do not eat the spacing, and coarse
  // enough that half a lap is a couple of thousand samples rather than a hundred
  // thousand.
  const walk = Math.min(0.5, spacing / 4);
  const all: RallyProp[] = [piece(fromS)];
  let previous = at(fromS);
  let accrued = 0;
  for (let travelled = walk; travelled <= total; travelled += walk) {
    const s = fromS + direction * travelled;
    const here = at(s);
    accrued += Math.hypot(here.x - previous.x, here.z - previous.z);
    previous = here;
    if (accrued < spacing) continue;
    all.push(piece(s));
    accrued = 0;
  }

  const props = all.slice(0, ALONG_ROAD_MAX_PIECES);
  const dropped = all.length - props.length;
  const label = dropped
    ? `laid ${props.length} ${options.asset} at ${spacing} yd, ${dropped} past the ${ALONG_ROAD_MAX_PIECES} piece cap`
    : `laid ${props.length} ${options.asset} at ${spacing} yd`;
  return { props, label };
}

/** Where a circuit-local point sits along the lap, yards. The gesture's two ends
 *  are pointer positions, and the row is authored in lap distance. */
export function lapPositionAt(circuit: RealmRacersCircuit, x: number, z: number): number {
  const track = realmRacersTrack(circuit);
  return track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z).s;
}

/** The signed lateral a point sits at, which is the offset a row inherits from
 *  where the operator started dragging. */
export function lateralAt(circuit: RealmRacersCircuit, x: number, z: number): number {
  const track = realmRacersTrack(circuit);
  return track.project(x + REALM_RACERS_ORIGIN.x, z + REALM_RACERS_ORIGIN.z).lateral;
}
