// The renderer half of the desktop shell's graphics backend choice
// (src/game/desktop_gpu_backend_sync.ts): the capability probe, the
// platform gate the shell answers, the boot reflection in and the push out.

import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_GPU_BACKEND_CHOICES,
  desktopBackendProbeSupported,
  desktopGpuBackendActive,
  desktopGpuBackendChoices,
  desktopGpuBackendSupported,
  desktopGpuBackendWriteFailed,
  GPU_BACKEND_SETTING_VALUES,
  gpuBackendSettingFromValue,
  gpuBackendValueFromSetting,
  initDesktopGpuBackendActive,
  latchDesktopGpuBackendWriteFailed,
  onDesktopGpuBackendActiveChange,
  onDesktopGpuBackendWriteFailed,
  pushDesktopGpuBackend,
  resetDesktopGpuBackendActiveForTest,
  startDesktopBackendProbe,
  syncDesktopGpuBackendSetting,
} from '../src/game/desktop_gpu_backend_sync';
import type { DesktopBridge, DesktopGpuBackendState } from '../src/runtime';

afterEach(() => {
  resetDesktopGpuBackendActiveForTest();
});

function fakeSettingsFactory() {
  const writes: { key: string; value: number }[] = [];
  return {
    writes,
    create: () => ({
      set(key: 'gpuBackend', value: number): number {
        writes.push({ key, value });
        return value;
      },
    }),
  };
}

function bridgeAnswering(
  state: DesktopGpuBackendState | (() => Promise<unknown>),
  hasGpuBackendChoice = true,
) {
  const written: unknown[] = [];
  const bridge = {
    hasGpuBackendChoice,
    getGpuBackend: typeof state === 'function' ? state : () => Promise.resolve(state),
    setGpuBackend: (value: unknown) => {
      written.push(value);
      return Promise.resolve(true);
    },
  } as unknown as DesktopBridge;
  return { bridge, written };
}

describe('the value mapping', () => {
  it('round-trips the four settings and treats anything else as auto', () => {
    for (const setting of ['auto', 'vulkan', 'opengl', 'd3d11'] as const) {
      expect(gpuBackendSettingFromValue(gpuBackendValueFromSetting(setting))).toBe(setting);
    }
    expect(gpuBackendSettingFromValue(1.4)).toBe('vulkan');
    expect(gpuBackendSettingFromValue(9)).toBe('auto');
    expect(gpuBackendValueFromSetting('bogus')).toBe(GPU_BACKEND_SETTING_VALUES.auto);
  });
});

describe('desktopGpuBackendChoices', () => {
  it('lists what the shell offers, filtered to known settings, the Linux three otherwise', () => {
    const shell = (gpuBackendChoices: unknown) =>
      ({ gpuBackendChoices }) as unknown as DesktopBridge;
    expect(desktopGpuBackendChoices(shell(['auto', 'vulkan', 'd3d11', 'opengl']))).toEqual([
      'auto',
      'vulkan',
      'd3d11',
      'opengl',
    ]);
    expect(desktopGpuBackendChoices(shell(['auto', 'metal', 'opengl']))).toEqual([
      'auto',
      'opengl',
    ]);
    expect(desktopGpuBackendChoices(shell(['metal']))).toEqual(DEFAULT_GPU_BACKEND_CHOICES);
    expect(desktopGpuBackendChoices(shell(undefined))).toEqual(DEFAULT_GPU_BACKEND_CHOICES);
    expect(desktopGpuBackendChoices(null)).toEqual(['auto', 'vulkan', 'opengl']);
  });
});

