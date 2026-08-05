// Whether the near-field blade carpet can grow on a circuit, and only where it
// should.
//
// The carpet is what a realm's meadow is made of (the Nightbloom's violet is
// almost entirely its blades), and it never reached the instance band because
// its placement gate is the overworld's. What is pinned here is the answer the
// circuit gives it back: a mask baked off the same spline the road is swept
// along, so what stays bare is exactly what is drawn.

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { suggestGroundOutline } from '../src/editor/circuit/envelope_core';
import { biomeGrassTint, GRASS_BIOME_DENSITY } from '../src/render/foliage_core';
import {
  REALM_RACERS_GRASS_TILE_RADIUS,
  REALM_RACERS_GRASS_TILE_YARDS,
  REALM_RACERS_GRASS_YARDS_PER_CLUSTER,
  realmRacersGrassAllowed,
  realmRacersGrassMask,
  realmRacersGrassTiles,
  realmRacersGrassTint,
} from '../src/render/realm_racers_grass_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import { realmRacersGroundShape } from '../src/sim/realm_racers_ground';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import { realmRacersPlacedPonds } from '../src/sim/realm_racers_props_resolve';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';

const track = realmRacersTrack(GARDEN_CIRCUIT);

/**
 * The garden's curve under a named skin: the same geometry, so what differs
 * between two probes is the theme and nothing else.
 *
 * Every case goes through this rather than reading the shipped record's own
 * `theme`, because that field is the one an operator flips to look at a theme
 * in game, and a suite that broke when they did would be testing the state of
 * a scratch edit rather than the seam.
 */
const probe = (themeId: string): RealmRacersCircuit => ({
  ...GARDEN_CIRCUIT,
  id: `grass_probe_${themeId}`,
  theme: themeId,
});

