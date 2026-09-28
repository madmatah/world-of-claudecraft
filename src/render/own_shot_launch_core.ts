// The predicted launch of the local pilot's own Ground Blast shell: the pure
// decisions behind drawing the shell leave the barrel on the input frame
// instead of a round trip later, when the server's Fired event arrives.
//
// WHERE and HOW LONG are the sim's own rules, run on the client's own copy of
// the aim: the drawn kart's pose and the point the client sends go through the
// same `resolveGroundBlastAim` clamp the server applies (cone, range band, whole
// ticks of flight). The predicted shell lands when the server's crater will be
// SEEN, one confirmation delay after the sim's flight, so it meets the
// explosion instead of sitting on the ground waiting for it. The confirmation
// delay is the prediction's own lead (`selfFrameLeadMs`, the predictor's tick
// offset over the ack): no ping estimate and no clock of its own.
//
// The explosion stays server-only (the Hit event). A shot the server never
// confirms inside a window derived from that same lead is faded out mid-air,
// and a confirmed one is ADOPTED: the one shell in the air is re-timed onto the
// server's flight and glides onto the server's target, never drawn twice.
//
// Pure contract: no three import, no DOM, no clocks (the caller passes its own
// frame clock in seconds), no randomness. Registered in RENDER_PURE_CORES.

import {
  GROUND_BLAST_MUZZLE_NOSE_YD,
  resolveGroundBlastAim,
} from '../sim/realm_racers_ground_blast';
import { DT, TICK_RATE } from '../sim/types';

/** Where a shell leaves a machine at (x, z) facing `facing`: the server's muzzle
 *  offset up the nose (the Fired event's own emit site). */
export function ownShotMuzzle(x: number, z: number, facing: number): { x: number; z: number } {
  return {
    x: x + Math.sin(facing) * GROUND_BLAST_MUZZLE_NOSE_YD,
    z: z + Math.cos(facing) * GROUND_BLAST_MUZZLE_NOSE_YD,
  };
}

/**
 * How long a predicted shot waits for the server's Fired event, seconds. The
 * event is due one lead after the press; the window grants a second lead of
 * grace (a late ack is still a live shot) plus the tick the command can wait
 * for the server's tick boundary. Derived from the measured lead only.
 */
export function ownShotConfirmWindowS(leadMs: number): number {
  return (2 * leadMs) / 1000 + DT;
}

/** How long an unconfirmed own shell takes to shrink away, seconds. */
export const OWN_SHOT_UNCONFIRMED_FADE_S = 0.25;

export interface OwnShotLaunch {
  /** Muzzle, from the drawn kart. */
  x: number;
  z: number;
  /** The impact point, clamped exactly as the sim clamps it. */
  targetX: number;
  targetZ: number;
  /** The sim's flight plus the confirmation delay (when the crater shows),
   *  and never shorter than the confirmation window plus the fade: a shell
   *  that landed before its window closed would let a late Fired event draw a
   *  second one. */
  flightSeconds: number;
  /** `ownShotConfirmWindowS` of this launch's lead. */
  confirmWithinS: number;
}

/**
 * The local launch of a shot fired from the drawn pose at `requested` (the
 * point the client sends; null fires blind down the nose, as the sim does), or
 * null when there is no lead to time it by (the kart is not predicted, or the
 * host is offline, where the Fired event lands on the same frame anyway).
 */
export function planOwnShotLaunch(
  pose: { x: number; z: number; facing: number },
  requested: { x: number; z: number } | null,
  leadMs: number | null,
): OwnShotLaunch | null {
  if (leadMs === null || !Number.isFinite(leadMs) || leadMs < 0) return null;
  const aim = resolveGroundBlastAim(pose, requested);
  const muzzle = ownShotMuzzle(pose.x, pose.z, pose.facing);
  const confirmWithinS = ownShotConfirmWindowS(leadMs);
  return {
    x: muzzle.x,
    z: muzzle.z,
    targetX: aim.x,
    targetZ: aim.z,
    flightSeconds: Math.max(
      aim.flightTicks / TICK_RATE + leadMs / 1000,
      confirmWithinS + OWN_SHOT_UNCONFIRMED_FADE_S,
    ),
    confirmWithinS,
  };
}

/** The one predicted shot awaiting its server confirmation. */
export interface OwnShotPending {
  ownerId: number;
  /** Which pooled shell draws it, and that slot's launch serial (a recycled
   *  slot is never mistaken for it). */
  slot: number;
  serial: number;
  /** Frame-clock deadline for the Fired event, seconds. */
  confirmBy: number;
}

export interface OwnShotLedger {
  pending: OwnShotPending | null;
}

export function createOwnShotLedger(): OwnShotLedger {
  return { pending: null };
}

/** A predicted shell just left the barrel. One in flight at a time: a newer
 *  launch replaces an older one still pending, which is returned so the caller
 *  fades it (it can no longer be adopted). */
export function recordOwnShotLaunch(
  ledger: OwnShotLedger,
  ownerId: number,
  slot: number,
  serial: number,
  nowS: number,
  confirmWithinS: number,
): OwnShotPending | null {
  const replaced = ledger.pending;
  ledger.pending = { ownerId, slot, serial, confirmBy: nowS + confirmWithinS };
  return replaced;
}

/**
 * A Fired event arrived from `sourceId`. The predicted shot it confirms, which
 * the caller adopts instead of drawing a second shell, or null (not the
 * pilot's own shot, nothing pending, or it arrived after the window, where the
 * predicted shell is already fading and the event draws on its own). Claiming
 * clears the pending shot either way once it is the pilot's own event.
 */
export function claimOwnShotLaunch(
  ledger: OwnShotLedger,
  sourceId: number,
  nowS: number,
): OwnShotPending | null {
  const pending = ledger.pending;
  if (!pending || pending.ownerId !== sourceId) return null;
  ledger.pending = null;
  return nowS <= pending.confirmBy ? pending : null;
}

/** The predicted shot to fade out, once its window has passed with no Fired
 *  event, or null. Clears it. */
export function expireOwnShotLaunch(ledger: OwnShotLedger, nowS: number): OwnShotPending | null {
  const pending = ledger.pending;
  if (!pending || nowS <= pending.confirmBy) return null;
  ledger.pending = null;
  return pending;
}

/**
 * The progress along a shell's path `elapsed` seconds into a flight of
 * `flight` seconds that started at progress `from` (0 for a fresh launch, the
 * progress already drawn for an adopted one): continuous at the adoption, and
 * exactly 1 when the flight ends.
 */
export function shellProgress(from: number, elapsed: number, flight: number): number {
  const u = flight > 0 ? Math.min(1, Math.max(0, elapsed / flight)) : 1;
  return from + (1 - from) * u;
}
