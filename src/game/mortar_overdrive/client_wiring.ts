// The Mortar Overdrive pieces the client frame loop and the chat send path compose,
// kept out of src/main.ts so the coordinator stays a firewall: the pilot's
// facing lane, the online camera heading, the start-camera tick, and the
// circuit-draft dev hook.
//
// Behind the wheel the heading belongs to the vehicle kernel on BOTH sides: the
// server refuses a streamed facing from a driver (it would overwrite the
// steering it just integrated), so the client stops claiming the channel, keeps
// its turn keys on the wire as steering input, and lets the predicted kart's
// heading (the self drive view) pose the model. The offline host honors the
// same rule: a pilot's heading is STEERED (the movement kernel integrates it
// from the steering input), so the camera never claims it while driving.

import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import type { Entity } from '../../sim/types';
import { cameraFollowFacing } from '../camera_follow';
import type { MortarOverdriveDraftHookDeps } from '../dev_chat_hooks';
import type { KeyboardTurnArgs } from '../keyboard_turn_facing';
import {
  applyMortarOverdriveStartCameraFromWorld,
  createMortarOverdriveStartCamera,
  type MortarOverdriveLiveCamera,
} from './start_camera';

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

/**
 * The heading the online chase camera follows (`cameraFollowFacing`): a pilot's
 * comes off the display predictor, the Mortar Overdrive scene's self-motion facing.
 */
export function cameraFacing(
  pilot: Pick<Entity, 'drive'>,
  renderer: { mortarOverdrive: { selfMotionFacing: number | null } },
  keyboardFacing: number | null,
  serverFacing: number,
): number {
  const predicted = renderer.mortarOverdrive.selfMotionFacing;
  return cameraFollowFacing(pilot.drive != null, predicted, keyboardFacing, serverFacing);
}

/** Drive the deterministic establishing shot off the world's race mirror. */
export function createStartCameraTick(
  camera: MortarOverdriveLiveCamera,
  world: Parameters<typeof applyMortarOverdriveStartCameraFromWorld>[2],
  reducedMotion: () => boolean,
): (facing: number) => void {
  const state = createMortarOverdriveStartCamera();
  return (facing) => {
    applyMortarOverdriveStartCameraFromWorld(state, camera, world, facing, reducedMotion());
  };
}

/**
 * The `/dev overdrivedraft` deps: the offline sim registers the draft (null online)
 * and the live renderer draws it. The renderer is read at draw time because the
 * draft is fetched first and a graphics rebuild can swap it in between.
 */
export function draftChatHook(
  sim: MortarOverdriveDraftHookDeps['sim'],
  renderer: () => {
    mortarOverdrive: { registerDraftCircuit(circuit: MortarOverdriveCircuit): void };
  },
): MortarOverdriveDraftHookDeps {
  return { sim, draw: (circuit) => renderer().mortarOverdrive.registerDraftCircuit(circuit) };
}
