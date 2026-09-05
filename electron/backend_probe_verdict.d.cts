export const GPU_BACKEND_CLASSES: readonly string[];
export const VERDICT_FIELD_MAX: number;
export const VERDICT_FIGURES_MAX_BYTES: number;
export const WORKER_RETIRE_STREAK_MAX: number;

export interface BackendProbeVerdict {
  rung: string;
  backend: string;
  worker: boolean;
  adapter: string;
  driverVersion: string;
  chromeVersion: string;
  probeVersion: number;
  corpusHash: string;
  appVersion: string;
  recordedAt: string;
  distribution: string;
  stale: boolean;
  deathStreak: number;
  workerRetireStreak: number;
  figures?: Record<string, unknown>;
}
export interface VerdictLaunchFacts {
  chromeVersion: string;
  probeVersion: number;
  corpusHash: string;
}
export interface VerdictMachine {
  adapter: string;
  driverVersion: string;
}
export interface VerdictFacts extends VerdictLaunchFacts, VerdictMachine {
  appVersion: string;
  recordedAt: string;
  distribution: string;
}
export function readBackendProbeVerdict(value: unknown): BackendProbeVerdict | null;
export function verdictValidAtLaunch(
  verdict: BackendProbeVerdict | null | undefined,
  facts: VerdictLaunchFacts,
): boolean;
export function verdictMatchesMachine(
  verdict: BackendProbeVerdict | null | undefined,
  machine: VerdictMachine,
): boolean;
export function verdictMarkedStale(
  verdict: BackendProbeVerdict | null | undefined,
): BackendProbeVerdict | null;
export function verdictAfterLaunchDeath(
  verdict: BackendProbeVerdict | null | undefined,
  rung: string,
): BackendProbeVerdict | null;
export function verdictAfterHealthySession(
  verdict: BackendProbeVerdict | null | undefined,
  rung: string,
): BackendProbeVerdict | null;
export function verdictAfterWorkerSession(
  verdict: BackendProbeVerdict | null | undefined,
  counted: boolean,
): BackendProbeVerdict | null;
export function verdictFromDecision(
  decision: {
    backend: string | null;
    backendClass?: string;
    worker?: boolean;
    figures?: Record<string, unknown>;
  } | null,
  facts: VerdictFacts,
): BackendProbeVerdict | null;
export const SHADER_WORKER_VERDICT_ARG: string;
export function shaderWorkerVerdictArguments(
  verdict: BackendProbeVerdict | null | undefined,
  launch: { fromVerdict?: boolean; rung: string } | null | undefined,
): string[];
