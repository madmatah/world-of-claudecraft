// Subtrees a compile of their PARENT skips: content whose programs have their
// own preparation owner and must never ride a wider compile.
//
// three's compile walks the root it is handed with `traverse`, hidden children
// included, and takes no filter, so a hidden group under the scene is linked by
// every whole-scene compile (the blocking arrival's zone prewarm hands the
// compile arms `this.scene`). Hiding cannot keep a group out of that walk;
// this does. A group declares itself with `excludeFromParentCompile`, and the
// arms (compile_arms.ts) run their synchronous section under
// `withParentCompileExclusions`, which empties the `children` of each declared
// DIRECT child of the compiled root for exactly that section and puts the very
// same array back before the arm's result is consumed. Nothing is detached, so
// the scene's child order, parent links and added/removed events are untouched.
//
// Only a direct child of the compiled root is read: that is where the declared
// roots live (scene-level groups), and it keeps the check to one pass over the
// root's children instead of a second whole-scene walk. A compile whose root IS
// the declared group, or lies inside it (the owner's own gate), is not affected.
//
// A caller may LIFT named owners for one call (`lifted`): a compile whose
// trigger is that owner's own (the blocking arrival that lands in the rally
// band, realm_racers_prepare_core.ts `rallyArrivalLifts`) links the group as
// if it were never declared. The decision is the caller's, made explicit.
//
// The declared group itself is still visited, so it must be a plain group
// carrying no material; a declared group must not hold a three light either,
// since the compile gathers lights from the same walk. The declaration lives
// in `userData`, which three's clone and copy carry over, so a clone of a
// declared group is excluded too.

import type * as THREE from 'three';

const EXCLUSION_KEY = 'compileExclusion';

/** Keep `group`'s subtree out of any compile of its parent. `owner` names the
 *  preparation that links it instead (diagnostics). */
export function excludeFromParentCompile(group: THREE.Object3D, owner: string): void {
  group.userData[EXCLUSION_KEY] = owner;
}

/** The owner a group declared, or undefined for an ordinary group. */
export function parentCompileExclusionOf(group: THREE.Object3D): string | undefined {
  const owner = group.userData[EXCLUSION_KEY];
  return typeof owner === 'string' ? owner : undefined;
}

const NOTHING_LIFTED: readonly string[] = Object.freeze([]);

/** Run `op` with every declared direct child of `root` emptied, restoring
 *  each child's own `children` array before returning. A child whose owner is
 *  in `lifted` is left whole for this call. */
export function withParentCompileExclusions<T>(
  root: THREE.Object3D,
  op: () => T,
  lifted: readonly string[] = NOTHING_LIFTED,
): T {
  let muted: { group: THREE.Object3D; children: THREE.Object3D[] }[] | null = null;
  for (const child of root.children) {
    const owner = parentCompileExclusionOf(child);
    if (owner === undefined || lifted.includes(owner) || child.children.length === 0) continue;
    muted ??= [];
    muted.push({ group: child, children: child.children });
  }
  if (muted === null) return op();
  try {
    for (const entry of muted) entry.group.children = [];
    return op();
  } finally {
    for (const entry of muted) entry.group.children = entry.children;
  }
}
