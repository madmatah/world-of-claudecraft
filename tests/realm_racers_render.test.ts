import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RALLY_SLICK_POOL } from '../src/render/realm_racers_slicks_core';
import { CIRCUIT_THEMES } from '../src/render/realm_racers_themes';
import {
  rallyBorderFlowerSpots,
  rallyFlowerSpots,
  rallyKerbRuns,
  rallyPerimeterPieces,
  rallyPondMeshes,
  rallyPondReedSpots,
  rallyStartArchPlacement,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from '../src/render/realm_racers_track_core';
import { SPARKLE_BOOST } from '../src/render/sparkle_sprite';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  REALM_RACERS_CIRCUIT_LIST,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import {
  REALM_RACERS_PICKUP_BOX_HALF,
  realmRacersPickupBoxes,
} from '../src/sim/realm_racers_pickups';
import {
  realmRacersPlacedPonds,
  realmRacersPlacedProps,
} from '../src/sim/realm_racers_props_resolve';
import { REALM_RACERS_SLICK_CAP } from '../src/sim/realm_racers_slicks';
import { rallyGardenEdgeOffsetAt, realmRacersTrack } from '../src/sim/realm_racers_spline';
import type { RealmRacersMatchInfo, RealmRacersSlickInfo } from '../src/world_api/realm_racers';

// The circuit builder mints procedural canvas textures, so it needs the same
// texture stub the other headless render suites use (terrain_chunk_geometry).
function mockTextures(): void {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  vi.doMock('../src/render/textures', () => ({
    rallyKerbTexture: vi.fn(texture),
    rallyGroundBlastMarkerTexture: vi.fn(texture),
    rallyStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    // The lawn's grass card comes from foliage.ts, which mints its own tuft
    // texture out of this module.
    grassTuftTexture: vi.fn(texture),
    // The pickup boxes wear the world's own quest-object sparkle, which is a
    // canvas texture out of this module too.
    sparkleTexture: vi.fn(texture),
    // The circuit now dresses itself in the world's own ground material, so the
    // stub has to cover what THAT reads too.
    groundDetailTexture: vi.fn(texture),
    macroNoiseTexture: vi.fn(texture),
    groundSplatMaps: vi.fn(() => ({
      grass: { map: texture(), normalMap: texture() },
      dirt: { map: texture(), normalMap: texture() },
      rock: { map: texture(), normalMap: texture() },
      sand: { map: texture(), normalMap: texture() },
    })),
  }));
}

const track = realmRacersTrack(GARDEN_CIRCUIT);
/** The practice circuit's own basin, which every water case below reads. Its
 *  record carries one: the circuit is a lake circuit and stays one. */
const GARDEN_BASIN = GARDEN_CIRCUIT.basin;
if (!GARDEN_BASIN) throw new Error('the practice circuit authors a basin');

/** The theme both shipped circuits wear. Everything the build used to hardcode
 *  as the Evergarden's now comes from here. */
const GARDEN_THEME = CIRCUIT_THEMES.evergarden;

/** One racer row, shared by the start-light fixtures below. The light gantry
 *  reads the phase and the countdown, never the field, so one row is enough. */
const RALLY_ME = {
  pid: 1,
  name: 'Aster',
  cls: 'warrior',
  lap: 1,
  finished: false,
  botTier: null,
  position: 1,
  finishSeconds: null,
  retired: false,
} as const;

describe('Realm Racers procedural render', () => {
  beforeEach(() => {
    vi.resetModules();
    mockTextures();
  });
  afterEach(() => {
    vi.doUnmock('../src/render/textures');
  });

  it('stands the authored dressing where the resolver put it, in all three axes', async () => {
    // The fountain migrated off a bespoke `landmark` field onto the general
    // prop seam, and the two builders it now passes through take their
    // arguments in different orders: the garden's stonework is (x, z, y), the
    // placement seam is (x, y, z). Both compile, and only a position read off
    // the built scene can tell them apart. This is that read.
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const placed = realmRacersPlacedProps(GARDEN_CIRCUIT).find((prop) => prop.asset === 'fountain');
    if (!placed) throw new Error('the practice circuit dresses its infield with a fountain');
    const group = buildRealmRacersTrack(GARDEN_CIRCUIT).group;
    // The one scaled group in the build: every other piece is a mesh or an
    // instanced mesh, and the fountain is the only prop built as its own group.
    const fountain = group.children.find(
      (child): child is THREE.Group => child instanceof THREE.Group && child.scale.x !== 1,
    );
    if (!fountain) throw new Error('the fountain should be built as a scaled group');
    expect(fountain.position.x).toBeCloseTo(placed.x + REALM_RACERS_ORIGIN.x, 6);
    expect(fountain.position.z).toBeCloseTo(placed.z + REALM_RACERS_ORIGIN.z, 6);
    // Seated ON the lawn, not floating at the z it was handed by mistake.
    expect(fountain.position.y).toBeLessThan(0);
    expect(fountain.position.y).toBeGreaterThan(-1);
    expect(fountain.scale.x).toBeCloseTo(placed.scale, 6);
  });

  it('builds a hidden circuit once and gates it by local-player proximity', async () => {
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    expect(rally.group.name).toBe('realm-racers-track');
    expect(rally.group.visible).toBe(false);
    // Lawn, two runoff ribbons, the road, the kerb runs, the start band, the
    // water, the flowers and the fountain.
    expect(rally.group.children.length).toBeGreaterThan(14);

    rally.update(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z, 1, null);
    expect(rally.group.visible).toBe(true);
    rally.update(0, 0, 2, null);
    expect(rally.group.visible).toBe(false);
  });

  it('shows three red countdown lamps, turns them green at GO, then extinguishes them', async () => {
    expect(rallyStartLightPlacements(GARDEN_CIRCUIT)).toHaveLength(3);
    expect(realmRacersStartLightSignal('countdown', 61, 0)).toEqual({
      colour: 'off',
      litCount: 0,
    });
    expect(realmRacersStartLightSignal('countdown', 60, 0)).toEqual({
      colour: 'red',
      litCount: 1,
    });
    expect(realmRacersStartLightSignal('countdown', 40, 0)).toEqual({
      colour: 'red',
      litCount: 2,
    });
    expect(realmRacersStartLightSignal('countdown', 20, 0)).toEqual({
      colour: 'red',
      litCount: 3,
    });
    expect(realmRacersStartLightSignal('racing', 0, 0)).toEqual({
      colour: 'green',
      litCount: 3,
    });
    expect(realmRacersStartLightSignal('racing', 0, 1)).toEqual({
      colour: 'off',
      litCount: 0,
    });

    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    rally.update(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z, 1, {
      circuitId: GARDEN_CIRCUIT.id,
      id: 7,
      participantIds: [1, 2] as number[],
      phase: 'countdown',
      countdown: 1,
      countdownTicks: 20,
      elapsed: 0,
      elapsedTicks: 0,
      chaseIn: 0,
      returnIn: 0,
      me: RALLY_ME,
      standings: [RALLY_ME],
      gridSize: 4,
      decided: false,
      speed: 0,
      wrongWay: false,
      offTrackIn: 0,
      cutReturned: false,
      pickupsTaken: [],
      slicks: [],
      warded: false,
      resetLocked: false,
      totalLaps: 3,
      practice: false,
      result: null,
    });
    const fixture = rally.group.getObjectByName('realm-racers-start-lights') as THREE.Group;
    expect(fixture.children.filter((child) => child.name.match(/start-light-\d+$/))).toHaveLength(
      3,
    );
    const colours = (): number[] =>
      fixture.children
        .filter((child) => child.name.match(/start-light-\d+$/))
        .map((child) => ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).color.getHex());
    expect(colours()).toEqual([0xff3b1f, 0xff3b1f, 0xff3b1f]);

    rally.update(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z, 2, {
      ...({
        circuitId: GARDEN_CIRCUIT.id,
        id: 7,
        participantIds: [1, 2],
        phase: 'racing',
        countdown: 0,
        countdownTicks: 0,
        elapsed: 0,
        elapsedTicks: 0,
        chaseIn: 0,
        returnIn: 0,
        me: RALLY_ME,
        standings: [RALLY_ME],
        gridSize: 4,
        decided: false,
        speed: 0,
        wrongWay: false,
        offTrackIn: 0,
        cutReturned: false,
        pickupsTaken: [],
        slicks: [],
        warded: false,
        resetLocked: false,
        totalLaps: 3,
        practice: false,
        result: null,
      } as const),
    });
    expect(colours()).toEqual([0x45e06f, 0x45e06f, 0x45e06f]);

    const racing = {
      circuitId: GARDEN_CIRCUIT.id,
      id: 7,
      participantIds: [1, 2] as number[],
      phase: 'racing' as const,
      countdown: 0,
      countdownTicks: 0,
      elapsed: 1,
      elapsedTicks: 0,
      chaseIn: 0,
      returnIn: 0,
      me: RALLY_ME,
      standings: [RALLY_ME],
      gridSize: 4,
      decided: false,
      speed: 0,
      wrongWay: false,
      offTrackIn: 0,
      cutReturned: false,
      pickupsTaken: [],
      slicks: [],
      warded: false,
      resetLocked: false,
      totalLaps: 3,
      practice: false,
      result: null,
    };
    rally.update(REALM_RACERS_ORIGIN.x, REALM_RACERS_ORIGIN.z, 3, racing);
    expect(colours()).toEqual([0x241c12, 0x241c12, 0x241c12]);
  });

  it('dresses every ground surface in the world material, already world-placed', async () => {
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const ground = rally.group.children.filter(
      (child) => child instanceof THREE.Mesh && child.geometry.getAttribute('aSplat'),
    ) as THREE.Mesh[];
    // The lawn, the road, and a runoff strip each side.
    expect(ground.length).toBeGreaterThanOrEqual(4);
    for (const mesh of ground) {
      // instance_surface's contract: the shader takes the object normal as the
      // world normal, so a surface rotated at DRAW time would hand it a
      // sideways normal and light as a cliff face.
      expect(mesh.rotation.x).toBe(0);
      expect(mesh.rotation.y).toBe(0);
      expect(mesh.rotation.z).toBe(0);
      expect(mesh.position.lengthSq()).toBe(0);
      const normal = mesh.geometry.getAttribute('normal');
      expect(normal.getY(0)).toBeCloseTo(1, 6);
      // Placed in WORLD coordinates, out in the instance band.
      const position = mesh.geometry.getAttribute('position');
      expect(position.getX(0)).toBeGreaterThan(REALM_RACERS_ORIGIN.x - 1000);
      // ...and carrying the extras explicitly, since an absent aExtra reads to
      // WebGL as (0, 0, 0, 1), which the material paints as an impact crater.
      const extra = mesh.geometry.getAttribute('aExtra');
      expect(extra).toBeDefined();
      expect(extra.getW(0)).toBe(0);
      expect(mesh.geometry.getAttribute('color')).toBeDefined();
    }
    // One material for all of them: the layer is per-vertex, not per-material.
    expect(new Set(ground.map((mesh) => mesh.material)).size).toBe(1);
  });

  it('meets road and lawn on a ramp, and never on a pure layer', async () => {
    // The world lays a road as 0.85 dirt over the biome grass and ramps that
    // share to zero across the next yards (terrain_chunk_build's roadDistance
    // pass). Two single-layer surfaces meeting on a geometric edge is what
    // made the circuit's verge read as a decal instead of as ground.
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const ground = rally.group.children.filter(
      (child) => child instanceof THREE.Mesh && child.geometry.getAttribute('aSplat'),
    ) as THREE.Mesh[];
    let ramped = 0;
    for (const mesh of ground) {
      const splat = mesh.geometry.getAttribute('aSplat');
      const grass: number[] = [];
      for (let i = 0; i < splat.count; i++) {
        expect(splat.getX(i) + splat.getY(i), 'grass + dirt').toBeCloseTo(1, 5);
        grass.push(splat.getX(i));
      }
      const min = Math.min(...grass);
      const max = Math.max(...grass);
      // The lawn is the one legitimately pure surface: it borders only the
      // runoff, which arrives at full grass to meet it.
      if (min === 1) continue;
      // Every OTHER surface keeps both layers alive, so no seam is a step
      // between a pure layer and a mix.
      expect(min, 'no pure-dirt ground surface').toBeGreaterThan(0);
      if (max > min) ramped++;
    }
    // The two runoff strips ramp; the road holds its constant mix.
    expect(ramped).toBe(2);
  });

  it('keeps the kerbs out of the ground material, so no ramp can touch them', async () => {
    // The red/white bands are their own textured strip laid over the seam.
    // They read no splat weight at all, which is what makes the verge ramp
    // safe to tune: it cannot bleed into the one thing that must stay crisp.
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const { rallyKerbRuns } = await import('../src/render/realm_racers_track_core');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const meshes = rally.group.children.filter(
      (child) => child instanceof THREE.Mesh,
    ) as THREE.Mesh[];
    const ground = meshes.filter((mesh) => mesh.geometry.getAttribute('aSplat'));
    const groundMaterial = ground[0].material;
    // The lawn, the road and one runoff strip each side: the ground material
    // is on those four and nothing else, which is the decisive half. Counting
    // only the meshes that LACK aSplat would pass even if a kerb had joined
    // the material, because that kerb would leave the set being checked.
    expect(ground).toHaveLength(4);
    expect(meshes.filter((mesh) => mesh.material === groundMaterial)).toHaveLength(4);
    // Kerbs are identified positively: one shared material, two strips per
    // painted corner run, so a kerb that changed material fails here too.
    const kerbs = meshes.filter(
      (mesh) => mesh.material !== groundMaterial && !mesh.geometry.getAttribute('aSplat'),
    );
    const kerbMaterials = new Set(kerbs.map((mesh) => mesh.material));
    const expectedKerbs = rallyKerbRuns(GARDEN_CIRCUIT).length * 2;
    const kerbMaterial = [...kerbMaterials].find(
      (material) => kerbs.filter((mesh) => mesh.material === material).length === expectedKerbs,
    );
    expect(kerbMaterial, 'the shared kerb material').toBeDefined();
    for (const kerb of kerbs.filter((mesh) => mesh.material === kerbMaterial)) {
      expect(kerb.geometry.getAttribute('aSplat')).toBeUndefined();
      expect(kerb.geometry.getAttribute('aTerrainPresenceMask')).toBeUndefined();
    }
  });

  it('builds no flat surface face-down', async () => {
    // Half the circuit's swept surfaces were mirrored, which reverses their
    // triangle winding, and every material here is FrontSide: the right-hand
    // runoff strip and every kerb on that side were built and then culled away.
    // Nobody saw it because the runoff hid behind the lawn (same grass), and a
    // missing kerb only reads as a circuit with one painted edge.
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const worldNormal = new THREE.Vector3();
    let flatSurfaces = 0;
    for (const child of rally.group.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) continue;
      const normal = mesh.geometry?.getAttribute?.('normal');
      if (!normal) continue;
      worldNormal
        .set(normal.getX(0), normal.getY(0), normal.getZ(0))
        .applyQuaternion(mesh.quaternion);
      if (Math.abs(worldNormal.y) < 0.9) continue; // a card or a wall, not ground
      flatSurfaces++;
      expect(worldNormal.y).toBeGreaterThan(0);
    }
    // Lawn, road, two runoffs, the start band, the water, and the kerb runs.
    expect(flatSurfaces).toBeGreaterThan(10);
  });

  it('mints its plain-mesh geometry per build and BORROWS every instanced one', async () => {
    // The premise `realm_racers_track_dispose_core.ts` rests on, proven against
    // the real builder rather than assumed: it frees a plain mesh's geometry
    // (minted here) and never an InstancedMesh's (owned by a shared cache), so
    // a preview rebuild or a re-registered draft would otherwise either leak or
    // take the authored circuits down with it.
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    // RECURSIVE, because the builder composes sub-groups now (the pickup boxes
    // hang under one of their own): a `children`-only walk would have quietly
    // stopped covering every mesh added after the first nested group arrived,
    // and this premise has to hold for the whole tree the dispose core traverses.
    const geometriesOf = (group: THREE.Object3D, instanced: boolean): THREE.BufferGeometry[] => {
      const out: THREE.BufferGeometry[] = [];
      group.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (child instanceof THREE.InstancedMesh !== instanced) return;
        out.push(child.geometry);
      });
      return out;
    };

    const first = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const second = buildRealmRacersTrack(GARDEN_CIRCUIT);

    const instancedA = geometriesOf(first.group, true);
    const instancedB = geometriesOf(second.group, true);
    expect(instancedA.length).toBeGreaterThan(0);
    expect(instancedB).toHaveLength(instancedA.length);
    // Referentially identical, every one: the flower card and the statue used
    // to be minted per build, which is the leak this pins shut.
    for (let i = 0; i < instancedA.length; i++) {
      expect(instancedA[i], `instanced geometry ${i}`).toBe(instancedB[i]);
    }

    const plainA = geometriesOf(first.group, false);
    const plainB = geometriesOf(second.group, false);
    expect(plainA.length).toBeGreaterThan(0);
    expect(plainB).toHaveLength(plainA.length);
    // And every plain one is fresh, which is what makes disposing it correct.
    const owned = new Set<THREE.BufferGeometry>(plainA);
    for (const geometry of plainB) expect(owned.has(geometry)).toBe(false);
  });

  it('sweeps the road as one continuous ribbon over every centerline sample', async () => {
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const rally = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const sections = track.samples.length + 1;
    const road = rally.group.children.find(
      (child) =>
        child instanceof THREE.Mesh &&
        child.geometry.getAttribute('position')?.count === sections * 2,
    );
    // A per-segment box road (what shipped) could never produce one ribbon with
    // exactly two vertices per sample.
    expect(road).toBeDefined();
  });

  it('paints kerbs on the corners and leaves the straights bare', async () => {
    const count = track.samples.length;
    const runs = rallyKerbRuns(GARDEN_CIRCUIT);
    const kerbed = (index: number): boolean =>
      runs.some((run) => {
        for (let i = run.from; i < run.to; i++) if (i % count === index) return true;
        return false;
      });
    expect(runs.length).toBeGreaterThan(3);
    for (const run of runs) expect(run.to).toBeGreaterThan(run.from);

    // The decisive claim, not the totals: the tightest corner is painted and the
    // start/finish straight is not.
    const hairpin = track.samples.indexOf(
      track.samples.reduce((best, sample) => (sample.x < best.x ? sample : best)),
    );
    expect(kerbed(hairpin)).toBe(true);
    expect(kerbed(0)).toBe(false);
    expect(kerbed(20)).toBe(false);

    // ...and a sanity band, so "kerb everything" and "kerb nothing" both fail.
    const total = runs.reduce((sum, run) => sum + (run.to - run.from), 0);
    expect(total).toBeGreaterThan(count * 0.25);
    expect(total).toBeLessThan(count * 0.7);
  });

  it('turns the start arch across the road, not along it', () => {
    // The two yaws are a quarter turn apart and trivially swapped by eye, which
    // is exactly how the arch first shipped straddling the racing line instead
    // of framing it. Pinned by what each yaw DOES to the model's own axes
    // rather than by its number.
    const place = rallyStartArchPlacement(GARDEN_CIRCUIT);
    const line = track.pointAt(0);
    // A three.js yaw maps local +z to (sin, cos).
    const archAxisX = Math.sin(place.yaw);
    const archAxisZ = Math.cos(place.yaw);
    // course_arch's long axis is z, so it must lie ACROSS the road: no
    // component along the racing direction.
    expect(archAxisX * line.tx + archAxisZ * line.tz).toBeCloseTo(0, 6);
    expect(Math.abs(archAxisX * -line.tz + archAxisZ * line.tx)).toBeCloseTo(1, 6);
    // The span reaches past both road edges...
    expect(place.span).toBeGreaterThan(line.halfWidth * 2);
    expect(Math.hypot(place.normalX, place.normalZ)).toBeCloseTo(1, 6);
    expect(place.normalX * line.tx + place.normalZ * line.tz).toBeCloseTo(0, 6);
    // ...and ONLY that axis is stretched to reach. Scaling uniformly to span 18
    // yards of road left the posts nearly ten yards deep under a height cap
    // that kept the gate squat; upright stays at the capped scale.
    expect(place.spanScale).toBeGreaterThan(place.uprightScale);
    expect(place.postHalfDepth).toBeLessThan(place.span / 8);
  });

  it('hangs each banner on its post, facing an arriving racer', () => {
    // The banner is a ONE-SIDED cloth (no doubleSided flag; mean vertex normal
    // +0.78 along its own z), so an orientation error does not look wrong, it
    // renders NOTHING from the approach while still showing from behind. That
    // is precisely how it shipped, and it is why this is asserted rather than
    // eyeballed.
    const place = rallyStartArchPlacement(GARDEN_CIRCUIT);
    const line = track.pointAt(0);
    expect(place.banners).toHaveLength(2);
    const laterals: number[] = [];
    for (const banner of place.banners) {
      // The cloth's own +z, which a yaw maps to (sin, cos), must point back UP
      // the road: fully opposed to the racing direction, not merely off it.
      const faceX = Math.sin(banner.yaw);
      const faceZ = Math.cos(banner.yaw);
      expect(faceX * line.tx + faceZ * line.tz).toBeCloseTo(-1, 6);

      // On the post, not adrift: centred on it across the road, and backed up
      // the road by just enough to clear the leg's own depth.
      const dx = banner.x - line.x;
      const dz = banner.z - line.z;
      const lateral = dx * place.normalX + dz * place.normalZ;
      const along = dx * line.tx + dz * line.tz;
      expect(Math.abs(lateral)).toBeCloseTo(place.span / 2, 6);
      expect(-along).toBeGreaterThan(0);
      expect(-along).toBeLessThan(place.postHalfDepth + 1);
      // Clear of the racing surface on both counts.
      expect(Math.abs(lateral)).toBeGreaterThan(line.halfWidth);
      expect(banner.lift).toBeGreaterThan(2);
      laterals.push(lateral);
    }
    // One post each, not both on the same one.
    expect(Math.sign(laterals[0])).toBe(-Math.sign(laterals[1]));
  });

  it('gives the water real depth to shade, not a rim of zeroes', () => {
    // A triangulated outline polygon puts EVERY vertex on the edge, so the
    // per-vertex shore depth the water shader reads would be zero everywhere:
    // the whole pond would render as the shallowest possible water with the
    // foam band covering all of it. Rings put vertices where the depth is.
    const meshes = rallyPondMeshes(GARDEN_CIRCUIT);
    // Two placed pools, so two water surfaces.
    expect(meshes).toHaveLength(2);
    for (const mesh of meshes) {
      const count = mesh.depths.length;
      expect(count).toBe(mesh.columns * (mesh.rings + 1) + 1);
      // The outline ring reads exactly 0...
      for (let col = 0; col < mesh.columns; col++) expect(mesh.depths[col]).toBe(0);
      // ...and the middle is at the basin floor, which is the whole point.
      expect(mesh.depths[count - 1]).toBeCloseTo(GARDEN_BASIN.depthMax, 6);
      // The rings crowd the edge, because everything the shader varies (the
      // ramp to the basin floor, the surf band) is within a few yards of the
      // waterline. Evenly spaced rings across a pool this wide put the first
      // one past all of it, and the bank renders as one hard step.
      const firstRing = mesh.depths.slice(mesh.columns, mesh.columns * 2);
      expect(Math.max(...firstRing)).toBeLessThan(GARDEN_BASIN.depthMax);
      // ...and it really is a ramp: shallow, mid and floor all present.
      const all: number[] = Array.from(mesh.depths);
      expect(all.some((d) => d > 0 && d < 1)).toBe(true);
      expect(all.some((d) => d >= 1 && d < GARDEN_BASIN.depthMax)).toBe(true);
      expect(all.some((d) => d >= GARDEN_BASIN.depthMax - 1e-6)).toBe(true);
      // Every depth is the authored ramp read at that vertex's own distance in
      // from the outline, to the authored floor. It is the ONE thing a placed
      // pond can answer about its depth: the road's bank profile is an offset
      // of the centerline and says nothing about a pool fifty yards away.
      for (const depth of all) {
        expect(depth).toBeGreaterThanOrEqual(0);
        expect(depth).toBeLessThanOrEqual(GARDEN_BASIN.depthMax);
      }
      // Every triangle is a real one: a ring that folded through itself would
      // still index cleanly and render as a crumpled sheet.
      expect(mesh.index.length % 3).toBe(0);
      expect(new Set(mesh.index).size).toBe(count);
    }
  });

  it('plants the shore and sows both road edges, building neither', () => {
    const edge = (x: number, z: number): number => {
      const projection = track.project(x, z);
      return Math.abs(projection.lateral) - track.halfWidthAt(projection.s);
    };
    // The water's edge is planted, not kerbed. It carried a ring of stone that
    // was also the circuit's inner collision, and from the circuit that read as
    // blocks standing in the lake.
    const reeds = rallyPondReedSpots(GARDEN_CIRCUIT);
    expect(reeds.length).toBeGreaterThan(20);
    const rims = realmRacersPlacedPonds(GARDEN_CIRCUIT);
    for (const spot of reeds) {
      // On a pond's own rim: every clump sits on an outline point, which is
      // what makes it a waterline rather than decoration near some water.
      const local = { x: spot.x - REALM_RACERS_ORIGIN.x, z: spot.z - REALM_RACERS_ORIGIN.z };
      const onRim = rims.some((pond) =>
        pond.outline.some((point) => Math.hypot(point.x - local.x, point.z - local.z) < 1e-6),
      );
      expect(onRim).toBe(true);
    }

    // The road edge is sown, not built: flowers on BOTH sides, on the boundary
    // between the two off-track bands.
    const flowers = rallyBorderFlowerSpots(GARDEN_CIRCUIT);
    expect(flowers.length).toBeGreaterThan(400);
    for (const spot of flowers) {
      const over = edge(spot.x, spot.z);
      expect(over).toBeGreaterThan(REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH);
      expect(over).toBeLessThan(REALM_RACERS_VERGE_MARGIN + REALM_RACERS_RUNOFF_WIDTH + 3);
    }
    const flowerSides = new Set(
      flowers.map((spot) => Math.sign(track.project(spot.x, spot.z).lateral)),
    );
    expect(flowerSides).toEqual(new Set([1, -1]));
  });

  it('sows flower beds in the outer garden only, in single-colour patches', () => {
    const spots = rallyFlowerSpots(GARDEN_CIRCUIT);
    expect(spots.length).toBeGreaterThan(400);
    for (const spot of spots) {
      const projection = track.project(spot.x, spot.z);
      // Every drivable band a racer uses stays clear: the apron is the whole
      // infield side, so nothing is sown there at all, and outward the beds
      // start past the border line. Keeping them merely off the ROAD, which is
      // what shipped, left strays over both the verge and the apron.
      expect(projection.lateral).toBeLessThan(0);
      expect(-projection.lateral).toBeGreaterThan(
        rallyGardenEdgeOffsetAt(GARDEN_CIRCUIT, projection.s),
      );
      expect(spot.colour).toBeGreaterThanOrEqual(0);
      expect(spot.colour).toBeLessThan(GARDEN_THEME.flowers.colours.length);
    }
    // Patches, not confetti: neighbours within a patch share their colour, so
    // the palette is used far fewer times than there are flowers.
    const runs = spots.reduce(
      (count, spot, i) => (i > 0 && spots[i - 1].colour === spot.colour ? count : count + 1),
      0,
    );
    expect(runs).toBeLessThan(spots.length / 4);
    expect(new Set(spots.map((spot) => spot.colour)).size).toBeGreaterThan(1);

    // The tier knob only ever thins the same patches (cosmetic, never a reshuffle).
    const thin = rallyFlowerSpots(GARDEN_CIRCUIT, 0.45);
    expect(thin.length).toBeLessThan(spots.length);
    const full = new Set(spots.map((spot) => `${spot.x.toFixed(4)},${spot.z.toFixed(4)}`));
    for (const spot of thin)
      expect(full.has(`${spot.x.toFixed(4)},${spot.z.toFixed(4)}`)).toBe(true);
  });

  describe('the ponds, placed', () => {
    /** The practice circuit's curve with ONE pool instead of its two, so a case
     *  can say what changes when a pond is added or taken away. */
    const ONE_POND: RealmRacersCircuit = {
      ...GARDEN_CIRCUIT,
      id: 'render_one_pond',
      ponds: [{ x: -4, z: 4, rx: 22, rz: 13, wobble: 0.2, seed: 1 }],
    };

    /** The same curve with no water authored at all. */
    const DRY: RealmRacersCircuit = {
      ...GARDEN_CIRCUIT,
      id: 'render_water_dry',
      ponds: undefined,
      basin: undefined,
    };

    /** The water sheets of a build. The shore-depth attribute is the one thing
     *  only the water writes, so counting them counts the pools. */
    const waterMeshes = (group: THREE.Group): THREE.Mesh[] =>
      group.children.filter(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.geometry.getAttribute('aShoreDepth') !== undefined,
      );

    /** The lawn: the ground surface that covers the whole region, so the widest
     *  of them. Identified by extent rather than by child order, which the
     *  builder is free to change. */
    const lawnMesh = (group: THREE.Group): THREE.Mesh => {
      const ground = group.children.filter(
        (child): child is THREE.Mesh =>
          child instanceof THREE.Mesh && child.geometry.getAttribute('aSplat') !== undefined,
      );
      let widest = ground[0];
      for (const mesh of ground) {
        mesh.geometry.computeBoundingBox();
        widest.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        const best = widest.geometry.boundingBox;
        if (box && best && box.max.x - box.min.x > best.max.x - best.min.x) widest = mesh;
      }
      if (!widest) throw new Error('the build has no ground surface');
      return widest;
    };

    /** Even-odd ray cast, the same rule a ShapeGeometry hole is punched by. */
    const pointInPolygon = (
      x: number,
      z: number,
      polygon: readonly (readonly [number, number])[],
    ): boolean => {
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, zi] = polygon[i];
        const [xj, zj] = polygon[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };

    /** A circuit's pond outlines in WORLD coordinates, which is the frame the
     *  lawn and the water meshes are built in. */
    const worldOutlines = (circuit: RealmRacersCircuit) =>
      realmRacersPlacedPonds(circuit).map((pond) =>
        pond.outline.map(
          (point) => [point.x + REALM_RACERS_ORIGIN.x, point.z + REALM_RACERS_ORIGIN.z] as const,
        ),
      );

    it('plants every rim and leaves a circuit with no water bare', () => {
      // Reeds mark a waterline, so they exist per pond and nowhere else.
      expect(rallyPondReedSpots(DRY)).toEqual([]);
      expect(rallyPondReedSpots(ONE_POND).length).toBeGreaterThan(10);
      expect(rallyPondReedSpots(GARDEN_CIRCUIT).length).toBeGreaterThan(
        rallyPondReedSpots(ONE_POND).length,
      );
      // Each pool still has real depth to shade rather than a rim of zeroes.
      const meshes = rallyPondMeshes(GARDEN_CIRCUIT);
      expect(meshes).toHaveLength(2);
      for (const mesh of meshes) {
        expect(mesh.columns).toBeGreaterThan(8);
        expect(Math.max(...Array.from(mesh.depths))).toBeGreaterThan(1);
      }
    });

    it('builds one water surface per pond, and none on a circuit with no water', async () => {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      expect(waterMeshes(buildRealmRacersTrack(DRY).group)).toHaveLength(0);
      expect(waterMeshes(buildRealmRacersTrack(ONE_POND).group)).toHaveLength(1);
      expect(waterMeshes(buildRealmRacersTrack(GARDEN_CIRCUIT).group)).toHaveLength(2);
      // ONE material across a build's pools, never one per pool: it is a
      // ShaderMaterial with its own compiled program, and the two callers that
      // rebuild a circuit over and over are exactly the ones a per-pool
      // material multiplies against (see realm_racers_track_dispose_core).
      const pools = waterMeshes(buildRealmRacersTrack(GARDEN_CIRCUIT).group);
      expect(new Set(pools.map((mesh) => mesh.material)).size).toBe(1);
    });

    it('punches the lawn open under every pond, and nowhere else', async () => {
      // The hole is what makes the water read as a sunken basin instead of a
      // sheet laid on the grass, and nothing else in this suite can see it:
      // counting water meshes passes just as well with one hole, or none.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      // Earcut triangulates a polygon of n vertices with h holes into
      // n + 2h - 2 triangles, the two bridge vertices per hole included. So the
      // lawn's own index count states BOTH how many holes it carries and how
      // many points each one has: neither can move without this moving.
      for (const circuit of [DRY, ONE_POND, GARDEN_CIRCUIT]) {
        const outlines = worldOutlines(circuit);
        const corners = 4;
        const points = outlines.reduce((sum, outline) => sum + outline.length, corners);
        const geo = lawnMesh(buildRealmRacersTrack(circuit).group).geometry;
        expect(geo.getIndex()?.count, `${circuit.id} lawn triangles`).toBe(
          3 * (points + 2 * outlines.length - 2),
        );
      }
      // ...and the three cases really are none, one and two holes, so the
      // identity above is not being satisfied three times by the same shape.
      expect(worldOutlines(DRY)).toHaveLength(0);
      expect(worldOutlines(ONE_POND)).toHaveLength(1);
      expect(worldOutlines(GARDEN_CIRCUIT)).toHaveLength(2);

      // ...and the holes are in the right PLACES: no lawn triangle survives
      // inside a pond outline. A hole punched with the wrong polygon would
      // still change the count.
      for (const circuit of [ONE_POND, GARDEN_CIRCUIT]) {
        const outlines = worldOutlines(circuit);
        const geo = lawnMesh(buildRealmRacersTrack(circuit).group).geometry;
        const position = geo.getAttribute('position');
        const index = geo.getIndex();
        if (!index) throw new Error('the lawn is an indexed ShapeGeometry');
        let over = 0;
        for (let t = 0; t < index.count; t += 3) {
          let cx = 0;
          let cz = 0;
          for (let k = 0; k < 3; k++) {
            cx += position.getX(index.getX(t + k)) / 3;
            cz += position.getZ(index.getX(t + k)) / 3;
          }
          if (outlines.some((outline) => pointInPolygon(cx, cz, outline))) over++;
        }
        expect(over, `${circuit.id} lawn triangles over water`).toBe(0);
      }
    });

    it('sinks the water below the lawn, which is what masks the shore seam', async () => {
      // The pools are triangulated rings, so a ring edge can sit a hair outside
      // the hole it fills. That is invisible only while the water sheet is
      // BELOW the lawn: level with it, every ring would show a lip of surface
      // lying on the grass. Both heights read off the real build rather than
      // off a copy of the builder's constants.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      for (const circuit of [GARDEN_CIRCUIT, ONE_POND]) {
        const group = buildRealmRacersTrack(circuit).group;
        const lawnY = lawnMesh(group).geometry.getAttribute('position').getY(0);
        const pools = waterMeshes(group);
        expect(pools.length).toBeGreaterThan(0);
        for (const pool of pools) {
          expect(pool.position.y, `${circuit.id} water under lawn`).toBeLessThan(lawnY);
        }
      }
    });

    it('never builds a degenerate ring out of the smallest pond authorable', () => {
      // The record's validator takes a radius down to half a yard, which is a
      // puddle: it still has to reach the mesh builder as a ring rather than as
      // a shard that indexes cleanly and renders as one.
      const puddle: RealmRacersCircuit = {
        ...ONE_POND,
        id: 'render_pond_puddle',
        ponds: [{ x: -4, z: 4, rx: 0.5, rz: 0.5, seed: 3 }],
      };
      const built = rallyPondMeshes(puddle);
      expect(built).toHaveLength(1);
      expect(built[0].columns).toBeGreaterThanOrEqual(3);
      expect(built[0].depths.length).toBe(built[0].columns * (built[0].rings + 1) + 1);
    });

    it('mints its water per build on a circuit with TWO pools', async () => {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const first = buildRealmRacersTrack(GARDEN_CIRCUIT);
      const second = buildRealmRacersTrack(GARDEN_CIRCUIT);
      const waterA = waterMeshes(first.group).map((mesh) => mesh.geometry);
      const waterB = waterMeshes(second.group).map((mesh) => mesh.geometry);
      expect(waterA).toHaveLength(2);
      // Every pool's sheet is FRESH, which is what makes disposing it correct.
      const owned = new Set(waterA);
      for (const geometry of waterB) expect(owned.has(geometry)).toBe(false);
      // ...and every instanced geometry is still BORROWED.
      const instancedOf = (group: THREE.Group): THREE.BufferGeometry[] =>
        group.children
          .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
          .map((mesh) => mesh.geometry);
      const instancedA = instancedOf(first.group);
      expect(instancedA.length).toBeGreaterThan(0);
      instancedOf(second.group).forEach((geometry, i) => {
        expect(geometry, `instanced geometry ${i}`).toBe(instancedA[i]);
      });
    });
  });

  describe('the Evergarden theme reproduces the pre-theme build', () => {
    // Pinned against the theme by NAME rather than against whatever the record
    // carries: `theme` is the field an operator flips to look at another skin
    // in game, and these literals are about the Evergarden's output.
    const GARDEN_THEMED: RealmRacersCircuit = { ...GARDEN_CIRCUIT, theme: 'evergarden' };
    // Every value below was read off the build BEFORE the visuals moved onto a
    // theme record, and pasted here unrounded. That is the whole point: the
    // extraction's promise is that a themed Evergarden circuit is the SAME
    // circuit, and only a literal captured on the far side of the change can
    // say so. Re-deriving any of it from today's records would pass by
    // construction.

    it('cuts the perimeter into the same panels', () => {
      // The panel run is the theme's now, and it decides how many pieces a
      // face is cut into: a wall module measured at one scale and drawn at
      // another leaves gaps, and the count is what says it did not happen.
      const pieces = rallyPerimeterPieces(GARDEN_THEMED);
      expect(pieces).toHaveLength(244);
      expect(pieces[0]).toEqual({ x: 113582, z: -92, yaw: -0, pillar: true });
      expect(pieces[1]).toEqual({ x: 113583.76119402985, z: -92, yaw: -0, pillar: false });
      expect(GARDEN_THEME.perimeter.scale).toBe(1);
    });

    it('keeps the kit, the palette and the ground the garden had', () => {
      // Not a restatement of the record: these are the ids and colours the
      // build carried as its own constants, so a theme edit that quietly
      // repoints the shipped circuit at another kit fails here.
      expect(GARDEN_THEME.ground).toBe('garden');
      expect(GARDEN_THEME.perimeter.fenceUrl).toBe('/models/props/garden_iron_fence.glb');
      expect(GARDEN_THEME.perimeter.pillarUrl).toBe('/models/props/garden_iron_pillar.glb');
      expect(GARDEN_THEME.startFixture.archUrl).toBe('/models/props/course_arch.glb');
      expect(GARDEN_THEME.startFixture.bannerUrl).toBe('/models/dungeon/banner_patterna_white.glb');
      expect(GARDEN_THEME.reedUrl).toBe('/models/props/reeds.glb');
      expect(GARDEN_THEME.kerb).toEqual({ base: 0xe8e2d4, stripe: 0xb8402f });
      expect(GARDEN_THEME.startGrid).toEqual({ light: 0xf2efe6, dark: 0x22201d });
      expect(GARDEN_THEME.flowers.colours).toEqual([
        0xf6f2ea, 0xf4b8cf, 0xf6dd7a, 0xc9b4e8, 0xf3a973,
      ]);
      expect(GARDEN_THEME.flowers.card).toEqual([{ p: [244, 242, 240], c: [252, 226, 140] }]);
      // The shipped pools are the world's own water: the ramp only moves for a
      // theme that asks, and this one does not.
      expect(GARDEN_THEME.water).toBeUndefined();
    });

    it('sows the same border, in the same colours', () => {
      const flowers = rallyBorderFlowerSpots(GARDEN_THEMED);
      expect(flowers).toHaveLength(790);
      expect(flowers[0]).toEqual({
        x: 113697.9808449484,
        z: -37.646071074350836,
        rot: 5.16329402634403,
        scale: 1.1108818834647536,
        // The palette's LENGTH decides this index, so a theme that adds or
        // drops a colour re-sows the whole border.
        colour: 1,
      });
    });
  });

  it('runs the perimeter around the garden wall', () => {
    const pieces = rallyPerimeterPieces(GARDEN_CIRCUIT);
    expect(pieces.length).toBeGreaterThan(50);
    expect(pieces.filter((piece) => piece.pillar)).toHaveLength(4);
    for (const piece of pieces) {
      const onX =
        Math.abs(Math.abs(piece.x - REALM_RACERS_ORIGIN.x) - GARDEN_CIRCUIT.perimeter.halfX) < 1e-6;
      const onZ =
        Math.abs(Math.abs(piece.z - REALM_RACERS_ORIGIN.z) - GARDEN_CIRCUIT.perimeter.halfZ) < 1e-6;
      expect(onX || onZ).toBe(true);
    }
  });

  describe('the Ground Blast visuals', () => {
    async function groundBlastVisuals() {
      const { RealmRacersGroundBlastVisuals } = await import(
        '../src/render/realm_racers_ground_blast'
      );
      return new RealmRacersGroundBlastVisuals();
    }

    /** Addressed by NAME, never by child order: the visual pass reshuffles the
     *  order every time it adds a layer, and a positional read would either
     *  break or, worse, quietly assert about the wrong mesh. */
    function part(blasts: { group: THREE.Object3D }, name: string): THREE.Object3D {
      const found = blasts.group.getObjectByName(name);
      if (!found) throw new Error(`no ${name} in the blast pool`);
      return found;
    }

    it('arcs from the barrel and meets the marked point at exactly the flight time', async () => {
      const blasts = await groundBlastVisuals();
      blasts.fire(10, 20, 10, 50, 0.6, 0);
      const projectile = part(blasts, 'groundBlast0');
      expect(projectile.position.z).toBeCloseTo(20, 6);
      blasts.update(0.3);
      // Halfway: halfway across, and off the ground (the whole point of an arc
      // a player can watch rather than a bolt that vanishes).
      expect(projectile.position.z).toBeCloseTo(35, 6);
      expect(projectile.position.y).toBeGreaterThan(2);
      blasts.update(0.3);
      expect(projectile.position.z).toBeCloseTo(50, 6);
      expect(projectile.position.y).toBeCloseTo(0, 6);
      expect(part(blasts, 'core0').scale.x).toBeLessThan(0.2);
    });

    it('marks the impact point for the whole flight and retires it on impact', async () => {
      const blasts = await groundBlastVisuals();
      blasts.fire(10, 20, 10, 50, 0.5, 0);
      const marker = part(blasts, 'marker0');
      const core = part(blasts, 'core0');
      const column = part(blasts, 'column0');
      expect([marker.position.x, marker.position.z]).toEqual([10, 50]);
      expect([column.position.x, column.position.z]).toEqual([10, 50]);
      for (let step = 0; step < 4; step++) {
        expect(marker.visible, `step ${step}`).toBe(true);
        expect(core.visible, `step ${step}`).toBe(true);
        expect(column.visible, `step ${step}`).toBe(true);
        blasts.update(0.1);
      }
      expect(blasts.inFlight).toBe(1);
      blasts.update(0.1);
      expect(blasts.inFlight).toBe(0);
      expect(marker.visible).toBe(false);
      expect(core.visible).toBe(false);
      expect(column.visible).toBe(false);
    });

    it('never resizes the hazard disc, only the countdown inside it', async () => {
      // Gameplay-neutral: the disc IS the blast the player reacts to, so its
      // size is fixed for the whole flight and identical on every preset. Only
      // the fill inside it and its colour carry the countdown.
      const blasts = await groundBlastVisuals();
      blasts.fire(0, 0, 0, 30, 0.5, 0);
      const marker = part(blasts, 'marker0') as THREE.Mesh;
      const core = part(blasts, 'core0');
      const opening = core.scale.x;
      const startColor = (marker.material as THREE.MeshBasicMaterial).color.getHex();
      for (let step = 0; step < 4; step++) {
        expect(marker.scale.x, `step ${step}`).toBe(1);
        expect(marker.scale.y, `step ${step}`).toBe(1);
        blasts.update(0.1);
      }
      expect(core.scale.x).toBeLessThan(opening);
      expect((marker.material as THREE.MeshBasicMaterial).color.getHex()).not.toBe(startColor);
    });

    it('cannot read a graphics tier or the frame governor at all', async () => {
      // The marker is actionable information: under the gameplay-neutral
      // invariant no preset may hide, shrink or delay it, and the cheapest way
      // to guarantee that is for this module to have no WAY of knowing the tier.
      // Checked on the imports rather than on the source text, so the reasoning
      // above can say the words without failing the guard that enforces it.
      const src = readFileSync(
        new URL('../src/render/realm_racers_ground_blast.ts', import.meta.url),
        'utf8',
      );
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
      expect(imports).toEqual(['../sim/realm_racers_ground_blast', './textures', 'three']);
    });

    it('pools its meshes rather than growing one set per shot', async () => {
      const blasts = await groundBlastVisuals();
      const cycle = () => {
        blasts.fire(0, 0, 0, 20, 0.5, 0);
        blasts.impact(0, 20, 0);
        blasts.update(0.6);
      };
      // The pool fills lazily, so let it saturate first, then keep firing.
      for (let shot = 0; shot < 12; shot++) cycle();
      const pooled = blasts.group.children.length;
      for (let shot = 0; shot < 60; shot++) cycle();
      expect(blasts.inFlight).toBe(0);
      // Saturated and reused from there: sixty more shots add nothing.
      expect(blasts.group.children.length).toBe(pooled);
      expect(pooled).toBeLessThanOrEqual(48);
    });
  });
});

