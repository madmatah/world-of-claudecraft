// Everything DERIVED from an authored Realm Racers circuit record: the
// resampled centerline, the arc-length table, nearest-point projection, the
// recovery gates, the start grid, and the one lateral boundary (the garden's
// edge, where the run-off gives way to lawn). One source of truth, shared by
// the sim (progress, recovery, the off-track bands) and the renderer (the road
// ribbon, kerbs, borders), so what a racer sees and what a racer drives on
// cannot drift.
//
// NOTHING here contains a racer any more, and nothing here is offset from the
// road except the road's own edges. The infield and the outfield are open,
// drivable, decorated garden; leaving the road arms the referee in
// `realm_racers_track_limits.ts` instead of meeting a barrier; and the ponds
// are PLACED (`realm_racers_props_resolve.ts`). The APRON, a second offset
// curve that used to run from the road edge out to the water, went with them:
// once the water was placed and the referee decided cuts, the only thing left
// reading it was the envelope that keeps the dressing off the track, and that
// envelope is the garden edge.
//
// Every entry point takes the CIRCUIT it is deriving, and each derivation is
// memoized under that circuit's id: the geometry is static content, so one
// build per circuit serves every Sim in the process.
//
// Pure leaf: no SimContext, no rng, no DOM, no three. The curve is a closed
// CENTRIPETAL Catmull-Rom, the same curve class src/render/race_line.ts draws
// with THREE.CatmullRomCurve3, re-implemented in plain numbers because src/sim
// cannot import three.

import type { RealmRacersCircuit } from './content/realm_racers_circuits';
import {
  type RallyGate,
  REALM_RACERS_GATE_MARGIN,
  REALM_RACERS_GATE_SNAP_FRACTION,
  REALM_RACERS_GATE_SPACING,
  REALM_RACERS_GRID_SIZE,
  REALM_RACERS_MIN_GATES,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_SAMPLE_STEP,
  REALM_RACERS_VERGE_MARGIN,
} from './realm_racers_layout';

export interface RallySample {
  /** World position of the centerline sample. */
  x: number;
  z: number;
  /** Unit tangent, pointing along the racing direction. */
  tx: number;
  tz: number;
  /** Arc length from the start line, yards. */
  s: number;
  /** Local road half-width, yards. */
  halfWidth: number;
  /**
   * Signed radius of curvature, yards: POSITIVE where the circuit bends toward
   * the INFIELD (the left normal), negative where it bends away, Infinity on a
   * straight.
   */
  turnRadius: number;
}

export interface RallyProjection {
  /** Index of the sample opening the segment the point projected onto. */
  index: number;
  /** Arc length of the projected point, yards from the start line. */
  s: number;
  /** Signed offset from the centerline along the left normal (-tz, tx). */
  lateral: number;
  /** Unit tangent at the projected point. */
  tangentX: number;
  tangentZ: number;
}

export interface RallyStartSlot {
  x: number;
  z: number;
  facing: number;
}

export interface RallyTrackModel {
  /** Uniformly resampled centerline, closed loop (samples[0] is the start line). */
  readonly samples: readonly RallySample[];
  /** Total lap length, yards. */
  readonly length: number;
  /** Uniform spacing between consecutive samples, yards. */
  readonly step: number;
  /**
   * Nearest-point projection. `hintIndex` is the caller's last projected index:
   * the search then covers a local window around it, and falls back to a full
   * scan whenever that window cannot vouch for its own answer, either because
   * the winner sat on the window's edge (so the real nearest point may be
   * outside what it looked at, the case a teleport creates) or because the
   * offset is past the drivable envelope. That is what keeps a racer from
   * snapping to the far side of the hairpin.
   */
  project(x: number, z: number, hintIndex?: number): RallyProjection;
  halfWidthAt(s: number): number;
  pointAt(s: number): RallySample;
}

/**
 * How far off the road a projection may sit before the hint is distrusted.
 *
 * Exported because it is also what bounds how close two far-apart stretches of
 * one circuit may run: a racer between two stretches nearer than twice this is
 * inside BOTH envelopes, so the hinted search can hand them the wrong one.
 * `realm_racers_circuit_metrics.ts` measures that, and would otherwise have to
 * remember the number.
 */
export const REALM_RACERS_PROJECTION_ENVELOPE = 24;
/**
 * Half-width of the hinted search window, in samples.
 *
 * Exported because a hinted projection silently FALLS BACK to a scan of the
 * whole lap when the local answer is not trusted, and a caller dragging a point
 * around (the circuit editor's dressing) has to be able to tell the two apart:
 * an answer further than this from the hint is the fallback, which on a circuit
 * with two stretches running close can be the other one.
 */
