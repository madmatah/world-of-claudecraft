// Making a drawn circuit raceable: the dev-only side door between the circuit
// editor and a running game.
//
// The loop it buys: draw a circuit, press Save draft, alt-tab to the client,
// and race it. Before this, seeing a draft in motion meant pasting it into the
// curated records module, restarting, racing, and reverting the paste.
//
// The rules, in the order they are checked, because the order is the point:
//
//  1. refused unless dev commands are enabled (`ctx.devCommands`, the same gate
//     the `/dev` cheats run behind), so no production realm can be handed
//     geometry nobody authored;
//  2. refused if the id is one the game AUTHORS. The overlay is consulted after
//     the records table so it could never shadow a shipped circuit, but a draft
//     under a shipped id still burns a lane and makes `mortarOverdrivePublicLane`
//     answer for the authored record, which would put two views on one lane;
//  3. refused if a race is LIVE on that id, because registration replaces the
//     record under whoever is driving it;
//  4. refused if the control points are absurd, checked cheaply BEFORE the
//     spline is built (see `withinDraftableBounds`);
//  5. refused unless the geometry is DRIVABLE, measured by the same
//     `mortarOverdriveCircuitMetrics` a content test runs over every shipped
//     circuit. A draft that crosses itself, folds its road round a corner or
//     outgrows the instance band is refused by name rather than seated and
//     discovered at speed.
//
// The sim never FETCHES: the game layer reads the draft off the dev server and
// hands a plain record in (`src/game/mortar_overdrive/draft_dev.ts`). What lands
// here is data, which is what keeps `src/sim/` host-agnostic.

import {
  MORTAR_OVERDRIVE_CIRCUITS,
  type MortarOverdriveCircuit,
} from '../content/mortar_overdrive/circuits';
import type { SimContext } from '../sim_context';
import { mortarOverdriveCircuitErrors, mortarOverdriveCircuitMetrics } from './circuit_metrics';
import { putMortarOverdriveDraftCircuit } from './draft_registry';
import {
  MORTAR_OVERDRIVE_MAX_REGION_HALF_X,
  MORTAR_OVERDRIVE_MAX_REGION_HALF_Z,
  mortarOverdrivePublicLane,
} from './layout';

export interface MortarOverdriveDraftRegistration {
  /** Lane the draft stands on, or -1 when it was refused. */
  lane: number;
  /**
   * Why it was refused, English, empty when it was not. Dev-channel text: this
   * whole surface is behind `devCommands` and its only reader is a dev command
   * readout, which stays English like every other tool here.
   */
  problems: readonly string[];
}

const refused = (...problems: string[]): MortarOverdriveDraftRegistration => ({
  lane: -1,
  problems,
});

/**
 * How far a control point may sit from the circuit's origin before the record
 * is refused without measuring it, yards.
 *
 * This is a COST guard, not a rule: the rule is the metrics core's
 * `region_outside_band`, and this is deliberately twice as permissive so it can
 * never refuse a circuit the real check would have accepted. What it stops is
 * the pathological case, which the payload validator alone admits: 256 points
 * anywhere in a 10 000 yard window resample at one yard into a 40 000 sample
 * lap, and the nearest-approach sweep is quadratic in that. A hand-edited
 * scratch file should not be able to wedge the tab it is being raced from.
 */
const DRAFT_MAX_HALF_X = 2 * MORTAR_OVERDRIVE_MAX_REGION_HALF_X;
const DRAFT_MAX_HALF_Z = 2 * MORTAR_OVERDRIVE_MAX_REGION_HALF_Z;

/** The bounding box of a record's control points, against the guard above. */
function withinDraftableBounds(circuit: MortarOverdriveCircuit): boolean {
  for (const point of circuit.controlPoints) {
    if (Math.abs(point.x) > DRAFT_MAX_HALF_X) return false;
    if (Math.abs(point.z) > DRAFT_MAX_HALF_Z) return false;
  }
  return true;
}

/** Whether a race is running on this circuit right now, public or practice. */
function raceLiveOn(ctx: SimContext, id: string): boolean {
  if (ctx.mortarOverdrive.match?.circuitId === id) return true;
  return ctx.mortarOverdrive.practices.some((match) => match.circuitId === id);
}

/**
 * Register a drawn circuit for this session and report the lane it stands on.
 * Dev only: it makes a circuit drawn in the editor raceable for this session.
 *
 * `Sim` keeps a thin delegate because the caller is FOREIGN (the client's dev
 * command glue holds a `Sim`, not a `SimContext`); the rules, the dev gate and
 * the "is this drivable geometry" check all live here.
 *
 * Registering the same id again REPLACES the record and keeps the lane, which
 * is the redraw-and-race-again loop: the geometry derivations behind it are
 * memoized per id against the record's identity, so they rebuild by themselves
 * (`memoizePerCircuit` in `mortar_overdrive/spline.ts` is one entry wide for
 * exactly this).
 */
export function mortarOverdriveRegisterDraftCircuit(
  ctx: SimContext,
  circuit: MortarOverdriveCircuit,
): MortarOverdriveDraftRegistration {
  if (!ctx.devCommands) return refused('dev commands are disabled');
  if (MORTAR_OVERDRIVE_CIRCUITS[circuit.id]) {
    // Not merely redundant: a draft here would take a lane of its own AND make
    // `mortarOverdrivePublicLane` answer that lane for the AUTHORED record, so the
    // authored view and the draft view would both claim it.
    return refused(`authored_circuit_id: '${circuit.id}' is a circuit the game ships; rename it`);
  }
  if (raceLiveOn(ctx, circuit.id)) {
    // Replacing the record under a live race swaps the geometry beneath four
    // machines mid-lap. Refusing the REGISTRATION is the honest place to stop:
    // refusing only the re-race would already have done the damage.
    return refused(`race_in_progress: a race is running on '${circuit.id}'`);
  }
  if (!withinDraftableBounds(circuit)) {
    return refused(
      `control_points_out_of_bounds: a point sits past ${DRAFT_MAX_HALF_X} x ${DRAFT_MAX_HALF_Z} yd from the circuit origin`,
    );
  }
  const errors = mortarOverdriveCircuitErrors(mortarOverdriveCircuitMetrics(circuit));
  if (errors.length > 0) {
    return refused(
      ...errors.map(
        (problem) =>
          `${problem.code}${problem.axis ? ` (${problem.axis})` : ''}: ${problem.value.toFixed(1)} against ${problem.limit.toFixed(1)}`,
      ),
    );
  }
  putMortarOverdriveDraftCircuit(circuit);
  // Dev lanes append after every authored lane, so nothing already in the band
  // moves; the layout leaf owns that arithmetic and reports it here.
  return { lane: mortarOverdrivePublicLane(circuit), problems: [] };
}
