// The GPU backend probe's plan (electron/backend_probe_plan.cjs): the arms per
// round, each arm's switches against the shell's shipped Vulkan sets, the
// child's environment and argv, the run's paths, the exit-code taxonomy.
import { describe, expect, it } from 'vitest';
import {
  armsForRound,
  childArgvFor,
  childEnvFor,
  classifyChildExit,
  hasTestBackendsFlag,
  isProbeChild,
  keepsDirectory,
  machineIsArm64,
  newRunId,
  PROBE_EXIT,
  probeChildConfig,
  profileDirFor,
  resultPathFor,
  runDirectoryFor,
  switchesForArm,
  TEST_BACKENDS_FLAG,
} from '../electron/backend_probe_plan.cjs';
import {
  GPU_BACKEND_RESCUE_ENV,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_PARALLEL_COMPILE_SWITCH,
} from '../electron/gpu_backend.cjs';
import { PRIME_RELAUNCH_MARKER } from '../electron/gpu_preference.cjs';

describe('armsForRound', () => {
  it('runs D3D11, Vulkan parallel and OpenGL in round one, reversed in round two', () => {
    expect(armsForRound(1)).toEqual(['d3d11', 'vulkan-parallel-compile', 'opengl']);
    expect(armsForRound(2)).toEqual(['opengl', 'vulkan-parallel-compile', 'd3d11']);
  });

  it('slots the adaptive plain-Vulkan arm right after the parallel one', () => {
    expect(armsForRound(1, { plainVulkan: true })).toEqual([
      'd3d11',
      'vulkan-parallel-compile',
      'vulkan-plain',
      'opengl',
    ]);
    expect(armsForRound(2, { plainVulkan: true })).toEqual([
      'opengl',
      'vulkan-plain',
      'vulkan-parallel-compile',
      'd3d11',
    ]);
  });

  it('drops OpenGL on ARM64, where no desktop ICD exists', () => {
    expect(armsForRound(1, { arm64: true })).toEqual(['d3d11', 'vulkan-parallel-compile']);
  });
});

describe('switchesForArm', () => {
  it('pins D3D11 and GL explicitly and ships the exact Vulkan sets', () => {
    expect(switchesForArm('d3d11')).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'd3d11'],
    ]);
    expect(switchesForArm('opengl')).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'gl'],
    ]);
    expect(switchesForArm('vulkan-plain')).toEqual([...VULKAN_BACKEND_SWITCHES]);
    expect(switchesForArm('vulkan-parallel-compile')).toEqual([
      ...VULKAN_BACKEND_SWITCHES,
      VULKAN_PARALLEL_COMPILE_SWITCH,
    ]);
  });
});

describe('the child environment and argv', () => {
  const input = {
    baseEnv: {
      PATH: '/bin',
      [GPU_BACKEND_RESCUE_ENV]: 'opengl',
      WOC_GPU_BACKEND: 'vulkan',
      [PRIME_RELAUNCH_MARKER]: '1',
    },
    arm: 'vulkan-plain' as const,
    run: 'abc-12',
    round: 2,
    resultPath: '/tmp/run/vulkan-plain-r2.json',
    profileDir: '/tmp/run/vulkan-plain-r2',
    locale: 'fr_FR',
    tier: 'ultra',
    gpuForceOptOut: true,
    parentPid: 4242,
  };

  it('plants the child fields and strips the rescue and PRIME markers', () => {
    const env = childEnvFor(input);
    expect(env.PATH).toBe('/bin');
    expect(env[GPU_BACKEND_RESCUE_ENV]).toBeUndefined();
    expect(env.WOC_GPU_BACKEND).toBeUndefined();
    expect(env[PRIME_RELAUNCH_MARKER]).toBeUndefined();
    expect(isProbeChild(env)).toBe(true);
    expect(probeChildConfig(env)).toEqual({
      arm: 'vulkan-plain',
      run: 'abc-12',
      round: 2,
      parentPid: 4242,
      resultPath: '/tmp/run/vulkan-plain-r2.json',
      profileDir: '/tmp/run/vulkan-plain-r2',
      locale: 'fr_FR',
      tier: 'ultra',
      gpuForceOptOut: true,
      armIndex: null,
      armTotal: null,
    });
  });

  it('carries the arm position, the child window said nothing global without it', () => {
    const env = childEnvFor({ ...input, armIndex: 1, armTotal: 3 });
    expect(probeChildConfig(env)).toMatchObject({ armIndex: 1, armTotal: 3 });
  });

  it('degrades a nonsense arm position to no position rather than refusing the child', () => {
    // Display only: the measurement must not hinge on it, and an unnamed
    // position must never read as "test 1 of 1".
    const env = childEnvFor({ ...input, armIndex: 5, armTotal: 3 });
    expect(probeChildConfig(env)).toMatchObject({ armIndex: null, armTotal: null });
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_ARM_TOTAL: 'x' })).toMatchObject({
      armIndex: null,
      armTotal: null,
    });
  });

  it('keeps the Windows child off the parent console, so the orphan pipe survives', () => {
    // Electron attaches to the parent's console on Windows and reopens the
    // standard streams, which replaces the pipe the parent put on fd 0 and made
    // every arm of the first Windows run exit orphaned 25 ms in.
    expect(childEnvFor(input).ELECTRON_NO_ATTACH_CONSOLE).toBe('1');
  });

  it('refuses a child plan with a missing or malformed field', () => {
    const env = childEnvFor(input);
    expect(isProbeChild({})).toBe(false);
    expect(probeChildConfig({})).toBeNull();
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_ARM: 'metal' })).toBeNull();
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_ROUND: '0' })).toBeNull();
    // The locale and the tier are allowlisted here too, defaulting rather than refusing.
    expect(
      probeChildConfig({
        ...env,
        WOC_BACKEND_PROBE_LOCALE: '../x',
        WOC_BACKEND_PROBE_TIER: 'turbo',
      }),
    ).toMatchObject({ locale: 'en', tier: 'ultra' });
    expect(
      probeChildConfig({
        ...env,
        WOC_BACKEND_PROBE_LOCALE: 'zh_CN',
        WOC_BACKEND_PROBE_TIER: 'low',
      }),
    ).toMatchObject({ locale: 'zh_CN', tier: 'low' });
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_PARENT_PID: 'x' })).toBeNull();
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_RESULT: 'relative.json' })).toBeNull();
    expect(probeChildConfig({ ...env, WOC_BACKEND_PROBE_RUN: 'has spaces' })).toBeNull();
  });

  it('strips the flag and the Epic auth family from the child argv', () => {
    expect(
      childArgvFor([
        'app',
        TEST_BACKENDS_FLAG,
        '-AUTH_PASSWORD=x',
        '-AUTH_TYPE=y',
        'worldofclaudecraft://desktop-login?code=abc',
        '--foo',
      ]),
    ).toEqual(['app', '--foo']);
    expect(hasTestBackendsFlag(['a', TEST_BACKENDS_FLAG])).toBe(true);
    expect(hasTestBackendsFlag(['a'])).toBe(false);
    expect(hasTestBackendsFlag(undefined)).toBe(false);
  });
});

