// A drawn circuit out of the tool and into the tree: the pasteable TypeScript
// literal, the reader that takes one back, and the validator the dev-server
// save endpoint runs before it writes anything.
//
// The tool deliberately does NOT rewrite `src/sim/content/realm_racers_circuits.ts`
// the way the music editor rewrites its generated module. That file is
// hand-curated and its comments carry the reasoning behind every number (why a
// chicane is 8.5, why a pool sits where it does); a generator would destroy it.
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
  type RallyPond,
  type RallyProp,
  type RallyPropCollide,
  type RallyScatter,
  REALM_RACERS_DEFAULT_THEME_ID,
  type RealmRacersCircuit,
  type RealmRacersCircuitRole,
} from '../../sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import type { RallyPoint } from '../../sim/realm_racers_layout';

/** Yards, to a tenth: finer than an operator can aim and finer than the
 *  spline's own one-yard resample can show. */
const POINT_PLACES = 1;
/** Lap fractions, to four places: a ten thousandth of a 1000 yard lap. */
const FRACTION_PLACES = 4;
/** Road half-width, yards to two places. */
const BAND_PLACES = 2;
/** Prop yaw and scale, to two places: a hundredth of a radian is under a
 *  degree, and a hundredth of a scale is invisible on anything a garden holds. */
const PROP_PLACES = 2;

const ID_RE = /^[a-z][a-z0-9_]{2,40}$/;
/** A plain lower-case token: what a music track id and a theme id both are. */
const TOKEN_RE = /^[a-z0-9_]{1,40}$/;
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
    ...(circuit.props ? { props: circuit.props.map(roundProp) } : {}),
    ...(circuit.scatters ? { scatters: circuit.scatters.map(roundScatter) } : {}),
    ...(circuit.ponds ? { ponds: circuit.ponds.map(roundPond) } : {}),
  };
}

function roundCollide(collide: RallyPropCollide): RallyPropCollide {
  if (collide === 'default' || collide === 'none') return collide;
  // Footprints keep two places where a POSITION keeps one: a fence rail is a
  // quarter of a yard thick, and rounding its half-depth to a tenth would move
  // the collider a fifth of its own size.
  return collide.kind === 'circle'
    ? { kind: 'circle', r: round(collide.r, PROP_PLACES) }
    : {
        kind: 'obb',
        hw: round(collide.hw, PROP_PLACES),
        hd: round(collide.hd, PROP_PLACES),
        rot: round(collide.rot, PROP_PLACES),
      };
}

function roundProp(prop: RallyProp): RallyProp {
  return {
    asset: prop.asset,
    at:
      's' in prop.at
        ? { s: round(prop.at.s, FRACTION_PLACES), offset: round(prop.at.offset, POINT_PLACES) }
        : { x: round(prop.at.x, POINT_PLACES), z: round(prop.at.z, POINT_PLACES) },
    ...(prop.yaw === undefined
      ? {}
      : { yaw: prop.yaw === 'tangent' ? 'tangent' : round(prop.yaw, PROP_PLACES) }),
    ...(prop.scale === undefined ? {} : { scale: round(prop.scale, PROP_PLACES) }),
    ...(prop.collide === undefined ? {} : { collide: roundCollide(prop.collide) }),
  };
}

function roundScatter(scatter: RallyScatter): RallyScatter {
  return {
    asset: scatter.asset,
    zone: scatter.zone,
    ...(scatter.span
      ? {
          span: {
            s0: round(scatter.span.s0, FRACTION_PLACES),
            s1: round(scatter.span.s1, FRACTION_PLACES),
          },
        }
      : {}),
    spacing: round(scatter.spacing, POINT_PLACES),
    seed: scatter.seed,
  };
}

