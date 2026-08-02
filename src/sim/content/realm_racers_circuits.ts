// The Realm Racers circuits, AUTHORED data only: one record per circuit, each
// holding the hand tuned numbers a designer edits (control points, width bands,
// the start grid, the perimeter, the water, the race length).
//
// Everything geometric that FOLLOWS from these numbers (the resampled
// centerline, arc lengths, the projection, the recovery anchors, the start
// slots, the lateral boundaries) is derived per circuit in
// `../realm_racers_spline.ts`, and the collision set in
// `../realm_racers_colliders.ts`. What stays in
// `../realm_racers_layout.ts` is what every circuit SHARES: the margins, the
// apron rule, the grid size, the gate-crossing math and the lane table.
//
// Coordinates are LOCAL to `REALM_RACERS_ORIGIN`, which sits in the reserved
// instance band between the Yumi maze and dungeon overflow, so a circuit cannot
// collide with overworld content or another activity.

import type { RallyPoint } from '../realm_racers_layout';

/**
 * What a circuit is used for. A circuit may serve BOTH while the pool is being
 * built out: the garden circuit is the practice home and, until a competition
 * circuit is authored, the one circuit queued races run on too.
 */
export type RealmRacersCircuitRole = 'practice' | 'competition';

/** The water hazard's bank, read by BOTH the renderer (per-vertex shore depth,
 *  which drives the colour ramp and the foam band) and the sim (how deep a
 *  racer is standing). Two profiles would mean a racer swimming where the water
 *  is drawn ankle deep. */
export interface RealmRacersBasin {
  /**
   * Water surface height inside the basin, a touch below the lawn so the shore
   * reads as a bank rather than a decal. The basin had a stone rim around it,
   * and that rim was the circuit's inner collision; it read as a wall of blocks
   * standing in the lake, so the whole thing is gone and the water itself is
   * the hazard instead.
   */
  waterY: number;
  /** Yards of depth gained per yard in from the shore. */
  bankSlope: number;
  /**
   * The depth it levels off at. Matches the renderer's own seabed clamp
   * (`WATER_SEABED_CLAMP_YARDS` in `src/render/water_core.ts`), which is where
   * its colour ramp tops out; authoring deeper than that would buy nothing
   * visible.
   */
  depthMax: number;
  /**
   * How far in from the shore a racer may still drive. The Lily Basin's shape:
   * a navigable margin, then water no mount will enter. Inside the margin the
   * racer is wading and paying for it; past it the circuit simply will not let
   * them through, so cutting the infield is off the table without a wall
   * standing in the lake to say so.
   */
  wadeYards: number;
}

/** The wrought-iron garden wall: the circuit's OUTER bound, and the only thing
 *  stopping a racer on that side. Half-extents from the circuit's origin, inside
 *  the region envelope so collision still belongs to the rally at the wall. */
export interface RealmRacersPerimeter {
  halfX: number;
  halfZ: number;
  halfThickness: number;
  height: number;
}

