// A player who never races pays none of the race-only GPU work at boot.
//
// Every circuit view is built at boot (realm_racers_track.ts,
// buildRealmRacersTracks) and attached to the scene HIDDEN, and the Ground
// Blast pool is attached EMPTY. The world-entry compile walk
// (initial_scene_compile_units.ts) collects the live scene with
// traverseVisible, so neither is a root of the boot, post-paint or resume
// units, and the race preparation seam (realm_racers_prepare.ts) is what
// links them, on its commitment trigger. These pins keep both halves true:
// the boot units built over a scene holding the rally groups the way the
// renderer holds them compile nothing under them, on every tier, and a
// session that never commits never calls the world gate at all.
//
// The blocking arrival's zone prewarm is the one compile that hands three the
// whole scene, whose walk takes hidden children too. The rally groups declare
// `excludeFromParentCompile` (compile_exclusion.ts), so that compile links none
// of their programs while every other hidden group still links as before, and
// the seam's own gates, rooted at a circuit or at the pool, still link it all.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateTier, gfxProfileRestorer } from './helpers/gfx_tier';
import { mirrorGltfScene } from './helpers/gltf_material_mirror';
import { stripComments } from './helpers/strip_comments';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

vi.mock('../src/render/textures', () => {
  const texture = (): THREE.DataTexture => {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  };
  return {
    rallyKerbTexture: vi.fn(texture),
    rallyGroundBlastMarkerTexture: vi.fn(texture),
    rallyStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    grassTuftTexture: vi.fn(texture),
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

vi.mock('../src/render/assets/loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/assets/loader')>()),
  // The dressing fills land, so the hidden views carry everything a circuit
  // draws, the theme models included.
  loadGltf: vi.fn((url: string) => {
    if (!url.startsWith('/models/')) return new Promise(() => undefined);
    return Promise.resolve({ scene: mirrorGltfScene(url, 'public') });
  }),
}));

import { resetArrivalCoverForTest } from '../src/render/arrival_cover';
import {
  type CompileArmHost,
  linkColorPrograms,
  linkShadowPrograms,
} from '../src/render/compile_arms';
import { GFX_TIER_RANK, type GfxTier } from '../src/render/gfx';
import { buildInitialSceneCompileUnits } from '../src/render/initial_scene_compile_units';
import { prepareRealmRacersCircuits } from '../src/render/realm_racers_circuit_prepare';
import { realmRacersFills } from '../src/render/realm_racers_fills';
import { RealmRacersGroundBlastVisuals } from '../src/render/realm_racers_ground_blast';
import {
  RealmRacersPrepare,
  type RealmRacersPrepareHost,
} from '../src/render/realm_racers_prepare';
import { setRenderCategory } from '../src/render/renderer_diagnostics';

type TrackModule = typeof import('../src/render/realm_racers_track');

let track: TrackModule;

beforeAll(async () => {
  track = await import('../src/render/realm_racers_track');
});

afterAll(gfxProfileRestorer());

