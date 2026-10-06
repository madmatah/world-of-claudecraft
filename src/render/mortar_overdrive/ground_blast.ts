// The Ground Blast, drawn: a shell that visibly leaves the barrel, arcs through the
// air behind a trail, and lands where the ground said it would.
//
// The GROUND MARKER is the load-bearing part. It is what makes the shot
// dodgeable rather than arbitrary, so under the gameplay-neutral-graphics
// invariant (root CLAUDE.md, docs/design/graphics-settings-fairness.md) its
// existence, its position and its SIZE are the same on every graphics preset and
// at every tier: nothing in this module reads the quality tier or the frame
// governor, and the hazard disc is drawn at exactly the sim's blast radius so
// what a player sees is what the blast will cover. Only the richness AROUND it
// (the muzzle smoke, the impact dust, the bloom) scales, and all of that lives
// in the renderer's pooled particle cloud, not here.
//
// Everything is pooled and driven by its own flight clock: a shell retires
// itself at the tick its impact was scheduled for, so the marker is up for
// exactly the flight and no event ordering can strand one on the ground.
//
// The whole pool, its shared geometries, materials and marker texture included,
// is built by `prepare()`, which the race preparation seam
// (mortar_overdrive/prepare.ts) calls when the viewer commits to racing and then
// links and uploads off the live frame; a shot never builds or waits, and a
// player who never races mints none of it.
//
// The local pilot's own shell can leave on the input frame (`launchOwn`): it is
// one of the same pooled slots, its Fired event ADOPTS it instead of drawing a
// second one, and an unconfirmed one shrinks away mid-air with no crater. The
// decisions are own_shot_launch_core.ts; this module only moves the meshes.

import * as THREE from 'three';
import { GROUND_BLAST_RADIUS } from '../../sim/mortar_overdrive/ground_blast';
import { excludeFromParentCompile } from '../compile_exclusion';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  claimOwnShotLaunch,
  createOwnShotLedger,
  expireOwnShotLaunch,
  planOwnShotLaunch,
  recordOwnShotLaunch,
  shellProgress,
  OWN_SHOT_UNCONFIRMED_FADE_S as UNCONFIRMED_FADE,
} from '../own_shot_launch_core';
import { tagVfxSubtree } from '../renderer_diagnostics';
import { mortarOverdriveGroundBlastMarkerTexture } from '../textures';
import { MORTAR_OVERDRIVE_COMPILE_OWNER } from './prepare_core';

/** How high the shell arcs, as a fraction of how far it is going, bounded so a
 *  point-blank lob still clears the machine and a long one is not a mortar. */
const ARC_HEIGHT_FRACTION = 0.18;
const ARC_HEIGHT_MIN = 2.5;
const ARC_HEIGHT_MAX = 7;
/** Height the marker floats above the ground, yards: enough to beat z-fighting
 *  with the road, low enough to read as painted on it. */
const MARKER_LIFT = 0.06;
/** Fraction of the blast radius the countdown disc still covers at impact. It
 *  never reaches zero, so the marker stays legible right to the last frame. */
const MARKER_CORE_FLOOR = 0.12;
/** How fast the hazard disc turns, rad/s. Motion is what the eye catches on a
 *  road going past at speed; the disc's SIZE never changes. */
const MARKER_SPIN = 0.9;
/** Height of the warning column over the marker, yards. It exists so a rival
 *  who is not looking down still sees the shot coming: at racing speed the
 *  ground ahead is almost edge-on and a flat circle alone arrives too late. */
const COLUMN_HEIGHT = 9;
/** Trail motes per shell, and how long each one lingers. */
const TRAIL_MOTES = 16;
const TRAIL_LIFE = 0.32;
/** How far the impact flash and its shockwave expand, as multiples of the blast
 *  radius, and how long each lasts. */
const FLASH_LIFE = 0.28;
const SHOCKWAVE_LIFE = 0.45;
const SHOCKWAVE_REACH = 2.4;

const COOL = new THREE.Color(0x6fd8ff);
const HOT = new THREE.Color(0xffb04a);

