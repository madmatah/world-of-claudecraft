// A Mortar Overdrive seat holds the pilot like a vehicle seat (items.ts useItem):
// nothing from the bags may cast a teleport off the circuit or plant a
// standard on the lane. And the seat and the return are relocations
// (mortar_overdrive/race.ts placeRacer / restoreRacer): a pilot seated mid-jump
// or mid-glide, or handed back mid-air, lands settled, never with a fall
// carried over from the far side.

import { describe, expect, it } from 'vitest';
import { startMortarOverdrivePractice } from '../src/sim/mortar_overdrive/bots';
import { mortarOverdriveMatchOf } from '../src/sim/mortar_overdrive/race';
import { ALLIED_HEARTHSTONE_CAST_ID } from '../src/sim/types';
import { addAt, makeWorld } from './mortar_overdrive_util';

function stock(sim: ReturnType<typeof makeWorld>, pid: number): void {
  const meta = sim.players.get(pid);
  if (!meta) throw new Error('no meta');
  meta.alliedHearthstoneAttunement = 'church_order';
  sim.addItem('allied_hearthstone', 1, pid);
  sim.addItem('dawn_battle_standard', 1, pid);
}

const standards = (sim: ReturnType<typeof makeWorld>): number =>
  [...sim.entities.values()].filter((e) => e.templateId === 'dawn_battle_standard').length;

describe('a seated racer uses nothing from the bags', () => {
  it('casts no Allied Hearthstone and plants no Dawn Battle Standard while seated', () => {
    const sim = makeWorld();
    // The control: the same items, used off the circuit, do start and plant.
    const walker = addAt(sim, 'warrior', 'Walker', 6, -40);
    stock(sim, walker);
    sim.useItem('allied_hearthstone', walker);
    expect(sim.entities.get(walker)?.castingAbility).toBe(ALLIED_HEARTHSTONE_CAST_ID);
    const before = standards(sim);
    const planter = addAt(sim, 'warrior', 'Planter', -6, -40);
    stock(sim, planter);
    sim.useItem('dawn_battle_standard', planter);
    expect(standards(sim)).toBe(before + 1);

    const pilot = addAt(sim, 'warrior', 'Pilot');
    stock(sim, pilot);
    expect(startMortarOverdrivePractice(sim, 'ace', pilot)).toBe(true);
    expect(mortarOverdriveMatchOf(sim.ctx, pilot)).not.toBeNull();
    sim.useItem('allied_hearthstone', pilot);
    expect(sim.entities.get(pilot)?.castingAbility ?? null).toBeNull();
    sim.useItem('dawn_battle_standard', pilot);
    expect(standards(sim)).toBe(before + 1);
    expect(sim.countItem('dawn_battle_standard', pilot)).toBe(1);
  });
});

describe('the seat and the return land the pilot settled', () => {
  it('drops a carried fall at the seat and again at the return', () => {
    const sim = makeWorld();
    const pid = addAt(sim, 'warrior', 'Pilot');
    const e = sim.entities.get(pid);
    if (!e) throw new Error('no pilot');
    const airborne = (): void => {
      e.onGround = false;
      e.jumping = true;
      e.vy = -6;
      e.fallStartY = e.pos.y + 60;
    };

    airborne();
    expect(startMortarOverdrivePractice(sim, 'ace', pid)).toBe(true);
    expect({ onGround: e.onGround, jumping: e.jumping, vy: e.vy }).toEqual({
      onGround: true,
      jumping: false,
      vy: 0,
    });
    expect(e.fallStartY).toBe(e.pos.y);

    airborne();
    sim.mortarOverdriveForfeit(pid, true);
    expect(mortarOverdriveMatchOf(sim.ctx, pid)).toBeNull();
    expect({ onGround: e.onGround, jumping: e.jumping, vy: e.vy }).toEqual({
      onGround: true,
      jumping: false,
      vy: 0,
    });
    expect(e.fallStartY).toBe(e.pos.y);
    const hp = e.hp;
    for (let i = 0; i < 20; i++) sim.tick();
    expect(e.hp).toBe(hp);
  });
});
