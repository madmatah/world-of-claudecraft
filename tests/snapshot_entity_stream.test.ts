import { describe, expect, it } from 'vitest';
import {
  appendSnapshotEntity,
  type EntityWireView,
  type SentEntityVersions,
} from '../server/snapshot_entity_stream';

describe('snapshot entity stream encoder', () => {
  const view = (over: Partial<EntityWireView> = {}): EntityWireView => {
    const dynVer = over.dynVer ?? 1;
    return {
      idVer: 1,
      dynVer,
      auraVer: 0,
      fullJson: `full-${dynVer}`,
      liteJson: `lite-${dynVer}`,
      fullAuraJson: `full-aura-${dynVer}`,
      liteAuraJson: `lite-aura-${dynVer}`,
      ...over,
    };
  };

  /** One recipient's stream state. The encoder runs per session, so a
   *  stable-timer client and a legacy one can watch the SAME entity and each
   *  append resolves against its own bookkeeping. Every append starts a fresh
   *  frame: `ents`/`keep` carry exactly what that tick emitted. */
  function session(stableTimerWire: boolean) {
    const sent = new Map<number, SentEntityVersions>();
    const state = {
      sent,
      present: new Set<number>(),
      ents: [] as string[],
      keep: [] as number[],
      append(tick: number, updateDue: boolean, cache: EntityWireView): void {
        state.ents = [];
        state.keep = [];
        appendSnapshotEntity(
          7,
          tick,
          stableTimerWire,
          updateDue,
          sent,
          state.present,
          state.ents,
          state.keep,
          cache,
        );
      },
    };
    return state;
  }

  it('sends identity on first sight, then keeps an unchanged entity', () => {
    const s = session(false);
    s.append(1, true, view({ dynVer: 1 }));
    expect(s.ents).toEqual(['full-1']);
    expect(s.present).toEqual(new Set([7]));

    s.append(2, true, view({ dynVer: 1 }));
    expect(s.ents).toEqual([]);
    expect(s.keep).toEqual([7]);
  });

  it('sends the aura-bearing full record on first sight to a stable-timer recipient', () => {
    // The stable wire's full record carries the aura timers; the legacy one
    // (above) must not, because an old client cannot parse them.
    const s = session(true);
    s.append(1, true, view({ dynVer: 1 }));
    expect(s.ents).toEqual(['full-aura-1']);
    expect(s.present).toEqual(new Set([7]));
  });

  it('defers a changed entity until due, then sends one lite settle record', () => {
    const s = session(false);
    s.append(1, true, view({ dynVer: 1 }));

    s.append(2, false, view({ dynVer: 2 }));
    expect(s.ents).toEqual([]);
    expect(s.keep).toEqual([7]);

    s.append(3, true, view({ dynVer: 2 }));
    expect(s.ents).toEqual(['lite-2']);

    s.append(4, true, view({ dynVer: 2 }));
    expect(s.ents).toEqual(['lite-2']);

    s.append(5, true, view({ dynVer: 2 }));
    expect(s.ents).toEqual([]);
    expect(s.keep).toEqual([7]);
  });

  it('re-sends the full record on an idVer bump and clears settled', () => {
    // A changed identity (name, form, gear silhouette) invalidates whatever the
    // client holds: the entity goes back out FULL even though nothing dynamic
    // moved, and the settle flag clears so the next due tick re-baselines.
    const s = session(false);
    s.append(1, true, view({ dynVer: 3 }));
    s.append(2, true, view({ idVer: 2, dynVer: 3 }));
    expect(s.ents).toEqual(['full-3']);
    expect(s.keep).toEqual([]);
    expect(s.sent.get(7)).toMatchObject({ idVer: 2, dynVer: 3, sentAtTick: 2, settled: false });
    // The cleared flag is observable behavior, not just bookkeeping: the next
    // due tick with NOTHING changed still sends one lite settle record...
    s.append(3, true, view({ idVer: 2, dynVer: 3 }));
    expect(s.ents).toEqual(['lite-3']);
    // ...and only then does the entity keep.
    s.append(4, true, view({ idVer: 2, dynVer: 3 }));
    expect(s.ents).toEqual([]);
    expect(s.keep).toEqual([7]);
  });

  it('re-sends the aura-bearing full on an idVer bump that also moved the aura clock', () => {
    const s = session(true);
    s.append(1, true, view({ dynVer: 1 }));
    s.append(2, true, view({ idVer: 2, dynVer: 1, auraVer: 5 }));
    expect(s.ents).toEqual(['full-aura-1']);
    // With the aura clock UNMOVED the same bump re-sends the plain full: the
    // aura payload rides only when there is aura news to carry.
    const quiet = session(true);
    quiet.append(1, true, view({ dynVer: 1 }));
    quiet.append(2, true, view({ idVer: 2, dynVer: 1 }));
    expect(quiet.ents).toEqual(['full-1']);
  });

  it('rides an aura-clock move to a stable-timer recipient while a legacy one keeps', () => {
    const stable = session(true);
    const legacy = session(false);
    for (const s of [stable, legacy]) s.append(1, true, view({ dynVer: 1 }));

    // An aura timer moved and nothing else did. Only the stable wire carries
    // aura timers, so only the stable recipient gets a record at all: the
    // legacy client would decode nothing new from one.
    for (const s of [stable, legacy]) s.append(2, true, view({ dynVer: 1, auraVer: 1 }));
    expect(stable.ents).toEqual(['lite-aura-1']);
    expect(legacy.ents).toEqual([]);
    expect(legacy.keep).toEqual([7]);

    // The new aura clock was recorded, or this tick would re-send it forever.
    for (const s of [stable, legacy]) s.append(3, true, view({ dynVer: 1, auraVer: 1 }));
    expect(stable.ents).toEqual([]);
    expect(stable.keep).toEqual([7]);

    // The body moves too: both due recipients update, each on its own wire
    // shape, which is the whole liteAuraJson-vs-liteJson split.
    for (const s of [stable, legacy]) s.append(4, true, view({ dynVer: 2, auraVer: 2 }));
    expect(stable.ents).toEqual(['lite-aura-2']);
    expect(legacy.ents).toEqual(['lite-2']);
  });
});
