// What every Mortar Overdrive circuit SHARES: the margins and the apron rule the
// spline derives its boundaries from, the grid size, the two pieces of math
// that read nothing derived (gate crossing and the region test), and the LANE
// table that says which circuit sits where in the instance band.
//
// The circuits themselves are authored data, one record each in
// `content/mortar_overdrive/circuits.ts`. Everything geometric that follows from a
// record (the resampled centerline, arc lengths, the projection, the gates, the
// start slots, the lateral boundaries) is derived per circuit in the sibling
// leaf `mortar_overdrive/spline.ts`, and the collision set in
// `mortar_overdrive/colliders.ts`. Keeping the split means the derived geometry can
// get as dense as it likes without bloating what is authored.

import {
  MORTAR_OVERDRIVE_CIRCUIT_LIST,
  MORTAR_OVERDRIVE_PRACTICE_CIRCUIT,
  type MortarOverdriveCircuit,
} from '../content/mortar_overdrive/circuits';
import { mortarOverdriveDraftAtSlot, mortarOverdriveDraftSlot } from './draft_registry';

export interface MortarOverdrivePoint {
  x: number;
  z: number;
}

export interface MortarOverdriveGate extends MortarOverdrivePoint {
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
export const MORTAR_OVERDRIVE_ORIGIN = { x: 113_700, z: 0 } as const;

/**
 * The x window every circuit's region has to fit inside, world coordinates.
 * About 700 yards TOTAL for the whole pool, which is why circuits stack along z
 * rather than beside each other: the west edge is where the Protect Yumi band
 * ends (`YUMI_BAND_X_MIN` + its width) and the east edge is where the overflow
 * dungeon band starts claiming x (`DUNGEON_OVERFLOW_X_BASE` less its guard).
 *
 * Authored here rather than imported from `data.ts`, which reaches the whole
 * content tree while this file is a leaf the spline and the renderer both sit
 * on. What holds the two numbers honest is `tests/mortar_overdrive_layout.test.ts`,
 * which re-derives them from the neighbouring bands and fails if one moves.
 */
export const MORTAR_OVERDRIVE_BAND_X_MIN = 113_400;
export const MORTAR_OVERDRIVE_BAND_X_MAX = 114_100;

/**
 * The plausibility ceiling on a one-tick move the gate test will read as a
 * crossing, yards. It exists to reject teleports (resets, shell reprojections),
 * so it must sit ABOVE the fastest displacement a race can legally produce:
 * nitro forward speed with an oil-raised slip ceiling is hypot(60 * 1.3,
 * 14 * 2) / 20 = 4.15 a tick, and a contact shove can add to the same tick. At
 * the old value of 4 every gate crossed in that state was silently missed, and
 * with no resync path the recovery anchor went a whole lap stale.
 */
export const MORTAR_OVERDRIVE_MAX_GATE_STEP = 6;

/**
 * Target distance between recovery anchors, yards. It is what decides how far a
 * reset can throw a racer back, and 57 is the spacing the garden circuit was
 * authored at (eight anchors over a 455 yard lap), kept because it read well.
 *
 * The anchor COUNT follows from it rather than being authored per circuit,
 * which is the whole point: a 1100 yard lap gets nineteen anchors instead of a
 * circuit-sized number somebody had to remember to raise.
 */
export const MORTAR_OVERDRIVE_GATE_SPACING = 57;

/** Fewest anchors any circuit gets, however short its lap. */
export const MORTAR_OVERDRIVE_MIN_GATES = 4;

/**
 * How many gates, starting at the next one, a crossing may resync on. A
 * machine shoved wide past a gate's band (out on the garden, still drivable)
 * crosses that gate's plane outside it, and with only the next gate tested it
 * kept that gate for the rest of the lap: every later recovery rewound to the
 * anchor before it, up to a lap, and a missed gate 0 rewound the lap count.
 * Three is two skipped gates, over a hundred yards of garden, which the loiter
 * referee ends long before; a gate further ahead is not where a machine came
 * from, so it is never an anchor.
 */
export const MORTAR_OVERDRIVE_GATE_RESYNC_WINDOW = 3;

/**
 * How far an anchor may slide off its evenly spaced slot to find straighter
 * road, as a fraction of the spacing.
 *
 * A reset puts a racer back on the centerline at a standstill, facing along the
 * track, so an anchor in a corner restarts them stopped on an apex. Evenly
 * spaced anchors land wherever they land: on the garden circuit only one of the
 * eight sat on a straight, and one sat in the hairpin. Kept under a half so two
 * neighbouring anchors can never cross or bunch.
 */
export const MORTAR_OVERDRIVE_GATE_SNAP_FRACTION = 0.4;

/** Narrowest road half-width any circuit may author. On the garden circuit it
 *  is the HAIRPIN's, which is where a circuit's tightest road belongs. */
export const MORTAR_OVERDRIVE_MIN_HALF_WIDTH = 8.0;

/** Uniform arc-length spacing of the resampled centerline, yards. */
export const MORTAR_OVERDRIVE_SAMPLE_STEP = 1.0;

/**
 * How far a gate's crossing band reaches PAST the local road edge. The band
 * must cover the legal racing surface (the verge margin plus the run-off,
 * 0.75 + 3.5 below), or a racer shoved wide on a straight crosses the road
 * without crossing the gate, and with no resync path the missed anchor stays
 * stale until the racer laps back around. It must also stay STRICTLY inside
 * the garden edge at that same 4.25, because a gate is something a racer
 * crosses on drivable ground: 4.2 is the surface edge less five centimetres.
 */
export const MORTAR_OVERDRIVE_GATE_MARGIN = 4.2;

/** How far past the road edge a racer may run before any penalty bites. */
export const MORTAR_OVERDRIVE_VERGE_MARGIN = 0.75;

/**
 * The mown VERGE just outside the road edge: the first, lighter slow band, and
 * the one a racer running a touch wide lands in.
 *
 * It is also the width of the ON-TRACK grace the referee gives
 * (`mortar_overdrive/track_limits.ts` starts no excursion inside the verge), which
 * is what makes clipping an apex ordinary racing rather than a track-limits
 * event: every lap clips one.
 */
export const MORTAR_OVERDRIVE_RUNOFF_WIDTH = 3.5;

/**
 * How far past the collision region the ground runs, yards.
 *
 * It keeps the horizon lawn rather than empty instance band, so it started life
 * as a renderer's own number. It is shared now because a circuit that authors no
 * `groundOutline` gets exactly this rectangle derived for it
 * (`mortar_overdrive/ground.ts`), and that default is what the readout measures a
 * road against: the same number on both sides, or the game would judge a road
 * against one shape and draw it standing on another.
 */
export const MORTAR_OVERDRIVE_LAWN_OVERSHOOT = 160;

/**
 * The road edge is marked the way an Evergarden walk is: a sown line of flowers
 * and low shrubs, not a built border. Nothing here collides; a racer drives
 * straight through it into the garden.
 */
export const MORTAR_OVERDRIVE_BORDER_SPACING = 1.15;
export const MORTAR_OVERDRIVE_BORDER_OFFSET = 0.7;

/**
 * How far from the road the chase camera can end up, yards: the zoom ceiling
 * (`CAMERA_ZOOM_MAX`, 22) times the Mortar Overdrive boom's own distance scale (1.16).
 *
 * A number rather than the derivation, because `src/sim/` may import neither
 * `src/game/input.ts` nor `src/render/camera_boom_core.ts`. It is NOT pinned by
 * hand: `tests/mortar_overdrive_props.test.ts` re-derives it from those two modules
 * and fails here if either moves, which is the same treatment the render side's
 * own `DRESSING_MARGIN` gets.
 *
 * The reason it exists at all: at a 2.5 yard dressing margin the chase camera
 * sat inside a tree canopy every time a machine ran wide, so anything TALL
 * standing this close to the road is worth a word before it ships.
 */
export const MORTAR_OVERDRIVE_CAMERA_REACH = 22 * 1.16;

/**
 * How tall a prop has to be before the camera can end up INSIDE it rather than
 * merely beside it, yards. Roughly a machine's own eye height plus the boom's
 * rise: a bench cannot swallow a camera, a canopy can.
 */
export const MORTAR_OVERDRIVE_CAMERA_CANOPY_HEIGHT = 3.0;

/**
 * How many machines line up. Every race is a four-pilot race, practice
 * included; a race freezes this number at seat time so a pilot dropping out
 * cannot retroactively renumber the grid under everyone else.
 */
export const MORTAR_OVERDRIVE_GRID_SIZE = 4;

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/**
 * Returns the fraction along movement at which a forward crossing happened.
 * Null means no valid crossing. Collinear grazes and implausibly long one-tick
 * teleports are rejected.
 */
export function mortarOverdriveGateCrossingFraction(
  from: MortarOverdrivePoint,
  to: MortarOverdrivePoint,
  gate: MortarOverdriveGate,
): number | null {
  const moveX = to.x - from.x;
  const moveZ = to.z - from.z;
  const moveLen = Math.hypot(moveX, moveZ);
  if (moveLen === 0 || moveLen > MORTAR_OVERDRIVE_MAX_GATE_STEP) return null;
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
 * and the overflow-dungeon guard is about 700 yards, and since packet 28 every
 * circuit's region fills 600 of it, because the volume stopped being a
 * per-circuit number and became the ceiling) and free on z, so everything stacks
 * along z at the SAME x. That is what makes the lane spacing the interesting
 * constraint and the x window a fixed fact.
 * x is what separates the instance plane's bands from each other and the Mortar Overdrive
 * owns its whole band, so nothing else in the world keys on z out here.
 *
 * A lane holds one COPY of one circuit. A circuit that serves competition takes
 * its public lane first, then its private practice copies: a practice lap must
 * never wait on, or be waited on by, someone else's race.
 */
export interface MortarOverdriveLane {
  /** Index into `MORTAR_OVERDRIVE_LANES`, and the multiplier on `LANE_DZ`. */
  index: number;
  circuit: MortarOverdriveCircuit;
  /** True for a private practice copy, false for the one public lane. */
  practice: boolean;
}

/**
 * Spacing between lanes, yards. Authored rather than derived, so adding a
 * circuit cannot silently relocate the lanes that already exist; what holds it
 * honest is `tests/mortar_overdrive_layout.test.ts`, which derives the floor
 * (`2 * max regionHalfZ + 200`, the 200 being clear air past the ~120 yd
 * interest radius) from the circuit records and fails if this drops under it.
 * That is what makes authoring a deeper circuit fail loudly instead of quietly
 * letting two lanes see each other.
 */
export const MORTAR_OVERDRIVE_LANE_DZ = 500;

/**
 * Clear air between two neighbouring lanes' region envelopes, yards. The
 * interest scan is about 120 yd, so anything past that keeps a private copy
 * genuinely private rather than merely far away.
 *
 * Together with `MORTAR_OVERDRIVE_LANE_DZ` this is what BOUNDS how deep a circuit
 * may be: `regionHalfZ` can never exceed `(LANE_DZ - LANE_CLEARANCE) / 2`. It
 * lives here rather than inside the test that derives the floor, so the circuit
 * editor can report the limit while a circuit is being drawn instead of the
 * operator meeting it as a red test afterwards.
 */
export const MORTAR_OVERDRIVE_LANE_CLEARANCE = 200;

/** How deep a circuit's region may be before two lanes could see each other. */
export const MORTAR_OVERDRIVE_MAX_REGION_HALF_Z =
  (MORTAR_OVERDRIVE_LANE_DZ - MORTAR_OVERDRIVE_LANE_CLEARANCE) / 2;

/** How wide a circuit's region may be before it leaves the band. Asymmetric
 *  window, so the tighter side is the one that binds. */
export const MORTAR_OVERDRIVE_MAX_REGION_HALF_X = Math.min(
  MORTAR_OVERDRIVE_ORIGIN.x - MORTAR_OVERDRIVE_BAND_X_MIN,
  MORTAR_OVERDRIVE_BAND_X_MAX - MORTAR_OVERDRIVE_ORIGIN.x,
);

export const MORTAR_OVERDRIVE_LANES: readonly MortarOverdriveLane[] = (() => {
  const lanes: MortarOverdriveLane[] = [];
  for (const circuit of MORTAR_OVERDRIVE_CIRCUIT_LIST) {
    if (circuit.roles.includes('competition')) {
      lanes.push({ index: lanes.length, circuit, practice: false });
    }
    for (let copy = 0; copy < circuit.practiceCopies; copy++) {
      lanes.push({ index: lanes.length, circuit, practice: true });
    }
  }
  return lanes;
})();

/**
 * DEV lanes: where a registered draft circuit stands.
 *
 * They append after every authored lane (`MORTAR_OVERDRIVE_LANES.length + slot`),
 * which is the whole discipline: an authored lane's index is decided by the
 * records module and a dev session must never be able to move one, or a
 * practice copy would relocate under a player standing on it.
 *
 * The lane OBJECT is memoized per slot against the record behind it, exactly
 * the way the spline memoizes its model: `mortarOverdriveLaneAt` is on the movement
 * path, and a fresh object per call there would allocate per tick per racer.
 */
const draftLanes = new Map<number, MortarOverdriveLane>();

function draftLaneAtSlot(slot: number): MortarOverdriveLane | null {
  const circuit = mortarOverdriveDraftAtSlot(slot);
  if (!circuit) return null;
  const index = MORTAR_OVERDRIVE_LANES.length + slot;
  const cached = draftLanes.get(index);
  if (cached && cached.circuit === circuit) return cached;
  const lane: MortarOverdriveLane = { index, circuit, practice: false };
  draftLanes.set(index, lane);
  return lane;
}

/** The public lane of a circuit, or -1 when it serves practice only. Circuits
 *  are compared by ID everywhere, never by record identity: a suite that
 *  re-imports a module gets a second copy of the records. */
export function mortarOverdrivePublicLane(circuit: MortarOverdriveCircuit): number {
  const authored = MORTAR_OVERDRIVE_LANES.find(
    (lane) => lane.circuit.id === circuit.id && !lane.practice,
  );
  if (authored) return authored.index;
  // A registered draft has one lane and it is public: practice copies are not
  // extended to drafts, since one lane per draft is all the dev loop needs.
  const slot = mortarOverdriveDraftSlot(circuit.id);
  return slot < 0 ? -1 : MORTAR_OVERDRIVE_LANES.length + slot;
}

/** Every private copy of the practice circuit, in lane order. Computed once:
 *  the lane table is import-time content (drafts never add practice lanes), and
 *  this read sits on the 20 Hz self-wire path for every online player. */
const PRACTICE_LANES: readonly MortarOverdriveLane[] = MORTAR_OVERDRIVE_LANES.filter(
  (lane) => lane.practice && lane.circuit.id === MORTAR_OVERDRIVE_PRACTICE_CIRCUIT.id,
);

export function mortarOverdrivePracticeLanes(): readonly MortarOverdriveLane[] {
  return PRACTICE_LANES;
}

/** The offset added to every geometry read on lane `lane`. Zero for lane 0, so
 *  that path is byte-identical to a single-circuit world. */
export function mortarOverdriveLaneOffset(lane: number): MortarOverdrivePoint {
  return { x: 0, z: lane * MORTAR_OVERDRIVE_LANE_DZ };
}

/** World origin of lane `lane`. */
export function mortarOverdriveLaneOrigin(lane: number): MortarOverdrivePoint {
  return {
    x: MORTAR_OVERDRIVE_ORIGIN.x,
    z: MORTAR_OVERDRIVE_ORIGIN.z + lane * MORTAR_OVERDRIVE_LANE_DZ,
  };
}

/**
 * Which lane a world point sits on, with the circuit standing there, or null
 * for none. A pure function of position: two circuits never share a lane, so
 * the answer can never depend on live match state.
 */
export function mortarOverdriveLaneAt(x: number, z: number): MortarOverdriveLane | null {
  // The open world's answer, before any lane arithmetic: the collider and
  // ground-height hooks ask this for every point anyone stands on. Every lane's
  // x window sits inside the band (`region_outside_band` refuses any other).
  if (x < MORTAR_OVERDRIVE_BAND_X_MIN || x > MORTAR_OVERDRIVE_BAND_X_MAX) return null;
  const alongBand = z - MORTAR_OVERDRIVE_ORIGIN.z;
  const index = Math.round(alongBand / MORTAR_OVERDRIVE_LANE_DZ);
  if (index < 0) return null;
  // Past the authored lanes the band is empty unless a dev session registered a
  // draft there, so this reads exactly as before on every other host.
  const lane =
    index < MORTAR_OVERDRIVE_LANES.length
      ? MORTAR_OVERDRIVE_LANES[index]
      : draftLaneAtSlot(index - MORTAR_OVERDRIVE_LANES.length);
  if (!lane) return null;
  if (Math.abs(x - MORTAR_OVERDRIVE_ORIGIN.x) > lane.circuit.regionHalfX) return null;
  return Math.abs(alongBand - index * MORTAR_OVERDRIVE_LANE_DZ) <= lane.circuit.regionHalfZ
    ? lane
    : null;
}

export function isAtMortarOverdriveXZ(x: number, z: number): boolean {
  return mortarOverdriveLaneAt(x, z) !== null;
}

export function isAtMortarOverdrive(point: MortarOverdrivePoint): boolean {
  return isAtMortarOverdriveXZ(point.x, point.z);
}
