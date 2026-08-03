// The Realm Racers dressing: the two halves of the catalog against each other,
// the ONE resolver both the renderer and the collision set read, the seeded
// fills, the placed ponds, and the readout that makes a piece of scenery on the
// racing surface unshippable.
//
// The load-bearing property is the resolver's singularity. Every scenery defect
// this packet exists for was a position DERIVED twice: the tiered fountain
// stood in the middle of one circuit's road because its placement was an offset
// from the band origin, tuned on another circuit's shape. So the tests below
// assert against the resolver's own output rather than re-deriving anything,
// and the renderer-versus-collider case asserts that both consumers landed on
// it unchanged.

import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CAMERA_ZOOM_MAX } from '../src/game/input';
import { MEDIA_ASSETS } from '../src/render/assets/manifest.generated';
import {
  cameraBoomDistance,
  REALM_RACERS_CAMERA_BOOM_PROFILE,
} from '../src/render/camera_boom_core';
import { PROP_ASSET_DEFS } from '../src/render/props';
import {
  REALM_RACERS_PROP_URLS,
  REALM_RACERS_PROP_VISUALS,
} from '../src/render/realm_racers_prop_visuals';
import { realmRacersPreloadInternalsForTest } from '../src/render/realm_racers_track';
import { resolvePosition } from '../src/sim/colliders';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { REALM_RACERS_PROPS } from '../src/sim/content/realm_racers_props';
import {
  realmRacersCircuitErrors,
  realmRacersCircuitMetrics,
} from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersColliders } from '../src/sim/realm_racers_colliders';
import {
  clearRealmRacersDraftCircuits,
  putRealmRacersDraftCircuit,
} from '../src/sim/realm_racers_draft_registry';
import {
  REALM_RACERS_CAMERA_REACH,
  REALM_RACERS_LANES,
  REALM_RACERS_ORIGIN,
  realmRacersLaneOffset,
} from '../src/sim/realm_racers_layout';
import {
  realmRacersPlacedPonds,
  realmRacersPlacedProps,
  realmRacersPlacements,
} from '../src/sim/realm_racers_props_resolve';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

const SEED = 42;
const publicDir = path.join(process.cwd(), 'public');

/** A draft id nobody else uses, so the overlay's slots stay this file's. */
function draft(id: string, extra: Partial<RealmRacersCircuit>): RealmRacersCircuit {
  return { ...GARDEN, id, props: undefined, ...extra };
}

afterAll(() => {
  clearRealmRacersDraftCircuits();
});

