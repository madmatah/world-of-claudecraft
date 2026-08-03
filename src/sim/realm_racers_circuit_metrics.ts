// Whether an authored Realm Racers circuit is DRIVABLE geometry: the live
// readout the circuit editor draws against, and the same readout a content test
// runs over every shipped circuit.
//
// It lives in `src/sim/` on purpose rather than in the editor. Every check below
// is a rule the GAME depends on (the spline's projection, the anti-cut apron,
// the basin polygon, the collision region, the band the instances stack in), so
// a copy of it inside a dev tool would be a rule the game does not share, and
// the tool would be free to bless a circuit the sim cannot drive.
//
// Everything is measured through the REAL spline rather than a second curve
// implementation: what the editor draws and what the sim derives have to be the
// same curve, or the tool is a liar.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM, no three.

import { RALLY_WATER_KINDS, type RealmRacersCircuit } from './content/realm_racers_circuits';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_MAX_RANGE,
  GROUND_BLAST_RADIUS,
} from './realm_racers_ground_blast';
import {
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from './realm_racers_layout';
import {
  REALM_RACERS_PROJECTION_ENVELOPE,
  rallyWaterKindAt,
  realmRacersTrack,
} from './realm_racers_spline';

/**
 * How far apart along the LAP two samples have to be before the distance
 * between them means anything. Neighbours on the same stretch are always close;
 * what the measurements below are hunting is two DIFFERENT parts of the circuit
 * running alongside each other.
 */
const FAR_APART_SAMPLES = 80;

/**
 * Closest two far-apart stretches may run, yards. Twice the spline's projection
 * envelope, because a racer halfway between two stretches nearer than that sits
 * inside BOTH envelopes: the hinted search will accept whichever it looked at
 * first, and progress, track limits and the recovery anchor all follow it onto
 * the wrong stretch.
 */
export const REALM_RACERS_MIN_STRETCH_SEPARATION = 2 * REALM_RACERS_PROJECTION_ENVELOPE;

/**
 * How far across the infield a Ground Blast actually reaches, yards. Derived
 * from the weapon rather than remembered: a shell is placed at most
 * `GROUND_BLAST_MAX_RANGE` off the nose inside a `+/-GROUND_BLAST_AIM_CONE_RAD`
 * cone and catches anything within `GROUND_BLAST_RADIUS` of where it lands, so
 * a rival on an opposed stretch is reachable while that stretch is nearer than
 * the cone-limited reach. Roughly 54 yards at today's numbers.
 */
const SHOOTING_REACH =
  (GROUND_BLAST_MAX_RANGE + GROUND_BLAST_RADIUS) * Math.cos(GROUND_BLAST_AIM_CONE_RAD);

/** How anti-parallel two stretches have to be to count as OPPOSED, which is the
 *  only arrangement a fixed forward cone can shoot across. */
const OPPOSED_TANGENT_DOT = -0.8;

/**
 * Ratio of corner radius to local road half-width under which the road ribbon's
 * inner edge folds through the centre of curvature. Geometric, not a speed
 * limit: a machine can take a 10 yard corner, but a 10 yard road cannot.
 */
export const REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR = 1;
/** ...and where it is close enough to the floor to be worth saying so. */
export const REALM_RACERS_RADIUS_OVER_WIDTH_WARN = 1.5;

/**
 * How far the total turning may sit off a full turn before the loop is not one.
 * Degrees, and deliberately tight: a simple closed curve turns through exactly
 * one circle, so anything else is a shape, not sampling noise.
 */
const TURNING_TOLERANCE_DEGREES = 5;

/**
 * A contiguous stretch of lap over which one check fails, and the worst sample
 * in it.
 *
 * Runs rather than the single worst sample on the whole lap, because the whole
 * point of the readout is that the operator can FIX what it reports. Reporting
 * only the argmin turns four tight corners into four rounds of "fix one, meet
 * the next", with nothing on screen ever saying there were four.
 */
function contiguousRuns(
  count: number,
  fails: (index: number) => boolean,
  severityOf: (index: number) => number,
): { start: number; end: number; worst: number }[] {
  const flagged: boolean[] = [];
  for (let i = 0; i < count; i++) flagged.push(fails(i));
  if (flagged.every((f) => f)) return [{ start: 0, end: count - 1, worst: argWorst(0, count - 1) }];

  function argWorst(from: number, to: number): number {
    let best = from;
    for (let k = from; k <= to; k++) {
      const i = k % count;
      if (severityOf(i) < severityOf(best % count)) best = k;
    }
    return best % count;
  }

  // Started at a sample that is NOT flagged, so a run crossing the start line
  // is walked as one run rather than reported as two.
  const origin = flagged.indexOf(false);
  if (origin < 0) return [];
  const runs: { start: number; end: number; worst: number }[] = [];
  let open = -1;
  for (let k = 0; k <= count; k++) {
    const i = (origin + k) % count;
    const on = k < count && flagged[i];
    if (on && open < 0) open = k;
    if (!on && open >= 0) {
      const from = origin + open;
      const to = origin + k - 1;
      runs.push({ start: from % count, end: to % count, worst: argWorst(from, to) });
      open = -1;
    }
  }
  return runs;
}

export type RealmRacersCircuitProblemCode =
  /** The loop crosses itself: total turning cancels out instead of measuring a
   *  full turn. Not authorable at all, since the band is flat and there is no
   *  bridge to carry one stretch over another. */
  | 'self_crossing'
  /** The loop runs clockwise, so the infield lands on the wrong side of it and
   *  the apron, the basin shore and the racing line all read the wrong sign. */
  | 'reversed_winding'
  | 'corner_folds_road'
  | 'corner_near_road_width'
  | 'stretches_too_close'
  | 'shore_overlap'
  /** A `water` span on a record that authors no basin for it to be made of. */
  | 'shore_requires_basin'
  /** `waterBands` is not a table the stepwise reader can use: unsorted, not
   *  starting at 0, out of [0, 1), or naming a kind that does not exist. */
  | 'water_bands_malformed'
  | 'road_outside_perimeter'
  | 'perimeter_outside_region'
  | 'region_outside_band'
  /** The region is deeper than half the gap between two lanes, so a racer on
   *  one copy of the circuit would come inside interest range of the next. */
  | 'region_deeper_than_lane_budget';

export interface RealmRacersCircuitProblem {
  code: RealmRacersCircuitProblemCode;
  /** An error is geometry the game cannot drive; a warning is close enough to
   *  one to be worth seeing while drawing. */
  severity: 'error' | 'warning';
  /** What was measured, and what it had to clear. Numbers rather than a
   *  sentence: `src/sim/` is language-agnostic, and the editor (English-only,
   *  like every dev tool here) is what renders these. */
  value: number;
  limit: number;
  /** Where on the lap, yards from the start line, or -1 for the whole loop. */
  s: number;
  /** Which axis failed, for the checks that measure two. Absent on the rest.
   *  Without it the two enclosure failures render as the same sentence twice
   *  and the operator cannot tell which box to widen. */
  axis?: 'x' | 'z';
}

export interface RealmRacersNearestApproach {
  /** Yards between the two centerlines at their closest far-apart pair. */
  distance: number;
  s: number;
  otherS: number;
  /** Tangent dot at that pair: -1 is head on, +1 is running alongside. */
  tangentDot: number;
}

export interface RealmRacersCircuitMetrics {
  lapLength: number;
  sampleCount: number;
  /** Signed total turning over the lap, degrees: +/-360 on a simple loop. */
  turningDegrees: number;
  /** +1 counter-clockwise, which is the sense the apron and the basin are built
   *  for (`turnRadius` is positive toward the LEFT normal), -1 clockwise. */
  winding: 1 | -1;
  tightestRadius: number;
  tightestRadiusAtS: number;
  /** The corner that comes closest to folding its own road, and where. */
  minRadiusOverWidth: number;
  minRadiusOverWidthAtS: number;
  nearestApproach: RealmRacersNearestApproach;
  /** Yards of lap that can be shot at across the infield. Information, not a
   *  fault: an opposed stretch in Ground Blast range is a circuit FEATURE. */
  shootingCorridorYards: number;
  /**
   * Yards of lap whose shore line is DRY while the nearest far-apart stretch is
   * dry too, near enough to shoot across: the shooting corridor as a piece of
   * open lawn rather than as a canal.
   *
   * Information, never a fault, and the reason `shore_overlap` is scoped to
   * water: two dry lines running close bound a strip a designer meant to keep
   * open, where two PONDS that close would be one lake drawn twice, which is a
   * defect that self-crosses the polygon.
   */
  sharedDryYards: number;
  /** Yards of lap where two stretches' WATER meets, which is where the basin
   *  polygon self-crosses. What `apronBands` exists to clear. */
  shoreOverlapYards: number;
  /** Half-extents of the ROAD's whole footprint (out to the garden edge, both
   *  sides) from the circuit's origin, yards. */
  roadHalfX: number;
  roadHalfZ: number;
  problems: readonly RealmRacersCircuitProblem[];
}

/** The whole readout for one circuit, measured through the real spline. */
export function realmRacersCircuitMetrics(circuit: RealmRacersCircuit): RealmRacersCircuitMetrics {
  const track = realmRacersTrack(circuit);
  const samples = track.samples;
  const count = samples.length;
  const step = track.step;

  // Total turning: the angle from each tangent to the next, summed the whole way
  // round. A simple closed loop turns through exactly one circle; a loop that
  // crosses itself turns one way then the other and cancels to near zero.
  let turning = 0;
  for (let i = 0; i < count; i++) {
    const a = samples[i];
    const b = samples[(i + 1) % count];
    turning += Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz);
  }
  const turningDegrees = (turning * 180) / Math.PI;
  const winding: 1 | -1 = turningDegrees < 0 ? -1 : 1;

  let tightestRadius = Number.POSITIVE_INFINITY;
  let tightestRadiusAtS = 0;
  let minRadiusOverWidth = Number.POSITIVE_INFINITY;
  let minRadiusOverWidthAtS = 0;
  for (const sample of samples) {
    const radius = Math.abs(sample.turnRadius);
    if (radius < tightestRadius) {
      tightestRadius = radius;
      tightestRadiusAtS = sample.s;
    }
    const ratio = radius / sample.halfWidth;
    if (ratio < minRadiusOverWidth) {
      minRadiusOverWidth = ratio;
      minRadiusOverWidthAtS = sample.s;
    }
  }

  // One pass over every far-apart pair answers all three of the "two stretches
  // running alongside each other" questions at once: how close they get, how
  // much lap is shootable across the gap, and where the shores meet.
  const shoreOffset = samples.map((sample) => sample.halfWidth + sample.apron);
  // Whether the line carries water at each sample: it decides whether two lines
  // meeting is a broken water polygon or an authored dry corridor.
  const dry = samples.map((sample) => rallyWaterKindAt(circuit, sample.s) === 'dry');
  const nearestDistance = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const nearestIndex = new Int32Array(count).fill(-1);
  const overlapDepth = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const a = samples[i];
    for (let j = i + FAR_APART_SAMPLES; j < count; j++) {
      const gap = j - i;
      // Measured the short way round the lap, or the samples just before the
      // start line would count as far apart from the ones just after it.
      if (Math.min(gap, count - gap) < FAR_APART_SAMPLES) continue;
      const b = samples[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance < nearestDistance[i]) {
        nearestDistance[i] = distance;
        nearestIndex[i] = j;
      }
      if (distance < nearestDistance[j]) {
        nearestDistance[j] = distance;
        nearestIndex[j] = i;
      }
      // Water only exists over a WATER span, so only two ponds can draw one
      // lake twice. Where either side is dry the same closeness is the authored
      // corridor, counted as information further down.
      if (dry[i] || dry[j]) continue;
      // The basin sits on the INFIELD (the left normal) side only, so two
      // stretches' shores can only meet where each one lies on the other's
      // infield side. Both offsets measured along the respective left normal.
      const bIsInfieldOfA = dx * -a.tz + dz * a.tx > 0;
      const aIsInfieldOfB = -dx * -b.tz + -dz * b.tx > 0;
      if (!bIsInfieldOfA || !aIsInfieldOfB) continue;
      const overlap = shoreOffset[i] + shoreOffset[j] - distance;
      if (overlap > overlapDepth[i]) overlapDepth[i] = overlap;
      if (overlap > overlapDepth[j]) overlapDepth[j] = overlap;
    }
  }

  let shootingCorridorYards = 0;
  let sharedDryYards = 0;
  let shoreOverlapYards = 0;
  const nearestApproach: RealmRacersNearestApproach = {
    distance: Number.POSITIVE_INFINITY,
    s: 0,
    otherS: 0,
    tangentDot: 0,
  };
  for (let i = 0; i < count; i++) {
    if (overlapDepth[i] > 0) shoreOverlapYards += step;
    const other = nearestIndex[i];
    if (other < 0) continue;
    const dot = samples[i].tx * samples[other].tx + samples[i].tz * samples[other].tz;
    if (nearestDistance[i] < nearestApproach.distance) {
      nearestApproach.distance = nearestDistance[i];
      nearestApproach.s = samples[i].s;
      nearestApproach.otherS = samples[other].s;
      nearestApproach.tangentDot = dot;
    }
    if (nearestDistance[i] <= SHOOTING_REACH && dot <= OPPOSED_TANGENT_DOT) {
      shootingCorridorYards += step;
    }
    if (nearestDistance[i] <= SHOOTING_REACH && dry[i] && dry[other]) {
      sharedDryYards += step;
    }
  }

  // The road's footprint is measured out to the GARDEN edge on both sides, not
  // to the centerline: the verge and the run-off are what make running wide
  // legible, and the perimeter wall has to stand outside them.
  let roadHalfX = 0;
  let roadHalfZ = 0;
  for (const sample of samples) {
    const offset = sample.halfWidth + REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH;
    const normalX = -sample.tz * offset;
    const normalZ = sample.tx * offset;
    const localX = sample.x - REALM_RACERS_ORIGIN.x;
    const localZ = sample.z - REALM_RACERS_ORIGIN.z;
    roadHalfX = Math.max(roadHalfX, Math.abs(localX + normalX), Math.abs(localX - normalX));
    roadHalfZ = Math.max(roadHalfZ, Math.abs(localZ + normalZ), Math.abs(localZ - normalZ));
  }

  const problems: RealmRacersCircuitProblem[] = [];
  const problem = (
    code: RealmRacersCircuitProblemCode,
    severity: 'error' | 'warning',
    value: number,
    limit: number,
    s = -1,
    axis?: 'x' | 'z',
  ): void => {
    problems.push(
      axis ? { code, severity, value, limit, s, axis } : { code, severity, value, limit, s },
    );
  };

  if (Math.abs(Math.abs(turningDegrees) - 360) > TURNING_TOLERANCE_DEGREES) {
    problem('self_crossing', 'error', turningDegrees, 360);
  } else if (winding < 0) {
    // Only meaningful once the loop IS a loop: a crossing shape's sign says
    // nothing about which side its infield is on.
    problem('reversed_winding', 'error', turningDegrees, 360);
  }

  // EVERY corner that fails, not the worst one: see `contiguousRuns`.
  const ratioAt = (i: number): number => Math.abs(samples[i].turnRadius) / samples[i].halfWidth;
  const folded = contiguousRuns(
    count,
    (i) => ratioAt(i) < REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR,
    ratioAt,
  );
  for (const run of folded) {
    problem(
      'corner_folds_road',
      'error',
      ratioAt(run.worst),
      REALM_RACERS_RADIUS_OVER_WIDTH_FLOOR,
      samples[run.worst].s,
    );
  }
  // A corner under the floor is wrapped in a band that is merely tight, so the
  // warning tier skips any run already carrying an error: naming one corner
  // three times is how a readout stops being read.
  const isFolded = (index: number): boolean =>
    folded.some((run) =>
      run.start <= run.end
        ? index >= run.start && index <= run.end
        : index >= run.start || index <= run.end,
    );
  for (const run of contiguousRuns(
    count,
    (i) => ratioAt(i) < REALM_RACERS_RADIUS_OVER_WIDTH_WARN,
    ratioAt,
  )) {
    if (isFolded(run.worst)) continue;
    problem(
      'corner_near_road_width',
      'warning',
      ratioAt(run.worst),
      REALM_RACERS_RADIUS_OVER_WIDTH_WARN,
      samples[run.worst].s,
    );
  }

  if (nearestApproach.distance < REALM_RACERS_MIN_STRETCH_SEPARATION) {
    problem(
      'stretches_too_close',
      'error',
      nearestApproach.distance,
      REALM_RACERS_MIN_STRETCH_SEPARATION,
      nearestApproach.s,
    );
  }
  if (shoreOverlapYards > 0) {
    problem('shore_overlap', 'error', shoreOverlapYards, 0);
  }

  // The water table, checked here as well as in the record test because this
  // readout is what a DRAFT is admitted by: a hand-edited scratch file reaches
  // the game through it and never through the record test.
  const bands = circuit.waterBands;
  if (bands) {
    let malformed = bands.length === 0 || bands[0].s !== 0;
    for (let i = 0; i < bands.length; i++) {
      if (!(bands[i].s >= 0) || bands[i].s >= 1) malformed = true;
      if (i > 0 && bands[i].s <= bands[i - 1].s) malformed = true;
      if (!RALLY_WATER_KINDS.includes(bands[i].kind)) malformed = true;
    }
    if (malformed) problem('water_bands_malformed', 'error', bands.length, 0);
  }
  if (!circuit.basin && dry.some((isDry) => !isDry)) {
    // A shore is made of water, so a circuit that authors a water span and no
    // basin has a stretch of shore line made of nothing at all.
    problem('shore_requires_basin', 'error', dry.filter((isDry) => !isDry).length, 0);
  }

  if (roadHalfX > circuit.perimeter.halfX) {
    problem('road_outside_perimeter', 'error', roadHalfX, circuit.perimeter.halfX, -1, 'x');
  }
  if (roadHalfZ > circuit.perimeter.halfZ) {
    problem('road_outside_perimeter', 'error', roadHalfZ, circuit.perimeter.halfZ, -1, 'z');
  }
  if (circuit.perimeter.halfX >= circuit.regionHalfX) {
    problem(
      'perimeter_outside_region',
      'error',
      circuit.perimeter.halfX,
      circuit.regionHalfX,
      -1,
      'x',
    );
  }
  if (circuit.perimeter.halfZ >= circuit.regionHalfZ) {
    problem(
      'perimeter_outside_region',
      'error',
      circuit.perimeter.halfZ,
      circuit.regionHalfZ,
      -1,
      'z',
    );
  }
  if (circuit.regionHalfX > REALM_RACERS_MAX_REGION_HALF_X) {
    problem('region_outside_band', 'error', circuit.regionHalfX, REALM_RACERS_MAX_REGION_HALF_X);
  }
  if (circuit.regionHalfZ > REALM_RACERS_MAX_REGION_HALF_Z) {
    problem(
      'region_deeper_than_lane_budget',
      'error',
      circuit.regionHalfZ,
      REALM_RACERS_MAX_REGION_HALF_Z,
    );
  }

  return {
    lapLength: track.length,
    sampleCount: count,
    turningDegrees,
    winding,
    tightestRadius,
    tightestRadiusAtS,
    minRadiusOverWidth,
    minRadiusOverWidthAtS,
    nearestApproach,
    shootingCorridorYards,
    sharedDryYards,
    shoreOverlapYards,
    roadHalfX,
    roadHalfZ,
    problems,
  };
}

/** The errors only: what makes a circuit unauthorable, as opposed to tight. */
export function realmRacersCircuitErrors(
  metrics: RealmRacersCircuitMetrics,
): readonly RealmRacersCircuitProblem[] {
  return metrics.problems.filter((p) => p.severity === 'error');
}
