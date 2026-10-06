// The queue card's pure core: the structural view (the grid, the solo note) and
// the live countdown it steps every frame against the client clock.

import { describe, expect, it } from 'vitest';
import { MORTAR_OVERDRIVE_BACKFILL_TICKS } from '../src/sim/mortar_overdrive/backfill';
import {
  buildMortarOverdriveQueueCardView,
  createMortarOverdriveQueueCountdown,
  MORTAR_OVERDRIVE_QUEUE_BAR_STEPS,
  MORTAR_OVERDRIVE_QUEUE_REANCHOR_MS,
  stepMortarOverdriveQueueCountdown,
} from '../src/ui/hud/mortar_overdrive/queue_card_view';
import type { MortarOverdriveQueueStart } from '../src/world_api';
import { addAt, makeWorld } from './mortar_overdrive_util';
import { assertAllocationStable } from './util/alloc_probe';

function start(over: Partial<MortarOverdriveQueueStart> = {}): MortarOverdriveQueueStart {
  return {
    seats: [{ name: 'Aster', you: true }],
    startsInTicks: 600,
    laneBusy: false,
    backfill: true,
    ...over,
  };
}

describe('Mortar Overdrive queue card view', () => {
  it('fills a whole grid, queued humans first, and flags a solo viewer', () => {
    const view = buildMortarOverdriveQueueCardView(start());
    expect(view.seats).toEqual([
      { name: 'Aster', you: true },
      { name: null, you: false },
      { name: null, you: false },
      { name: null, you: false },
    ]);
    expect(view.solo).toBe(true);
  });

  it('is not solo with a second human, and moves its signature with the grid', () => {
    const pair = start({
      seats: [
        { name: 'Aster', you: true },
        { name: 'Briar', you: false },
      ],
    });
    const view = buildMortarOverdriveQueueCardView(pair);
    expect(view.solo).toBe(false);
    expect(view.sig).not.toBe(buildMortarOverdriveQueueCardView(start()).sig);
    // The clock never rides the signature: a countdown must not rebuild the card.
    expect(buildMortarOverdriveQueueCardView({ ...pair, startsInTicks: 5 }).sig).toBe(view.sig);
    expect(buildMortarOverdriveQueueCardView({ ...pair, laneBusy: true }).sig).toBe(view.sig);
  });

  it('keeps names apart in the signature', () => {
    const ab = start({
      seats: [
        { name: 'Ab', you: true },
        { name: 'C', you: false },
      ],
    });
    const a = start({
      seats: [
        { name: 'A', you: true },
        { name: 'bC', you: false },
      ],
    });
    expect(buildMortarOverdriveQueueCardView(ab).sig).not.toBe(
      buildMortarOverdriveQueueCardView(a).sig,
    );
  });
});