describe('Realm Racers props: the catalog has two halves and they must agree', () => {
  it('resolves every sim key to a visual, and every visual key to a footprint', () => {
    // The sim carries footprints because a collider needs dimensions; the
    // renderer carries models because the sim cannot import three. A key only
    // one of them knows is scenery that either has no size or has no picture.
    expect(Object.keys(REALM_RACERS_PROP_VISUALS).sort()).toEqual(
      Object.keys(REALM_RACERS_PROPS).sort(),
    );
  });

  it('draws every model out of the world catalog, on disk, manifested and preloaded', () => {
    const known = new Set(Object.values(PROP_ASSET_DEFS).map((def) => def.url));
    const preloaded = new Set(realmRacersPreloadInternalsForTest.assetUrls);
    for (const url of REALM_RACERS_PROP_URLS) {
      // Through the world's OWN registry, never a second one: that is what
      // keeps the manifest and preload guards covering it and what makes an
      // Evergarden circuit wear the Evergarden's vocabulary.
      expect(known.has(url), `${url} should be registered in PROP_ASSET_DEFS`).toBe(true);
      const rel = url.replace(/^\//, '');
      expect(existsSync(path.join(publicDir, rel)), `${url} should exist under public/`).toBe(true);
      expect(MEDIA_ASSETS[rel], `${url} should be in the media manifest`).toBeDefined();
      // An authored prop whose url misses the rally's own preload lane draws
      // NOTHING on a cold client and fails no test that does not look here.
      expect(preloaded.has(url), `${url} should ride the rally preload lane`).toBe(true);
    }
  });

  it('gives every kind a footprint and a height it could actually have', () => {
    for (const [key, def] of Object.entries(REALM_RACERS_PROPS)) {
      expect(def.height, key).toBeGreaterThan(0);
      // Nothing in a garden is thirty yards tall, and a footprint wider than
      // the road it stands beside is a measurement mistake, not a prop.
      expect(def.height, key).toBeLessThan(20);
      if (def.footprint.kind === 'circle') {
        expect(def.footprint.r, key).toBeGreaterThan(0);
        expect(def.footprint.r, key).toBeLessThan(10);
      } else {
        expect(def.footprint.hw, key).toBeGreaterThan(0);
        expect(def.footprint.hd, key).toBeGreaterThan(0);
        expect(Math.max(def.footprint.hw, def.footprint.hd), key).toBeLessThan(10);
      }
    }
  });

  it('derives the camera reach from the real camera rather than remembering it', () => {
    // `src/sim/` may import neither the input module nor the boom core, so the
    // constant lives in the layout leaf and this is what holds it honest: the
    // rule is the zoom ceiling through the rally boom, and it moves when either
    // of those moves.
    expect(REALM_RACERS_CAMERA_REACH).toBeCloseTo(
      cameraBoomDistance(CAMERA_ZOOM_MAX, REALM_RACERS_CAMERA_BOOM_PROFILE),
      9,
    );
  });
});

describe('Realm Racers props: the resolver is the single source of positions', () => {
  it('keeps a track-space prop on its corner when the centerline moves', () => {
    const bench = { asset: 'bench', at: { s: 0.3, offset: 24 }, yaw: 'tangent' } as const;
    const before = draft('props_anchor_a', { props: [bench] });
    // The same record with ONE control point nudged: track-space is authored as
    // a lap fraction, so the piece rides the curve rather than being left
    // standing where the road used to be.
    const moved = draft('props_anchor_b', {
      props: [bench],
      controlPoints: GARDEN.controlPoints.map((point, i) =>
        i === 4 ? { x: point.x + 14, z: point.z + 10 } : point,
      ),
    });
    const a = realmRacersPlacedProps(before)[0];
    const b = realmRacersPlacedProps(moved)[0];
    // It MOVED in the world...
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeGreaterThan(1);
    // ...and it is still exactly where it was authored: 24 yards along the left
    // normal from whatever point sits at lap fraction 0.3 on THAT curve. An
    // absolute point would have been left standing beside the old road.
    for (const [circuit, placed] of [
      [before, a],
      [moved, b],
    ] as const) {
      const track = realmRacersTrack(circuit);
      const anchor = track.pointAt(0.3 * track.length);
      const dx = placed.x + REALM_RACERS_ORIGIN.x - anchor.x;
      const dz = placed.z + REALM_RACERS_ORIGIN.z - anchor.z;
      expect(Math.hypot(dx, dz)).toBeCloseTo(24, 6);
      expect(dx * -anchor.tz + dz * anchor.tx).toBeCloseTo(24, 6);
      // ...facing the racing direction it was told to face.
      expect(placed.yaw).toBeCloseTo(Math.atan2(anchor.tx, anchor.tz), 6);
    }
  });

  it('leaves an absolute prop exactly where it was authored, whatever the road does', () => {
    const at = { x: -4, z: 4 };
    const here = realmRacersPlacedProps(
      draft('props_absolute', { props: [{ asset: 'well', at }] }),
    )[0];
    expect(here.x).toBe(at.x);
    expect(here.z).toBe(at.z);
  });

  it('takes the collision default from the catalog, and every override from the record', () => {
    const circuit = draft('props_collide', {
      props: [
        { asset: 'statue', at: { x: 40, z: 4 } },
        { asset: 'statue', at: { x: 44, z: 4 }, collide: 'none' },
        { asset: 'shrub', at: { x: 48, z: 4 } },
        { asset: 'shrub', at: { x: 52, z: 4 }, collide: { kind: 'circle', r: 3 } },
      ],
    });
    const placed = realmRacersPlacedProps(circuit);
    expect(placed.map((prop) => prop.solid)).toEqual([true, false, false, true]);
    // An override carries its own dimensions, at the size it was authored:
    // scale multiplies the CATALOG's footprint, never a hand-written one.
    expect(placed[3].footprint).toEqual({ kind: 'circle', r: 3 });
    expect(placed[0].footprint).toEqual({ kind: 'obb', hw: 0.75, hd: 0.75, rot: 0 });
  });

  it('scales the catalog footprint and the height together', () => {
    const circuit = draft('props_scale', {
      props: [{ asset: 'fountain', at: { x: -4, z: 4 }, scale: 2.2 }],
    });
    const placed = realmRacersPlacedProps(circuit)[0];
    expect(placed.footprint).toEqual({ kind: 'circle', r: 3.3 * 2.2 });
    expect(placed.height).toBeCloseTo(3.8 * 2.2, 9);
  });

  it('draws and collides the SAME piece: one resolver, two consumers', () => {
    // The renderer instances what the resolver returns and the collision set
    // appends what it marks solid, so a drift between the two is structurally
    // impossible; this is what pins that neither re-derives anything.
    const circuit = draft('props_no_drift', {
      props: [
        { asset: 'statue', at: { s: 0.5, offset: 30 }, yaw: 'tangent' },
        { asset: 'well', at: { x: -30, z: 30 }, scale: 3, collide: 'none' },
      ],
    });
    const solid = realmRacersPlacedProps(circuit).filter((prop) => prop.solid);
    expect(solid).toHaveLength(1);
    const colliders = realmRacersColliders(circuit);
    // Four perimeter slabs plus exactly the solid pieces, and no more: a
    // decorative override adds nothing to collision.
    expect(colliders).toHaveLength(5);
    const appended = colliders[4];
    if (appended.type !== 'obb') throw new Error('a statue is an obb');
    expect(appended.x).toBe(solid[0].x);
    expect(appended.z).toBe(solid[0].z);
    expect(appended.hw).toBe(0.75);
    expect(appended.rot).toBe(solid[0].yaw);
  });

  it('renders the migrated fountain where the deleted landmark field put it', () => {
    // The practice circuit's landmark was `{ x: -4, z: 4 }` drawn at scale 2.2,
    // and the painter added the band origin. Pinned as WORLD numbers so the
    // migration is measured against what shipped rather than against itself.
    const fountain = realmRacersPlacedProps(GARDEN).find((prop) => prop.asset === 'fountain');
    if (!fountain) throw new Error('the practice circuit dresses its infield with a fountain');
    expect(fountain.x + REALM_RACERS_ORIGIN.x).toBe(113_696);
    expect(fountain.z + REALM_RACERS_ORIGIN.z).toBe(4);
    expect(fountain.scale).toBe(2.2);
    expect(fountain.footprint).toEqual({ kind: 'circle', r: 3.3 * 2.2 });
    // ...still out past the shore, on the island, clear of everything drivable.
    const track = realmRacersTrack(GARDEN);
    const projection = track.project(
      fountain.x + REALM_RACERS_ORIGIN.x,
      fountain.z + REALM_RACERS_ORIGIN.z,
    );
    expect(projection.lateral - 3.3 * 2.2).toBeGreaterThan(
      rallyGardenEdgeOffsetAt(GARDEN, projection.s),
    );
    // ...and it collides with nothing, exactly as it never did.
    expect(realmRacersColliders(GARDEN)).toHaveLength(4);
  });
});

describe('Realm Racers props: a seeded scatter', () => {
  const scatterCircuit = (id: string, seed: number, spacing = 12): RealmRacersCircuit =>
    draft(id, { scatters: [{ asset: 'shrub', zone: 'outfield', spacing, seed }] });

  it('lands the same pieces twice, and different pieces on a different seed', () => {
    const key = (circuit: RealmRacersCircuit): string =>
      realmRacersPlacements(circuit)
        .scattered.map((prop) => `${prop.x.toFixed(4)},${prop.z.toFixed(4)}`)
        .join('|');
    expect(key(scatterCircuit('scatter_a', 11))).toBe(key(scatterCircuit('scatter_a2', 11)));
    expect(key(scatterCircuit('scatter_b', 12))).not.toBe(key(scatterCircuit('scatter_a', 11)));
  });

  it('respects the spacing it was asked for, within the jitter it allows', () => {
    const spots = realmRacersPlacements(scatterCircuit('scatter_spacing', 5, 14)).scattered;
    expect(spots.length).toBeGreaterThan(20);
    // A jittered grid: no two pieces closer than a cell less its jitter, and
    // the field is not one clump either.
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        closest = Math.min(closest, Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z));
      }
    }
    expect(closest).toBeGreaterThan(14 * 0.4);
  });

  it('never sows a piece on the racing surface, and never sows a solid one', () => {
    const track = realmRacersTrack(GARDEN);
    for (const zone of ['infield', 'outfield'] as const) {
      const circuit = draft(`scatter_${zone}`, {
        scatters: [{ asset: 'bedRound', zone, spacing: 9, seed: 3 }],
      });
      const spots = realmRacersPlacements(circuit).scattered;
      expect(spots.length).toBeGreaterThan(0);
      for (const spot of spots) {
        const projection = track.project(
          spot.x + REALM_RACERS_ORIGIN.x,
          spot.z + REALM_RACERS_ORIGIN.z,
        );
        const side: 1 | -1 = projection.lateral >= 0 ? 1 : -1;
        expect(side).toBe(zone === 'infield' ? 1 : -1);
        expect(Math.abs(projection.lateral)).toBeGreaterThan(
          rallyGardenEdgeOffsetAt(circuit, projection.s),
        );
        // A fill is dressing by definition: a field of colliders an author
        // never looked at one by one is the invisible wall the design outlawed.
        expect(spot.solid).toBe(false);
      }
      // ...and the readout agrees that nothing was sown anywhere it should not be.
      expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(circuit))).toEqual([]);
    }
  });

  it('keeps a span to its stretch of lap, wrapping across the start line', () => {
    const track = realmRacersTrack(GARDEN);
    const circuit = draft('scatter_span', {
      scatters: [
        { asset: 'shrub', zone: 'outfield', span: { s0: 0.9, s1: 0.1 }, spacing: 8, seed: 9 },
      ],
    });
    const spots = realmRacersPlacements(circuit).scattered;
    expect(spots.length).toBeGreaterThan(0);
    for (const spot of spots) {
      const projection = track.project(
        spot.x + REALM_RACERS_ORIGIN.x,
        spot.z + REALM_RACERS_ORIGIN.z,
      );
      const fraction = projection.s / track.length;
      expect(fraction >= 0.9 || fraction <= 0.1).toBe(true);
    }
  });
});