export interface RealmRacersCircuit {
  /** Stable id: the cache key for every derived geometry, the wire token, and
   *  the suffix of this circuit's i18n name and blurb keys. */
  id: string;
  /** Read as a CLOSED centripetal Catmull-Rom loop. */
  controlPoints: readonly RallyPoint[];
  /** Road half-width breakpoints as (lap fraction, half-width in yards),
   *  linearly interpolated and wrapped. Never under
   *  `REALM_RACERS_MIN_HALF_WIDTH`. */
  widthBands: readonly { s: number; halfWidth: number }[];
  /**
   * Optional CEILING on the derived apron, as (lap fraction, yards),
   * interpolated and wrapped exactly like `widthBands`. Applied as a further
   * `min` on top of the derived value and never as a raise, which is what keeps
   * it safe: the derivation
   * (`min(REALM_RACERS_APRON_MAX, REALM_RACERS_APRON_RADIUS_FRACTION * R)`) is
   * an ANTI-CUT ceiling, so narrowing it can only ever make a cut cost more.
   *
   * What it is for: on a STRAIGHT there is nothing to cut, so the apron reaches
   * its cap there and the basin's shore sits `halfWidth + apron` off the
   * centerline. Where two far-apart stretches of the lap run close to each
   * other, those two shores meet and the water polygon self-crosses. Pulling
   * the apron in over the pinch is the fix, and nothing else in the record can
   * express it. Omit the field entirely on a circuit with no pinch.
   */
  apronBands?: readonly { s: number; maxApron: number }[];
  /**
   * Region envelope, half-extents from the circuit's origin. It must cover the
   * circuit, the drivable garden, the perimeter wall AND the dressing ring
   * beyond it, because every collision short-circuit in `colliders.ts` keys on
   * it: anything inside is the rally, anything outside past the dungeon
   * threshold falls through to interior collision. `regionHalfZ` is also what
   * bounds the lane spacing, so a deeper circuit must not silently let two
   * lanes see each other (`tests/realm_racers_layout.test.ts` derives it).
   */
  regionHalfX: number;
  regionHalfZ: number;
  perimeter: RealmRacersPerimeter;
  basin: RealmRacersBasin;
  /**
   * The infield landmark, in circuit-local coordinates, or absent for a circuit
   * with nowhere to put one.
   *
   * Authored rather than derived, because it was derived and that was a bug: the
   * fountain sat at a fixed offset from the BAND origin, which is the middle of
   * the practice circuit's lake and the middle of another circuit's ROAD. A
   * landmark belongs to the circuit that has room for it, and nothing about a
   * circuit's spline can work out where that is.
   */
  landmark?: { x: number; z: number };
  /** How far behind the start line the row of machines sits. */
  startBack: number;
  /** Centre-to-centre spacing of the grid slots, yards. Per circuit, so a
   *  narrower circuit can tighten the row. */
  startSpacing: number;
  /** Laps for a queued / backfilled race. */
  laps: number;
  /** Laps for a private practice race. Longer than the public race so a solo
   *  session has room to learn the line without changing competitive length. */
  practiceLaps: number;
  /** Race deadline. Per circuit, because a longer lap at the same lap count can
   *  bust a limit a short lap comfortably clears. */
  timeLimitSeconds: number;
  /**
   * The area music this circuit plays. A PLAIN STRING, never the `AreaTrackId`
   * union: that type lives in `src/game/music_tracks.ts` and `src/sim/` may not
   * import from `src/game/` at all. The game layer owns the id-to-url mapping,
   * and `tests/instance_music.test.ts` pins that every circuit's track has one.
   */
  musicTrack: string;
  /** What this circuit is used for; see `RealmRacersCircuitRole`. */
  roles: readonly RealmRacersCircuitRole[];
  /**
   * How many PRIVATE copies of this circuit the band holds, beside the public
   * one. A practice lap must never wait on, or be waited on by, someone else's
   * race, so each one runs on its own copy of the whole circuit (the Vale Cup's
   * practice-pitch model): the same geometry at its own lane origin.
   */
  practiceCopies: number;
}

/**
 * The Evergarden practice circuit: a start/finish straight heading +x, a fast
 * right sweeper, a north straight, a chicane, a long parabolic, and a hairpin
 * back onto the straight. The lap lands at roughly 455 yards. The first control
 * point is deliberately mid-straight so the start line and the grid behind it
 * both sit on straight road.
 *
 * It is the circuit a player LEARNS on, which is what its id says: short, wide
 * and forgiving next to a competition circuit. Until one of those is authored it
 * is also the circuit queued races run on.
 */
