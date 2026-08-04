// Where the camera stands to photograph one catalog piece for its library tile.
//
// A tile is the answer to "what does `statueHead` even look like", so the frame
// has to be filled by the piece and the pose has to be the SAME for every piece
// or the grid reads as a set of unrelated photographs. Both are decisions, so
// they are here rather than in the rig that renders them.
//
// The framing is `preview_camera_core.ts`'s, restated for a box rather than a
// circuit: the vertical field opens `2 * tan(fov / 2)` per unit of distance, the
// horizontal is that times the aspect, and the distance is whichever of the two
// the subject needs more of. What is new is that a prop is a BOX seen at an
// angle, so its extents are measured along the camera's own axes rather than
// along the world's; a bounding sphere would frame a garden fence as if it were
// a cube and leave it a sixth of the tile.
//
// Pure and deterministic: no Three, no DOM, no rng. The rig hands in a bounding
// box and gets a pose.

/** Three-quarter view, from slightly above: the pose a product shot uses,
 *  because it shows a face, a side and the top edge in one frame. */
export const THUMBNAIL_YAW = Math.PI * 0.25;
export const THUMBNAIL_PITCH = 0.38;

/** Breathing room around the subject, so nothing touches the tile's edge. */
export const THUMBNAIL_MARGIN = 1.12;

/** The floor a distance is clamped to. A flower bed measured at a tenth of a
 *  yard would otherwise put the camera inside its own near plane. */
export const THUMBNAIL_MIN_DISTANCE = 0.35;

/**
 * Which kind of visual mints geometry the rig has to give back.
 *
 * The whole disposal hazard in one function. A `group` builder mints its meshes
 * per build, so the rig owns them. An `instanced` entry draws a geometry and a
 * material out of a SHARED cache, and a GLB clone shares its parents' buffers
 * with the loader's parsed scene: freeing either would take every authored
 * circuit's props down with the tile. Two of the three answers are "leave it
 * alone", which is exactly why it is worth stating once and pinning.
 */
export function thumbnailOwnsGeometry(kind: 'group' | 'instanced' | 'gltf'): boolean {
  return kind === 'group';
}

export interface ThumbnailBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface ThumbnailPoint {
  x: number;
  y: number;
  z: number;
}

export interface ThumbnailPose {
  camera: ThumbnailPoint;
  target: ThumbnailPoint;
  distance: number;
}

/** Whether a measured box is something a camera can be aimed at. A GLB that
 *  failed to load measures as an empty box, and framing that is a division by
 *  zero dressed as a photograph. */
export function thumbnailBoundsUsable(bounds: ThumbnailBounds): boolean {
  const spans = [bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, bounds.maxZ - bounds.minZ];
  if (!spans.every((span) => Number.isFinite(span) && span >= 0)) return false;
  return spans.some((span) => span > 1e-4);
}

/**
 * Where to stand to fill the tile with this piece.
 *
 * The eight corners are measured along the camera's own right, up and forward
 * axes, so a long low fence is framed by its length and a column by its height,
 * each filling the frame on the axis that binds. The forward extent is added to
 * the distance rather than ignored: at a three-quarter view the near corner is
 * closer than the centre by half the depth, and a camera framed on the centre
 * alone clips it.
 */
export function thumbnailPose(
  bounds: ThumbnailBounds,
  aspect: number,
  verticalFovRadians: number,
): ThumbnailPose {
  const target: ThumbnailPoint = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };
  const cosPitch = Math.cos(THUMBNAIL_PITCH);
  const sinPitch = Math.sin(THUMBNAIL_PITCH);
  const sinYaw = Math.sin(THUMBNAIL_YAW);
  const cosYaw = Math.cos(THUMBNAIL_YAW);
  // The camera looks from `target + forward * distance` back at the target, so
  // forward points from the subject toward the eye.
  const forward: ThumbnailPoint = { x: -sinYaw * cosPitch, y: sinPitch, z: -cosYaw * cosPitch };
  // Right is horizontal by construction (no roll), up completes the basis.
  const right: ThumbnailPoint = { x: -cosYaw, y: 0, z: sinYaw };
  const up: ThumbnailPoint = {
    x: forward.y * right.z - forward.z * right.y,
    y: forward.z * right.x - forward.x * right.z,
    z: forward.x * right.y - forward.y * right.x,
  };

  let halfRight = 0;
  let halfUp = 0;
  let halfForward = 0;
  for (const cx of [bounds.minX, bounds.maxX]) {
    for (const cy of [bounds.minY, bounds.maxY]) {
      for (const cz of [bounds.minZ, bounds.maxZ]) {
        const dx = cx - target.x;
        const dy = cy - target.y;
        const dz = cz - target.z;
        halfRight = Math.max(halfRight, Math.abs(dx * right.x + dy * right.y + dz * right.z));
        halfUp = Math.max(halfUp, Math.abs(dx * up.x + dy * up.y + dz * up.z));
        halfForward = Math.max(
          halfForward,
          Math.abs(dx * forward.x + dy * forward.y + dz * forward.z),
        );
      }
    }
  }

  const vertical = 2 * Math.tan(Math.max(0.02, verticalFovRadians) / 2);
  const horizontal = vertical * Math.max(0.05, aspect);
  const needed = Math.max((2 * halfRight) / horizontal, (2 * halfUp) / vertical);
  const distance = Math.max(THUMBNAIL_MIN_DISTANCE, needed * THUMBNAIL_MARGIN + halfForward);
  return {
    target,
    distance,
    camera: {
      x: target.x + forward.x * distance,
      y: target.y + forward.y * distance,
      z: target.z + forward.z * distance,
    },
  };
}
