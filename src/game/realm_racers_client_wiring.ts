// The Realm Racers pieces the client frame loop and the chat send path compose,
// kept out of src/main.ts so the coordinator stays a firewall: the pilot's
// facing lane, the start-camera tick, and the circuit-draft dev hook.
//
// Behind the wheel the heading belongs to the vehicle kernel on BOTH sides: the
// server refuses a streamed facing from a driver (it would overwrite the
// steering it just integrated), so the client stops claiming the channel, keeps
// its turn keys on the wire as steering input, and lets the self extrapolator's
// predicted heading pose the model. The offline host honors the same rule: a
// pilot's heading is STEERED (the movement kernel integrates it from the
// steering input), so the camera never claims it while driving.

import type { RealmRacersCircuit } from '../sim/content/realm_racers_circuits';
import type { RealmRacersDraftHookDeps } from './dev_chat_hooks';
import type { KeyboardTurnArgs } from './keyboard_turn_facing';
import {
  applyRealmRacersStartCameraFromWorld,
  createRealmRacersStartCamera,
  type RealmRacersLiveCamera,
} from './realm_racers_start_camera';

/**
 * Put the keyboard-turn args of a pilot on the raw lane. Keyboard turns
 * normally integrate TURN_SPEED locally and STREAM the resulting heading on the
 * facing channel, with the turn flags zeroed on the wire. A pilot's turn keys
 * are steering intent instead: the flags ride the wire untouched and no local
 * heading claims the channel. A no-op on foot.
 */
export function applyDriveFacingLane(args: KeyboardTurnArgs, driving: boolean): void {
  if (!driving) return;
  args.rawTurnIntent = true;
  args.turnAllowed = false;
  args.sentFacing = null;
}

/** Drive the deterministic establishing shot off the world's race mirror. */
export function createStartCameraTick(
  camera: RealmRacersLiveCamera,
  world: Parameters<typeof applyRealmRacersStartCameraFromWorld>[2],
  reducedMotion: () => boolean,
): (facing: number) => void {
  const state = createRealmRacersStartCamera();
  return (facing) => {
    applyRealmRacersStartCameraFromWorld(state, camera, world, facing, reducedMotion());
  };
}

/**
 * The `/dev rallydraft` deps: the offline sim registers the draft (null online)
 * and the live renderer draws it. The renderer is read at draw time because the
 * draft is fetched first and a graphics rebuild can swap it in between.
 */
export function draftChatHook(
  sim: RealmRacersDraftHookDeps['sim'],
  renderer: () => { registerRealmRacersDraftCircuit(circuit: RealmRacersCircuit): void },
): RealmRacersDraftHookDeps {
  return { sim, draw: (circuit) => renderer().registerRealmRacersDraftCircuit(circuit) };
}
