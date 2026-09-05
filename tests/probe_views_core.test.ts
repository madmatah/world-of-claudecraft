import { describe, expect, it } from 'vitest';
import {
  backendLabel,
  consentModel,
  estimateMinutes,
  progressLine,
  verdictModel,
} from '../src/probe/probe_views_core';

/** A `t` that echoes the key and its params, so the model's wiring is what is pinned. */
const t = (key: string, params?: Record<string, string | number>): string =>
  params ? `${key}${JSON.stringify(params)}` : key;

describe('the probe views core', () => {
  it('estimates the minutes from the arm count, rounded up, never under one', () => {
    expect(estimateMinutes(3)).toBe(2);
    expect(estimateMinutes(6)).toBe(3);
    expect(estimateMinutes(1, 10, 5)).toBe(1);
  });

  it('names each backend, Vulkan by its compile mode', () => {
    expect(backendLabel(t, 'd3d11', false)).toBe('probe.backend.d3d11');
    expect(backendLabel(t, 'vulkan', true)).toBe('probe.backend.vulkanParallel');
    expect(backendLabel(t, 'vulkan', false)).toBe('probe.backend.vulkanPlain');
    expect(backendLabel(t, 'opengl', false)).toBe('probe.backend.opengl');
    expect(backendLabel(t, 'software', false)).toBe('probe.backend.software');
    expect(backendLabel(t, 'unknown', false)).toBe('probe.backend.unknown');
  });

  it('builds the consent screen with the minutes', () => {
    expect(consentModel(t, 2)).toEqual({
      heading: 'probe.consent.heading',
      body: 'probe.consent.body{"minutes":2}',
      start: 'probe.consent.start',
      cancel: 'probe.consent.cancel',
    });
  });

  it('the progress line: waiting, then the arm and step, busy overrides', () => {
    const base = { backend: null, parallelCompile: false, done: 0, total: 6, busy: false };
    expect(progressLine(t, base)).toBe('probe.progress.waiting');
    expect(progressLine(t, { ...base, backend: 'opengl', done: 2 })).toBe(
      'probe.progress.arm{"backend":"probe.backend.opengl","step":3,"total":6}',
    );
    expect(progressLine(t, { ...base, backend: 'opengl', done: 6 })).toContain('"step":6');
    expect(progressLine(t, { ...base, backend: 'opengl', busy: true })).toBe('probe.progress.busy');
  });

  it('the verdict: decided with the worker line, inconclusive, and the explicit-setting note', () => {
    const decided = verdictModel(t, {
      backend: 'vulkan',
      parallelCompile: true,
      worker: true,
      inconclusive: false,
      explicitSetting: false,
    });
    expect(decided.heading).toBe('probe.verdict.heading{"backend":"probe.backend.vulkanParallel"}');
    expect(decided.worker).toBe('probe.verdict.workerOn');
    expect(decided.note).toBeNull();
    expect(decided.switchToAuto).toBeNull();
    const explicit = verdictModel(t, {
      backend: 'd3d11',
      parallelCompile: false,
      worker: false,
      inconclusive: false,
      explicitSetting: true,
    });
    expect(explicit.worker).toBe('probe.verdict.workerOff');
    expect(explicit.note).toBe('probe.verdict.explicitSetting');
    expect(explicit.switchToAuto).toBe('probe.verdict.switchToAuto');
    const none = verdictModel(t, {
      backend: null,
      parallelCompile: false,
      worker: false,
      inconclusive: true,
      explicitSetting: false,
    });
    expect(none.heading).toBe('probe.verdict.inconclusive');
    expect(none.worker).toBe('');
  });
});