describe('the probe entry point', () => {
  it('is offered only by a shell with the channel on a platform that lists d3d11', () => {
    const shell = (over: Record<string, unknown>) =>
      ({ startBackendProbe: () => Promise.resolve(true), ...over }) as unknown as DesktopBridge;
    expect(
      desktopBackendProbeSupported(
        shell({ gpuBackendChoices: ['auto', 'vulkan', 'd3d11', 'opengl'] }),
      ),
    ).toBe(true);
    expect(
      desktopBackendProbeSupported(shell({ gpuBackendChoices: ['auto', 'vulkan', 'opengl'] })),
    ).toBe(false);
    expect(desktopBackendProbeSupported(shell({}))).toBe(false);
    expect(
      desktopBackendProbeSupported({
        gpuBackendChoices: ['auto', 'd3d11'],
      } as unknown as DesktopBridge),
    ).toBe(false);
    expect(desktopBackendProbeSupported(null)).toBe(false);
  });

  it('starts the probe through the shell and answers what it did, never throwing', async () => {
    let calls = 0;
    const started = {
      startBackendProbe: () => {
        calls += 1;
        return Promise.resolve(true);
      },
    };
    expect(await startDesktopBackendProbe(started as unknown as DesktopBridge)).toBe(true);
    expect(calls).toBe(1);
    const refused = { startBackendProbe: () => Promise.resolve(false) };
    expect(await startDesktopBackendProbe(refused as unknown as DesktopBridge)).toBe(false);
    const broken = { startBackendProbe: () => Promise.reject(new Error('gone')) };
    expect(await startDesktopBackendProbe(broken as unknown as DesktopBridge)).toBe(false);
    expect(await startDesktopBackendProbe(null)).toBe(false);
  });
});

describe('desktopGpuBackendSupported', () => {
  it('needs both bridge methods, and never the shell flag alone', () => {
    expect(desktopGpuBackendSupported(null)).toBe(false);
    expect(desktopGpuBackendSupported({} as DesktopBridge)).toBe(false);
    expect(
      desktopGpuBackendSupported({
        getGpuBackend: () => Promise.resolve(),
      } as unknown as DesktopBridge),
    ).toBe(false);
    expect(desktopGpuBackendSupported(bridgeAnswering({ setting: 'auto' }).bridge)).toBe(true);
  });
});

describe('syncDesktopGpuBackendSetting', () => {
  it('reflects the stored setting into the local store', async () => {
    const { bridge } = bridgeAnswering({ setting: 'opengl' });
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(bridge, factory.create);
    expect(factory.writes).toEqual([
      { key: 'gpuBackend', value: GPU_BACKEND_SETTING_VALUES.opengl },
    ]);
  });

  it('reads the extra fields the shell answers (the trial verdict) as nothing', async () => {
    const { bridge } = bridgeAnswering(() => Promise.resolve({ setting: 'vulkan', verdict: 'ok' }));
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(bridge, factory.create);
    expect(factory.writes).toEqual([
      { key: 'gpuBackend', value: GPU_BACKEND_SETTING_VALUES.vulkan },
    ]);
  });

  it('writes nothing on a missing method, a rejected read, or a malformed answer', async () => {
    const factory = fakeSettingsFactory();
    await syncDesktopGpuBackendSetting(null, factory.create);
    await syncDesktopGpuBackendSetting({} as DesktopBridge, factory.create);
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.reject(new Error('gone'))).bridge,
      factory.create,
    );
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.resolve('vulkan')).bridge,
      factory.create,
    );
    await syncDesktopGpuBackendSetting(
      bridgeAnswering(() => Promise.resolve({ setting: 'bogus' })).bridge,
      factory.create,
    );
    expect(factory.writes).toEqual([]);
  });
});

/** A shell whose setter answers exactly what the case is about. */
function bridgeWriting(write: () => unknown): DesktopBridge {
  return {
    getGpuBackend: () => Promise.resolve(),
    setGpuBackend: write,
  } as unknown as DesktopBridge;
}

describe('pushDesktopGpuBackend', () => {
  it('sends the setting name the stored number means', async () => {
    const { bridge, written } = bridgeAnswering({ setting: 'auto' });
    await pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.vulkan);
    await pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.opengl);
    await pushDesktopGpuBackend(bridge, GPU_BACKEND_SETTING_VALUES.auto);
    expect(written).toEqual(['vulkan', 'opengl', 'auto']);
  });

  it('answers what the shell did with it, and never throws doing so', async () => {
    // Null is "nothing to confirm" (no setter at all), which is NOT a refusal:
    // the caller has no local value to put back and nothing to tell a player.
    await expect(pushDesktopGpuBackend(null, 1)).resolves.toBeNull();
    await expect(pushDesktopGpuBackend({} as DesktopBridge, 1)).resolves.toBeNull();
    await expect(
      pushDesktopGpuBackend(bridgeAnswering({ setting: 'auto' }).bridge, 1),
    ).resolves.toBe(true);
    // The shell answers false when its own prefs write failed, when the sender
    // is untrusted, or when the value is not one it knows: a refusal, not a
    // channel fault, and the one the row exists for.
    await expect(
      pushDesktopGpuBackend(
        bridgeWriting(() => Promise.resolve(false)),
        1,
      ),
    ).resolves.toBe(false);
    await expect(
      pushDesktopGpuBackend(
        bridgeWriting(() => {
          throw new Error('channel closed');
        }),
        1,
      ),
    ).resolves.toBe(false);
    await expect(
      pushDesktopGpuBackend(
        bridgeWriting(() => Promise.reject(new Error('no'))),
        1,
      ),
    ).resolves.toBe(false);
  });
});

