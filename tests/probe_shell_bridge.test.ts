import { describe, expect, it } from 'vitest';
import type { InterferenceMonitor } from '../src/probe/interference';
import type { ProbeResult } from '../src/probe/probe_run';
import {
  bindWindowState,
  reportEnded,
  shellSink,
  windowStateReasons,
} from '../src/probe/shell_bridge';
import type { DesktopBridge, DesktopProbeWindowState } from '../src/runtime';

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
  let push: ((s: DesktopProbeWindowState) => void) | null = null;
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
  } satisfies DesktopBridge;
  return {
    bridge,
    posted,
    ended,
    push: (s: DesktopProbeWindowState) => push?.(s),
    unbound: () => unbound,
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

describe('shellSink', () => {
  it('posts to the page sink and the shell, and is the page sink alone outside the shell', () => {
    const { bridge, posted } = fakeBridge();
    const seen: unknown[] = [];
    const page = { post: (r: ProbeResult) => void seen.push(r) };
    const result = { ended: 'completed' } as ProbeResult;
    shellSink(bridge, page).post(result);
    expect(seen).toEqual([result]);
    expect(posted).toEqual([result]);
    expect(shellSink(null, page)).toBe(page);
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

describe('reportEnded', () => {
  it('reports the ended state to the shell and nothing outside it', () => {
    const { bridge, ended } = fakeBridge();
    reportEnded(bridge, 'busy');
    expect(ended).toEqual(['busy']);
    expect(() => reportEnded(null, 'completed')).not.toThrow();
  });
});
