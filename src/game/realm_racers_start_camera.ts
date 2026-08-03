// Deterministic Realm Racers establishing shot. The sim's authoritative race
// clock drives the pose (the countdown remainder, then the ticks since the
// flag), so late snapshots join at the right point and frame rate cannot change
// when the camera reaches the normal chase view.

import { TICK_RATE } from '../sim/types';
import type { RealmRacersMatchInfo, RealmRacersPhase } from '../world_api/realm_racers';
import type { CameraPose } from './spawn_cinematic';

export const REALM_RACERS_START_TICKS = 9 * TICK_RATE;
export const REALM_RACERS_PANORAMA_TICKS = 6 * TICK_RATE;
export const REALM_RACERS_OVERVIEW_TICKS = REALM_RACERS_PANORAMA_TICKS;

const GAMEPLAY_PITCH = 0.32;
const OPENING_DIST = 55;
const OPENING_PITCH = 0.95;
const OPENING_TURNS = 0.3;

// The grid pose, held for the whole light sequence. The lamps hang 10.2 yards up
// under the arch beam and the grid sits barely 7.4 yards behind the line, so the
// gameplay pose (pitched 0.32 DOWN, 12 yards back) puts them 99% of the way to
// the top edge of the frame, and off it as often as not. Easing the pitch off and
// lengthening the arm drops them to around 54% of the way up, which is where a
// start light belongs. The pitch and the arm move TOGETHER: pitch alone raises
// the camera but carries the lamps back up the frame with it, and the extra
// length is what buys the height back. This pair holds the eye 6.9 yards up,
// looking down over the grid. `tests/realm_racers_start_camera.test.ts` projects
// both poses through the renderer's own camera placement and pins the difference.
const GRID_PITCH = 0.2;
const GRID_DIST = 22;
/**
 * Ticks of racing spent easing the grid pose back into the gameplay pose. Ticks
 * rather than seconds because `RealmRacersMatchInfo.elapsed` is floored for the
 * readout: easing on it would hold for a whole second and then pop.
 */
export const REALM_RACERS_HANDOFF_TICKS = 1.2 * TICK_RATE;

export interface RealmRacersStartCameraState {
  matchId: number | null;
  targetYaw: number;
  targetDist: number;
}

export interface RealmRacersStartCameraInput {
  matchId: number | null;
  phase: RealmRacersPhase | null;
  countdownTicks: number;
  /** Ticks since the flag, which drives the post-start handoff. */
  elapsedTicks: number;
  facing: number;
  /** The live camera yaw, which the handoff hands straight back to the player. */
  liveYaw: number;
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
  match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks' | 'elapsedTicks'> | null,
  facing: number,
  liveYaw: number,
  liveDist: number,
  reducedMotion: boolean,
): RealmRacersStartCameraInput {
  return {
    matchId: match?.id ?? null,
    phase: match?.phase ?? null,
    countdownTicks: match?.countdownTicks ?? 0,
    elapsedTicks: match?.elapsedTicks ?? 0,
    facing,
    liveYaw,
    liveDist,
    reducedMotion,
  };
}

/** Execute the complete host adapter and apply its override to the live camera. */
export function applyRealmRacersStartCamera(
  state: RealmRacersStartCameraState,
  target: RealmRacersLiveCamera,
  match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks' | 'elapsedTicks'> | null,
  facing: number,
  reducedMotion: boolean,
): boolean {
  const pose = stepRealmRacersStartCamera(
    state,
    realmRacersStartCameraInput(match, facing, target.camYaw, target.camDist, reducedMotion),
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
      match: Pick<RealmRacersMatchInfo, 'id' | 'phase' | 'countdownTicks' | 'elapsedTicks'> | null;
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

/**
 * Return a cinematic override for the start, or null once gameplay owns the
 * camera. The override spans the countdown AND the first
 * `REALM_RACERS_HANDOFF_TICKS` of racing: holding the grid pose through the
 * green light is the whole point of it, so the return to the chase pose has to
 * happen after the flag rather than before it.
 */
export function stepRealmRacersStartCamera(
  state: RealmRacersStartCameraState,
  input: RealmRacersStartCameraInput,
): CameraPose | null {
  const racing = input.phase === 'racing';
  // Releasing means WRITING the gameplay pose one last time, not just returning
  // null: the host only touches pitch and distance through this override, so a
  // silent release strands the player on the grid pose for the whole race (and
  // leaves the next race to capture that pose as their zoom).
  const release = (): CameraPose | null => {
    const held = state.matchId !== null;
    state.matchId = null;
    return held ? { yaw: input.liveYaw, pitch: GAMEPLAY_PITCH, dist: state.targetDist } : null;
  };
  // Racing only ever CONTINUES an override this race opened: a viewer who joins
  // mid-race, or any later phase, gets the plain gameplay camera.
  if (input.matchId === null || (!racing && input.phase !== 'countdown')) return release();
  if (racing && state.matchId !== input.matchId) return release();
  if (state.matchId !== input.matchId) {
    state.matchId = input.matchId;
    state.targetYaw = input.facing;
    state.targetDist = input.liveDist;
  }

  const end = { yaw: state.targetYaw, pitch: GAMEPLAY_PITCH, dist: state.targetDist };
  // Never pull a player who plays zoomed further out back IN for the start; the
  // extra length only lowers the lamps in frame, which is the direction we want.
  const grid = {
    yaw: state.targetYaw,
    pitch: GRID_PITCH,
    dist: Math.max(GRID_DIST, state.targetDist),
  };

  if (racing) {
    // Reduced motion took the grid pose as a static hold, so it leaves it the
    // same way: one cut at the flag rather than a glide the setting exists to
    // suppress.
    const t = input.reducedMotion
      ? 1
      : smootherstep(Math.max(0, input.elapsedTicks) / REALM_RACERS_HANDOFF_TICKS);
    if (t >= 1) return release();
    // Yaw goes back to the player the moment the race is on: writing back the
    // live yaw makes the host's write an identity, so mouselook and the follow
    // camera keep owning the heading through the handoff. Only the pitch and
    // the arm are still being handed back.
    return {
      yaw: input.liveYaw,
      pitch: mix(grid.pitch, end.pitch, t),
      dist: mix(grid.dist, end.dist, t),
    };
  }

  // The lamps are as much a start signal as the countdown text, so reduced
  // motion loses the sweep but keeps the framing that makes them readable.
  if (input.reducedMotion) return grid;

  const elapsed = REALM_RACERS_START_TICKS - Math.max(0, input.countdownTicks);
  if (elapsed >= REALM_RACERS_OVERVIEW_TICKS) return grid;
  const openingYaw = state.targetYaw - OPENING_TURNS * Math.PI * 2;
  // One easing curve owns yaw, pitch and distance all the way to the grid pose.
  // A separate settle segment visibly changed speed and direction just before
  // the start line came into view.
  const t = smootherstep(elapsed / REALM_RACERS_PANORAMA_TICKS);
  return {
    yaw: mix(openingYaw, grid.yaw, t),
    pitch: mix(OPENING_PITCH, grid.pitch, t),
    dist: mix(OPENING_DIST, grid.dist, t),
  };
}
