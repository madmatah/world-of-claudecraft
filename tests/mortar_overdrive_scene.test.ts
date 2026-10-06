// The Mortar Overdrive scene the renderer delegates to (mortar_overdrive/scene.ts): the
// tracks, pools, sky and preparation seam, the race's instant feedback and the
// Mortar Overdrive events. It reads private renderer members through an untyped host, so
// the last block welds every name it reads to renderer.ts, and pins each
// delegate call site where the frame runs it.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));
// The shell pool mints its marker texture at construction, which needs a DOM
// canvas; the rest of the textures module is the real one.
vi.mock('../src/render/textures', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/render/textures')>()),
  mortarOverdriveGroundBlastMarkerTexture: () =>
    new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
}));

import {
  createContactKick,
  retireContactKick,
} from '../src/render/mortar_overdrive/contact_kick_core';
import { MortarOverdriveScene } from '../src/render/mortar_overdrive/scene';
import {
  mortarOverdriveSkyDayNightBiome,
  mortarOverdriveThemeAt,
} from '../src/render/mortar_overdrive/themes';
import { createOwnBumpFeedback, markLocalBump } from '../src/render/own_bump_feedback_core';
import { createRemoteVehicleDisplay } from '../src/render/remote_vehicle_display_core';
import { createSelfRenderPositionState } from '../src/render/self_render_position_core';
import {
  MORTAR_OVERDRIVE_LANES,
  mortarOverdriveLaneAt,
  mortarOverdriveLaneOrigin,
} from '../src/sim/mortar_overdrive/layout';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { stripComments } from './helpers/strip_comments';

const SELF = 1;
const RIVAL = 2;
const STRANGER = 9;
const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

function sceneHost(extra: Record<string, unknown> = {}) {
  return {
    sim: {
      playerId: SELF,
      player: { id: SELF, pos: { x: 0, y: 0, z: 0 }, facing: 0, drive: null, netUpdatedAt: 0 },
      mortarOverdriveInfo: { match: null },
      mortarOverdriveTrackside: null,
    },
    views: new Map(),
    vfx: { burst: vi.fn(), groundPuff: vi.fn() },
    audioSink: { mortarOverdriveEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() },
    selfRender: {
      drive: { source: 'none', velocityX: 0, velocityZ: 0 },
      contactKick: createContactKick(),
    },
    time: 3,
    groundSample: ground,
    spawnAoeRing: vi.fn(),
    addShake: vi.fn(),
    punchFov: vi.fn(),
    triggerHit: vi.fn(),
    createRequiredView: vi.fn((id: number | null) => (id === null ? 0 : 1)),
    ...extra,
  };
}

