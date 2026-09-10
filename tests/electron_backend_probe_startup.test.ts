import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './helpers/strip_comments';

// Source-scan pins for the GPU backend probe's two branches in main.cjs and
// the child module's discipline: main.cjs cannot run under vitest, so the
// ORDER of its module-scope side effects is the coverage. A child that read
// the prefs, took the lock or showed the crash dialog would corrupt the game's
// profile or hold the parent; a parent that opened the game window would
// measure under a GPU load.
const repoRoot = join(__dirname, '..');
const read = (rel: string) => stripComments(readFileSync(join(repoRoot, rel), 'utf8'));
const main = read('electron/main.cjs');
const entry = read('electron/entry.cjs');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  main: string;
};
const child = read('electron/backend_probe_child.cjs');
const parent = read('electron/backend_probe_parent.cjs');
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const at = (source: string, needle: string) => {
  const index = source.indexOf(needle);
  expect(index, `${needle} not found`).toBeGreaterThan(-1);
  return index;
};

describe('the probe child branch in main.cjs', () => {
  it('hands over in the entry, before main.cjs and any of its side effects', () => {
    // The entry is the package main, and its ONLY job is the branch: a child
    // requires the child module, everything else requires main.cjs, which
    // itself never knows the child mode.
    expect(packageJson.main).toBe('electron/entry.cjs');
    expect(entry).toContain('if (isProbeChild(process.env)) {');
    expect(entry).toContain("require('./backend_probe_child.cjs').runBackendProbeChild();");
    expect(entry).toContain("require('./main.cjs');");
    expect(entry.split('require(').length - 1).toBe(3);
    expect(main).not.toContain('isProbeChild(');
    expect(main).not.toContain('runBackendProbeChild');
    // main.cjs keeps every side effect the child must never reach.
    for (const effect of [
      'loadDesktopPrefs(desktopPrefsPath)',
      'crashReporter.start({',
      'installProcessCrashGuards({',
      'app.requestSingleInstanceLock()',
    ]) {
      expect(main).toContain(effect);
    }
  });

  it('the child module sets its own profile first, and never touches the lock or the prefs', () => {
    const run = at(child, 'function runBackendProbeChild(');
    const firstAppCall = child.slice(run).search(/app\.(?!exit)/);
    expect(child.slice(run + firstAppCall, run + firstAppCall + 80)).toContain(
      "app.setPath('userData', config.profileDir)",
    );
    expect(at(child, "app.setPath('sessionData'")).toBeGreaterThan(run);
    expect(at(child, "app.setPath('logs'")).toBeGreaterThan(run);
    expect(at(child, 'initLogging({')).toBeGreaterThan(at(child, "app.setPath('logs'"));
    expect(child).not.toContain('requestSingleInstanceLock');
    expect(child).not.toContain('saveDesktopPrefs');
    expect(child).not.toContain('loadDesktopPrefs');
    expect(child).not.toContain('dialog.');
    expect(child).toContain('uploadToServer: false');
  });

  it('the child arms the orphan watch through its module and logs its page errors', () => {
    // The watch itself (pipe when fd 0 carries one, parent pid when it does not)
    // is tests/electron_backend_probe_orphan_watch.test.ts; here we pin that the
    // child hands it the three things only the child has, and rolls none of it
    // by hand.
    expect(child).toContain('armOrphanWatch({');
    expect(child).toContain('stdin: process.stdin,');
    expect(child).toContain('parentPid: config.parentPid,');
    expect(child).toContain('fs.fstatSync(fd)');
    expect(child).not.toContain('process.stdin.resume();');
    expect(child).toContain("ipcMain.on('desktop-renderer-error'");
    expect(child).toContain("app.on('child-process-gone'");
    expect(child).toContain("classifyRendererExit(details.reason) === 'benign'");
    expect(child).toContain("win.webContents.on('render-process-gone'");
    expect(child).toContain('backgroundThrottling: false');
    expect(child).toContain('alwaysOnTop: true');
    expect(child).toContain("app.commandLine.appendSwitch('force-device-scale-factor', '1')");
    // Full screen at the first paint, never at construction (a Vulkan swapchain
    // has died on a window that changed mode before its first frame), and the
    // resize lock lifted across it or Windows only drops the frame.
    expect(child).toContain("win.webContents.once('did-finish-load'");
    expect(child).toContain('win.setResizable(true);\n      win.setFullScreen(true);');
    expect(child).toContain('win.setResizable(false);');
  });

  it('carries the same app scheme privileges as main.cjs', () => {
    const literal = (source: string) => {
      const start = at(source, 'protocol.registerSchemesAsPrivileged([');
      return source.slice(start, source.indexOf(']);', start)).replace(/\s+/g, ' ');
    };
    expect(literal(child)).toBe(literal(main));
  });
});

