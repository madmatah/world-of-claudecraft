// The rival oil spray: a short burst from the dropper's DRAWN tail to the patch
// the server laid. The path is read off the R1 display state (the machine as
// the viewer sees it), the patch end never moves, and the pool is prepared,
// not grown: one shared, named, never-disposed material, and every program a
// spray draws is one `prepare()` already built for the race preparation seam.

import type * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: {} }));
// The shell pool mints its marker texture at construction, which needs a DOM
// canvas; the rest of the textures module is the real one.
vi.mock('../src/render/textures', async (importOriginal) => {
  const THREE = await import('three');
  return {
    ...(await importOriginal<typeof import('../src/render/textures')>()),
    mortarOverdriveGroundBlastMarkerTexture: () =>
      new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1),
  };
});

import { MortarOverdriveFieldCues } from '../src/render/mortar_overdrive/field_cues';
import {
  MortarOverdriveOilSprayVisuals,
  mortarOverdriveOilSprayMaterial,
} from '../src/render/mortar_overdrive/oil_spray';
import {
  MORTAR_OVERDRIVE_OIL_SPRAY_DROPLETS,
  MORTAR_OVERDRIVE_OIL_SPRAY_FLIGHT_SEC,
  MORTAR_OVERDRIVE_OIL_SPRAY_MAX_REACH_YD,
  MORTAR_OVERDRIVE_OIL_SPRAY_SECONDS,
  MORTAR_OVERDRIVE_OIL_SPRAY_STAGGER_SEC,
  MORTAR_OVERDRIVE_OIL_SPRAY_TAIL_YD,
  type MortarOverdriveOilDroplet,
  mortarOverdriveOilDropletAt,
  mortarOverdriveOilSprayPath,
} from '../src/render/mortar_overdrive/oil_spray_core';
import { MortarOverdriveScene } from '../src/render/mortar_overdrive/scene';
import { MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR } from '../src/render/mortar_overdrive/slicks_core';
import {
  createRemoteVehicleDisplay,
  type RemoteVehicleDisplayState,
} from '../src/render/remote_vehicle_display_core';
import { Renderer } from '../src/render/renderer';
import { MORTAR_OVERDRIVE_SLICK_RADIUS } from '../src/sim/mortar_overdrive/slicks';
import type { SimEvent } from '../src/sim/types';
import { drawsUnder, threeProgramKeys } from './helpers/three_program_keys';

const SELF = 1;
const RIVAL = 2;
const GHOST = 3;

function drawn(x: number, z: number, facing: number, active = true): RemoteVehicleDisplayState {
  const view = createRemoteVehicleDisplay();
  view.active = active;
  view.x = x;
  view.z = z;
  view.facing = facing;
  return view;
}

function viewsOf(
  entries: [number, RemoteVehicleDisplayState][],
): Map<number, { remoteVehicle: RemoteVehicleDisplayState }> {
  return new Map(entries.map(([id, remoteVehicle]) => [id, { remoteVehicle }]));
}

const dropped = (sourceId: number, x = 30, z = 5): SimEvent => ({
  type: 'mortarOverdriveSlickDropped',
  sourceId,
  x,
  z,
});

const pathOut = () => ({ fromX: 0, fromZ: 0, toX: 0, toZ: 0 });

