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
} from '../../sim/realm_racers_circuit_metrics';
import { type RallyPoint, REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import { type RallyPlacedProp, realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import {
  type RallyTrackModel,
  rallyGardenEdgeOffsetAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
} from '../../sim/realm_racers_spline';
import { CircuitDock } from './dock';
import { suggestEnvelope } from './envelope_core';
import { circuitToTypeScript, roundCircuit } from './export_core';
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
import { armStateText, CIRCUIT_ONLY_ACTIONS, needsCircuit, panelLayout } from './panel_core';
import { RecordFormPanel } from './panel_form';
import { InspectorPanel } from './panel_inspector';
import { type LibraryHost, LibraryPanel } from './panel_library';
import { OutlinerPanel } from './panel_outliner';
import { MetricsDrawerPanel, ModeReadoutPanel } from './panel_readout';
import {
  fitHalfExtent,
  fitScale,
  HIT_TOLERANCE_PIXELS,
  PROP_LABEL_MIN_SCALE,
  planLimits,
  resolvePlanPalette,
  starterControlPoints,
  wheelZoomScale,
  withAlpha,
} from './plan_core';
import {
  authorPlacement,
  type DressingRect,
  type DressingSelection,
  ghostPlacement,
  hitTestPlaced,
  hitTestPondHandle,
  hitTestPonds,
  movedProp,
  nextSeed,
  POND_CHOICE,
  type PondHandle,
  placedPropIndices,
  placementIndexOf,
  pondFromDrag,
  pondHandlePoints,
  pondWithHandleAt,
  propFrameOf,
  propProjectionHint,
  removedAt,
  replacedAt,
  rotatedProp,
  scaledProp,
  scatterFromRect,
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

function blankCircuit(): RealmRacersCircuit {
  const template = REALM_RACERS_CIRCUIT_LIST[0];
  return {
    ...template,
    id: 'draft_circuit',
    controlPoints: starterControlPoints(),
    widthBands: [
      { s: 0, halfWidth: 10 },
      { s: 1, halfWidth: 10 },
    ],
    // A blank canvas is UNDRESSED. The template's dressing belongs to the
    // template's shape: inheriting it is how the practice circuit's infield
    // fountain used to land on every new circuit, and on one whose road runs
    // through that point it is now a metrics error the operator did not author
    // and cannot see the source of. The basin goes with the ponds, because the
    // record's rule is an IFF and a basin with nothing to shade is a payload
    // the save endpoint refuses.
    props: undefined,
    scatters: undefined,
    ponds: undefined,
    basin: undefined,
    roles: ['competition'],
    practiceCopies: 0,
  };
}

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
let dressingDrag: 'move' | 'rect' | 'pond' | null = null;
/** The pond handle under a resize/rotate drag. */
let pondHandle: PondHandle | null = null;
/** The projection index a track-space drag started from: without it a drag
 *  across a pinch re-anchors the piece to the facing stretch. */
let dragHint: number | undefined;
/** The live rectangle a scatter or a pond is being dragged out over. */
let dressingRect: DressingRect | null = null;
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
    wadeYards: 4,
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
  requestRedraw();
  // The palette follows the theme, so retyping the theme field re-offers the
  // zone's own vocabulary rather than the one the circuit opened on.
  library.syncTheme();
  // The preview debounces this itself: a drag lands one build on release, never
  // one per pointermove.
  if (drawn) preview?.show(record);
}

function restore(snapshot: EditSnapshot): void {
  selection = null;
  dressing = null;
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
 * The room a circuit has, drawn on a blank canvas.
 *
 * On a blank canvas the readout is hidden, so the two ceilings a circuit lives
 * under are nowhere on screen at the exact moment they matter most: before the
 * first stroke. The inner box is what an operator actually aims at, since the
 * line they draw carries a road and a garden either side of it and only the
 * CENTERLINE is under the pen. Both boxes and both sentences come from the core.
 */
function drawLimits(): void {
  const limits = planLimits(record.widthBands.map((band) => band.halfWidth));
  strokeRect(limits.outer.halfX, limits.outer.halfZ, planPalette.line, [8, 6]);
  strokeRect(limits.inner.halfX, limits.inner.halfZ, '#55607a', [3, 3]);

  ctx.fillStyle = planPalette.dim;
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(limits.outerLabel, screenX(0), screenY(-limits.outer.halfZ) - 8);
  // Inside its own box rather than under it: sat on the outer frame it read as
  // a label for the wrong rectangle.
  ctx.fillText(limits.innerLabel, screenX(0), screenY(limits.inner.halfZ) - 8);
  ctx.textAlign = 'left';
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
  if (!drawn || tool() !== 'props' || armed === null) return null;
  if (armed === POND_CHOICE || !hover || dressingDrag) return null;
  const point = authored(hover);
  return ghostPlacement(record, armed, point.x, point.z);
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
  const named = view.scale > PROP_LABEL_MIN_SCALE;
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
    if (!named) continue;
    ctx.fillStyle = planPalette.muted;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(prop.asset, screenX(prop.x) + 6, screenY(prop.z) - 6);
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

  // The GHOST: what the next click will put down, where it will put it.
  const ghost = cursorGhost();
  if (ghost) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = planPalette.pick;
    ctx.lineWidth = 1.5;
    traceFootprint(ghost);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = planPalette.pick;
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(ghost.asset, screenX(ghost.x) + 8, screenY(ghost.z) - 8);
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

  if (!drawn) {
    // Nothing of the placeholder record is drawn, so a blank canvas really is
    // blank: the room a circuit has, and the live stroke so a gesture is
    // visible as it happens.
    drawLimits();
    drawStroke();
    return;
  }
  strokeRect(record.regionHalfX, record.regionHalfZ, planPalette.line, [8, 6]);
  strokeRect(record.perimeter.halfX, record.perimeter.halfZ, '#55607a');
  drawSurfaces();
  drawGates();
  drawStroke();
  if (tool() === 'props') drawDressing();
  else drawHandles();
  drawProblemMarkers();
}

// ---- the dressing gestures ----

/** Click tolerance in yards, so a bench is grabbable at any zoom. */
const dressingTolerance = (): number => HIT_TOLERANCE_PIXELS.dressing / view.scale;

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
    dragHint = propProjectionHint(record, (record.props ?? [])[index]);
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

  // Nothing under the pointer: this is a placement. A pond and a scatter are
  // both dragged out over a box, a prop lands on the click.
  const point = authored(raw);
  if (rect || armed === POND_CHOICE) {
    dressingRect = { x0: point.x, z0: point.z, x1: point.x, z1: point.z };
    dressingDrag = 'rect';
    return;
  }
  const placement = authorPlacement(record, point.x, point.z);
  const props = [...(record.props ?? []), { asset: armed, at: placement.at }];
  dressing = { kind: 'prop', index: props.length - 1 };
  dressingDrag = 'move';
  dragHint = placement.hint;
  commitDressing({ props });
  applySideTab();
  setStatus(`placed ${armed} (${propFrameOf(props[props.length - 1])})`, 'ok');
}

function moveDressingGesture(raw: RallyPoint): void {
  const point = authored(raw);
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
    commitDressing(
      {
        props: replacedAt(
          record.props,
          dressing.index,
          movedProp(record, prop, point.x, point.z, dragHint),
        ),
      },
      false,
    );
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
      const spacing = Number(shell.toolValueInput.value);
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
  pondHandle = null;
  dragHint = undefined;
  requestRedraw();
}

/** The selected prop, or null: every keyboard transform reads this. */
function selectedProp(): RallyProp | null {
  if (dressing?.kind !== 'prop') return null;
  return (record.props ?? [])[dressing.index] ?? null;
}

function transformSelectedProp(next: (prop: RallyProp) => RallyProp): void {
  const prop = selectedProp();
  if (!prop || dressing?.kind !== 'prop') return;
  commitDressing({ props: replacedAt(record.props, dressing.index, next(prop)) });
}

/** Deletes whatever is selected, and drops the selection with it. */
function deleteDressing(): void {
  if (!dressing) return;
  if (dressing.kind === 'prop') commitDressing({ props: removedAt(record.props, dressing.index) });
  if (dressing.kind === 'scatter') {
    commitDressing({ scatters: removedAt(record.scatters, dressing.index) });
  }
  if (dressing.kind === 'pond') commitDressing({ ponds: removedAt(record.ponds, dressing.index) });
  dressing = null;
  applySideTab();
}

// ---- the two repairs ----

/** Sizes the wall and the region to the road, clamped to the band and the lane
 *  depth budget. What makes a big circuit drawable at all: the enclosure follows
 *  the drawing rather than the drawing being trapped inside the enclosure. */
function fitEnclosure(): void {
  const suggestion = suggestEnvelope(metrics.roadHalfX, metrics.roadHalfZ, record.perimeter);
  commit({
    ...record,
    perimeter: suggestion.perimeter,
    regionHalfX: suggestion.regionHalfX,
    regionHalfZ: suggestion.regionHalfZ,
  });
  form.sync();
  const fitted = `wall ${suggestion.perimeter.halfX} x ${suggestion.perimeter.halfZ}, region ${suggestion.regionHalfX} x ${suggestion.regionHalfZ}`;
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

function hasSelection(): boolean {
  return dressing !== null;
}

function applySideTab(): void {
  const field = TOOL_VALUE_FIELDS[tool()];
  const panel = panelLayout({
    mode: railMode,
    drawn,
    chosen: sideChoice,
    hasSelection: hasSelection(),
    hasToolValue: field !== null,
    toolValueIsProps: tool() === 'props',
  });
  shell.setSideTab(panel.tabs, panel.active);
  library.el.hidden = !panel.showLibrary;
  inspector.el.hidden = !panel.showInspector;
  outliner.el.hidden = !panel.showOutliner;
  form.el.hidden = !panel.showForm;
  modeReadout.el.hidden = !panel.showModeReadout;
  shell.setToolValueField(field, panel.showToolValue);
  requestRedraw();
}

/** Everything whose availability depends on there being a circuit at all. */
function refreshChrome(): void {
  // A blank canvas has exactly one thing to do, so it says so rather than
  // leaving whatever mode the last circuit was being edited in selected under a
  // disabled rail entry.
  if (!drawn && railMode !== 'shape') setRailMode('shape');
  emptyEl.hidden = drawn;
  for (const id of CIRCUIT_ONLY_ACTIONS) shell.setEnabled(id, drawn);
  shell.setDocument(record.id, dirty);
  shell.setBanner(railMode, drawn, redrawing);
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
  shell.setArmed(railMode === 'props' ? armStateText(asset, POND_CHOICE) : '');
  canvas.style.cursor = asset === null ? 'crosshair' : 'copy';
  requestRedraw();
}

function setRailMode(next: RailModeId): void {
  // Leaving SHAPE cancels a pending redraw: an arm that survived a trip through
  // another tool would eat the operator's next stroke.
  if (next !== 'shape') redrawing = false;
  railMode = next;
  selection = null;
  dressing = null;
  sideChoice = null;
  shell.setMode(railMode, drawn, redrawing);
  // Leaving props disarms: an arm that survived a trip through the width tool
  // would place a piece on the operator's first click back.
  library.arm(next === 'props' ? library.armed : null);
  applySideTab();
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
  if (active === 'race') return;
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
  if (drawn && (active === 'width' || active === 'props')) {
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
    moveDressingGesture(point);
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
      fitEnclosure();
    } else {
      setStatus('stroke too short to fit a loop: draw a bigger one', 'err');
    }
  }
  if (painting) reportStroke();
  if (dressingDrag) endDressingGesture();
  panning = null;
  painting = false;
  paintBefore = null;
  paintOrigin = null;
  paintFractions = [];
  dragging = null;
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
  selection = null;
  dressing = null;
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
  selection = null;
  dressing = null;
  // A shipped record is loaded under a DRAFT id, so editing it can never hand
  // the memoized derivation of a live circuit a shape the game did not author.
  // Committed before the flag moves, for the same reason as `newBlank`.
  commit(circuit);
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
      redrawing = false;
      dressing = null;
      library.arm(null);
      applySideTab();
      shell.setMode(railMode, drawn);
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
    case 'fitEnclosure':
      fitEnclosure();
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
      // Reported so a change the operator made is visibly the tool's now.
      const field = TOOL_VALUE_FIELDS[tool()];
      if (field) setStatus(`${field.label}: ${shell.toolValueInput.value}`, '');
    },
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

const panelHost: LibraryHost = {
  record: () => record,
  metrics: () => metrics,
  track: () => track,
  drawn: () => drawn,
  mode: () => railMode,
  selection: () => dressing,
  commit: (next) => commit(next),
  commitDressing: (next) => commitDressing(next),
  setStatus,
  onArmed: announceArmed,
};

const form = new RecordFormPanel(panelHost);
const inspector = new InspectorPanel(panelHost);
const outliner = new OutlinerPanel(panelHost);
const library = new LibraryPanel(panelHost);
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
  // The SELECTION chords go through the same table as everything else. They were
  // matched inline here against `ev.key` literals, which made them a fifth
  // hand-kept copy of the very list the table exists to be the only copy of:
  // re-spelling `rotateProp` in the table would have moved the tooltip, the hint
  // and the cheatsheet while the page went on acting on the old key.
  const selected = actionForSelectionShortcut(ev);
  if (selected) {
    if (tool() === 'props') {
      if (!dressing) return;
      ev.preventDefault();
      runSelectionAction(selected);
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

/** What a selection chord does to the armed dressing piece. */
function runSelectionAction(id: ActionId): void {
  switch (id) {
    case 'deleteSelection':
      deleteDressing();
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

window.addEventListener('resize', () => {
  requestRedraw();
  dock.reflow(planArea());
  preview?.resize();
});

// The page's one teardown. A dev tool is left open for hours and reloaded often;
// giving the GL context and the built circuit back on the way out is what keeps
// a reload from stacking contexts until the browser starts dropping the oldest.
window.addEventListener('pagehide', () => {
  preview?.dispose();
  preview = null;
});

// ---- boot ----

shell.sideBodyEl.append(library.el, inspector.el, outliner.el, modeReadout.el, form.el);
shell.showMetrics(layout.metricsOpen);
syncToggles();
shell.setPreviewReady('off');
newBlank();
// The stored zoom, applied after the blank canvas framed itself: the operator
// left the plan at a zoom they were working at, and `newBlank` frames the room a
// circuit has rather than the one they were looking at.
if (layout.zoom) {
  view.scale = layout.zoom;
  requestRedraw();
}
