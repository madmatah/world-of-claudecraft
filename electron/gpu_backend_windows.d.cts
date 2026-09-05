import type { BackendProbeVerdict } from './backend_probe_verdict.cjs';

export const WINDOWS_GPU_BACKEND_RUNGS: readonly string[];

export interface WindowsGpuBackendLaunch {
  backend: 'vulkan' | 'default';
  parallel: boolean;
  rung: string;
  reprobed: false;
  capped: false;
  reason: string;
  ladder: boolean;
  auto: false;
  rescued: boolean;
  fromVerdict: boolean;
  switches: [string, string][];
}
export function windowsRungBelow(rung: string): string | null;
export function launchForWindowsRung(
  rung: string,
  reason: string,
  flags?: {
    ladder?: boolean;
    rescued?: boolean;
    fromVerdict?: boolean;
    switches?: [string, string][];
  },
): WindowsGpuBackendLaunch;
export function decideWindowsGpuBackendLaunch(input: {
  env: Record<string, string | undefined> | undefined;
  prefs: { gpuBackend?: string; backendProbeVerdict?: BackendProbeVerdict } | undefined;
  chromeVersion: string;
  probeVersion: number;
  corpusHash: string;
}): WindowsGpuBackendLaunch;
export function judgeWindowsGpuBackendLaunch(input: {
  glRenderer?: string;
  softwareRendering?: boolean;
  parallel?: boolean;
  parallelCompile?: boolean;
}): string;
export function windowsBackendDidNotBind(askedRung: string, boundRung: string): boolean;
