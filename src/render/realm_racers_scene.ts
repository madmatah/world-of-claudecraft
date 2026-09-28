// The Realm Racers circuit as the renderer draws it: the tracks, the Ground
// Blast and oil-spray pools, the theme sky and the race preparation seam that
// owns their programs, plus the race's instant feedback (the pilot's own shot
// and oil drop, a rival drawn in the local kart's frame and the bang of a seen
// contact) and the rally events presented. The renderer owns one of these,
// attaches it once, drives it once per world frame and hands it the rally
// events; the HUD and main.ts reach its public reads through
// `renderer.realmRacers`. Display and audio only: every outcome is the sim's.
//
// The renderer members it reads are private, so the renderer passes itself
// untyped (the quest_entity_presentation.ts precedent); the names the host
// cast reads are welded to renderer.ts in tests/realm_racers_scene.test.ts.

import * as THREE from 'three';
import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import { vehicleProfile } from '../sim/content/vehicles';
import { GROUND_BLAST_RADIUS } from '../sim/realm_racers_ground_blast';
import { isAtRealmRacersXZ, realmRacersLaneAt } from '../sim/realm_racers_layout';
import type { BiomeId, Entity, SimEvent } from '../sim/types';
import { vehicleVelocityX, vehicleVelocityZ } from '../sim/vehicle_motion';
import type { IWorld } from '../world_api';
import type { RealmRacersInfo } from '../world_api/realm_racers';
import type { FramedPose } from './deck_frame';
import { GFX } from './gfx';
import {
  bumpClosingSpeed,
  consumeLocalBumpSuppression,
  createOwnBumpFeedback,
  LOCAL_BUMP_MIN_CLOSING,
  localBumpArmed,
  markLocalBump,
  shouldPlayLocalBump,
} from './own_bump_feedback_core';
import {
  canMarkOwnShotFeedback,
  consumeOwnShotFeedback,
  createOwnShotFeedback,
  markOwnShotFeedback,
} from './own_shot_feedback_core';
import { ownShotMuzzle } from './own_shot_launch_core';
import { playRealmRacersEventAudio, type RealmRacersRuntimeAudioSink } from './realm_racers_audio';
import { prepareRealmRacersCircuits } from './realm_racers_circuit_prepare';
import { RealmRacersFieldCues } from './realm_racers_field_cues';
import { RealmRacersGroundBlastVisuals } from './realm_racers_ground_blast';
import { RealmRacersPrepare, type RealmRacersPrepareHost } from './realm_racers_prepare';
import { RealmRacersSky, type RealmRacersSkyView } from './realm_racers_sky';
import {
  type RallyCircuitTheme,
  type RallySkyKey,
  rallySkyDayNightBiome,
  realmRacersThemeAt,
} from './realm_racers_themes';
import { buildRealmRacersTracks, type RealmRacersTracksView } from './realm_racers_track';
import { isRealmRacersCoPilot } from './realm_racers_visibility_core';
import {
  type RemoteVehicleDisplayState,
  remoteRacerDisplayY,
  remoteRacerMuzzle,
  resetRemoteVehicleDisplay,
  startRemoteRacerHops,
  stepRemoteRacerView,
} from './remote_vehicle_display_core';
import { setRenderCategory } from './renderer_diagnostics';
import {
  displayedAimPose,
  type SelfRenderPositionState,
  type SelfRenderPrediction,
} from './self_render_position_core';
import type { Vfx } from './vfx';

/** Mean wait a command spends on the server for the next tick boundary,
 *  seconds (half of DT): the calibration for the provisional oil drop. */
export const SLICK_DROP_MEAN_TICK_WAIT_SEC = 0.025;

/** What the scene reads of an entity view: the remote racer projection. */
export interface RealmRacersRivalView {
  remoteVehicle: RemoteVehicleDisplayState;
}

/** The circuit answer the renderer's ambience pass reads for one frame. A
 *  reused object: read it within the frame it was asked in. */