describe('the spray path', () => {
  it("leaves the drawn rival's tail and lands on the server's patch", () => {
    // The rival is drawn 6 yd up the road from where the server laid the oil.
    const views = viewsOf([[RIVAL, drawn(30, 11, 0)]]);
    const path = mortarOverdriveOilSprayPath(
      views,
      { sourceId: RIVAL, x: 30, z: 5 },
      SELF,
      pathOut(),
    );
    expect(path).not.toBeNull();
    expect(path?.fromX).toBeCloseTo(30, 10);
    expect(path?.fromZ).toBeCloseTo(11 - MORTAR_OVERDRIVE_OIL_SPRAY_TAIL_YD, 10);
    // The patch end is the event's point, never the drawn pose.
    expect(path?.toX).toBe(30);
    expect(path?.toZ).toBe(5);
  });

  it('follows the drawn heading, not the patch direction', () => {
    const facing = Math.PI / 2;
    const views = viewsOf([[RIVAL, drawn(40, 5, facing)]]);
    const path = mortarOverdriveOilSprayPath(
      views,
      { sourceId: RIVAL, x: 30, z: 5 },
      SELF,
      pathOut(),
    );
    expect(path?.fromX).toBeCloseTo(40 - MORTAR_OVERDRIVE_OIL_SPRAY_TAIL_YD, 10);
    expect(path?.fromZ).toBeCloseTo(5, 10);
  });

  it('never sprays the viewer own drop, whatever its view holds', () => {
    const views = viewsOf([[SELF, drawn(30, 11, 0)]]);
    expect(
      mortarOverdriveOilSprayPath(views, { sourceId: SELF, x: 30, z: 5 }, SELF, pathOut()),
    ).toBeNull();
  });

  it('splashes in place for a dropper with no live display', () => {
    const views = viewsOf([[RIVAL, drawn(90, 90, 0, false)]]);
    for (const sourceId of [RIVAL, GHOST]) {
      expect(
        mortarOverdriveOilSprayPath(views, { sourceId, x: 30, z: 5 }, SELF, pathOut()),
      ).toEqual({
        fromX: 30,
        fromZ: 5,
        toX: 30,
        toZ: 5,
      });
    }
  });

  it('writes into the caller-owned path, so a drop allocates nothing', () => {
    const out = pathOut();
    const views = viewsOf([[RIVAL, drawn(30, 11, 0)]]);
    expect(mortarOverdriveOilSprayPath(views, { sourceId: RIVAL, x: 30, z: 5 }, SELF, out)).toBe(
      out,
    );
    expect(out.toZ).toBe(5);
  });

  it('caps the reach along the same line for a drawn rival far from its patch', () => {
    const views = viewsOf([[RIVAL, drawn(30, 105 + MORTAR_OVERDRIVE_OIL_SPRAY_TAIL_YD, 0)]]);
    const path = mortarOverdriveOilSprayPath(
      views,
      { sourceId: RIVAL, x: 30, z: 5 },
      SELF,
      pathOut(),
    );
    expect(path?.fromX).toBeCloseTo(30, 10);
    expect(path?.fromZ).toBeCloseTo(5 + MORTAR_OVERDRIVE_OIL_SPRAY_MAX_REACH_YD, 10);
  });
});

describe('the droplets', () => {
  const path = { fromX: 0, fromZ: 10, toX: 0, toZ: 0 };
  const out = (): MortarOverdriveOilDroplet => ({ x: 0, y: 0, z: 0, scale: 0 });

  it('leave the tail in turn and each lands inside the patch', () => {
    for (let i = 0; i < MORTAR_OVERDRIVE_OIL_SPRAY_DROPLETS; i++) {
      const launch =
        (i / MORTAR_OVERDRIVE_OIL_SPRAY_DROPLETS) * MORTAR_OVERDRIVE_OIL_SPRAY_STAGGER_SEC;
      expect(mortarOverdriveOilDropletAt(path, 1, 0, i, launch, out()).scale).toBe(0);
      const leaving = mortarOverdriveOilDropletAt(path, 1, 0, i, launch + 1e-6, out());
      expect(leaving.scale).toBeGreaterThan(0);
      expect(Math.hypot(leaving.x - path.fromX, leaving.z - path.fromZ)).toBeLessThan(1e-3);
      expect(leaving.y).toBeCloseTo(1, 3);
      const landing = mortarOverdriveOilDropletAt(
        path,
        1,
        0,
        i,
        launch + MORTAR_OVERDRIVE_OIL_SPRAY_FLIGHT_SEC - 1e-6,
        out(),
      );
      expect(Math.hypot(landing.x - path.toX, landing.z - path.toZ)).toBeLessThan(
        MORTAR_OVERDRIVE_SLICK_RADIUS,
      );
      expect(landing.y).toBeCloseTo(0, 3);
      const landed = mortarOverdriveOilDropletAt(
        path,
        1,
        0,
        i,
        launch + MORTAR_OVERDRIVE_OIL_SPRAY_FLIGHT_SEC + 1e-9,
        out(),
      );
      expect(landed.scale).toBe(0);
    }
  });

  it('has every droplet down by the end of the spray', () => {
    for (let i = 0; i < MORTAR_OVERDRIVE_OIL_SPRAY_DROPLETS; i++) {
      expect(
        mortarOverdriveOilDropletAt(path, 1, 0, i, MORTAR_OVERDRIVE_OIL_SPRAY_SECONDS, out()).scale,
      ).toBe(0);
    }
  });
});

