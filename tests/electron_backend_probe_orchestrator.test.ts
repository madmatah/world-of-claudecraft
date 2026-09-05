import { describe, expect, it } from 'vitest';
import {
  armInputs,
  cleanupRun,
  createLivenessTracker,
  HANG_FLOOR_MS,
  HANG_GAP_MULTIPLIER,
  inconclusiveOutcomes,
  launchArm,
  type OrchestratorContext,
  runRound,
  secondRoundTriggers,
} from '../electron/backend_probe_orchestrator.cjs';
import { PROBE_EXIT } from '../electron/backend_probe_plan.cjs';
import { PROBE_VERSION } from '../electron/backend_probe_result.cjs';

// A scripted world: fake timers ticked by hand, a fake filesystem, and a
// spawn whose exits the test drives. Each spawned "child" exposes what the
// orchestrator gave it and how to end it.
function world() {
  let nowMs = 1_000;
  const intervals: { cb: () => void; ms: number; id: number }[] = [];
  let nextId = 1;
  const dirs: string[] = [];
  const removed: string[] = [];
  const files = new Map<string, { mtime: number; body: unknown }>();
  const spawned: {
    env: Record<string, string | undefined>;
    argv: string[];
    exit: (code: number | null, signal?: string | null) => void;
    killed: number;
  }[] = [];
  const ctx: OrchestratorContext = {
    run: 'run1',
    runDir: '/ud/backend-probe/run1',
    baseEnv: { PATH: '/bin' },
    argv: ['--test-backends', '-AUTH_LOGIN=x', '--keep'],
    locale: 'fr',
    tier: 'high',
    gpuForceOptOut: false,
    parentPid: 42,
    fs: {
      mkdir: (dir) => void dirs.push(dir),
      rm: (dir) => void removed.push(dir),
      fileMtimeMs: (path) => files.get(path)?.mtime ?? null,
      readResultFile: (path) => files.get(path)?.body ?? null,
    },
    timers: {
      setInterval: (cb, ms) => {
        const id = nextId++;
        intervals.push({ cb, ms, id });
        return id;
      },
      clearInterval: (id) => {
        const at = intervals.findIndex((i) => i.id === id);
        if (at >= 0) intervals.splice(at, 1);
      },
    },
    now: () => nowMs,
    spawn: ({ env, argv, onExit }) => {
      const child = {
        env,
        argv,
        killed: 0,
        exit: (code: number | null, signal: string | null = null) => onExit({ code, signal }),
      };
      spawned.push(child);
      return {
        pid: 100 + spawned.length,
        kill: () => {
          child.killed += 1;
          onExit({ code: null, signal: 'SIGKILL' });
        },
      };
    },
  };
  const tick = (ms: number) => {
    nowMs += ms;
    for (const interval of [...intervals]) interval.cb();
  };
  const writeResult = (path: string, result: unknown, extra: Record<string, unknown> = {}) => {
    files.set(path, { mtime: nowMs, body: { outcome: 'running', result, ...extra } });
  };
  const result = (round: number, ended = 'completed') => ({
    probeVersion: PROBE_VERSION,
    run: 'run1',
    round,
    ended,
    sections: {},
  });
  return { ctx, tick, spawned, dirs, removed, writeResult, result, intervals };
}

// Let the promise machinery settle between scripted steps.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('createLivenessTracker', () => {
  it('is hung only past the floor, or past a multiple of the largest gap seen', () => {
    const tracker = createLivenessTracker(0);
    expect(tracker.deadlineMs()).toBe(HANG_FLOOR_MS);
    expect(tracker.hung(HANG_FLOOR_MS)).toBe(false);
    expect(tracker.hung(HANG_FLOOR_MS + 1)).toBe(true);
    // A slow machine that showed a 30 s gap earns a 120 s deadline.
    tracker.progress(30_000);
    expect(tracker.deadlineMs()).toBe(HANG_GAP_MULTIPLIER * 30_000);
    expect(tracker.hung(30_000 + HANG_GAP_MULTIPLIER * 30_000)).toBe(false);
    expect(tracker.hung(30_000 + HANG_GAP_MULTIPLIER * 30_000 + 1)).toBe(true);
    // Progress that does not move forward is ignored.
    tracker.progress(20_000);
    expect(tracker.lastProgressMs()).toBe(30_000);
  });
});

