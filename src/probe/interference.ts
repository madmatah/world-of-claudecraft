// What disturbs a pass on the page's own evidence: the document hidden or
// blurred, an input event (the player touched the machine), or a throttled
// frame loop (a wall-clock watchdog whose gap against the animation frames
// says the page was starved). The shell's window-state push (minimized,
// hidden, unfocused: with background throttling off the document's own
// visibility never changes) arrives through `note`. A disturbed pass is
// replayed once by the run; still disturbed, it is invalid.
//
// The throttle arm is judged at the END of the pass, not at each tick, because
// the probe's own measured stalls are charged to it afterwards: a section that
// blocks the main thread on purpose (the link section does, that is what it
// measures) would otherwise read its own measurement as interference. See
// ./interference_gap_core.ts for the rule and the run that found it.

import { gapIsStarvation, unexplainedGapMs, WATCHDOG_TICK_MS } from './interference_gap_core';

export interface InterferenceMonitor {
  /** Start a pass: forget what came before. */
  mark(): void;
  /** A stall the pass measured ON PURPOSE, in ms, charged the moment it ends:
   *  it accounts for that much of the delay in the watchdog window it lands in. */
  charge(ms: number): void;
  /** Whether anything disturbed the pass since the mark. */
  disturbed(): boolean;
  reasons(): string[];
  /** A disturbance seen outside the page (the shell's window state). */
  note(reason: string): void;
  dispose(): void;
}

export function createInterferenceMonitor(
  target: Document = document,
  win: Window = window,
): InterferenceMonitor {
  let reasons = new Set<string>();
  const note = (reason: string) => () => {
    reasons.add(reason);
  };
  const onVisibility = () => {
    if (target.visibilityState !== 'visible') reasons.add('hidden');
  };
  const onBlur = note('blur');
  const onInput = note('input');
  target.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('blur', onBlur);
  for (const type of ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart']) {
    win.addEventListener(type, onInput, { passive: true });
  }
  // The watchdog: a timer that should fire every WATCHDOG_TICK_MS. It records
  // the worst gap it saw rather than ruling on it, so a stall the pass charges
  // after the fact can still account for it.
  let last = performance.now();
  let chargedMs = 0;
  let worstUnexplainedMs = 0;
  const watchdog = win.setInterval(() => {
    const now = performance.now();
    worstUnexplainedMs = Math.max(
      worstUnexplainedMs,
      unexplainedGapMs({ gapMs: now - last, chargedMs }),
    );
    chargedMs = 0;
    last = now;
  }, WATCHDOG_TICK_MS);
  const throttled = () => gapIsStarvation(worstUnexplainedMs);
  return {
    mark() {
      reasons = new Set();
      last = performance.now();
      chargedMs = 0;
      worstUnexplainedMs = 0;
    },
    charge(ms: number) {
      if (Number.isFinite(ms) && ms > 0) chargedMs += ms;
    },
    disturbed() {
      return reasons.size > 0 || throttled();
    },
    reasons() {
      return throttled() ? [...reasons, 'throttled'] : [...reasons];
    },
    note(reason: string) {
      reasons.add(reason);
    },
    dispose() {
      target.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('blur', onBlur);
      for (const type of ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart']) {
        win.removeEventListener(type, onInput);
      }
      win.clearInterval(watchdog);
    },
  };
}
