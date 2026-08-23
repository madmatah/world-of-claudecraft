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
import {
  REALM_RACERS_ABILITY_ID,
  REALM_RACERS_WEAPON_CHARGES,
} from '../src/sim/content/realm_racers';
import { REALM_RACERS_COUNTDOWN_TICKS, realmRacersMatchOf } from '../src/sim/social/realm_racers';
import type { Entity } from '../src/sim/types';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import type { ActionBarPlayerInput } from '../src/ui/hud/action_bar/action_bar_view';
import { addAt, makeWorld } from './vale_cup_util';

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

describe('ability budget: the two shapes that really call it agree', () => {
  /** The action bar's deliberately narrow player input, rebuilt from the live
   *  entity the way the HUD's world adapters mirror it: fresh plain objects
   *  carrying only the declared fields, so the agreement below is about the
   *  SHAPE and not about two aliases of one object. */
  function actionBarShape(e: Entity): ActionBarPlayerInput {
    const charges: NonNullable<ActionBarPlayerInput['abilityCharges']> = {};
    for (const [id, pool] of Object.entries(e.abilityCharges ?? {})) {
      if (pool) charges[id] = { charges: pool.charges, fixed: pool.fixed };
    }
    return {
      id: e.id,
      autoAttack: false,
      dead: e.dead,
      resource: e.resource,
      // Mirrored off the entity like every field above, not defaulted: the whole
      // point of this shape is that it carries what the live bar reads, and a
      // druid running a form has its real pool parked in savedMana.
      resourceType: e.resourceType,
      savedMana: e.savedMana,
      cooldowns: e.cooldowns,
      gcdRemaining: 0,
      potionCdRemaining: 0,
      queuedOnSwing: null,
      pos: e.pos,
      abilityCharges: charges,
      drive: e.drive ? { controlsLocked: e.drive.controlsLocked } : null,
      auras: [],
    };
  }

  it('answers identically for a REAL seated racer and the narrow bar input, in all three states', () => {
    const sim = makeWorld();
    const human = addAt(sim, 'warrior', 'Aster', -5, -40);
    sim.realmRacersPracticeStart('driver', human);
    sim.tick();
    const race = realmRacersMatchOf(sim.ctx, human);
    if (!race) throw new Error('no practice race');
    const racer = sim.entities.get(human);
    if (!racer) throw new Error('no racer entity');

    /** Both shapes through the SAME predicates; failing on disagreement names
     *  the state and the predicate, then the caller pins the expected truth. */
    const agreed = (label: string): { locked: boolean; spent: boolean; controls: boolean } => {
      const narrow = actionBarShape(racer);
      const locked = isAbilityLockedByActivity(racer, WEAPON);
      const spent = isAbilityBudgetSpent(racer, WEAPON);
      const controls = areAbilityControlsLocked(racer);
      expect(isAbilityLockedByActivity(narrow, WEAPON), `${label}: locked`).toBe(locked);
      expect(isAbilityBudgetSpent(narrow, WEAPON), `${label}: spent`).toBe(spent);
      expect(areAbilityControlsLocked(narrow), `${label}: controls`).toBe(controls);
      return { locked, spent, controls };
    };

    // LOCKED: held on the grid through the countdown, budget untouched.
    expect(race.phase).toBe('countdown');
    expect(agreed('countdown')).toEqual({ locked: true, spent: false, controls: true });

    // CLEAR: the flag drops and the pilot has the machine and the full budget.
    // One beat past the flip: the tick that turns the phase has already stamped
    // the countdown lock, so the unlock lands on the following pass.
    for (let i = 0; i < REALM_RACERS_COUNTDOWN_TICKS + 5 && race.phase !== 'racing'; i++) {
      sim.tick();
    }
    sim.tick();
    expect(race.phase).toBe('racing');
    expect(agreed('racing')).toEqual({ locked: false, spent: false, controls: false });

    // SPENT: the whole fixed budget fired off, controls still in hand.
    for (let shot = 0; shot < REALM_RACERS_WEAPON_CHARGES; shot++) {
      racer.cooldowns.delete(WEAPON);
      sim.castAbility(WEAPON, human);
    }
    expect(racer.abilityCharges?.[WEAPON]?.charges).toBe(0);
    expect(agreed('spent')).toEqual({ locked: true, spent: true, controls: false });
  });
});
