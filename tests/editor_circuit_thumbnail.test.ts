// Where the camera stands to photograph one catalog piece for its library tile.
//
// A grid of tiles only reads if every piece is shot the SAME way and each one
// fills its frame. The extreme aspect ratios are the cases that matter: the
// catalog holds a two yard fence and a four yard arch beside a knee-high haybale,
// and a framing that works on a cube leaves the fence a sixth of the tile.

import { describe, expect, it } from 'vitest';
import {
  THUMBNAIL_MARGIN,
  THUMBNAIL_MIN_DISTANCE,
  THUMBNAIL_PITCH,
  THUMBNAIL_YAW,
  type ThumbnailBounds,
  thumbnailBoundsUsable,
  thumbnailOwnsGeometry,
  thumbnailPose,
} from '../src/editor/circuit/thumbnail_core';
import { MORTAR_OVERDRIVE_PROP_VISUALS } from '../src/render/mortar_overdrive/prop_visuals';

const FOV = (32 * Math.PI) / 180;

const box = (w: number, h: number, d: number, at = { x: 0, y: 0, z: 0 }): ThumbnailBounds => ({
  minX: at.x - w / 2,
  maxX: at.x + w / 2,
  minY: at.y - h / 2,
  maxY: at.y + h / 2,
  minZ: at.z - d / 2,
  maxZ: at.z + d / 2,
});

/**
 * How much of the frame the subject actually fills, on each axis.
 *
 * Measured by projecting the corners through the pose, rather than by restating
 * the arithmetic the pose used: a test that recomputes the framing formula
 * passes whatever that formula does, including nothing.
 */
function fill(bounds: ThumbnailBounds, aspect: number): { across: number; down: number } {
  const pose = thumbnailPose(bounds, aspect, FOV);
  const forward = {
    x: pose.target.x - pose.camera.x,
    y: pose.target.y - pose.camera.y,
    z: pose.target.z - pose.camera.z,
  };
  const length = Math.hypot(forward.x, forward.y, forward.z);
  const f = { x: forward.x / length, y: forward.y / length, z: forward.z / length };
  // Right is horizontal (no roll); up completes the basis.
  const right = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(right.x, right.z) || 1;
  const r = { x: right.x / rl, y: 0, z: right.z / rl };
  const u = {
    x: r.y * f.z - r.z * f.y,
    y: r.z * f.x - r.x * f.z,
    z: r.x * f.y - r.y * f.x,
  };
  let across = 0;
  let down = 0;
  for (const cx of [bounds.minX, bounds.maxX]) {
    for (const cy of [bounds.minY, bounds.maxY]) {
      for (const cz of [bounds.minZ, bounds.maxZ]) {
        const dx = cx - pose.camera.x;
        const dy = cy - pose.camera.y;
        const dz = cz - pose.camera.z;
        const depth = dx * f.x + dy * f.y + dz * f.z;
        if (depth <= 0.001)
          return { across: Number.POSITIVE_INFINITY, down: Number.POSITIVE_INFINITY };
        const halfDown = depth * Math.tan(FOV / 2);
        const halfAcross = halfDown * aspect;
        down = Math.max(down, Math.abs(dx * u.x + dy * u.y + dz * u.z) / halfDown);
        across = Math.max(across, Math.abs(dx * r.x + dy * r.y + dz * r.z) / halfAcross);
      }
    }
  }
  return { across, down };
}

