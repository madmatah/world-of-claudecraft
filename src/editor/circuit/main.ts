// The circuit editor page: the plan canvas, pointer routing, and the workbench
// chrome hung off it.
//
// Every decision lives in a core (`plan_core`, `stroke_fit_core`, `handles_core`,
// `props_core`, `export_core`, `layout_core`) or in the sim (`realmRacersTrack`
// for the geometry, `realmRacersCircuitMetrics` for the readout). Nothing here
// computes anything about a circuit or about the shell: this file turns pointers
// into calls and returned numbers into pixels.
//
// The chrome itself is `shell.ts` (menu bar, rail, plan overlays, status bar),
// `dock.ts` (the floating 3D panel) and the `panel_*` modules (the right column
// and the readout drawer). All of them are structure over the same cores, so what
// this file wires is behavior.
//
// Dev tool: English-only, absent from every production build. See CLAUDE.md.

import {
  REALM_RACERS_PICKUP_COLOR_CSS,
  REALM_RACERS_PICKUP_FILL_CSS,
} from '../../render/realm_racers_pickups_core';
import { realmRacersTheme } from '../../render/realm_racers_themes';
import { REALM_RACERS_BARRIERS } from '../../sim/content/realm_racers_barriers';
import {
  type RallyFence,
  type RallyProp,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersBasin,
  type RealmRacersCircuit,
} from '../../sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import {
  type RealmRacersCircuitMetrics,
  type RealmRacersCircuitProblem,
  realmRacersCircuitMetrics,
  realmRacersPickupRowFit,
} from '../../sim/realm_racers_circuit_metrics';
import { realmRacersFencePlacements } from '../../sim/realm_racers_fences';
import { realmRacersGroundShape } from '../../sim/realm_racers_ground';
import { type RallyPoint, REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import {
  REALM_RACERS_PICKUP_BOX_HALF,
  realmRacersPickupBoxes,
} from '../../sim/realm_racers_pickups';
import { type RallyPlacedProp, realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import {
  type RallyTrackModel,
  rallyGardenEdgeOffsetAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../../sim/realm_racers_spline';
import { type NudgeKey, rotateStep } from '../placement_transform_core';
import { CircuitDock } from './dock';
import { DraftDialog } from './draft_dialog';
import {
  DRAFT_SAVE_DEBOUNCE_MS,
  DRAFT_STORAGE_KEY,
  parseDraft,
  resumeOfferText,
  type StoredDraft,
  serializeDraft,
  shouldWarnOnUnload,
} from './draft_store_core';
import {
  circuitMovedFromPress,
  type EnclosureGrab,
  enclosureGrab,
  enclosureGrips,
  enclosureHitAt,
  enclosureResized,
} from './enclosure_core';
import { circuitWithCeilingVolume, fittedCircuit, suggestGroundOutline } from './envelope_core';
import { circuitToTypeScript, roundCircuit } from './export_core';
import {
  addFence,
  centerCircuitOffset,
  FENCE_POINT_TOLERANCE_YD,
  type FenceDraft,
  fenceDraftClick,
  fenceHitAt,
  fenceRunClearOfSurface,
  finishFenceDraft,
  moveCircuitContent,
  moveFence,
  moveFencePoint,
  removeFence,
  removeFencePoint,
  setFenceScale,
} from './fences_core';
import { type GroundHit, groundHitAt, groundPointRemoved, MIN_GROUND_POINTS } from './ground_core';
import {
  type CircuitBand,
  deleteControlPoint,
  fromWidthBands,
  hitTestControlPoint,
  insertControlPoint,
  MIN_CONTROL_POINTS,
  moveControlPoint,
  nearestSegment,
  paintSpan,
  toWidthBands,
} from './handles_core';
import { SnapshotHistory } from './history_core';
import {
  type ActionId,
  actionForSelectionShortcut,
  actionForShortcut,
  type CircuitTool,
  calloutProblems,
  clampToolValue,
  type DockGeometry,
  type EditorLayout,
  gridRange,
  gridStepAt,
  headlineChips,
  LAYOUT_STORAGE_KEY,
  MODE_ACTIONS,
  parseLayout,
  problemDetail,
  problemHeadline,
  type RailModeId,
  type SideTabId,
  serializeLayout,
  snapPoint,
  TOOL_VALUE_FIELDS,
  toolFor,
  zoomScale,
} from './layout_core';
import {
  armStateText,
  CIRCUIT_ONLY_ACTIONS,
  needsCircuit,
  panelLayout,
  raceArmStateText,
} from './panel_core';
import { RecordFormPanel } from './panel_form';
import { InspectorPanel } from './panel_inspector';
import {
  DEFAULT_PLACEMENT,
  type LibraryHost,
  LibraryPanel,
  type PlacementSettings,
} from './panel_library';
import { type OutlinerHost, OutlinerPanel } from './panel_outliner';
import { RaceInspectorPanel, RacePalettePanel, type RacePanelHost } from './panel_race';
import { MetricsDrawerPanel, ModeReadoutPanel } from './panel_readout';
import {
  barrierKitLabel,
  TerrainInspectorPanel,
  TerrainPalettePanel,
  type TerrainPanelHost,
  terrainArmStateText,
} from './panel_terrain';
import {
  addPickupRow,
  movedPickupRow,
  nudgedPickupFraction,
  pickupDragFractionAt,
  pickupNudgeDirection,
  pickupRowAtPoint,
  pickupRowFractionAt,
  removedPickupRow,
} from './pickup_rows_core';
import {
  alongRoadProps,
  lapPositionAt,
  lateralAt,
  type PendingYaw,
  type PlacementLegality,
  pendingYawText,
  placementLegality,
  resolveSnap,
  rotatedPendingYaw,
  type SnapResult,
} from './placement_core';
import {
  blankCircuit as blankCircuitFrom,
  fitHalfExtent,
  fitScale,
  HIT_TOLERANCE_PIXELS,
  labelledPieces,
  PLAN_LEGEND,
  type PlanBearing,
  type PlanBearingId,
  PROP_LABEL_MIN_SCALE,
  placementTint,
  planBearings,
  resolvePlanPalette,
  wheelZoomScale,
  withAlpha,
} from './plan_core';
import {
  authorPlacement,
  type DressingRect,
  type DressingSelection,
  duplicatedPond,
  duplicatedProp,
  ghostPlacement,
  ghostRowPlacements,
  hitTestPlaced,
  hitTestPondHandle,
  hitTestPonds,
  hitTestPropHandle,
  movedProp,
  nextSeed,
  nudgeKeyOf,
  POND_CHOICE,
  type PondHandle,
  type PropFrame,
  type PropHandle,
  placedPropIndices,
  placementIndexOf,
  planNudge,
  pondFromDrag,
  pondHandlePoints,
  pondWithHandleAt,
  propFrameOf,
  propHandlePoints,
  propProjectionHint,
  propWithHandleAt,
  removedAt,
  replacedAt,
  rotatedProp,
  scaledProp,
  scatterFromRect,
  selectionFocusPoint,
  tangentProp,
  toggledCollide,
} from './props_core';
import { detectPlatform, EditorShell, type MessageTone } from './shell';
import { fitStrokeToControlPoints } from './stroke_fit_core';
import { suggestWidthBands } from './width_fix_core';

type Selection = { kind: 'point'; index: number } | null;

/**
 * How much lap a painted transition runs over, YARDS. In yards rather than in
 * lap fractions so a transition reads the same on a 454 yard circuit and on an
 * 1100 yard one.
 *
 * The number comes from the hand-authored profile: the garden circuit ramps its
 * width over 23 to 32 yards, so 25 sits in that band and reads as a road
 * changing width rather than a step in it. A one-cell ramp, which is what this
 * replaces, is 2.3 yards, and a two yard change over that is a wall.
 */
const PAINT_RAMP_YARDS = 25;

/** The placeholder record a blank canvas stands on. The rule (a blank canvas
 *  inherits the template's NUMBERS and none of what its author placed on it)
 *  lives in `plan_core.ts`, where a test can hold it. */
const blankCircuit = (): RealmRacersCircuit => blankCircuitFrom(REALM_RACERS_CIRCUIT_LIST[0]);

// ---- state ----

let record: RealmRacersCircuit = blankCircuit();
/**
 * Whether the record above is the operator's circuit or the placeholder a blank
 * canvas stands on.
 *
 * A circuit with no curve is not a thing the spline, the readout or the export
 * can represent, so a blank canvas keeps a valid record underneath and simply
 * shows and offers NOTHING of it: no road, no panel, no handles, no export. The
 * first stroke makes it real. Everything else in the page reads a record that
 * is always well formed, which is what keeps the empty state from being a null
 * check in twenty places.
 */
let drawn = false;
let track: RallyTrackModel = realmRacersTrack(record);
let metrics: RealmRacersCircuitMetrics = realmRacersCircuitMetrics(record);
/**
 * Which rail entry is armed. The GESTURE it routes is derived
 * (`toolFor(railMode, drawn)`): SHAPE draws a blank canvas and edits handles on
 * a drawn one, and which of the two the operator gets was never a choice worth
 * a button of its own.
 */
let railMode: RailModeId = 'shape';
/** Whether the operator asked to re-stroke the centerline of a DRAWN circuit.
 *  One stroke long: it clears the moment a stroke lands, or on escape. */
let redrawing = false;
const tool = (): CircuitTool => toolFor(railMode, drawn, redrawing);
let selection: Selection = null;
/**
 * The pickup row the RACE tool has selected, or null.
 *
 * A state of its own rather than a third arm of `Selection` or of the dressing
 * selection: a row is not a control point and it is not a piece of scenery, and
 * the two chords it answers (delete, and the click that picks it) are the whole
 * of what it does.
 */
let pickupSelection: number | null = null;
/** Whether the pointer currently has hold of that row and is sliding it along
 *  the lap. Armed at the press on a row, dropped on release. */
let pickupDragging = false;
/**
 * The barrier the TERRAIN tool has selected, and which of its POINTS.
 *
 * Two numbers rather than one, because a barrier is the only thing on this page
 * whose selection has an inside: a click may mean the whole run (to delete it,
 * or to read its numbers) or one corner of it (to drag, to nudge, to delete on
 * its own). `fencePoint` is null when the press landed on a run between two
 * points.
 */
let fenceSelection: number | null = null;
let fencePoint: number | null = null;
/**
 * Whether the pointer currently has hold of that point.
 *
 * SEPARATE from the selection, and it has to be: a pointermove fires on plain
 * hover, so a selected point that also meant "dragging" would follow the pointer
 * around the plan for the rest of the session after one drag ended. The
 * selection survives the release, which is what lets an arrow key keep nudging
 * the corner just moved.
 */
let fenceDragging = false;
/**
 * The run being drawn, held OUTSIDE the record until it is finished.
 *
 * A half-drawn barrier has no runs, collides with nothing and gives the readout
 * nothing to say, so putting it on the record would be putting an entry on the
 * circuit that every consumer then has to special-case. It reaches the record in
 * one commit, which is also what makes the whole gesture one step back.
 */
let fenceDraft: FenceDraft | null = null;
/**
 * The GROUND shape's selected handle, and whether the pointer has hold of it.
 *
 * Its own pair rather than a third arm on the barrier selection, because the two
 * are different objects in the same tool: a circuit carries any number of
 * barriers and at most one ground shape, so "which one" is a question only the
 * first has.
 */
let groundPoint: number | null = null;
let groundDragging = false;
/**
 * The WALL grip the pointer has hold of, and where the circuit stood when a move
 * began.
 *
 * Two states rather than one because the box answers two different verbs: eight
 * grips RESIZE it, and the centre one does not touch it at all, it slides the
 * circuit's own contents. The move keeps its origin because it is a delta
 * gesture: the record has no position to read the offset back out of.
 */
let wallGrip: EnclosureGrab | null = null;
let wallMove: { x: number; z: number; from: RealmRacersCircuit } | null = null;
/**
 * Whether the next drag on the plan shapes the LAND.
 *
 * A page state rather than a palette entry, and that is the whole shape of this
 * tool: a circuit has ONE ground and any number of barriers, so the ground
 * belongs with the actions about the terrain and not in a palette, which exists
 * to pick one of many. It is armed from the banner (`drawGround`), it holds the
 * chip lit while it is true, and it is mutually exclusive with an armed kit.
 */
let groundArmed = false;
/** The freehand loop being drawn for the ground, kept off the record until the
 *  release fits it, exactly as the centerline's own stroke is. */
let groundStroke: RallyPoint[] = [];
let groundDrawing = false;
/** The raw gesture, kept after the fit so the operator can see how far the
 *  closed centripetal Catmull-Rom sits off the line they drew. */
let stroke: RallyPoint[] = [];
let drawing = false;
let dragging: Selection = null;
let painting = false;
/** The painted quantity, sampled before the stroke started, so the stroke can
 *  report what it actually changed. A paint that lands on a road already at the
 *  painted value is silent otherwise, which reads as a broken tool. */
let paintBefore: number[] | null = null;
/** The band table as it stood when the stroke began, plus every lap fraction
 *  the pointer has visited since. A stroke is re-applied to the ORIGINAL table
 *  on every move, which is what keeps it from denting against its own earlier
 *  points as it extends. */
let paintOrigin: CircuitBand[] | null = null;
let paintFractions: number[] = [];
/** What the dressing gesture in flight is doing, and to which entry. */
let dressing: DressingSelection | null = null;
let dressingDrag: 'move' | 'rect' | 'pond' | 'prop' | 'road' | null = null;
/** The pond handle under a resize/rotate drag. */
let pondHandle: PondHandle | null = null;
/** The selected prop's grip under a rotate/scale drag. */
let propHandle: PropHandle | null = null;
/** The piece as the resolver placed it at the grip PRESS: every move of a grip
 *  drag measures against THIS. An explicit collide literal keeps a constant
 *  reach while the scale grows, so a ratio read against the placement the
 *  previous move committed compounds to the clamp within a few moves. */
let propGrab: RallyPlacedProp | null = null;
/** The projection index a track-space drag is anchored to: without it a drag
 *  across a pinch re-anchors the piece to the facing stretch. Refreshed from
 *  every move's own answer, because a hint parked at the press is outrun by
 *  any drag longer than the projection window's reach. */
let dragHint: number | undefined;
/** The frame the dragged piece wore at the PRESS. Every move commits, so the
 *  frame read off the entry the last move committed latched 'absolute' after
 *  one excursion past the envelope; the drop decides from where the pointer
 *  is NOW, against the frame the drag began with. */
let dragFrame: PropFrame | undefined;
/** The live rectangle a scatter or a pond is being dragged out over. */
let dressingRect: DressingRect | null = null;
/**
 * The yaw the NEXT piece goes down at, before it is a piece.
 *
 * `R` turns the ghost and `shift+R` faces it down the road, both while nothing
 * is selected: rotating after the drop means placing a lantern, looking at it,
 * selecting it and rotating it, which is four gestures for a decision the
 * operator had already made. Null means the catalog's own default.
 */
let pendingYaw: PendingYaw = null;
/** How the next gesture lays what is armed: the library's placement block. */
let placement: PlacementSettings = { ...DEFAULT_PLACEMENT };
/** Where a row being dragged along the road started, in lap yards, and at what
 *  lateral offset. Null unless an along-road drag is in flight. */
let roadRun: { fromS: number; offset: number } | null = null;
/** A drag that began on a LIBRARY TILE rather than on the plan. The ghost has to
 *  follow the pointer over a canvas the gesture never touched down on. */
let tileDrag: { asset: string; pointerId: number } | null = null;
/** What the ghost's readout says about the snap it took, live. */
let ghostSnap: SnapResult | null = null;
/**
 * Whether `alt` is down, which is the operator overruling every magnet.
 *
 * Tracked rather than read off the pointer event, because the ghost is redrawn
 * on a repaint the key press caused and there is no pointer event in hand there.
 */
let altHeld = false;
/** Where the pointer last was on the plan, which is where the armed piece's
 *  ghost stands. Null once the pointer leaves. */
let hover: RallyPoint | null = null;
let panning: { x: number; z: number; clientX: number; clientY: number } | null = null;
/** The edit history. Snapshots of the whole record, because `commit` already
 *  produces one per edit; the model and its forward branch live in the core. */
interface EditSnapshot {
  record: RealmRacersCircuit;
  drawn: boolean;
}
const history = new SnapshotHistory<EditSnapshot>();
const view = { x: 0, z: 0, scale: 2.4 };
let redrawQueued = false;
/** Edits since the last save, which is what the document's `unsaved` marker
 *  reports. Not a save gate: a dev tool never blocks the operator. */
let dirty = false;

// ---- dom ----

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const loadDialog = document.getElementById('loadDialog') as HTMLDialogElement;
const loadListEl = document.getElementById('loadList') as HTMLDivElement;
const previewCanvas = document.getElementById('preview3d') as HTMLCanvasElement;
/** Detected ONCE and handed to both consumers: it is a UA sniff, and running it
 *  twice is two answers to a question with one. */
const platform = detectPlatform();

/**
 * The colours the canvas shares with the stylesheet, read once at boot.
 *
 * Five of the sheet's tokens used to exist twice, as a custom property and as a
 * hex literal in here, with nothing keeping the copies in step. `getComputedStyle`
 * is a layout read, so it happens once rather than per colour per frame.
 */
const rootStyle = getComputedStyle(document.documentElement);
const planPalette = resolvePlanPalette((property) => rootStyle.getPropertyValue(property));
/** The wash a selected piece is filled with: the same token, translucent. */
const PICK_FILL = withAlpha(planPalette.pick, 0.35);

/**
 * The last basin the record carried, so deleting the final pond and then
 * placing one back restores THAT water rather than a default one.
 *
 * A circuit that has never had a basin falls back to the practice circuit's own
 * water, READ off the record rather than copied: a second literal of those four
 * numbers here is a set of tuning values that can drift from the ones the game
 * ships without anything saying so.
 */
let rememberedBasin: RealmRacersBasin = record.basin ??
  REALM_RACERS_PRACTICE_CIRCUIT.basin ?? {
    waterY: -0.55,
    bankSlope: 0.8,
    depthMax: 6,
  };

// ---- the persisted layout ----

function readLayout(): EditorLayout {
  try {
    return parseLayout(window.localStorage.getItem(LAYOUT_STORAGE_KEY));
  } catch {
    // Private browsing and a blocked origin both throw on access rather than
    // returning null, and a tool that cannot remember its panels still works.
    return parseLayout(null);
  }
}

let layout: EditorLayout = readLayout();
let layoutSaveTimer = 0;

function saveLayout(): void {
  window.clearTimeout(layoutSaveTimer);
  // Coalesced: the zoom lands in here on every wheel notch, and a write per
  // notch is a synchronous storage hit inside a gesture.
  layoutSaveTimer = window.setTimeout(() => {
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, serializeLayout(layout));
    } catch {
      // Nothing to do and nothing to say: the layout is a convenience.
    }
  }, 400);
}

function setStatus(text: string, tone: MessageTone = ''): void {
  shell.setMessage(text, tone);
}

// ---- the autosaved draft ----
//
// The tool is left open for hours and reloaded often, and until now a reload was
// a discard. Every commit schedules a write of the working record; boot OFFERS
// what it finds rather than opening it, because a dev tool that silently reopened
// yesterday's circuit over a blank canvas would be deciding what the operator
// came here to do.

let draftSaveTimer = 0;

function saveDraftLocally(): void {
  window.clearTimeout(draftSaveTimer);
  draftSaveTimer = window.setTimeout(() => {
    // A BLANK canvas writes nothing, and this is the whole safety net rather
    // than a tidy guard. `newBlank()` runs at boot and commits, so the timer it
    // schedules fires a second later and wrote `{drawn: false}` straight over
    // the draft the status bar was at that moment offering to restore: an
    // operator who did not press Resume within the second lost the work for
    // good, and the in-memory offer kept working, which is exactly what hid it.
    if (!drawn) return;
    try {
      window.localStorage.setItem(DRAFT_STORAGE_KEY, serializeDraft(record, drawn, Date.now()));
    } catch {
      // A full quota or a blocked origin: the draft is a safety net, not a save.
    }
  }, DRAFT_SAVE_DEBOUNCE_MS);
}

/** What boot found, until the operator takes it or draws over it. */
let offered: StoredDraft | null = null;

function offerResume(): void {
  let stored: StoredDraft | null = null;
  try {
    stored = parseDraft(window.localStorage.getItem(DRAFT_STORAGE_KEY));
  } catch {
    stored = null;
  }
  if (!stored) return;
  offered = stored;
  shell.setResume(resumeOfferText(stored, Date.now()));
}

function takeResume(): void {
  const stored = offered;
  if (!stored) return;
  offered = null;
  shell.setResume(null);
  loadCircuit(stored.record, `${stored.record.id} (resumed)`);
  drawn = stored.drawn;
  refreshChrome();
}

// ---- the record ----

/**
 * The 3D preview, once the operator has asked for it.
 *
 * Loaded on demand: it drags in Three and a GL context, and the 2D tool is the
 * one that has to open instantly. Null until the first toggle, and every edit
 * simply skips it while it is.
 */
let preview: import('./preview3d').CircuitPreview | null = null;
/** One-shot: a layout that was left with the dock open re-opens it as soon as
 *  there is a circuit to show, and never asks again. */
let dockRestored = false;

/** Every edit records the state it is LEAVING through here, so no site can
 *  forget that a new edit drops the forward branch. */
function pushUndo(): void {
  history.push({ record, drawn });
}

/** Every edit lands here: it rounds to what the export carries, re-derives the
 *  geometry and the readout, and schedules a repaint. */
function commit(next: RealmRacersCircuit, remember = true): void {
  if (remember) pushUndo();
  record = roundCircuit(next);
  if (record.basin) rememberedBasin = record.basin;
  track = realmRacersTrack(record);
  metrics = realmRacersCircuitMetrics(record);
  dirty = true;
  saveDraftLocally();
  requestRedraw();
  // The palette follows the theme, so retyping the theme field re-offers the
  // zone's own vocabulary rather than the one the circuit opened on.
  library.syncTheme();
  // `Delete ground shape` acts on a field that appears and disappears with an
  // edit, so its enabled state is re-read HERE rather than only at load: a chip
  // that stayed live over a shape nobody has any more is a button whose refusal
  // the operator meets after clicking it.
  syncGroundActions();
  // The preview debounces this itself: a drag lands one build on release, never
  // one per pointermove.
  if (drawn) preview?.show(record);
}

/**
 * Drop every selection the tools can hold: a control point, a dressing piece,
 * a pickup row.
 *
 * One helper rather than three assignments repeated at each site, because they
 * are one decision ("nothing is selected any more") and the sites that forgot
 * the newest of the three would be pointing an index at a record that no longer
 * has it. `disarmTool` keeps its own pair on purpose: `esc` drops what the tools
 * ARM, and the control-point selection is not one of those.
 */
function clearSelections(): void {
  selection = null;
  dressing = null;
  pickupSelection = null;
  fenceSelection = null;
  fencePoint = null;
  fenceDragging = false;
  groundPoint = null;
  groundDragging = false;
  groundStroke = [];
  groundDrawing = false;
  groundArmed = false;
  wallGrip = null;
  // The move's origin is a point in the coordinates of the record being left, so
  // a load or an undo mid-drag would slide the next circuit by the difference
  // between two frames.
  wallMove = null;
  // The draft goes with them: it holds points in the coordinates of the record
  // being left, so carrying it into an undo or a load would drop a run onto a
  // circuit nobody drew it on.
  fenceDraft = null;
}

function restore(snapshot: EditSnapshot): void {
  clearSelections();
  drawn = snapshot.drawn;
  commit(snapshot.record, false);
  form.sync();
  refreshChrome();
}

function undo(): void {
  const previous = history.undo({ record, drawn });
  if (previous) restore(previous);
}

function redo(): void {
  const next = history.redo({ record, drawn });
  if (next) restore(next);
}

// ---- view maths (screen only: nothing here is about the circuit) ----

const local = (point: { x: number; z: number }): RallyPoint => ({
  x: point.x - REALM_RACERS_ORIGIN.x,
  z: point.z - REALM_RACERS_ORIGIN.z,
});

/**
 * The plan's pixel size, sampled once per frame.
 *
 * Read live it was a layout property read PER POINT: `drawSurfaces` alone walks
 * about 480 samples across five rings, so a frame did thousands of them, and the
 * chrome paint read them again AFTER writing to the DOM, which forces a reflow.
 * One sample at the top of the frame, before anything writes, removes both.
 */
const plan = { width: 0, height: 0 };

function samplePlanSize(): void {
  plan.width = canvas.clientWidth;
  plan.height = canvas.clientHeight;
}

const screenX = (x: number): number => (x - view.x) * view.scale + plan.width / 2;
const screenY = (z: number): number => (z - view.z) * view.scale + plan.height / 2;

function toLocal(ev: { clientX: number; clientY: number }): RallyPoint {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (ev.clientX - rect.left - rect.width / 2) / view.scale + view.x,
    z: (ev.clientY - rect.top - rect.height / 2) / view.scale + view.z,
  };
}