function programKeys(root: THREE.Object3D, visibleOnly: boolean): Set<string> {
  const keys = new Set<string>();
  for (const { object, material } of drawsUnder(root)) {
    if (visibleOnly && !object.visible) continue;
    keys.add(threeProgramKeys(material, object));
  }
  return keys;
}

function materialsUnder(root: THREE.Object3D): Set<THREE.Material> {
  return new Set(drawsUnder(root).map((draw) => draw.material));
}

/** Spray well past two laps of the pool, observing after every step. */
function volley(pool: MortarOverdriveOilSprayVisuals, observe: () => void): void {
  for (let n = 0; n < 12; n++) {
    pool.spray({ fromX: n, fromZ: 10, toX: n, toZ: 0 }, 1, 0);
    observe();
    pool.update(0.05);
    observe();
    if (n % 3 === 0) {
      pool.spray({ fromX: -n, fromZ: 0, toX: -n, toZ: 8 }, 1.2, 0.3);
      observe();
    }
    pool.update(0.1);
    observe();
  }
  for (let step = 0; step < 8; step++) {
    pool.update(0.1);
    observe();
  }
}

describe('the spray pool preparation', () => {
  // A pool-local check against the helper's fixed scene state: the real
  // proof that the race preparation links what a spray draws, through the
  // seam's own gate and the whole-scene compile exclusion, is
  // tests/mortar_overdrive_boot_compile.test.ts.
  it('draws only programs, meshes and materials that prepare() built', () => {
    const pool = new MortarOverdriveOilSprayVisuals();
    const root = pool.prepare();
    expect(root).toBe(pool.group);
    const prepared = programKeys(root, false);
    const children = [...root.children];
    const materials = materialsUnder(root);
    expect(children.length).toBeGreaterThan(0);
    root.traverse((object) => {
      if (object !== root) expect(object.visible, object.name).toBe(false);
    });
    const drawn = new Set<string>();
    let sawDraw = false;
    volley(pool, () => {
      const visible = programKeys(root, true);
      if (visible.size > 0) sawDraw = true;
      for (const key of visible) drawn.add(key);
      expect(root.children).toEqual(children);
    });
    expect(sawDraw).toBe(true);
    expect(drawn).toEqual(prepared);
    expect(materialsUnder(root)).toEqual(materials);
    // Every spray has landed: the pool is parked again.
    expect(pool.inFlight).toBe(0);
    root.traverse((object) => {
      if (object !== root) expect(object.visible, object.name).toBe(false);
    });
  });

  it('wears one shared, named material across every pool, never one per drop', () => {
    const a = new MortarOverdriveOilSprayVisuals();
    const b = new MortarOverdriveOilSprayVisuals();
    const shared = mortarOverdriveOilSprayMaterial();
    expect(materialsUnder(a.prepare())).toEqual(new Set([shared]));
    expect(materialsUnder(b.prepare())).toEqual(new Set([shared]));
    expect(mortarOverdriveOilSprayMaterial()).toBe(shared);
    expect(shared.name).toBe('mortarOverdriveOilSpray:droplet');
    // Drawn as an instanced single-sided opaque program: no second pass to link.
    expect(shared.transparent).toBe(false);
    const geometries = new Set(
      drawsUnder(a.group).map((draw) => (draw.object as THREE.Mesh).geometry),
    );
    for (const draw of drawsUnder(b.group)) {
      expect(geometries.has((draw.object as THREE.Mesh).geometry)).toBe(true);
    }
  });

  it('builds the whole pool at once when a drop beats the preparation', () => {
    const pool = new MortarOverdriveOilSprayVisuals();
    pool.spray({ fromX: 0, fromZ: 10, toX: 0, toZ: 0 }, 1, 0);
    const children = pool.group.children.length;
    const fresh = new MortarOverdriveOilSprayVisuals();
    expect(children).toBe(fresh.prepare().children.length);
    volley(pool, () => undefined);
    expect(pool.group.children.length).toBe(children);
  });

  it('gives back its instance buffers on teardown and never the shared material', () => {
    const pool = new MortarOverdriveOilSprayVisuals();
    pool.prepare();
    const meshes = [...pool.group.children] as THREE.InstancedMesh[];
    const meshDisposed = vi.fn();
    for (const mesh of meshes) mesh.addEventListener('dispose', meshDisposed);
    const materialDisposed = vi.fn();
    const shared = mortarOverdriveOilSprayMaterial();
    shared.addEventListener('dispose', materialDisposed);
    pool.dispose();
    shared.removeEventListener('dispose', materialDisposed);
    expect(meshDisposed).toHaveBeenCalledTimes(meshes.length);
    expect(materialDisposed).not.toHaveBeenCalled();
    expect(pool.group.children).toHaveLength(0);
    expect(() => {
      pool.spray({ fromX: 0, fromZ: 10, toX: 0, toZ: 0 }, 1, 0);
      pool.update(0.1);
      pool.dispose();
    }).not.toThrow();
    expect(pool.prepare().children).toHaveLength(0);
  });

  it('tags every drawable for the VFX walk and keeps the pool out of parent compiles', () => {
    const pool = new MortarOverdriveOilSprayVisuals();
    expect(pool.prepareId).toBe('oilSpray');
    pool.prepare().traverse((object) => {
      expect(object.userData.renderCategory, object.name).toBe('vfx');
    });
  });
});

