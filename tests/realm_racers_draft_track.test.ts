// The dev draft arm's VISUAL lifecycle: build on registration, swap and free
// on re-registration.
//
// The authored circuits have no lifecycle at all (built once, eagerly, at
// renderer construction), which is exactly why this is a sibling module: the
// operator's loop is save, race, redraw, race again, and each pass replaces a
// circuit's worth of geometry. Driven with fakes, so the contract under test is
// the ORDER of build, add, remove and dispose rather than anything Three does.

import { afterEach, describe, expect, it } from 'vitest';
import { buildRealmRacersDraftTracks } from '../src/render/realm_racers_draft_track';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { clearRealmRacersDraftCircuits } from '../src/sim/realm_racers_draft_registry';
import { realmRacersRegisterDraftCircuit } from '../src/sim/realm_racers_drafts';
import {
  REALM_RACERS_LANE_DZ,
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneAt,
} from '../src/sim/realm_racers_layout';
import type { SimContext } from '../src/sim/sim_context';

const draft = (id: string, over: Partial<RealmRacersCircuit> = {}): RealmRacersCircuit => ({
  ...GARDEN,
  id,
  ...over,
});

interface FakeGroup {
  name: string;
  type: string;
  disposals: number;
  cleared: number;
  traverse(callback: (object: { type: string }) => void): void;
  clear(): void;
}

function scene() {
  const added: FakeGroup[] = [];
  const removed: FakeGroup[] = [];
  const built: string[] = [];
  const updates: { name: string; px: number }[] = [];
  const groups = new Map<string, FakeGroup>();

  const parent = {
    add: (object: unknown) => {
      added.push(object as FakeGroup);
    },
    remove: (object: unknown) => {
      removed.push(object as FakeGroup);
    },
  };

  let build = 0;
  const drafts = buildRealmRacersDraftTracks(parent as never, (circuit: RealmRacersCircuit) => {
    built.push(circuit.id);
    const name = `${circuit.id}#${build++}`;
    const group: FakeGroup = {
      name,
      type: 'Group',
      disposals: 0,
      cleared: 0,
      traverse() {
        /* nothing but the group itself in this fake */
      },
      clear() {
        this.cleared++;
      },
    };
    groups.set(name, group);
    return {
      group: group as never,
      update: (px: number) => {
        updates.push({ name, px });
      },
    };
  });

  return { drafts, added, removed, built, updates, groups };
}

describe('the draft track arm', () => {
  it('builds a view and parents it on registration', () => {
    const s = scene();
    s.drafts.register(draft('draft_one'));
    expect(s.built).toEqual(['draft_one']);
    expect(s.added.map((g) => g.name)).toEqual(['draft_one#0']);
    expect(s.removed).toEqual([]);
  });

  it('replaces the view on re-registration, unparenting and freeing the old one', () => {
    const s = scene();
    s.drafts.register(draft('draft_one', { laps: 2 }));
    s.drafts.register(draft('draft_one', { laps: 5 }));
    expect(s.built).toEqual(['draft_one', 'draft_one']);
    expect(s.added.map((g) => g.name)).toEqual(['draft_one#0', 'draft_one#1']);
    // The old group is taken out of the scene AND emptied, so it can neither be
    // drawn nor keep its buffers alive.
    expect(s.removed.map((g) => g.name)).toEqual(['draft_one#0']);
    expect(s.groups.get('draft_one#0')?.cleared).toBe(1);
    expect(s.groups.get('draft_one#1')?.cleared).toBe(0);
  });

  it('keeps a second draft alongside the first rather than replacing it', () => {
    const s = scene();
    s.drafts.register(draft('draft_one'));
    s.drafts.register(draft('draft_two'));
    expect(s.removed).toEqual([]);
    expect(s.added.map((g) => g.name)).toEqual(['draft_one#0', 'draft_two#1']);
  });

  it('drives every live view per frame, and only the live ones', () => {
    const s = scene();
    s.drafts.register(draft('draft_one'));
    s.drafts.register(draft('draft_two'));
    s.drafts.register(draft('draft_one'));
    s.drafts.update(113_700, 500, 1, null);
    expect(s.updates.map((u) => u.name).sort()).toEqual(['draft_one#2', 'draft_two#1']);
    expect(s.updates.every((u) => u.px === 113_700)).toBe(true);
  });

  it('does nothing at all until a draft is registered', () => {
    const s = scene();
    s.drafts.update(0, 0, 0, null);
    expect(s.built).toEqual([]);
    expect(s.updates).toEqual([]);
  });
});

describe('the draft view visibility gate', () => {
  afterEach(() => {
    clearRealmRacersDraftCircuits();
  });

  it('shows a draft only on the lane the sim put it on', () => {
    // Driven through the REAL `realmRacersLaneAt`, the same lookup the shipped
    // view runs: the fake stands in for Three, never for the lane rule. A
    // registered draft's view has to appear on its own lane and stay hidden on
    // an authored one, or two circuits draw on top of each other.
    const record = draft('draft_one');
    const registration = realmRacersRegisterDraftCircuit(
      { devCommands: true, realmRacers: { match: null, practices: [] } } as unknown as SimContext,
      record,
    );
    expect(registration.lane).toBeGreaterThanOrEqual(REALM_RACERS_LANES.length);

    const parent = { add: () => undefined, remove: () => undefined };
    let visible = false;
    let movedTo = -1;
    const drafts = buildRealmRacersDraftTracks(parent as never, (circuit) => ({
      group: { visible: false } as never,
      // The shipped view's own gate, restated over the real lookup.
      update: (px: number, pz: number) => {
        const lane = realmRacersLaneAt(px, pz);
        visible = lane?.circuit.id === circuit.id;
        movedTo = visible ? (lane?.index ?? -1) : -1;
      },
    }));
    drafts.register(record);

    const draftZ = REALM_RACERS_ORIGIN.z + registration.lane * REALM_RACERS_LANE_DZ;
    drafts.update(REALM_RACERS_ORIGIN.x, draftZ, 0, null);
    expect(visible).toBe(true);
    expect(movedTo).toBe(registration.lane);

    // Lane 0 belongs to an authored circuit, and the draft must not draw there.
    drafts.update(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z, 0, null);
    expect(visible).toBe(false);
  });
});
