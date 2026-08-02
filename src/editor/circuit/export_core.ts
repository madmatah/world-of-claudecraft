// A drawn circuit out of the tool and into the tree: the pasteable TypeScript
// literal, the reader that takes one back, and the validator the dev-server
// save endpoint runs before it writes anything.
//
// The tool deliberately does NOT rewrite `src/sim/content/realm_racers_circuits.ts`
// the way the music editor rewrites its generated module. That file is
// hand-curated and its comments carry the reasoning behind every number (why a
// chicane is 8.5, what bounds the apron); a generator would destroy all of it.
// So the primary export is a literal the operator pastes and then comments, and
// the save endpoint only ever writes a scratch draft.
//
// Rounding is here rather than at the paste: an editor whose live record holds
// more precision than what it exports would render a readout of a circuit
// nobody can paste. `roundCircuit` is applied after every edit, so what the
// panel measures IS what the clipboard carries.
//
// Pure core: DOM-free, deterministic, no clock, no rng.

import {
  RALLY_BARRIER_KINDS,
  type RallyBarrierKind,
  type RealmRacersCircuit,
  type RealmRacersCircuitRole,
} from '../../sim/content/realm_racers_circuits';
import type { RallyPoint } from '../../sim/realm_racers_layout';

/** Yards, to a tenth: finer than an operator can aim and finer than the
 *  spline's own one-yard resample can show. */
const POINT_PLACES = 1;
/** Lap fractions, to four places: a ten thousandth of a 1000 yard lap. */
const FRACTION_PLACES = 4;
/** Band values (road half-width, apron ceiling), yards to two places. */
const BAND_PLACES = 2;

const ID_RE = /^[a-z][a-z0-9_]{2,40}$/;
const MUSIC_TRACK_RE = /^[a-z0-9_]{1,40}$/;
const ROLES: readonly RealmRacersCircuitRole[] = ['practice', 'competition'];

