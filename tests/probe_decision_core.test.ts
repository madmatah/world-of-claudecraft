// The decision rule over hand-built arm results: the reference, the margin,
// the hitch composite, the frame and pacing tolerances, every
// disqualification, the second-round triggers, the worker verdict.
import { describe, expect, it } from 'vitest';
import {
  type ArmInput,
  type ArmRung,
  armFigures,
  decide,
  PROVISIONAL_FLOORS,
  RELATIVE_MINIMUM,
  WORKER_SECTION_PROGRAMS,
} from '../src/probe/decision_core';
import type { ProbeResult } from '../src/probe/probe_run';

interface Figures {
  worst?: number;
  lost?: number;
  cold?: number;
  hit?: number;
  upload?: number;
  frameP95?: number;
  onCadence?: number;
  workerHit?: number;
  workerLost?: number;
  checksumOk?: boolean;
  software?: boolean;
  critical?: string[];
  ended?: ProbeResult['ended'];
  validity?: Partial<Record<string, boolean[]>>;
}

const frames = (maxMs: number, lostMs: number) => ({
  frames: 60,
  refreshMs: 16.7,
  medianMs: 16.7,
  p95Ms: maxMs,
  p99Ms: maxMs,
  maxMs,
  longFrames: lostMs > 0 ? 1 : 0,
  lostMs,
  onCadence: 0.95,
});

/** A result whose two passes carry the same figures (spread 0) unless a
 *  second figure set is given. */
function result(f: Figures, second: Figures = f): ProbeResult {
  const pass = (g: Figures) => ({
    cold: {
      count: 12,
      medianMs: g.cold ?? 100,
      maxMs: g.cold ?? 100,
      trimmedMeanMs: g.cold ?? 100,
      medianLinkMs: 0,
      medianDrawMs: 0,
      medianDraw2Ms: 0,
      capped: false,
      failed: 0,
      reachedMinimum: true,
    },
    hit: {
      count: 12,
      medianMs: g.hit ?? 10,
      maxMs: g.hit ?? 10,
      trimmedMeanMs: g.hit ?? 10,
      medianLinkMs: 0,
      medianDrawMs: 0,
      medianDraw2Ms: 0,
      capped: false,
      failed: 0,
      reachedMinimum: true,
    },
    coldSamples: [],
    hitSamples: [],
  });
  const parallel = (g: Figures) => ({
    summary: {
      count: 6,
      failed: 0,
      asyncFraction: 1,
      medianFramesPending: 2,
      medianMs: 50,
      frames: frames(g.worst ?? 100, g.lost ?? 200),
      blocking: false,
      reachedMinimum: true,
    },
    samples: [],
    frameIntervalsMs: [],
    capped: false,
  });
  const worker = (g: Figures) => {
    const hit = g.workerHit ?? 10;
    const cold = g.cold ?? 100;
    return {
      summary: {
        readyMs: 30,
        refusal: null,
        warmed: 6,
        failed: 0,
        medianWorkerLinkMs: 200,
        framesDuringWarm: frames(50, g.workerLost ?? 60),
        medianHitMs: hit,
        maxHitMs: hit,
        coldMedianMs: cold,
        hitOverCold: hit / cold,
        capped: false,
      },
      warm: [],
      hits: [],
      frameIntervalsMs: [],
    };
  };
  const uploads = (g: Figures) => ({
    summary: {
      paths: [
        {
          path: 'canvas' as const,
          count: 6,
          medianCallMs: 5,
          maxCallMs: 8,
          medianFrameMs: 17,
          maxFrameMs: g.upload ?? 20,
          bytesPerUpload: 1,
          skipped: false,
        },
      ],
      frames: frames(20, 0),
    },
    samples: [],
  });
  const frame = (g: Figures) => ({
    summary: {
      frames: frames(g.frameP95 ?? 20, 0),
      medianSubmitMs: 5,
      p95SubmitMs: 6,
      submitShare: 0.3,
      drawsPerFrame: 1104,
      shape: { shadowDraws: 1, colourDraws: 1, skeletons: 1, drawsPerSkeleton: 1, postPasses: 1 },
      checksum: { ok: g.checksumOk ?? true, worstDelta: 0, samples: 16 },
      textureChecksum: { ok: true, worstDelta: 0, samples: 16 },
    },
    intervalsMs: [],
    submitMs: [],
  });
  const pacing = (g: Figures) => ({
    windowed: { ...frames(17, 0), onCadence: g.onCadence ?? 0.98 },
    intervalsMs: [],
  });
  const record = <T>(name: string, a: T, b: T) => ({
    passes: [a, b],
    validity: f.validity?.[name] ?? [true, true],
    replays: 0,
    disturbances: [],
    floor: frames(17, 0),
  });
  return {
    probeVersion: 1,
    run: 'r',
    round: 1,
    tier: 'ultra',
    corpusTier: 'ultra',
    corpusHash: 'h',
    startedAt: 0,
    identity: {
      renderer: 'x',
      backend: 'd3d11',
      software: f.software ?? false,
      parallelCompile: true,
      extensions: [],
      powerPreference: 'high-performance',
      hardwareConcurrency: 8,
      userAgent: 'ua',
      canvasWidth: 1,
      canvasHeight: 1,
    },
    capability: {
      missingExtensions: [],
      compressed: { bptc: true, s3tc: true, etc: false, astc: false },
      halfFloatTargets: true,
      floatTargets: true,
      limits: {
        maxTextureSize: 16384,
        maxCubeMapSize: 16384,
        max3dTextureSize: 2048,
        maxArrayTextureLayers: 2048,
        maxCombinedTextureUnits: 32,
        maxVertexAttribs: 16,
        maxVaryingVectors: 31,
        maxFragmentUniformVectors: 1024,
        maxSamples: 8,
        maxAnisotropy: 16,
      },
      critical: f.critical ?? [],
      degraded: [],
    },
    bootMs: 500,
    refreshMs: 16.7,
    load: { passes: 4, targetMs: 6.7 },
    sections: {
      links: record('links', pass(f), pass(second)),
      parallel: record('parallel', parallel(f), parallel(second)),
      worker: record('worker', worker(f), worker(second)),
      uploads: record('uploads', uploads(f), uploads(second)),
      frame: record('frame', frame(f), frame(second)),
      pacing: record('pacing', pacing(f), pacing(second)),
    },
    ended: f.ended ?? 'completed',
  };
}

