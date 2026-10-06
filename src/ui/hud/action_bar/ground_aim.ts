import { MORTAR_OVERDRIVE_ABILITIES } from '../../../sim/content/mortar_overdrive/kit';
import { ABILITIES } from '../../../sim/data';
import { resolveGroundBlastAim } from '../../../sim/mortar_overdrive/ground_blast';
import type { ResolvedAbility } from '../../../sim/sim';
import type { AbilityEffect, Entity } from '../../../sim/types';

export interface AimPoint {
  x: number;
  z: number;
}

/** A living, non-self selected target seeds precise aim only if attackable.
 * Quick targeting intentionally accepts friendly targets too, as before. */
export function selectedGroundAimPoint(
  player: Pick<Entity, 'id' | 'targetId' | 'pos'>,
  entities: ReadonlyMap<number, Entity>,
  attackable?: (id: number) => boolean,
): AimPoint | null {
  const target = player.targetId !== null ? entities.get(player.targetId) : null;
  if (!target || target.dead || target.id === player.id || (attackable && !attackable(target.id)))
    return null;
  return { x: target.pos.x, z: target.pos.z };
}

// Where a ground-targeted ability should land: the current target's position if
// one is selected (the usual "cast on that pack" intent), else the caster's own
// spot for an open-ground cast. The sim clamps this to the ability's range.
/** Without a valid selected target, instant desktop casts use the player's feet. */
export function quickGroundTarget(player: Entity, entities: ReadonlyMap<number, Entity>): AimPoint {
  return selectedGroundAimPoint(player, entities) ?? { x: player.pos.x, z: player.pos.z };
}

export interface GroundAimState {
  activeAbilityId: string | null;
  activeSlot: number | null;
}

export const DEFAULT_GROUND_AOE_RADIUS = 6;

/** Aim-slot sentinel for an ability arranged only on the cross hotbar: no bar
 *  slot can equal it, so re-press commit resolves by ability id instead. */
export const XHB_ONLY_AIM_SLOT = -1;

/**
 * Touch uses the dedicated precise-targeting preference. Desktop remains
 * governed by the player's ground-reticle preference.
 *
 * A Mortar Overdrive weapon overrides BOTH, so `abilityId` is passed wherever the
 * caller knows which ability is about to cast: placing the shell is the entire
 * weapon, so it always aims. The reticle-off fallback (drop it on your target's
 * feet, else your own) has no meaning for a shot whose skill is leading a
 * machine up the road, and on the circuit there is no selected target to fall
 * back to anyway.
 */
export function shouldUseGroundAim(
  mobileTouch: boolean,
  desktopPreference: boolean,
  touchPrecise: boolean,
  abilityId?: string,
): boolean {
  if (abilityId !== undefined && MORTAR_OVERDRIVE_ABILITIES[abilityId]) return true;
  return mobileTouch ? touchPrecise : desktopPreference;
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
 * Most abilities are limited by range alone. A Mortar Overdrive weapon is also
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
  if (abilityId !== undefined && MORTAR_OVERDRIVE_ABILITIES[abilityId]) {
    const aim = resolveGroundBlastAim(
      { x: caster.pos.x, z: caster.pos.z, facing: caster.facing },
      point,
    );
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

/**
 * May the client play INSTANT local feedback for this Mortar Overdrive cast? Online,
 * every audible and visible cue otherwise waits a full round trip for the
 * server (the shell's Fired event, the readout's oil patch), which reads as
 * the kit responding late.
 *
 * `expectedAbilityId` names the ONE Mortar Overdrive ability the caller's feedback is
 * built for (the shell's muzzle report, the oil drop's patch), so a future
 * Mortar Overdrive ability can never inherit another's cue. The remaining inputs mirror
 * the client-visible half of the sim's refusal set
 * (src/sim/mortar_overdrive/race.ts): a live caster, the activity lock
 * (controls locked or out of charges), no running cooldown, the racing
 * phase, and a pilot whose own race is not over (a finished or retired pilot
 * keeps the wheel but is done acting). The server stays the judge either
 * way: a wrong local yes costs one cosmetic cue that quietly expires.
 */
export function localMortarOverdriveCastFeedbackAllowed(
  abilityId: string,
  expectedAbilityId: string,
  casterDead: boolean,
  activityLocked: boolean,
  cooldownRemaining: number,
  racingPhase: boolean,
  stillRunning: boolean,
): boolean {
  return (
    abilityId === expectedAbilityId &&
    !casterDead &&
    !activityLocked &&
    cooldownRemaining <= 0 &&
    racingPhase &&
    stillRunning
  );
}

export function smartSeedPoint(
  caster: Pick<Entity, 'pos' | 'facing'>,
  targetPoint: AimPoint | null,
  range: number,
): AimPoint {
  if (targetPoint) return clampAimToRange(caster, targetPoint, range).point;
  const effectiveRange = range > 0 ? range : 5;
  const distance = effectiveRange / 2;
  return {
    x: caster.pos.x + Math.sin(caster.facing) * distance,
    z: caster.pos.z + Math.cos(caster.facing) * distance,
  };
}

/** The point a QUICK (no-reticle) cast submits. The device's classic point
 *  (the smart seed on touch, target-or-feet elsewhere) wins unless it violates
 *  the ability's minimum range; then the seed, then a facing push landing half
 *  a yard past the minimum, so the sim's proposed-point refusal can never trip
 *  on a float round-trip. */
export function quickAimPoint(
  caster: Pick<Entity, 'pos' | 'facing'>,
  targetPoint: AimPoint | null,
  classicPoint: AimPoint,
  range: number,
  minRange: number | undefined,
  preferSeed = false,
): AimPoint {
  const preferred = preferSeed ? smartSeedPoint(caster, targetPoint, range) : classicPoint;
  if (!withinMinRange(caster, preferred, minRange)) return preferred;
  const seed = smartSeedPoint(caster, targetPoint, range);
  if (!withinMinRange(caster, seed, minRange)) return seed;
  const effectiveRange = range > 0 ? range : 5;
  const distance = Math.min(Math.max(effectiveRange / 2, (minRange ?? 0) + 0.5), effectiveRange);
  return {
    x: caster.pos.x + Math.sin(caster.facing) * distance,
    z: caster.pos.z + Math.cos(caster.facing) * distance,
  };
}

export function withinMinRange(
  caster: Pick<Entity, 'pos'>,
  point: AimPoint,
  minRange: number | undefined,
): boolean {
  return !!minRange && Math.hypot(point.x - caster.pos.x, point.z - caster.pos.z) < minRange;
}

export function abilityAoeRadius(res: { effects: readonly AbilityEffect[] }): number {
  const effect = res.effects.find(
    (eff) =>
      eff.type === 'aoeDamage' ||
      eff.type === 'groundAoE' ||
      eff.type === 'mortarOverdriveGroundBlast' ||
      eff.type === 'temporalHourglass',
  );
  if (effect?.type === 'temporalHourglass') return effect.captureRadius;
  return effect && 'radius' in effect ? effect.radius : DEFAULT_GROUND_AOE_RADIUS;
}

export function resolveGroundAimAbility(
  known: ReadonlyArray<ResolvedAbility>,
  id: string,
): ResolvedAbility | null {
  const match = known.find((k) => k.def.id === id);
  if (match) return match;
  if (id === 'clockwork_shock_bomb' && ABILITIES.clockwork_shock_bomb) {
    const def = ABILITIES.clockwork_shock_bomb;
    return { def, effects: def.effects ?? [] } as ResolvedAbility;
  }
  return null;
}
