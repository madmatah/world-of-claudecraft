// The authoritative self-position discontinuity, and the ONE mechanism that
// decides it.
//
// The v0.40.0 release merge arrived carrying a second one:
// `hasAuthoritativeSelfPositionDiscontinuity(events, playerId)` in
// `src/render/self_motion.ts`, which `main.ts` called on the event batch. It is
// gone, and this file is why it could go rather than being kept beside this one.
// The mirror's flag answers strictly more: the same completed `unstuck`, PLUS
// `mortarOverdriveReset`, and it defers the answer until the snapshot that follows
// the events has actually landed on the mirror. That deferral is the part a
// batch-reading predicate cannot have, because the two arrive as separate
// ordered frames and a render frame can fall between them.
import { describe, expect, it } from 'vitest';
import { ClientWorld } from '../src/net/online';
import { SelfPositionDiscontinuityLatch } from '../src/net/self_position_discontinuity';
import type { SimEvent } from '../src/sim/types';

class StubWebSocket {
  static readonly OPEN = 1;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  readyState = StubWebSocket.OPEN;
  constructor(public readonly url: string) {}
  send(): void {}
  close(): void {}
}

interface ClientInternals {
  onMessage(raw: string): void;
}

function makeWorld(): { world: ClientWorld; wire: ClientInternals } {
  const g = globalThis as Record<string, unknown>;
  const previousWebSocket = g.WebSocket;
  const previousWindow = g.window;
  g.WebSocket = StubWebSocket as unknown;
  g.window = { setInterval: () => 0, clearInterval: () => undefined };
  try {
    const world = new ClientWorld('recovery-latch-token', 1, 'warrior', 'http://localhost');
    world.close();
    const wire = world as unknown as ClientInternals;
    wire.onMessage(JSON.stringify({ t: 'hello', pid: 1, seed: 20061 }));
    return { world, wire };
  } finally {
    g.WebSocket = previousWebSocket;
    g.window = previousWindow;
  }
}

function playerWire(x: number, z: number): Record<string, unknown> {
  return {
    id: 1,
    k: 'player',
    tid: 'warrior',
    nm: 'Me',
    lv: 12,
    x,
    y: 0,
    z,
    f: 0,
    hp: 100,
    mhp: 100,
  };
}

describe('ClientWorld authoritative position-discontinuity latch', () => {
  it('waits through an event-to-rAF gap and snaps on the following snapshot exactly once', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(0, 0) }));

    wire.onMessage(
      JSON.stringify({ t: 'events', list: [{ type: 'mortarOverdriveReset', pid: 1 }] }),
    );
    expect(world.drainEvents()).toEqual([{ type: 'mortarOverdriveReset', pid: 1 }]);
    // This is the rAF that can run between the server's event and snapshot frames.
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);

    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(4, 0) }));
    expect(world.consumeSelfPositionDiscontinuity()).toBe(true);
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);
  });

  it('ignores another racer reset and promotes event-plus-snapshot received before rAF', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(
      JSON.stringify({ t: 'events', list: [{ type: 'mortarOverdriveReset', pid: 2 }] }),
    );
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(0, 0) }));
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);

    wire.onMessage(
      JSON.stringify({ t: 'events', list: [{ type: 'mortarOverdriveReset', pid: 1 }] }),
    );
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(4, 0) }));
    expect(world.consumeSelfPositionDiscontinuity()).toBe(true);
  });

  it('also latches on a completed unstuck for the local player, and ignores a mid-countdown one', () => {
    const { world, wire } = makeWorld();
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(0, 0) }));

    // A running countdown is not a discontinuity yet: only 'completed' teleports the racer.
    wire.onMessage(
      JSON.stringify({ t: 'events', list: [{ type: 'unstuck', phase: 'countdown', seconds: 4 }] }),
    );
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(0, 0) }));
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);

    wire.onMessage(
      JSON.stringify({
        t: 'events',
        list: [
          {
            type: 'unstuck',
            phase: 'completed',
            pid: 1,
            reason: 'moved_to_graveyard',
            area: { kind: 'overworld', id: 'eastbrook_vale' },
            origin: { x: 0, y: 0, z: 0, localX: 0, localZ: 0 },
            destination: { x: 4, y: 0, z: 0, localX: 4, localZ: 0 },
            duration: 10,
            distance: 4,
          },
        ],
      }),
    );
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);
    wire.onMessage(JSON.stringify({ t: 'snap', ents: [], self: playerWire(4, 0) }));
    expect(world.consumeSelfPositionDiscontinuity()).toBe(true);
    expect(world.consumeSelfPositionDiscontinuity()).toBe(false);
  });
});

describe('SelfPositionDiscontinuityLatch', () => {
  it('arms on the viewer or a pid-less event, fires once after the snapshot', () => {
    const latch = new SelfPositionDiscontinuityLatch();
    latch.noteEvent({ type: 'mortarOverdriveReset', pid: 2 } as unknown as SimEvent, 1);
    latch.snapshotApplied();
    expect(latch.consume()).toBe(false);
    latch.noteEvent({ type: 'unstuck', phase: 'started' } as unknown as SimEvent, 1);
    latch.snapshotApplied();
    expect(latch.consume()).toBe(false);
    latch.noteEvent({ type: 'unstuck', phase: 'completed' } as unknown as SimEvent, 1);
    expect(latch.consume()).toBe(false);
    latch.snapshotApplied();
    expect(latch.consume()).toBe(true);
    expect(latch.consume()).toBe(false);
    latch.noteEvent({ type: 'mortarOverdriveReset', pid: 1 } as unknown as SimEvent, 1);
    latch.snapshotApplied();
    expect(latch.consume()).toBe(true);
  });
});
