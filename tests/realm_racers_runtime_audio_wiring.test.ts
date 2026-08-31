import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimEvent, VehicleDrive } from '../src/sim/types';

const audioSpies = vi.hoisted(() => ({ realmRacersResult: vi.fn() }));
vi.mock('../src/game/audio', () => ({ audio: audioSpies }));

import { createOwnBumpFeedback, markLocalBump } from '../src/render/own_bump_feedback_core';
import { Renderer } from '../src/render/renderer';
import { Hud } from '../src/ui/hud';

interface HudHarness {
  sim: {
    playerId: number;
    player: { pos: { x: number; z: number } };
    craftingIdentity: { synced: boolean };
    craftSkills: Record<string, number>;
  };
  renderer: { handleEvent: ReturnType<typeof vi.fn> };
  playEventSfx: ReturnType<typeof vi.fn>;
  meters: { onEvent: ReturnType<typeof vi.fn> };
  isNythraxisEvent: ReturnType<typeof vi.fn>;
  showBanner: ReturnType<typeof vi.fn>;
  combatLog: ReturnType<typeof vi.fn>;
  prevCraftSkills: Record<string, number> | null;
  craftTierUpDrains: number;
  handleEvents(events: SimEvent[]): void;
}

function hudHarness(): HudHarness {
  const hud = Object.create(Hud.prototype) as unknown as HudHarness;
  hud.sim = {
    playerId: 7,
    player: { pos: { x: 0, z: 0 } },
    craftingIdentity: { synced: false },
    craftSkills: {},
  };
  hud.renderer = { handleEvent: vi.fn() };
  hud.playEventSfx = vi.fn();
  hud.meters = { onEvent: vi.fn() };
  hud.isNythraxisEvent = vi.fn(() => false);
  hud.showBanner = vi.fn();
  hud.combatLog = vi.fn();
  hud.prevCraftSkills = null;
  hud.craftTierUpDrains = 0;
  return hud;
}

const result = (won: boolean, forfeited: boolean, winnerName: string, pid = 7): SimEvent =>
  ({
    type: 'realmRacersResult',
    won,
    forfeited,
    winnerName,
    returnTicks: 80,
    pid,
  }) as SimEvent;

interface RendererHarness {
  realmRacersGroundBlasts: { fire: ReturnType<typeof vi.fn>; impact: ReturnType<typeof vi.fn> };
  groundSample(x: number, z: number): number;
  vfx: { burst: ReturnType<typeof vi.fn>; groundPuff: ReturnType<typeof vi.fn> };
  audioSink: {
    realmRacersEvent: ReturnType<typeof vi.fn>;
    vehicle: ReturnType<typeof vi.fn>;
    stopVehicle: ReturnType<typeof vi.fn>;
    mountEngineReset: ReturnType<typeof vi.fn>;
    stopMountLoop: ReturnType<typeof vi.fn>;
  };
  spawnAoeRing: ReturnType<typeof vi.fn>;
  sim: { playerId: number };
  triggerHit: ReturnType<typeof vi.fn>;
  addShake: ReturnType<typeof vi.fn>;
  punchFov: ReturnType<typeof vi.fn>;
  handleEvent(event: SimEvent): void;
  syncRealmRacersVehicleAudioForView(
    entity: { id: number; drive: VehicleDrive | null },
    view: { vehicleAudioActive: boolean; vehicleLean: { acceleration: number } },
    audible: boolean,
    x: number,
    y: number,
    z: number,
  ): void;
}

function rendererHarness(): RendererHarness {
  const renderer = Object.create(Renderer.prototype) as unknown as RendererHarness;
  renderer.realmRacersGroundBlasts = { fire: vi.fn(), impact: vi.fn() };
  renderer.groundSample = (x, z) => x + z;
  renderer.vfx = { burst: vi.fn(), groundPuff: vi.fn() };
  renderer.audioSink = {
    realmRacersEvent: vi.fn(),
    vehicle: vi.fn(),
    stopVehicle: vi.fn(),
    mountEngineReset: vi.fn(),
    // removeView also stops the release's mount loop for the dropped view.
    stopMountLoop: vi.fn(),
  };
  renderer.spawnAoeRing = vi.fn();
  renderer.sim = { playerId: 1 };
  renderer.triggerHit = vi.fn();
  renderer.addShake = vi.fn();
  renderer.punchFov = vi.fn();
  return renderer;
}

const drive = (): VehicleDrive => ({
  profileKey: 'rally_loaner',
  speed: 30,
  slip: 4,
  steerAngle: 0,
  yawRate: 0,
  spin: 0,
  handbrake: 0,
  gripMult: 1,
  dragMult: 1.8,
  speedCap: 1,
  slipCap: 1,
  collisionImpact: 0,
  controlsLocked: false,
});

/** Assert the last sink.vehicle call argument for argument, with the two derived
 *  fractions compared as floats rather than by exact equality. */
