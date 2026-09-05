export const DECISION_DEADLINE_MS: number;
export const PROBE_TIERS: readonly string[];

export function probeIneligibility(input: {
  platform: string;
  isPackaged: boolean;
  devServerUrl?: string;
  env?: Record<string, string | undefined>;
}): string | null;
export function startPayload(value: unknown): { locale: string; tier: string } | null;
export interface AcceptedDecision {
  backend: string | null;
  backendClass: string;
  worker: boolean;
  secondRoundTriggers: string[];
  inconclusive: string | null;
  figures?: Record<string, unknown>;
}
export function acceptDecision(value: unknown): AcceptedDecision | null;
export function probePageUrl(base: string, view: string, params?: Record<string, string>): string;

export interface BackendProbeParentDeps {
  app: {
    quit(): void;
    getPath(name: string): string;
    getVersion(): string;
  };
  BrowserWindow: new (options: unknown) => unknown;
  ipcMain: { handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void };
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void; error(...args: unknown[]): void };
  trustedSender(event: unknown): boolean;
  appOrigin: string;
  devServerUrl?: string;
  preloadPath: string;
  iconPath: string;
  argv: string[];
  env: Record<string, string | undefined>;
  desktopPrefs: Record<string, unknown> & { gpuBackend?: string; backendProbeVerdict?: { rung: string } };
  savePrefs(next: unknown): boolean;
  corpusHash: string;
  distribution?: string;
  gpuForceOptOut?: boolean;
  arm64?: boolean;
  restartIntoGame(): Promise<boolean>;
}
export interface BackendProbeParent {
  start(): void;
  onSecondInstance(): void;
  gameArgv(): string[];
}
export function createBackendProbeParent(deps: BackendProbeParentDeps): BackendProbeParent;
