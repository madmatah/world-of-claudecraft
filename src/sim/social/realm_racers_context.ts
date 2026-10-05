// The Realm Racers' SimContext bindings and tick phase, beside the coordinator
// (the world_quest_context.ts pattern): the host constructs ctx before assigning
// it, so every callback reads `sim.ctx` when called, never during binding. It is
// also the coordinator's ONE Realm Racers import: every name sim.ts reaches for
// rides the re-exports below, so the monolith carries a single import line.
import type { CharacterState } from '../character_state';
import { isRallyDriverTier } from '../realm_racers_driver';
import type { Sim } from '../sim';
import type { SimContext } from '../sim_context';
import * as realmRacersMod from './realm_racers';
import * as realmRacersBotsMod from './realm_racers_bots';

export type { RealmRacersInfo, RealmRacersLaneView } from '../../world_api/realm_racers';
export type { RealmRacersCircuit } from '../content/realm_racers_circuits';
export {
  type RealmRacersDraftRegistration,
  realmRacersRegisterDraftCircuit,
} from '../realm_racers_drafts';
export type { RallyDriverTier } from '../realm_racers_driver';
export {
  createRealmRacersState,
  type RealmRacersPlayerMeta,
  type RealmRacersState,
  realmRacersForfeit,
  realmRacersInfoFor,
  realmRacersQueueJoin,
  realmRacersQueueLeave,
  realmRacersReady,
  realmRacersResetPosition,
  realmRacersSaveOverlay,
  realmRacersTracksideFor,
} from './realm_racers';
export { startRealmRacersPractice } from './realm_racers_bots';

type RealmRacersBindings = Pick<
  SimContext,
  | 'realmRacersFireGroundBlast'
  | 'realmRacersSpendPickupEffect'
  | 'realmRacersDevRace'
  | 'realmRacersDevGrantKit'
>;

/** The Realm Racers rally arms (social/realm_racers.ts). */
export function realmRacersContextBindings(sim: Sim): RealmRacersBindings {
  return {
    realmRacersFireGroundBlast: (caster) =>
      realmRacersMod.realmRacersFireGroundBlast(sim.ctx, caster),
    realmRacersSpendPickupEffect: (caster, effect) =>
      realmRacersMod.realmRacersSpendPickupEffect(sim.ctx, caster, effect),
    realmRacersDevRace: (circuitId, tier, pid) =>
      isRallyDriverTier(tier)
        ? realmRacersBotsMod.startRealmRacersDevRace(sim, circuitId, tier, pid)
        : false,
    realmRacersDevGrantKit: (pid, charges) =>
      realmRacersMod.realmRacersDevGrantKit(sim.ctx, pid, charges),
  };
}

/** The Realm Racers fields of a freshly built PlayerMeta: only the win count
 *  persists, validated like the other stored meters (bgCaptures): the row is
 *  untrusted, and the win deeds read this count. */
export function freshRealmRacersMeta(
  savedState: Pick<CharacterState, 'rrWins'> | undefined,
): realmRacersMod.RealmRacersPlayerMeta {
  const stored = savedState?.rrWins;
  const rrWins = Number.isFinite(stored) ? Math.max(0, Math.floor(stored as number)) : 0;
  return { realmRacersMatchId: null, rrWins };
}

/**
 * The Realm Racers tick phase: the match lifecycle, then the house pilots.
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
 * with pilots firing in tests/realm_racers_bots.test.ts. A human's own cast
 * arrives as a command between ticks, outside this phase and its budget.
 */
export function updateRealmRacersPhase(sim: Sim): void {
  realmRacersMod.updateRealmRacers(sim.ctx);
  realmRacersBotsMod.updateRealmRacersBots(sim);
}