function roundPond(pond: RallyPond): RallyPond {
  return {
    x: round(pond.x, POINT_PLACES),
    z: round(pond.z, POINT_PLACES),
    rx: round(pond.rx, POINT_PLACES),
    rz: round(pond.rz, POINT_PLACES),
    ...(pond.rot === undefined ? {} : { rot: round(pond.rot, PROP_PLACES) }),
    ...(pond.wobble === undefined ? {} : { wobble: round(pond.wobble, PROP_PLACES) }),
    ...(pond.seed === undefined ? {} : { seed: pond.seed }),
  };
}

const pointLiteral = (point: RallyPoint): string => `{ x: ${point.x}, z: ${point.z} }`;

function collideLiteral(collide: RallyPropCollide): string {
  if (collide === 'default' || collide === 'none') return `'${collide}'`;
  return collide.kind === 'circle'
    ? `{ kind: 'circle', r: ${collide.r} }`
    : `{ kind: 'obb', hw: ${collide.hw}, hd: ${collide.hd}, rot: ${collide.rot} }`;
}

function propLiteral(prop: RallyProp): string {
  const at =
    's' in prop.at
      ? `{ s: ${prop.at.s}, offset: ${prop.at.offset} }`
      : `{ x: ${prop.at.x}, z: ${prop.at.z} }`;
  const parts = [`asset: '${prop.asset}'`, `at: ${at}`];
  if (prop.yaw !== undefined) {
    parts.push(`yaw: ${prop.yaw === 'tangent' ? "'tangent'" : prop.yaw}`);
  }
  if (prop.scale !== undefined) parts.push(`scale: ${prop.scale}`);
  if (prop.collide !== undefined) parts.push(`collide: ${collideLiteral(prop.collide)}`);
  return `{ ${parts.join(', ')} }`;
}

function scatterLiteral(scatter: RallyScatter): string {
  const parts = [`asset: '${scatter.asset}'`, `zone: '${scatter.zone}'`];
  if (scatter.span) parts.push(`span: { s0: ${scatter.span.s0}, s1: ${scatter.span.s1} }`);
  parts.push(`spacing: ${scatter.spacing}`, `seed: ${scatter.seed}`);
  return `{ ${parts.join(', ')} }`;
}

