import { describe, expect, it } from 'vitest';
import { readBackendProbeVerdict } from '../electron/backend_probe_verdict.cjs';
import { GPU_BACKEND_RUNGS } from '../electron/gpu_backend.cjs';
import {
  decideWindowsGpuBackendLaunch,
  judgeWindowsGpuBackendLaunch,
  WINDOWS_GPU_BACKEND_RUNGS,
  windowsBackendDidNotBind,
  windowsRungBelow,
} from '../electron/gpu_backend_windows.cjs';

const facts = { chromeVersion: '151.0.7443.0', probeVersion: 1, corpusHash: 'abc' };
const verdict = (over: Record<string, unknown> = {}) =>
  readBackendProbeVerdict({
    rung: 'vulkan-parallel-compile',
    backend: 'vulkan',
    worker: true,
    chromeVersion: facts.chromeVersion,
    probeVersion: 1,
    corpusHash: 'abc',
    ...over,
  }) as NonNullable<ReturnType<typeof readBackendProbeVerdict>>;

describe('the Windows rungs', () => {
  it('share the Linux literals for the rungs both ladders have', () => {
    for (const rung of GPU_BACKEND_RUNGS) expect(WINDOWS_GPU_BACKEND_RUNGS).toContain(rung);
    expect(WINDOWS_GPU_BACKEND_RUNGS).toContain('d3d11');
  });

  it('step down inside Vulkan, then onto D3D11, and nowhere below it', () => {
    expect(windowsRungBelow('vulkan-parallel-compile')).toBe('vulkan-plain');
    expect(windowsRungBelow('vulkan-plain')).toBe('d3d11');
    expect(windowsRungBelow('opengl')).toBe('d3d11');
    expect(windowsRungBelow('d3d11')).toBeNull();
    expect(windowsRungBelow('metal')).toBeNull();
  });
});

describe('decideWindowsGpuBackendLaunch', () => {
  it('pins D3D11 explicitly by default, with the rescue on', () => {
    const launch = decideWindowsGpuBackendLaunch({ env: {}, prefs: {}, ...facts });
    expect(launch.rung).toBe('d3d11');
    expect(launch.switches).toEqual([
      ['use-gl', 'angle'],
      ['use-angle', 'd3d11'],
    ]);
    expect(launch.ladder).toBe(true);
    expect(launch.auto).toBe(false);
    expect(launch.fromVerdict).toBe(false);
    expect(launch.backend).toBe('default');
  });

  it('runs a valid verdict, and ignores a stale or mismatched one', () => {
    const fromVerdict = decideWindowsGpuBackendLaunch({
      env: {},
      prefs: { gpuBackend: 'auto', backendProbeVerdict: verdict() },
      ...facts,
    });
    expect(fromVerdict.rung).toBe('vulkan-parallel-compile');
    expect(fromVerdict.fromVerdict).toBe(true);
    expect(fromVerdict.backend).toBe('vulkan');
    expect(fromVerdict.parallel).toBe(true);
    expect(fromVerdict.switches.map(([name]) => name)).toContain('enable-angle-features');
    for (const bad of [
      verdict({ stale: true }),
      verdict({ chromeVersion: '150.0.0.0' }),
      verdict({ corpusHash: 'other' }),
      verdict({ probeVersion: 2 }),
    ]) {
      expect(
        decideWindowsGpuBackendLaunch({ env: {}, prefs: { backendProbeVerdict: bad }, ...facts })
          .rung,
      ).toBe('d3d11');
    }
  });

  it('follows the precedence: rescue marker, env override, no-lever env, setting, verdict', () => {
    const prefs = { gpuBackend: 'opengl', backendProbeVerdict: verdict() };
    expect(
      decideWindowsGpuBackendLaunch({
        env: { WOC_GPU_BACKEND_RESCUED_TO: 'vulkan-plain', WOC_GPU_BACKEND: 'd3d11' },
        prefs,
        ...facts,
      }),
    ).toMatchObject({ rung: 'vulkan-plain', rescued: true });
    expect(
      decideWindowsGpuBackendLaunch({ env: { WOC_GPU_BACKEND: 'vulkan' }, prefs, ...facts }).rung,
    ).toBe('vulkan-parallel-compile');
    expect(
      decideWindowsGpuBackendLaunch({ env: { WOC_GPU_BACKEND: 'd3d11' }, prefs, ...facts }).rung,
    ).toBe('d3d11');
    const noLever = decideWindowsGpuBackendLaunch({
      env: { WOC_DISABLE_GPU_FORCE: '1' },
      prefs,
      ...facts,
    });
    expect(noLever).toMatchObject({ rung: 'd3d11', ladder: false, switches: [] });
    expect(decideWindowsGpuBackendLaunch({ env: {}, prefs, ...facts })).toMatchObject({
      rung: 'opengl',
      fromVerdict: false,
    });
    expect(
      decideWindowsGpuBackendLaunch({
        env: {},
        prefs: { ...prefs, gpuBackend: 'vulkan' },
        ...facts,
      }).rung,
    ).toBe('vulkan-parallel-compile');
    expect(
      decideWindowsGpuBackendLaunch({ env: {}, prefs: { ...prefs, gpuBackend: 'd3d11' }, ...facts })
        .rung,
    ).toBe('d3d11');
    // An unknown rescue marker is ignored.
    expect(
      decideWindowsGpuBackendLaunch({
        env: { WOC_GPU_BACKEND_RESCUED_TO: 'metal' },
        prefs: {},
        ...facts,
      }).rung,
    ).toBe('d3d11');
  });
});

