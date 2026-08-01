import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vfx } from '../src/render/vfx';

type SpawnCall = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

function probe(): {
  vfx: Vfx;
  spawn: ReturnType<typeof vi.fn<(...args: SpawnCall) => void>>;
  emitChance: ReturnType<typeof vi.fn<(rate: number, dt: number) => boolean>>;
} {
  // These four methods only need the particle helpers. Bypassing the WebGL
  // constructor keeps the test about their actual spawn contracts rather than
  // canvas setup.
  const vfx = Object.create(Vfx.prototype) as Vfx;
  const spawn = vi.fn<(...args: SpawnCall) => void>();
  const emitChance = vi.fn<(rate: number, dt: number) => boolean>(() => true);
  Object.assign(vfx as object, { spawn, emitChance, scaledCount: () => 2, quality: 1 });
  return { vfx, spawn, emitChance };
}

afterEach(() => vi.restoreAllMocks());

describe('Realm Racers vehicle VFX', () => {
  it('keeps tyre smoke pale and gated on a sustained slide', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const { vfx, spawn } = probe();
    vfx.vehicleDriftSmoke(new THREE.Vector3(), 0, 2, 1 / 60);
    expect(spawn).not.toHaveBeenCalled();
    vfx.vehicleDriftSmoke(new THREE.Vector3(), 0, 12, 1 / 60);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0][6]).toBe(0xd8d5cf);
    expect(spawn.mock.calls[0][10]).toBe(11); // smoke atlas cell
  });

  it('uses ochre debris for moving off-road dust and dark smoke for exhaust', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const dust = probe();
    dust.vfx.vehicleSurfaceDust(new THREE.Vector3(), 0, 35, 1 / 60);
    expect(dust.spawn.mock.calls[0][6]).toBe(0xc89955);
    expect(dust.spawn.mock.calls[0][10]).toBe(14); // debris atlas cell

    const exhaust = probe();
    exhaust.vfx.vehicleExhaust(new THREE.Vector3(), 0, true, 1 / 60);
    expect(exhaust.emitChance).toHaveBeenCalledWith(16, 1 / 60);
    expect(exhaust.spawn.mock.calls[0][6]).toBe(0x3d4142);
    expect(exhaust.spawn.mock.calls[0][10]).toBe(11);
  });

  it('throws a short orange/yellow trace-and-spark shower on impact', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.2);
    const { vfx, spawn } = probe();
    vfx.vehicleScrapeSparks(new THREE.Vector3(), 0.8);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls.map((call) => call[6])).toEqual([0xfff1a8, 0xff9d2e]);
    expect(spawn.mock.calls.map((call) => call[10])).toEqual([12, 4]);
  });

  it('wires all four effects to live vehicle state in the renderer', () => {
    const source = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(source).toContain('this.vfx.vehicleDriftSmoke(');
    expect(source).toContain('if (vehicleIsOffRoad(e.drive.dragMult))');
    expect(source).toContain('this.vfx.vehicleSurfaceDust(');
    expect(source).toContain('this.vfx.vehicleExhaust(');
    expect(source).toContain('if (e.drive.collisionImpact > 3');
    expect(source).toContain('this.vfx.vehicleScrapeSparks(');
  });
});