const arm = (rung: ArmRung, f: Figures, over: Partial<ArmInput> = {}): ArmInput => ({
  rung,
  results: [result(f)],
  roundsLaunched: 1,
  roundsDied: 0,
  adapter: 'gpu-1',
  ...over,
});

describe('armFigures', () => {
  it('averages the valid passes and reads the largest spread', () => {
    const figures = armFigures(
      [result({ cold: 100, worst: 100 }, { cold: 120, worst: 100 })],
      PROVISIONAL_FLOORS,
    );
    expect(figures.coldLinkMs).toBe(110);
    expect(figures.spread).toBeCloseTo(20 / 110, 5);
    expect(figures.workerWorthIt).toBe(true);
    expect(figures.linkProfileMs).toBeCloseTo(10 + 60 / 6, 5);
  });

  it('turns the worker off when its frames lost per program pass the floor', () => {
    const figures = armFigures([result({ workerLost: 600 })], PROVISIONAL_FLOORS);
    expect(figures.workerWorthIt).toBe(false);
    expect(figures.linkProfileMs).toBe(100);
  });

  it('names single-pass and neutral sections from the validity', () => {
    const figures = armFigures(
      [result({ validity: { links: [true, false], pacing: [false, false] } })],
      PROVISIONAL_FLOORS,
    );
    expect(figures.singlePassSections).toEqual(['links']);
    expect(figures.neutralSections).toEqual(['pacing']);
  });
});

describe('the floors', () => {
  it('pins the provisional floors and the relative minimum to their literals', () => {
    expect(PROVISIONAL_FLOORS).toEqual({
      hitch: 0.15,
      frame: 0.1,
      pacing: 0.05,
      workerLostPerProgramMs: 40,
    });
    expect(RELATIVE_MINIMUM).toBe(0.1);
    expect(WORKER_SECTION_PROGRAMS).toBe(6);
  });

  it('applies the fixed floor with floors, the relative minimum without', () => {
    // A 12 percent hitch gap: outside the relative minimum, inside the floor.
    const arms = [
      arm('d3d11', { worst: 500, lost: 1000, cold: 170 }),
      arm('vulkan-parallel-compile', { worst: 440, lost: 880, cold: 150 }),
    ];
    expect(decide(arms, { round: 1, floors: PROVISIONAL_FLOORS }).backend).toBe('d3d11');
    expect(decide(arms, { round: 1, floors: null }).backend).toBe('vulkan-parallel-compile');
  });
});

