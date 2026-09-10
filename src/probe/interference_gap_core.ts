// Telling the probe's OWN stall apart from an outside disturbance.
//
// The interference monitor watches a 250 ms timer: a wall-clock gap much larger
// than its cadence says the page was starved, and the pass is replayed and then
// thrown away. But the link section deliberately blocks the main thread, which
// is the very thing it measures: on the first Windows run a cold Direct3D 11
// link took 524 ms in the median and 723 ms at the worst, twelve of them per
// pass, and the watchdog read the measurement as interference. Both passes of
// the reference arm went invalid, so the run could not decide at all. The
// systematic shape of that is what makes it a defect rather than bad luck: the
// worse a backend is at linking, the more likely the probe throws its evidence
// away, on exactly the machines the probe exists for.
//
// So a section CHARGES the monitor the moment it finishes a stall it measured
// on purpose, and each watchdog tick judges only the delay its own window's
// charges do not account for. Charging as it happens rather than at the end of
// the pass is what keeps the accounting exact: the charge lands in the same
// window as the gap it caused, so nothing has to be guessed from totals. What
// the rule buys, in the two directions that matter: a machine slow enough that
// every link takes two seconds reports its honest two seconds instead of going
// invalid, and a freeze longer than the measured work around it is still caught.

/** The watchdog's cadence: it should fire this often. */
export const WATCHDOG_TICK_MS = 250;

/** How much unexplained delay in one window makes a pass starved rather than jittery. */
export const STARVATION_GAP_MS = 1000;

export interface GapWindow {
  /** Wall clock between this watchdog tick and the one before it. */
  gapMs: number;
  /** What the pass measured on purpose inside that window. */
  chargedMs: number;
}

/**
 * The delay in one window that no measured stall accounts for. Never negative:
 * a window whose charges cover the whole gap is fully explained. A figure that
 * is not a usable number counts as nothing measured, so a broken charge can
 * only make the monitor more suspicious, never less.
 */
export function unexplainedGapMs({ gapMs, chargedMs }: GapWindow): number {
  const gap = Number.isFinite(gapMs) && gapMs > 0 ? gapMs : 0;
  const charged = Number.isFinite(chargedMs) && chargedMs > 0 ? chargedMs : 0;
  return Math.max(0, gap - charged);
}

/** Whether a pass was starved by something other than its own measurement. */
export function gapIsStarvation(
  worstUnexplainedMs: number,
  thresholdMs: number = STARVATION_GAP_MS,
): boolean {
  return Number.isFinite(worstUnexplainedMs) && worstUnexplainedMs > thresholdMs;
}
