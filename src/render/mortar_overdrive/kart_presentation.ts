// A racing machine's per-view presentation, driven from the renderer's entity
// loop: its lean into its own acceleration (on the rider and on the machine),
// the tyre smoke, the off-road dust, the exhaust, the scrape sparks and
// report, and the engine mix. Display and audio only. Every view carries the
// state below; outside a race it stays at rest. The renderer imports this
// module as the `mortarOverdriveKart` namespace, hence the short names.
//
// The renderer members these read are private, so the renderer passes itself
// untyped (the quest_entity_presentation.ts precedent); the names the host
// cast reads are welded to renderer.ts in tests/mortar_overdrive_kart_presentation.test.ts.

import type * as THREE from 'three';
import { vehicleProfile } from '../../sim/content/vehicles';
import type { Entity, VehicleDrive } from '../../sim/types';
import {
  createRemoteVehicleDisplay,
  type RemoteVehicleDisplayState,
} from '../remote_vehicle_display_core';
import type { SelfRenderPositionState } from '../self_render_position_core';
import {
  createVehicleLean,
  stepVehicleLean,
  type VehicleLeanState,
  vehicleIsOffRoad,
} from '../vehicle_lean_core';
import type { Vfx } from '../vfx';
import {
  type MortarOverdriveRuntimeAudioSink,
  playMortarOverdriveScrapeAudio,
  syncMortarOverdriveVehicleAudio,
} from './audio';

/** The racing-machine slice of every entity view. */
export interface ViewState {
  vehicleAudioActive: boolean;
  vehicleScrapeCooldown: number;
  /** Display-only forward projection of a REMOTE racing machine toward the
   *  present (remote_vehicle_display_core); inactive outside a race. */
  remoteVehicle: RemoteVehicleDisplayState;
  vehicleLean: VehicleLeanState;
}

export function createViewState(): ViewState {
  return {
    vehicleAudioActive: false,
    vehicleScrapeCooldown: 0,
    remoteVehicle: createRemoteVehicleDisplay(),
    vehicleLean: createVehicleLean(),
  };
}

interface TiltedView extends ViewState {
  groundTilt: { pitch: number; roll: number };
}

interface GroundTilted {
  setGroundTilt(pitch: number, roll: number): void;
}

/** The private renderer members the kart presentation reads and drives. */
interface MortarOverdriveKartHost {
  readonly sim: { readonly playerId: number };
  readonly audioSink: MortarOverdriveRuntimeAudioSink | null;
  readonly selfRender: SelfRenderPositionState;
  readonly vfx: Pick<
    Vfx,
    'vehicleDriftSmoke' | 'vehicleSurfaceDust' | 'vehicleExhaust' | 'vehicleScrapeSparks'
  >;
  readonly tmpV: THREE.Vector3;
  readonly groundSample: (x: number, z: number) => number;
  reducedMotion(): boolean;
  addShake(amount: number): void;
}

/** The machine a view's lean and engine read: the viewer's own drive view
 *  (the predicted kart it is drawn as, else its mirror), a rival's mirror. */
function kartDrive(
  h: MortarOverdriveKartHost,
  e: Pick<Entity, 'id' | 'drive'>,
): VehicleDrive | null {
  return (e.id === h.sim.playerId && h.selfRender.drive.state) || e.drive;
}

/** A sink swap stops every engine the outgoing sink was running. */
export function stopVehicleAudio(
  current: MortarOverdriveRuntimeAudioSink | null,
  next: MortarOverdriveRuntimeAudioSink | null,
  views: ReadonlyMap<number, ViewState>,
): void {
  if (current && current !== next) {
    for (const [id, view] of views) {
      if (view.vehicleAudioActive) current.stopVehicle(id);
      view.vehicleAudioActive = false;
    }
  }
}

