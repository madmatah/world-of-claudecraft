// The per-view kart presentation the renderer delegates to
// (mortar_overdrive/kart_presentation.ts): a racing machine's lean, road effects
// and engine mix. It reads private renderer members through an untyped host,
// so the last block welds every name it reads to renderer.ts, and pins each
// delegate call site in the entity loop.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import * as moKart from '../src/render/mortar_overdrive/kart_presentation';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { stripComments } from './helpers/strip_comments';

const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

describe('the kart presentation', () => {
  it('gives every view a resting racing-machine slice', () => {
    const state = moKart.createViewState();
    expect(state.vehicleAudioActive).toBe(false);
    expect(state.vehicleScrapeCooldown).toBe(0);
    expect(state.remoteVehicle.active).toBe(false);
    expect([state.vehicleLean.pitch, state.vehicleLean.roll]).toEqual([0, 0]);
    expect(moKart.createViewState().remoteVehicle).not.toBe(state.remoteVehicle);
  });

  it('stops the outgoing sink engines on a swap, and nothing on the same sink', () => {
    const sink = { mortarOverdriveEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() };
    const running = { ...moKart.createViewState(), vehicleAudioActive: true };
    const idle = moKart.createViewState();
    const views = new Map([
      [7, running],
      [8, idle],
    ]);
    moKart.stopVehicleAudio(sink, sink, views);
    moKart.stopVehicleAudio(null, sink, views);
    expect(sink.stopVehicle).not.toHaveBeenCalled();
    expect(running.vehicleAudioActive).toBe(true);
    moKart.stopVehicleAudio(sink, null, views);
    expect(sink.stopVehicle.mock.calls).toEqual([[7]]);
    expect(running.vehicleAudioActive).toBe(false);
  });

  /** A host whose viewer is entity 1, drawing `predicted` as its kart. */
  const viewerHost = (predicted: ReturnType<typeof createVehicleDrive> | null = null) => ({
    reducedMotion: () => false,
    sim: { playerId: 1 },
    selfRender: { drive: { state: predicted } },
  });

  it('leans a driving rider on top of the terrain tilt, and only a driving one', () => {
    const host = viewerHost();
    const drive = createVehicleDrive('mo_loaner');
    drive.slip = 6;
    const v = { ...moKart.createViewState(), groundTilt: { pitch: 0.01, roll: 0.02 } };
    const visual = { setGroundTilt: vi.fn() };
    for (let i = 0; i < 30; i++) moKart.leanRider(host, v, visual, { id: 2, drive }, true, 1 / 60);
    const [pitch, roll] = visual.setGroundTilt.mock.calls.at(-1) as [number, number];
    expect(roll).toBeCloseTo(0.02 + v.vehicleLean.roll, 12);
    expect(pitch).toBeCloseTo(0.01 + v.vehicleLean.pitch, 12);
    expect(v.vehicleLean.roll).not.toBe(0);

    const walker = {
      ...moKart.createViewState(),
      groundTilt: { pitch: 0.01, roll: 0.02 },
    };
    moKart.leanRider(host, walker, visual, { id: 2, drive: null }, true, 1 / 60);
    expect(visual.setGroundTilt).toHaveBeenLastCalledWith(0.01, 0.02);
    // Reduced motion keeps a driving machine level.
    const still = { ...moKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    moKart.leanRider(
      { ...viewerHost(), reducedMotion: () => true },
      still,
      visual,
      { id: 2, drive },
      true,
      1 / 60,
    );
    expect(still.vehicleLean.roll).toBe(0);
  });

  it("leans and voices the viewer's own kart off its drive view, a rival off its mirror", () => {
    // The viewer's mirror is the acked snapshot, a round trip behind and
    // stepping at 20 Hz; the drive view is the predicted kart it is drawn as.
    const predicted = createVehicleDrive('mo_loaner');
    predicted.speed = 40;
    predicted.slip = 6;
    const mirror = createVehicleDrive('mo_loaner');
    const visual = { setGroundTilt: vi.fn() };
    const self = { ...moKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    const rival = { ...moKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    for (let i = 0; i < 30; i++) {
      moKart.leanRider(viewerHost(predicted), self, visual, { id: 1, drive: mirror }, true, 1 / 60);
      moKart.leanRider(
        viewerHost(predicted),
        rival,
        visual,
        { id: 2, drive: mirror },
        true,
        1 / 60,
      );
    }
    expect(self.vehicleLean.roll).not.toBe(0);
    expect(rival.vehicleLean.roll).toBe(0);

    const sink = { mortarOverdriveEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() };
    const host = { ...viewerHost(predicted), audioSink: sink };
    const fresh = () => ({ ...moKart.createViewState() });
    moKart.syncVehicleAudio(host, { id: 1, drive: mirror }, fresh(), true, 0, 0, 0);
    moKart.syncVehicleAudio(host, { id: 2, drive: mirror }, fresh(), true, 0, 0, 0);
    const [selfCall, rivalCall] = sink.vehicle.mock.calls;
    // (id, self, x, y, z, speedFraction, effort, slip, offRoad)
    expect(selfCall[1]).toBe(true);
    expect(selfCall[7]).toBe(6);
    expect(selfCall[5]).toBeGreaterThan(0.5);
    expect(rivalCall[1]).toBe(false);
    expect(rivalCall[7]).toBe(0);
    expect(rivalCall[5]).toBe(0);
  });

  it('tilts only a shown, driving machine', () => {
    const mountVisual = { setGroundTilt: vi.fn() };
    const v = {
      ...moKart.createViewState(),
      groundTilt: { pitch: 0.1, roll: 0.2 },
      mountVisual,
    };
    moKart.leanMount({ drive: null }, v, true);
    moKart.leanMount({ drive: createVehicleDrive('mo_loaner') }, v, false);
    expect(mountVisual.setGroundTilt).not.toHaveBeenCalled();
    moKart.leanMount({ drive: createVehicleDrive('mo_loaner') }, v, true);
    expect(mountVisual.setGroundTilt).toHaveBeenCalledExactlyOnceWith(0.1, 0.2);
  });

  it("scrapes on the viewer's drive view, and shakes only the viewer", () => {
    const vfx = {
      vehicleDriftSmoke: vi.fn(),
      vehicleSurfaceDust: vi.fn(),
      vehicleExhaust: vi.fn(),
      vehicleScrapeSparks: vi.fn(),
    };
    const predicted = createVehicleDrive('mo_loaner');
    predicted.collisionImpact = 12;
    const host = {
      vfx,
      audioSink: { mortarOverdriveEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() },
      selfRender: { drive: { state: predicted } },
      tmpV: new THREE.Vector3(),
      groundSample: ground,
      addShake: vi.fn(),
    };
    const v = { ...moKart.createViewState(), group: new THREE.Group(), isFar: false };
    const mirror = { drive: createVehicleDrive('mo_loaner') };
    moKart.syncRoadFx(host, v, mirror, true, true, 0, 1, 2, 3, 1 / 60);
    expect(vfx.vehicleScrapeSparks).toHaveBeenCalledOnce();
    expect(host.addShake).toHaveBeenCalledOnce();
    expect(v.vehicleScrapeCooldown).toBe(0.18);
    // The same impact on a rival's mirrored state sparks but never shakes.
    const rival = {
      ...moKart.createViewState(),
      group: new THREE.Group(),
      isFar: false,
    };
    moKart.syncRoadFx(host, rival, { drive: predicted }, false, true, 0, 1, 2, 3, 1 / 60);
    expect(vfx.vehicleScrapeSparks).toHaveBeenCalledTimes(2);
    expect(host.addShake).toHaveBeenCalledOnce();
    // A far or unsettled body draws no road effects at all.
    moKart.syncRoadFx(
      host,
      { ...rival, isFar: true },
      { drive: predicted },
      false,
      true,
      0,
      1,
      2,
      3,
      1 / 60,
    );
    expect(vfx.vehicleDriftSmoke).toHaveBeenCalledTimes(2);
  });
});

describe('the renderer delegates, welded', () => {
  const renderer = stripComments(readFileSync('src/render/renderer.ts', 'utf8'));
  const count = (needle: string) => renderer.split(needle).length - 1;

  it('declares every private member the host cast reads', () => {
    for (const anchor of [
      'private sim: IWorld,',
      'vfx: Vfx;',
      'private audioSink: SpatialAudioSink | null = null;',
      'private selfRender = createSelfRenderPositionState(this.selfRenderPosition);',
      'private groundSample = createRiftAwareGroundSampler(',
      'private tmpV = new THREE.Vector3();',
      'private reducedMotion(): boolean {',
      'addShake(amount: number, x?: number, y?: number, z?: number, crunch = false): void {',
    ]) {
      expect(renderer, anchor).toContain(anchor);
    }
  });

  it('runs each delegate once, and every view carries the slice', () => {
    for (const call of [
      'moKart.stopVehicleAudio(this.audioSink, sink, this.views);',
      'moKart.syncVehicleAudio(this, e, v, d2 < SFX_MOVE_RANGE_SQ, ax, ay, az);',
      'moKart.leanRider(this, v, v.visual, e, settled, dt);',
      'moKart.leanMount(e, v, !!mountSpec && mountShown && runCharacterPresentation);',
      'moKart.syncRoadFx(this, v, e, isSelf, settled, facing, ax, ay, az, dt);',
      '...moKart.createViewState(),',
    ]) {
      expect(count(call), call).toBe(1);
    }
    expect(renderer).toMatch(/export interface EntityView\s+extends[^{]*moKart\.ViewState \{/);
    // The rider's lean replaces the plain terrain tilt; nothing else sets it.
    expect(count('v.visual.setGroundTilt(')).toBe(0);
    // The machine leans after the mount's own attitude pass.
    const lean = renderer.indexOf('moKart.leanMount(');
    const mountPass = renderer.lastIndexOf(
      'groundSample: this.groundSample,\n        dt,\n      });',
      lean,
    );
    expect(mountPass).toBeGreaterThan(0);
    expect(lean).toBeGreaterThan(mountPass);
    expect(renderer.slice(mountPass, lean)).not.toContain(';\n      if (');
  });
});
