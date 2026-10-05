// The per-view kart presentation the renderer delegates to
// (realm_racers_kart_presentation.ts): a racing machine's lean, road effects
// and engine mix. It reads private renderer members through an untyped host,
// so the last block welds every name it reads to renderer.ts, and pins each
// delegate call site in the entity loop.

import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import * as realmRacersKart from '../src/render/realm_racers_kart_presentation';
import { createVehicleDrive } from '../src/sim/vehicle_motion';
import { stripComments } from './helpers/strip_comments';

const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

describe('the kart presentation', () => {
  it('gives every view a resting racing-machine slice', () => {
    const state = realmRacersKart.createViewState();
    expect(state.vehicleAudioActive).toBe(false);
    expect(state.vehicleScrapeCooldown).toBe(0);
    expect(state.remoteVehicle.active).toBe(false);
    expect([state.vehicleLean.pitch, state.vehicleLean.roll]).toEqual([0, 0]);
    expect(realmRacersKart.createViewState().remoteVehicle).not.toBe(state.remoteVehicle);
  });

  it('stops the outgoing sink engines on a swap, and nothing on the same sink', () => {
    const sink = { realmRacersEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() };
    const running = { ...realmRacersKart.createViewState(), vehicleAudioActive: true };
    const idle = realmRacersKart.createViewState();
    const views = new Map([
      [7, running],
      [8, idle],
    ]);
    realmRacersKart.stopVehicleAudio(sink, sink, views);
    realmRacersKart.stopVehicleAudio(null, sink, views);
    expect(sink.stopVehicle).not.toHaveBeenCalled();
    expect(running.vehicleAudioActive).toBe(true);
    realmRacersKart.stopVehicleAudio(sink, null, views);
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
    const drive = createVehicleDrive('rally_loaner');
    drive.slip = 6;
    const v = { ...realmRacersKart.createViewState(), groundTilt: { pitch: 0.01, roll: 0.02 } };
    const visual = { setGroundTilt: vi.fn() };
    for (let i = 0; i < 30; i++)
      realmRacersKart.leanRider(host, v, visual, { id: 2, drive }, true, 1 / 60);
    const [pitch, roll] = visual.setGroundTilt.mock.calls.at(-1) as [number, number];
    expect(roll).toBeCloseTo(0.02 + v.vehicleLean.roll, 12);
    expect(pitch).toBeCloseTo(0.01 + v.vehicleLean.pitch, 12);
    expect(v.vehicleLean.roll).not.toBe(0);

    const walker = {
      ...realmRacersKart.createViewState(),
      groundTilt: { pitch: 0.01, roll: 0.02 },
    };
    realmRacersKart.leanRider(host, walker, visual, { id: 2, drive: null }, true, 1 / 60);
    expect(visual.setGroundTilt).toHaveBeenLastCalledWith(0.01, 0.02);
    // Reduced motion keeps a driving machine level.
    const still = { ...realmRacersKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    realmRacersKart.leanRider(
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
    const predicted = createVehicleDrive('rally_loaner');
    predicted.speed = 40;
    predicted.slip = 6;
    const mirror = createVehicleDrive('rally_loaner');
    const visual = { setGroundTilt: vi.fn() };
    const self = { ...realmRacersKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    const rival = { ...realmRacersKart.createViewState(), groundTilt: { pitch: 0, roll: 0 } };
    for (let i = 0; i < 30; i++) {
      realmRacersKart.leanRider(
        viewerHost(predicted),
        self,
        visual,
        { id: 1, drive: mirror },
        true,
        1 / 60,
      );
      realmRacersKart.leanRider(
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

    const sink = { realmRacersEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() };
    const host = { ...viewerHost(predicted), audioSink: sink };
    const fresh = () => ({ ...realmRacersKart.createViewState() });
    realmRacersKart.syncVehicleAudio(host, { id: 1, drive: mirror }, fresh(), true, 0, 0, 0);
    realmRacersKart.syncVehicleAudio(host, { id: 2, drive: mirror }, fresh(), true, 0, 0, 0);
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
      ...realmRacersKart.createViewState(),
      groundTilt: { pitch: 0.1, roll: 0.2 },
      mountVisual,
    };
    realmRacersKart.leanMount({ drive: null }, v, true);
    realmRacersKart.leanMount({ drive: createVehicleDrive('rally_loaner') }, v, false);
    expect(mountVisual.setGroundTilt).not.toHaveBeenCalled();
    realmRacersKart.leanMount({ drive: createVehicleDrive('rally_loaner') }, v, true);
    expect(mountVisual.setGroundTilt).toHaveBeenCalledExactlyOnceWith(0.1, 0.2);
  });

  it("scrapes on the viewer's drive view, and shakes only the viewer", () => {
    const vfx = {
      vehicleDriftSmoke: vi.fn(),
      vehicleSurfaceDust: vi.fn(),
      vehicleExhaust: vi.fn(),
      vehicleScrapeSparks: vi.fn(),
    };
    const predicted = createVehicleDrive('rally_loaner');
    predicted.collisionImpact = 12;
    const host = {
      vfx,
      audioSink: { realmRacersEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() },
      selfRender: { drive: { state: predicted } },
      tmpV: new THREE.Vector3(),
      groundSample: ground,
      addShake: vi.fn(),
    };
    const v = { ...realmRacersKart.createViewState(), group: new THREE.Group(), isFar: false };
    const mirror = { drive: createVehicleDrive('rally_loaner') };
    realmRacersKart.syncRoadFx(host, v, mirror, true, true, 0, 1, 2, 3, 1 / 60);
    expect(vfx.vehicleScrapeSparks).toHaveBeenCalledOnce();
    expect(host.addShake).toHaveBeenCalledOnce();
    expect(v.vehicleScrapeCooldown).toBe(0.18);
    // The same impact on a rival's mirrored state sparks but never shakes.
    const rival = { ...realmRacersKart.createViewState(), group: new THREE.Group(), isFar: false };
    realmRacersKart.syncRoadFx(host, rival, { drive: predicted }, false, true, 0, 1, 2, 3, 1 / 60);
    expect(vfx.vehicleScrapeSparks).toHaveBeenCalledTimes(2);
    expect(host.addShake).toHaveBeenCalledOnce();
    // A far or unsettled body draws no road effects at all.
    realmRacersKart.syncRoadFx(
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
      'realmRacersKart.stopVehicleAudio(this.audioSink, sink, this.views);',
      'realmRacersKart.syncVehicleAudio(this, e, v, d2 < SFX_MOVE_RANGE_SQ, ax, ay, az);',
      'realmRacersKart.leanRider(this, v, v.visual, e, settled, dt);',
      'realmRacersKart.leanMount(e, v, !!mountSpec && mountShown && runCharacterPresentation);',
      'realmRacersKart.syncRoadFx(this, v, e, isSelf, settled, facing, ax, ay, az, dt);',
      '...realmRacersKart.createViewState(),',
    ]) {
      expect(count(call), call).toBe(1);
    }
    expect(renderer).toMatch(
      /export interface EntityView\s+extends[^{]*realmRacersKart\.ViewState \{/,
    );
    // The rider's lean replaces the plain terrain tilt; nothing else sets it.
    expect(count('v.visual.setGroundTilt(')).toBe(0);
    // The machine leans after the mount's own attitude pass.
    const lean = renderer.indexOf('realmRacersKart.leanMount(');
    const mountPass = renderer.lastIndexOf(
      'groundSample: this.groundSample,\n        dt,\n      });',
      lean,
    );
    expect(mountPass).toBeGreaterThan(0);
    expect(lean).toBeGreaterThan(mountPass);
    expect(renderer.slice(mountPass, lean)).not.toContain(';\n      if (');
  });
});