const EVERGARDEN_PRACTICE: RealmRacersCircuit = {
  id: 'evergarden_practice',
  controlPoints: [
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
  ],
  /**
   * The spread between the widest and the narrowest road is deliberately
   * narrow, because a real circuit does not halve its width: what makes a
   * chicane slow is its GEOMETRY, the S it asks a machine to thread, never a
   * wall closing in. An earlier profile held the chicane at 6.0 against a 10.0
   * approach and read as a funnel rather than as a corner. At 8.5 it is still
   * the place a four-abreast field has to become three (four machines at the
   * grid's own spacing need about 18 yards and it offers 17), which was the
   * whole point of keeping it tight.
   *
   * What bounds the widths is the OUTSIDE, not the lake: the garden between the
   * road and the perimeter wall is what makes running wide legible. The basin
   * is not the constraint at any width worth authoring, since its own shore is
   * `halfWidth + apron` and moves outward with the road.
   */
  widthBands: [
    { s: 0.0, halfWidth: 10.5 }, // start / finish straight
    { s: 0.18, halfWidth: 10.5 },
    { s: 0.24, halfWidth: 9.5 }, // fast sweeper
    { s: 0.35, halfWidth: 9.5 },
    { s: 0.41, halfWidth: 10.0 }, // north straight
    { s: 0.53, halfWidth: 10.0 },
    { s: 0.58, halfWidth: 8.5 }, // chicane, the narrowest STRAIGHT-ish stretch
    { s: 0.62, halfWidth: 8.5 },
    { s: 0.68, halfWidth: 9.0 }, // parabolic
    { s: 0.73, halfWidth: 9.0 },
    { s: 0.8, halfWidth: 8.0 }, // hairpin
    { s: 0.9, halfWidth: 8.0 },
    { s: 0.95, halfWidth: 10.5 },
    { s: 1.0, halfWidth: 10.5 },
  ],
  regionHalfX: 170,
  regionHalfZ: 140,
  perimeter: { halfX: 118, halfZ: 92, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6, wadeYards: 4.0 },
  /** Out in the lake, where this circuit's own infield has always put it. */
  landmark: { x: -4, z: 4 },
  startBack: 7.0,
  /**
   * The row is symmetric about the centerline, so the arithmetic that has to
   * hold is:
   *
   *   road half-width on the start straight  10.5   (widthBands, s = 0 to 0.18)
   *   machine hull radius                     1.7   (VEHICLE_PROFILES.bodyRadius)
   *   outermost slot centre                   7.5   ((n - 1) / 2 * spacing)
   *   outermost hull edge                     9.2   -> 1.3 yd of road left outside it
   *   gap between neighbouring hulls          1.6   (spacing - 2 * bodyRadius)
   *
   * The two clearances are deliberately close to each other: a row bunched in
   * the middle of a wide road with empty tarmac either side reads as a mistake,
   * so the spacing is sized to spread the field across the road it actually
   * has. `tests/realm_racers_layout.test.ts` re-derives all of it rather than
   * pinning the numbers, so an edit here fails the test instead of quietly
   * parking a machine on the grass.
   */
  startSpacing: 5.0,
  laps: 3,
  practiceLaps: 4,
  timeLimitSeconds: 180,
  musicTrack: 'realm_racers',
  roles: ['practice'],
  practiceCopies: 6,
};

/**
 * The Evergarden Express Tour: the first COMPETITION circuit, and the first
 * drawn in the circuit editor rather than typed by hand.
 *
 * Measured through the shared spline at authoring time: a 1469 yard lap over
 * 1469 samples, turning +360 degrees (so it closes without crossing itself),
 * winding counter-clockwise (so the infield is on the left normal, which is
 * what the apron and the basin shore are built on), and a tightest corner of
 * 15.2 yards against a 8 yard local half-width, a ratio of 1.90 that keeps the
 * road ribbon's inner edge from folding through its own centre of curvature.
 *
 * Its `apronBands` are the reason the shore never self-crosses: where two
 * stretches of the lap run close to each other the derived apron would push
 * both shores into the same water, and pulling it in over those arcs is the
 * only thing in the record that can say so.
 *
 * Known and deliberate, to revisit in the seat: the lap is a third longer than
 * the 1100 yard target (about 37 s a lap at the `ace` pace, so a 3 lap race
 * still finishes inside the 180 s limit), and it has NO shooting corridor yet:
 * its closest opposed stretches sit 54 yards apart at a tangent dot of -0.66,
 * which is 131 degrees rather than the head-on -0.8 a cross-gap shell needs.
 */