describe('framing one catalog piece', () => {
  it('fills the frame without spilling out of it, on a cube', () => {
    const { across, down } = fill(box(1, 1, 1), 1);
    expect(Math.max(across, down)).toBeLessThanOrEqual(1);
    expect(Math.max(across, down)).toBeGreaterThan(0.6);
  });

  it('fills it on a long low fence, where the WIDTH binds', () => {
    // A bounding sphere would frame this as if it were a four yard cube and
    // leave the fence a sixth of the tile.
    const { across, down } = fill(box(4, 0.4, 0.25), 1);
    expect(across).toBeLessThanOrEqual(1);
    expect(down).toBeLessThanOrEqual(1);
    expect(across).toBeGreaterThan(0.55);
  });

  it('fills it on a tall column, where the HEIGHT binds', () => {
    const { across, down } = fill(box(0.3, 4.4, 0.3), 1);
    expect(down).toBeLessThanOrEqual(1);
    expect(across).toBeLessThanOrEqual(1);
    expect(down).toBeGreaterThan(0.55);
  });

  it('never clips the near corner, which a centre-framed camera does', () => {
    // At a three-quarter view the near corner is half the depth closer than the
    // centre, and a distance worked out from the centre alone puts it behind the
    // camera on anything deep.
    for (const bounds of [box(1, 1, 6), box(6, 1, 6), box(0.2, 0.2, 12)]) {
      const { across, down } = fill(bounds, 1);
      expect(Number.isFinite(across)).toBe(true);
      expect(Math.max(across, down)).toBeLessThanOrEqual(1);
    }
  });

  it('answers a wide tile as well as a square one', () => {
    const wide = fill(box(4, 0.4, 0.25), 2);
    expect(wide.across).toBeLessThanOrEqual(1);
    expect(wide.down).toBeLessThanOrEqual(1);
  });

  it('aims at the box centre, wherever the box sits', () => {
    // A model authored off its own origin (several kit pieces are) must not be
    // photographed off to one side of the tile.
    const pose = thumbnailPose(box(2, 3, 1, { x: 40, y: 7, z: -12 }), 1, FOV);
    expect(pose.target).toEqual({ x: 40, y: 7, z: -12 });
  });

  it('is the SAME pose for every piece, which is what makes a grid readable', () => {
    const a = thumbnailPose(box(1, 1, 1), 1, FOV);
    const b = thumbnailPose(box(3, 0.5, 2), 1, FOV);
    const angle = (pose: typeof a) => {
      const dx = pose.camera.x - pose.target.x;
      const dy = pose.camera.y - pose.target.y;
      const dz = pose.camera.z - pose.target.z;
      return {
        yaw: Math.atan2(-dx, -dz),
        pitch: Math.asin(dy / Math.hypot(dx, dy, dz)),
      };
    };
    expect(angle(a).yaw).toBeCloseTo(angle(b).yaw, 6);
    expect(angle(a).pitch).toBeCloseTo(angle(b).pitch, 6);
    expect(angle(a).pitch).toBeCloseTo(THUMBNAIL_PITCH, 6);
    expect(THUMBNAIL_YAW).toBeGreaterThan(0);
    expect(THUMBNAIL_MARGIN).toBeGreaterThan(1);
  });

  it('is deterministic: the same box gives the same pose, every time', () => {
    const bounds = box(1.7, 0.5, 0.75);
    expect(thumbnailPose(bounds, 1, FOV)).toEqual(thumbnailPose(bounds, 1, FOV));
  });

  it('keeps the camera out of its own near plane on a tiny piece', () => {
    const pose = thumbnailPose(box(0.02, 0.02, 0.02), 1, FOV);
    expect(pose.distance).toBeGreaterThanOrEqual(THUMBNAIL_MIN_DISTANCE);
  });

  it('survives an absurd field of view rather than dividing by zero', () => {
    const pose = thumbnailPose(box(1, 1, 1), 1, 0);
    expect(Number.isFinite(pose.distance)).toBe(true);
    expect(Number.isFinite(thumbnailPose(box(1, 1, 1), 0, FOV).distance)).toBe(true);
  });
});

describe('whether there is anything to photograph', () => {
  it('takes a box with any real extent', () => {
    expect(thumbnailBoundsUsable(box(1, 1, 1))).toBe(true);
    // A flat piece (a banner, a lily raft) is a real subject.
    expect(thumbnailBoundsUsable(box(2, 0, 2))).toBe(true);
  });

  it('refuses the empty box a failed load measures as', () => {
    expect(thumbnailBoundsUsable(box(0, 0, 0))).toBe(false);
  });

  it('refuses an inverted or non-finite box rather than aiming at NaN', () => {
    // `Box3.setFromObject` on an object with no geometry comes back inverted
    // (+Infinity min, -Infinity max), and framing that is a camera at NaN.
    expect(
      thumbnailBoundsUsable({
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
      }),
    ).toBe(false);
    // Per AXIS, because the guard ANDs three of them and a check that only ever
    // looked at x would pass every case above.
    const sane = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 };
    expect(thumbnailBoundsUsable({ ...sane, maxX: Number.NaN })).toBe(false);
    expect(thumbnailBoundsUsable({ ...sane, maxY: Number.NaN })).toBe(false);
    expect(thumbnailBoundsUsable({ ...sane, maxZ: Number.NaN })).toBe(false);
    // An inverted single axis is not a box either.
    expect(thumbnailBoundsUsable({ ...sane, maxY: -1 })).toBe(false);
    expect(thumbnailBoundsUsable(sane)).toBe(true);
  });
});

describe('what the rig owns of what it draws', () => {
  it('frees only the kind that mints geometry, and never the shared caches', () => {
    // The whole disposal hazard in one table. An `instanced` entry draws a cached
    // geometry and material, and a GLB clone shares its buffers with the loader's
    // parsed scene: freeing either would take every authored circuit's props down
    // with one library tile.
    expect(thumbnailOwnsGeometry('group')).toBe(true);
    expect(thumbnailOwnsGeometry('instanced')).toBe(false);
    expect(thumbnailOwnsGeometry('gltf')).toBe(false);
    // A streetlamp fixture is a GLB clone like any other model on disk.
    expect(thumbnailOwnsGeometry('streetlamp')).toBe(false);
    // A kit piece is the world's own env-prop template, shared with every
    // Drakelands build that draws it.
    expect(thumbnailOwnsGeometry('worldKit')).toBe(false);
  });

  it('covers every kind the visual registry actually has', () => {
    // Both ways, so a fourth kind added render-side cannot silently default to
    // "we own it" and start disposing a cache.
    const kinds = new Set(
      Object.values(MORTAR_OVERDRIVE_PROP_VISUALS).map((visual) => visual.kind),
    );
    expect([...kinds].sort()).toEqual(['gltf', 'group', 'instanced', 'streetlamp', 'worldKit']);
  });
});
