// The probe child's orphan watch. The bug this pins: on Windows the child's
// fd 0 is not always the pipe the parent created, and node then hands the
// process an ALREADY ENDED stream (its stdin bootstrap: "Provide a dummy
// contentless input for e.g. non-console Windows applications", `new
// Readable(); push(null)`). A watch that resumes stdin and trusts its 'end'
// therefore fires immediately: every arm of the first real Windows run died
// 25 ms in with exit orphaned, on a parent that was alive.
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { armOrphanWatch, PARENT_POLL_MS } from '../electron/backend_probe_orphan_watch.cjs';

type Handler = () => void;

/** A stdin stand-in that records what the watch did to it. */
function fakeStdin() {
  const emitter = new EventEmitter();
  const resume = vi.fn();
  return {
    stream: Object.assign(emitter, { resume }),
    resume,
    emit: (event: string) => emitter.emit(event),
    listeners: (event: string) => emitter.listenerCount(event),
  };
}

const fifo = () => ({ isFIFO: () => true, isSocket: () => false });
const socket = () => ({ isFIFO: () => false, isSocket: () => true });
const chardev = () => ({ isFIFO: () => false, isSocket: () => false });
const unusable = () => {
  throw Object.assign(new Error('EBADF'), { code: 'EBADF' });
};

function arm(over: Record<string, unknown> = {}) {
  const onOrphan = vi.fn();
  const kill = vi.fn();
  const timers: { fn: Handler; ms: number }[] = [];
  const stdin = fakeStdin();
  const mechanism = armOrphanWatch({
    stdin: stdin.stream,
    fstat: fifo,
    parentPid: 4242,
    kill,
    setInterval: (fn: Handler, ms: number) => {
      timers.push({ fn, ms });
      return { unref: () => {} };
    },
    log: { info: vi.fn(), warn: vi.fn() },
    onOrphan,
    ...over,
  });
  return { mechanism, onOrphan, kill, timers, stdin };
}

describe('the probe child orphan watch', () => {
  it('trusts stdin when fd 0 is a real pipe, and reports the parent going away', () => {
    const w = arm({ fstat: fifo });
    expect(w.mechanism).toBe('stdin');
    expect(w.stdin.resume).toHaveBeenCalled();
    expect(w.onOrphan).not.toHaveBeenCalled();
    w.stdin.emit('end');
    expect(w.onOrphan).toHaveBeenCalledTimes(1);
  });

  it('trusts a socketpair too, which is what a pipe slot is on some platforms', () => {
    expect(arm({ fstat: socket }).mechanism).toBe('stdin');
  });

  // The regression itself: an unusable fd 0 must NOT be read as the parent's death.
  it('never touches stdin when fd 0 is unusable, and polls the parent instead', () => {
    const w = arm({ fstat: unusable });
    expect(w.mechanism).toBe('parent-pid');
    expect(w.stdin.resume).not.toHaveBeenCalled();
    expect(w.stdin.listeners('end')).toBe(0);
    expect(w.stdin.listeners('close')).toBe(0);
    expect(w.onOrphan).not.toHaveBeenCalled();
  });

  it('does not read a console handle as a pipe either', () => {
    expect(arm({ fstat: chardev }).mechanism).toBe('parent-pid');
  });

  it('reports the parent gone when the pid poll can no longer signal it', () => {
    const w = arm({
      fstat: unusable,
      kill: vi.fn(() => {
        throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }),
    });
    expect(w.timers[0]?.ms).toBe(PARENT_POLL_MS);
    w.timers[0]?.fn();
    expect(w.onOrphan).toHaveBeenCalledTimes(1);
  });

  it('stays quiet while the pid poll still finds the parent', () => {
    const w = arm({ fstat: unusable });
    w.timers[0]?.fn();
    w.timers[0]?.fn();
    expect(w.kill).toHaveBeenCalledWith(4242, 0);
    expect(w.onOrphan).not.toHaveBeenCalled();
  });

  it('reports the parent once, however many times the channel says so', () => {
    const w = arm({ fstat: fifo });
    w.stdin.emit('end');
    w.stdin.emit('close');
    expect(w.onOrphan).toHaveBeenCalledTimes(1);
  });

  it('arms nothing rather than guessing when there is no pipe and no parent pid', () => {
    const w = arm({ fstat: unusable, parentPid: null });
    expect(w.mechanism).toBe('none');
    expect(w.timers).toHaveLength(0);
    expect(w.onOrphan).not.toHaveBeenCalled();
  });
});
