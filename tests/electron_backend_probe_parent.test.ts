import { describe, expect, it } from 'vitest';
import {
  acceptDecision,
  createBackendProbeParent,
  probeIneligibility,
  probePageUrl,
  startPayload,
} from '../electron/backend_probe_parent.cjs';
import { PROBE_EXIT } from '../electron/backend_probe_plan.cjs';
import { PROBE_VERSION } from '../electron/backend_probe_result.cjs';

describe('probeIneligibility', () => {
  it('runs on packaged Windows builds only, unless forced for development', () => {
    expect(probeIneligibility({ platform: 'win32', isPackaged: true, env: {} })).toBeNull();
    expect(probeIneligibility({ platform: 'linux', isPackaged: true, env: {} })).toMatch(/Windows/);
    expect(probeIneligibility({ platform: 'win32', isPackaged: false, env: {} })).toMatch(
      /packaged/,
    );
    expect(
      probeIneligibility({
        platform: 'win32',
        isPackaged: true,
        devServerUrl: 'http://localhost:5173',
        env: {},
      }),
    ).toMatch(/dev server/);
    expect(
      probeIneligibility({
        platform: 'linux',
        isPackaged: false,
        env: { WOC_BACKEND_PROBE_FORCE: '1' },
      }),
    ).toBeNull();
    // Never on a shipped build, whatever the env says.
    expect(
      probeIneligibility({
        platform: 'linux',
        isPackaged: true,
        env: { WOC_BACKEND_PROBE_FORCE: '1' },
      }),
    ).toMatch(/Windows/);
  });
});

describe('startPayload and acceptDecision', () => {
  it('validates the consent payload, defaulting an unknown locale or tier', () => {
    expect(startPayload({ locale: 'fr', tier: 'high' })).toEqual({ locale: 'fr', tier: 'high' });
    expect(startPayload({ locale: 'zh_CN', tier: 'insane' })).toEqual({
      locale: 'zh_CN',
      tier: 'insane',
    });
    expect(startPayload({ locale: '../x', tier: 'turbo' })).toEqual({
      locale: 'en',
      tier: 'ultra',
    });
    expect(startPayload(null)).toBeNull();
  });

  it('accepts a decision envelope and refuses an unknown backend', () => {
    expect(
      acceptDecision({
        backend: 'd3d11',
        backendClass: 'd3d11',
        worker: true,
        secondRoundTriggers: ['x', 7],
        inconclusive: null,
        figures: { a: 1 },
        extra: 1,
      }),
    ).toEqual({
      backend: 'd3d11',
      backendClass: 'd3d11',
      worker: true,
      secondRoundTriggers: ['x'],
      inconclusive: null,
      figures: { a: 1 },
    });
    expect(acceptDecision({ backend: null })).toMatchObject({ backend: null, worker: false });
    expect(acceptDecision({ backend: 'metal' })).toBeNull();
    expect(acceptDecision('d3d11')).toBeNull();
  });

  it('builds the probe page URL with its view', () => {
    expect(probePageUrl('app://worldofclaudecraft', 'verdict', { run: 'r1', round: '2' })).toBe(
      'app://worldofclaudecraft/backend-probe.html?view=verdict&run=r1&round=2',
    );
  });
});

