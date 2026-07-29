import { REALM_RACERS_ABILITIES } from '../../../sim/content/realm_racers';
import { resolveShellAim } from '../../../sim/realm_racers_shell';
import type { AbilityEffect, Entity } from '../../../sim/types';

export interface AimPoint {
  x: number;
  z: number;
}

export interface GroundAimState {
  activeAbilityId: string | null;
  activeSlot: number | null;
}

export const DEFAULT_GROUND_AOE_RADIUS = 6;

/**
 * Touch normally keeps instant target-feet casting, but Meteor needs an
 * explicit terrain tap so it never falls on the caster merely for lacking a
 * selected target. Desktop remains governed by the player's reticle setting.
 *
 * A Realm Racers weapon overrides BOTH: placing the shell is the entire
 * weapon, so it always aims. The reticle-off fallback (drop it on your target's
 * feet, else your own) has no meaning for a shot whose skill is leading a
 * machine up the road, and on the circuit there is no selected target to fall
 * back to anyway.
 */
export function shouldUseGroundAim(
  abilityId: string,
  mobileTouch: boolean,
  desktopPreference: boolean,
): boolean {
  if (REALM_RACERS_ABILITIES[abilityId]) return true;
  return mobileTouch ? abilityId === 'meteor' : desktopPreference;
}

export function createGroundAimState(): GroundAimState {
  return { activeAbilityId: null, activeSlot: null };
}

export function enterGroundAim(
  state: GroundAimState,
  abilityId: string,
  slot: number,
): GroundAimState {
  return { ...state, activeAbilityId: abilityId, activeSlot: slot };
}

export function cancelGroundAim(state: GroundAimState): GroundAimState {
  if (state.activeAbilityId === null && state.activeSlot === null) return state;
  return { ...state, activeAbilityId: null, activeSlot: null };
}

export function commitGroundAim(state: GroundAimState): {
  state: GroundAimState;
  abilityId: string | null;
} {
  const abilityId = state.activeAbilityId;
  return { state: cancelGroundAim(state), abilityId };
}

/**
 * Where a ground-targeted cast may actually land, from where the player asked.
 *
 * Most abilities are limited by range alone. A Realm Racers weapon is also
 * limited by a forward CONE and a minimum range, and those rules live in the sim
 * leaf that RE-CLAMPS the aim server-side: running the identical function here
 * is what guarantees the circle a pilot commits to is the crater they get. A
 * second copy of the arithmetic in the HUD would be a rule the server does not
 * share, which is the way this kind of feature normally goes wrong.
 */
export function clampAimToRange(
  caster: Pick<Entity, 'pos' | 'facing'>,
  point: AimPoint,
  range: number,
  abilityId?: string,
): {
  point: AimPoint;
  clamped: boolean;
} {
  if (abilityId !== undefined && REALM_RACERS_ABILITIES[abilityId]) {
    const aim = resolveShellAim({ x: caster.pos.x, z: caster.pos.z, facing: caster.facing }, point);
    return { point: { x: aim.x, z: aim.z }, clamped: aim.clamped };
  }
  const maxRange = range > 0 ? range : 5;
  const dx = point.x - caster.pos.x;
  const dz = point.z - caster.pos.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxRange || d === 0) return { point: { x: point.x, z: point.z }, clamped: false };
  return {
    point: {
      x: caster.pos.x + (dx / d) * maxRange,
      z: caster.pos.z + (dz / d) * maxRange,
    },
    clamped: true,
  };
}

export function abilityAoeRadius(res: { effects: readonly AbilityEffect[] }): number {
  const effect = res.effects.find(
    (eff) =>
      eff.type === 'aoeDamage' ||
      eff.type === 'groundAoE' ||
      eff.type === 'realmRacersShell' ||
      eff.type === 'temporalHourglass',
  );
  if (effect?.type === 'temporalHourglass') return effect.captureRadius;
  return effect && 'radius' in effect ? effect.radius : DEFAULT_GROUND_AOE_RADIUS;
}
