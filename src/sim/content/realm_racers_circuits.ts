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
// grid size, the gate-crossing math and the lane table.
//
// Coordinates are LOCAL to `REALM_RACERS_ORIGIN`, which sits in the reserved
// instance band between the Yumi maze and dungeon overflow, so a circuit cannot
// collide with overworld content or another activity.

import { realmRacersDraftCircuit } from '../realm_racers_draft_registry';
import type { RallyPoint } from '../realm_racers_layout';

/**
 * What a circuit is used for. A circuit may serve BOTH while the pool is being
 * built out: the garden circuit is the practice home and, until a competition
 * circuit is authored, the one circuit queued races run on too.
 */
export type RealmRacersCircuitRole = 'practice' | 'competition';

/**
 * Every theme a circuit may name, and the one a record falls back on.
 *
 * Pure data, no logic, and deliberately sim-side: the circuit editor offers this
 * list as a picker and the metrics readout flags an id that is not in it
 * (`unknown_theme`), neither of which may import render code. The records the
 * ids resolve to live in `src/render/realm_racers_themes.ts`, and
 * `tests/realm_racers_themes.test.ts` pins the two against each other BOTH
 * ways, so an id here with no record (or a record with no id) fails.
 *
 * ONE ID PER WORLD-MAP ZONE, in the order `data.ts` lists the zones: a circuit
 * drawn anywhere wears the art of the realm it is meant to be in, and adding a
 * realm's circuit is adding a `theme:` string to its record rather than a
 * render change. The ids are the ZONE ids with their articles dropped
 * (`veiled_hollow` for `veiled_hollow`, `eastbrook` for `eastbrook_vale`,
 * `mirefen` for `mirefen_marsh`, `thornpeak` for `thornpeak_heights`,
 * `farshore` for `farshore_isle`); `tests/realm_racers_themes.test.ts` pins the
 * mapping against the zone table so a fifteenth realm cannot ship without one.
 */
export const REALM_RACERS_THEME_IDS: readonly string[] = [
  'eastbrook',
  'mirefen',
  'thornpeak',
  'veiled_hollow',
  'drakelands',
  'frostveil',
  'amberfall',
  'willowfen',
  'nightbloom',
  'wraithwood',
  'palmreach',
  'evergarden',
  'galecrest',
  'farshore',
];

/** The theme a circuit wears unless it says otherwise, and what a bad id falls
 *  back to at draw time. */
export const REALM_RACERS_DEFAULT_THEME_ID = 'evergarden';

/** The water's bank, read by BOTH the renderer (per-vertex shore depth,
 *  which drives the colour ramp and the foam band) and the sim (how deep a
 *  racer is standing). Two profiles would mean a racer swimming where the water
 *  is drawn ankle deep. */
export interface RealmRacersBasin {
  /**
   * Water surface height inside the basin, a touch below the lawn so the shore
   * reads as a bank rather than a decal.
   */
  waterY: number;
  /** Yards of depth gained per yard in from a pond's own outline. */
  bankSlope: number;
  /**
   * The depth it levels off at. Matches the renderer's own seabed clamp
   * (`WATER_SEABED_CLAMP_YARDS` in `src/render/water_core.ts`), which is where
   * its colour ramp tops out; authoring deeper than that would buy nothing
   * visible.
   */
  depthMax: number;
}

/** The wrought-iron garden wall: the circuit's OUTER bound, and the only thing
 *  on the whole circuit that stops a racer unless the dressing authors
 *  something solid. Half-extents from the circuit's origin, inside the region
 *  envelope so collision still belongs to the rally at the wall. */
export interface RealmRacersPerimeter {
  halfX: number;
  halfZ: number;
  halfThickness: number;
  height: number;
}

