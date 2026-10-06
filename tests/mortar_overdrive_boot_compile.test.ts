// A player who never races pays none of the race-only work at boot, CPU, memory
// or GPU.
//
// NO circuit is built at boot: `buildMortarOverdriveTracks` (mortar_overdrive/track.ts)
// makes one empty, hidden group per authored circuit and nothing else, not even
// the spline or the placements a build would resolve, and a circuit is built
// only by its race preparation client when a pilot commits to it
// (mortar_overdrive/circuit_prepare.ts). The Ground Blast pool is attached EMPTY.
// These pins keep that true: after boot and a long session that never
// commits, no circuit is built, the pool holds no drawable and no buffer, the
// sim resolvers a build reads were never asked, and the world gate was never
// called.
//
// A circuit a player DID race stays built, hidden, for the session. The
// world-entry compile walk (initial_scene_compile_units.ts) collects the live
// scene with traverseVisible, so it is never a root of the boot, post-paint or
// resume units. The blocking arrival's zone prewarm is the one compile that
// hands three the whole scene, whose walk takes hidden children too: the Mortar Overdrive
// groups declare `excludeFromParentCompile` (compile_exclusion.ts), so that
// compile links none of their programs while every other hidden group still
// links as before, and the seam's own gates, rooted at a circuit or at the pool,
// still link it all.

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
    mortarOverdriveKerbTexture: vi.fn(texture),
    mortarOverdriveGroundBlastMarkerTexture: vi.fn(texture),
    mortarOverdriveStartGridTexture: vi.fn(texture),
    flowerTuftTexture: vi.fn(texture),
    grassTuftTexture: vi.fn(texture),
    sparkleTexture: vi.fn(texture),
    groundDetailTexture: vi.fn(texture),
    macroNoiseTexture: vi.fn(texture),
    // The low-tier water is the world's own Phong plane material.
    waterNormalish: vi.fn(texture),
    waterNormalMaps: vi.fn(() => [texture(), texture()]),
    groundSplatMaps: vi.fn(() => ({
      grass: { map: texture(), normalMap: texture() },
      dirt: { map: texture(), normalMap: texture() },
      rock: { map: texture(), normalMap: texture() },
      sand: { map: texture(), normalMap: texture() },
    })),
  };
});

