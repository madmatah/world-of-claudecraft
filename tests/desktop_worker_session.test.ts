import { describe, expect, it } from 'vitest';
import { initDesktopWorkerSession } from '../src/game/desktop_worker_session';
import {
  configureShaderWarm,
  noteShaderWarmExtensionDrift,
  resetShaderWarmForTest,
} from '../src/render/shader_warm_client';
import type { DesktopBridge } from '../src/runtime';

function rig(workerRan = true) {
  const reported: string[] = [];
  let hide: (() => void) | null = null;
  const bridge = {
    reportWorkerSession: (outcome: 'counted' | 'settled') => void reported.push(outcome),
  } as unknown as DesktopBridge;
  const dispose = initDesktopWorkerSession(bridge, {
    onPageHide: (callback) => {
      hide = callback;
      return () => {
        hide = null;
      };
    },
    workerRan: () => workerRan,
  });
  return { reported, hide: () => hide?.(), dispose, unhooked: () => hide === null };
}

describe('initDesktopWorkerSession', () => {
  it('counts the session on the first counting retirement, once', () => {
    resetShaderWarmForTest({ search: '?shaderwarm=all', spawn: () => null });
    configureShaderWarm({ search: '?shaderwarm=all', spawn: () => null, platform: 'other' });
    const r = rig();
    noteShaderWarmExtensionDrift('EXT_x');
    noteShaderWarmExtensionDrift('EXT_y');
    r.hide();
    expect(r.reported).toEqual(['counted']);
    r.dispose();
    expect(r.unhooked()).toBe(true);
  });

  it('settles at pagehide when a worker ran and nothing counted, and says nothing otherwise', () => {
    resetShaderWarmForTest({ search: '?shaderwarm=all', spawn: () => null });
    const ran = rig(true);
    ran.hide();
    ran.hide();
    expect(ran.reported).toEqual(['settled']);
    const never = rig(false);
    never.hide();
    expect(never.reported).toEqual([]);
  });

  it('is a no-op on a shell without the channel', () => {
    expect(initDesktopWorkerSession(null)).toBeTypeOf('function');
    expect(initDesktopWorkerSession({} as DesktopBridge)).toBeTypeOf('function');
  });
});
