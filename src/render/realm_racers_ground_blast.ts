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

import * as THREE from 'three';
import { GROUND_BLAST_RADIUS } from '../sim/realm_racers_ground_blast';
import { rallyGroundBlastMarkerTexture } from './textures';

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
  live: boolean;
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

export class RealmRacersGroundBlastVisuals {
  readonly group = new THREE.Group();
  private slots: GroundBlastSlot[] = [];
  private bursts: BurstSlot[] = [];
  private nextSlot = 0;
  private nextBurst = 0;
  private scratch = new THREE.Object3D();

  private projectileGeometry = new THREE.IcosahedronGeometry(0.3, 1);
  private glowGeometry = new THREE.IcosahedronGeometry(0.72, 1);
  private moteGeometry = new THREE.IcosahedronGeometry(0.2, 0);
  private markerGeometry = new THREE.PlaneGeometry(
    GROUND_BLAST_RADIUS * 2,
    GROUND_BLAST_RADIUS * 2,
  );
  private coreGeometry = new THREE.CircleGeometry(GROUND_BLAST_RADIUS, 40);
  private columnGeometry = new THREE.CylinderGeometry(
    GROUND_BLAST_RADIUS * 0.94,
    GROUND_BLAST_RADIUS * 0.94,
    COLUMN_HEIGHT,
    28,
    1,
    true,
  );
  private waveGeometry = new THREE.RingGeometry(0.82, 1, 48, 1);
  private flashGeometry = new THREE.IcosahedronGeometry(1, 2);

