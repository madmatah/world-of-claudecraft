// What disturbs a pass on the page's own evidence: the document hidden or
// blurred, an input event (the player touched the machine), or a throttled
// frame loop (a wall-clock watchdog whose gap against the animation frames
// says the page was starved). The shell adds its window-state push in
// step 2; this monitor is what a plain browser has. A disturbed pass is
// replayed once by the run; still disturbed, it is invalid.

export interface InterferenceMonitor {
  /** Start a pass: forget what came before. */
  mark(): void;
  /** Whether anything disturbed the pass since the mark. */
  disturbed(): boolean;
  reasons(): string[];
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
  // The watchdog: a timer that should fire every 250 ms; a gap of more than
  // a second means the page was throttled or the thread starved.
  let last = performance.now();
  const watchdog = win.setInterval(() => {
    const now = performance.now();
    if (now - last > 1000) reasons.add('throttled');
    last = now;
  }, 250);
  return {
    mark() {
      reasons = new Set();
      last = performance.now();
    },
    disturbed() {
      return reasons.size > 0;
    },
    reasons() {
      return [...reasons];
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
