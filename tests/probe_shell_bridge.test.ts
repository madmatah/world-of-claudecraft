import { describe, expect, it } from 'vitest';
import type { InterferenceMonitor } from '../src/probe/interference';
import type { ProbeResult } from '../src/probe/probe_run';
import {
  actInShell,
  bindWindowState,
  createShellSink,
  HEARTBEAT_MS,
  postVerdictInShell,
  readResultsInShell,
  reportEnded,
  startInShell,
  subscribeProgress,
  windowStateReasons,
} from '../src/probe/shell_bridge';
import type { DesktopBridge, DesktopProbeProgress, DesktopProbeWindowState } from '../src/runtime';

const state = (over: Partial<DesktopProbeWindowState> = {}): DesktopProbeWindowState => ({
  minimized: false,
  visible: true,
  focused: true,
  ...over,
});

const fakeMonitor = () => {
  const noted: string[] = [];
  const monitor: InterferenceMonitor = {
    mark() {},
    disturbed: () => noted.length > 0,
    reasons: () => [...noted],
    note: (reason) => {
      noted.push(reason);
    },
    dispose() {},
  };
  return { monitor, noted };
};

const fakeBridge = () => {
  const posted: unknown[] = [];
  const ended: string[] = [];
  const started: unknown[] = [];
  const actions: string[] = [];
  const verdicts: unknown[] = [];
  let push: ((s: DesktopProbeWindowState) => void) | null = null;
  let progress: ((p: DesktopProbeProgress) => void) | null = null;
  let unbound = 0;
  const bridge = {
    openBrowserLogin: async () => {},
    takeLoginCode: async () => null,
    onLoginCode: () => () => {},
    probePost: async (result: unknown) => {
      posted.push(result);
      return true;
    },
    probeEnded: async (value: string) => {
      ended.push(value);
      return true;
    },
    onProbeWindowState: (callback: (s: DesktopProbeWindowState) => void) => {
      push = callback;
      return () => {
        unbound += 1;
      };
    },
    probeStart: async (payload: { locale: string; tier: string }) => {
      started.push(payload);
      return true;
    },
    probeAction: async (action: string) => {
      actions.push(action);
      return true;
    },
    probeResults: async () => ({
      phase: 'decide' as const,
      round: 1,
      arms: [],
      storedVerdictRung: null,
      arm64: false,
    }),
    probeVerdict: async (decision: unknown) => {
      verdicts.push(decision);
      return true;
    },
    onProbeProgress: (callback: (p: DesktopProbeProgress) => void) => {
      progress = callback;
      return () => {
        unbound += 1;
      };
    },
  } satisfies DesktopBridge;
  return {
    bridge,
    posted,
    ended,
    started,
    actions,
    verdicts,
    push: (s: DesktopProbeWindowState) => push?.(s),
    progress: (p: DesktopProbeProgress) => progress?.(p),
    unbound: () => unbound,
  };
};

const fakeTimers = () => {
  const intervals: { cb: () => void; ms: number; id: number }[] = [];
  let next = 1;
  return {
    intervals,
    timers: {
      setInterval: ((cb: () => void, ms: number) => {
        const id = next++;
        intervals.push({ cb, ms, id });
        return id;
      }) as unknown as typeof setInterval,
      clearInterval: ((id: number) => {
        const at = intervals.findIndex((i) => i.id === id);
        if (at >= 0) intervals.splice(at, 1);
      }) as unknown as typeof clearInterval,
    },
  };
};

describe('windowStateReasons', () => {
  it('names each disturbed dimension and nothing for a restored focused window', () => {
    expect(windowStateReasons(state())).toEqual([]);
    expect(windowStateReasons(state({ minimized: true }))).toEqual(['minimized']);
    expect(windowStateReasons(state({ visible: false }))).toEqual(['hidden']);
    expect(windowStateReasons(state({ focused: false }))).toEqual(['blur']);
    expect(windowStateReasons(state({ minimized: true, visible: false, focused: false }))).toEqual([
      'minimized',
      'hidden',
      'blur',
    ]);
  });
});

describe('createShellSink', () => {
  it('posts to the page sink and the shell, re-posts on the heartbeat, and stops on dispose', () => {
    const { bridge, posted } = fakeBridge();
    const { timers, intervals } = fakeTimers();
    const seen: unknown[] = [];
    const page = { post: (r: ProbeResult) => void seen.push(r) };
    const shell = createShellSink(bridge, page, timers);
    expect(intervals).toHaveLength(1);
    expect(intervals[0].ms).toBe(HEARTBEAT_MS);
    // Nothing to beat before the first post.
    intervals[0].cb();
    expect(posted).toHaveLength(0);
    const result = { ended: 'completed' } as ProbeResult;
    shell.sink.post(result);
    expect(seen).toEqual([result]);
    expect(posted).toEqual([result]);
    intervals[0].cb();
    expect(posted).toEqual([result, result]);
    shell.dispose();
    expect(intervals).toHaveLength(0);
  });

  it('is the page sink alone, with no heartbeat, outside the shell', () => {
    const { timers, intervals } = fakeTimers();
    const page = { post: () => {} };
    const shell = createShellSink(null, page, timers);
    expect(shell.sink).toBe(page);
    expect(intervals).toHaveLength(0);
    shell.dispose();
  });
});

describe('bindWindowState', () => {
  it('feeds the push into the monitor and unbinds', () => {
    const { bridge, push, unbound } = fakeBridge();
    const { monitor, noted } = fakeMonitor();
    const unbind = bindWindowState(bridge, monitor);
    push(state({ minimized: true, focused: false }));
    expect(noted).toEqual(['minimized', 'blur']);
    push(state());
    expect(noted).toEqual(['minimized', 'blur']);
    unbind();
    expect(unbound()).toBe(1);
    expect(bindWindowState(null, monitor)).toBeTypeOf('function');
  });
});

describe('the parent-window helpers', () => {
  it('start, act, read, post and subscribe reach the bridge, and are no-ops outside it', async () => {
    const f = fakeBridge();
    expect(await startInShell(f.bridge, { locale: 'fr', tier: 'high' })).toBe(true);
    expect(f.started).toEqual([{ locale: 'fr', tier: 'high' }]);
    expect(await actInShell(f.bridge, 'play')).toBe(true);
    expect(f.actions).toEqual(['play']);
    expect(await readResultsInShell(f.bridge)).toMatchObject({ phase: 'decide', round: 1 });
    expect(await postVerdictInShell(f.bridge, { backend: 'd3d11' })).toBe(true);
    expect(f.verdicts).toEqual([{ backend: 'd3d11' }]);
    const heard: DesktopProbeProgress[] = [];
    const unbind = subscribeProgress(f.bridge, (p) => void heard.push(p));
    f.progress({ phase: 'arm', arm: 'd3d11', round: 1, index: 0, total: 3 });
    expect(heard).toHaveLength(1);
    unbind();
    expect(f.unbound()).toBe(1);
    expect(await startInShell(null, { locale: 'en', tier: 'ultra' })).toBe(false);
    expect(await actInShell(null, 'cancel')).toBe(false);
    expect(await readResultsInShell(null)).toBeNull();
    expect(await postVerdictInShell(null, {})).toBe(false);
    expect(subscribeProgress(null, () => {})).toBeTypeOf('function');
  });

  it('reports the ended state to the shell and nothing outside it', () => {
    const { bridge, ended } = fakeBridge();
    reportEnded(bridge, 'busy');
    expect(ended).toEqual(['busy']);
    expect(() => reportEnded(null, 'completed')).not.toThrow();
  });
});