describe('launchArm', () => {
  it('creates the profile before the spawn, hands the plan over, and reads the result', async () => {
    const w = world();
    const pending = launchArm(w.ctx, 'd3d11', 1);
    expect(w.dirs).toEqual(['/ud/backend-probe/run1/d3d11-r1']);
    const child = w.spawned[0];
    expect(child.env.WOC_BACKEND_PROBE).toBe('1');
    expect(child.env.WOC_BACKEND_PROBE_ARM).toBe('d3d11');
    expect(child.env.WOC_BACKEND_PROBE_RESULT).toBe('/ud/backend-probe/run1/d3d11-r1.json');
    expect(child.env.WOC_BACKEND_PROBE_LOCALE).toBe('fr');
    expect(child.env.WOC_BACKEND_PROBE_TIER).toBe('high');
    expect(child.argv).toEqual(['--keep']);
    w.writeResult('/ud/backend-probe/run1/d3d11-r1.json', w.result(1), {
      adapter: '0x10de:0x2504',
      driverVersion: '560.94',
    });
    child.exit(PROBE_EXIT.completed);
    const outcome = await pending;
    expect(outcome.outcome).toBe('completed');
    expect(outcome.result).toMatchObject({ run: 'run1', round: 1, ended: 'completed' });
    expect(outcome.adapter).toBe('0x10de:0x2504');
    expect(outcome.driverVersion).toBe('560.94');
    expect(outcome.keepDirectory).toBe(false);
    expect(w.intervals).toHaveLength(0);
  });

  it('kills a child that stops posting past the deadline and reads it as hung', async () => {
    const w = world();
    const pending = launchArm(w.ctx, 'opengl', 1);
    const path = '/ud/backend-probe/run1/opengl-r1.json';
    // Heartbeats every 2 s for a while, each seen by the next poll: alive.
    for (let i = 0; i < 10; i += 1) {
      w.writeResult(path, w.result(1));
      w.tick(2_000);
    }
    expect(w.spawned[0].killed).toBe(0);
    // Then silence: still alive up to the floor, hung past it.
    w.tick(HANG_FLOOR_MS - 1_000);
    expect(w.spawned[0].killed).toBe(0);
    w.tick(2_000);
    expect(w.spawned[0].killed).toBe(1);
    const outcome = await pending;
    expect(outcome.outcome).toBe('hung');
    expect(outcome.keepDirectory).toBe(true);
    // The sections it finished are kept.
    expect(outcome.result).toMatchObject({ ended: 'completed' });
  });

  it('classifies a death, a did-not-bind and an unknown code, and a spawn failure', async () => {
    const w = world();
    const died = launchArm(w.ctx, 'vulkan-parallel-compile', 1);
    w.spawned[0].exit(PROBE_EXIT.died);
    expect((await died).outcome).toBe('died');
    const bind = launchArm(w.ctx, 'opengl', 1);
    w.spawned[1].exit(PROBE_EXIT.didNotBind);
    expect((await bind).outcome).toBe('did-not-bind');
    const odd = launchArm(w.ctx, 'd3d11', 1);
    w.spawned[2].exit(99);
    expect((await odd).outcome).toBe('unknown');
    const failing = {
      ...w.ctx,
      spawn: () => {
        throw new Error('ENOENT');
      },
    };
    expect((await launchArm(failing, 'd3d11', 1)).outcome).toBe('unknown');
  });

  it('refuses a result of another run or round', async () => {
    const w = world();
    const pending = launchArm(w.ctx, 'd3d11', 2);
    w.writeResult('/ud/backend-probe/run1/d3d11-r2.json', w.result(1));
    w.spawned[0].exit(PROBE_EXIT.completed);
    expect((await pending).result).toBeNull();
  });
});

