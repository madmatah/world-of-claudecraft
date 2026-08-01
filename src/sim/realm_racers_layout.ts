// The Realm Racers circuit, AUTHORED data only. This module holds the hand
// tuned numbers a designer edits (control points, width bands, gate positions,
// the start grid, the region envelope) plus the two pieces of math that read
// nothing derived: gate crossing and the region test. Everything geometric that
// follows from these numbers (the resampled centerline, arc lengths, the
// projection, the gates, the start slots, the lateral boundaries) is derived in
// the sibling leaf `realm_racers_spline.ts`, and the collision set (the
// garden wall, and only that) in `realm_racers_colliders.ts`. Keeping the
// split means the derived geometry can get as dense as it likes without
// bloating what is authored.
//
// Coordinates below are LOCAL to REALM_RACERS_ORIGIN, which sits in the
// reserved instance band between the Yumi maze and dungeon overflow, so the
// garden circuit cannot collide with overworld content or another activity.

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

export const REALM_RACERS_ORIGIN = { x: 113_700, z: 0 } as const;
/** Laps for a queued / backfilled race on the public circuit. */
export const REALM_RACERS_LAPS = 3;
/** Laps for a private practice race. Longer than the public race so a solo
 *  session has room to learn the line without changing competitive length. */
export const REALM_RACERS_PRACTICE_LAPS = 4;
export const REALM_RACERS_MAX_GATE_STEP = 4;

/**
 * The circuit: a start/finish straight heading +x, a fast right sweeper, a
 * north straight, a chicane, a long parabolic, and a hairpin back onto the
 * straight. Read as a CLOSED centripetal Catmull-Rom loop, which lands the lap
 * at roughly 455 yards. The first point is deliberately mid-straight so the
 * start line and the grid behind it both sit on straight road.
 */
export const REALM_RACERS_CONTROL_POINTS: readonly RallyPoint[] = [
  { x: -2, z: -54 }, // start / finish line, heading +x
  { x: 38, z: -52 },
  { x: 64, z: -44 }, // T1 entry, fast sweeper
  { x: 80, z: -24 },
  { x: 84, z: 2 },
  { x: 76, z: 26 },
  { x: 56, z: 42 }, // T2 exit onto the north straight
  { x: 28, z: 46 },
  { x: 8, z: 40 }, // chicane, first apex (narrowest road)
  { x: -14, z: 46 }, // chicane, second apex
  { x: -36, z: 50 },
  { x: -60, z: 42 }, // the long parabolic
  { x: -78, z: 22 },
  { x: -86, z: 0 }, // hairpin apex (tightest)
  { x: -78, z: -22 },
  { x: -62, z: -40 }, // back onto the start straight
  { x: -42, z: -52 },
] as const;

/**
 * Road half-width breakpoints as (lap fraction, half-width in yards), linearly
 * interpolated and wrapped by `halfWidthAt`. Two machines side by side plus a
 * passing gap need about 11 yards, so 6.0 (12 total) is the floor.
 */
export const REALM_RACERS_WIDTH_BANDS: readonly { s: number; halfWidth: number }[] = [
  { s: 0.0, halfWidth: 9.0 }, // start / finish straight
  { s: 0.18, halfWidth: 9.0 },
  { s: 0.24, halfWidth: 8.0 }, // fast sweeper
  { s: 0.35, halfWidth: 8.0 },
  { s: 0.41, halfWidth: 8.5 }, // north straight
  { s: 0.53, halfWidth: 8.5 },
  { s: 0.58, halfWidth: 6.0 }, // chicane
  { s: 0.62, halfWidth: 6.0 },
  { s: 0.68, halfWidth: 7.5 }, // parabolic
  { s: 0.73, halfWidth: 7.5 },
  { s: 0.8, halfWidth: 6.5 }, // hairpin
  { s: 0.9, halfWidth: 6.5 },
  { s: 0.95, halfWidth: 9.0 },
  { s: 1.0, halfWidth: 9.0 },
] as const;

/** Narrowest authored road half-width; the width bands may never go under it. */
export const REALM_RACERS_MIN_HALF_WIDTH = 6.0;

/** Uniform arc-length spacing of the resampled centerline, yards. */
export const REALM_RACERS_SAMPLE_STEP = 1.0;

/**
 * Recovery anchors as lap fractions, decoupled from the control points: eight gates
 * evenly spaced around the lap, the first ON the start/finish line.
 *
 * They are INVISIBLE recovery anchors: nothing in the HUD reads them and
 * nothing is built over them. Continuous spline distance validates laps and
 * prevents shortcuts; these fractions only decide where a reset may return.
 */
export const REALM_RACERS_GATE_FRACTIONS: readonly number[] = [
  0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875,
] as const;

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
 * Water surface height inside the basin, a touch below the lawn so the shore
 * reads as a bank rather than a decal. The basin had a stone rim around it, and
 * that rim was the circuit's inner collision; it read as a wall of blocks
 * standing in the lake, so the whole thing is gone and the water itself is the
 * hazard instead.
 */
export const REALM_RACERS_BASIN_WATER_Y = -0.55;