describe('the probe parent branch in main.cjs', () => {
  it('turns hardware acceleration off before ready, only when the probe runs', () => {
    const off = at(main, 'if (backendProbeParentRuns) app.disableHardwareAcceleration();');
    expect(off).toBeLessThan(at(main, 'app.whenReady()'));
    expect(count(main, 'disableHardwareAcceleration()')).toBe(1);
  });

  it('opens the probe window instead of the game and skips the updater, presence and activate', () => {
    const ready = at(main, 'app.whenReady().then(() => {');
    const branch = main.indexOf('if (backendProbeRequested) {', ready);
    expect(branch).toBeGreaterThan(ready);
    const body = main.slice(branch, main.indexOf('\n  }\n', branch));
    expect(body).toContain('backendProbeParent = createBackendProbeParent({');
    expect(body).toContain('backendProbeParent.start();');
    expect(body).toContain('return;');
    // The branch sits after the protocol and lockdown, before the game window,
    // the updater and the activate handler.
    expect(branch).toBeGreaterThan(main.indexOf('registerAppProtocol({ apiOrigin });', ready));
    expect(branch).toBeGreaterThan(
      main.indexOf('lockDownPermissions(session.defaultSession);', ready),
    );
    expect(branch).toBeLessThan(main.indexOf('createMainWindow();', ready));
    expect(branch).toBeLessThan(main.indexOf('initUpdater({', ready));
    expect(branch).toBeLessThan(main.indexOf("app.on('activate'", ready));
    // An ineligible flag logs and quits inside the same branch.
    expect(body).toContain('app.quit();');
    // The verdict's Play strips the flag and hands the lock over on spawn.
    expect(body.replace(/\s+/g, ' ')).toContain(
      'argv: childArgvFor(process.argv.slice(1)), onSpawned: () => { app.releaseSingleInstanceLock(); app.quit(); }',
    );
  });

  it('routes a second instance to the parent before the game focus', () => {
    const handler = at(main, "app.on('second-instance'");
    const body = main.slice(handler, main.indexOf('\n  });', handler));
    const parentAt = body.indexOf('backendProbeParent.onSecondInstance();');
    const focusAt = body.indexOf('focusMainWindow();');
    expect(parentAt).toBeGreaterThan(-1);
    expect(parentAt).toBeLessThan(focusAt);
    expect(body.slice(parentAt, parentAt + 60)).toContain('return;');
  });

  it('the parent never opens the game window and gates every handle on the trusted sender', () => {
    expect(parent).not.toContain('createMainWindow');
    const registrations = parent.split('ipcMain.handle(').slice(1);
    expect(registrations.length).toBe(4);
    for (const body of registrations) {
      expect(body.slice(0, 200)).toContain('deps.trustedSender(event)');
    }
    // Exactly one window, in the sibling module, never in main.cjs.
    expect(count(parent, 'new BrowserWindow(')).toBe(1);
    expect(count(main, 'new BrowserWindow(')).toBe(1);
  });
});

describe('the Windows verdict in main.cjs', () => {
  it('feeds the Windows decision its validity facts and picks the platform judge and ladder', () => {
    const decideAt = at(main, 'const gpuBackendLaunch = decideGpuBackendLaunch({');
    const decision = main.slice(decideAt, main.indexOf('});', decideAt)).replace(/\s+/g, ' ');
    expect(decision).toContain('chromeVersion: process.versions.chrome,');
    expect(decision).toContain('probeVersion: PROBE_VERSION,');
    expect(decision).toContain('corpusHash: desktopConfig.probeCorpusHash,');
    expect(main).toContain(
      'const judgeGpuBackendLaunch = onWindows ? judgeWindowsGpuBackendLaunch : judgeLinuxGpuBackendLaunch;',
    );
    expect(main).toContain(
      'const backendDidNotBind = onWindows ? windowsBackendDidNotBind : linuxBackendDidNotBind;',
    );
    expect(main).toContain('const gpuLadder = onWindows ? WINDOWS_LADDER : undefined;');
  });

  it('moves the verdict streaks on a launch death and a healthy session, and marks a moved machine stale', () => {
    const gone = at(main, "app.on('child-process-gone'");
    const goneBody = main.slice(gone, main.indexOf('\n});', gone)).replace(/\s+/g, ' ');
    expect(goneBody).toContain(
      'if (onWindows && !gpuLaunchDeathCounted) { gpuLaunchDeathCounted = true; const next = verdictAfterLaunchDeath(desktopPrefs.backendProbeVerdict, gpuBackendLaunch.rung); if (next && mergeDesktopPrefs({ backendProbeVerdict: next })) {',
    );
    // Before the Linux memory arm, so the auto flag (always false on Windows)
    // never has to know about the verdict.
    expect(goneBody.indexOf('verdictAfterLaunchDeath(')).toBeLessThan(
      goneBody.indexOf('demoteAfterRepeatedCrashes('),
    );
    const healthy = at(main, 'function armHealthySessionTimer() {');
    const healthyBody = main.slice(healthy, main.indexOf('\n}', healthy)).replace(/\s+/g, ' ');
    expect(healthyBody).toContain(
      'const next = verdictAfterHealthySession(desktopPrefs.backendProbeVerdict, boundRung); if (next && mergeDesktopPrefs({ backendProbeVerdict: next })) {',
    );
    const latch = at(
      main,
      "if (boundGpuAdapter === '') boundGpuAdapter = activeGpuAdapterKey(devices);",
    );
    const after = main.slice(latch, latch + 1200).replace(/\s+/g, ' ');
    expect(after).toContain('if (onWindows && gpuBackendLaunch.fromVerdict === true) {');
    expect(after).toContain(
      '!verdictMatchesMachine(verdict, { adapter: boundGpuAdapter, driverVersion })',
    );
    expect(after).toContain('mergeDesktopPrefs({ backendProbeVerdict: stale })');
  });
});