describe('the refused-write latch and its subscribers', () => {
  it('carries the refusal, clears on a later write the shell keeps, and wakes once per move', async () => {
    let wakes = 0;
    const unsubscribe = onDesktopGpuBackendWriteFailed(() => {
      wakes += 1;
    });
    expect(desktopGpuBackendWriteFailed()).toBe(false);

    // The apply arm latches the refusal itself, once it has put the local
    // setting back on the shell's stored value.
    latchDesktopGpuBackendWriteFailed(true);
    expect(desktopGpuBackendWriteFailed()).toBe(true);
    expect(wakes).toBe(1);
    // A second refusal says nothing new; a rebuild per push would throw away
    // the control the player is standing on.
    latchDesktopGpuBackendWriteFailed(true);
    expect(wakes).toBe(1);

    // A push the shell refuses leaves the flag to the caller (which reverts
    // first), so it neither clears the line nor repaints behind the revert.
    await expect(
      pushDesktopGpuBackend(
        bridgeWriting(() => Promise.resolve(false)),
        1,
      ),
    ).resolves.toBe(false);
    expect(desktopGpuBackendWriteFailed()).toBe(true);
    expect(wakes).toBe(1);

    // A write that does persist takes the sentence off the row.
    await expect(
      pushDesktopGpuBackend(bridgeAnswering({ setting: 'auto' }).bridge, 1),
    ).resolves.toBe(true);
    expect(desktopGpuBackendWriteFailed()).toBe(false);
    expect(wakes).toBe(2);
    // And a second success is silent for the same reason.
    await pushDesktopGpuBackend(bridgeAnswering({ setting: 'auto' }).bridge, 1);
    expect(wakes).toBe(2);

    unsubscribe();
    latchDesktopGpuBackendWriteFailed(true);
    expect(desktopGpuBackendWriteFailed()).toBe(true);
    expect(wakes).toBe(2);
  });

  it('is forgotten by the test reset, subscribers and all', () => {
    let wakes = 0;
    onDesktopGpuBackendWriteFailed(() => {
      wakes += 1;
    });
    latchDesktopGpuBackendWriteFailed(true);
    expect(wakes).toBe(1);
    resetDesktopGpuBackendActiveForTest();
    expect(desktopGpuBackendWriteFailed()).toBe(false);
    latchDesktopGpuBackendWriteFailed(true);
    expect(wakes).toBe(1);
  });
});