/**
 * Where a piece of scenery stands, in one of TWO frames, and the record keeps
 * whichever one the author chose.
 *
 * TRACK-SPACE (`{ s, offset }`) is a lap fraction plus a signed offset along the
 * left normal, in yards. Trackside furniture belongs here: a bench at the
 * hairpin stays at the hairpin when the centerline moves, where an absolute
 * point would be left standing in the new road.
 *
 * ABSOLUTE (`{ x, z }`) is circuit-local, the same frame as `controlPoints`.
 * Infield landmarks belong here: a fountain out in the middle has no lap
 * fraction worth speaking of, and projecting one onto the nearest stretch would
 * make it slide about every time that stretch is redrawn.
 *
 * NEVER world coordinates and never anything measured off `REALM_RACERS_ORIGIN`:
 * a placement expressed against the band is a placement that belongs to the
 * band rather than to the circuit, which is exactly how the tiered fountain came
 * to stand in the middle of the Express Tour's road.
 */
export type RallyPropAt = { s: number; offset: number } | { x: number; z: number };

/**
 * How a piece of scenery collides, or does not.
 *
 * `'default'` (and an absent field) takes the catalog's own answer for that
 * kind; `'none'` forces a normally solid piece to be pure decoration. A
 * footprint literal overrides both shape and size, in yards, at the placed
 * position (an `obb`'s `rot` is a circuit-local yaw, not an offset from the
 * prop's own).
 *
 * Nothing here is a track-limits device. The referee
 * (`../realm_racers_track_limits.ts`) decides what a cut is, so a gap in the
 * dressing is a view rather than a shortcut and a solid prop is only ever
 * furniture a racer can hit.
 */
export type RallyPropCollide =
  | 'default'
  | 'none'
  | { kind: 'circle'; r: number }
  | { kind: 'obb'; hw: number; hd: number; rot: number };

/** One hand-placed piece of scenery. */
export interface RallyProp {
  /** Catalog key: `REALM_RACERS_PROPS` sim side, `REALM_RACERS_PROP_VISUALS`
   *  render side. A key neither knows is a metrics error, never a silent skip. */
  asset: string;
  at: RallyPropAt;
  /** Radians, or `'tangent'` to face the racing direction where it stands. */
  yaw?: number | 'tangent';
  /** Multiplies the catalog's authored size. Defaults to 1. */
  scale?: number;
  collide?: RallyPropCollide;
}

/**
 * A seeded fill of one side of the circuit, so dressing a whole infield is a
 * record entry rather than three hundred clicks.
 *
 * Deterministic by construction: the points come out of `hash2` over a fixed
 * grid, never `ctx.rng` and never `Math.random`. Content derivation runs
 * outside the tick, at import time on three different hosts, so a draw here
 * would fork the world.
 */
export interface RallyScatter {
  asset: string;
  /** Which side of the road to fill: `infield` is the left-normal side (the
   *  side the shore and the ponds are on), `outfield` the other. */
  zone: 'infield' | 'outfield';
  /** Lap window, as fractions. Absent means the whole loop. */
  span?: { s0: number; s1: number };
  /** Target yards between pieces. */
  spacing: number;
  /** Hash input. Two scatters with the same seed and spacing fill alike. */
  seed: number;
}

/**
 * A decorative pond: an ellipse with a deterministic radial wobble, so five
 * numbers give a natural blob rather than a drawn polygon. The ONLY water a
 * circuit can carry.
 *
 * Placed, not derived. The water used to be a ribbon offset from the road (a
 * stepwise `waterBands` table saying which spans of the shore line carried
 * one), and the shape of that authoring was the defect: a table of lap
 * fractions still derives the water from the road's own offset curve, so every
 * circuit wore a canal down its middle whatever its shape, and painting it away
 * span by span was the only control anyone had. A pond stands where the author
 * put it.
 *
 * Purely visual: no depth band, no slow, no mechanic. A machine drives through
 * one exactly as it drives over lawn. A wading feel band is a recorded v2 if
 * the seat ever asks for one; what it must not be again is a device that
 * contains anyone, because the referee (`../realm_racers_track_limits.ts`) is
 * what decides a cut.
 */
export interface RallyPond {
  /** Circuit-local centre. */
  x: number;
  z: number;
  /** Radii, yards. */
  rx: number;
  rz: number;
  /** Radians. */
  rot?: number;
  /** Fraction of the radius the outline wanders by, 0 to 0.35. */
  wobble?: number;
  /** Hash input for the wobble. */
  seed?: number;
}

