import { vehicleProfile } from '../../sim/content/vehicles';
import type { SimEvent, VehicleDrive } from '../../sim/types';
import type { MortarOverdriveAudioEvent } from '../audio_sink';
import { vehicleIsOffRoad } from '../vehicle_lean_core';
import {
  type MortarOverdriveSpatialAudioCue,
  mortarOverdriveScrapeAudioCue,
  mortarOverdriveSpatialAudioCue,
  mortarOverdriveVehicleAudioAction,
} from './audio_core';

export interface MortarOverdriveRuntimeAudioSink {
  vehicle(
    entityId: number,
    self: boolean,
    x: number,
    y: number,
    z: number,
    speedFraction: number,
    effort: number,
    slip: number,
    offRoad: boolean,
  ): void;
  stopVehicle(entityId: number): void;
  mortarOverdriveEvent(
    kind: MortarOverdriveAudioEvent,
    x: number,
    y: number,
    z: number,
    impact?: number,
  ): void;
}

export type MortarOverdriveGroundSample = (x: number, z: number) => number;

function playMortarOverdriveCue(
  sink: MortarOverdriveRuntimeAudioSink | null,
  groundSample: MortarOverdriveGroundSample,
  cue: MortarOverdriveSpatialAudioCue | null,
): void {
  if (!sink || !cue) return;
  sink.mortarOverdriveEvent(
    cue.kind,
    cue.x,
    groundSample(cue.x, cue.z) + cue.heightOffset,
    cue.z,
    cue.impact,
  );
}

/** Execute the exact renderer relay for an authoritative Mortar Overdrive world event. */
export function playMortarOverdriveEventAudio(
  sink: MortarOverdriveRuntimeAudioSink | null,
  groundSample: MortarOverdriveGroundSample,
  event: SimEvent,
): void {
  playMortarOverdriveCue(sink, groundSample, mortarOverdriveSpatialAudioCue(event));
}

export function playMortarOverdriveScrapeAudio(
  sink: MortarOverdriveRuntimeAudioSink | null,
  groundSample: MortarOverdriveGroundSample,
  x: number,
  z: number,
  impact: number,
): void {
  playMortarOverdriveCue(sink, groundSample, mortarOverdriveScrapeAudioCue(x, z, impact));
}

/** Start/update or tear down the real three-loop vehicle mix for one render frame. */
export function syncMortarOverdriveVehicleAudio(
  sink: MortarOverdriveRuntimeAudioSink | null,
  entityId: number,
  self: boolean,
  wasActive: boolean,
  drive: VehicleDrive | null,
  audible: boolean,
  x: number,
  y: number,
  z: number,
  acceleration: number,
): boolean {
  if (!sink) return wasActive;
  const action = mortarOverdriveVehicleAudioAction(wasActive, drive !== null, audible);
  if (action === 'stop') {
    sink.stopVehicle(entityId);
    return false;
  }
  if (action !== 'run' || !drive) return wasActive;
  const vehicle = vehicleProfile(drive.profileKey);
  // Speed OVER THE GROUND, not the forward component. The driving kernel
  // conserves the velocity vector through the body rotation, so a drift is
  // exactly the process of moving pace out of `speed` and into `slip`: reading
  // the forward component alone dives the engine pitch and thins the tyre roll
  // purely because the machine is sideways, which is when both should be at
  // their most urgent. src/sim/vehicle_motion.ts refuses the same mistake for
  // steering authority, for the same reason.
  const speedFraction = Math.min(1, Math.hypot(drive.speed, drive.slip) / vehicle.maxSpeed);
  const effort = Math.min(1, speedFraction * 0.2 + Math.max(0, acceleration) / vehicle.engineAccel);
  sink.vehicle(
    entityId,
    self,
    x,
    y,
    z,
    speedFraction,
    effort,
    drive.slip,
    vehicleIsOffRoad(drive.dragMult),
  );
  return true;
}
