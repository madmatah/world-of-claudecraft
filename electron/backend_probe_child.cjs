'use strict';

// The GPU backend probe's CHILD mode: one process per arm, spawned by the
// parent (electron/backend_probe_parent.cjs) with the plan in its environment
// (electron/backend_probe_plan.cjs). main.cjs hands over to this module
// before its own module scope runs, so nothing below shares the game's
// profile, prefs, memory timers, updater, presence or rescue.
//
// What the child does, in order: its own userData (the parent created it; a
// shared profile is what the single-instance lock exists to prevent), a crash
// reporter that never uploads, its own log, a log-and-exit guard instead of
// the crash dialog, the orphan watch on stdin, the arm's Chromium switches,
// the scheme privileges, then at ready the app protocol, the permission
// lockdown and one 1280x720 window on the probe page. The page posts each
// finished section over one IPC channel; the child rewrites the result file
// atomically each time, pushes the window's state (minimized, hidden, blur)
// to the page for the disturbance taxonomy, ends the arm on a GPU-process
// death, and exits with the code its outcome owes (electron/backend_probe_plan.cjs).
// Design: docs/desktop-release.md ("GPU backend on Windows: the probe"), "Child process lifecycle".

const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  crashReporter,
  ipcMain,
  Menu,
  powerMonitor,
  protocol,
  session,
} = require('electron');
const { registerAppProtocol } = require('./app_protocol.cjs');
const { armOrphanWatch } = require('./backend_probe_orphan_watch.cjs');
const { disturbanceLines } = require('./backend_probe_disturbances.cjs');
const { PROBE_EXIT, probeChildConfig, switchesForArm } = require('./backend_probe_plan.cjs');
const { acceptProbeResult, exitCodeForEnded } = require('./backend_probe_result.cjs');
const { resolveDesktopConfig } = require('./desktop_config.cjs');
const { classifyRendererExit, rendererErrorLogEntry } = require('./diagnostics.cjs');
const { forceHighPerformanceGpu, summarizeGpuDevices } = require('./gpu_preference.cjs');
const { activeGpuAdapterKey } = require('./gpu_backend.cjs');
const { initLogging } = require('./logging.cjs');
const {
  appNavigationOrigins,
  deriveOrigin,
  isTrustedSender,
  lockDownPermissions,
} = require('./shell_guards.cjs');

const APP_ORIGIN = 'app://worldofclaudecraft';
const PRODUCTION_API_ORIGIN = 'https://worldofclaudecraft.com';
const PROBE_WINDOW_WIDTH = 1280;
const PROBE_WINDOW_HEIGHT = 720;

/** The probe page's URL for this child: the packaged app origin, or the dev
 *  server when the parent runs under it. */
function probePageUrl(base, config) {
  const params = new URLSearchParams({
    view: 'probe',
    run: config.run,
    round: String(config.round),
    tier: config.tier,
    lang: config.locale,
    // Under `auto` the game's warm policy turns the worker off on every class
    // but D3D11; the worker section must measure it on EVERY arm.
    shaderwarm: 'all',
  });
  // The page's only global bearing while the parent's window is hidden.
  if (config.armIndex !== null && config.armTotal !== null) {
    params.set('arm', String(config.armIndex + 1));
    params.set('arms', String(config.armTotal));
  }
  return `${base}/backend-probe.html?${params.toString()}`;
}

/** Write the result file atomically: a scratch sibling renamed over the
 *  target, so a reader never sees a torn file. */
function writeResultFile(resultPath, payload) {
  const scratch = `${resultPath}.${process.pid}.tmp`;
  fs.writeFileSync(scratch, JSON.stringify(payload));
  fs.renameSync(scratch, resultPath);
}

/**
 * Run the child. Never returns normally: every path ends in app.exit with a
 * code of the taxonomy. `deps` exist for the startup test's dry run; the
 * live caller (main.cjs) passes nothing.
 */