describe('race furniture is never tiered', () => {
  it('names no graphics tier, governor or distance cull in the pickup or oil modules', () => {
    // The fairness half of the graphics-neutrality invariant, as a source scan
    // rather than a promise: a pickup box and a patch of oil are both things a
    // pilot STEERS around, so no preset, no FPS governor and no distance cull
    // may decide whether one is drawn. (The marker module next door is pinned by
    // its import list for the same reason; these two import nothing that could
    // reach a tier at all, so the token scan is the honest test for them.)
    const files = [
      'src/render/realm_racers_pickups.ts',
      'src/render/realm_racers_pickups_core.ts',
      'src/render/realm_racers_slicks.ts',
      'src/render/realm_racers_slicks_core.ts',
    ];
    const FORBIDDEN = [
      /\bfxTier\b/,
      /\bgetFxTier\b/,
      /\bgovernor\b/i,
      /\bdata-fx-level\b/,
      /\buiEffectsProfile\b/,
      /\bqualityTier\b/,
      /\bdrawDistance\b/,
      /\blodBias\b/,
    ];
    for (const file of files) {
      // COMMENTS STRIPPED FIRST, which is the trap the Ground Blast marker's
      // own fairness pin hit and answered with an import list instead: these
      // modules' headers explain that they read no tier and no governor, and a
      // raw text scan cannot tell that sentence from a real read.
      const source = readFileSync(`${process.cwd()}/${file}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(source), `${file} names ${pattern}`).toBe(false);
      }
      // The scan is only worth anything over a file it really read.
      expect(source.length).toBeGreaterThan(500);
    }
  });
});

describe('the pickup boxes, drawn', () => {
  beforeEach(() => {
    vi.resetModules();
    mockTextures();
  });
  afterEach(() => {
    vi.doUnmock('../src/render/textures');
  });

  /** One match readout on a chosen circuit, holding a chosen taken set. */
  const matchOn = (circuitId: string, pickupsTaken: number[]): RealmRacersMatchInfo => ({
    circuitId,
    id: 7,
    participantIds: [1],
    phase: 'racing',
    countdown: 0,
    countdownTicks: 0,
    elapsed: 0,
    elapsedTicks: 0,
    chaseIn: 0,
    returnIn: 0,
    me: RALLY_ME,
    standings: [RALLY_ME],
    gridSize: 4,
    decided: false,
    speed: 0,
    wrongWay: false,
    offTrackIn: 0,
    cutReturned: false,
    pickupsTaken,
    slicks: [],
    warded: false,
    resetLocked: false,
    totalLaps: 3,
    practice: false,
    result: null,
  });

  async function pickupsGroup(): Promise<{
    view: {
      update(px: number, pz: number, time: number, match: RealmRacersMatchInfo | null): void;
    };
    /** One body per box: the crate plus its glint, animated as one object. */
    boxes: THREE.Object3D[];
  }> {
    const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
    const view = buildRealmRacersTrack(GARDEN_CIRCUIT);
    const group = view.group.getObjectByName('realm-racers-pickups') as THREE.Group;
    expect(group).toBeDefined();
    return { view, boxes: group.children };
  }

  /** Every mesh under one box's body, at whatever depth the crate nests them. */
  function drawnMeshes(body: THREE.Object3D): THREE.Mesh[] {
    const found: THREE.Mesh[] = [];
    body.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) found.push(object as THREE.Mesh);
    });
    return found;
  }

  it('stands one body on every box the sim resolved', async () => {
    const { boxes } = await pickupsGroup();
    const resolved = realmRacersPickupBoxes(GARDEN_CIRCUIT);
    expect(resolved.length).toBeGreaterThan(0);
    expect(boxes).toHaveLength(resolved.length);
    // At the resolver's own coordinates, so what a player drives at is what a
    // player sees: the builder authors this group in the same origin frame.
    boxes.forEach((mesh, i) => {
      expect(mesh.position.x).toBeCloseTo(resolved[i].x, 6);
      expect(mesh.position.z).toBeCloseTo(resolved[i].z, 6);
    });
  });

  it('pops a taken box out and leaves its neighbours standing', async () => {
    const { view, boxes } = await pickupsGroup();
    const here = REALM_RACERS_ORIGIN;
    view.update(here.x, here.z, 1, matchOn(GARDEN_CIRCUIT.id, []));
    expect(boxes[0].visible).toBe(true);

    // Past the whole pop, in FRAMES: a single long step would be clamped to one
    // frame's worth of animation, which is the point of the clamp (a tab that
    // was in the background must not fast-forward a pop into nothing).
    let time = 1;
    const frames = (count: number, taken: number[]): void => {
      for (let i = 0; i < count; i++) {
        time += 0.05;
        view.update(here.x, here.z, time, matchOn(GARDEN_CIRCUIT.id, taken));
      }
    };
    frames(10, [0]);
    expect(boxes[0].visible).toBe(false);
    expect(boxes[1].visible).toBe(true);

    // And it grows back when the readout says it is there again.
    frames(1, []);
    expect(boxes[0].visible).toBe(true);
    expect(boxes[0].scale.x).toBeLessThan(1);
    frames(12, []);
    expect(boxes[0].scale.x).toBeCloseTo(1, 6);
  });

  it('writes no scale on a frame where nothing about the boxes changed', async () => {
    const { view, boxes } = await pickupsGroup();
    const here = REALM_RACERS_ORIGIN;
    view.update(here.x, here.z, 1, matchOn(GARDEN_CIRCUIT.id, []));
    view.update(here.x, here.z, 1.05, matchOn(GARDEN_CIRCUIT.id, []));
    const spies = boxes.map((mesh) => vi.spyOn(mesh.scale, 'setScalar'));
    // A second identical frame: the clock moved (so the spin and the bob DO
    // write, by design) and nothing else did. Write elision is what keeps a
    // dozen resting boxes from re-stamping an identical scale forever.
    view.update(here.x, here.z, 1.1, matchOn(GARDEN_CIRCUIT.id, []));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    // The spin and the bob are the deliberate exception, and they really do run.
    const before = boxes[0].rotation.y;
    view.update(here.x, here.z, 1.15, matchOn(GARDEN_CIRCUIT.id, []));
    expect(boxes[0].rotation.y).not.toBe(before);
    for (const spy of spies) spy.mockRestore();
  });

  it('ignores a race running on a DIFFERENT circuit', async () => {
    const { view, boxes } = await pickupsGroup();
    const here = REALM_RACERS_ORIGIN;
    const other = REALM_RACERS_CIRCUIT_LIST.find((circuit) => circuit.id !== GARDEN_CIRCUIT.id);
    expect(other).toBeDefined();
    // Another lane's race says nothing about these boxes: its taken indices
    // belong to its own circuit's box list, so reading them here would loot a
    // circuit nobody is racing on.
    for (let i = 0; i < 12; i++) {
      view.update(
        here.x,
        here.z,
        1 + i * 0.05,
        matchOn((other as RealmRacersCircuit).id, [0, 1, 2, 3]),
      );
    }
    for (const mesh of boxes) expect(mesh.visible).toBe(true);
  });

  describe('and the crate they wear', () => {
    /** What `normalizeRoot` hands every ground quest object: scaled to the
     *  ground-object height and standing on y = 0. */
    const QUEST_OBJECT_HEIGHT = 1.35;
    /** The cube a crate is refitted into. Derived, not a literal: the size is a
     *  seat-tuning knob, and this case is about the REFIT following it. */
    const BOX_SIZE = REALM_RACERS_PICKUP_BOX_HALF * 2;

    /**
     * Stand in for `quest_objects.ts`, whose real model needs a GLB fetch this
     * suite has no loader for.
     *
     * The fake is shaped like the real thing where it matters: ONE geometry
     * behind every call (the module caches its prepared template and clones it,
     * so the world's ground crates draw the same buffer), and a mesh sitting on
     * y = 0 at the ground-object height.
     */
    function mockQuestObject(resolved: boolean): {
      asked: string[];
      shared: THREE.BufferGeometry;
    } {
      const shared = new THREE.BoxGeometry(0.9, QUEST_OBJECT_HEIGHT, 0.8);
      const asked: string[] = [];
      vi.doMock('../src/render/quest_objects', () => ({
        buildGroundQuestObject: (itemId: string) => {
          asked.push(itemId);
          const group = new THREE.Group();
          if (resolved) {
            const mesh = new THREE.Mesh(shared, new THREE.MeshBasicMaterial());
            mesh.position.y = QUEST_OBJECT_HEIGHT / 2;
            group.add(mesh);
          }
          return { group, height: QUEST_OBJECT_HEIGHT };
        },
      }));
      return { asked, shared };
    }

    afterEach(() => {
      vi.doUnmock('../src/render/quest_objects');
    });

    it('cuts every box out of the world own supply crate', async () => {
      const { asked, shared } = mockQuestObject(true);
      const { boxes } = await pickupsGroup();
      // The q_supplies crate, asked for ONCE for the whole build: a request per
      // box would rebuild and refit the same model a dozen times a circuit.
      expect(asked).toEqual(['supply_crate']);
      for (const body of boxes) expect(drawnMeshes(body)).toHaveLength(1);
      const first = drawnMeshes(boxes[0])[0];
      // A COPY of the quest object's buffer, shared across this build's boxes.
      // The track disposer frees the geometry of every plain mesh it walks, so
      // drawing the cached one would take the world's own quest crates down
      // with the next editor rebuild.
      expect(first.geometry).not.toBe(shared);
      for (const body of boxes) expect(drawnMeshes(body)[0].geometry).toBe(first.geometry);
    });

    it('refits the crate into the cube the catch radius is tuned against', async () => {
      mockQuestObject(true);
      const { boxes } = await pickupsGroup();
      // Measured in the BOX's own frame, so this says nothing about where the
      // lane put the body: the crate is centred on the box's point rather than
      // standing on it, which is what makes the spin and the bob turn about the
      // crate itself instead of swinging it around.
      const probe = new THREE.Group();
      probe.add(boxes[0].children[0].clone(true));
      probe.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(probe);
      const span = bounds.getSize(new THREE.Vector3());
      expect(Math.max(span.x, span.y, span.z)).toBeCloseTo(BOX_SIZE, 6);
      const centre = bounds.getCenter(new THREE.Vector3());
      expect(centre.x).toBeCloseTo(0, 6);
      expect(centre.y).toBeCloseTo(0, 6);
      expect(centre.z).toBeCloseTo(0, 6);
    });

    it('falls back to a solid box when the crate model is not resolved', async () => {
      // A fetch that failed, or any host with no loader: a box is a thing a
      // pilot steers at, so it is never nothing.
      mockQuestObject(false);
      const { view, boxes } = await pickupsGroup();
      const here = REALM_RACERS_ORIGIN;
      view.update(here.x, here.z, 1, matchOn(GARDEN_CIRCUIT.id, []));
      expect(boxes.length).toBeGreaterThan(0);
      const first = drawnMeshes(boxes[0])[0];
      expect(first.geometry.type).toBe('BoxGeometry');
      for (const body of boxes) {
        expect(body.visible).toBe(true);
        const drawn = drawnMeshes(body);
        expect(drawn).toHaveLength(1);
        expect(drawn[0].visible).toBe(true);
        // One geometry per build here too, not one per box.
        expect(drawn[0].geometry).toBe(first.geometry);
      }
    });

    it('hangs the world own gold glint over every box, at full boost', async () => {
      mockQuestObject(true);
      const { boxes } = await pickupsGroup();
      const sprites = boxes.map(
        (body) =>
          body.children.filter((child) => (child as THREE.Sprite).isSprite) as THREE.Sprite[],
      );
      for (const perBox of sprites) expect(perBox).toHaveLength(1);
      // One material for the lot: it carries a canvas texture, and the editor
      // rebuilds a whole circuit per edit.
      const materials = new Set(sprites.map((perBox) => perBox[0].material));
      expect(materials.size).toBe(1);
      // Boosted whatever the tier: a glint a preset could dim is a box a pilot
      // could miss, which is the race-furniture fairness rule.
      const material = [...materials][0] as THREE.SpriteMaterial;
      expect(material.color.r).toBeCloseTo(SPARKLE_BOOST, 6);
      expect(material.map).not.toBeNull();
      // And it pops WITH the box rather than hanging in the air after it: the
      // glint is a child of the body the take animation writes.
      expect(sprites[0][0].parent).toBe(boxes[0]);
    });
  });

  describe('and the oil they leave behind', () => {
    /** The same readout, carrying a chosen set of patches. */
    const matchWithSlicks = (slicks: RealmRacersSlickInfo[]): RealmRacersMatchInfo => ({
      ...matchOn(GARDEN_CIRCUIT.id, []),
      slicks,
    });

    async function slicksGroup(): Promise<{
      view: {
        update(px: number, pz: number, time: number, match: RealmRacersMatchInfo | null): void;
      };
      slots: THREE.Object3D[];
    }> {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const view = buildRealmRacersTrack(GARDEN_CIRCUIT);
      const group = view.group.getObjectByName('realm-racers-slicks') as THREE.Group;
      expect(group).toBeDefined();
      return { view, slots: group.children };
    }

    it('draws nothing on a clean circuit and a patch where the race says one is', async () => {
      const { view, slots } = await slicksGroup();
      const here = REALM_RACERS_ORIGIN;
      // A fixed pool, minted at build time: the cost of the oil is the same
      // whether or not any is down.
      expect(slots).toHaveLength(RALLY_SLICK_POOL);
      view.update(here.x, here.z, 1, matchWithSlicks([]));
      for (const slot of slots) expect(slot.visible).toBe(false);

      let time = 1;
      const frames = (count: number, slicks: RealmRacersSlickInfo[]): void => {
        for (let i = 0; i < count; i++) {
          time += 0.05;
          view.update(here.x, here.z, time, matchWithSlicks(slicks));
        }
      };
      frames(1, [{ id: 4, x: 12, z: -7 }]);
      const shown = slots.filter((slot) => slot.visible);
      expect(shown).toHaveLength(1);
      // At the coordinates the race reported, in the circuit's own frame: what a
      // machine slides on is what a pilot sees.
      expect(shown[0].position.x).toBeCloseTo(12, 6);
      expect(shown[0].position.z).toBeCloseTo(-7, 6);
      // FULL radius from the first frame, and it stays there: the sim can report a grip loss for a patch the tick it appears, so a disk still
      // growing would be drawn smaller than it bites.
      expect(shown[0].scale.x).toBeCloseTo(1, 6);
      frames(10, [{ id: 4, x: 12, z: -7 }]);
      expect(shown[0].scale.x).toBeCloseTo(1, 6);
    });

    it('soaks a patch away when it expires and gives the slot back', async () => {
      const { view, slots } = await slicksGroup();
      const here = REALM_RACERS_ORIGIN;
      let time = 1;
      const frames = (count: number, slicks: RealmRacersSlickInfo[]): void => {
        for (let i = 0; i < count; i++) {
          time += 0.05;
          view.update(here.x, here.z, time, matchWithSlicks(slicks));
        }
      };
      frames(12, [{ id: 4, x: 12, z: -7 }]);
      const slot = slots.find((child) => child.visible) as THREE.Object3D;
      expect(slot).toBeDefined();
      // The frame the fade STARTS on carries no elapsed time, so the patch is
      // still full size there; the frame after is when it shrinks.
      frames(2, []);
      expect(slot.visible).toBe(true);
      expect(slot.scale.x).toBeLessThan(1);
      frames(16, []);
      expect(slot.visible).toBe(false);

      // And the pool really recycles: a second patch takes the same slot back.
      frames(1, [{ id: 5, x: -3, z: 9 }]);
      expect(slot.visible).toBe(true);
      expect(slot.position.x).toBeCloseTo(-3, 6);
    });

    it('draws every patch a race can hold at once', async () => {
      const { view, slots } = await slicksGroup();
      const here = REALM_RACERS_ORIGIN;
      // The pool is at least the SIM's cap, so what bites is always what a pilot
      // can see; the sim evicts its oldest patch past that number.
      expect(RALLY_SLICK_POOL).toBeGreaterThanOrEqual(REALM_RACERS_SLICK_CAP);
      // One more than the cap, which is the shape the sim can never produce:
      // every id a race CAN hold still owns a visible slot, and the extra one
      // simply goes undrawn rather than pushing a live patch off the road.
      const live: RealmRacersSlickInfo[] = Array.from(
        { length: REALM_RACERS_SLICK_CAP + 1 },
        (_, i) => ({ id: i + 1, x: i * 3, z: -i * 2 }),
      );
      view.update(here.x, here.z, 1, matchWithSlicks(live));
      const shown = slots.filter((slot) => slot.visible);
      expect(shown).toHaveLength(RALLY_SLICK_POOL);
      for (const slick of live.slice(0, REALM_RACERS_SLICK_CAP)) {
        const owned = shown.find(
          (slot) =>
            Math.abs(slot.position.x - slick.x) < 1e-6 &&
            Math.abs(slot.position.z - slick.z) < 1e-6,
        );
        expect(owned, `slick ${slick.id} owns a slot`).toBeDefined();
        expect(owned?.scale.x).toBeCloseTo(1, 6);
      }
    });

    it('ignores the oil on a race running on a DIFFERENT circuit', async () => {
      const { view, slots } = await slicksGroup();
      const here = REALM_RACERS_ORIGIN;
      const other = REALM_RACERS_CIRCUIT_LIST.find((circuit) => circuit.id !== GARDEN_CIRCUIT.id);
      expect(other).toBeDefined();
      for (let i = 0; i < 12; i++) {
        view.update(here.x, here.z, 1 + i * 0.05, {
          ...matchOn((other as RealmRacersCircuit).id, []),
          slicks: [{ id: 1, x: 0, z: 0 }],
        });
      }
      for (const slot of slots) expect(slot.visible).toBe(false);
    });
  });
});
