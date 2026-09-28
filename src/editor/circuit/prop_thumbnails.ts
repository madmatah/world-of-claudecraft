// One photograph per catalog piece, for the library's tiles.
//
// The palette used to be a wall of text buttons, which answers "what may I
// place" and never "what does `statueHead` look like": the operator's own words
// for the job were that dressing a circuit is a hunt. So each asset is rendered
// ONCE through the game's own visual registry
// (`src/render/realm_racers_prop_visuals.ts`), off screen, and cached.
//
// Loaded on demand, like `preview3d.ts` and for the same reason: it drags in
// Three and a GL context, and the 2D tool is the one that has to open instantly.
// The library shows text chips until the pictures arrive and never blocks on
// them, so a page with no WebGL at all is a library that simply reads the way it
// used to.
//
// Two things it must not do, both about the SHARED caches it draws from:
//  - a GLB-backed piece is a clone of the loader's parsed scene wearing what a
//    circuit draws it with (the world's converted prop materials, through
//    `realm_racers_dressing_material.ts`), so its geometry and materials belong
//    to those caches and are never disposed here; freeing one would take every
//    authored circuit's props, and the world's, down with it;
//  - an `instanced` piece draws a cached geometry and material for the same
//    reason (`gardenStatueGeo`), so the mesh wrapping them is dropped and they
//    are left alone.
// Only the `group` kind mints geometry per build, and only that kind is walked
// through the shared disposer.
//
// Dev tool: English-only, absent from every production build.

import * as THREE from 'three';
import { loadGltf } from '../../render/assets/loader';
import { REALM_RACERS_BARRIER_VISUALS } from '../../render/realm_racers_barrier_visuals';
import {
  realmRacersDressingPart,
  realmRacersDressingRoute,
  realmRacersWorldKitPart,
} from '../../render/realm_racers_dressing_material';
import { REALM_RACERS_PROP_VISUALS } from '../../render/realm_racers_prop_visuals';
import { disposeRealmRacersTrackGroup } from '../../render/realm_racers_track_dispose_core';
import {
  BARRIER_PREFIX,
  thumbnailBoundsUsable,
  thumbnailOwnsGeometry,
  thumbnailPose,
} from './thumbnail_core';

/** Tile size in device pixels. Small on purpose: a grid of forty of these lives
 *  in `localStorage`, which is a few megabytes for the whole origin. */
const THUMBNAIL_PIXELS = 96;

const FOV = 32;

/** A neutral studio backdrop rather than the garden sky: the tile is a product
 *  shot, and tinting every one of them the same green would hide exactly the
 *  differences the operator is scanning for. */
const BACKDROP = 0x232733;

/** A clone of a model, each part wearing what a circuit draws it with. The
 *  swapped geometry and material are shared caches, never ours to dispose. */
function dressed(object: THREE.Object3D, url: string): THREE.Object3D {
  // A kit piece is the world's template, not the file; the file stands in
  // only until the template has landed.
  if (realmRacersDressingRoute(url) === 'worldKit') {
    const template = realmRacersWorldKitPart(url);
    return template ? new THREE.Mesh(template.geometry, template.material) : object;
  }
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const part = realmRacersDressingPart(url, mesh.geometry, mesh.material as THREE.Material);
    if (!part) {
      mesh.visible = false;
      return;
    }
    mesh.geometry = part.geometry;
    mesh.material = part.material;
  });
  return object;
}

