'use strict';

// The GPU backend probe's VERDICT, the Windows memory: what the probe
// measured and decided, stored in desktop-prefs.json as one validated
// object. Its readers rebuild it field by field (the readGpuBackendProof
// posture of electron/desktop_prefs.cjs) so a hand-edited file can never
// plant a rung or a class the launch does not know. The verdict is a MEMORY
// the rescue supersedes: it goes stale on the same launch-death streak the
// Linux memory uses (never on one death), on a worker-retirement streak
// (worker half only), or when the machine no longer matches; a healthy
// session on its backend clears the death streak. Validity at launch is the
// Chromium version, the probe version and the corpus hash, never the app
// version. Design: docs/desktop-release.md ("GPU backend on Windows: the probe"), "What changes on the shell
// side". Pure; tests/electron_backend_probe_verdict.test.ts.

const { MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES } = require('./gpu_backend.cjs');
const { PROBE_ARMS } = require('./backend_probe_plan.cjs');

/** The backend classes the page reports (src/render/gpu_backend_class_core.ts,
 *  pinned for parity by the test). */
const GPU_BACKEND_CLASSES = ['d3d11', 'vulkan', 'metal', 'opengl', 'software', 'unknown'];

/** How many CONSECUTIVE counted worker sessions retire the worker verdict. */
const WORKER_RETIRE_STREAK_MAX = 3;

const VERDICT_FIELD_MAX = 256;
/** The measured figures are for display and support; capped so the prefs
 *  file stays far under its own size cap. */
const VERDICT_FIGURES_MAX_BYTES = 8 * 1024;

const isCount = (value) => Number.isInteger(value) && value >= 0;
const text = (value) => (typeof value === 'string' ? value.slice(0, VERDICT_FIELD_MAX) : '');

/**
 * A verdict off disk, rebuilt, or null when the rung, the class, the
 * Chromium version, the probe version or the corpus hash is missing: without
 * them the verdict can neither launch nor be checked for validity.
 */
function readBackendProbeVerdict(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (!PROBE_ARMS.includes(value.rung)) return null;
  if (!GPU_BACKEND_CLASSES.includes(value.backend)) return null;
  const chromeVersion = text(value.chromeVersion);
  const corpusHash = text(value.corpusHash);
  if (chromeVersion === '' || corpusHash === '') return null;
  if (!isCount(value.probeVersion) || value.probeVersion < 1) return null;
  const verdict = {
    rung: value.rung,
    backend: value.backend,
    worker: value.worker === true,
    adapter: text(value.adapter),
    driverVersion: text(value.driverVersion),
    chromeVersion,
    probeVersion: value.probeVersion,
    corpusHash,
    appVersion: text(value.appVersion),
    recordedAt: text(value.recordedAt),
    distribution: text(value.distribution),
    stale: value.stale === true,
    deathStreak: isCount(value.deathStreak) ? value.deathStreak : 0,
    workerRetireStreak: isCount(value.workerRetireStreak) ? value.workerRetireStreak : 0,
  };
  const figures = readFigures(value.figures);
  if (figures) verdict.figures = figures;
  return verdict;
}

function readFigures(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  let bytes = 0;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return null;
  }
  if (bytes > VERDICT_FIGURES_MAX_BYTES) return null;
  return JSON.parse(JSON.stringify(value));
}

/**
 * Whether a stored verdict may launch: not stale, and measured under this
 * Chromium, this probe and this corpus. The machine fingerprint is checked
 * after load (app.getGPUInfo resolves then), one launch late by construction.
 */
function verdictValidAtLaunch(verdict, { chromeVersion, probeVersion, corpusHash }) {
  if (!verdict || verdict.stale === true) return false;
  if (typeof chromeVersion !== 'string' || verdict.chromeVersion !== chromeVersion) return false;
  if (!Number.isInteger(probeVersion) || verdict.probeVersion !== probeVersion) return false;
  if (typeof corpusHash !== 'string') return false;
  // An unknown shipped hash (an unstamped build) reads as "the same corpus":
  // the Chromium and probe versions still gate, and a stale corpus only
  // ages the measurement, it cannot launch a backend the machine lacks.
  return corpusHash === '' || verdict.corpusHash === corpusHash;
}

/**
 * Whether the verdict describes THIS machine. An unknown adapter on either
 * side reads as the same machine (getGPUInfo lists no active device on some
 * machines, the Linux memory reads the same way); a driver version is
 * compared only when both are known.
 */
