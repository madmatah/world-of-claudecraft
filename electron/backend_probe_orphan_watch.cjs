// The probe child's orphan watch: how a child notices its parent died and
// stops measuring nobody's machine.
//
// The design's channel is the stdin pipe the parent holds and never writes to
// (its close is the parent's death, immune to pid reuse). That channel does not
// always exist: on Windows the child's fd 0 is not always the pipe the parent
// created, and when Node cannot recognise the handle it hands the process an
// ALREADY ENDED stream ("Provide a dummy contentless input for e.g. non-console
// Windows applications", node's stdin bootstrap: `new Readable(); push(null)`).
// Resuming that stream emits 'end' at once, which a watch that trusts stdin
// reads as the parent's death: every arm died 25 ms in, exit orphaned.
//
// So the watch first ASKS whether fd 0 is a real pipe, and only then trusts it.
// fstat is the same question node's own bootstrap asks: a pipe stats as a FIFO
// (a socketpair, which is what a "pipe" stdio slot is on some platforms, stats
// as a socket), and an unusable handle throws. Anything else falls back to
// polling the parent's pid, which is not immune to pid reuse but does bound the
// worst case: a child that outlives its parent is a stranded GUI process on a
// player's machine, which is worse than a run that reports one arm inconclusive.
//
// The mechanism that armed is returned AND logged, so a support log says which
// of the two was in force.

/** How often the pid fallback asks whether the parent is still there. */
const PARENT_POLL_MS = 2000;

/**
 * Whether fd 0 is a channel whose close means something. A pipe stats as a
 * FIFO, a socketpair as a socket; an unusable handle throws, which is exactly
 * the case node answers with the pre-ended dummy stream.
 */
function stdinIsRealPipe(fstat) {
  try {
    const stats = fstat(0);
    return stats.isFIFO() || stats.isSocket();
  } catch {
    return false;
  }
}

/**
 * Arm the orphan watch and return which mechanism took: `stdin` when the pipe
 * is real, `parent-pid` when it is not and a parent pid is available, `none`
 * when neither is (nothing to watch, and the parent's hang guard remains).
 * `onOrphan` fires at most once.
 */
function armOrphanWatch({ stdin, fstat, parentPid, kill, setInterval: schedule, log, onOrphan }) {
  let fired = false;
  const fire = () => {
    if (fired) return;
    fired = true;
    onOrphan();
  };

  if (stdin && typeof stdin.resume === 'function' && stdinIsRealPipe(fstat)) {
    stdin.resume();
    stdin.on('end', fire);
    stdin.on('close', fire);
    log?.info?.('[probe-child] orphan watch on the parent pipe');
    return 'stdin';
  }

  if (Number.isInteger(parentPid) && parentPid > 0) {
    const timer = schedule(() => {
      try {
        // Signal 0 asks whether the process exists without touching it.
        kill(parentPid, 0);
      } catch {
        fire();
      }
    }, PARENT_POLL_MS);
    timer?.unref?.();
    log?.info?.(
      `[probe-child] stdin is not a pipe here; orphan watch polls the parent pid ${parentPid}`,
    );
    return 'parent-pid';
  }

  log?.warn?.('[probe-child] no orphan watch: stdin is not a pipe and no parent pid was given');
  return 'none';
}

module.exports = { armOrphanWatch, PARENT_POLL_MS, stdinIsRealPipe };
