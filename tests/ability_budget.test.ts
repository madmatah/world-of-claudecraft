// The two "an activity lent you this kit and is refusing it" answers.
//
// The whole reason this is its own leaf is that BOTH sides of the wire must give
// the same answer: the sim refuses the cast with it (authority) and the HUD reads
// it to decide whether pressing the key is worth opening a ground-aim mode at
// all. So the cases here are written against the two shapes that really call it,
// a full sim `Entity` and the action bar's deliberately narrow player input, and
// assert they agree.

import { describe, expect, it } from 'vitest';
import {
  areAbilityControlsLocked,
  isAbilityBudgetSpent,
  isAbilityLockedByActivity,
} from '../src/sim/ability_budget';
import { REALM_RACERS_ABILITY_ID } from '../src/sim/content/realm_racers';
import { createVehicleDrive } from '../src/sim/vehicle_motion';

const WEAPON = REALM_RACERS_ABILITY_ID;

function budget(charges: number, fixed: boolean) {
  return { [WEAPON]: { charges, maxCharges: 3, recharge: 0, rechargeLength: 0, fixed } };
}

function lockedDrive(controlsLocked: boolean) {
  return { ...createVehicleDrive('rally_loaner'), controlsLocked };
}

describe('ability budget: a spent activity kit', () => {
  it('is spent only at zero, and only for a FIXED pool', () => {
    expect(isAbilityBudgetSpent({ abilityCharges: budget(0, true) }, WEAPON)).toBe(true);
    expect(isAbilityBudgetSpent({ abilityCharges: budget(1, true) }, WEAPON)).toBe(false);
    // A pool on the RECHARGE model is never "spent": its empty state is a timer
    // the player waits out, and the action bar sweeps it rather than greying it.
    expect(isAbilityBudgetSpent({ abilityCharges: budget(0, false) }, WEAPON)).toBe(false);
  });

  it('says nothing about an ability with no pool at all', () => {
    expect(isAbilityBudgetSpent({}, WEAPON)).toBe(false);
    expect(isAbilityBudgetSpent({ abilityCharges: budget(0, true) }, 'fireball')).toBe(false);
  });
});

describe('ability budget: locked controls', () => {
  it('reads the machine, and is false for anyone on foot', () => {
    expect(areAbilityControlsLocked({ drive: lockedDrive(true) })).toBe(true);
    expect(areAbilityControlsLocked({ drive: lockedDrive(false) })).toBe(false);
    expect(areAbilityControlsLocked({ drive: null })).toBe(false);
    expect(areAbilityControlsLocked({})).toBe(false);
  });

  it('locks EVERY ability, not just the one that ran out', () => {
    const held = { drive: lockedDrive(true), abilityCharges: budget(3, true) };
    expect(isAbilityLockedByActivity(held, WEAPON)).toBe(true);
    expect(isAbilityLockedByActivity(held, 'fireball')).toBe(true);
  });

  it('combines the two reasons and clears when neither holds', () => {
    expect(
      isAbilityLockedByActivity(
        { drive: lockedDrive(false), abilityCharges: budget(0, true) },
        WEAPON,
      ),
    ).toBe(true);
    expect(
      isAbilityLockedByActivity(
        { drive: lockedDrive(false), abilityCharges: budget(2, true) },
        WEAPON,
      ),
    ).toBe(false);
  });
});
