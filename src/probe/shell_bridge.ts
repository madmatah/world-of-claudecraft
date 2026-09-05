// The probe page's side of the desktop bridge: inside a probe child the page
// posts its result to the child (which writes it to disk) and reports how the
// run ended (the child's exit code), and the child's window-state push feeds
// the interference monitor. Outside the shell every function is a no-op over
// a null bridge, so the page behaves the same in a plain browser.

import type { DesktopBridge, DesktopProbeWindowState } from '../runtime';
import type { InterferenceMonitor } from './interference';
import type { ProbeResult, ProbeSink } from './probe_run';

/** The disturbance reasons a window state carries: none when the window is
 *  restored, visible and focused. */
export function windowStateReasons(state: DesktopProbeWindowState): string[] {
  const reasons: string[] = [];
  if (state.minimized) reasons.push('minimized');
  if (!state.visible) reasons.push('hidden');
  if (!state.focused) reasons.push('blur');
  return reasons;
}

/** A sink that posts to the shell AND to the page's own sink (the page's
 *  status line reads the page sink). A shell that refuses a post (an
 *  envelope it does not accept) is not the page's problem to retry. */
export function shellSink(bridge: DesktopBridge | null, page: ProbeSink): ProbeSink {
  const post = bridge?.probePost;
  if (typeof post !== 'function') return page;
  return {
    post(result: ProbeResult) {
      page.post(result);
      void post.call(bridge, result).catch(() => false);
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
