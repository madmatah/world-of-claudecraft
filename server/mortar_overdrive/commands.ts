// The Mortar Overdrive command-case bodies, behind one case group in
// server/game.ts (the bank_wire.ts seam: game.ts sits at a zero-margin monolith
// ceiling, so new dispatch surface lands in a sibling). Shape checks only; the
// Sim re-validates every rule (for Practice: a free circuit copy and a sender
// able to race; for ready: a seated pilot of a race still loading) and refuses
// silently, like the queue join.
import { isMortarOverdriveDriverTier } from '../../src/sim/mortar_overdrive/driver';
import { mortarOverdriveReady } from '../../src/sim/mortar_overdrive/race';
import type { Sim } from '../../src/sim/sim';
import type { Entity, Vec3 } from '../../src/sim/types';

export type MortarOverdriveCommandName =
  | 'mortar_overdrive_join'
  | 'mortar_overdrive_leave'
  | 'mortar_overdrive_forfeit'
  | 'mortar_overdrive_reset'
  | 'mortar_overdrive_practice'
  | 'mortar_overdrive_ready';

export type MortarOverdriveCommandSim = Pick<
  Sim,
  | 'ctx'
  | 'mortarOverdriveQueueJoin'
  | 'mortarOverdriveQueueLeave'
  | 'mortarOverdriveForfeit'
  | 'mortarOverdriveResetPosition'
  | 'mortarOverdrivePracticeStart'
>;

export function dispatchMortarOverdriveCommand(
  sim: MortarOverdriveCommandSim,
  cmd: MortarOverdriveCommandName,
  msg: Record<string, unknown>,
  pid: number,
): void {
  switch (cmd) {
    case 'mortar_overdrive_join':
      sim.mortarOverdriveQueueJoin(pid);
      break;
    case 'mortar_overdrive_leave':
      sim.mortarOverdriveQueueLeave(pid);
      break;
    case 'mortar_overdrive_forfeit':
      sim.mortarOverdriveForfeit(pid);
      break;
    case 'mortar_overdrive_reset':
      sim.mortarOverdriveResetPosition(pid);
      break;
    case 'mortar_overdrive_practice':
      if (isMortarOverdriveDriverTier(msg.tier)) sim.mortarOverdrivePracticeStart(msg.tier, pid);
      break;
    case 'mortar_overdrive_ready':
      mortarOverdriveReady(sim.ctx, pid);
      break;
  }
}

/**
 * Out of the Mortar Overdrive (queue and seat) before a moderation move takes the body
 * somewhere else, as the jail paths do: a seat left standing would have the
 * race return the body out of wherever the move put it. The race restores the
 * body first, so the position returned is where the race found them, never a
 * spot on the circuit, and it is what the caller saves to come back to.
 */
export function leaveMortarOverdriveForModeration(
  sim: Pick<Sim, 'mortarOverdriveForfeit'>,
  pid: number,
  entity: Entity,
): Vec3 {
  sim.mortarOverdriveForfeit(pid, true);
  return { ...entity.pos };
}
