import { beforeEach, describe, expect, it } from 'vitest';
import {
  appendSnapshotEntity,
  type EntityWireView,
  type SentEntityVersions,
} from '../server/snapshot_entity_stream';

describe('snapshot entity stream encoder', () => {
  const sent = new Map<number, SentEntityVersions>();
  const present = new Set<number>();
  const ents: string[] = [];
  const keep: number[] = [];
  const cache = (dynVer: number): EntityWireView => ({
    idVer: 1,
    dynVer,
    auraVer: 0,
    fullJson: `full-${dynVer}`,
    liteJson: `lite-${dynVer}`,
    fullAuraJson: `full-aura-${dynVer}`,
    liteAuraJson: `lite-aura-${dynVer}`,
  });
  const append = (tick: number, updateDue: boolean, dynVer: number): void => {
    appendSnapshotEntity(7, tick, false, updateDue, sent, present, ents, keep, cache(dynVer));
  };

  beforeEach(() => {
    sent.clear();
    present.clear();
    ents.length = 0;
    keep.length = 0;
  });

  it('sends identity on first sight, then keeps an unchanged entity', () => {
    append(1, true, 1);
    expect(ents).toEqual(['full-1']);
    expect(present).toEqual(new Set([7]));

    ents.length = 0;
    append(2, true, 1);
    expect(ents).toEqual([]);
    expect(keep).toEqual([7]);
  });

  it('defers a changed entity until due, then sends one lite settle record', () => {
    append(1, true, 1);
    ents.length = 0;

    append(2, false, 2);
    expect(ents).toEqual([]);
    expect(keep).toEqual([7]);

    keep.length = 0;
    append(3, true, 2);
    expect(ents).toEqual(['lite-2']);

    ents.length = 0;
    append(4, true, 2);
    expect(ents).toEqual(['lite-2']);

    ents.length = 0;
    append(5, true, 2);
    expect(keep).toEqual([7]);
  });
});