beforeEach(() => {
  resetArrivalCoverForTest();
  // The fetch-and-fill arm only runs where a window exists.
  vi.stubGlobal('window', {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Eastbrook-side world coordinates, far from the rally band. */
const TOWN = { x: 0, z: 0 };
const IDLE = { queued: false, match: null };

function under(object: THREE.Object3D, roots: readonly THREE.Object3D[]): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (roots.includes(node)) return true;
  }
  return false;
}

/** The rally groups attached the way the renderer attaches them, beside a
 *  visible world mesh and a staged hidden catalog. */
async function bootScene() {
  const scene = new THREE.Scene();
  const world = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial());
  world.name = 'world';
  scene.add(world);
  const catalog = new THREE.Group();
  catalog.visible = false;
  const staged = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
  staged.name = 'catalog';
  catalog.add(staged);
  scene.add(catalog);

  const tracks = track.buildRealmRacersTracks();
  await Promise.all(tracks.circuits.map((view) => realmRacersFills(view.group).landed()));
  const blasts = new RealmRacersGroundBlastVisuals();
  const seam = new RealmRacersPrepare([blasts]);
  prepareRealmRacersCircuits(seam, tracks, { ensure: vi.fn(() => Promise.resolve(true)) });
  setRenderCategory(tracks.group, 'props');
  scene.add(tracks.group);
  scene.add(blasts.group);
  return { scene, world, catalog, staged, tracks, blasts, seam };
}

describe.each(Object.keys(GFX_TIER_RANK) as GfxTier[])('a player who never races on %s', (tier) => {
  beforeEach(() => {
    activateTier(tier);
  });

  it('links no rally program in the boot, post-paint or resume compile units', async () => {
    const { scene, world, catalog, staged, tracks, blasts } = await bootScene();
    const rallyRoots = [tracks.group, blasts.group];
    // What the walk has to skip is real: every circuit's view is built, filled
    // and hidden.
    for (const view of tracks.circuits) {
      expect(view.group.visible, view.circuitId).toBe(false);
      expect(drawsUnder(view.group).length, view.circuitId).toBeGreaterThan(0);
    }

    const compiled: THREE.Object3D[] = [];
    const dedupe = { seen: new Set<THREE.Object3D>(), seenKeys: new Set<unknown>() };
    const unitsFor = (includeGroup: (id: string) => boolean) =>
      buildInitialSceneCompileUnits({
        scene,
        stagedGroups: [['catalog', catalog]],
        includeGroup,
        playerX: TOWN.x,
        playerZ: TOWN.z,
        batchSize: 4,
        sharedDedupe: dedupe,
        compileColor: async (root) => {
          compiled.push(root);
        },
        compileShadow: async () => undefined,
        onCompiledRoot: () => undefined,
      });
    // The boot submission (the visible scene), the post-paint debt (the
    // staged catalogs), then the live-scene re-collection the resume lane
    // takes: the three calls the renderer makes, one shared dedupe.
    const units = [
      ...unitsFor((id) => id === 'scene'),
      ...unitsFor((id) => id !== 'scene'),
      ...unitsFor(() => true),
    ];
    for (const unit of units) await unit.run();

    // The walk ran and took the world's roots...
    expect(compiled).toContain(world);
    expect(compiled).toContain(staged);
    // ...and nothing three would compile from any of them sits under a rally
    // group (a root's compile walks its whole subtree, hidden children too).
    for (const root of compiled) {
      for (const { object } of drawsUnder(root)) {
        expect(under(object, rallyRoots), object.name || object.type).toBe(false);
      }
    }
    // The Ground Blast pool is not even built before the trigger.
    expect(blasts.group.children).toEqual([]);
  });

  it('never calls the world gate for a session that never commits to racing', async () => {
    const { tracks, blasts, seam } = await bootScene();
    const gate = vi.fn(() => Promise.resolve());
    const host: RealmRacersPrepareHost = {
      worldCompileGate: () => gate,
      webgl: { properties: { get: () => undefined } },
    };
    for (let frame = 0; frame < 600; frame++) {
      tracks.update(TOWN.x + frame, TOWN.z, frame / 20, null);
      seam.frame(host, IDLE, TOWN.x + frame, TOWN.z);
    }
    expect(gate).not.toHaveBeenCalled();
    expect(seam.reason).toBeNull();
    expect(seam.worldGate()).toBeUndefined();
    for (const view of tracks.circuits) expect(view.group.visible, view.circuitId).toBe(false);
    expect(blasts.group.children).toEqual([]);
  });
});

/** The compile arms over a renderer whose link walks what three's compile
 *  walks: the root handed over, with `traverse`, hidden children included. */
function walkingArms(scene: THREE.Scene) {
  const walked: THREE.Object3D[] = [];
  const host: CompileArmHost = {
    webgl: () => ({
      getRenderTarget: () => null,
      setRenderTarget: () => undefined,
      compileAsync: (root: THREE.Object3D) => {
        root.traverse((object) => {
          if ((object as THREE.Mesh).material) walked.push(object);
        });
        return Promise.resolve(root);
      },
    }),
    camera: () => new THREE.PerspectiveCamera(),
    scene: () => scene,
    shadowCamera: () => new THREE.OrthographicCamera(),
    offscreen: () => true,
    offscreenTarget: () => ({}) as THREE.WebGLRenderTarget,
    depthMaterials: () => new Map(),
    shadowArm: () => true,
  };
  return { host, walked };
}

function programsOf(objects: readonly THREE.Object3D[]): Set<string> {
  const keys = new Set<string>();
  for (const object of objects) {
    const material = (object as THREE.Mesh).material;
    for (const entry of Array.isArray(material) ? material : [material]) {
      if (entry) keys.add(threeProgramKeys(entry, object));
    }
  }
  return keys;
}

describe.each(Object.keys(GFX_TIER_RANK) as GfxTier[])(
  "a blocking arrival's whole-scene compile on %s",
  (tier) => {
    beforeEach(() => {
      activateTier(tier);
    });

    // renderer.ts prewarmZoneAt, the covered arm: compilePrewarmColorPrograms
    // over this.scene, which the colour arm hands to three's compile as is.
    it('links no rally program, and still links the hidden world content beside it', async () => {
      const { scene, world, staged, tracks, blasts } = await bootScene();
      // A racer's prepared pool sits in the scene too: skipped all the same.
      blasts.prepare();
      const rallyRoots = [tracks.group, blasts.group];
      const rally = programsOf(drawsUnder(tracks.group).map((draw) => draw.object));
      expect(rally.size).toBeGreaterThan(0);
      const arms = walkingArms(scene);
      await linkColorPrograms(arms.host, scene, false);
      await linkShadowPrograms(arms.host, scene);
      expect(arms.walked).toContain(world);
      // The hidden staged catalog links exactly as before.
      expect(arms.walked).toContain(staged);
      for (const object of arms.walked) {
        expect(under(object, rallyRoots), object.name || object.type).toBe(false);
      }
      // Every circuit is whole again once the compile returned.
      for (const view of tracks.circuits) {
        expect(view.group.parent).toBe(tracks.group);
        expect(drawsUnder(view.group).length, view.circuitId).toBeGreaterThan(0);
      }
      expect(blasts.group.children.length).toBeGreaterThan(0);
    });

    it("leaves the race preparation's own gates linking the whole circuit and pool", async () => {
      const { scene, tracks, blasts } = await bootScene();
      blasts.prepare();
      const arms = walkingArms(scene);
      for (const view of tracks.circuits) await linkColorPrograms(arms.host, view.group, false);
      await linkColorPrograms(arms.host, blasts.group, false);
      const expected = [
        ...tracks.circuits.flatMap((view) => drawsUnder(view.group).map((draw) => draw.object)),
        ...drawsUnder(blasts.group).map((draw) => draw.object),
      ];
      expect(new Set(arms.walked)).toEqual(new Set(expected));
    });
  },
);

describe('renderer wiring of the rally groups', () => {
  const renderer = stripComments(readFileSync('src/render/renderer.ts', 'utf8'));

  it('keeps every rally group out of the staged compile catalogs', () => {
    const start = renderer.indexOf('const stagedCompileGroupsNow = ');
    expect(start).toBeGreaterThan(-1);
    const end = renderer.indexOf('];', start);
    const staged = renderer.slice(start, end);
    expect(staged).toContain("['props', propMaterialPrewarmGroup]");
    expect(staged).not.toMatch(/realmRacers|groundBlast/i);
  });

  it('attaches the tracks and the Ground Blast pool to the live scene, walked visible-only', () => {
    expect(renderer).toContain('this.scene.add(this.realmRacersTrack.group);');
    expect(renderer).toContain('this.scene.add(this.realmRacersGroundBlasts.group);');
  });
});
