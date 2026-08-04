// The pickup boxes: where a circuit's authored ROWS put them, who is holding
// one, and when a taken one comes back.
//
// Two halves of one small system, together because they are two halves of one
// fact (a box is a place plus a state) and because both are pure:
//
//  - the GEOMETRY, derived per circuit and memoized under its id exactly like
//    the spline and the recovery anchors. A row is one authored lap fraction and
//    everything else follows from the road there, so nothing in the record can
//    put a box off the track by hand;
//  - the per-race STATE and the two rules over it: a box is taken by the first
//    machine to reach it whose pickup cooldown has expired, and every taken box
//    comes back when the race LEADER crosses the start line.
//
// The consequences (the charge granted, the cooldown armed, the readout) belong
// to `social/realm_racers.ts`, which owns everything else about a race. This
// decides only where the boxes are and which of them changed hands, the same
// split `realm_racers_track_limits.ts` keeps with the referee.
//
// Pure leaf: no SimContext, no rng, no clock, no DOM, no three. It draws NO
// randomness at all, deliberately: what a box GIVES is a fixed charge of the
// machine's own weapon, so nothing here can move the shared draw order.

import type { RealmRacersCircuit } from './content/realm_racers_circuits';
import { memoizePerCircuit, realmRacersTrack } from './realm_racers_spline';
import { TICK_RATE } from './types';

/** Boxes in a row. Four, matching the grid, so a field that arrives abreast
 *  finds one each. */
export const REALM_RACERS_PICKUP_LANES = 4;

/**
 * How much of the road's WIDTH the row spreads over: the outermost boxes sit at
 * this fraction of the local half-width, so a tenth of the road stays clear on
 * each side.
 *
 * Under 1 on purpose. A row that reached the road edges would make shaving a
 * border the way to dodge it by accident; at 80 percent the clear strip is
 * narrow enough that missing the row is a line a pilot CHOSE, which is what
 * makes an oil-slick lane (22b) a decision rather than a tax.
 */
export const REALM_RACERS_PICKUP_SPREAD = 0.8;

/** Half the box's own size, yards: what the renderer draws and what the readout
 *  measures against the road. */
export const REALM_RACERS_PICKUP_BOX_HALF = 0.6;

/**
 * How close a machine's path has to pass a box's centre to take it, yards.
 *
 * The box's own half-size plus about a machine's hull radius, so a box is taken
 * by driving THROUGH it rather than by touching a point.
 *
 * It is NOT under half the gap between two neighbouring boxes, and that was
 * written here as though it were. Measured over every shipped row: the gap is
 * `2 * SPREAD * halfWidth / (LANES - 1)`, so on the narrowest shipped road (8.0
 * half-width, the Express Tour's two middle rows) neighbours are 4.27 yards
 * apart and the half-gap is 2.13, INSIDE this reach. A pass straight down the
 * middle of two boxes is therefore genuinely inside both catch zones, and what
 * decides it is the take rule itself: the NEAREST box, lowest index on an exact
 * tie. The cooldown is what stops the SECOND one being taken a tick later, so
 * it is part of the rule rather than a backstop for a case that cannot happen.
 * `pickup_row_lanes_overlap` is the readout warning that names a row where this
 * is true, so a future road narrow enough to make it the common case is caught
 * while it is being drawn.
 */
export const REALM_RACERS_PICKUP_REACH = 2.3;

/** The gap between two neighbouring boxes of a row on a road of this
 *  half-width, yards. What the readout measures against the reach. */
export function realmRacersPickupLaneGap(halfWidth: number): number {
  return (2 * REALM_RACERS_PICKUP_SPREAD * halfWidth) / Math.max(1, REALM_RACERS_PICKUP_LANES - 1);
}

/**
 * How long after taking a box a machine cannot take another, ticks.
 *
 * The mechanical spelling of "one box per pass": a row is a couple of yards deep
 * and is crossed in well under a second at race speed, so a second of lockout
 * covers the whole row without any per-row bookkeeping, and a racer coming back
 * round a 450 yard lap is never inside it.
 */
