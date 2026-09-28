import { describe, expect, it } from 'vitest';
import {
  applyKeyboardTurnInput,
  type KeyboardTurnArgs,
  newKeyboardTurnState,
  stepKeyboardTurnFacing,
} from '../src/game/keyboard_turn_facing';
import {
  applyDriveFacingLane,
  createStartCameraTick,
  draftChatHook,
} from '../src/game/realm_racers_client_wiring';
import type { RealmRacersCircuit } from '../src/sim/content/realm_racers_circuits';

const footArgs = (): KeyboardTurnArgs => ({
  rawTurnIntent: false,
  turnLeft: true,
  turnRight: false,
  turnAllowed: true,
  sentFacing: 1.25,
  serverFacing: 0.5,
  releaseCommitAcknowledged: false,
  echoMs: 80,
  snapshotIntervalMs: 50,
  movementWireVersion: 2,
  frameDt: 1 / 60,
});

describe('Realm Racers drive facing lane', () => {
  it('leaves a player on foot exactly as the keyboard-turn path filled them', () => {
    const args = footArgs();
    applyDriveFacingLane(args, false);
    expect(args).toEqual(footArgs());
  });

  it('puts a pilot on the raw lane: no local heading, turn flags ride the wire', () => {
    const args = { ...footArgs(), rawTurnIntent: false };
    applyDriveFacingLane(args, true);
    expect(args).toEqual({
      ...footArgs(),
      rawTurnIntent: true,
      turnAllowed: false,
      sentFacing: null,
    });

    const state = newKeyboardTurnState();
    expect(stepKeyboardTurnFacing(state, args)).toBeNull();
    const wire = { turnLeft: false, turnRight: false };
    applyKeyboardTurnInput(wire, { turnLeft: true, turnRight: false }, state);
    expect(wire).toEqual({ turnLeft: true, turnRight: false });
  });
});

describe('Realm Racers start camera tick', () => {
  it('latches the grid pose for the whole countdown and reads reduced motion per call', () => {
    const camera = { camYaw: 9, camPitch: 9, camDist: 15 };
    const world = {
      realmRacersInfo: {
        match: { id: 7, phase: 'countdown' as const, countdownTicks: 60, elapsedTicks: 0 },
      },
    };
    let reduced = false;
    const reads: boolean[] = [];
    const tick = createStartCameraTick(camera, world, () => {
      reads.push(reduced);
      return reduced;
    });
    tick(1.4);
    expect(camera).toEqual({ camYaw: 1.4, camPitch: 0.2, camDist: 22 });
    reduced = true;
    tick(-0.8);
    expect(camera).toEqual({ camYaw: 1.4, camPitch: 0.2, camDist: 22 });
    expect(reads).toEqual([false, true]);
  });

  it('hands the camera back once the match leaves the mirror', () => {
    const camera = { camYaw: 0, camPitch: 0, camDist: 12 };
    const world: {
      realmRacersInfo: {
        match: {
          id: number;
          phase: 'countdown';
          countdownTicks: number;
          elapsedTicks: number;
        } | null;
      };
    } = {
      realmRacersInfo: {
        match: { id: 8, phase: 'countdown', countdownTicks: 60, elapsedTicks: 0 },
      },
    };
    const tick = createStartCameraTick(camera, world, () => false);
    tick(0.3);
    world.realmRacersInfo.match = null;
    tick(2);
    expect(camera).toEqual({ camYaw: 0.3, camPitch: 0.32, camDist: 12 });
    camera.camYaw = 5;
    tick(2);
    expect(camera.camYaw).toBe(5);
  });
});

describe('Realm Racers circuit-draft chat hook', () => {
  it('passes the sim through and draws on the renderer live at draw time', () => {
    const drawnBy: string[] = [];
    const rendererNamed = (name: string) => ({
      registerRealmRacersDraftCircuit: (_circuit: RealmRacersCircuit) => drawnBy.push(name),
    });
    let renderer = rendererNamed('boot');
    const hook = draftChatHook(null, () => renderer);
    expect(hook.sim).toBeNull();
    renderer = rendererNamed('rebuilt');
    hook.draw({} as RealmRacersCircuit);
    expect(drawnBy).toEqual(['rebuilt']);

    const sim = { realmRacersRegisterDraftCircuit: () => ({ lane: 3, problems: [] }) };
    expect(draftChatHook(sim, () => renderer).sim).toBe(sim);
  });
});
