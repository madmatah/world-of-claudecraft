// The Realm Racers' SimContext bindings and tick phase, beside the coordinator
// (the world_quest_context.ts pattern): the host constructs ctx before assigning
// it, so every callback reads `sim.ctx` when called, never during binding.
import { isRallyDriverTier } from '../realm_racers_driver';
import type { Sim } from '../sim';
import type { SimContext } from '../sim_context';
import * as realmRacersMod from './realm_racers';
import * as realmRacersBotsMod from './realm_racers_bots';

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

/**
 * The Realm Racers tick phase: the match lifecycle, then the house pilots.
 * House pilots drive in the same tick phase, so offline Practice and the
 * server's queue backfill run identical code.
 */
export function updateRealmRacersPhase(sim: Sim): void {
  realmRacersMod.updateRealmRacers(sim.ctx);
  realmRacersBotsMod.updateRealmRacersBots(sim);
}