describe('createBackendProbeParent', () => {
  function rig() {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const windows: FakeWindow[] = [];
    class FakeWindow {
      visible = false;
      focused = 0;
      urls: string[] = [];
      sent: { channel: string; payload: unknown }[] = [];
      listeners = new Map<string, () => void>();
      webContents = {
        send: (channel: string, payload: unknown) => void this.sent.push({ channel, payload }),
      };
      constructor() {
        windows.push(this);
      }
      once(event: string, cb: () => void) {
        this.listeners.set(event, cb);
      }
      on(event: string, cb: () => void) {
        this.listeners.set(event, cb);
      }
      loadURL(url: string) {
        this.urls.push(url);
        return Promise.resolve();
      }
      isDestroyed() {
        return false;
      }
      isVisible() {
        return this.visible;
      }
      show() {
        this.visible = true;
      }
      hide() {
        this.visible = false;
      }
      focus() {
        this.focused += 1;
      }
    }
    const quits: number[] = [];
    const saved: unknown[] = [];
    const desktopPrefs: Record<string, unknown> = { gpuBackend: 'vulkan' };
    const parent = createBackendProbeParent({
      app: {
        quit: () => void quits.push(1),
        getPath: () => '/ud',
        getVersion: () => '0.42.0',
      },
      BrowserWindow: FakeWindow,
      ipcMain: {
        handle: (channel: string, cb: (event: unknown, ...args: unknown[]) => unknown) =>
          void handles.set(channel, cb),
      },
      log: { info() {}, warn() {}, error() {} },
      trustedSender: (event: unknown) => event === 'trusted',
      appOrigin: 'app://worldofclaudecraft',
      preloadPath: '/preload.cjs',
      iconPath: '/icon.png',
      argv: ['--test-backends', '--x'],
      env: {},
      desktopPrefs,
      savePrefs: (next: unknown) => {
        saved.push(next);
        return true;
      },
      corpusHash: 'abc',
      distribution: 'website',
      gpuForceOptOut: false,
      arm64: false,
      restartIntoGame: () => Promise.resolve(true),
    });
    return { parent, handles, windows, quits, saved, desktopPrefs };
  }

  it('registers the four handles gated on the trusted sender and opens the consent view', () => {
    const { parent, handles, windows } = rig();
    parent.start();
    expect([...handles.keys()].sort()).toEqual([
      'desktop-probe-action',
      'desktop-probe-results',
      'desktop-probe-start',
      'desktop-probe-verdict',
    ]);
    expect(windows).toHaveLength(1);
    expect(windows[0].urls).toEqual(['app://worldofclaudecraft/backend-probe.html?view=consent']);
    for (const handle of handles.values()) {
      expect(handle('untrusted', { locale: 'en', tier: 'ultra' })).toBeFalsy();
    }
    expect(handles.get('desktop-probe-results')?.('trusted')).toBeNull();
    expect(handles.get('desktop-probe-verdict')?.('trusted', { backend: null })).toBe(false);
  });

  it('answers the verdict buttons: cancel quits, auto rewrites only the setting, play restarts', async () => {
    const { parent, handles, quits, saved, desktopPrefs } = rig();
    parent.start();
    const action = handles.get('desktop-probe-action') as (e: unknown, a: string) => unknown;
    expect(action('trusted', 'cancel')).toBe(true);
    expect(quits).toHaveLength(1);
    // Outside the verdict phase the other actions are refused.
    expect(action('trusted', 'auto')).toBe(false);
    expect(action('trusted', 'play')).toBe(false);
    expect(action('trusted', 'nope')).toBe(false);
    expect(saved).toHaveLength(0);
    expect(desktopPrefs.gpuBackend).toBe('vulkan');
  });

  it('strips the flag from the argv the verdict restarts the game with', () => {
    const { parent } = rig();
    expect(parent.gameArgv()).toEqual(['--x']);
  });

  it('shows the window on a second instance outside an arm', () => {
    const { parent, windows } = rig();
    parent.start();
    parent.onSecondInstance();
    expect(windows[0].visible).toBe(true);
    expect(windows[0].focused).toBe(1);
  });
});