const EVERGARDEN_EXPRESS_TOUR: RealmRacersCircuit = {
  id: 'evergarden_express_tour',
  controlPoints: [
    { x: -21.3, z: -87.5 },
    { x: 24.1, z: -77.5 },
    { x: 39, z: -73.7 },
    { x: 56, z: -58.7 },
    { x: 63.5, z: -45.3 },
    { x: 61.5, z: -26.6 },
    { x: 47.4, z: -5.8 },
    { x: 45, z: 14.4 },
    { x: 64, z: 42.7 },
    { x: 58, z: 64.1 },
    { x: 27.6, z: 84.9 },
    { x: 8.7, z: 85 },
    { x: -15.9, z: 70.2 },
    { x: -18.9, z: 47 },
    { x: -8.6, z: 19.4 },
    { x: -7.2, z: 3.8 },
    { x: -13.4, z: -9.9 },
    { x: -26, z: -17.9 },
    { x: -41.2, z: -21.3 },
    { x: -63.1, z: -22.2 },
    { x: -80.4, z: -15.1 },
    { x: -100.7, z: 8.4 },
    { x: -133.5, z: 20.2 },
    { x: -184.6, z: 5.9 },
    { x: -187.4, z: -29.7 },
    { x: -169.8, z: -53.3 },
    { x: -130.4, z: -53.5 },
    { x: -114.9, z: -60.8 },
    { x: -105.8, z: -83.3 },
    { x: -93, z: -100.4 },
  ],
  widthBands: [
    { s: 0, halfWidth: 10 },
    { s: 0.045, halfWidth: 10 },
    { s: 0.05, halfWidth: 10 },
    { s: 0.06, halfWidth: 9.8 },
    { s: 0.08, halfWidth: 9.06 },
    { s: 0.145, halfWidth: 9.04 },
    { s: 0.15, halfWidth: 8.92 },
    { s: 0.155, halfWidth: 8.66 },
    { s: 0.16, halfWidth: 8.27 },
    { s: 0.17, halfWidth: 8.08 },
    { s: 0.235, halfWidth: 8 },
    { s: 0.41, halfWidth: 8 },
    { s: 0.5, halfWidth: 8 },
    { s: 0.705, halfWidth: 8 },
    { s: 0.715, halfWidth: 8.2 },
    { s: 0.735, halfWidth: 8.97 },
    { s: 0.855, halfWidth: 9 },
    { s: 0.865, halfWidth: 8.8 },
    { s: 0.88, halfWidth: 8.18 },
    { s: 0.89, halfWidth: 8 },
    { s: 0.92, halfWidth: 8 },
    { s: 0.925, halfWidth: 8.11 },
    { s: 0.935, halfWidth: 8.79 },
    { s: 0.945, halfWidth: 9.6 },
    { s: 0.95, halfWidth: 9.89 },
    { s: 0.955, halfWidth: 10 },
    { s: 1, halfWidth: 10 },
  ],
  apronBands: [
    { s: 0, maxApron: 15 },
    { s: 0.175, maxApron: 15 },
    { s: 0.18, maxApron: 14.58 },
    { s: 0.185, maxApron: 13.51 },
    { s: 0.19, maxApron: 12.05 },
    { s: 0.195, maxApron: 10.45 },
    { s: 0.2, maxApron: 8.99 },
    { s: 0.205, maxApron: 7.92 },
    { s: 0.21, maxApron: 7.5 },
    { s: 0.22, maxApron: 7.5 },
    { s: 0.225, maxApron: 7.92 },
    { s: 0.23, maxApron: 8.83 },
    { s: 0.235, maxApron: 9.31 },
    { s: 0.24, maxApron: 8.91 },
    { s: 0.245, maxApron: 8.14 },
    { s: 0.25, maxApron: 7.64 },
    { s: 0.255, maxApron: 7.51 },
    { s: 0.3, maxApron: 7.5 },
    { s: 0.41, maxApron: 7.5 },
    { s: 0.415, maxApron: 7.92 },
    { s: 0.42, maxApron: 8.99 },
    { s: 0.425, maxApron: 10.45 },
    { s: 0.43, maxApron: 12.05 },
    { s: 0.435, maxApron: 13.51 },
    { s: 0.44, maxApron: 14.58 },
    { s: 0.445, maxApron: 15 },
    { s: 0.575, maxApron: 15 },
    { s: 0.58, maxApron: 14.67 },
    { s: 0.585, maxApron: 13.81 },
    { s: 0.59, maxApron: 12.64 },
    { s: 0.595, maxApron: 11.36 },
    { s: 0.6, maxApron: 10.19 },
    { s: 0.605, maxApron: 9.33 },
    { s: 0.61, maxApron: 9 },
    { s: 0.77, maxApron: 9 },
    { s: 0.775, maxApron: 9.31 },
    { s: 0.78, maxApron: 10.19 },
    { s: 0.785, maxApron: 11.36 },
    { s: 0.79, maxApron: 12.25 },
    { s: 0.795, maxApron: 12.09 },
    { s: 0.8, maxApron: 10.97 },
    { s: 0.805, maxApron: 9.75 },
    { s: 0.81, maxApron: 9.15 },
    { s: 0.815, maxApron: 9.01 },
    { s: 0.87, maxApron: 9 },
    { s: 0.875, maxApron: 9.13 },
    { s: 0.88, maxApron: 9.72 },
    { s: 0.885, maxApron: 10.89 },
    { s: 0.89, maxApron: 12.44 },
    { s: 0.895, maxApron: 13.81 },
    { s: 0.9, maxApron: 14.67 },
    { s: 0.905, maxApron: 15 },
    { s: 1, maxApron: 15 },
  ],
  regionHalfX: 265,
  regionHalfZ: 150,
  perimeter: { halfX: 217, halfZ: 124, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6, wadeYards: 4 },
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 3,
  timeLimitSeconds: 180,
  musicTrack: 'realm_racers',
  roles: ['competition'],
  practiceCopies: 0,
};

