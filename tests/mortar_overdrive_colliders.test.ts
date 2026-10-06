import { describe, expect, it } from 'vitest';
import { resolvePosition } from '../src/sim/colliders';
import { MORTAR_OVERDRIVE_PRACTICE_CIRCUIT as GARDEN_CIRCUIT } from '../src/sim/content/mortar_overdrive/circuits';
import {
  DUNGEON_OVERFLOW_X_BASE,
  isYumiMazePos,
  YUMI_BAND_X_MAX,
  YUMI_MAZE_X,
} from '../src/sim/data';
import {
  mortarOverdriveSightBlocked,
  resolveMortarOverdrivePosition,
} from '../src/sim/mortar_overdrive/collide';
import { mortarOverdriveColliders } from '../src/sim/mortar_overdrive/colliders';
import { MORTAR_OVERDRIVE_ORIGIN } from '../src/sim/mortar_overdrive/layout';
import {
  mortarOverdriveGardenEdgeOffsetAt,
  mortarOverdriveTrack,
} from '../src/sim/mortar_overdrive/spline';

const SEED = 42;
const track = mortarOverdriveTrack(GARDEN_CIRCUIT);
const colliders = mortarOverdriveColliders(GARDEN_CIRCUIT);

/** Samples a collider box's outline in world coordinates. */
function outline(collider: (typeof colliders)[number]): { x: number; z: number }[] {
  if (collider.type !== 'obb') throw new Error('Mortar Overdrive boundaries are OBBs');
  const cos = Math.cos(collider.rot);
  const sin = Math.sin(collider.rot);
  const points: { x: number; z: number }[] = [];
  for (const lx of [-collider.hw, 0, collider.hw]) {
    for (const lz of [-collider.hd, collider.hd]) {
      points.push({
        x: MORTAR_OVERDRIVE_ORIGIN.x + collider.x + lx * cos + lz * sin,
        z: MORTAR_OVERDRIVE_ORIGIN.z + collider.z - lx * sin + lz * cos,
      });
    }
  }
  return points;
}

