// Activities a Realm Racers seat must never pull a player out of: each one
// either owns the player's movement ahead of the race's own lock (the cannon
// seat, the glider, the wisp maze, the shadow trial, the ferry deck) or holds
// state the seat cannot hand back (freight is shed by the seat's clean slate,
// a ferry-parked pet respawns wherever its owner stands). The battleground
// arms mirror the arena ones the seat already refuses. Asked by the seat's one
// eligibility test, so the queue join, the queue pop and Practice all agree.
//
// Draws no rng, mutates nothing.

import { gliderActionsLocked } from '../glider_action_lock';
import { shadowActionsLocked } from '../shadow_action_lock';
import { onShipDeck } from '../ship_deck_presence';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import type { Entity } from '../types';
import { wispMazeActionsLocked } from '../wisp_maze_action_lock';
import { hasWorldQuestDeliveryCargo } from '../world_quest_delivery';
import { bgGroupContaining } from './battleground';
import { bgProposalFor } from './battleground_proposal';

export function realmRacersHeldElsewhere(ctx: SimContext, meta: PlayerMeta, e: Entity): boolean {
  // A moderation prisoner stays in the cage: a seat would teleport them out.
  if (e.jailed) return true;
  const log = meta.worldQuestLog;
  if (meta.vehicle || wispMazeActionsLocked(log) || shadowActionsLocked(log)) return true;
  if (gliderActionsLocked(log) || hasWorldQuestDeliveryCargo(e)) return true;
  if (e.ferryRide || e.ferryPetParked || onShipDeck(ctx, e)) return true;
  const pid = meta.entityId;
  return ctx.bgMatches.has(pid) || !!bgGroupContaining(ctx, pid) || !!bgProposalFor(ctx, pid);
}
