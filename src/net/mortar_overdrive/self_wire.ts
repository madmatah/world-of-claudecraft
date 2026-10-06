// The Mortar Overdrive readouts of the snapshot self record: `mo` (queue, heat and
// standings), `moc` (the heat's per-tick clocks and speed, folded back into
// the same readout) and `mot` (the trackside lane the viewer stands on). All
// are delta-omitted (server selfWireJson `maybe(...)`): an ABSENT key keeps the
// prior mirror, and an explicit null is the key's own "nothing". Sibling of
// social_self_wire.ts, which owns the rest of the social/PvP cohort. Also the
// Mortar Overdrive kit mirror (`mokit`) and the known list it resolves.

import {
  MORTAR_OVERDRIVE_EFFECT_ABILITIES,
  resolveMortarOverdriveKit,
} from '../../sim/content/mortar_overdrive/kit';
import {
  type MortarOverdriveHeldEffect,
  mortarOverdriveHeldEffectFromWire,
} from '../../sim/mortar_overdrive/pickup_effects';
import {
  type MortarOverdriveMatchClock,
  type MortarOverdriveStillInfo,
  mergeMortarOverdriveInfo,
  mortarOverdriveClockOf,
} from '../../sim/mortar_overdrive/readout_clock';
import type { ResolvedAbility } from '../../sim/sim';
import type { Entity } from '../../sim/types';
import type {
  MortarOverdriveInfo,
  MortarOverdriveLaneView,
} from '../../world_api/mortar_overdrive';

export interface MortarOverdriveSelfMirrors {
  mortarOverdriveInfo: MortarOverdriveInfo;
  mortarOverdriveTrackside: MortarOverdriveLaneView | null;
}

export interface MortarOverdriveSelfRecord {
  mo?: unknown;
  moc?: unknown;
  mot?: unknown;
}

/** The mirror's "no queue, no heat" value, and the ClientWorld initializer. */
export function idleMortarOverdriveInfo(): MortarOverdriveInfo {
  return {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
    queueViable: true,
  };
}

export function applyMortarOverdriveSelfWire(
  target: MortarOverdriveSelfMirrors,
  s: MortarOverdriveSelfRecord,
): void {
  // Either half may arrive alone; the mirror itself carries the other one, so
  // the readout is folded back from whichever moved and what is already held.
  if (s.mo !== undefined || s.moc !== undefined) {
    const prior = target.mortarOverdriveInfo;
    const still =
      s.mo !== undefined
        ? ((s.mo as MortarOverdriveStillInfo | null) ?? idleMortarOverdriveInfo())
        : prior;
    const clock =
      s.moc !== undefined
        ? ((s.moc as MortarOverdriveMatchClock | null) ?? null)
        : mortarOverdriveClockOf(prior.match);
    target.mortarOverdriveInfo = mergeMortarOverdriveInfo(still, clock);
  }
  if (s.mot !== undefined)
    target.mortarOverdriveTrackside = (s.mot as MortarOverdriveLaneView | null) ?? null;
}

export interface MortarOverdriveKitMirror {
  abilityId: string;
  charges: number | null;
  /** Every pickup effect the racer is holding, not just the first: a racer can
   *  carry more than one, and a mirror that kept one drops the other's button
   *  off the bar entirely. */
  held: readonly MortarOverdriveHeldEffect[];
}

/**
 * The Mortar Overdrive kit rides a wireRev-gated heavy self field because a
 * server-side meta.known swap is invisible to this derived rebuild, and it
 * carries WHICH weapon plus its per-race budget: the kit is resolved
 * from the racer's slot server-side, so a mirror that re-derived a
 * hardcoded ability would show the wrong slot the moment a machine or a
 * pickup hands out a different one. The live count rides `achg` like every
 * other charge-limited ability. An absent `mokit` keeps the prior mirror.
 */
export function decodeMortarOverdriveKit(
  prior: MortarOverdriveKitMirror | null,
  // biome-ignore lint/suspicious/noExplicitAny: the raw self record field, re-validated here
  mokit: any,
): MortarOverdriveKitMirror | null {
  if (mokit === undefined) return prior;
  return mokit && mokit.active === true
    ? {
        abilityId: String(mokit.w ?? ''),
        charges: mokit.c ?? null,
        // The HELD pickup effects (22b), empty with an empty slot. The
        // mirror rebuilds the whole kit below, so without these an online
        // pilot would carry an effect with no button to spend it.
        held: (Array.isArray(mokit.h) ? mokit.h : [])
          .map((effect: unknown) => mortarOverdriveHeldEffectFromWire(String(effect ?? '')))
          .filter(
            (effect: MortarOverdriveHeldEffect | null): effect is MortarOverdriveHeldEffect =>
              effect !== null,
          ),
      }
    : null;
}

/** The self known list: the Mortar Overdrive kit while seated, the class presentation otherwise. */
export function mortarOverdriveKnownOr(
  mortarOverdriveKit: MortarOverdriveKitMirror | null,
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
  const budget = mortarOverdriveKit ? e?.abilityCharges?.[mortarOverdriveKit.abilityId] : undefined;
  if (budget) budget.fixed = true;
  // Each held effect's own pool is the same shape and needs the same stamp:
  // a fixed count that never recharges, so the HUD greys the button the
  // moment it is spent rather than showing a cooldown that will not come
  // back. The COUNT is the authoritative one off `achg`, which is why the
  // kit flag carries no number: one charge from a pickup, or a stack from a
  // dev grant, and the badge reads whatever the server published.
  const heldSlots = (mortarOverdriveKit?.held ?? []).map((effect) => {
    const pool = e?.abilityCharges?.[MORTAR_OVERDRIVE_EFFECT_ABILITIES[effect]];
    if (pool) pool.fixed = true;
    return { effect, charges: pool?.charges ?? 1 };
  });
  return mortarOverdriveKit
    ? resolveMortarOverdriveKit(mortarOverdriveKit.abilityId, mortarOverdriveKit.charges, heldSlots)
    : presentationKnown;
}