function verdictMatchesMachine(verdict, { adapter, driverVersion }) {
  if (!verdict) return false;
  const known = (value) => typeof value === 'string' && value !== '';
  if (known(adapter) && known(verdict.adapter) && adapter !== verdict.adapter) return false;
  if (
    known(driverVersion) &&
    known(verdict.driverVersion) &&
    driverVersion !== verdict.driverVersion
  ) {
    return false;
  }
  return true;
}

/** The verdict marked stale, or null when it already was. */
function verdictMarkedStale(verdict) {
  if (!verdict || verdict.stale === true) return null;
  return { ...verdict, stale: true };
}

/**
 * After a launch-time GPU-process death on `rung`: one more consecutive
 * death when the rung is the verdict's, stale at the streak. A death on
 * another rung (an explicit choice, a rescued child) says nothing about it.
 * Returns the next verdict, or null when nothing changed.
 */
function verdictAfterLaunchDeath(verdict, rung) {
  if (!verdict || verdict.stale === true || verdict.rung !== rung) return null;
  const deathStreak = verdict.deathStreak + 1;
  if (deathStreak >= MAX_CONSECUTIVE_GPU_LAUNCH_CRASHES) {
    return { ...verdict, deathStreak, stale: true };
  }
  return { ...verdict, deathStreak };
}

/** After a session ran healthy on `rung`: the death streak clears. */
function verdictAfterHealthySession(verdict, rung) {
  if (!verdict || verdict.rung !== rung || verdict.deathStreak === 0) return null;
  return { ...verdict, deathStreak: 0 };
}

/**
 * After a game session reported its worker outcome: a COUNTED session (a
 * lifetime retired for a counting cause) moves the streak, three in a row
 * turn the worker half off and mark the verdict stale so the game offers a
 * re-run; a SETTLED session resets it. Only a verdict with the worker on has
 * anything to learn.
 */
function verdictAfterWorkerSession(verdict, counted) {
  if (!verdict || verdict.worker !== true) return null;
  if (counted !== true) {
    return verdict.workerRetireStreak === 0 ? null : { ...verdict, workerRetireStreak: 0 };
  }
  const workerRetireStreak = verdict.workerRetireStreak + 1;
  if (workerRetireStreak >= WORKER_RETIRE_STREAK_MAX) {
    return { ...verdict, workerRetireStreak, worker: false, stale: true };
  }
  return { ...verdict, workerRetireStreak };
}

/**
 * A fresh verdict from a decision: the parent's facts (versions, hash,
 * fingerprint, date) plus what the decision found. Null when the decision
 * carries no backend.
 */
function verdictFromDecision(decision, facts) {
  if (!decision || !PROBE_ARMS.includes(decision.backend)) return null;
  if (!GPU_BACKEND_CLASSES.includes(decision.backendClass)) return null;
  return readBackendProbeVerdict({
    rung: decision.backend,
    backend: decision.backendClass,
    worker: decision.worker === true,
    adapter: facts.adapter,
    driverVersion: facts.driverVersion,
    chromeVersion: facts.chromeVersion,
    probeVersion: facts.probeVersion,
    corpusHash: facts.corpusHash,
    appVersion: facts.appVersion,
    recordedAt: facts.recordedAt,
    distribution: facts.distribution,
    stale: false,
    deathStreak: 0,
    workerRetireStreak: 0,
    figures: decision.figures,
  });
}

/** The additionalArguments prefix electron/preload.cjs parses (kept literal on both sides). */
const SHADER_WORKER_VERDICT_ARG = '--woc-shader-worker-verdict=';

/**
 * The window arguments that hand the worker decision to the renderer: one
 * entry when THIS launch runs the verdict's backend (the decision chose it,
 * so the measured backend is the one running), none otherwise (a rescued or
 * explicit launch runs another backend, and the verdict must not speak there).
 */
function shaderWorkerVerdictArguments(verdict, launch) {
  if (!verdict || verdict.stale === true || launch?.fromVerdict !== true) return [];
  if (launch.rung !== verdict.rung) return [];
  return [`${SHADER_WORKER_VERDICT_ARG}${verdict.backend}:${verdict.worker ? 'on' : 'off'}`];
}

module.exports = {
  GPU_BACKEND_CLASSES,
  SHADER_WORKER_VERDICT_ARG,
  shaderWorkerVerdictArguments,
  VERDICT_FIELD_MAX,
  VERDICT_FIGURES_MAX_BYTES,
  WORKER_RETIRE_STREAK_MAX,
  readBackendProbeVerdict,
  verdictAfterHealthySession,
  verdictAfterLaunchDeath,
  verdictAfterWorkerSession,
  verdictFromDecision,
  verdictMarkedStale,
  verdictMatchesMachine,
  verdictValidAtLaunch,
};
