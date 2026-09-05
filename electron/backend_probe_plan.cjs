'use strict';

// The GPU backend probe's plan, pure: which arms a round launches and in what
// order, the Chromium switches each arm carries, the environment and argv a
// child starts with, where a run's directories and result files live, the
// exit-code taxonomy a child reports and how the parent reads an exit. The
// orchestrator (electron/backend_probe_parent.cjs) and the child mode
// (electron/backend_probe_child.cjs) are thin over this; main.cjs only asks
// whether this process is a child. Design: docs/desktop-release.md ("GPU backend on Windows: the probe") in the
// maintainer's checkout ("Form", "Child process lifecycle").
//
// Pure functions with injected inputs, exercised by
// tests/electron_backend_probe_plan.test.ts.

const nodePath = require('node:path');
const {
  GPU_BACKEND_RESCUE_ENV,
  VULKAN_BACKEND_SWITCHES,
  VULKAN_PARALLEL_COMPILE_SWITCH,
} = require('./gpu_backend.cjs');
const { PRIME_RELAUNCH_ADDED_ENV, PRIME_RELAUNCH_MARKER } = require('./gpu_preference.cjs');

/** The rungs the probe measures, sharing the Linux ladder's literals. */
const PROBE_ARMS = ['d3d11', 'vulkan-parallel-compile', 'vulkan-plain', 'opengl'];

/** The command-line flag that starts the parent. */
const TEST_BACKENDS_FLAG = '--test-backends';

/** The child's environment: its presence is the child mode. */
const PROBE_CHILD_ENV = 'WOC_BACKEND_PROBE';
const PROBE_ARM_ENV = 'WOC_BACKEND_PROBE_ARM';
const PROBE_RUN_ENV = 'WOC_BACKEND_PROBE_RUN';
const PROBE_ROUND_ENV = 'WOC_BACKEND_PROBE_ROUND';
const PROBE_RESULT_ENV = 'WOC_BACKEND_PROBE_RESULT';
const PROBE_PROFILE_ENV = 'WOC_BACKEND_PROBE_PROFILE';
const PROBE_LOCALE_ENV = 'WOC_BACKEND_PROBE_LOCALE';
const PROBE_TIER_ENV = 'WOC_BACKEND_PROBE_TIER';
const PROBE_GPU_FORCE_OPT_OUT_ENV = 'WOC_BACKEND_PROBE_GPU_FORCE_OPT_OUT';
const PROBE_PARENT_PID_ENV = 'WOC_BACKEND_PROBE_PARENT_PID';

/** The graphics tiers a child may be asked to measure on (the `?gfx=` grammar). */
const PROBE_TIERS = Object.freeze(['low', 'medium', 'high', 'ultra', 'insane']);
/** A locale tag as the game spells them (`fr`, `zh_CN`, `en-CA`). */
const LOCALE_PATTERN = /^[a-z]{2,3}(?:[_-][A-Za-z]{2,4})?$/;

/** Exit codes a child reports; anything else is "unknown" to the parent. */
const PROBE_EXIT = Object.freeze({
  completed: 0,
  died: 10,
  didNotBind: 11,
  capped: 12,
  orphaned: 13,
  rendererGone: 14,
  probeError: 15,
  busy: 16,
});

/** The Chromium switches an arm runs, as [name, value] pairs. The D3D11 arm is
 *  pinned explicitly (the platform default can resolve to d3d11on12 or WARP);
 *  the Vulkan arms are exactly the shell's shipped switch sets. */
function switchesForArm(arm) {
  switch (arm) {
    case 'd3d11':
      return [
        ['use-gl', 'angle'],
        ['use-angle', 'd3d11'],
      ];
    case 'vulkan-parallel-compile':
      return [...VULKAN_BACKEND_SWITCHES, VULKAN_PARALLEL_COMPILE_SWITCH];
    case 'vulkan-plain':
      return [...VULKAN_BACKEND_SWITCHES];
    case 'opengl':
      return [
        ['use-gl', 'angle'],
        ['use-angle', 'gl'],
      ];
    default:
      return [];
  }
}

