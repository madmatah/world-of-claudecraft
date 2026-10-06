// The one place a Mortar Overdrive circuit id becomes a name a player can read.
//
// A circuit's id is wire data (`MortarOverdriveMatchInfo.circuitId`), and every
// surface that names one, the race strip through the countdown, the podium
// heading and the practice setup screen, resolves it here rather than carrying
// its own map. The key is derived from the id by construction, so authoring a
// circuit and authoring its name are one edit in two files and cannot drift
// into a switch statement somebody forgets.
//
// The `sim_i18n.ts` / `deed_i18n.ts` shape: it owns the id-to-key rule and
// nothing else. No DOM, no state, no fallback text.

import { tOptional } from '../../i18n';

/**
 * The player-facing name of a circuit, or null when nothing names it.
 *
 * Null is a real answer, not a failure: `mortarOverdriveCircuitById` resolves DRAFT
 * circuits a dev command registered for one session
 * (`src/sim/mortar_overdrive/draft_registry.ts`), and those never have a catalog
 * key. Every caller hides its line rather than showing a raw id, which is why
 * this returns null instead of the id: an id is not copy.
 *
 * `tOptional` rather than `t`, for the same reason: `t` throws on an untracked
 * key in dev and test, and a draft circuit is exactly that.
 */
export function mortarOverdriveCircuitName(circuitId: string): string | null {
  if (!circuitId) return null;
  return tOptional(`hudChrome.mortarOverdrive.circuitName_${circuitId}`);
}