export const REALM_RACERS_PICKUP_COOLDOWN_TICKS = TICK_RATE;

/** Charges a box grants, added to whatever the machine already holds. There is
 *  no cap and no refusal: a box ALWAYS gives. */
export const REALM_RACERS_PICKUP_CHARGE_GRANT = 1;

/**
 * One box, resolved onto the circuit.
 *
 * Coordinates are in the SPLINE's own frame (circuit-local plus
 * `REALM_RACERS_ORIGIN`), which is what `realmRacersGates` and
 * `realmRacersStarts` also come back in and what `realmRacersToCanonical` maps a
 * live position into. A race adds its own lane origin on top; the renderer's
 * track group is already built in it.
 */
export interface RallyPickupBox {
  /** Index into the circuit's whole box list: the id every state, wire payload
   *  and visual keys off. */
  index: number;
  /** Which authored row it belongs to, and which slot across that row. */
  row: number;
  lane: number;
  x: number;
  z: number;
  /** Lap position of the row, yards. */
  s: number;
  /** Signed offset along the left normal, yards. */
  lateral: number;
  /** Heading of the road there, radians, so a box can face down the circuit. */
  yaw: number;
}

/**
 * Every box on a circuit, in row order then lane order (lane 0 is the leftmost,
 * on the left normal).
 *
 * Memoized per circuit like every other derivation: the rows are static content,
 * so one build per circuit serves every Sim in the process, and a record edited
 * under its own id (the circuit editor, redrawing on every drag) rebuilds
 * because `memoizePerCircuit` keys on the RECORD as well as the id.
 */
export const realmRacersPickupBoxes: (circuit: RealmRacersCircuit) => readonly RallyPickupBox[] =
  memoizePerCircuit((circuit) => {
    const rows = circuit.pickupRows ?? [];
    const track = realmRacersTrack(circuit);
    const boxes: RallyPickupBox[] = [];
    for (let row = 0; row < rows.length; row++) {
      const fraction = ((rows[row].s % 1) + 1) % 1;
      const point = track.pointAt(fraction * track.length);
      // The left normal, the sign convention every lateral offset in the rally is
      // written in (`RallyProjection.lateral`, the props' `offset`).
      const normalX = -point.tz;
      const normalZ = point.tx;
      const half = REALM_RACERS_PICKUP_SPREAD * point.halfWidth;
      for (let lane = 0; lane < REALM_RACERS_PICKUP_LANES; lane++) {
        // Evenly spread between the two outermost slots, so the row is symmetric
        // about the centerline whatever the lane count is.
        const span = Math.max(1, REALM_RACERS_PICKUP_LANES - 1);
        const lateral = -half + ((2 * half) / span) * lane;
        boxes.push({
          index: boxes.length,
          row,
          lane,
          x: point.x + normalX * lateral,
          z: point.z + normalZ * lateral,
          s: point.s,
          lateral,
          yaw: Math.atan2(point.tx, point.tz),
        });
      }
    }
    return boxes;
  });

/**
 * The live state of one race's boxes.
 *
 * `taken` is one flag per box, in `realmRacersPickupBoxes` order. `leaderLap` is
 * the lap the leader was on when the boxes were last put back, which is the
 * whole of the respawn rule: it fires when that number goes up.
 */
export interface RallyPickupState {
  taken: boolean[];
  leaderLap: number;
}

/** Every box present, which is how a race starts. The leader is on lap 1, so the
 *  first respawn is the leader's first crossing of the line. */
export function createRealmRacersPickupState(circuit: RealmRacersCircuit): RallyPickupState {
  return { taken: realmRacersPickupBoxes(circuit).map(() => false), leaderLap: 1 };
}

/** Which boxes are taken right now, by index: the compact form the readout and
 *  the wire carry (usually empty, and never longer than the row count). */
