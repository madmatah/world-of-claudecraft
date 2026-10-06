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

import { type Entity, TICK_RATE } from '../types';

/** The aura that marks a ghosted racer. It rides the ordinary entity aura wire,
 *  so every client (a rival about to drive through it included) reads it. Its
 *  id is also its kind, the way the ward's is. */
export const MORTAR_OVERDRIVE_GHOST_AURA = 'mortar_overdrive_ghost';
/** Player-visible aura name, localized at the client boundary (sim_i18n.ts). */
export const MORTAR_OVERDRIVE_GHOST_AURA_NAME = 'Ghosted';
/**
 * The shortest a ghost lasts, ticks from the recovery, whatever lock the
 * recovery carried.
 *
 * It is keyed to the RECOVERY, not to the lock, because the pilot it protects
 * is the follower: the automatic recoveries hand control back after one tick
 * and the cut return after one second, and the follower is still arriving. The
 * farthest a shooter stands behind a machine it knocks off the road is the
 * Ground Blast's maximum range (70 yd, `GROUND_BLAST_MAX_RANGE`); at a racing
 * pace of about 47 yd/s (just under four fifths of the 60 yd/s top speed)
 * that is 1.5 s, which is this.
 */
export const MORTAR_OVERDRIVE_GHOST_MIN_TICKS = (3 * TICK_RATE) / 2;
/**
 * How long past its earliest clear tick a ghost may last at most, ticks.
 *
 * The ghost normally ends the first tick it may clear and is clear of every
 * rival; the margin bounds how long an overlap can keep it going past that, and
 * one second of driving is enough to part two machines that want to be parted.
 * The window itself is intangible driving by design (about 1.5 s after an
 * automatic recovery's one-tick lock), and the recovery that opened it already
 * cost the pilot the trip back to the last anchor.
 */
export const MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS = TICK_RATE;

/** The window one recovery opens: exclusive ticks, the lock's convention. */
export interface MortarOverdriveGhostWindow {
  /** The first tick the ghost may end on, if the machine is clear. */
  earliestClearTick: number;
  /** The tick it ends on whatever the overlap. */
  capTick: number;
}

/**
 * The ghost window a recovery at `resetTick` opens, given the lock it wrote
 * (`resetLockedUntilTick`, 0 for none). A function of this one recovery only:
 * a second recovery inside a live window REPLACES it, so repeated resets can
 * never stack a longer ghost than one fresh reset gives.
 */
export function mortarOverdriveGhostWindow(
  resetTick: number,
  lockedUntilTick: number,
): MortarOverdriveGhostWindow {
  const earliestClearTick = Math.max(
    lockedUntilTick,
    resetTick + MORTAR_OVERDRIVE_GHOST_MIN_TICKS + 1,
  );
  return { earliestClearTick, capTick: earliestClearTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS };
}

/** Is this machine a ghost right now? The one question every ghost site asks. */
export function mortarOverdriveGhosted(racer: Entity | undefined | null): boolean {
  return !!racer?.auras.some((aura) => aura.id === MORTAR_OVERDRIVE_GHOST_AURA);
}

/** One machine's hull on the ground: the contact reach is the sum of two radii. */
export interface MortarOverdriveGhostHull {
  x: number;
  z: number;
  radius: number;
}

/** Do two hulls overlap? The same circles, and the same reach, the contact pass
 *  resolves; touching exactly at the reach is clear. */
export function mortarOverdriveHullsOverlap(
  a: MortarOverdriveGhostHull,
  b: MortarOverdriveGhostHull,
): boolean {
  const reach = a.radius + b.radius;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz < reach * reach;
}

/** A hull plus where it STARTED the tick (Entity.prevPos). */
export interface MortarOverdriveGhostSweptHull extends MortarOverdriveGhostHull {
  prevX: number;
  prevZ: number;
}

/**
 * Did two hulls come within reach at any point of this tick's motion (linear
 * within the tick, the contact pass's own assumption)? The end-of-tick overlap
 * alone misses a rival that tunnels clean through the ghost on the tick it
 * would clear, and the swept contact pass would then resolve that crossing as a
 * hit. The closest approach over the tick is a superset of every crossing the
 * swept pass can resolve, so clearing never lands inside one.
 */
export function mortarOverdriveHullsMeetInTick(
  a: MortarOverdriveGhostSweptHull,
  b: MortarOverdriveGhostSweptHull,
): boolean {
  if (mortarOverdriveHullsOverlap(a, b)) return true;
  const reach = a.radius + b.radius;
  const px = b.prevX - a.prevX;
  const pz = b.prevZ - a.prevZ;
  const vx = b.x - b.prevX - (a.x - a.prevX);
  const vz = b.z - b.prevZ - (a.z - a.prevZ);
  const vv = vx * vx + vz * vz;
  const t = vv > 0 ? Math.min(1, Math.max(0, -(px * vx + pz * vz) / vv)) : 0;
  const cx = px + vx * t;
  const cz = pz + vz * t;
  return cx * cx + cz * cz < reach * reach;
}

export interface MortarOverdriveGhostClearInput extends MortarOverdriveGhostWindow {
  tick: number;
  /** Does the ghost's hull overlap any other machine on the grid, at the end
   *  of this tick or anywhere along the tick's motion? */
  overlapping: boolean;
}

/**
 * May the ghost end on this tick? Only once the window allows it (the lock is
 * over AND the recovery is old enough) and the machine is clear of every rival,
 * since ending it inside another hull would spawn two machines in each other;
 * or at the cap, whatever the overlap.
 */
export function mortarOverdriveGhostMayClear(input: MortarOverdriveGhostClearInput): boolean {
  if (input.tick >= input.capTick) return true;
  return input.tick >= input.earliestClearTick && !input.overlapping;
}

/**
 * Does a contact the contact pass resolved count as RIVAL contact (the
 * clean-race deed's flag)? Not between a pair still PARTING: one of them is a
 * ghost that ended inside the other (only the cap ends one there), and the push
 * that separates them is the race's doing, not a pilot's. Each list holds the
 * machines that pilot's ghost ended inside; a contact with anyone else counts.
 */
export function mortarOverdriveContactCounts(
  aPid: number,
  aParting: readonly number[] | undefined,
  bPid: number,
  bParting: readonly number[] | undefined,
): boolean {
  return !aParting?.includes(bPid) && !bParting?.includes(aPid);
}

/**
 * The tick a parting opened at `capTick` ends on whatever the overlap: the same
 * one-second margin a ghost gets to shake off an overlap. Without it a pair held
 * together (pinned on a wall, or a blast throwing one back into the other)
 * would stay exempt for as long as they touched.
 */
export function mortarOverdrivePartingEndTick(capTick: number): number {
  return capTick + MORTAR_OVERDRIVE_GHOST_MARGIN_TICKS;
}

/**
 * Keep only the partners a machine still meets this tick (`stillMeeting`, the
 * ghost's own swept hull test), and none from `endTick` on (exclusive, the
 * lock's convention). One tick apart ends a parting for good, so the next
 * contact between that pair counts like any other. In place.
 */
export function mortarOverdriveKeepParting(
  partners: number[],
  tick: number,
  endTick: number,
  stillMeeting: (pid: number) => boolean,
): void {
  if (tick >= endTick) {
    partners.length = 0;
    return;
  }
  let kept = 0;
  for (let i = 0; i < partners.length; i++) {
    if (stillMeeting(partners[i])) partners[kept++] = partners[i];
  }
  partners.length = kept;
}
