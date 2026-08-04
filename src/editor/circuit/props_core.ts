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
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import { polygonContainsPoint } from '../../sim/geometry2d';
import type { RallyPoint } from '../../sim/realm_racers_layout';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import type { RallyPlacedPond, RallyPlacedProp } from '../../sim/realm_racers_props_resolve';
import { rallyFootprintRadius, realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import {
  REALM_RACERS_PROJECTION_ENVELOPE,
  REALM_RACERS_PROJECTION_WINDOW,
  realmRacersTrack,
} from '../../sim/realm_racers_spline';
import {
  NORTH_UP_YAW,
  NUDGE_STEP_BIG_YD,
  NUDGE_STEP_YD,
  type NudgeKey,
  nudgeDelta,
  PLACEMENT_SCALE_MIN,
  ROTATE_STEP_RAD,
  rotateStep,
  scaleStep,
  wrapAngle,
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

/**
 * The palette entry that places WATER rather than a catalog piece.
 *
 * Ponds live in the same list because placing one is the same gesture, and a
 * mode of their own is what the deleted water paint already was. It is not a
 * catalog key and never reaches a record: the pond gesture authors a `RallyPond`.
 */
export const POND_CHOICE = 'pond';

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

/** The circuit tool's own scale ceiling, deliberately far above the map
 *  editor's shared PLACEMENT_SCALE_MAX of 5: the promoted kit pieces (the hex
 *  and kmed buildings) are authored around a yard at scale 1 and the zones
 *  themselves seat them at 7 to 11, so a circuit needs building-sized scales
 *  the map editor's furniture never does. The export validator has accepted
 *  up to 50 all along; this lifts the interactive clamp to the same ceiling. */
export const RALLY_PLACEMENT_SCALE_MAX = 50;

/** One scale tick, clamped to the circuit tool's own bounds. */
export function scaledProp(prop: RallyProp, deltaY: number): RallyProp {
  const scale = scaleStep(prop.scale ?? 1, deltaY, RALLY_PLACEMENT_SCALE_MAX);
  return { ...prop, scale };
}

/** Whether a scale is one the tool will author. */
export function propScaleInRange(scale: number): boolean {
  return scale >= PLACEMENT_SCALE_MIN && scale <= RALLY_PLACEMENT_SCALE_MAX;
}

/** A scale the tool will author, from one a gesture asked for. The same clamp
 *  and the same two decimals `scaleStep` lands on, so a dragged corner and a
 *  tapped `+` cannot leave the record in two different shapes. */
export function clampPropScale(scale: number): number {
  const clamped = Math.min(RALLY_PLACEMENT_SCALE_MAX, Math.max(PLACEMENT_SCALE_MIN, scale));
  return Math.round(clamped * 100) / 100;
}

// ---- the selected piece's own grips ----

/**
 * A selected prop's two grips: turn it, and resize it.
 *
 * The pond has had handles since the water was placeable and the props never
 * did, so rotating a bench meant tapping `r` and reading the inspector to find
 * out where it got to. This is that precedent generalized, and it is the same
 * three functions: where they sit, which one a pointer is on, and what a drag
 * to a point leaves behind.
 */
export type PropHandle = 'rotate' | 'scale';

export const PROP_HANDLES: readonly PropHandle[] = ['rotate', 'scale'];

/** Yards between the piece's own outline and the rotate ring beyond it, so the
 *  ring is never sitting on top of the corner grip it shares an axis with. */
export const PROP_ROTATE_HANDLE_GAP = 2.5;

/** The corner of a footprint, in the piece's own frame: the box's own corner, or
 *  the point of a circle at 45 degrees, which is the same distance out. */
function propGripLocal(footprint: RallyPlacedProp['footprint']): RallyPoint {
  if (footprint.kind === 'circle') {
    const reach = footprint.r / Math.SQRT2;
    return { x: reach, z: reach };
  }
  return { x: footprint.hw, z: footprint.hd };
}

/**
 * Where the two grips sit, circuit-local.
 *
 * Both ride the piece's own YAW rather than the footprint's rotation, and the
 * difference is not academic: a record may carry an explicit collision box with
 * a rotation of its own, and a ring drawn on THAT would turn the wrong thing
 * when dragged. The rotate ring on the facing axis doubles as the only mark on
 * the plan that says which way a piece is pointing.
 */
export function propHandlePoints(placed: RallyPlacedProp): Record<PropHandle, RallyPoint> {
  const cos = Math.cos(placed.yaw);
  const sin = Math.sin(placed.yaw);
  const at = (localX: number, localZ: number): RallyPoint => ({
    x: placed.x + localX * cos - localZ * sin,
    z: placed.z + localX * sin + localZ * cos,
  });
  const grip = propGripLocal(placed.footprint);
  return {
    rotate: at(rallyFootprintRadius(placed.footprint) + PROP_ROTATE_HANDLE_GAP, 0),
    scale: at(grip.x, grip.z),
  };
}

/**
 * The grip a pointer is on, or null. The NEAREST one wins rather than the first
 * in the list: on a lantern the whole piece is under a yard across, so at a
 * working zoom the click tolerance reaches both grips at once and "whichever was
 * declared first" would make one of them unreachable.
 */
export function hitTestPropHandle(
  placed: RallyPlacedProp,
  x: number,
  z: number,
  tolerance: number,
): PropHandle | null {
  const points = propHandlePoints(placed);
  let best: PropHandle | null = null;
  let bestDistance = tolerance;
  for (const handle of PROP_HANDLES) {
    const point = points[handle];
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = handle;
    }
  }
  return best;
}

/**
 * The piece a grip drag leaves behind.
 *
 * Rotation lands on the ROTATE STEP unless `free`, because a row of benches that
 * each stopped at whatever angle the pointer happened to be at is the thing an
 * author is trying to avoid; `shift` is the way out for the one piece that wants
 * an angle nothing else has.
 *
 * Scale is read as a RATIO of the reach the grip already had, so it is the same
 * gesture at every zoom and at every size the piece is already at: the grip
 * follows the pointer because the piece grew to meet it.
 */
export function propWithHandleAt(
  prop: RallyProp,
  placed: RallyPlacedProp,
  handle: PropHandle,
  x: number,
  z: number,
  free = false,
): RallyProp {
  const dx = x - placed.x;
  const dz = z - placed.z;
  if (handle === 'rotate') {
    const angle = Math.atan2(dz, dx);
    return {
      ...prop,
      yaw: wrapAngle(free ? angle : Math.round(angle / ROTATE_STEP_RAD) * ROTATE_STEP_RAD),
    };
  }
  const grip = propHandlePoints(placed).scale;
  const reach = Math.hypot(grip.x - placed.x, grip.z - placed.z);
  // A footprint with no extent has no ratio to read, and dividing by it would
  // author a scale of Infinity that the clamp would silently turn into the max.
  if (reach <= 0) return prop;
  return { ...prop, scale: clampPropScale(placed.scale * (Math.hypot(dx, dz) / reach)) };
}

// ---- nudging, and the copy beside it ----

/** The arrow key an event carries, or null. The four are matched by name rather
 *  than through the action table because they are not a chord: one row saying
 *  "arrows" is what an operator reads, and four (or eight, with the shifted
 *  step) would be a cheatsheet nobody finishes. */
export function nudgeKeyOf(key: string): NudgeKey | null {
  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    return key;
  }
  return null;
}