/**
 * One ROW of pickup boxes across the road, authored as a lap fraction and
 * nothing else.
 *
 * The record is the ROW because the row is the design: how many boxes it holds,
 * how wide they are spread and where each one lands all follow from the road at
 * that arc, so authoring four points would be authoring four chances to put one
 * of them off the track. `realm_racers_pickups.ts` resolves it, the way
 * `realm_racers_props_resolve.ts` resolves the dressing, and the readout checks
 * that what comes back fits on the road (`pickup_row_off_road`).
 */
export interface RallyPickupRow {
  /** Lap fraction, 0 at the start line. */
  s: number;
}

/**
 * A hand-placed run of barrier modules: a hedge down the outside of a corner, a
 * stone wall closing a courtyard, a line of ironwork between road and lawn.
 *
 * ANGULAR, and that is a decision rather than an omission. Every kit's module is
 * a straight segment, so a smoothed run would be a chain of chords with a wedge
 * of daylight at every joint; the one thing on a circuit that WANTS a curve is
 * the ground's own outline, which is not made of modules.
 *
 * CIRCUIT-LOCAL, unlike a track-space prop: a fence does not follow a later
 * centerline edit. That is the right trade for the shoreline and the boundary
 * work fences exist for, and the wrong one for a hedge hugging a corner exit; if
 * a second consumer ever wants the other frame, this grows the way `RallyPropAt`
 * already did.
 *
 * FURNITURE, never containment. A gap in a fence is a view, never a shortcut:
 * `../realm_racers_track_limits.ts` is the sole authority on track limits, and
 * nothing here has any part in that verdict.
 */