describe('Realm Racers props: a solid piece is real collision', () => {
  it('stops a driven racer, on every lane, and lets a decorative one through', () => {
    // Two drafts of the same geometry so the LANE FRAME is exercised: a lane's
    // colliders are circuit-local and offset per copy, and a prop that stopped
    // a racer on one lane and not on the next is the practice-copy bug class.
    const solidAt = { x: -4, z: 40 };
    const solid = draft('props_lane_solid', {
      props: [{ asset: 'statue', at: solidAt, scale: 4 }],
    });
    const decorative = draft('props_lane_decor', {
      props: [{ asset: 'statue', at: solidAt, scale: 4, collide: 'none' }],
    });
    const solidLane = REALM_RACERS_LANES.length + putRealmRacersDraftCircuit(solid);
    const decorLane = REALM_RACERS_LANES.length + putRealmRacersDraftCircuit(decorative);
    expect(decorLane).not.toBe(solidLane);

    for (const [lane, blocks] of [
      [solidLane, true],
      [decorLane, false],
    ] as const) {
      const offset = realmRacersLaneOffset(lane);
      const x = REALM_RACERS_ORIGIN.x + solidAt.x + offset.x;
      const z = REALM_RACERS_ORIGIN.z + solidAt.z + offset.z;
      // A body standing on the piece's own centre: a solid one pushes it out,
      // and everything else in that lane is open garden that leaves it alone.
      const resolved = resolvePosition(SEED, x, z, 0.5);
      const stopped = Math.hypot(resolved.x - x, resolved.z - z) > 1e-6;
      expect(stopped, `lane ${lane} should ${blocks ? 'stop' : 'pass'}`).toBe(blocks);
    }
  });
});