describe('the run paths and id', () => {
  it('nest the run under userData with one profile and one result per arm and round', () => {
    const runDir = runDirectoryFor('/home/p/.config/woc', 'r1');
    expect(runDir).toBe('/home/p/.config/woc/backend-probe/r1');
    expect(profileDirFor(runDir, 'd3d11', 1)).toBe('/home/p/.config/woc/backend-probe/r1/d3d11-r1');
    expect(resultPathFor(runDir, 'opengl', 2)).toBe(
      '/home/p/.config/woc/backend-probe/r1/opengl-r2.json',
    );
  });

  it('mints a run id of directory-safe characters', () => {
    const id = newRunId(1_700_000_000_000, () => 0.5);
    expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    expect(newRunId(1, () => 0.1)).not.toBe(newRunId(1, () => 0.9));
  });
});

describe('classifyChildExit', () => {
  it('maps each code, a parent kill, a signal and a stranger to their outcomes', () => {
    expect(classifyChildExit({ code: PROBE_EXIT.completed, signal: null })).toBe('completed');
    expect(classifyChildExit({ code: PROBE_EXIT.died, signal: null })).toBe('died');
    expect(classifyChildExit({ code: PROBE_EXIT.didNotBind, signal: null })).toBe('did-not-bind');
    expect(classifyChildExit({ code: PROBE_EXIT.capped, signal: null })).toBe('capped');
    expect(classifyChildExit({ code: PROBE_EXIT.orphaned, signal: null })).toBe('orphaned');
    expect(classifyChildExit({ code: PROBE_EXIT.rendererGone, signal: null })).toBe(
      'renderer-gone',
    );
    expect(classifyChildExit({ code: PROBE_EXIT.probeError, signal: null })).toBe('probe-error');
    expect(classifyChildExit({ code: PROBE_EXIT.busy, signal: null })).toBe('busy');
    expect(classifyChildExit({ code: 1, signal: null })).toBe('unknown');
    expect(classifyChildExit({ code: null, signal: 'SIGSEGV' })).toBe('unknown');
    expect(classifyChildExit({ code: null, signal: 'SIGKILL', killedByParent: true })).toBe('hung');
  });

  it('keeps every directory but a completed child', () => {
    expect(keepsDirectory('completed')).toBe(false);
    expect(keepsDirectory('died')).toBe(true);
    expect(keepsDirectory('unknown')).toBe(true);
  });
});

describe('machineIsArm64', () => {
  it('reads the process arch, then the WOW64 environment of an emulated x64 build', () => {
    expect(machineIsArm64({ arch: 'arm64', env: {} })).toBe(true);
    expect(machineIsArm64({ arch: 'x64', env: { PROCESSOR_ARCHITEW6432: 'ARM64' } })).toBe(true);
    expect(machineIsArm64({ arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'ARM64' } })).toBe(true);
    expect(machineIsArm64({ arch: 'x64', env: { PROCESSOR_ARCHITECTURE: 'AMD64' } })).toBe(false);
    expect(
      machineIsArm64({
        arch: 'x64',
        env: { PROCESSOR_ARCHITEW6432: 'AMD64', PROCESSOR_ARCHITECTURE: 'ARM64' },
      }),
    ).toBe(false);
    expect(machineIsArm64({ arch: 'x64' })).toBe(false);
  });
});
