import { describe, expect, it } from 'vitest';
import { REALM_RACERS_ABILITY_ID } from '../src/sim/content/realm_racers';
import { ABILITIES } from '../src/sim/data';
import {
  GROUND_BLAST_AIM_CONE_RAD,
  GROUND_BLAST_MAX_RANGE,
  resolveGroundBlastAim,
} from '../src/sim/realm_racers_ground_blast';
import type { AbilityEffect, Entity } from '../src/sim/types';
import {
  abilityAoeRadius,
  cancelGroundAim,
  clampAimToRange,
  commitGroundAim,
  createGroundAimState,
  DEFAULT_GROUND_AOE_RADIUS,
  enterGroundAim,
  localBlastFeedbackAllowed,
  shouldUseGroundAim,
} from '../src/ui/hud/action_bar/ground_aim';

function casterAt(x: number, z: number, facing = 0): Pick<Entity, 'pos' | 'facing'> {
  return { pos: { x, y: 0, z }, facing };
}

describe('ground_aim', () => {
  it('opens touch placement for Meteor without changing other mobile ground casts', () => {
    expect(shouldUseGroundAim('meteor', true, false)).toBe(true);
    expect(shouldUseGroundAim('flamestrike', true, true)).toBe(false);
  });

  it('keeps desktop ground placement controlled by its preference', () => {
    expect(shouldUseGroundAim('meteor', false, true)).toBe(true);
    expect(shouldUseGroundAim('meteor', false, false)).toBe(false);
    expect(shouldUseGroundAim('flamestrike', false, true)).toBe(true);
  });

  it('always aims a Realm Racers weapon, whatever the host or the preference', () => {
    // Placing the shell IS the weapon: the reticle-off fallback (your target's
    // feet, else your own) has no meaning for it, and on the circuit there is no
    // selected target to fall back to.
    for (const mobileTouch of [false, true]) {
      for (const preference of [false, true]) {
        expect(shouldUseGroundAim(REALM_RACERS_ABILITY_ID, mobileTouch, preference)).toBe(true);
      }
    }
  });

  it('holds a Realm Racers aim inside its forward cone, mirroring the sim', () => {
    // Facing +z, aiming 90 degrees out to the side: the barrel is bolted to the
    // chassis, so the circle slides back onto the cone edge instead of going
    // where the cursor asked. The clamp is the sim's own function, so what the
    // player commits to is exactly what the server will resolve.
    const point = { x: 30, z: 0 };
    const aim = clampAimToRange(
      casterAt(0, 0),
      point,
      GROUND_BLAST_MAX_RANGE,
      REALM_RACERS_ABILITY_ID,
    );
    const mirror = resolveGroundBlastAim({ x: 0, z: 0, facing: 0 }, point);
    expect(aim.clamped).toBe(true);
    expect(aim.point).toEqual({ x: mirror.x, z: mirror.z });
    expect(Math.atan2(aim.point.x, aim.point.z)).toBeCloseTo(GROUND_BLAST_AIM_CONE_RAD, 9);
    // The same request under any OTHER ability id keeps the plain range clamp,
    // so the cone is the rally weapon's rule and nobody else's.
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

describe('localBlastFeedbackAllowed', () => {
  // The gate mirrors the client-visible half of realmRacersFireGroundBlast's
  // refusal set. Every dimension gets its own negative case: a gate that only
  // ever ran fully-open would pass while refusing nothing.
  const allowed = (over: Partial<Record<string, unknown>> = {}) =>
    localBlastFeedbackAllowed(
      (over.abilityId as string) ?? REALM_RACERS_ABILITY_ID,
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
    // The shell ONLY: a future position-targeted rally ability must not
    // inherit the Ground Blast's muzzle report.
    expect(allowed({ abilityId: 'rally_nitro' })).toBe(false);
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