/** Every circuit, in lane order: the lane table is built by walking this record
 *  in insertion order, so an entry's position here decides where in the band it
 *  sits. Appending is free; reordering MOVES existing circuits. */
export const REALM_RACERS_CIRCUITS: Record<string, RealmRacersCircuit> = {
  [EVERGARDEN_PRACTICE.id]: EVERGARDEN_PRACTICE,
  [EVERGARDEN_EXPRESS_TOUR.id]: EVERGARDEN_EXPRESS_TOUR,
};

/** Insertion-ordered list, which is the lane order. */
export const REALM_RACERS_CIRCUIT_LIST: readonly RealmRacersCircuit[] =
  Object.values(REALM_RACERS_CIRCUITS);

/** The one circuit practice runs on, whatever the competition pool holds. */
export const REALM_RACERS_PRACTICE_CIRCUIT: RealmRacersCircuit = (() => {
  const practice = REALM_RACERS_CIRCUIT_LIST.filter((c) => c.roles.includes('practice'));
  if (practice.length !== 1) {
    throw new Error(`expected exactly one practice circuit, found ${practice.length}`);
  }
  return practice[0];
})();

export const REALM_RACERS_PRACTICE_CIRCUIT_ID = REALM_RACERS_PRACTICE_CIRCUIT.id;

/** The pool a queued race draws from. Never empty. */
export function realmRacersCompetitionCircuits(): readonly RealmRacersCircuit[] {
  return REALM_RACERS_CIRCUIT_LIST.filter((c) => c.roles.includes('competition'));
}

/** The record for an id, or undefined for an id no longer authored (a match
 *  restored from an older shape, which the caller falls back on). */
export function realmRacersCircuitById(id: string): RealmRacersCircuit | undefined {
  return REALM_RACERS_CIRCUITS[id];
}