describe('Realm Racers props: the readout refuses what cannot ship', () => {
  const codes = (circuit: RealmRacersCircuit): string[] =>
    realmRacersCircuitMetrics(circuit).problems.map((problem) => problem.code);

  it('errors on a prop standing on the racing surface, decorative or not', () => {
    // THE check: the tiered fountain that stood in the middle of a road
    // collided with nothing at all, so a collision-only rule would have blessed
    // it. The prop below is likewise decorative.
    const track = realmRacersTrack(GARDEN);
    const onRoad = draft('props_on_road', {
      props: [{ asset: 'bench', at: { s: 0.1, offset: 2 }, collide: 'none' }],
    });
    expect(codes(onRoad)).toContain('prop_blocks_racing_surface');
    // ...and a piece just past the same envelope clears it.
    const clear = draft('props_off_road', {
      props: [
        {
          asset: 'bench',
          at: { s: 0.1, offset: -(rallyGardenEdgeOffsetAt(GARDEN, 0.1 * track.length) + 6) },
        },
      ],
    });
    expect(codes(clear)).not.toContain('prop_blocks_racing_surface');
  });

  it('errors on a catalog key nothing draws, and on a prop off the collision region', () => {
    expect(
      codes(draft('props_unknown', { props: [{ asset: 'no_such_prop', at: { x: 0, z: 60 } }] })),
    ).toContain('unknown_prop_asset');
    expect(
      codes(
        draft('props_outside', {
          props: [{ asset: 'well', at: { x: GARDEN.regionHalfX + 5, z: 0 } }],
        }),
      ),
    ).toContain('prop_outside_region');
  });

  it('leaves a solid piece out in the garden alone, wherever it stands', () => {
    // Two warnings used to fire here and neither could ever come back false.
    // One said a solid prop stood on drivable ground, which since track limits
    // became a rule is true of everything inside the wall; the other said a
    // solid prop was too low or too alone to be read, which is a rule about the
    // PIECE and never about where it is, so a bench forty yards off the road
    // tripped it as surely as one at a corner exit. What is left is the error
    // below: nothing may stand on the ground the race is run on.
    const lone = draft('props_lone_bollard', {
      props: [{ asset: 'statueBlock', at: { x: 0, z: 0 } }],
    });
    expect(realmRacersCircuitMetrics(lone).problems).toEqual([]);
    const run = draft('props_solid_run', {
      props: [0, 1, 2, 3].map((i) => ({
        asset: 'gardenIronFence' as const,
        at: { x: -6 + i * 4, z: 0 },
      })),
    });
    expect(realmRacersCircuitMetrics(run).problems).toEqual([]);
    // Not vacuous: the same lone piece ON the road is still the one error the
    // dressing can commit.
    const onRoad = draft('props_lone_on_road', {
      props: [{ asset: 'statueBlock', at: { s: 0.1, offset: 2 } }],
    });
    expect(codes(onRoad)).toEqual(['prop_blocks_racing_surface']);
  });

  it('warns on a tall piece inside the chase camera reach, and not on a low one', () => {
    const canopy = draft('props_canopy', {
      props: [{ asset: 'oak', at: { s: 0.1, offset: -20 }, scale: 1, collide: 'none' }],
    });
    expect(codes(canopy)).toContain('prop_in_camera_reach');
    const bench = draft('props_bench_near', {
      props: [{ asset: 'bench', at: { s: 0.1, offset: -20 }, collide: 'none' }],
    });
    expect(codes(bench)).not.toContain('prop_in_camera_reach');
  });

  it('errors on a pond over the road and warns on one racers drive through', () => {
    const track = realmRacersTrack(GARDEN);
    const onRoad = track.pointAt(0.1 * track.length);
    const swallowing = draft('pond_on_road', {
      ponds: [
        {
          x: onRoad.x - REALM_RACERS_ORIGIN.x,
          z: onRoad.z - REALM_RACERS_ORIGIN.z,
          rx: 30,
          rz: 22,
        },
      ],
    });
    expect(codes(swallowing)).toContain('pond_on_racing_surface');
    // A pond out in the infield is legal decor, reported as nothing at all: a
    // machine drives through it with no splash and no slow, and the ground it
    // covers is garden every yard of which is drivable anyway.
    const infield = draft('pond_infield', { ponds: [{ x: -4, z: 4, rx: 16, rz: 10 }] });
    expect(codes(infield)).not.toContain('pond_on_racing_surface');
  });

  it('refuses a pond on a circuit with no bank profile to shade it', () => {
    const dry = draft('pond_no_basin', {
      basin: undefined,
      ponds: [{ x: -4, z: 4, rx: 16, rz: 10 }],
    });
    expect(codes(dry)).toContain('pond_requires_basin');
  });

  it('leaves both shipped circuits free of every dressing ERROR', () => {
    for (const circuit of REALM_RACERS_CIRCUIT_LIST) {
      expect(realmRacersCircuitErrors(realmRacersCircuitMetrics(circuit)), circuit.id).toEqual([]);
    }
  });
});

