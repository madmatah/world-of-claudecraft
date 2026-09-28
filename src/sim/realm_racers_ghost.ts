// The recovery GHOST: a machine the race has just put back on the racing line
// is intangible to rival machines for a short window.
//
// Why it exists: a recovery drops a machine on the line at a standstill and
// locks it there, which is exactly where the pilot who shot it off the road is
// arriving at full speed. Without the window the follower hits a parked, solid
// machine it had no way to avoid.
//
// A pure leaf (no SimContext, no rng, no clock): the sim module owns WHEN the
// ghost starts and asks this file when it may end, and the renderer asks it
// whether a machine it draws is one, so the local bump bang never plays against
// a machine the server will never collide.

import { type Entity, TICK_RATE } from './types';

/** The aura that marks a ghosted racer. It rides the ordinary entity aura wire,
 *  so every client (a rival about to drive through it included) reads it. Its
 *  id is also its kind, the way the ward's is. */
export const REALM_RACERS_GHOST_AURA = 'rally_ghost';
/** Player-visible aura name, localized at the client boundary (sim_i18n.ts). */
export const REALM_RACERS_GHOST_AURA_NAME = 'Ghosted';
/**
 * How long past the MANUAL recovery lock the ghost may last at most, ticks.
 *
 * The ghost normally ends the first tick the machine is unlocked and clear of
 * every rival. The margin only bounds the case where a rival parks on top of it:
 * one second of driving is enough to separate two machines that want to be
 * separated, and short enough that nobody can use the window to pass through a
 * rival they would otherwise have to go around.
 */
export const REALM_RACERS_GHOST_MARGIN_TICKS = TICK_RATE;

/** Is this machine a ghost right now? The one question every ghost site asks. */
export function realmRacersGhosted(racer: Entity | undefined | null): boolean {
  return !!racer?.auras.some((aura) => aura.id === REALM_RACERS_GHOST_AURA);
}

/** One machine's hull on the ground: the contact reach is the sum of two radii. */
export interface RallyGhostHull {
  x: number;
  z: number;
  radius: number;
}

/** Do two hulls overlap? The same circles, and the same reach, the contact pass
 *  resolves; touching exactly at the reach is clear. */
export function rallyHullsOverlap(a: RallyGhostHull, b: RallyGhostHull): boolean {
  const reach = a.radius + b.radius;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz < reach * reach;
}

export interface RallyGhostClearInput {
  tick: number;
  /** The recovery lock's exclusive end tick (`resetLockedUntilTick`). */
  lockedUntilTick: number;
  /** The hard cap's exclusive end tick. */
  capTick: number;
  /** Does the ghost's hull overlap any other machine on the grid right now? */
  overlapping: boolean;
}

/**
 * May the ghost end on this tick? Only once the machine is unlocked AND clear
 * of every rival, since ending it inside another hull would spawn two machines
 * in each other; or at the cap, whatever the overlap.
 */
export function rallyGhostMayClear(input: RallyGhostClearInput): boolean {
  if (input.tick >= input.capTick) return true;
  return input.tick >= input.lockedUntilTick && !input.overlapping;
}