function round(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** The record as the export will carry it, so the live readout and the pasted
 *  literal are measurements of the same circuit. */
export function roundCircuit(circuit: RealmRacersCircuit): RealmRacersCircuit {
  return {
    ...circuit,
    controlPoints: circuit.controlPoints.map((point) => ({
      x: round(point.x, POINT_PLACES),
      z: round(point.z, POINT_PLACES),
    })),
    widthBands: circuit.widthBands.map((band) => ({
      s: round(band.s, FRACTION_PLACES),
      halfWidth: round(band.halfWidth, BAND_PLACES),
    })),
    ...(circuit.barrierBands
      ? {
          barrierBands: circuit.barrierBands.map((band) => ({
            s: round(band.s, FRACTION_PLACES),
            kind: band.kind,
          })),
        }
      : {}),
    ...(circuit.apronBands
      ? {
          apronBands: circuit.apronBands.map((band) => ({
            s: round(band.s, FRACTION_PLACES),
            maxApron: round(band.maxApron, BAND_PLACES),
          })),
        }
      : {}),
    ...(circuit.landmark
      ? {
          landmark: {
            x: round(circuit.landmark.x, POINT_PLACES),
            z: round(circuit.landmark.z, POINT_PLACES),
          },
        }
      : {}),
  };
}

const pointLiteral = (point: RallyPoint): string => `{ x: ${point.x}, z: ${point.z} }`;

/**
 * The record as a TypeScript literal, ready to paste into the curated records
 * module. Stable field order and stable formatting, so two exports of the same
 * circuit are the same text and a diff shows only what actually moved.
 */
export function circuitToTypeScript(circuit: RealmRacersCircuit): string {
  const c = roundCircuit(circuit);
  const constName = c.id.toUpperCase();
  const lines: string[] = [
    `const ${constName}: RealmRacersCircuit = {`,
    `  id: '${c.id}',`,
    '  controlPoints: [',
  ];
  for (const point of c.controlPoints) lines.push(`    ${pointLiteral(point)},`);
  lines.push('  ],', '  widthBands: [');
  for (const band of c.widthBands) {
    lines.push(`    { s: ${band.s}, halfWidth: ${band.halfWidth} },`);
  }
  lines.push('  ],');
  if (c.apronBands) {
    lines.push('  apronBands: [');
    for (const band of c.apronBands) {
      lines.push(`    { s: ${band.s}, maxApron: ${band.maxApron} },`);
    }
    lines.push('  ],');
  }
  if (c.barrierBands) {
    lines.push('  barrierBands: [');
    for (const band of c.barrierBands) {
      lines.push(`    { s: ${band.s}, kind: '${band.kind}' },`);
    }
    lines.push('  ],');
  }
  lines.push(
    `  regionHalfX: ${c.regionHalfX},`,
    `  regionHalfZ: ${c.regionHalfZ},`,
    `  perimeter: { halfX: ${c.perimeter.halfX}, halfZ: ${c.perimeter.halfZ}, halfThickness: ${c.perimeter.halfThickness}, height: ${c.perimeter.height} },`,
  );
  // Emitted only when the circuit HAS water, which is exactly when a shore span
  // exists: a dry circuit that carried a basin literal would be authoring a
  // lake nothing draws.
  if (c.basin) {
    lines.push(
      `  basin: { waterY: ${c.basin.waterY}, bankSlope: ${c.basin.bankSlope}, depthMax: ${c.basin.depthMax}, wadeYards: ${c.basin.wadeYards} },`,
    );
  }
  // Optional, and emitted in the record's own field order so a paste reads like
  // the module it is being pasted into.
  if (c.landmark) lines.push(`  landmark: { x: ${c.landmark.x}, z: ${c.landmark.z} },`);
  lines.push(
    `  startBack: ${c.startBack},`,
    `  startSpacing: ${c.startSpacing},`,
    `  laps: ${c.laps},`,
    `  practiceLaps: ${c.practiceLaps},`,
    `  timeLimitSeconds: ${c.timeLimitSeconds},`,
    `  musicTrack: '${c.musicTrack}',`,
    `  roles: [${c.roles.map((role) => `'${role}'`).join(', ')}],`,
    `  practiceCopies: ${c.practiceCopies},`,
    '};',
    '',
  );
  return lines.join('\n');
}

/**
 * The literal above, back into a record. Only ever fed what this module wrote
 * (the round-trip test, and the operator pasting a draft back in), so it can
 * normalize the one object-literal dialect it emits into JSON rather than
 * parsing TypeScript.
 */
export function circuitFromTypeScript(source: string): RealmRacersCircuit | null {
  // Anchored on the annotated declaration rather than on the first brace, so a
  // whole draft FILE parses too: its preamble carries an `import type { ... }`
  // whose brace would otherwise be read as the start of the record.
  const declaration = /:\s*RealmRacersCircuit\s*=\s*\{/.exec(source);
  const start = declaration ? declaration.index + declaration[0].length - 1 : source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const json = source
    .slice(start, end + 1)
    .replace(/([{,[]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
    .replace(/'([^']*)'/g, '"$1"')
    .replace(/,(\s*[}\]])/g, '$1');
  try {
    return validateCircuitPayload(JSON.parse(json));
  } catch {
    return null;
  }
}

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const inRange = (value: unknown, min: number, max: number): value is number =>
  isNumber(value) && value >= min && value <= max;

const isInteger = (value: unknown, min: number, max: number): value is number =>
  inRange(value, min, max) && Number.isInteger(value);

function readPoints(raw: unknown): RallyPoint[] | null {
  if (!Array.isArray(raw) || raw.length < 3 || raw.length > 256) return null;
  const out: RallyPoint[] = [];
  for (const item of raw) {
    const point = item as { x?: unknown; z?: unknown };
    if (!inRange(point.x, -5000, 5000) || !inRange(point.z, -5000, 5000)) return null;
    out.push({ x: point.x, z: point.z });
  }
  return out;
}

/**
 * A band table read straight off the wire: sorted, spanning the whole lap, and
 * every value inside the range its own field allows. The same shape twice, so
 * one reader takes both and neither can be validated the loose way by accident.
 */
function readBands(raw: unknown, key: string, min: number, max: number): { s: number }[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 512) return null;
  const out: { s: number; [key: string]: number }[] = [];
  let previous = -1;
  for (const item of raw) {
    const band = item as Record<string, unknown>;
    if (!inRange(band.s, 0, 1) || !inRange(band[key], min, max)) return null;
    if (band.s <= previous) return null;
    previous = band.s;
    out.push({ s: band.s, [key]: band[key] as number });
  }
  if (out[0].s !== 0 || out[out.length - 1].s !== 1) return null;
  return out;
}

/**
 * The stepwise barrier table off the wire: sorted, first entry at 0, every
 * entry in [0, 1), and every kind one the spline knows how to stand on the
 * line.
 */
function readBarrierBands(raw: unknown): { s: number; kind: RallyBarrierKind }[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 512) return null;
  const out: { s: number; kind: RallyBarrierKind }[] = [];
  let previous = -1;
  for (const item of raw) {
    const band = item as { s?: unknown; kind?: unknown };
    if (!isNumber(band.s) || band.s < 0 || band.s >= 1) return null;
    if (band.s <= previous) return null;
    if (!RALLY_BARRIER_KINDS.includes(band.kind as RallyBarrierKind)) return null;
    previous = band.s;
    out.push({ s: band.s, kind: band.kind as RallyBarrierKind });
  }
  if (out[0].s !== 0) return null;
  return out;
}

/**
 * Whether a payload is a circuit at all, and the normalized record if it is.
 *
 * Run by the dev-server save endpoint BEFORE it writes anything, on the
 * music-editor precedent: the browser is not trusted to have kept its own rules,
 * and a draft written from a malformed payload would be a file the tree cannot
 * even parse.
 */
export function validateCircuitPayload(raw: unknown): RealmRacersCircuit | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== 'string' || !ID_RE.test(c.id)) return null;
  if (typeof c.musicTrack !== 'string' || !MUSIC_TRACK_RE.test(c.musicTrack)) return null;

  const controlPoints = readPoints(c.controlPoints);
  if (!controlPoints) return null;
  const widthBands = readBands(c.widthBands, 'halfWidth', 1, 100) as
    | { s: number; halfWidth: number }[]
    | null;
  if (!widthBands) return null;
  const apronBands =
    c.apronBands === undefined
      ? undefined
      : ((readBands(c.apronBands, 'maxApron', 0.1, 100) ?? null) as
          | { s: number; maxApron: number }[]
          | null);
  if (c.apronBands !== undefined && !apronBands) return null;

  /**
   * The barrier table: STEPWISE, so unlike the two band tables above it is
   * sorted over [0, 1) with its first entry at 0 and no closing entry at 1 (one
   * there would open a span of zero length). Read by its own reader for that
   * reason rather than by loosening `readBands` until it takes both.
   */
  const barrierBands = c.barrierBands === undefined ? undefined : readBarrierBands(c.barrierBands);
  if (c.barrierBands !== undefined && !barrierBands) return null;

  const perimeter = c.perimeter as Record<string, unknown> | undefined;
  if (!perimeter) return null;
  // Water is optional now, and required exactly where a shore span exists: the
  // record's rule is an IFF, and both halves are refused here. Without a shore
  // the payload is a lake circuit that forgot its lake (the absent table means a
  // whole lap of shore); with one it authors a basin nothing is made of, which
  // re-exports as a literal the next reader takes for a lake.
  const basin = c.basin as Record<string, unknown> | undefined;
  const anyShore = !barrierBands || barrierBands.some((band) => band.kind === 'shore');
  if (anyShore !== Boolean(basin)) return null;
  if (basin) {
    if (
      !inRange(basin.waterY, -20, 20) ||
      !inRange(basin.bankSlope, 0.01, 10) ||
      !inRange(basin.depthMax, 0.1, 50) ||
      !inRange(basin.wadeYards, 0, 50)
    ) {
      return null;
    }
  }

  /**
   * The infield landmark, optional and carried THROUGH rather than dropped.
   *
   * It was dropped, and that was a live divergence rather than a missing
   * niceness: the editor's 3D preview builds the record it holds (fountain and
   * all) while a draft raced in game arrives through this validator, so the two
   * views of one circuit disagreed about whether there was an island out in the
   * lake. Bounded by the same window the control points use, since it is a
   * circuit-local point exactly like them.
   */
  const rawLandmark = c.landmark as { x?: unknown; z?: unknown } | undefined | null;
  let landmark: RallyPoint | undefined;
  if (rawLandmark !== undefined && rawLandmark !== null) {
    if (!inRange(rawLandmark.x, -5000, 5000) || !inRange(rawLandmark.z, -5000, 5000)) return null;
    landmark = { x: rawLandmark.x, z: rawLandmark.z };
  }
  if (
    !inRange(c.regionHalfX, 10, 2000) ||
    !inRange(c.regionHalfZ, 10, 2000) ||
    !inRange(perimeter.halfX, 5, 2000) ||
    !inRange(perimeter.halfZ, 5, 2000) ||
    !inRange(perimeter.halfThickness, 0.05, 10) ||
    !inRange(perimeter.height, 0.5, 20) ||
    !inRange(c.startBack, 0, 200) ||
    !inRange(c.startSpacing, 1, 50) ||
    !isInteger(c.laps, 1, 20) ||
    !isInteger(c.practiceLaps, 1, 20) ||
    !inRange(c.timeLimitSeconds, 10, 3600) ||
    !isInteger(c.practiceCopies, 0, 32)
  ) {
    return null;
  }

  if (!Array.isArray(c.roles) || c.roles.length === 0 || c.roles.length > ROLES.length) return null;
  const roles: RealmRacersCircuitRole[] = [];
  for (const role of c.roles) {
    if (!ROLES.includes(role as RealmRacersCircuitRole)) return null;
    if (roles.includes(role as RealmRacersCircuitRole)) return null;
    roles.push(role as RealmRacersCircuitRole);
  }

  return {
    id: c.id,
    controlPoints,
    widthBands,
    ...(apronBands ? { apronBands } : {}),
    ...(barrierBands ? { barrierBands } : {}),
    ...(landmark ? { landmark } : {}),
    regionHalfX: c.regionHalfX,
    regionHalfZ: c.regionHalfZ,
    perimeter: {
      halfX: perimeter.halfX as number,
      halfZ: perimeter.halfZ as number,
      halfThickness: perimeter.halfThickness as number,
      height: perimeter.height as number,
    },
    ...(basin
      ? {
          basin: {
            waterY: basin.waterY as number,
            bankSlope: basin.bankSlope as number,
            depthMax: basin.depthMax as number,
            wadeYards: basin.wadeYards as number,
          },
        }
      : {}),
    startBack: c.startBack,
    startSpacing: c.startSpacing,
    laps: c.laps,
    practiceLaps: c.practiceLaps,
    timeLimitSeconds: c.timeLimitSeconds,
    musicTrack: c.musicTrack,
    roles,
    practiceCopies: c.practiceCopies,
  };
}

/** The scratch draft the dev-server endpoint writes. Never the curated records
 *  module: this file is a note to self, not content. */
export function draftFileContents(circuit: RealmRacersCircuit): string {
  return [
    `// Realm Racers circuit draft '${circuit.id}', saved from circuit_editor.html.`,
    '// Scratch only: gitignored, never imported, and never the curated records',
    '// module (which carries the authored prose explaining every number). Paste',
    '// the literal below into src/sim/content/realm_racers_circuits.ts and write',
    '// that prose by hand.',
    '',
    "import type { RealmRacersCircuit } from '../../src/sim/content/realm_racers_circuits';",
    '',
    circuitToTypeScript(circuit),
  ].join('\n');
}