describe('the latched reading and its subscribers', () => {
  // The shell judges the launch seconds after boot, so a surface built before
  // the verdict (the options graphics panel) has to learn it from here.
  function pushingBridge() {
    let push: ((state: unknown) => void) | null = null;
    let subscriptions = 0;
    const bridge = {
      onGpuBackendState: (callback: (state: unknown) => void) => {
        subscriptions += 1;
        push = callback;
        return () => {
          subscriptions -= 1;
          push = null;
        };
      },
    } as unknown as DesktopBridge;
    return {
      bridge,
      send: (state: unknown) => push?.(state),
      liveSubscriptions: () => subscriptions,
    };
  }

  it('wakes subscribers when the reading changes, and stays quiet on an identical re-push', () => {
    const shell = pushingBridge();
    const off = initDesktopGpuBackendActive(shell.bridge);
    let wakes = 0;
    const unsubscribe = onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });

    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(wakes).toBe(1);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
      autoCapped: false,
      verdict: null,
    });

    // The shell resends its state on its own schedule; a rebuild per resend
    // would throw away the control the player is standing on.
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: false,
    });
    expect(wakes).toBe(1);

    // Either field moving is a different reading, and the row says something else.
    shell.send({
      setting: 'vulkan',
      active: 'vulkan-parallel-compile',
      requestedUnavailable: true,
    });
    expect(wakes).toBe(2);
    shell.send({ setting: 'vulkan', active: 'opengl', requestedUnavailable: true });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'opengl',
      requestedUnavailable: true,
      autoCapped: false,
      verdict: null,
    });

    // A payload with nothing to say keeps the reading AND stays silent: an
    // unjudged rung is absent, never a guess.
    shell.send({ setting: 'vulkan' });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'opengl',
      requestedUnavailable: true,
      autoCapped: false,
      verdict: null,
    });

    unsubscribe();
    shell.send({ setting: 'auto', active: 'vulkan-plain', requestedUnavailable: false });
    expect(wakes).toBe(3);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-plain',
      requestedUnavailable: false,
      autoCapped: false,
      verdict: null,
    });
    off();
    expect(shell.liveSubscriptions()).toBe(0);
  });

  it('wakes them for the boot read too, which carries the same payload', async () => {
    let wakes = 0;
    onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });
    const { bridge } = bridgeAnswering({
      setting: 'vulkan',
      active: 'vulkan-plain',
      requestedUnavailable: true,
    });
    await syncDesktopGpuBackendSetting(bridge, fakeSettingsFactory().create);
    expect(wakes).toBe(1);
    expect(desktopGpuBackendActive()).toEqual({
      active: 'vulkan-plain',
      requestedUnavailable: true,
      autoCapped: false,
      verdict: null,
    });
  });

  it('carries the probe verdict as its own field, null when the shell stores none', () => {
    const shell = pushingBridge();
    const off = initDesktopGpuBackendActive(shell.bridge);
    let wakes = 0;
    onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });
    shell.send({
      setting: 'auto',
      active: 'd3d11',
      requestedUnavailable: false,
      verdict: { rung: 'vulkan-parallel-compile', worker: true, stale: false },
    });
    expect(desktopGpuBackendActive()?.verdict).toEqual({
      rung: 'vulkan-parallel-compile',
      worker: true,
      stale: false,
    });
    expect(wakes).toBe(1);
    // The verdict going stale alone is a new reading; an identical re-push is not.
    shell.send({
      setting: 'auto',
      active: 'd3d11',
      requestedUnavailable: false,
      verdict: { rung: 'vulkan-parallel-compile', worker: true, stale: true },
    });
    expect(desktopGpuBackendActive()?.verdict?.stale).toBe(true);
    expect(wakes).toBe(2);
    shell.send({
      setting: 'auto',
      active: 'd3d11',
      requestedUnavailable: false,
      verdict: { rung: 'vulkan-parallel-compile', worker: true, stale: true },
    });
    expect(wakes).toBe(2);
    // A junk verdict is none.
    shell.send({
      setting: 'auto',
      active: 'd3d11',
      requestedUnavailable: false,
      verdict: { rung: 7 } as never,
    });
    expect(desktopGpuBackendActive()?.verdict).toBeNull();
    off();
  });

  it('carries the policy cap as its own field, absent on an older shell meaning not capped', () => {
    const shell = pushingBridge();
    const off = initDesktopGpuBackendActive(shell.bridge);
    let wakes = 0;
    onDesktopGpuBackendActiveChange(() => {
      wakes += 1;
    });
    shell.send({
      setting: 'auto',
      active: 'opengl',
      requestedUnavailable: false,
      autoCapped: true,
    });
    expect(desktopGpuBackendActive()).toEqual({
      active: 'opengl',
      requestedUnavailable: false,
      autoCapped: true,
      verdict: null,
    });
    expect(wakes).toBe(1);
    // The cap moving alone is a different reading (the row's sentence changes).
    shell.send({ setting: 'auto', active: 'opengl', requestedUnavailable: false });
    expect(desktopGpuBackendActive()?.autoCapped).toBe(false);
    expect(wakes).toBe(2);
    // Only a strict true caps.
    shell.send({
      setting: 'auto',
      active: 'opengl',
      requestedUnavailable: false,
      autoCapped: 'yes' as never,
    });
    expect(desktopGpuBackendActive()?.autoCapped).toBe(false);
    expect(wakes).toBe(2);
    off();
  });

  it('subscribes to nothing on a shell without the push channel', () => {
    expect(initDesktopGpuBackendActive(null)).toBeTypeOf('function');
    expect(() => initDesktopGpuBackendActive({} as DesktopBridge)()).not.toThrow();
    expect(desktopGpuBackendActive()).toBeNull();
  });
});