export const REALM_RACERS_PROJECTION_WINDOW = 40;
/** Sub-samples per authored control-point span while measuring the curve. */
const DENSE_PER_SPAN = 64;
/** Half-window, in samples, the curvature is measured over. */
const CURVATURE_WINDOW = 3;
/** Reads a piecewise-linear band table at a lap fraction, wrapping. */
function bandValueAtFraction<T extends { s: number }>(
  bands: readonly T[],
  value: (band: T) => number,
  fraction: number,
): number {
  const f = ((fraction % 1) + 1) % 1;
  for (let i = 1; i < bands.length; i++) {
    const a = bands[i - 1];
    const b = bands[i];
    if (f > b.s) continue;
    const span = b.s - a.s;
    const t = span <= 0 ? 0 : (f - a.s) / span;
    return value(a) + (value(b) - value(a)) * t;
  }
  return value(bands[bands.length - 1]);
}

function widthAtFraction(circuit: RealmRacersCircuit, fraction: number): number {
  return bandValueAtFraction(circuit.widthBands, (band) => band.halfWidth, fraction);
}

/**
 * One centripetal Catmull-Rom span, evaluated with the Barry-Goldman pyramid
 * (the same formulation three.js uses for 'centripetal'). `t` runs 0..1 across
 * the span from p1 to p2.
 */
function catmullRom(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const knot = (a: readonly [number, number], b: readonly [number, number]): number =>
    Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-4;
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (
    a: readonly [number, number],
    b: readonly [number, number],
    ta: number,
    tb: number,
  ): [number, number] => {
    const w = tb - ta || 1e-4;
    const ka = (tb - u) / w;
    const kb = (u - ta) / w;
    return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}

function buildModel(circuit: RealmRacersCircuit): RallyTrackModel {
  const cps = circuit.controlPoints;
  const n = cps.length;
  const pt = (i: number): [number, number] => {
    const p = cps[((i % n) + n) % n];
    return [p.x, p.z];
  };

  // 1) Dense measurement pass: enough sub-samples that the accumulated chord
  // length is within a fraction of a percent of the true arc length.
  const dense: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < DENSE_PER_SPAN; k++) {
      dense.push(catmullRom(pt(i - 1), pt(i), pt(i + 1), pt(i + 2), k / DENSE_PER_SPAN));
    }
  }
  const denseCount = dense.length;
  const cumulative = new Float64Array(denseCount + 1);
  for (let i = 1; i <= denseCount; i++) {
    const a = dense[i - 1];
    const b = dense[i % denseCount];
    cumulative[i] = cumulative[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = cumulative[denseCount];

  // 2) Uniform arc-length resample. The count is chosen so the step lands as
  // close to the authored step as a closed loop allows.
  const count = Math.max(16, Math.round(length / REALM_RACERS_SAMPLE_STEP));
  const step = length / count;
  const positions: [number, number][] = [];
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const target = i * step;
    while (cursor < denseCount - 1 && cumulative[cursor + 1] < target) cursor++;
    const spanStart = cumulative[cursor];
    const spanLength = cumulative[cursor + 1] - spanStart;
    const t = spanLength <= 0 ? 0 : (target - spanStart) / spanLength;
    const a = dense[cursor];
    const b = dense[(cursor + 1) % denseCount];
    positions.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }

  // 3) Signed curvature over a window wider than one step: at a yard apart,
  // three consecutive samples are too collinear to read a radius from.
  const radii = positions.map((_, i) => {
    const a = positions[(i - CURVATURE_WINDOW + count) % count];
    const b = positions[i];
    const c = positions[(i + CURVATURE_WINDOW) % count];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const area = Math.abs(cross) / 2;
    if (area < 1e-9) return Number.POSITIVE_INFINITY;
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
    const ca = Math.hypot(c[0] - a[0], c[1] - a[1]);
    // The loop runs counter-clockwise in (x, z), so its interior is on the left
    // normal and a left turn (positive cross) is a turn toward the infield.
    return (Math.sign(cross) || 1) * ((ab * bc * ca) / (4 * area));
  });

  const samples: RallySample[] = positions.map(([x, z], i) => {
    const prev = positions[(i + count - 1) % count];
    const next = positions[(i + 1) % count];
    const dx = next[0] - prev[0];
    const dz = next[1] - prev[1];
    const d = Math.hypot(dx, dz) || 1;
    return {
      x: x + REALM_RACERS_ORIGIN.x,
      z: z + REALM_RACERS_ORIGIN.z,
      tx: dx / d,
      tz: dz / d,
      s: i * step,
      halfWidth: widthAtFraction(circuit, i / count),
      turnRadius: radii[i],
    };
  });

  const projectOnto = (
    index: number,
    x: number,
    z: number,
  ): { d2: number; projection: RallyProjection } => {
    const a = samples[index];
    const b = samples[(index + 1) % count];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz || 1e-9;
    const raw = ((x - a.x) * dx + (z - a.z) * dz) / len2;
    const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const len = Math.sqrt(len2);
    const ux = dx / len;
    const uz = dz / len;
    return {
      d2: (x - px) * (x - px) + (z - pz) * (z - pz),
      projection: {
        index,
        s: a.s + len * t,
        // Along the left normal (-uz, ux), matching the gate normal convention.
        lateral: (x - a.x) * -uz + (z - a.z) * ux,
        tangentX: ux,
        tangentZ: uz,
      },
    };
  };

  // `from` is already normalized into [0, count), so the walk can wrap with a
  // plain modulo. `atEdge` reports whether the winner sat on the window's rim,
  // which is how a windowed search says "the real nearest point may be outside
  // what I looked at".
  const scan = (
    x: number,
    z: number,
    from: number,
    span: number,
  ): { projection: RallyProjection; atEdge: boolean } => {
    let best = projectOnto(from, x, z);
    let bestK = 0;
    for (let k = 1; k < span; k++) {
      const candidate = projectOnto((from + k) % count, x, z);
      if (candidate.d2 < best.d2) {
        best = candidate;
        bestK = k;
      }
    }
    return { projection: best.projection, atEdge: bestK === 0 || bestK === span - 1 };
  };

  return {
    samples,
    length,
    step,
    project(x, z, hintIndex) {
      if (hintIndex !== undefined && Number.isFinite(hintIndex)) {
        const from = Math.round(hintIndex) - REALM_RACERS_PROJECTION_WINDOW;
        const local = scan(
          x,
          z,
          ((from % count) + count) % count,
          REALM_RACERS_PROJECTION_WINDOW * 2 + 1,
        );
        if (
          !local.atEdge &&
          Math.abs(local.projection.lateral) <= REALM_RACERS_PROJECTION_ENVELOPE
        ) {
          return local.projection;
        }
      }
      return scan(x, z, 0, count).projection;
    },
    halfWidthAt(s) {
      return widthAtFraction(circuit, s / length);
    },
    pointAt(s) {
      const wrapped = ((s % length) + length) % length;
      const exact = wrapped / step;
      const i = Math.floor(exact) % count;
      const t = exact - Math.floor(exact);
      const a = samples[i];
      const b = samples[(i + 1) % count];
      const tx = a.tx + (b.tx - a.tx) * t;
      const tz = a.tz + (b.tz - a.tz) * t;
      const d = Math.hypot(tx, tz) || 1;
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        tx: tx / d,
        tz: tz / d,
        s: wrapped,
        halfWidth: widthAtFraction(circuit, wrapped / length),
        turnRadius: t < 0.5 ? a.turnRadius : b.turnRadius,
      };
    },
  };
}