function runBackendProbeChild(deps = {}) {
  const env = deps.env ?? process.env;
  const config = probeChildConfig(env);
  if (!config) {
    // No plan: nothing to measure and nowhere to write; the parent reads the
    // exit as the probe's own failure.
    app.exit(PROBE_EXIT.probeError);
    return;
  }
  // The profile FIRST: everything else derives from it. The parent created
  // the directory (app.setPath throws on a missing one).
  app.setPath('userData', config.profileDir);
  app.setPath('sessionData', config.profileDir);
  app.setPath('logs', path.join(config.profileDir, 'logs'));
  crashReporter.start({
    productName: 'World of ClaudeCraft',
    globalExtra: { _companyName: 'World of ClaudeCraft' },
    uploadToServer: false,
    compress: true,
    rateLimit: true,
  });
  const { log } = initLogging({ isPackaged: app.isPackaged });
  log.info(`[probe-child] arm ${config.arm} round ${config.round} run ${config.run}`);

  let latest = null;
  let exiting = false;
  // The machine key and driver this arm ran on, latched from the first
  // getGPUInfo reading that names an active adapter (the parent's decision
  // compares arms on it, the verdict fingerprints it).
  let adapter = '';
  let driverVersion = '';
  // The power state at the first frame: arms measured on battery compare
  // only with arms measured on battery (the decision's power-state rule).
  let onBattery = null;
  const envelope = (outcome, code) => ({
    outcome,
    code,
    adapter,
    driverVersion,
    onBattery,
    result: latest,
  });
  const exitWith = (code, outcome) => {
    if (exiting) return;
    exiting = true;
    try {
      writeResultFile(config.resultPath, envelope(outcome, code));
    } catch (err) {
      log.warn('[probe-child] could not write the result file', err?.message ?? err);
    }
    // Why a pass was thrown away, in the log the parent copies: the result file
    // this reads from is deleted by the next run.
    for (const line of disturbanceLines(latest)) log.info(`[probe-child] ${line}`);
    log.info(`[probe-child] exit ${code} (${outcome})`);
    app.exit(code);
  };

  // A log-and-exit guard, never the crash dialog: a child sitting on a modal
  // would hold the parent until its hang guard.
  process.on('uncaughtException', (err) => {
    log.error('[probe-child] uncaught exception', err);
    exitWith(PROBE_EXIT.probeError, 'probe-error');
  });
  process.on('unhandledRejection', (reason) => {
    log.error('[probe-child] unhandled rejection', reason);
    exitWith(PROBE_EXIT.probeError, 'probe-error');
  });
  // The orphan watch: the parent pipe when fd 0 really carries one, the parent's
  // pid when it does not (electron/backend_probe_orphan_watch.cjs says why).
  armOrphanWatch({
    stdin: process.stdin,
    fstat: (fd) => fs.fstatSync(fd),
    parentPid: config.parentPid,
    kill: (pid, signal) => process.kill(pid, signal),
    setInterval: (fn, ms) => setInterval(fn, ms),
    log,
    onOrphan: () => exitWith(PROBE_EXIT.orphaned, 'orphaned'),
  });

  // The arm's switches, before ready, and the same pixel count on every machine.
  for (const [name, value] of switchesForArm(config.arm)) app.commandLine.appendSwitch(name, value);
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  // The same adapter as the game: the discrete-GPU force, under the same
  // opt-out the parent read off the prefs (the child reads no prefs).
  if (env.WOC_DISABLE_GPU_FORCE === '1' || config.gpuForceOptOut) {
    log.info('[probe-child] GPU force off (opt-out or env)');
  } else {
    forceHighPerformanceGpu({ app, log });
  }
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        codeCache: true,
      },
    },
  ]);
  if (process.platform === 'win32' || process.platform === 'linux') {
    Menu.setApplicationMenu(null);
  }

  const desktopConfig = resolveDesktopConfig({
    packagedMetadata: readPackagedMetadata(),
    env,
    isPackaged: app.isPackaged,
  });
  const apiOrigin = deriveOrigin(desktopConfig.apiOrigin) || PRODUCTION_API_ORIGIN;
  const devServerUrl = app.isPackaged ? undefined : env.VITE_DEV_SERVER_URL;
  const appOrigins = appNavigationOrigins(APP_ORIGIN, devServerUrl);
  const trustedSender = (event) => isTrustedSender(event.senderFrame, appOrigins);

  // A GPU process that dies ends the arm: Chromium restarts it on the
  // software fallback, and a section that continued would measure that
  // under the arm's name. Benign exits (a clean teardown) are not deaths.
  app.on('child-process-gone', (_event, details) => {
    if (details?.type !== 'GPU') return;
    if (classifyRendererExit(details.reason) === 'benign') return;
    log.error('[probe-child] GPU process gone', details);
    exitWith(PROBE_EXIT.died, 'died');
  });

  ipcMain.handle('desktop-probe-post', (event, value) => {
    if (!trustedSender(event)) return false;
    const accepted = acceptProbeResult(value, { run: config.run, round: config.round });
    if (!accepted) return false;
    latest = accepted;
    try {
      writeResultFile(config.resultPath, envelope('running', null));
    } catch (err) {
      log.warn('[probe-child] could not write the result file', err?.message ?? err);
      return false;
    }
    return true;
  });
  ipcMain.handle('desktop-probe-ended', (event, ended) => {
    if (!trustedSender(event)) return false;
    const code = exitCodeForEnded(String(ended), PROBE_EXIT);
    const outcome =
      code === PROBE_EXIT.completed
        ? 'completed'
        : code === PROBE_EXIT.didNotBind
          ? 'did-not-bind'
          : code === PROBE_EXIT.busy
            ? 'busy'
            : code === PROBE_EXIT.capped
              ? 'capped'
              : 'probe-error';
    // Let the invoke answer before the process leaves.
    setTimeout(() => exitWith(code, outcome), 50);
    return true;
  });
  ipcMain.on('desktop-renderer-error', (event, payload) => {
    if (!trustedSender(event)) return;
    const entry = rendererErrorLogEntry(payload);
    if (entry) log.error('[probe-child] page error', entry);
  });

  app.whenReady().then(() => {
    registerAppProtocol({ apiOrigin });
    lockDownPermissions(session.defaultSession);
    const win = new BrowserWindow({
      width: PROBE_WINDOW_WIDTH,
      height: PROBE_WINDOW_HEIGHT,
      resizable: false,
      alwaysOnTop: true,
      // Full screen from the FIRST PAINT, never at construction: a Vulkan
      // swapchain has been seen dying (VK_ERROR_OUT_OF_DATE_KHR) on a window
      // that changed mode before its first frame. Measuring full screen is
      // both what a player sees (the machine is visibly busy, and there is no
      // desktop to wander off into) and what the game does, so the pacing
      // section reads the presentation path the game will really take. The
      // drawn surface does not change with it: the canvas is capped at
      // MAX_CANVAS_WIDTH x MAX_CANVAS_HEIGHT, so every machine still measures
      // the same pixel count.
      title: 'World of ClaudeCraft',
      backgroundColor: '#05070a',
      show: true,
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        // A throttled window's animation frames stop outright, which the page
        // would read as a clean truncation rather than a disturbance.
        backgroundThrottling: false,
        spellcheck: false,
        webviewTag: false,
        disableBlinkFeatures: 'Autofill',
      },
    });
    // The window's state, pushed to the page: with throttling off the page's
    // own visibility stays "visible" while minimized, so this is its source.
    const pushWindowState = () => {
      if (win.isDestroyed()) return;
      win.webContents.send('desktop-probe-window-state', {
        minimized: win.isMinimized(),
        visible: win.isVisible(),
        focused: win.isFocused(),
        atMs: Date.now(),
      });
    };
    for (const event of ['minimize', 'restore', 'blur', 'focus', 'hide', 'show']) {
      win.on(event, pushWindowState);
    }
    win.webContents.on('did-finish-load', () => {
      pushWindowState();
      try {
        onBattery = powerMonitor.isOnBatteryPower() === true;
      } catch (err) {
        log.warn('[probe-child] could not read the power state', err?.message ?? err);
      }
      app.getGPUInfo('complete').then(
        (info) => {
          const { devices } = summarizeGpuDevices(info?.gpuDevice);
          if (adapter !== '') return;
          adapter = activeGpuAdapterKey(devices);
          driverVersion = devices.find((d) => d.active)?.driverVersion ?? '';
          log.info('[probe-child] adapter', { adapter, driverVersion, devices });
        },
        (err) => log.warn('[probe-child] could not read gpu info', err?.message ?? err),
      );
    });
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error('[probe-child] renderer gone', details);
      exitWith(PROBE_EXIT.rendererGone, 'renderer-gone');
    });
    win.on('closed', () => exitWith(PROBE_EXIT.probeError, 'probe-error'));
    // The mode change waits for the first paint (see the window options).
    win.webContents.once('did-finish-load', () => {
      if (!win.isDestroyed() && !win.isFullScreen()) win.setFullScreen(true);
    });
    void win.loadURL(probePageUrl(devServerUrl ?? APP_ORIGIN, config));
  });
}

function readPackagedMetadata() {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { probePageUrl, runBackendProbeChild };
