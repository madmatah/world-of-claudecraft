// Giving a built Mortar Overdrive track group back: what `buildMortarOverdriveTrack`
// OWNS, and nothing it borrows.
//
// It exists because two callers rebuild that group over and over where the game
// builds it once: the circuit editor's 3D preview (a rebuild per edit) and the
// dev draft arm (a rebuild per `/dev overdrivedraft`). Both leak a whole circuit's
// vertex buffers per rebuild without this, which is about half a megabyte a
// throw.
//
// The rule the builder actually follows, read off it rather than assumed:
//
//  - every plain `THREE.Mesh` in the group carries a geometry minted for that
//    build (the lawn shape, every swept ribbon, the basin sheet, the start
//    lights, the fountain), so its geometry is ours to free;
//  - every `THREE.InstancedMesh` draws a geometry and a material that belong to
//    a SHARED cache (the GLB loader's parsed scene, `surfaceMat`, the texture
//    factory, `gardenStatueGeo`). Freeing one of those would take the authored
//    circuits down with the draft, so an InstancedMesh only ever gives back its
//    own per-instance attributes, which is exactly what `InstancedMesh.dispose`
//    does.
//
// MATERIALS are left alone for that same borrowing reason: most of them come
// out of `surfaceMat`, which dedupes by key and hands the same object to every
// circuit. The handful the builder mints itself (the ground splat material, the
// start-line basic material, the two start-light lenses, the water surface) are
// small CPU objects whose textures and compiled programs are shared anyway, so
// what they hold is nothing next to the geometry. If that ever stops being
// true, the answer is for the builder to report what it owns, not for this file
// to guess harder.
//
// What that rests on is MULTIPLICITY: one minted material per build, never one
// per piece of the thing it draws. A circuit's water is now several lobes
// rather than one lake, and the builder deliberately mints ONE water
// ShaderMaterial for the build and shares it across them; a per-lobe material
// would multiply the one class of object this file knowingly leaks by however
// many spans a circuit authors, on exactly the two paths (preview rebuild, draft
// re-registration) it exists for.
//
// Pure core: structurally typed against the Three shapes it touches, so a
// Vitest drives it with a counting fake and no renderer.

/** The part of `THREE.Mesh` / `THREE.InstancedMesh` this needs to see.
 *  `type` is required only so the shape is not a WEAK type: with every member
 *  optional, TypeScript refuses a real `Object3D` for having "no properties in
 *  common" with it. */
export interface DisposableMeshLike {
  type: string;
  isMesh?: boolean;
  isInstancedMesh?: boolean;
  geometry?: { dispose(): void };
  /** `InstancedMesh.dispose`; a plain Mesh has none. */
  dispose?(): void;
}

/** The part of `THREE.Object3D` this needs to see. */
export interface DisposableGroupLike {
  traverse(callback: (object: DisposableMeshLike) => void): void;
  clear(): void;
}

/**
 * Free the geometry a track group owns and detach its children.
 *
 * Safe to call on a group that is still parented: the caller is expected to
 * remove it first, and `clear()` here only drops this group's own children so a
 * disposed group cannot be drawn again by accident.
 */
export function disposeMortarOverdriveTrackGroup(group: DisposableGroupLike): void {
  group.traverse((object) => {
    if (!object.isMesh) return;
    if (object.isInstancedMesh) {
      // Per-instance attributes only: the geometry and material under it are
      // the shared cache's.
      object.dispose?.();
      return;
    }
    object.geometry?.dispose();
  });
  group.clear();
}