/**
 * How far one arrow key moves a piece ON THE PLAN.
 *
 * The plan is a fixed top-down view, so the camera-relative nudge the map editor
 * shares is read at the one yaw whose screen axes are the plan's own: up is -z
 * and right is +x. The two step sizes are the map editor's too, which is what
 * makes a nudge mean the same thing in both tools.
 */
export function planNudge(key: NudgeKey, big: boolean): { dx: number; dz: number } {
  return nudgeDelta(key, NORTH_UP_YAW, big ? NUDGE_STEP_BIG_YD : NUDGE_STEP_YD);
}

/** How far a duplicate lands from its original, yards. Far enough to read as a
 *  second piece at a working zoom, near enough that it is obviously the copy of
 *  the one under the pointer rather than something dropped elsewhere. */
export const DUPLICATE_OFFSET_YD = 2;

/**
 * The same piece again, beside itself.
 *
 * Through `movedProp`, so the copy is re-framed by the same rule every other
 * placement is: a track-space bench duplicated along the verge stays track-space
 * and follows the road, and one duplicated out past the projection envelope
 * becomes circuit-local where it landed.
 */
export function duplicatedProp(
  circuit: RealmRacersCircuit,
  prop: RallyProp,
  placedX: number,
  placedZ: number,
  hint?: number,
): RallyProp {
  return movedProp(
    circuit,
    prop,
    placedX + DUPLICATE_OFFSET_YD,
    placedZ + DUPLICATE_OFFSET_YD,
    hint,
  );
}

