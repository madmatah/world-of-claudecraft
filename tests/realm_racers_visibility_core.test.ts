import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  isOutsideRealmRacersDrawRange,
  isOutsideRealmRacersRetainRange,
  isRealmRacersCoPilot,
} from '../src/render/realm_racers_visibility_core';
import { Renderer } from '../src/render/renderer';
import type { Entity } from '../src/sim/types';
import { addAt, makeWorld } from './vale_cup_util';

interface RequiredViewsHarness {
  sim: { entities: Map<number, Entity> };
  views: Map<number, unknown>;
  viewCreateRetry: { canAttempt(id: number, kind: string, now: number): boolean };
  createView: ReturnType<typeof vi.fn>;
  sampleCreatedViewType: ReturnType<typeof vi.fn>;
  createRequiredViews(
    player: Entity,
    createdViewTypes: string[],
    participantIds: readonly number[],
  ): number;
}

describe('Realm Racers participant visibility', () => {
  const participantIds = [10, 11, 12, 13];

  it('classifies every remote pilot and excludes self and strangers', () => {
    expect(participantIds.map((id) => isRealmRacersCoPilot(participantIds, 10, id))).toEqual([
      false,
      true,
      true,
      true,
    ]);
    expect(isRealmRacersCoPilot(participantIds, 10, 99)).toBe(false);
  });

  it('requires all three remote views for a four-pilot grid', () => {
    const renderer = Object.create(Renderer.prototype) as unknown as RequiredViewsHarness;
    renderer.sim = {
      entities: new Map(participantIds.map((id) => [id, { id } as Entity])),
    };
    renderer.views = new Map();
    renderer.viewCreateRetry = { canAttempt: () => true };
    renderer.createView = vi.fn();
    renderer.sampleCreatedViewType = vi.fn();

    const created = renderer.createRequiredViews(
      { id: 10, targetId: null } as Entity,
      [],
      participantIds,
    );

    expect(created).toBe(4);
    expect(renderer.createView.mock.calls.map(([entity]) => entity.id)).toEqual(participantIds);
  });

  it('creates an offline practice bot as a required view beyond the normal destroy range', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', 0, 0);
    sim.realmRacersPracticeStart('rookie', human);
    const info = sim.realmRacersInfoFor(human).match;
    if (!info) throw new Error('practice match missing');
    const bot = info.participantIds.find((pid) => pid !== human);
    if (bot === undefined) throw new Error('practice bot missing');
    const humanEntity = sim.entities.get(human);
    const botEntity = sim.entities.get(bot);
    if (!humanEntity || !botEntity) throw new Error('practice entities missing');
    botEntity.pos.x = humanEntity.pos.x + 170;
    const dx = botEntity.pos.x - humanEntity.pos.x;
    const dz = botEntity.pos.z - humanEntity.pos.z;

    const renderer = Object.create(Renderer.prototype) as unknown as RequiredViewsHarness;
    renderer.sim = { entities: sim.entities };
    renderer.views = new Map();
    renderer.viewCreateRetry = { canAttempt: () => true };
    renderer.createView = vi.fn();
    renderer.sampleCreatedViewType = vi.fn();
    const created = renderer.createRequiredViews(humanEntity, [], info.participantIds);

    expect(dx * dx + dz * dz).toBeGreaterThan(96 * 96);
    expect(isRealmRacersCoPilot(info.participantIds, human, bot)).toBe(true);
    // The whole grid is required, human included: a practice race is a field of
    // house pilots, and the one parked 170 yards away is drawn like the rest.
    expect(created).toBe(info.participantIds.length);
    expect(renderer.createView.mock.calls.map(([entity]) => entity.id)).toEqual(
      info.participantIds,
    );
  });

  it('retains and draws every far co-pilot while rejecting a stranger at the same range', () => {
    const farDistanceSq = 170 * 170;
    for (const id of [11, 12, 13]) {
      expect(isOutsideRealmRacersRetainRange(participantIds, 10, id, farDistanceSq, 96 * 96)).toBe(
        false,
      );
      expect(
        isOutsideRealmRacersDrawRange(
          participantIds,
          10,
          id,
          false,
          farDistanceSq,
          80 * 80,
          96 * 96,
        ),
      ).toBe(false);
    }
    expect(isOutsideRealmRacersRetainRange(participantIds, 10, 99, farDistanceSq, 96 * 96)).toBe(
      true,
    );
    expect(
      isOutsideRealmRacersDrawRange(participantIds, 10, 99, true, farDistanceSq, 80 * 80, 96 * 96),
    ).toBe(true);
  });

  it('preserves the normal 80/96 yard boundaries for strangers', () => {
    expect(isOutsideRealmRacersRetainRange(participantIds, 10, 99, 96 * 96, 96 * 96)).toBe(false);
    expect(isOutsideRealmRacersRetainRange(participantIds, 10, 99, 96 * 96 + 1, 96 * 96)).toBe(
      true,
    );
    expect(
      isOutsideRealmRacersDrawRange(participantIds, 10, 99, false, 80 * 80, 80 * 80, 96 * 96),
    ).toBe(false);
    expect(
      isOutsideRealmRacersDrawRange(participantIds, 10, 99, false, 80 * 80 + 1, 80 * 80, 96 * 96),
    ).toBe(true);
    expect(
      isOutsideRealmRacersDrawRange(participantIds, 10, 99, true, 96 * 96, 80 * 80, 96 * 96),
    ).toBe(false);
  });

  it('pins the create, retain, and draw gates to the same fairness predicate', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toMatch(
      /createRequiredViews\([\s\S]*isRealmRacersCoPilot\([\s\S]*createRequiredView/,
    );
    expect(renderer.match(/isOutsideRealmRacersRetainRange\(/g)).toHaveLength(1);
    expect(renderer.match(/isOutsideRealmRacersDrawRange\(/g)).toHaveLength(1);
  });
});
