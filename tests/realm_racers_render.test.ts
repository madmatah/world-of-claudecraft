import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_ZOOM_MAX } from '../src/game/input';
import {
  cameraBoomDistance,
  REALM_RACERS_CAMERA_BOOM_PROFILE,
} from '../src/render/camera_boom_core';
import {
  RALLY_BARRIER_VISUALS,
  RALLY_FLOWER_COLOURS,
  rallyBarrierPieces,
  rallyBasinMeshes,
  rallyBorderFlowerSpots,
  rallyDressingSpots,
  rallyFlowerSpots,
  rallyFountainSpot,
  rallyKerbRuns,
  rallyPerimeterPieces,
  rallyReedSpots,
  rallyStartArchPlacement,
  rallyStartLightPlacements,
  realmRacersStartLightSignal,
} from '../src/render/realm_racers_track_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN_CIRCUIT,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import {
  REALM_RACERS_ORIGIN,
  REALM_RACERS_RUNOFF_WIDTH,
  REALM_RACERS_VERGE_MARGIN,
} from '../src/sim/realm_racers_layout';
import {
  rallyBarrierKindAt,
  rallyBasinDepthAt,
  rallyContainmentLineAt,
  rallyGardenEdgeOffsetAt,
  realmRacersTrack,
  realmRacersWaterOutlines,
} from '../src/sim/realm_racers_spline';

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
  it("keeps every dressing piece outside the chase camera's furthest reach", () => {
    // A machine pinned against the garden wall with its nose to the infield puts
    // the camera OUTSIDE the wall, and the boom reaches the zoom clamp times the
    // rally profile's distance scale. Anything nearer than that is something a
    // player ends up looking from inside, which is what the ring used to do: it
    // stepped outward RADIALLY from the circuit's centre, so a piece nominally
    // 30 yards out sat barely 18 clear of a long face.
    const reach = cameraBoomDistance(CAMERA_ZOOM_MAX, REALM_RACERS_CAMERA_BOOM_PROFILE);
    const spots = rallyDressingSpots(GARDEN_CIRCUIT);
    expect(spots.length).toBeGreaterThan(20);
    for (const spot of spots) {
      const outX = Math.abs(spot.x - REALM_RACERS_ORIGIN.x) - GARDEN_CIRCUIT.perimeter.halfX;
      const outZ = Math.abs(spot.z - REALM_RACERS_ORIGIN.z) - GARDEN_CIRCUIT.perimeter.halfZ;
      // The piece's own footprint counts: the camera meets the canopy, not the
      // trunk. Clearance is to the NEAREST face, so the larger overhang wins.
      const clear = Math.max(outX, outZ) - spot.radius;
      expect(clear, `${spot.kind} at ${spot.x.toFixed(1)}, ${spot.z.toFixed(1)}`).toBeGreaterThan(
        reach,
      );
    }
  });

  beforeEach(() => {
    vi.resetModules();
    mockTextures();
  });
  afterEach(() => {
    vi.doUnmock('../src/render/textures');
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
      chaseIn: 0,
      returnIn: 0,
      me: RALLY_ME,
      standings: [RALLY_ME],
      gridSize: 4,
      decided: false,
      speed: 0,
      wrongWay: false,
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
        chaseIn: 0,
        returnIn: 0,
        me: RALLY_ME,
        standings: [RALLY_ME],
        gridSize: 4,
        decided: false,
        speed: 0,
        wrongWay: false,
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
      chaseIn: 0,
      returnIn: 0,
      me: RALLY_ME,
      standings: [RALLY_ME],
      gridSize: 4,
      decided: false,
      speed: 0,
      wrongWay: false,
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
    const geometriesOf = (group: THREE.Group, instanced: boolean): THREE.BufferGeometry[] =>
      group.children
        .filter(
          (child): child is THREE.Mesh =>
            child instanceof THREE.Mesh && child instanceof THREE.InstancedMesh === instanced,
        )
        .map((mesh) => mesh.geometry);

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

  it('keeps every solid prop out of the drivable garden', () => {
    // The garden between the two walls is drivable now, so anything standing in
    // it is either an obstacle a racer hits without warning or a thing they
    // drive through. The dressing therefore lives OUTSIDE the perimeter.
    const outsidePerimeter = (x: number, z: number, radius: number): boolean =>
      Math.abs(x - REALM_RACERS_ORIGIN.x) - radius > GARDEN_CIRCUIT.perimeter.halfX ||
      Math.abs(z - REALM_RACERS_ORIGIN.z) - radius > GARDEN_CIRCUIT.perimeter.halfZ;
    const dressing = rallyDressingSpots(GARDEN_CIRCUIT);
    expect(dressing.length).toBeGreaterThan(8);
    for (const spot of dressing) {
      expect(outsidePerimeter(spot.x, spot.z, spot.radius)).toBe(true);
      expect(Math.abs(spot.x - REALM_RACERS_ORIGIN.x)).toBeLessThan(GARDEN_CIRCUIT.regionHalfX);
      expect(Math.abs(spot.z - REALM_RACERS_ORIGIN.z)).toBeLessThan(GARDEN_CIRCUIT.regionHalfZ);
    }
  });

  it('gives the water real depth to shade, not a rim of zeroes', () => {
    // A triangulated outline polygon puts EVERY vertex on the shore, so the
    // per-vertex shore depth the water shader reads would be zero everywhere:
    // the whole basin would render as the shallowest possible water with the
    // foam band covering all of it. Rings put vertices where the depth is.
    const meshes = rallyBasinMeshes(GARDEN_CIRCUIT);
    // One shore span (the whole lap), so one water surface.
    expect(meshes).toHaveLength(1);
    const mesh = meshes[0];
    const count = mesh.depths.length;
    expect(count).toBe(mesh.columns * (mesh.rings + 1) + 1);
    // The shore ring reads exactly 0...
    for (let col = 0; col < mesh.columns; col++) expect(mesh.depths[col]).toBe(0);
    // ...and the middle is at the basin floor, which is the whole point.
    expect(mesh.depths[count - 1]).toBeCloseTo(GARDEN_BASIN.depthMax, 6);
    // The rings crowd the shore, because everything the shader varies (the
    // ramp to the basin floor, the surf band) is within a few yards of the
    // waterline. Evenly spaced rings across a basin this wide put the first one
    // past all of it, and the bank renders as one hard step.
    const firstRing = mesh.depths.slice(mesh.columns, mesh.columns * 2);
    expect(Math.max(...firstRing)).toBeLessThan(GARDEN_BASIN.depthMax);
    // ...and it really is a ramp: shallow, mid and floor all present.
    const all: number[] = Array.from(mesh.depths);
    expect(all.some((d) => d > 0 && d < 1)).toBe(true);
    expect(all.some((d) => d >= 1 && d < GARDEN_BASIN.depthMax)).toBe(true);
    expect(all.some((d) => d >= GARDEN_BASIN.depthMax - 1e-6)).toBe(true);
    for (const depth of all) {
      expect(depth).toBeGreaterThanOrEqual(0);
      expect(depth).toBeLessThanOrEqual(GARDEN_BASIN.depthMax);
    }
    // Every vertex is on the infield side, and the depth is the SIM's, so the
    // water a racer sees is the water the sim decides they are wading in.
    // EXACTLY, not approximately: the mesh keeps its positions in float64
    // precisely so this holds. At float32 the band's x = 113_700 resolves to
    // about 7mm, which near a spot where two parts of the shore compete for
    // "nearest" is enough to flip the winner and step the depth by a third of a
    // yard, and that step would be a colour seam across open water.
    for (let i = mesh.columns; i < count; i++) {
      const x = mesh.positions[i * 2];
      const z = mesh.positions[i * 2 + 1];
      expect(mesh.depths[i]).toBeCloseTo(Math.max(0, rallyBasinDepthAt(GARDEN_CIRCUIT, x, z)), 9);
    }
    // The shore ring is PINNED to zero instead, because the projection measures
    // against a polyline that reads a sagitta short of the true curve. Bound
    // what that pin is allowed to paper over, so it can never hide a real
    // disagreement between the drawn shore and the sim's.
    for (let col = 0; col < mesh.columns; col++) {
      const depth = rallyBasinDepthAt(
        GARDEN_CIRCUIT,
        mesh.positions[col * 2],
        mesh.positions[col * 2 + 1],
      );
      expect(Math.abs(depth)).toBeLessThan(0.05);
    }
    // Every triangle is a real one: a ring that folded through itself would
    // still index cleanly and render as a crumpled sheet.
    expect(mesh.index.length % 3).toBe(0);
    expect(new Set(mesh.index).size).toBe(count);
  });

  it('plants the shore and sows both road edges, building neither', () => {
    const edge = (x: number, z: number): number => {
      const projection = track.project(x, z);
      return Math.abs(projection.lateral) - track.halfWidthAt(projection.s);
    };
    // The water's edge is planted, not kerbed. It carried a ring of stone that
    // was also the circuit's inner collision, and from the circuit that read as
    // blocks standing in the lake.
    const reeds = rallyReedSpots(GARDEN_CIRCUIT);
    expect(reeds.length).toBeGreaterThan(50);
    for (const spot of reeds) {
      const projection = track.project(spot.x, spot.z);
      // On the infield side, on the shore. Loose to a centimetre: the reeds are
      // placed off the interpolated centerline and measured back against the
      // resampled POLYLINE, which reads a sagitta short of the true curve.
      expect(projection.lateral).toBeGreaterThan(0);
      expect(projection.lateral).toBeCloseTo(
        rallyContainmentLineAt(GARDEN_CIRCUIT, projection.s),
        1,
      );
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
      expect(spot.colour).toBeLessThan(RALLY_FLOWER_COLOURS.length);
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

  it('parks the infield landmark out in the water, clear of the drivable apron', () => {
    // The lone landmark stands on its island. Its four flanking statues stood on
    // the APRON instead, which is drivable and carries no collision, so racers
    // drove straight through them.
    const spot = rallyFountainSpot(GARDEN_CIRCUIT);
    if (!spot) throw new Error('the practice circuit authors a landmark');
    const projection = track.project(spot.x, spot.z);
    expect(projection.lateral - spot.radius).toBeGreaterThan(
      rallyContainmentLineAt(GARDEN_CIRCUIT, projection.s),
    );
  });

  describe('the barriers standing on the containment line', () => {
    /** The practice circuit's curve with two solid spans painted on it: a low
     *  hedge over the start straight and a kneewall round the parabolic. */
    const FLIPPED: RealmRacersCircuit = {
      ...GARDEN_CIRCUIT,
      id: 'render_barrier_fixture',
      barrierBands: [
        { s: 0, kind: 'shore' },
        { s: 0.05, kind: 'hedge_low' },
        { s: 0.12, kind: 'shore' },
        { s: 0.63, kind: 'wall_low' },
        { s: 0.7, kind: 'shore' },
      ],
    };

    /** The same curve with every span solid and no water authored at all: the
     *  shape that was not expressible before this packet. */
    const DRY: RealmRacersCircuit = {
      ...GARDEN_CIRCUIT,
      id: 'render_barrier_dry',
      barrierBands: [{ s: 0, kind: 'hedge_tall' }],
      basin: undefined,
    };

    /** The water sheets of a build. The shore-depth attribute is the one thing
     *  only the basin writes, so counting them counts the lobes. */
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

    it('builds none at all on a circuit whose whole line is shore', () => {
      // The shipped practice circuit is a lake circuit and stays one: nothing
      // about this packet puts a hedge on it.
      expect(rallyBarrierPieces(GARDEN_CIRCUIT)).toEqual([]);
      expect(realmRacersWaterOutlines(GARDEN_CIRCUIT)).toHaveLength(1);
    });

    it('lands every piece NEAR FACE on the containment line, over its own span only', () => {
      const pieces = rallyBarrierPieces(FLIPPED);
      expect(pieces.length).toBeGreaterThan(15);
      for (const piece of pieces) {
        const projection = track.project(piece.x, piece.z);
        const line = rallyContainmentLineAt(FLIPPED, projection.s);
        const half = RALLY_BARRIER_VISUALS[piece.kind].depth / 2;
        // The near face is what a pilot meets, and it sits ON the line the sim
        // clamps against, within half a yard. Centred on the line instead, half
        // the hedge would stand on the drivable side and a racer held by the
        // clamp would be buried in it.
        expect(
          Math.abs(projection.lateral - half - line),
          `${piece.kind} at ${piece.x.toFixed(1)}, ${piece.z.toFixed(1)}`,
        ).toBeLessThan(0.5);
        // ...so the whole piece stands INFIELD of the line, never over it.
        expect(projection.lateral).toBeGreaterThan(line);
        // ...on the infield side of the road, and only where that span is solid.
        expect(projection.lateral).toBeGreaterThan(0);
        expect(rallyBarrierKindAt(FLIPPED, projection.s)).toBe(piece.kind);
        // Nothing solid stands in the drivable garden: the same rule the
        // dressing ring keeps, against the boundary a barrier actually stands on
        // (further out than the border line the flowers mark).
        expect(projection.lateral).toBeGreaterThan(rallyGardenEdgeOffsetAt(FLIPPED, projection.s));
      }
      // Both authored kinds really were placed.
      expect(new Set(pieces.map((piece) => piece.kind))).toEqual(
        new Set(['hedge_low', 'wall_low']),
      );
    });

    it('lays each run end to end, with no daylight between two pieces', () => {
      // A barrier the clamp has no gaps in must not LOOK like it has one: a gap
      // is somewhere a pilot aims and then meets an invisible wall.
      const pieces = rallyBarrierPieces(FLIPPED);
      for (const kind of ['hedge_low', 'wall_low'] as const) {
        const run = pieces.filter((piece) => piece.kind === kind);
        expect(run.length).toBeGreaterThan(6);
        let overlapped = 0;
        for (let i = 1; i < run.length; i++) {
          const apart = Math.hypot(run[i].x - run[i - 1].x, run[i].z - run[i - 1].z);
          // Consecutive pieces of ONE run: the two runs are far apart, so a
          // jump between them is the run boundary and not a gap.
          if (apart > RALLY_BARRIER_VISUALS[kind].pieceLength * 4) continue;
          expect(apart, `${kind} piece ${i}`).toBeLessThan(run[i].length);
          overlapped++;
        }
        expect(overlapped).toBeGreaterThan(5);
        // Every piece spans its own slot with a little to spare, which is what
        // closes the joint where the line curves.
        for (const piece of run) {
          expect(piece.length).toBeGreaterThan(RALLY_BARRIER_VISUALS[kind].pieceLength * 0.5);
          expect(piece.length).toBeLessThan(RALLY_BARRIER_VISUALS[kind].pieceLength * 2);
        }
      }
    });

    it('turns each piece ALONG the line rather than across it', () => {
      // The mistake the start arch shipped with, in the other direction: these
      // models are long on x, so a quarter turn out reads as a picket fence of
      // planks standing across the boundary. Measured against the CONTAINMENT
      // line's own direction (piece to piece), never the road's: the two part
      // company wherever the apron ramps, and the line is what the barrier
      // stands on.
      const pieces = rallyBarrierPieces(FLIPPED);
      let compared = 0;
      for (const kind of ['hedge_low', 'wall_low'] as const) {
        const run = pieces.filter((piece) => piece.kind === kind);
        for (let i = 1; i < run.length; i++) {
          const dx = run[i].x - run[i - 1].x;
          const dz = run[i].z - run[i - 1].z;
          const apart = Math.hypot(dx, dz);
          if (apart > RALLY_BARRIER_VISUALS[kind].pieceLength * 4) continue;
          const axisX = Math.cos(run[i - 1].yaw);
          const axisZ = -Math.sin(run[i - 1].yaw);
          expect((axisX * dx + axisZ * dz) / apart, `${kind} piece ${i}`).toBeGreaterThan(0.9);
          compared++;
        }
      }
      expect(compared).toBeGreaterThan(15);
    });

    it('keeps each kind at its own authored height, low enough to see over', () => {
      // `hedge_low` exists to be seen over: a pilot has to spot a rival across
      // the strip, which is the whole point of the corridor it flanks.
      expect(RALLY_BARRIER_VISUALS.hedge_low.height).toBeLessThan(1.5);
      expect(RALLY_BARRIER_VISUALS.wall_low.height).toBeLessThan(1.5);
      expect(RALLY_BARRIER_VISUALS.hedge_tall.height).toBeGreaterThan(
        RALLY_BARRIER_VISUALS.hedge_low.height,
      );
      for (const visual of Object.values(RALLY_BARRIER_VISUALS)) {
        expect(visual.pieceLength).toBeGreaterThan(0);
        expect(visual.depth).toBeGreaterThan(0);
      }
    });

    it('cuts the water into one lobe per shore span and leaves the strip dry', () => {
      const outlines = realmRacersWaterOutlines(FLIPPED);
      expect(outlines).toHaveLength(2);
      // No reed grows at the foot of a barrier: reeds mark a waterline.
      for (const spot of rallyReedSpots(FLIPPED)) {
        expect(rallyBarrierKindAt(FLIPPED, track.project(spot.x, spot.z).s)).toBe('shore');
      }
      expect(rallyReedSpots(FLIPPED).length).toBeLessThan(rallyReedSpots(GARDEN_CIRCUIT).length);
      // Each lobe still has real depth to shade rather than a rim of zeroes.
      const meshes = rallyBasinMeshes(FLIPPED);
      expect(meshes).toHaveLength(2);
      for (const mesh of meshes) {
        expect(mesh.columns).toBeGreaterThan(8);
        expect(Math.max(...Array.from(mesh.depths))).toBeGreaterThan(1);
      }
    });

    it('draws the kneewall from one shared geometry, per build', async () => {
      // The instanced-vs-plain promise `realm_racers_track_dispose_core.ts`
      // rests on, extended to the barrier the builder mints itself rather than
      // loading: a per-build block would be freed as if it were shared.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const first = buildRealmRacersTrack(FLIPPED);
      const second = buildRealmRacersTrack(FLIPPED);
      const wallsOf = (group: THREE.Group): THREE.InstancedMesh[] =>
        group.children.filter(
          (child): child is THREE.InstancedMesh =>
            child instanceof THREE.InstancedMesh &&
            child.geometry.getAttribute('position')?.count === 24,
        );
      const a = wallsOf(first.group);
      expect(a.length).toBe(1);
      expect(a[0].count).toBe(
        rallyBarrierPieces(FLIPPED).filter((p) => p.kind === 'wall_low').length,
      );
      expect(wallsOf(second.group)[0].geometry).toBe(a[0].geometry);
      expect(wallsOf(second.group)[0].material).toBe(a[0].material);

      // ...and every instance really is built to the authored HEIGHT. The
      // kneewall's geometry is a unit block, so its per-instance y scale IS the
      // number, and nothing else in the suite reads the matrices the painter
      // composes.
      const matrix = new THREE.Matrix4();
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      for (let i = 0; i < a[0].count; i++) {
        a[0].getMatrixAt(i, matrix);
        matrix.decompose(position, quaternion, scale);
        expect(scale.y, `kneewall ${i} height`).toBeCloseTo(
          RALLY_BARRIER_VISUALS.wall_low.height,
          6,
        );
        expect(scale.z, `kneewall ${i} depth`).toBeCloseTo(RALLY_BARRIER_VISUALS.wall_low.depth, 6);
      }
    });

    it('builds one water surface per lobe, and none on a dry circuit', async () => {
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      expect(waterMeshes(buildRealmRacersTrack(DRY).group)).toHaveLength(0);
      expect(waterMeshes(buildRealmRacersTrack(FLIPPED).group)).toHaveLength(2);
      expect(waterMeshes(buildRealmRacersTrack(GARDEN_CIRCUIT).group)).toHaveLength(1);
      // ONE material across a build's lobes, never one per lobe: it is a
      // ShaderMaterial with its own compiled program, and the two callers that
      // rebuild a circuit over and over are exactly the ones a per-lobe
      // material multiplies against (see realm_racers_track_dispose_core).
      const lobes = waterMeshes(buildRealmRacersTrack(FLIPPED).group);
      expect(new Set(lobes.map((mesh) => mesh.material)).size).toBe(1);
    });

    it('punches the lawn open under every lobe, and nowhere else', async () => {
      // The hole is what makes the water read as a sunken basin instead of a
      // sheet laid on the grass, and nothing else in this suite can see it:
      // counting water meshes passes just as well with one hole, or none.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      // Earcut triangulates a polygon of n vertices with h holes into
      // n + 2h - 2 triangles, the two bridge vertices per hole included. So the
      // lawn's own index count states BOTH how many holes it carries and how
      // many points each one has: neither can move without this moving.
      for (const circuit of [DRY, GARDEN_CIRCUIT, FLIPPED]) {
        const outlines = realmRacersWaterOutlines(circuit);
        const holes = outlines.length;
        const corners = 4;
        const points = outlines.reduce((sum, outline) => sum + outline.length, corners);
        const geo = lawnMesh(buildRealmRacersTrack(circuit).group).geometry;
        expect(geo.getIndex()?.count, `${circuit.id} lawn triangles`).toBe(
          3 * (points + 2 * holes - 2),
        );
      }
      // ...and the three cases really are none, one and two holes, so the
      // identity above is not being satisfied three times by the same shape.
      expect(realmRacersWaterOutlines(DRY)).toHaveLength(0);
      expect(realmRacersWaterOutlines(GARDEN_CIRCUIT)).toHaveLength(1);
      expect(realmRacersWaterOutlines(FLIPPED)).toHaveLength(2);

      // ...and the holes are in the right PLACES: no lawn triangle survives
      // inside a water outline. A hole punched with the wrong polygon would
      // still change the count.
      for (const circuit of [GARDEN_CIRCUIT, FLIPPED]) {
        const outlines = realmRacersWaterOutlines(circuit).map((outline) =>
          outline.map((point) => [point.x, point.z] as const),
        );
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
      // The lobes are triangulated rings, so a ring edge can sit a hair outside
      // the hole it fills. That is invisible only while the water sheet is
      // BELOW the lawn: level with it, every ring would show a lip of surface
      // lying on the grass. Both heights read off the real build rather than
      // off a copy of the builder's constants.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      for (const circuit of [GARDEN_CIRCUIT, FLIPPED]) {
        const group = buildRealmRacersTrack(circuit).group;
        const lawnY = lawnMesh(group).geometry.getAttribute('position').getY(0);
        const lobes = waterMeshes(group);
        expect(lobes.length).toBeGreaterThan(0);
        for (const lobe of lobes) {
          expect(lobe.position.y, `${circuit.id} water under lawn`).toBeLessThan(lawnY);
        }
      }
    });

    it('never builds a degenerate lobe out of a two-yard shore span', () => {
      // A one-cell shore span is paintable in the editor (the brush snaps to
      // 0.005 of a lap), and it reaches the mesh builder as an outline of two
      // or three points: neither a ring to lerp toward a middle, nor something
      // the authored one-in-four stride can thin any further.
      const sliver: RealmRacersCircuit = {
        ...GARDEN_CIRCUIT,
        id: 'render_barrier_sliver',
        barrierBands: [
          { s: 0, kind: 'hedge_tall' },
          { s: 0.5, kind: 'shore' },
          { s: 0.505, kind: 'hedge_tall' },
        ],
      };
      const outlines = realmRacersWaterOutlines(sliver);
      expect(outlines).toHaveLength(1);
      expect(outlines[0].length).toBeLessThan(4);
      // Either it is skipped or it is a real ring: never a mesh with fewer
      // columns than a triangle, which indexes cleanly and renders as a shard.
      for (const mesh of rallyBasinMeshes(sliver)) {
        expect(mesh.columns).toBeGreaterThanOrEqual(3);
        expect(mesh.depths.length).toBe(mesh.columns * (mesh.rings + 1) + 1);
      }
      // ...and a slightly longer span really does build one, so the guard above
      // is a floor rather than a way of skipping every short span.
      const short: RealmRacersCircuit = {
        ...sliver,
        id: 'render_barrier_short_span',
        barrierBands: [
          { s: 0, kind: 'hedge_tall' },
          { s: 0.5, kind: 'shore' },
          { s: 0.53, kind: 'hedge_tall' },
        ],
      };
      const built = rallyBasinMeshes(short);
      expect(built).toHaveLength(1);
      expect(built[0].columns).toBeGreaterThanOrEqual(3);
    });

    it('rings the whole line on a circuit with no water at all', () => {
      // The all-solid arm: a dry circuit's barrier is ONE closed run, and
      // returning nothing there would satisfy every other case in this block.
      const pieces = rallyBarrierPieces(DRY);
      expect(pieces.length).toBeGreaterThan(20);
      expect(new Set(pieces.map((piece) => piece.kind))).toEqual(new Set(['hedge_tall']));
      // Closed: every piece overlaps its neighbour INCLUDING across the start
      // line, so the ring has no seam where the sample array happens to end.
      for (let i = 0; i < pieces.length; i++) {
        const next = pieces[(i + 1) % pieces.length];
        const apart = Math.hypot(pieces[i].x - next.x, pieces[i].z - next.z);
        expect(apart, `dry ring piece ${i}`).toBeLessThan(pieces[i].length);
      }
    });

    it('splits a run where two SOLID kinds meet, never drawing one at the other height', () => {
      // Two solid kinds are two heights. A run that only ended at water drew
      // the whole stretch at the FIRST kind's height, which makes a tall hedge
      // knee-high, or opens a sight line the design says stays blocked.
      const adjacent: RealmRacersCircuit = {
        ...GARDEN_CIRCUIT,
        id: 'render_barrier_adjacent_kinds',
        barrierBands: [
          { s: 0, kind: 'shore' },
          { s: 0.05, kind: 'hedge_low' },
          { s: 0.12, kind: 'hedge_tall' },
          { s: 0.2, kind: 'shore' },
        ],
      };
      const adjacentPieces = rallyBarrierPieces(adjacent);
      for (const piece of adjacentPieces) {
        expect(rallyBarrierKindAt(adjacent, track.project(piece.x, piece.z).s)).toBe(piece.kind);
      }
      expect(new Set(adjacentPieces.map((piece) => piece.kind))).toEqual(
        new Set(['hedge_low', 'hedge_tall']),
      );

      // ...and with NO shore span anywhere, which is the other branch: the ring
      // walk has to start at a change of kind rather than at water.
      const ring: RealmRacersCircuit = {
        ...GARDEN_CIRCUIT,
        id: 'render_barrier_ring_two_kinds',
        barrierBands: [
          { s: 0, kind: 'wall_low' },
          { s: 0.5, kind: 'hedge_tall' },
        ],
        basin: undefined,
      };
      const ringPieces = rallyBarrierPieces(ring);
      expect(new Set(ringPieces.map((piece) => piece.kind))).toEqual(
        new Set(['wall_low', 'hedge_tall']),
      );
      for (const piece of ringPieces) {
        expect(rallyBarrierKindAt(ring, track.project(piece.x, piece.z).s)).toBe(piece.kind);
      }
    });

    it('mints its water per build and shares the kneewall, on a FLIPPED circuit too', async () => {
      // The packet-19 sweep runs on the all-shore practice circuit, where there
      // is one lobe and no barrier at all: the per-lobe water and the minted
      // kneewall are both outside what it covers.
      const { buildRealmRacersTrack } = await import('../src/render/realm_racers_track');
      const first = buildRealmRacersTrack(FLIPPED);
      const second = buildRealmRacersTrack(FLIPPED);
      const waterA = waterMeshes(first.group).map((mesh) => mesh.geometry);
      const waterB = waterMeshes(second.group).map((mesh) => mesh.geometry);
      expect(waterA).toHaveLength(2);
      // Every lobe's sheet is FRESH, which is what makes disposing it correct.
      const owned = new Set(waterA);
      for (const geometry of waterB) expect(owned.has(geometry)).toBe(false);
      // ...and every instanced geometry is still BORROWED, barriers included.
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

  it('runs the perimeter around the garden wall', () => {
    const pieces = rallyPerimeterPieces(GARDEN_CIRCUIT, 3.5);
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
