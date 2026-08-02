// What every Realm Racers circuit SHARES: the margins and the apron rule the
// spline derives its boundaries from, the grid size, the two pieces of math
// that read nothing derived (gate crossing and the region test), and the LANE
// table that says which circuit sits where in the instance band.
//
// The circuits themselves are authored data, one record each in
// `content/realm_racers_circuits.ts`. Everything geometric that follows from a
// record (the resampled centerline, arc lengths, the projection, the gates, the
// start slots, the lateral boundaries) is derived per circuit in the sibling
// leaf `realm_racers_spline.ts`, and the collision set in
// `realm_racers_colliders.ts`. Keeping the split means the derived geometry can
// get as dense as it likes without bloating what is authored.

import {
  REALM_RACERS_CIRCUIT_LIST,
  REALM_RACERS_PRACTICE_CIRCUIT,
  type RealmRacersCircuit,
} from './content/realm_racers_circuits';

export interface RallyPoint {
  x: number;
  z: number;
}

export interface RallyGate extends RallyPoint {
  index: number;
  dirX: number;
  dirZ: number;
  /** Half the crossing band, always wider than the road (see GATE_MARGIN). */
  halfWidth: number;
  /** Arc length of the gate along the lap, yards from the start line. */
  s: number;
}

/**
 * The band's anchor: lane 0's origin, and the frame every circuit's control
 * points are authored around. It sits in the reserved instance band between the
 * Yumi maze and dungeon overflow, so no circuit can collide with overworld
 * content or another activity.
 */
export const REALM_RACERS_ORIGIN = { x: 113_700, z: 0 } as const;

export const REALM_RACERS_MAX_GATE_STEP = 4;

/** Narrowest road half-width any circuit may author. On the garden circuit it
 *  is the HAIRPIN's, which is where a circuit's tightest road belongs. */
export const REALM_RACERS_MIN_HALF_WIDTH = 8.0;

/** Uniform arc-length spacing of the resampled centerline, yards. */
export const REALM_RACERS_SAMPLE_STEP = 1.0;

/**
 * How far a gate's crossing band reaches PAST the local road edge. The band
 * must always over-cover the road, or a racer hugging the outer edge crosses
 * the road without crossing the gate and silently misses a recovery anchor.
 */
export const REALM_RACERS_GATE_MARGIN = 1.5;

/** How far past the road edge a racer may run before any penalty bites. */
export const REALM_RACERS_VERGE_MARGIN = 0.75;

/**
 * The mown VERGE just outside the road edge: the first, lighter slow band, and
 * the one a racer running a touch wide lands in.
 *
 * Its width is bounded the same way the apron is, by its OWN speed loss: a cut
 * that stays inside the verge saves its depth and pays only the verge's price,
 * so `VERGE_MARGIN + RUNOFF_WIDTH` has to stay under `R * vergeLoss` at the
 * tightest corner. Widening it means making it cost more.
 */
export const REALM_RACERS_RUNOFF_WIDTH = 3.5;

/**
 * The apron: drivable garden between the road edge and the basin's shore. You
 * may run as wide as you like into it, you just lose time.
 *
 * It cannot be a constant. A racer cutting a corner along the apron's edge
 * travels an arc of radius `R - apron` instead of `R`, so the cut PAYS as soon
 * as `apron > R * slow`, whatever the wall is made of. The apron therefore
 * scales with the local corner radius and only reaches its cap on the fast
 * parts of the lap. `tests/realm_racers_colliders.test.ts` sweeps every
 * sample against that inequality, so raising the cap or softening the slow
 * without re-deriving the other fails there rather than in a race.
 */
export const REALM_RACERS_APRON_MAX = 15.0;
/**
 * Fraction of the local corner radius the apron may use. Must stay strictly
 * under the garden's speed loss (`REALM_RACERS_GARDEN_SLOW`); the gap is the
 * safety margin against a racer carrying more speed through the cut than the
 * flat model assumes.
 */
export const REALM_RACERS_APRON_RADIUS_FRACTION = 0.35;

/**
 * The road edge is marked the way an Evergarden walk is: a sown line of flowers
 * and low shrubs, not a built border. Nothing here collides; a racer drives
 * straight through it into the garden.
 */
export const REALM_RACERS_BORDER_SPACING = 1.15;
export const REALM_RACERS_BORDER_OFFSET = 0.7;

/**
 * How many machines line up. Every race is a four-pilot race, practice
 * included; a race freezes this number at seat time so a pilot dropping out
 * cannot retroactively renumber the grid under everyone else.
 */
export const REALM_RACERS_GRID_SIZE = 4;

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/**
 * Returns the fraction along movement at which a forward crossing happened.
 * Null means no valid crossing. Collinear grazes and implausibly long one-tick
 * teleports are rejected.
 */