export class PropThumbnailRig {
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.01, 200);
  private readonly stage = new THREE.Group();
  private broken = false;
  private disposed = false;

  constructor(private readonly size: number = THUMBNAIL_PIXELS) {
    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.add(this.stage);
    // A three-point-ish rig, restated rather than imported: the renderer keeps
    // its intensities private, and a tile wants flat, even, comparable light
    // rather than the circuit's own sun.
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x39404f, 1.5));
    const key = new THREE.DirectionalLight(0xfff3dd, 2.1);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaec6ff, 0.7);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);
  }

  /**
   * The renderer, or null once we know there is not going to be one.
   *
   * `preserveDrawingBuffer` because the whole point is to read the pixels back
   * with `toDataURL`, which without it returns a blank image on most drivers as
   * soon as the frame is presented.
   */
  private context(): THREE.WebGLRenderer | null {
    if (this.renderer || this.broken || this.disposed) return this.renderer;
    try {
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(1);
      renderer.setSize(this.size, this.size, false);
      this.renderer = renderer;
    } catch {
      // No WebGL on this page: the library falls back to its text chips, which
      // is the state it shipped in.
      this.broken = true;
    }
    return this.renderer;
  }

  /**
   * A BARRIER kit's tile: three modules in a row, not one.
   *
   * One module answers "what is it made of" and not "what does a run of it look
   * like", which is the question an operator arming a kit is actually asking:
   * the difference between a rail and a wall is mostly what it does repeated.
   * Three is enough to read as a run and cheap enough to photograph.
   *
   * Every module is a clone of the loader's parsed scene, so its geometry and
   * materials belong to that cache and are never disposed here.
   */
  private async barrierSubject(kit: string): Promise<THREE.Object3D | null> {
    const visual = REALM_RACERS_BARRIER_VISUALS[kit];
    if (!visual) return null;
    try {
      const gltf = await loadGltf(visual.panelUrl);
      const row = new THREE.Group();
      const step = visual.panelYards / visual.scale;
      for (let i = -1; i <= 1; i++) {
        const panel = dressed(gltf.scene.clone(true), visual.panelUrl);
        // Along the module's OWN length axis, so a kit authored on +z lays the
        // same row as one authored on +x rather than three pieces stacked
        // through each other.
        if (visual.lengthAxis === 'z') panel.position.z = i * step;
        else panel.position.x = i * step;
        row.add(panel);
      }
      return row;
    } catch {
      return null;
    }
  }

  /** The piece itself, plus whether we own what it is made of. */
  private async subject(asset: string): Promise<{ object: THREE.Object3D; owned: boolean } | null> {
    // Namespaced rather than merged into one lookup: the two catalogs are free
    // to use the same word (a `hedge` is a plausible prop key), and a silent
    // collision would photograph the wrong thing with nothing saying so.
    if (asset.startsWith(BARRIER_PREFIX)) {
      const object = await this.barrierSubject(asset.slice(BARRIER_PREFIX.length));
      return object ? { object, owned: false } : null;
    }
    const visual = REALM_RACERS_PROP_VISUALS[asset];
    if (!visual) return null;
    if (visual.kind === 'group') {
      return { object: visual.build(0, 0, 0, 1), owned: thumbnailOwnsGeometry('group') };
    }
    if (visual.kind === 'instanced') {
      // The geometry and the material are the shared cache's; only this Mesh is
      // ours, and dropping the reference is all it takes.
      return {
        object: new THREE.Mesh(visual.geometry(), visual.material()),
        owned: thumbnailOwnsGeometry('instanced'),
      };
    }
    try {
      // Both remaining kinds are a model on disk: a `streetlamp` is the world's
      // own lit fixture rather than a prop, but a TILE only wants to look at it,
      // so it is photographed as the GLB it is (its authored emissive is dark by
      // day, which is how a lamp looks on a shelf anyway).
      const gltf = await loadGltf(visual.url);
      const clone = gltf.scene.clone(true);
      return {
        object: visual.kind === 'streetlamp' ? clone : dressed(clone, visual.url),
        owned: thumbnailOwnsGeometry(visual.kind),
      };
    } catch {
      return null;
    }
  }

  /**
   * One asset's tile, as a data URL, or null when there is nothing honest to
   * show (no WebGL, no such key, a model that would not load, or a piece that
   * measures as nothing).
   */
  async thumbnail(asset: string): Promise<string | null> {
    const renderer = this.context();
    if (!renderer || this.disposed) return null;
    const subject = await this.subject(asset);
    if (!subject || this.disposed) return null;
    try {
      this.stage.add(subject.object);
      const box = new THREE.Box3().setFromObject(subject.object);
      const bounds = {
        minX: box.min.x,
        minY: box.min.y,
        minZ: box.min.z,
        maxX: box.max.x,
        maxY: box.max.y,
        maxZ: box.max.z,
      };
      if (!thumbnailBoundsUsable(bounds)) return null;
      const pose = thumbnailPose(bounds, 1, (FOV * Math.PI) / 180);
      this.camera.position.set(pose.camera.x, pose.camera.y, pose.camera.z);
      this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
      this.camera.updateProjectionMatrix();
      renderer.render(this.scene, this.camera);
      return renderer.domElement.toDataURL('image/webp', 0.8);
    } finally {
      this.stage.remove(subject.object);
      if (subject.owned) {
        disposeRealmRacersTrackGroup(
          subject.object as unknown as Parameters<typeof disposeRealmRacersTrackGroup>[0],
        );
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stage.clear();
    this.renderer?.dispose();
    this.renderer = null;
  }
}