describe('the game-side entry points in main.cjs', () => {
  it('restarts into the probe on a NO-payload channel, main appending the literal flag', () => {
    const start = at(main, "ipcMain.handle('desktop-start-backend-probe'");
    const body = main.slice(start, main.indexOf('\n});', start)).replace(/\s+/g, ' ');
    expect(body).toContain("ipcMain.handle('desktop-start-backend-probe', (event) => {");
    expect(body).toContain('if (restartInFlight) return restartInFlight;');
    expect(body).toContain('extraArgv: [TEST_BACKENDS_FLAG],');
    expect(body).toContain('onSpawned: () => { app.releaseSingleInstanceLock(); app.quit(); }');
    expect(body).not.toContain('argv:');
  });

  it('asks the running game on a second launch with the flag, after the focus and the deep link', () => {
    const handler = at(main, "app.on('second-instance'");
    const body = main.slice(handler, main.indexOf('\n  });', handler));
    const ask = body.indexOf("mainWindow.webContents.send('desktop-probe-requested');");
    expect(ask).toBeGreaterThan(body.indexOf('focusMainWindow();'));
    expect(ask).toBeGreaterThan(body.indexOf('if (url) handleDeepLink(url);'));
    const guard = body.slice(0, ask).replace(/\s+/g, ' ');
    expect(guard).toContain('if ( hasTestBackendsFlag(argv) &&');
    // Only where the probe can run: elsewhere the restart would quit the game
    // and leave nothing behind.
    expect(guard).toContain(
      'probeIneligibility({ platform: process.platform, isPackaged: app.isPackaged, devServerUrl, env: process.env, }) === null &&',
    );
    expect(guard).toContain('mainWindow && !mainWindow.isDestroyed() ) {');
  });

  it('reports the stored verdict on the backend state, Windows only', () => {
    const state = at(main, 'function gpuBackendState() {');
    expect(main.slice(state, main.indexOf('\n}', state))).toContain(
      'verdict: probeVerdictState(),',
    );
    const reader = at(main, 'function probeVerdictState() {');
    const body = main.slice(reader, main.indexOf('\n}', reader)).replace(/\s+/g, ' ');
    expect(body).toContain('if (!onWindows) return null;');
    expect(body).toContain(
      'return { rung: verdict.rung, worker: verdict.worker === true, stale: verdict.stale === true };',
    );
  });
});

describe('the worker verdict plumbing in main.cjs', () => {
  it('hands the worker decision to the game window as additionalArguments, off the launch', () => {
    const window = at(main, 'function createMainWindow() {');
    const body = main.slice(window, main.indexOf('\n}', window)).replace(/\s+/g, ' ');
    expect(body).toContain(
      'additionalArguments: shaderWorkerVerdictArguments( desktopPrefs.backendProbeVerdict, gpuBackendLaunch, ),',
    );
  });

  it('moves the worker retirement streak on the session outcome, Windows only, one word accepted', () => {
    const on = at(main, "ipcMain.on('desktop-worker-session'");
    const body = main.slice(on, main.indexOf('\n});', on)).replace(/\s+/g, ' ');
    expect(body).toContain('if (!trustedSender(event)) return;');
    expect(body).toContain("if (outcome !== 'counted' && outcome !== 'settled') return;");
    expect(body).toContain('if (!onWindows) return;');
    expect(body).toContain(
      "const next = verdictAfterWorkerSession(desktopPrefs.backendProbeVerdict, outcome === 'counted');",
    );
    expect(body).toContain('mergeDesktopPrefs({ backendProbeVerdict: next })');
  });
});
