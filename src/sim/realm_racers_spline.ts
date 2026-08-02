// Everything DERIVED from an authored Realm Racers circuit record: the
// resampled centerline, the arc-length table, nearest-point projection, the
// recovery gates, the start grid, and the two lateral boundaries (the garden's
// edge and the CONTAINMENT line, the infield's anti-cut boundary). One source
// of truth, shared by the sim (progress, recovery, track limits) and the
// renderer (the road ribbon, kerbs, borders, the water, the barriers), so what
// a racer sees and what a racer drives on cannot drift.
//
// The containment line is `halfWidth + apron` and is never authored. What
// STANDS on it is: `barrierBands` picks water, hedge or kneewall per span, and
// only the water arm lets a racer past the line at all (see
// `resolveRealmRacersContainment`).
//
// Every entry point takes the CIRCUIT it is deriving, and each derivation is
// memoized under that circuit's id: the geometry is static content, so one
// build per circuit serves every Sim in the process.
//
// Pure leaf: no SimContext, no rng, no DOM, no three. The curve is a closed
// CENTRIPETAL Catmull-Rom, the same curve class src/render/race_line.ts draws
// with THREE.CatmullRomCurve3, re-implemented in plain numbers because src/sim
// cannot import three.

import {
  isSolidBarrierKind,
  type RallyBarrierKind,
  type RealmRacersCircuit,
} from './content/realm_racers_circuits';
import {
  type RallyGate,
  type RallyPoint,
  REALM_RACERS_APRON_MAX,
  REALM_RACERS_APRON_RADIUS_FRACTION,
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
   * the INFIELD (the left normal, the side the containment line is on),
   * negative where it bends away, Infinity on a straight. Only the positive
   * case constrains the apron, because only there does cutting shorten the
   * path.
   */
  turnRadius: number;
  /** Drivable garden between the road edge and the containment line, yards. */
  apron: number;
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
  /** Drivable garden between the road edge and the containment line at `s`. */
  apronAt(s: number): number;
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
/** Half-width of the hinted search window, in samples. */
const PROJECTION_WINDOW = 40;
/** Sub-samples per authored control-point span while measuring the curve. */
const DENSE_PER_SPAN = 64;
/** Half-window, in samples, the curvature is measured over. */
const CURVATURE_WINDOW = 3;
/** Half-window, in samples, the apron's running minimum spans. */
const APRON_SMOOTH_WINDOW = 10;
/** Passes the containment clamp takes to settle (see
 *  resolveRealmRacersContainment). */
const CONTAINMENT_CLAMP_PASSES = 4;

/**
 * How much lap the wading grace tapers over as a shore span runs into a solid
 * one, yards.
 *
 * Without it the clamp limit STEPS by the whole wading margin at the boundary:
 * a racer wading four yards deep who crosses into a hedge span is walked four
 * yards sideways in one tick, which is a teleport out of the back of a hedge.
 * The taper eases them out over half a second at racing pace instead, and it
 * can never reopen a shortcut because it only ever REMOVES grace (the same
 * argument the apron's running minimum rests on).
 */
const BARRIER_EASE_YARDS = 12;

/**
 * Reads a piecewise-linear band table at a lap fraction, wrapping. The road
 * width and the apron ceiling are the same shape authored twice, so they read
 * through one function rather than two copies that can drift apart.
 */
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
 * The authored ceiling on the apron, or the shared cap where a circuit authors
 * none. Only ever narrows the derived value (see `apronBands` on the record),
 * so the anti-cut inequality the derivation exists for still holds.
 */
function maxApronAtFraction(circuit: RealmRacersCircuit, fraction: number): number {
  const bands = circuit.apronBands;
  if (!bands || bands.length === 0) return REALM_RACERS_APRON_MAX;
  return Math.min(
    REALM_RACERS_APRON_MAX,
    bandValueAtFraction(bands, (band) => band.maxApron, fraction),
  );
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

  // 4) The apron, then a running MINIMUM over a window so it narrows BEFORE a
  // corner and reopens after it. Taking the minimum (never the average) keeps
  // every sample at or under its own limit, so the smoothing cannot reopen a
  // shortcut the raw profile had closed.
  const rawApron = radii.map((r, i) => {
    const derived =
      r > 0 && Number.isFinite(r)
        ? Math.min(REALM_RACERS_APRON_MAX, REALM_RACERS_APRON_RADIUS_FRACTION * r)
        : REALM_RACERS_APRON_MAX;
    // The authored ceiling lands BEFORE the running minimum below, so a pinch
    // the operator narrows widens by the smoothing window rather than stepping
    // at its edge, and the smoothing still cannot reopen anything.
    return Math.min(derived, maxApronAtFraction(circuit, i / radii.length));
  });
  const apron = rawApron.map((_, i) => {
    let best = Number.POSITIVE_INFINITY;
    for (let k = -APRON_SMOOTH_WINDOW; k <= APRON_SMOOTH_WINDOW; k++) {
      best = Math.min(best, rawApron[(i + k + count) % count]);
    }
    return best;
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
      apron: apron[i],
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
        const from = Math.round(hintIndex) - PROJECTION_WINDOW;
        const local = scan(x, z, ((from % count) + count) % count, PROJECTION_WINDOW * 2 + 1);
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
    apronAt(s) {
      const wrapped = ((s % length) + length) % length;
      // The apron is already a running minimum, so reading the nearer sample
      // keeps it conservative rather than interpolating a wider value in.
      return apron[Math.round(wrapped / step) % count];
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
        apron: Math.min(a.apron, b.apron),
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
function memoizePerCircuit<T>(
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
 * Distance from the centerline to the CONTAINMENT line: the road plus its whole
 * drivable apron. It is where the infield stops being drivable garden, and it
 * is the line every anti-cut proof is written against. Nothing is built here;
 * `barrierBands` says what stands on it.
 */
export function rallyContainmentLineAt(circuit: RealmRacersCircuit, s: number): number {
  const track = realmRacersTrack(circuit);
  return track.halfWidthAt(s) + track.apronAt(s);
}

/** Reads the stepwise barrier table at a lap fraction, wrapping. Absent table
 *  means the whole lap is shore, which is what every circuit was before the
 *  field existed. */
function barrierKindAtFraction(circuit: RealmRacersCircuit, fraction: number): RallyBarrierKind {
  const bands = circuit.barrierBands;
  if (!bands || bands.length === 0) return 'shore';
  const f = ((fraction % 1) + 1) % 1;
  // Walked backwards: the LAST entry at or before the fraction owns it, and a
  // fraction before the first entry wraps round to the last one.
  for (let i = bands.length - 1; i >= 0; i--) {
    if (f >= bands[i].s) return bands[i].kind;
  }
  return bands[bands.length - 1].kind;
}

/**
 * A contiguous run of centerline samples, `from` inclusive and possibly
 * wrapping past the end of the sample array.
 */
interface RallySampleRun {
  from: number;
  length: number;
}

interface RallyContainmentModel {
  /** What stands on the line at each centerline sample. */
  readonly kinds: readonly RallyBarrierKind[];
  /** Yards past the line a racer may still reach at each sample: the wading
   *  margin on open shore, tapering to zero into a solid span. */
  readonly grace: Float64Array;
  /** The contiguous shore runs, which is where water exists at all. */
  readonly shoreRuns: readonly RallySampleRun[];
}

/**
 * What the containment line carries, sample by sample.
 *
 * One derivation rather than three, because the kind decides all three answers:
 * how far past the line a racer may get, where the water is, and where a
 * barrier is built.
 */
const realmRacersContainment: (circuit: RealmRacersCircuit) => RallyContainmentModel =
  memoizePerCircuit((circuit) => {
    const track = realmRacersTrack(circuit);
    const count = track.samples.length;
    const kinds: RallyBarrierKind[] = [];
    for (let i = 0; i < count; i++) kinds.push(barrierKindAtFraction(circuit, i / count));
    const wade = circuit.basin?.wadeYards ?? 0;

    // Samples to the nearest SOLID sample, the short way round the lap. A lap
    // with no solid sample at all leaves every distance at infinity, which is
    // what makes the default's grace exactly the authored wading margin.
    const distance = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
    let anySolid = false;
    for (let i = 0; i < count; i++) {
      if (isSolidBarrierKind(kinds[i])) {
        distance[i] = 0;
        anySolid = true;
      }
    }
    if (anySolid) {
      // Two sweeps each way settle a ring: one pass cannot see a source it has
      // already walked past.
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < count; i++) {
          distance[i] = Math.min(distance[i], distance[(i + count - 1) % count] + 1);
        }
        for (let i = count - 1; i >= 0; i--) {
          distance[i] = Math.min(distance[i], distance[(i + 1) % count] + 1);
        }
      }
    }
    const grace = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      // `wade * 1` is exactly `wade`, so a lap with no solid span keeps the
      // authored margin to the last bit.
      grace[i] = wade * Math.min(1, (distance[i] * track.step) / BARRIER_EASE_YARDS);
    }

    const shoreRuns: RallySampleRun[] = [];
    if (!anySolid) {
      shoreRuns.push({ from: 0, length: count });
    } else {
      // Started at a solid sample so a shore run crossing the start line is
      // walked as ONE run rather than reported as two.
      const origin = kinds.findIndex(isSolidBarrierKind);
      let open = -1;
      for (let k = 0; k <= count; k++) {
        const on = k < count && !isSolidBarrierKind(kinds[(origin + k) % count]);
        if (on && open < 0) open = k;
        if (!on && open >= 0) {
          shoreRuns.push({ from: (origin + open) % count, length: k - open });
          open = -1;
        }
      }
    }
    return { kinds, grace, shoreRuns };
  });

/** What stands on the containment line at arc length `s`. */
export function rallyBarrierKindAt(circuit: RealmRacersCircuit, s: number): RallyBarrierKind {
  const track = realmRacersTrack(circuit);
  const count = track.samples.length;
  const wrapped = ((s % track.length) + track.length) % track.length;
  return realmRacersContainment(circuit).kinds[Math.round(wrapped / track.step) % count];
}

/**
 * Yards past the containment line a racer may still reach at `s`: the basin's
 * wading margin on open shore, zero on anything solid, tapering between the two
 * so a barrier never walks a wading racer sideways in one tick.
 */
export function rallyContainmentGraceAt(circuit: RealmRacersCircuit, s: number): number {
  const track = realmRacersTrack(circuit);
  const count = track.samples.length;
  const wrapped = ((s % track.length) + track.length) % track.length;
  return realmRacersContainment(circuit).grace[Math.round(wrapped / track.step) % count];
}

/**
 * Distance from the centerline to the boundary between the VERGE and the
 * GARDEN, i.e. between the two off-track slow bands (`realmRacersOffTrackBand` in
 * `social/realm_racers.ts` splits them at exactly this offset). Nothing is
 * built here either: the renderer sows the border flowers along it, so the line
 * a racer reads is the line the penalty actually steps at.
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

/**
 * The BANK PROFILE at (x, z): 0 at the containment line, deepening at the
 * authored bank slope to the basin's floor. NEGATIVE outside the line, and the
 * magnitude there is how far out the point lies, which is what lets one call
 * answer both "how deep is the bank here" and "how far out is this".
 *
 * Purely geometric, and deliberately says nothing about whether there is WATER
 * at the point: it is the ramp shape a water surface is shaded with, and the
 * renderer only ever samples it at vertices it has already placed inside a
 * water lobe. Ask `rallyBasinDepthAt` for the other question.
 *
 * Measured along the track normal rather than to the outline polygon: the line
 * IS an offset of the centerline, so the normal distance is the exact distance
 * to it, and it costs one projection instead of a walk over 450 segments.
 */
export function rallyBankDepthAt(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  hintIndex?: number,
): number {
  const track = realmRacersTrack(circuit);
  const projection = track.project(x, z, hintIndex);
  const inward = projection.lateral - rallyContainmentLineAt(circuit, projection.s);
  if (inward <= 0) return inward;
  // A circuit with no basin authors no bank to ramp down at all.
  if (!circuit.basin) return 0;
  return Math.min(circuit.basin.depthMax, circuit.basin.bankSlope * inward);
}

/**
 * Yards of WATER under (x, z), which is the bank profile above and one more
 * question: is there water on this stretch at all.
 *
 * Zero past a solid span, because there is not. The bank profile alone would
 * answer a couple of yards of depth three yards behind a hedge, which is dry
 * garden nobody can even reach; that answer was harmless only while every
 * circuit was a lake circuit all the way round.
 *
 * NOT what the water surface is shaded with: a vertex out in the middle of a
 * lobe can be nearest to the hedged stretch across the strip, and it is still
 * open water. The renderer places its vertices inside a lobe by construction
 * and reads `rallyBankDepthAt`; this one answers for a POINT whose lobe
 * membership nobody has established.
 */
export function rallyBasinDepthAt(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
  hintIndex?: number,
): number {
  const depth = rallyBankDepthAt(circuit, x, z, hintIndex);
  if (depth <= 0) return depth;
  const projection = realmRacersTrack(circuit).project(x, z, hintIndex);
  return rallyBarrierKindAt(circuit, projection.s) === 'shore' ? depth : 0;
}

/**
 * How far from the centerline a racer may get on the infield side: the
 * containment line, plus whatever grace the barrier standing there gives. Water
 * gives the basin's wading margin; anything solid gives none.
 */
export function rallyContainmentLimitAt(circuit: RealmRacersCircuit, s: number): number {
  return rallyContainmentLineAt(circuit, s) + rallyContainmentGraceAt(circuit, s);
}

/**
 * Holds a racer out of the infield, by clamping how far in they may be while
 * leaving their position ALONG the circuit alone: they slide around the
 * boundary rather than being stopped dead or bounced back onto the road.
 *
 * This is the infield's whole anti-shortcut story now that the stone rim is
 * gone. The rim did the same job with a wall of blocks standing in the lake.
 * What replaced it was the water itself (a navigable margin, then a line no
 * mount will cross, which is what the Lily Basin does in the open world), and
 * what replaced THAT is this: the same line, with the water now only one of the
 * things a circuit may stand on it.
 */
export function resolveRealmRacersContainment(
  circuit: RealmRacersCircuit,
  x: number,
  z: number,
): RallyPoint {
  const track = realmRacersTrack(circuit);
  let px = x;
  let pz = z;
  let hint: number | undefined;
  // Iterated, because one pass does not converge from out in the middle: the
  // clamped point's nearest segment is not the one it was measured against, and
  // the limit differs between them. Two or three passes settle it, and the loop
  // only ever runs at all for a racer already past the line.
  for (let pass = 0; pass < CONTAINMENT_CLAMP_PASSES; pass++) {
    const projection = track.project(px, pz, hint);
    hint = projection.index;
    const back = projection.lateral - rallyContainmentLimitAt(circuit, projection.s);
    if (back <= 0) break;
    // Walked back along the PROJECTION's own normal, not `pointAt`'s: that
    // interpolates and renormalizes the tangent between samples, so the result
    // would sit off the segment's true normal by a centimetre.
    px -= -projection.tangentZ * back;
    pz -= projection.tangentX * back;
  }
  return { x: px, z: pz };
}

/**
 * The water's edge, as one closed polygon per contiguous SHORE span. The
 * renderer triangulates each into a water surface and punches the same polygons
 * out of the lawn, so the water sits in holes in the ground rather than
 * floating over it.
 *
 * A span's polygon is its stretch of the containment line, one point per
 * centerline sample, closed by the straight chord back to where it started.
 * On a circuit whose whole line is shore that chord has nowhere to go and the
 * result is exactly the closed offset curve, which is what the single mandatory
 * lake always was. Where a solid span interrupts, the chord cuts the water off
 * across the mouth of the strip the barrier encloses, and the strip is dry.
 */
export const realmRacersWaterOutlines: (
  circuit: RealmRacersCircuit,
) => readonly (readonly RallyPoint[])[] = memoizePerCircuit((circuit) => {
  const samples = realmRacersTrack(circuit).samples;
  const count = samples.length;
  // No basin means no water at all, whatever the bands say: the record test and
  // the metrics both refuse a shore span without one, so this is the arm a DRY
  // circuit takes rather than a fallback for a broken record.
  if (!circuit.basin) return [];
  return realmRacersContainment(circuit).shoreRuns.map((run) => {
    const out: RallyPoint[] = [];
    for (let k = 0; k < run.length; k++) {
      const sample = samples[(run.from + k) % count];
      const offset = rallyContainmentLineAt(circuit, sample.s);
      out.push({ x: sample.x - sample.tz * offset, z: sample.z + sample.tx * offset });
    }
    return out;
  });
});

/** Positive when a heading points along the racing direction, negative when it
 *  points back up the circuit (the wrong-way test). */
export function rallyForwardDot(projection: RallyProjection, dirX: number, dirZ: number): number {
  return projection.tangentX * dirX + projection.tangentZ * dirZ;
}
