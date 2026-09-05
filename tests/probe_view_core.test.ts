import { describe, expect, it } from 'vitest';
import { PROBE_VIEWS, probeViewFromSearch } from '../src/probe/probe_view_core';

describe('probeViewFromSearch', () => {
  it('reads each view by its exact literal', () => {
    for (const view of PROBE_VIEWS) {
      expect(probeViewFromSearch(`?view=${view}`)).toBe(view);
      expect(probeViewFromSearch(`?lang=fr_FR&view=${view}&tier=low`)).toBe(view);
    }
  });

  it('lands a bare open and every near miss on the consent screen', () => {
    // The measuring view is the shell's alone: a case fold, a prefix or an
    // unknown value must never reach it.
    expect(probeViewFromSearch('')).toBe('consent');
    expect(probeViewFromSearch('?view=')).toBe('consent');
    expect(probeViewFromSearch('?view=Probe')).toBe('consent');
    expect(probeViewFromSearch('?view=probe2')).toBe('consent');
    expect(probeViewFromSearch('?view=verdicts')).toBe('consent');
    expect(probeViewFromSearch('?views=probe')).toBe('consent');
  });
});
