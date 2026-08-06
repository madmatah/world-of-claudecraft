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

import { REALM_RACERS_THEME_IDS, type RealmRacersCircuit } from './content/realm_racers_circuits';
import { polygonContainsPoint, polygonSelfIntersects } from './geometry2d';
import {
  rallyFenceRunSamples,
  realmRacersFencePlacements,
  realmRacersFenceRuns,
} from './realm_racers_fences';
import { realmRacersGroundReach, realmRacersGroundShape } from './realm_racers_ground';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_MAX_RANGE,
  GROUND_BLAST_RADIUS,
} from './realm_racers_ground_blast';
import {
  REALM_RACERS_CAMERA_CANOPY_HEIGHT,
  REALM_RACERS_CAMERA_REACH,
  REALM_RACERS_MAX_REGION_HALF_X,
  REALM_RACERS_MAX_REGION_HALF_Z,
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from './realm_racers_layout';
import {
  type RallyPickupBox,
  REALM_RACERS_PICKUP_BOX_HALF,
  REALM_RACERS_PICKUP_REACH,
  realmRacersPickupBoxes,
  realmRacersPickupLaneGap,
} from './realm_racers_pickups';
import {
  type RallyPlacedProp,
  rallyFootprintRadius,
  realmRacersPlacedPonds,
  realmRacersPlacements,
} from './realm_racers_props_resolve';
import {
  REALM_RACERS_PROJECTION_ENVELOPE,
  rallyGardenEdgeOffsetAt,
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
 * How finely a barrier run is sampled when the readout asks where it stands,
 * yards.
 *
 * A property of the READOUT rather than of a kit, which is why it is not the
 * module length: what is being answered is "does this straight line cross the
 * racing surface anywhere", and the answer must not get coarser because a
 * circuit chose a kit with longer panels. Two yards is comfortably finer than
 * the narrowest road a circuit may author.
 */
const FENCE_SAMPLE_YARDS = 2;

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
  /** A pond on a record that authors no basin for it to be made of. */
  | 'pond_requires_basin'
  /**
   * The circuit names a theme no registry authors, so every visual it derives
   * falls back to the Evergarden's and the circuit silently wears the wrong
   * skin. Flagged here rather than at the render seam because that is where a
   * DRAFT is admitted from: a hand-typed theme id reaches the game through this
   * readout and never through the record test.
   */
  | 'unknown_theme'
  | 'road_outside_perimeter'
  | 'perimeter_outside_region'
  | 'region_outside_band'
  /** The region is deeper than half the gap between two lanes, so a racer on
   *  one copy of the circuit would come inside interest range of the next. */
  | 'region_deeper_than_lane_budget'
  /** A prop or scatter names a catalog key nothing authors, so nothing draws
   *  it and nothing knows how big it is. */
  | 'unknown_prop_asset'
  /** A fence names a barrier kit nothing authors, so nothing draws it and
   *  nothing knows how thick it is. */
  | 'unknown_barrier_kit'
  /**
   * A fence run reaches into the racing surface (road, verge and run-off).
   *
   * The prop rule, applied to a thing with LENGTH, and the length is the whole
   * difference: a run is measured by SAMPLING it rather than by its two ends,
   * because a fence whose endpoints both sit safely out in the lawn can still
   * cut the inside of a corner between them.
   */
  | 'fence_blocks_racing_surface'
  /** A fence run leaves the collision region, where the rally's own
   *  short-circuits stop applying at all. */
  | 'fence_outside_region'
  /**
   * A prop's footprint, SOLID or decorative, reaches into the racing surface
   * (road, verge, run-off and the whole drivable apron). The check the
   * fountain-in-the-road defect would have failed: that piece collided with
   * nothing and was still standing where the race goes.
   */
  | 'prop_blocks_racing_surface'
  /** A prop's footprint leaves the collision region, where the rally's own
   *  short-circuits stop applying at all. */
  | 'prop_outside_region'
  /** A tall prop stands inside the chase camera's reach of the road. */
  | 'prop_in_camera_reach'
  /**
   * A pond's outline reaches into the racing surface.
   *
   * The only thing a pond can get wrong, and deliberately so. There WAS a
   * second code beside it, warning that a pond covered drivable garden; since
   * track limits became a rule the whole garden inside the wall is drivable, so
   * it was true of every pond that was not outside the circuit altogether. A
   * check that cannot come back false is not a check, and it fired five times
   * over the two shipped circuits without ever saying anything. What it was
   * trying to protect is this error: water may not touch the ground the race is
   * run on. Past that line a machine drives through a pond exactly as it drives
   * over the lawn around it.
   */
  | 'pond_on_racing_surface'
  /**
   * The road leaves the ground the circuit authored: a stretch of it, or of the
   * garden either side of it, stands over open water.
   *
   * An ERROR rather than a warning, because an island whose road runs off the
   * edge of it is not a design: the machine drives on over the sea (water costs
   * nothing and stops nobody) and the lap is run on a surface that is not drawn.
   * It is measured over CONTIGUOUS runs like the corner checks, and reported at
   * the lap position where it happens, so the operator meets the place rather
   * than a verdict about the circuit.
   *
   * It can never fire on a circuit that authors no outline: the derived
   * rectangle covers the whole collision region and then some.
   */
  | 'road_outside_ground_outline'
  /**
   * The authored ground outline crosses itself.
   *
   * An ERROR, and not a cosmetic one, because every reader of the shape is
   * even-odd: a loop that folds through itself reads as a HOLE, so the meadow,
   * the flower beds and the seeded scatters are all punched out over ground the
   * lawn is drawn on, and the road-off-ground rule reports a stretch of open
   * water where there is grass. The freehand gesture invites it (a stroke that
   * doubles back), and so did the `Fit ground` repair until it learned to cut
   * its own folds out.
   */
  | 'ground_outline_folds'
  /**
   * The authored ground outline reaches past where the WATER can follow it.
   *
   * A WARNING, and the severity is the whole of what this rule learned. It
   * shipped as an error saying an outline past the collision region stood over
   * unflattened world terrain with the world's rocks live under it, and that was
   * simply false: the entire instance band sits past `DUNGEON_X_THRESHOLD`, so
   * `groundHeight` returns the flat interior floor inside the region and outside
   * it alike, and the open-world collider grid is never consulted out there at
   * all. Nothing about the ground under an oversized island is different.
   *
   * What IS different is the sea. It is cast as rings from the island's centroid
   * out to `realmRacersGroundReach`, and a shore point past that reach clamps to
   * itself (`rallySeaMesh`), so the water collapses to nothing along whichever
   * part of the coast overran: an island with a beach on one side and a dry
   * edge on the other, for a reason nothing on screen would otherwise give.
   *
   * The limit therefore comes from the resolver rather than from the region, and
   * that fixed the rule's second fault: at the region it was 160 yards STRICTER
   * than the rectangle the same module hands a circuit that draws nothing, so it
   * refused shapes smaller than the one every shipped circuit already wears, and
   * an error there refuses the draft outright (`realm_racers_drafts.ts`).
   *
   * Measured on the SAMPLED curve rather than on the authored handles, because
   * the curve is the shape: a centripetal Catmull-Rom bulges past its control
   * points on the outside of a bend, so a ring of handles all inside the box can
   * still draw a shore outside it. One problem per axis, like the fence rule.
   */
  | 'ground_beyond_water_reach'
  /**
   * A pickup row does not fit on the ROAD where it stands: one of its boxes
   * reaches past the road edge.
   *
   * Measured against the road rather than against the garden edge every other
   * placement is judged by, and that is the whole content of the rule. A row is
   * DERIVED from the road at its own lap position, so a check against the garden
   * edge (road plus verge plus run-off) could never come back false, and a check
   * that cannot come back false is not a check. What can come back false is a
   * road too narrow for the row it is carrying: the boxes are spread over a
   * fixed fraction of the local width, so at some width their own size eats the
   * strip that fraction leaves. Then a box is standing where a machine holding
   * the racing line does not go, and the row is decoration.
   */
  | 'pickup_row_off_road'
  /**
   * A row's boxes stand close enough together that their catch zones overlap: a
   * machine passing between two of them is inside both.
   *
   * A WARNING, and it fires on shipped content today (the Express Tour's two 8
   * yard rows put neighbours 4.27 yards apart against a 2.3 yard reach). It
   * changes nothing about what HAPPENS, because the take is the nearest box with
   * the lowest index on an exact tie and the cooldown covers the rest of the
   * row, so the outcome stays deterministic on all three hosts. What it says is
   * that the row has stopped being four separate targets: the narrower the road,
   * the more a pass down the middle is a coin toss the pilot did not mean to
   * flip. It exists so a future circuit drawn narrower meets that while it is
   * being drawn rather than in a seat.
   */
  | 'pickup_row_lanes_overlap';

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
  /** The corner that comes closest to folding its own road, and where. */
  minRadiusOverWidth: number;
  minRadiusOverWidthAtS: number;
  nearestApproach: RealmRacersNearestApproach;
  /** Yards of lap that can be shot at across the infield. Information, not a
   *  fault: an opposed stretch in Ground Blast range is a circuit FEATURE. */
  shootingCorridorYards: number;
  /** Half-extents of the ROAD's whole footprint (out to the garden edge, both
   *  sides) from the circuit's origin, yards. */
  roadHalfX: number;
  roadHalfZ: number;
  /** Hand-placed props, seeded scatter pieces, solid pieces among both, and
   *  ponds: what the editor's dressing readout counts. */
  propCount: number;
  scatterCount: number;
  solidPropCount: number;
  pondCount: number;
  /** Authored pickup ROWS, not boxes: the row is what a designer places. */
  pickupRowCount: number;
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
  let minRadiusOverWidth = Number.POSITIVE_INFINITY;
  let minRadiusOverWidthAtS = 0;
  for (const sample of samples) {
    const radius = Math.abs(sample.turnRadius);
    if (radius < tightestRadius) tightestRadius = radius;
    const ratio = radius / sample.halfWidth;
    if (ratio < minRadiusOverWidth) {
      minRadiusOverWidth = ratio;
      minRadiusOverWidthAtS = sample.s;
    }
  }

  // One pass over every far-apart pair answers both "two stretches running
  // alongside each other" questions at once: how close they get, and how much
  // lap is shootable across the gap.
  const nearestDistance = new Float64Array(count).fill(Number.POSITIVE_INFINITY);
  const nearestIndex = new Int32Array(count).fill(-1);
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
    }
  }

  let shootingCorridorYards = 0;
  const nearestApproach: RealmRacersNearestApproach = {
    distance: Number.POSITIVE_INFINITY,
    s: 0,
    otherS: 0,
    tangentDot: 0,
  };
  for (let i = 0; i < count; i++) {
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
  // Checked here as well as in the record test because this readout is what a
  // DRAFT is admitted by: a hand-edited scratch file reaches the game through
  // it and never through the record test. The basin carries the bank profile
  // every pond is shaded with, so a circuit that places one and authors no
  // basin has water made of nothing at all.
  const pondCount = circuit.ponds?.length ?? 0;
  if (!circuit.basin && pondCount > 0) {
    problem('pond_requires_basin', 'error', pondCount, 0);
  }
  // Same reason, and the same shape as an unrecognised prop key: the id itself
  // cannot ride on a numeric problem, so the editor reads the name off the
  // record and what belongs here is that the circuit is not shippable.
  if (!REALM_RACERS_THEME_IDS.includes(circuit.theme)) {
    // (1, 0), the same shape `unknown_prop_asset` uses: the editor renders a
    // problem as "value against limit", so a count against a ceiling of zero
    // reads as "one of these, and none is allowed".
    problem('unknown_theme', 'error', 1, 0);
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

  // --- the dressing: what is placed on the circuit, and where it may stand ---
  //
  // Only the AUTHORED props are measured piece by piece. A seeded scatter
  // rejects against `rallyRacingSurfaceOffsetAt` and the perimeter box as it
  // resolves, and nothing it places is ever solid, so its pieces can fail none
  // of the checks below; measuring thousands of them would cost a full spline
  // projection each to prove what the resolver already guaranteed.
  const placements = realmRacersPlacements(circuit);
  // One problem per unrecognised key. The KEY itself cannot ride on a numeric
  // problem, so the editor reads the names off `realmRacersPlacements`; what
  // belongs here is how many there are and that the circuit is not shippable.
  for (let i = 0; i < placements.unknownAssets.length; i++) {
    problem('unknown_prop_asset', 'error', placements.unknownAssets.length, 0);
  }

  for (const prop of placements.props) {
    const radius = rallyFootprintRadius(prop.footprint);
    const { s, clear, surface, clearOfSurface } = realmRacersPropStanding(circuit, prop);
    if (!clearOfSurface) problem('prop_blocks_racing_surface', 'error', clear, surface, s);
    if (Math.abs(prop.x) + radius > circuit.regionHalfX) {
      problem(
        'prop_outside_region',
        'error',
        Math.abs(prop.x) + radius,
        circuit.regionHalfX,
        -1,
        'x',
      );
    }
    if (Math.abs(prop.z) + radius > circuit.regionHalfZ) {
      problem(
        'prop_outside_region',
        'error',
        Math.abs(prop.z) + radius,
        circuit.regionHalfZ,
        -1,
        'z',
      );
    }
    // Only a piece tall enough to swallow the boom: a bench beside the road is
    // scenery, a canopy over it is the frame going green.
    if (prop.height > REALM_RACERS_CAMERA_CANOPY_HEIGHT) {
      const reach = track.halfWidthAt(s) + REALM_RACERS_CAMERA_REACH;
      if (clear < reach) problem('prop_in_camera_reach', 'warning', clear, reach, s);
    }
  }

  // --- the authored barriers ---
  //
  // Same two questions the props answer (is it on the racing surface, is it
  // inside the region), asked of a thing with LENGTH. Both are sampled along the
  // run rather than tested at its ends: a fence drawn between two points out in
  // the lawn can still cut straight across a corner, and that is exactly the
  // case an endpoint test blesses. One problem per RUN, not per sample, or a
  // hedge across a hairpin would be forty callouts at one place.
  const fencePlacements = realmRacersFencePlacements(circuit);
  for (let i = 0; i < fencePlacements.unknownKits.length; i++) {
    problem('unknown_barrier_kit', 'error', fencePlacements.unknownKits.length, 0);
  }
  for (const { run } of realmRacersFenceRuns(circuit)) {
    let worst: { s: number; clear: number; surface: number } | null = null;
    // Tracked PER AXIS, because the problem carries one value and one limit and
    // the reader compares them. A run leaving the region on z, reported with its
    // x reach against the x limit, prints a value comfortably UNDER its limit:
    // the readout names a real defect with numbers that say there is none, which
    // is worse than silence. `prop_outside_region` has two arms for this reason
    // and this mirrors it.
    let worstX = 0;
    let worstZ = 0;
    for (const point of rallyFenceRunSamples(run, FENCE_SAMPLE_YARDS)) {
      const projection = track.project(
        point.x + REALM_RACERS_ORIGIN.x,
        point.z + REALM_RACERS_ORIGIN.z,
      );
      // The run's own half thickness counts: a hedge is over a yard wide, and a
      // centre line that clears the verge by a hand's breadth is a hedge on it.
      const clear = Math.abs(projection.lateral) - run.hd;
      const surface = rallyGardenEdgeOffsetAt(circuit, projection.s);
      if (!worst || clear - surface < worst.clear - worst.surface) {
        worst = { s: projection.s, clear, surface };
      }
      worstX = Math.max(worstX, Math.abs(point.x) + run.hd);
      worstZ = Math.max(worstZ, Math.abs(point.z) + run.hd);
    }
    // Raised on `clear < surface` rather than on `!(clear >= surface)`, the way
    // `realmRacersPropStanding` spells the same test: a malformed draft yields
    // NaN, every comparison with NaN is false, and this arm is the one where
    // that means "raise nothing" rather than "raise everything".
    if (worst && worst.clear < worst.surface) {
      problem('fence_blocks_racing_surface', 'error', worst.clear, worst.surface, worst.s);
    }
    if (worstX > circuit.regionHalfX) {
      problem('fence_outside_region', 'error', worstX, circuit.regionHalfX, -1, 'x');
    }
    if (worstZ > circuit.regionHalfZ) {
      problem('fence_outside_region', 'error', worstZ, circuit.regionHalfZ, -1, 'z');
    }
  }

  for (const pond of realmRacersPlacedPonds(circuit)) {
    // Two arms, because either one alone misses a real case: an outline point
    // inside the racing surface is a pond lapping onto the track, and a
    // centerline point inside the outline is a pond the road runs THROUGH with
    // its banks well clear either side.
    let onSurface = false;
    for (const point of pond.outline) {
      const projection = track.project(
        point.x + REALM_RACERS_ORIGIN.x,
        point.z + REALM_RACERS_ORIGIN.z,
      );
      if (Math.abs(projection.lateral) < rallyGardenEdgeOffsetAt(circuit, projection.s)) {
        onSurface = true;
        break;
      }
    }
    for (let i = 0; !onSurface && i < count; i++) {
      const sample = samples[i];
      const localX = sample.x - REALM_RACERS_ORIGIN.x;
      const localZ = sample.z - REALM_RACERS_ORIGIN.z;
      const span = rallyGardenEdgeOffsetAt(circuit, sample.s);
      if (Math.hypot(localX - pond.x, localZ - pond.z) > pond.radius + span) continue;
      const probes: [number, number][] = [
        [localX, localZ],
        [localX - sample.tz * span, localZ + sample.tx * span],
        [localX + sample.tz * span, localZ - sample.tx * span],
      ];
      for (const [x, z] of probes) {
        if (polygonContainsPoint(pond.outline, x, z)) {
          onSurface = true;
          break;
        }
      }
    }
    if (onSurface) problem('pond_on_racing_surface', 'error', 0, 0);
  }

  // --- the land: does the road stay on the ground the circuit authored? ---
  //
  // Measured at the GARDEN EDGE on both sides rather than at the centerline,
  // because the garden either side of the road is where a machine running wide
  // ends up: a centerline test would bless a shore cut so close that half the
  // run-off is open water. The three probes are the same shape the pond check
  // uses for the same reason.
  //
  // Skipped outright when nothing is authored: the derived rectangle covers the
  // region plus the overshoot, so every probe is inside it by construction and
  // the walk would be a lap of point-in-polygon tests to prove it.
  const ground = realmRacersGroundShape(circuit);
  if (ground.authored && polygonSelfIntersects(ground.outline)) {
    // (1, 0), the shape every count-against-a-ceiling-of-zero problem here
    // uses: one of these, and none is allowed.
    problem('ground_outline_folds', 'error', 1, 0);
  }
  if (ground.authored) {
    // The worst reach on each axis, the shape the fence rule already uses: an
    // outline is one object, so two callouts (one per axis) is what an author
    // can act on, where one per stray vertex would be a wall of them.
    let worstX = 0;
    let worstZ = 0;
    for (const point of ground.outline) {
      worstX = Math.max(worstX, Math.abs(point.x));
      worstZ = Math.max(worstZ, Math.abs(point.z));
    }
    // From the RESOLVER, so the shape a circuit is given by default and the
    // shape it is allowed to draw are the same size. They were 160 yards apart.
    const reach = realmRacersGroundReach(circuit);
    if (worstX > reach.halfX) {
      problem('ground_beyond_water_reach', 'warning', worstX, reach.halfX, -1, 'x');
    }
    if (worstZ > reach.halfZ) {
      problem('ground_beyond_water_reach', 'warning', worstZ, reach.halfZ, -1, 'z');
    }

    const offGround = (index: number): boolean => {
      const sample = samples[index];
      const localX = sample.x - REALM_RACERS_ORIGIN.x;
      const localZ = sample.z - REALM_RACERS_ORIGIN.z;
      const span = rallyGardenEdgeOffsetAt(circuit, sample.s);
      // A probe that is not a point raises NOTHING, which is this file's own
      // doctrine (see the fence run above) and needs saying HERE because the
      // test below is a NEGATED containment: without this line a malformed
      // width table or centerline would read as "off the ground" at every
      // sample and flag the entire lap, where its neighbour raises nothing at
      // all on the same draft. Whatever put a NaN in the road is a defect other
      // rules own.
      if (![localX, localZ, span].every(Number.isFinite)) return false;
      const probes: [number, number][] = [
        [localX, localZ],
        [localX - sample.tz * span, localZ + sample.tx * span],
        [localX + sample.tz * span, localZ - sample.tx * span],
      ];
      return probes.some(([x, z]) => !polygonContainsPoint(ground.outline, x, z));
    };
    for (const run of contiguousRuns(count, offGround, () => 0)) {
      // The VALUE is how much lap the run covers and the limit is zero, because
      // there is no margin to report: a yard of road over water is the whole
      // fault, and what an operator wants to know beside the place is how much
      // of the lap is standing on nothing.
      const length = (run.start <= run.end ? run.end - run.start : count - run.start + run.end) + 1;
      problem('road_outside_ground_outline', 'error', length * step, 0, samples[run.start].s);
    }
  }

  // --- the pickup rows: does the row the road derived actually fit on it? ---
  //
  // One problem per ROW, not per box: the row is what is authored, and four
  // callouts on one lap position is one unreadable callout. Every box is
  // measured by its own four CORNERS rather than by its centre, because a box
  // has depth and a corner of it sits at a different lap position from the row:
  // on a tight corner that is what puts the outer box's leading corner past the
  // road edge while its centre is comfortably inside.
  const pickupBoxes = realmRacersPickupBoxes(circuit);
  const rowBoxes = new Map<number, RallyPickupBox[]>();
  for (const box of pickupBoxes) {
    const held = rowBoxes.get(box.row);
    if (held) held.push(box);
    else rowBoxes.set(box.row, [box]);
  }
  for (const boxes of rowBoxes.values()) {
    const fit = realmRacersPickupRowFit(circuit, boxes);
    if (fit.fitsRoad) continue;
    problem('pickup_row_off_road', 'error', fit.reach, fit.road, fit.s);
  }
  // And whether the four boxes are still four separate targets there. Measured
  // per ROW off the road's own width, since the gap follows from it: the value
  // is the half-gap a machine has to thread and the limit is the catch radius
  // it has to stay outside of to be inside one box only.
  for (const row of new Set(pickupBoxes.map((box) => box.row))) {
    const box = pickupBoxes.find((candidate) => candidate.row === row) as RallyPickupBox;
    const halfGap = realmRacersPickupLaneGap(track.halfWidthAt(box.s)) / 2;
    if (halfGap >= REALM_RACERS_PICKUP_REACH) continue;
    problem('pickup_row_lanes_overlap', 'warning', halfGap, REALM_RACERS_PICKUP_REACH, box.s);
  }

  return {
    lapLength: track.length,
    sampleCount: count,
    turningDegrees,
    winding,
    tightestRadius,
    minRadiusOverWidth,
    minRadiusOverWidthAtS,
    nearestApproach,
    shootingCorridorYards,
    roadHalfX,
    roadHalfZ,
    propCount: placements.props.length,
    scatterCount: placements.scattered.length,
    solidPropCount: placements.props.filter((prop) => prop.solid).length,
    pondCount: placements.ponds.length,
    pickupRowCount: circuit.pickupRows?.length ?? 0,
    problems,
  };
}

/** The errors only: what makes a circuit unauthorable, as opposed to tight. */
/**
 * Where one placed piece stands relative to the racing surface.
 *
 * Extracted so the ONE rule has one reader. The circuit editor tints a placement
 * ghost red before the drop, and a tint derived from its own arithmetic would be
 * a second copy of `prop_blocks_racing_surface` free to disagree with the readout
 * the operator is about to be judged by. Behaviour is exactly the loop below's:
 * the piece's own footprint radius against the garden edge at the lap position it
 * projects to.
 */
export interface RealmRacersPropStanding {
  /** Lap position it projects to, yards. */
  s: number;
  /** Lateral clearance from the centerline, less the footprint radius. */
  clear: number;
  /** The garden edge there: road plus verge plus run-off, the one boundary. */
  surface: number;
  clearOfSurface: boolean;
}

/**
 * How well one pickup ROW fits the road it stands on: its worst corner, and
 * whether that corner is still on the tarmac.
 *
 * Extracted for the same reason `realmRacersPropStanding` was, and against the
 * same failure: the circuit editor tints a row's ghost before the click, and a
 * tint derived from the tool's own arithmetic would be a second copy of
 * `pickup_row_off_road` free to say green about a row the readout then refuses.
 * It takes the row's BOXES rather than a row index, because the ghost is judging
 * a row that is not on the record yet.
 *
 * Every box is measured by its four CORNERS rather than by its centre: a box has
 * depth, so a corner of it sits at a different lap position from the row, and on
 * a tight corner that is what puts the outer box's leading corner past the road
 * edge while its centre is comfortably inside.
 */
export interface RealmRacersPickupRowFit {
  /** The row's own lap position, yards. */
  s: number;
  /** How far off the centerline the worst corner reaches, yards. */
  reach: number;
  /** The road's half-width where that corner projects to, yards. */
  road: number;
  fitsRoad: boolean;
}

export function realmRacersPickupRowFit(
  circuit: RealmRacersCircuit,
  boxes: readonly RallyPickupBox[],
): RealmRacersPickupRowFit {
  const track = realmRacersTrack(circuit);
  let worst: { s: number; reach: number; road: number } | null = null;
  for (const box of boxes) {
    const tangentX = Math.sin(box.yaw);
    const tangentZ = Math.cos(box.yaw);
    const half = REALM_RACERS_PICKUP_BOX_HALF;
    for (const [along, across] of [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const cornerX = box.x + tangentX * half * along - tangentZ * half * across;
      const cornerZ = box.z + tangentZ * half * along + tangentX * half * across;
      const projection = track.project(cornerX, cornerZ);
      const reach = Math.abs(projection.lateral);
      const road = track.halfWidthAt(projection.s);
      // Worst = the corner with the least clearance, which is the one an
      // operator has to move the row (or widen the road) for. First corner wins
      // an exact tie, which is what keeps the reported numbers stable.
      if (worst && worst.road - worst.reach <= road - reach) continue;
      worst = { s: box.s, reach, road };
    }
  }
  // A row with no boxes is not a row anything can refuse. It cannot arise from
  // the resolver, which always emits `REALM_RACERS_PICKUP_LANES` of them, but a
  // predicate that threw here would turn a caller's empty list into a crash.
  if (!worst) return { s: 0, reach: 0, road: 0, fitsRoad: true };
  return { ...worst, fitsRoad: worst.reach <= worst.road };
}

export function realmRacersPropStanding(
  circuit: RealmRacersCircuit,
  prop: RallyPlacedProp,
): RealmRacersPropStanding {
  const track = realmRacersTrack(circuit);
  const projection = track.project(prop.x + REALM_RACERS_ORIGIN.x, prop.z + REALM_RACERS_ORIGIN.z);
  const clear = Math.abs(projection.lateral) - rallyFootprintRadius(prop.footprint);
  const surface = rallyGardenEdgeOffsetAt(circuit, projection.s);
  // Spelled as the NEGATION of the loop's own `clear < surface` rather than as
  // `clear >= surface`, which is the same thing for every real number and NOT
  // the same for NaN: a malformed draft used to raise nothing here and would
  // otherwise start raising a racing-surface error it has no business raising.
  return { s: projection.s, clear, surface, clearOfSurface: !(clear < surface) };
}

export function realmRacersCircuitErrors(
  metrics: RealmRacersCircuitMetrics,
): readonly RealmRacersCircuitProblem[] {
  return metrics.problems.filter((p) => p.severity === 'error');
}
