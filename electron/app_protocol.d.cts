// Type declarations for the app:// protocol handler (electron/app_protocol.cjs);
// main.cjs and the probe's child mode run outside tsc, these serve the tests.

export function fileInside(root: string, target: string): boolean;
export function registerAppProtocol(options: { apiOrigin: string; distDir?: string }): void;
