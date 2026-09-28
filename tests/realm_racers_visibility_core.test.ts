import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// The rally scene's shell pool mints its marker texture at construction, which
// needs a DOM canvas; the rest of the textures module is the real one.
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    rallyGroundBlastMarkerTexture: () =>
      new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  };
});

import { makeQuestObjectGate, type QuestObjectGate } from '../src/render/quest_object_gate_core';
import { RealmRacersScene } from '../src/render/realm_racers_scene';
import {
  isOutsideRealmRacersDrawRange,
  isRealmRacersCoPilot,
} from '../src/render/realm_racers_visibility_core';
import { Renderer } from '../src/render/renderer';
import type { Entity, QuestProgress } from '../src/sim/types';
import { addAt, makeWorld } from './realm_racers_util';

interface RequiredViewsHarness {
  sim: { entities: Map<number, Entity>; questLog: Map<string, QuestProgress> };
  views: Map<number, unknown>;
  // The required-view path runs every candidate through the shared admission
  // policy, which takes the renderer's own quest-object gate as a function.
  questObjectHidden: QuestObjectGate;
  viewCreateRetry: { canAttempt(id: number, kind: string, now: number): boolean };
  createView: ReturnType<typeof vi.fn>;
  sampleCreatedViewType: ReturnType<typeof vi.fn>;
  // The co-pilots are asked of the rally scene, built over the renderer.
  realmRacers: RealmRacersScene;
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
      questLog: new Map(),
    };
    renderer.views = new Map();
    renderer.questObjectHidden = makeQuestObjectGate({});
    renderer.viewCreateRetry = { canAttempt: () => true };
    renderer.createView = vi.fn();
    renderer.sampleCreatedViewType = vi.fn();
    renderer.realmRacers = new RealmRacersScene(renderer);

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
    renderer.sim = { entities: sim.entities, questLog: sim.questLog };
    renderer.views = new Map();
    renderer.questObjectHidden = makeQuestObjectGate({});
    renderer.viewCreateRetry = { canAttempt: () => true };
    renderer.createView = vi.fn();
    renderer.sampleCreatedViewType = vi.fn();
    renderer.realmRacers = new RealmRacersScene(renderer);
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

  it('draws every far co-pilot while rejecting a stranger at the same range', () => {
    const farDistanceSq = 170 * 170;
    for (const id of [11, 12, 13]) {
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
    expect(
      isOutsideRealmRacersDrawRange(participantIds, 10, 99, true, farDistanceSq, 80 * 80, 96 * 96),
    ).toBe(true);
  });

  it('preserves the normal 80/96 yard boundaries for strangers', () => {
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
    // The CREATE gate: the renderer's required views ask the rally scene for
    // the co-pilots, which runs each through the predicate into the same
    // required-view path as the player and their target.
    expect(renderer).toMatch(
      /private createRequiredViews\([\s\S]*?this\.realmRacers\.createCoPilotViews\(participantIds, player\.id, createdViewTypes\)/,
    );
    const scene = readFileSync(
      new URL('../src/render/realm_racers_scene.ts', import.meta.url),
      'utf8',
    );
    expect(scene).toMatch(
      /createCoPilotViews\([\s\S]*?isRealmRacersCoPilot\(participantIds, playerId, id\)[\s\S]*?h\.createRequiredView\(id, createdViewTypes\)/,
    );
    // The RETAIN gate is no longer a predicate of ours. The release gave every
    // view one shared drop scan (`collectDoomedViewsInto`), and a co-pilot rides
    // it as a range-exempt id with an INFINITE destroy range, which exempts them
    // from the distance arm and from nothing else (the core's own test drives
    // that). Pinned as that wiring, because the guarantee is that match
    // membership beats distance, not that any particular helper says so.
    expect(renderer).toMatch(
      /collectDoomedViewsInto\(this\.doomedIds,[^;]*rangeExemptIds: participantIds,/,
    );
    const scan = readFileSync(
      new URL('../src/render/view_candidate_scan_core.ts', import.meta.url),
      'utf8',
    );
    expect(scan).toMatch(
      /input\.rangeExemptIds\?\.includes\(id\)\s*\?\s*Number\.POSITIVE_INFINITY/,
    );
    expect(renderer.match(/isOutsideRealmRacersDrawRange\(/g)).toHaveLength(1);
  });
});