export function rallyGateCrossingFraction(
  from: RallyPoint,
  to: RallyPoint,
  gate: RallyGate,
): number | null {
  const moveX = to.x - from.x;
  const moveZ = to.z - from.z;
  const moveLen = Math.hypot(moveX, moveZ);
  if (moveLen === 0 || moveLen > REALM_RACERS_MAX_GATE_STEP) return null;
  if (moveX * gate.dirX + moveZ * gate.dirZ <= 0) return null;

  const gateX = -gate.dirZ * gate.halfWidth;
  const gateZ = gate.dirX * gate.halfWidth;
  const qx = gate.x - gateX;
  const qz = gate.z - gateZ;
  const segX = gateX * 2;
  const segZ = gateZ * 2;
  const denominator = cross(moveX, moveZ, segX, segZ);
  if (Math.abs(denominator) < 1e-9) return null;
  const relX = qx - from.x;
  const relZ = qz - from.z;
  const t = cross(relX, relZ, segX, segZ) / denominator;
  const u = cross(relX, relZ, moveX, moveZ) / denominator;
  if (t <= 0 || t > 1 || u <= 0 || u >= 1) return null;
  return t;
}

/**
 * Lanes: where the circuits live in the band.
 *
 * The instance band is tight on x (the usable window between `YUMI_BAND_X_MAX`
 * and the overflow-dungeon guard is about 700 yards, and one circuit's region is
 * already 340 of it) and free on z, so everything stacks along z at the SAME x.
 * x is what separates the instance plane's bands from each other and the rally
 * owns its whole band, so nothing else in the world keys on z out here.
 *
 * A lane holds one COPY of one circuit. A circuit that serves competition takes
 * its public lane first, then its private practice copies: a practice lap must
 * never wait on, or be waited on by, someone else's race.
 */
export interface RealmRacersLane {
  /** Index into `REALM_RACERS_LANES`, and the multiplier on `LANE_DZ`. */
  index: number;
  circuit: RealmRacersCircuit;
  /** True for a private practice copy, false for the one public lane. */
  practice: boolean;
}

/**
 * Spacing between lanes, yards. Authored rather than derived, so adding a
 * circuit cannot silently relocate the lanes that already exist; what holds it
 * honest is `tests/realm_racers_layout.test.ts`, which derives the floor
 * (`2 * max regionHalfZ + 200`, the 200 being clear air past the ~120 yd
 * interest radius) from the circuit records and fails if this drops under it.
 * That is what makes authoring a deeper circuit fail loudly instead of quietly
 * letting two lanes see each other.
 */
export const REALM_RACERS_LANE_DZ = 500;

export const REALM_RACERS_LANES: readonly RealmRacersLane[] = (() => {
  const lanes: RealmRacersLane[] = [];
  for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
    if (circuit.roles.includes('competition')) {
      lanes.push({ index: lanes.length, circuit, practice: false });
    }
    for (let copy = 0; copy < circuit.practiceCopies; copy++) {
      lanes.push({ index: lanes.length, circuit, practice: true });
    }
  }
  return lanes;
})();

/** The public lane of a circuit, or -1 when it serves practice only. Circuits
 *  are compared by ID everywhere, never by record identity: a suite that
 *  re-imports a module gets a second copy of the records. */
export function realmRacersPublicLane(circuit: RealmRacersCircuit): number {
  return (
    REALM_RACERS_LANES.find((lane) => lane.circuit.id === circuit.id && !lane.practice)?.index ?? -1
  );
}

/** Every private copy of the practice circuit, in lane order. */
export function realmRacersPracticeLanes(): readonly RealmRacersLane[] {
  return REALM_RACERS_LANES.filter(
    (lane) => lane.practice && lane.circuit.id === REALM_RACERS_PRACTICE_CIRCUIT.id,
  );
}

/** The offset added to every geometry read on lane `lane`. Zero for lane 0, so
 *  that path is byte-identical to a single-circuit world. */
export function realmRacersLaneOffset(lane: number): RallyPoint {
  return { x: 0, z: lane * REALM_RACERS_LANE_DZ };
}

/** World origin of lane `lane`. */
export function realmRacersLaneOrigin(lane: number): RallyPoint {
  return {
    x: REALM_RACERS_ORIGIN.x,
    z: REALM_RACERS_ORIGIN.z + lane * REALM_RACERS_LANE_DZ,
  };
}

/**
 * Which lane a world point sits on, with the circuit standing there, or null
 * for none. A pure function of position: two circuits never share a lane, so
 * the answer can never depend on live match state.
 */
export function realmRacersLaneAt(x: number, z: number): RealmRacersLane | null {
  const alongBand = z - REALM_RACERS_ORIGIN.z;
  const index = Math.round(alongBand / REALM_RACERS_LANE_DZ);
  const lane = index >= 0 ? REALM_RACERS_LANES[index] : undefined;
  if (!lane) return null;
  if (Math.abs(x - REALM_RACERS_ORIGIN.x) > lane.circuit.regionHalfX) return null;
  return Math.abs(alongBand - index * REALM_RACERS_LANE_DZ) <= lane.circuit.regionHalfZ
    ? lane
    : null;
}

export function isAtRealmRacersXZ(x: number, z: number): boolean {
  return realmRacersLaneAt(x, z) !== null;
}

export function isAtRealmRacers(point: RallyPoint): boolean {
  return isAtRealmRacersXZ(point.x, point.z);
}