function pondLiteral(pond: RallyPond): string {
  const parts = [`x: ${pond.x}`, `z: ${pond.z}`, `rx: ${pond.rx}`, `rz: ${pond.rz}`];
  if (pond.rot !== undefined) parts.push(`rot: ${pond.rot}`);
  if (pond.wobble !== undefined) parts.push(`wobble: ${pond.wobble}`);
  if (pond.seed !== undefined) parts.push(`seed: ${pond.seed}`);
  return `{ ${parts.join(', ')} }`;
}

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
  lines.push(
    `  regionHalfX: ${c.regionHalfX},`,
    `  regionHalfZ: ${c.regionHalfZ},`,
    `  perimeter: { halfX: ${c.perimeter.halfX}, halfZ: ${c.perimeter.halfZ}, halfThickness: ${c.perimeter.halfThickness}, height: ${c.perimeter.height} },`,
  );
  // Emitted only when the circuit HAS water, which is exactly when a `water`
  // span exists: a dry circuit that carried a basin literal would be authoring
  // a lake nothing draws.
  if (c.basin) {
    lines.push(
      `  basin: { waterY: ${c.basin.waterY}, bankSlope: ${c.basin.bankSlope}, depthMax: ${c.basin.depthMax}, wadeYards: ${c.basin.wadeYards} },`,
    );
  }
  // The dressing, in AUTHORED order: it is the one part of a circuit a designer
  // composed piece by piece, so re-sorting it would throw away the order they
  // are read back in and make a diff of two exports meaningless.
  if (c.ponds) {
    lines.push('  ponds: [');
    for (const pond of c.ponds) lines.push(`    ${pondLiteral(pond)},`);
    lines.push('  ],');
  }
  if (c.props) {
    lines.push('  props: [');
    for (const prop of c.props) lines.push(`    ${propLiteral(prop)},`);
    lines.push('  ],');
  }
  if (c.scatters) {
    lines.push('  scatters: [');
    for (const scatter of c.scatters) lines.push(`    ${scatterLiteral(scatter)},`);
    lines.push('  ],');
  }
  lines.push(
    `  startBack: ${c.startBack},`,
    `  startSpacing: ${c.startSpacing},`,
    `  laps: ${c.laps},`,
    `  practiceLaps: ${c.practiceLaps},`,
    `  timeLimitSeconds: ${c.timeLimitSeconds},`,
    `  musicTrack: '${c.musicTrack}',`,
    `  theme: '${c.theme}',`,
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
 * The road-width table read straight off the wire: sorted, spanning the whole
 * lap, and every value inside the range the field allows.
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
 * The dressing off the wire.
 *
 * Carried THROUGH rather than dropped, and the reason is a live divergence the
 * one authorable placement a circuit used to have already caused once: the
 * editor's 3D preview builds the record it holds while a draft raced in game
 * arrives through this validator, so a field the validator silently discards
 * makes the two views of one circuit disagree about what is standing on it.
 *
 * The catalog key is checked against the SIM catalog, which is what the game
 * itself resolves footprints from, so the tool cannot bless a key the game
 * cannot place.
 */
function readCollide(raw: unknown): RallyPropCollide | null {
  if (raw === 'default' || raw === 'none') return raw;
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.kind === 'circle') {
    return inRange(c.r, 0.05, 200) ? { kind: 'circle', r: c.r } : null;
  }
  if (c.kind === 'obb') {
    return inRange(c.hw, 0.05, 200) && inRange(c.hd, 0.05, 200) && inRange(c.rot, -100, 100)
      ? { kind: 'obb', hw: c.hw, hd: c.hd, rot: c.rot }
      : null;
  }
  return null;
}

function readProps(raw: unknown): RallyProp[] | null {
  if (!Array.isArray(raw) || raw.length > 4096) return null;
  const out: RallyProp[] = [];
  for (const item of raw) {
    const prop = item as Record<string, unknown>;
    if (typeof prop.asset !== 'string' || !(prop.asset in REALM_RACERS_PROPS)) return null;
    const at = prop.at as Record<string, unknown> | undefined;
    if (!at || typeof at !== 'object') return null;
    let placement: RallyProp['at'];
    if (at.s !== undefined) {
      if (!inRange(at.s, 0, 1) || !inRange(at.offset, -5000, 5000)) return null;
      placement = { s: at.s, offset: at.offset };
    } else {
      if (!inRange(at.x, -5000, 5000) || !inRange(at.z, -5000, 5000)) return null;
      placement = { x: at.x, z: at.z };
    }
    if (prop.yaw !== undefined && prop.yaw !== 'tangent' && !inRange(prop.yaw, -100, 100))
      return null;
    if (prop.scale !== undefined && !inRange(prop.scale, 0.05, 50)) return null;
    const collide = prop.collide === undefined ? undefined : readCollide(prop.collide);
    if (prop.collide !== undefined && !collide) return null;
    out.push({
      asset: prop.asset,
      at: placement,
      ...(prop.yaw === undefined ? {} : { yaw: prop.yaw as number | 'tangent' }),
      ...(prop.scale === undefined ? {} : { scale: prop.scale as number }),
      ...(collide ? { collide } : {}),
    });
  }
  return out;
}