  private markerTexture = rallyGroundBlastMarkerTexture();
  private projectileMaterial = new THREE.MeshBasicMaterial({ color: 0xdcf7ff });
  private glowMaterial = new THREE.MeshBasicMaterial({
    color: 0x63d5ff,
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private trailMaterial = new THREE.MeshBasicMaterial({
    color: 0x9ce6ff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private markerMaterial = new THREE.MeshBasicMaterial({
    map: this.markerTexture,
    color: COOL.clone(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private coreMaterial = new THREE.MeshBasicMaterial({
    color: COOL.clone(),
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private columnMaterial = new THREE.MeshBasicMaterial({
    color: COOL.clone(),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private waveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  private flashMaterial = new THREE.MeshBasicMaterial({
    color: 0xfff0cf,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  private slotAt(index: number): GroundBlastSlot {
    const existing = this.slots[index];
    if (existing) return existing;
    const projectile = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial);
    const glow = new THREE.Mesh(this.glowGeometry, this.glowMaterial);
    const trail = new THREE.InstancedMesh(this.moteGeometry, this.trailMaterial, TRAIL_MOTES);
    trail.frustumCulled = false;
    const marker = new THREE.Mesh(this.markerGeometry, this.markerMaterial.clone());
    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial.clone());
    const column = new THREE.Mesh(this.columnGeometry, this.columnMaterial.clone());
    // Flat on the ground rather than facing the camera: the marker is a mark on
    // the track, and a billboard would read as a UI element floating over it.
    marker.rotation.x = -Math.PI / 2;
    core.rotation.x = -Math.PI / 2;
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
      live: false,
    };
    this.retire(slot);
    this.slots[index] = slot;
    return slot;
  }

  private burstAt(index: number): BurstSlot {
    const existing = this.bursts[index];
    if (existing) return existing;
    const flash = new THREE.Mesh(this.flashGeometry, this.flashMaterial.clone());
    const wave = new THREE.Mesh(this.waveGeometry, this.waveMaterial.clone());
    wave.rotation.x = -Math.PI / 2;
    flash.castShadow = false;
    wave.castShadow = false;
    this.group.add(flash, wave);
    const slot: BurstSlot = { flash, wave, elapsed: 0, live: false };
    flash.visible = false;
    wave.visible = false;
    this.bursts[index] = slot;
    return slot;
  }

  private retire(slot: GroundBlastSlot): void {
    slot.live = false;
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
  fire(
    muzzleX: number,
    muzzleZ: number,
    targetX: number,
    targetZ: number,
    flightSeconds: number,
    groundY: number,
  ): void {
    const slot = this.slotAt(this.nextSlot % POOL_SIZE);
    this.nextSlot++;
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

  /** The shell landed: a flash and a shockwave off the ground. Driven by the
   *  impact EVENT rather than by the flight clock, so a shell that caught
   *  nothing still craters at the exact point the sim resolved. */
  impact(x: number, z: number, groundY: number): void {
    const slot = this.burstAt(this.nextBurst % POOL_SIZE);
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
    const t = Math.min(1, slot.elapsed / slot.flight);
    const x = slot.fromX + (slot.toX - slot.fromX) * t;
    const z = slot.fromZ + (slot.toZ - slot.fromZ) * t;
    // A parabola through both ends: 4*t*(1-t) peaks at 1 halfway across, so the
    // shell leaves the barrel and meets the marker at ground level.
    const y = slot.groundY + 1.1 * (1 - t) + slot.arc * 4 * t * (1 - t);
    slot.projectile.position.set(x, y, z);
    slot.glow.position.set(x, y, z);
    slot.projectile.rotation.y += dt * 9;
    slot.projectile.rotation.x += dt * 6;
    const pulse = 1 + Math.sin(slot.elapsed * 30) * 0.12;
    slot.glow.scale.setScalar(pulse);

    this.stepTrail(slot, dt, x, y, z);

    // The countdown. The hazard disc never moves or resizes (it IS the blast,
    // and a player acts on it): what closes is the fill inside it, and what
    // sharpens is the colour. Reading the time left off those is the dodge.
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
    markerMat.opacity = 0.72 + 0.28 * Math.abs(Math.sin(slot.elapsed * (6 + 14 * t)));
    coreMat.opacity = 0.2 + 0.35 * heat;
    columnMat.opacity = 0.1 + 0.22 * heat;
    slot.column.scale.set(1, 1, 1);

    if (t >= 1) this.retire(slot);
  }

  /** Drop a mote behind the shell at a fixed cadence and age the rest. The motes
   *  are one InstancedMesh per slot, so a trail costs one draw call and no
   *  per-frame allocation. */
  private stepTrail(slot: GroundBlastSlot, dt: number, x: number, y: number, z: number): void {
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
      this.scratch.scale.setScalar(life * life);
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
    for (const slot of this.slots) {
      if (slot.live) this.step(slot, dt);
    }
    for (const slot of this.bursts) {
      if (slot.live) this.stepBurst(slot, dt);
    }
  }

  /** Terminal release on renderer teardown: every geometry and material this
   *  pool minted, the per-slot clones included. The marker texture belongs to
   *  the shared texture cache and stays. */
  dispose(): void {
    for (const slot of this.slots) {
      if (!slot) continue;
      slot.trail.dispose();
      for (const mesh of [slot.marker, slot.core, slot.column]) {
        (mesh.material as THREE.Material).dispose();
      }
    }
    for (const burst of this.bursts) {
      if (!burst) continue;
      (burst.flash.material as THREE.Material).dispose();
      (burst.wave.material as THREE.Material).dispose();
    }
    for (const geometry of [
      this.projectileGeometry,
      this.glowGeometry,
      this.moteGeometry,
      this.markerGeometry,
      this.coreGeometry,
      this.columnGeometry,
      this.waveGeometry,
      this.flashGeometry,
    ]) {
      geometry.dispose();
    }
    for (const material of [
      this.projectileMaterial,
      this.glowMaterial,
      this.trailMaterial,
      this.markerMaterial,
      this.coreMaterial,
      this.columnMaterial,
      this.waveMaterial,
      this.flashMaterial,
    ]) {
      material.dispose();
    }
    this.slots.length = 0;
    this.bursts.length = 0;
    this.group.clear();
  }

  /** Live shells, for tests and for anything that needs to know whether the sky
   *  is busy. */
  get inFlight(): number {
    return this.slots.reduce((n, slot) => n + (slot.live ? 1 : 0), 0);
  }
}
