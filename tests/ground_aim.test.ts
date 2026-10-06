import { describe, expect, it } from 'vitest';
import { MORTAR_OVERDRIVE_ABILITY_ID } from '../src/sim/content/mortar_overdrive/kit';
import { ABILITIES } from '../src/sim/data';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_MAX_RANGE,
  resolveGroundBlastAim,
} from '../src/sim/mortar_overdrive/ground_blast';
import type { AbilityEffect, Entity } from '../src/sim/types';
import {
  abilityAoeRadius,
  cancelGroundAim,
  clampAimToRange,
  commitGroundAim,
  createGroundAimState,
  DEFAULT_GROUND_AOE_RADIUS,
  enterGroundAim,
  localMortarOverdriveCastFeedbackAllowed,
  shouldUseGroundAim,
  smartSeedPoint,
  withinMinRange,
} from '../src/ui/hud/action_bar/ground_aim';

function casterAt(x: number, z: number, facing = 0): Pick<Entity, 'pos' | 'facing'> {
  return { pos: { x, y: 0, z }, facing };
}

describe('ground_aim', () => {
  it('uses the precise touch preference for every mobile ground cast', () => {
    expect(shouldUseGroundAim(true, false, true)).toBe(true);
    expect(shouldUseGroundAim(true, true, true)).toBe(true);
    expect(shouldUseGroundAim(true, true, false)).toBe(false);
    expect(shouldUseGroundAim(true, false, false)).toBe(false);
  });

  it('keeps desktop ground placement controlled by its preference', () => {
    expect(shouldUseGroundAim(false, true, false)).toBe(true);
    expect(shouldUseGroundAim(false, false, true)).toBe(false);
    expect(shouldUseGroundAim(false, true, false)).toBe(true);
  });

  it('always aims a Mortar Overdrive weapon, whatever the host or the preference', () => {
    // Placing the shell IS the weapon: the reticle-off fallback (your target's
    // feet, else your own) has no meaning for it, and on the circuit there is no
    // selected target to fall back to.
    for (const mobileTouch of [false, true]) {
      for (const preference of [false, true]) {
        // One value per host knob: `preference` is the desktop placement toggle
        // off mobile and the precise-touch toggle on it, so both hosts are swept
        // with their own switch in both positions.
        expect(
          shouldUseGroundAim(mobileTouch, preference, preference, MORTAR_OVERDRIVE_ABILITY_ID),
        ).toBe(true);
      }
    }
  });

  it('holds a Mortar Overdrive aim inside its forward cone, mirroring the sim', () => {
    // Facing +z, aiming 90 degrees out to the side: the barrel is bolted to the
    // chassis, so the circle slides back onto the cone edge instead of going
    // where the cursor asked. The clamp is the sim's own function, so what the
    // player commits to is exactly what the server will resolve.
    const point = { x: 30, z: 0 };
    const aim = clampAimToRange(
      casterAt(0, 0),
      point,
      GROUND_BLAST_MAX_RANGE,
      MORTAR_OVERDRIVE_ABILITY_ID,
    );
    const mirror = resolveGroundBlastAim({ x: 0, z: 0, facing: 0 }, point);
    expect(aim.clamped).toBe(true);
    expect(aim.point).toEqual({ x: mirror.x, z: mirror.z });
    expect(Math.atan2(aim.point.x, aim.point.z)).toBeCloseTo(GROUND_BLAST_AIM_CONE_RAD, 9);
    // The same request under any OTHER ability id keeps the plain range clamp,
    // so the cone is the Mortar Overdrive weapon's rule and nobody else's.
    const plain = clampAimToRange(casterAt(0, 0), point, GROUND_BLAST_MAX_RANGE, 'flamestrike');
    expect(plain.point).toEqual(point);
  });

  it('passes through points inside range', () => {
    const aim = clampAimToRange(casterAt(10, -4), { x: 16, z: -4 }, 8);
    expect(aim).toEqual({ point: { x: 16, z: -4 }, clamped: false });
  });

  it('clamps beyond range with the same math as the sim cast path', () => {
    const aim = clampAimToRange(casterAt(10, -4), { x: 20, z: 20 }, 13);
    const dx = aim.point.x - 10;
    const dz = aim.point.z + 4;
    expect(aim.clamped).toBe(true);
    expect(Math.hypot(dx, dz)).toBeCloseTo(13, 6);
    expect(aim.point.x).toBeCloseTo(15, 6);
    expect(aim.point.z).toBeCloseTo(8, 6);
  });

  it('clamps a selected target seed to the ability range', () => {
    const seed = smartSeedPoint({ pos: { x: 10, y: 0, z: -4 }, facing: 0 }, { x: 60, z: -4 }, 30);

    expect(seed).toEqual({ x: 40, z: -4 });
  });

  it('seeds halfway forward when no target is selected', () => {
    const seed = smartSeedPoint({ pos: { x: 10, y: 0, z: -4 }, facing: 0 }, null, 30);

    expect(seed).toEqual({ x: 10, z: 11 });
    expect(seed).not.toEqual({ x: 10, z: -4 });
  });

  it('uses a five yard effective range when the authored range is not positive', () => {
    const seed = smartSeedPoint({ pos: { x: 10, y: 0, z: -4 }, facing: 0 }, null, 0);

    expect(seed).toEqual({ x: 10, z: -1.5 });
  });

  it('uses the player motion sin and cos facing basis', () => {
    const facing = Math.PI / 3;
    const seed = smartSeedPoint({ pos: { x: 2, y: 0, z: 5 }, facing }, null, 20);

    expect(seed.x).toBeCloseTo(2 + Math.sin(facing) * 10, 6);
    expect(seed.z).toBeCloseTo(5 + Math.cos(facing) * 10, 6);
  });

  it('recognizes only points inside an authored minimum range', () => {
    const caster = casterAt(10, -4);

    expect(withinMinRange(caster, { x: 13, z: 0 }, 6)).toBe(true);
    expect(withinMinRange(caster, { x: 16, z: -4 }, 6)).toBe(false);
    expect(withinMinRange(caster, { x: 10, z: -4 }, undefined)).toBe(false);
  });

  it('resolves radius from the first aoeDamage, groundAoE, or channel pulse effect', () => {
    const aoeDamage: AbilityEffect[] = [{ type: 'aoeDamage', min: 1, max: 2, radius: 7 }];
    const groundAoE: AbilityEffect[] = [
      { type: 'groundAoE', min: 1, max: 2, radius: 8, duration: 4, interval: 1 },
    ];
    const channelPulse: AbilityEffect[] = [{ type: 'aoeDamage', min: 1, max: 2, radius: 9 }];

    expect(abilityAoeRadius({ effects: aoeDamage })).toBe(7);
    expect(abilityAoeRadius({ effects: groundAoE })).toBe(8);
    expect(abilityAoeRadius({ effects: channelPulse })).toBe(9);
  });

  it('falls back when no area radius is present', () => {
    expect(abilityAoeRadius({ effects: [{ type: 'directDamage', min: 1, max: 2 }] })).toBe(
      DEFAULT_GROUND_AOE_RADIUS,
    );
  });

  it('uses Meteor actual 8-yard impact radius', () => {
    expect(abilityAoeRadius(ABILITIES.meteor)).toBe(8);
  });

  it('uses the Hourglass capture radius for its compact ground reticle', () => {
    expect(
      abilityAoeRadius({
        effects: [
          {
            type: 'temporalHourglass',
            duration: 5,
            hostilePveDuration: 60,
            hostilePvpDuration: 10,
            groundDuration: 30,
            selfRadius: 1.5,
            captureRadius: 1.75,
            healMaxHpPct: 0.3,
            selfCooldownRate: 2,
            allyCooldownRate: 1.75,
          },
        ],
      }),
    ).toBe(1.75);
  });

  it('transitions enter to cancel to commit', () => {
    const idle = createGroundAimState();
    const active = enterGroundAim(idle, 'flamestrike', 11);
    expect(active).toEqual({ activeAbilityId: 'flamestrike', activeSlot: 11 });
    expect(cancelGroundAim(active)).toEqual({ activeAbilityId: null, activeSlot: null });

    const second = enterGroundAim(idle, 'earthquake', 3);
    expect(commitGroundAim(second)).toEqual({
      abilityId: 'earthquake',
      state: { activeAbilityId: null, activeSlot: null },
    });
  });
});