function expectVehicleCall(spy: ReturnType<typeof vi.fn>, expected: (number | boolean)[]): void {
  const call = spy.mock.calls.at(-1);
  expect(call).toBeDefined();
  expect(call).toHaveLength(expected.length);
  for (const [index, want] of expected.entries()) {
    if (typeof want === 'number' && !Number.isInteger(want)) {
      expect(call?.[index]).toBeCloseTo(want, 10);
    } else {
      expect(call?.[index]).toBe(want);
    }
  }
}

beforeEach(() => vi.clearAllMocks());
// One case freezes `performance.now()`; restore it so a frozen clock cannot
// leak into a sibling that reads the real one.
afterEach(() => vi.restoreAllMocks());

describe('Realm Racers coordinator audio wiring', () => {
  it('executes the real HUD result branch with the viewer pid and leaves draws/others silent', () => {
    const hud = hudHarness();
    hud.handleEvents([
      result(true, false, 'Me'),
      result(false, false, 'Rival'),
      result(false, true, 'Rival'),
      result(false, false, ''),
      result(true, false, 'Other', 8),
    ]);

    expect(audioSpies.realmRacersResult.mock.calls.map(([won]) => won)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('executes the real renderer event branches and preserves kind, ground height, and impact', () => {
    const renderer = rendererHarness();
    renderer.handleEvent({
      type: 'realmRacersGroundBlastFired',
      sourceId: 1,
      x: 2,
      z: 3,
      targetX: 4,
      targetZ: 5,
      flightSeconds: 0.8,
    });
    renderer.handleEvent({
      type: 'realmRacersGroundBlastHit',
      sourceId: 1,
      targetId: null,
      x: 4,
      z: 5,
      impact: 0.7,
    });
    renderer.handleEvent({
      type: 'realmRacersBump',
      aId: 1,
      bId: 2,
      x: 6,
      z: 7,
      impact: 12,
    });

    expect(renderer.audioSink.realmRacersEvent.mock.calls).toEqual([
      ['groundBlastFire', 2, 6, 3, undefined],
      ['groundBlastImpact', 4, 9, 5, 0.7],
      ['bump', 6, 13.5, 7, 0.5],
    ]);
  });

  it('suppresses the own-bump duplicate exactly once, remote pairs untouched', () => {
    // The local bang already played at the displayed touch; the server
    // event's cosmetics are its echo and skip ONCE. A second authoritative
    // bump inside the window is a new contact and plays, and a bump between
    // two rivals is never suppressed whatever the latch holds.
    const renderer = rendererHarness();
    const state = createOwnBumpFeedback();
    // The clock is FROZEN for this case rather than read live. The suppression
    // window is 1200 ms and the consume side reads `performance.now()` itself,
    // so a live stamp made the verdict depend on how long the machine took
    // between these lines: generous, but a real-time dependency in a test that
    // is not about time at all. Pinned at a fixed instant, the window is a
    // property of the core instead of a property of the run.
    const nowMs = 10_000;
    vi.spyOn(performance, 'now').mockReturnValue(nowMs);
    markLocalBump(state, 2, nowMs);
    markLocalBump(state, 3, nowMs);
    (renderer as unknown as { ownBumpFeedbackState: unknown }).ownBumpFeedbackState = state;
    const bump = (aId: number, bId: number) => {
      renderer.handleEvent({ type: 'realmRacersBump', aId, bId, x: 6, z: 7, impact: 12 });
    };
    bump(1, 2); // the echo of the local bang: silent
    expect(renderer.audioSink.realmRacersEvent).not.toHaveBeenCalled();
    bump(2, 1); // consumed: a genuinely new bump plays
    expect(renderer.audioSink.realmRacersEvent).toHaveBeenCalledTimes(1);
    bump(3, 4); // two rivals: the latch for 3 is not even consulted
    expect(renderer.audioSink.realmRacersEvent).toHaveBeenCalledTimes(2);
  });

  it('executes the renderer vehicle-view coordinator through run and race exit', () => {
    const renderer = rendererHarness();
    const entity: { id: number; drive: VehicleDrive | null } = { id: 77, drive: drive() };
    const view = { vehicleAudioActive: false, vehicleLean: { acceleration: 6 } };

    // speed 30 with slip 4 on a 60 yd/s machine: the fraction is the GROUND
    // speed, so the sideways component counts toward how hard the engine reads.
    const groundFraction = Math.hypot(30, 4) / 60;
    const effort = groundFraction * 0.2 + 6 / 20;

    renderer.syncRealmRacersVehicleAudioForView(entity, view, true, 2, 0, 3);
    expect(view.vehicleAudioActive).toBe(true);
    expectVehicleCall(renderer.audioSink.vehicle, [
      77,
      false,
      2,
      0,
      3,
      groundFraction,
      effort,
      4,
      true,
    ]);

    renderer.sim.playerId = 77;
    renderer.syncRealmRacersVehicleAudioForView(entity, view, true, 2, 0, 3);
    expectVehicleCall(renderer.audioSink.vehicle, [
      77,
      true,
      2,
      0,
      3,
      groundFraction,
      effort,
      4,
      true,
    ]);

    entity.drive = null;
    renderer.syncRealmRacersVehicleAudioForView(entity, view, true, 2, 0, 3);
    expect(view.vehicleAudioActive).toBe(false);
    expect(renderer.audioSink.stopVehicle).toHaveBeenCalledWith(77);
  });

  it('stops a racer vehicle loop when its view is dropped for leaving interest range', () => {
    const renderer = rendererHarness() as unknown as {
      views: Map<number, unknown>;
      scene: { remove: ReturnType<typeof vi.fn> };
      lightOwnerGroups: { delete: ReturnType<typeof vi.fn> };
      healGlowAt: Map<number, number>;
      weaponSkinApplies: { cancel: ReturnType<typeof vi.fn> };
      viewLights: unknown[];
      clickTargets: unknown[];
      audioSink: { stopVehicle: ReturnType<typeof vi.fn> };
      nameplatePainter: { remove: ReturnType<typeof vi.fn> };
      removeView(id: number): void;
    };
    renderer.scene = { remove: vi.fn() };
    renderer.lightOwnerGroups = { delete: vi.fn() };
    // Dropping a view also clears the per-entity heal-glow throttle and cancels
    // any pending weapon-skin application aimed at it.
    renderer.healGlowAt = new Map();
    renderer.weaponSkinApplies = { cancel: vi.fn() };
    // Overhead text is one batched canvas surface now, keyed by entity id, so
    // dropping a view unregisters it there rather than detaching a DOM plate.
    renderer.nameplatePainter = { remove: vi.fn() };
    renderer.viewLights = [];
    renderer.clickTargets = [];
    const view = {
      vehicleAudioActive: true,
      // removeView also runs the release's raid-encounter teardown over the
      // group, which probes it by name; a bare object is enough for a racer.
      group: { getObjectByName: () => undefined },
      viewLights: [],
      clickTarget: {},
      visual: { dispose: vi.fn() },
      visualPoolKey: null,
    };
    renderer.views = new Map([[77, view]]);

    // The server stopped including this racer's entity in the snapshot (it
    // left the ~120yd interest scope), so the interest-churn sweep drops its
    // view. This is the literal "leaving interest range" path, distinct from
    // the audible-range mute covered by the run/race-exit test above.
    renderer.removeView(77);

    expect(renderer.audioSink.stopVehicle).toHaveBeenCalledWith(77);
    expect(renderer.views.has(77)).toBe(false);
  });

  it('pins the exact Renderer.sync vehicle arguments and camera output dataflow', () => {
    const prototype = Renderer.prototype as unknown as {
      sync: (...args: unknown[]) => void;
      updateCamera: (...args: unknown[]) => void;
    };
    const syncSource = prototype.sync.toString();
    expect(syncSource).toMatch(
      /this\.syncRealmRacersVehicleAudioForView\(\s*e,\s*v,\s*d2 < SFX_MOVE_RANGE_SQ,\s*ax,\s*ay,\s*az,?\s*\)/,
    );

    const cameraSource = prototype.updateCamera
      .toString()
      .replace(/\(0,__vite_ssr_import_\d+__\.([A-Za-z0-9_]+)\)\(/g, '$1(');
    expect(cameraSource).toMatch(
      /const boomProfile = stepCameraBoomForDriving\(\s*this\.camBoom,\s*selfPos\.x,\s*selfPos\.y,\s*selfPos\.z,\s*dt,\s*reduce \? 4 : 1,\s*driving,?\s*\)/,
    );
    expect(cameraSource).toContain('cameraBoomDistance(pose.dist, boomProfile)');
    // The listener rides the camera and looks at the chase pivot, but the audio
    // ANCHOR is the machine itself. The pivot lags and leads by yards through a
    // corner, and handing that to setListener is what panned the pilot's own
    // engine into the inside ear.
    expect(cameraSource).toMatch(
      /sink\.setListener\(\s*cpx,\s*cpy,\s*cpz,\s*fx \/ fl,\s*fy \/ fl,\s*fz \/ fl,\s*selfPos\.x,\s*selfPos\.y,\s*selfPos\.z,?\s*\)/,
    );
    expect(cameraSource).toMatch(
      /const feelFovOffset = stepCameraFeelForDriving\([\s\S]*?driving\s*\)/,
    );
    // The base is the player's own setCameraFov value (the release made it
    // configurable), and the offset stays the driving-aware feel profile's.
    expect(cameraSource).toContain('cameraFeelFovTarget(this.baseFov, feelFovOffset)');
  });
});