describe('runRound', () => {
  async function drive(w: ReturnType<typeof world>, script: Record<string, number>) {
    // Ends each spawned child with the exit its arm is scripted to, in order.
    const seen: string[] = [];
    let handled = 0;
    while (true) {
      await settle();
      if (w.spawned.length === handled) break;
      const child = w.spawned[handled];
      const arm = child.env.WOC_BACKEND_PROBE_ARM as string;
      seen.push(arm);
      const round = Number(child.env.WOC_BACKEND_PROBE_ROUND);
      const path = child.env.WOC_BACKEND_PROBE_RESULT as string;
      if (script[arm] === PROBE_EXIT.completed) w.writeResult(path, w.result(round));
      child.exit(script[arm] ?? PROBE_EXIT.completed);
      handled += 1;
    }
    return seen;
  }

  it('runs the fixed order in round one and reverses it in round two', async () => {
    const w = world();
    const starts: string[] = [];
    w.ctx.onArmStart = (s) => void starts.push(`${s.arm}#${s.index + 1}/${s.total}`);
    const pending = runRound(w.ctx, 1);
    const seen = await drive(w, {});
    const round = await pending;
    expect(seen).toEqual(['d3d11', 'vulkan-parallel-compile', 'opengl']);
    expect(starts).toEqual(['d3d11#1/3', 'vulkan-parallel-compile#2/3', 'opengl#3/3']);
    expect(round.plainVulkan).toBe(false);
    const w2 = world();
    const pending2 = runRound(w2.ctx, 2, { plainVulkan: true });
    expect(await drive(w2, {})).toEqual([
      'opengl',
      'vulkan-plain',
      'vulkan-parallel-compile',
      'd3d11',
    ]);
    expect((await pending2).arms).toHaveLength(4);
  });

  it('launches vulkan-plain right after a dead vulkan child, once, in round one only', async () => {
    const w = world();
    const pending = runRound(w.ctx, 1);
    const seen = await drive(w, { 'vulkan-parallel-compile': PROBE_EXIT.died });
    const round = await pending;
    expect(seen).toEqual(['d3d11', 'vulkan-parallel-compile', 'vulkan-plain', 'opengl']);
    expect(round.plainVulkan).toBe(true);
    // Already an arm: no second launch.
    const w2 = world();
    const pending2 = runRound(w2.ctx, 1, { plainVulkan: true });
    expect(await drive(w2, { 'vulkan-parallel-compile': PROBE_EXIT.died })).toEqual([
      'd3d11',
      'vulkan-parallel-compile',
      'vulkan-plain',
      'opengl',
    ]);
    await pending2;
    // Round two never adds an arm.
    const w3 = world();
    const pending3 = runRound(w3.ctx, 2);
    expect(await drive(w3, { 'vulkan-parallel-compile': PROBE_EXIT.died })).toEqual([
      'opengl',
      'vulkan-parallel-compile',
      'd3d11',
    ]);
    await pending3;
  });

  it('drops the OpenGL arm on arm64', async () => {
    const w = world();
    w.ctx.arm64 = true;
    const pending = runRound(w.ctx, 1);
    expect(await drive(w, {})).toEqual(['d3d11', 'vulkan-parallel-compile']);
    await pending;
  });
});

