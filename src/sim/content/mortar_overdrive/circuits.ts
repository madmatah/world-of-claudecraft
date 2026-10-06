// The Mortar Overdrive circuits, AUTHORED data only: one record per circuit, each
// holding the hand tuned numbers a designer edits (control points, width bands,
// the start grid, the perimeter, the water, the race length).
//
// Everything geometric that FOLLOWS from these numbers (the resampled
// centerline, arc lengths, the projection, the recovery anchors, the start
// slots, the lateral boundaries) is derived per circuit in
// `../../mortar_overdrive/spline.ts`, and the collision set in
// `../../mortar_overdrive/colliders.ts`. What stays in
// `../../mortar_overdrive/layout.ts` is what every circuit SHARES: the margins, the
// grid size, the gate-crossing math and the lane table.
//
// Coordinates are LOCAL to `MORTAR_OVERDRIVE_ORIGIN`, which sits in the reserved
// instance band between the Yumi maze and dungeon overflow, so a circuit cannot
// collide with overworld content or another activity.

import { mortarOverdriveDraftCircuit } from '../../mortar_overdrive/draft_registry';
import type { MortarOverdrivePoint } from '../../mortar_overdrive/layout';

/**
 * What a circuit is used for. A circuit may serve BOTH while the pool is being
 * built out: the garden circuit is the practice home and, until a competition
 * circuit is authored, the one circuit queued races run on too.
 */
export type MortarOverdriveCircuitRole = 'practice' | 'competition';

/**
 * Every theme a circuit may name, and the one a record falls back on.
 *
 * Pure data, no logic, and deliberately sim-side: the circuit editor offers this
 * list as a picker and the metrics readout flags an id that is not in it
 * (`unknown_theme`), neither of which may import render code. The records the
 * ids resolve to live in `src/render/mortar_overdrive/themes.ts`, and
 * `tests/mortar_overdrive_themes.test.ts` pins the two against each other BOTH
 * ways, so an id here with no record (or a record with no id) fails.
 *
 * ONE ID PER WORLD-MAP ZONE, in the order `data.ts` lists the zones: a circuit
 * drawn anywhere wears the art of the realm it is meant to be in, and adding a
 * realm's circuit is adding a `theme:` string to its record rather than a
 * render change. The ids are the ZONE ids with their articles dropped
 * (`veiled_hollow` for `veiled_hollow`, `eastbrook` for `eastbrook_vale`,
 * `mirefen` for `mirefen_marsh`, `thornpeak` for `thornpeak_heights`,
 * `farshore` for `farshore_isle`); `tests/mortar_overdrive_themes.test.ts` pins the
 * mapping against the zone table so a fifteenth realm cannot ship without one.
 */