describe('createBackendProbeParent, a scripted run', () => {
  // The orchestrator's world is injected: children "exit" on the next tick
  // with the result the script gives their arm, the page's decide is played
  // back by the test through the verdict handle when the window navigates to
  // the decide view, and the prefs write is captured.
  function scripted(options: {
    arms: Record<string, { code: number; ended?: string }>;
    decision: (round: number) => Record<string, unknown>;
    prefs?: Record<string, unknown>;
    savePrefsAnswer?: boolean;
  }) {
    const handles = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const files = new Map<string, unknown>();
    const spawned: { arm: string; round: number }[] = [];
    const windows: FakeWindow[] = [];
    class FakeWindow {
      visible = false;
      urls: string[] = [];
      sent: { channel: string; payload: unknown }[] = [];
      webContents = {
        send: (channel: string, payload: unknown) => void this.sent.push({ channel, payload }),
      };
      constructor() {
        windows.push(this);
      }
      once() {}
      on() {}
      loadURL(url: string) {
        this.urls.push(url);
        if (url.includes('phase=decide')) {
          const round = Number(new URL(url).searchParams.get('round'));
          setTimeout(() => {
            void handles.get('desktop-probe-verdict')?.('trusted', options.decision(round));
          }, 0);
        }
        return Promise.resolve();
      }
      isDestroyed() {
        return false;
      }
      isVisible() {
        return this.visible;
      }
      show() {
        this.visible = true;
      }
      hide() {
        this.visible = false;
      }
      focus() {}
    }
    const saved: unknown[] = [];
    const desktopPrefs: Record<string, unknown> = { gpuBackend: 'auto', ...(options.prefs ?? {}) };
    let restarted = 0;
    const parent = createBackendProbeParent({
      app: { quit() {}, getPath: () => '/ud', getVersion: () => '0.42.0' },
      BrowserWindow: FakeWindow,
      ipcMain: {
        handle: (channel: string, cb: (event: unknown, ...args: unknown[]) => unknown) =>
          void handles.set(channel, cb),
      },
      log: { info() {}, warn() {}, error() {} },
      trustedSender: (event: unknown) => event === 'trusted',
      appOrigin: 'app://worldofclaudecraft',
      preloadPath: '/preload.cjs',
      iconPath: '/icon.png',
      argv: ['--test-backends'],
      env: {},
      desktopPrefs,
      savePrefs: (next: unknown) => {
        saved.push(next);
        return options.savePrefsAnswer ?? true;
      },
      corpusHash: 'stamped',
      distribution: 'website',
      gpuForceOptOut: false,
      arm64: false,
      chromeVersion: '151.0.0.0',
      restartIntoGame: () => {
        restarted += 1;
        return Promise.resolve(true);
      },
      orchestrator: {
        fs: {
          mkdir() {},
          rm() {},
          fileMtimeMs: () => null,
          readResultFile: (path: string) => files.get(path) ?? null,
        },
        timers: { setInterval: () => 0, clearInterval() {} },
        now: () => 0,
        spawn: ({ env, onExit }) => {
          const arm = env.WOC_BACKEND_PROBE_ARM as string;
          const round = Number(env.WOC_BACKEND_PROBE_ROUND);
          spawned.push({ arm, round });
          const script = options.arms[arm] ?? { code: 0 };
          const result = {
            probeVersion: PROBE_VERSION,
            run: env.WOC_BACKEND_PROBE_RUN,
            round,
            ended: script.ended ?? 'completed',
            corpusHash: 'measured',
            sections: {},
          };
          files.set(env.WOC_BACKEND_PROBE_RESULT as string, {
            outcome: 'running',
            adapter: '0x10de:0x2504',
            driverVersion: '560.94',
            result,
          });
          setTimeout(() => onExit({ code: script.code, signal: null }), 0);
          return { pid: 1, kill() {} };
        },
      },
    });
    parent.start();
    const start = () =>
      handles.get('desktop-probe-start')?.('trusted', { locale: 'fr', tier: 'high' });
    const action = (a: string) => handles.get('desktop-probe-action')?.('trusted', a);
    const results = () => handles.get('desktop-probe-results')?.('trusted');
    const settled = async () => {
      for (let i = 0; i < 50; i += 1) await new Promise((resolve) => setTimeout(resolve, 2));
    };
    return {
      parent,
      windows,
      spawned,
      saved,
      desktopPrefs,
      start,
      action,
      results,
      settled,
      restarted: () => restarted,
    };
  }

  const decided = (backend: string | null, triggers: string[] = []) => ({
    backend,
    backendClass: backend?.startsWith('vulkan') ? 'vulkan' : 'd3d11',
    worker: true,
    secondRoundTriggers: triggers,
    inconclusive: backend === null ? 'no surviving backend' : null,
  });

  it('runs the arms, has the page decide, writes the verdict off the winner, and shows it', async () => {
    const r = scripted({
      arms: {
        d3d11: { code: PROBE_EXIT.completed },
        'vulkan-parallel-compile': { code: 0 },
        opengl: { code: 0 },
      },
      decision: () => decided('vulkan-parallel-compile'),
    });
    expect(r.start()).toBe(true);
    await r.settled();
    expect(r.spawned.map((s) => `${s.arm}#${s.round}`)).toEqual([
      'd3d11#1',
      'vulkan-parallel-compile#1',
      'opengl#1',
    ]);
    // The verdict written into the prefs, with the corpus the winner measured on.
    expect(r.saved).toHaveLength(1);
    const verdict = (r.saved[0] as { backendProbeVerdict: Record<string, unknown> })
      .backendProbeVerdict;
    expect(verdict).toMatchObject({
      rung: 'vulkan-parallel-compile',
      backend: 'vulkan',
      worker: true,
      corpusHash: 'measured',
      adapter: '0x10de:0x2504',
      driverVersion: '560.94',
      stale: false,
    });
    expect(r.desktopPrefs.backendProbeVerdict).toBe(verdict);
    // The window ends visible on the verdict view, and the results handle says final.
    expect(r.windows[0].visible).toBe(true);
    expect(r.windows[0].urls.at(-1)).toContain('view=verdict');
    expect(r.results()).toMatchObject({ phase: 'final', written: true, inconclusive: null });
    // The buttons in the verdict phase: play restarts; auto rewrites the setting only.
    expect(await r.action('play')).toBe(true);
    expect(r.restarted()).toBe(1);
    r.desktopPrefs.gpuBackend = 'vulkan';
    expect(await r.action('auto')).toBe(true);
    expect(r.saved.at(-1)).toMatchObject({ gpuBackend: 'auto' });
    expect(r.desktopPrefs.gpuBackend).toBe('auto');
    expect(await r.action('auto')).toBe(true);
    expect(r.saved).toHaveLength(2);
  });

  it('runs a second round on the triggers, then decides again', async () => {
    let rounds = 0;
    const r = scripted({
      arms: {
        d3d11: { code: 0 },
        'vulkan-parallel-compile': { code: PROBE_EXIT.died },
        opengl: { code: 0 },
      },
      decision: (round) => {
        rounds += 1;
        return decided('d3d11', round === 1 ? ['vulkan-parallel-compile died once'] : []);
      },
    });
    r.start();
    await r.settled();
    // A dead Vulkan child adds vulkan-plain; round two reverses the order.
    expect(r.spawned.map((s) => `${s.arm}#${s.round}`)).toEqual([
      'd3d11#1',
      'vulkan-parallel-compile#1',
      'vulkan-plain#1',
      'opengl#1',
      'opengl#2',
      'vulkan-plain#2',
      'vulkan-parallel-compile#2',
      'd3d11#2',
    ]);
    expect(rounds).toBe(2);
    expect(r.saved).toHaveLength(1);
  });

  it('writes nothing when the decision is inconclusive or an arm was inconclusive', async () => {
    const none = scripted({
      arms: { d3d11: { code: 0 }, 'vulkan-parallel-compile': { code: 0 }, opengl: { code: 0 } },
      decision: () => decided(null),
    });
    none.start();
    await none.settled();
    expect(none.saved).toHaveLength(0);
    expect(none.results()).toMatchObject({
      phase: 'final',
      written: false,
      inconclusive: 'no surviving backend',
    });
    const hung = scripted({
      arms: {
        d3d11: { code: 0 },
        'vulkan-parallel-compile': { code: PROBE_EXIT.rendererGone },
        opengl: { code: 0 },
      },
      decision: () => decided('d3d11'),
    });
    hung.start();
    await hung.settled();
    expect(hung.saved).toHaveLength(0);
    expect(hung.results()).toMatchObject({ phase: 'final', written: false });
    expect((hung.results() as { inconclusive: string }).inconclusive).toContain('renderer-gone');
  });

  it('queues a second instance during an arm and shows the window between arms', async () => {
    const r = scripted({
      arms: { d3d11: { code: 0 }, 'vulkan-parallel-compile': { code: 0 }, opengl: { code: 0 } },
      decision: () => decided('d3d11'),
    });
    // The scripted spawn exits on the next tick; the window is hidden while
    // the arm runs, so the second instance arriving in that tick is queued.
    r.start();
    r.parent.onSecondInstance();
    expect(r.windows[0].visible).toBe(false);
    await r.settled();
    // Drained between arms: the window came up.
    expect(r.windows[0].visible).toBe(true);
  });
});
