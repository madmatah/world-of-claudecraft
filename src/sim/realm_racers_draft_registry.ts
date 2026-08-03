// Circuits that exist only for this session: the DRAFT overlay a dev command
// fills, so a circuit drawn in the editor can be driven without pasting it into
// the curated records module and restarting.
//
// It is a module-level table rather than state on `Sim` because what it holds
// is CONTENT, not per-match state: it extends `REALM_RACERS_CIRCUITS`, which is
// itself a module table, and `realmRacersCircuitById` (a plain function with no
// `ctx`) is what has to see it. The editor's own `setActiveWorldContent`
// (`sim/data.ts`) is the same shape for the same reason. Empty unless a dev
// command filled it, so nothing deterministic can observe it.
//
// A LEAF with no runtime imports at all, deliberately: the lane table
// (`realm_racers_layout.ts`) and the record lookup
// (`content/realm_racers_circuits.ts`) both consult it, and either of them
// importing something that imports this back would be a cycle through a module
// that builds its table at import time.
//
// It holds no rules. The dev gate and the "is this drivable geometry" check
// live in `realm_racers_drafts.ts`, which sits above the metrics core; this
// file only remembers.
//
// OFFLINE HOSTS ONLY in practice. Nothing here is reachable without a dev
// command, the server never runs one, and the table is process-wide rather than
// per-`Sim`: it is CONTENT, like the records module it extends, and
// `realmRacersCircuitById` is a plain function with no `ctx` to hang it off. A
// second `Sim` in the same process therefore sees a draft the first one
// registered, which is correct for the one host that can register at all (the
// dev client) and is pinned by `tests/realm_racers_drafts.test.ts` so it is a
// stated property rather than a surprise.
//
// Every derived cache keyed off a circuit id holds its entry only while the
// RECORD behind that id is the same object, which is what makes a redrawn draft
// safe. Two of them go through one shared helper (`memoizePerCircuit` in
// `realm_racers_spline.ts`, which the spline derivations and the dressing
// resolver both use) and one is hand-rolled beside it (the collider cache). If
// a SECOND hand-rolled one ever appears, stop writing identity guards one at a
// time and give this table a generation counter the caches bump against.

import type { RealmRacersCircuit } from './content/realm_racers_circuits';

/**
 * Slots are handed out in registration order and never reused, so a draft keeps
 * the same lane for the whole session even if a later one replaces it. The lane
 * INDEX is `REALM_RACERS_LANES.length + slot`, which the layout leaf computes:
 * dev lanes append after every authored lane, so no authored lane can move.
 */
const drafts = new Map<string, { circuit: RealmRacersCircuit; slot: number }>();
const bySlot: (RealmRacersCircuit | undefined)[] = [];

/**
 * Remember a draft under its id, replacing whatever stood there.
 *
 * Re-registering the same id keeps its slot: the operator's loop is save, race,
 * redraw, race again, and a draft that moved lanes each pass would strand the
 * renderer's view and the player's position on the lane before it.
 */
export function putRealmRacersDraftCircuit(circuit: RealmRacersCircuit): number {
  const existing = drafts.get(circuit.id);
  const slot = existing ? existing.slot : bySlot.length;
  drafts.set(circuit.id, { circuit, slot });
  bySlot[slot] = circuit;
  return slot;
}

/** The record registered under an id, or undefined for an id nobody drew. */
export function realmRacersDraftCircuit(id: string): RealmRacersCircuit | undefined {
  return drafts.get(id)?.circuit;
}

/** Which dev slot an id holds, or -1 for an id nobody drew. */
export function realmRacersDraftSlot(id: string): number {
  return drafts.get(id)?.slot ?? -1;
}

/** The record standing on a dev slot, or undefined past the end. */
export function realmRacersDraftAtSlot(slot: number): RealmRacersCircuit | undefined {
  return slot >= 0 ? bySlot[slot] : undefined;
}

/** Drop every draft. For tests: a session never un-registers one. */
export function clearRealmRacersDraftCircuits(): void {
  drafts.clear();
  bySlot.length = 0;
}