describe('armInputs, secondRoundTriggers, inconclusiveOutcomes, cleanupRun', () => {
  const outcome = (arm: string, round: number, o: string, extra: Record<string, unknown> = {}) => ({
    arm,
    round,
    outcome: o,
    code: null,
    signal: null,
    result: o === 'completed' ? { round } : null,
    adapter: '',
    driverVersion: '',
    onBattery: null,
    profileDir: `/p/${arm}-r${round}`,
    resultPath: `/p/${arm}-r${round}.json`,
    keepDirectory: o !== 'completed',
    ...extra,
  });

  it('shapes the rounds into per-rung inputs with launched and died counts', () => {
    const rounds = [
      {
        round: 1,
        arms: ['d3d11', 'vulkan-parallel-compile', 'opengl'],
        outcomes: [
          outcome('d3d11', 1, 'completed', { adapter: 'a' }),
          outcome('vulkan-parallel-compile', 1, 'died'),
          outcome('opengl', 1, 'completed'),
        ],
        plainVulkan: false,
      },
      {
        round: 2,
        arms: ['opengl', 'vulkan-parallel-compile', 'd3d11'],
        outcomes: [
          outcome('opengl', 2, 'completed'),
          outcome('vulkan-parallel-compile', 2, 'completed', { adapter: 'a' }),
          outcome('d3d11', 2, 'completed', { adapter: 'b' }),
        ],
        plainVulkan: false,
      },
    ];
    const inputs = armInputs(rounds);
    expect(inputs.map((i) => i.rung)).toEqual(['d3d11', 'vulkan-parallel-compile', 'opengl']);
    const vulkan = inputs[1];
    expect(vulkan.roundsLaunched).toBe(2);
    expect(vulkan.roundsDied).toBe(1);
    expect(vulkan.results).toEqual([{ round: 2 }]);
    expect(vulkan.adapter).toBe('a');
    // The first adapter reported is the one latched.
    expect(inputs[0].adapter).toBe('a');
    expect(inputs[0].results).toEqual([{ round: 1 }, { round: 2 }]);
    // Power states: one reading per round that reported one.
    const powered = armInputs([
      {
        round: 1,
        arms: ['d3d11'],
        outcomes: [outcome('d3d11', 1, 'completed', { onBattery: true })],
        plainVulkan: false,
      },
      {
        round: 2,
        arms: ['d3d11'],
        outcomes: [outcome('d3d11', 2, 'completed')],
        plainVulkan: false,
      },
    ]);
    expect(powered[0].onBattery).toEqual([true]);
  });

  it('names every second-round trigger once and the inconclusive outcomes', () => {
    const round1 = {
      round: 1,
      arms: ['d3d11', 'vulkan-parallel-compile', 'opengl'],
      outcomes: [
        outcome('d3d11', 1, 'capped'),
        outcome('vulkan-parallel-compile', 1, 'died'),
        outcome('opengl', 1, 'hung'),
      ],
      plainVulkan: false,
    };
    expect(secondRoundTriggers(round1, { secondRoundTriggers: ['inside the margin'] })).toEqual([
      'inside the margin',
      'reference capped',
      'vulkan-parallel-compile died',
    ]);
    // The decision already naming the death: not repeated.
    expect(
      secondRoundTriggers(round1, { secondRoundTriggers: ['vulkan-parallel-compile died once'] }),
    ).toEqual(['vulkan-parallel-compile died once', 'reference capped']);
    expect(secondRoundTriggers(round1, null)).toContain('vulkan-parallel-compile died');
    // The capped trigger follows the decision's reference, not D3D11 literally.
    expect(secondRoundTriggers(round1, { secondRoundTriggers: [], reference: 'opengl' })).toEqual([
      'vulkan-parallel-compile died',
    ]);
    expect(inconclusiveOutcomes([round1])).toEqual(['opengl round 1: hung']);
  });

  it('names every inconclusive outcome', () => {
    for (const o of ['hung', 'renderer-gone', 'probe-error', 'busy', 'orphaned', 'unknown']) {
      const round = {
        round: 1,
        arms: ['d3d11'],
        outcomes: [outcome('d3d11', 1, o)],
        plainVulkan: false,
      };
      expect(inconclusiveOutcomes([round])).toEqual([`d3d11 round 1: ${o}`]);
    }
    for (const o of ['completed', 'died', 'did-not-bind', 'capped']) {
      const round = {
        round: 1,
        arms: ['d3d11'],
        outcomes: [outcome('d3d11', 1, o)],
        plainVulkan: false,
      };
      expect(inconclusiveOutcomes([round])).toEqual([]);
    }
  });

  it('removes only the directories of completed children', () => {
    const w = world();
    cleanupRun(w.ctx, [
      {
        round: 1,
        arms: ['d3d11', 'opengl'],
        outcomes: [outcome('d3d11', 1, 'completed'), outcome('opengl', 1, 'died')],
        plainVulkan: false,
      },
    ]);
    expect(w.removed).toEqual(['/p/d3d11-r1']);
  });
});
