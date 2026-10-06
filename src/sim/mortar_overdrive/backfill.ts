// When house pilots fill a short queue, as pure arithmetic over the waiters'
// join ticks: the wait, the tier they drive at, the tick the fill lands on and
// the queue's start readout. A leaf with no SimContext and no rng, so the online
// backfill (`bots.ts`), the readout the window counts down from (`race.ts`) and
// presentation (the queue card's bar) all read ONE deadline and cannot drift.

import type { MortarOverdriveQueueStart } from '../../world_api/mortar_overdrive';
import { TICK_RATE } from '../types';
import type { MortarOverdriveDriverTier } from './driver';
import { MORTAR_OVERDRIVE_GRID_SIZE } from './layout';

/**
 * How long the oldest waiter in the queue sits before the Society sends house
 * pilots out to fill the grid. Long enough that four humans who all walked up
 * still get a real race, short enough that the minigame is never a dead end:
 * measured on the OLDEST waiter, so a lone queuer gets a race in 45 s and a
 * queue of three never waits on a fourth human forever.
 */
export const MORTAR_OVERDRIVE_BACKFILL_TICKS = 45 * TICK_RATE;

/** The tier the online backfill (and Start now) sends. The middle one: a lone
 *  queuer asked for a race, not for a lesson, and never chose a difficulty. */
export const MORTAR_OVERDRIVE_BACKFILL_TIER: MortarOverdriveDriverTier = 'driver';

/**
 * The tick the backfill seats `waiters` on, or null when it never will: nobody
 * free to sit, or a full grid of them (the queue pop's business). The clock is
 * the OLDEST waiter's, so anyone who joined behind them races sooner than their
 * own wait, and nobody at the head is ever made to wait longer because the queue
 * grew. A waiter with no join tick counts as joining `now`.
 */
export function mortarOverdriveBackfillAt(
  waiters: readonly number[],
  queuedAtTick: ReadonlyMap<number, number>,
  now: number,
): number | null {
  if (waiters.length === 0 || waiters.length >= MORTAR_OVERDRIVE_GRID_SIZE) return null;
  let oldest = now;
  for (const pid of waiters) {
    const joinedAt = queuedAtTick.get(pid);
    if (joinedAt !== undefined && joinedAt < oldest) oldest = joinedAt;
  }
  return oldest + MORTAR_OVERDRIVE_BACKFILL_TICKS;
}

/** What the queue readout is built from, gathered by the race module. */
export interface MortarOverdriveQueueStartInput {
  viewer: number;
  queue: readonly number[];
  /** The first queued pilots free to sit now (`mortarOverdriveSeatableWaiters`). */
  waiters: readonly number[];
  queuedAtTick: ReadonlyMap<number, number>;
  now: number;
  /** House pilots fill a short grid on their own (`cfg.mortarOverdriveBackfill`). */
  backfill: boolean;
  /** A public race holds the one public lane. */
  laneBusy: boolean;
  nameOf(pid: number): string;
}

/**
 * The start readout of a queued viewer: the queue head that takes the grid, and
 * how long until house pilots fill the rest. The ticks left are exact at `now`;
 * they are null where nothing fills the grid on its own (no backfill here, or
 * nobody free to sit) and while the lane is busy, since the fill then waits for
 * that race to end rather than for the clock.
 */
export function buildMortarOverdriveQueueStart(
  input: MortarOverdriveQueueStartInput,
): MortarOverdriveQueueStart {
  const seats = [];
  const size = Math.min(input.queue.length, MORTAR_OVERDRIVE_GRID_SIZE);
  for (let i = 0; i < size; i++) {
    const pid = input.queue[i] as number;
    seats.push({ name: input.nameOf(pid), you: pid === input.viewer });
  }
  const at =
    input.backfill && !input.laneBusy
      ? mortarOverdriveBackfillAt(input.waiters, input.queuedAtTick, input.now)
      : null;
  return {
    seats,
    startsInTicks: at === null ? null : Math.max(0, at - input.now),
    laneBusy: input.laneBusy,
    backfill: input.backfill,
  };
}
