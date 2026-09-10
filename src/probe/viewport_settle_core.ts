// Waiting for the window to stop moving before anything is measured.
//
// The probe reads its canvas size ONCE, from the viewport, and the shell puts
// its windows full screen only after the page has loaded (the mode change waits
// for the first paint: a Vulkan swapchain has died on a window that changed mode
// before its first frame). The two race: the page can be several frames into its
// run when the window resizes under it, which moves the compositor path in the
// middle of a measurement and can leave one arm measured windowed and the next
// one full screen. So the run waits for the viewport to hold still first.
//
// Still means unchanged for a few consecutive painted frames, not "changed once
// and stopped": a mode change reports several intermediate sizes on the way. The
// wait is bounded, because a viewport that never settles must not hang a run.

/** Consecutive identical frames that count as settled. */
export const SETTLE_FRAMES = 6;

/** How long the run may wait for it before measuring anyway. */
export const SETTLE_MAX_MS = 2000;

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * Whether the last `frames` samples are all the same size. Fewer samples than
 * that is never settled: the point is to see the window hold, not to catch it
 * between two steps of a transition.
 */
export function viewportSettled(
  samples: readonly ViewportSize[],
  frames: number = SETTLE_FRAMES,
): boolean {
  if (frames < 1 || samples.length < frames) return false;
  const tail = samples.slice(-frames);
  const first = tail[0];
  if (!first) return false;
  return tail.every((size) => size.width === first.width && size.height === first.height);
}