/** Where a canvas point sits along the lap, through the REAL projection. */
function fractionAt(point: RallyPoint): number {
  const projection = track.project(
    point.x + REALM_RACERS_ORIGIN.x,
    point.z + REALM_RACERS_ORIGIN.z,
  );
  return projection.s / track.length;
}

/** What a gesture authors from a raw pointer position: the grid rounds it when
 *  the operator asked for a grid to round to. */
const authored = (point: RallyPoint): RallyPoint => snapPoint(point, layout.snap);

function fitView(): void {
  const half = fitHalfExtent(drawn, metrics.roadHalfX, metrics.roadHalfZ);
  // Measured HERE rather than trusted from the last frame: `fitView` runs at boot,
  // before any frame has been drawn, and a plan still measuring zero produced a
  // scale of zero, which is not a view anyone can draw at.
  samplePlanSize();
  view.x = 0;
  view.z = 0;
  view.scale = fitScale(plan.width, plan.height, half);
  rememberZoom();
  requestRedraw();
}

function rememberZoom(): void {
  layout = { ...layout, zoom: view.scale };
  saveLayout();
}

// ---- drawing ----

function requestRedraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    // Before either painter, and before any write either makes.
    samplePlanSize();
    draw();
    paintChrome();
  });
}

function tracePolygon(points: readonly RallyPoint[]): void {
  ctx.beginPath();
  points.forEach((point, i) => {
    const x = screenX(point.x);
    const y = screenY(point.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

function strokeRect(halfX: number, halfZ: number, color: string, dash: number[] = []): void {
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.strokeRect(screenX(-halfX), screenY(-halfZ), halfX * 2 * view.scale, halfZ * 2 * view.scale);
  ctx.restore();
}

/** The reference grid, under everything. The step comes from the core, which
 *  multiplies it up until the lines are far enough apart to read. */
function drawGridLines(): void {
  if (!layout.grid) return;
  const { width, height } = plan;
  const step = gridStepAt(view.scale);
  const across = gridRange(view.x, width, view.scale, step);
  const down = gridRange(view.z, height, view.scale, step);
  if (!across || !down) return;
  ctx.save();
  ctx.strokeStyle = '#1d212b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = across.first; x <= across.last; x += step) {
    ctx.moveTo(screenX(x), 0);
    ctx.lineTo(screenX(x), height);
  }
  for (let z = down.first; z <= down.last; z += step) {
    ctx.moveTo(0, screenY(z));
    ctx.lineTo(width, screenY(z));
  }
  ctx.stroke();
  // The origin, so a circuit-local coordinate in the inspector has something on
  // screen to mean anything against.
  ctx.strokeStyle = '#252b38';
  ctx.beginPath();
  ctx.moveTo(screenX(0), 0);
  ctx.lineTo(screenX(0), height);
  ctx.moveTo(0, screenY(0));
  ctx.lineTo(width, screenY(0));
  ctx.stroke();
  ctx.restore();
}

/** The road, its two off-track bands and the ponds, offset from the centerline
 *  exactly the way the sim and the renderer offset them. */
function drawSurfaces(): void {
  const samples = track.samples;
  const offsetRing = (offset: (index: number) => number, side: 1 | -1): RallyPoint[] =>
    samples.map((sample, i) => {
      const distance = offset(i) * side;
      const p = local(sample);
      return { x: p.x - sample.tz * distance, z: p.z + sample.tx * distance };
    });

  // The ponds, straight off the resolver: the same outlines the renderer cuts
  // its water and its holes in the lawn from, so a wobble the operator seeded
  // is the wobble they will drive past.
  ctx.fillStyle = '#1d3448';
  for (const pond of realmRacersPlacements(record).ponds) {
    tracePolygon(pond.outline);
    ctx.fill();
  }

  // The road ribbon: out one side and back the other.
  const leftEdge = offsetRing((i) => samples[i].halfWidth, 1);
  const rightEdge = offsetRing((i) => samples[i].halfWidth, -1);
  ctx.fillStyle = '#2b3040';
  ctx.beginPath();
  leftEdge.forEach((p, i) => {
    const x = screenX(p.x);
    const y = screenY(p.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (let i = rightEdge.length - 1; i >= 0; i--) {
    ctx.lineTo(screenX(rightEdge[i].x), screenY(rightEdge[i].z));
  }
  ctx.closePath();
  ctx.fill('evenodd');

  // The garden edge: where the verge stops and the second slow band starts.
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#4a7a52';
  ctx.lineWidth = 1;
  for (const side of [1, -1] as const) {
    tracePolygon(offsetRing((i) => rallyGardenEdgeOffsetAt(record, samples[i].s), side));
    ctx.stroke();
  }
  ctx.restore();

  // The centerline.
  ctx.strokeStyle = '#7f8798';
  ctx.lineWidth = 1;
  tracePolygon(samples.map((sample) => local(sample)));
  ctx.stroke();
}

function drawGates(): void {
  // The recovery anchors are DERIVED, so they are drawn and never edited: they
  // are here to show where a reset would put a racer back, which is worth
  // seeing while shaping the curve that decides it.
  ctx.strokeStyle = '#6b6250';
  ctx.lineWidth = 1;
  for (const gate of realmRacersGates(record)) {
    const p = local(gate);
    const nx = -gate.dirZ * gate.halfWidth;
    const nz = gate.dirX * gate.halfWidth;
    ctx.beginPath();
    ctx.moveTo(screenX(p.x - nx), screenY(p.z - nz));
    ctx.lineTo(screenX(p.x + nx), screenY(p.z + nz));
    ctx.stroke();
  }

  ctx.fillStyle = '#e0e4ee';
  for (const slot of realmRacersStarts(record)) {
    const p = local(slot);
    ctx.beginPath();
    ctx.arc(screenX(p.x), screenY(p.z), Math.max(2, 1.7 * view.scale), 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The pickup rows: the four boxes each one resolves to, drawn where the sim
 * says they stand.
 *
 * Straight off `realmRacersPickupBoxes`, never from arithmetic here, for the
 * same reason the dressing draws the resolver's own output: a square on this
 * canvas has to be a box a machine can drive into.
 */
function drawPickupRows(): void {
  for (const box of realmRacersPickupBoxes(record)) {
    const chosen = pickupSelection === box.row;
    drawPickupBox(
      box,
      chosen ? PICK_FILL : REALM_RACERS_PICKUP_FILL_CSS,
      chosen ? planPalette.pick : REALM_RACERS_PICKUP_COLOR_CSS,
    );
  }
}

/** One box, in whatever colours the caller is drawing it for. */
function drawPickupBox(
  box: { x: number; z: number },
  fill: string,
  stroke: string,
  dashed = false,
): void {
  const p = local(box);
  const size = Math.max(3, REALM_RACERS_PICKUP_BOX_HALF * 2 * view.scale);
  const x = screenX(p.x) - size / 2;
  const y = screenY(p.z) - size / 2;
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.setLineDash(dashed ? [3, 2] : []);
  ctx.strokeRect(x, y, size, size);
  ctx.setLineDash([]);
}

/**
 * The row the armed palette would lay where the pointer is.
 *
 * It resolves a THROWAWAY record carrying the pending row and draws what came
 * back, which is the same rule the dressing ghost keeps and for the same reason:
 * the outline under the cursor has to be the one the sim will hold, never a
 * second derivation of it.
 *
 * The tint is the READOUT's own verdict, not this tool's arithmetic. Three things
 * can refuse a row and only two of them belong to the gesture (off the road, too
 * near a neighbour); the third is `pickup_row_off_road`, which measures the
 * resolved boxes' CORNERS against the road and is the one that catches a row that
 * looks central on a tight corner. A ghost drawn green over that would be the
 * tool blessing a placement the panel is about to refuse.
 */
function drawPickupGhost(): void {
  if (!drawn || !hover || racePalette.armed === null) return;
  const fraction = pickupRowFractionAt(record, hover.x, hover.z);
  if (fraction === null) return;
  const pending = { ...record, pickupRows: [{ s: fraction }] };
  const boxes = realmRacersPickupBoxes(pending);
  const clear =
    realmRacersPickupRowFit(pending, boxes).fitsRoad &&
    addPickupRow(record.pickupRows ?? [], fraction).outcome === 'added';
  for (const box of boxes) {
    drawPickupBox(box, 'transparent', clear ? planPalette.ok : planPalette.bad, true);
  }
}

function drawHandles(): void {
  record.controlPoints.forEach((point, index) => {
    const chosen = selection?.kind === 'point' && selection.index === index;
    ctx.fillStyle = chosen ? planPalette.pick : index === 0 ? planPalette.ok : '#7fb2e8';
    ctx.beginPath();
    ctx.arc(screenX(point.x), screenY(point.z), chosen ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * Which colour each named box is drawn in.
 *
 * HUES, not four shades of the same slate, and that is a seat finding rather
 * than decoration: the boxes were told apart by their dash patterns alone, and
 * a legend keyed on "long dashes versus short dashes versus dots" is not one a
 * person can read at a glance. Colour is the channel that works; the dashes
 * stay as the second one, so the key survives being looked at by someone who
 * does not separate these hues.
 *
 * Chosen clear of the colours this canvas already spends: amber is a selection
 * (`--pick`), red and green are the readout's verdicts, the handles are
 * cornflower and the stroke is pink. `ground` keeps the authored shore's own
 * blue, because the row and the drawn curve are the same object.
 */
const BEARING_COLOUR: Record<PlanBearingId, string> = {
  volume: '#8f7fd6',
  centerline: '#4fb3a5',
  wall: '#c98f5a',
  ground: '#4d7fa0',
};

/**
 * The named boxes a circuit lives inside, drawn in EVERY state.
 *
 * The defect this ends: the ceiling was drawn only on a blank canvas, and the
 * circuit's own collision region took its place after the first stroke wearing
 * the same colour and the same dashes. Two different objects, one drawing, so
 * the fixed reference read as a rectangle that shrank when a circuit was drawn.
 * They are one box now (every circuit carries the volume at its ceiling), and
 * every box on the plan says what it is in the legend.
 */
function drawBearings(): void {
  // The aim box is up while the PEN is, not for the whole of SHAPE: a blank
  // canvas and a redraw are strokes, and dragging a handle is not.
  const bearings = planBearings(record, drawn, tool() === 'draw');
  const sizing = wallGrip !== null;
  for (const bearing of bearings) {
    if (!bearing.half) continue;
    // The wall lights up while it is being dragged, and lighting the WHOLE box
    // is the point rather than a flourish: a half-extent moves both edges, and
    // an operator watching only the one under the pointer would read the far
    // side moving as the tool doing something it was not asked to.
    const colour = bearing.id === 'wall' && sizing ? planPalette.pick : BEARING_COLOUR[bearing.id];
    strokeRect(bearing.half.halfX, bearing.half.halfZ, colour, [...bearing.dash]);
  }
  // Only while a click could actually take one: a kit armed or the ground armed
  // routes every press elsewhere, and eight dots that answer nothing are the
  // affordance lying about the state.
  if (drawn && railMode === 'terrain' && terrainPalette.armed === null && !groundArmed) {
    drawWallGrips();
  }
  drawBearingLegend(bearings);
}

/**
 * The wall's grips, and the centre one that moves the circuit instead.
 *
 * TERRAIN only, because that is the mode the wall belongs to: eight dots on
 * every other tool's canvas would be eight things to click by accident while
 * painting a road or placing a bench.
 */
function drawWallGrips(): void {
  ctx.save();
  for (const grip of enclosureGrips(record.perimeter.halfX, record.perimeter.halfZ)) {
    ctx.fillStyle = wallGrip?.grip.id === grip.id ? planPalette.pick : BEARING_COLOUR.wall;
    ctx.beginPath();
    ctx.arc(screenX(grip.x), screenY(grip.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  // The centre is a CROSS rather than a ninth dot, because it is a different
  // verb: the eight resize the box and this one picks the circuit up.
  ctx.strokeStyle = wallMove ? planPalette.pick : BEARING_COLOUR.wall;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(screenX(0) - 5, screenY(0));
  ctx.lineTo(screenX(0) + 5, screenY(0));
  ctx.moveTo(screenX(0), screenY(0) - 5);
  ctx.lineTo(screenX(0), screenY(0) + 5);
  ctx.stroke();
  ctx.restore();
}

/**
 * The legend, bottom left, in SCREEN space.
 *
 * In pixels rather than in yards because it is a key rather than a measurement:
 * at any zoom that makes a road legible, most of the boxes are off the canvas
 * entirely, which is exactly when their numbers are the only way to know they
 * are there. Each row wears its box's own colour AND its own dashes, so the
 * swatch and the rectangle cannot drift apart, and neither channel is carrying
 * the key on its own.
 *
 * The value column is MEASURED off the widest label rather than set to a
 * constant. It was a constant, and `centerline` (66 px at this size) ran
 * straight through a column parked at 52, so the row printed
 * `centerline62 x 272 yd` on screen. A monospace font makes the arithmetic look
 * safe to do by eye, and it is exactly as wrong as any other kind.
 */
function drawBearingLegend(bearings: readonly PlanBearing[]): void {
  ctx.save();
  ctx.font = '11px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const bottom = plan.height - PLAN_LEGEND.bottomInset;
  const textX = PLAN_LEGEND.left + PLAN_LEGEND.swatch + PLAN_LEGEND.gap;
  // `Math.max()` of nothing is -Infinity, which puts the whole column at NaN.
  // Unreachable through `planBearings`, which always answers with at least the
  // volume, and this takes a caller-supplied list.
  const widest = Math.max(0, ...bearings.map((bearing) => ctx.measureText(bearing.label).width));
  const valueX = textX + widest + PLAN_LEGEND.gap;
  bearings.forEach((bearing, index) => {
    const y = bottom - (bearings.length - 1 - index) * PLAN_LEGEND.rowHeight;
    ctx.save();
    ctx.setLineDash([...bearing.dash]);
    ctx.strokeStyle = BEARING_COLOUR[bearing.id];
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PLAN_LEGEND.left, y);
    ctx.lineTo(PLAN_LEGEND.left + PLAN_LEGEND.swatch, y);
    ctx.stroke();
    ctx.restore();
    // The NAME wears the box's colour, so the eye can go from a rectangle on the
    // canvas to its row without reading the swatch as a separate thing.
    ctx.fillStyle = BEARING_COLOUR[bearing.id];
    ctx.fillText(bearing.label, textX, y);
    ctx.fillStyle = planPalette.dim;
    ctx.fillText(bearing.value, valueX, y);
  });
  ctx.restore();
}

function drawStroke(): void {
  if (stroke.length < 2) return;
  ctx.save();
  ctx.strokeStyle = '#e08ad0';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  stroke.forEach((point, i) => {
    const x = screenX(point.x);
    const y = screenY(point.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawProblemMarkers(): void {
  for (const problem of metrics.problems) {
    if (problem.s < 0) continue;
    const p = local(track.pointAt(problem.s));
    ctx.strokeStyle = problem.severity === 'error' ? planPalette.bad : planPalette.warn;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(screenX(p.x), screenY(p.z), 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  const nearest = metrics.nearestApproach;
  if (Number.isFinite(nearest.distance)) {
    const a = local(track.pointAt(nearest.s));
    const b = local(track.pointAt(nearest.otherS));
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = planPalette.bad;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenX(a.x), screenY(a.z));
    ctx.lineTo(screenX(b.x), screenY(b.z));
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * The piece the cursor is carrying, placed where a click would place it.
 *
 * Null unless the props tool is armed and the pointer is over the plan. The
 * placement itself is `props_core`'s, which resolves a throwaway record through
 * the ONE resolver, so the outline under the cursor is the outline the collision
 * set will hold.
 */
function cursorGhost(): RallyPlacedProp | null {
  const armed = library.armed;
  if (!drawn || armed === null || armed === POND_CHOICE || !hover) return null;
  // A tile drag draws its ghost over whatever tool is showing; a plan hover only
  // draws one in PROPS, and never in the middle of another dressing gesture.
  if (!tileDrag && (tool() !== 'props' || dressingDrag)) return null;
  const snap = resolveSnap(record, hover.x, hover.z, { grid: layout.snap, free: altHeld });
  ghostSnap = snap;
  return ghostPlacement(record, armed, snap.x, snap.z, pendingYaw ?? undefined);
}

/**
 * The barriers, as the resolver placed them, plus the run being drawn.
 *
 * Drawn as the RUNS the resolver returns rather than as the points on the
 * record, for the reason every view on this page is: the line under the pointer
 * has to be the line the collision set will hold. The two differ by more than
 * rounding, since a run reaches a half thickness past every joint.
 *
 * The DRAFT is drawn from its own points, because it has no resolved geometry
 * yet: it is not on the record, so there is nothing to resolve. Its last segment
 * follows the pointer, which is what makes a drawing gesture readable at all.
 */
function drawFences(): void {
  const placements = realmRacersFencePlacements(record);
  for (const fence of placements.fences) {
    // Keyed off the placement's OWN record index, never its position in this
    // list: an unknown kit is skipped by the resolver, so the two lists stop
    // being parallel and a position match would paint one barrier's runs under
    // another's points.
    const index = fence.index;
    const selected = index === fenceSelection;
    ctx.strokeStyle = selected ? planPalette.pick : '#8f9bb8';
    ctx.lineWidth = selected ? 3 : 2;
    for (const run of fence.runs) {
      ctx.beginPath();
      ctx.moveTo(screenX(run.ax), screenY(run.az));
      ctx.lineTo(screenX(run.bx), screenY(run.bz));
      ctx.stroke();
    }
    // The authored POINTS on top: they are what a drag grabs, so they have to be
    // visible even where two runs meet at a shallow angle.
    const authored = record.fences?.[index]?.points ?? [];
    authored.forEach((point, p) => {
      ctx.fillStyle = selected && p === fencePoint ? planPalette.pick : '#c8d2e8';
      ctx.beginPath();
      ctx.arc(screenX(point.x), screenY(point.z), selected ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (!fenceDraft) return;
  // The pending segment's tint is the READOUT's own verdict, the rule both the
  // dressing ghost and the row ghost already keep: a tint derived from the
  // tool's own arithmetic would be free to draw a normal-coloured line over a
  // run the panel is about to refuse with `fence_blocks_racing_surface`, and the
  // operator would only meet the refusal after committing.
  const draftHalf = (REALM_RACERS_BARRIERS[fenceDraft.kit]?.halfThickness ?? 0) * 1;
  const last = fenceDraft.points[fenceDraft.points.length - 1];
  const pendingBlocked =
    hover !== null && last !== undefined && !fenceRunClearOfSurface(record, last, hover, draftHalf);
  ctx.strokeStyle = pendingBlocked ? planPalette.bad : planPalette.pick;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  fenceDraft.points.forEach((point, i) => {
    const x = screenX(point.x);
    const y = screenY(point.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  if (hover) ctx.lineTo(screenX(hover.x), screenY(hover.z));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = planPalette.pick;
  for (const point of fenceDraft.points) {
    ctx.beginPath();
    ctx.arc(screenX(point.x), screenY(point.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * The dressing, as the resolver placed it.
 *
 * Every footprint here is read off `realmRacersPlacements`, never worked out
 * from the record: the canvas is a VIEW of the one placement, and a tool that
 * drew a fountain where the game does not put one is the whole defect the
 * resolver exists to prevent.
 */
function drawDressing(): void {
  const placements = realmRacersPlacements(record);
  const placed = placedPropIndices(record.props, REALM_RACERS_PROPS);
  const traceFootprint = (prop: RallyPlacedProp): void => {
    ctx.beginPath();
    if (prop.footprint.kind === 'circle') {
      ctx.arc(
        screenX(prop.x),
        screenY(prop.z),
        Math.max(2, prop.footprint.r * view.scale),
        0,
        Math.PI * 2,
      );
      return;
    }
    const { hw, hd, rot } = prop.footprint;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const corners: [number, number][] = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    corners.forEach(([lx, lz], i) => {
      const x = screenX(prop.x + lx * cos - lz * sin);
      const y = screenY(prop.z + lx * sin + lz * cos);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };

  // The seeded pieces first and faint: there can be hundreds, and none of them
  // is a thing the operator clicks.
  ctx.strokeStyle = '#4a6a4e';
  ctx.lineWidth = 1;
  for (const piece of placements.scattered) {
    traceFootprint(piece);
    ctx.stroke();
  }

  // Solid pieces are FILLED and decorative ones hollow: whether a piece stops a
  // machine is the one thing about it that is not visible from its shape.
  //
  // The KEYS are written beside the pieces that have room for one. A zoom
  // threshold alone stopped being enough the moment one gesture could lay a row:
  // eleven lanterns eight yards apart are eleven labels on top of each other.
  const named = view.scale > PROP_LABEL_MIN_SCALE;
  const labelled = named
    ? labelledPieces(placements.props.map((prop) => ({ x: screenX(prop.x), y: screenY(prop.z) })))
    : [];
  for (const [index, prop] of placements.props.entries()) {
    const chosen = dressing?.kind === 'prop' && dressing.index === placed[index];
    ctx.strokeStyle = chosen ? planPalette.pick : prop.solid ? '#e0a86f' : '#8fb2d8';
    ctx.lineWidth = chosen ? 2 : 1;
    traceFootprint(prop);
    if (prop.solid) {
      ctx.fillStyle = chosen ? PICK_FILL : 'rgba(224, 168, 111, 0.25)';
      ctx.fill();
    }
    ctx.stroke();
    if (!labelled[index]) continue;
    ctx.fillStyle = planPalette.muted;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(prop.asset, screenX(prop.x) + 6, screenY(prop.z) - 6);
  }

  // A selected prop gets its two grips: the corner that resizes it, and the ring
  // beyond its outline that turns it. The ring sits on the piece's own facing,
  // so it is also the only mark on the plan that says which way it points.
  const selectedPlaced = selectedPlacedProp();
  if (selectedPlaced) {
    const grips = propHandlePoints(selectedPlaced);
    ctx.save();
    ctx.strokeStyle = planPalette.pick;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenX(selectedPlaced.x), screenY(selectedPlaced.z));
    ctx.lineTo(screenX(grips.rotate.x), screenY(grips.rotate.z));
    ctx.stroke();
    ctx.fillStyle = planPalette.pick;
    ctx.beginPath();
    ctx.arc(screenX(grips.rotate.x), screenY(grips.rotate.z), 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(screenX(grips.scale.x) - 4, screenY(grips.scale.z) - 4, 8, 8);
    ctx.restore();
  }

  // A selected pond gets its handles; the outline itself is drawn with the
  // surfaces, because it is water whatever mode the tool is in.
  if (dressing?.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (pond) {
      ctx.fillStyle = planPalette.pick;
      for (const handle of Object.values(pondHandlePoints(pond))) {
        ctx.beginPath();
        ctx.arc(screenX(handle.x), screenY(handle.z), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The GHOST: what the next click will put down, where it will put it, and
  // whether the readout will accept it. The verdict comes from the readout's own
  // predicate, so a ghost that reads green cannot be a placement the panel then
  // refuses.
  const ghost = cursorGhost();
  if (ghost) {
    const legality = placementLegality(record, ghost);
    const tint = planPalette[placementTint(legality?.severity)];
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = tint;
    ctx.lineWidth = 1.5;
    traceFootprint(ghost);
    ctx.stroke();
    if (legality && legality.severity !== 'ok') {
      ctx.fillStyle = withAlpha(tint, 0.3);
      ctx.fill();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = tint;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    const lines = [ghost.asset];
    if (ghostSnap) lines.push(`snap: ${ghostSnap.label}`);
    if (legality) lines.push(legality.label);
    lines.forEach((line, i) => {
      ctx.fillText(line, screenX(ghost.x) + 8, screenY(ghost.z) - 8 + i * 12);
    });
    ctx.restore();
  }

  // The row a drag along the road is laying, before it is committed. Resolved
  // through the same one resolver as everything else here, so the preview is the
  // row: a dozen dots worked out on the side would be the ghost's own defect
  // class, twelve times over.
  if (roadRunPreview.placed.length > 0) {
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.lineWidth = 1.5;
    roadRunPreview.placed.forEach((piece, index) => {
      ctx.strokeStyle = planPalette[placementTint(roadRunPreview.severity[index])];
      traceFootprint(piece);
      ctx.stroke();
    });
    ctx.restore();
  }

  if (dressingRect) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = planPalette.warn;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      screenX(Math.min(dressingRect.x0, dressingRect.x1)),
      screenY(Math.min(dressingRect.z0, dressingRect.z1)),
      Math.abs(dressingRect.x1 - dressingRect.x0) * view.scale,
      Math.abs(dressingRect.z1 - dressingRect.z0) * view.scale,
    );
    ctx.restore();
  }
}

/**
 * The land's own edge, and the handles that shape it.
 *
 * The SAMPLED curve rather than the authored points, for the reason every view
 * on this page draws what the resolver returned: a closed centripetal
 * Catmull-Rom does not pass through its control points, so a plan drawing the
 * polygon would show a shore the game does not cut. The handles are drawn on
 * top, because they are what a drag grabs.
 *
 * Nothing at all on a circuit that authors no shape: its land is the rectangle
 * that covers the whole region and then some, which is off the plan at any zoom
 * a road is legible at and would read as a second enclosure if it were not.
 */
function drawGroundOutline(): void {
  const authored = record.groundOutline;
  if (authored?.length) {
    ctx.strokeStyle = '#4d7fa0';
    ctx.lineWidth = 2;
    tracePolygon(realmRacersGroundShape(record).outline);
    ctx.stroke();
    if (tool() === 'terrain') {
      authored.forEach((point, i) => {
        ctx.fillStyle = i === groundPoint ? planPalette.pick : '#8fc0dc';
        ctx.beginPath();
        ctx.arc(screenX(point.x), screenY(point.z), i === groundPoint ? 5 : 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
  if (groundStroke.length < 2) return;
  // The raw loop, faint, under the fit that will replace it: the same pairing
  // the centerline stroke draws, and for the same reason.
  ctx.strokeStyle = '#8fc0dc';
  ctx.lineWidth = 1;
  ctx.beginPath();
  groundStroke.forEach((point, i) => {
    const x = screenX(point.x);
    const y = screenY(point.z);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = plan;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = planPalette.bg;
  ctx.fillRect(0, 0, width, height);
  drawGridLines();

  // The named boxes come first and come in BOTH states: the volume is the one
  // mark on this canvas that never moves, and an operator who has just drawn a
  // circuit needs it exactly as much as one who has not.
  drawBearings();
  if (!drawn) {
    // Nothing else of the placeholder record is drawn, so a blank canvas really
    // is blank: just the room a circuit has, and the live stroke so a gesture is
    // visible as it happens.
    drawStroke();
    return;
  }
  // The land first, under everything standing on it.
  drawGroundOutline();
  drawSurfaces();
  drawGates();
  drawPickupRows();
  drawStroke();
  if (tool() === 'race') drawPickupGhost();
  // The barriers draw under EVERY tool, unlike the dressing: they are what a
  // circuit's edge is made of, so a road being widened or a row being laid is
  // being judged against them.
  drawFences();
  if (tool() === 'props') drawDressing();
  else if (tool() !== 'terrain') drawHandles();
  drawProblemMarkers();
}

// ---- the race furniture gesture ----

/**
 * One click in the RACE tool.
 *
 * The row under the pointer is picked up FIRST, whether or not the palette is
 * armed, exactly as the props tool hit tests before it places: clicking a row
 * that is already there means that row, never a second one on top of it.
 *
 * With nothing under the pointer, what happens depends on the tool's STATE and
 * that is the whole of this change. The pointer state authors nothing at all,
 * because a click that hit nothing is a miss or a deliberate deselect and both
 * used to lay a row a few yards from the one the operator meant. Only an armed
 * palette places, and its two refusals (off the road, too near an existing row)
 * are still reported by name.
 */
function startRaceFurnitureGesture(raw: RallyPoint): void {
  if (!drawn) return;
  const hit = pickupRowAtPoint(record, raw.x, raw.z, dressingTolerance());
  if (hit >= 0) {
    pickupSelection = hit;
    // The undo snapshot is taken at the PRESS, so a drag that follows is one step
    // back rather than one per pointermove. A press that turns out to be a plain
    // click leaves a snapshot of a record nothing changed, which the history core
    // is free to hold: it is a state the operator can return to.
    pushUndo();
    pickupDragging = true;
    setStatus(`pickup row ${hit + 1} selected: drag or arrow it along the lap, del removes it`, '');
    applySideTab();
    requestRedraw();
    return;
  }
  if (racePalette.armed === null) {
    pickupSelection = null;
    applySideTab();
    requestRedraw();
    return;
  }
  const fraction = pickupRowFractionAt(record, raw.x, raw.z);
  if (fraction === null) {
    setStatus('a pickup row is laid ON the road: click inside the road edge', 'err');
    return;
  }
  const added = addPickupRow(record.pickupRows ?? [], fraction);
  if (added.outcome === 'tooClose') {
    pickupSelection = added.index;
    setStatus(`there is already a pickup row here (row ${added.index + 1})`, 'err');
    applySideTab();
    requestRedraw();
    return;
  }
  if (added.outcome === 'full') {
    setStatus('this circuit already carries every pickup row it may', 'err');
    return;
  }
  commit({ ...record, pickupRows: added.rows });
  pickupSelection = added.index;
  setStatus(`pickup row at ${(fraction * track.length).toFixed(0)} yd`, 'ok');
  applySideTab();
  requestRedraw();
}

/**
 * Take the selected row to a lap fraction.
 *
 * The selection follows the RETURNED index rather than keeping the one it had:
 * the list is sorted by lap position, so a move that carries a row past a
 * neighbour renumbers both, and a selection that stayed put would be pointing at
 * whichever row moved into the hole.
 *
 * `remember` is false for every step of a drag, because the press already
 * snapshotted: one gesture is one step back.
 */
function movePickupRow(fraction: number, remember = true): void {
  if (pickupSelection === null) return;
  const moved = movedPickupRow(record.pickupRows ?? [], pickupSelection, fraction);
  if (moved.outcome === 'blocked') {
    setStatus('there is no room left on this lap to move that row to', 'err');
    return;
  }
  commit({ ...record, pickupRows: moved.rows }, remember);
  pickupSelection = moved.index;
  const row = moved.rows[moved.index];
  setStatus(`pickup row ${moved.index + 1} at ${(row.s * track.length).toFixed(0)} yd`, 'ok');
  // No `applySideTab` here, unlike the sites that select or deselect: which tab
  // is up cannot change during a move, and this runs once per pointermove. The
  // inspector still follows, because every repaint paints it.
  requestRedraw();
}

/** One arrow key on the selected row: a step in YARDS along the lap, which is
 *  why it goes through the core rather than adding a fraction here. */
function nudgePickupRow(direction: 1 | -1, big: boolean): void {
  if (pickupSelection === null) return;
  const row = (record.pickupRows ?? [])[pickupSelection];
  if (!row) return;
  movePickupRow(nudgedPickupFraction(row.s, track.length, direction, big));
}

/** Removes the selected row, and drops the selection with it: every index after
 *  it shifts, so a selection that survived would point at its neighbour. */
function deletePickupRow(): void {
  if (pickupSelection === null) return;
  commit({ ...record, pickupRows: removedPickupRow(record.pickupRows ?? [], pickupSelection) });
  pickupSelection = null;
  setStatus('pickup row removed', 'ok');
  applySideTab();
  requestRedraw();
}

// ---- the terrain gestures ----

/** Click tolerance for a barrier point: yards at zoom 1, over the zoom, so a
 *  corner stays grabbable at any zoom. The same shape as the dressing's own. */
const fenceTolerance = (): number => FENCE_POINT_TOLERANCE_YD / view.scale;

/**
 * One click in the TERRAIN tool.
 *
 * The barrier under the pointer is picked up FIRST, whether or not the palette
 * is armed, which is the props tool's hit-test-first order: clicking a run that
 * is already there means that run, never a new point on top of it. Only with
 * nothing under the pointer does the tool's STATE decide, and the pointer state
 * authors nothing at all.
 *
 * A DRAWING gesture is the exception to the first rule, and it has to be: every
 * click after the first lands within tolerance of the run being drawn, so
 * hit-testing first would make the second point select the barrier instead of
 * extending it. While a draft is open every click goes to the draft.
 */
function startTerrainGesture(raw: RallyPoint): void {
  if (!drawn) return;
  // The GROUND is armed with one gesture and one only: a freehand loop. It is
  // tested before the barriers for the reason a drawing run is: a stroke that
  // began on top of a fence is still a stroke.
  if (groundArmed) {
    startGroundStroke(raw);
    return;
  }
  if (fenceDraft) {
    const step = fenceDraftClick(fenceDraft, raw.x, raw.z, fenceTolerance());
    if (step.kind === 'ignored') {
      setStatus(step.reason, 'err');
      return;
    }
    if (step.kind === 'point') {
      fenceDraft = step.draft;
      // The HELD line rather than a transient one: "am I still drawing, and how
      // many points have I put down" is a question about state, which a message
      // that scrolls away cannot answer.
      announceArmed(terrainPalette.armed);
      return;
    }
    commitFence(step.fence, 'closed ring');
    return;
  }
  const hit = fenceHitAt(record, raw.x, raw.z, fenceTolerance());
  if (hit) {
    fenceSelection = hit.fence;
    fencePoint = hit.point;
    fenceDragging = hit.point !== null;
    // One selection at a time in this tool: a ground handle left selected under
    // a barrier would answer `del` with whichever branch ran first.
    groundPoint = null;
    // The undo snapshot is taken at the PRESS, so a drag that follows is one
    // step back rather than one per pointermove.
    if (hit.point !== null) pushUndo();
    setStatus(
      hit.point === null
        ? `barrier ${hit.fence + 1} selected: del removes it`
        : `barrier ${hit.fence + 1}, point ${hit.point + 1}: drag to move it, del removes it`,
      '',
    );
    applySideTab();
    requestRedraw();
    return;
  }
  const kit = terrainPalette.armed;
  // With nothing armed, POINTS come before CURVES, which is the rule the ground
  // gesture already keeps inside itself and the reason it is split open here.
  // Measured, on both shipped circuits after their own two fits: `Fit ground`
  // proposes the shore at road + 26 and `Fit wall` sizes the box at road + 20,
  // so the land's curve passes within 4.3 to 6.2 yards of the wall's four edge
  // grips, and the curve's click tolerance is the WIDER of the two. Testing the
  // whole ground gesture first therefore answered a click landing dead on a grip
  // by inserting a ground handle instead, which is destructive rather than
  // inert: four of the eight grips were unreachable at any working zoom.
  const ground = kit === null ? groundHitOf(raw) : null;
  if (ground?.kind === 'handle') {
    takeGroundHandle(ground.index);
    return;
  }
  if (kit === null && startWallGesture(raw)) return;
  if (ground) {
    insertGroundHandle(ground);
    return;
  }
  if (kit === null) {
    fenceSelection = null;
    groundPoint = null;
    applySideTab();
    requestRedraw();
    return;
  }
  fenceDraft = { kit, points: [{ x: raw.x, z: raw.z }] };
  fenceSelection = null;
  // The point index goes with the selection: left behind, it survived into the
  // freshly drawn fence's selection and `del` removed a point of the NEW fence.
  fencePoint = null;
  groundPoint = null;
  announceArmed(kit);
}

/** Put a finished run on the record and select it. One commit, so the whole
 *  drawing gesture is one step back. */
function commitFence(fence: RallyFence, how: string): void {
  const added = addFence(record.fences ?? [], fence);
  fenceDraft = null;
  announceArmed(terrainPalette.armed);
  if (!added) {
    setStatus('this circuit already carries every barrier it may', 'err');
    requestRedraw();
    return;
  }
  commit({ ...record, fences: added.fences });
  fenceSelection = added.index;
  setStatus(`${barrierKitLabel(fence.kit)} placed, ${how}`, 'ok');
  applySideTab();
  requestRedraw();
}

/** Finish the run being drawn as an OPEN one: the enter key, and the inspector's
 *  own button. A run of one point is not a run, and says so. */
function finishFenceDrawing(): void {
  if (!fenceDraft) return;
  const fence = finishFenceDraft(fenceDraft);
  if (!fence) {
    fenceDraft = null;
    setStatus('a barrier needs at least two points', 'err');
    applySideTab();
    requestRedraw();
    return;
  }
  commitFence(fence, 'open run');
}

/** Drag one authored point. `remember` is false through a drag: the press
 *  already snapshotted, so one gesture is one step back. */
function moveFencePointTo(x: number, z: number): void {
  if (fenceSelection === null || fencePoint === null) return;
  commit(
    { ...record, fences: moveFencePoint(record.fences ?? [], fenceSelection, fencePoint, x, z) },
    false,
  );
  requestRedraw();
}

/** One arrow key: the map editor's own step sizes, so a nudge means the same
 *  thing in both tools. Moves the POINT when one is held and the whole run
 *  otherwise, which is what the selection already says. */
function nudgeFence(dx: number, dz: number): void {
  if (fenceSelection === null) return;
  const fences = record.fences ?? [];
  const next =
    fencePoint === null
      ? moveFence(fences, fenceSelection, dx, dz)
      : (() => {
          const point = fences[fenceSelection]?.points[fencePoint];
          return point
            ? moveFencePoint(fences, fenceSelection, fencePoint, point.x + dx, point.z + dz)
            : fences;
        })();
  commit({ ...record, fences: next });
  requestRedraw();
}

/**
 * `del` on a barrier: the POINT when one is held, the whole run otherwise.
 *
 * Removing the last point but two takes the whole barrier with it, in the core:
 * a run needs two points, so refusing there would leave `del` doing nothing on
 * the commonest barrier there is, a single straight run.
 */
function deleteFenceSelection(): void {
  if (fenceSelection === null) return;
  const fences = record.fences ?? [];
  const before = fences.length;
  const next =
    fencePoint === null
      ? removeFence(fences, fenceSelection)
      : removeFencePoint(fences, fenceSelection, fencePoint);
  commit({ ...record, fences: next });
  if (next.length < before) {
    fenceSelection = null;
    fencePoint = null;
    setStatus('barrier removed', 'ok');
  } else {
    fencePoint = null;
    setStatus('point removed', 'ok');
  }
  applySideTab();
  requestRedraw();
}

/** Cancel a run being drawn, which is what `esc` means while one is open. */
function cancelFenceDrawing(): boolean {
  if (!fenceDraft) return false;
  fenceDraft = null;
  setStatus('run cancelled', '');
  announceArmed(terrainPalette.armed);
  return true;
}

/**
 * Slide the whole circuit so the road sits in the middle of its enclosure.
 *
 * Every circuit-local thing moves by the same offset, which is the core's own
 * rule and the reason this is one call rather than four: moving the road alone
 * would walk it out from under its own dressing.
 */
function centerCircuit(): void {
  const offset = centerCircuitOffset(record);
  if (Math.abs(offset.dx) < 0.05 && Math.abs(offset.dz) < 0.05) {
    setStatus('the circuit is already centred in its enclosure', '');
    return;
  }
  commit(moveCircuitContent(record, offset.dx, offset.dz));
  setStatus(`circuit moved ${offset.dx.toFixed(1)}, ${offset.dz.toFixed(1)} yd to centre it`, 'ok');
  requestRedraw();
}

// ---- the ground shape gesture ----

/**
 * One click in TERRAIN with the GROUND armed: the start of a freehand loop.
 *
 * The circuit's own gesture, deliberately, down to the module it fits with: the
 * land is a closed smoothed curve exactly as the centerline is, so an operator
 * who has drawn one has drawn both. What follows the release is the same known
 * behaviour too: a closed centripetal Catmull-Rom does not pass through the
 * stroke, so the plan draws the raw loop faint under the derived one.
 */
function startGroundStroke(raw: RallyPoint): void {
  groundStroke = [raw];
  groundDrawing = true;
  groundPoint = null;
}

/**
 * Arm or disarm the ground, and say so everywhere it is said.
 *
 * Mutually exclusive with the kit palette by construction rather than by
 * discipline: two armed gestures would make the next click ambiguous, and a run
 * left half drawn under a stroke is a thing on screen no gesture can finish.
 */
function setGroundArmed(on: boolean): void {
  groundArmed = on;
  if (on) {
    if (terrainPalette.armed !== null) terrainPalette.arm(null);
    fenceDraft = null;
    groundPoint = null;
  } else if (groundDrawing) {
    groundDrawing = false;
    groundStroke = [];
  }
  shell.setChecked('drawGround', on);
  announceArmed(terrainPalette.armed);
  requestRedraw();
}

/** The release: fit the loop, put it on the record, and hand the pointer back so
 *  the handles it just made are editable without a trip to the palette. */
function finishGroundStroke(): void {
  groundDrawing = false;
  const fitted = fitStrokeToControlPoints(groundStroke);
  groundStroke = [];
  if (fitted.length < MIN_CONTROL_POINTS) {
    setStatus('stroke too short to shape the ground: draw a bigger loop', 'err');
    requestRedraw();
    return;
  }
  commit({ ...record, groundOutline: fitted });
  groundPoint = null;
  // The arm is spent: the shape now has handles, and editing them is what an
  // operator does next. Re-arming is one click on the same chip.
  setGroundArmed(false);
  setStatus(`ground shape fitted to ${fitted.length} handles`, 'ok');
  applySideTab();
  requestRedraw();
}

/**
 * A click on the ground shape, with nothing armed: its handles, and the curve
 * between two of them.
 *
 * The control ring's own grammar and the control ring's own core
 * (`handles_core.ts`), because it is the same object: a click on a handle grabs
 * it, a click on the line inserts one there, `del` removes one. Returns whether
 * the click was the ground's, so the caller can go on to deselect.
 */
function groundHitOf(raw: RallyPoint): GroundHit | null {
  const outline = record.groundOutline;
  if (!outline || outline.length === 0) return null;
  // Which of the two it was is `ground_core.ts`'s call, not the page's. It was
  // decided twice until packet 28: the core carried the order a test could
  // reach, and this function carried a second copy of it that is what actually
  // ran, which is the one arrangement where a green test proves nothing.
  return groundHitAt(
    outline,
    raw.x,
    raw.z,
    HIT_TOLERANCE_PIXELS.handle / view.scale,
    HIT_TOLERANCE_PIXELS.segment / view.scale,
  );
}

/** Pick up a ground handle. The undo snapshot is taken at the PRESS, so the drag
 *  that follows is one step back rather than one per pointermove. */
function takeGroundHandle(index: number): void {
  groundPoint = index;
  groundDragging = true;
  pushUndo();
  fenceSelection = null;
  fencePoint = null;
  setStatus(`ground handle ${index + 1}: drag to move it, del removes it`, '');
  applySideTab();
  requestRedraw();
}

/** Add one on the curve between two handles, and hand it straight to the drag. */
function insertGroundHandle(hit: Extract<GroundHit, { kind: 'insert' }>): void {
  const outline = record.groundOutline;
  if (!outline) return;
  commit({
    ...record,
    groundOutline: insertControlPoint(outline, hit.index, authored(hit.at)),
  });
  groundPoint = hit.index + 1;
  groundDragging = true;
  fenceSelection = null;
  fencePoint = null;
  setStatus('ground handle inserted', 'ok');
  applySideTab();
  requestRedraw();
}

// ---- the wall gesture ----

/**
 * One click on the WALL, with nothing armed: its eight grips, and its centre.
 *
 * Returns whether the click was the wall's, so the caller can go on to whatever
 * else a click can mean. The undo snapshot is taken at the PRESS, like every
 * other drag in this tool, so one gesture is one step back rather than one per
 * pointermove.
 */
function startWallGesture(raw: RallyPoint): boolean {
  const hit = enclosureHitAt(
    record.perimeter.halfX,
    record.perimeter.halfZ,
    raw.x,
    raw.z,
    HIT_TOLERANCE_PIXELS.handle / view.scale,
  );
  if (!hit) return false;
  pushUndo();
  fenceSelection = null;
  fencePoint = null;
  groundPoint = null;
  // The right column follows, like every other branch here: dropping three
  // selections without it leaves an inspector up for nothing.
  applySideTab();
  if (hit.kind === 'move') {
    wallMove = { x: raw.x, z: raw.z, from: record };
    setStatus('drag to slide the whole circuit inside its wall', '');
    requestRedraw();
    return true;
  }
  // The pointer's offset from the grip goes with it, so the box follows the
  // drag instead of snapping its edge under the pointer on the first move.
  wallGrip = enclosureGrab(hit.grip, raw.x, raw.z);
  // What the drag is about to do to the OTHER side, said once at the press: the
  // record holds one half-extent per axis, so there is no version of this
  // gesture that moves the edge under the pointer alone.
  setStatus(`wall ${hit.grip.id}: drag to resize, both sides move together`, '');
  requestRedraw();
  return true;
}

/** Drag a wall grip. `remember` is false through the drag: the press already
 *  snapshotted. */
function resizeWallTo(x: number, z: number): void {
  if (!wallGrip) return;
  const perimeter = enclosureResized(record.perimeter, wallGrip, x, z);
  commit({ ...record, perimeter }, false);
  form.sync();
  setStatus(`wall ${perimeter.halfX * 2} x ${perimeter.halfZ * 2} yd`, '');
  requestRedraw();
}

/**
 * Drag the circuit inside its wall.
 *
 * Everything circuit-local moves together through the one core that knows what
 * "everything" is (`moveCircuitContent`): moving the road alone would walk it
 * out from under its own dressing.
 *
 * The offset is applied to the record as it stood at the PRESS, every move,
 * rather than stepped from the last frame. Stepping is the obvious shape and it
 * DRIFTS: a commit rounds the control points, so a slow drag across the plan is
 * a hundred separate roundings compounding in whatever direction the pointer was
 * going. Measured from the press there is exactly one rounding, of the total.
 */
function moveCircuitTo(x: number, z: number): void {
  if (!wallMove) return;
  const press = { x: wallMove.x, z: wallMove.z };
  commit(circuitMovedFromPress(wallMove.from, press, { x, z }), false);
  setStatus(
    `circuit moved ${(x - press.x).toFixed(1)}, ${(z - press.z).toFixed(1)} yd inside its wall`,
    '',
  );
  requestRedraw();
}

/** Drag one handle. `remember` is false through the drag: the press already
 *  snapshotted, so one gesture is one step back. */
function moveGroundPointTo(x: number, z: number): void {
  const outline = record.groundOutline;
  if (!outline || groundPoint === null) return;
  commit({ ...record, groundOutline: moveControlPoint(outline, groundPoint, { x, z }) }, false);
  requestRedraw();
}

/**
 * `del` on a ground handle.
 *
 * It goes through `deleteControlPoint`, so it refuses below the same floor the
 * centerline keeps: a closed loop with fewer handles than that is not a shape
 * the curve can be read from, and the way to get rid of a ground shape is to
 * discard the whole thing rather than to whittle it down to nothing.
 */
function deleteGroundPoint(): void {
  const outline = record.groundOutline;
  if (!outline || groundPoint === null) return;
  const next = groundPointRemoved(outline, groundPoint);
  if (!next) {
    setStatus(
      `a ground shape needs ${MIN_GROUND_POINTS} handles: delete the whole shape instead`,
      'err',
    );
    return;
  }
  commit({ ...record, groundOutline: next });
  groundPoint = null;
  setStatus('ground handle removed', 'ok');
  applySideTab();
  requestRedraw();
}

/** Discard the shape: the land goes back to the rectangle that covers the whole
 *  region, which is what a circuit authoring none has always had. */
function removeGroundShape(): void {
  if (!record.groundOutline) return;
  const next = { ...record };
  delete (next as { groundOutline?: readonly RallyPoint[] }).groundOutline;
  commit(next);
  groundPoint = null;
  setStatus('ground shape removed: the land covers the whole region again', 'ok');
  applySideTab();
  requestRedraw();
}

/**
 * `Fit ground`: propose a shape around the road.
 *
 * The repair beside `Fit enclosure`, and the same kind of thing: it answers the
 * question an operator would otherwise answer by drawing, and the answer is then
 * dragged. It replaces whatever shape is there, so it is one undo step.
 */
function fitGround(): void {
  const outline = suggestGroundOutline(record);
  if (outline.length < MIN_CONTROL_POINTS) {
    setStatus('this road is too small to fit a ground shape around', 'err');
    return;
  }
  commit({ ...record, groundOutline: outline });
  groundPoint = null;
  setStatus(`ground fitted to the road: ${outline.length} handles`, 'ok');
  applySideTab();
  requestRedraw();
}

// ---- the dressing gestures ----

/** Click tolerance in yards, so a bench is grabbable at any zoom. */
const dressingTolerance = (): number => HIT_TOLERANCE_PIXELS.dressing / view.scale;

/**
 * The row an along-road drag is currently describing, and where its pieces land.
 *
 * Cached per POINTER MOVE rather than recomputed per repaint, which is what it
 * logically is: the walk is up to a couple of thousand spline samples, the
 * resolve rebuilds a whole placement set, and each previewed piece costs an
 * unhinted projection to judge. Per frame that is a drag that stops answering on
 * a big circuit; per move it is once per thing the operator actually did.
 */
let roadRunPreview: {
  props: RallyProp[];
  placed: RallyPlacedProp[];
  severity: (PlacementLegality['severity'] | undefined)[];
} = {
  props: [],
  placed: [],
  severity: [],
};

function buildRoadRun(): RallyProp[] {
  const armed = library.armed;
  if (!roadRun || !hover || !armed || armed === POND_CHOICE) return [];
  return alongRoadProps(record, roadRun.fromS, lapPositionAt(record, hover.x, hover.z), {
    asset: armed,
    spacing: placement.spacing,
    offset: roadRun.offset,
    alignToRoad: placement.alignToRoad,
    solid: placement.solid,
  }).props;
}

function refreshRoadRunPreview(): void {
  const props = buildRoadRun();
  const placed = props.length > 0 ? ghostRowPlacements(record, props) : [];
  roadRunPreview = {
    props,
    placed,
    severity: placed.map((piece) => placementLegality(record, piece)?.severity),
  };
}

/** The record with one dressing list replaced, committed. */
function commitDressing(next: Partial<RealmRacersCircuit>, remember = true): void {
  // A pond is the only thing on a circuit that needs the basin, and the record
  // requires the two to agree: authoring the first pond brings the water back
  // and deleting the last one takes it away, so neither is a second step the
  // operator has to remember (and the save endpoint refuses either half alone).
  const ponds = 'ponds' in next ? next.ponds : record.ponds;
  const basin = (ponds?.length ?? 0) > 0 ? (record.basin ?? rememberedBasin) : undefined;
  commit({ ...record, ...next, basin }, remember);
}

function startDressingGesture(raw: RallyPoint, rect: boolean): void {
  const placements = realmRacersPlacements(record);
  const tolerance = dressingTolerance();

  // A selected PROP's grips come first, for the reason the pond's do: the scale
  // grip sits on the piece's own outline, so hit-testing the piece before it
  // would turn every resize into a move.
  if (dressing?.kind === 'prop') {
    const placed = selectedPlacedProp();
    const handle = placed && hitTestPropHandle(placed, raw.x, raw.z, tolerance);
    if (placed && handle) {
      pushUndo();
      dressingDrag = 'prop';
      propHandle = handle;
      propGrab = placed;
      return;
    }
  }

  // A selected pond's handles come first: they sit ON the pond, so hit-testing
  // the shape before them would make a resize impossible.
  if (dressing?.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    const handle = pond && hitTestPondHandle(pond, raw.x, raw.z, tolerance);
    if (pond && handle) {
      pushUndo();
      dressingDrag = 'pond';
      pondHandle = handle;
      return;
    }
  }

  // Hit testing reads the RAW pointer: what is under the finger is under the
  // finger whether or not the next placement will be rounded to the grid.
  const hitProp = hitTestPlaced(placements.props, raw.x, raw.z, tolerance);
  if (hitProp >= 0) {
    const index = placedPropIndices(record.props, REALM_RACERS_PROPS)[hitProp];
    dressing = { kind: 'prop', index };
    pushUndo();
    dressingDrag = 'move';
    const grabbed = (record.props ?? [])[index];
    dragHint = propProjectionHint(record, grabbed);
    dragFrame = propFrameOf(grabbed);
    applySideTab();
    requestRedraw();
    return;
  }
  const hitPond = hitTestPonds(placements.ponds, raw.x, raw.z);
  if (hitPond >= 0) {
    dressing = { kind: 'pond', index: hitPond };
    pushUndo();
    dressingDrag = 'move';
    applySideTab();
    requestRedraw();
    return;
  }

  // Nothing under the pointer, and nothing armed: the click was a miss, or a
  // deliberate deselect. Either way it must not author anything.
  const armed = library.armed;
  if (armed === null) {
    dressing = null;
    applySideTab();
    requestRedraw();
    return;
  }

  // Nothing under the pointer: this is a placement, and WHICH placement is the
  // library's placement block. Water is always a box, whatever the mode says,
  // because a pond has no other shape to be dragged out as.
  const boxed = rect || armed === POND_CHOICE || placement.mode === 'scatter';
  if (boxed) {
    const point = authored(raw);
    dressingRect = { x0: point.x, z0: point.z, x1: point.x, z1: point.z };
    dressingDrag = 'rect';
    return;
  }
  if (placement.mode === 'alongRoad') {
    pushUndo();
    // The offset the whole row inherits comes from the SNAPPED start, not from
    // the raw pointer: a drag begun on the road would otherwise lay every piece
    // of the row on the racing surface, which is eight identical errors out of
    // one gesture. `alt` still overrules it, so a deliberate infield row is one
    // key away.
    const start = resolveSnap(record, raw.x, raw.z, { grid: layout.snap, free: altHeld });
    roadRun = {
      fromS: lapPositionAt(record, start.x, start.z),
      offset: lateralAt(record, start.x, start.z),
    };
    dressingDrag = 'road';
    return;
  }
  placeOne(raw);
}

/**
 * One piece, where the pointer says and at the yaw the ghost was showing.
 *
 * Shared by the click, the tile drop and nothing else: the ghost's whole promise
 * is that what it drew is what lands, so the snap and the yaw are resolved here
 * exactly as `cursorGhost` resolves them.
 */
function placeOne(raw: RallyPoint): void {
  const armed = library.armed;
  if (!armed || armed === POND_CHOICE) return;
  const snap = resolveSnap(record, raw.x, raw.z, { grid: layout.snap, free: altHeld });
  const authoredAt = authorPlacement(record, snap.x, snap.z);
  const piece: RallyProp = { asset: armed, at: authoredAt.at };
  if (pendingYaw !== null) piece.yaw = pendingYaw;
  if (!placement.solid) piece.collide = 'none';
  const props = [...(record.props ?? []), piece];
  dressing = { kind: 'prop', index: props.length - 1 };
  dressingDrag = 'move';
  dragHint = authoredAt.hint;
  dragFrame = propFrameOf(piece);
  commitDressing({ props });
  applySideTab();
  const legality = placementLegality(
    record,
    ghostPlacement(record, armed, snap.x, snap.z, pendingYaw ?? undefined),
  );
  // A warning says its piece on the racing surface too: what changes with the
  // severity is the CHANNEL, not whether the operator is told.
  const verdict = legality && legality.severity !== 'ok' ? `, ${legality.label}` : '';
  setStatus(
    `placed ${armed} (${propFrameOf(piece)}, snap: ${snap.label}${verdict})`,
    legality && !legality.legal ? 'err' : 'ok',
  );
}

/**
 * Where a dressing drag has got to.
 *
 * `free` is the shift key AS OF THIS MOVE rather than as of the press, because
 * what it means here is "do not step this rotation", which is a decision the
 * operator makes while watching the piece turn.
 */
function moveDressingGesture(raw: RallyPoint, free = false): void {
  const point = authored(raw);
  if (dressingDrag === 'prop' && propHandle && dressing?.kind === 'prop') {
    const prop = selectedProp();
    if (!prop || !propGrab) return;
    // The RAW pointer: a grip drag authors an angle or a ratio, and neither is a
    // coordinate the grid has anything to say about. Against the placement the
    // PRESS captured, never a fresh resolve: an explicit collide footprint keeps
    // a constant reach while the scale grows, so a ratio read against the entry
    // the last move committed compounds on every pointermove.
    commitDressing(
      {
        props: replacedAt(
          record.props,
          dressing.index,
          propWithHandleAt(prop, propGrab, propHandle, raw.x, raw.z, free),
        ),
      },
      false,
    );
    return;
  }
  if (dressingDrag === 'road') {
    // Nothing is committed until the release: the row is rebuilt from the two
    // ends on every move, so dragging back over it shortens it rather than
    // stacking a second row on the first.
    refreshRoadRunPreview();
    requestRedraw();
    return;
  }
  if (dressingDrag === 'rect' && dressingRect) {
    dressingRect = { ...dressingRect, x1: point.x, z1: point.z };
    requestRedraw();
    return;
  }
  if (dressingDrag === 'pond' && pondHandle && dressing?.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (!pond) return;
    commitDressing(
      {
        ponds: replacedAt(
          record.ponds,
          dressing.index,
          pondWithHandleAt(pond, pondHandle, point.x, point.z),
        ),
      },
      false,
    );
    return;
  }
  if (dressingDrag !== 'move' || !dressing) return;
  if (dressing.kind === 'prop') {
    const prop = (record.props ?? [])[dressing.index];
    if (!prop) return;
    // The hint the move hands back anchors the next move's projection window to
    // wherever the drag has got to, and the frame is the PRESS's: both are what
    // keeps a long drag along the road track-space, and an excursion past the
    // envelope a decision the drop point makes rather than a latch.
    const moved = movedProp(record, prop, point.x, point.z, dragHint, dragFrame);
    dragHint = moved.hint;
    commitDressing({ props: replacedAt(record.props, dressing.index, moved.prop) }, false);
    return;
  }
  if (dressing.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (!pond) return;
    commitDressing(
      { ponds: replacedAt(record.ponds, dressing.index, { ...pond, x: point.x, z: point.z }) },
      false,
    );
  }
}

function endDressingGesture(): void {
  const armed = library.armed;
  if (dressingDrag === 'road' && roadRun && armed) {
    const row = roadRunPreview.props;
    if (row.length === 0) {
      setStatus('drag ALONG the road to lay a row', 'err');
    } else {
      const run = alongRoadProps(
        record,
        roadRun.fromS,
        lapPositionAt(record, hover?.x ?? 0, hover?.z ?? 0),
        {
          asset: armed,
          spacing: placement.spacing,
          offset: roadRun.offset,
          alignToRoad: placement.alignToRoad,
          solid: placement.solid,
        },
      );
      const props = [...(record.props ?? []), ...run.props];
      dressing = { kind: 'prop', index: props.length - 1 };
      // `false`: the undo snapshot was taken when the drag began, so the whole
      // row is one step back rather than one per piece.
      commitDressing({ props }, false);
      applySideTab();
      setStatus(`laid ${row.length} ${armed} at ${placement.spacing} yd`, 'ok');
    }
  }
  if (dressingDrag === 'rect' && dressingRect && armed) {
    const box = dressingRect;
    const dragged = Math.hypot(box.x1 - box.x0, box.z1 - box.z0);
    if (dragged < 2) {
      setStatus('drag a box: a scatter fills a stretch of one side, a pond fills the box', 'err');
    } else if (armed === POND_CHOICE) {
      const ponds = [
        ...(record.ponds ?? []),
        pondFromDrag(box.x0, box.z0, box.x1, box.z1, nextSeed(record)),
      ];
      dressing = { kind: 'pond', index: ponds.length - 1 };
      commitDressing({ ponds });
      setStatus(`placed a pond, ${ponds.length} on this circuit`, 'ok');
    } else {
      const spacing = placement.spacing;
      const scatter = scatterFromRect(record, box, armed, spacing, nextSeed(record));
      const scatters = [...(record.scatters ?? []), scatter];
      dressing = { kind: 'scatter', index: scatters.length - 1 };
      commitDressing({ scatters });
      // What a fill LANDED is the only useful readout: a scatter rejects every
      // piece that would sit on the racing surface or outside the wall, so the
      // count is nothing like the box divided by the spacing.
      setStatus(`scattered ${armed}: ${metrics.scatterCount} pieces at ${spacing} yd`, 'ok');
    }
    applySideTab();
  }
  dressingDrag = null;
  dressingRect = null;
  roadRun = null;
  roadRunPreview = { props: [], placed: [], severity: [] };
  pondHandle = null;
  propHandle = null;
  propGrab = null;
  dragHint = undefined;
  dragFrame = undefined;
  requestRedraw();
}

/** The selected prop, or null: every keyboard transform reads this. */
function selectedProp(): RallyProp | null {
  if (dressing?.kind !== 'prop') return null;
  return (record.props ?? [])[dressing.index] ?? null;
}

/** The same piece as the RESOLVER placed it: where it stands, which way it
 *  faces and how big its footprint came out. Every grip and every focus reads
 *  this rather than the record, for the reason the whole tool does: the one
 *  resolver decides where a piece is. */
function selectedPlacedProp(): RallyPlacedProp | null {
  if (dressing?.kind !== 'prop') return null;
  const placedIndex = placementIndexOf(record.props, REALM_RACERS_PROPS, dressing.index);
  return realmRacersPlacements(record).props[placedIndex] ?? null;
}

function transformSelectedProp(next: (prop: RallyProp) => RallyProp): void {
  const prop = selectedProp();
  if (!prop || dressing?.kind !== 'prop') return;
  commitDressing({ props: replacedAt(record.props, dressing.index, next(prop)) });
}

/**
 * Moves whatever is selected by one arrow-key step.
 *
 * A prop goes back through `movedProp`, so a nudged track-space piece is
 * re-framed by the same rule a dragged one is; a pond is a plain circuit-local
 * pair and moves by the delta. Scatters have no position to nudge: what they
 * have is a span, which the inspector owns.
 */
function nudgeDressing(key: NudgeKey, big: boolean): void {
  if (!dressing) return;
  const { dx, dz } = planNudge(key, big);
  if (dressing.kind === 'prop') {
    const prop = selectedProp();
    const placed = selectedPlacedProp();
    if (!prop || !placed) return;
    commitDressing({
      props: replacedAt(
        record.props,
        dressing.index,
        movedProp(record, prop, placed.x + dx, placed.z + dz, propProjectionHint(record, prop))
          .prop,
      ),
    });
    setStatus(`nudged ${prop.asset} ${Math.hypot(dx, dz).toFixed(1)} yd`, '');
    return;
  }
  if (dressing.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (!pond) return;
    commitDressing({
      ponds: replacedAt(record.ponds, dressing.index, { ...pond, x: pond.x + dx, z: pond.z + dz }),
    });
    return;
  }
  setStatus('a scatter is a stretch of lap, not a point: edit its span', 'err');
}

/**
 * A second copy of the selection, beside it and selected.
 *
 * Selecting the COPY rather than leaving the original armed is what makes a run
 * of them one gesture repeated: duplicate, nudge, duplicate, nudge. Leaving the
 * original selected would put every copy in the same place.
 */
function duplicateDressing(): void {
  if (!dressing) return;
  if (dressing.kind === 'prop') {
    const prop = selectedProp();
    const placed = selectedPlacedProp();
    if (!prop || !placed) return;
    const props = [
      ...(record.props ?? []),
      duplicatedProp(record, prop, placed.x, placed.z, propProjectionHint(record, prop)),
    ];
    dressing = { kind: 'prop', index: props.length - 1 };
    commitDressing({ props });
    applySideTab();
    setStatus(`duplicated ${prop.asset}`, 'ok');
    return;
  }
  if (dressing.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (!pond) return;
    const ponds = [...(record.ponds ?? []), duplicatedPond(pond)];
    dressing = { kind: 'pond', index: ponds.length - 1 };
    commitDressing({ ponds });
    applySideTab();
    setStatus(`duplicated pond, ${ponds.length} on this circuit`, 'ok');
    return;
  }
  setStatus('a scatter fills a stretch of road: drag another box instead', 'err');
}

/** Takes the plan, and the 3D dock with it, to a point on the circuit. The dock
 *  only when it is OPEN: pointing a camera nobody can see is work for nothing,
 *  and opening one uninvited is a half-megabyte rebuild the operator did not
 *  ask for. */
function lookAtPoint(point: RallyPoint): void {
  view.x = point.x;
  view.z = point.z;
  requestRedraw();
  if (preview && dock.open) {
    preview.lookAt(point.x, point.z);
    syncDockChrome();
  }
}

/** Frames whatever is selected. The point is the resolver's, never the record's:
 *  a track-space piece's own numbers are a lap fraction and an offset, which is
 *  not somewhere the plan can be centred. */
function focusDressing(selection: DressingSelection): void {
  const point = selectionFocusPoint(record, selection);
  if (!point) {
    setStatus('nothing to look at: that entry places nothing', 'err');
    return;
  }
  lookAtPoint(point);
  setStatus(`looking at ${selection.kind} ${selection.index}`, '');
}

/**
 * Deletes ONE entry, whether or not it is the selected one.
 *
 * The selection is dropped either way rather than kept and adjusted: removing an
 * entry shifts every index after it, so a selection that survived would be
 * pointing at the piece that moved up into the hole. That is the outliner's own
 * bug class, since its rows are the only place a piece other than the selected
 * one can be acted on.
 */
function removeDressing(target: DressingSelection): void {
  if (target.kind === 'prop') commitDressing({ props: removedAt(record.props, target.index) });
  if (target.kind === 'scatter') {
    commitDressing({ scatters: removedAt(record.scatters, target.index) });
  }
  if (target.kind === 'pond') commitDressing({ ponds: removedAt(record.ponds, target.index) });
  dressing = null;
  applySideTab();
}

/** Deletes whatever is selected, and drops the selection with it. */
function deleteDressing(): void {
  if (dressing) removeDressing(dressing);
}

// ---- the two repairs ----

/**
 * Sizes the WALL to the road, clamped to the band and the lane depth budget.
 * What makes a big circuit drawable at all: the wall follows the drawing rather
 * than the drawing being trapped inside the wall.
 *
 * It writes the instance volume too, and that is normalization rather than a
 * second decision: the region has exactly one legal value now (the ceiling), so
 * this is what brings a draft authored before that rule up to it. Nothing here
 * chooses the number, which is why the status line talks about the wall.
 */
function fitWall(): void {
  const { circuit, suggestion } = fittedCircuit(record, metrics.roadHalfX, metrics.roadHalfZ);
  commit(circuit);
  form.sync();
  const fitted = `wall ${suggestion.perimeter.halfX} x ${suggestion.perimeter.halfZ}`;
  // Whether a clamp MATTERED is not whether it happened: a clamp that only ate
  // into the dressing margin leaves a perfectly drivable circuit, and saying
  // "the circuit has to shrink" there would send the operator redrawing a
  // circuit that is fine. The road still fitting its wall is the real question,
  // and the readout has just answered it.
  const road = metrics.problems.some((problem) => problem.code === 'road_outside_perimeter');
  if (!road) {
    setStatus(`enclosure fitted: ${fitted}`, 'ok');
    return;
  }
  const reason = suggestion.clampedBy.includes('band')
    ? 'the instance band is only so wide'
    : 'two lanes would see each other';
  setStatus(`${fitted}: still too small, ${reason}, so the circuit has to shrink`, 'err');
}

/**
 * Narrows the road wherever a corner is tighter than it, in one pass over the
 * whole lap. Fixing those by hand is the thing that made authoring miserable:
 * the constraint is per sample, the road is authored as a few breakpoints, and
 * a corner's requirement appears in neither.
 */
function fixCorners(): void {
  const fix = suggestWidthBands(record);
  if (fix.narrowedYards > 0) {
    commit({ ...record, widthBands: fix.widthBands });
    form.sync();
  }
  const narrowed =
    fix.narrowedYards > 0
      ? `narrowed ${fix.narrowedYards.toFixed(0)} yd of road`
      : 'nothing to narrow';
  if (fix.remaining.length === 0) {
    setStatus(`${narrowed}: every corner clears its own road`, 'ok');
    return;
  }
  // The honest half. A corner under the road's own floor cannot be fixed by
  // narrowing at all, and saying so with the yardage is what lets the operator
  // go and open those corners up instead of hunting for a width that works.
  const where = fix.remaining.map((problem) => `${problem.s.toFixed(0)} yd`).join(', ');
  setStatus(
    `${narrowed}: ${fix.remaining.length} corner(s) too tight for any legal road, at ${where}. Widen the curve there.`,
    'err',
  );
}

// ---- the chrome ----

/** Which contextual panel is on screen. Null means the auto choice wins. */
let sideChoice: SideTabId | null = layout.side;

/** Whether the ACTIVE tool has something selected, which is what decides that
 *  the panel opens on the inspector. Each tool selects its own kind of thing. */
function hasSelection(): boolean {
  if (railMode === 'race') return pickupSelection !== null;
  // A ground handle counts: it is what the inspector's land rows report, and
  // without it the auto-tab rule falls back to the palette and the numbers the
  // selection just made are on a tab nobody opened.
  if (railMode === 'terrain') return fenceSelection !== null || groundPoint !== null;
  return dressing !== null;
}

/** What the ACTIVE tool's palette is armed with. Each placing tool has its own,
 *  and a tool with no palette is never placing. */
function activeArmed(): string | null {
  if (railMode === 'props') return library.armed;
  if (railMode === 'race') return racePalette.armed;
  if (railMode === 'terrain') return terrainPalette.armed;
  return null;
}

/** Whether a palette is armed, which is what keeps the panel on the library
 *  through a placing loop instead of following each placement's selection. */
function isPlacing(): boolean {
  // The ground counts as placing even though it arms from the banner rather
  // than from a palette: what this decides is whether the right column stays on
  // the library instead of jumping to a selection nobody asked to see, and a
  // gesture in progress is a gesture in progress wherever it was armed.
  return activeArmed() !== null || groundArmed;
}

function applySideTab(): void {
  const field = TOOL_VALUE_FIELDS[tool()];
  const panel = panelLayout({
    mode: railMode,
    drawn,
    chosen: sideChoice,
    hasSelection: hasSelection(),
    isPlacing: isPlacing(),
    hasToolValue: field !== null,
  });
  shell.setSideTab(panel.tabs, panel.active);
  // Two panels share the `library` tab and two share `inspector`, one pair per
  // placing tool, and only the active mode's is ever shown: the props library
  // arms a catalog asset and the race palette arms a piece of furniture, which
  // are different vocabularies rather than one list with a filter.
  library.el.hidden = !(panel.showLibrary && railMode === 'props');
  racePalette.el.hidden = !(panel.showLibrary && railMode === 'race');
  terrainPalette.el.hidden = !(panel.showLibrary && railMode === 'terrain');
  inspector.el.hidden = !(panel.showInspector && railMode === 'props');
  raceInspector.el.hidden = !(panel.showInspector && railMode === 'race');
  terrainInspector.el.hidden = !(panel.showInspector && railMode === 'terrain');
  outliner.el.hidden = !panel.showOutliner;
  form.el.hidden = !panel.showForm;
  modeReadout.el.hidden = !panel.showModeReadout;
  shell.setToolValueField(field, panel.showToolValue);
  requestRedraw();
}

/** Everything whose availability depends on there being a circuit at all. */
/** What the two ground chips say about the record: one is a toggle the page
 *  owns, the other is live exactly while there is a shape to discard. */
function syncGroundActions(): void {
  shell.setEnabled('deleteGround', drawn && Boolean(record.groundOutline?.length));
  shell.setChecked('drawGround', groundArmed);
}

function refreshChrome(): void {
  // A blank canvas has exactly one thing to do, so it says so rather than
  // leaving whatever mode the last circuit was being edited in selected under a
  // disabled rail entry.
  if (!drawn && railMode !== 'shape') setRailMode('shape');
  emptyEl.hidden = drawn;
  for (const id of CIRCUIT_ONLY_ACTIONS) shell.setEnabled(id, drawn);
  syncGroundActions();
  shell.setDocument(record.id, dirty);
  shell.setBanner(railMode, drawn, redrawing, placement.mode, isPlacing(), groundArmed);
  applySideTab();
  // A layout left with the dock open re-opens it the moment there is something
  // to show, which is what makes the stored flag mean anything: at boot there is
  // no circuit and a 3D panel over a blank canvas is a loading cost for nothing.
  if (drawn && layout.dockOpen && !dockRestored) {
    dockRestored = true;
    void openPreview();
  }
}

/** What a click on empty plan will now do. Three things say it, so none of them
 *  has to be read: the status bar, the cursor, and the ghost. */
function announceArmed(asset: string | null): void {
  shell.setArmed(
    railMode === 'props'
      ? armStateText(asset, POND_CHOICE)
      : railMode === 'race'
        ? raceArmStateText(asset)
        : railMode === 'terrain'
          ? // The point count comes with it, because the two ways out of a
            // drawing gesture become available at different counts, and "am I
            // still drawing" is a question about state rather than a message.
            terrainArmStateText(asset, fenceDraft?.points.length ?? null, groundArmed)
          : '',
  );
  // The GROUND is drawn rather than dropped, so it keeps the crosshair: a copy
  // cursor over a freehand stroke says the wrong thing about the gesture.
  canvas.style.cursor = asset === null ? 'crosshair' : 'copy';
  // The banner's RACE arm says which of the two states the tool is in, so it has
  // to be repainted here and not only on a mode change.
  shell.setBanner(railMode, drawn, redrawing, placement.mode, isPlacing(), groundArmed);
  applySideTab();
  requestRedraw();
}

function setRailMode(next: RailModeId): void {
  // Leaving SHAPE cancels a pending redraw: an arm that survived a trip through
  // another tool would eat the operator's next stroke.
  if (next !== 'shape') redrawing = false;
  railMode = next;
  // A selection belongs to the tool that made it: a row selected in RACE is not
  // something the width brush can act on.
  clearSelections();
  sideChoice = null;
  // Leaving a placing tool disarms it: an arm that survived a trip through the
  // width tool would place a piece on the operator's first click back. Both
  // palettes are asked, because both can be armed and only one is ever on
  // screen to say so.
  if (library.armed !== null && next !== 'props') library.arm(null);
  if (racePalette.armed !== null && next !== 'race') racePalette.arm(null);
  if (terrainPalette.armed !== null && next !== 'terrain') terrainPalette.arm(null);
  // A run left half drawn in another mode is a run nothing on screen explains,
  // so leaving TERRAIN cancels it rather than parking it.
  if (next !== 'terrain') fenceDraft = null;
  // The ground's arm went with the selections above, whatever mode this is, so
  // its chip is re-read here rather than only on the way OUT of TERRAIN: the
  // rail answers a click on the mode it is already in, and that path used to
  // drop the arm while leaving the chip lit and the banner mid-sentence.
  syncGroundActions();
  shell.setMode(railMode, drawn, redrawing, placement.mode, isPlacing(), groundArmed);
  // Unconditionally, even when neither palette moved: the armed line and the
  // canvas cursor belong to the mode now showing, and a tool entered with
  // nothing armed must not inherit the last one's sentence.
  announceArmed(activeArmed());
  requestRedraw();
}

/** Where a lap position sits on the plan, or null when it is off it. */
function planPointAt(s: number): { x: number; y: number } | null {
  if (!drawn) return null;
  const p = local(track.pointAt(s));
  const x = screenX(p.x);
  const y = screenY(p.z);
  if (x < 0 || y < 0 || x > plan.width || y > plan.height) return null;
  return { x, y };
}

function paintChrome(): void {
  shell.setViewChips(view.scale, layout.grid, layout.snap);
  shell.setHeadline(drawn ? headlineChips(metrics) : null);
  shell.setProblems(
    drawn ? metrics.problems : [],
    drawn ? calloutProblems(metrics.problems) : [],
    planPointAt,
    plan.width,
  );
  shell.setDocument(record.id, dirty);
  // The undo stack moves on every commit, which is far more often than the
  // chrome is refreshed, so its button state is read here rather than there.
  shell.setEnabled('undo', history.canUndo);
  shell.setEnabled('redo', history.canRedo);
  if (layout.metricsOpen) metricsDrawer.paint();
  outliner.paint();
  inspector.paint();
  raceInspector.paint();
  // The palette repaints too, unlike the other two: its fold follows the
  // record's THEME, and its hint counts the points in the run being drawn.
  terrainPalette.paint();
  terrainInspector.paint();
  modeReadout.paint();
}

// ---- pointer routing ----

/** The quantity the painting mode edits, per centerline sample. */
function paintedQuantity(): number[] {
  return track.samples.map((sample) => sample.halfWidth);
}

/** What the stroke that just ended did, in the operator's own units. */
function reportStroke(): void {
  const field = TOOL_VALUE_FIELDS[tool()];
  if (!paintBefore || !field) return;
  const after = paintedQuantity();
  let changed = 0;
  for (let i = 0; i < after.length && i < paintBefore.length; i++) {
    if (Math.abs(after[i] - paintBefore[i]) > 0.01) changed += track.step;
  }
  const value = Number(shell.toolValueInput.value);
  if (changed > 0) {
    setStatus(`${field.label}: ${changed.toFixed(0)} yd of lap set to ${value}`, 'ok');
    return;
  }
  // The case that made this whole readout necessary. Naming the reason is the
  // difference between "the tool is broken" and "you painted what was there".
  setStatus(`nothing changed: the road is already ${value} yd there`, 'err');
}

/** The table the painting mode edits, as it stands on the record. */
function paintedBands(): CircuitBand[] {
  return fromWidthBands(record.widthBands);
}

/** Extends the live stroke to this point and re-applies the whole of it. */
function paintAt(point: RallyPoint): void {
  const field = TOOL_VALUE_FIELDS[tool()];
  const value = Number(shell.toolValueInput.value);
  if (!field || !paintOrigin || !Number.isFinite(value)) return;
  paintFractions.push(fractionAt(point));
  const bands = paintSpan(paintOrigin, paintFractions, value, {
    min: field.min,
    max: field.max,
    ramp: PAINT_RAMP_YARDS / track.length,
  });
  commit({ ...record, widthBands: toWidthBands(bands) }, false);
}

canvas.addEventListener('pointerdown', (ev) => {
  // Left draws and edits, middle pans; anything else belongs to the browser. A
  // right click used to capture the pointer and start a stroke, place a prop or
  // begin a width paint UNDER the context menu.
  if (ev.button !== 0 && ev.button !== 1) return;
  canvas.setPointerCapture(ev.pointerId);
  if (ev.button === 1) {
    panning = { x: view.x, z: view.z, clientX: ev.clientX, clientY: ev.clientY };
    return;
  }
  const raw = toLocal(ev);
  const active = tool();
  if (active === 'race') {
    startRaceFurnitureGesture(raw);
    return;
  }
  if (active === 'terrain') {
    startTerrainGesture(raw);
    return;
  }
  if (active === 'draw') {
    drawing = true;
    stroke = [raw];
    return;
  }
  if (active === 'props') {
    startDressingGesture(raw, ev.shiftKey);
    return;
  }
  if (active === 'width') {
    pushUndo();
    painting = true;
    paintBefore = paintedQuantity();
    paintOrigin = paintedBands();
    paintFractions = [];
    paintAt(raw);
    return;
  }
  const point = authored(raw);
  const hit = hitTestControlPoint(
    record.controlPoints,
    raw.x,
    raw.z,
    HIT_TOLERANCE_PIXELS.handle / view.scale,
  );
  if (hit >= 0) {
    selection = { kind: 'point', index: hit };
    dragging = selection;
    pushUndo();
    requestRedraw();
    return;
  }
  const segment = nearestSegment(record.controlPoints, raw.x, raw.z);
  if (segment.distance <= HIT_TOLERANCE_PIXELS.segment / view.scale) {
    commit({
      ...record,
      controlPoints: insertControlPoint(record.controlPoints, segment.index, point),
    });
    selection = { kind: 'point', index: segment.index + 1 };
    dragging = selection;
    requestRedraw();
    return;
  }
  selection = null;
  requestRedraw();
});

/** The status bar's live cursor. In the two track tools it also carries where
 *  the pointer sits ALONG the lap, which is the coordinate those tools author
 *  in. */
function reportCursor(point: RallyPoint): void {
  const parts = [`x ${point.x.toFixed(1)}`, `z ${point.z.toFixed(1)}`];
  const active = tool();
  if (drawn && (active === 'width' || active === 'props' || active === 'race')) {
    const projection = track.project(
      point.x + REALM_RACERS_ORIGIN.x,
      point.z + REALM_RACERS_ORIGIN.z,
    );
    parts.push(`s ${projection.s.toFixed(0)} yd`, `off ${projection.lateral.toFixed(1)}`);
  }
  shell.setCursor(parts.join('   '));
}

canvas.addEventListener('pointermove', (ev) => {
  if (panning) {
    view.x = panning.x - (ev.clientX - panning.clientX) / view.scale;
    view.z = panning.z - (ev.clientY - panning.clientY) / view.scale;
    requestRedraw();
    return;
  }
  const point = toLocal(ev);
  hover = point;
  reportCursor(point);
  // An armed piece has a ghost to move, so a plain hover repaints. Only while
  // armed: a repaint per pointermove for nothing is a whole circuit redrawn to
  // show no change.
  if (tool() === 'props' && library.armed !== null && !dressingDrag) requestRedraw();
  // The same rule for the row ghost: it follows the cursor, so it repaints on a
  // hover, and only while something is armed.
  if (tool() === 'race' && racePalette.armed !== null && !pickupDragging) requestRedraw();
  // And for the run being drawn, whose last segment follows the pointer. Keyed
  // on the DRAFT rather than on the palette being armed: an armed kit with no
  // draft open has nothing on screen that moves, and a run being finished has
  // one whether or not the kit is still armed.
  if (tool() === 'terrain' && fenceDraft) requestRedraw();
  // The dock rides the pointer when asked to: hovering a corner on the plan is
  // then the gesture that looks at it in 3D, with no camera to fly.
  if (layout.followCursor && preview && drawn) {
    const fraction = fractionAt(point);
    preview.setFlyFraction(fraction);
    dock.setAt(fraction * track.length, fraction);
  }
  if (drawing) {
    stroke.push(point);
    requestRedraw();
    return;
  }
  if (painting) {
    paintAt(point);
    return;
  }
  if (dressingDrag) {
    moveDressingGesture(point, ev.shiftKey);
    return;
  }
  if (pickupDragging) {
    // The UNCONSTRAINED projection, unlike the one a placement is gated by: a
    // drag whose row stopped following because the pointer strayed a yard onto
    // the verge would read as the tool having dropped the gesture.
    const fraction = pickupDragFractionAt(record, point.x, point.z);
    if (fraction !== null) movePickupRow(fraction, false);
    return;
  }
  if (groundDrawing) {
    groundStroke.push(point);
    requestRedraw();
    return;
  }
  if (groundDragging && tool() === 'terrain') {
    const snap = resolveSnap(record, point.x, point.z, { grid: layout.snap, free: altHeld });
    moveGroundPointTo(snap.x, snap.z);
    return;
  }
  // The wall takes the RAW point rather than a snapped one: it is authored in
  // whole yards by its own core, and the road-edge magnet every other terrain
  // gesture goes through has nothing to say about a box out in the lawn.
  if (wallGrip && tool() === 'terrain') {
    resizeWallTo(point.x, point.z);
    return;
  }
  if (wallMove && tool() === 'terrain') {
    moveCircuitTo(point.x, point.z);
    return;
  }
  if (fenceDragging && tool() === 'terrain' && !fenceDraft) {
    const snap = resolveSnap(record, point.x, point.z, { grid: layout.snap, free: altHeld });
    moveFencePointTo(snap.x, snap.z);
    return;
  }
  if (!dragging) return;
  commit(
    {
      ...record,
      controlPoints: moveControlPoint(record.controlPoints, dragging.index, authored(point)),
    },
    false,
  );
});

function endGesture(): void {
  if (drawing) {
    drawing = false;
    const fitted = fitStrokeToControlPoints(stroke);
    if (fitted.length >= MIN_CONTROL_POINTS) {
      commit({ ...record, controlPoints: fitted });
      // The stroke that turns a blank canvas into a circuit, or replaces the
      // curve of one that already is. Either way the arm is spent.
      drawn = true;
      redrawing = false;
      setRailMode('shape');
      refreshChrome();
      setStatus(`fitted ${fitted.length} control points from ${stroke.length} stroke points`, 'ok');
      // A freshly drawn loop is whatever size it is, and the enclosure it
      // inherited is the previous circuit's. Sizing it here is what lets an
      // operator draw a 1000 yard lap without meeting a wall complaint first.
      fitWall();
    } else {
      setStatus('stroke too short to fit a loop: draw a bigger one', 'err');
    }
  }
  if (groundDrawing) finishGroundStroke();
  if (groundDragging) {
    groundDragging = false;
    requestRedraw();
  }
  if (wallGrip || wallMove) {
    // Nothing stays selected: the wall has no numbers of its own to inspect
    // beyond the two the panel already shows, and a grip left lit would answer
    // `del` with whichever branch ran first.
    wallGrip = null;
    wallMove = null;
    requestRedraw();
  }
  if (painting) reportStroke();
  if (dressingDrag) endDressingGesture();
  panning = null;
  painting = false;
  paintBefore = null;
  paintOrigin = null;
  paintFractions = [];
  dragging = null;
  pickupDragging = false;
  // The point stays SELECTED after the release, so an arrow key keeps nudging
  // the corner the drag just moved; what ends is the drag itself, and the two
  // are the same variable because a point is only ever dragged while it is the
  // one under the pointer.
  if (fenceDragging) {
    fenceDragging = false;
    requestRedraw();
  }
}

canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);
canvas.addEventListener('pointerleave', () => {
  if (!hover) return;
  hover = null;
  requestRedraw();
});

// Double-clicking the plan is the shortest way to say "look at THAT" to the 3D
// dock: the orbit rig opens on the circuit's origin, and on a big lap its far
// side is off the frame at any distance you can read the road from.
canvas.addEventListener('dblclick', (ev) => {
  if (!preview || !drawn) return;
  const point = toLocal(ev);
  preview.lookAt(point.x, point.z);
  dock.setOpen(true);
  syncDockChrome();
  setStatus(`orbiting ${point.x.toFixed(0)}, ${point.z.toFixed(0)}`, '');
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const before = toLocal(ev);
  view.scale = wheelZoomScale(view.scale, ev.deltaY);
  const after = toLocal(ev);
  view.x += before.x - after.x;
  view.z += before.z - after.z;
  rememberZoom();
  requestRedraw();
});

function applyZoom(percent: number): void {
  view.scale = zoomScale(percent);
  rememberZoom();
  requestRedraw();
}

function focusProblem(problem: RealmRacersCircuitProblem): void {
  if (!drawn || problem.s < 0) return;
  const p = local(track.pointAt(problem.s));
  view.x = p.x;
  view.z = p.z;
  requestRedraw();
  setStatus(`${problemHeadline(problem)}: ${problemDetail(problem)}`, 'err');
}

// ---- actions ----

function newBlank(): void {
  stroke = [];
  clearSelections();
  // Committed BEFORE the flag moves: `commit` snapshots the state it is
  // leaving, and clearing the flag first made that snapshot say the canvas was
  // already blank, so undoing a discard restored nothing.
  commit(blankCircuit());
  drawn = false;
  dirty = false;
  setRailMode('shape');
  refreshChrome();
  fitView();
  setStatus('blank canvas: draw a closed loop', '');
}

/** Starting from something: the starter oval, or any circuit the game ships. */
function loadCircuit(circuit: RealmRacersCircuit, label: string): void {
  stroke = [];
  clearSelections();
  // A shipped record is loaded under a DRAFT id, so editing it can never hand
  // the memoized derivation of a live circuit a shape the game did not author.
  // Committed before the flag moves, for the same reason as `newBlank`.
  //
  // The instance volume comes up to the ceiling on the way in, because it has
  // exactly one legal value now and no panel left to type it in: a draft from
  // before that rule would otherwise be stuck under it, and dragging its wall
  // out would answer with a containment error the tool offered no way to fix.
  commit(circuitWithCeilingVolume(circuit));
  drawn = true;
  dirty = false;
  setRailMode('shape');
  refreshChrome();
  form.sync();
  fitView();
  setStatus(`loaded ${label}`, 'ok');
}

async function copyRecord(): Promise<void> {
  const text = circuitToTypeScript(record);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('record copied: paste it into realm_racers_circuits.ts', 'ok');
  } catch {
    // Clipboard access needs a secure context; a download is the fallback that
    // always works over plain http on a dev host.
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    anchor.download = `${record.id}.ts`;
    anchor.click();
    setStatus('clipboard refused: downloaded the record instead', 'ok');
  }
}

async function saveDraft(): Promise<void> {
  try {
    const response = await fetch('/__circuit_editor/save', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (!response.ok) throw new Error(await response.text());
    dirty = false;
    shell.setDocument(record.id, dirty);
    setStatus(`saved tmp/circuit-drafts/${record.id}.ts`, 'ok');
  } catch (err) {
    setStatus(`save failed: ${err}`, 'err');
  }
}

function setLayout(next: Partial<EditorLayout>): void {
  layout = { ...layout, ...next };
  saveLayout();
}

/**
 * Every toggle's checked state, from the layout that owns it.
 *
 * One writer. The plan chips were repainted per frame by `setViewChips` while the
 * MENU entries and the `aria-pressed` on both were written once at boot, so after
 * the first `g` the menu said Grid was on with the grid off, and both chips lied
 * to a screen reader.
 */
function syncToggles(): void {
  shell.setChecked('toggleGrid', layout.grid);
  shell.setChecked('toggleSnap', layout.snap);
  shell.setChecked('toggleDock', dock.open);
  shell.setChecked('dockFullscreen', layout.dockFullscreen);
}

function runAction(id: ActionId): void {
  // One refusal, off the table's own flag. Nine `if (drawn)` guards inside the
  // switch, a second list for the enable sweep and a third in the mode host was
  // three copies of one rule.
  if (!drawn && needsCircuit(id)) return;
  switch (id) {
    case 'newBlank':
      newBlank();
      return;
    case 'load':
      loadDialog.showModal();
      void draftDialog.refresh();
      return;
    case 'saveDraft':
      void saveDraft();
      return;
    case 'copyRecord':
      void copyRecord();
      return;
    case 'undo':
      undo();
      return;
    case 'redo':
      redo();
      return;
    case 'redrawCenterline':
      redrawing = true;
      setRailMode('shape');
      setStatus(
        'draw a new centerline: the dressing, the road profile and the race settings all stay',
        '',
      );
      return;
    case 'disarmTool':
      // A run being DRAWN takes the first `esc` on its own, and gives the kit
      // back: an operator who mis-clicked one point of a five-point run wants
      // that run gone, not the whole tool disarmed and the kit to re-find. A
      // second `esc` then does what it always did.
      if (cancelFenceDrawing()) return;
      // A stroke in progress takes the first `esc` on its own, and the arm
      // survives it: an operator who started the loop in the wrong place wants
      // that loop gone, not the tool disarmed and the chip to find again.
      if (groundDrawing) {
        groundDrawing = false;
        groundStroke = [];
        setStatus('ground stroke cancelled', '');
        requestRedraw();
        return;
      }
      if (groundArmed) setGroundArmed(false);
      redrawing = false;
      dressing = null;
      pickupSelection = null;
      fenceSelection = null;
      fencePoint = null;
      // Every palette: `esc` drops what the tools ARM, and each placing tool has
      // one of its own.
      library.arm(null);
      if (racePalette.armed !== null) racePalette.arm(null);
      if (terrainPalette.armed !== null) terrainPalette.arm(null);
      applySideTab();
      shell.setMode(railMode, drawn, false, placement.mode, isPlacing(), groundArmed);
      return;
    case 'toggleDock':
      void togglePreview();
      return;
    case 'dockFullscreen':
      setLayout({ dockFullscreen: !layout.dockFullscreen });
      dock.setFullscreen(layout.dockFullscreen);
      return;
    case 'toggleMetrics':
      setLayout({ metricsOpen: !layout.metricsOpen });
      shell.showMetrics(layout.metricsOpen);
      requestRedraw();
      return;
    case 'toggleGrid':
      setLayout({ grid: !layout.grid });
      syncToggles();
      requestRedraw();
      return;
    case 'toggleSnap':
      setLayout({ snap: !layout.snap });
      setStatus(layout.snap ? 'snapping every placement to the grid' : 'free placement', '');
      syncToggles();
      requestRedraw();
      return;
    case 'fitView':
      fitView();
      return;
    case 'zoomOut':
      applyZoom(50);
      return;
    case 'zoomReset':
      applyZoom(100);
      return;
    case 'zoomIn':
      applyZoom(200);
      return;
    case 'fitWall':
      fitWall();
      return;
    case 'centerCircuit':
      centerCircuit();
      return;
    case 'fitGround':
      fitGround();
      return;
    case 'drawGround':
      // Reachable from the Track menu in any mode, so it takes the operator to
      // the tool it belongs to rather than arming a gesture the canvas is not
      // routing: `raceSettings` does the same.
      if (railMode !== 'terrain') setRailMode('terrain');
      setGroundArmed(!groundArmed);
      setStatus(
        groundArmed
          ? 'drag one closed loop to shape the land; esc puts the pointer back'
          : 'pointer',
        '',
      );
      return;
    case 'deleteGround':
      removeGroundShape();
      return;
    case 'fixCorners':
      fixCorners();
      return;
    case 'raceSettings':
      setRailMode('race');
      return;
    case 'modeShape':
      setRailMode('shape');
      return;
    case 'modeWidth':
      setRailMode('width');
      return;
    case 'modeProps':
      setRailMode('props');
      return;
    case 'modeRace':
      setRailMode('race');
      return;
    case 'modeTerrain':
      setRailMode('terrain');
      return;
    case 'keys':
      shell.toggleKeys();
      return;
    case 'dockPlay': {
      if (!preview || !dock.open) return;
      const riding = preview.cameraMode === 'fly' && preview.playing;
      if (riding) {
        preview.setFlyPlaying(false);
        setStatus('fly-through paused: drag to look around', '');
      } else {
        // Resuming puts the head back down the road: a lap restarted from a view
        // turned ninety degrees is not the lap anyone paused to look at.
        preview.resetLook();
        preview.setFlyPlaying(true);
        setStatus('riding the lap', '');
      }
      syncDockChrome();
      return;
    }
    default:
      // Selection and pointer rows: the props branch and the canvas own those,
      // and the table carries them for the cheatsheet and the hints.
      return;
  }
}

/**
 * Dragging a tile out of the library and onto the plan.
 *
 * The primary gesture, and the reason it is pointer capture rather than HTML5
 * drag-and-drop: the drop target is a CANVAS, so there is nothing to hit-test
 * against and the ghost has to be drawn by the plan itself. Capturing on the
 * tile keeps every move coming to one listener whatever the pointer crosses, and
 * the plan simply treats the pointer as a hover it did not start.
 *
 * A drag that ends anywhere but the plan places nothing and leaves the piece
 * ARMED, so the gesture degrades into the click-to-place one rather than into
 * nothing at all.
 */
function beginTileDrag(asset: string, ev: PointerEvent): void {
  if (!drawn || asset === POND_CHOICE) return;
  const tile = ev.currentTarget;
  if (!(tile instanceof HTMLElement)) return;
  tile.setPointerCapture(ev.pointerId);
  tileDrag = { asset, pointerId: ev.pointerId };

  const move = (moveEv: PointerEvent): void => {
    if (!tileDrag || moveEv.pointerId !== tileDrag.pointerId) return;
    hover = overPlan(moveEv) ? toLocal(moveEv) : null;
    requestRedraw();
  };
  const end = (upEv: PointerEvent): void => {
    tile.releasePointerCapture?.(upEv.pointerId);
    tile.removeEventListener('pointermove', move);
    tile.removeEventListener('pointerup', end);
    tile.removeEventListener('pointercancel', end);
    const dropped = tileDrag !== null && overPlan(upEv);
    tileDrag = null;
    if (dropped) {
      if (railMode !== 'props') setRailMode('props');
      placeOne(toLocal(upEv));
      dressingDrag = null;
    } else {
      hover = null;
    }
    requestRedraw();
  };
  tile.addEventListener('pointermove', move);
  tile.addEventListener('pointerup', end);
  tile.addEventListener('pointercancel', end);
}

/** Whether a pointer is over the plan's canvas, in viewport coordinates. */
function overPlan(ev: { clientX: number; clientY: number }): boolean {
  const rect = canvas.getBoundingClientRect();
  return (
    ev.clientX >= rect.left &&
    ev.clientX <= rect.right &&
    ev.clientY >= rect.top &&
    ev.clientY <= rect.bottom
  );
}

// ---- the shell ----

const shell = new EditorShell(
  {
    onAction: runAction,
    onMode: (mode) => {
      if (!drawn && needsCircuit(MODE_ACTIONS[mode])) return;
      setRailMode(mode);
    },
    onSideTab: (tab) => {
      sideChoice = tab;
      setLayout({ side: tab });
      applySideTab();
    },
    onFocusProblem: focusProblem,
    onToolValue: () => {
      // Nothing to recompute: the field is read at the start of the next stroke.
      // Clamped HERE, on the change itself, with the same clamp the tool-swap
      // path uses: typing 100 into the width box painted 40 (paintSpan clamps
      // internally) while the status line reported "set to 100". Reported so a
      // change the operator made is visibly the tool's now.
      const field = TOOL_VALUE_FIELDS[tool()];
      if (!field) return;
      const value = clampToolValue(field, Number(shell.toolValueInput.value));
      shell.toolValueInput.value = String(value);
      setStatus(`${field.label}: ${value}`, '');
    },
    onResume: takeResume,
  },
  platform,
);

const planArea = (): { width: number; height: number } => ({
  width: shell.planEl.clientWidth,
  height: shell.planEl.clientHeight,
});

const dock = new CircuitDock(
  {
    onGeometry: (geometry: DockGeometry) => setLayout({ dock: geometry }),
    onFullscreen: (on) => {
      setLayout({ dockFullscreen: on });
      dock.setFullscreen(on);
    },
    onInvertLook: (on) => {
      setLayout({ invertLook: on });
      dock.setInvertLook(on);
      preview?.setInvertLook(on);
    },
    onFollowCursor: (on) => {
      setLayout({ followCursor: on });
      dock.setFollowCursor(on);
      // A camera that is being pointed at things must not also be driving off
      // on its own.
      if (on) preview?.setFlyPlaying(false);
      syncDockChrome();
    },
    onCameraMode: (mode) => {
      if (!preview) return;
      if (mode === 'fly') {
        preview.setFlyPlaying(!(preview.cameraMode === 'fly' && preview.playing));
      } else {
        preview.setFlyPlaying(false);
        preview.setMode('orbit');
        preview.frame(metrics.roadHalfX, metrics.roadHalfZ);
      }
      syncDockChrome();
    },
    onFlySpeed: (speed) => preview?.setFlySpeed(speed),
    onFlyFraction: (fraction) => {
      preview?.setFlyFraction(fraction);
      dock.setAt(drawn ? fraction * track.length : null, fraction);
      syncDockChrome();
    },
    onClose: () => void togglePreview(),
    onResized: () => preview?.resize(),
  },
  platform,
);

function syncDockChrome(): void {
  dock.setCameraMode(preview?.cameraMode === 'fly' ? 'fly' : 'orbit', preview?.playing ?? false);
}

// ---- the panels ----
//
// The right column and the readout drawer, each a sibling module behind one
// host. None of them touches the canvas or the page's gesture state: they read
// the document and commit edits, which is why none of them lives in here.

/** The document, as every panel reads it. Shared so the two hosts below differ
 *  only in the verbs their own tool needs. */
const panelDocument = {
  record: () => record,
  metrics: () => metrics,
  track: () => track,
  drawn: () => drawn,
  mode: () => railMode,
  selection: () => dressing,
  commit: (next: RealmRacersCircuit) => commit(next),
  commitDressing: (next: Partial<RealmRacersCircuit>) => commitDressing(next),
  setStatus,
};

const panelHost: LibraryHost & OutlinerHost = {
  ...panelDocument,
  select: (next) => {
    dressing = next;
    // Selecting from the outliner DISARMS: the panel keeps the library up while
    // a piece is armed, so an operator who went to the list to find something
    // would pick a row and be shown the tiles again rather than its numbers.
    library.arm(null);
    applySideTab();
    requestRedraw();
  },
  focus: focusDressing,
  remove: removeDressing,
  onArmed: (asset) => {
    // A fresh arm starts at the catalog's own facing: carrying the last piece's
    // rotation onto a different kind of thing is a yaw nobody chose.
    pendingYaw = null;
    announceArmed(asset);
  },
  onTileDrag: beginTileDrag,
  onPlacement: (settings) => {
    placement = settings;
    shell.setBanner(railMode, drawn, redrawing, settings.mode, isPlacing(), groundArmed);
    requestRedraw();
  },
};

const racePanelHost: RacePanelHost = {
  ...panelDocument,
  pickupSelection: () => pickupSelection,
  // The field is in YARDS and the record is in lap fractions, which is the one
  // conversion the panel is not asked to make: it edits a distance an operator
  // can compare to the lap, and the page owns what the record is written in.
  movePickupRowTo: (yards) => movePickupRow(track.length > 0 ? yards / track.length : 0),
  removePickupRow: deletePickupRow,
  onArmed: announceArmed,
};

const terrainPanelHost: TerrainPanelHost = {
  ...panelDocument,
  fenceSelection: () => fenceSelection,
  draftPointCount: () => fenceDraft?.points.length ?? null,
  groundArmed: () => groundArmed,
  setFenceScale: (scale) => {
    if (fenceSelection === null) return;
    commit({ ...record, fences: setFenceScale(record.fences ?? [], fenceSelection, scale) });
    requestRedraw();
  },
  removeFence: deleteFenceSelection,
  groundSelection: () => groundPoint,
  finishDraft: finishFenceDrawing,
  onArmed: (kit) => {
    // Arming a KIT drops the ground's own arm, the other half of the exclusion
    // `setGroundArmed` keeps: two armed gestures make the next click ambiguous.
    if (kit !== null && groundArmed) setGroundArmed(false);
    announceArmed(kit);
  },
  // The theme's own vocabulary, off the RENDER registry, which is where a
  // theme's art lives. An unknown theme id falls back the same way every other
  // consumer does rather than leaving the palette empty: an operator drawing a
  // circuit against a theme being written in the same change still needs kits.
  themeBarriers: () => realmRacersTheme(record).barriers,
};

const form = new RecordFormPanel(panelHost);
const inspector = new InspectorPanel(panelHost);
const outliner = new OutlinerPanel(panelHost);
const library = new LibraryPanel(panelHost);
const racePalette = new RacePalettePanel(racePanelHost);
const terrainPalette = new TerrainPalettePanel(terrainPanelHost);
const terrainInspector = new TerrainInspectorPanel(terrainPanelHost);
const raceInspector = new RaceInspectorPanel(racePanelHost);
const modeReadout = new ModeReadoutPanel(panelHost);
const metricsDrawer = new MetricsDrawerPanel(panelHost, shell.metricsBodyEl);

// ---- the load dialog ----

const LOAD_CHOICES: { label: string; detail: string; build: () => RealmRacersCircuit }[] = [
  {
    label: 'starter oval',
    detail: 'a plain loop to deform',
    build: () => ({ ...blankCircuit(), id: 'draft_circuit' }),
  },
  ...REALM_RACERS_CIRCUIT_LIST.map((circuit) => ({
    label: circuit.id,
    detail: `${circuit.roles.join(' and ')}, ${circuit.laps} laps`,
    build: () => ({ ...circuit, id: `draft_${circuit.id}` }),
  })),
];

for (const choice of LOAD_CHOICES) {
  const button = document.createElement('button');
  button.type = 'button';
  const name = document.createElement('div');
  name.textContent = choice.label;
  const detail = document.createElement('div');
  detail.className = 'sub';
  detail.textContent = choice.detail;
  button.append(name, detail);
  button.onclick = () => {
    loadDialog.close();
    loadCircuit(choice.build(), choice.label);
  };
  loadListEl.append(button);
}

(document.getElementById('loadCancel') as HTMLButtonElement).onclick = () => loadDialog.close();

// ---- the drafts on disk ----
//
// The Load dialog's other half, and a sibling module rather than a block in
// here: none of it needs the page's gesture state, which is this directory's own
// test for which side of the seam something belongs on.

const draftDialog = new DraftDialog(document.getElementById('draftList') as HTMLDivElement, {
  load: (circuit, label) => {
    loadDialog.close();
    loadCircuit(circuit, label);
  },
  setStatus,
  now: () => Date.now(),
});

// ---- the 3D dock's preview ----

async function openPreview(): Promise<void> {
  if (preview) return;
  shell.setEnabled('toggleDock', false);
  setStatus('preview: starting', '');
  try {
    const { CircuitPreview } = await import('./preview3d');
    dock.setGeometry(layout.dock, planArea());
    dock.setOpen(true);
    dock.setFullscreen(layout.dockFullscreen);
    dock.setFollowCursor(layout.followCursor);
    dock.setInvertLook(layout.invertLook);
    dock.setAt(null, 0);
    shell.setChecked('toggleDock', true);
    const created = new CircuitPreview({
      canvas: previewCanvas,
      onStatus: (text) => setStatus(text, ''),
    });
    created.onFlyProgress = (fraction) => {
      dock.setAt(drawn ? fraction * track.length : null, fraction);
    };
    created.setInvertLook(layout.invertLook);
    preview = created;
    created.frame(metrics.roadHalfX, metrics.roadHalfZ);
    created.show(record);
    await created.start();
    setLayout({ dockOpen: true });
    shell.setPreviewReady('ready');
    syncDockChrome();
  } catch (err) {
    // A dev page with no WebGL still has a working 2D tool, and saying so beats
    // a blank panel over the plan.
    dock.setOpen(false);
    shell.setChecked('toggleDock', false);
    shell.setPreviewReady('error');
    setStatus(`preview unavailable: ${err}`, 'err');
  } finally {
    shell.setEnabled('toggleDock', drawn);
  }
}

async function togglePreview(): Promise<void> {
  if (!preview) {
    await openPreview();
    return;
  }
  const showing = !dock.open;
  dock.setOpen(showing);
  shell.setChecked('toggleDock', showing);
  setLayout({ dockOpen: showing });
  // Told either way: a hidden preview STOPS rendering rather than drawing a
  // whole circuit behind the plan, under the 2D drag path.
  preview.setVisible(showing);
  shell.setPreviewReady(showing ? 'ready' : 'off');
  if (showing) {
    preview.show(record);
    dock.reflow(planArea());
  }
}

// ---- keyboard ----

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
  // A modal owns the keyboard while it is up. Without this, `g`, `s`, `m` and
  // `ctrl+S` all acted on the page behind the Load dialog, and `?` opened a
  // second nested modal. An open MENU takes escape before this runs, in the
  // shell's own document listener.
  if (loadDialog.open || shell.keysOpen) return;
  const action = actionForShortcut(ev);
  if (action) {
    // The space bar ACTIVATES a focused button. Taking it here would leave the
    // rail and the menus unusable from the keyboard the moment one has focus.
    if (action === 'dockPlay' && document.activeElement instanceof HTMLButtonElement) return;
    ev.preventDefault();
    runAction(action);
    return;
  }
  // The arrows are matched off the key rather than off the table, and the table
  // says so in `nudgeSelection`'s row: eight rows for one gesture ("arrows, and
  // shift for a bigger step") is a cheatsheet block nobody finishes reading.
  const nudge = nudgeKeyOf(ev.key);
  if (nudge && tool() === 'props' && dressing) {
    ev.preventDefault();
    nudgeDressing(nudge, ev.shiftKey);
    return;
  }
  // A barrier nudges in both axes, unlike a pickup row: it is a shape on the
  // ground rather than a position along the lap. The step sizes are the map
  // editor's own, through the same `planNudge`, so a nudge means the same thing
  // in every tool in this repo.
  if (nudge && tool() === 'terrain' && fenceSelection !== null) {
    ev.preventDefault();
    const step = planNudge(nudge, ev.shiftKey);
    nudgeFence(step.dx, step.dz);
    return;
  }
  // Enter finishes a run being drawn as an OPEN one, which is the half of the
  // gesture a click cannot express: clicking the first point closes the ring,
  // and there is no click that means "stop here".
  if (ev.key === 'Enter' && tool() === 'terrain' && fenceDraft) {
    ev.preventDefault();
    finishFenceDrawing();
    return;
  }
  // A row has ONE degree of freedom, so only the horizontal pair means anything:
  // left is back down the lap and right is on down it, the way a scrubber reads.
  // The step is a length in yards, which is `pickup_rows_core`'s rule.
  const alongLap = pickupNudgeDirection(ev.key);
  if (alongLap && tool() === 'race' && pickupSelection !== null) {
    ev.preventDefault();
    nudgePickupRow(alongLap, ev.shiftKey);
    return;
  }
  // The SELECTION chords go through the same table as everything else. They were
  // matched inline here against `ev.key` literals, which made them a fifth
  // hand-kept copy of the very list the table exists to be the only copy of:
  // re-spelling `rotateProp` in the table would have moved the tooltip, the hint
  // and the cheatsheet while the page went on acting on the old key.
  const selected = actionForSelectionShortcut(ev);
  if (selected) {
    if (tool() === 'props') {
      // With a piece ARMED and nothing selected, the rotation chords aim at the
      // GHOST: turning a lantern after dropping it means place, look, select,
      // rotate, which is four gestures for a decision already made.
      if (!dressing && library.armed && library.armed !== POND_CHOICE) {
        if (selected === 'rotateProp' || selected === 'faceRacing') {
          ev.preventDefault();
          rotateGhost(selected === 'faceRacing');
          return;
        }
      }
      if (!dressing) return;
      ev.preventDefault();
      runSelectionAction(selected);
      return;
    }
    // In RACE the delete chord acts on the pickup row, which is the only thing
    // that tool selects.
    if (tool() === 'race') {
      if (selected === 'deleteSelection' && pickupSelection !== null) {
        ev.preventDefault();
        deletePickupRow();
      }
      return;
    }
    // And in TERRAIN it acts on the barrier, or on the one point of it the
    // selection holds.
    if (tool() === 'terrain') {
      if (selected === 'deleteSelection' && fenceSelection !== null) {
        ev.preventDefault();
        deleteFenceSelection();
        return;
      }
      if (selected === 'deleteSelection' && groundPoint !== null) {
        ev.preventDefault();
        deleteGroundPoint();
      }
      return;
    }
    // Outside props the only selection chord that means anything is delete, on a
    // control point.
    if (selected === 'deleteSelection' && selection) {
      ev.preventDefault();
      commit({
        ...record,
        controlPoints: deleteControlPoint(record.controlPoints, selection.index),
      });
      selection = null;
    }
  }
});

/** Turns the piece the cursor is carrying, before it is a piece. The rule is
 *  `placement_core`'s; this hands it the step function and reports the answer. */
function rotateGhost(faceRacing: boolean): void {
  pendingYaw = rotatedPendingYaw(pendingYaw, faceRacing, rotateStep);
  setStatus(pendingYawText(pendingYaw), '');
  requestRedraw();
}

/** What a selection chord does to the armed dressing piece. */
function runSelectionAction(id: ActionId): void {
  switch (id) {
    case 'deleteSelection':
      deleteDressing();
      return;
    case 'duplicateSelection':
      duplicateDressing();
      return;
    case 'focusSelection':
      if (dressing) focusDressing(dressing);
      return;
    case 'faceRacing':
      // Facing the racing direction is a different thing from any angle: it
      // re-reads the tangent wherever the piece is moved to.
      transformSelectedProp(tangentProp);
      return;
    case 'rotateProp': {
      if (dressing?.kind !== 'prop') return;
      const placed =
        realmRacersPlacements(record).props[
          placementIndexOf(record.props, REALM_RACERS_PROPS, dressing.index)
        ];
      transformSelectedProp((prop) => rotatedProp(prop, placed?.yaw ?? 0, 1));
      return;
    }
    case 'toggleCollide':
      transformSelectedProp(toggledCollide);
      return;
    case 'scaleUp':
      transformSelectedProp((prop) => scaledProp(prop, -1));
      return;
    case 'scaleDown':
      transformSelectedProp((prop) => scaledProp(prop, 1));
      return;
    default:
      return;
  }
}

// `alt` overrules every magnet, and the ghost has to say so the moment it is
// held rather than on the next pointer move.
window.addEventListener('keydown', (ev) => {
  if (!ev.altKey || altHeld) return;
  altHeld = true;
  requestRedraw();
});
window.addEventListener('keyup', (ev) => {
  if (ev.altKey || !altHeld) return;
  altHeld = false;
  requestRedraw();
});
window.addEventListener('blur', () => {
  // A chord that tabbed away leaves the key stuck down otherwise, and every
  // placement after it silently ignores the grid.
  altHeld = false;
});

window.addEventListener('resize', () => {
  requestRedraw();
  dock.reflow(planArea());
  preview?.resize();
});

/**
 * The last chance to say there is unsaved work.
 *
 * A guard rather than a save: the draft is already in `localStorage` by now, so
 * what this catches is the operator who meant to press Save draft and would
 * rather find out before the tab closes than after. Only while DIRTY, or a dev
 * tool asks for confirmation on every reload, which is the fastest way to teach
 * someone to click through it.
 */
window.addEventListener('beforeunload', (ev) => {
  if (!shouldWarnOnUnload(dirty, drawn)) return;
  ev.preventDefault();
  // Browsers ignore custom text and show their own sentence; assigning it is
  // still what arms the prompt in several of them.
  ev.returnValue = '';
});

// The page's one teardown. A dev tool is left open for hours and reloaded often;
// giving the GL context and the built circuit back on the way out is what keeps
// a reload from stacking contexts until the browser starts dropping the oldest.
window.addEventListener('pagehide', () => {
  preview?.dispose();
  preview = null;
  library.dispose();
  terrainPalette.dispose();
});

// ---- boot ----

shell.sideBodyEl.append(
  library.el,
  racePalette.el,
  terrainPalette.el,
  inspector.el,
  raceInspector.el,
  terrainInspector.el,
  outliner.el,
  modeReadout.el,
  form.el,
);
shell.showMetrics(layout.metricsOpen);
syncToggles();
shell.setPreviewReady('off');
// Captured BEFORE the blank canvas: `newBlank` runs `fitView`, whose
// `rememberZoom` overwrites `layout.zoom` with the blank-canvas fit scale, so
// reading the field after it meant the operator's parked zoom was already gone.
const parkedZoom = layout.zoom;
newBlank();
// Offered AFTER the blank canvas, so the status line the operator reads is the
// offer rather than "blank canvas: draw a closed loop" written over it.
offerResume();
// The stored zoom, applied after the blank canvas framed itself: the operator
// left the plan at a zoom they were working at, and `newBlank` frames the room a
// circuit has rather than the one they were looking at. Remembered again, since
// the boot fit has just SAVED its own scale over the parked one.
if (parkedZoom) {
  view.scale = parkedZoom;
  rememberZoom();
  requestRedraw();
}
