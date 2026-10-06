import { mortarOverdriveUnready } from '../src/sim/mortar_overdrive/race';
import type { Sim } from '../src/sim/sim';
import { emptyMoveInput } from '../src/sim/types';
import { leaveWispMaze } from '../src/sim/world_quest_wisp_maze';

/** A dropped socket drops carried freight, releases a manned cannon, cannot keep
 *  steering or lose maze lives while disconnected, and is no longer ready in a
 *  Mortar Overdrive loading lobby. */
export function stopDisconnectedPlayerInput(sim: Sim, pid: number): void {
  sim.dropWorldQuestDeliveryCargo(pid);
  sim.leaveVehicle(pid);
  const meta = sim.meta(pid);
  if (!meta) return;
  mortarOverdriveUnready(sim.ctx, pid);
  Object.assign(meta.moveInput, emptyMoveInput());
  const player = sim.entities.get(pid);
  if (player) leaveWispMaze(sim.ctx, meta, player);
}