function world(match: { phase: string } | null = { phase: 'racing' }) {
  return {
    playerId: SELF,
    player: { pos: { x: 0, z: 0 }, facing: 0, drive: null },
    mortarOverdriveInfo: { match },
  } as unknown as Parameters<MortarOverdriveFieldCues['onEvent']>[1];
}

/** The self render state as the renderer holds it: drawn pose, drive view. */
function seenSelf() {
  return {
    position: { x: 0, z: 0 },
    active: false,
    ready: false,
    drive: { source: 'none' as const, velocityX: 0, velocityZ: 0 },
  };
}

/** A race preparation seam that has (or has not) started. */
function seamOf(reason: 'queue' | null) {
  return { reason, addClient: vi.fn() };
}

function vfxSpy() {
  return { burst: vi.fn(), groundPuff: vi.fn() };
}

describe('the field cues', () => {
  const ground = (x: number, z: number): number => 0.1 * x + 0.05 * z;

  it("sprays a rival's drop from its drawn pose to the patch", () => {
    const rival = drawn(30, 11, 0);
    const cues = new MortarOverdriveFieldCues(viewsOf([[RIVAL, rival]]), ground);
    const seam = seamOf('queue');
    cues.joinPrepare(seam);
    expect(seam.addClient).toHaveBeenCalledWith(cues.sprays);
    const spray = vi.spyOn(cues.sprays, 'spray');
    cues.onEvent(dropped(RIVAL), world(), vfxSpy(), null, seenSelf());
    expect(spray).toHaveBeenCalledOnce();
    const [path, fromY, toY] = spray.mock.calls[0];
    expect(path).toEqual(
      mortarOverdriveOilSprayPath(
        viewsOf([[RIVAL, rival]]),
        dropped(RIVAL) as never,
        SELF,
        pathOut(),
      ),
    );
    expect(fromY).toBeGreaterThan(ground(path.fromX, path.fromZ));
    expect(toY).toBe(ground(30, 5));
    // And it is drawn: a slot of the pool is up.
    expect(cues.sprays.inFlight).toBe(1);
  });

  it('leaves the viewer own drop to the provisional patch', () => {
    const cues = new MortarOverdriveFieldCues(viewsOf([[SELF, drawn(30, 11, 0)]]), ground);
    cues.joinPrepare(seamOf('queue'));
    const spray = vi.spyOn(cues.sprays, 'spray');
    cues.onEvent(dropped(SELF), world(), vfxSpy(), null, seenSelf());
    expect(spray).not.toHaveBeenCalled();
    expect(cues.sprays.built).toBe(false);
  });

  it('never builds or draws a spray for a viewer who has not committed to racing', () => {
    // Never queued, not seated, not in the band: the seam has not started, so
    // the pool is not prepared and a live-frame spray would link its program.
    // The patch still appears, from the readout.
    const rival = drawn(30, 11, 0);
    for (const seam of [null, seamOf(null)]) {
      const cues = new MortarOverdriveFieldCues(viewsOf([[RIVAL, rival]]), ground);
      if (seam) cues.joinPrepare(seam);
      const spray = vi.spyOn(cues.sprays, 'spray');
      cues.onEvent(dropped(RIVAL), world(null), vfxSpy(), null, seenSelf());
      expect(spray).not.toHaveBeenCalled();
      expect(cues.sprays.built).toBe(false);
      expect(cues.sprays.group.children).toHaveLength(0);
    }
    // Once the seam starts, the same drop sprays.
    const seam = seamOf(null);
    const cues = new MortarOverdriveFieldCues(viewsOf([[RIVAL, rival]]), ground);
    cues.joinPrepare(seam);
    (seam as { reason: string | null }).reason = 'queue';
    cues.onEvent(dropped(RIVAL), world(null), vfxSpy(), null, seenSelf());
    expect(cues.sprays.inFlight).toBe(1);
    // And a pool already built (a seam that started earlier) keeps spraying.
    const built = new MortarOverdriveFieldCues(viewsOf([[RIVAL, rival]]), ground);
    built.sprays.prepare();
    built.onEvent(dropped(RIVAL), world(null), vfxSpy(), null, seenSelf());
    expect(built.sprays.inFlight).toBe(1);
  });

  it('keeps the slick throw puff and scrape it took over from the renderer', () => {
    const cues = new MortarOverdriveFieldCues(viewsOf([]), ground);
    const vfx = vfxSpy();
    const sink = { mortarOverdriveEvent: vi.fn(), vehicle: vi.fn(), stopVehicle: vi.fn() };
    cues.onEvent(
      { type: 'mortarOverdriveSlicked', targetId: RIVAL, x: 10, z: 20, impact: 0.5 },
      world(),
      vfx,
      sink,
      seenSelf(),
    );
    expect(vfx.groundPuff).toHaveBeenCalledOnce();
    const [at, power, color] = vfx.groundPuff.mock.calls[0];
    expect([at.x, at.y, at.z]).toEqual([10, ground(10, 20), 20]);
    expect(power).toBeCloseTo(1.4, 10);
    expect(color).toBe(MORTAR_OVERDRIVE_SLICK_SHEEN_COLOR);
    expect(sink.mortarOverdriveEvent.mock.calls).toEqual([
      ['scrape', 10, ground(10, 20) + 0.3, 20, 0.5],
    ]);
  });
});