// The sim resolvers a circuit build is the first to ask: counted, so a boot that
// builds nothing is seen to resolve nothing.
vi.mock('../src/sim/mortar_overdrive/spline', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/mortar_overdrive/spline')>();
  return { ...actual, mortarOverdriveTrack: vi.fn(actual.mortarOverdriveTrack) };
});
vi.mock('../src/sim/mortar_overdrive/props_resolve', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/sim/mortar_overdrive/props_resolve')>();
  return { ...actual, mortarOverdrivePlacedProps: vi.fn(actual.mortarOverdrivePlacedProps) };
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
import { parentCompileExclusionOf } from '../src/render/compile_exclusion';
import { GFX_TIER_RANK, type GfxTier } from '../src/render/gfx';
import { buildInitialSceneCompileUnits } from '../src/render/initial_scene_compile_units';
import { prepareMortarOverdriveCircuits } from '../src/render/mortar_overdrive/circuit_prepare';
import { mortarOverdriveFills } from '../src/render/mortar_overdrive/fills';
import { MortarOverdriveGroundBlastVisuals } from '../src/render/mortar_overdrive/ground_blast';
import { MortarOverdriveOilSprayVisuals } from '../src/render/mortar_overdrive/oil_spray';
import {
  MortarOverdrivePrepare,
  type MortarOverdrivePrepareHost,
  mortarOverdriveArrivalLifts,
} from '../src/render/mortar_overdrive/prepare';
import { setRenderCategory } from '../src/render/renderer_diagnostics';
import { MORTAR_OVERDRIVE_CIRCUIT_LIST } from '../src/sim/content/mortar_overdrive/circuits';
import {
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneOrigin,
} from '../src/sim/mortar_overdrive/layout';
import { mortarOverdrivePlacedProps } from '../src/sim/mortar_overdrive/props_resolve';
import { mortarOverdriveTrack } from '../src/sim/mortar_overdrive/spline';

type TrackModule = typeof import('../src/render/mortar_overdrive/track');

let track: TrackModule;

beforeAll(async () => {
  track = await import('../src/render/mortar_overdrive/track');
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

/** Eastbrook-side world coordinates, far from the Mortar Overdrive band. */
const TOWN = { x: 0, z: 0 };
const IDLE = { queued: false, match: null };

function under(object: THREE.Object3D, roots: readonly THREE.Object3D[]): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (roots.includes(node)) return true;
  }
  return false;
}

/** The Mortar Overdrive groups attached the way the renderer attaches them, beside a
 *  visible world mesh and a staged hidden catalog. `raced` builds every
 *  circuit first, as a session that raced each of them once has. */
async function bootScene(raced = true) {
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

  const tracks = track.buildMortarOverdriveTracks();
  if (raced) for (const view of tracks.circuits) view.build().finish();
  await Promise.all(tracks.circuits.map((view) => mortarOverdriveFills(view.group).landed()));
  const blasts = new MortarOverdriveGroundBlastVisuals();
  const sprays = new MortarOverdriveOilSprayVisuals();
  const seam = new MortarOverdrivePrepare([blasts]);
  prepareMortarOverdriveCircuits(seam, tracks, { ensure: vi.fn(() => Promise.resolve(true)) });
  setRenderCategory(tracks.group, 'props');
  scene.add(tracks.group);
  scene.add(blasts.group);
  seam.addClient(sprays);
  scene.add(sprays.group);
  // The exclusion is read off the compiled root's DIRECT children: a declared
  // group moved under anything else would silently stop being skipped.
  expect(tracks.group.parent).toBe(scene);
  expect(blasts.group.parent).toBe(scene);
  expect(sprays.group.parent).toBe(scene);
  return { scene, world, catalog, staged, tracks, blasts, sprays, seam };
}

describe.each(Object.keys(GFX_TIER_RANK) as GfxTier[])('a player who never races on %s', (tier) => {
  beforeEach(() => {
    activateTier(tier);
  });

  it('builds no circuit, retains no circuit buffer and resolves nothing at boot', async () => {
    vi.mocked(mortarOverdriveTrack).mockClear();
    vi.mocked(mortarOverdrivePlacedProps).mockClear();
    const { tracks, seam } = await bootScene(false);
    const host: MortarOverdrivePrepareHost = {
      worldCompileGate: () => () => Promise.resolve(),
      webgl: { properties: { get: () => undefined } },
    };
    for (let frame = 0; frame < 600; frame++) {
      tracks.update(TOWN.x + frame, TOWN.z, frame / 20, null);
      seam.frame(host, IDLE, TOWN.x + frame, TOWN.z);
    }
    expect(tracks.circuits.map((view) => view.circuitId)).toEqual(
      MORTAR_OVERDRIVE_CIRCUIT_LIST.map((circuit) => circuit.id),
    );
    for (const view of tracks.circuits) {
      expect(view.built, view.circuitId).toBe(false);
      expect(view.group.children, view.circuitId).toEqual([]);
      expect(view.group.visible, view.circuitId).toBe(false);
    }
    // Nothing under the pool draws, so nothing holds a vertex, index or
    // instance buffer.
    expect(drawsUnder(tracks.group)).toEqual([]);
    let buffers = 0;
    tracks.group.traverse((object) => {
      if ((object as THREE.Mesh).geometry) buffers++;
    });
    expect(buffers).toBe(0);
    // The sim resolvers a build is the first caller of were never asked.
    expect(mortarOverdriveTrack).not.toHaveBeenCalled();
    expect(mortarOverdrivePlacedProps).not.toHaveBeenCalled();
  });

  it('links no Mortar Overdrive program in the boot, post-paint or resume compile units', async () => {
    const { scene, world, catalog, staged, tracks, blasts, sprays } = await bootScene();
    const mortarOverdriveRoots = [tracks.group, blasts.group, sprays.group];
    // What the walk has to skip is real: a session that raced keeps every
    // circuit it raced built, filled and hidden.
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
    // ...and nothing three would compile from any of them sits under a Mortar Overdrive
    // group (a root's compile walks its whole subtree, hidden children too).
    for (const root of compiled) {
      for (const { object } of drawsUnder(root)) {
        expect(under(object, mortarOverdriveRoots), object.name || object.type).toBe(false);
      }
    }
    // Neither pool is even built before the trigger.
    expect(blasts.group.children).toEqual([]);
    expect(sprays.group.children).toEqual([]);
  });

  it('never calls the world gate for a session that never commits to racing', async () => {
    const { tracks, blasts, sprays, seam } = await bootScene(false);
    const gate = vi.fn(() => Promise.resolve());
    const host: MortarOverdrivePrepareHost = {
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
    for (const view of tracks.circuits) {
      expect(view.group.visible, view.circuitId).toBe(false);
      expect(view.built, view.circuitId).toBe(false);
    }
    expect(blasts.group.children).toEqual([]);
    expect(sprays.group.children).toEqual([]);
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

    // renderer.ts prewarmZoneAt, the covered arm: the colour link over
    // this.scene, which three's compile walks as is, lifted for a band landing.
    it('links no Mortar Overdrive program for a landing elsewhere, and still links the hidden world content', async () => {
      const { scene, world, staged, tracks, blasts, sprays } = await bootScene();
      // A racer's prepared pools sit in the scene too: skipped all the same.
      blasts.prepare();
      sprays.prepare();
      const mortarOverdriveRoots = [tracks.group, blasts.group, sprays.group];
      const mortarOverdrive = programsOf(drawsUnder(tracks.group).map((draw) => draw.object));
      expect(mortarOverdrive.size).toBeGreaterThan(0);
      const arms = walkingArms(scene);
      await linkColorPrograms(arms.host, scene, false, mortarOverdriveArrivalLifts(TOWN.x, TOWN.z));
      await linkShadowPrograms(arms.host, scene);
      expect(arms.walked).toContain(world);
      // The hidden staged catalog links exactly as before.
      expect(arms.walked).toContain(staged);
      for (const object of arms.walked) {
        expect(under(object, mortarOverdriveRoots), object.name || object.type).toBe(false);
      }
      // Every circuit is whole again once the compile returned.
      for (const view of tracks.circuits) {
        expect(view.group.parent).toBe(tracks.group);
        expect(drawsUnder(view.group).length, view.circuitId).toBeGreaterThan(0);
      }
      expect(blasts.group.children.length).toBeGreaterThan(0);
    });

    it('links every Mortar Overdrive program in the arrival compile of a landing in the band', async () => {
      const { scene, world, staged, tracks, blasts, sprays } = await bootScene();
      blasts.prepare();
      sprays.prepare();
      const lane = mortarOverdriveLaneOrigin(MORTAR_OVERDRIVE_LANES[0].index);
      const arms = walkingArms(scene);
      await linkColorPrograms(arms.host, scene, false, mortarOverdriveArrivalLifts(lane.x, lane.z));
      expect(arms.walked).toContain(world);
      expect(arms.walked).toContain(staged);
      const walked = new Set(arms.walked);
      for (const root of [tracks.group, blasts.group, sprays.group]) {
        const draws = drawsUnder(root).map((draw) => draw.object);
        expect(draws.length).toBeGreaterThan(0);
        expect(draws.filter((object) => !walked.has(object))).toEqual([]);
      }
      const mortarOverdrive = programsOf(drawsUnder(tracks.group).map((draw) => draw.object));
      const linked = programsOf(arms.walked);
      expect([...mortarOverdrive].filter((key) => !linked.has(key))).toEqual([]);
      // The lift is for that one call: the next compile skips them again.
      const after = walkingArms(scene);
      await linkColorPrograms(after.host, scene, false);
      expect(
        after.walked.filter((object) => under(object, [tracks.group, blasts.group, sprays.group])),
      ).toEqual([]);
    });

    it('declares groups that carry no material and hold no light anywhere below them', async () => {
      const { tracks, blasts, sprays } = await bootScene();
      blasts.prepare();
      sprays.prepare();
      for (const root of [tracks.group, blasts.group, sprays.group]) {
        expect(parentCompileExclusionOf(root), root.name || root.type).toBe(
          'mortar-overdrive-prepare',
        );
        expect((root as THREE.Object3D & { material?: unknown }).material).toBeUndefined();
        const lights: string[] = [];
        root.traverse((object) => {
          if ((object as THREE.Light).isLight) lights.push(object.name || object.type);
        });
        expect(lights).toEqual([]);
      }
      expect(drawsUnder(blasts.group).length).toBeGreaterThan(0);
      expect(drawsUnder(sprays.group).length).toBeGreaterThan(0);
    });

    it("leaves the race preparation's own gates linking the whole circuit and pool", async () => {
      const { scene, tracks, blasts, sprays } = await bootScene();
      blasts.prepare();
      sprays.prepare();
      const arms = walkingArms(scene);
      for (const view of tracks.circuits) await linkColorPrograms(arms.host, view.group, false);
      await linkColorPrograms(arms.host, blasts.group, false);
      await linkColorPrograms(arms.host, sprays.group, false);
      const expected = [
        ...tracks.circuits.flatMap((view) => drawsUnder(view.group).map((draw) => draw.object)),
        ...drawsUnder(blasts.group).map((draw) => draw.object),
        ...drawsUnder(sprays.group).map((draw) => draw.object),
      ];
      expect(new Set(arms.walked)).toEqual(new Set(expected));
    });
  },
);

describe('renderer wiring of the Mortar Overdrive groups', () => {
  const renderer = stripComments(readFileSync('src/render/renderer.ts', 'utf8'));

  it('keeps every Mortar Overdrive group out of the staged compile catalogs', () => {
    const start = renderer.indexOf('const stagedCompileGroupsNow = ');
    expect(start).toBeGreaterThan(-1);
    const end = renderer.indexOf('];', start);
    const staged = renderer.slice(start, end);
    expect(staged).toContain("['props', propMaterialPrewarmGroup]");
    expect(staged).not.toMatch(/mortarOverdrive|groundBlast/i);
  });

  it('lifts the Mortar Overdrive exclusion in the blocking arrival compile on the landing point alone', () => {
    const start = renderer.indexOf('async prewarmZoneAt(x: number, z: number');
    expect(start).toBeGreaterThan(-1);
    const method = renderer.slice(start, renderer.indexOf('\n  }\n', start));
    // The lifts are taken for the landing point, then handed to the one blocking link.
    expect(method).toMatch(
      /const lifts = moRender\.mortarOverdriveArrivalLifts\(x, z\);\s*await linkColorPrograms\(this\.compileArms, this\.scene, false, lifts\);/,
    );
    expect(method).not.toContain('compilePrewarmColorPrograms(this.scene');
  });

  // No Renderer can be built headless, so the real wiring is read off its
  // source: the renderer hands the Mortar Overdrive scene its scene root once, and the
  // Mortar Overdrive scene attaches each declared group once, straight to that root, and
  // never to any other parent (the exclusion reads direct children).
  it('attaches the tracks and the Ground Blast and oil-spray pools to the scene itself, and nowhere else', () => {
    const scene = stripComments(readFileSync('src/render/mortar_overdrive/scene.ts', 'utf8'));
    expect(renderer.match(/this\.mortarOverdrive\.attach\(/g)).toHaveLength(1);
    expect(renderer).toContain('this.mortarOverdrive.attach(this.scene);');
    expect(scene).toContain('attach(scene: THREE.Scene): void {');
    for (const group of [
      'this.track.group',
      'this.groundBlasts.group',
      'this.fieldCues.sprays.group',
    ]) {
      const attaches = [...scene.matchAll(/(\S+)\.(?:add|attach)\(([^)]*)\)/g)].filter((m) =>
        m[2].split(',').some((arg) => arg.trim() === group),
      );
      expect(
        attaches.map((m) => m[0]),
        group,
      ).toEqual([`scene.add(${group})`]);
      expect(scene).not.toMatch(
        new RegExp(`attachSceneGroupGated\\([^)]*${group.replace(/\./g, '\\.')}`),
      );
    }
    // The renderer never reaches past the Mortar Overdrive scene to parent a Mortar Overdrive group.
    expect(renderer).not.toMatch(/mortarOverdrive\.(?:track|groundBlasts|fieldCues)\b[^;]*\.group/);
    expect(renderer).not.toMatch(/attachSceneGroupGated\([^)]*mortarOverdrive/);
  });
});
