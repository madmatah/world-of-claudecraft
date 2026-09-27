// The Realm Racers command-case bodies, behind one case group in
// server/game.ts (the bank_wire.ts seam: game.ts sits at a zero-margin monolith
// ceiling, so new dispatch surface lands in a sibling). Shape checks only; the
// Sim re-validates every rule (for Practice: a free circuit copy and a sender
// able to race; for ready: a seated pilot of a race still loading) and refuses
// silently, like the queue join.
import { isRallyDriverTier } from '../src/sim/realm_racers_driver';
import type { Sim } from '../src/sim/sim';
import { realmRacersReady } from '../src/sim/social/realm_racers';

export type RealmRacersCommandName =
  | 'realm_racers_join'
  | 'realm_racers_leave'
  | 'realm_racers_forfeit'
  | 'realm_racers_reset'
  | 'realm_racers_practice'
  | 'realm_racers_ready';

export type RealmRacersCommandSim = Pick<
  Sim,
  | 'ctx'
  | 'realmRacersQueueJoin'
  | 'realmRacersQueueLeave'
  | 'realmRacersForfeit'
  | 'realmRacersResetPosition'
  | 'realmRacersPracticeStart'
>;

export function dispatchRealmRacersCommand(
  sim: RealmRacersCommandSim,
  cmd: RealmRacersCommandName,
  msg: Record<string, unknown>,
  pid: number,
): void {
  switch (cmd) {
    case 'realm_racers_join':
      sim.realmRacersQueueJoin(pid);
      break;
    case 'realm_racers_leave':
      sim.realmRacersQueueLeave(pid);
      break;
    case 'realm_racers_forfeit':
      sim.realmRacersForfeit(pid);
      break;
    case 'realm_racers_reset':
      sim.realmRacersResetPosition(pid);
      break;
    case 'realm_racers_practice':
      if (isRallyDriverTier(msg.tier)) sim.realmRacersPracticeStart(msg.tier, pid);
      break;
    case 'realm_racers_ready':
      realmRacersReady(sim.ctx, pid);
      break;
  }
}