/**
 * The arms of a round, in launch order. Round one runs D3D11, the Vulkan
 * parallel-compile arm and OpenGL; `plainVulkan` (the adaptive fourth arm,
 * once the parallel arm died or a stored verdict names it) sits right after
 * the parallel arm. Round two reverses the order, so each arm takes another
 * position; an arm that died in round one is in round two like any other.
 */
function armsForRound(round, options = {}) {
  const base = ['d3d11', 'vulkan-parallel-compile'];
  if (options.plainVulkan === true) base.push('vulkan-plain');
  base.push('opengl');
  const arms = options.arm64 === true ? base.filter((arm) => arm !== 'opengl') : base;
  return round >= 2 ? [...arms].reverse() : arms;
}

/** Whether the flag is on an argv (the parent's own, or a second instance's). */
function hasTestBackendsFlag(argv) {
  return Array.isArray(argv) && argv.includes(TEST_BACKENDS_FLAG);
}

/** A child's argv: this process's, minus the flag (a child never re-enters the
 *  probe) and minus Epic's `-AUTH_*` family (an exchange code must not ride
 *  into six processes). */
function childArgvFor(argv) {
  // Also minus a deep link (`worldofclaudecraft://...` carries a single-use
  // login code; no game runs in a child to take it).
  return (argv ?? []).filter(
    (arg) =>
      arg !== TEST_BACKENDS_FLAG && !/^-AUTH_/.test(arg) && !/^worldofclaudecraft:\/\//.test(arg),
  );
}

/** The names a rescue or PRIME relaunch may have planted, which a child must
 *  never inherit (a fresh decision, never a continuation). */
const STRIPPED_ENV = [
  GPU_BACKEND_RESCUE_ENV,
  'WOC_GPU_BACKEND',
  PRIME_RELAUNCH_MARKER,
  PRIME_RELAUNCH_ADDED_ENV,
];

/** The environment one child starts with. */
function childEnvFor(input) {
  const env = { ...input.baseEnv };
  for (const name of STRIPPED_ENV) delete env[name];
  env[PROBE_CHILD_ENV] = '1';
  env[PROBE_ARM_ENV] = input.arm;
  env[PROBE_RUN_ENV] = input.run;
  env[PROBE_ROUND_ENV] = String(input.round);
  env[PROBE_RESULT_ENV] = input.resultPath;
  env[PROBE_PROFILE_ENV] = input.profileDir;
  env[PROBE_LOCALE_ENV] = input.locale;
  env[PROBE_TIER_ENV] = input.tier;
  env[PROBE_GPU_FORCE_OPT_OUT_ENV] = input.gpuForceOptOut ? '1' : '0';
  env[PROBE_PARENT_PID_ENV] = String(input.parentPid);
  return env;
}

/** Whether THIS process is a probe child. */
function isProbeChild(env) {
  return env?.[PROBE_CHILD_ENV] === '1';
}

/** The child's configuration off its environment, or null when a field is
 *  missing or malformed (a child with no plan exits at once). */
function probeChildConfig(env) {
  if (!isProbeChild(env)) return null;
  const arm = env[PROBE_ARM_ENV];
  const round = Number(env[PROBE_ROUND_ENV]);
  const parentPid = Number(env[PROBE_PARENT_PID_ENV]);
  const resultPath = env[PROBE_RESULT_ENV];
  const profileDir = env[PROBE_PROFILE_ENV];
  const run = env[PROBE_RUN_ENV];
  if (!PROBE_ARMS.includes(arm)) return null;
  if (!Number.isInteger(round) || round < 1) return null;
  if (!Number.isInteger(parentPid) || parentPid <= 0) return null;
  if (typeof resultPath !== 'string' || !nodePath.isAbsolute(resultPath)) return null;
  if (typeof profileDir !== 'string' || !nodePath.isAbsolute(profileDir)) return null;
  if (typeof run !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(run)) return null;
  return {
    arm,
    run,
    round,
    parentPid,
    resultPath,
    profileDir,
    // Allowlisted here too, independent of the page's own re-validation.
    locale: LOCALE_PATTERN.test(env[PROBE_LOCALE_ENV] ?? '') ? env[PROBE_LOCALE_ENV] : 'en',
    tier: PROBE_TIERS.includes(env[PROBE_TIER_ENV]) ? env[PROBE_TIER_ENV] : 'ultra',
    gpuForceOptOut: env[PROBE_GPU_FORCE_OPT_OUT_ENV] === '1',
  };
}

