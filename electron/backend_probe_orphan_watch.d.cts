export const PARENT_POLL_MS: number;
export function stdinIsRealPipe(
  fstat: (fd: number) => {
    isFIFO(): boolean;
    isSocket(): boolean;
  },
): boolean;
export function armOrphanWatch(deps: {
  stdin: { resume(): void; on(event: string, listener: () => void): unknown } | null;
  fstat: (fd: number) => { isFIFO(): boolean; isSocket(): boolean };
  parentPid: number | null;
  kill: (pid: number, signal: number) => void;
  setInterval: (fn: () => void, ms: number) => { unref?: () => void } | number;
  log?: { info?: (message: string) => void; warn?: (message: string) => void };
  onOrphan: () => void;
}): 'stdin' | 'parent-pid' | 'none';
