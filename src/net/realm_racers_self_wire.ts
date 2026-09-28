// The Realm Racers readouts of the snapshot self record: `rr` (queue, heat and
// standings) and `rrt` (the trackside lane the viewer stands on). Both are
// delta-omitted (server selfWireJson `maybe(...)`): an ABSENT key keeps the
// prior mirror, and an explicit null is the key's own "nothing". Sibling of
// social_self_wire.ts, which owns the rest of the social/PvP cohort. Also the
// Rally kit mirror (`rrkit`) and the known list it resolves.

import { REALM_RACERS_EFFECT_ABILITIES, resolveRealmRacersKit } from '../sim/content/realm_racers';
import { type RallyHeldEffect, rallyHeldEffectFromWire } from '../sim/realm_racers_pickup_effects';
import type { ResolvedAbility } from '../sim/sim';
import type { Entity } from '../sim/types';
import type { RealmRacersInfo, RealmRacersLaneView } from '../world_api/realm_racers';

export interface RealmRacersSelfMirrors {
  realmRacersInfo: RealmRacersInfo;
  realmRacersTrackside: RealmRacersLaneView | null;
}

export interface RealmRacersSelfRecord {
  rr?: unknown;
  rrt?: unknown;
}

/** The mirror's "no queue, no heat" value, and the ClientWorld initializer. */
export function idleRealmRacersInfo(): RealmRacersInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    queueViable: true,
  };
}

export function applyRealmRacersSelfWire(
  target: RealmRacersSelfMirrors,
  s: RealmRacersSelfRecord,
): void {
  if (s.rr !== undefined)
    target.realmRacersInfo = (s.rr as RealmRacersInfo | null) ?? idleRealmRacersInfo();
  if (s.rrt !== undefined)
    target.realmRacersTrackside = (s.rrt as RealmRacersLaneView | null) ?? null;
}

export interface RealmRacersKitMirror {
  abilityId: string;
  charges: number | null;
  /** Every pickup effect the racer is holding, not just the first: a racer can
   *  carry more than one, and a mirror that kept one drops the other's button
   *  off the bar entirely. */
  held: readonly RallyHeldEffect[];
}

/**
 * The Rally kit rides a wireRev-gated heavy self field because a
 * server-side meta.known swap is invisible to this derived rebuild, and it
 * carries WHICH weapon plus its per-race budget: the kit is resolved
 * from the racer's slot server-side, so a mirror that re-derived a
 * hardcoded ability would show the wrong slot the moment a machine or a
 * pickup hands out a different one. The live count rides `achg` like every
 * other charge-limited ability. An absent `rrkit` keeps the prior mirror.
 */
export function decodeRealmRacersKit(
  prior: RealmRacersKitMirror | null,
  // biome-ignore lint/suspicious/noExplicitAny: the raw self record field, re-validated here
  rrkit: any,
): RealmRacersKitMirror | null {
  if (rrkit === undefined) return prior;
  return rrkit && rrkit.active === true
    ? {
        abilityId: String(rrkit.w ?? ''),
        charges: rrkit.c ?? null,
        // The HELD pickup effects (22b), empty with an empty slot. The
        // mirror rebuilds the whole kit below, so without these an online
        // pilot would carry an effect with no button to spend it.
        held: (Array.isArray(rrkit.h) ? rrkit.h : [])
          .map((effect: unknown) => rallyHeldEffectFromWire(String(effect ?? '')))
          .filter((effect: RallyHeldEffect | null): effect is RallyHeldEffect => effect !== null),
      }
    : null;
}

/** The self known list: the Rally kit while seated, the class presentation otherwise. */
export function realmRacersKnownOr(
  rallyKit: RealmRacersKitMirror | null,
  e: Pick<Entity, 'abilityCharges'> | null,
  presentationKnown: ResolvedAbility[],
): ResolvedAbility[] {
  // The weapon's charge pool is a FIXED race budget, not the refilling
  // recharge model, and the wire carries counts only. It is stamped HERE
  // rather than where `achg` decodes because that block runs ABOVE this one:
  // reading the kit there would take it from the previous snapshot, so the
  // first frame after a racer is seated would mirror their budget as an
  // ordinary pool. The HUD greys a spent slot (and declines to open an
  // aiming mode) off exactly this flag.
  const budget = rallyKit ? e?.abilityCharges?.[rallyKit.abilityId] : undefined;
  if (budget) budget.fixed = true;
  // Each held effect's own pool is the same shape and needs the same stamp:
  // a fixed count that never recharges, so the HUD greys the button the
  // moment it is spent rather than showing a cooldown that will not come
  // back. The COUNT is the authoritative one off `achg`, which is why the
  // kit flag carries no number: one charge from a pickup, or a stack from a
  // dev grant, and the badge reads whatever the server published.
  const heldSlots = (rallyKit?.held ?? []).map((effect) => {
    const pool = e?.abilityCharges?.[REALM_RACERS_EFFECT_ABILITIES[effect]];
    if (pool) pool.fixed = true;
    return { effect, charges: pool?.charges ?? 1 };
  });
  return rallyKit
    ? resolveRealmRacersKit(rallyKit.abilityId, rallyKit.charges, heldSlots)
    : presentationKnown;
}
