import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  GPU_BACKEND_CLASSES,
  readBackendProbeVerdict,
  SHADER_WORKER_VERDICT_ARG,
  shaderWorkerVerdictArguments,
  VERDICT_FIELD_MAX,
  verdictAfterHealthySession,
  verdictAfterLaunchDeath,
  verdictAfterWorkerSession,
  verdictFromDecision,
  verdictMarkedStale,
  verdictMatchesMachine,
  verdictValidAtLaunch,
  WORKER_RETIRE_STREAK_MAX,
} from '../electron/backend_probe_verdict.cjs';
import { MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES } from '../electron/gpu_backend.cjs';

const stored = (over: Record<string, unknown> = {}) => ({
  rung: 'vulkan-parallel-compile',
  backend: 'vulkan',
  worker: true,
  adapter: '0x10de:0x2504',
  driverVersion: '560.94',
  chromeVersion: '151.0.7443.0',
  probeVersion: 1,
  corpusHash: 'abc123',
  appVersion: '0.42.0',
  recordedAt: '2026-09-05T10:00:00.000Z',
  distribution: 'steam',
  stale: false,
  deathStreak: 0,
  workerRetireStreak: 0,
  ...over,
});

describe('readBackendProbeVerdict', () => {
  it('rebuilds a complete verdict and keeps only what it knows', () => {
    const verdict = readBackendProbeVerdict({
      ...stored(),
      figures: { coldLinkMs: 12 },
      extra: 'nope',
    });
    expect(verdict).toEqual({ ...stored(), figures: { coldLinkMs: 12 } });
    expect(verdict).not.toHaveProperty('extra');
  });

  it('refuses a verdict without a known rung, class, Chromium version, probe version or hash', () => {
    expect(readBackendProbeVerdict(stored({ rung: 'metal' }))).toBeNull();
    expect(readBackendProbeVerdict(stored({ backend: 'directx' }))).toBeNull();
    expect(readBackendProbeVerdict(stored({ chromeVersion: '' }))).toBeNull();
    expect(readBackendProbeVerdict(stored({ probeVersion: 0 }))).toBeNull();
    expect(readBackendProbeVerdict(stored({ probeVersion: '1' }))).toBeNull();
    expect(readBackendProbeVerdict(stored({ corpusHash: 7 }))).toBeNull();
    expect(readBackendProbeVerdict(null)).toBeNull();
    expect(readBackendProbeVerdict([])).toBeNull();
  });

  it('takes the flags strictly, the counts as non-negative integers, and caps every string', () => {
    const verdict = readBackendProbeVerdict(
      stored({
        worker: 'yes',
        stale: 1,
        deathStreak: -1,
        workerRetireStreak: 2.5,
        adapter: 'x'.repeat(VERDICT_FIELD_MAX + 10),
      }),
    );
    expect(verdict?.worker).toBe(false);
    expect(verdict?.stale).toBe(false);
    expect(verdict?.deathStreak).toBe(0);
    expect(verdict?.workerRetireStreak).toBe(0);
    expect(verdict?.adapter).toHaveLength(VERDICT_FIELD_MAX);
  });

  it('drops oversized or non-object figures rather than the verdict', () => {
    const big = readBackendProbeVerdict(stored({ figures: { pad: 'x'.repeat(9000) } }));
    expect(big).not.toBeNull();
    expect(big).not.toHaveProperty('figures');
    expect(readBackendProbeVerdict(stored({ figures: [1] }))).not.toHaveProperty('figures');
  });

  it('pins the backend classes to the page classifier union', () => {
    const source = readFileSync(
      join(__dirname, '..', 'src', 'render', 'gpu_backend_class_core.ts'),
      'utf8',
    );
    const union = source.match(/export type GpuBackendClass = ([^;]+);/)?.[1] ?? '';
    const classes = [...union.matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]);
    expect([...GPU_BACKEND_CLASSES].sort()).toEqual([...classes].sort());
  });
});

describe('validity and machine match', () => {
  const facts = { chromeVersion: '151.0.7443.0', probeVersion: 1, corpusHash: 'abc123' };
  it('is valid only under the same Chromium, probe and corpus, and never when stale', () => {
    const verdict = readBackendProbeVerdict(stored());
    expect(verdictValidAtLaunch(verdict, facts)).toBe(true);
    expect(verdictValidAtLaunch(verdict, { ...facts, chromeVersion: '152.0.0.0' })).toBe(false);
    expect(verdictValidAtLaunch(verdict, { ...facts, probeVersion: 2 })).toBe(false);
    expect(verdictValidAtLaunch(verdict, { ...facts, corpusHash: 'other' })).toBe(false);
    // An unstamped build knows no corpus hash: the other two arms decide.
    expect(verdictValidAtLaunch(verdict, { ...facts, corpusHash: '' })).toBe(true);
    expect(verdictValidAtLaunch(readBackendProbeVerdict(stored({ stale: true })), facts)).toBe(
      false,
    );
    // The app version is informational: a release does not kill the verdict.
    expect(
      verdictValidAtLaunch(readBackendProbeVerdict(stored({ appVersion: '0.43.0' })), facts),
    ).toBe(true);
    expect(verdictValidAtLaunch(null, facts)).toBe(false);
  });

  it('matches the machine on adapter and driver when both sides know them', () => {
    const verdict = readBackendProbeVerdict(stored());
    expect(
      verdictMatchesMachine(verdict, { adapter: '0x10de:0x2504', driverVersion: '560.94' }),
    ).toBe(true);
    expect(
      verdictMatchesMachine(verdict, { adapter: '0x8086:0x7d55', driverVersion: '560.94' }),
    ).toBe(false);
    expect(
      verdictMatchesMachine(verdict, { adapter: '0x10de:0x2504', driverVersion: '561.0' }),
    ).toBe(false);
    expect(verdictMatchesMachine(verdict, { adapter: '', driverVersion: '' })).toBe(true);
    expect(
      verdictMatchesMachine(readBackendProbeVerdict(stored({ adapter: '' })), {
        adapter: '0x8086:0x7d55',
        driverVersion: '',
      }),
    ).toBe(true);
    expect(verdictMatchesMachine(null, { adapter: '', driverVersion: '' })).toBe(false);
  });
});