describe('Mortar Overdrive boundaries', () => {
  it('leaves the whole racing surface clear', () => {
    // The reported "bars in the middle of the track": nothing solid may reach
    // the road, on either side.
    let worst = Number.POSITIVE_INFINITY;
    for (const collider of colliders) {
      for (const point of outline(collider)) {
        const projection = track.project(point.x, point.z);
        worst = Math.min(worst, Math.abs(projection.lateral) - track.halfWidthAt(projection.s));
      }
    }
    expect(worst).toBeGreaterThan(0);
  });

  it('resolves a point on the centerline to itself', () => {
    for (let i = 0; i < track.samples.length; i += 11) {
      const sample = track.samples[i];
      const resolved = resolvePosition(SEED, sample.x, sample.z, 0.5);
      expect(resolved.x).toBeCloseTo(sample.x, 9);
      expect(resolved.z).toBeCloseTo(sample.z, 9);
    }
  });

  it('lets a racer run wide on BOTH sides, past the water and out into it', () => {
    // The whole garden is drivable: a mistake, a nudge or a shell has to be able
    // to put a racer off the road without a wall ending the moment. The circuit
    // has shipped the opposite three times, first with a wall hugging both road
    // edges, then with a stone rim around the basin, then with a containment
    // line derived from the racing line and wearing water or a hedge.
    for (let i = 0; i < track.samples.length; i += 17) {
      const sample = track.samples[i];
      for (const [offset, side] of [
        [track.halfWidthAt(sample.s) + 6, -1],
        [mortarOverdriveGardenEdgeOffsetAt(GARDEN_CIRCUIT, sample.s) - 0.5, 1],
        [mortarOverdriveGardenEdgeOffsetAt(GARDEN_CIRCUIT, sample.s) + 20, 1],
      ] as const) {
        const x = sample.x - sample.tz * offset * side;
        const z = sample.z + sample.tx * offset * side;
        const resolved = resolvePosition(SEED, x, z, 0.5);
        expect(Math.hypot(resolved.x - x, resolved.z - z)).toBeLessThan(1e-6);
      }
    }
  });

  it('closes the garden at the perimeter wall, which is the ONLY thing that does', () => {
    // Vacuity guard for the test above: something in this region must still
    // push, or "nothing stopped the racer" would prove nothing (the region used
    // to short-circuit to `return { x, z }` and collide with nothing at all).
    const probe = GARDEN_CIRCUIT.perimeter.halfX - 0.2;
    const pushed = resolvePosition(
      SEED,
      MORTAR_OVERDRIVE_ORIGIN.x + probe,
      MORTAR_OVERDRIVE_ORIGIN.z,
      0.5,
    );
    expect(pushed.x - MORTAR_OVERDRIVE_ORIGIN.x).toBeLessThan(probe);
    for (const [x, z] of [
      [GARDEN_CIRCUIT.perimeter.halfX + 4, 0],
      [-GARDEN_CIRCUIT.perimeter.halfX - 4, 0],
      [0, GARDEN_CIRCUIT.perimeter.halfZ + 4],
      [0, -GARDEN_CIRCUIT.perimeter.halfZ - 4],
    ]) {
      const resolved = resolvePosition(
        SEED,
        MORTAR_OVERDRIVE_ORIGIN.x + x,
        MORTAR_OVERDRIVE_ORIGIN.z + z,
        0.5,
      );
      expect(Math.abs(resolved.x - MORTAR_OVERDRIVE_ORIGIN.x)).toBeLessThanOrEqual(
        GARDEN_CIRCUIT.perimeter.halfX + 4,
      );
      expect(Math.abs(resolved.z - MORTAR_OVERDRIVE_ORIGIN.z)).toBeLessThanOrEqual(
        GARDEN_CIRCUIT.perimeter.halfZ + 4,
      );
    }
  });

  it('caches the built set (one build serves every Sim in the process)', () => {
    expect(mortarOverdriveColliders(GARDEN_CIRCUIT)).toBe(colliders);
    // The four perimeter slabs and nothing else: no rim, no hedge, no gantry.
    expect(colliders).toHaveLength(4);
  });

  it('keeps the region envelope strictly inside its reserved instance band', () => {
    // The volume FILLS its reserved window on the west side exactly, and has
    // since packet 28 put every circuit's instance volume at its ceiling: the
    // ceiling IS the distance from the origin to the band's own west edge, and
    // that edge IS `YUMI_BAND_X_MAX`. Touching it is exact rather than tight,
    // and the two lines below are why, both checked rather than asserted in
    // prose: the neighbouring band's membership test is half-open, so no yard
    // is ever claimed by both, and the maze CONTENT sits thousands of yards
    // further west than the edge of the window reserved around it.
    const westEdge = MORTAR_OVERDRIVE_ORIGIN.x - GARDEN_CIRCUIT.regionHalfX;
    expect(westEdge).toBeGreaterThanOrEqual(YUMI_BAND_X_MAX);
    expect(isYumiMazePos(westEdge)).toBe(false);
    // ...and the seam really is a seam rather than a gap: the yard below it IS
    // the neighbour's, so the two windows meet exactly and nothing is orphaned.
    expect(isYumiMazePos(westEdge - 1)).toBe(true);
    expect(YUMI_MAZE_X).toBeLessThan(westEdge - 1000);
    expect(MORTAR_OVERDRIVE_ORIGIN.x + GARDEN_CIRCUIT.regionHalfX).toBeLessThan(
      DUNGEON_OVERFLOW_X_BASE - 300,
    );
    // ...and the envelope really does cover every collider, or a racer could be
    // stopped by geometry that collision has already stopped owning.
    for (const collider of colliders) {
      for (const point of outline(collider)) {
        expect(Math.abs(point.x - MORTAR_OVERDRIVE_ORIGIN.x)).toBeLessThan(
          GARDEN_CIRCUIT.regionHalfX,
        );
        expect(Math.abs(point.z - MORTAR_OVERDRIVE_ORIGIN.z)).toBeLessThan(
          GARDEN_CIRCUIT.regionHalfZ,
        );
      }
    }
  });

  it('models every boundary as an OBB carrying its visual top', () => {
    for (const collider of colliders) {
      expect(collider.type).toBe('obb');
      if (collider.type !== 'obb') continue;
      expect(collider.hd).toBeGreaterThan(0);
      // The chase camera rides over a wall instead of being pulled inside it.
      expect(collider.cameraTopY).toBeGreaterThan(0);
      // Nothing on the circuit is standable: a racer cannot mantle the wall.
      expect(collider.standable).toBeUndefined();
    }
  });
});

describe('Mortar Overdrive collider arms', () => {
  it('stays out of the way off the band', () => {
    const solve = () => ({ x: 1, z: 1 });
    expect(resolveMortarOverdrivePosition(0, 0, 0.5, solve)).toBeNull();
    expect(mortarOverdriveSightBlocked(0, 0, 0.5, 1, () => true)).toBeNull();
  });

  it('solves in the circuit frame and shifts back to world space', () => {
    const x = MORTAR_OVERDRIVE_ORIGIN.x + 3;
    const z = MORTAR_OVERDRIVE_ORIGIN.z + 4;
    const seen: { x: number; z: number; list: unknown }[] = [];
    const out = resolveMortarOverdrivePosition(x, z, 0.5, (list, lx, lz) => {
      seen.push({ x: lx, z: lz, list });
      return { x: lx + 1, z: lz };
    });
    expect(seen).toEqual([{ x: 3, z: 4, list: colliders }]);
    expect(out).toEqual({ x: x + 1, z });
    expect(out).toEqual(
      resolveMortarOverdrivePosition(x, z, 0.5, (_l, lx, lz) => ({ x: lx + 1, z: lz })),
    );
    let skipLow: boolean | undefined;
    expect(
      mortarOverdriveSightBlocked(x, z, 0.5, 2, (list, lx, lz, _r, _y, skip) => {
        skipLow = skip;
        return list === colliders && lx === 3 && lz === 4;
      }),
    ).toBe(true);
    expect(skipLow).toBe(false);
  });
});
