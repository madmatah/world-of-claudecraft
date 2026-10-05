// The pure core behind the end-of-race podium.
//
// It returns ONE reused container mutated in place per call (the
// allocation-light per-frame contract: it is built every frame the podium is
// up), so a test that compares two builds captures the PRIMITIVES it needs (a
// sig string) before building the next one, never two object handles.

import { describe, expect, it } from 'vitest';
import { buildRealmRacersPodiumView, RALLY_PODIUM_STEPS } from '../src/ui/realm_racers_podium_view';
import type { RealmRacersInfo } from '../src/world_api';
import { assertAllocationStable } from './util/alloc_probe';

type Match = NonNullable<RealmRacersInfo['match']>;
type Racer = Match['standings'][number];

function racer(over: Partial<Racer> & { pid: number }): Racer {
  return {
    name: `Racer${over.pid}`,
    cls: 'warrior',
    lap: 3,
    finished: true,
    botTier: null,
    position: 1,
    finishSeconds: 60,
    retired: false,
    ...over,
  };
}

function match(over: Partial<Match> = {}, standings?: Racer[]): Match {
  const field = standings ?? [
    racer({ pid: 2, name: 'Briar', cls: 'mage', position: 1, finishSeconds: 64.2 }),
    racer({ pid: 3, name: 'Cass', cls: 'rogue', position: 2, finishSeconds: 67.8 }),
    racer({ pid: 4, name: 'Dell', cls: 'priest', position: 3, finishSeconds: 71.4 }),
    racer({ pid: 1, name: 'Aster', position: 4, finished: false, finishSeconds: null, lap: 2 }),
  ];
  const me = field.find((row) => row.pid === (over.me?.pid ?? 1)) as Racer;
  return {
    id: 7,
    circuitId: 'evergarden_practice',
    participantIds: field.map((row) => row.pid),
    phase: 'finished',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 71,
    elapsedTicks: 0,
    chaseIn: 0,
    returnIn: 6,
    me,
    standings: field,
    gridSize: 4,
    decided: true,
    speed: 0,
    wrongWay: false,
    offTrackIn: 0,
    cutReturned: false,
    pickupsTaken: [],
    slicks: [],
    warded: false,
    resetLocked: false,
    totalLaps: 3,
    practice: false,
    result: 'lost',
    ...over,
  };
}

