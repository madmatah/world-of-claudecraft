// The session's shader warm worker outcome, reported to the desktop shell for
// the GPU backend probe's worker verdict (electron/backend_probe_verdict.cjs
// keeps a retirement streak: three consecutive counted sessions retire the
// worker half and offer a re-run). The unit is the SESSION: it is counted the
// moment any worker lifetime retires for a counting cause (the warm client
// can hold several lifetimes per session: a graphics rebuild retires and
// respawns), and settled at pagehide when none did AND a worker ever ran
// (a session whose worker never spawned says nothing). Each outcome is sent
// once. No-op without the bridge method (older shell, browser).

import { onShaderWarmRetired, shaderWarmSnapshot } from '../render/shader_warm_client';
import { isCountingWorkerRetirement } from '../render/shader_warm_client_core';
import type { DesktopBridge } from '../runtime';

export interface DesktopWorkerSessionDeps {
  /** The pagehide subscription; the page default. */
  onPageHide?: (callback: () => void) => () => void;
  /** Whether a worker has run this session; the warm client's snapshot by default. */
  workerRan?: () => boolean;
}

function defaultOnPageHide(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('pagehide', callback);
  return () => window.removeEventListener('pagehide', callback);
}

function defaultWorkerRan(): boolean {
  const state = shaderWarmSnapshot().worker;
  return state === 'ready' || state === 'dead';
}

export function initDesktopWorkerSession(
  bridge: DesktopBridge | null | undefined,
  deps: DesktopWorkerSessionDeps = {},
): () => void {
  const report = bridge?.reportWorkerSession;
  if (typeof report !== 'function') return () => {};
  const onPageHide = deps.onPageHide ?? defaultOnPageHide;
  const workerRan = deps.workerRan ?? defaultWorkerRan;
  let reported = false;
  const send = (outcome: 'counted' | 'settled'): void => {
    if (reported) return;
    reported = true;
    report.call(bridge, outcome);
  };
  const offRetired = onShaderWarmRetired((reason) => {
    if (isCountingWorkerRetirement(reason)) send('counted');
  });
  const offHide = onPageHide(() => {
    if (workerRan()) send('settled');
  });
  return () => {
    offRetired();
    offHide();
  };
}