export interface RallyFence {
  /** A key of `REALM_RACERS_BARRIERS`. */
  kit: string;
  /** Circuit-local, in order. Two points is one straight run. */
  points: readonly RallyPoint[];
  /** Joins the last point back to the first. */
  closed?: boolean;
  /** Multiplies the kit's own scale, for the low-wall case. */
  scale?: number;
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
   * The INSTANCE VOLUME, half-extents from the circuit's origin: where the world
   * stops being the world. It is not a wall and it stops nobody. It answers
   * `realmRacersLaneAt`, and that answer is what flattens the ground
   * (`world.ts` `groundHeight`, not `terrainHeight`), switches
   * off the world's colliders and mantling (`colliders.ts`), and picks the sky,
   * the theme's art and the music. The one thing that STOPS a machine is
   * `perimeter`, and the rule that the wall stays strictly inside this box is
   * load-bearing for exactly that reason: the wall is the only thing keeping a
   * pilot on the flat floor.
   *
   * **Every circuit carries the CEILING, and that is not a coincidence to be
   * preserved by hand.** The gap this used to leave to the wall was a constant
   * (the editor's dressing margin), so it carried no design decision, and a
   * per-circuit value bought nothing but a fifth rectangle for an author to
   * understand. The ceiling is safe by construction rather than by luck:
   * `REALM_RACERS_MAX_REGION_HALF_Z` IS `(LANE_DZ - LANE_CLEARANCE) / 2`, so two
   * lanes both at it still keep the designed clear air, and the x ceiling is the
   * instance band's own window, which nothing else lives in.
   * `tests/realm_racers_circuits.test.ts` pins both numbers against the
   * constants; they are literals here only because `realm_racers_layout.ts`
   * imports this module and importing it back would be a cycle.
   */
  regionHalfX: number;
  regionHalfZ: number;
  perimeter: RealmRacersPerimeter;
  /**
   * The water's bank profile, REQUIRED if and only if the circuit authors a
   * `ponds` entry.
   *
   * Optional because the water used to be the mechanic: the only thing keeping
   * a racer out of the infield was how deep it got, so every circuit in every
   * future zone theme was forced to be a lake circuit. The referee does that
   * job now, so a circuit may author no water at all and its infield is dry
   * ground for the dressing to use.
   */
  basin?: RealmRacersBasin;
  /**
   * The hand-placed scenery, in authored order.
   *
   * This is the only placement on a circuit that carries a DESIGN. Everything
   * else the dressing draws is derived (the perimeter ring walks the wall, the
   * flowers grid off the perimeter box, the reeds follow the shore), and a rule
   * tuned on one circuit's shape is a bug on the next one: the one authorable
   * thing there used to be was a single `landmark` point, and the tiered
   * fountain it placed stood in the middle of the Express Tour's road because
   * its position was an offset from the BAND origin.
   */
  props?: readonly RallyProp[];
  /** Seeded fills, applied on top of the props. */
  scatters?: readonly RallyScatter[];
  /** Decorative water, placed. */
  ponds?: readonly RallyPond[];
  /**
   * The hand-placed barriers. Solid, always: a fence exists to be in the way.
   *
   * They are what a circuit's visible boundary is MADE of, now that the
   * perimeter box is collision only and draws nothing. A circuit that authors
   * none simply has no visible edge, which is a shape the tool has to be able to
   * reach while one is being drawn.
   */
  fences?: readonly RallyFence[];
  /**
   * The shape of the LAND itself: control points of a closed, SMOOTHED curve
   * (the same centripetal Catmull-Rom the centerline is read as), circuit-local.
   *
   * Absent means the rectangle the ground has always been, `regionHalf*` plus
   * `REALM_RACERS_LAWN_OVERSHOOT`, so a circuit that authors none is drawn
   * exactly as it was before the field existed. Outside the shape is the theme's
   * water, which is decoration: nothing here stops a machine, and the perimeter
   * box goes on being the one thing that does.
   *
   * SMOOTHED, unlike a `fences` run, and the two are separate records for that
   * reason: a shore is a curve and a barrier is made of straight modules, so the
   * one shape a kit cannot follow is exactly the one the land wants. Both "an
   * island with no fence on it" and "a fence out in the middle of the lawn" are
   * shapes an author may want.
   */
  groundOutline?: readonly RallyPoint[];
  /**
   * Where the pickup boxes stand, one entry per ROW across the road. A circuit
   * with none authored simply has no boxes on it.
   */
  pickupRows?: readonly RallyPickupRow[];
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
  /**
   * The art this circuit wears: ground tints, kerbs, the perimeter kit, the
   * dressing ring, the flowers, the water and the sky.
   *
   * A PLAIN STRING for the same reason `musicTrack` is one: the registry that
   * resolves it is `src/render/realm_racers_themes.ts`, and `src/sim/` may not
   * import from `src/render/` at all. `REALM_RACERS_THEME_IDS` below is the
   * language-agnostic list the editor's picker and the metrics readout resolve
   * against, and the render registry is pinned against it both ways.
   *
   * A theme is VISUALS ONLY. Nothing a racer feels comes from it: the off-track
   * bands, the referee and every handling number stay on this record and the
   * shared constants.
   */
  theme: string;
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
   * What bounds the widths is the OUTSIDE, not the water: the garden between
   * the road and the perimeter wall is what makes running wide legible, and the
   * pools are placed well clear of both.
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
  // The ceiling, like every circuit: see the field's own comment.
  regionHalfX: 300,
  regionHalfZ: 150,
  perimeter: { halfX: 118, halfZ: 92, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6 },
  /**
   * The infield lake, now that it is PLACED: two pools with the fountain's lawn
   * between them, instead of the one ring of water the shore line derived.
   *
   * The identity is the same (this circuit has always been a lake circuit) and
   * the shape is the part that changed: a derived ring was as wide as the road's
   * own offset curve happened to be at every point of the lap, so it was a moat,
   * and the fountain stood on an island in it because nothing else could be
   * standing there. Two pools leave a lawn down the middle for the fountain and
   * for whatever the dressing puts beside it.
   *
   * The radii are measured, not eyed: each pool sits at the centre of the
   * largest circle that fits inside the infield's racing-surface ring, and its
   * biggest wobbled radius (`r * (1 + wobble)`) stays a few yards inside that
   * circle. `pond_on_racing_surface` is the check that says so.
   */
  ponds: [
    { x: -34, z: -3, rx: 18, rz: 18, wobble: 0.16, seed: 41 },
    { x: 32, z: -3, rx: 19, rz: 17, wobble: 0.14, seed: 42 },
  ],
  /**
   * The tiered fountain on its lawn, out in the middle where this circuit's own
   * infield has always put it. It was the `landmark` field, the one authorable
   * placement a circuit had; the point and the scale are the same numbers that
   * field and the painter carried between them, so the fountain has not moved.
   * What moved is the WATER: it used to be standing in it, and the two pools
   * above are placed to leave it the strip of lawn it sits on.
   *
   * `collide: 'none'` preserves what it has always been: nothing on this
   * circuit stopped a racer except the perimeter, and a fountain that starts
   * blocking machines is a sim behavior change, not a migration. Whether the
   * catalog's own solid default should apply here is a seat call for a later
   * pass, and it is one line when it is taken.
   */
  props: [{ asset: 'fountain', at: { x: -4, z: 4 }, scale: 2.2, collide: 'none' }],
  /**
   * Three rows over a 455 yard lap, one for each part of the circuit a pilot
   * arrives at with a decision already made: the end of the start straight
   * before the fast sweeper, the middle of the north straight, and the entry to
   * the parabolic. All three sit on road wide enough to take the whole row with
   * a clear strip either side, none of them is on the start line, and the
   * spacing means a lap always offers a refill without a lap ever being a
   * shopping trip.
   */
  pickupRows: [{ s: 0.19 }, { s: 0.44 }, { s: 0.7 }],
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
  theme: 'evergarden',
  roles: ['practice'],
  practiceCopies: 6,
};

/**
 * The Evergarden Express Tour: the first COMPETITION circuit, and the first
 * drawn in the circuit editor rather than typed by hand.
 *
 * Measured through the shared spline: an 829 yard lap over 829 samples, turning
 * +360 degrees (so it closes without crossing itself), winding counter-clockwise
 * (so the infield is on the left normal, which is the side the dressing and the
 * pools are measured against), and a tightest corner of 13.3 yards.
 *
 * The pinch is the circuit's one real FEATURE: its two long stretches run 51
 * yards apart, dead head on (tangent dot -1.0), for 42 yards of lap, which is
 * inside a Ground Blast's cone-limited reach, so a pilot can see (and shell) a
 * rival across it. The corridor is open lawn: the water is two placed pools
 * well clear of it, where it used to be a ribbon the record had to paint away
 * span by span to keep the strip from being a canal. Nothing closes the strip
 * physically: a machine that drives across it is a cut, and the referee in
 * `realm_racers_track_limits.ts` is what returns it.
 *
 * It carried 54 rows of `apronBands` until the apron itself was deleted. They
 * held a second offset curve off the road, out to the water, and every one of
 * them existed to stop that curve reaching across this strip from both sides.
 * With the water placed and the referee deciding cuts, nothing read the apron
 * but the envelope that keeps the dressing off the track, and that envelope is
 * the garden edge.
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
  regionHalfX: 300,
  regionHalfZ: 150,
  perimeter: { halfX: 299, halfZ: 149, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6 },
  ponds: [
    { x: 21, z: 46, rx: 15.5, rz: 14.5, wobble: 0.16, seed: 11 },
    { x: -147, z: -17, rx: 13, rz: 12, wobble: 0.15, seed: 12 },
  ],
  props: [
    { asset: 'fountain', at: { x: 21.6, z: 45.5 } },
    {
      asset: 'leafyFoxStatue',
      at: { s: 0.0565, offset: 18.7 },
      yaw: 4.5,
      scale: 7,
      collide: 'none',
    },
    { asset: 'leafyFoxStatue', at: { x: 28, z: -95.5 }, yaw: 4.71, scale: 7, collide: 'none' },
    { asset: 'shrub', at: { x: -81.5, z: -82.1 }, scale: 3.83 },
    { asset: 'gardenArch', at: { x: -52.1, z: -21.6 }, yaw: 4.45, scale: 8, collide: 'none' },
    { asset: 'lilyRaft', at: { x: -145.8, z: -9.3 }, scale: 4 },
    { asset: 'lilyRaft', at: { x: -153.9, z: -19.4 }, scale: 4 },
    { asset: 'lilyRaft', at: { x: -141.4, z: -23.3 }, scale: 4 },
    { asset: 'reeds', at: { x: -136.2, z: -14.2 }, scale: 4 },
    { asset: 'reeds', at: { x: -135.8, z: -21.6 }, scale: 4 },
    { asset: 'reeds', at: { x: -141.2, z: -29 }, scale: 4 },
    { asset: 'reeds', at: { x: -151.7, z: -28.1 }, scale: 4 },
    { asset: 'reeds', at: { x: -139.3, z: -6.9 }, scale: 4 },
    { asset: 'reeds', at: { x: -152.2, z: -6.1 }, scale: 4 },
    { asset: 'reeds', at: { x: -158.8, z: -13.5 }, scale: 4 },
    { asset: 'reeds', at: { x: -158.4, z: -22.7 }, scale: 4 },
    { asset: 'fountain', at: { x: -145.5, z: -17.1 } },
    { asset: 'gardenArch', at: { x: 43.7, z: 77.6 }, yaw: 5.5, scale: 8, collide: 'none' },
    { asset: 'oak', at: { x: -85.9, z: -49.7 }, scale: 2 },
    { asset: 'oak', at: { x: -0.4, z: -48.5 }, scale: 2 },
    { asset: 'oak', at: { x: 10.1, z: -23.6 }, scale: 1.3 },
    { asset: 'oak', at: { x: 41.5, z: -112.1 }, scale: 4 },
    { asset: 'oak', at: { x: -133.3, z: -114.1 }, scale: 1.8 },
    { asset: 'oak', at: { x: -214.7, z: -63.3 }, scale: 2.6 },
    { asset: 'oak', at: { x: -198.3, z: 53.4 }, scale: 3 },
    { asset: 'oak', at: { x: -69.5, z: 31.8 }, scale: 3 },
    { asset: 'oak', at: { x: 52.7, z: 124.5 }, scale: 5 },
    { asset: 'oak', at: { x: 115.6, z: 55.2 }, scale: 3.4 },
    { asset: 'oak', at: { x: 110, z: -31.8 }, scale: 2 },
    { asset: 'bench', at: { s: 0.2087, offset: 17.4 }, yaw: 5.5, scale: 3.5 },
    { asset: 'bedSquareA', at: { x: 30.2, z: -36.1 }, scale: 15.98 },
    { asset: 'hexTower', at: { x: -108.6, z: -27.5 }, scale: 10 },
  ],
  fences: [
    {
      kit: 'hedge',
      points: [
        { x: -38.4, z: -56.8 },
        { x: -40, z: -50.2 },
        { x: -33.5, z: -48.8 },
        { x: -30.8, z: -59.7 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -46, z: -50.7 },
        { x: -42.7, z: -62.8 },
        { x: -24.3, z: -58.7 },
        { x: -27, z: -46.6 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -68.4, z: -49.8 },
        { x: -21.6, z: -40.3 },
        { x: -16.9, z: -62.9 },
        { x: -28.2, z: -65.6 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -34.9, z: -66.6 },
        { x: -61.9, z: -72.8 },
        { x: -68.4, z: -49.9 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -43, z: -62.9 },
        { x: -58.2, z: -66.1 },
        { x: -59.6, z: -61.1 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -60.4, z: -57.2 },
        { x: -62.9, z: -48.9 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -57.2, z: -51.9 },
        { x: -53.4, z: -65 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -49.3, z: -60 },
        { x: -52.8, z: -46.8 },
      ],
    },
    {
      kit: 'hedge',
      points: [
        { x: -33.5, z: -48.7 },
        { x: -34.8, z: -43.1 },
      ],
    },
  ],
  pickupRows: [{ s: 0.42 }],
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 3,
  timeLimitSeconds: 180,
  musicTrack: 'realm_racers',
  theme: 'evergarden',
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

/**
 * The record for an id, or undefined for an id no longer authored (a match
 * restored from an older shape, which the caller falls back on).
 *
 * The DRAFT overlay is consulted after the authored table and never before it:
 * a dev session registering a draft can add circuits the game can race, but it
 * can never shadow one the game ships. The overlay is empty unless a dev
 * command filled it (`realm_racers_drafts.ts`), so every other host resolves
 * exactly the authored table.
 */
export function realmRacersCircuitById(id: string): RealmRacersCircuit | undefined {
  return REALM_RACERS_CIRCUITS[id] ?? realmRacersDraftCircuit(id);
}