/** One view's engine mix for this frame (syncMortarOverdriveVehicleAudio). */
export function syncVehicleAudio(
  host: object,
  entity: Pick<Entity, 'id' | 'drive'>,
  view: Pick<ViewState, 'vehicleAudioActive'> & { readonly vehicleLean: { acceleration: number } },
  audible: boolean,
  x: number,
  y: number,
  z: number,
): void {
  const h = host as MortarOverdriveKartHost;
  view.vehicleAudioActive = syncMortarOverdriveVehicleAudio(
    h.audioSink,
    entity.id,
    entity.id === h.sim.playerId,
    view.vehicleAudioActive,
    kartDrive(h, entity),
    audible,
    x,
    y,
    z,
    view.vehicleLean.acceleration,
  );
}

/** The terrain lean plus a racing machine's own weight (vehicle_lean_core),
 *  onto the rider's visual. The lean steps for every body; it only tips one
 *  that drives, settled, with motion allowed. */
export function leanRider(
  host: object,
  v: TiltedView,
  visual: GroundTilted,
  e: Pick<Entity, 'id' | 'drive'>,
  settled: boolean,
  dt: number,
): void {
  const h = host as MortarOverdriveKartHost;
  const drive = kartDrive(h, e);
  const profile = drive ? vehicleProfile(drive.profileKey) : null;
  stepVehicleLean(
    v.vehicleLean,
    drive?.speed ?? 0,
    drive?.slip ?? 0,
    profile?.maxSlip ?? 1,
    dt,
    !!drive && settled && !h.reducedMotion(),
  );
  visual.setGroundTilt(
    v.groundTilt.pitch + v.vehicleLean.pitch,
    v.groundTilt.roll + v.vehicleLean.roll,
  );
}

/**
 * A racing machine leans into its own acceleration and rolls with the ground
 * under it. Applied AFTER the mount's attitude pass, which owns the mount
 * root's pitch for every ordinary mount, and gated on the body actually
 * driving so no ordinary mount gains a tilt it never had.
 */
export function leanMount(
  e: Pick<Entity, 'drive'>,
  v: TiltedView & { mountVisual: GroundTilted | null | undefined },
  shown: boolean,
): void {
  if (e.drive && v.mountVisual && shown) {
    v.mountVisual.setGroundTilt(
      v.groundTilt.pitch + v.vehicleLean.pitch,
      v.groundTilt.roll + v.vehicleLean.roll,
    );
  }
}

/** A racing machine's road effects: drift smoke, off-road dust, exhaust, and
 *  the scrape sparks, report and (for the viewer's own machine) shake. */
export function syncRoadFx(
  host: object,
  v: ViewState & { readonly group: THREE.Object3D; readonly isFar: boolean },
  e: Pick<Entity, 'drive'>,
  isSelf: boolean,
  settled: boolean,
  facing: number,
  ax: number,
  ay: number,
  az: number,
  dt: number,
): void {
  const h = host as MortarOverdriveKartHost;
  const kart = (isSelf && h.selfRender.drive.state) || e.drive;
  if (kart && settled && !v.isFar) {
    h.vfx.vehicleDriftSmoke(v.group.position, facing, kart.slip, dt);
    if (vehicleIsOffRoad(kart.dragMult))
      h.vfx.vehicleSurfaceDust(v.group.position, facing, kart.speed, dt);
    h.vfx.vehicleExhaust(v.group.position, facing, v.vehicleLean.acceleration > 1, dt);
    v.vehicleScrapeCooldown = Math.max(0, v.vehicleScrapeCooldown - dt);
    if (kart.collisionImpact > 3 && v.vehicleScrapeCooldown <= 0) {
      const impact = Math.min(1, kart.collisionImpact / 24);
      h.tmpV.set(ax, ay + 0.55, az);
      h.vfx.vehicleScrapeSparks(h.tmpV, impact);
      playMortarOverdriveScrapeAudio(h.audioSink, h.groundSample, ax, az, impact);
      if (isSelf) h.addShake(0.05 + impact * 0.14);
      v.vehicleScrapeCooldown = 0.18;
    }
  }
}
