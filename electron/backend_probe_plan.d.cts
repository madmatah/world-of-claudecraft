// Type declarations for the GPU backend probe's plan (electron/backend_probe_plan.cjs);
// main.cjs and the probe's parent and child modules run outside tsc, these serve
// tests/electron_backend_probe_plan.test.ts.

export type ProbeArm = 'd3d11' | 'vulkan-parallel-compile' | 'vulkan-plain' | 'opengl';

export type ProbeChildOutcome =
  | 'completed'
  | 'died'
  | 'did-not-bind'
  | 'capped'
  | 'orphaned'
  | 'renderer-gone'
  | 'probe-error'
  | 'busy'
  | 'hung'
  | 'unknown';

export interface ProbeChildConfig {
  arm: ProbeArm;
  run: string;
  round: number;
  parentPid: number;
  resultPath: string;
  profileDir: string;
  locale: string;
  tier: string;
  gpuForceOptOut: boolean;
}

export const BACKEND_OUTCOMES: readonly ProbeChildOutcome[];
export const PROBE_ARMS: readonly ProbeArm[];
export const PROBE_ARM_ENV: string;
export const PROBE_CHILD_ENV: string;
export const PROBE_EXIT: Readonly<{
  completed: number;
  died: number;
  didNotBind: number;
  capped: number;
  orphaned: number;
  rendererGone: number;
  probeError: number;
  busy: number;
}>;
export const PROBE_GPU_FORCE_OPT_OUT_ENV: string;
export const PROBE_LOCALE_ENV: string;
export const PROBE_PARENT_PID_ENV: string;
export const PROBE_PROFILE_ENV: string;
export const PROBE_RESULT_ENV: string;
export const PROBE_ROUND_ENV: string;
export const PROBE_RUN_ENV: string;
export const PROBE_TIER_ENV: string;
export const TEST_BACKENDS_FLAG: string;

export function armsForRound(
  round: number,
  options?: { plainVulkan?: boolean; arm64?: boolean },
): ProbeArm[];
export function childArgvFor(argv: readonly string[] | undefined): string[];
export function childEnvFor(input: {
  baseEnv: Record<string, string | undefined>;
  arm: ProbeArm;
  run: string;
  round: number;
  resultPath: string;
  profileDir: string;
  locale: string;
  tier: string;
  gpuForceOptOut: boolean;
  parentPid: number;
}): Record<string, string | undefined>;
export function classifyChildExit(input: {
  code: number | null;
  signal: string | null;
  killedByParent?: boolean;
}): ProbeChildOutcome;
export function hasTestBackendsFlag(argv: readonly string[] | undefined): boolean;
export function isProbeChild(env: Record<string, string | undefined> | undefined): boolean;
export function keepsDirectory(outcome: ProbeChildOutcome): boolean;
export function newRunId(now?: number, random?: () => number): string;
export function probeChildConfig(
  env: Record<string, string | undefined> | undefined,
): ProbeChildConfig | null;
export function profileDirFor(runDir: string, arm: ProbeArm, round: number): string;
export function resultPathFor(runDir: string, arm: ProbeArm, round: number): string;
export function runDirectoryFor(userData: string, run: string): string;
export function switchesForArm(arm: ProbeArm): Array<readonly [string, string]>;
export function machineIsArm64(input: {
  arch: string;
  env?: Record<string, string | undefined>;
}): boolean;
