// The circuit editor's 3D preview: the drawn circuit, rendered through the
// GAME's own track builder.
//
// It is deliberately not a second drawing. `buildRealmRacersTrack` takes a
// plain record, so the panel shows the shipped visual pipeline (ground splat,
// kerbs, the basin, the perimeter, the dressing) and inherits whatever later
// work adds to it. The 2D canvas answers "is this geometry legal"; this answers
// "does it read at speed", which is the question that made the first authored
// circuits fail slowly.
//
// Two placement facts worth stating once:
//
//  - the builder authors WORLD coordinates around `REALM_RACERS_ORIGIN`
//    (x = 113 700). The preview subtracts that on the parent group rather than
//    flying the camera out to the band, so every camera number in
//    `preview_camera_core.ts` is circuit-local and readable. The ground
//    material reads OBJECT space, which a parent translation does not touch, so
//    the splat lands exactly where it does in game.
//  - the builder's own `update()` is never called here: it exists to hide a
//    circuit that does not own the viewer's lane, and a preview has one circuit
//    and no lanes. The group is simply shown.
//
// Dev tool: English-only, absent from every production build. See CLAUDE.md.

import * as THREE from 'three';
import { assetsReady, beginDeferredPreloads } from '../../render/assets/preload';
import { initGfxTier, SUN_ANCHOR } from '../../render/gfx';
import { buildRealmRacersTrack } from '../../render/realm_racers_track';
import { disposeRealmRacersTrackGroup } from '../../render/realm_racers_track_dispose_core';
import type { RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { VEHICLE_PROFILES } from '../../sim/content/vehicles';
import { REALM_RACERS_ORIGIN } from '../../sim/realm_racers_layout';
import { realmRacersTrack } from '../../sim/realm_racers_spline';
import {
  advanceFlyThrough,
  createFlyLook,
  createPreviewOrbit,
  flyLookDrag,
  flyLookPose,
  flySpeedYardsPerSecond,
  flyThroughPoseAt,
  orbitDrag,
  orbitFrame,
  orbitLookAt,
  orbitPan,
  orbitPose,
  orbitZoom,
  PREVIEW_REBUILD_DEBOUNCE_MS,
  type PreviewFlySpeed,
  type PreviewPose,
} from './preview_camera_core';

export type PreviewCameraMode = 'orbit' | 'fly';

/** The loaner's top speed, which the two fly-through paces are fractions of. */
const MACHINE_TOP_SPEED = VEHICLE_PROFILES.rally_loaner.maxSpeed;

/** Garden sky, matching the band's own daylight rather than a neutral grey: a
 *  circuit judged against grey reads differently from one judged in game. */
const SKY_COLOUR = 0x9ac4e8;

const FOV = 62;
const NEAR = 0.5;
const FAR = 2600;

export interface CircuitPreviewOptions {
  canvas: HTMLCanvasElement;
  /** Told what the preview is doing, so the page can show it in the header. */
  onStatus(text: string): void;
}

export class CircuitPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus: (text: string) => void;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer | null = null;
  /** Everything the track builder makes, translated so the circuit sits on the
   *  world origin (see the header). */
  private readonly stage = new THREE.Group();
  private trackGroup: THREE.Group | null = null;

  private readonly orbit = createPreviewOrbit();
  /** Where the fly-through is looking, relative to straight down the road. */
  private readonly flyLook = createFlyLook();
  /** Whether a downward drag tips the view up. An operator preference, held in
   *  the page's layout store. */
  private invertLook = false;
  private mode: PreviewCameraMode = 'orbit';
  private flyS = 0;
  private flyPlaying = false;
  private flySpeed: PreviewFlySpeed = 'race';
  private lapLength = 0;

  private raf = 0;
  /**
   * Whether the panel is on screen.
   *
   * The loop STOPS when it is not. Left running behind a hidden panel it kept
   * submitting a whole circuit's draw calls under the 2D canvas's own drag
   * path, which is the one thing in this tool that has to stay responsive.
   */
  private visible = false;
  private lastFrameMs = 0;
  private rebuildTimer = 0;
  private pending: RealmRacersCircuit | null = null;
  private assetsPromise: Promise<void> | null = null;
  private started = false;
  private disposed = false;
  private dragging: { x: number; y: number; pan: boolean } | null = null;
  private viewWidth = 0;
  private viewHeight = 0;

  /** Told the fly-through moved, so the page can follow it with a scrubber. */
  onFlyProgress: ((fraction: number) => void) | null = null;

  constructor(options: CircuitPreviewOptions) {
    this.canvas = options.canvas;
    this.onStatus = options.onStatus;
    this.camera = new THREE.PerspectiveCamera(FOV, 1, NEAR, FAR);
    this.stage.position.set(-REALM_RACERS_ORIGIN.x, 0, -REALM_RACERS_ORIGIN.z);
    this.scene.add(this.stage);
    this.scene.background = new THREE.Color(SKY_COLOUR);
    this.scene.fog = new THREE.Fog(SKY_COLOUR, 900, 2400);
    this.buildLights();
    this.attachPointer();
  }

  /**
   * The renderer's own outdoor rig, restated rather than imported: `renderer.ts`
   * keeps its intensities private, and the preview must not drag the whole
   * Renderer (with its scene graph, post chain and world state) into a dev page
   * that only wants one group drawn.
   */
  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdcefff, 0x465f39, 1.15));
    const sun = new THREE.DirectionalLight(0xffd99a, 2.6);
    sun.position.copy(SUN_ANCHOR);
    this.scene.add(sun);
    this.scene.add(sun.target);
  }

  /**
   * Boot the GL context and open the asset lane.
   *
   * The lane is the deferred one every world subsystem registers into, so the
   * GLB props (beds, trees, the arch, the ironwork) arrive over the dev server
   * exactly as they do in game. Nothing here ships, so fetching them from
   * `public/` is free.
   */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    initGfxTier(renderer);
    this.renderer = renderer;
    this.resize();
    this.setVisible(true);
    this.onStatus('preview: loading models');
    beginDeferredPreloads();
    this.assetsPromise = assetsReady().catch(() => undefined);
    await this.assetsPromise;
    if (this.disposed) return;
    this.onStatus('preview: ready');
    // A record that landed while the models were still arriving is built now,
    // so opening the panel on an existing circuit never shows an empty stage.
    if (this.pending) this.rebuildNow();
  }

  /**
   * On screen or not. Off stops the render loop outright rather than drawing
   * behind a hidden panel; on re-arms it and takes a fresh frame clock, so the
   * fly-through does not leap by however long the panel was closed.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!visible) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      return;
    }
    this.lastFrameMs = 0;
    if (!this.disposed) this.loop();
  }

  /** Every edit arrives here; only the last one in a burst is built. */
  show(circuit: RealmRacersCircuit): void {
    this.pending = circuit;
    if (!this.started || this.assetsPromise === null) return;
    window.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = window.setTimeout(() => this.rebuildNow(), PREVIEW_REBUILD_DEBOUNCE_MS);
  }

  private rebuildNow(): void {
    const circuit = this.pending;
    if (!circuit || this.disposed) return;
    if (this.trackGroup) {
      this.stage.remove(this.trackGroup);
      disposeRealmRacersTrackGroup(this.trackGroup);
      this.trackGroup = null;
    }
    const view = buildRealmRacersTrack(circuit);
    // The builder hides its group for the lane gate it will never be asked
    // about here (see the header); a preview has one circuit and shows it.
    view.group.visible = true;
    this.stage.add(view.group);
    this.trackGroup = view.group;
    const track = realmRacersTrack(circuit);
    this.lapLength = track.length;
    if (this.flyS > this.lapLength) this.flyS = 0;
  }

  /**
   * Frame the whole circuit from above.
   *
   * The live aspect is handed to the core rather than assumed: this panel is a
   * tall half-screen, where the horizontal field is the one that binds.
   */
  frame(halfX: number, halfZ: number): void {
    // Read the canvas box rather than the renderer's, so framing works on the
    // very first call, which happens before the GL context is up.
    const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
    orbitFrame(this.orbit, halfX, halfZ, (FOV * Math.PI) / 180, aspect);
    this.mode = 'orbit';
  }

  setMode(mode: PreviewCameraMode): void {
    this.mode = mode;
  }

  /**
   * Orbit that point instead, in CIRCUIT-LOCAL yards.
   *
   * The plan is the fastest way to say which corner: double-clicking it beats
   * panning a rig that started on the origin, especially on a lap big enough that
   * its far side is off the frame at any readable distance.
   */
  lookAt(x: number, z: number): void {
    orbitLookAt(this.orbit, x, z);
    this.flyPlaying = false;
    this.mode = 'orbit';
  }

  get cameraMode(): PreviewCameraMode {
    return this.mode;
  }

  setFlyPlaying(playing: boolean): void {
    this.flyPlaying = playing;
    if (playing) this.mode = 'fly';
  }

  get playing(): boolean {
    return this.flyPlaying;
  }

  setFlySpeed(preset: PreviewFlySpeed): void {
    this.flySpeed = preset;
  }

  setInvertLook(invert: boolean): void {
    this.invertLook = invert;
  }

  /**
   * Put the look back down the road.
   *
   * What "the default POV" means: the chase pose the game's own boom profile
   * gives a pilot, facing forward. A lap resumed from a head turned ninety
   * degrees is not the lap anyone wanted to watch.
   */
  resetLook(): void {
    this.flyLook.yaw = 0;
    this.flyLook.pitch = 0;
  }

  /** Jump the fly-through to a lap fraction (the scrubber). */
  setFlyFraction(fraction: number): void {
    if (this.lapLength <= 0) return;
    this.flyS = Math.min(1, Math.max(0, fraction)) * this.lapLength;
    this.mode = 'fly';
  }

  resize(): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    if (width === this.viewWidth && height === this.viewHeight) return;
    this.viewWidth = width;
    this.viewHeight = height;
    renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private attachPointer(): void {
    this.canvas.addEventListener('pointerdown', (ev) => {
      this.canvas.setPointerCapture(ev.pointerId);
      // Middle button, or shift held, PANS instead of turning. Both, because the
      // middle drag is the pan gesture the 2D plan already uses and a trackpad
      // has no middle button to offer.
      const pan = ev.button === 1 || ev.shiftKey;
      this.dragging = { x: ev.clientX, y: ev.clientY, pan };
      if (pan) ev.preventDefault();
    });
    this.canvas.addEventListener('pointermove', (ev) => {
      const from = this.dragging;
      if (!from) return;
      const dx = ev.clientX - from.x;
      const dy = ev.clientY - from.y;
      this.dragging = { x: ev.clientX, y: ev.clientY, pan: from.pan };
      // In FLY the drag turns the pilot's head and stays in fly: the eye is the
      // one thing that must not move, or the view stops being what a pilot at
      // that point on the lap sees. In ORBIT it moves the rig.
      if (this.mode === 'fly' && !from.pan) {
        flyLookDrag(this.flyLook, dx, dy, this.invertLook);
        return;
      }
      if (from.pan) orbitPan(this.orbit, dx, dy);
      else orbitDrag(this.orbit, dx, dy);
      // Touching the orbit rig is a request to look around, which the
      // fly-through would otherwise fight for the camera every frame.
      this.mode = 'orbit';
    });
    // A double click puts the look back down the road: a head turned a long way
    // round is easy to reach and awkward to undo by hand.
    this.canvas.addEventListener('dblclick', () => {
      this.flyLook.yaw = 0;
      this.flyLook.pitch = 0;
    });
    const end = (): void => {
      this.dragging = null;
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    this.canvas.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        orbitZoom(this.orbit, ev.deltaY);
        this.mode = 'orbit';
      },
      { passive: false },
    );
  }

  private pose(dt: number): PreviewPose {
    if (this.mode !== 'fly' || this.lapLength <= 0) return orbitPose(this.orbit);
    if (this.flyPlaying) {
      this.flyS = advanceFlyThrough(
        this.flyS,
        flySpeedYardsPerSecond(this.flySpeed, MACHINE_TOP_SPEED),
        dt,
        this.lapLength,
      );
      this.onFlyProgress?.(this.flyS / this.lapLength);
    }
    const circuit = this.pending;
    if (!circuit) return orbitPose(this.orbit);
    // Sampling, the world-to-stage conversion and the chase pose are ONE call:
    // the conversion was skippable when they were three, and skipping it put
    // the camera out at the instance band looking at empty sky.
    const chase = flyThroughPoseAt(realmRacersTrack(circuit), this.flyS, REALM_RACERS_ORIGIN);
    return flyLookPose(chase, this.flyLook);
  }

  private loop = (): void => {
    if (this.disposed || !this.visible) return;
    this.raf = requestAnimationFrame(this.loop);
    const renderer = this.renderer;
    if (!renderer) return;
    const now = performance.now();
    const dt = this.lastFrameMs === 0 ? 0 : Math.min(0.1, (now - this.lastFrameMs) / 1000);
    this.lastFrameMs = now;
    // Cheap because `resize` bails on an unchanged box: the panel is resized by
    // a window drag, not per frame, and a dev page has no other layout writer
    // for this read to thrash against.
    this.resize();
    const pose = this.pose(dt);
    // Circuit-local poses, drawn in the stage's own frame: the stage carries
    // the origin offset, so the camera never leaves the near field.
    this.camera.position.set(pose.camera.x, pose.camera.y, pose.camera.z);
    this.camera.lookAt(pose.target.x, pose.target.y, pose.target.z);
    renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.disposed = true;
    this.visible = false;
    cancelAnimationFrame(this.raf);
    window.clearTimeout(this.rebuildTimer);
    if (this.trackGroup) {
      this.stage.remove(this.trackGroup);
      disposeRealmRacersTrackGroup(this.trackGroup);
      this.trackGroup = null;
    }
    this.renderer?.dispose();
    this.renderer = null;
  }
}
