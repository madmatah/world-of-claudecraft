// The auras a Realm Racers seat strips, and how they come back on the return.
//
// The race itself stays a clean slate (the arena wipe, resetForArena, runs at
// the seat and again at the return), so nobody drives a heat on a flask. But
// a race is a parenthesis, not a cleanse: what the seat took off comes back
// when the pilot goes home, aged by the time the race held them. A timed aura
// returns with its remaining time minus the ticks between the seat and the
// return, and one whose time ran out in between stays gone; an untimed aura
// (a permanent one, or an engine aura the aura pass never ages) returns as it
// was. The sicknesses are not here: the arena pools already carry them back
// (snapshotArenaReturnPools), and the Cheater mark is never stripped. Nothing
// the race applies (the ward, the ghost, the surface slows) can be in the
// snapshot, which is taken before the seat's own wipe.
//
// The druid's parked pools ride along: a form that comes back swaps the bar
// again, so the mana parked behind it (and the parked Cat energy deficit) must
// be the pre-race values, not the full refill the clean slate handed out. The
// pre-race bar type also tells the save overlay which pool a mid-race save
// should write (persistedResource).
//
// Sim time in ticks only; draws no rng.
import { isPersistentEngineAura } from '../persistent_aura';
import { SICKNESS_AURA_IDS } from '../resurrection';
import type { SimContext } from '../sim_context';
import { type Aura, CAST_COMPLETE_EPS, type Entity, type ResourceType, TICK_RATE } from '../types';

export interface RealmRacersStrippedAuras {
  /** The tick the seat took them off. */
  tick: number;
  auras: Aura[];
  resourceType: ResourceType | null;
  savedMana: number;
  parkedEnergyDeficit: number;
}

/** The pilot as the seat found them, captured BEFORE the seat's clean slate
 *  runs. Holds every aura by reference until `settleRealmRacersStrippedAuras`
 *  keeps only what the wipe actually took. */
export function snapshotRealmRacersStrippedAuras(
  e: Entity,
  tick: number,
): RealmRacersStrippedAuras {
  return {
    tick,
    auras: e.auras.slice(),
    resourceType: e.resourceType,
    savedMana: e.savedMana,
    parkedEnergyDeficit: e.parkedEnergyDeficit ?? 0,
  };
}

/** After the seat's clean slate: keep, as copies, exactly the auras it took
 *  off (whatever it left on the body, the Cheater mark today, is not owed
 *  back), minus the sicknesses the arena pools already carry. */
export function settleRealmRacersStrippedAuras(
  snapshot: RealmRacersStrippedAuras,
  e: Entity,
): void {
  snapshot.auras = snapshot.auras
    .filter((aura) => !e.auras.includes(aura) && !SICKNESS_AURA_IDS.has(aura.id))
    .map((aura) => ({ ...aura }));
}

function untimed(aura: Aura): boolean {
  return aura.permanent === true || isPersistentEngineAura(aura.id);
}

/** The stripped auras as they stand `tick`: aged by the time since the seat,
 *  the expired ones dropped. Pure; returns fresh copies. */
export function realmRacersAurasAt(snapshot: RealmRacersStrippedAuras, tick: number): Aura[] {
  const elapsed = Math.max(0, tick - snapshot.tick) / TICK_RATE;
  const out: Aura[] = [];
  for (const aura of snapshot.auras) {
    if (untimed(aura)) {
      out.push({ ...aura });
      continue;
    }
    const remaining = aura.remaining - elapsed;
    if (remaining <= CAST_COMPLETE_EPS) continue;
    out.push({ ...aura, remaining });
  }
  return out;
}

/**
 * Put the stripped auras back on a returning pilot, after the return's clean
 * slate and BEFORE the arena pools: the pools clamp hp and resource to the
 * maxima, and those have to be the buffed ones the pilot walked in with.
 */
export function restoreRealmRacersStrippedAuras(
  ctx: SimContext,
  e: Entity,
  snapshot: RealmRacersStrippedAuras,
): void {
  const back = realmRacersAurasAt(snapshot, ctx.tickCount);
  if (back.length === 0) return;
  e.auras.push(...back);
  e.stealthed = e.auras.some((aura) => aura.kind === 'stealth');
  ctx.recalcPlayer(e);
}

/** The parked druid pools, after the arena pools have set the live bar. */
export function restoreRealmRacersParkedPools(e: Entity, snapshot: RealmRacersStrippedAuras): void {
  e.savedMana = snapshot.savedMana;
  e.parkedEnergyDeficit = snapshot.parkedEnergyDeficit;
}