describe('the Mortar Overdrive scene', () => {
  it('asks the circuit under the viewer once a frame, and nothing outside the band', () => {
    const scene = new MortarOverdriveScene(sceneHost());
    const ensure = vi.spyOn(scene.sky, 'ensure').mockResolvedValue(true);
    const town = scene.ambienceAt(0, 0, 0);
    expect(town).toEqual({
      inMortarOverdrive: false,
      theme: null,
      circuit: null,
      gradeBiome: null,
    });
    expect(ensure).not.toHaveBeenCalled();

    const lane = mortarOverdriveLaneOrigin(MORTAR_OVERDRIVE_LANES[0].index);
    const band = scene.ambienceAt(lane.x, lane.z, lane.x);
    const theme = mortarOverdriveThemeAt(lane.x, lane.z);
    expect(band.inMortarOverdrive).toBe(true);
    expect(band.theme).toBe(theme);
    expect(band.circuit).toBe(mortarOverdriveLaneAt(lane.x, lane.z)?.circuit ?? null);
    expect(band.gradeBiome).toBe(mortarOverdriveSkyDayNightBiome(theme.sky.biome));
    expect(ensure).toHaveBeenCalledExactlyOnceWith(theme.sky.biome);
    // One reused answer: the ambience pass allocates nothing per frame.
    expect(band).toBe(town);
  });

  it("lays the theme's own haze on the frame the fog turns to the circuit", () => {
    const scene = new MortarOverdriveScene(sceneHost());
    vi.spyOn(scene.sky, 'ensure').mockResolvedValue(true);
    const lane = mortarOverdriveLaneOrigin(MORTAR_OVERDRIVE_LANES[0].index);
    scene.ambienceAt(lane.x, lane.z, lane.x);
    const fog = new THREE.Fog(0x000000, 1, 2);
    scene.applyFog(fog, lane.x, lane.z);
    const haze = mortarOverdriveThemeAt(lane.x, lane.z).sky.fog;
    expect([fog.color.getHex(), fog.near, fog.far]).toEqual([haze.color, haze.near, haze.far]);
  });

  it('asks the renderer for every co-pilot view, never the viewer or a stranger', () => {
    const host = sceneHost();
    const scene = new MortarOverdriveScene(host);
    expect(scene.createCoPilotViews([SELF, RIVAL, 3], SELF, [])).toBe(2);
    expect(host.createRequiredView.mock.calls.map(([id]) => id)).toEqual([RIVAL, 3]);
    expect(scene.createCoPilotViews([], SELF, [])).toBe(0);
    expect(scene.createCoPilotViews([RIVAL], STRANGER, [])).toBe(1);
  });

  it('runs the seam before the tracks, a seated pilot on their match, a bystander trackside', () => {
    const host = sceneHost();
    const scene = new MortarOverdriveScene(host);
    const order: string[] = [];
    const seam = (scene as unknown as { prepareSeam: { frame: (...a: unknown[]) => void } })
      .prepareSeam;
    seam.frame = vi.fn(() => order.push('seam'));
    const update = vi.fn(() => order.push('track'));
    scene.track = { update } as unknown as MortarOverdriveScene['track'];
    const trackside = { circuitId: 'fence' };
    host.sim.mortarOverdriveTrackside = trackside as never;
    scene.frame({ queued: false, match: null } as never, 4, 5, 1 / 60);
    expect(order).toEqual(['seam', 'track']);
    expect(update).toHaveBeenLastCalledWith(4, 5, 3, trackside);
    const match = { circuitId: 'mine' };
    scene.frame({ queued: false, match } as never, 4, 5, 1 / 60);
    expect(update).toHaveBeenLastCalledWith(4, 5, 3, match);
  });

  it('bangs a seen contact once and lets the echo of the server event pass silently', () => {
    const drive = createVehicleDrive('mo_loaner');
    const self = {
      id: SELF,
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      drive,
      netUpdatedAt: 1000,
      auras: [],
    };
    const race = {
      phase: 'racing',
      circuitId: 'c',
      standings: [SELF, RIVAL].map((pid) => ({ pid, finished: false, retired: false })),
    };
    const host = sceneHost({
      sim: {
        playerId: SELF,
        player: self,
        mortarOverdriveInfo: { match: race },
        mortarOverdriveTrackside: null,
      },
      selfRender: {
        drive: { source: 'predicted', velocityX: 20, velocityZ: 0 },
        contactKick: createContactKick(),
      },
    });
    const scene = new MortarOverdriveScene(host);
    const rival = {
      id: RIVAL,
      pos: { x: 0.5, y: 0, z: 0 },
      prevPos: { x: 0.5, y: 0, z: 0 },
      facing: 0,
      prevFacing: 0,
      drive: createVehicleDrive('mo_loaner'),
      netUpdatedAt: 1000,
      auras: [],
    };
    const view = { remoteVehicle: createRemoteVehicleDisplay() };
    const pose = { x: 0.5, y: 0, z: 0, facing: 0 };
    scene.projectRival(
      false,
      view,
      rival as never,
      pose,
      null,
      1000,
      1 / 60,
      self as never,
      self.pos,
    );
    // The pose is the projected one, not the interpolated wire pose it came in as.
    expect(view.remoteVehicle.active).toBe(true);
    expect([pose.x, pose.z, pose.facing]).toEqual([
      view.remoteVehicle.x,
      view.remoteVehicle.z,
      view.remoteVehicle.facing,
    ]);
    expect(host.audioSink.mortarOverdriveEvent).toHaveBeenCalledOnce();
    expect(host.addShake).toHaveBeenCalledOnce();
    // The server's event for the same contact is that bang's echo.
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    scene.onEvent({ type: 'mortarOverdriveBump', aId: SELF, bId: RIVAL, x: 0, z: 0, impact: 12 });
    expect(host.audioSink.mortarOverdriveEvent).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
  });

  it('starts the drawn bump at the seen touch, shifts the drawn rival, folds it back once retired', () => {
    const drive = createVehicleDrive('mo_loaner');
    drive.speed = 20;
    const self = {
      id: SELF,
      pos: { x: 0, y: 0, z: 0 },
      facing: 0,
      drive,
      netUpdatedAt: 1000,
      auras: [],
    };
    const race = {
      phase: 'racing',
      circuitId: 'c',
      standings: [SELF, RIVAL].map((pid) => ({ pid, finished: false, retired: false })),
    };
    const selfRender = createSelfRenderPositionState();
    Object.assign(selfRender.drive, {
      source: 'predicted',
      velocityX: 0,
      velocityZ: 20,
      facing: 0,
    });
    const host = sceneHost({
      sim: {
        playerId: SELF,
        player: self,
        mortarOverdriveInfo: { match: race },
        mortarOverdriveTrackside: null,
      },
      selfRender,
    });
    const scene = new MortarOverdriveScene(host);
    const rival = {
      id: RIVAL,
      pos: { x: 0, y: 0, z: 3 },
      prevPos: { x: 0, y: 0, z: 3 },
      facing: 0,
      prevFacing: 0,
      drive: createVehicleDrive('mo_loaner'),
      netUpdatedAt: 1000,
      auras: [],
    };
    const mirrored = JSON.stringify([self, rival]);
    const motion = {
      kind: 'reconciled',
      position: { x: 0, y: 0, z: 0 },
      residual: null,
      drive: { facing: 0, velocityX: 0, velocityZ: 20, onGround: true, state: drive },
      tickOffset: 4,
      tickAlpha: 0.5,
      ackTick: 96,
    } as const;
    const view = { remoteVehicle: createRemoteVehicleDisplay() };
    const pose = { x: 0, y: 0, z: 3, facing: 0 };
    const project = (now: number) =>
      scene.projectRival(
        false,
        view,
        rival as never,
        pose,
        motion as never,
        now,
        1 / 60,
        self as never,
        self.pos,
      );
    project(1000);
    expect(host.audioSink.mortarOverdriveEvent).toHaveBeenCalledOnce();
    const kick = selfRender.contactKick;
    // Touched in the predicted head's client tick: the ack plus the offset.
    expect([kick.rivalId, kick.touchTick]).toEqual([RIVAL, 100]);
    expect(kick.selfVz).toBeLessThan(0);
    expect(kick.rivalVz).toBeGreaterThan(0);
    // The self display grows it; the scene draws the rival's share.
    kick.rivalZ = 0.4;
    project(1016);
    expect(pose.z).toBe(view.remoteVehicle.z + 0.4);
    // Never the mirror, never the wire.
    expect(JSON.stringify([self, rival])).toBe(mirrored);
    // Retired by the self display: folded into the drawn rival before its
    // next projection step, so the drawn pose does not jump.
    const drawnBefore = pose.z;
    retireContactKick(kick);
    project(1032);
    expect(kick.handoffRivalId).toBe(-1);
    expect(pose.z).toBe(view.remoteVehicle.z);
    expect(Math.abs(pose.z - drawnBefore)).toBeLessThan(0.4);
  });

  it('aims every command from the pose without the drawn bump', () => {
    const selfRender = createSelfRenderPositionState();
    const host = sceneHost({ selfRender });
    const scene = new MortarOverdriveScene(host);
    selfRender.active = true;
    selfRender.ready = true;
    selfRender.position.x = 10;
    selfRender.position.z = 20;
    selfRender.contactKick.rivalId = RIVAL;
    selfRender.contactKick.selfX = 1.5;
    selfRender.contactKick.selfZ = -2;
    expect(scene.selfAimPose?.pos).toEqual({ x: 8.5, y: 0, z: 22 });
  });

  it('draws no bump under ?contactkick=0, the bang still plays', async () => {
    vi.resetModules();
    vi.doMock('../src/render/render_dev_flags', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/render/render_dev_flags')>()),
      contactKickRequested: () => false,
    }));
    const { MortarOverdriveScene: Scene } = await import('../src/render/mortar_overdrive/scene');
    const drive = createVehicleDrive('mo_loaner');
    drive.speed = 20;
    const self = { id: SELF, pos: { x: 0, y: 0, z: 0 }, facing: 0, drive, auras: [] };
    const selfRender = createSelfRenderPositionState();
    Object.assign(selfRender.drive, {
      source: 'predicted',
      velocityX: 0,
      velocityZ: 20,
      facing: 0,
    });
    const race = {
      phase: 'racing',
      standings: [SELF, RIVAL].map((pid) => ({ pid, finished: false, retired: false })),
    };
    const host = sceneHost({
      sim: { playerId: SELF, player: self, mortarOverdriveInfo: { match: race } },
      selfRender,
    });
    const scene = new Scene(host as never);
    const rival = {
      id: RIVAL,
      pos: { x: 0, y: 0, z: 3 },
      prevPos: { x: 0, y: 0, z: 3 },
      facing: 0,
      prevFacing: 0,
      drive: createVehicleDrive('mo_loaner'),
      netUpdatedAt: 1000,
      auras: [],
    };
    const motion = {
      kind: 'reconciled',
      position: self.pos,
      residual: null,
      tickOffset: 4,
      tickAlpha: 0.5,
      ackTick: 96,
    };
    scene.projectRival(
      false,
      { remoteVehicle: createRemoteVehicleDisplay() },
      rival as never,
      { x: 0, y: 0, z: 3, facing: 0 },
      motion as never,
      1000,
      1 / 60,
      self as never,
      self.pos,
    );
    expect(host.audioSink.mortarOverdriveEvent).toHaveBeenCalledOnce();
    expect(selfRender.contactKick.rivalId).toBe(-1);
    vi.doUnmock('../src/render/render_dev_flags');
    vi.resetModules();
  });

  it('lifts the drawn hull off the wire pose it read before writing the projection', () => {
    const host = sceneHost();
    const scene = new MortarOverdriveScene(host);
    const drive = createVehicleDrive('mo_loaner');
    drive.speed = 20;
    // Driving +z at 20 yd/s, 100 ms stale: the drawn hull is yards up the road.
    const rival = {
      id: RIVAL,
      pos: { x: 10, y: 3, z: 0 },
      prevPos: { x: 10, y: 3, z: 0 },
      facing: 0,
      prevFacing: 0,
      drive,
      netUpdatedAt: 1000,
      auras: [],
    };
    const view = { remoteVehicle: createRemoteVehicleDisplay() };
    const pose = { x: 10, y: 3, z: 0, facing: 0 };
    const player = host.sim.player as never;
    scene.projectRival(false, view, rival as never, pose, null, 1100, 1 / 60, player, {
      x: 0,
      z: 0,
    });
    expect(pose.z).toBeGreaterThan(1);
    // The wire's lift over its own ground, carried to the ground under the
    // drawn hull: read off the wire pose BEFORE the projection overwrote it.
    expect(pose.y).toBeCloseTo(3 - ground(10, 0) + ground(pose.x, pose.z), 9);
  });

  it('never bangs for the viewer, and resets a projection it no longer steps', () => {
    const host = sceneHost();
    const scene = new MortarOverdriveScene(host);
    const view = { remoteVehicle: createRemoteVehicleDisplay() };
    view.remoteVehicle.active = true;
    const pose = { x: 1, y: 2, z: 3, facing: 0.5 };
    const player = host.sim.player as never;
    scene.projectRival(true, view, { id: SELF } as never, pose, null, 0, 1 / 60, player, pose);
    expect(pose).toEqual({ x: 1, y: 2, z: 3, facing: 0.5 });
    expect(view.remoteVehicle.active).toBe(false);
    expect(host.audioSink.mortarOverdriveEvent).not.toHaveBeenCalled();
  });

  it('plays the server bump when no local bang latched it', () => {
    const host = sceneHost();
    const scene = new MortarOverdriveScene(host);
    const state = createOwnBumpFeedback();
    markLocalBump(state, 3, 0);
    (scene as unknown as { ownBumpFeedback: unknown }).ownBumpFeedback = state;
    scene.onEvent({ type: 'mortarOverdriveBump', aId: 3, bId: 4, x: 1, z: 2, impact: 24 });
    expect(host.spawnAoeRing).toHaveBeenCalledOnce();
    const [x, z, radius, school] = host.spawnAoeRing.mock.calls[0];
    expect([x, z, school]).toEqual([1, 2, 'physical']);
    expect(radius).toBeCloseTo(3, 12);
    expect(host.addShake).not.toHaveBeenCalled();
  });
});

