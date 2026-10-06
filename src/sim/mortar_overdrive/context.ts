// Mortar Overdrive's SimContext bindings and tick phase, beside the coordinator
// (the world_quest_context.ts pattern): the host constructs ctx before assigning
// it, so every callback reads `sim.ctx` when called, never during binding. It is
// also the coordinator's ONE Mortar Overdrive module: every name sim.ts reaches for
// rides the re-exports below through one namespace import, plus the save
// fragment, imported by name because the save-key guard
// (tests/professions_blob_growth.test.ts) resolves only named helper calls.
import type { CharacterState } from '../character_state';
import type { Sim } from '../sim';
import type { SimContext } from '../sim_context';
import * as mortarOverdriveBotsMod from './bots';
import { isMortarOverdriveDriverTier } from './driver';
import * as mortarOverdriveMod from './race';

export type {
  MortarOverdriveInfo,
  MortarOverdriveLaneView,
} from '../../world_api/mortar_overdrive';
export type { MortarOverdriveCircuit } from '../content/mortar_overdrive/circuits';
export { startMortarOverdriveNow, startMortarOverdrivePractice } from './bots';
export {
  type MortarOverdriveDraftRegistration,
  mortarOverdriveRegisterDraftCircuit,
} from './drafts';
export type { MortarOverdriveDriverTier } from './driver';
export {
  createMortarOverdriveState,
  type MortarOverdrivePlayerMeta,
  type MortarOverdriveState,
  mortarOverdriveForfeit,
  mortarOverdriveInfoFor,
  mortarOverdriveQueueJoin,
  mortarOverdriveQueueLeave,
  mortarOverdriveReady,
  mortarOverdriveResetPosition,
  mortarOverdriveTracksideFor,
} from './race';

type MortarOverdriveBindings = Pick<
  SimContext,
  | 'mortarOverdriveFireGroundBlast'
  | 'mortarOverdriveSpendPickupEffect'
  | 'mortarOverdriveDevRace'
  | 'mortarOverdriveDevGrantKit'
>;

/** The Mortar Overdrive arms (mortar_overdrive/race.ts). */
export function mortarOverdriveContextBindings(sim: Sim): MortarOverdriveBindings {
  return {
    mortarOverdriveFireGroundBlast: (caster) =>
      mortarOverdriveMod.mortarOverdriveFireGroundBlast(sim.ctx, caster),
    mortarOverdriveSpendPickupEffect: (caster, effect) =>
      mortarOverdriveMod.mortarOverdriveSpendPickupEffect(sim.ctx, caster, effect),
    mortarOverdriveDevRace: (circuitId, tier, pid) =>
      isMortarOverdriveDriverTier(tier)
        ? mortarOverdriveBotsMod.startMortarOverdriveDevRace(sim, circuitId, tier, pid)
        : false,
    mortarOverdriveDevGrantKit: (pid, charges) =>
      mortarOverdriveMod.mortarOverdriveDevGrantKit(sim.ctx, pid, charges),
  };
}

/**
 * The Mortar Overdrive save fragment: a seated pilot's pre-race state laid over the
 * live fields serializeCharacter already wrote (`mortarOverdriveSaveOverlay`), and
 * nothing off the grid. Declared here, with its keys in the return type, so the
 * save-key guard can read what it writes.
 */
export function mortarOverdriveSaveFragment(
  ctx: SimContext,
  pid: number,
): {
  pos?: CharacterState['pos'];
  facing?: number;
  hp?: number;
  resource?: number;
  resSickness?: number | null;
  unstuckSickness?: number | null;
  cooldowns?: CharacterState['cooldowns'];
} {
  return mortarOverdriveMod.mortarOverdriveSaveOverlay(ctx, pid) ?? {};
}

/** The Mortar Overdrive fields of a freshly built PlayerMeta: only the win count
 *  persists, validated like the other stored meters (bgCaptures): the row is
 *  untrusted, and the win deeds read this count. */
export function freshMortarOverdriveMeta(
  savedState: Pick<CharacterState, 'mortarOverdriveWins'> | undefined,
): mortarOverdriveMod.MortarOverdrivePlayerMeta {
  const stored = savedState?.mortarOverdriveWins;
  const mortarOverdriveWins = Number.isFinite(stored)
    ? Math.max(0, Math.floor(stored as number))
    : 0;
  return { mortarOverdriveMatchId: null, mortarOverdriveWins };
}

/**
 * The Mortar Overdrive tick phase: the match lifecycle, then the house pilots.
 * House pilots drive in the same tick phase, so offline Practice and the
 * server's queue backfill run identical code.
 *
 * The coordinator runs it after all movement has completed, so same-tick
 * finishes are independent of player insertion order. It draws EXACTLY ONE
 * value per pickup box that changes hands (the weighted effect draw, 22b),
 * plus the one circuit draw a queued race takes when it seats a grid (the
 * queue pop or the online backfill); a tick where nobody takes a box and
 * nobody is seated draws nothing at all. The house-pilot half adds nothing:
 * spawning and reaping a pilot (addPlayer, removePlayer) and each pilot's
 * Ground Blast through castAbility are draw-free, pinned over a whole race
 * with pilots firing in tests/mortar_overdrive_bots.test.ts. A human's own cast
 * arrives as a command between ticks, outside this phase and its budget.
 */
export function updateMortarOverdrivePhase(sim: Sim): void {
  mortarOverdriveMod.updateMortarOverdrive(sim.ctx);
  mortarOverdriveBotsMod.updateMortarOverdriveBots(sim);
}