export function realmRacersPickupTakenIndices(state: RallyPickupState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.taken.length; i++) {
    if (state.taken[i]) out.push(i);
  }
  return out;
}

/** One machine's tick, as the boxes see it: where it drove, and whether it may
 *  take anything. */
export interface RallyPickupRacer {
  pid: number;
  /** The segment this machine covered this tick, circuit-local. A SEGMENT
   *  rather than a point because a machine covers about three yards a tick at
   *  race speed, which is enough to step over a box's catch zone. */
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  /** Tick this machine's pickup cooldown expires on; 0 when it has none. */
  cooldownUntilTick: number;
  /**
   * False for anyone who may not take: finished, retired, or not driving under
   * their own steam (a machine the referee has just put back is held by the
   * control lock, and a box it happens to have been dropped on is not a box it
   * drove into).
   */
  eligible: boolean;
}

export interface RallyPickupTake {
  pid: number;
  /** Index into `realmRacersPickupBoxes`. */
  box: number;
}

export interface RallyPickupStep {
  /** In the order the racers were offered, which is the caller's grid order. */
  takes: readonly RallyPickupTake[];
  /** True on the tick the leader's crossing put every taken box back. */
  respawned: boolean;
}

export interface RallyPickupInput {
  tick: number;
  /** The lap the RACE LEADER (most travelled) is on. */
  leaderLap: number;
  /** Every racer, in a stable order the caller owns (the frozen grid order):
   *  two machines reaching one box on the same tick are separated by it. */
  racers: readonly RallyPickupRacer[];
}

/** Square of the distance from a point to a segment: the take test, without the
 *  square root nothing needs. */
function distanceSqToSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  const raw = len2 <= 0 ? 0 : ((px - ax) * dx + (pz - az) * dz) / len2;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return (px - cx) * (px - cx) + (pz - cz) * (pz - cz);
}

/**
 * Advance one race's boxes by a tick, and say what changed hands.
 *
 * MUTATES `state`, which is the match's own: the boxes are a table the race
 * owns, not a value it recomputes. Respawn is resolved BEFORE any take, so the
 * lap the leader opens starts with a full set of boxes even where the leader's
 * own crossing puts it through a row standing on the start straight.
 */
export function stepRealmRacersPickups(
  boxes: readonly RallyPickupBox[],
  state: RallyPickupState,
  input: RallyPickupInput,
): RallyPickupStep {
  let respawned = false;
  if (input.leaderLap > state.leaderLap) {
    state.leaderLap = input.leaderLap;
    for (let i = 0; i < state.taken.length; i++) {
      if (!state.taken[i]) continue;
      state.taken[i] = false;
      respawned = true;
    }
  }
  const takes: RallyPickupTake[] = [];
  const reach2 = REALM_RACERS_PICKUP_REACH * REALM_RACERS_PICKUP_REACH;
  for (const racer of input.racers) {
    if (!racer.eligible || input.tick < racer.cooldownUntilTick) continue;
    // The NEAREST reachable box. Two boxes of one row really do overlap on the
    // narrowest shipped road (see REACH), so this is the rule rather than a
    // tidy-up: a pass down the middle hands over the box it came closest to.
    // A strict `<` keeps the LOWEST index on an exact tie, which is what makes
    // a dead-centre pass deterministic across every host.
    let best = -1;
    let bestDistance = reach2;
    for (const box of boxes) {
      if (state.taken[box.index]) continue;
      const distance = distanceSqToSegment(
        box.x,
        box.z,
        racer.fromX,
        racer.fromZ,
        racer.toX,
        racer.toZ,
      );
      if (distance < bestDistance) {
        best = box.index;
        bestDistance = distance;
      }
    }
    if (best < 0) continue;
    state.taken[best] = true;
    takes.push({ pid: racer.pid, box: best });
  }
  return { takes, respawned };
}