export interface RealmRacersAmbience {
  /** The viewer stands in the Realm Racers band. */
  inRally: boolean;
  /** The circuit theme under the viewer, null outside the band. */
  theme: RallyCircuitTheme | null;
  /** The circuit record under the viewer, null outside the band or off a lane. */
  circuit: RealmRacersCircuit | null;
  /** The biome the day/night grade tables read under the theme's dome. */
  gradeBiome: BiomeId | null;
}

export interface RealmRacersAimPose {
  pos: { x: number; y: number; z: number };
  facing: number;
}

/** The private renderer members the scene reads and drives. */
interface RealmRacersSceneHost extends RealmRacersPrepareHost {
  readonly sim: IWorld;
  readonly views: ReadonlyMap<number, RealmRacersRivalView>;
  readonly vfx: Pick<Vfx, 'burst' | 'groundPuff'>;
  readonly audioSink: RealmRacersRuntimeAudioSink | null;
  readonly selfRender: SelfRenderPositionState;
  readonly time: number;
  readonly groundSample: (x: number, z: number) => number;
  readonly skyView: RealmRacersSkyView;
  readonly backgroundGpuWork: {
    run(work: () => unknown, priority: number, label: string): Promise<unknown>;
  };
  readonly lowGfx: boolean;
  readonly envRTs: { readonly size: number };
  prewarmTextureInIdle(texture: THREE.Texture | null): Promise<unknown>;
  ensureEnvironmentBiome(biome: RallySkyKey): unknown;
  spawnAoeRing(x: number, z: number, radius: number, school: string): void;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
  triggerHit(entityId: number): void;
  createRequiredView(id: number | null, createdViewTypes: string[]): number;
}

type RallyEvent = Extract<
  SimEvent,
  {
    type:
      | 'realmRacersGroundBlastFired'
      | 'realmRacersGroundBlastHit'
      | 'realmRacersBump'
      | 'realmRacersSlicked'
      | 'realmRacersSlickDropped'
      | 'realmRacersPickupTaken';
  }
>;

// The objects themselves stay public for the renderer's teardown
// (renderer_resource_lifecycle.ts) and the suites; the HUD, main.ts and the
// client wiring read only `prepare`, the self reads, the two predictions and
// the draft hook.
export class RealmRacersScene {
  readonly sky: RealmRacersSky;
  /** Every circuit's view, built at `attach` (the renderer's scene exists by then). */
  track!: RealmRacersTracksView;
  readonly groundBlasts = new RealmRacersGroundBlastVisuals();
  private readonly prepareSeam = new RealmRacersPrepare([this.groundBlasts]);
  /** The HUD reads the lobby progress through a read-only slice, never the seam. */
  readonly prepare: Pick<RealmRacersPrepare, 'progress'> = this.prepareSeam;
  readonly fieldCues: RealmRacersFieldCues;
  // Latch deduplicating the own Fired event's muzzle cue against the locally
  // played one (own_shot_feedback_core).
  private readonly ownShotFeedback = createOwnShotFeedback();
  // Per-rival latch for the local bump bang (own_bump_feedback_core).
  private readonly ownBumpFeedback = createOwnBumpFeedback();
  private readonly selfAimPoseOut: RealmRacersAimPose = { pos: { x: 0, y: 0, z: 0 }, facing: 0 };
  private readonly ambience: RealmRacersAmbience = {
    inRally: false,
    theme: null,
    circuit: null,
    gradeBiome: null,
  };

  /** `host` is the renderer, passed untyped (see the header). */
  constructor(private readonly host: object) {
    const h = host as RealmRacersSceneHost;
    this.sky = new RealmRacersSky({
      sky: () => h.skyView,
      run: (work, priority, label) => h.backgroundGpuWork.run(work, priority, label),
      upload: (texture) => h.prewarmTextureInIdle(texture),
      environment: (biome) => h.ensureEnvironmentBiome(biome),
      needsEnvironment: () => !h.lowGfx && !(GFX.constrainedMemory && h.envRTs.size > 0),
    });
    this.fieldCues = new RealmRacersFieldCues(h.views, h.groundSample);
  }