describe('the renderer delegates, welded', () => {
  const renderer = stripComments(readFileSync('src/render/renderer.ts', 'utf8'));
  const count = (needle: string) => renderer.split(needle).length - 1;

  it('declares every private member the host cast reads', () => {
    for (const anchor of [
      'private sim: IWorld,',
      'views = new Map<number, EntityView>();',
      'vfx: Vfx;',
      'private audioSink: SpatialAudioSink | null = null;',
      'private selfRender = createSelfRenderPositionState(this.selfRenderPosition);',
      'private time = 0;',
      'private groundSample = createRiftAwareGroundSampler(',
      'private skyView!: SkyView;',
      'readonly backgroundGpuWork = createBackgroundGpuQueue({',
      'private readonly buildLedger = createBuildLedger();',
      'private lowGfx: boolean;',
      'private envRTs = new Map<SkyKey, THREE.WebGLRenderTarget>();',
      'private prewarmTextureInIdle(',
      'private ensureEnvironmentBiome(biome: SkyKey): THREE.WebGLRenderTarget | null {',
      'spawnAoeRing(x: number, z: number, radius: number, school: string, colorHex?: number): void {',
      'addShake(amount: number, x?: number, y?: number, z?: number, crunch = false): void {',
      'punchFov(degrees: number): void {',
      'triggerHit(entityId: number): void {',
      'private createRequiredView(id: number | null, createdViewTypes: string[]): number {',
      'worldCompileGate(): ((target: THREE.Object3D) => Promise<unknown>) | undefined {',
      'webgl: THREE.WebGLRenderer;',
    ]) {
      expect(renderer, anchor).toContain(anchor);
    }
  });

  it('builds the scene after the views and the ground sampler it captures', () => {
    const scene = renderer.indexOf(
      'readonly mortarOverdrive = new moRender.MortarOverdriveScene(this);',
    );
    expect(count('readonly mortarOverdrive = new moRender.MortarOverdriveScene(this);')).toBe(1);
    expect(renderer.indexOf('views = new Map<number, EntityView>();')).toBeLessThan(scene);
    expect(renderer.indexOf('private groundSample = createRiftAwareGroundSampler(')).toBeLessThan(
      scene,
    );
  });

  it('runs each delegate once, where the frame ran the moved code', () => {
    for (const call of [
      'this.mortarOverdrive.attach(this.scene);',
      'this.mortarOverdrive.frame(mortarOverdriveInfo, p.pos.x, p.pos.z, dt);',
      'this.mortarOverdrive.onEvent(ev);',
      'this.mortarOverdrive.projectRival(isSelf, v, e, rp, selfMotion, now, dt, p, selfPos);',
      'this.mortarOverdrive.createCoPilotViews(participantIds, player.id, createdViewTypes)',
      'const band = this.mortarOverdrive.ambienceAt(px, pz, this.sim.player.pos.x);',
      'if (desired === MO_FOG) this.mortarOverdrive.applyFog(fog, px, pz);',
    ]) {
      expect(count(call), call).toBe(1);
    }
    // The world frame: after the zone features it always drove, before the
    // ambience that reads the circuit, and never behind a branch of its own.
    const frame = renderer.indexOf('this.mortarOverdrive.frame(');
    const features = renderer.lastIndexOf('this.impactSite.update(', frame);
    expect(renderer.slice(features, frame)).toMatch(
      /^this\.impactSite\.update\(p\.pos\.x, p\.pos\.z, dt\);\s*$/,
    );
    const ambience = 'this.updateAmbience(p.pos.x, this.camera.position.y, dt);';
    expect(renderer.indexOf(ambience, frame)).toBeGreaterThan(frame);
    // The rival step runs before the body is placed from the pose it writes.
    const rival = renderer.indexOf('this.mortarOverdrive.projectRival(');
    expect(renderer.slice(rival, rival + 240)).toMatch(
      /projectRival\([^)]*\);\s*const \{ x, y, z, deck \} = rp;[^\n]*\n\s*v\.group\.position\.set\(x, y, z\);\s*let facing = rp\.facing;/,
    );
  });
});