/** The same pond again, beside itself. Its own seed comes along: a copy that
 *  reseeded itself would be a differently shaped piece of water, which is not
 *  what "duplicate" says. */
export function duplicatedPond(pond: RallyPond): RallyPond {
  return { ...pond, x: pond.x + DUPLICATE_OFFSET_YD, z: pond.z + DUPLICATE_OFFSET_YD };
}

/**
 * Where the view goes to look at a selection, circuit-local, or null.
 *
 * A prop and a pond each have one place. A SCATTER does not: it is a side of the
 * road over a stretch of lap, so what is framed is the middle of that stretch on
 * the centerline, taken the short way round so a fill straddling the start line
 * frames the grid rather than the far side of the circuit. A scatter with no
 * span covers the whole lap and genuinely has no one place; it frames the start
 * line, which at least is on the circuit.
 */
export function selectionFocusPoint(
  circuit: RealmRacersCircuit,
  selection: DressingSelection,
): RallyPoint | null {
  if (selection.kind === 'pond') {
    const pond = circuit.ponds?.[selection.index];
    return pond ? { x: pond.x, z: pond.z } : null;
  }
  if (selection.kind === 'prop') {
    const placed =
      realmRacersPlacements(circuit).props[
        placementIndexOf(circuit.props, REALM_RACERS_PROPS, selection.index)
      ];
    return placed ? { x: placed.x, z: placed.z } : null;
  }
  const scatter = circuit.scatters?.[selection.index];
  if (!scatter) return null;
  const track = realmRacersTrack(circuit);
  const point = track.pointAt(spanMidpoint(scatter.span) * track.length);
  return { x: point.x - REALM_RACERS_ORIGIN.x, z: point.z - REALM_RACERS_ORIGIN.z };
}