describe('the renderer hands the field events to the cues', () => {
  it('routes the slick throw, the drop and the take through one arm', () => {
    const onEvent = vi.fn();
    const sim = { playerId: SELF };
    const vfx = vfxSpy();
    const audioSink = { mortarOverdriveEvent: vi.fn() };
    const selfRender = seenSelf();
    // The Mortar Overdrive scene over a stub of the renderer members it reads.
    const scene = new MortarOverdriveScene({
      sim,
      vfx,
      audioSink,
      selfRender,
      views: viewsOf([]),
      groundSample: (x: number, z: number): number => 0.1 * x + 0.05 * z,
    });
    (scene as unknown as { fieldCues: unknown }).fieldCues = { onEvent };
    const events = [
      { type: 'mortarOverdriveSlicked', targetId: RIVAL, x: 1, z: 2, impact: 0.4 },
      dropped(RIVAL),
      { type: 'mortarOverdrivePickupTaken', takerId: RIVAL, x: 3, z: 4 },
    ] as Parameters<MortarOverdriveScene['onEvent']>[0][];
    for (const ev of events) scene.onEvent(ev);
    expect(onEvent.mock.calls).toEqual(events.map((ev) => [ev, sim, vfx, audioSink, selfRender]));
    expect(vfx.groundPuff).not.toHaveBeenCalled();
  });

  it('is the one renderer arm every Mortar Overdrive event takes to the scene', () => {
    const onEvent = vi.fn();
    const renderer = Object.create(Renderer.prototype) as Record<string, unknown> & {
      handleEvent(ev: SimEvent): void;
    };
    renderer.mortarOverdrive = { onEvent };
    const events: SimEvent[] = [
      {
        type: 'mortarOverdriveGroundBlastFired',
        sourceId: RIVAL,
        x: 1,
        z: 2,
        targetX: 3,
        targetZ: 4,
        flightSeconds: 0.5,
      },
      {
        type: 'mortarOverdriveGroundBlastHit',
        sourceId: RIVAL,
        targetId: null,
        x: 1,
        z: 2,
        impact: 0.5,
      },
      { type: 'mortarOverdriveBump', aId: SELF, bId: RIVAL, x: 1, z: 2, impact: 6 },
      { type: 'mortarOverdriveSlicked', targetId: RIVAL, x: 1, z: 2, impact: 0.4 },
      dropped(RIVAL),
      { type: 'mortarOverdrivePickupTaken', takerId: RIVAL, x: 3, z: 4 },
    ] as SimEvent[];
    for (const ev of events) renderer.handleEvent(ev);
    expect(onEvent.mock.calls).toEqual(events.map((ev) => [ev]));
  });
});
