import { vehicleProfile } from '../sim/content/vehicles';
import type { SimEvent, VehicleDrive } from '../sim/types';
import type { RealmRacersAudioEvent } from './audio_sink';
import {
  type RealmRacersSpatialAudioCue,
  realmRacersScrapeAudioCue,
  realmRacersSpatialAudioCue,
  realmRacersVehicleAudioAction,
} from './realm_racers_audio_core';
import { vehicleIsOffRoad } from './vehicle_lean_core';

export interface RealmRacersRuntimeAudioSink {
  vehicle(
    entityId: number,
    x: number,
    y: number,
    z: number,
    speedFraction: number,
    effort: number,
    slip: number,
    offRoad: boolean,
  ): void;
  stopVehicle(entityId: number): void;
  realmRacersEvent(
    kind: RealmRacersAudioEvent,
    x: number,
    y: number,
    z: number,
    impact?: number,
  ): void;
}

export type RealmRacersGroundSample = (x: number, z: number) => number;

function playRealmRacersCue(
  sink: RealmRacersRuntimeAudioSink | null,
  groundSample: RealmRacersGroundSample,
  cue: RealmRacersSpatialAudioCue | null,
): void {
  if (!sink || !cue) return;
  sink.realmRacersEvent(
    cue.kind,
    cue.x,
    groundSample(cue.x, cue.z) + cue.heightOffset,
    cue.z,
    cue.impact,
  );
}

/** Execute the exact renderer relay for an authoritative rally world event. */
export function playRealmRacersEventAudio(
  sink: RealmRacersRuntimeAudioSink | null,
  groundSample: RealmRacersGroundSample,
  event: SimEvent,
): void {
  playRealmRacersCue(sink, groundSample, realmRacersSpatialAudioCue(event));
}

export function playRealmRacersScrapeAudio(
  sink: RealmRacersRuntimeAudioSink | null,
  groundSample: RealmRacersGroundSample,
  x: number,
  z: number,
  impact: number,
): void {
  playRealmRacersCue(sink, groundSample, realmRacersScrapeAudioCue(x, z, impact));
}

/** Start/update or tear down the real three-loop vehicle mix for one render frame. */
export function syncRealmRacersVehicleAudio(
  sink: RealmRacersRuntimeAudioSink | null,
  entityId: number,
  wasActive: boolean,
  drive: VehicleDrive | null,
  audible: boolean,
  x: number,
  y: number,
  z: number,
  acceleration: number,
): boolean {
  if (!sink) return wasActive;
  const action = realmRacersVehicleAudioAction(wasActive, drive !== null, audible);
  if (action === 'stop') {
    sink.stopVehicle(entityId);
    return false;
  }
  if (action !== 'run' || !drive) return wasActive;
  const vehicle = vehicleProfile(drive.profileKey);
  const speedFraction = Math.min(1, Math.abs(drive.speed) / vehicle.maxSpeed);
  const effort = Math.min(1, speedFraction * 0.2 + Math.max(0, acceleration) / vehicle.engineAccel);
  sink.vehicle(
    entityId,
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
