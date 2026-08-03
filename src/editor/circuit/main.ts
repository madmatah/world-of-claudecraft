// The circuit editor page: the plan canvas, pointer routing, and the workbench
// chrome hung off it.
//
// Every decision lives in a core (`stroke_fit_core`, `handles_core`,
// `export_core`, `layout_core`) or in the sim (`realmRacersTrack` for the
// geometry, `realmRacersCircuitMetrics` for the readout). Nothing here computes
// anything about a circuit or about the shell: this file turns pointers into
// calls and returned numbers into pixels, which is the only reason a page is
// allowed to be this long.
//
// The chrome itself is `shell.ts` (menu bar, rail, plan overlays, status bar,
// contextual panel) and `dock.ts` (the floating 3D panel). Both are structure
// over the same action table, so what this file wires is behavior.
//
// Dev tool: English-only, absent from every production build. See CLAUDE.md.

import { AREA_TRACK_URLS } from '../../game/music_tracks';
import { realmRacersTheme } from '../../render/realm_racers_themes';
import {
  type RallyPond,
  type RallyProp,
  type RallyScatter,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  REALM_RACERS_THEME_IDS,
  type RealmRacersBasin,
  type RealmRacersCircuit,
  type RealmRacersCircuitRole,
} from '../../sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import {
  type RealmRacersCircuitMetrics,
  type RealmRacersCircuitProblem,
  realmRacersCircuitMetrics,
} from '../../sim/realm_racers_circuit_metrics';
import {
  type RallyPoint,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../../sim/realm_racers_layout';
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
import { circuitToTypeScript, roundCircuit, validateCircuitPayload } from './export_core';
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
  clampScale,
  type DockGeometry,
  type EditorLayout,
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
  MAX_LISTED_PROBLEMS,
  MODE_READOUT,
  needsCircuit,
  panelLayout,
  READOUT_SECTIONS,
  type ReadoutSection,
} from './panel_core';
import {
  authorPlacement,
  convertedProp,
  type DressingRect,
  type DressingSelection,
  hitTestPlaced,
  hitTestPondHandle,
  hitTestPonds,
  movedProp,
  type PondHandle,
  pondFromDrag,
  pondHandlePoints,
  pondWithHandleAt,
  propFrameOf,
  propPalette,
  propProjectionHint,
  removedAt,
  replacedAt,
  rotatedProp,
  scaledProp,
  scatterFromRect,
  tangentProp,
  toggledCollide,
} from './props_core';
import { detectPlatform, EditorShell } from './shell';
import { fitStrokeToControlPoints } from './stroke_fit_core';
import { suggestWidthBands } from './width_fix_core';

type Selection = { kind: 'point'; index: number } | null;

/**
 * The music a circuit may name.
 *
 * The area-track table is the set the game can actually stream for a lane, so it
 * is the honest vocabulary; a circuit naming anything else would play silence. Read
 * off that table rather than re-listed here, so a new track appears in the picker
 * the moment the game can play it.
 */
const MUSIC_TRACK_IDS: readonly string[] = Object.keys(AREA_TRACK_URLS);

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

/**
 * An oval a new circuit opens on, so the tool never starts on geometry the
 * spline cannot read. Local yards, counter-clockwise, and sized to clear the
 * template's perimeter wall with its road on: a tool that opens on a circuit
 * its own panel is complaining about teaches the operator to ignore the panel.
 */
function blankControlPoints(): RallyPoint[] {
  return Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2;
    return { x: Math.round(Math.cos(angle) * 95), z: Math.round(Math.sin(angle) * 55) };
  });
}