/**
 * One memo per derivation, keyed by circuit id. Keyed rather than singular
 * because the band holds several circuits: a shared unkeyed cache would hand
 * the practice circuit's geometry to whoever asked second.
 *
 * An entry is kept only while the RECORD behind the id is the same object. The
 * shipped records are module singletons, so every game and test caller hits the
 * cache exactly as before; a caller holding an id still while editing what is
 * under it (the circuit editor, redrawing a draft on every drag) gets the
 * geometry of the record it actually passed, and the cache stays one entry wide
 * instead of growing a track per revision.
 */
export function memoizePerCircuit<T>(
  build: (circuit: RealmRacersCircuit) => T,
): (circuit: RealmRacersCircuit) => T {
  const cache = new Map<string, { circuit: RealmRacersCircuit; value: T }>();
  return (circuit) => {
    const cached = cache.get(circuit.id);
    if (cached && cached.circuit === circuit) return cached.value;
    const value = build(circuit);
    cache.set(circuit.id, { circuit, value });
    return value;
  };
}

/** The memoized model of one circuit. */
export const realmRacersTrack: (circuit: RealmRacersCircuit) => RallyTrackModel =
  memoizePerCircuit(buildModel);

/**
 * Distance from the centerline to the boundary between the VERGE and the
 * GARDEN: road, plus the two off-track bands a racer running wide actually
 * uses. THE lateral boundary of a circuit, now that the apron is gone.
 *
 * It is where the two slow bands change over (`realmRacersOffTrackBand` in
 * `social/realm_racers.ts` splits them at exactly this offset), it is where the
 * renderer sows the border flowers, so the line a racer reads is the line the
 * penalty steps at, and it is the RACING SURFACE the dressing may not stand on:
 * the seeded scatter rejects against it and the readout errors on it
 * (`prop_blocks_racing_surface`). Nothing is built on it and nothing is
 * contained by it.
 */
