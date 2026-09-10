'use strict';

// The GPU backend probe's PARENT: the process `--test-backends` starts. It
// owns the consent, progress and verdict window (one BrowserWindow on the
// probe page, never the game's createMainWindow), runs the rounds through the
// orchestrator core (electron/backend_probe_orchestrator.cjs) with the real
// spawn, filesystem and timers, has the page decide (the decision core is
// TypeScript in src/probe/, so the verdict view runs it and posts the
// decision back), writes the verdict into the prefs
// (electron/backend_probe_verdict.cjs), and answers the verdict view's
// buttons. main.cjs constructs it with the shell's own facts and calls
// `start()` at ready; everything Electron-specific is injected so the
// startup test can dry-run it. Design: docs/desktop-release.md ("GPU backend on Windows: the probe"), "Form",
// "Child process lifecycle", "IPC surface".

const fs = require('node:fs');
const path = require('node:path');
const {
  armInputs,
  cleanupRun,
  inconclusiveOutcomes,
  runRound,
  secondRoundTriggers,
} = require('./backend_probe_orchestrator.cjs');
const {
  LOCALE_PATTERN,
  PROBE_ARMS,
  PROBE_TIERS,
  childArgvFor,
  newRunId,
  runDirectoryFor,
} = require('./backend_probe_plan.cjs');
const { PROBE_VERSION } = require('./backend_probe_result.cjs');
const { verdictFromDecision } = require('./backend_probe_verdict.cjs');
const { spawnWaitingSelf } = require('./gpu_preference.cjs');
const { restartEnv } = require('./launch_settings.cjs');

const PARENT_WINDOW_WIDTH = 720;
const PARENT_WINDOW_HEIGHT = 480;
/** How long the decide view may take to post: a page that never answers is
 *  a defect of the build, not a slow machine (the decision is arithmetic). */
const DECISION_DEADLINE_MS = 60_000;
const CHILD_LOG_TAIL_BYTES = 4096;

/** Whether this process may run the probe at all, or the reason it may not. */
function probeIneligibility({ platform, isPackaged, devServerUrl, env }) {
  // The developer bypass exists for an UNPACKAGED checkout only (the Linux dry
  // run); a shipped build never honours it, like the other env hatches
  // electron/desktop_config.cjs closes on isPackaged.
  if (env?.WOC_BACKEND_PROBE_FORCE === '1' && isPackaged !== true) return null;
  if (platform !== 'win32') return 'the backend probe measures Windows backends only';
  if (typeof devServerUrl === 'string' && devServerUrl !== '') {
    return 'the backend probe does not run under the dev server';
  }
  if (isPackaged !== true) return 'the backend probe runs in packaged builds only';
  return null;
}

/** The consent view's START payload, validated, or null. */
function startPayload(value) {
  if (!value || typeof value !== 'object') return null;
  const locale =
    typeof value.locale === 'string' && LOCALE_PATTERN.test(value.locale) ? value.locale : 'en';
  const tier = PROBE_TIERS.includes(value.tier) ? value.tier : 'ultra';
  return { locale, tier };
}

/** The decision the verdict view posts, validated to the envelope the parent
 *  reads; the arms' figures stay the page's own. */
function acceptDecision(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const backend =
    value.backend === null || PROBE_ARMS.includes(value.backend) ? value.backend : undefined;
  if (backend === undefined) return null;
  const triggers = Array.isArray(value.secondRoundTriggers)
    ? value.secondRoundTriggers.filter((t) => typeof t === 'string').map((t) => t.slice(0, 200))
    : [];
  return {
    backend,
    backendClass: typeof value.backendClass === 'string' ? value.backendClass : 'unknown',
    worker: value.worker === true,
    secondRoundTriggers: triggers,
    inconclusive: typeof value.inconclusive === 'string' ? value.inconclusive.slice(0, 500) : null,
    figures:
      value.figures && typeof value.figures === 'object' && !Array.isArray(value.figures)
        ? value.figures
        : undefined,
  };
}

function probePageUrl(base, view, params = {}) {
  const query = new URLSearchParams({ view, ...params });
  return `${base}/backend-probe.html?${query.toString()}`;
}

/** A child's result file lives in a user-writable directory: refuse an
 *  oversized one BEFORE parsing it (the envelope's own cap applies after). */
const MAX_RESULT_FILE_BYTES = 4 * 1024 * 1024;

function readJsonFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_RESULT_FILE_BYTES) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileMtimeMs(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/** The last bytes of a child's own log, for the parent's main.log. */
function childLogTail(profileDir) {
  const logPath = path.join(profileDir, 'logs', 'main.log');
  try {
    const size = fs.statSync(logPath).size;
    const fd = fs.openSync(logPath, 'r');
    try {
      const length = Math.min(size, CHILD_LOG_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, size - length);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

/**
 * Build the parent. `deps`:
 *   app, BrowserWindow, ipcMain, log, trustedSender, appOrigin, devServerUrl,
 *   preloadPath, iconPath, argv, env, desktopPrefs, savePrefs(next) -> bool,
 *   corpusHash, distribution, gpuForceOptOut, arm64, restartIntoGame() -> Promise<bool>
 */
function createBackendProbeParent(deps) {
  const { app, BrowserWindow, ipcMain, log } = deps;
  const base = deps.devServerUrl ?? deps.appOrigin;
  let win = null;
  let phase = 'consent';
  let armInFlight = false;
  let secondInstanceQueued = false;
  let run = null;
  let pendingDecision = null;
  // Where the run is, for the line the between-arms window shows.
  let armIndex = 0;
  let armTotal = 0;

  const show = () => {
    if (!win || win.isDestroyed()) return;
    if (!win.isVisible()) win.show();
    // Full screen like the children, so the run never cuts between a full
    // screen measurement and a small window on the desktop. The mode change
    // waits for a shown window, never a construction-time flag (a Vulkan
    // swapchain has died on a window that changed mode before its first frame).
    if (!win.isFullScreen()) win.setFullScreen(true);
    win.focus();
  };
  const hide = () => {
    if (win && !win.isDestroyed() && win.isVisible()) win.hide();
  };
  const navigate = (view, params) => {
    if (!win || win.isDestroyed()) return;
    void win.loadURL(probePageUrl(base, view, params));
  };

  function createWindow() {
    win = new BrowserWindow({
      width: PARENT_WINDOW_WIDTH,
      height: PARENT_WINDOW_HEIGHT,
      resizable: false,
      title: 'World of ClaudeCraft',
      backgroundColor: '#05070a',
      show: false,
      icon: deps.iconPath,
      webPreferences: {
        preload: deps.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: false,
        spellcheck: false,
        webviewTag: false,
        disableBlinkFeatures: 'Autofill',
      },
    });
    win.once('ready-to-show', () => show());
    // Development only (behind the same force as the eligibility bypass): a
    // dry run on a machine nobody clicks on starts without the consent.
    if (
      app.isPackaged !== true &&
      deps.env?.WOC_BACKEND_PROBE_FORCE === '1' &&
      deps.env?.WOC_BACKEND_PROBE_AUTOSTART === '1'
    ) {
      win.webContents.once('did-finish-load', () => {
        if (phase === 'consent') void runProbe('en', 'ultra');
      });
    }
    win.on('closed', () => {
      win = null;
      // Closing the window mid-run abandons it: the child in flight loses its
      // stdin when this process leaves and exits orphaned.
      if (phase !== 'verdict') log.info('[probe] window closed; leaving');
      app.quit();
    });
    navigate('consent');
  }

  function progress(payload) {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('desktop-probe-progress', payload);
  }

  function orchestratorContext(runId, runDir, locale, tier) {
    return {
      run: runId,
      runDir,
      baseEnv: restartEnv(deps.env),
      argv: deps.argv,
      locale,
      tier,
      gpuForceOptOut: deps.gpuForceOptOut === true,
      parentPid: process.pid,
      arm64: deps.arm64 === true,
      // The orchestrator's world, the real one unless the test injects its own
      // (`deps.orchestrator`): the filesystem, the timers, the clock, the spawn.
      fs: deps.orchestrator?.fs ?? {
        mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
        rm: (dir) => fs.rmSync(dir, { recursive: true, force: true }),
        fileMtimeMs,
        readResultFile: readJsonFile,
      },
      timers: deps.orchestrator?.timers ?? { setInterval, clearInterval },
      now: deps.orchestrator?.now ?? (() => Date.now()),
      spawn:
        deps.orchestrator?.spawn ??
        (({ env, argv, onExit }) =>
          spawnWaitingSelf({ env, argv, execPath: process.execPath, onExit })),
      log,
      onArmStart: ({ arm, round, index, total }) => {
        armInFlight = true;
        armIndex = index;
        armTotal = total;
        hide();
        progress({ phase: 'arm', arm, round, index, total });
      },
      onArmEnd: (outcome) => {
        armInFlight = false;
        const tail = childLogTail(outcome.profileDir);
        if (tail !== '')
          log.info(`[probe] child log tail (${outcome.arm} r${outcome.round}):\n${tail}`);
        progress({
          phase: 'between',
          arm: outcome.arm,
          round: outcome.round,
          outcome: outcome.outcome,
          index: armIndex,
          total: armTotal,
        });
        // Nothing is measuring between two arms, so the window that says where
        // the run is comes back rather than leaving the player on an empty
        // screen wondering whether it crashed. It hides again at the next arm.
        show();
        secondInstanceQueued = false;
      },
    };
  }

  /** Have the verdict view decide over the rounds so far; resolves with the
   *  validated decision, or null when the page never answered. */
  function decideInPage(round) {
    phase = 'deciding';
    progress({ phase: 'deciding', round });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (pendingDecision?.resolve === resolve) {
          pendingDecision = null;
          log.error('[probe] the decide view never answered');
          resolve(null);
        }
      }, DECISION_DEADLINE_MS);
      pendingDecision = {
        round,
        resolve: (decision) => {
          clearTimeout(timer);
          resolve(decision);
        },
      };
      navigate('verdict', { run: run.id, round: String(round), phase: 'decide' });
    });
  }

  async function runProbe(locale, tier) {
    const runId = newRunId();
    const runDir = runDirectoryFor(app.getPath('userData'), runId);
    // The previous runs' directories, best-effort: a kept directory survives
    // until the next run starts.
    const world = deps.orchestrator?.fs;
    try {
      if (world) world.rm(path.dirname(runDir));
      else fs.rmSync(path.dirname(runDir), { recursive: true, force: true });
    } catch (err) {
      log.warn('[probe] could not remove the previous runs', err?.message ?? err);
    }
    if (world) world.mkdir(runDir);
    else fs.mkdirSync(runDir, { recursive: true });
    run = { id: runId, dir: runDir, locale, tier, rounds: [], decision: null, final: null };
    phase = 'running';
    log.info(`[probe] run ${runId} starting`, { locale, tier, arm64: deps.arm64 === true });
    navigate('progress');
    const ctx = orchestratorContext(runId, runDir, locale, tier);
    const storedRung = deps.desktopPrefs?.backendProbeVerdict?.rung ?? null;
    const round1 = await runRound(ctx, 1, { plainVulkan: storedRung === 'vulkan-plain' });
    run.rounds.push(round1);
    let decision = await decideInPage(1);
    const triggers = secondRoundTriggers(round1, decision);
    if (triggers.length > 0) {
      log.info('[probe] second round', { triggers });
      const round2 = await runRound(ctx, 2, { plainVulkan: round1.plainVulkan });
      run.rounds.push(round2);
      decision = await decideInPage(2);
    }
    finalize(decision);
  }

  function finalize(decision) {
    phase = 'verdict';
    const inconclusive = inconclusiveOutcomes(run.rounds);
    let written = false;
    let inconclusiveWhy = decision?.inconclusive ?? null;
    if (!decision) inconclusiveWhy = 'no decision';
    else if (inconclusive.length > 0) inconclusiveWhy = inconclusive.join('; ');
    if (decision && inconclusiveWhy === null && decision.backend !== null) {
      const inputs = armInputs(run.rounds);
      const winner = inputs.find((input) => input.rung === decision.backend);
      const winnerOutcome = run.rounds
        .flatMap((round) => round.outcomes)
        .find((outcome) => outcome.arm === decision.backend && outcome.result);
      // The corpus the winning arm MEASURED on, off its own result: that is
      // the hash the next launch compares the shipped stamp against (an
      // unstamped build compares nothing, backend_probe_verdict.cjs).
      const measuredCorpus = winnerOutcome?.result?.corpusHash;
      const verdict = verdictFromDecision(decision, {
        adapter: winner?.adapter ?? '',
        driverVersion: winnerOutcome?.driverVersion ?? '',
        chromeVersion: deps.chromeVersion ?? process.versions.chrome ?? '',
        probeVersion: PROBE_VERSION,
        corpusHash:
          typeof measuredCorpus === 'string' && measuredCorpus !== ''
            ? measuredCorpus
            : deps.corpusHash,
        appVersion: app.getVersion(),
        recordedAt: new Date().toISOString(),
        distribution: deps.distribution ?? '',
      });
      if (verdict) {
        written = deps.savePrefs({ ...deps.desktopPrefs, backendProbeVerdict: verdict });
        if (written) deps.desktopPrefs.backendProbeVerdict = verdict;
        else log.warn('[probe] could not persist the verdict');
      } else {
        log.warn('[probe] the decision did not make a storable verdict', {
          backendClass: decision.backendClass,
          corpusHash: measuredCorpus ?? deps.corpusHash,
        });
      }
    }
    run.final = {
      decision,
      written,
      inconclusive: inconclusiveWhy,
      explicitSetting: deps.desktopPrefs?.gpuBackend !== 'auto',
    };
    log.info('[probe] verdict', {
      backend: decision?.backend ?? null,
      worker: decision?.worker ?? false,
      inconclusive: inconclusiveWhy,
      written,
    });
    cleanupRun(orchestratorContext(run.id, run.dir, run.locale, run.tier), run.rounds);
    // A fresh load of the verdict view: it reads the final answer above.
    navigate('verdict', { run: run.id, round: String(run.rounds.length) });
    show();
  }

  function registerHandlers() {
    ipcMain.handle('desktop-probe-start', (event, value) => {
      if (!deps.trustedSender(event)) return false;
      if (phase !== 'consent' && phase !== 'verdict') return false;
      const payload = startPayload(value);
      if (!payload) return false;
      runProbe(payload.locale, payload.tier).catch((err) => {
        log.error('[probe] run failed', err);
        phase = 'verdict';
        run = run ?? { rounds: [] };
        run.final = {
          decision: null,
          written: false,
          inconclusive: 'probe error',
          explicitSetting: false,
        };
        show();
      });
      return true;
    });
    ipcMain.handle('desktop-probe-results', (event) => {
      if (!deps.trustedSender(event)) return null;
      if (!run) return null;
      if (phase === 'deciding') {
        return {
          phase: 'decide',
          round: pendingDecision?.round ?? run.rounds.length,
          arms: armInputs(run.rounds),
          storedVerdictRung: deps.desktopPrefs?.backendProbeVerdict?.rung ?? null,
          arm64: deps.arm64 === true,
        };
      }
      if (phase === 'verdict' && run.final) {
        return {
          phase: 'final',
          round: run.rounds.length,
          decision: run.final.decision,
          written: run.final.written,
          inconclusive: run.final.inconclusive,
          explicitSetting: deps.desktopPrefs?.gpuBackend !== 'auto',
        };
      }
      return null;
    });
    ipcMain.handle('desktop-probe-verdict', (event, value) => {
      if (!deps.trustedSender(event)) return false;
      if (phase !== 'deciding' || !pendingDecision) return false;
      const decision = acceptDecision(value);
      if (!decision) return false;
      const pending = pendingDecision;
      pendingDecision = null;
      pending.resolve(decision);
      return true;
    });
    ipcMain.handle('desktop-probe-action', (event, action) => {
      if (!deps.trustedSender(event)) return false;
      switch (action) {
        case 'cancel':
          app.quit();
          return true;
        case 'play':
          if (phase !== 'verdict') return false;
          return deps.restartIntoGame();
        case 'rerun': {
          if (phase !== 'verdict' || !run) return false;
          runProbe(run.locale, run.tier).catch((err) => log.error('[probe] re-run failed', err));
          return true;
        }
        case 'auto': {
          if (phase !== 'verdict') return false;
          if (deps.desktopPrefs.gpuBackend === 'auto') return true;
          if (!deps.savePrefs({ ...deps.desktopPrefs, gpuBackend: 'auto' })) return false;
          deps.desktopPrefs.gpuBackend = 'auto';
          if (run?.final) run.final.explicitSetting = false;
          return true;
        }
        default:
          return false;
      }
    });
  }

  return {
    start() {
      registerHandlers();
      createWindow();
    },
    /** A second launch while the probe runs: never the game, never a window
     *  mid-arm (it would blur the child); between arms the window comes up. */
    onSecondInstance() {
      if (phase === 'running' && armInFlight) {
        secondInstanceQueued = true;
        return;
      }
      show();
    },
    /** The verdict window's own restart into the game: this process's argv
     *  minus the flag (and Epic's auth family). */
    gameArgv: () => childArgvFor(deps.argv),
  };
}

module.exports = {
  DECISION_DEADLINE_MS,
  PROBE_TIERS,
  acceptDecision,
  createBackendProbeParent,
  probeIneligibility,
  probePageUrl,
  startPayload,
};
