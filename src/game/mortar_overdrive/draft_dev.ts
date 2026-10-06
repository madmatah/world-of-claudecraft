// `/dev overdrivedraft <id> [tier]`: race a circuit that was drawn in the editor,
// without a source edit and without a restart.
//
// It lives in the GAME layer rather than in `src/sim/dev_commands.ts` for one
// reason that decides the whole shape: the sim never fetches. So the client
// reads the draft off the dev server, validates it with the SAME core the save
// endpoint validates with, and hands the sim a plain record; the sim's own
// `/dev overdrive` then races it, because a registered draft resolves through
// `mortarOverdriveCircuitById` exactly like an authored circuit.
//
// The loop it closes: draw, Save draft, alt-tab, run the command, watch the
// countdown. Redraw, save again, run it again: re-registering an id replaces
// the record and keeps its lane.
//
// Offline dev builds only. The endpoints it reads are registered in
// `configureServer` (`vite.config.ts`), which runs under the dev server and
// nowhere else, and the sim refuses the registration outright unless dev
// commands are on. Dev-channel text throughout, English like every other tool
// here.

import { validateCircuitPayload } from '../../editor/circuit/export_core';
import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import { MORTAR_OVERDRIVE_DRIVER_TIERS } from '../../sim/mortar_overdrive/driver';

/** Where the dev server answers. Kept beside the parser so the one place that
 *  knows the endpoint shape is the one place that knows the command. */
export const CIRCUIT_DRAFT_ENDPOINT = '/__circuit_editor/draft';
/** The draft LIST, read by the editor's own Load dialog so nobody has to
 *  remember an id. Both constants live here rather than beside the dialog for
 *  the same reason: the one place that knows the endpoint shape is the one place
 *  that knows the command it was written for. */
export const CIRCUIT_DRAFT_LIST_ENDPOINT = '/__circuit_editor/drafts';

/**
 * The id shape the save endpoint writes files under. Re-checked here so a
 * mistyped command is refused by name instead of turning into a request the
 * dev server has to reject.
 */
const DRAFT_ID_RE = /^[a-z][a-z0-9_]{2,40}$/;

export interface MortarOverdriveDraftCommand {
  id: string;
  tier: string;
}

/**
 * Parse the command, or null when this is not it.
 *
 * PURE, and the reason this module is testable: the fetch, the sim and the
 * renderer are all injected below, so what a Vitest drives is the decision, not
 * a browser.
 */
export function parseMortarOverdriveDraftCommand(raw: string): MortarOverdriveDraftCommand | null {
  const match = /^\/(?:dev\s+overdrivedraft|devoverdrivedraft)\s+(\S+)(?:\s+(\S+))?\s*$/i.exec(
    raw.trim(),
  );
  if (!match) return null;
  const id = match[1];
  if (!DRAFT_ID_RE.test(id)) return null;
  const requested = (match[2] ?? '').toLowerCase();
  const tier = (MORTAR_OVERDRIVE_DRIVER_TIERS as readonly string[]).includes(requested)
    ? requested
    : 'ace';
  return { id, tier };
}

export interface MortarOverdriveDraftDevDeps {
  /** Reads the dev-server endpoint. Injected so a test needs no network. */
  fetchDraft(id: string): Promise<unknown>;
  /** The sim's dev-gated registration; reports the lane, or why it refused. */
  register(circuit: MortarOverdriveCircuit): { lane: number; problems: readonly string[] };
  /** Builds the draft's visual, so the countdown opens on a circuit that
   *  exists rather than on empty lawn. */
  draw(circuit: MortarOverdriveCircuit): void;
  /** Runs a chat command through the world, which is how the race actually
   *  starts: the sim's `/dev overdrive` already races any circuit it can resolve. */
  race(command: string): void;
  /** Dev-channel readout. */
  log(text: string): void;
}

/**
 * Run a parsed command end to end.
 *
 * Every failure is reported by name. The whole point of the tool is a fast
 * loop, and "nothing happened" costs more than a slow loop does.
 */
export async function runMortarOverdriveDraftCommand(
  command: MortarOverdriveDraftCommand,
  deps: MortarOverdriveDraftDevDeps,
): Promise<boolean> {
  let payload: unknown;
  try {
    payload = await deps.fetchDraft(command.id);
  } catch (err) {
    deps.log(`[dev] Could not read draft '${command.id}': ${err}`);
    return false;
  }
  // Validated CLIENT side as well as at the endpoint: the record is about to
  // become world geometry, and the one validator both ends share is the one the
  // editor exports through.
  const circuit = validateCircuitPayload(payload);
  if (!circuit) {
    deps.log(`[dev] Draft '${command.id}' is not a circuit record.`);
    return false;
  }
  if (circuit.id !== command.id) {
    deps.log(`[dev] Draft '${command.id}' carries the id '${circuit.id}'; rename one of them.`);
    return false;
  }
  const registration = deps.register(circuit);
  if (registration.lane < 0) {
    deps.log(`[dev] Draft '${command.id}' refused: ${registration.problems.join('; ')}`);
    return false;
  }
  deps.draw(circuit);
  deps.log(
    `[dev] Draft '${command.id}' is on lane ${registration.lane}; racing it against a grid of ${command.tier} pilots.`,
  );
  deps.race(`/dev overdrive ${command.id} ${command.tier}`);
  return true;
}

/** The default reader: the dev server, same origin, GET only. */
export async function fetchMortarOverdriveDraft(id: string): Promise<unknown> {
  const response = await fetch(`${CIRCUIT_DRAFT_ENDPOINT}/${id}`);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
