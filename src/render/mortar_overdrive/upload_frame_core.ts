// The frame that uploads ALL of a built Mortar Overdrive circuit
// (mortar_overdrive/track.ts `uploadFrame`, awaited by its race preparation client
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
// The proof is a RENDER, never an update: a frame loop can update the scene
// and skip the present (a blocking arrival holds the world draw, a hidden
// window), so "shown at the last update" says nothing about what was drawn.
// Each node carries a sentinel `onAfterRender` for the frame, which three
// calls once it has drawn the node, buffers uploaded.
//
// Pure core: structurally typed, no three import, so a Vitest drives it with
// plain objects.

type AfterRender = (...args: never[]) => void;

export interface UploadFrameObject {
  isMesh?: boolean;
  isSprite?: boolean;
  frustumCulled: boolean;
  castShadow: boolean;
  onAfterRender: AfterRender;
}

export interface UploadFrameRoot {
  traverse(visit: (object: UploadFrameObject) => void): void;
}

/** A drawable's own culling, shadow and after-render hook, held across the
 *  upload frame. */
export interface UploadFrameNode {
  object: UploadFrameObject;
  frustumCulled: boolean;
  castShadow: boolean;
  onAfterRender: AfterRender;
  /** Whether the node carried its own hook, rather than the prototype's. */
  ownHook: boolean;
}

/** Ready every drawable under `root` for the upload frame, `drawn` called each
 *  time three draws one of them; returns each one's own state for the
 *  restore. */
export function prepareUploadFrame(root: UploadFrameRoot, drawn: () => void): UploadFrameNode[] {
  const held: UploadFrameNode[] = [];
  root.traverse((object) => {
    if (!object.isMesh && !object.isSprite) return;
    const hook = object.onAfterRender;
    held.push({
      object,
      frustumCulled: object.frustumCulled,
      castShadow: object.castShadow,
      onAfterRender: hook,
      ownHook: Object.hasOwn(object, 'onAfterRender'),
    });
    object.frustumCulled = false;
    object.castShadow = false;
    object.onAfterRender = ((...args: never[]) => {
      drawn();
      hook.apply(object, args);
    }) as AfterRender;
  });
  return held;
}

export function restoreAfterUploadFrame(held: readonly UploadFrameNode[]): void {
  for (const node of held) {
    node.object.frustumCulled = node.frustumCulled;
    node.object.castShadow = node.castShadow;
    if (node.ownHook) node.object.onAfterRender = node.onAfterRender;
    else delete (node.object as Partial<UploadFrameObject>).onAfterRender;
  }
}
