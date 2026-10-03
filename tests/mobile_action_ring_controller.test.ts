// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AbilityDef } from '../src/sim/types';
import type {
  ActionBarAbility,
  ActionBarWorldInput,
} from '../src/ui/hud/action_bar/action_bar_view';
import {
  mobileButtonHasSourceSlot,
  mobileButtonOwnsSourceSlot,
  sourceSlotForMobileButton,
} from '../src/ui/hud/action_bar/mobile_action_page_view';
import { buildMobileActionRing } from '../src/ui/hud/action_bar/mobile_action_ring_controller';
import type { PainterHostWriters } from '../src/ui/painter_host';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

const writers: PainterHostWriters = {
  setText: vi.fn(),
  setDisplay: vi.fn(),
  setTransform: vi.fn(),
  setWidth: vi.fn(),
  setStyleProp: vi.fn(),
  toggleClass: vi.fn(),
  setAttr: vi.fn(),
};

const ability: ActionBarAbility = {
  def: {
    id: 'flamestrike',
    offGcd: false,
    cooldown: 6,
    requiresTarget: false,
    range: 30,
  } as AbilityDef,
  cost: 0,
};

function world(activeAimSlot: number | null): ActionBarWorldInput {
  return {
    player: {
      id: 1,
      autoAttack: false,
      dead: false,
      resource: 100,
      cooldowns: new Map(),
      gcdRemaining: 0,
      potionCdRemaining: 0,
      resourceType: 'mana',
      savedMana: 0,
      queuedOnSwing: null,
      auras: [],
      pos: { x: 0, y: 0, z: 0 },
    },
    target: null,
    inventory: [],
    stealthed: false,
    entities: [],
    activeAimSlot,
  };
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="mobile-action-ring">
      <button id="mobile-action-attack"></button>
      ${Array.from(
        { length: 4 },
        (_, index) => `<button class="mobile-action-slot" data-mobile-index="${index}"></button>`,
      ).join('')}
      <button id="mobile-action-page-toggle"><span class="mobile-action-page-indicator"></span></button>
    </div>
    <div id="mobile-action-radial">
      ${['up', 'right', 'down', 'left']
        .map(
          (direction, index) =>
            `<button class="mobile-action-petal" data-mobile-index="${index}" data-radial-dir="${direction}"></button>`,
        )
        .join('')}
      <button id="mobile-action-radial-cancel"></button>
    </div>
  `;
});

type RingDeps = Parameters<typeof buildMobileActionRing>[0];

function ringDeps(over: Partial<RingDeps> = {}): RingDeps {
  return {
    writers,
    iconBackground: () => '',
    sourceSlot: (buttonIndex, direction) => sourceSlotForMobileButton(0, buttonIndex, direction),
    hasSourceSlot: (buttonIndex, direction) =>
      mobileButtonHasSourceSlot(0, buttonIndex, undefined, direction),
    aimOwnsButton: () => false,
    cancelAim: vi.fn(),
    actionForSlot: () => ({ type: 'ability', id: ability.def.id }),
    abilityForSlot: () => ability,
    itemForSlot: () => null,
    empoweredAbilityIdForSlot: () => null,
    bindModeActive: () => false,
    takeSuppressedClick: () => false,
    castSlot: vi.fn(),
    cyclePage: vi.fn(),
    primary: () => 'attack',
    activateFixedAttackSlot: vi.fn(),
    attackNearest: null,
    attackTapState: () => ({ autoAttack: false, hasLiveHostileTarget: false }),
    hideTooltip: vi.fn(),
    consumePeekGuard: vi.fn(),
    bindEmpoweredHold: vi.fn(),
    ...over,
  };
}

describe('buildMobileActionRing aiming ownership', () => {
  it('marks the physical button that owns a petal aim and clears it when aim ends', () => {
    let activeAimSlot: number | null = 17;
    const ring = buildMobileActionRing(
      ringDeps({
        aimOwnsButton: (buttonIndex) => mobileButtonOwnsSourceSlot(0, buttonIndex, activeAimSlot),
      }),
    );

    expect(ring).not.toBeNull();
    expect(ring?.view.tick(world(activeAimSlot)).slots.map((slot) => slot.aiming)).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);

    activeAimSlot = null;
    expect(ring?.view.tick(world(activeAimSlot)).slots.every((slot) => !slot.aiming)).toBe(true);
  });
});

describe('buildMobileActionRing primary button', () => {
  const blast: ActionBarAbility = {
    def: {
      id: 'rally_ground_blast',
      offGcd: true,
      cooldown: 4.5,
      requiresTarget: false,
      range: 60,
      targetMode: 'position',
    } as AbilityDef,
    cost: 0,
  };
  const kitDeps = (over: Partial<RingDeps> = {}) =>
    ringDeps({
      primary: () => 'kit',
      actionForSlot: (slot) => (slot === 0 ? { type: 'ability', id: blast.def.id } : null),
      abilityForSlot: (slot) => (slot === 0 ? blast : null),
      ...over,
    });

  it('shows the kit ability pinned to slot 0 instead of the attack toggle', () => {
    const ring = buildMobileActionRing(kitDeps());
    const primary = ring?.view.tick(world(null)).slots[0];
    expect(primary?.kind).toBe('ability');
    expect(primary?.abilityId).toBe('rally_ground_blast');
  });

  it('casts slot 0 on a tap while a kit owns it, never the attack toggle', () => {
    const deps = kitDeps();
    const ring = buildMobileActionRing(deps);
    ring?.attackBtn.click();
    expect(deps.castSlot).toHaveBeenCalledExactlyOnceWith(0);
    expect(deps.activateFixedAttackSlot).not.toHaveBeenCalled();
  });

  it('marks the primary button as aiming while the ground aim belongs to slot 0', () => {
    const ring = buildMobileActionRing(kitDeps());
    expect(ring?.view.tick(world(0)).slots.map((slot) => slot.aiming)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(ring?.view.tick(world(null)).slots[0].aiming).toBe(false);
  });

  it('shows an empty seat, not the attack toggle, while the kit slot holds nothing', () => {
    const ring = buildMobileActionRing(
      kitDeps({ actionForSlot: () => null, abilityForSlot: () => null }),
    );
    expect(ring?.view.tick(world(null)).slots[0].kind).toBe('empty');
  });

  it('keeps the attack toggle everywhere else, whatever desktop slot 0 holds', () => {
    const deps = ringDeps({
      attackTapState: () => ({ autoAttack: true, hasLiveHostileTarget: true }),
    });
    const ring = buildMobileActionRing(deps);
    expect(ring?.view.tick(world(0)).slots[0]).toMatchObject({ kind: 'attack', aiming: false });
    ring?.attackBtn.click();
    expect(deps.activateFixedAttackSlot).toHaveBeenCalledOnce();
    expect(deps.castSlot).not.toHaveBeenCalled();
  });
});