export const MORTAR_OVERDRIVE_THEME_IDS: readonly string[] = [
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
export const MORTAR_OVERDRIVE_DEFAULT_THEME_ID = 'evergarden';

/**
 * Every hour of the day a circuit may be raced at, in clock order from dawn.
 *
 * Sim-side and pure data for the same reason `MORTAR_OVERDRIVE_THEME_IDS` is: the
 * editor offers this list as a picker and the metrics readout flags an id that
 * is not in it (`unknown_time_of_day`), and neither may import render code. The
 * PHASES the ids resolve to live in `src/render/mortar_overdrive/daylight_core.ts`,
 * pinned against this list both ways by `tests/mortar_overdrive_daylight.test.ts`.
 *
 * NAMED rather than a raw cycle phase, and that is the whole authoring decision:
 * a record reading `timeOfDay: 'dusk'` says what it is, a record reading `0.78`
 * needs the reader to know the cycle's parameterization, and a picker over seven
 * names is a control an author can use without a preview. The set is the moments
 * a race is worth staging at rather than an even sampling of the clock: three
 * daylight hours that differ in shadow direction, the two horizon crossings that
 * are the whole reason to light a race at all, and two nights.
 */
export const MORTAR_OVERDRIVE_TIME_OF_DAY_IDS: readonly string[] = [
  'dawn',
  'morning',
  'noon',
  'afternoon',
  'dusk',
  'night',
  'midnight',
];

/** The water's bank, read by BOTH the renderer (per-vertex shore depth,
 *  which drives the colour ramp and the foam band) and the sim (how deep a
 *  racer is standing). Two profiles would mean a racer swimming where the water
 *  is drawn ankle deep. */
export interface MortarOverdriveBasin {
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
 *  envelope so collision still belongs to the race at the wall. */
export interface MortarOverdrivePerimeter {
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
 * NEVER world coordinates and never anything measured off `MORTAR_OVERDRIVE_ORIGIN`:
 * a placement expressed against the band is a placement that belongs to the
 * band rather than to the circuit, which is exactly how the tiered fountain came
 * to stand in the middle of the Express Tour's road.
 */
export type MortarOverdrivePropAt = { s: number; offset: number } | { x: number; z: number };

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
 * (`../../mortar_overdrive/track_limits.ts`) decides what a cut is, so a gap in the
 * dressing is a view rather than a shortcut and a solid prop is only ever
 * furniture a racer can hit.
 */
export type MortarOverdrivePropCollide =
  | 'default'
  | 'none'
  | { kind: 'circle'; r: number }
  | { kind: 'obb'; hw: number; hd: number; rot: number };

/** One hand-placed piece of scenery. */
export interface MortarOverdriveProp {
  /** Catalog key: `MORTAR_OVERDRIVE_PROPS` sim side, `MORTAR_OVERDRIVE_PROP_VISUALS`
   *  render side. A key neither knows is a metrics error, never a silent skip. */
  asset: string;
  at: MortarOverdrivePropAt;
  /** Radians, or `'tangent'` to face the racing direction where it stands. */
  yaw?: number | 'tangent';
  /** Multiplies the catalog's authored size. Defaults to 1. */
  scale?: number;
  collide?: MortarOverdrivePropCollide;
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
export interface MortarOverdriveScatter {
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
 * contains anyone, because the referee (`../../mortar_overdrive/track_limits.ts`) is
 * what decides a cut.
 */
export interface MortarOverdrivePond {
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
 * of them off the track. `mortar_overdrive/pickups.ts` resolves it, the way
 * `mortar_overdrive/props_resolve.ts` resolves the dressing, and the readout checks
 * that what comes back fits on the road (`pickup_row_off_road`).
 */
export interface MortarOverdrivePickupRow {
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
 * a second consumer ever wants the other frame, this grows the way `MortarOverdrivePropAt`
 * already did.
 *
 * FURNITURE, never containment. A gap in a fence is a view, never a shortcut:
 * `../../mortar_overdrive/track_limits.ts` is the sole authority on track limits, and
 * nothing here has any part in that verdict.
 */
export interface MortarOverdriveFence {
  /** A key of `MORTAR_OVERDRIVE_BARRIERS`. */
  kit: string;
  /** Circuit-local, in order. Two points is one straight run. */
  points: readonly MortarOverdrivePoint[];
  /** Joins the last point back to the first. */
  closed?: boolean;
  /** Multiplies the kit's own scale, for the low-wall case. */
  scale?: number;
}

export interface MortarOverdriveCircuit {
  /** Stable id: the cache key for every derived geometry, the wire token, and
   *  the suffix of this circuit's i18n name and blurb keys. */
  id: string;
  /** Read as a CLOSED centripetal Catmull-Rom loop. */
  controlPoints: readonly MortarOverdrivePoint[];
  /** Road half-width breakpoints as (lap fraction, half-width in yards),
   *  linearly interpolated and wrapped. Never under
   *  `MORTAR_OVERDRIVE_MIN_HALF_WIDTH`. */
  widthBands: readonly { s: number; halfWidth: number }[];
  /**
   * The INSTANCE VOLUME, half-extents from the circuit's origin: where the world
   * stops being the world. It is not a wall and it stops nobody. It answers
   * `mortarOverdriveLaneAt`, and that answer is what flattens the ground
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
   * `MORTAR_OVERDRIVE_MAX_REGION_HALF_Z` IS `(LANE_DZ - LANE_CLEARANCE) / 2`, so two
   * lanes both at it still keep the designed clear air, and the x ceiling is the
   * instance band's own window, which nothing else lives in.
   * `tests/mortar_overdrive_circuits.test.ts` pins both numbers against the
   * constants; they are literals here only because `mortar_overdrive/layout.ts`
   * imports this module and importing it back would be a cycle.
   */
  regionHalfX: number;
  regionHalfZ: number;
  perimeter: MortarOverdrivePerimeter;
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
  basin?: MortarOverdriveBasin;
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
  props?: readonly MortarOverdriveProp[];
  /** Seeded fills, applied on top of the props. */
  scatters?: readonly MortarOverdriveScatter[];
  /** Decorative water, placed. */
  ponds?: readonly MortarOverdrivePond[];
  /**
   * The hand-placed barriers. Solid, always: a fence exists to be in the way.
   *
   * They are what a circuit's visible boundary is MADE of, now that the
   * perimeter box is collision only and draws nothing. A circuit that authors
   * none simply has no visible edge, which is a shape the tool has to be able to
   * reach while one is being drawn.
   */
  fences?: readonly MortarOverdriveFence[];
  /**
   * The shape of the LAND itself: control points of a closed, SMOOTHED curve
   * (the same centripetal Catmull-Rom the centerline is read as), circuit-local.
   *
   * Absent means the rectangle the ground has always been, `regionHalf*` plus
   * `MORTAR_OVERDRIVE_LAWN_OVERSHOOT`, so a circuit that authors none is drawn
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
  groundOutline?: readonly MortarOverdrivePoint[];
  /**
   * Where the pickup boxes stand, one entry per ROW across the road. A circuit
   * with none authored simply has no boxes on it.
   */
  pickupRows?: readonly MortarOverdrivePickupRow[];
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
   * resolves it is `src/render/mortar_overdrive/themes.ts`, and `src/sim/` may not
   * import from `src/render/` at all. `MORTAR_OVERDRIVE_THEME_IDS` below is the
   * language-agnostic list the editor's picker and the metrics readout resolve
   * against, and the render registry is pinned against it both ways.
   *
   * A theme is VISUALS ONLY. Nothing a racer feels comes from it: the off-track
   * bands, the referee and every handling number stay on this record and the
   * shared constants.
   */
  theme: string;
  /**
   * The hour this circuit is always raced at: one of
   * `MORTAR_OVERDRIVE_TIME_OF_DAY_IDS`, resolved to a cycle phase render-side.
   *
   * ABSENT means the world's own clock, which is what every circuit did before
   * this field existed and what keeps the shipped records drawing unchanged.
   *
   * A circuit owns its light for the same reason it owns its sky. The band
   * belongs to no zone, a race is a few minutes long, and the world clock is
   * UTC-anchored: without this, the same circuit is a bright afternoon or a
   * near-black night depending on when the queue popped, a practice lap is lit
   * differently from the race it practises for, and the darkness a pilot has to
   * read the road through is decided by nothing anybody authored.
   *
   * VISUALS ONLY, exactly like `theme`. Nothing a racer feels comes from it: the
   * grip, the referee and every handling number are untouched by the hour, and
   * the sim never reads this at all (the day/night cycle is render-side, so this
   * is a string sim content carries rather than a state sim has).
   */
  timeOfDay?: string;
  /** What this circuit is used for; see `MortarOverdriveCircuitRole`. */
  roles: readonly MortarOverdriveCircuitRole[];
  /**
   * How many PRIVATE copies of this circuit the band holds, beside the public
   * one. A practice lap must never wait on, or be waited on by, someone else's
   * race, so each one runs on its own copy of the whole circuit: the same
   * geometry at its own lane origin.
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
const EVERGARDEN_PRACTICE: MortarOverdriveCircuit = {
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
   * has. `tests/mortar_overdrive_layout.test.ts` re-derives all of it rather than
   * pinning the numbers, so an edit here fails the test instead of quietly
   * parking a machine on the grass.
   */
  startSpacing: 5.0,
  laps: 3,
  practiceLaps: 4,
  timeLimitSeconds: 180,
  musicTrack: 'mortar_overdrive_evergarden',
  theme: 'evergarden',
  /**
   * Noon, because this is where the line is LEARNED. A practice lap is the one
   * session whose light should never be a variable: the same corner at the same
   * brightness every time, with the shortest shadows the cycle draws, so what a
   * pilot reads is the road rather than the hour they happened to queue at.
   */
  timeOfDay: 'noon',
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
 * `mortar_overdrive/track_limits.ts` is what returns it.
 *
 * It carried 54 rows of `apronBands` until the apron itself was deleted. They
 * held a second offset curve off the road, out to the water, and every one of
 * them existed to stop that curve reaching across this strip from both sides.
 * With the water placed and the referee deciding cuts, nothing read the apron
 * but the envelope that keeps the dressing off the track, and that envelope is
 * the garden edge.
 */
const EVERGARDEN_EXPRESS_TOUR: MortarOverdriveCircuit = {
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
    // The verge lights, and they are why this circuit can be raced at sunset.
    // Eighteen of the Evergarden's own flower lamps, one every 46 yards of the
    // 829 yard lap, all on the same side of the road the way a lit road is
    // lit. Each one is a REAL light: the fixture carries an authored socket and
    // the night light field lights the track from it with true direction and
    // falloff (`src/render/mortar_overdrive/lamps.ts`), so the road brightens
    // because something above it is burning.
    //
    // Offset 16 is the nearest whole yard that clears the racing surface all
    // the way round (the widest road here is 10 half-width, plus the verge
    // margin and the run-off, plus the fixture's own measured radius), which is
    // also close enough that a lamp lights the road rather than the lawn. They
    // stand inside the chase camera's reach and the readout says so: a warning
    // is a sentence to the author, and a lamp post is a thin pole rather than
    // the tree canopy that rule was written for.
    { asset: 'lampEvergardenFlower', at: { s: 0.0, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.0556, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.1111, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.1667, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.2222, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.2778, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.3333, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.3889, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.4444, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.5, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.5556, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.6111, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.6667, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.7222, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.7778, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.8333, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.8889, offset: 16 } },
    { asset: 'lampEvergardenFlower', at: { s: 0.9444, offset: 16 } },
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
  musicTrack: 'mortar_overdrive_evergarden',
  theme: 'evergarden',
  /**
   * Sunset, and the race is better for it. The sun sits ON the horizon at this
   * phase, which is where the grade's warm and the longest shadows both are, so
   * the garden reads as an occasion rather than as an afternoon; the lamps
   * along the verge are burning by then, which is what the dressing is FOR; and
   * the light is still half of full daylight, so nothing about the road is
   * harder to read than it was.
   *
   * It is also the field the whole feature exists for. On the world clock this
   * circuit was a bright noon or an unlit midnight depending on when the queue
   * popped, which is not a design anybody chose.
   */
  timeOfDay: 'dusk',
  roles: ['competition'],
  practiceCopies: 0,
};

const NIGHTBLOOM_MOONSPRING_RUN: MortarOverdriveCircuit = {
  id: 'nightbloom_moonwell_run',
  controlPoints: [
    { x: -55, z: -97 },
    { x: 10, z: -98 },
    { x: 70, z: -95 },
    { x: 118, z: -82 },
    { x: 152, z: -50 },
    { x: 166, z: -10 },
    { x: 164, z: 28 },
    { x: 150, z: 64 },
    { x: 118, z: 92 },
    { x: 78, z: 104 },
    { x: 36, z: 97 },
    { x: -2, z: 110 },
    { x: -44, z: 99 },
    { x: -84, z: 107 },
    { x: -116, z: 90 },
    { x: -130, z: 56 },
    { x: -130, z: 15 },
    { x: -133, z: -14 },
    { x: -146, z: -36 },
    { x: -172, z: -46 },
    { x: -196, z: -48 },
    { x: -214, z: -55 },
    { x: -221, z: -72 },
    { x: -214, z: -89 },
    { x: -195, z: -98 },
    { x: -160, z: -99 },
    { x: -110, z: -98 },
  ],
  widthBands: [
    { s: 0, halfWidth: 10 },
    { s: 0.09, halfWidth: 10 },
    { s: 0.13, halfWidth: 9.5 },
    { s: 0.28, halfWidth: 9.5 },
    { s: 0.32, halfWidth: 9 },
    { s: 0.4, halfWidth: 9 },
    { s: 0.44, halfWidth: 8.5 },
    { s: 0.57, halfWidth: 8.5 },
    { s: 0.6, halfWidth: 9 },
    { s: 0.69, halfWidth: 9 },
    { s: 0.72, halfWidth: 8.5 },
    { s: 0.79, halfWidth: 8 },
    { s: 0.86, halfWidth: 8 },
    { s: 0.9, halfWidth: 10 },
    { s: 1, halfWidth: 10 },
  ],
  regionHalfX: 300,
  regionHalfZ: 150,
  perimeter: { halfX: 299, halfZ: 149, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.8, depthMax: 6 },
  ponds: [{ x: -262, z: -72, rx: 20, rz: 24, wobble: 0.12, seed: 23 }],
  props: [
    { asset: 'lampNightbloomMoonflower', at: { s: 0.885, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.925, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.965, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.005, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.045, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.085, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.885, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.925, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.965, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.005, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.045, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.085, offset: 16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.125, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.165, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.205, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.245, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.285, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.325, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.365, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.405, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.445, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.485, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.525, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.565, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.605, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.645, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.685, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.725, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.765, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.8, offset: -16 } },
    { asset: 'lampNightbloomMoonflower', at: { s: 0.865, offset: -16 } },
    { asset: 'glowCluster', at: { s: 0.15, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.2, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.25, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.34, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.38, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 3.2, z: 69.8 }, scale: 15.5 },
    { asset: 'glowCluster', at: { s: 0.55, offset: 20 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.6, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.64, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.76, offset: -21 }, scale: 2.5 },
    { asset: 'glowCluster', at: { s: 0.82, offset: -21 }, scale: 2.5 },
    { asset: 'kmedTavern', at: { x: -120, z: -128 }, yaw: 0, scale: 8 },
    { asset: 'kmedHomeA', at: { x: -158, z: -126 }, yaw: 0.3, scale: 8 },
    { asset: 'kmedHomeB', at: { x: -90, z: -130 }, yaw: -0.2, scale: 8 },
    { asset: 'kmedChurch', at: { x: -40, z: -131 }, yaw: 0, scale: 9.5 },
    { asset: 'kmedHomeA', at: { x: 0, z: -127 }, yaw: 2.9, scale: 7.5 },
    { asset: 'kmedHomeB', at: { x: 35, z: -129 }, yaw: 0.4, scale: 8 },
    { asset: 'postLantern', at: { x: -140, z: -117 }, scale: 2.5 },
    { asset: 'postLantern', at: { x: -105, z: -117 }, scale: 2.5 },
    { asset: 'postLantern', at: { x: -65, z: -117 }, scale: 2.5 },
    { asset: 'postLantern', at: { x: -20, z: -117 }, scale: 2.5 },
    { asset: 'postLantern', at: { x: 18, z: -117 }, scale: 2.5 },
    { asset: 'bench', at: { x: -130, z: -118 }, yaw: 0, scale: 3.5 },
    { asset: 'bench', at: { x: 10, z: -118 }, yaw: 0, scale: 3.5 },
    { asset: 'banner', at: { x: -112, z: -119 }, scale: 4 },
    { asset: 'banner', at: { x: -128, z: -119 }, scale: 4 },
    { asset: 'giantMushroom', at: { s: 0.12, offset: -23 }, yaw: 0.6, scale: 9 },
    { asset: 'giantMushroom', at: { s: 0.12, offset: 23 }, yaw: 2.4, scale: 9 },
    { asset: 'giantMushroom', at: { x: 150, z: -115 }, yaw: 1.1, scale: 8 },
    { asset: 'giantMushroom', at: { x: 190, z: -100 }, yaw: 2.8, scale: 10 },
    { asset: 'giantMushroom', at: { x: 205, z: -60 }, yaw: 0.2, scale: 7 },
    { asset: 'giantMushroom', at: { x: 175, z: -125 }, yaw: 4.1, scale: 6 },
    { asset: 'giantMushroom', at: { x: 215, z: -20 }, yaw: 3.3, scale: 9 },
    { asset: 'glowCluster', at: { x: 165, z: -110 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 200, z: -80 }, scale: 2.5 },
    { asset: 'amethyst', at: { x: 140, z: -125 }, yaw: 0.7, scale: 1 },
    { asset: 'amethyst', at: { x: 185, z: -70 }, yaw: 2.3, scale: 1.2 },
    { asset: 'amethyst', at: { x: 210, z: -40 }, yaw: -1.1, scale: 0.8 },
    { asset: 'amethyst', at: { x: 195, z: -125 }, yaw: 3, scale: 1.4 },
    { asset: 'amethyst', at: { x: 200, z: 5 }, yaw: 1.2, scale: 1.3 },
    { asset: 'amethyst', at: { x: 215, z: 25 }, yaw: -0.6, scale: 0.9 },
    { asset: 'amethyst', at: { x: 222, z: -5 }, yaw: 2, scale: 1.1 },
    { asset: 'amethyst', at: { x: 198, z: 35 }, yaw: 0.3, scale: 0.7 },
    { asset: 'crystalMoundCave', at: { x: 188, z: 80 }, yaw: 3.6, scale: 1.2 },
    { asset: 'graveCross', at: { x: 172, z: 68 }, yaw: 0.3, scale: 3 },
    { asset: 'graveBevel', at: { x: 178, z: 95 }, yaw: -0.5, scale: 3 },
    { asset: 'graveRound', at: { x: 200, z: 62 }, yaw: 0.9, scale: 3 },
    { asset: 'graveDecor', at: { x: 165, z: 82 }, yaw: -0.4, scale: 3 },
    { asset: 'graveCross', at: { x: 205, z: 102 }, yaw: 0.1, scale: 3 },
    { asset: 'amethyst', at: { x: 210, z: 80 }, yaw: 1.7, scale: 1 },
    { asset: 'amethyst', at: { x: 176, z: 108 }, yaw: -2.2, scale: 0.8 },
    { asset: 'giantMushroom', at: { x: 215, z: 105 }, yaw: 0.9, scale: 7 },
    { asset: 'giantMushroom', at: { x: 135, z: 120 }, yaw: 2.1, scale: 6 },
    { asset: 'pixieMushroomHouse', at: { x: 40, z: 128 }, yaw: -1.2, scale: 1.3 },
    { asset: 'pixieMushroomHouse', at: { x: -25, z: 132 }, yaw: 0.6, scale: 1.1 },
    { asset: 'pixieMushroomHouse', at: { x: -70, z: 128 }, yaw: 2.5, scale: 1.2 },
    { asset: 'giantMushroom', at: { x: 10, z: 135 }, yaw: 1.5, scale: 8 },
    { asset: 'giantMushroom', at: { x: -45, z: 137 }, yaw: 3.9, scale: 9 },
    { asset: 'giantMushroom', at: { x: 75, z: 130 }, yaw: 0.4, scale: 6 },
    { asset: 'giantMushroom', at: { x: -100, z: 135 }, yaw: 2.7, scale: 7 },
    { asset: 'glowCluster', at: { x: 25, z: 122 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: -8, z: 124 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: -90, z: 124 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 60, z: 120 }, scale: 2.5 },
    { asset: 'amethyst', at: { x: -60, z: 138 }, yaw: 1.4, scale: 1 },
    { asset: 'giantMushroom', at: { x: 30, z: 72 }, yaw: 0.8, scale: 7 },
    { asset: 'giantMushroom', at: { x: -30, z: 76 }, yaw: 2.2, scale: 8 },
    { asset: 'giantMushroom', at: { x: -70, z: 70 }, yaw: 4.4, scale: 6 },
    { asset: 'glowCluster', at: { x: 0, z: 80 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 60, z: 78 }, scale: 2.5 },
    { asset: 'amethyst', at: { x: -50, z: 80 }, yaw: 0.5, scale: 0.9 },
    { asset: 'kkPillar', at: { x: -181, z: 42 }, yaw: 0, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -184.5, z: 51.6 }, yaw: 0.7, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -193.4, z: 56.8 }, yaw: 1.4, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -203.5, z: 55 }, yaw: 2.1, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -210.1, z: 47.1 }, yaw: 2.8, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -210.1, z: 36.9 }, yaw: 3.5, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -203.5, z: 29 }, yaw: 4.2, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -193.4, z: 27.2 }, yaw: 4.9, scale: 2.6 },
    { asset: 'kkPillar', at: { x: -184.5, z: 32.4 }, yaw: 5.6, scale: 2.6 },
    { asset: 'starHeartCrystal', at: { x: -116.5, z: -62 }, yaw: 6.02, scale: 3.08 },
    { asset: 'amethyst', at: { x: -215, z: 70 }, yaw: 0.2, scale: 1 },
    { asset: 'amethyst', at: { x: -170, z: 20 }, yaw: 2.6, scale: 0.8 },
    { asset: 'glowCluster', at: { x: -180, z: 60 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: -212, z: 20 }, scale: 2.5 },
    { asset: 'giantMushroom', at: { x: -235, z: 60 }, yaw: 1.9, scale: 8 },
    { asset: 'giantMushroom', at: { x: -150, z: 125 }, yaw: 0.3, scale: 7 },
    { asset: 'giantMushroom', at: { x: -190, z: 100 }, yaw: 3.1, scale: 9 },
    { asset: 'giantMushroom', at: { x: -230, z: 10 }, yaw: 5, scale: 6 },
    { asset: 'giantMushroom', at: { x: -125, z: 130 }, yaw: 1.2, scale: 6 },
    { asset: 'reeds', at: { x: -284, z: -60 }, scale: 3 },
    { asset: 'reeds', at: { x: -280, z: -88 }, scale: 3 },
    { asset: 'reeds', at: { x: -262, z: -100 }, scale: 3 },
    { asset: 'reeds', at: { x: -246, z: -95 }, scale: 3 },
    { asset: 'reeds', at: { x: -243, z: -52 }, scale: 3 },
    { asset: 'reeds', at: { x: -260, z: -44 }, scale: 3 },
    { asset: 'reeds', at: { x: -284, z: -78 }, scale: 3 },
    { asset: 'reeds', at: { x: -252, z: -101 }, scale: 3 },
    { asset: 'lilyRaft', at: { x: -262, z: -70 }, scale: 3 },
    { asset: 'lilyRaft', at: { x: -270, z: -82 }, scale: 3 },
    { asset: 'lilyRaft', at: { x: -252, z: -60 }, scale: 3 },
    { asset: 'lilyRaft', at: { x: -268, z: -58 }, scale: 3 },
    { asset: 'lampNightbloomMoonflower', at: { x: -238, z: -108 } },
    { asset: 'bench', at: { x: -232, z: -113 }, yaw: 0.8, scale: 3.5 },
    { asset: 'amethyst', at: { x: -285, z: -45 }, yaw: 1, scale: 1.2 },
    { asset: 'amethyst', at: { x: -240, z: -40 }, yaw: -0.8, scale: 0.9 },
    { asset: 'giantMushroom', at: { x: -275, z: -115 }, yaw: 2, scale: 8 },
    { asset: 'giantMushroom', at: { x: -282, z: -20 }, yaw: 0.5, scale: 7 },
    { asset: 'giantMushroom', at: { x: 60, z: 20 }, yaw: 0.3, scale: 8 },
    { asset: 'giantMushroom', at: { x: 110, z: 40 }, yaw: 1.7, scale: 6 },
    { asset: 'giantMushroom', at: { x: 20, z: 50 }, yaw: 2.9, scale: 9 },
    { asset: 'giantMushroom', at: { x: -40, z: 30 }, yaw: 4, scale: 7 },
    { asset: 'giantMushroom', at: { x: -87.4, z: 66.5 }, yaw: 0.9, scale: 6 },
    { asset: 'giantMushroom', at: { x: 100, z: -25 }, yaw: 2.4, scale: 8 },
    { asset: 'giantMushroom', at: { x: 30, z: -30 }, yaw: 3.6, scale: 7 },
    { asset: 'giantMushroom', at: { x: -60, z: -10 }, yaw: 1.3, scale: 9 },
    { asset: 'amethyst', at: { x: 80, z: -5 }, yaw: 0.6, scale: 1.3 },
    { asset: 'amethyst', at: { x: -10, z: 15 }, yaw: 2.1, scale: 1 },
    { asset: 'amethyst', at: { x: -96.5, z: 13.7 }, yaw: 3.3, scale: 1.1 },
    { asset: 'amethyst', at: { x: 130, z: 10 }, yaw: 1.5, scale: 0.8 },
    { asset: 'glowCluster', at: { x: 40, z: 5 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: -20, z: 45 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 90, z: 60 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: -95, z: -20 }, scale: 2.5 },
    { asset: 'glowCluster', at: { x: 173.8, z: -96.1 }, yaw: 4.45, scale: 30 },
    { asset: 'glowCluster', at: { x: 131, z: 27.3 }, scale: 15 },
    { asset: 'glowFlower', at: { x: -6.4, z: 82.5 } },
  ],
  scatters: [
    { asset: 'glowFlower', zone: 'infield', spacing: 12, seed: 5 },
    { asset: 'glowFlower', zone: 'outfield', span: { s0: 0.36, s1: 0.62 }, spacing: 11, seed: 6 },
    { asset: 'glowFlower', zone: 'outfield', span: { s0: 0.16, s1: 0.3 }, spacing: 12, seed: 12 },
    { asset: 'mushroomTan', zone: 'infield', spacing: 11, seed: 7 },
    { asset: 'mushroomRed', zone: 'outfield', spacing: 14, seed: 8 },
    { asset: 'glowCluster', zone: 'infield', spacing: 18, seed: 9 },
  ],
  fences: [
    {
      kit: 'woodPaling',
      points: [
        { x: -294.1, z: -141.9 },
        { x: 296.4, z: -141.9 },
        { x: 297.2, z: 141.8 },
        { x: -295.6, z: 141.8 },
      ],
      closed: true,
    },
  ],
  pickupRows: [{ s: 0.6692 }],
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 3,
  timeLimitSeconds: 180,
  musicTrack: 'mortar_overdrive_nightbloom',
  theme: 'nightbloom',
  timeOfDay: 'night',
  roles: ['competition'],
  practiceCopies: 0,
};

/**
 * The Drakelands Rampart Run: past Wyrmwatch to the forge, up Cannon Row, round
 * the Den hairpin and its lava field under the dragon, back down the Rampart
 * between the fortress towers and through the gatehouse, then down the Keep road
 * through the Last Keep.
 *
 * The Keep road runs on a diagonal rather than round a north-west corner, and
 * that is the track-limits decision in the shape: a square corner there left a
 * straight line across the infield that beat the road by almost two seconds
 * while driving more ground than it gained, which the referee cannot see.
 *
 * The Rampart runs head on against the Smithy straight across the lava, inside
 * Ground Blast reach, and the one pickup row stands on the Smithy straight so a
 * pilot arms up just before it. One row because the lap-time gate holds every
 * competition race to the same length, so this lap is the same size in time as
 * the other two and one row is the pool's cadence.
 *
 * Raced in the afternoon, the hour the ember storm dome reads best: the sun is
 * high enough to light the storm and throw the towers' shadows across the road.
 */
const DRAKELANDS_RAMPART_RUN: MortarOverdriveCircuit = {
  id: 'drakelands_rampart_run',
  controlPoints: [
    { x: -110, z: -105 },
    { x: -68.8, z: -105 },
    { x: -27.5, z: -105 },
    { x: 13.8, z: -105 },
    { x: 55, z: -105 },
    { x: 68.3, z: -101.9 },
    { x: 78.8, z: -93.3 },
    { x: 84.4, z: -80.9 },
    { x: 84, z: -67.2 },
    { x: 73, z: -26.2 },
    { x: 62, z: 14.9 },
    { x: 61.5, z: 28.5 },
    { x: 67.2, z: 40.9 },
    { x: 77.7, z: 49.5 },
    { x: 91, z: 52.6 },
    { x: 121, z: 52.6 },
    { x: 151, z: 52.6 },
    { x: 163.5, z: 56 },
    { x: 172.6, z: 65.1 },
    { x: 176, z: 77.6 },
    { x: 172.6, z: 90.1 },
    { x: 163.5, z: 99.3 },
    { x: 151, z: 102.6 },
    { x: 119.1, z: 102.6 },
    { x: 87.2, z: 102.6 },
    { x: 76.3, z: 103.5 },
    { x: 65.6, z: 106.1 },
    { x: 51.3, z: 109.1 },
    { x: 36.7, z: 109.1 },
    { x: 22.3, z: 106.1 },
    { x: 11.7, z: 103.5 },
    { x: 0.7, z: 102.6 },
    { x: -9.3, z: 102.6 },
    { x: -22.3, z: 101.7 },
    { x: -35.1, z: 98.9 },
    { x: -47.3, z: 94.2 },
    { x: -58.7, z: 87.8 },
    { x: -69.1, z: 79.9 },
    { x: -78.2, z: 70.5 },
    { x: -100.3, z: 44.2 },
    { x: -122.4, z: 17.9 },
    { x: -144.5, z: -8.5 },
    { x: -152.9, z: -21.1 },
    { x: -158.5, z: -35.3 },
    { x: -163.6, z: -54.6 },
    { x: -164.8, z: -69.2 },
    { x: -160.6, z: -83.2 },
    { x: -151.8, z: -94.7 },
    { x: -139.3, z: -102.3 },
    { x: -125, z: -105 },
  ],
  widthBands: [
    { s: 0, halfWidth: 10 },
    { s: 0.14, halfWidth: 10 },
    { s: 0.17, halfWidth: 9.5 },
    { s: 0.22, halfWidth: 9.5 },
    { s: 0.24, halfWidth: 9 },
    { s: 0.36, halfWidth: 9 },
    { s: 0.38, halfWidth: 9.5 },
    { s: 0.41, halfWidth: 9.5 },
    { s: 0.43, halfWidth: 9 },
    { s: 0.5, halfWidth: 9 },
    { s: 0.52, halfWidth: 10 },
    { s: 0.68, halfWidth: 10 },
    { s: 0.7, halfWidth: 9.5 },
    { s: 0.75, halfWidth: 9.5 },
    { s: 0.77, halfWidth: 9 },
    { s: 0.9, halfWidth: 9 },
    { s: 0.92, halfWidth: 9.5 },
    { s: 0.97, halfWidth: 9.5 },
    { s: 0.99, halfWidth: 10 },
    { s: 1, halfWidth: 10 },
  ],
  regionHalfX: 300,
  regionHalfZ: 150,
  perimeter: { halfX: 299, halfZ: 149, halfThickness: 0.4, height: 2.2 },
  props: [
    { asset: 'lampDrakelandsBrazier', at: { s: 0.99, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.99, offset: -16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.02, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.02, offset: -16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.05, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.05, offset: -16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.08, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.08, offset: -16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.11, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.11, offset: -16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.14, offset: 16 } },
    { asset: 'lampDrakelandsBrazier', at: { s: 0.14, offset: -16 } },
    { asset: 'dkBuilding1', at: { x: -205, z: -132 }, yaw: 0, scale: 11 },
    { asset: 'dkStables', at: { x: -168, z: -134 }, yaw: 0, scale: 9 },
    { asset: 'dkBuilding2', at: { x: -128, z: -133 }, yaw: 0, scale: 10 },
    { asset: 'dkBuildingBaseRoof', at: { x: -88, z: -133 }, yaw: 0, scale: 11 },
    { asset: 'dkBuilding1', at: { x: -46, z: -132 }, yaw: 0, scale: 11 },
    { asset: 'dkBuildingBase', at: { x: -8, z: -134 }, yaw: 0, scale: 9 },
    { asset: 'dkBuilding2', at: { x: 30, z: -133 }, yaw: 0, scale: 10 },
    { asset: 'hexrBlacksmith', at: { x: 108, z: -122 }, yaw: 2.4, scale: 7 },
    { asset: 'hexCannonballs', at: { x: 96, z: -128 }, scale: 3 },
    { asset: 'kcasCratesStacked', at: { x: 122, z: -108 }, yaw: 0.4, scale: 1.5 },
    { asset: 'hexCrateBig', at: { x: 118, z: -131 }, yaw: 0.2, scale: 4 },
    { asset: 'hexSack', at: { x: 92, z: -120 }, scale: 5 },
    { asset: 'bonfire', at: { x: 124, z: -126 }, scale: 5 },
    { asset: 'hexCannon', at: { s: 0.24, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'hexCannonballs', at: { s: 0.247, offset: -21 }, scale: 4 },
    { asset: 'hexCannon', at: { s: 0.26, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'hexCannonballs', at: { s: 0.267, offset: -21 }, scale: 4 },
    { asset: 'hexCannon', at: { s: 0.28, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'hexCannonballs', at: { s: 0.287, offset: -21 }, scale: 4 },
    { asset: 'hexCannon', at: { s: 0.3, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'hexCannonballs', at: { s: 0.307, offset: -21 }, scale: 4 },
    { asset: 'kcasCratesStacked', at: { s: 0.25, offset: -26 }, yaw: 'tangent', scale: 1.6 },
    { asset: 'kcasCratesStacked', at: { s: 0.29, offset: -26 }, yaw: 'tangent', scale: 1.6 },
    { asset: 'ffCannon', at: { s: 0.25, offset: 23 }, yaw: 'tangent', scale: 6 },
    { asset: 'ffCannon', at: { s: 0.285, offset: 23 }, yaw: 'tangent', scale: 6 },
    { asset: 'ffGearWall', at: { s: 0.268, offset: 26 }, yaw: 'tangent', scale: 5 },
    { asset: 'ffTowerBase', at: { x: 160, z: -15 }, yaw: 0, scale: 16 },
    { asset: 'ffTowerBase', at: { x: 262, z: -15 }, yaw: 0, scale: 16 },
    { asset: 'ffTowerBase', at: { x: 160, z: -128 }, yaw: 0, scale: 16 },
    { asset: 'ffTowerBase', at: { x: 262, z: -128 }, yaw: 0, scale: 16 },
    { asset: 'ffTowerPillar', at: { x: 211, z: -70 }, scale: 20 },
    { asset: 'ffGearWall', at: { x: 160, z: -50 }, yaw: 1.57, scale: 5 },
    { asset: 'ffGearWall', at: { x: 160, z: -92 }, yaw: 1.57, scale: 5 },
    { asset: 'ffDragonPillar', at: { x: 152, z: -71 }, yaw: -1.57, scale: 8 },
    { asset: 'lavaPool', at: { x: 211, z: -95 }, scale: 14 },
    { asset: 'lavaPool', at: { x: 232, z: -48 }, scale: 11 },
    { asset: 'dkDummy', at: { s: 0.33, offset: -24 }, yaw: 'tangent', scale: 3 },
    { asset: 'dkDummy', at: { s: 0.34, offset: -26 }, yaw: 'tangent', scale: 3 },
    { asset: 'dkShieldRack', at: { s: 0.35, offset: -25 }, yaw: 'tangent', scale: 4 },
    { asset: 'well', at: { s: 0.32, offset: -27 }, scale: 2 },
    { asset: 'kcasCratesStacked', at: { s: 0.385, offset: -22 }, yaw: 'tangent', scale: 1.5 },
    { asset: 'hexCannon', at: { s: 0.41, offset: -22 }, yaw: 'tangent', scale: 4 },
    { asset: 'lavaPool', at: { x: 78, z: 78 }, scale: 12 },
    { asset: 'lavaPool', at: { x: 102, z: 76 }, scale: 14 },
    { asset: 'lavaPool', at: { x: 128, z: 79 }, scale: 12 },
    { asset: 'dragonHoard', at: { x: 152, z: 78 }, yaw: 0.6, scale: 10 },
    { asset: 'dragonEggs', at: { x: 140, z: 70 }, yaw: 1.4, scale: 5 },
    { asset: 'dragonEggs', at: { x: 116, z: 85 }, yaw: 2.9, scale: 4 },
    { asset: 'emberLily', at: { x: 90, z: 70 }, scale: 3, collide: 'none' },
    { asset: 'emberLily', at: { x: 115, z: 70 }, scale: 3, collide: 'none' },
    { asset: 'emberLily', at: { x: 66, z: 84 }, scale: 3, collide: 'none' },
    { asset: 'dkDragonStatue', at: { x: 208, z: 78 }, yaw: -1.57, scale: 12 },
    { asset: 'ffDragonPillar', at: { x: 198, z: 44 }, yaw: -2.2, scale: 8 },
    { asset: 'ffDragonPillar', at: { x: 198, z: 112 }, yaw: -1, scale: 8 },
    { asset: 'lavaPool', at: { x: 236, z: 60 }, scale: 12 },
    { asset: 'lavaPool', at: { x: 238, z: 102 }, scale: 10 },
    { asset: 'dragonEggs', at: { x: 222, z: 80 }, yaw: 0.3, scale: 5 },
    { asset: 'ffTowerPillar', at: { s: 0.52, offset: -24 }, scale: 12 },
    { asset: 'ffTowerPillar', at: { s: 0.55, offset: -24 }, scale: 12 },
    { asset: 'ffTowerPillar', at: { s: 0.58, offset: -24 }, scale: 12 },
    { asset: 'ffTowerPillar', at: { s: 0.67, offset: -24 }, scale: 12 },
    { asset: 'ffTowerPillar', at: { s: 0.7, offset: -24 }, scale: 12 },
    { asset: 'ffTowerPillar', at: { s: 0.67, offset: 24 }, scale: 12 },
    { asset: 'ffTowerBase', at: { s: 0.623, offset: -26 }, yaw: 'tangent', scale: 15 },
    { asset: 'ffTowerBase', at: { s: 0.623, offset: 26 }, yaw: 'tangent', scale: 15 },
    { asset: 'ffDragonPillar', at: { s: 0.608, offset: 22 }, yaw: 'tangent', scale: 7 },
    { asset: 'ffDragonPillar', at: { s: 0.638, offset: 22 }, yaw: 'tangent', scale: 7 },
    { asset: 'ffGearWall', at: { s: 0.535, offset: -23 }, yaw: 'tangent', scale: 4 },
    { asset: 'ffGearWall', at: { s: 0.565, offset: -23 }, yaw: 'tangent', scale: 4 },
    { asset: 'dkChurch', at: { x: -112, z: 122 }, yaw: -0.6, scale: 12 },
    { asset: 'dkGravestone2', at: { x: -86, z: 130 }, yaw: 0.2, scale: 3 },
    { asset: 'dkGravestone3', at: { x: -74, z: 125 }, yaw: -0.1, scale: 3 },
    { asset: 'graveCross', at: { x: -132, z: 134 }, yaw: 0.4, scale: 3 },
    { asset: 'graveRound', at: { x: -140, z: 116 }, yaw: -0.3, scale: 3 },
    { asset: 'dkGravestone2', at: { x: -148, z: 102 }, yaw: 1.2, scale: 3 },
    { asset: 'graveCross', at: { x: -126, z: 96 }, yaw: 1, scale: 3 },
    { asset: 'dkDragonStatue', at: { x: -58, z: 132 }, yaw: 2.6, scale: 5 },
    { asset: 'dkBuilding1', at: { s: 0.77, offset: -44 }, yaw: 'tangent', scale: 11 },
    { asset: 'dkStables', at: { s: 0.795, offset: -48 }, yaw: 'tangent', scale: 10 },
    { asset: 'dkBuildingBaseRoof', at: { s: 0.825, offset: -44 }, yaw: 'tangent', scale: 11 },
    { asset: 'dkBuilding2', at: { s: 0.85, offset: -46 }, yaw: 'tangent', scale: 10 },
    { asset: 'dkChurch', at: { s: 0.81, offset: -72 }, yaw: 'tangent', scale: 10 },
    { asset: 'dkBuildingBase', at: { s: 0.775, offset: -72 }, yaw: 'tangent', scale: 9 },
    { asset: 'dkBuildingBase', at: { s: 0.848, offset: -72 }, yaw: 'tangent', scale: 9 },
    { asset: 'well', at: { s: 0.81, offset: -58 }, scale: 2.5 },
    { asset: 'dkDragonStatue', at: { s: 0.8, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'dkDragonStatue', at: { s: 0.823, offset: -22 }, yaw: 'tangent', scale: 6 },
    { asset: 'dkShieldRack', at: { s: 0.79, offset: 32 }, yaw: 'tangent', scale: 4 },
    { asset: 'dkDummy', at: { s: 0.805, offset: 34 }, yaw: 'tangent', scale: 3.5 },
    { asset: 'dkDummy', at: { s: 0.815, offset: 31 }, yaw: 'tangent', scale: 3.5 },
    { asset: 'dkShieldRack', at: { s: 0.83, offset: 33 }, yaw: 'tangent', scale: 4 },
    { asset: 'dkBuildingBase', at: { s: 0.81, offset: 46 }, yaw: 'tangent', scale: 8 },
    { asset: 'column', at: { x: -201, z: -104 }, scale: 5 },
    { asset: 'columnBroken', at: { x: -204.2, z: -96.2 }, scale: 5 },
    { asset: 'column', at: { x: -212, z: -93 }, scale: 5 },
    { asset: 'column', at: { x: -219.8, z: -96.2 }, scale: 5 },
    { asset: 'columnBroken', at: { x: -223, z: -104 }, scale: 5 },
    { asset: 'column', at: { x: -219.8, z: -111.8 }, scale: 5 },
    { asset: 'column', at: { x: -212, z: -115 }, scale: 5 },
    { asset: 'columnBroken', at: { x: -204.2, z: -111.8 }, scale: 5 },
    { asset: 'statueHead', at: { x: -212, z: -104 }, yaw: 0.9, scale: 3 },
    { asset: 'lavaPool', at: { x: -250, z: -20 }, scale: 16 },
    { asset: 'lavaPool', at: { x: -242, z: 42 }, scale: 12 },
    { asset: 'lavaPool', at: { x: -222, z: 112 }, scale: 10 },
    { asset: 'dragonHoard', at: { x: -262, z: -66 }, yaw: 1.1, scale: 9 },
    { asset: 'dragonEggs', at: { x: -236, z: 18 }, yaw: 2.5, scale: 5 },
    { asset: 'emberLily', at: { x: -230, z: -60 }, yaw: -1.54, scale: 12 },
    { asset: 'emberLily', at: { x: -266, z: 10 }, yaw: -1.9, scale: 11 },
    { asset: 'emberLily', at: { x: -256, z: 80 }, yaw: 1.12, scale: 13 },
    { asset: 'emberLily', at: { x: -200, z: 122 }, yaw: 4.64, scale: 12 },
    { asset: 'emberLily', at: { x: -276, z: -110 }, yaw: -4.68, scale: 10 },
    { asset: 'emberLily', at: { s: 0.03, offset: 30 }, yaw: 2.91, scale: 11 },
    { asset: 'emberLily', at: { s: 0.075, offset: 34 }, yaw: 0.99, scale: 13 },
    { asset: 'emberLily', at: { s: 0.12, offset: -32 }, yaw: 5.36, scale: 10 },
    { asset: 'emberLily', at: { s: 0.2, offset: 30 }, yaw: 0.56, scale: 12 },
    { asset: 'emberLily', at: { s: 0.22, offset: 36 }, yaw: 2.5, scale: 10 },
    { asset: 'emberLily', at: { s: 0.31, offset: -30 }, yaw: 4.95, scale: 11 },
    { asset: 'emberLily', at: { s: 0.38, offset: -40 }, yaw: 5.46, scale: 12 },
    { asset: 'emberLily', at: { s: 0.53, offset: -30 }, yaw: 1.17, scale: 12 },
    { asset: 'emberLily', at: { s: 0.56, offset: -32 }, yaw: 4.08, scale: 10 },
    { asset: 'emberLily', at: { s: 0.69, offset: 28 }, yaw: 4.13, scale: 12 },
    { asset: 'emberLily', at: { s: 0.71, offset: 36 }, yaw: 6.07, scale: 10 },
    { asset: 'emberLily', at: { s: 0.72, offset: -34 }, yaw: 0.76, scale: 13 },
    { asset: 'emberLily', at: { s: 0.735, offset: -30 }, yaw: 2.21, scale: 11 },
    { asset: 'emberLily', at: { s: 0.75, offset: 30 }, yaw: 3.67, scale: 10 },
    { asset: 'emberLily', at: { s: 0.89, offset: 28 }, yaw: 4.69, scale: 12 },
    { asset: 'emberLily', at: { s: 0.89, offset: -30 }, yaw: 4.69, scale: 11 },
    { asset: 'emberLily', at: { s: 0.95, offset: 32 }, yaw: 4.23, scale: 12 },
    { asset: 'emberLily', at: { s: 0.965, offset: -34 }, yaw: 5.69, scale: 10 },
    { asset: 'lavaPool', at: { x: -60, z: -20 }, scale: 18 },
    { asset: 'lavaPool', at: { x: -20, z: 20 }, scale: 13 },
    { asset: 'lavaPool', at: { x: -55, z: 45 }, scale: 12 },
    { asset: 'lavaPool', at: { x: 10, z: -55 }, scale: 11 },
    { asset: 'dragonHoard', at: { x: -30, z: -30 }, yaw: 2.1, scale: 9 },
    { asset: 'dragonEggs', at: { x: -44, z: -8 }, yaw: 0.4, scale: 5 },
    { asset: 'dragonEggs', at: { x: -8, z: 30 }, yaw: 2.2, scale: 4 },
    { asset: 'emberLily', at: { x: -100, z: -60 }, yaw: -2.8, scale: 12 },
    { asset: 'emberLily', at: { x: -85, z: -75 }, yaw: -5.97, scale: 10 },
    { asset: 'emberLily', at: { x: -105, z: -10 }, yaw: -4.89, scale: 13 },
    { asset: 'emberLily', at: { x: -30, z: 60 }, yaw: 4.94, scale: 11 },
    { asset: 'emberLily', at: { x: 20, z: 60 }, yaw: 4.6, scale: 12 },
    { asset: 'emberLily', at: { x: 30, z: -20 }, yaw: -2.62, scale: 10 },
    { asset: 'emberLily', at: { x: -5, z: -80 }, yaw: -0.21, scale: 11 },
    { asset: 'emberLily', at: { x: 45, z: 20 }, yaw: 5.25, scale: 10 },
    { asset: 'emberLily', at: { x: -120, z: -40 }, yaw: -2.76, scale: 9 },
    { asset: 'emberLily', at: { x: -40, z: 40 }, yaw: 0.08, scale: 10 },
    { asset: 'column', at: { x: 38.6, z: -42.3 }, scale: 4 },
    { asset: 'columnBroken', at: { x: 33.3, z: -36.6 }, scale: 4 },
    { asset: 'column', at: { x: 25.5, z: -37.2 }, scale: 4 },
    { asset: 'columnBroken', at: { x: 21.1, z: -43.7 }, scale: 4 },
    { asset: 'column', at: { x: 23.4, z: -51.1 }, scale: 4 },
    { asset: 'columnBroken', at: { x: 30.7, z: -54 }, scale: 4 },
    { asset: 'column', at: { x: 37.4, z: -50.1 }, scale: 4 },
    { asset: 'bonfire', at: { x: 30, z: -45 }, scale: 5 },
  ],
  scatters: [{ asset: 'emberLily', zone: 'infield', spacing: 14, seed: 31 }],
  fences: [
    {
      kit: 'fortressWall',
      points: [
        { x: -110, z: 142 },
        { x: 285, z: 142 },
        { x: 285, z: -140 },
        { x: 140, z: -140 },
      ],
    },
    {
      kit: 'keepFence',
      points: [
        { x: -124.4, z: 55.9 },
        { x: -98.8, z: 86.5 },
        { x: -145.2, z: 127.5 },
        { x: -223.5, z: 32.2 },
        { x: -171.7, z: -1.8 },
        { x: -145.1, z: 31.3 },
      ],
    },
    {
      kit: 'keepFence',
      points: [
        { x: -68.8, z: 41.4 },
        { x: -122, z: -21.9 },
      ],
    },
  ],
  pickupRows: [{ s: 0.397 }],
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 3,
  timeLimitSeconds: 180,
  musicTrack: 'mortar_overdrive_drakelands',
  theme: 'drakelands',
  timeOfDay: 'afternoon',
  roles: ['competition'],
  practiceCopies: 0,
};

/**
 * The Palmreach Lagoon Run: an island lap. Down the Strand past Drifthaven and
 * its fishing dock, up the Causeway between the open sea and the lagoon, round
 * the Idol hairpin and the drowned columns of the Sunken Idol, back down the
 * Lagoon Return, through the Tangle under the banyans, and round the long
 * Palmstrand sweep on the western beach.
 *
 * The land is AUTHORED (`groundOutline`), so the sea stands all round it and
 * the lap's edge is its own shore rather than a wall. The water is decoration
 * on every tier, drawn with the world's own material for that tier (the water
 * shader, or the low tier's plane), and none of it touches the racing surface.
 *
 * The Causeway and the Lagoon Return run head on fifty yards apart across the
 * lagoon, inside Ground Blast reach, and the one pickup row stands at the foot
 * of the Causeway so a pilot arms up just before it. One row because the lap is
 * the pool's size in time (the ace field's three laps land inside the gate like
 * the other competition circuits'), so one row is the pool's cadence.
 *
 * Raced at noon, the hour the lagoon reads turquoise to its bed: the morning sun
 * lays the arch's shadow across the grid, and by the afternoon the sea greys.
 */
const PALMREACH_LAGOON_RUN: MortarOverdriveCircuit = {
  id: 'palmreach_lagoon_run',
  controlPoints: [
    { x: -60, z: -98 },
    { x: -20, z: -98 },
    { x: 20, z: -98 },
    { x: 60, z: -98 },
    { x: 75.3, z: -95 },
    { x: 88.3, z: -86.3 },
    { x: 97, z: -73.3 },
    { x: 100, z: -58 },
    { x: 100, z: -14.1 },
    { x: 100, z: 29.7 },
    { x: 100, z: 73.6 },
    { x: 96.7, z: 86.1 },
    { x: 87.5, z: 95.3 },
    { x: 75, z: 98.6 },
    { x: 62.5, z: 95.3 },
    { x: 53.3, z: 86.1 },
    { x: 50, z: 73.6 },
    { x: 50, z: 18.6 },
    { x: 46, z: 3.6 },
    { x: 35, z: -7.4 },
    { x: 20, z: -11.4 },
    { x: 0, z: -11.4 },
    { x: -17.1, z: -8.4 },
    { x: -32.1, z: 0.3 },
    { x: -47.2, z: 9 },
    { x: -64.3, z: 12 },
    { x: -112.1, z: 12 },
    { x: -160, z: 12 },
    { x: -174.2, z: 10.1 },
    { x: -187.5, z: 4.6 },
    { x: -198.9, z: -4.1 },
    { x: -207.6, z: -15.5 },
    { x: -213.1, z: -28.8 },
    { x: -215, z: -43 },
    { x: -213.1, z: -57.2 },
    { x: -207.6, z: -70.5 },
    { x: -198.9, z: -81.9 },
    { x: -187.5, z: -90.6 },
    { x: -174.2, z: -96.1 },
    { x: -160, z: -98 },
    { x: -126.7, z: -98 },
    { x: -93.3, z: -98 },
  ],
  widthBands: [
    { s: 0, halfWidth: 10 },
    { s: 0.12, halfWidth: 10 },
    { s: 0.15, halfWidth: 9.5 },
    { s: 0.31, halfWidth: 9.5 },
    { s: 0.34, halfWidth: 9 },
    { s: 0.6, halfWidth: 9 },
    { s: 0.63, halfWidth: 9.5 },
    { s: 0.7, halfWidth: 9.5 },
    { s: 0.73, halfWidth: 10 },
    { s: 1, halfWidth: 10 },
  ],
  regionHalfX: 300,
  regionHalfZ: 150,
  perimeter: { halfX: 299, halfZ: 149, halfThickness: 0.4, height: 2.2 },
  basin: { waterY: -0.55, bankSlope: 0.35, depthMax: 6 },
  ponds: [
    { x: 75, z: 74, rx: 10, rz: 10, wobble: 0.08, seed: 61 },
    { x: 75, z: 38, rx: 9.5, rz: 20, wobble: 0.1, seed: 62 },
    { x: -95, z: -45, rx: 15, rz: 12, rot: 0.3, wobble: 0.14, seed: 63 },
  ],
  props: [
    { asset: 'lampPalmreachTotem', at: { s: 0.9, offset: -16 } },
    { asset: 'lampPalmreachTotem', at: { s: 0.94, offset: -16 } },
    { asset: 'lampPalmreachTotem', at: { s: 0.98, offset: -16 } },
    { asset: 'lampPalmreachTotem', at: { s: 0.02, offset: -16 } },
    { asset: 'lampPalmreachTotem', at: { s: 0.06, offset: -16 } },
    { asset: 'lampPalmreachTotem', at: { s: 0.1, offset: -16 } },
    { asset: 'house1', at: { x: -132, z: -123 }, yaw: 0, scale: 2.2 },
    { asset: 'inn', at: { x: -100, z: -125 }, yaw: 0, scale: 2 },
    { asset: 'blacksmith', at: { x: -66, z: -124 }, yaw: 0, scale: 1.8 },
    { asset: 'house1', at: { x: -26, z: -123 }, yaw: 0.2, scale: 2.1 },
    {
      asset: 'mushroomRed',
      at: { x: -152, z: -127 },
      yaw: 0.4,
      scale: 12,
      collide: { kind: 'circle', r: 1.2 },
    },
    { asset: 'mushroomTan', at: { x: -149, z: -124 }, yaw: 1.3, scale: 3 },
    {
      asset: 'mushroomRed',
      at: { x: -8, z: -128 },
      yaw: 2.1,
      scale: 13,
      collide: { kind: 'circle', r: 1.3 },
    },
    { asset: 'mushroomTan', at: { x: -12, z: -125 }, yaw: 0.3, scale: 3.4 },
    { asset: 'well', at: { x: -83, z: -118 }, scale: 2.8 },
    { asset: 'bonfire', at: { x: -116, z: -118 }, scale: 4.3 },
    { asset: 'bonfire', at: { x: -46, z: -118 }, scale: 4.3 },
    { asset: 'crateWooden', at: { x: -91, z: -132 }, yaw: 0.4, scale: 1.3 },
    { asset: 'barrel', at: { x: -88, z: -133 }, scale: 1.25 },
    { asset: 'crateWooden', at: { x: -57, z: -132 }, yaw: 1.1, scale: 1.3 },
    { asset: 'barrel', at: { x: -54, z: -131 }, scale: 1.25 },
    { asset: 'rowboat', at: { x: -118, z: -140 }, yaw: 1.2, scale: 1 },
    { asset: 'rowboat', at: { x: -18, z: -139 }, yaw: -0.6, scale: 1 },
    { asset: 'dockPlatform', at: { x: -42, z: -138 }, scale: 1.4 },
    { asset: 'dockPlatform', at: { x: -42, z: -141.5 }, scale: 1.4 },
    { asset: 'dockPlatform', at: { x: -42, z: -145 }, scale: 1.4 },
    { asset: 'rowboat', at: { x: -34.5, z: -144 }, yaw: 1.57, scale: 1 },
    { asset: 'barrel', at: { x: -44, z: -137 }, scale: 1.2 },
    { asset: 'beachPalm3', at: { s: 0.1236, offset: -25.1 }, yaw: 5.86, scale: 2.61 },
    { asset: 'beachPalm2', at: { s: 0.1426, offset: -27.5 }, yaw: 4.51, scale: 4.07 },
    { asset: 'fallenCoconuts', at: { s: 0.1456, offset: -27.9 }, yaw: 0.01, scale: 4.24 },
    { asset: 'beachPalm2', at: { s: 0.1637, offset: -26.3 }, yaw: 3.37, scale: 3.35 },
    { asset: 'fallenCoconuts', at: { s: 0.1588, offset: -25.5 }, yaw: 0.29, scale: 3.24 },
    { asset: 'beachPalm1', at: { s: 0.1731, offset: -22.6 }, yaw: 2.71, scale: 2.95 },
    { asset: 'beachPalm3', at: { s: 0.2044, offset: -17.7 }, yaw: 5.24, scale: 3.15 },
    { asset: 'fallenCoconuts', at: { s: 0.1977, offset: -21 }, yaw: 2.88, scale: 3.54 },
    { asset: 'beachPalm3', at: { s: 0.2196, offset: -19.2 }, yaw: 4.26, scale: 3.34 },
    { asset: 'beachPalm2', at: { s: 0.2388, offset: -18.6 }, yaw: 0.59, scale: 3.81 },
    { asset: 'beachPalm2', at: { s: 0.2493, offset: -19.3 }, yaw: 5.99, scale: 3.39 },
    { asset: 'fallenCoconuts', at: { s: 0.2522, offset: -21.5 }, yaw: 0.6, scale: 3.79 },
    { asset: 'beachPalm2', at: { s: 0.2739, offset: -17.2 }, yaw: 5.85, scale: 4.16 },
    { asset: 'beachPalm1', at: { s: 0.2948, offset: -17.3 }, yaw: 4.01, scale: 3.47 },
    { asset: 'beachPalm2', at: { s: 0.3088, offset: -17.2 }, yaw: 0.75, scale: 4.15 },
    { asset: 'fallenCoconuts', at: { s: 0.3074, offset: -22.2 }, yaw: 1.93, scale: 3.31 },
    { asset: 'beachPalm2', at: { s: 0.3354, offset: -19.2 }, yaw: 1.22, scale: 3.02 },
    { asset: 'beachPalm2', at: { s: 0.3544, offset: -20 }, yaw: 0.75, scale: 4.35 },
    { asset: 'fallenCoconuts', at: { s: 0.3515, offset: -25.7 }, yaw: 2.52, scale: 3.53 },
    { asset: 'beachPalm3', at: { s: 0.3723, offset: -21.2 }, yaw: 4.46, scale: 2.45 },
    { asset: 'beachPalm2', at: { s: 0.394, offset: -21.2 }, yaw: 5.72, scale: 3.1 },
    { asset: 'fallenCoconuts', at: { s: 0.3874, offset: -24.9 }, yaw: 1.94, scale: 3.98 },
    { asset: 'beachPalm2', at: { s: 0.7227, offset: -23.1 }, yaw: 5.89, scale: 4.45 },
    { asset: 'beachPalm1', at: { s: 0.7279, offset: -23.1 }, yaw: 2.15, scale: 4.28 },
    { asset: 'fallenCoconuts', at: { s: 0.7311, offset: -26.6 }, yaw: 5.06, scale: 4.3 },
    { asset: 'beachPalm3', at: { s: 0.7441, offset: -28.4 }, yaw: 5, scale: 3.22 },
    { asset: 'beachPalm3', at: { s: 0.7557, offset: -20.1 }, yaw: 5.91, scale: 2.72 },
    { asset: 'beachPalm3', at: { s: 0.7628, offset: -27.2 }, yaw: 0.74, scale: 2.21 },
    { asset: 'fallenCoconuts', at: { s: 0.7656, offset: -24.9 }, yaw: 0.26, scale: 3.78 },
    { asset: 'beachPalm3', at: { s: 0.7727, offset: -26.7 }, yaw: 3.18, scale: 2.58 },
    { asset: 'beachPalm1', at: { s: 0.7893, offset: -28.9 }, yaw: 2.72, scale: 3.97 },
    { asset: 'beachPalm2', at: { s: 0.7976, offset: -26.9 }, yaw: 0.61, scale: 3.12 },
    { asset: 'beachPalm3', at: { s: 0.8095, offset: -27.4 }, yaw: 2.11, scale: 2.93 },
    { asset: 'fallenCoconuts', at: { s: 0.8092, offset: -27.4 }, yaw: 4.5, scale: 3.06 },
    { asset: 'beachPalm1', at: { s: 0.8197, offset: -24.9 }, yaw: 2.39, scale: 4.11 },
    { asset: 'fallenCoconuts', at: { s: 0.8175, offset: -26 }, yaw: 1.24, scale: 3.71 },
    { asset: 'beachPalm3', at: { s: 0.8317, offset: -22.9 }, yaw: 1.41, scale: 3.19 },
    { asset: 'beachPalm1', at: { s: 0.8416, offset: -24 }, yaw: 5.87, scale: 3.43 },
    { asset: 'fallenCoconuts', at: { s: 0.842, offset: -29.3 }, yaw: 5.04, scale: 3.79 },
    { asset: 'beachPalm3', at: { s: 0.8507, offset: -23.9 }, yaw: 4.89, scale: 3.17 },
    { asset: 'fallenCoconuts', at: { s: 0.852, offset: -22.7 }, yaw: 6.09, scale: 3.5 },
    { asset: 'beachPalm1', at: { s: 0.861, offset: -26.5 }, yaw: 6.13, scale: 4.46 },
    { asset: 'fallenCoconuts', at: { s: 0.8619, offset: -27 }, yaw: 1.15, scale: 3.09 },
    { asset: 'beachPalm2', at: { s: 0.8713, offset: -21.2 }, yaw: 1.65, scale: 3.87 },
    { asset: 'fallenCoconuts', at: { s: 0.8752, offset: -31.2 }, yaw: 2.07, scale: 3.04 },
    { asset: 'beachPalm2', at: { s: 0.8842, offset: -24.9 }, yaw: 4.27, scale: 3.4 },
    { asset: 'beachPalm2', at: { s: 0.907, offset: 22.2 }, yaw: 2.87, scale: 4.17 },
    { asset: 'fallenCoconuts', at: { s: 0.8988, offset: 26.4 }, yaw: 4.95, scale: 3.19 },
    { asset: 'beachPalm2', at: { s: 0.9284, offset: 20.7 }, yaw: 1.12, scale: 3.65 },
    { asset: 'beachPalm2', at: { s: 0.9562, offset: 25.5 }, yaw: 5.1, scale: 3.48 },
    { asset: 'fallenCoconuts', at: { s: 0.956, offset: 28.9 }, yaw: 0.5, scale: 3.72 },
    { asset: 'beachPalm1', at: { s: 0.0062, offset: 23.3 }, yaw: 3.97, scale: 4.49 },
    { asset: 'beachPalm2', at: { s: 0.0363, offset: 25.1 }, yaw: 0.64, scale: 3.9 },
    { asset: 'fallenCoconuts', at: { s: 0.0422, offset: 28.5 }, yaw: 2.48, scale: 3.02 },
    { asset: 'beachPalm3', at: { s: 0.0758, offset: 21 }, yaw: 0.83, scale: 2.8 },
    { asset: 'fallenCoconuts', at: { s: 0.0787, offset: 27.1 }, yaw: 1.01, scale: 3.67 },
    { asset: 'beachPalm1', at: { s: 0.1053, offset: 21.2 }, yaw: 2.87, scale: 4.13 },
    { asset: 'fallenCoconuts', at: { s: 0.1007, offset: 29.5 }, yaw: 5.79, scale: 3.35 },
    { asset: 'columnBroken', at: { x: 76.9, z: 80.2 }, yaw: 0.85, scale: 3.8 },
    { asset: 'column', at: { x: 81.3, z: 75.4 }, yaw: 3.1, scale: 3.8 },
    { asset: 'columnBroken', at: { x: 79.4, z: 69.2 }, yaw: 0.32, scale: 3.8 },
    { asset: 'columnBroken', at: { x: 73.1, z: 67.8 }, yaw: 1.39, scale: 3.8 },
    { asset: 'columnBroken', at: { x: 68.7, z: 72.6 }, yaw: 2.51, scale: 3.8 },
    { asset: 'column', at: { x: 70.6, z: 78.8 }, yaw: 1.28, scale: 3.8 },
    { asset: 'statueHead', at: { x: 74, z: 75 }, yaw: 2.4, scale: 2.3 },
    { asset: 'statueBlock', at: { x: 77.5, z: 72 }, yaw: 0.6, scale: 2.1 },
    { asset: 'lilyRaft', at: { x: 73, z: 42 }, scale: 4 },
    { asset: 'lilyRaft', at: { x: 77, z: 28 }, scale: 3.5 },
    { asset: 'lilyRaft', at: { x: 74, z: 55 }, scale: 4.5 },
    { asset: 'oak', at: { s: 0.43, offset: -24 }, scale: 1.1 },
    { asset: 'oak', at: { s: 0.46, offset: -30 }, scale: 1.3 },
    { asset: 'greatTree', at: { s: 0.44, offset: -58 }, yaw: 3.6, scale: 2.2 },
    {
      asset: 'mushroomRed',
      at: { s: 0.5, offset: 26 },
      yaw: 1,
      scale: 11,
      collide: { kind: 'circle', r: 1.1 },
    },
    { asset: 'oak', at: { s: 0.535, offset: -24 }, scale: 1.2 },
    { asset: 'oak', at: { s: 0.565, offset: 24 }, scale: 1 },
    { asset: 'oak', at: { s: 0.59, offset: -26 }, scale: 1.3 },
    { asset: 'greatTree', at: { s: 0.575, offset: -60 }, yaw: 2.2, scale: 2.4 },
    { asset: 'greatTree', at: { s: 0.63, offset: -70 }, yaw: 0.9, scale: 2.6 },
    { asset: 'house1', at: { s: 0.655, offset: -34 }, yaw: 'tangent', scale: 2 },
    {
      asset: 'mushroomRed',
      at: { s: 0.67, offset: -30 },
      yaw: 2.2,
      scale: 11,
      collide: { kind: 'circle', r: 1.1 },
    },
    {
      asset: 'mushroomRed',
      at: { s: 0.64, offset: -31 },
      yaw: 0.2,
      scale: 12,
      collide: { kind: 'circle', r: 1.2 },
    },
    { asset: 'bonfire', at: { s: 0.66, offset: -26 }, scale: 4 },
    { asset: 'crateWooden', at: { s: 0.645, offset: -26 }, yaw: 0.7, scale: 1.3 },
    { asset: 'oak', at: { s: 0.69, offset: -24 }, scale: 1.2 },
    { asset: 'oak', at: { s: 0.62, offset: 24 }, scale: 1.1 },
    { asset: 'oak', at: { s: 0.7, offset: 26 }, scale: 1.4 },
    { asset: 'greatTree', at: { s: 0.68, offset: -85 }, yaw: 1.8, scale: 2.8 },
    { asset: 'greatTree', at: { x: -40, z: -40 }, yaw: 0.4, scale: 2.4 },
    { asset: 'greatTree', at: { x: 5, z: -55 }, yaw: 5.1, scale: 2.2 },
    { asset: 'greatTree', at: { x: -130, z: -30 }, yaw: 2.8, scale: 2.1 },
    { asset: 'lilyRaft', at: { x: -92, z: -42 }, scale: 4 },
    { asset: 'lilyRaft', at: { x: -100, z: -50 }, scale: 3.5 },
    { asset: 'oak', at: { x: -60, z: -70 }, scale: 1.2 },
    { asset: 'oak', at: { x: -20, z: -72 }, scale: 1.1 },
    { asset: 'oak', at: { x: 30, z: -70 }, scale: 1.3 },
    { asset: 'oak', at: { x: -150, z: -65 }, scale: 1.2 },
    { asset: 'mushroomTan', at: { x: -70, z: -50 }, yaw: 0.8, scale: 3 },
    { asset: 'mushroomTan', at: { x: -64, z: -46 }, yaw: 2.3, scale: 2.5 },
    { asset: 'greatTree', at: { x: -40, z: 85 }, yaw: 3.9, scale: 2.8 },
    { asset: 'greatTree', at: { x: 0, z: 60 }, yaw: 1.1, scale: 2.4 },
    { asset: 'greatTree', at: { x: -180, z: 70 }, yaw: 5.4, scale: 2.6 },
    { asset: 'oak', at: { x: 20, z: 95 }, scale: 1.3 },
    { asset: 'oak', at: { x: -100, z: 95 }, scale: 1.2 },
    { asset: 'beachPalm2', at: { x: -232.2, z: -99 }, yaw: 4.7, scale: 4.05 },
    { asset: 'fallenCoconuts', at: { x: -229.2, z: -101 }, yaw: 2.13, scale: 3.93 },
    { asset: 'beachPalm2', at: { x: -237.3, z: 30.7 }, yaw: 1.89, scale: 4.5 },
    { asset: 'fallenCoconuts', at: { x: -234.3, z: 28.7 }, yaw: 5.83, scale: 3.64 },
    { asset: 'beachPalm1', at: { x: -233.3, z: 51.8 }, yaw: 4.63, scale: 3.42 },
    { asset: 'beachPalm2', at: { x: -211.4, z: 26.9 }, yaw: 4.86, scale: 3.21 },
    { asset: 'beachPalm1', at: { x: -214.4, z: 76.8 }, yaw: 4.6, scale: 4.56 },
    { asset: 'beachPalm3', at: { x: -209.2, z: 89.3 }, yaw: 4.82, scale: 2.94 },
    { asset: 'fallenCoconuts', at: { x: -206.2, z: 87.3 }, yaw: 4.69, scale: 3.78 },
    { asset: 'beachPalm1', at: { x: -195.6, z: 79.6 }, yaw: 4.36, scale: 3.51 },
    { asset: 'fallenCoconuts', at: { x: -192.6, z: 77.6 }, yaw: 0.13, scale: 3.84 },
    { asset: 'beachPalm3', at: { x: -184.4, z: 91.4 }, yaw: 1.54, scale: 2.42 },
    { asset: 'fallenCoconuts', at: { x: -181.4, z: 89.4 }, yaw: 3.53, scale: 3.63 },
    { asset: 'beachPalm2', at: { x: -174.4, z: -65.7 }, yaw: 2.63, scale: 3.27 },
    { asset: 'beachPalm2', at: { x: -175.7, z: -36.1 }, yaw: 0.8, scale: 4.99 },
    { asset: 'beachPalm1', at: { x: -168.1, z: -16.1 }, yaw: 6.18, scale: 4.49 },
    { asset: 'fallenCoconuts', at: { x: -165.1, z: -18.1 }, yaw: 3.82, scale: 4.38 },
    { asset: 'beachPalm3', at: { x: -174.2, z: 35.8 }, yaw: 0.13, scale: 3.16 },
    { asset: 'beachPalm1', at: { x: -162.2, z: 54.3 }, yaw: 3.82, scale: 4.87 },
    { asset: 'beachPalm1', at: { x: -154, z: -12.9 }, yaw: 3.91, scale: 3.87 },
    { asset: 'fallenCoconuts', at: { x: -151, z: -14.9 }, yaw: 0.6, scale: 4.44 },
    { asset: 'beachPalm1', at: { x: -145.3, z: 49.9 }, yaw: 0.6, scale: 4.95 },
    { asset: 'fallenCoconuts', at: { x: -142.3, z: 47.9 }, yaw: 4.02, scale: 3.07 },
    { asset: 'beachPalm3', at: { x: -153.4, z: 89.3 }, yaw: 1.83, scale: 3.21 },
    { asset: 'fallenCoconuts', at: { x: -150.4, z: 87.3 }, yaw: 5.31, scale: 3.31 },
    { asset: 'beachPalm3', at: { x: -123, z: -65.3 }, yaw: 1.31, scale: 3.45 },
    { asset: 'fallenCoconuts', at: { x: -120, z: -67.3 }, yaw: 3.54, scale: 3.56 },
    { asset: 'beachPalm2', at: { x: -124.1, z: 71.2 }, yaw: 1.33, scale: 4.69 },
    { asset: 'beachPalm1', at: { x: -105.5, z: 54.4 }, yaw: 3.85, scale: 4.66 },
    { asset: 'beachPalm2', at: { x: -99.6, z: 69.1 }, yaw: 5.16, scale: 4.47 },
    { asset: 'fallenCoconuts', at: { x: -96.6, z: 67.1 }, yaw: 2.59, scale: 4.44 },
    { asset: 'beachPalm1', at: { x: -74.5, z: -14.1 }, yaw: 1.42, scale: 4.8 },
    { asset: 'fallenCoconuts', at: { x: -71.5, z: -16.1 }, yaw: 3.23, scale: 4.16 },
    { asset: 'beachPalm1', at: { x: -84.8, z: 56.5 }, yaw: 3.23, scale: 4.57 },
    { asset: 'fallenCoconuts', at: { x: -81.8, z: 54.5 }, yaw: 2.62, scale: 4.33 },
    { asset: 'beachPalm2', at: { x: -75.5, z: 67 }, yaw: 4.87, scale: 3.81 },
    { asset: 'beachPalm2', at: { x: -41.4, z: -74.9 }, yaw: 6.17, scale: 3.84 },
    { asset: 'fallenCoconuts', at: { x: -38.4, z: -76.9 }, yaw: 3.16, scale: 3.97 },
    { asset: 'beachPalm3', at: { x: -30.9, z: -59.5 }, yaw: 2.57, scale: 2.32 },
    { asset: 'beachPalm2', at: { x: -37, z: 53 }, yaw: 2.96, scale: 4.51 },
    { asset: 'fallenCoconuts', at: { x: -34, z: 51 }, yaw: 4.9, scale: 4.22 },
    { asset: 'beachPalm1', at: { x: -11.1, z: -54.6 }, yaw: 1.07, scale: 4.18 },
    { asset: 'beachPalm3', at: { x: -13.9, z: 33.4 }, yaw: 1.13, scale: 3.42 },
    { asset: 'beachPalm1', at: { x: 9.6, z: 33.3 }, yaw: 5.47, scale: 3.69 },
    { asset: 'beachPalm3', at: { x: 12.2, z: 92.7 }, yaw: 4.85, scale: 3.46 },
    { asset: 'beachPalm3', at: { x: 26.3, z: 48.7 }, yaw: 5.36, scale: 3 },
    { asset: 'beachPalm3', at: { x: 26.7, z: 79.7 }, yaw: 3.13, scale: 3.29 },
    { asset: 'fallenCoconuts', at: { x: 29.7, z: 77.7 }, yaw: 1.78, scale: 4.29 },
    { asset: 'beachPalm2', at: { x: 35.7, z: 99.9 }, yaw: 4.37, scale: 3.47 },
    { asset: 'fallenCoconuts', at: { x: 38.7, z: 97.9 }, yaw: 5.41, scale: 3.18 },
    { asset: 'beachPalm1', at: { x: 48, z: -31.9 }, yaw: 0.25, scale: 4.93 },
    { asset: 'beachPalm1', at: { x: 56.1, z: -20.3 }, yaw: 5.99, scale: 4.21 },
    { asset: 'beachPalm1', at: { x: 70.7, z: -16 }, yaw: 1.17, scale: 3.27 },
    { asset: 'beachPalm1', at: { x: 72, z: 1.1 }, yaw: 0.8, scale: 4.28 },
    { asset: 'fallenCoconuts', at: { x: 75, z: -0.9 }, yaw: 2.32, scale: 3.48 },
    { asset: 'house1', at: { x: -118, z: -62 }, yaw: 2.6, scale: 2 },
    {
      asset: 'mushroomRed',
      at: { x: -128, z: -52 },
      yaw: 1.4,
      scale: 11,
      collide: { kind: 'circle', r: 1.1 },
    },
    {
      asset: 'mushroomRed',
      at: { x: -106, z: -70 },
      yaw: 3.1,
      scale: 12,
      collide: { kind: 'circle', r: 1.2 },
    },
    { asset: 'bonfire', at: { x: -115, z: -52 }, scale: 4 },
    { asset: 'barrel', at: { x: -124, z: -66 }, scale: 1.25 },
    { asset: 'rowboat', at: { x: -246, z: -20 }, yaw: 0.3, scale: 1 },
    { asset: 'rowboat', at: { x: -244, z: 30 }, yaw: 2.8, scale: 1 },
    { asset: 'rowboat', at: { x: 119, z: -90 }, yaw: 1.4, scale: 1 },
  ],
  groundOutline: [
    { x: -240, z: -132 },
    { x: -120, z: -140 },
    { x: 0, z: -141 },
    { x: 90, z: -136 },
    { x: 120, z: -110 },
    { x: 123, z: -20 },
    { x: 122, z: 80 },
    { x: 105, z: 118 },
    { x: 40, z: 124 },
    { x: -80, z: 124 },
    { x: -200, z: 112 },
    { x: -250, z: 70 },
    { x: -255, z: -40 },
    { x: -252, z: -110 },
  ],
  pickupRows: [{ s: 0.205 }],
  startBack: 7,
  startSpacing: 5,
  laps: 3,
  practiceLaps: 3,
  timeLimitSeconds: 180,
  musicTrack: 'mortar_overdrive_palmreach',
  theme: 'palmreach',
  timeOfDay: 'noon',
  roles: ['competition'],
  practiceCopies: 0,
};

/** Every circuit, in lane order: the lane table is built by walking this record
 *  in insertion order, so an entry's position here decides where in the band it
 *  sits. Appending is free; reordering MOVES existing circuits. */
export const MORTAR_OVERDRIVE_CIRCUITS: Record<string, MortarOverdriveCircuit> = {
  [EVERGARDEN_PRACTICE.id]: EVERGARDEN_PRACTICE,
  [EVERGARDEN_EXPRESS_TOUR.id]: EVERGARDEN_EXPRESS_TOUR,
  [NIGHTBLOOM_MOONSPRING_RUN.id]: NIGHTBLOOM_MOONSPRING_RUN,
  [DRAKELANDS_RAMPART_RUN.id]: DRAKELANDS_RAMPART_RUN,
  [PALMREACH_LAGOON_RUN.id]: PALMREACH_LAGOON_RUN,
};

/** Insertion-ordered list, which is the lane order. */
export const MORTAR_OVERDRIVE_CIRCUIT_LIST: readonly MortarOverdriveCircuit[] =
  Object.values(MORTAR_OVERDRIVE_CIRCUITS);

/** The one circuit practice runs on, whatever the competition pool holds. */
export const MORTAR_OVERDRIVE_PRACTICE_CIRCUIT: MortarOverdriveCircuit = (() => {
  const practice = MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.roles.includes('practice'));
  if (practice.length !== 1) {
    throw new Error(`expected exactly one practice circuit, found ${practice.length}`);
  }
  return practice[0];
})();

export const MORTAR_OVERDRIVE_PRACTICE_CIRCUIT_ID = MORTAR_OVERDRIVE_PRACTICE_CIRCUIT.id;

/** The pool a queued race draws from. Never empty. */
export function mortarOverdriveCompetitionCircuits(): readonly MortarOverdriveCircuit[] {
  return MORTAR_OVERDRIVE_CIRCUIT_LIST.filter((c) => c.roles.includes('competition'));
}

/**
 * The record for an id, or undefined for an id no longer authored (a match
 * restored from an older shape, which the caller falls back on).
 *
 * The DRAFT overlay is consulted after the authored table and never before it:
 * a dev session registering a draft can add circuits the game can race, but it
 * can never shadow one the game ships. The overlay is empty unless a dev
 * command filled it (`mortar_overdrive/drafts.ts`), so every other host resolves
 * exactly the authored table.
 */
export function mortarOverdriveCircuitById(id: string): MortarOverdriveCircuit | undefined {
  return MORTAR_OVERDRIVE_CIRCUITS[id] ?? mortarOverdriveDraftCircuit(id);
}
