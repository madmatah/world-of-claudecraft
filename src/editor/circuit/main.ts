// The circuit editor page: a canvas, pointer routing, and the readout panel.
//
// Every decision lives in a core (`stroke_fit_core`, `handles_core`,
// `export_core`) or in the sim (`realmRacersTrack` for the geometry,
// `realmRacersCircuitMetrics` for the readout). Nothing here computes anything
// about a circuit: this file turns pointers into calls and returned numbers into
// pixels, which is the only reason a page is allowed to be this long.
//
// Dev tool: English-only, absent from every production build. See CLAUDE.md.

import {
  type RallyWaterKind,
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersBasin,
  type RealmRacersCircuit,
} from '../../sim/content/realm_racers_circuits';
import {
  type RealmRacersCircuitMetrics,
  type RealmRacersCircuitProblem,
  type RealmRacersCircuitProblemCode,
  realmRacersCircuitMetrics,
} from '../../sim/realm_racers_circuit_metrics';
import {
  type RallyPoint,
  REALM_RACERS_APRON_MAX,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_MIN_HALF_WIDTH,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../../sim/realm_racers_layout';
import {
  type RallyTrackModel,
  rallyGardenEdgeOffsetAt,
  rallyShoreOffsetAt,
  rallyWaterKindAt,
  realmRacersGates,
  realmRacersStarts,
  realmRacersTrack,
  realmRacersWaterOutlines,
} from '../../sim/realm_racers_spline';
import { suggestEnvelope } from './envelope_core';
import { circuitToTypeScript, roundCircuit, validateCircuitPayload } from './export_core';
import {
  type CircuitBand,
  deleteControlPoint,
  fromApronBands,
  fromWidthBands,
  hitTestControlPoint,
  insertControlPoint,
  MIN_CONTROL_POINTS,
  moveControlPoint,
  nearestSegment,
  paintSpan,
  toApronBands,
  toWidthBands,
} from './handles_core';
import { fitStrokeToControlPoints } from './stroke_fit_core';
import {
  applyWaterBands,
  DEFAULT_WATER_BANDS,
  paintWaterSpan,
  type WaterBand,
  waterSpanYards,
} from './water_paint_core';
import { suggestWidthBands } from './width_fix_core';

type Mode = 'draw' | 'handles' | 'width' | 'apron' | 'water';
type Selection = { kind: 'point'; index: number } | null;

/** How many problems the panel lists before it says how many it is holding
 *  back. Every one of them still draws its marker on the canvas. */
const MAX_LISTED_PROBLEMS = 10;

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
 * What the one number in the header MEANS in each mode, and what it is allowed
 * to be. It is not a brush SIZE, which is what "brush" says in every other
 * tool: it is the value the stroke paints, in yards, and the two painting modes
 * paint two different quantities with two different legal ranges.
 */
const BRUSH_FIELDS: Record<Mode, { label: string; min: number; max: number } | null> = {
  draw: null,
  handles: null,
  width: { label: 'road half-width (yd)', min: REALM_RACERS_MIN_HALF_WIDTH, max: 40 },
  apron: { label: 'apron cap (yd)', min: 0.5, max: REALM_RACERS_APRON_MAX },
  // The water brush paints a KIND, so it takes the picker beside this field
  // rather than a number with a legend.
  water: null,
};

/** What each shore kind is drawn in on the canvas: blue where the line carries
 *  a pond, green where it is open lawn. */
const WATER_COLOURS: Record<RallyWaterKind, string> = {
  water: '#4a7fae',
  dry: '#63a86f',
};

const MODE_HINTS: Record<Mode, string> = {
  draw: 'drag anywhere to draw the centerline in one gesture; the fitted curve replaces the stroke on release',
  handles: 'drag a handle to move it, click the curve to insert one, del to delete',
  width: 'drag along the circuit to set the road half-width there; the road is twice this wide',
  apron:
    'drag along the circuit to CAP the apron, the drivable garden between the road edge and the water; the cap can only narrow what the corner already allows, so painting it wide removes it',
  water:
    'drag along the circuit to say whether the shore line carries a pond there or open lawn; nothing here stops a racer either way, and painting the last pond away leaves a circuit with no water at all',
};

const PROBLEM_LABELS: Record<RealmRacersCircuitProblemCode, string> = {
  self_crossing: 'the loop crosses itself',
  reversed_winding: 'the loop runs clockwise',
  corner_folds_road: 'a corner is tighter than its own road',
  corner_near_road_width: 'a corner is close to its own road width',
  stretches_too_close: 'two stretches run close enough to break the projection',
  shore_overlap: 'the two basin shores intersect',
  road_outside_perimeter: 'the road runs outside the perimeter wall',
  perimeter_outside_region: 'the perimeter wall is outside the collision region',
  region_outside_band: 'the region is wider than the instance band',
  region_deeper_than_lane_budget: 'the region is deeper than the gap between two lanes',
  shore_requires_basin: 'a stretch of pond on a circuit with no water authored',
  water_bands_malformed: 'the water table is not sorted from the start line',
};

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
    apronBands: undefined,
    waterBands: undefined,
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
let mode: Mode = 'draw';
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
/** The water table as it stood when the stroke began, and the kind under
 *  every centerline sample then. Separate from the two numeric brushes because
 *  a kind is not a value on a scale: nothing about it ramps or thins. */
let paintWaterOrigin: WaterBand[] | null = null;
let paintKindsBefore: RallyWaterKind[] | null = null;
let paintFractions: number[] = [];
let panning: { x: number; z: number; clientX: number; clientY: number } | null = null;
const undoStack: { record: RealmRacersCircuit; drawn: boolean }[] = [];
const view = { x: 0, z: 0, scale: 2.4 };
let redrawQueued = false;

// ---- dom ----

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const readoutEl = document.getElementById('readout') as HTMLDivElement;
const formEl = document.getElementById('form') as HTMLDivElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;
const hintEl = document.getElementById('hint') as HTMLSpanElement;
const brushInput = document.getElementById('brush') as HTMLInputElement;
const brushLabel = document.getElementById('brushLabel') as HTMLLabelElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const loadDialog = document.getElementById('loadDialog') as HTMLDialogElement;
const loadListEl = document.getElementById('loadList') as HTMLDivElement;
const fitBtn = document.getElementById('fitBtn') as HTMLButtonElement;
const fitBoxBtn = document.getElementById('fitBoxBtn') as HTMLButtonElement;
const fixCornersBtn = document.getElementById('fixCornersBtn') as HTMLButtonElement;
const copyBtn = document.getElementById('copyBtn') as HTMLButtonElement;
const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
const previewBtn = document.getElementById('previewBtn') as HTMLButtonElement;
const previewEl = document.getElementById('preview') as HTMLDivElement;
const previewCanvas = document.getElementById('preview3d') as HTMLCanvasElement;
const flyBtn = document.getElementById('flyBtn') as HTMLButtonElement;
const orbitBtn = document.getElementById('orbitBtn') as HTMLButtonElement;
const flySpeedEl = document.getElementById('flySpeed') as HTMLSelectElement;
const flyAtEl = document.getElementById('flyAt') as HTMLInputElement;
const flyLabelEl = document.getElementById('flyLabel') as HTMLSpanElement;
const modeButtons: Record<Mode, HTMLButtonElement> = {
  draw: document.getElementById('modeDraw') as HTMLButtonElement,
  handles: document.getElementById('modeHandles') as HTMLButtonElement,
  width: document.getElementById('modeWidth') as HTMLButtonElement,
  apron: document.getElementById('modeApron') as HTMLButtonElement,
  water: document.getElementById('modeWater') as HTMLButtonElement,
};
const waterLabel = document.getElementById('waterLabel') as HTMLLabelElement;
const waterKindEl = document.getElementById('waterKind') as HTMLSelectElement;

/**
 * The last basin the record carried, so painting the final shore span away and
 * then painting one back restores THAT lake rather than a default one.
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

function setStatus(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = cls;
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

/** Every edit lands here: it rounds to what the export carries, re-derives the
 *  geometry and the readout, and schedules a repaint. */
function commit(next: RealmRacersCircuit, remember = true): void {
  if (remember) {
    undoStack.push({ record, drawn });
    if (undoStack.length > 100) undoStack.shift();
  }
  record = roundCircuit(next);
  if (record.basin) rememberedBasin = record.basin;
  track = realmRacersTrack(record);
  metrics = realmRacersCircuitMetrics(record);
  requestRedraw();
  // The preview debounces this itself: a drag lands one build on release, never
  // one per pointermove.
  if (drawn) preview?.show(record);
}

function undo(): void {
  const previous = undoStack.pop();
  if (!previous) return;
  selection = null;
  drawn = previous.drawn;
  commit(previous.record, false);
  syncForm();
  refreshChrome();
}

// ---- view maths (screen only: nothing here is about the circuit) ----

const local = (point: { x: number; z: number }): RallyPoint => ({
  x: point.x - REALM_RACERS_ORIGIN.x,
  z: point.z - REALM_RACERS_ORIGIN.z,
});

const screenX = (x: number): number => (x - view.x) * view.scale + canvas.clientWidth / 2;
const screenY = (z: number): number => (z - view.z) * view.scale + canvas.clientHeight / 2;

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

function fitView(): void {
  // A blank canvas frames the room a circuit HAS; the placeholder record's own
  // extents would be framing a shape nobody drew.
  const half = drawn
    ? Math.max(metrics.roadHalfX, metrics.roadHalfZ, 20) * 1.15
    : Math.max(REALM_RACERS_MAX_REGION_HALF_X, REALM_RACERS_MAX_REGION_HALF_Z) * 1.12;
  view.x = 0;
  view.z = 0;
  view.scale = Math.min(canvas.clientWidth, canvas.clientHeight) / (2 * half);
  requestRedraw();
}

// ---- drawing ----

function requestRedraw(): void {
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    draw();
    paintPanel();
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

/** The road, its two off-track bands and the water, offset from the centerline
 *  exactly the way the sim and the renderer offset them. */
function drawSurfaces(): void {
  const samples = track.samples;
  const offsetRing = (offset: (index: number) => number, side: 1 | -1): RallyPoint[] =>
    samples.map((sample, i) => {
      const distance = offset(i) * side;
      const p = local(sample);
      return { x: p.x - sample.tz * distance, z: p.z + sample.tx * distance };
    });

  // The water: one polygon per WATER span, straight off the sim, so a strip the
  // operator has just painted dry stops being drawn as lake here too.
  ctx.fillStyle = '#1d3448';
  for (const outline of realmRacersWaterOutlines(record)) {
    tracePolygon(outline.map((point) => local(point)));
    ctx.fill();
  }

  // The shore line itself, coloured by whether it carries water: the line never
  // moves, and this is the only thing about it the operator authors.
  ctx.save();
  ctx.lineWidth = 2;
  let runStart = 0;
  const kindAt = (index: number): RallyWaterKind =>
    rallyWaterKindAt(record, samples[index % samples.length].s);
  const containment = offsetRing((i) => rallyShoreOffsetAt(record, samples[i].s), 1);
  for (let i = 1; i <= samples.length; i++) {
    if (i < samples.length && kindAt(i) === kindAt(runStart)) continue;
    ctx.strokeStyle = WATER_COLOURS[kindAt(runStart)];
    ctx.beginPath();
    for (let k = runStart; k <= i; k++) {
      const point = containment[k % containment.length];
      const x = screenX(point.x);
      const y = screenY(point.z);
      if (k === runStart) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    runStart = i;
  }
  ctx.restore();

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

function drawGrid(): void {
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
 * On a blank canvas the panel is hidden, so the two ceilings a circuit lives
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

function draw(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#14161c';
  ctx.fillRect(0, 0, width, height);

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
  drawGrid();
  drawStroke();
  drawHandles();
  drawProblemMarkers();
}

// ---- the panel ----

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
  label.textContent = problem.axis
    ? `${PROBLEM_LABELS[problem.code]} (${problem.axis})`
    : PROBLEM_LABELS[problem.code];
  const detail = document.createElement('div');
  detail.className = 'd';
  const where = problem.s >= 0 ? ` at ${problem.s.toFixed(0)} yd` : '';
  detail.textContent = `${problem.value.toFixed(2)} against ${problem.limit.toFixed(2)}${where}`;
  div.append(label, detail);
  return div;
}

function paintPanel(): void {
  readoutEl.replaceChildren();
  if (!drawn) return;
  const shape = document.createElement('table');
  row(shape, 'lap', `${metrics.lapLength.toFixed(1)} yd`);
  row(shape, 'samples', String(metrics.sampleCount));
  row(
    shape,
    'total turning',
    `${metrics.turningDegrees.toFixed(1)} deg`,
    Math.abs(Math.abs(metrics.turningDegrees) - 360) > 5 ? 'bad' : 'good',
  );
  row(
    shape,
    'winding',
    metrics.winding > 0 ? 'counter-clockwise' : 'clockwise',
    metrics.winding > 0 ? 'good' : 'bad',
  );
  row(shape, 'control points', String(record.controlPoints.length));
  readoutEl.append(heading('shape'), shape);

  const corners = document.createElement('table');
  row(corners, 'tightest corner', `${metrics.tightestRadius.toFixed(1)} yd`);
  row(
    corners,
    'radius / road',
    metrics.minRadiusOverWidth.toFixed(2),
    metrics.minRadiusOverWidth < 1 ? 'bad' : metrics.minRadiusOverWidth < 1.5 ? 'warn' : 'good',
  );
  row(corners, 'at', `${metrics.minRadiusOverWidthAtS.toFixed(0)} yd`);
  readoutEl.append(heading('corners'), corners);

  const gaps = document.createElement('table');
  const nearest = metrics.nearestApproach;
  row(
    gaps,
    'nearest approach',
    Number.isFinite(nearest.distance) ? `${nearest.distance.toFixed(1)} yd` : 'none',
    Number.isFinite(nearest.distance) && nearest.distance < 48 ? 'bad' : 'good',
  );
  row(gaps, 'tangent dot', nearest.tangentDot.toFixed(2));
  row(gaps, 'between', `${nearest.s.toFixed(0)} and ${nearest.otherS.toFixed(0)} yd`);
  row(gaps, 'shooting corridor', `${metrics.shootingCorridorYards.toFixed(0)} yd`);
  // Two DRY lines flanking the same strip: an authored open corridor, which is
  // information rather than a fault (two PONDS that close would be one lake
  // drawn twice, and that is the error below).
  row(gaps, 'shared dry line', `${metrics.sharedDryYards.toFixed(0)} yd`);
  row(
    gaps,
    'shore overlap',
    `${metrics.shoreOverlapYards.toFixed(0)} yd`,
    metrics.shoreOverlapYards > 0 ? 'bad' : 'good',
  );
  readoutEl.append(heading('stretches'), gaps);

  // What the two brushes actually left on the circuit, read back off the
  // derived samples rather than off the band tables: the apron is a running
  // minimum of a derived value, so the table is not what the road ends up with.
  const surface = document.createElement('table');
  const halfWidths = track.samples.map((sample) => sample.halfWidth);
  const aprons = track.samples.map((sample) => sample.apron);
  row(
    surface,
    'road half-width',
    `${Math.min(...halfWidths).toFixed(1)} to ${Math.max(...halfWidths).toFixed(1)} yd`,
  );
  row(
    surface,
    'apron',
    `${Math.min(...aprons).toFixed(1)} to ${Math.max(...aprons).toFixed(1)} yd`,
  );
  row(surface, 'width bands', String(record.widthBands.length));
  row(surface, 'apron bands', record.apronBands ? String(record.apronBands.length) : 'none');
  // What the shore line carries, in yards of lap rather than in rows: the table
  // is breakpoints and the operator paints stretches.
  const spans = waterSpanYards(record.waterBands ?? DEFAULT_WATER_BANDS, track.length);
  for (const [kind, label] of [
    ['water', 'pond'],
    ['dry', 'dry shore'],
  ] as const) {
    if (spans[kind] <= 0) continue;
    row(surface, label, `${spans[kind].toFixed(0)} yd`);
  }
  row(surface, 'water authored', record.basin ? 'yes' : 'no', record.basin ? '' : 'warn');
  row(surface, 'recovery anchors', String(realmRacersGates(record).length));
  readoutEl.append(heading('surface'), surface);

  const envelope = document.createElement('table');
  row(envelope, 'road half-extent x', `${metrics.roadHalfX.toFixed(0)} yd`);
  row(envelope, 'road half-extent z', `${metrics.roadHalfZ.toFixed(0)} yd`);
  // The two ceilings, so a circuit that cannot fit the band says so BEFORE the
  // operator has drawn a lap around it.
  row(
    envelope,
    'widest region',
    `${REALM_RACERS_MAX_REGION_HALF_X} yd`,
    record.regionHalfX > REALM_RACERS_MAX_REGION_HALF_X ? 'bad' : '',
  );
  row(
    envelope,
    'deepest region',
    `${REALM_RACERS_MAX_REGION_HALF_Z} yd`,
    record.regionHalfZ > REALM_RACERS_MAX_REGION_HALF_Z ? 'bad' : '',
  );
  readoutEl.append(heading('envelope'), envelope);

  readoutEl.append(heading('problems'));
  if (metrics.problems.length === 0) {
    const clean = document.createElement('div');
    clean.className = 'clean';
    clean.textContent = 'none: this is drivable geometry';
    readoutEl.append(clean);
  } else {
    // Capped, and the cap SAYS so: a list that silently stopped at ten would
    // read as "ten problems" when there are thirty.
    for (const problem of metrics.problems.slice(0, MAX_LISTED_PROBLEMS)) {
      readoutEl.append(problemLine(problem));
    }
    if (metrics.problems.length > MAX_LISTED_PROBLEMS) {
      const more = document.createElement('div');
      more.className = 'd';
      more.textContent = `and ${metrics.problems.length - MAX_LISTED_PROBLEMS} more`;
      readoutEl.append(more);
    }
  }
}

// ---- the record form ----
//
// Everything a circuit holds that is NOT drawn: the id, the enclosure, and the
// race. Built once and only synced, because rebuilding it on every drag would
// take the focus out of an input the operator is still typing in.

interface FormField {
  input: HTMLInputElement;
  read: () => string;
}

const formFields: FormField[] = [];

function field(
  parent: HTMLElement,
  label: string,
  read: () => string,
  write: (raw: string) => RealmRacersCircuit | null,
  attrs: Partial<HTMLInputElement> = {},
): void {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const name = document.createElement('label');
  name.textContent = label;
  const input = document.createElement('input');
  input.type = attrs.type ?? 'number';
  Object.assign(input, attrs);
  input.value = read();
  input.onchange = () => {
    const next = write(input.value);
    // Checked through the SAVE endpoint's own validator rather than against a
    // second copy of every field's range here: a value the form accepts that
    // the endpoint would refuse is a draft the operator cannot save, found out
    // one step too late. A value that is merely unwise (a region deeper than
    // the lane budget) still lands, because the readout is what says so.
    const valid = next && validateCircuitPayload(next);
    if (valid) {
      commit(valid);
    } else {
      // Written back HERE rather than through syncForm, which deliberately
      // skips the focused input: a refused edit is the one case where the field
      // still holds the caret and must be overwritten anyway, or the panel shows
      // a number the record does not carry.
      setStatus(`${label}: ${input.value} is not a value a circuit can carry`, 'err');
      input.value = read();
    }
    syncForm();
  };
  name.append(input);
  wrap.append(name);
  parent.append(wrap);
  formFields.push({ input, read });
}

const asNumber = (raw: string, fallback: number): number => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

function buildForm(): void {
  formEl.replaceChildren();
  formFields.length = 0;

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
    'practice laps',
    () => String(record.practiceLaps),
    (raw) => ({ ...record, practiceLaps: Math.round(asNumber(raw, record.practiceLaps)) }),
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
  field(
    race,
    'practice copies',
    () => String(record.practiceCopies),
    (raw) => ({ ...record, practiceCopies: Math.round(asNumber(raw, record.practiceCopies)) }),
    { min: '0', max: '32', step: '1' },
  );
  field(
    race,
    'music track',
    () => record.musicTrack,
    (raw) => ({ ...record, musicTrack: raw.trim() }),
    { type: 'text' },
  );
  formEl.append(race);
}

function syncForm(): void {
  for (const { input, read } of formFields) {
    if (input === document.activeElement) continue;
    input.value = read();
  }
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

// ---- pointer routing ----

/** Everything whose availability depends on there being a circuit at all. */
function refreshChrome(): void {
  // A blank canvas has exactly one thing to do, so it says so rather than
  // leaving whatever mode the last circuit was being edited in selected under a
  // disabled button.
  if (!drawn && mode !== 'draw') setMode('draw');
  emptyEl.hidden = drawn;
  formEl.hidden = !drawn;
  for (const [key, button] of Object.entries(modeButtons)) {
    button.disabled = !drawn && key !== 'draw';
  }
  for (const button of [fitBtn, fitBoxBtn, fixCornersBtn, copyBtn, saveBtn, previewBtn]) {
    button.disabled = !drawn;
  }
}

function setMode(next: Mode): void {
  mode = next;
  selection = null;
  for (const [key, button] of Object.entries(modeButtons)) {
    button.classList.toggle('on', key === next);
  }
  hintEl.textContent = MODE_HINTS[next];
  waterLabel.hidden = next !== 'water';
  const brush = BRUSH_FIELDS[next];
  brushLabel.hidden = next === 'water';
  brushLabel.classList.toggle('off', brush === null);
  brushInput.disabled = brush === null;
  brushLabel.firstChild?.replaceWith(`${brush?.label ?? 'brush'} `);
  if (brush) {
    brushInput.min = String(brush.min);
    brushInput.max = String(brush.max);
    brushInput.value = String(Math.min(brush.max, Math.max(brush.min, Number(brushInput.value))));
  }
  requestRedraw();
}

/** The quantity the current painting mode edits, per centerline sample. */
function paintedQuantity(): number[] {
  return track.samples.map((sample) => (mode === 'width' ? sample.halfWidth : sample.apron));
}

/** What the shore line carries at every centerline sample, read back
 *  through the SPLINE rather than off the table: the table is breakpoints and
 *  the road is samples, and only the second one is what a racer meets. */
function paintedKinds(): RallyWaterKind[] {
  return track.samples.map((sample) => rallyWaterKindAt(record, sample.s));
}

/** The kind the picker is set to. */
function brushKind(): RallyWaterKind {
  return waterKindEl.value as RallyWaterKind;
}

/** What the stroke that just ended did, in the operator's own units. */
function reportStroke(): void {
  if (mode === 'water') {
    if (!paintKindsBefore) return;
    const after = paintedKinds();
    let changed = 0;
    for (let i = 0; i < after.length && i < paintKindsBefore.length; i++) {
      if (after[i] !== paintKindsBefore[i]) changed += track.step;
    }
    const spans = waterSpanYards(record.waterBands ?? DEFAULT_WATER_BANDS, track.length);
    const water = spans.water.toFixed(0);
    if (changed > 0) {
      setStatus(
        `${changed.toFixed(0)} yd of shore set to ${brushKind()}; ${water} yd of pond left${
          record.basin ? '' : ', and no water on this circuit at all now'
        }`,
        'ok',
      );
      return;
    }
    setStatus(`nothing changed: that stretch of shore is already ${brushKind()}`, 'err');
    return;
  }
  const brush = BRUSH_FIELDS[mode];
  if (!paintBefore || !brush) return;
  const after = paintedQuantity();
  let changed = 0;
  for (let i = 0; i < after.length && i < paintBefore.length; i++) {
    if (Math.abs(after[i] - paintBefore[i]) > 0.01) changed += track.step;
  }
  const value = Number(brushInput.value);
  if (changed > 0) {
    setStatus(`${brush.label}: ${changed.toFixed(0)} yd of lap set to ${value}`, 'ok');
    return;
  }
  // The case that made this whole readout necessary. Naming the reason is the
  // difference between "the tool is broken" and "you painted what was there".
  setStatus(
    mode === 'width'
      ? `nothing changed: the road is already ${value} yd there`
      : `nothing changed: a ${value} yd cap is not below what those corners already allow`,
    'err',
  );
}

/** The table the current painting mode edits, as it stands on the record. */
function paintedBands(): CircuitBand[] {
  if (mode === 'width') return fromWidthBands(record.widthBands);
  return fromApronBands(
    record.apronBands ?? [
      { s: 0, maxApron: REALM_RACERS_APRON_MAX },
      { s: 1, maxApron: REALM_RACERS_APRON_MAX },
    ],
  );
}

/** Extends the live stroke to this point and re-applies the whole of it. */
function paintAt(point: RallyPoint): void {
  if (mode === 'water') {
    if (!paintWaterOrigin) return;
    paintFractions.push(fractionAt(point));
    const bands = paintWaterSpan(paintWaterOrigin, paintFractions, brushKind());
    commit(applyWaterBands(record, bands, rememberedBasin), false);
    return;
  }
  const brush = BRUSH_FIELDS[mode];
  const value = Number(brushInput.value);
  if (!brush || !paintOrigin || !Number.isFinite(value)) return;
  paintFractions.push(fractionAt(point));
  const bands = paintSpan(paintOrigin, paintFractions, value, {
    min: brush.min,
    max: brush.max,
    ramp: PAINT_RAMP_YARDS / track.length,
  });
  commit(
    mode === 'width'
      ? { ...record, widthBands: toWidthBands(bands) }
      : { ...record, apronBands: toApronBands(bands) },
    false,
  );
}

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  if (ev.button === 1) {
    panning = { x: view.x, z: view.z, clientX: ev.clientX, clientY: ev.clientY };
    return;
  }
  const point = toLocal(ev);
  if (mode === 'draw') {
    drawing = true;
    stroke = [point];
    return;
  }
  if (mode === 'width' || mode === 'apron' || mode === 'water') {
    undoStack.push({ record, drawn });
    painting = true;
    paintBefore = mode === 'water' ? null : paintedQuantity();
    paintKindsBefore = mode === 'water' ? paintedKinds() : null;
    paintOrigin = mode === 'water' ? null : paintedBands();
    paintWaterOrigin =
      mode === 'water'
        ? [...(record.waterBands ?? DEFAULT_WATER_BANDS)].map((band) => ({ ...band }))
        : null;
    paintFractions = [];
    paintAt(point);
    return;
  }
  const hit = hitTestControlPoint(record.controlPoints, point.x, point.z, 8 / view.scale);
  if (hit >= 0) {
    selection = { kind: 'point', index: hit };
    dragging = selection;
    undoStack.push({ record, drawn });
    requestRedraw();
    return;
  }
  const segment = nearestSegment(record.controlPoints, point.x, point.z);
  if (segment.distance <= 10 / view.scale) {
    commit({
      ...record,
      controlPoints: insertControlPoint(record.controlPoints, segment.index, segment.point),
    });
    selection = { kind: 'point', index: segment.index + 1 };
    dragging = selection;
    requestRedraw();
    return;
  }
  selection = null;
  requestRedraw();
});

canvas.addEventListener('pointermove', (ev) => {
  if (panning) {
    view.x = panning.x - (ev.clientX - panning.clientX) / view.scale;
    view.z = panning.z - (ev.clientY - panning.clientY) / view.scale;
    requestRedraw();
    return;
  }
  const point = toLocal(ev);
  if (drawing) {
    stroke.push(point);
    requestRedraw();
    return;
  }
  if (painting) {
    paintAt(point);
    return;
  }
  if (!dragging) return;
  commit(
    { ...record, controlPoints: moveControlPoint(record.controlPoints, dragging.index, point) },
    false,
  );
});

function endGesture(): void {
  if (drawing) {
    drawing = false;
    const fitted = fitStrokeToControlPoints(stroke);
    if (fitted.length >= MIN_CONTROL_POINTS) {
      commit({ ...record, controlPoints: fitted });
      // The stroke that turns a blank canvas into a circuit.
      drawn = true;
      refreshChrome();
      setMode('handles');
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
  panning = null;
  painting = false;
  paintBefore = null;
  paintKindsBefore = null;
  paintOrigin = null;
  paintWaterOrigin = null;
  paintFractions = [];
  dragging = null;
}

canvas.addEventListener('pointerup', endGesture);
canvas.addEventListener('pointercancel', endGesture);

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const before = toLocal(ev);
  view.scale = Math.min(20, Math.max(0.4, view.scale * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
  const after = toLocal(ev);
  view.x += before.x - after.x;
  view.z += before.z - after.z;
  requestRedraw();
});

window.addEventListener('keydown', (ev) => {
  if (ev.target instanceof HTMLInputElement || ev.target instanceof HTMLSelectElement) return;
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'z') {
    ev.preventDefault();
    undo();
    return;
  }
  if (ev.key === 'Delete' || ev.key === 'Backspace') {
    if (!selection) return;
    ev.preventDefault();
    commit({ ...record, controlPoints: deleteControlPoint(record.controlPoints, selection.index) });
    selection = null;
  }
});

window.addEventListener('resize', requestRedraw);

// ---- header wiring ----

for (const [key, button] of Object.entries(modeButtons)) {
  button.onclick = () => setMode(key as Mode);
}
(document.getElementById('undoBtn') as HTMLButtonElement).onclick = undo;
(document.getElementById('fitBtn') as HTMLButtonElement).onclick = fitView;
(document.getElementById('fitBoxBtn') as HTMLButtonElement).onclick = fitEnclosure;
(document.getElementById('fixCornersBtn') as HTMLButtonElement).onclick = fixCorners;

(document.getElementById('copyBtn') as HTMLButtonElement).onclick = async () => {
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
};

(document.getElementById('saveBtn') as HTMLButtonElement).onclick = async () => {
  try {
    const response = await fetch('/__circuit_editor/save', {
      method: 'POST',
      body: JSON.stringify(record),
    });
    if (!response.ok) throw new Error(await response.text());
    setStatus(`saved tmp/circuit-drafts/${record.id}.ts`, 'ok');
  } catch (err) {
    setStatus(`save failed: ${err}`, 'err');
  }
};

/**
 * Starting from nothing. A `<select>` used to do both jobs and did the second
 * one badly: it only fires on a CHANGE, so an operator who had drawn over the
 * starter oval and wanted a fresh one had no way to ask for it.
 */
function newBlank(): void {
  stroke = [];
  selection = null;
  // Committed BEFORE the flag moves: `commit` snapshots the state it is
  // leaving, and clearing the flag first made that snapshot say the canvas was
  // already blank, so undoing a discard restored nothing.
  commit(blankCircuit());
  drawn = false;
  setMode('draw');
  refreshChrome();
  fitView();
  setStatus('blank canvas: draw a closed loop', '');
}

/** Starting from something: the starter oval, or any circuit the game ships. */
function loadCircuit(circuit: RealmRacersCircuit, label: string): void {
  stroke = [];
  selection = null;
  // A shipped record is loaded under a DRAFT id, so editing it can never hand
  // the memoized derivation of a live circuit a shape the game did not author.
  // Committed before the flag moves, for the same reason as `newBlank`.
  commit(circuit);
  drawn = true;
  setMode('handles');
  refreshChrome();
  syncForm();
  fitView();
  setStatus(`loaded ${label}`, 'ok');
}

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

// ---- the 3D preview ----
//
// The panel is a toggle rather than a second window: the readout is what says
// whether a circuit is legal, the 3D is what says whether it is any good, and
// an operator switches between them constantly.

function syncFlyChrome(): void {
  const flying = preview?.cameraMode === 'fly';
  flyBtn.classList.toggle('on', flying && (preview?.playing ?? false));
  orbitBtn.classList.toggle('on', !flying);
}

async function togglePreview(): Promise<void> {
  if (preview) {
    const showing = Boolean(previewEl.hidden);
    previewEl.hidden = !showing;
    previewBtn.classList.toggle('on', showing);
    // Told either way: a hidden preview STOPS rendering rather than drawing a
    // whole circuit behind the panel, under the 2D drag path.
    preview.setVisible(showing);
    if (showing) {
      preview.show(record);
      preview.resize();
    }
    return;
  }
  previewBtn.disabled = true;
  setStatus('preview: starting', '');
  try {
    const { CircuitPreview } = await import('./preview3d');
    previewEl.hidden = false;
    previewBtn.classList.add('on');
    const created = new CircuitPreview({
      canvas: previewCanvas,
      onStatus: (text) => setStatus(text, ''),
    });
    created.onFlyProgress = (fraction) => {
      flyAtEl.value = String(Math.round(fraction * 1000));
      flyLabelEl.textContent = `${Math.round(fraction * 100)}%`;
    };
    preview = created;
    created.frame(metrics.roadHalfX, metrics.roadHalfZ);
    created.show(record);
    await created.start();
    syncFlyChrome();
  } catch (err) {
    // A dev page with no WebGL still has a working 2D tool, and saying so beats
    // a blank half-screen.
    previewEl.hidden = true;
    previewBtn.classList.remove('on');
    setStatus(`preview unavailable: ${err}`, 'err');
  } finally {
    previewBtn.disabled = !drawn;
  }
}

previewBtn.onclick = () => void togglePreview();
flyBtn.onclick = () => {
  if (!preview) return;
  preview.setFlyPlaying(!(preview.cameraMode === 'fly' && preview.playing));
  syncFlyChrome();
};
orbitBtn.onclick = () => {
  if (!preview) return;
  preview.setFlyPlaying(false);
  preview.setMode('orbit');
  preview.frame(metrics.roadHalfX, metrics.roadHalfZ);
  syncFlyChrome();
};
flySpeedEl.onchange = () => {
  preview?.setFlySpeed(flySpeedEl.value === 'scenic' ? 'scenic' : 'race');
};
flyAtEl.oninput = () => {
  const fraction = Number(flyAtEl.value) / 1000;
  flyLabelEl.textContent = `${Math.round(fraction * 100)}%`;
  preview?.setFlyFraction(fraction);
  syncFlyChrome();
};

window.addEventListener('resize', () => preview?.resize());
// The page's one teardown. A dev tool is left open for hours and reloaded often;
// giving the GL context and the built circuit back on the way out is what keeps
// a reload from stacking contexts until the browser starts dropping the oldest.
window.addEventListener('pagehide', () => {
  preview?.dispose();
  preview = null;
});

(document.getElementById('newBtn') as HTMLButtonElement).onclick = newBlank;
(document.getElementById('loadBtn') as HTMLButtonElement).onclick = () => loadDialog.showModal();
(document.getElementById('loadCancel') as HTMLButtonElement).onclick = () => loadDialog.close();

buildForm();
newBlank();
