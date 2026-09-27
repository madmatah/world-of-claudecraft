// The circuit models a track group is still waiting for: every fetch-and-fill
// `instanceModel` starts adds its InstancedMeshes to the group only when
// `loadGltf` resolves, which is after any compile that ran over the group
// before it. The race preparation (realm_racers_circuit_prepare.ts) reads this
// ledger to run its gate only once the group holds everything it will draw,
// and counts the landed fills as progress steps.

import type * as THREE from 'three';

export interface RealmRacersFills {
  /** Fills started on this group. */
  readonly total: number;
  /** Fills landed (drawn or failed). */
  readonly done: number;
  /** Resolves once every fill started so far has landed; never rejects. */
  landed(): Promise<void>;
}

interface Ledger {
  total: number;
  done: number;
  pending: Promise<void>[];
}

const ledgers = new WeakMap<THREE.Object3D, Ledger>();

function ledgerOf(group: THREE.Object3D): Ledger {
  let ledger = ledgers.get(group);
  if (!ledger) {
    ledger = { total: 0, done: 0, pending: [] };
    ledgers.set(group, ledger);
  }
  return ledger;
}

/** Record a fill on `group`. The promise must never reject. */
export function recordRealmRacersFill(group: THREE.Object3D, fill: Promise<void>): void {
  const ledger = ledgerOf(group);
  ledger.total++;
  ledger.pending.push(
    fill.then(() => {
      ledger.done++;
    }),
  );
}

export function realmRacersFills(group: THREE.Object3D): RealmRacersFills {
  const ledger = ledgerOf(group);
  return {
    get total() {
      return ledger.total;
    },
    get done() {
      return ledger.done;
    },
    landed: () => Promise.all(ledger.pending).then(() => undefined),
  };
}
