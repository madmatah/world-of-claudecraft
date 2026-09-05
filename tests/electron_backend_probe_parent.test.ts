import { describe, expect, it } from 'vitest';
import {
  acceptDecision,
  createBackendProbeParent,
  probeIneligibility,
  probePageUrl,
  startPayload,
} from '../electron/backend_probe_parent.cjs';

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
