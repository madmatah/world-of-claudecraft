import { describe, expect, it } from 'vitest';
import {
  applyKeyboardTurnInput,
  type KeyboardTurnArgs,
  newKeyboardTurnState,
  stepKeyboardTurnFacing,
} from '../src/game/keyboard_turn_facing';
import {
  applyDriveFacingLane,
  cameraFacing,
  createStartCameraTick,
  draftChatHook,
} from '../src/game/mortar_overdrive/client_wiring';
import type { MortarOverdriveCircuit } from '../src/sim/content/mortar_overdrive/circuits';

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

describe('Mortar Overdrive online camera heading', () => {
  it('follows the predicted heading behind the wheel and the keyboard facing on foot', () => {
    const renderer = { mortarOverdrive: { selfMotionFacing: 1.1 as number | null } };
    const pilot = { drive: {} as never };
    expect(cameraFacing(pilot, renderer, 0.4, -2)).toBe(1.1);
    expect(cameraFacing({ drive: null }, renderer, 0.4, -2)).toBe(0.4);
    renderer.mortarOverdrive.selfMotionFacing = null;
    expect(cameraFacing(pilot, renderer, 0.4, -2)).toBe(-2);
    expect(cameraFacing({ drive: null }, renderer, null, -2)).toBe(-2);
  });
});

describe('Mortar Overdrive drive facing lane', () => {
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

describe('Mortar Overdrive start camera tick', () => {
  it('latches the grid pose for the whole countdown and reads reduced motion per call', () => {
    const camera = { camYaw: 9, camPitch: 9, camDist: 15 };
    const world = {
      mortarOverdriveInfo: {
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
      mortarOverdriveInfo: {
        match: {
          id: number;
          phase: 'countdown';
          countdownTicks: number;
          elapsedTicks: number;
        } | null;
      };
    } = {
      mortarOverdriveInfo: {
        match: { id: 8, phase: 'countdown', countdownTicks: 60, elapsedTicks: 0 },
      },
    };
    const tick = createStartCameraTick(camera, world, () => false);
    tick(0.3);
    world.mortarOverdriveInfo.match = null;
    tick(2);
    expect(camera).toEqual({ camYaw: 0.3, camPitch: 0.32, camDist: 12 });
    camera.camYaw = 5;
    tick(2);
    expect(camera.camYaw).toBe(5);
  });
});

describe('Mortar Overdrive circuit-draft chat hook', () => {
  it('passes the sim through and draws on the renderer live at draw time', () => {
    const drawnBy: string[] = [];
    const rendererNamed = (name: string) => ({
      mortarOverdrive: {
        registerDraftCircuit: (_circuit: MortarOverdriveCircuit) => drawnBy.push(name),
      },
    });
    let renderer = rendererNamed('boot');
    const hook = draftChatHook(null, () => renderer);
    expect(hook.sim).toBeNull();
    renderer = rendererNamed('rebuilt');
    hook.draw({} as MortarOverdriveCircuit);
    expect(drawnBy).toEqual(['rebuilt']);

    const sim = { mortarOverdriveRegisterDraftCircuit: () => ({ lane: 3, problems: [] }) };
    expect(draftChatHook(sim, () => renderer).sim).toBe(sim);
  });
});
