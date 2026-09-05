export const ENDED: readonly string[];
export const MAX_RESULT_BYTES: number;
export const PROBE_VERSION: number;
export function acceptProbeResult<T>(
  value: T,
  options?: { run?: string; round?: number; maxBytes?: number },
): T | null;
export function exitCodeForEnded(
  ended: string,
  codes: {
    completed: number;
    didNotBind: number;
    busy: number;
    capped: number;
    probeError: number;
  },
): number;
export function isTerminalEnded(ended: unknown): boolean;
