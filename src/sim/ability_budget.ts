// Can this player use this ability right now, for the two reasons an ACTIVITY
// that lent them a temporary kit decides: the kit is spent, or the activity has
// taken the controls away.
//
// A pure leaf on purpose, because both answers are needed on both sides of the
// wire and must not be written twice. The SIM refuses the cast with them (the
// authority: the aim and the keypress both arrive over the wire), and the HUD
// reads the same two to decide whether pressing the key is worth opening a
// ground-aim mode at all. A second copy of either rule in the client is a rule
// the server does not share, and the way that fails is the worst one available:
// the player commits to an action the server then silently drops.
//
// Neither is a COOLDOWN, and that distinction is the point. A cooldown is a
// timer the player waits out and the action bar sweeps; these two are states,
// and a slot in one of them is greyed rather than swept.

/**
 * The two fields these answers are read from, declared STRUCTURALLY rather than
 * as a slice of `Entity`. That is what lets the action bar's own deliberately
 * narrow player input satisfy them unchanged, so the HUD calls the very same
 * predicate the sim refuses on instead of a lookalike written against a
 * different shape.
 */
export interface AbilityBudgetSubject {
  abilityCharges?: {
    [id: string]: { charges: number; fixed?: boolean } | undefined;
  };
  drive?: { controlsLocked: boolean } | null;
}

/**
 * A FIXED charge budget, spent out: N uses granted for the duration of an
 * activity and never refilled (Mortar Overdrive's weapon slot).
 *
 * The `fixed` flag is load-bearing and not merely `rechargeLength <= 0`: the
 * shared recharge tick reads a zero recharge length as "every timer already
 * due" and hands the whole pool straight back on the next tick, which is
 * exactly how this shipped broken the first time.
 */
export function isAbilityBudgetSpent(e: AbilityBudgetSubject, abilityId: string): boolean {
  const state = e.abilityCharges?.[abilityId];
  return !!state && state.fixed === true && state.charges <= 0;
}

/**
 * The machine's controls are locked by whatever is running the activity: a
 * racer held on the grid before the flag, or sitting in the finished tableau
 * after it. Locked, nothing casts at all.
 */
export function areAbilityControlsLocked(e: AbilityBudgetSubject): boolean {
  return e.drive?.controlsLocked === true;
}

/** Either reason. What the cast gate refuses on, and what the action bar greys
 *  a slot for. */
export function isAbilityLockedByActivity(e: AbilityBudgetSubject, abilityId: string): boolean {
  return areAbilityControlsLocked(e) || isAbilityBudgetSpent(e, abilityId);
}