  /** Build the circuits and put every rally group straight on the scene, once. */
  attach(scene: THREE.Scene): void {
    this.track = buildRealmRacersTracks();
    prepareRealmRacersCircuits(this.prepareSeam, this.track, this.sky);
    setRenderCategory(this.track.group, 'props');
    scene.add(this.track.group);
    scene.add(this.groundBlasts.group);
    this.fieldCues.joinPrepare(this.prepareSeam);
    scene.add(this.fieldCues.sprays.group);
  }

  /** One world frame. The seam runs before the tracks, so a reveal hold reads
   *  this frame's viewer. */
  frame(info: RealmRacersInfo, px: number, pz: number, dt: number): void {
    const h = this.host as RealmRacersSceneHost;
    this.prepareSeam.frame(h, info, px, pz);
    // A seated pilot reads their own match; a bystander at the fence reads the
    // lane's trackside view, so the lights, the boxes and the oil stay honest
    // for anyone looking at the circuit (same shape as the Vale Cup spectate).
    this.track.update(px, pz, h.time, info.match ?? h.sim.realmRacersTrackside ?? null);
    this.groundBlasts.update(dt);
    this.fieldCues.update(dt);
  }

  /** Every co-pilot of the viewer's match is a required view, created whatever
   *  its range (realm_racers_visibility_core.ts). Returns how many were made. */
  createCoPilotViews(
    participantIds: readonly number[],
    playerId: number,
    createdViewTypes: string[],
  ): number {
    const h = this.host as RealmRacersSceneHost;
    let created = 0;
    for (const id of participantIds) {
      if (!isRealmRacersCoPilot(participantIds, playerId, id)) continue;
      created += h.createRequiredView(id, createdViewTypes);
    }
    return created;
  }

  /**
   * The circuit under the viewer at (`px`, `pz`), for the ambience pass;
   * `viewerX` is the player's own x, which the theme lookup reads. Asking also
   * prepares that theme's sky.
   */
  ambienceAt(px: number, pz: number, viewerX: number): RealmRacersAmbience {
    const out = this.ambience;
    out.inRally = isAtRealmRacersXZ(px, pz);
    // A Realm Racers circuit flies its THEME's sky rather than the band's own
    // zone answer. Two reasons, and the second is a defect: a circuit is meant
    // to wear its zone's art wherever the band happens to sit, and
    // `zoneBiomeAt` out there depends on which LANE a copy of the circuit is
    // on (the public lane reads vale, the private practice copies read marsh,
    // jungle, night, amber, ember), so a practice lap was lit by a different
    // sky than the race it practises for.
    out.theme = out.inRally ? realmRacersThemeAt(viewerX, pz) : null;
    // ...and raced at the hour its RECORD names: no zone owns the band, so no
    // clock out here was authored by anybody.
    out.circuit = out.inRally ? (realmRacersLaneAt(px, pz)?.circuit ?? null) : null;
    // The DOME and the day/night GRADE are two questions, and the Farshore is
    // where they stop having one answer: its sky is place-keyed rather than
    // biome-keyed, so the grade tables (which are keyed by biome) take the
    // realm under that dome instead.
    out.gradeBiome = out.theme ? rallySkyDayNightBiome(out.theme.sky.biome) : null;
    if (out.theme) void this.sky.ensure(out.theme.sky.biome);
    return out;
  }

  /**
   * The circuit's own haze, out of the same theme record as its ground, its
   * kerbs and its planting, applied on the frame the fog state turns 'rally'
   * (only ever inside the band), so the theme is the one the track under the
   * player is drawn from (or the default, between two lanes). It reads the
   * theme this frame's `ambienceAt` found.
   */
  applyFog(fog: THREE.Fog, px: number, pz: number): void {
    const rallyFog = (this.ambience.theme ?? realmRacersThemeAt(px, pz)).sky.fog;
    fog.color.setHex(rallyFog.color);
    fog.near = rallyFog.near;
    fog.far = rallyFog.far;
  }

  /**
   * Dev only: draw a circuit that was drawn in the editor rather than authored
   * in the records module, so `/dev rallydraft` has something to look at. The
   * lifecycle (build on registration, swap and dispose on re-registration)
   * lives in the sibling the tracks view composes.
   */
  registerDraftCircuit(circuit: RealmRacersCircuit): void {
    this.track.registerDraft(circuit);
  }