describe('Mortar Overdrive queue countdown', () => {
  it('counts whole seconds down on the client clock from one reading', () => {
    const c = createMortarOverdriveQueueCountdown();
    const reading = start({ startsInTicks: 30 * 20 });
    stepMortarOverdriveQueueCountdown(c, reading, 1000);
    expect(c.status).toBe('counting');
    expect(c.seconds).toBe(30);
    // The reading holds still (a mirror between snapshots): the clock carries on.
    stepMortarOverdriveQueueCountdown(c, reading, 1000 + 10_400);
    expect(c.seconds).toBe(20);
    stepMortarOverdriveQueueCountdown(c, reading, 1000 + 30_000);
    expect(c.status).toBe('starting');
    expect(c.seconds).toBe(0);
    expect(c.barStep).toBe(0);
    expect(c.canStart).toBe(true);
  });

  it('keeps its anchor through readings that agree, and re-anchors on drift', () => {
    const c = createMortarOverdriveQueueCountdown();
    stepMortarOverdriveQueueCountdown(c, start({ startsInTicks: 600 }), 0);
    const anchor = c.deadlineMs;
    // One tick later, a reading 40 ms late (a snapshot's jitter): no re-anchor.
    stepMortarOverdriveQueueCountdown(c, start({ startsInTicks: 599 }), 90);
    expect(c.deadlineMs).toBe(anchor);
    // The deadline moved by a whole second (the oldest waiter left): follow it.
    stepMortarOverdriveQueueCountdown(
      c,
      start({ startsInTicks: 599 + 20 + MORTAR_OVERDRIVE_QUEUE_REANCHOR_MS / 50 }),
      100,
    );
    expect(c.deadlineMs).not.toBe(anchor);
    expect(c.seconds).toBe(Math.ceil(((c.deadlineMs as number) - 100) / 1000));
  });

  it('aims the bar at the next whole second, emptying toward the fill', () => {
    const c = createMortarOverdriveQueueCountdown();
    stepMortarOverdriveQueueCountdown(
      c,
      start({ startsInTicks: MORTAR_OVERDRIVE_BACKFILL_TICKS }),
      0,
    );
    const full = c.barStep;
    expect(full).toBeLessThan(MORTAR_OVERDRIVE_QUEUE_BAR_STEPS);
    expect(full).toBeGreaterThan(MORTAR_OVERDRIVE_QUEUE_BAR_STEPS * 0.9);
    stepMortarOverdriveQueueCountdown(
      c,
      start({ startsInTicks: MORTAR_OVERDRIVE_BACKFILL_TICKS }),
      10_000,
    );
    expect(c.barStep).toBeLessThan(full);
  });

  it('reads busy, manual and held without a clock, and refuses Start now only while busy', () => {
    const c = createMortarOverdriveQueueCountdown();
    stepMortarOverdriveQueueCountdown(c, start({ startsInTicks: null, laneBusy: true }), 0);
    expect(c.status).toBe('busy');
    expect(c.canStart).toBe(false);
    expect(c.deadlineMs).toBeNull();
    stepMortarOverdriveQueueCountdown(c, start({ startsInTicks: null, backfill: false }), 0);
    expect(c.status).toBe('manual');
    expect(c.canStart).toBe(true);
    stepMortarOverdriveQueueCountdown(c, start({ startsInTicks: null }), 0);
    expect(c.status).toBe('held');
    stepMortarOverdriveQueueCountdown(c, undefined, 0);
    expect(c.status).toBe('held');
    expect(c.seconds).toBe(0);
  });

  it('steps without allocating', () => {
    const c = createMortarOverdriveQueueCountdown();
    const reading = start();
    let now = 0;
    expect(() =>
      assertAllocationStable(
        () => {
          now += 16;
          return stepMortarOverdriveQueueCountdown(c, reading, now);
        },
        64,
        'mortar overdrive queue countdown',
      ),
    ).not.toThrow();
  });

  it('never counts up or stutters over a real Sim readout and a jittered mirror cadence', () => {
    const sim = makeWorld({ mortarOverdriveBackfill: true });
    const pid = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.mortarOverdriveQueueJoin(pid);
    sim.tick();
    // Offline: a fresh reading every 50 ms tick, the client clock in step.
    const offline = createMortarOverdriveQueueCountdown();
    let last = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 400; i++) {
      stepMortarOverdriveQueueCountdown(offline, sim.mortarOverdriveInfoFor(pid).start, i * 50);
      expect(offline.seconds).toBeLessThanOrEqual(last);
      last = offline.seconds;
      sim.tick();
    }
    // Online: the mirror derives the ticks left from one absolute deadline
    // against snapshots that land 50 to 100 ms apart, painted every 16 ms.
    const deadline = 900;
    const online = createMortarOverdriveQueueCountdown();
    let tick = 0;
    let nextSnap = 0;
    let reading: MortarOverdriveQueueStart = start({ startsInTicks: deadline });
    last = Number.POSITIVE_INFINITY;
    for (let now = 0; now < 20_000; now += 16) {
      if (now >= nextSnap) {
        tick = Math.floor(now / 50);
        reading = start({ startsInTicks: Math.max(0, deadline - tick) });
        nextSnap = now + 50 + ((tick * 37) % 51);
      }
      stepMortarOverdriveQueueCountdown(online, reading, now);
      expect(online.seconds).toBeLessThanOrEqual(last);
      last = online.seconds;
    }
    // And it lands where the deadline says (45 s out, the last paint just
    // under 20 s in), within the one second a whole-second display rounds.
    expect(Math.abs(online.seconds - (deadline * 50 - 20_000) / 1000)).toBeLessThanOrEqual(1);
  });
});