describe('localMortarOverdriveCastFeedbackAllowed', () => {
  // The gate mirrors the client-visible half of the sim's Mortar Overdrive refusal set.
  // Every dimension gets its own negative case: a gate that only ever ran
  // fully-open would pass while refusing nothing.
  const allowed = (over: Partial<Record<string, unknown>> = {}) =>
    localMortarOverdriveCastFeedbackAllowed(
      (over.abilityId as string) ?? MORTAR_OVERDRIVE_ABILITY_ID,
      MORTAR_OVERDRIVE_ABILITY_ID,
      (over.casterDead as boolean) ?? false,
      (over.activityLocked as boolean) ?? false,
      (over.cooldownRemaining as number) ?? 0,
      (over.racingPhase as boolean) ?? true,
      (over.stillRunning as boolean) ?? true,
    );

  it('allows the shell when every mirror says the sim would accept it', () => {
    expect(allowed()).toBe(true);
  });

  it('refuses each client-visible reason the sim refuses on', () => {
    // The shell ONLY: a future position-targeted Mortar Overdrive ability must not
    // inherit the Ground Blast's muzzle report.
    expect(allowed({ abilityId: 'mortar_overdrive_nitro' })).toBe(false);
    expect(allowed({ abilityId: 'flamestrike' })).toBe(false);
    expect(allowed({ casterDead: true })).toBe(false);
    expect(allowed({ activityLocked: true })).toBe(false);
    expect(allowed({ cooldownRemaining: 2.5 })).toBe(false);
    // Countdown and podium are not the racing phase.
    expect(allowed({ racingPhase: false })).toBe(false);
    // A finished or retired pilot keeps the wheel but is done shooting.
    expect(allowed({ stillRunning: false })).toBe(false);
  });
});