  /** Previous rendered frame's predicted driving heading for main.ts's chase
   *  camera follower. Null on foot, while inactive, and on the first vehicle
   *  frame before the predictor has adopted the drive state. */
  get selfMotionFacing(): number | null {
    const h = this.host as RealmRacersSceneHost;
    return h.selfRender.drive.steersHeading ? h.selfRender.drive.facing : null;
  }

  /**
   * The DISPLAYED self pose, for aiming affordances (the ground-aim reticle's
   * cone/range clamp). Online, the mirror pose the HUD reads is one echo old;
   * at racing speed that is yards behind the machine the player is looking at,
   * so a clamp measured from it promises a limit the server will not apply.
   * The predicted display pose is also the closest estimate of the pose the
   * server WILL hold when the cast command arrives (one uplink from now).
   * Null while the predictor is inactive (offline, spectating, gated), where
   * the mirror pose is already the right reference. Returns a reused object:
   * per-frame reticle redraw path.
   */
  get selfAimPose(): RealmRacersAimPose | null {
    const h = this.host as RealmRacersSceneHost;
    // Driving, the drive view's steered heading is the zero-latency truth; on
    // foot the facing channel is client-authoritative input and the mirror is
    // already current (displayedAimPose).
    return displayedAimPose(h.selfRender, h.sim.player?.facing ?? 0, this.selfAimPoseOut);
  }

  /**
   * Instant local feedback for the pilot's OWN rally shot: the muzzle flash,
   * the fire report and (while the kart is predicted) the shell itself leave
   * at the press, from the displayed pose toward the point the client sent.
   * Display and audio only: the Fired event adopts the shell (or it fades
   * unconfirmed), and the crater stays the server's Hit event.
   */
  predictOwnGroundBlastFire(point: { x: number; z: number } | null = null): void {
    const h = this.host as RealmRacersSceneHost;
    // One report in flight at a time: a re-commit inside the round trip beats
    // the not-yet-mirrored cooldown, and its shell will never exist.
    if (!canMarkOwnShotFeedback(this.ownShotFeedback, performance.now())) return;
    const pose = this.selfAimPose;
    const p = h.sim.player;
    const px = pose ? pose.pos.x : p.pos.x;
    const pz = pose ? pose.pos.z : p.pos.z;
    const facing = pose ? pose.facing : p.facing;
    const { x, z } = ownShotMuzzle(px, pz, facing); // the server's muzzle, so no gap
    const lead = h.selfRender.reconciledLeadMs;
    this.groundBlasts.launchOwn(px, pz, facing, point, lead, h.groundSample, p.id);
    h.vfx.burst(new THREE.Vector3(x, 1.1, z), 'arcane', 14, 0.65);
    playRealmRacersEventAudio(h.audioSink, h.groundSample, {
      type: 'realmRacersGroundBlastFired',
      sourceId: h.sim.playerId,
      x,
      z,
      targetX: x,
      targetZ: z,
      flightSeconds: 0,
    });
    markOwnShotFeedback(this.ownShotFeedback, performance.now());
  }

  /**
   * Instant local feedback for the pilot's OWN oil drop: paint the patch under
   * the displayed machine the frame the cast commits, instead of waiting the
   * readout's round trip (9 to 15 yards of road at race speed). The slick
   * layer swaps it for the readout's real patch when that lands, or expires it
   * if the cast was refused. Local screen only; the hazard every other pilot
   * steers around stays the readout's.
   */
  predictOwnSlickDrop(): void {
    const h = this.host as RealmRacersSceneHost;
    const match = h.sim.realmRacersInfo.match;
    if (!match) return;
    const pose = this.selfAimPose;
    const p = h.sim.player;
    // The server lays the real patch under its own pose at the tick the
    // command lands, which trails the displayed machine by the command's wait
    // for the tick boundary: zero to one tick, half on average. Painting the
    // provisional that same half-tick of travel BEHIND the display halves the
    // typical handoff shift.
    const lag = h.selfRender.drive.source === 'predicted' ? SLICK_DROP_MEAN_TICK_WAIT_SEC : 0;
    const vx = h.selfRender.drive.velocityX;
    const vz = h.selfRender.drive.velocityZ;
    this.track.dropProvisionalSlick(
      match.circuitId,
      (pose ? pose.pos.x : p.pos.x) - vx * lag,
      (pose ? pose.pos.z : p.pos.z) - vz * lag,
      h.time,
    );
  }

