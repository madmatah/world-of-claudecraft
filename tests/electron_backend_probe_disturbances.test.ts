// What a child says about the passes it threw away. The run behind this: the
// first Windows probe run ended inconclusive because the reference arm lost
// both passes of its link section, and the reasons were only in a result file
// that the next run deletes. The child now names them in its own log.
import { describe, expect, it } from 'vitest';
import { disturbanceLines, sectionLine } from '../electron/backend_probe_disturbances.cjs';

describe('sectionLine', () => {
  it('says nothing about a section whose every pass counted', () => {
    expect(sectionLine('frame', { validity: [true, true], replays: 0, disturbances: [] })).toBe(
      null,
    );
  });

  it('names the reasons of a section that lost every pass', () => {
    // The measured arm, verbatim.
    expect(
      sectionLine('links', {
        validity: [false, false],
        replays: 2,
        disturbances: ['throttled', 'throttled', 'input', 'throttled', 'throttled'],
      }),
    ).toBe('links: 0/2 passes kept, 2 replayed, disturbed by throttled, input');
  });

  it('reports a section that kept one pass, which is what forces a second round', () => {
    expect(
      sectionLine('uploads', { validity: [true, false], replays: 1, disturbances: ['blur'] }),
    ).toBe('uploads: 1/2 passes kept, 1 replayed, disturbed by blur');
  });

  it('still reports a lost pass that carries no reason', () => {
    expect(sectionLine('pacing', { validity: [false, true] })).toBe(
      'pacing: 1/2 passes kept, 0 replayed',
    );
  });

  it('reads a missing or malformed record as nothing to say', () => {
    expect(sectionLine('links', null)).toBe(null);
    expect(sectionLine('links', 'nope')).toBe(null);
    expect(sectionLine('links', { validity: [] })).toBe(null);
  });
});

describe('disturbanceLines', () => {
  it('names only the sections that lost a pass, and stays empty on a clean run', () => {
    const clean = { validity: [true, true], replays: 0, disturbances: [] };
    expect(
      disturbanceLines({
        sections: { links: clean, parallel: clean, frame: clean },
      }),
    ).toEqual([]);
  });

  it('reports each losing section in order', () => {
    const clean = { validity: [true, true], replays: 0, disturbances: [] };
    expect(
      disturbanceLines({
        sections: {
          links: { validity: [false, false], replays: 2, disturbances: ['throttled'] },
          parallel: clean,
          uploads: { validity: [true, false], replays: 1, disturbances: ['hidden'] },
        },
      }),
    ).toEqual([
      'links: 0/2 passes kept, 2 replayed, disturbed by throttled',
      'uploads: 1/2 passes kept, 1 replayed, disturbed by hidden',
    ]);
  });

  it('says nothing when the child never got a result to report', () => {
    expect(disturbanceLines(null)).toEqual([]);
    expect(disturbanceLines({})).toEqual([]);
    expect(disturbanceLines({ sections: 'nope' })).toEqual([]);
  });
});