/**
 * The basin's bank: yards of depth gained per yard in from the shore, and the
 * depth it levels off at.
 *
 * This is ONE profile with two readers. The renderer bakes it into the water
 * surface's per-vertex shore depth (which is what drives the colour ramp and
 * the foam band), and the sim reads it to decide how deep a racer is standing.
 * Two profiles would mean a racer swimming where the water is drawn ankle deep.
 *
 * The cap matches the renderer's own seabed clamp (`WATER_SEABED_CLAMP_YARDS`
 * in `src/render/water_core.ts`), which is where its colour ramp tops out;
 * authoring deeper than that would buy nothing visible.
 */
export const REALM_RACERS_BASIN_BANK_SLOPE = 0.8;
export const REALM_RACERS_BASIN_DEPTH_MAX = 6;

/**
 * How far in from the shore a racer may still drive. The Lily Basin's shape,
 * which is the one the operator pointed at: a navigable margin, then water no
 * mount will enter. Inside the margin the racer is wading and paying for it;
 * past it the circuit simply will not let them through, so cutting the infield
 * is off the table without a wall standing in the lake to say so.
 */
export const REALM_RACERS_BASIN_WADE_YARDS = 4.0;

/**
 * The road edge is marked the way an Evergarden walk is: a sown line of flowers
 * and low shrubs, not a built border. Nothing here collides; a racer drives
 * straight through it into the garden.
 */
export const REALM_RACERS_BORDER_SPACING = 1.15;
export const REALM_RACERS_BORDER_OFFSET = 0.7;

/**
 * The wrought-iron garden wall: the circuit's OUTER bound, and the only thing
 * stopping a racer on that side. Half-extents from the origin, inside the
 * region envelope so collision still belongs to the rally at the wall itself.
 */
export const REALM_RACERS_PERIMETER_HALF_X = 104;
export const REALM_RACERS_PERIMETER_HALF_Z = 78;
export const REALM_RACERS_PERIMETER_HALF_THICKNESS = 0.4;
export const REALM_RACERS_PERIMETER_HEIGHT = 2.2;

/** Start grid: how far behind the start line, and how far off the centerline. */
export const REALM_RACERS_START_BACK = 7.0;
export const REALM_RACERS_START_SIDE = 3.2;

/**
 * Region envelope, half-extents from the origin. It must cover the circuit, the
 * drivable garden, the perimeter wall AND the dressing ring beyond it, because
 * every collision short-circuit in `colliders.ts` keys on it: anything inside is
 * the rally, anything outside past the dungeon threshold falls through to
 * interior collision. It therefore sits a good margin outside the perimeter,
 * which is where the dressing stands. Stays strictly between YUMI_BAND_X_MAX and
 * DUNGEON_OVERFLOW_X_BASE.
 */
export const REALM_RACERS_REGION_HALF_X = 124;
export const REALM_RACERS_REGION_HALF_Z = 98;

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
 * Private practice copies of the circuit. A practice lap must never wait on, or
 * be waited on by, someone else's race, so each one runs on its OWN copy of the
 * whole circuit (the Vale Cup's practice-pitch model): the same geometry shifted
 * by an ORIGIN offset, which every geometry read adds. Slot 0 is the one PUBLIC
 * circuit, where queued races run; slots 1 and up are the private copies.
 *
 * The copies stack along z at the SAME x, because x is what separates the
 * instance plane's bands from each other and the rally owns its whole band
 * (`REALM_RACERS_ORIGIN.x` sits in the reserved gap between
 * `YUMI_BAND_X_MAX` and `DUNGEON_OVERFLOW_X_BASE`, and no real overflow dungeon
 * can land on it). Nothing else in the world keys on z at this x.
 */
export const REALM_RACERS_PRACTICE_SLOTS = 6;
/**
 * Spacing between copies, yards. The region is 2 * REGION_HALF_Z = 196 deep, so
 * this leaves 204 yards of empty plane between neighbours: comfortably past the
 * ~120 yd interest radius, which is what makes a practice lap genuinely private
 * rather than merely far away.
 */
export const REALM_RACERS_SLOT_DZ = 400;

/** The offset added to every geometry read on circuit copy `slot`. Zero for the
 *  public circuit, so the public path is byte-identical to what it was. */
export function realmRacersSlotOffset(slot: number): RallyPoint {
  return { x: 0, z: slot * REALM_RACERS_SLOT_DZ };
}

/** World origin of circuit copy `slot`. */
export function realmRacersSlotOrigin(slot: number): RallyPoint {
  return {
    x: REALM_RACERS_ORIGIN.x,
    z: REALM_RACERS_ORIGIN.z + slot * REALM_RACERS_SLOT_DZ,
  };
}

/** Which circuit copy a world point sits on, or null for none. */
export function realmRacersSlotAtXZ(x: number, z: number): number | null {
  if (Math.abs(x - REALM_RACERS_ORIGIN.x) > REALM_RACERS_REGION_HALF_X) return null;
  const alongBand = z - REALM_RACERS_ORIGIN.z;
  const slot = Math.round(alongBand / REALM_RACERS_SLOT_DZ);
  if (slot < 0 || slot > REALM_RACERS_PRACTICE_SLOTS) return null;
  return Math.abs(alongBand - slot * REALM_RACERS_SLOT_DZ) <= REALM_RACERS_REGION_HALF_Z
    ? slot
    : null;
}

export function isAtRealmRacersXZ(x: number, z: number): boolean {
  return realmRacersSlotAtXZ(x, z) !== null;
}

export function isAtRealmRacers(point: RallyPoint): boolean {
  return isAtRealmRacersXZ(point.x, point.z);
}