interface GroundBlastSlot {
  projectile: THREE.Mesh;
  glow: THREE.Mesh;
  trail: THREE.InstancedMesh;
  /** Age of each trail mote, seconds; past TRAIL_LIFE the mote is spent. */
  trailAge: Float32Array;
  trailPos: Float32Array;
  trailNext: number;
  trailSince: number;
  marker: THREE.Mesh;
  core: THREE.Mesh;
  column: THREE.Mesh;
  fromX: number;
  fromZ: number;
  toX: number;
  toZ: number;
  groundY: number;
  arc: number;
  flight: number;
  elapsed: number;
  /** Path progress the flight started from: 0, or where an adopted own shell
   *  already was when the server's flight took over. */
  progressFrom: number;
  /** The adopted target's correction (ground height included), decaying to
   *  zero over the flight. */
  shiftX: number;
  shiftZ: number;
  shiftY: number;
  /** Bumped per launch, so a recycled slot is never mistaken for an old shot. */
  serial: number;
  /** Seconds of the unconfirmed shrink left, or -1 when not fading. */
  fade: number;
  live: boolean;
}

/** What a shot's flight needs, as the Fired event carries it. */
export interface GroundBlastShot {
  x: number;
  z: number;
  targetX: number;
  targetZ: number;
  flightSeconds: number;
  /** The shooter, when known: the pilot's own event adopts a predicted shell. */
  sourceId?: number;
}

interface BurstSlot {
  flash: THREE.Mesh;
  wave: THREE.Mesh;
  elapsed: number;
  live: boolean;
}

/** At most one shell per racer is ever in the air on a two-pilot grid; the pools
 *  are sized for a bigger one and recycle their oldest slot past that. */
const POOL_SIZE = 6;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const materialName = (role: string): string => `mortarOverdriveGroundBlast:${role}`;

/** The geometries and materials every slot shares (the marker, core, column,
 *  flash and wave materials are cloned per slot from these). */
interface GroundBlastKit {
  readonly projectileGeometry: THREE.BufferGeometry;
  readonly glowGeometry: THREE.BufferGeometry;
  readonly moteGeometry: THREE.BufferGeometry;
  readonly markerGeometry: THREE.BufferGeometry;
  readonly coreGeometry: THREE.BufferGeometry;
  readonly columnGeometry: THREE.BufferGeometry;
  readonly waveGeometry: THREE.BufferGeometry;
  readonly flashGeometry: THREE.BufferGeometry;
  readonly projectileMaterial: THREE.MeshBasicMaterial;
  readonly glowMaterial: THREE.MeshBasicMaterial;
  readonly trailMaterial: THREE.MeshBasicMaterial;
  readonly markerMaterial: THREE.MeshBasicMaterial;
  readonly coreMaterial: THREE.MeshBasicMaterial;
  readonly columnMaterial: THREE.MeshBasicMaterial;
  readonly waveMaterial: THREE.MeshBasicMaterial;
  readonly flashMaterial: THREE.MeshBasicMaterial;
}