  /**
   * One frame of a view's remote racing machine, written into `pose` (the
   * caller's per-call render pose scratch, read by the caller right after):
   * a remote racing machine is
   * projected off its newest wire pose with the real vehicle kernel, into the
   * local kart's frame while that kart is predicted, else by its arrival age;
   * its height is the wire's over the ground under the drawn hull, or a blast
   * pop drawn from the Hit event (remote_vehicle_display_core.ts). Anything
   * else resets a live projection and leaves `pose` alone. Display-only.
   */
  projectRival(
    isSelf: boolean,
    v: RealmRacersRivalView,
    e: Entity,
    pose: FramedPose,
    selfMotion: SelfRenderPrediction | null,
    now: number,
    dt: number,
    /** The frame's player (the entity loop reads it once per frame). */
    p: Entity,
    selfPos: { readonly x: number; readonly z: number },
  ): void {
    const h = this.host as RealmRacersSceneHost;
    if (!isSelf && stepRemoteRacerView(v.remoteVehicle, e, selfMotion, now, dt, p.netUpdatedAt)) {
      const x = v.remoteVehicle.x;
      const z = v.remoteVehicle.z;
      pose.y = remoteRacerDisplayY(
        v.remoteVehicle,
        pose.x,
        pose.y,
        pose.z,
        x,
        z,
        h.groundSample,
        dt,
      );
      pose.x = x;
      pose.z = z;
      const facing = v.remoteVehicle.facing;
      pose.facing = facing;
      // The local bump bang: the DISPLAYED hulls are accurate now, so when
      // they touch with a real closing speed the player sees a collision a
      // beat before the server's event can say so. Play the bang at the
      // seen touch (throttled per rival) and let the event's duplicate be
      // suppressed in onEvent; the physics still arrives with the
      // snapshots, untouched. Gated by localBumpArmed: a predicted self
      // drive, a rival of the LOCAL race in its racing phase (the sim only
      // resolves contacts over the match's own grid, so a paddock or
      // post-tableau touch must never bang), and neither machine a recovery
      // ghost, which the server never collides. The overlap test is the
      // plain instantaneous circle, not the sim's swept same-tick test, on
      // purpose: a fast crossing the circle misses simply plays through
      // the unsuppressed server event. The ghost read is the entity aura
      // both worlds carry (realm_racers_ghost.ts), so a machine a rival
      // passes through never bangs on either side of the wire.
      const race = h.sim.realmRacersInfo.match;
      if (p.drive && localBumpArmed(h.selfRender.drive.source, race, e, p)) {
        const reach =
          vehicleProfile(e.drive.profileKey).bodyRadius +
          vehicleProfile(p.drive.profileKey).bodyRadius;
        const dx = x - selfPos.x;
        const dz = z - selfPos.z;
        if (dx * dx + dz * dz < reach * reach) {
          const closing = bumpClosingSpeed(
            dx,
            dz,
            h.selfRender.drive.velocityX - vehicleVelocityX(e.drive, facing),
            h.selfRender.drive.velocityZ - vehicleVelocityZ(e.drive, facing),
          );
          if (
            closing >= LOCAL_BUMP_MIN_CLOSING &&
            shouldPlayLocalBump(this.ownBumpFeedback, e.id, now)
          ) {
            markLocalBump(this.ownBumpFeedback, e.id, now);
            this.playBumpFeedback((selfPos.x + x) / 2, (selfPos.z + z) / 2, closing, p.id, e.id);
          }
        }
      }
    } else if (v.remoteVehicle.active) {
      resetRemoteVehicleDisplay(v.remoteVehicle);
    }
  }