describe('Realm Racers podium core', () => {
  it('is inert with no race, and while a race is still running', () => {
    expect(buildRealmRacersPodiumView(null).active).toBe(false);
    expect(buildRealmRacersPodiumView(match({ phase: 'racing', decided: false })).active).toBe(
      false,
    );
  });

  it('stays away from a pilot who merely quit while the race runs on', () => {
    // Their OWN phase reads finished and they are watching a return countdown,
    // but there is no classification yet: keying on `phase` would show them a
    // podium built from an order the race has not settled.
    const quitter = buildRealmRacersPodiumView(
      match({ phase: 'finished', decided: false, result: 'forfeit' }),
    );
    expect(quitter.active).toBe(false);
  });

  it('holds no ceremony for a race voided before GO, for the survivor or a quitter', () => {
    expect(
      buildRealmRacersPodiumView(match({ decided: true, voided: true, result: 'void' })).active,
    ).toBe(false);
    expect(
      buildRealmRacersPodiumView(match({ decided: true, voided: true, result: 'forfeit' })).active,
    ).toBe(false);
  });

  it('puts second to the LEFT of first, which is what a podium looks like', () => {
    const view = buildRealmRacersPodiumView(match());
    expect(view.steps.map((step) => step.placing)).toEqual([2, 1, 3]);
    expect(view.steps.map((step) => step.name)).toEqual(['Cass', 'Briar', 'Dell']);
  });

  it('lists everyone past the podium below it, in classification order', () => {
    const view = buildRealmRacersPodiumView(match());
    expect(view.steps).toHaveLength(RALLY_PODIUM_STEPS);
    expect(view.rest.map((row) => row.placing)).toEqual([4]);
    expect(view.rest[0].name).toBe('Aster');
  });

  it('carries a race time for a finisher and none for a pilot the flag caught', () => {
    const view = buildRealmRacersPodiumView(match());
    expect(view.steps.map((step) => step.finishSeconds)).toEqual([67.8, 64.2, 71.4]);
    // The one who never crossed shows their lap instead; the core hands the
    // painter both and lets it choose.
    expect(view.rest[0].finishSeconds).toBeNull();
    expect(view.rest[0].lap).toBe(2);
    expect(view.totalLaps).toBe(3);
  });

  it('marks the viewer wherever they placed', () => {
    const onPodium = buildRealmRacersPodiumView(match({ me: racer({ pid: 2, position: 1 }) }));
    expect(onPodium.steps.filter((step) => step.isMe).map((step) => step.placing)).toEqual([1]);
    expect(onPodium.rest.some((row) => row.isMe)).toBe(false);
    const offPodium = buildRealmRacersPodiumView(match());
    expect(offPodium.steps.some((step) => step.isMe)).toBe(false);
    expect(offPodium.rest.filter((row) => row.isMe).map((row) => row.placing)).toEqual([4]);
  });

  it('survives a field shorter than the podium', () => {
    const view = buildRealmRacersPodiumView(
      match({}, [racer({ pid: 1, position: 1 }), racer({ pid: 2, name: 'Briar', position: 2 })]),
    );
    expect(view.steps.map((step) => step.placing)).toEqual([2, 1]);
    expect(view.rest).toEqual([]);
  });

  it('carries the circuit that was raced, and rebuilds the ceremony when it changes', () => {
    // The heading is the slot workstream 12 left empty. It is structure the
    // painter builds from this id, so the id has to be in the signature that
    // rebuilds it, and it is an id rather than a name: this core is i18n-free.
    const view = buildRealmRacersPodiumView(match({ circuitId: 'evergarden_express_tour' }));
    expect(view.circuitId).toBe('evergarden_express_tour');
    const raced = view.sig;
    expect(buildRealmRacersPodiumView(match()).sig).not.toBe(raced);
    expect(buildRealmRacersPodiumView(null).circuitId).toBe('');
  });

  it('keeps the countdown out of its signature, and the classification in', () => {
    const base = buildRealmRacersPodiumView(match()).sig;
    // The return clock ticks once a second and the painter writes it through
    // the elided writers; rebuilding the whole ceremony for it would restart
    // its entrance six times.
    expect(buildRealmRacersPodiumView(match({ returnIn: 3 })).sig).toBe(base);
    const reordered = buildRealmRacersPodiumView(
      match({}, [
        racer({ pid: 3, name: 'Cass', position: 1 }),
        racer({ pid: 2, name: 'Briar', position: 2 }),
        racer({ pid: 4, name: 'Dell', position: 3 }),
        racer({ pid: 1, name: 'Aster', position: 4 }),
      ]),
    );
    expect(reordered.sig).not.toBe(base);
    expect(buildRealmRacersPodiumView(match({ result: 'won' })).sig).not.toBe(base);
  });

  it('allocates nothing per frame while the podium is up: the container, its lists and every entry keep their identity', () => {
    const decided = match();
    expect(() =>
      assertAllocationStable(() => buildRealmRacersPodiumView(decided), 64, 'podium view'),
    ).not.toThrow();
    expect(() =>
      assertAllocationStable(() => buildRealmRacersPodiumView(decided).steps, 64, 'podium steps'),
    ).not.toThrow();
    expect(() =>
      assertAllocationStable(() => buildRealmRacersPodiumView(decided).rest, 64, 'podium rest'),
    ).not.toThrow();
    // ...and an inactive frame hands back the same container, emptied.
    const up = buildRealmRacersPodiumView(decided);
    const down = buildRealmRacersPodiumView(null);
    expect(down).toBe(up);
    expect(down.active).toBe(false);
    expect(down.steps).toEqual([]);
    expect(down.rest).toEqual([]);
    // A frame read back after the next build still carries this frame's values.
    const again = buildRealmRacersPodiumView(match({ returnIn: 2 }));
    expect(again.active).toBe(true);
    expect(again.returnIn).toBe(2);
    expect(again.steps.map((step) => step.name)).toEqual(['Cass', 'Briar', 'Dell']);
  });
});
