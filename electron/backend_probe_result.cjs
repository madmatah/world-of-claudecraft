'use strict';

// What a probe child accepts from its page, and what the parent accepts from
// a child's result file: both sit on a boundary (a sandboxed renderer's IPC,
// a user-writable directory), so the shape is checked field by field and
// bounded before anything is written or ranked. The measured figures inside
// the sections are the page's own (the decision core validates what it
// reads); this guard pins the envelope: version, run, round, arm, the ended
// state, and the size. Pure; tests/electron_backend_probe_result.test.ts.

// 2: the decision compares the upload section's COLD pass rather than the mean
// of a cold and a warm one, and the margin sets aside a spread too large to be
// two readings of one quantity. A verdict recorded under 1 measured a different
// thing, so it is re-probed rather than trusted.
const PROBE_VERSION = 2;
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const ENDED = ['completed', 'no-webgl2', 'software', 'no-corpus', 'aborted', 'busy', 'capped'];

/**
 * The page's result, accepted when it is an object of the probe's version
 * for this run and round, with a known ended state, under the byte cap;
 * null otherwise. The returned value is the SAME object (the page's own),
 * never a copy that could drop a field the decision reads.
 */
function acceptProbeResult(value, { run, round, maxBytes = MAX_RESULT_BYTES } = {}) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const result = value;
  if (result.probeVersion !== PROBE_VERSION) return null;
  if (typeof run === 'string' && result.run !== run) return null;
  if (Number.isInteger(round) && result.round !== round) return null;
  if (!ENDED.includes(result.ended)) return null;
  if (typeof result.sections !== 'object' || result.sections === null) return null;
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');
  } catch {
    return null;
  }
  if (bytes > maxBytes) return null;
  return result;
}

/** The exit a child owes for a result's ended state: only a completed run
 *  exits 0; a backend that never came up or only in software is "did not
 *  bind"; a busy machine is "busy"; the rest is the probe's own failure. */
function exitCodeForEnded(ended, codes) {
  switch (ended) {
    case 'completed':
      return codes.completed;
    case 'no-webgl2':
    case 'software':
      return codes.didNotBind;
    case 'busy':
      return codes.busy;
    case 'capped':
      // The link section's no-progress cap ended the arm: a bound, not an error.
      return codes.capped;
    default:
      return codes.probeError;
  }
}

/** Whether a result's ended state is terminal for the child (the page has
 *  nothing more to post). */
function isTerminalEnded(ended) {
  return ENDED.includes(ended);
}

module.exports = {
  ENDED,
  MAX_RESULT_BYTES,
  PROBE_VERSION,
  acceptProbeResult,
  exitCodeForEnded,
  isTerminalEnded,
};