describe('Realm Racers props: a placed pond', () => {
  const pondCircuit = (id: string, seed: number): RealmRacersCircuit =>
    draft(id, { ponds: [{ x: -4, z: 4, rx: 20, rz: 12, rot: 0.5, wobble: 0.2, seed }] });

  it('closes on itself, stays inside its own wobble, and is the same shape twice', () => {
    const a = realmRacersPlacedPonds(pondCircuit('pond_a', 3))[0];
    const b = realmRacersPlacedPonds(pondCircuit('pond_a2', 3))[0];
    expect(a.outline.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`)).toEqual(
      b.outline.map((p) => `${p.x.toFixed(6)},${p.z.toFixed(6)}`),
    );
    // Every point is within the authored radii scaled by the wobble, so a pond
    // never grows past the ellipse its five numbers describe.
    for (const point of a.outline) {
      const dx = point.x - a.x;
      const dz = point.z - a.z;
      // Back into the ellipse's own frame before measuring against its radii.
      const local = {
        x: dx * Math.cos(-0.5) - dz * Math.sin(-0.5),
        z: dx * Math.sin(-0.5) + dz * Math.cos(-0.5),
      };
      expect(Math.hypot(local.x / 20, local.z / 12)).toBeLessThanOrEqual(1.2 + 1e-9);
      expect(Math.hypot(local.x / 20, local.z / 12)).toBeGreaterThanOrEqual(0.8 - 1e-9);
    }
    expect(a.radius).toBeGreaterThan(0);
    // A different seed wobbles differently.
    const other = realmRacersPlacedPonds(pondCircuit('pond_b', 4))[0];
    expect(other.outline[3].x).not.toBeCloseTo(a.outline[3].x, 6);
  });

  it('is decor only: a pond appends no collider and no slow', () => {
    const circuit = pondCircuit('pond_decor', 1);
    expect(realmRacersColliders(circuit)).toHaveLength(4);
  });
});