describe('Realm Racers grass', () => {
  it('leaves the racing surface bare, all the way round', () => {
    // Sampled on the centerline itself and at both road edges, which is the
    // claim that matters: no blade stands where a machine drives.
    for (const sample of track.samples) {
      const localX = sample.x - REALM_RACERS_ORIGIN.x;
      const localZ = sample.z - REALM_RACERS_ORIGIN.z;
      for (const across of [0, sample.halfWidth, -sample.halfWidth]) {
        const x = localX - sample.tz * across;
        const z = localZ + sample.tx * across;
        expect(
          realmRacersGrassAllowed(GARDEN_CIRCUIT, x, z),
          `road at s=${sample.s.toFixed(1)}, across=${across}`,
        ).toBe(false);
      }
    }
  });

  it('grows in the garden, on BOTH sides of the road', () => {
    // The point of the whole thing: everywhere except the track. Measured out
    // past the run-off, where the lawn starts.
    const clear = REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH + 6;
    const sides = new Set<number>();
    let grown = 0;
    for (const sample of track.samples) {
      const localX = sample.x - REALM_RACERS_ORIGIN.x;
      const localZ = sample.z - REALM_RACERS_ORIGIN.z;
      for (const side of [1, -1]) {
        const across = side * (sample.halfWidth + clear);
        const x = localX - sample.tz * across;
        const z = localZ + sample.tx * across;
        // Only where the point is really lawn: past the wall, or inside a
        // pond, a NO is the right answer and is checked by its own case.
        if (Math.abs(x) > GARDEN_CIRCUIT.perimeter.halfX - 2) continue;
        if (Math.abs(z) > GARDEN_CIRCUIT.perimeter.halfZ - 2) continue;
        if (
          realmRacersPlacedPonds(GARDEN_CIRCUIT).some((p) => polygonContainsPoint(p.outline, x, z))
        )
          continue;
        if (realmRacersGrassAllowed(GARDEN_CIRCUIT, x, z)) {
          grown++;
          sides.add(side);
        }
      }
    }
    expect(grown).toBeGreaterThan(400);
    expect(sides).toEqual(new Set([1, -1]));
  });

  it('keeps every blade out of the water', () => {
    // The lawn is cut open under a pond, so a blade there stands on the
    // surface rather than beside it.
    const ponds = realmRacersPlacedPonds(GARDEN_CIRCUIT);
    expect(ponds.length).toBeGreaterThan(0);
    for (const pond of ponds) {
      expect(realmRacersGrassAllowed(GARDEN_CIRCUIT, pond.x, pond.z)).toBe(false);
      for (const point of pond.outline) {
        // A hair inside the outline, toward the middle.
        const x = point.x + (pond.x - point.x) * 0.1;
        const z = point.z + (pond.z - point.z) * 0.1;
        expect(realmRacersGrassAllowed(GARDEN_CIRCUIT, x, z)).toBe(false);
      }
    }
  });

  it('stops at the SHORE on a circuit that authored one', () => {
    // The defect this closes, and it was seen in the seat before it was seen
    // here: the mask covers the perimeter BOX, so an island grew a rectangle of
    // meadow out over the sea around it. A box is not a shape.
    const island: RealmRacersCircuit = {
      ...probe('nightbloom'),
      id: 'grass_probe_island',
      groundOutline: suggestGroundOutline(GARDEN_CIRCUIT),
    };
    const clusters = realmRacersGrassTiles(island).flatMap((tile) => tile.clusters);
    // Non-vacuity first: a theme that grows nothing would pass everything below
    // by having no blades at all, which is exactly how this defect could come
    // back unnoticed.
    expect(clusters.length).toBeGreaterThan(5000);
    const outline = realmRacersGroundShape(island).outline;
    for (const cluster of clusters) {
      expect(
        polygonContainsPoint(outline, cluster.x, cluster.z),
        `cluster at ${cluster.x.toFixed(1)}, ${cluster.z.toFixed(1)}`,
      ).toBe(true);
    }
    // ...and it really was a CLIP rather than the meadow being switched off: the
    // same theme on the same curve with no shore drawn grows more.
    const unclipped = realmRacersGrassTiles(probe('nightbloom')).flatMap((tile) => tile.clusters);
    expect(unclipped.length).toBeGreaterThan(clusters.length);
    // The mask says so directly too, on both sides of one shore point.
    const shore = outline[0];
    expect(realmRacersGrassAllowed(island, shore.x * 1.1, shore.z * 1.1)).toBe(false);
  });

  it('leaves a circuit with no shore drawn exactly the meadow it always had', () => {
    // The other half of the clip: a record that authors no outline must not lose
    // a single blade to it, which is what makes the two shipped circuits safe.
    const plain = probe('nightbloom');
    const clusters = realmRacersGrassTiles(plain).flatMap((tile) => tile.clusters);
    expect(clusters.length).toBeGreaterThan(5000);
    const { halfX, halfZ } = plain.perimeter;
    // Every corner of the perimeter box is still fair game, which an island
    // would have eaten.
    for (const [x, z] of [
      [halfX - 3, halfZ - 3],
      [-(halfX - 3), halfZ - 3],
      [halfX - 3, -(halfZ - 3)],
      [-(halfX - 3), -(halfZ - 3)],
    ]) {
      expect(realmRacersGrassAllowed(plain, x, z), `${x}, ${z}`).toBe(true);
    }
  });

  it('stops at the perimeter wall', () => {
    // Past it is the lawn's overshoot, which no racer reaches and which the
    // carpet would only pay for.
    const { halfX, halfZ } = GARDEN_CIRCUIT.perimeter;
    expect(realmRacersGrassAllowed(GARDEN_CIRCUIT, halfX + 20, 0)).toBe(false);
    expect(realmRacersGrassAllowed(GARDEN_CIRCUIT, 0, halfZ + 20)).toBe(false);
  });

  describe('what a themed circuit actually grows', () => {
    it('follows the zone, which for the Evergarden means NONE', () => {
      // Not an omission and not a tuning choice: `GRASS_BIOME_DENSITY` says the
      // Evergarden is mown lawn and grows no wild blades, and its flowers live
      // in authored beds instead. Both shipped circuits wear that theme, so
      // both are bare, and a garden circuit that sprouted a meadow would be
      // wrong about its own zone.
      expect(GRASS_BIOME_DENSITY.garden).toBe(0);
      expect(realmRacersGrassTiles(probe('evergarden'))).toEqual([]);
    });

    it('spends the zone density it reads, not merely its sign', () => {
      // `theme.ground === 'garden' ? 0 : 1` would pass every other case here,
      // because the table authors no entry for `night` or `gale` and both take
      // the `?? 1` fallback. So the count is checked against what the density
      // actually BUYS: one cluster per YARDS_PER_CLUSTER of free lawn.
      const night = probe('nightbloom');
      const mask = realmRacersGrassMask(night);
      const free = mask.blocked.reduce((sum, cell) => sum + (1 - cell), 0);
      const clusters = realmRacersGrassTiles(night).reduce(
        (sum, tile) => sum + tile.clusters.length,
        0,
      );
      const density = GRASS_BIOME_DENSITY.night ?? 1;
      const expected = (free * density) / REALM_RACERS_GRASS_YARDS_PER_CLUSTER;
      expect(clusters / expected).toBeGreaterThan(0.9);
      expect(clusters / expected).toBeLessThan(1.1);
    });

    it('grows a violet meadow on a Nightbloom circuit, in its zone colour', () => {
      const night = probe('nightbloom');
      const tiles = realmRacersGrassTiles(night);
      expect(tiles.length).toBeGreaterThan(10);
      const clusters = tiles.reduce((sum, tile) => sum + tile.clusters.length, 0);
      expect(clusters).toBeGreaterThan(5000);
      expect(realmRacersGrassTint(night)).toBe(biomeGrassTint('night'));
      // The colour is the zone's, not a copy: a retinted realm carries its
      // circuit with it.
      expect(realmRacersGrassTint(night)).not.toBe(realmRacersGrassTint(probe('galecrest')));
    });

    it('puts no cluster on the road or in the water', () => {
      // Measured against the GEOMETRY, not against the mask that placed them:
      // reading a cluster back through `realmRacersGrassAllowed` recovers the
      // very cell `buildTiles` already checked (the jitter is bounded by half a
      // cell, so `Math.round` returns the originating column every time), which
      // asserts nothing at all.
      const ponds = realmRacersPlacedPonds(GARDEN_CIRCUIT);
      for (const tile of realmRacersGrassTiles(probe('nightbloom'))) {
        for (const cluster of tile.clusters) {
          const projection = track.project(
            cluster.x + REALM_RACERS_ORIGIN.x,
            cluster.z + REALM_RACERS_ORIGIN.z,
          );
          expect(
            Math.abs(projection.lateral),
            `cluster at ${cluster.x.toFixed(1)}, ${cluster.z.toFixed(1)}`,
          ).toBeGreaterThan(rallyGardenEdgeOffsetAt(GARDEN_CIRCUIT, projection.s));
          for (const pond of ponds) {
            expect(polygonContainsPoint(pond.outline, cluster.x, cluster.z)).toBe(false);
          }
        }
      }
    });

    it('tiles the scatter, so the frustum has something to throw away', () => {
      // One mesh for a whole circuit is submitted in full from every corner of
      // it; the tiles are what make the cost track what is on screen.
      const tiles = realmRacersGrassTiles(probe('nightbloom'));
      const centres = new Set(tiles.map((tile) => `${tile.x}:${tile.z}`));
      expect(centres.size).toBe(tiles.length);
      for (const tile of tiles) {
        expect(tile.clusters.length).toBeGreaterThan(0);
        for (const cluster of tile.clusters) {
          // Half the tile, not a whole one: at 40 a doubled tile pitch would
          // still pass, and the bounding sphere the painter builds from the
          // centre assumes this.
          expect(Math.abs(cluster.x - tile.x)).toBeLessThanOrEqual(
            REALM_RACERS_GRASS_TILE_YARDS / 2,
          );
          expect(Math.abs(cluster.z - tile.z)).toBeLessThanOrEqual(
            REALM_RACERS_GRASS_TILE_YARDS / 2,
          );
        }
      }
    });

    it('is the same meadow every session', () => {
      // Placed off `hash2` over the mask grid, never a live rng: two clients
      // looking at one circuit have to see one circuit.
      const a = realmRacersGrassTiles(probe('nightbloom'));
      const b = realmRacersGrassTiles({ ...probe('nightbloom'), id: 'grass_repeat' });
      // EVERY tile and every cluster, not the first of each: the jitter and the
      // lean are hashed per cluster index, so a regression in the n > 0 arm
      // would sit entirely behind a first-element comparison.
      expect(b).toEqual(a);
    });
  });

  describe('through the real builder', () => {
    // `buildGrass` takes an early return on `GFX.bladeCarpetRadius <= 0`, and
    // headless resolves to the low tier where that is 0, so WITHOUT this stub
    // the entire Three half of the feature runs in no test at all.
    beforeEach(() => {
      vi.resetModules();
      vi.doMock('../src/render/gfx', async () => {
        const actual =
          await vi.importActual<typeof import('../src/render/gfx')>('../src/render/gfx');
        return { ...actual, GFX: { ...actual.GFX, bladeCarpetRadius: 34 } };
      });
      vi.doMock('../src/render/textures', () => {
        const texture = (): THREE.DataTexture => {
          const tex = new THREE.DataTexture(
            new Uint8Array([255, 255, 255, 255]),
            1,
            1,
            THREE.RGBAFormat,
          );
          tex.needsUpdate = true;
          return tex;
        };
        return {
          rallyKerbTexture: vi.fn(texture),
          rallyGroundBlastMarkerTexture: vi.fn(texture),
          rallyStartGridTexture: vi.fn(texture),
          flowerTuftTexture: vi.fn(texture),
          grassTuftTexture: vi.fn(texture),
          // The pickup boxes wear the world's own quest-object sparkle.
          sparkleTexture: vi.fn(texture),
          groundDetailTexture: vi.fn(texture),
          macroNoiseTexture: vi.fn(texture),
          groundSplatMaps: vi.fn(() => ({
            grass: { map: texture(), normalMap: texture() },
            dirt: { map: texture(), normalMap: texture() },
            rock: { map: texture(), normalMap: texture() },
            sand: { map: texture(), normalMap: texture() },
          })),
        };
      });
    });
    afterEach(() => {
      vi.doUnmock('../src/render/gfx');
      vi.doUnmock('../src/render/textures');
    });

    /** The grass tiles of a build: the shared cluster geometry is the one thing
     *  only the meadow draws, so identity picks them out. */
    const grassMeshes = (group: THREE.Group): THREE.InstancedMesh[] =>
      group.children.filter(
        (child): child is THREE.InstancedMesh =>
          child instanceof THREE.InstancedMesh && child.userData.renderCategory === 'grass',
      );

    it('draws one instanced tile per tile, and none on a bare theme', async () => {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const tiles = realmRacersGrassTiles(probe('nightbloom'));
      const meshes = grassMeshes(buildRealmRacersTrack(probe('nightbloom')).group);
      expect(meshes).toHaveLength(tiles.length);
      expect(meshes.reduce((sum, mesh) => sum + mesh.count, 0)).toBe(
        tiles.reduce((sum, tile) => sum + tile.clusters.length, 0),
      );
      // The Evergarden is mown lawn, so its build carries no meadow at all.
      expect(grassMeshes(buildRealmRacersTrack(probe('evergarden')).group)).toHaveLength(0);
    });

    it('borrows one geometry for every tile and every build', async () => {
      // The dispose core frees a plain mesh's geometry and never an instanced
      // one, on the promise that every instanced geometry is SHARED. A meadow
      // that minted one per tile would take every other circuit's grass down
      // with a rebuilt draft.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const first = grassMeshes(buildRealmRacersTrack(probe('nightbloom')).group);
      const second = grassMeshes(
        buildRealmRacersTrack({ ...probe('nightbloom'), id: 'grass_rebuild' }).group,
      );
      const geometries = new Set([...first, ...second].map((mesh) => mesh.geometry));
      expect(geometries.size).toBe(1);
      // ...and the colour rides the MATERIAL, so no per-instance colour buffer
      // carries one repeated value across tens of thousands of clusters.
      expect(first[0].instanceColor).toBeNull();
      const material = first[0].material as THREE.MeshStandardMaterial;
      expect(new Set([...first, ...second].map((mesh) => mesh.material)).size).toBe(1);
      expect(material.color.getHex()).not.toBe(0xffffff);
    });

    it('gives every tile its own bounding sphere, so the frustum can cull it', async () => {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const meshes = grassMeshes(buildRealmRacersTrack(probe('nightbloom')).group);
      const centres = new Set<string>();
      for (const mesh of meshes) {
        const sphere = mesh.boundingSphere;
        expect(sphere).not.toBeNull();
        expect(sphere?.radius).toBeCloseTo(REALM_RACERS_GRASS_TILE_RADIUS, 6);
        centres.add(`${sphere?.center.x}:${sphere?.center.z}`);
        // Every cluster of the tile really is inside the sphere it claims.
        const matrix = new THREE.Matrix4();
        const position = new THREE.Vector3();
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, matrix);
          position.setFromMatrixPosition(matrix);
          expect(sphere?.containsPoint(position)).toBe(true);
        }
      }
      expect(centres.size).toBe(meshes.length);
    });
  });

  it('covers the box it claims to, one byte per square yard', () => {
    const mask = realmRacersGrassMask(GARDEN_CIRCUIT);
    expect(mask.halfX).toBe(GARDEN_CIRCUIT.perimeter.halfX);
    expect(mask.halfZ).toBe(GARDEN_CIRCUIT.perimeter.halfZ);
    expect(mask.blocked).toHaveLength(mask.columns * mask.rows);
    // The road really is a minority of the garden: a mask that blocked
    // everything would pass every "bare" case above on its own.
    const blocked = mask.blocked.reduce((sum, cell) => sum + cell, 0);
    expect(blocked).toBeGreaterThan(mask.blocked.length * 0.05);
    expect(blocked).toBeLessThan(mask.blocked.length * 0.6);
    // Built once per circuit, not per query: the carpet asks hundreds of times
    // a frame while a machine is moving.
    expect(realmRacersGrassMask(GARDEN_CIRCUIT)).toBe(mask);
  });
});