function blankCircuit(): RealmRacersCircuit {
  const template = REALM_RACERS_CIRCUIT_LIST[0];
  return {
    ...template,
    id: 'draft_circuit',
    controlPoints: blankControlPoints(),
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
/**
 * What a click on empty plan PLACES: a catalog asset, the pond, or nothing.
 *
 * Null is the pointer, and it is the default. With something permanently armed,
 * a click that missed the bench the operator meant to grab silently authored a
 * second bench, which is the worst kind of edit: one nobody asked for, at a place
 * nobody chose. Arming is now a deliberate act with a visible state in the status
 * bar, and `esc` puts the pointer back.
 */
let paletteChoice: string | null = null;
let paletteShowAll = false;
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
const platform = detectPlatform();

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

function setStatus(text: string, cls: '' | 'ok' | 'err' = ''): void {
  shell.setMessage(text, cls);
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

/** Every edit lands here: it rounds to what the export carries, re-derives the
 *  geometry and the readout, and schedules a repaint. */
/** Every edit records the state it is LEAVING through here, so no site can
 *  forget that a new edit drops the forward branch. */
function pushUndo(): void {
  history.push({ record, drawn });
}

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
  if (record.theme !== paletteTheme) {
    paletteTheme = record.theme;
    buildPalette();
  }
  // The preview debounces this itself: a drag lands one build on release, never
  // one per pointermove.
  if (drawn) preview?.show(record);
}

function restore(snapshot: EditSnapshot): void {
  selection = null;
  dressing = null;
  drawn = snapshot.drawn;
  commit(snapshot.record, false);
  syncForm();
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
  // A blank canvas frames the room a circuit HAS; the placeholder record's own
  // extents would be framing a shape nobody drew.
  const half = drawn
    ? Math.max(metrics.roadHalfX, metrics.roadHalfZ, 20) * 1.15
    : Math.max(REALM_RACERS_MAX_REGION_HALF_X, REALM_RACERS_MAX_REGION_HALF_Z) * 1.12;
  view.x = 0;
  view.z = 0;
  view.scale = Math.min(plan.width, plan.height) / (2 * half);
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
  const step = gridStepAt(view.scale);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const left = view.x - width / (2 * view.scale);
  const right = view.x + width / (2 * view.scale);
  const top = view.z - height / (2 * view.scale);
  const bottom = view.z + height / (2 * view.scale);
  ctx.save();
  ctx.strokeStyle = '#1d212b';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.ceil(left / step) * step; x <= right; x += step) {
    ctx.moveTo(screenX(x), 0);
    ctx.lineTo(screenX(x), height);
  }
  for (let z = Math.ceil(top / step) * step; z <= bottom; z += step) {
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
    ctx.fillStyle = chosen ? '#ffd479' : index === 0 ? '#7fd48a' : '#7fb2e8';
    ctx.beginPath();
    ctx.arc(screenX(point.x), screenY(point.z), chosen ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  });
}

/**
 * The room a circuit has, drawn on a blank canvas.
 *
 * On a blank canvas the readout is hidden, so the two ceilings a circuit lives
 * under (`REALM_RACERS_MAX_REGION_HALF_X`, set by the instance band, and
 * `REALM_RACERS_MAX_REGION_HALF_Z`, set by the gap between two lanes) are
 * nowhere on screen at the exact moment they matter most: before the first
 * stroke. The inner box is what an operator actually aims at, since the line
 * they draw carries a road and a garden either side of it and only the
 * CENTERLINE is under the pen.
 */
function drawLimits(): void {
  const road = Math.max(...record.widthBands.map((band) => band.halfWidth));
  const gardenEdge = road + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH;
  // The wall has to sit strictly inside the region, and the road inside the
  // wall, so a yard comes off before the garden either side does.
  const halfX = REALM_RACERS_MAX_REGION_HALF_X - 1;
  const halfZ = REALM_RACERS_MAX_REGION_HALF_Z - 1;
  strokeRect(halfX, halfZ, '#3a4054', [8, 6]);
  strokeRect(halfX - gardenEdge, halfZ - gardenEdge, '#55607a', [3, 3]);

  ctx.fillStyle = '#6f7890';
  ctx.font = '12px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    `widest a circuit may be: ${halfX * 2} x ${halfZ * 2} yd`,
    screenX(0),
    screenY(-halfZ) - 8,
  );
  // Inside its own box rather than under it: sat on the outer frame it read as
  // a label for the wrong rectangle.
  ctx.fillText(
    `keep the line you draw inside ${Math.round((halfX - gardenEdge) * 2)} x ${Math.round((halfZ - gardenEdge) * 2)} yd`,
    screenX(0),
    screenY(halfZ - gardenEdge) - 8,
  );
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
    ctx.strokeStyle = problem.severity === 'error' ? '#e08a8a' : '#e0c48a';
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
    ctx.strokeStyle = '#e08a8a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(screenX(a.x), screenY(a.z));
    ctx.lineTo(screenX(b.x), screenY(b.z));
    ctx.stroke();
    ctx.restore();
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
  const placed = placedPropIndices();
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
  const named = view.scale > 1.6;
  for (const [index, prop] of placements.props.entries()) {
    const chosen = dressing?.kind === 'prop' && dressing.index === placed[index];
    ctx.strokeStyle = chosen ? '#ffd479' : prop.solid ? '#e0a86f' : '#8fb2d8';
    ctx.lineWidth = chosen ? 2 : 1;
    traceFootprint(prop);
    if (prop.solid) {
      ctx.fillStyle = chosen ? 'rgba(255, 212, 121, 0.35)' : 'rgba(224, 168, 111, 0.25)';
      ctx.fill();
    }
    ctx.stroke();
    if (!named) continue;
    ctx.fillStyle = '#9aa3b5';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(prop.asset, screenX(prop.x) + 6, screenY(prop.z) - 6);
  }

  // A selected pond gets its handles; the outline itself is drawn with the
  // surfaces, because it is water whatever mode the tool is in.
  if (dressing?.kind === 'pond') {
    const pond = record.ponds?.[dressing.index];
    if (pond) {
      ctx.fillStyle = '#ffd479';
      for (const handle of Object.values(pondHandlePoints(pond))) {
        ctx.beginPath();
        ctx.arc(screenX(handle.x), screenY(handle.z), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // The GHOST: what the next click will put down, where it will put it.
  //
  // Resolved through `realmRacersPlacements` on a record carrying the pending
  // piece, never worked out here: a ghost that drew its own footprint would be a
  // second derivation of a placement, which is the exact class of bug the one
  // resolver exists to make impossible. So the outline under the cursor is the
  // outline the collision set will hold.
  const ghost = ghostPlacement();
  if (ghost) {
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#ffd479';
    ctx.lineWidth = 1.5;
    traceFootprint(ghost);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd479';
    ctx.font = '11px ui-monospace, Menlo, monospace';
    ctx.fillText(ghost.asset, screenX(ghost.x) + 8, screenY(ghost.z) - 8);
    ctx.restore();
  }

  if (dressingRect) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#e0c48a';
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
  ctx.fillStyle = '#14161c';
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
  strokeRect(record.regionHalfX, record.regionHalfZ, '#3a4054', [8, 6]);
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
const dressingTolerance = (): number => 7 / view.scale;

/**
 * The piece the cursor is carrying, placed where a click would place it.
 *
 * Null unless the props tool is armed and the pointer is over the plan. It goes
 * through the resolver on a throwaway record, which costs one resolve per
 * repaint: `drawDressing` already resolves once per repaint, so this is the same
 * order, and it is the only way for the ghost's footprint, yaw and solidity to be
 * the ones the game will use.
 */
function ghostPlacement(): RallyPlacedProp | null {
  if (!drawn || tool() !== 'props' || paletteChoice === null) return null;
  if (paletteChoice === POND_CHOICE || !hover || dressingDrag) return null;
  const point = authored(hover);
  const pending: RallyProp = {
    asset: paletteChoice,
    at: authorPlacement(record, point.x, point.z).at,
  };
  const props = [...(record.props ?? []), pending];
  // Its OWN id, and this is not cosmetic. `memoizePerCircuit` keeps one entry
  // per id and only while the record behind it is the same object, so a
  // throwaway wearing the real id EVICTS the real entry on every frame: the
  // spline model was being rebuilt twice per pointermove, once for the ghost and
  // once for the circuit it had just displaced.
  const placed = realmRacersPlacements({ ...record, props, id: `${record.id}__ghost` }).props;
  return placed[placed.length - 1] ?? null;
}

/**
 * Record indices of the props the resolver actually placed, in its own order.
 *
 * The resolver SKIPS a catalog key nothing authors rather than throwing, so a
 * record carrying one (a hand-pasted draft can) hands back a shorter list than
 * it was given. Without this map every selection past the unknown key would
 * edit the entry after the one the operator clicked.
 */
function placedPropIndices(): number[] {
  const out: number[] = [];
  (record.props ?? []).forEach((prop, index) => {
    if (prop.asset in REALM_RACERS_PROPS) out.push(index);
  });
  return out;
}

/** Where a record prop sits in the resolver's list, or -1. */
function placementIndexOf(recordIndex: number): number {
  return placedPropIndices().indexOf(recordIndex);
}

/** A seed a new scatter or pond gets. Taken off the record's own size rather
 *  than off a clock: the page must stay reloadable to the same circuit, and a
 *  seed nobody chose is still a number the operator can edit afterwards. */
function nextSeed(): number {
  return (record.scatters?.length ?? 0) + (record.ponds?.length ?? 0) + record.id.length;
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
    const index = placedPropIndices()[hitProp];
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
  if (paletteChoice === null) {
    dressing = null;
    applySideTab();
    requestRedraw();
    return;
  }

  // Nothing under the pointer: this is a placement. A pond and a scatter are
  // both dragged out over a box, a prop lands on the click.
  const point = authored(raw);
  if (rect || paletteChoice === POND_CHOICE) {
    dressingRect = { x0: point.x, z0: point.z, x1: point.x, z1: point.z };
    dressingDrag = 'rect';
    return;
  }
  const placement = authorPlacement(record, point.x, point.z);
  const props = [...(record.props ?? []), { asset: paletteChoice, at: placement.at }];
  dressing = { kind: 'prop', index: props.length - 1 };
  dressingDrag = 'move';
  dragHint = placement.hint;
  commitDressing({ props });
  applySideTab();
  setStatus(`placed ${paletteChoice} (${propFrameOf(props[props.length - 1])})`, 'ok');
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
  const armed = paletteChoice;
  if (dressingDrag === 'rect' && dressingRect && armed) {
    const box = dressingRect;
    const dragged = Math.hypot(box.x1 - box.x0, box.z1 - box.z0);
    if (dragged < 2) {
      setStatus('drag a box: a scatter fills a stretch of one side, a pond fills the box', 'err');
    } else if (armed === POND_CHOICE) {
      const ponds = [
        ...(record.ponds ?? []),
        pondFromDrag(box.x0, box.z0, box.x1, box.z1, nextSeed()),
      ];
      dressing = { kind: 'pond', index: ponds.length - 1 };
      commitDressing({ ponds });
      setStatus(`placed a pond, ${ponds.length} on this circuit`, 'ok');
    } else {
      const spacing = Number(shell.toolValueInput.value);
      const scatter = scatterFromRect(record, box, armed, spacing, nextSeed());
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

// ---- the library ----

/** The palette entry that places WATER rather than a catalog piece. Ponds live
 *  in the same list because placing one is the same gesture, and a mode of
 *  their own is what the deleted water paint already was. */
const POND_CHOICE = 'pond';

/** Which theme the palette on screen was built for. */
let paletteTheme = '';

const libraryEl = document.createElement('div');
const paletteListEl = document.createElement('div');
paletteListEl.className = 'palette-list';
const pointerButton = document.createElement('button');
pointerButton.type = 'button';
pointerButton.className = 'pointer-mode';
pointerButton.title =
  'Select and edit what is already there. A click on empty plan places nothing (esc)';
pointerButton.onclick = () => armPalette(null);
const paletteAllLabel = document.createElement('label');
paletteAllLabel.id = 'paletteAllLabel';
const paletteAllEl = document.createElement('input');
paletteAllEl.type = 'checkbox';
paletteAllLabel.append(paletteAllEl, ' show the whole catalog');

/** What the status bar says a click will do, and what the palette highlights. */
function armPalette(key: string | null): void {
  paletteChoice = key;
  buildPalette();
  shell.setArmed(railMode === 'props' ? armStateText(paletteChoice, POND_CHOICE) : '');
  // The pointer itself says which of the two states the tool is in, before the
  // operator has read anything: a crosshair selects, a copy cursor places.
  canvas.style.cursor = key === null ? 'crosshair' : 'copy';
  requestRedraw();
}

function buildPalette(): void {
  libraryEl.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'library';
  paletteListEl.replaceChildren();
  const entries = propPalette(REALM_RACERS_PROPS, realmRacersTheme(record).props);
  const shown = paletteShowAll ? entries : entries.filter((entry) => entry.featured);
  const choose = (key: string, label: string, detail: string): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = detail;
    button.classList.toggle('on', paletteChoice === key);
    // Clicking the armed piece again disarms it, so the pointer is always one
    // click away from wherever the operator's hand already is.
    button.onclick = () => armPalette(paletteChoice === key ? null : key);
    paletteListEl.append(button);
  };
  choose(POND_CHOICE, 'pond', 'Drag a box: decorative water, no slow and no mechanic');
  for (const entry of shown) choose(entry.asset, entry.asset, entry.group);
  // The pointer is a MODE, not a piece, so it gets its own row above the pieces.
  // Sat inside the list as the first tile it read as "the first asset is armed",
  // which is the opposite of what it means.
  pointerButton.classList.toggle('on', paletteChoice === null);
  pointerButton.textContent =
    paletteChoice === null ? 'pointer (armed)' : `pointer (esc) - placing ${paletteChoice}`;
  const hint = document.createElement('div');
  hint.className = 'hint-line';
  hint.textContent =
    railMode === 'props'
      ? paletteChoice === null
        ? 'arm a piece above, then click the plan to place one'
        : 'click the plan to place one; shift+drag a box to sow a whole patch of them at the spacing above'
      : 'arm a piece here, then switch to the PROPS tool to place it';
  libraryEl.append(heading, pointerButton, paletteListEl, paletteAllLabel, hint);
}

paletteAllEl.onchange = () => {
  paletteShowAll = paletteAllEl.checked;
  buildPalette();
};

// ---- the outliner ----
//
// What is STANDING on this circuit, entry by entry. The drawer counts the
// dressing in aggregate, which answers "how much" and never "which one", and on
// a dressed circuit the fourth lantern is the thing an operator is looking for.

const outlinerEl = document.createElement('div');

function outlinerRow(name: string, detail: string, solid = false): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'outline-row';
  const label = document.createElement('span');
  label.className = 'n';
  label.textContent = name;
  const note = document.createElement('span');
  note.textContent = detail;
  row.append(label, note);
  if (solid) {
    const mark = document.createElement('span');
    mark.className = 'solid';
    mark.textContent = 'solid';
    row.append(mark);
  }
  return row;
}

function paintOutliner(): void {
  if (outlinerEl.hidden) return;
  outlinerEl.replaceChildren();
  if (!drawn) return;
  const placements = realmRacersPlacements(record);
  const props = record.props ?? [];
  // Hoisted: called per prop it walks the whole list per prop, which is
  // quadratic and allocates an array each time, on a path that runs per frame.
  const placed = placedPropIndices();
  const heading = (text: string): void => {
    const h = document.createElement('h2');
    h.textContent = text;
    outlinerEl.append(h);
  };

  heading(`props (${props.length})`);
  if (props.length === 0) outlinerEl.append(outlinerRow('nothing placed', ''));
  props.forEach((prop, index) => {
    const at = placements.props[placed.indexOf(index)];
    const where = at ? `${at.x.toFixed(0)}, ${at.z.toFixed(0)}` : 'not drawn';
    outlinerEl.append(outlinerRow(prop.asset, where, Boolean(at?.solid)));
  });

  const scatters = record.scatters ?? [];
  heading(`scatters (${scatters.length}, ${metrics.scatterCount} pieces)`);
  for (const scatter of scatters) {
    outlinerEl.append(outlinerRow(scatter.asset, `${scatter.zone}, ${scatter.spacing} yd`));
  }

  const ponds = record.ponds ?? [];
  heading(`ponds (${ponds.length})`);
  ponds.forEach((pond, index) => {
    outlinerEl.append(
      outlinerRow(`pond ${index}`, `${(pond.rx * 2).toFixed(0)} x ${(pond.rz * 2).toFixed(0)} yd`),
    );
  });

  const hint = document.createElement('div');
  hint.className = 'hint-line';
  hint.textContent = 'click a piece on the plan to edit its numbers';
  outlinerEl.append(hint);
}

// ---- the inspector ----
//
// The numbers behind the selection, editable. Rebuilt with the readout, EXCEPT
// while one of its own inputs has the caret: a drag repaints the panel, and
// rebuilding under a half-typed number would take the focus out of it.

const inspectorEl = document.createElement('div');
inspectorEl.id = 'inspector';

function inspectorRow(
  label: string,
  value: string,
  write: (raw: string) => void,
  attrs: Partial<HTMLInputElement> = {},
): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const name = document.createElement('label');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = attrs.type ?? 'number';
  Object.assign(input, attrs);
  input.value = value;
  input.onchange = () => write(input.value);
  name.append(input);
  wrap.append(name);
  inspectorEl.append(wrap);
}

function inspectorButton(label: string, onClick: () => void): void {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.onclick = onClick;
  inspectorEl.append(button);
}

function paintInspector(): void {
  if (inspectorEl.hidden || inspectorEl.contains(document.activeElement)) return;
  inspectorEl.replaceChildren();
  if (!dressing) {
    const hint = document.createElement('div');
    hint.className = 'hint-line';
    hint.textContent =
      railMode === 'props'
        ? 'click a prop, a scatter or a pond on the plan'
        : 'the PROPS tool is where a piece is selected';
    inspectorEl.append(hint);
    return;
  }
  const title = document.createElement('h2');
  title.textContent = `${dressing.kind} ${dressing.index}`;
  inspectorEl.append(title);
  const number = (raw: string, fallback: number): number =>
    Number.isFinite(Number(raw)) ? Number(raw) : fallback;

  if (dressing.kind === 'prop') {
    const prop = selectedProp();
    if (!prop) return;
    const index = dressing.index;
    const placed = realmRacersPlacements(record).props[placementIndexOf(index)];
    const edit = (next: RallyProp): void =>
      commitDressing({ props: replacedAt(record.props, index, next) });
    if ('s' in prop.at) {
      inspectorRow(
        'lap fraction',
        String(prop.at.s),
        (raw) => {
          const at = prop.at as { s: number; offset: number };
          edit({ ...prop, at: { s: number(raw, at.s), offset: at.offset } });
        },
        { step: '0.001', min: '0', max: '1' },
      );
      inspectorRow(
        'offset (yd)',
        String(prop.at.offset),
        (raw) => {
          const at = prop.at as { s: number; offset: number };
          edit({ ...prop, at: { s: at.s, offset: number(raw, at.offset) } });
        },
        { step: '0.5' },
      );
    } else {
      inspectorRow(
        'x',
        String(prop.at.x),
        (raw) => {
          const at = prop.at as { x: number; z: number };
          edit({ ...prop, at: { x: number(raw, at.x), z: at.z } });
        },
        { step: '0.5' },
      );
      inspectorRow(
        'z',
        String(prop.at.z),
        (raw) => {
          const at = prop.at as { x: number; z: number };
          edit({ ...prop, at: { x: at.x, z: number(raw, at.z) } });
        },
        { step: '0.5' },
      );
    }
    inspectorRow(
      'yaw (rad)',
      prop.yaw === 'tangent' ? '' : String(prop.yaw ?? 0),
      (raw) => {
        edit({ ...prop, yaw: number(raw, 0) });
      },
      { step: '0.05' },
    );
    inspectorRow(
      'scale',
      String(prop.scale ?? 1),
      (raw) => {
        edit({ ...prop, scale: number(raw, 1) });
      },
      { step: '0.05', min: '0.05', max: '50' },
    );
    if (placed) {
      const detail = document.createElement('div');
      detail.className = 'd';
      detail.textContent = `${propFrameOf(prop)}, ${placed.solid ? 'solid' : 'decor'}, stands at ${placed.x.toFixed(1)}, ${placed.z.toFixed(1)}`;
      inspectorEl.append(detail);
      inspectorButton('to the other frame', () => {
        edit(convertedProp(record, prop, placed.x, placed.z));
      });
    }
    inspectorButton(prop.collide === 'none' ? 'make it solid again' : 'stop it colliding', () => {
      edit(toggledCollide(prop));
    });
    return;
  }

  if (dressing.kind === 'scatter') {
    const scatter = (record.scatters ?? [])[dressing.index];
    if (!scatter) return;
    const index = dressing.index;
    const edit = (next: RallyScatter): void =>
      commitDressing({ scatters: replacedAt(record.scatters, index, next) });
    inspectorRow(
      'spacing (yd)',
      String(scatter.spacing),
      (raw) => {
        edit({ ...scatter, spacing: number(raw, scatter.spacing) });
      },
      { step: '0.5', min: '1', max: '200' },
    );
    inspectorRow(
      'seed',
      String(scatter.seed),
      (raw) => {
        edit({ ...scatter, seed: Math.round(number(raw, scatter.seed)) });
      },
      { step: '1' },
    );
    if (scatter.span) {
      const span = scatter.span;
      inspectorRow(
        'span from',
        String(span.s0),
        (raw) => {
          edit({ ...scatter, span: { s0: number(raw, span.s0), s1: span.s1 } });
        },
        { step: '0.01', min: '0', max: '1' },
      );
      inspectorRow(
        'span to',
        String(span.s1),
        (raw) => {
          edit({ ...scatter, span: { s0: span.s0, s1: number(raw, span.s1) } });
        },
        { step: '0.01', min: '0', max: '1' },
      );
    }
    const detail = document.createElement('div');
    detail.className = 'd';
    detail.textContent = `${scatter.asset}, ${scatter.zone}`;
    inspectorEl.append(detail);
    inspectorButton(
      scatter.zone === 'infield' ? 'move to the outfield' : 'move to the infield',
      () => {
        edit({ ...scatter, zone: scatter.zone === 'infield' ? 'outfield' : 'infield' });
      },
    );
    return;
  }

  const pond = (record.ponds ?? [])[dressing.index];
  if (!pond) return;
  const index = dressing.index;
  const edit = (next: RallyPond): void =>
    commitDressing({ ponds: replacedAt(record.ponds, index, next) });
  inspectorRow('x', String(pond.x), (raw) => edit({ ...pond, x: number(raw, pond.x) }), {
    step: '0.5',
  });
  inspectorRow('z', String(pond.z), (raw) => edit({ ...pond, z: number(raw, pond.z) }), {
    step: '0.5',
  });
  inspectorRow('radius x', String(pond.rx), (raw) => edit({ ...pond, rx: number(raw, pond.rx) }), {
    step: '0.5',
    min: '0.5',
  });
  inspectorRow('radius z', String(pond.rz), (raw) => edit({ ...pond, rz: number(raw, pond.rz) }), {
    step: '0.5',
    min: '0.5',
  });
  inspectorRow('rotation', String(pond.rot ?? 0), (raw) => edit({ ...pond, rot: number(raw, 0) }), {
    step: '0.05',
  });
  inspectorRow(
    'wobble',
    String(pond.wobble ?? 0.15),
    (raw) => edit({ ...pond, wobble: number(raw, 0.15) }),
    {
      step: '0.01',
      min: '0',
      max: '0.35',
    },
  );
  inspectorRow(
    'seed',
    String(pond.seed ?? 0),
    (raw) => edit({ ...pond, seed: Math.round(number(raw, 0)) }),
    {
      step: '1',
    },
  );
}

// ---- the readout drawer ----

function row(table: HTMLTableElement, key: string, value: string, cls = ''): void {
  const tr = table.insertRow();
  const k = tr.insertCell();
  k.className = 'k';
  k.textContent = key;
  const v = tr.insertCell();
  v.className = `v ${cls}`.trim();
  v.textContent = value;
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h2');
  h.textContent = text;
  return h;
}

function problemLine(problem: RealmRacersCircuitProblem): HTMLDivElement {
  const div = document.createElement('div');
  div.className = `problem ${problem.severity}`;
  const label = document.createElement('div');
  label.className = 'c';
  label.textContent = problemHeadline(problem);
  const detail = document.createElement('div');
  detail.className = 'd';
  detail.textContent = problemDetail(problem);
  div.append(label, detail);
  return div;
}

/**
 * The readout, section by section, each one an element.
 *
 * Sections rather than one paint, because two surfaces show them: the drawer
 * shows every one, and the right panel shows the SECTIONS THE ACTIVE TOOL IS
 * ABOUT (shape's geometry while shaping, the road profile while painting it).
 * One builder each, so the two can never quote a different number for the same
 * measurement.
 */
function readoutSection(section: ReadoutSection): HTMLElement[] {
  const table = document.createElement('table');
  switch (section) {
    case 'shape':
      row(table, 'lap', `${metrics.lapLength.toFixed(1)} yd`);
      row(table, 'samples', String(metrics.sampleCount));
      row(
        table,
        'total turning',
        `${metrics.turningDegrees.toFixed(1)} deg`,
        Math.abs(Math.abs(metrics.turningDegrees) - 360) > 5 ? 'bad' : 'good',
      );
      row(
        table,
        'winding',
        metrics.winding > 0 ? 'counter-clockwise' : 'clockwise',
        metrics.winding > 0 ? 'good' : 'bad',
      );
      row(table, 'control points', String(record.controlPoints.length));
      break;
    case 'corners':
      row(table, 'tightest corner', `${metrics.tightestRadius.toFixed(1)} yd`);
      row(
        table,
        'radius / road',
        metrics.minRadiusOverWidth.toFixed(2),
        metrics.minRadiusOverWidth < 1 ? 'bad' : metrics.minRadiusOverWidth < 1.5 ? 'warn' : 'good',
      );
      row(table, 'at', `${metrics.minRadiusOverWidthAtS.toFixed(0)} yd`);
      break;
    case 'stretches': {
      const nearest = metrics.nearestApproach;
      row(
        table,
        'nearest approach',
        Number.isFinite(nearest.distance) ? `${nearest.distance.toFixed(1)} yd` : 'none',
        Number.isFinite(nearest.distance) && nearest.distance < 48 ? 'bad' : 'good',
      );
      row(table, 'tangent dot', nearest.tangentDot.toFixed(2));
      row(table, 'between', `${nearest.s.toFixed(0)} and ${nearest.otherS.toFixed(0)} yd`);
      row(table, 'shooting corridor', `${metrics.shootingCorridorYards.toFixed(0)} yd`);
      break;
    }
    case 'surface': {
      // What the brush actually left on the circuit, read back off the derived
      // samples rather than off the band table: the table is breakpoints and the
      // road is samples, and only the second one is what a racer meets.
      const halfWidths = track.samples.map((sample) => sample.halfWidth);
      row(
        table,
        'road half-width',
        `${Math.min(...halfWidths).toFixed(1)} to ${Math.max(...halfWidths).toFixed(1)} yd`,
      );
      row(table, 'width bands', String(record.widthBands.length));
      row(table, 'recovery anchors', String(realmRacersGates(record).length));
      break;
    }
    case 'dressing': {
      // What is STANDING on the circuit, counted off the resolver rather than off
      // the record: a scatter is a handful of rows and hundreds of pieces, and
      // the pieces are what the operator is looking at.
      row(table, 'props', String(metrics.propCount));
      row(table, 'solid props', String(metrics.solidPropCount));
      row(table, 'scatters', `${record.scatters?.length ?? 0} (${metrics.scatterCount} pieces)`);
      row(table, 'ponds', String(metrics.pondCount));
      row(table, 'water authored', record.basin ? 'yes' : 'no');
      const unknown = realmRacersPlacements(record).unknownAssets;
      if (unknown.length > 0) row(table, 'unknown keys', unknown.join(', '), 'bad');
      break;
    }
    default:
      row(table, 'road half-extent x', `${metrics.roadHalfX.toFixed(0)} yd`);
      row(table, 'road half-extent z', `${metrics.roadHalfZ.toFixed(0)} yd`);
      // The two ceilings, so a circuit that cannot fit the band says so BEFORE
      // the operator has drawn a lap around it.
      row(
        table,
        'widest region',
        `${REALM_RACERS_MAX_REGION_HALF_X} yd`,
        record.regionHalfX > REALM_RACERS_MAX_REGION_HALF_X ? 'bad' : '',
      );
      row(
        table,
        'deepest region',
        `${REALM_RACERS_MAX_REGION_HALF_Z} yd`,
        record.regionHalfZ > REALM_RACERS_MAX_REGION_HALF_Z ? 'bad' : '',
      );
      break;
  }
  return [heading(section), table];
}

function problemsBlock(): HTMLElement[] {
  const out: HTMLElement[] = [heading('problems')];
  if (metrics.problems.length === 0) {
    const clean = document.createElement('div');
    clean.className = 'clean';
    clean.textContent = 'none: this is drivable geometry';
    out.push(clean);
    return out;
  }
  // Capped, and the cap SAYS so: a list that silently stopped at ten would read
  // as "ten problems" when there are thirty.
  for (const problem of metrics.problems.slice(0, MAX_LISTED_PROBLEMS)) {
    out.push(problemLine(problem));
  }
  if (metrics.problems.length > MAX_LISTED_PROBLEMS) {
    const more = document.createElement('div');
    more.className = 'd';
    more.textContent = `and ${metrics.problems.length - MAX_LISTED_PROBLEMS} more`;
    out.push(more);
  }
  return out;
}

function paintReadout(): void {
  const body = shell.metricsBodyEl;
  body.replaceChildren();
  if (!drawn) return;
  for (const section of READOUT_SECTIONS) body.append(...readoutSection(section));
  body.append(...problemsBlock());
}

const modeReadoutEl = document.createElement('div');

function paintModeReadout(): void {
  if (modeReadoutEl.hidden) return;
  modeReadoutEl.replaceChildren();
  if (!drawn) return;
  for (const section of MODE_READOUT[railMode]) modeReadoutEl.append(...readoutSection(section));
  const hint = document.createElement('div');
  hint.className = 'hint-line';
  hint.textContent = 'the whole readout is under View > metrics detail';
  modeReadoutEl.append(hint);
}

// ---- the record form ----
//
// Everything a circuit holds that is NOT drawn: the id, the enclosure, and the
// race. Built once and only synced, because rebuilding it on every drag would
// take the focus out of an input the operator is still typing in.

interface FormField {
  input: HTMLInputElement | HTMLSelectElement;
  read: () => string;
  /**
   * How this control re-reads the record, when assigning `value` is not enough.
   *
   * A `<select>` given a value no option carries goes BLANK, silently. Every
   * commit the control did not make itself lands here (an undo, a Load, a fresh
   * draft), so a select whose options were built for the previous record has to
   * rebuild them rather than take the assignment.
   */
  sync?: () => void;
}

const formEl = document.createElement('div');
const formFields: FormField[] = [];
/** The rows only a PRACTICE circuit has, hidden when it is not one. */
const practiceRows: HTMLElement[] = [];
/** The role checkboxes, synced from the record rather than trusted. */
const roleBoxes = new Map<RealmRacersCircuitRole, HTMLInputElement>();

/**
 * One edit, validated the way the SAVE endpoint validates.
 *
 * Checked through `validateCircuitPayload` rather than against a second copy of
 * every field's range here: a value the form accepts that the endpoint would
 * refuse is a draft the operator cannot save, found out one step too late. A
 * value that is merely unwise (a region deeper than the lane budget) still lands,
 * because the readout is what says so.
 */
function applyEdit(label: string, next: RealmRacersCircuit | null, refusal?: string): boolean {
  const valid = next && validateCircuitPayload(next);
  if (!valid) {
    setStatus(refusal ?? `${label}: not a value a circuit can carry`, 'err');
    return false;
  }
  commit(valid);
  return true;
}

function fieldRow(label: string): { wrap: HTMLDivElement; name: HTMLLabelElement } {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const name = document.createElement('label');
  name.textContent = label;
  wrap.append(name);
  return { wrap, name };
}

function field(
  parent: HTMLElement,
  label: string,
  read: () => string,
  write: (raw: string) => RealmRacersCircuit | null,
  attrs: Partial<HTMLInputElement> = {},
): HTMLDivElement {
  const { wrap, name } = fieldRow(label);
  const input = document.createElement('input');
  input.type = attrs.type ?? 'number';
  Object.assign(input, attrs);
  input.value = read();
  input.onchange = () => {
    // Written back HERE on a refusal rather than through syncForm, which
    // deliberately skips the focused input: a refused edit is the one case where
    // the field still holds the caret and must be overwritten anyway, or the
    // panel shows a number the record does not carry.
    if (!applyEdit(`${label}: ${input.value}`, write(input.value))) input.value = read();
    syncForm();
  };
  name.append(input);
  parent.append(wrap);
  formFields.push({ input, read });
  return wrap;
}

/** The option value that means "not one of the above". */
const CUSTOM_OPTION = '__custom__';

/**
 * A real `<select>` over a known set, with a way out.
 *
 * It replaced a datalist, which only ever worked as a SEARCH: there was no way to
 * see what the themes even were, which is the first thing anyone wants from a
 * fixed vocabulary. The way out matters too, and it is why this is not a plain
 * select: an id being written in the same change is legally typeable, and the
 * readout is what says whether a registry authors it (`unknown_theme`). A value
 * already on the record that is not in the list is added as an option, so the
 * control always shows the truth.
 */
function selectField(
  parent: HTMLElement,
  label: string,
  read: () => string,
  write: (raw: string) => RealmRacersCircuit | null,
  choices: readonly string[],
): HTMLDivElement {
  const { wrap, name } = fieldRow(label);
  const select = document.createElement('select');
  const custom = document.createElement('input');
  custom.type = 'text';
  custom.placeholder = 'id not in the list';
  custom.hidden = true;

  const fill = (): void => {
    const current = read();
    const known = [...choices, ...(choices.includes(current) || !current ? [] : [current])];
    select.replaceChildren();
    for (const choice of known) {
      const option = document.createElement('option');
      option.value = choice;
      option.textContent = choices.includes(choice) ? choice : `${choice} (not in the list)`;
      select.append(option);
    }
    const other = document.createElement('option');
    other.value = CUSTOM_OPTION;
    other.textContent = 'other, type it';
    select.append(other);
    select.value = current;
  };
  fill();

  select.onchange = () => {
    if (select.value === CUSTOM_OPTION) {
      custom.hidden = false;
      custom.value = read();
      custom.focus();
      select.value = read();
      return;
    }
    custom.hidden = true;
    if (!applyEdit(`${label}: ${select.value}`, write(select.value))) fill();
    syncForm();
  };
  custom.onchange = () => {
    if (applyEdit(`${label}: ${custom.value}`, write(custom.value))) {
      custom.hidden = true;
      fill();
    }
    syncForm();
  };

  name.append(select);
  wrap.append(custom);
  parent.append(wrap);
  formFields.push({ input: select, read, sync: fill });
  return wrap;
}

/**
 * A role, on or off.
 *
 * The record needs at least one, so unchecking the last is REFUSED by name rather
 * than silently ignored: a checkbox that springs back with no explanation reads as
 * a broken control. Turning practice off also zeroes the copy count, because a
 * circuit nobody practises on has nothing to copy.
 */
function roleBox(parent: HTMLElement, role: RealmRacersCircuitRole, detail: string): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const name = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = record.roles.includes(role);
  name.append(box, ` ${role}`);
  name.title = detail;
  box.onchange = () => {
    const wanted = new Set(record.roles);
    if (box.checked) wanted.add(role);
    else wanted.delete(role);
    const roles = ROLE_ORDER.filter((entry) => wanted.has(entry));
    const next =
      roles.length === 0
        ? null
        : {
            ...record,
            roles,
            practiceCopies: roles.includes('practice') ? record.practiceCopies : 0,
          };
    applyEdit(
      role,
      next,
      'a circuit has to be at least one of competition or practice, so the last one cannot come off',
    );
    syncForm();
  };
  wrap.append(name);
  parent.append(wrap);
  roleBoxes.set(role, box);
}

const ROLE_ORDER: readonly RealmRacersCircuitRole[] = ['competition', 'practice'];

const asNumber = (raw: string, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

function buildForm(): void {
  formEl.replaceChildren();
  formFields.length = 0;
  practiceRows.length = 0;
  roleBoxes.clear();

  formEl.append(heading('roles'));
  const roles = document.createElement('div');
  roleBox(roles, 'competition', 'Drawn from the competition pool when a four-pilot roster fills');
  roleBox(roles, 'practice', 'Offered as practice, with one lane copy per practising player');
  formEl.append(roles);

  formEl.append(heading('race'));
  const race = document.createElement('div');
  field(
    race,
    'id',
    () => record.id,
    (raw) => ({ ...record, id: raw.trim() }),
    { type: 'text' },
  );
  field(
    race,
    'laps',
    () => String(record.laps),
    (raw) => ({ ...record, laps: Math.round(asNumber(raw, record.laps)) }),
    { min: '1', max: '20', step: '1' },
  );
  field(
    race,
    'time limit (s)',
    () => String(record.timeLimitSeconds),
    (raw) => ({ ...record, timeLimitSeconds: asNumber(raw, record.timeLimitSeconds) }),
    { min: '10', max: '3600', step: '10' },
  );
  field(
    race,
    'start back',
    () => String(record.startBack),
    (raw) => ({ ...record, startBack: asNumber(raw, record.startBack) }),
    { step: '0.5' },
  );
  field(
    race,
    'start spacing',
    () => String(record.startSpacing),
    (raw) => ({ ...record, startSpacing: asNumber(raw, record.startSpacing) }),
    { step: '0.5' },
  );
  practiceRows.push(
    field(
      race,
      'practice laps',
      () => String(record.practiceLaps),
      (raw) => ({ ...record, practiceLaps: Math.round(asNumber(raw, record.practiceLaps)) }),
      { min: '1', max: '20', step: '1' },
    ),
    field(
      race,
      'practice copies',
      () => String(record.practiceCopies),
      (raw) => ({ ...record, practiceCopies: Math.round(asNumber(raw, record.practiceCopies)) }),
      { min: '0', max: '32', step: '1' },
    ),
  );
  formEl.append(race);

  formEl.append(heading('presentation'));
  const art = document.createElement('div');
  selectField(
    art,
    'music track',
    () => record.musicTrack,
    (raw) => ({ ...record, musicTrack: raw.trim() }),
    MUSIC_TRACK_IDS,
  );
  selectField(
    art,
    'theme',
    () => record.theme,
    (raw) => ({ ...record, theme: raw.trim() }),
    REALM_RACERS_THEME_IDS,
  );
  formEl.append(art);

  formEl.append(heading('enclosure'));
  const box = document.createElement('div');
  field(
    box,
    'perimeter half x',
    () => String(record.perimeter.halfX),
    (raw) => ({
      ...record,
      perimeter: { ...record.perimeter, halfX: asNumber(raw, record.perimeter.halfX) },
    }),
  );
  field(
    box,
    'perimeter half z',
    () => String(record.perimeter.halfZ),
    (raw) => ({
      ...record,
      perimeter: { ...record.perimeter, halfZ: asNumber(raw, record.perimeter.halfZ) },
    }),
  );
  field(
    box,
    'region half x',
    () => String(record.regionHalfX),
    (raw) => ({ ...record, regionHalfX: asNumber(raw, record.regionHalfX) }),
    { max: String(REALM_RACERS_MAX_REGION_HALF_X) },
  );
  field(
    box,
    'region half z',
    () => String(record.regionHalfZ),
    (raw) => ({ ...record, regionHalfZ: asNumber(raw, record.regionHalfZ) }),
    { max: String(REALM_RACERS_MAX_REGION_HALF_Z) },
  );
  formEl.append(box);
}

function syncForm(): void {
  for (const { input, read, sync } of formFields) {
    if (input === document.activeElement) continue;
    if (sync) sync();
    else input.value = read();
  }
  for (const [role, box] of roleBoxes) box.checked = record.roles.includes(role);
  // A circuit nobody practises on has no practice numbers worth showing. The lap
  // count STAYS on the record while hidden, because the validator holds it to 1
  // to 20 and a zero there is a draft that cannot be saved.
  const practises = record.roles.includes('practice');
  for (const wrap of practiceRows) wrap.hidden = !practises;
}
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
  syncForm();
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
    syncForm();
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
  libraryEl.hidden = !panel.showLibrary;
  inspectorEl.hidden = !panel.showInspector;
  outlinerEl.hidden = !panel.showOutliner;
  formEl.hidden = !panel.showForm;
  modeReadoutEl.hidden = !panel.showModeReadout;
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
  if (next !== 'props') paletteChoice = null;
  armPalette(paletteChoice);
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
  );
  shell.setDocument(record.id, dirty);
  // The undo stack moves on every commit, which is far more often than the
  // chrome is refreshed, so its button state is read here rather than there.
  shell.setEnabled('undo', history.canUndo);
  shell.setEnabled('redo', history.canRedo);
  if (layout.metricsOpen) paintReadout();
  paintOutliner();
  paintInspector();
  paintModeReadout();
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
  const hit = hitTestControlPoint(record.controlPoints, raw.x, raw.z, 8 / view.scale);
  if (hit >= 0) {
    selection = { kind: 'point', index: hit };
    dragging = selection;
    pushUndo();
    requestRedraw();
    return;
  }
  const segment = nearestSegment(record.controlPoints, raw.x, raw.z);
  if (segment.distance <= 10 / view.scale) {
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
  if (tool() === 'props' && paletteChoice !== null && !dressingDrag) requestRedraw();
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
  view.scale = clampScale(view.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12));
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
  syncForm();
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
      armPalette(null);
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

const shell = new EditorShell({
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
});

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
  // second nested modal.
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
      const placed = realmRacersPlacements(record).props[placementIndexOf(dressing.index)];
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

buildForm();
buildPalette();
shell.sideBodyEl.append(libraryEl, inspectorEl, outlinerEl, modeReadoutEl, formEl);
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
