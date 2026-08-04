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
//  - a GLB-backed piece is a clone of the loader's parsed scene, so its geometry
//    and materials belong to that cache and are never disposed here; freeing one
//    would take every authored circuit's props down with it;
//  - an `instanced` piece draws a cached geometry and material for the same
//    reason (`gardenStatueGeo`), so the mesh wrapping them is dropped and they
//    are left alone.
// Only the `group` kind mints geometry per build, and only that kind is walked
// through the shared disposer.
//
// Dev tool: English-only, absent from every production build.

import * as THREE from 'three';
import { loadGltf } from '../../render/assets/loader';
import { REALM_RACERS_PROP_VISUALS } from '../../render/realm_racers_prop_visuals';
import { disposeRealmRacersTrackGroup } from '../../render/realm_racers_track_dispose_core';
import { thumbnailBoundsUsable, thumbnailOwnsGeometry, thumbnailPose } from './thumbnail_core';

/** Tile size in device pixels. Small on purpose: a grid of forty of these lives
 *  in `localStorage`, which is a few megabytes for the whole origin. */
const THUMBNAIL_PIXELS = 96;

const FOV = 32;

/** A neutral studio backdrop rather than the garden sky: the tile is a product
 *  shot, and tinting every one of them the same green would hide exactly the
 *  differences the operator is scanning for. */
const BACKDROP = 0x232733;

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

  /** The piece itself, plus whether we own what it is made of. */
  private async subject(asset: string): Promise<{ object: THREE.Object3D; owned: boolean } | null> {
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
      const gltf = await loadGltf(visual.url);
      return { object: gltf.scene.clone(true), owned: thumbnailOwnsGeometry('gltf') };
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
