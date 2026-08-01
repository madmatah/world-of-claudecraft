// Deterministic Realm Racers establishing shot. The sim's authoritative
// countdown clock drives the pose, so late snapshots join at the right point
// and frame rate cannot change when the camera reaches the normal chase view.

import { TICK_RATE } from '../sim/types';
import type {
  RealmRacersMatchInfo,
  RealmRacersPhase,
} from '../world_api/realm_racers';
import type { CameraPose } from './spawn_cinematic';

export const REALM_RACERS_START_TICKS = 9 * TICK_RATE;
export const REALM_RACERS_PANORAMA_TICKS = 6 * TICK_RATE;
export const REALM_RACERS_OVERVIEW_TICKS = REALM_RACERS_PANORAMA_TICKS;

const GAMEPLAY_PITCH = 0.32;
const OPENING_DIST = 55;
const OPENING_PITCH = 0.95;
const OPENING_TURNS = 0.3;

export interface RealmRacersStartCameraState {
  matchId: number | null;
  targetYaw: number;
  targetDist: number;
}

export interface RealmRacersStartCameraInput {
  matchId: number | null;
  phase: RealmRacersPhase | null;
  countdownTicks: number;
  facing: number;
  liveDist: number;
  reducedMotion: boolean;
}

export interface RealmRacersLiveCamera {
  camYaw: number;
  camPitch: number;
  camDist: number;
}

export function createRealmRacersStartCamera(): RealmRacersStartCameraState {
  return { matchId: null, targetYaw: 0, targetDist: 12 };
}

/** Map the host-neutral race mirror into the deterministic camera input. */
export function realmRacersStartCameraInput(
  match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks'> | null,
  facing: number,
  liveDist: number,
  reducedMotion: boolean,
): RealmRacersStartCameraInput {
  return {
    matchId: match?.id ?? null,
    phase: match?.phase ?? null,
    countdownTicks: match?.countdownTicks ?? 0,
    facing,
    liveDist,
    reducedMotion,
  };
}

/** Execute the complete host adapter and apply its override to the live camera. */
export function applyRealmRacersStartCamera(
  state: RealmRacersStartCameraState,
  target: RealmRacersLiveCamera,
  match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks'> | null,
  facing: number,
  reducedMotion: boolean,
): boolean {
  const pose = stepRealmRacersStartCamera(
    state,
    realmRacersStartCameraInput(match, facing, target.camDist, reducedMotion),
  );
  if (!pose) return false;
  target.camYaw = pose.yaw;
  target.camPitch = pose.pitch;
  target.camDist = pose.dist;
  return true;
}

/** Host coordinator: read the current mirror rather than accepting a detached match copy. */
export function applyRealmRacersStartCameraFromWorld(
  state: RealmRacersStartCameraState,
  target: RealmRacersLiveCamera,
  world: {
    realmRacersInfo: {
      match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks'> | null;
    };
  },
  facing: number,
  reducedMotion: boolean,
): boolean {
  return applyRealmRacersStartCamera(
    state,
    target,
    world.realmRacersInfo.match,
    facing,
    reducedMotion,
  );
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smootherstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/** Return a cinematic override during countdown, or null once gameplay owns the camera. */
export function stepRealmRacersStartCamera(
  state: RealmRacersStartCameraState,
  input: RealmRacersStartCameraInput,
): CameraPose | null {
  if (input.matchId === null || input.phase !== 'countdown') {
    state.matchId = null;
    return null;
  }
  if (state.matchId !== input.matchId) {
    state.matchId = input.matchId;
    state.targetYaw = input.facing;
    state.targetDist = input.liveDist;
  }

  const end = { yaw: state.targetYaw, pitch: GAMEPLAY_PITCH, dist: state.targetDist };
  if (input.reducedMotion) return end;

  const elapsed = REALM_RACERS_START_TICKS - Math.max(0, input.countdownTicks);
  if (elapsed >= REALM_RACERS_OVERVIEW_TICKS) return end;
  const openingYaw = state.targetYaw - OPENING_TURNS * Math.PI * 2;
  // One easing curve owns yaw, pitch and distance all the way to the normal
  // chase pose. A separate settle segment visibly changed speed and direction
  // just before the start line came into view.
  const t = smootherstep(elapsed / REALM_RACERS_PANORAMA_TICKS);
  return {
    yaw: mix(openingYaw, end.yaw, t),
    pitch: mix(OPENING_PITCH, end.pitch, t),
    dist: mix(OPENING_DIST, end.dist, t),
  };
}
