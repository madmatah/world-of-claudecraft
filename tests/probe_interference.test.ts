// The interference monitor as the run drives it. The rule under test: the probe
// charges the stalls it measured on purpose, and a watchdog gap those stalls
// account for is not interference. Without it the link section reads its own
// measurement as a disturbance, which is what invalidated both passes of the
// reference arm on the first Windows run.
import { describe, expect, it } from 'vitest';
import { createInterferenceMonitor } from '../src/probe/interference';
import { WATCHDOG_TICK_MS } from '../src/probe/interference_gap_core';

/** A window whose clock and interval the test drives by hand. */
function rig() {
  let now = 0;
  let tick: (() => void) | null = null;
  const listeners = new Map<string, Set<() => void>>();
  const win = {
    setInterval: (fn: () => void) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
    addEventListener: (type: string, fn: () => void) => {
      const set = listeners.get(type) ?? new Set();
      set.add(fn);
      listeners.set(type, set);
    },
    removeEventListener: (type: string, fn: () => void) => listeners.get(type)?.delete(fn),
  } as unknown as Window;
  const target = {
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as Document;
  const original = performance.now;
  performance.now = () => now;
  const monitor = createInterferenceMonitor(target, win);
  return {
    monitor,
    /** Let `ms` of wall clock pass, then fire the watchdog once. */
    advance(ms: number) {
      now += ms;
      tick?.();
    },
    fire(type: string) {
      for (const fn of listeners.get(type) ?? []) fn();
    },
    restore() {
      performance.now = original;
    },
  };
}

describe('the interference monitor', () => {
  it('reports a gap no measured stall explains', () => {
    const r = rig();
    r.monitor.mark();
    r.advance(3000);
    expect(r.monitor.disturbed()).toBe(true);
    expect(r.monitor.reasons()).toContain('throttled');
    r.restore();
  });

  it('stays quiet on the cadence it expects', () => {
    const r = rig();
    r.monitor.mark();
    for (let i = 0; i < 8; i++) r.advance(WATCHDOG_TICK_MS);
    expect(r.monitor.disturbed()).toBe(false);
    r.restore();
  });

  // The regression: a Direct3D 11 cold link holds the thread most of a second
  // and the release around it pushes the window past the watchdog's allowance.
  // The section charges the stall before it yields, so the tick that follows
  // sees a window it can account for.
  it('clears a window the pass measured on purpose', () => {
    const r = rig();
    r.monitor.mark();
    r.monitor.charge(852.4); // the link, charged the moment it lets go
    r.advance(1100); // the tick that follows the stall
    expect(r.monitor.disturbed()).toBe(false);
    expect(r.monitor.reasons()).not.toContain('throttled');
    r.restore();
  });

  it('charges a window once, so a later freeze is not excused by an earlier stall', () => {
    const r = rig();
    r.monitor.mark();
    r.monitor.charge(852.4);
    r.advance(1100); // explained
    r.advance(2200); // nothing measured in this window
    expect(r.monitor.disturbed()).toBe(true);
    expect(r.monitor.reasons()).toContain('throttled');
    r.restore();
  });

  it('adds up several stalls that land in one window', () => {
    const r = rig();
    r.monitor.mark();
    for (const ms of [585, 578, 590]) r.monitor.charge(ms);
    r.advance(1800);
    expect(r.monitor.disturbed()).toBe(false);
    r.restore();
  });

  it('forgets the charge and the gap at the next mark', () => {
    const r = rig();
    r.monitor.mark();
    r.monitor.charge(900);
    r.advance(852);
    expect(r.monitor.disturbed()).toBe(false);
    r.monitor.mark();
    r.advance(3000);
    expect(r.monitor.disturbed()).toBe(true);
    r.restore();
  });

  it('never lets a charge excuse an input or a window-state disturbance', () => {
    const r = rig();
    r.monitor.mark();
    r.monitor.charge(5000);
    r.advance(100);
    r.fire('blur');
    expect(r.monitor.disturbed()).toBe(true);
    expect(r.monitor.reasons()).toContain('blur');
    r.monitor.note('minimized');
    expect(r.monitor.reasons()).toContain('minimized');
    r.restore();
  });
});
