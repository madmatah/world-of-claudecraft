'use strict';

// The WINDOWS GPU backend lever: which backend a launch runs, and where the
// rescue steps when it dies. Windows differs from the Linux ladder
// (electron/gpu_backend.cjs) in three ways: D3D11 is the reference and the
// floor (below it Chromium's own fallback runs), the memory is the probe's
// VERDICT (electron/backend_probe_verdict.cjs) rather than a climbing
// attempt, and the D3D11 launch is PINNED explicitly (the platform default
// can resolve to d3d11on12 or WARP), so measured equals shipped. The rungs
// share the Linux literals for the two Vulkan rungs and OpenGL, so no
// whitelist ever drops a verdict.
//
// Precedence at launch, first match wins: the rescue marker (the parent
// watched the rung above die seconds ago), WOC_GPU_BACKEND, WOC_DISABLE_GPU_FORCE
// (the platform default with no pin at all), the player's explicit setting,
// a valid verdict, D3D11 pinned. Pure; tests/electron_gpu_backend_windows.test.ts.

const { GPU_BACKEND_ENV, GPU_BACKEND_RESCUE_ENV } = require('./gpu_backend.cjs');
const { PROBE_ARMS, switchesForArm } = require('./backend_probe_plan.cjs');
const { verdictValidAtLaunch } = require('./backend_probe_verdict.cjs');

/** The Windows rungs: the probe's arms. */
const WINDOWS_GPU_BACKEND_RUNGS = PROBE_ARMS;

/** The rung the rescue steps to when `rung` dies at launch: the Vulkan
 *  family steps down inside itself then onto D3D11, OpenGL steps onto
 *  D3D11, and below D3D11 there is nothing of ours to step to. */
function windowsRungBelow(rung) {
  switch (rung) {
    case 'vulkan-parallel-compile':
      return 'vulkan-plain';
    case 'vulkan-plain':
      return 'd3d11';
    case 'opengl':
      return 'd3d11';
    default:
      return null;
  }
}

/**
 * The launch a rung describes, in the shape main.cjs already keys off
 * (electron/gpu_backend.cjs launchForRung) plus the arm's own switch list and
 * whether the verdict chose it. `auto` is always false here: the Linux
 * memory writers never run on Windows; the verdict's streaks are the
 * verdict module's business.
 */
function launchForWindowsRung(rung, reason, flags = {}) {
  return {
    backend: rung.startsWith('vulkan') ? 'vulkan' : 'default',
    parallel: rung === 'vulkan-parallel-compile',
    rung,
    reprobed: false,
    capped: false,
    reason,
    ladder: flags.ladder !== false,
    auto: false,
    rescued: flags.rescued === true,
    fromVerdict: flags.fromVerdict === true,
    switches: flags.switches ?? switchesForArm(rung),
  };
}

/** Which backend THIS Windows launch runs on (decision table in the header). */
function decideWindowsGpuBackendLaunch({ env, prefs, chromeVersion, probeVersion, corpusHash }) {
  const environment = env ?? {};
  const rescued = environment[GPU_BACKEND_RESCUE_ENV];
  if (WINDOWS_GPU_BACKEND_RUNGS.includes(rescued)) {
    return launchForWindowsRung(rescued, `rescued to ${rescued}`, { rescued: true });
  }
  const override = environment[GPU_BACKEND_ENV];
  if (override === 'opengl' || override === 'd3d11') {
    return launchForWindowsRung(override, `${GPU_BACKEND_ENV}=${override}`);
  }
  if (override === 'vulkan') {
    return launchForWindowsRung('vulkan-parallel-compile', `${GPU_BACKEND_ENV}=vulkan`);
  }
  if (environment.WOC_DISABLE_GPU_FORCE === '1') {
    // Every lever off: the platform default, unpinned, and nothing to rescue.
    return launchForWindowsRung('d3d11', 'WOC_DISABLE_GPU_FORCE=1', {
      ladder: false,
      switches: [],
    });
  }
  const setting = prefs?.gpuBackend;
  if (setting === 'opengl' || setting === 'd3d11') {
    return launchForWindowsRung(setting, `setting ${setting}`);
  }
  if (setting === 'vulkan') {
    return launchForWindowsRung('vulkan-parallel-compile', 'setting vulkan');
  }
  const verdict = prefs?.backendProbeVerdict;
  if (verdict && verdictValidAtLaunch(verdict, { chromeVersion, probeVersion, corpusHash })) {
    return launchForWindowsRung(verdict.rung, `verdict ${verdict.rung}`, { fromVerdict: true });
  }
  return launchForWindowsRung('d3d11', 'default, D3D11 pinned');
}

/**
 * The rung this Windows launch ACTUALLY bound, from what the GPU process
 * reports: 'software' for a rasterizer (SwiftShader, WARP's "Microsoft Basic
 * Render Driver"), the Vulkan rungs as on Linux, D3D11 (d3d11on12 included:
 * the string alone tells them apart, the rescue does not), OpenGL over WGL,
 * or 'unknown'. Real strings the test pins.
 */
function judgeWindowsGpuBackendLaunch({
  glRenderer,
  softwareRendering,
  parallel,
  parallelCompile,
}) {
  if (softwareRendering === true) return 'software';
  if (typeof glRenderer !== 'string' || glRenderer === '') return 'unknown';
  const renderer = glRenderer.toLowerCase();
  if (renderer.includes('swiftshader') || renderer.includes('basic render driver')) {
    return 'software';
  }
  if (renderer.includes('vulkan')) {
    if (parallel !== true) return 'vulkan-plain';
    return parallelCompile === false ? 'vulkan-plain' : 'vulkan-parallel-compile';
  }
  if (renderer.includes('direct3d11') || renderer.includes('d3d11')) return 'd3d11';
  if (renderer.includes('opengl')) return 'opengl';
  return 'unknown';
}

/**
 * Whether the backend a launch asked for failed to come up, by FAMILY as on
 * Linux: a Vulkan rung that bound anything but Vulkan, an OpenGL rung that
 * bound anything but OpenGL, a D3D11 rung that bound software. Unknown
 * evidence is not a failure.
 */
function windowsBackendDidNotBind(askedRung, boundRung) {
  if (!WINDOWS_GPU_BACKEND_RUNGS.includes(askedRung)) return false;
  if (boundRung === 'unknown' || typeof boundRung !== 'string') return false;
  if (askedRung.startsWith('vulkan')) return !boundRung.startsWith('vulkan');
  if (askedRung === 'opengl') return boundRung !== 'opengl';
  return boundRung === 'software';
}

module.exports = {
  WINDOWS_GPU_BACKEND_RUNGS,
  decideWindowsGpuBackendLaunch,
  judgeWindowsGpuBackendLaunch,
  launchForWindowsRung,
  windowsBackendDidNotBind,
  windowsRungBelow,
};