function buildGroundBlastKit(): GroundBlastKit {
  return {
    projectileGeometry: new THREE.IcosahedronGeometry(0.3, 1),
    glowGeometry: new THREE.IcosahedronGeometry(0.72, 1),
    moteGeometry: new THREE.IcosahedronGeometry(0.2, 0),
    markerGeometry: new THREE.PlaneGeometry(GROUND_BLAST_RADIUS * 2, GROUND_BLAST_RADIUS * 2),
    coreGeometry: new THREE.CircleGeometry(GROUND_BLAST_RADIUS, 40),
    columnGeometry: new THREE.CylinderGeometry(
      GROUND_BLAST_RADIUS * 0.94,
      GROUND_BLAST_RADIUS * 0.94,
      COLUMN_HEIGHT,
      28,
      1,
      true,
    ),
    waveGeometry: new THREE.RingGeometry(0.82, 1, 48, 1),
    flashGeometry: new THREE.IcosahedronGeometry(1, 2),
    projectileMaterial: new THREE.MeshBasicMaterial({
      name: materialName('projectile'),
      color: 0xdcf7ff,
    }),
    glowMaterial: new THREE.MeshBasicMaterial({
      name: materialName('glow'),
      color: 0x63d5ff,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    trailMaterial: new THREE.MeshBasicMaterial({
      name: materialName('trail'),
      color: 0x9ce6ff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
    markerMaterial: new THREE.MeshBasicMaterial({
      name: materialName('marker'),
      map: mortarOverdriveGroundBlastMarkerTexture(),
      color: COOL.clone(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    coreMaterial: new THREE.MeshBasicMaterial({
      name: materialName('core'),
      color: COOL.clone(),
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    columnMaterial: new THREE.MeshBasicMaterial({
      name: materialName('column'),
      color: COOL.clone(),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    waveMaterial: new THREE.MeshBasicMaterial({
      name: materialName('wave'),
      color: 0xffd9a0,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
    flashMaterial: new THREE.MeshBasicMaterial({
      name: materialName('flash'),
      color: 0xfff0cf,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  };
}

export class MortarOverdriveGroundBlastVisuals {
  readonly prepareId = 'groundBlast';
  readonly group = new THREE.Group();
  private slots: GroundBlastSlot[] = [];
  private bursts: BurstSlot[] = [];
  private nextSlot = 0;
  private nextBurst = 0;
  private prepared = false;
  private disposed = false;
  private scratch = new THREE.Object3D();
  /** Frame clock, seconds (the sum of `update` steps): the only time the own
   *  shot's confirmation window is measured on. */
  private clock = 0;
  private readonly ownShots = createOwnShotLedger();

  /** Minted by `prepare()`, never at construction: a player who never races
   *  holds none of it. */
  private kit: GroundBlastKit | null = null;

  constructor() {
    this.group.name = 'mortarOverdriveGroundBlast';
    tagVfxSubtree(this.group);
    // The prepared pool is linked by the race preparation seam alone, never by
    // a whole-scene compile it happens to sit under (compile_exclusion.ts).
    excludeFromParentCompile(this.group, MORTAR_OVERDRIVE_COMPILE_OWNER);
  }

  /**
   * Build every slot and burst the pool will ever draw, hidden, and return the
   * root holding them: the preparation seam links and uploads exactly this set,
   * so `fire()` and `impact()` only move and show what is already here.
   * Each transparent DoubleSide material (marker, core, column, wave) is TWO
   * programs, the Back pass then the Front pass, and three's compile links
   * both, exactly as the draw does. Idempotent, and a no-op once disposed.
   */
  prepare(): THREE.Object3D {
    if (this.prepared || this.disposed) return this.group;
    this.prepared = true;
    const kit = buildGroundBlastKit();
    this.kit = kit;
    for (let i = 0; i < POOL_SIZE; i++) {
      this.slots[i] = this.buildSlot(i, kit);
      this.bursts[i] = this.buildBurst(kit);
    }
    tagVfxSubtree(this.group);
    return this.group;
  }

  /** Built, by `prepare()` or by a shot that came first. */
  get built(): boolean {
    return this.prepared;
  }

  private buildSlot(index: number, kit: GroundBlastKit): GroundBlastSlot {
    const projectile = new THREE.Mesh(kit.projectileGeometry, kit.projectileMaterial);
    const glow = new THREE.Mesh(kit.glowGeometry, kit.glowMaterial);
    const trail = new THREE.InstancedMesh(kit.moteGeometry, kit.trailMaterial, TRAIL_MOTES);
    trail.frustumCulled = false;
    const marker = new THREE.Mesh(kit.markerGeometry, kit.markerMaterial.clone());
    const core = new THREE.Mesh(kit.coreGeometry, kit.coreMaterial.clone());
    const column = new THREE.Mesh(kit.columnGeometry, kit.columnMaterial.clone());
    // Flat on the ground rather than facing the camera: the marker is a mark on
    // the track, and a billboard would read as a UI element floating over it.
    marker.rotation.x = -Math.PI / 2;
    core.rotation.x = -Math.PI / 2;
    // The dodge read rides the encounter band, over any floor mark a pilot's
    // own kit could paint, with the countdown fill under its disc.
    core.renderOrder = floorVfxRenderOrder('encounter', 0);
    marker.renderOrder = floorVfxRenderOrder('encounter', 1);
    // Named per slot so a test can address one part of one blast without
    // depending on the child ORDER, which every visual pass reshuffles.
    for (const [name, mesh] of [
      ['groundBlast', projectile],
      ['glow', glow],
      ['trail', trail],
      ['marker', marker],
      ['core', core],
      ['column', column],
    ] as const) {
      mesh.castShadow = false;
      mesh.name = `${name}${index}`;
    }
    this.group.add(projectile, glow, trail, marker, core, column);
    const slot: GroundBlastSlot = {
      projectile,
      glow,
      trail,
      trailAge: new Float32Array(TRAIL_MOTES).fill(TRAIL_LIFE),
      trailPos: new Float32Array(TRAIL_MOTES * 3),
      trailNext: 0,
      trailSince: 0,
      marker,
      core,
      column,
      fromX: 0,
      fromZ: 0,
      toX: 0,
      toZ: 0,
      groundY: 0,
      arc: 0,
      flight: 1,
      elapsed: 0,
      progressFrom: 0,
      shiftX: 0,
      shiftZ: 0,
      shiftY: 0,
      serial: 0,
      fade: -1,
      live: false,
    };
    this.retire(slot);
    return slot;
  }

  private buildBurst(kit: GroundBlastKit): BurstSlot {
    const flash = new THREE.Mesh(kit.flashGeometry, kit.flashMaterial.clone());
    const wave = new THREE.Mesh(kit.waveGeometry, kit.waveMaterial.clone());
    wave.rotation.x = -Math.PI / 2;
    wave.renderOrder = floorVfxRenderOrder('player', 0);
    flash.castShadow = false;
    wave.castShadow = false;
    this.group.add(flash, wave);
    const slot: BurstSlot = { flash, wave, elapsed: 0, live: false };
    flash.visible = false;
    wave.visible = false;
    return slot;
  }

  private retire(slot: GroundBlastSlot): void {
    slot.live = false;
    slot.fade = -1;
    slot.projectile.scale.setScalar(1);
    slot.glow.scale.setScalar(1);
    slot.projectile.visible = false;
    slot.glow.visible = false;
    slot.trail.visible = false;
    slot.marker.visible = false;
    slot.core.visible = false;
    slot.column.visible = false;
  }

  /**
   * A shell left the barrel. Everything the flight needs is known here (the
   * impact point was decided at fire time server-side and rides the event), so
   * nothing about this shot needs another packet.
   */
  fire(shot: GroundBlastShot, groundY: number): void {
    if (this.disposed) return;
    this.prepare();
    if (shot.sourceId !== undefined && this.adoptOwnShot(shot, groundY)) return;
    const { x: muzzleX, z: muzzleZ, targetX, targetZ, flightSeconds } = shot;
    const slot = this.slots[this.nextSlot % POOL_SIZE];
    this.nextSlot++;
    slot.serial++;
    slot.progressFrom = 0;
    slot.shiftX = 0;
    slot.shiftZ = 0;
    slot.shiftY = 0;
    slot.fade = -1;
    const span = Math.hypot(targetX - muzzleX, targetZ - muzzleZ);
    slot.fromX = muzzleX;
    slot.fromZ = muzzleZ;
    slot.toX = targetX;
    slot.toZ = targetZ;
    slot.groundY = groundY;
    slot.arc = Math.min(ARC_HEIGHT_MAX, Math.max(ARC_HEIGHT_MIN, span * ARC_HEIGHT_FRACTION));
    slot.flight = Math.max(1e-3, flightSeconds);
    slot.elapsed = 0;
    slot.live = true;
    slot.trailAge.fill(TRAIL_LIFE);
    slot.trailNext = 0;
    slot.trailSince = 0;
    slot.projectile.visible = true;
    slot.glow.visible = true;
    slot.trail.visible = true;
    slot.marker.visible = true;
    slot.core.visible = true;
    slot.column.visible = true;
    slot.marker.position.set(targetX, groundY + MARKER_LIFT, targetZ);
    slot.core.position.set(targetX, groundY + MARKER_LIFT * 0.5, targetZ);
    slot.column.position.set(targetX, groundY + COLUMN_HEIGHT / 2, targetZ);
    this.step(slot, 0);
  }

  /**
   * The local pilot fired: launch their shell NOW from the drawn pose, toward
   * the point the client sent, clamped and timed as the sim does it
   * (own_shot_launch_core.ts). No-op, false, without a lead to time it by.
   */
  launchOwn(
    x: number,
    z: number,
    facing: number,
    requested: { x: number; z: number } | null,
    leadMs: number | null,
    ground: (x: number, z: number) => number,
    ownerId: number,
  ): boolean {
    if (this.disposed) return false;
    const launch = planOwnShotLaunch({ x, z, facing }, requested, leadMs);
    if (!launch) return false;
    const index = this.nextSlot % POOL_SIZE;
    this.fire(launch, ground(launch.targetX, launch.targetZ));
    const slot = this.slots[index];
    const replaced = recordOwnShotLaunch(
      this.ownShots,
      ownerId,
      index,
      slot.serial,
      this.clock,
      launch.confirmWithinS,
    );
    // A second press before the first was confirmed: the first will never be
    // adopted now, so it goes the way an unconfirmed shot goes.
    if (replaced) this.fadeUnconfirmed(replaced);
    return true;
  }

  private fadeUnconfirmed(pending: { slot: number; serial: number }): void {
    const slot = this.slots[pending.slot];
    if (slot?.live && slot.serial === pending.serial && slot.fade < 0) {
      slot.fade = UNCONFIRMED_FADE;
    }
  }

  /** The server confirmed the pilot's predicted shell: re-time the ONE shell in
   *  the air onto the server's flight (from where it is drawn now, so nothing
   *  jumps) and glide it onto the server's target. False when there is nothing
   *  to adopt, and the event draws its own shell. */
  private adoptOwnShot(shot: GroundBlastShot, groundY: number): boolean {
    const claimed = claimOwnShotLaunch(this.ownShots, shot.sourceId ?? -1, this.clock);
    const slot = claimed ? this.slots[claimed.slot] : undefined;
    if (!claimed || !slot || !slot.live || slot.serial !== claimed.serial || slot.fade >= 0) {
      return false;
    }
    const u = clamp01(slot.elapsed / slot.flight);
    const drawnToX = slot.toX + slot.shiftX * (1 - u);
    const drawnToZ = slot.toZ + slot.shiftZ * (1 - u);
    slot.progressFrom = shellProgress(slot.progressFrom, slot.elapsed, slot.flight);
    slot.elapsed = 0;
    slot.flight = Math.max(1e-3, shot.flightSeconds);
    slot.toX = shot.targetX;
    slot.toZ = shot.targetZ;
    slot.shiftX = drawnToX - shot.targetX;
    slot.shiftZ = drawnToZ - shot.targetZ;
    // The ground under the server's target, eased in like the target itself.
    slot.shiftY = slot.groundY + slot.shiftY * (1 - u) - groundY;
    slot.groundY = groundY;
    return true;
  }

  /** The shell landed: a flash and a shockwave off the ground. Driven by the
   *  impact EVENT rather than by the flight clock, so a shell that caught
   *  nothing still craters at the exact point the sim resolved. */
  impact(x: number, z: number, groundY: number): void {
    if (this.disposed) return;
    this.prepare();
    const slot = this.bursts[this.nextBurst % POOL_SIZE];
    this.nextBurst++;
    slot.elapsed = 0;
    slot.live = true;
    slot.flash.visible = true;
    slot.wave.visible = true;
    slot.flash.position.set(x, groundY + 0.9, z);
    slot.wave.position.set(x, groundY + MARKER_LIFT * 2, z);
    this.stepBurst(slot, 0);
  }

  private step(slot: GroundBlastSlot, dt: number): void {
    slot.elapsed += dt;
    const t = shellProgress(slot.progressFrom, slot.elapsed, slot.flight);
    const settle = 1 - clamp01(slot.elapsed / slot.flight);
    const toX = slot.toX + slot.shiftX * settle;
    const toZ = slot.toZ + slot.shiftZ * settle;
    const x = slot.fromX + (toX - slot.fromX) * t;
    const z = slot.fromZ + (toZ - slot.fromZ) * t;
    const groundY = slot.groundY + slot.shiftY * settle;
    if (slot.shiftX !== 0 || slot.shiftZ !== 0 || slot.shiftY !== 0) {
      slot.marker.position.set(toX, groundY + MARKER_LIFT, toZ);
      slot.core.position.set(toX, groundY + MARKER_LIFT * 0.5, toZ);
      slot.column.position.set(toX, groundY + COLUMN_HEIGHT / 2, toZ);
    }
    // An unconfirmed own shell shrinks away: scale only, since the projectile's
    // material is shared and opaque (an opacity flip would be a new program).
    let shrink = 1;
    const fading = slot.fade >= 0;
    if (fading) {
      slot.fade -= dt;
      shrink = clamp01(slot.fade / UNCONFIRMED_FADE);
    }
    // A parabola through both ends: 4*t*(1-t) peaks at 1 halfway across, so the
    // shell leaves the barrel and meets the marker at ground level.
    const y = groundY + 1.1 * (1 - t) + slot.arc * 4 * t * (1 - t);
    slot.projectile.position.set(x, y, z);
    slot.glow.position.set(x, y, z);
    slot.projectile.rotation.y += dt * 9;
    slot.projectile.rotation.x += dt * 6;
    const pulse = 1 + Math.sin(slot.elapsed * 30) * 0.12;
    slot.glow.scale.setScalar(pulse * shrink);
    slot.projectile.scale.setScalar(shrink);

    this.stepTrail(slot, dt, x, y, z, shrink);

    // The countdown. The hazard disc never resizes (it IS the blast, and a
    // player acts on it), and it only moves when the pilot's own predicted
    // shell is adopted and glides onto the server's target: what closes is the
    // fill inside it, and what sharpens is the colour. Reading the time left
    // off those is the dodge.
    const heat = t * t;
    const closing = MARKER_CORE_FLOOR + (1 - MARKER_CORE_FLOOR) * (1 - t);
    slot.core.scale.setScalar(closing);
    slot.marker.scale.setScalar(1);
    slot.marker.rotation.z += dt * MARKER_SPIN;
    const markerMat = slot.marker.material as THREE.MeshBasicMaterial;
    const coreMat = slot.core.material as THREE.MeshBasicMaterial;
    const columnMat = slot.column.material as THREE.MeshBasicMaterial;
    markerMat.color.copy(COOL).lerp(HOT, heat);
    coreMat.color.copy(COOL).lerp(HOT, heat);
    columnMat.color.copy(COOL).lerp(HOT, heat);
    // A steady pulse that quickens as the shell falls, on OPACITY only.
    markerMat.opacity = (0.72 + 0.28 * Math.abs(Math.sin(slot.elapsed * (6 + 14 * t)))) * shrink;
    coreMat.opacity = (0.2 + 0.35 * heat) * shrink;
    columnMat.opacity = (0.1 + 0.22 * heat) * shrink;
    slot.column.scale.set(1, 1, 1);

    if (t >= 1 || (fading && shrink <= 0)) this.retire(slot);
  }

  /** Drop a mote behind the shell at a fixed cadence and age the rest. The motes
   *  are one InstancedMesh per slot, so a trail costs one draw call and no
   *  per-frame allocation. */
  private stepTrail(
    slot: GroundBlastSlot,
    dt: number,
    x: number,
    y: number,
    z: number,
    shrink: number,
  ): void {
    slot.trailSince += dt;
    const interval = TRAIL_LIFE / TRAIL_MOTES;
    if (slot.trailSince >= interval || dt === 0) {
      slot.trailSince = 0;
      const at = slot.trailNext * 3;
      slot.trailPos[at] = x;
      slot.trailPos[at + 1] = y;
      slot.trailPos[at + 2] = z;
      slot.trailAge[slot.trailNext] = 0;
      slot.trailNext = (slot.trailNext + 1) % TRAIL_MOTES;
    }
    for (let i = 0; i < TRAIL_MOTES; i++) {
      slot.trailAge[i] += dt;
      const life = clamp01(1 - slot.trailAge[i] / TRAIL_LIFE);
      const at = i * 3;
      this.scratch.position.set(slot.trailPos[at], slot.trailPos[at + 1], slot.trailPos[at + 2]);
      this.scratch.scale.setScalar(life * life * shrink);
      this.scratch.updateMatrix();
      slot.trail.setMatrixAt(i, this.scratch.matrix);
    }
    slot.trail.instanceMatrix.needsUpdate = true;
  }

  private stepBurst(slot: BurstSlot, dt: number): void {
    slot.elapsed += dt;
    const flashT = clamp01(slot.elapsed / FLASH_LIFE);
    const waveT = clamp01(slot.elapsed / SHOCKWAVE_LIFE);
    const flashMat = slot.flash.material as THREE.MeshBasicMaterial;
    const waveMat = slot.wave.material as THREE.MeshBasicMaterial;
    // The flash blooms out fast and dies; the wave keeps going and thins.
    slot.flash.scale.setScalar(GROUND_BLAST_RADIUS * (0.35 + 0.9 * flashT));
    flashMat.opacity = (1 - flashT) ** 2;
    slot.wave.scale.setScalar(GROUND_BLAST_RADIUS * (0.4 + SHOCKWAVE_REACH * waveT));
    waveMat.opacity = 0.9 * (1 - waveT) ** 1.5;
    if (flashT >= 1) slot.flash.visible = false;
    if (waveT >= 1) {
      slot.wave.visible = false;
      slot.live = false;
    }
  }

  update(dt: number): void {
    if (this.disposed) return;
    this.clock += dt;
    const unconfirmed = expireOwnShotLaunch(this.ownShots, this.clock);
    if (unconfirmed) this.fadeUnconfirmed(unconfirmed);
    for (const slot of this.slots) {
      if (slot.live) this.step(slot, dt);
    }
    for (const slot of this.bursts) {
      if (slot.live) this.stepBurst(slot, dt);
    }
  }

  /** Terminal release on renderer teardown: every geometry and material this
   *  pool minted, the per-slot clones included. The marker texture belongs to
   *  the shared texture cache and stays. Each release is attempted on its own,
   *  so one that throws never strands the rest, and what threw is rethrown at
   *  the end; the pool is torn down for good either way. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    const release = (resource: { dispose(): void }): void => {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const slot of this.slots) {
      release(slot.trail);
      for (const mesh of [slot.marker, slot.core, slot.column]) {
        release(mesh.material as THREE.Material);
      }
    }
    for (const burst of this.bursts) {
      release(burst.flash.material as THREE.Material);
      release(burst.wave.material as THREE.Material);
    }
    const kit = this.kit;
    this.kit = null;
    if (kit) {
      for (const geometry of [
        kit.projectileGeometry,
        kit.glowGeometry,
        kit.moteGeometry,
        kit.markerGeometry,
        kit.coreGeometry,
        kit.columnGeometry,
        kit.waveGeometry,
        kit.flashGeometry,
      ]) {
        release(geometry);
      }
      for (const material of [
        kit.projectileMaterial,
        kit.glowMaterial,
        kit.trailMaterial,
        kit.markerMaterial,
        kit.coreMaterial,
        kit.columnMaterial,
        kit.waveMaterial,
        kit.flashMaterial,
      ]) {
        release(material);
      }
    }
    this.slots.length = 0;
    this.bursts.length = 0;
    this.group.clear();
    if (errors.length > 0) throw new AggregateError(errors, 'Ground Blast pool disposal failed');
  }

  /** Live shells, for tests and for anything that needs to know whether the sky
   *  is busy. */
  get inFlight(): number {
    return this.slots.reduce((n, slot) => n + (slot.live ? 1 : 0), 0);
  }
}
