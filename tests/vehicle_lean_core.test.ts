import { describe, expect, it } from 'vitest';
import {
  createVehicleLean,
  stepVehicleLean,
  vehicleIsOffRoad,
} from '../src/render/vehicle_lean_core';

describe('vehicle lean presentation', () => {
  it('pitches under acceleration and rolls with lateral slip', () => {
    const state = createVehicleLean();
    stepVehicleLean(state, 10, 0, 14, 1 / 20, true);
    stepVehicleLean(state, 12, 7, 14, 1 / 20, true);
    expect(state.acceleration).toBeGreaterThan(15);
    expect(state.pitch).toBeLessThan(0);
    expect(state.roll).toBeLessThan(0);
  });

  it('gives held snapshot speeds nearly the same lean at 30 and 60 fps', () => {
    const run = (fps: number) => {
      const state = createVehicleLean();
      stepVehicleLean(state, 10, 0, 14, 1 / fps, true);
      for (let frame = 0; frame < fps / 2; frame++) {
        // Model a 20 Hz network mirror: speed changes only every snapshot.
        const speed = 10 + Math.floor((frame * 20) / fps) * 0.5;
        stepVehicleLean(state, speed, 4, 14, 1 / fps, true);
      }
      return state;
    };
    const at30 = run(30);
    const at60 = run(60);
    expect(at30.pitch).toBeCloseTo(at60.pitch, 2);
    expect(at30.roll).toBeCloseTo(at60.roll, 2);
  });

  it('does not turn an asphalt Arc Shell grip penalty into off-road dust', () => {
    expect(vehicleIsOffRoad(1)).toBe(false);
    expect(vehicleIsOffRoad(1.06)).toBe(true);
  });

  it('stays bounded and eases neutral when disabled', () => {
    const state = createVehicleLean();
    stepVehicleLean(state, 0, 0, 14, 1 / 20, true);
    stepVehicleLean(state, 60, 100, 14, 1 / 20, true);
    expect(Math.abs(state.pitch)).toBeLessThanOrEqual(0.11);
    expect(Math.abs(state.roll)).toBeLessThanOrEqual(0.16);
    for (let i = 0; i < 60; i++) stepVehicleLean(state, 60, 0, 14, 1 / 60, false);
    expect(Math.abs(state.acceleration)).toBeLessThan(0.01);
    expect(Math.abs(state.pitch)).toBeLessThan(0.001);
    expect(Math.abs(state.roll)).toBeLessThan(0.001);
  });
});