  /** The rally sim events, presented. */
  onEvent(ev: RallyEvent): void {
    const h = this.host as RealmRacersSceneHost;
    switch (ev.type) {
      case 'realmRacersGroundBlastFired': {
        // Muzzle flash at the barrel as DRAWN, then the arc and the dodge marker.
        // The marker never scales: only this burst does (the pooled cloud's).
        const shot = remoteRacerMuzzle(h.views, ev, h.sim.playerId, h.groundSample);
        this.groundBlasts.fire(shot, h.groundSample(ev.targetX, ev.targetZ));
        // The local pilot's own muzzle flash and report already played at the
        // press (predictOwnGroundBlastFire): replaying them reads as a double
        // shot. The arc and the marker are not duplicated locally.
        if (
          !consumeOwnShotFeedback(
            this.ownShotFeedback,
            ev.sourceId === h.sim.playerId,
            performance.now(),
          )
        ) {
          h.vfx.burst(new THREE.Vector3(shot.x, shot.y, shot.z), 'arcane', 14, 0.65);
          playRealmRacersEventAudio(h.audioSink, h.groundSample, shot);
        }
        return;
      }
      case 'realmRacersGroundBlastHit': {
        // The crater fires whether or not anyone was caught: a miss that lands
        // silently is most of what made the first version read as nothing
        // happening. Flash and shockwave are the shell module's own pooled
        // meshes; the ring and the dust are the shared pools.
        this.groundBlasts.impact(ev.x, ev.z, h.groundSample(ev.x, ev.z));
        startRemoteRacerHops(h.views, ev, h.sim.playerId);
        h.spawnAoeRing(ev.x, ev.z, GROUND_BLAST_RADIUS, 'physical');
        h.vfx.burst(
          new THREE.Vector3(ev.x, 1.1, ev.z),
          'arcane',
          20 + Math.round(24 * ev.impact),
          0.9 + 0.6 * ev.impact,
        );
        h.vfx.groundPuff(
          new THREE.Vector3(ev.x, h.groundSample(ev.x, ev.z), ev.z),
          1.1 + ev.impact,
          0xbfae92,
        );
        playRealmRacersEventAudio(h.audioSink, h.groundSample, ev);
        if (ev.targetId !== null) h.triggerHit(ev.targetId);
        if (ev.targetId === h.sim.playerId) {
          h.addShake(0.2 + 0.35 * ev.impact);
          h.punchFov(-(1.5 + 3 * ev.impact));
        }
        return;
      }
      case 'realmRacersBump': {
        // Sparks and a flash off the contact point, scaled by how hard it was.
        // For a bump involving the LOCAL machine the same cosmetics may have
        // already played at the displayed touch (the local bang in
        // projectRival); a fresh latch means this event is that bang's echo,
        // and its physics arrives through the snapshots regardless.
        if (ev.aId === h.sim.playerId || ev.bId === h.sim.playerId) {
          const rivalId = ev.aId === h.sim.playerId ? ev.bId : ev.aId;
          if (consumeLocalBumpSuppression(this.ownBumpFeedback, rivalId, performance.now())) {
            return;
          }
        }
        this.playBumpFeedback(ev.x, ev.z, ev.impact, ev.aId, ev.bId);
        return;
      }
      case 'realmRacersSlicked':
      case 'realmRacersSlickDropped':
      case 'realmRacersPickupTaken':
        this.fieldCues.onEvent(ev, h.sim, h.vfx, h.audioSink, h.selfRender);
        return;
    }
  }

  /** The rally bump cosmetics (sparks, ring, report, shake), shared by the
   *  authoritative event and the local display-touch bang. */
  private playBumpFeedback(x: number, z: number, impact: number, aId: number, bId: number): void {
    const h = this.host as RealmRacersSceneHost;
    const force = Math.min(1, impact / 24);
    h.vfx.burst(new THREE.Vector3(x, 0.9, z), 'physical', 10 + 18 * force, 0.5 + force);
    h.spawnAoeRing(x, z, 1.6 + 1.4 * force, 'physical');
    playRealmRacersEventAudio(h.audioSink, h.groundSample, {
      type: 'realmRacersBump',
      aId,
      bId,
      x,
      z,
      impact,
    });
    if (aId === h.sim.playerId || bId === h.sim.playerId) {
      h.addShake(0.12 + 0.28 * force);
    }
  }
}
