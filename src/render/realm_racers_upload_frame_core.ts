// The frame that uploads ALL of a built Realm Racers circuit
// (realm_racers_track.ts `uploadFrame`, awaited by its race preparation client
// under the lobby curtain).
//
// A view's first visible frame uploads only what the camera sees; the rest
// (the far side of the lap the establishing shot sweeps to later) used to
// upload during the countdown. Unculled for one frame, every drawable the view
// shows is submitted and its buffers upload. Shadow casting is off for the
// same frame, so a caster outside the shadow frustum does not join every
// cascade too. Neither flag is a program input. The restore gives each node
// its OWN flags back, never a default.
//
// Pure core: structurally typed, no three import, so a Vitest drives it with
// plain objects.

export interface UploadFrameObject {
  isMesh?: boolean;
  isSprite?: boolean;
  frustumCulled: boolean;
  castShadow: boolean;
}

export interface UploadFrameRoot {
  traverse(visit: (object: UploadFrameObject) => void): void;
}

/** A drawable's own culling and shadow flags, held across the upload frame. */
export interface UploadFrameNode {
  object: UploadFrameObject;
  frustumCulled: boolean;
  castShadow: boolean;
}

/** Ready every drawable under `root` for the upload frame; returns each one's
 *  own flags for the restore. */
export function prepareUploadFrame(root: UploadFrameRoot): UploadFrameNode[] {
  const held: UploadFrameNode[] = [];
  root.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;
    held.push({ object, frustumCulled: object.frustumCulled, castShadow: object.castShadow });
    object.frustumCulled = false;
    object.castShadow = false;
  });
  return held;
}

export function restoreAfterUploadFrame(held: readonly UploadFrameNode[]): void {
  for (const node of held) {
    node.object.frustumCulled = node.frustumCulled;
    node.object.castShadow = node.castShadow;
  }
}