export function rallyGardenEdgeOffsetAt(circuit: RealmRacersCircuit, s: number): number {
  return (
    realmRacersTrack(circuit).halfWidthAt(s) + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH
  );
}

/**
 * The reset anchors, DERIVED from the curve rather than authored.
 *
 * They were a hand-placed list of lap fractions on the record, and that was a
 * mistake: an anchor is invisible, it is never a lap-validation checkpoint
 * (continuous spline distance does that), and the only thing it decides is
 * where a reset puts a racer back. There is no design in it, so there is
 * nothing for a designer to author, and a per-circuit list is one more table to
 * get wrong on every circuit the pool ever grows by.
 *
 * The rule, a pure function of the curve and therefore identical on all three
 * hosts and at every load:
 *
 *   1. one anchor per `REALM_RACERS_GATE_SPACING` yards of lap, at least
 *      `REALM_RACERS_MIN_GATES` of them;
 *   2. spaced evenly to start with;
 *   3. each one then slid to the STRAIGHTEST road within
 *      `REALM_RACERS_GATE_SNAP_FRACTION` of the spacing, because a reset
 *      restarts a racer at a standstill facing along the track and an anchor in
 *      a corner restarts them stopped on an apex. Ties go to the sample nearest
 *      the even slot, so the spacing stays as regular as the road allows;
 *   4. the first anchor pinned ON the start/finish line.
 */
export const realmRacersGates: (circuit: RealmRacersCircuit) => readonly RallyGate[] =
  memoizePerCircuit((circuit) => {
    const track = realmRacersTrack(circuit);
    const samples = track.samples;
    const n = samples.length;
    const count = Math.max(
      REALM_RACERS_MIN_GATES,
      Math.round(track.length / REALM_RACERS_GATE_SPACING),
    );
    const spacing = track.length / count;
    const window = Math.floor((REALM_RACERS_GATE_SNAP_FRACTION * spacing) / track.step);

    /** The straightest sample within the window, nearest slot on a tie. Kept
     *  strictly under half the spacing, so two anchors can never cross. */
    const straightestNear = (slot: number): number => {
      let best = slot;
      let bestRadius = Math.abs(samples[slot].turnRadius);
      let bestOffset = 0;
      for (let k = -window; k <= window; k++) {
        const i = (((slot + k) % n) + n) % n;
        const radius = Math.abs(samples[i].turnRadius);
        const offset = Math.abs(k);
        if (radius > bestRadius || (radius === bestRadius && offset < bestOffset)) {
          best = i;
          bestRadius = radius;
          bestOffset = offset;
        }
      }
      return best;
    };

    return Array.from({ length: count }, (_, index) => {
      const slot = Math.round((index * spacing) / track.step) % n;
      const s = index === 0 ? 0 : samples[straightestNear(slot)].s;
      const p = track.pointAt(s);
      return {
        x: p.x,
        z: p.z,
        index,
        dirX: p.tx,
        dirZ: p.tz,
        halfWidth: p.halfWidth + REALM_RACERS_GATE_MARGIN,
        s,
      };
    });
  });

/**
 * The start grid: `REALM_RACERS_GRID_SIZE` slots abreast on the road behind the
 * start line, all facing along the racing direction. The row is derived from the
 * circuit's own spacing and centred on the centerline, so widening the grid is
 * an edit to two numbers rather than a rewrite here.
 */
export const realmRacersStarts: (circuit: RealmRacersCircuit) => readonly RallyStartSlot[] =
  memoizePerCircuit((circuit) => {
    const track = realmRacersTrack(circuit);
    const p = track.pointAt(track.length - circuit.startBack);
    const facing = Math.atan2(p.tx, p.tz);
    const normalX = -p.tz;
    const normalZ = p.tx;
    const n = REALM_RACERS_GRID_SIZE;
    return Array.from({ length: n }, (_, i) => {
      const offset = (i - (n - 1) / 2) * circuit.startSpacing;
      return {
        x: p.x + normalX * offset,
        z: p.z + normalZ * offset,
        facing,
      };
    });
  });

/** Positive when a heading points along the racing direction, negative when it
 *  points back up the circuit (the wrong-way test). */
export function rallyForwardDot(projection: RallyProjection, dirX: number, dirZ: number): number {
  return projection.tangentX * dirX + projection.tangentZ * dirZ;
}
