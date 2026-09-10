import { describe, expect, it } from 'vitest';
import {
  acceptProbeResult,
  exitCodeForEnded,
  isTerminalEnded,
  PROBE_VERSION,
} from '../electron/backend_probe_result.cjs';

const codes = { completed: 0, didNotBind: 11, busy: 16, capped: 12, probeError: 15 };

const result = (over: Record<string, unknown> = {}) => ({
  probeVersion: PROBE_VERSION,
  run: 'r1',
  round: 1,
  ended: 'completed',
  sections: {},
  ...over,
});

describe('acceptProbeResult', () => {
  it('accepts the page result for its run and round, as the same object', () => {
    const value = result();
    expect(acceptProbeResult(value, { run: 'r1', round: 1 })).toBe(value);
  });

  it('refuses another version, run, round, an unknown ended state, or an oversized result', () => {
    // Any version but this build's, whichever number that is.
    expect(
      acceptProbeResult(result({ probeVersion: PROBE_VERSION + 1 }), { run: 'r1', round: 1 }),
    ).toBeNull();
    expect(
      acceptProbeResult(result({ probeVersion: PROBE_VERSION - 1 }), { run: 'r1', round: 1 }),
    ).toBeNull();
    expect(acceptProbeResult(result({ run: 'r2' }), { run: 'r1', round: 1 })).toBeNull();
    expect(acceptProbeResult(result({ round: 2 }), { run: 'r1', round: 1 })).toBeNull();
    expect(acceptProbeResult(result({ ended: 'weird' }), { run: 'r1', round: 1 })).toBeNull();
    expect(acceptProbeResult(result({ sections: null }), { run: 'r1', round: 1 })).toBeNull();
    expect(acceptProbeResult(null, {})).toBeNull();
    expect(acceptProbeResult([], {})).toBeNull();
    expect(
      acceptProbeResult(result({ sections: { pad: 'x'.repeat(100) } }), { maxBytes: 50 }),
    ).toBeNull();
  });
});

describe('exitCodeForEnded', () => {
  it('maps each ended state to the child exit it owes', () => {
    expect(exitCodeForEnded('completed', codes)).toBe(0);
    expect(exitCodeForEnded('no-webgl2', codes)).toBe(11);
    expect(exitCodeForEnded('software', codes)).toBe(11);
    expect(exitCodeForEnded('busy', codes)).toBe(16);
    expect(exitCodeForEnded('capped', codes)).toBe(12);
    expect(isTerminalEnded('capped')).toBe(true);
    expect(exitCodeForEnded('no-corpus', codes)).toBe(15);
    expect(exitCodeForEnded('aborted', codes)).toBe(15);
    expect(isTerminalEnded('completed')).toBe(true);
    expect(isTerminalEnded('running')).toBe(false);
  });
});