describe('decide', () => {
  it('disqualifies an arm that did not bind or left no result', () => {
    const decision = decide([
      arm('d3d11', {}),
      arm('vulkan-parallel-compile', { ended: 'no-webgl2' }),
      arm('opengl', {}, { results: [], roundsLaunched: 1, roundsDied: 0 }),
    ]);
    expect(decision.arms.find((a) => a.rung === 'vulkan-parallel-compile')?.disqualified).toBe(
      'did-not-bind',
    );
    expect(decision.arms.find((a) => a.rung === 'opengl')?.disqualified).toBe('no-result');
    expect(decision.backend).toBe('d3d11');
  });

  it('reports the WINNER worker decision, not the reference one', () => {
    // Both workers off (the link profile is then the cold link on both
    // arms), so the winner is decided on the hitch metrics alone.
    const decision = decide([
      arm('d3d11', { worst: 500, lost: 1100, cold: 170, workerLost: 600 }),
      arm('vulkan-parallel-compile', { worst: 230, lost: 380, cold: 175, workerLost: 600 }),
    ]);
    expect(decision.backend).toBe('vulkan-parallel-compile');
    expect(decision.worker).toBe(false);
    const referenceWins = decide([
      arm('d3d11', { workerLost: 600 }),
      arm('vulkan-parallel-compile', { workerLost: 600 }),
    ]);
    expect(referenceWins.backend).toBe('d3d11');
    expect(referenceWins.worker).toBe(false);
  });

  it('holds a stored backend unless the new winner beats its own arm by the margin', () => {
    // Vulkan beats D3D11 clearly; plain Vulkan (the stored one) only just.
    const arms = [
      arm('d3d11', { worst: 500, lost: 1100, cold: 170 }),
      arm('vulkan-parallel-compile', { worst: 230, lost: 380, cold: 175 }),
      arm('vulkan-plain', { worst: 245, lost: 400, cold: 176 }),
    ];
    expect(decide(arms, { round: 1 }).backend).toBe('vulkan-parallel-compile');
    const held = decide(arms, { round: 1, storedRung: 'vulkan-plain' });
    expect(held.backend).toBe('vulkan-plain');
    expect(held.secondRoundTriggers).toContain(
      'vulkan-parallel-compile does not beat the stored vulkan-plain by the margin',
    );
    // A stored backend disqualified in this run is replaced regardless.
    const replaced = decide([arms[0], arms[1], arm('vulkan-plain', { software: true })], {
      round: 1,
      storedRung: 'vulkan-plain',
    });
    expect(replaced.backend).toBe('vulkan-parallel-compile');
    // A stored backend the new winner beats by the margin is replaced too.
    const beaten = decide(
      [arms[0], arms[1], arm('vulkan-plain', { worst: 400, lost: 900, cold: 176 })],
      { round: 1, storedRung: 'vulkan-plain' },
    );
    expect(beaten.backend).toBe('vulkan-parallel-compile');
  });

  it('is inconclusive on a mixed power state', () => {
    const decision = decide([
      arm('d3d11', {}, { onBattery: [false] }),
      arm('vulkan-parallel-compile', {}, { onBattery: [true] }),
    ]);
    expect(decision.inconclusive).toBe('mixed power state');
    expect(decision.backend).toBeNull();
    const same = decide([
      arm('d3d11', {}, { onBattery: [true] }),
      arm('vulkan-parallel-compile', {}, { onBattery: [true] }),
    ]);
    expect(same.inconclusive).toBeNull();
  });

  it('keeps D3D11 on a tie, with the tie as a second-round trigger', () => {
    const decision = decide([arm('d3d11', {}), arm('vulkan-parallel-compile', {})]);
    expect(decision.backend).toBe('d3d11');
    expect(decision.reference).toBe('d3d11');
    expect(decision.secondRoundTriggers).toEqual(['vulkan-parallel-compile inside the margin']);
    expect(decision.inconclusive).toBeNull();
  });

  it('replaces D3D11 with a backend clearly better on hitches and not worse elsewhere', () => {
    const decision = decide([
      arm('d3d11', { worst: 500, lost: 1100, cold: 170 }),
      arm('vulkan-parallel-compile', { worst: 230, lost: 380, cold: 175 }),
    ]);
    expect(decision.backend).toBe('vulkan-parallel-compile');
    expect(decision.secondRoundTriggers).toEqual([]);
  });

  it('refuses a hitch winner that is worse beyond tolerance on the game-shaped frame', () => {
    const decision = decide([
      arm('d3d11', { worst: 500, lost: 1100, frameP95: 25 }),
      arm('vulkan-parallel-compile', { worst: 230, lost: 380, frameP95: 33 }),
    ]);
    expect(decision.backend).toBe('d3d11');
  });

  it('refuses a hitch winner that is worse on pacing or on another hitch metric', () => {
    expect(
      decide([
        arm('d3d11', { worst: 500, onCadence: 0.99 }),
        arm('vulkan-parallel-compile', { worst: 230, onCadence: 0.7 }),
      ]).backend,
    ).toBe('d3d11');
    expect(
      decide([
        arm('d3d11', { worst: 500, upload: 20 }),
        arm('vulkan-parallel-compile', { worst: 230, upload: 60 }),
      ]).backend,
    ).toBe('d3d11');
  });

  it('disqualifies software, a wrong checksum, a critical capability, a double death, another adapter', () => {
    const decision = decide([
      arm('d3d11', {}),
      arm('vulkan-parallel-compile', { software: true }),
      arm('vulkan-plain', { checksumOk: false }),
      arm('opengl', { critical: ['no half-float render targets'] }),
    ]);
    expect(decision.arms.map((a) => a.disqualified)).toEqual([
      null,
      'software',
      'checksum',
      'capability',
    ]);
    const died = decide([
      arm('d3d11', {}),
      arm('vulkan-parallel-compile', {}, { results: [], roundsLaunched: 2, roundsDied: 2 }),
      arm('opengl', { worst: 10, lost: 0 }, { adapter: 'gpu-2' }),
    ]);
    expect(died.arms[1].disqualified).toBe('died');
    expect(died.arms[2].disqualified).toBe('adapter-differs');
    expect(died.backend).toBe('d3d11');
  });

  it('a single death is a trigger, not a disqualification', () => {
    const decision = decide([
      arm('d3d11', {}),
      arm('vulkan-parallel-compile', { worst: 10, lost: 0 }, { roundsLaunched: 2, roundsDied: 1 }),
    ]);
    expect(decision.arms[1].disqualified).toBeNull();
    expect(decision.secondRoundTriggers).toContain('vulkan-parallel-compile died once');
  });

  it('ranks the survivors against each other when D3D11 is out, ties to Vulkan', () => {
    const decision = decide([
      arm('d3d11', { software: true }),
      arm('opengl', {}),
      arm('vulkan-plain', {}),
    ]);
    expect(decision.reference).toBe('vulkan-plain');
    expect(decision.backend).toBe('vulkan-plain');
  });

  it('is inconclusive on a neutral gating section or with no survivor', () => {
    expect(decide([arm('d3d11', { validity: { pacing: [false, false] } })]).inconclusive).toContain(
      'neutral pacing',
    );
    expect(decide([arm('d3d11', { software: true })]).inconclusive).toBe('no surviving backend');
  });

  it('widens the margin to twice the largest spread and lists single passes as triggers', () => {
    const noisy: ArmInput = {
      ...arm('d3d11', {}),
      results: [result({ cold: 100 }, { cold: 160 })],
    };
    const decision = decide([noisy, arm('vulkan-parallel-compile', { worst: 80 })]);
    expect(decision.margin).toBeCloseTo(2 * (60 / 130), 5);
    // Twenty percent better on one metric is inside a margin near 0.92.
    expect(decision.backend).toBe('d3d11');
    const single = decide([arm('d3d11', { validity: { links: [true, false] } })]);
    expect(single.secondRoundTriggers).toEqual(['d3d11 single pass: links']);
  });

  it('lists no trigger in round two', () => {
    const decision = decide([arm('d3d11', {}), arm('vulkan-parallel-compile', {})], { round: 2 });
    expect(decision.secondRoundTriggers).toEqual([]);
    expect(decision.backend).toBe('d3d11');
  });
});
