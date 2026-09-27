import type { Sim } from '../src/sim/sim';
import { realmRacersUnready } from '../src/sim/social/realm_racers';
import { emptyMoveInput } from '../src/sim/types';
import { leaveWispMaze } from '../src/sim/world_quest_wisp_maze';

/** A dropped socket drops carried freight, releases a manned cannon, cannot keep
 *  steering or lose maze lives while disconnected, and is no longer ready in a
 *  Realm Racers loading lobby. */
export function stopDisconnectedPlayerInput(sim: Sim, pid: number): void {
  sim.dropWorldQuestDeliveryCargo(pid);
  sim.leaveVehicle(pid);
  const meta = sim.meta(pid);
  if (!meta) return;
  realmRacersUnready(sim.ctx, pid);
  Object.assign(meta.moveInput, emptyMoveInput());
  const player = sim.entities.get(pid);
  if (player) leaveWispMaze(sim.ctx, meta, player);
}