/** The middle of a lap window, the short way round. */
function spanMidpoint(span: RallyScatter['span']): number {
  if (!span) return 0;
  const length = (((span.s1 - span.s0) % 1) + 1) % 1;
  return (((span.s0 + length / 2) % 1) + 1) % 1;
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

/**
 * Record indices of the props the resolver actually places, in its own order.
 *
 * The resolver SKIPS a catalog key nothing authors rather than throwing, so a
 * record carrying one (a hand-pasted draft can) hands back a shorter list than
 * it was given. Without this map every selection past the unknown key would edit
 * the entry after the one the operator clicked.
 */
export function placedPropIndices(
  props: readonly RallyProp[] | undefined,
  catalog: Readonly<Record<string, unknown>>,
): number[] {
  const out: number[] = [];
  (props ?? []).forEach((prop, index) => {
    if (prop.asset in catalog) out.push(index);
  });
  return out;
}

/** Where a record prop sits in the resolver's list, or -1. */
export function placementIndexOf(
  props: readonly RallyProp[] | undefined,
  catalog: Readonly<Record<string, unknown>>,
  recordIndex: number,
): number {
  return placedPropIndices(props, catalog).indexOf(recordIndex);
}

/**
 * The suffix a throwaway record wears, and it is not cosmetic.
 *
 * `memoizePerCircuit` keeps one entry per id and only while the record behind it
 * is the same object, so a throwaway wearing the REAL id evicts the real entry on
 * every frame: the spline model was being rebuilt twice per pointermove, once for
 * the ghost and once for the circuit it had just displaced.
 */
export const GHOST_ID_SUFFIX = '__ghost';

/**
 * The piece the cursor is carrying, placed where a click would place it.
 *
 * It goes through the RESOLVER on a throwaway record rather than working out its
 * own footprint, because the outline under the cursor has to be the outline the
 * collision set will hold: a ghost drawing its own footprint would be a second
 * derivation of a placement, which is the exact bug class the one resolver exists
 * to prevent. Null for a key the catalog does not author, since there is nothing
 * honest to draw for it.
 */
export function ghostPlacement(
  circuit: RealmRacersCircuit,
  asset: string,
  x: number,
  z: number,
  yaw?: number | 'tangent',
): RallyPlacedProp | null {
  const pending: RallyProp = { asset, at: authorPlacement(circuit, x, z).at };
  if (yaw !== undefined) pending.yaw = yaw;
  const placed = ghostRowPlacements(circuit, [pending]);
  return placed[placed.length - 1] ?? null;
}

/**
 * Where a whole PENDING row would stand, through the same one resolver.
 *
 * The along-road gesture lays a dozen pieces at once and has to show them before
 * the drop, which is the same problem the single ghost has and must not be a
 * second answer to it: a preview that drew its own dots would be exactly the
 * separate derivation `ghostPlacement` exists to refuse, only twelve times over.
 */
export function ghostRowPlacements(
  circuit: RealmRacersCircuit,
  pending: readonly RallyProp[],
): RallyPlacedProp[] {
  if (pending.length === 0) return [];
  const standing = (circuit.props ?? []).length;
  const resolved = realmRacersPlacements({
    ...circuit,
    props: [...(circuit.props ?? []), ...pending],
    id: `${circuit.id}${GHOST_ID_SUFFIX}`,
  });
  // Counted off the START of the pending block rather than taken as "the tail":
  // the resolver SKIPS a catalog key nothing authors, so a row of an unknown key
  // would otherwise hand back the circuit's own last props as the preview.
  const known = placedPropIndices(circuit.props, REALM_RACERS_PROPS).length;
  const before = Math.min(known, standing);
  return resolved.props.slice(before);
}

/**
 * The seed a new scatter or pond gets.
 *
 * Taken off the record's own size rather than off a clock: the page must stay
 * reloadable to the same circuit, and a seed nobody chose is still a number the
 * operator can edit afterwards.
 */
export function nextSeed(circuit: RealmRacersCircuit): number {
  return (circuit.scatters?.length ?? 0) + (circuit.ponds?.length ?? 0) + circuit.id.length;
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
 *
 * Exported for one reason: that same forgiveness makes a TYPO invisible, since a
 * misspelled name here simply files nothing and the real key quietly falls to
 * `other`. `tests/editor_circuit_props.test.ts` reads the table and fails on a
 * name the catalog does not author.
 */
export const PALETTE_GROUPS: readonly { group: string; assets: readonly string[] }[] = [
  {
    group: 'landmark',
    assets: [
      'fountain',
      'statue',
      'well',
      'gardenArch',
      'bellTower',
      'pixieMushroomHouse',
      'crystalMoundCave',
      'starHeartCrystal',
      'stagShrine',
      'shipMonument',
      'kcasShrine',
    ],
  },
  {
    group: 'stonework',
    assets: [
      'column',
      'columnBroken',
      'statueBlock',
      'statueHead',
      'leafyFoxStatue',
      'goldenHorseStatue',
      'timberPillar',
      'kcasColumn',
      'kcasPillar',
      'kcasFoundation',
      'kcasStairsWide',
      'kcasStairsWalled',
      'kcasFloorLarge',
      'kcasFloorWeeds',
    ],
  },
  {
    group: 'furniture',
    assets: [
      'bench',
      'postLantern',
      'banner',
      'haybale',
      'lanternWall',
      'hexFlagRed',
      'kcasTorchMounted',
      'kcasChestGold',
      'kcasTableLong',
      'kcasTableCloth',
      'kcasTableRoundSmall',
      'kcasTableRoundMedium',
      'kcasBookcase',
      'kcasKeg',
      'kcasBarrel',
      'kcasBedRoyal',
      'kcasBedDouble',
      'kcasBedSingle',
      'kcasBedBunk',
      'kcasBedCot',
      'kcasBedroll',
      'kcasChair',
      'kcasStool',
      'kcasBarA',
      'kcasBarB',
      'kcasBarC',
      'kcasBartopMedium',
      'kcasCandleTriple',
    ],
  },
  { group: 'ironwork', assets: ['gardenIronFence', 'gardenIronPillar', 'gardenIronGate'] },
  {
    group: 'planting',
    assets: [
      'oak',
      'shrub',
      'bedRound',
      'bedSquareA',
      'bedSquareB',
      'giantMushroom',
      'glowCluster',
      'glowFlower',
      'mushroomRed',
      'mushroomTan',
    ],
  },
  { group: 'waterside', assets: ['reeds', 'lilyRaft'] },
  {
    group: 'village',
    assets: [
      'house1',
      'house3',
      'blacksmith',
      'inn',
      'kmedHomeA',
      'kmedHomeB',
      'kmedTavern',
      'kmedChurch',
      'kmedBlacksmith',
      'kmedMarket',
      'hexWindmill',
      'hexCastle',
      'hexTower',
      'hexChurch',
      'hexTavern',
      'hexBlacksmith',
      'hexHomeA',
      'hexHomeB',
      'hexMarket',
      'hexWatchtower',
      'hexCannonTower',
      'hexBarracks',
      'hexbHomeA',
      'hexbHomeB',
      'hexbTavern',
      'hexbTownhall',
      'hexbWorkshop',
      'hexbMarket',
      'hexbShipyard',
      'hexbStables',
      'hexbTowerBase',
      'hexbTowerA',
      'hexbTowerB',
      'hexbWindmill',
      'hexrCastle',
      'hexrTownhall',
      'hexrBarracks',
      'hexrChurch',
      'hexrTavern',
      'hexrStables',
      'hexrHomeA',
      'hexrHomeB',
      'hexrMarket',
      'hexrBlacksmith',
      'hexrWindmill',
      'hexrArcheryrange',
      'hexrTowerA',
      'hexrTowerCatapult',
      'hexrTowerBase2',
      'hexrTent',
      'hexrWatchtower',
    ],
  },
  {
    group: 'walling',
    assets: [
      'fence',
      'hexWall',
      'hexFenceStone',
      'hexnPalisade',
      'kkWall',
      'kkWallCracked',
      'kkPillar',
      'kcasWall',
      'kcasWallHalf',
      'kcasWallCorner',
      'kcasWallGated',
      'kcasWallDoorway',
      'kcasWallBroken',
      'kcasWallCracked',
      'kcasWallWindow',
      'kcasWallPillar',
      'kcasBarrier',
      'kcasBarrierHalf',
      'kcasBarrierCorner',
    ],
  },
  {
    group: 'harbour',
    assets: [
      'dockPlatform',
      'rowboat',
      'hexShipBlue',
      'hexShipRed',
      'hexShipGreen',
      'hexBoat',
      'hexBoatrack',
      'hexAnchor',
    ],
  },
  { group: 'graveyard', assets: ['graveRound', 'graveCross', 'graveBevel', 'graveDecor'] },
  {
    group: 'rocks',
    assets: [
      'amethyst',
      'oreRocks',
      'rockTallA',
      'rockTallH',
      'rockLargeD',
      'rockLargeF',
      'kcasRocks',
      'kcasRubbleLarge',
      'kcasRubbleHalf',
    ],
  },
  {
    group: 'clutter',
    assets: [
      'bonfire',
      'crateWooden',
      'farmCrate',
      'barrel',
      'anvil',
      'weaponStand',
      'hexCannonballs',
      'hexLumber',
      'hexWeaponRack',
      'hexWheelbarrow',
      'hexSack',
      'hexCrateBig',
      'hexCrateOpen',
      'hexTrough',
      'hexBarrel',
      'hexTarget',
      'hexCannon',
      'kcasCrateLarge',
      'kcasCrateSmall',
      'kcasCratesStacked',
    ],
  },
  { group: 'fixture', assets: ['courseArch', 'jumpVertical', 'jumpOxer'] },
];

/**
 * Every authorable key, grouped and flagged, in palette order.
 *
 * `catalog` is the SIM catalog and `featured` the CIRCUIT THEME's own
 * vocabulary, both handed in so this stays a pure function of them. The
 * theme's pieces come first, in the theme's own order, and they are the ones
 * offered before the full catalog is unfolded: hand-dressing a circuit is
 * mostly the hunt for the six pieces that look like this zone inside a catalog
 * that holds every zone's. Everything else still shows, because a record may
 * place any key and the readout judges the PLACEMENT, never the vocabulary.
 */
export function propPalette(
  catalog: Readonly<Record<string, unknown>>,
  featured: readonly string[],
): PropPaletteEntry[] {
  const out: PropPaletteEntry[] = [];
  const seen = new Set<string>();
  const groups = new Map<string, string>();
  for (const { group, assets } of PALETTE_GROUPS) {
    for (const asset of assets) groups.set(asset, group);
  }
  for (const asset of featured) {
    if (!(asset in catalog) || seen.has(asset)) continue;
    seen.add(asset);
    out.push({ asset, group: groups.get(asset) ?? 'other', featured: true });
  }
  for (const { group, assets } of PALETTE_GROUPS) {
    for (const asset of assets) {
      if (!(asset in catalog) || seen.has(asset)) continue;
      seen.add(asset);
      out.push({ asset, group, featured: false });
    }
  }
  for (const asset of Object.keys(catalog)) {
    if (seen.has(asset)) continue;
    out.push({ asset, group: 'other', featured: false });
  }
  return out;
}
