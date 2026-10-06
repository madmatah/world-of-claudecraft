// Pure core of the Mortar Overdrive queue card: the start card the window shows
// while the viewer is queued. Two halves, like the lobby: the structural view
// (the grid the queue head takes, the solo note) rebuilt behind a signature, and
// the live countdown, stepped every frame into one reused container against the
// client clock so it ticks down smoothly whatever the snapshot cadence.

import { MORTAR_OVERDRIVE_BACKFILL_TICKS } from '../../../sim/mortar_overdrive/backfill';
import { MORTAR_OVERDRIVE_GRID_SIZE } from '../../../sim/mortar_overdrive/layout';
import { TICK_RATE } from '../../../sim/types';
import type { MortarOverdriveQueueStart } from '../../../world_api';

/** One seat of the card's grid: a queued human by name, or an open seat a house
 *  pilot takes (`name` null). */
export interface MortarOverdriveQueueCardSeat {
  name: string | null;
  you: boolean;
}

export interface MortarOverdriveQueueCardView {
  /** Always a full grid: the queued humans first, in queue order, then the
   *  open seats. */
  seats: readonly MortarOverdriveQueueCardSeat[];
  /** The viewer is the only human queued, so the race would be against house
   *  pilots alone, which banks no win (`src/sim/mortar_overdrive/credit.ts`). */
  solo: boolean;
  /** The viewer's place in the queue when it is past this grid (they race the
   *  next one), or 0 while they hold one of these seats. */
  behind: number;
  sig: string;
}

export function buildMortarOverdriveQueueCardView(
  start: MortarOverdriveQueueStart | undefined,
  position = 0,
): MortarOverdriveQueueCardView {
  const seats: MortarOverdriveQueueCardSeat[] = [];
  const humans = start?.seats ?? [];
  for (let i = 0; i < MORTAR_OVERDRIVE_GRID_SIZE; i++) {
    const seat = humans[i];
    seats.push(seat ? { name: seat.name, you: seat.you } : { name: null, you: false });
  }
  const solo = humans.length === 1 && humans[0]?.you === true;
  const behind = humans.some((seat) => seat.you) ? 0 : position;
  // Names are joined on a separator no name can hold, so two grids never share
  // a signature by concatenation.
  const sig = `${solo ? 'solo' : 'field'}\u0000${behind}\u0000${humans.map((seat) => `${seat.you ? '*' : ''}${seat.name}`).join('\u0000')}`;
  return { seats, solo, behind, sig };
}

/**
 * What the card's live line says this frame:
 * - `counting`: house pilots fill the grid on the clock, `seconds` away;
 * - `starting`: the clock ran out and the grid is being seated (a seat can lag
 *   the client clock by a snapshot or a busy server tick);
 * - `busy`: the public lane is racing, so the queue starts after that race;
 * - `manual`: nothing fills the grid on its own here (offline): Start now does;
 * - `held`: no clock, yet the lane is free and house pilots do come (every
 *   waiter is still in a fight): the card says nothing it cannot keep.
 */
export type MortarOverdriveQueueCardStatus = 'counting' | 'starting' | 'busy' | 'manual' | 'held';

/** Steps of the bar, so the painter writes from a fixed table of widths and a
 *  frame allocates nothing; 200 is under a pixel per step at the card's width. */
export const MORTAR_OVERDRIVE_QUEUE_BAR_STEPS = 200;

/** How far the implied deadline may wander before the countdown re-anchors on
 *  it. Snapshot jitter and the offline tick's own 50 ms grain sit well inside
 *  it; a stalled server or a resumed tab does not. */
export const MORTAR_OVERDRIVE_QUEUE_REANCHOR_MS = 500;

const MS_PER_TICK = 1000 / TICK_RATE;
const WAIT_MS = MORTAR_OVERDRIVE_BACKFILL_TICKS * MS_PER_TICK;

/** The live countdown, ONE container per card, mutated in place every frame. */
export interface MortarOverdriveQueueCountdown {
  /** Client-clock moment house pilots fill the grid, or null with no clock. */
  deadlineMs: number | null;
  /** The ticks-left reading the anchor last checked, so an unchanged reading
   *  (a mirror between snapshots) never pulls the anchor back. */
  lastTicks: number | null;
  status: MortarOverdriveQueueCardStatus;
  /** Whole seconds left, rounded up; 0 outside `counting`. */
  seconds: number;
  /** The bar's fill in `MORTAR_OVERDRIVE_QUEUE_BAR_STEPS` steps, aimed at the
   *  NEXT whole second: the painter writes it once per second and the bar's
   *  one-second linear transition carries it there, so the bar moves smoothly
   *  for nothing per frame, and steps once a second under reduced motion. */
  barStep: number;
  /** Whether Start now may be pressed: refused while the lane is busy. */
  canStart: boolean;
}

export function createMortarOverdriveQueueCountdown(): MortarOverdriveQueueCountdown {
  return {
    deadlineMs: null,
    lastTicks: null,
    status: 'held',
    seconds: 0,
    barStep: 0,
    canStart: true,
  };
}

/**
 * Step the countdown to `nowMs` (the client clock). Each NEW reading of the
 * ticks left implies a deadline (now plus those ticks); the countdown keeps its
 * own anchor while the two agree, so a readout that moves once per tick
 * (offline) or once per snapshot (online) never makes the seconds stutter, and
 * re-anchors when they drift apart (the deadline moved, the server sagged, the
 * tab slept). A reading that has not changed says nothing new: the client clock
 * carries the count on.
 */
export function stepMortarOverdriveQueueCountdown(
  state: MortarOverdriveQueueCountdown,
  start: MortarOverdriveQueueStart | undefined,
  nowMs: number,
): MortarOverdriveQueueCountdown {
  state.canStart = !start?.laneBusy;
  const ticks = start?.startsInTicks ?? null;
  if (!start || ticks === null) {
    state.deadlineMs = null;
    state.lastTicks = null;
    state.status = start?.laneBusy ? 'busy' : start && !start.backfill ? 'manual' : 'held';
    state.seconds = 0;
    state.barStep = 0;
    return state;
  }
  if (state.deadlineMs === null || ticks !== state.lastTicks) {
    const implied = nowMs + ticks * MS_PER_TICK;
    if (
      state.deadlineMs === null ||
      Math.abs(implied - state.deadlineMs) > MORTAR_OVERDRIVE_QUEUE_REANCHOR_MS
    ) {
      state.deadlineMs = implied;
    }
    state.lastTicks = ticks;
  }
  const leftMs = Math.max(0, state.deadlineMs - nowMs);
  const seconds = Math.ceil(leftMs / 1000);
  state.status = seconds > 0 ? 'counting' : 'starting';
  state.seconds = seconds;
  const target = Math.max(0, seconds - 1) * 1000;
  state.barStep = Math.round(Math.min(1, target / WAIT_MS) * MORTAR_OVERDRIVE_QUEUE_BAR_STEPS);
  return state;
}