/** A run's directory under the parent's userData, and a child's profile and
 *  result inside it. The parent creates them before the spawn: app.setPath
 *  throws on a directory that does not exist. */
function runDirectoryFor(userData, run) {
  return nodePath.join(userData, 'backend-probe', run);
}

function profileDirFor(runDir, arm, round) {
  return nodePath.join(runDir, `${arm}-r${round}`);
}

function resultPathFor(runDir, arm, round) {
  return nodePath.join(runDir, `${arm}-r${round}.json`);
}

/** A run id: the launch time in base 36 plus a few random characters, only
 *  characters a directory name and a URL query take. */
function newRunId(now = Date.now(), random = Math.random) {
  return `${now.toString(36)}-${Math.floor(random() * 0x100000).toString(36)}`;
}

/**
 * What a child's exit means to the parent. Only "died" and "did not bind"
 * speak about the backend; every other outcome makes the run inconclusive
 * and keeps the child's directory.
 */
function classifyChildExit({ code, signal, killedByParent }) {
  if (killedByParent === true) return 'hung';
  if (signal) return 'unknown';
  switch (code) {
    case PROBE_EXIT.completed:
      return 'completed';
    case PROBE_EXIT.died:
      return 'died';
    case PROBE_EXIT.didNotBind:
      return 'did-not-bind';
    case PROBE_EXIT.capped:
      return 'capped';
    case PROBE_EXIT.orphaned:
      return 'orphaned';
    case PROBE_EXIT.rendererGone:
      return 'renderer-gone';
    case PROBE_EXIT.probeError:
      return 'probe-error';
    case PROBE_EXIT.busy:
      return 'busy';
    default:
      return 'unknown';
  }
}

/** Outcomes that speak about the backend (the arm may be disqualified on them). */
const BACKEND_OUTCOMES = Object.freeze(['died', 'did-not-bind', 'capped']);

/**
 * Whether this machine is ARM64: the process's own architecture, or, for an
 * x64 build running under emulation (the Steam and Epic depots are x64 and
 * `process.arch` then reads x64), the WOW64 environment Windows sets. On
 * ARM64 the OpenGL arm has no desktop ICD and the decision runs on the
 * relative rules alone.
 */
function machineIsArm64({ arch, env }) {
  if (arch === 'arm64') return true;
  const wow = env?.PROCESSOR_ARCHITEW6432;
  const native = env?.PROCESSOR_ARCHITECTURE;
  return wow === 'ARM64' || (wow === undefined && native === 'ARM64');
}

/** Outcomes that keep the child's directory as support evidence. */
function keepsDirectory(outcome) {
  return outcome !== 'completed';
}

module.exports = {
  BACKEND_OUTCOMES,
  PROBE_ARMS,
  PROBE_ARM_ENV,
  PROBE_CHILD_ENV,
  PROBE_EXIT,
  PROBE_GPU_FORCE_OPT_OUT_ENV,
  PROBE_LOCALE_ENV,
  PROBE_PARENT_PID_ENV,
  PROBE_PROFILE_ENV,
  PROBE_RESULT_ENV,
  PROBE_ROUND_ENV,
  PROBE_RUN_ENV,
  PROBE_TIERS,
  PROBE_TIER_ENV,
  LOCALE_PATTERN,
  TEST_BACKENDS_FLAG,
  armsForRound,
  childArgvFor,
  childEnvFor,
  classifyChildExit,
  hasTestBackendsFlag,
  isProbeChild,
  keepsDirectory,
  machineIsArm64,
  newRunId,
  probeChildConfig,
  profileDirFor,
  resultPathFor,
  runDirectoryFor,
  switchesForArm,
};