describe('judgeWindowsGpuBackendLaunch', () => {
  it('reads real renderer strings', () => {
    const judge = (glRenderer: string, more: Record<string, unknown> = {}) =>
      judgeWindowsGpuBackendLaunch({ glRenderer, ...more });
    expect(
      judge('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 (0x00002504) Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    ).toBe('d3d11');
    expect(
      judge('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11on12 vs_5_0 ps_5_0, D3D11on12)'),
    ).toBe('d3d11');
    expect(
      judge('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)'),
    ).toBe('software');
    expect(
      judge(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe('software');
    expect(
      judge(
        'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3060 (0x00002504)), NVIDIA)',
        {
          parallel: true,
          parallelCompile: true,
        },
      ),
    ).toBe('vulkan-parallel-compile');
    expect(
      judge(
        'ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA GeForce RTX 3060 (0x00002504)), NVIDIA)',
        {
          parallel: true,
          parallelCompile: false,
        },
      ),
    ).toBe('vulkan-plain');
    expect(judge('ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA ...), NVIDIA)', { parallel: false })).toBe(
      'vulkan-plain',
    );
    expect(
      judge('ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3060/PCIe/SSE2, OpenGL 4.5.0)'),
    ).toBe('opengl');
    expect(judge('', { softwareRendering: true })).toBe('software');
    expect(judge('')).toBe('unknown');
    expect(judge('Something else')).toBe('unknown');
  });
});

describe('windowsBackendDidNotBind', () => {
  it('judges by family and never on unknown evidence', () => {
    expect(windowsBackendDidNotBind('vulkan-parallel-compile', 'd3d11')).toBe(true);
    expect(windowsBackendDidNotBind('vulkan-parallel-compile', 'vulkan-plain')).toBe(false);
    expect(windowsBackendDidNotBind('vulkan-plain', 'software')).toBe(true);
    expect(windowsBackendDidNotBind('opengl', 'd3d11')).toBe(true);
    expect(windowsBackendDidNotBind('opengl', 'opengl')).toBe(false);
    expect(windowsBackendDidNotBind('d3d11', 'software')).toBe(true);
    expect(windowsBackendDidNotBind('d3d11', 'd3d11')).toBe(false);
    expect(windowsBackendDidNotBind('d3d11', 'unknown')).toBe(false);
    expect(windowsBackendDidNotBind('metal', 'software')).toBe(false);
  });
});
