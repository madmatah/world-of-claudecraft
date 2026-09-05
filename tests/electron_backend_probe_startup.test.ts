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

  it('the child resumes stdin for the orphan watch and logs its page errors', () => {
    expect(child).toContain('process.stdin.resume();');
    expect(child).toContain("process.stdin.on('end'");
    expect(child).toContain("process.stdin.on('close'");
    expect(child).toContain("ipcMain.on('desktop-renderer-error'");
    expect(child).toContain("app.on('child-process-gone'");
    expect(child).toContain("classifyRendererExit(details.reason) === 'benign'");
    expect(child).toContain("win.webContents.on('render-process-gone'");
    expect(child).toContain('backgroundThrottling: false');
    expect(child).toContain('alwaysOnTop: true');
    expect(child).toContain("app.commandLine.appendSwitch('force-device-scale-factor', '1')");
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
