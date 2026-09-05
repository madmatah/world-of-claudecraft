// The probe page's side of the desktop bridge. In a probe CHILD the page
// posts its result to the child (which writes it to disk), keeps a heartbeat
// going between sections (the parent's hang guard reads the file's mtime),
// reports how the run ended (the child's exit code), and the child's
// window-state push feeds the interference monitor. In the PARENT's window
// the consent view starts the run, the progress view hears the pushes, and
// the verdict view reads the rounds, decides and posts the decision back.
// Outside the shell every function is a no-op over a null bridge, so the
// page behaves the same in a plain browser.

import type {
  DesktopBridge,
  DesktopProbeAction,
  DesktopProbeProgress,
  DesktopProbeResults,
  DesktopProbeWindowState,
} from '../runtime';
import type { InterferenceMonitor } from './interference';
import type { ProbeResult, ProbeSink } from './probe_run';

/** How often the latest result is re-posted while the run is alive. */
export const HEARTBEAT_MS = 2000;

/** The disturbance reasons a window state carries: none when the window is
 *  restored, visible and focused. */
export function windowStateReasons(state: DesktopProbeWindowState): string[] {
  const reasons: string[] = [];
  if (state.minimized) reasons.push('minimized');
  if (!state.visible) reasons.push('hidden');
  if (!state.focused) reasons.push('blur');
  return reasons;
}

export interface ShellSink {
  sink: ProbeSink;
  /** Stop the heartbeat (the run ended). */
  dispose(): void;
}

/**
 * A sink that posts to the shell AND to the page's own sink (the page's
 * status line reads the page sink), and re-posts the latest result on the
 * heartbeat so the shell sees progress between sections. Outside the shell
 * the page sink alone, no heartbeat. A shell that refuses a post (an
 * envelope it does not accept) is not the page's problem to retry.
 */
export function createShellSink(
  bridge: DesktopBridge | null,
  page: ProbeSink,
  timers: { setInterval: typeof setInterval; clearInterval: typeof clearInterval } = globalThis,
): ShellSink {
  const post = bridge?.probePost;
  if (typeof post !== 'function') return { sink: page, dispose() {} };
  let latest: ProbeResult | null = null;
  const send = () => {
    if (latest) void post.call(bridge, latest).catch(() => false);
  };
  const beat = timers.setInterval(send, HEARTBEAT_MS);
  return {
    sink: {
      post(result: ProbeResult) {
        page.post(result);
        latest = result;
        send();
      },
    },
    dispose() {
      timers.clearInterval(beat);
    },
  };
}

/** Feed the shell's window-state push into the monitor; returns the unbind. */
export function bindWindowState(
  bridge: DesktopBridge | null,
  monitor: InterferenceMonitor,
): () => void {
  const subscribe = bridge?.onProbeWindowState;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, (state) => {
    for (const reason of windowStateReasons(state)) monitor.note(reason);
  });
}

/** Tell the shell how the run ended; a no-op outside it. */
export function reportEnded(bridge: DesktopBridge | null, ended: ProbeResult['ended']): void {
  const report = bridge?.probeEnded;
  if (typeof report !== 'function') return;
  void report.call(bridge, ended).catch(() => false);
}

/** Start the run from the consent view; false outside the shell. */
export function startInShell(
  bridge: DesktopBridge | null,
  payload: { locale: string; tier: string },
): Promise<boolean> {
  const start = bridge?.probeStart;
  if (typeof start !== 'function') return Promise.resolve(false);
  return start.call(bridge, payload).catch(() => false);
}

/** The verdict view's buttons; false outside the shell. */
export function actInShell(
  bridge: DesktopBridge | null,
  action: DesktopProbeAction,
): Promise<boolean> {
  const act = bridge?.probeAction;
  if (typeof act !== 'function') return Promise.resolve(false);
  return act.call(bridge, action).catch(() => false);
}

/** The progress view's subscription; a no-op unbind outside the shell. */
export function subscribeProgress(
  bridge: DesktopBridge | null,
  callback: (progress: DesktopProbeProgress) => void,
): () => void {
  const subscribe = bridge?.onProbeProgress;
  if (typeof subscribe !== 'function') return () => {};
  return subscribe.call(bridge, callback);
}

/** What the parent has for the verdict view, or null outside the shell. */
export function readResultsInShell(
  bridge: DesktopBridge | null,
): Promise<DesktopProbeResults | null> {
  const read = bridge?.probeResults;
  if (typeof read !== 'function') return Promise.resolve(null);
  return read.call(bridge).catch(() => null);
}

/** Post the decision the verdict view computed; false outside the shell. */
export function postVerdictInShell(
  bridge: DesktopBridge | null,
  decision: unknown,
): Promise<boolean> {
  const post = bridge?.probeVerdict;
  if (typeof post !== 'function') return Promise.resolve(false);
  return post.call(bridge, decision).catch(() => false);
}
