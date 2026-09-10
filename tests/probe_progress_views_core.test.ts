// The two lines a player leans on during a run. The report behind them: a
// beginner watching the probe had no global bearing (only a step count inside
// the current test) and saw a blank screen between two arms, with no way to
// tell a working run from a crashed one.
import { describe, expect, it } from 'vitest';
import { betweenLine, overallLine } from '../src/probe/probe_views_core';

const t = ((key: string, values?: Record<string, string>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as Parameters<
  typeof overallLine
>[0];

describe('overallLine', () => {
  it('names the test in flight and how many there are', () => {
    expect(overallLine(t, { index: 2, total: 3 })).toBe(
      'probe.progress.overall {"index":"2","total":"3"}',
    );
  });

  it('formats both numbers through the caller formatter', () => {
    expect(overallLine(t, { index: 2, total: 3 }, (n) => `<${n}>`)).toBe(
      'probe.progress.overall {"index":"<2>","total":"<3>"}',
    );
  });

  it('says nothing outside a probe child, where the shell names no position', () => {
    expect(overallLine(t, { index: null, total: null })).toBe(null);
    expect(overallLine(t, { index: 1, total: null })).toBe(null);
  });

  it('says nothing rather than a nonsense position', () => {
    expect(overallLine(t, { index: 0, total: 3 })).toBe(null);
    expect(overallLine(t, { index: 4, total: 3 })).toBe(null);
    expect(overallLine(t, { index: 1.5, total: 3 })).toBe(null);
    expect(overallLine(t, { index: 1, total: 0 })).toBe(null);
  });
});

describe('betweenLine', () => {
  it('counts the test that just finished, not the one to come', () => {
    expect(betweenLine(t, { done: 1, total: 3 })).toBe(
      'probe.progress.between {"done":"1","total":"3"}',
    );
  });

  it('never counts past the total or below zero', () => {
    expect(betweenLine(t, { done: 9, total: 3 })).toBe(
      'probe.progress.between {"done":"3","total":"3"}',
    );
    expect(betweenLine(t, { done: -2, total: 3 })).toBe(
      'probe.progress.between {"done":"0","total":"3"}',
    );
  });
});
