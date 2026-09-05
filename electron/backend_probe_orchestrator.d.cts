export const HANG_FLOOR_MS: number;
export const HANG_GAP_MULTIPLIER: number;
export const INCONCLUSIVE_OUTCOMES: readonly string[];
export const LIVENESS_POLL_MS: number;

export interface LivenessTracker {
  progress(atMs: number): void;
  deadlineMs(): number;
  hung(nowMs: number): boolean;
  lastProgressMs(): number;
}
export function createLivenessTracker(startMs: number): LivenessTracker;

export interface OrchestratorFs {
  mkdir(dir: string): void;
  rm(dir: string): void;
  fileMtimeMs(path: string): number | null;
  readResultFile(path: string): unknown;
}
export interface OrchestratorTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}
export interface SpawnedChild {
  pid?: number | null;
  kill(): void;
}
export interface ChildExit {
  code: number | null;
  signal: string | null;
  error?: unknown;
}
export interface ArmOutcome {
  arm: string;
  round: number;
  outcome: string;
  code: number | null;
  signal: string | null;
  result: unknown;
  adapter: string;
  driverVersion: string;
  /** The child's power state at its first frame; null when unknown. */
  onBattery: boolean | null;
  profileDir: string;
  resultPath: string;
  keepDirectory: boolean;
}
export interface OrchestratorContext {
  run: string;
  runDir: string;
  baseEnv: Record<string, string | undefined>;
  argv: string[];
  locale: string;
  tier: string;
  gpuForceOptOut: boolean;
  parentPid: number;
  arm64?: boolean;
  fs: OrchestratorFs;
  timers: OrchestratorTimers;
  now(): number;
  spawn(input: {
    env: Record<string, string | undefined>;
    argv: string[];
    onExit: (exit: ChildExit) => void;
  }): SpawnedChild;
  log?: { info?: (...args: unknown[]) => void; warn?: (...args: unknown[]) => void };
  onArmStart?(start: { arm: string; round: number; index: number; total: number }): void;
  onArmEnd?(outcome: ArmOutcome): void;
}
export interface RoundOutcome {
  round: number;
  arms: string[];
  outcomes: ArmOutcome[];
  plainVulkan: boolean;
}
export interface ArmInputRecord {
  rung: string;
  results: unknown[];
  roundsLaunched: number;
  roundsDied: number;
  adapter: string;
  /** One reading per round that reported one. */
  onBattery: boolean[];
  outcomes: string[];
}
export function launchArm(
  ctx: OrchestratorContext,
  arm: string,
  round: number,
): Promise<ArmOutcome>;
export function runRound(
  ctx: OrchestratorContext,
  round: number,
  options?: { plainVulkan?: boolean },
): Promise<RoundOutcome>;
export function armInputs(rounds: readonly RoundOutcome[]): ArmInputRecord[];
export function secondRoundTriggers(
  round1: RoundOutcome,
  decision: { secondRoundTriggers?: string[]; reference?: string | null } | null | undefined,
): string[];
export function inconclusiveOutcomes(rounds: readonly RoundOutcome[]): string[];
export function cleanupRun(ctx: OrchestratorContext, rounds: readonly RoundOutcome[]): void;