describe('the streaks', () => {
  it('goes stale on the launch-death streak, never on one death, only on its own rung', () => {
    let verdict = readBackendProbeVerdict(stored());
    for (let i = 1; i < MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES; i += 1) {
      verdict = verdictAfterLaunchDeath(verdict, 'vulkan-parallel-compile');
      expect(verdict?.deathStreak).toBe(i);
      expect(verdict?.stale).toBe(false);
    }
    verdict = verdictAfterLaunchDeath(verdict, 'vulkan-parallel-compile');
    expect(verdict?.stale).toBe(true);
    expect(verdictAfterLaunchDeath(verdict, 'vulkan-parallel-compile')).toBeNull();
    expect(verdictAfterLaunchDeath(readBackendProbeVerdict(stored()), 'd3d11')).toBeNull();
  });

  it('clears the death streak after a healthy session on its rung', () => {
    const verdict = readBackendProbeVerdict(stored({ deathStreak: 2 }));
    expect(verdictAfterHealthySession(verdict, 'vulkan-parallel-compile')?.deathStreak).toBe(0);
    expect(verdictAfterHealthySession(verdict, 'd3d11')).toBeNull();
    expect(
      verdictAfterHealthySession(readBackendProbeVerdict(stored()), 'vulkan-parallel-compile'),
    ).toBeNull();
  });

  it('retires the worker after the counted-session streak and resets on a settled one', () => {
    let verdict = readBackendProbeVerdict(stored());
    for (let i = 1; i < WORKER_RETIRE_STREAK_MAX; i += 1) {
      verdict = verdictAfterWorkerSession(verdict, true);
      expect(verdict?.workerRetireStreak).toBe(i);
      expect(verdict?.worker).toBe(true);
    }
    const reset = verdictAfterWorkerSession(verdict, false);
    expect(reset?.workerRetireStreak).toBe(0);
    verdict = verdictAfterWorkerSession(verdict, true);
    expect(verdict?.worker).toBe(false);
    expect(verdict?.stale).toBe(true);
    // A settled session with nothing to reset, and a worker-off verdict: nothing.
    expect(verdictAfterWorkerSession(readBackendProbeVerdict(stored()), false)).toBeNull();
    expect(
      verdictAfterWorkerSession(readBackendProbeVerdict(stored({ worker: false })), true),
    ).toBeNull();
  });

  it('marks stale once', () => {
    const verdict = readBackendProbeVerdict(stored());
    const stale = verdictMarkedStale(verdict);
    expect(stale?.stale).toBe(true);
    expect(verdictMarkedStale(stale)).toBeNull();
  });
});

describe('verdictFromDecision', () => {
  const facts = {
    adapter: '0x10de:0x2504',
    driverVersion: '560.94',
    chromeVersion: '151.0.7443.0',
    probeVersion: 1,
    corpusHash: 'abc123',
    appVersion: '0.42.0',
    recordedAt: '2026-09-05T10:00:00.000Z',
    distribution: 'website',
  };
  it('builds a fresh verdict from a decision with a backend, none without', () => {
    const verdict = verdictFromDecision(
      { backend: 'd3d11', backendClass: 'd3d11', worker: true, figures: { hit: 1 } },
      facts,
    );
    expect(verdict).toEqual({
      ...stored({ rung: 'd3d11', backend: 'd3d11', distribution: 'website' }),
      figures: { hit: 1 },
    });
    expect(verdictFromDecision({ backend: null }, facts)).toBeNull();
    expect(verdictFromDecision({ backend: 'd3d11', backendClass: 'nope' }, facts)).toBeNull();
    expect(verdictFromDecision(null, facts)).toBeNull();
  });
});

describe('shaderWorkerVerdictArguments', () => {
  it('hands the worker decision to the window only when the launch runs the verdict backend', () => {
    const verdict = readBackendProbeVerdict(stored());
    expect(
      shaderWorkerVerdictArguments(verdict, { fromVerdict: true, rung: 'vulkan-parallel-compile' }),
    ).toEqual([`${SHADER_WORKER_VERDICT_ARG}vulkan:on`]);
    expect(
      shaderWorkerVerdictArguments(readBackendProbeVerdict(stored({ worker: false })), {
        fromVerdict: true,
        rung: 'vulkan-parallel-compile',
      }),
    ).toEqual([`${SHADER_WORKER_VERDICT_ARG}vulkan:off`]);
    // An explicit or rescued launch, another rung, a stale verdict, or none: nothing.
    expect(
      shaderWorkerVerdictArguments(verdict, {
        fromVerdict: false,
        rung: 'vulkan-parallel-compile',
      }),
    ).toEqual([]);
    expect(shaderWorkerVerdictArguments(verdict, { fromVerdict: true, rung: 'd3d11' })).toEqual([]);
    expect(
      shaderWorkerVerdictArguments(readBackendProbeVerdict(stored({ stale: true })), {
        fromVerdict: true,
        rung: 'vulkan-parallel-compile',
      }),
    ).toEqual([]);
    expect(shaderWorkerVerdictArguments(null, { fromVerdict: true, rung: 'd3d11' })).toEqual([]);
  });
});