function readScatters(raw: unknown): RallyScatter[] | null {
  if (!Array.isArray(raw) || raw.length > 64) return null;
  const out: RallyScatter[] = [];
  for (const item of raw) {
    const scatter = item as Record<string, unknown>;
    if (typeof scatter.asset !== 'string' || !(scatter.asset in REALM_RACERS_PROPS)) return null;
    if (scatter.zone !== 'infield' && scatter.zone !== 'outfield') return null;
    if (!inRange(scatter.spacing, 1, 200) || !isInteger(scatter.seed, -1e9, 1e9)) return null;
    const span = scatter.span as Record<string, unknown> | undefined;
    if (span !== undefined && !(inRange(span.s0, 0, 1) && inRange(span.s1, 0, 1))) return null;
    out.push({
      asset: scatter.asset,
      zone: scatter.zone,
      ...(span === undefined ? {} : { span: { s0: span.s0 as number, s1: span.s1 as number } }),
      spacing: scatter.spacing,
      seed: scatter.seed,
    });
  }
  return out;
}

function readPonds(raw: unknown): RallyPond[] | null {
  if (!Array.isArray(raw) || raw.length > 256) return null;
  const out: RallyPond[] = [];
  for (const item of raw) {
    const pond = item as Record<string, unknown>;
    if (!inRange(pond.x, -5000, 5000) || !inRange(pond.z, -5000, 5000)) return null;
    if (!inRange(pond.rx, 0.5, 2000) || !inRange(pond.rz, 0.5, 2000)) return null;
    if (pond.rot !== undefined && !inRange(pond.rot, -100, 100)) return null;
    if (pond.wobble !== undefined && !inRange(pond.wobble, 0, 0.35)) return null;
    if (pond.seed !== undefined && !isInteger(pond.seed, -1e9, 1e9)) return null;
    out.push({
      x: pond.x,
      z: pond.z,
      rx: pond.rx,
      rz: pond.rz,
      ...(pond.rot === undefined ? {} : { rot: pond.rot as number }),
      ...(pond.wobble === undefined ? {} : { wobble: pond.wobble as number }),
      ...(pond.seed === undefined ? {} : { seed: pond.seed as number }),
    });
  }
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
  if (typeof c.musicTrack !== 'string' || !TOKEN_RE.test(c.musicTrack)) return null;
  // The SHAPE of a theme id, never its membership: whether a registry authors
  // it is a metrics ERROR (`unknown_theme`), which the panel shows live and the
  // content test fails on. Refusing it here instead would make a draft carrying
  // a theme id typed one letter wrong unsaveable and unexplained, where the
  // readout can name it.
  //
  // ABSENT is legal and defaults, unlike every other required field: a draft
  // written before themes existed is a scratch file on the operator's disk, and
  // refusing the whole record for a field that has a default would read as
  // "this is not a circuit" with nothing naming the reason.
  const theme = c.theme === undefined ? REALM_RACERS_DEFAULT_THEME_ID : c.theme;
  if (typeof theme !== 'string' || !TOKEN_RE.test(theme)) return null;

  const controlPoints = readPoints(c.controlPoints);
  if (!controlPoints) return null;
  const widthBands = readBands(c.widthBands, 'halfWidth', 1, 100) as
    | { s: number; halfWidth: number }[]
    | null;
  if (!widthBands) return null;
  const perimeter = c.perimeter as Record<string, unknown> | undefined;
  if (!perimeter) return null;
  const props = c.props === undefined ? undefined : readProps(c.props);
  if (c.props !== undefined && !props) return null;
  const scatters = c.scatters === undefined ? undefined : readScatters(c.scatters);
  if (c.scatters !== undefined && !scatters) return null;
  const ponds = c.ponds === undefined ? undefined : readPonds(c.ponds);
  if (c.ponds !== undefined && !ponds) return null;

  const basin = c.basin as Record<string, unknown> | undefined;
  // Water is optional, and required exactly where a pond is placed: the record's
  // rule is an IFF and both halves are refused here. Without a basin the ponds
  // are made of nothing at all; with one and no pond the payload authors a bank
  // profile nothing is shaded with.
  if ((ponds?.length ?? 0) > 0 !== Boolean(basin)) return null;
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
    ...(props ? { props } : {}),
    ...(scatters ? { scatters } : {}),
    ...(ponds ? { ponds } : {}),
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
    theme,
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
