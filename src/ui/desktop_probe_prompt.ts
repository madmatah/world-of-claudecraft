// The in-game prompt for the GPU backend probe ("WoC config detector"): a
// second launch of the desktop shell carrying --test-backends while the game
// runs (the Start-menu shortcut) cannot start the probe itself, so the shell
// pushes a request and the game asks the player here. Confirming restarts
// into the probe through the shell's no-payload channel; declining does
// nothing. A fixed, non-blocking card like the update toast (styles in
// src/styles/shell.css "desktop probe prompt"), never a native dialog: every
// string is a t() key. Registered in UI_DOM_MODULES (tests/architecture.test.ts).

import { startDesktopBackendProbe } from '../game/desktop_gpu_backend_sync';
import type { DesktopBridge } from '../runtime';
import { t } from './i18n';

export const DESKTOP_PROBE_PROMPT_ID = 'desktop-probe-prompt';

export function initDesktopProbePrompt(bridge: DesktopBridge): () => void {
  if (typeof bridge.onProbeRequested !== 'function') return () => {};
  if (typeof bridge.startBackendProbe !== 'function') return () => {};
  const existing = document.getElementById(DESKTOP_PROBE_PROMPT_ID);
  if (existing) existing.remove();

  const root = document.createElement('div');
  root.id = DESKTOP_PROBE_PROMPT_ID;
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-labelledby', `${DESKTOP_PROBE_PROMPT_ID}-title`);
  root.hidden = true;

  const title = document.createElement('div');
  title.className = 'desktop-probe-title';
  title.id = `${DESKTOP_PROBE_PROMPT_ID}-title`;
  title.textContent = t('hudChrome.options.probeRequestedTitle');
  const body = document.createElement('div');
  body.className = 'desktop-probe-body';
  body.textContent = t('hudChrome.options.probeRequestedBody');
  const actions = document.createElement('div');
  actions.className = 'desktop-probe-actions';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn';
  confirm.textContent = t('hudChrome.options.probeRequestedConfirm');
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = t('hudChrome.options.probeRequestedCancel');
  actions.append(confirm, cancel);
  root.append(title, body, actions);
  document.body.appendChild(root);

  // The card takes focus when it appears (a request the player must answer)
  // and hands it back to whatever had it on every way out, Escape included.
  let opener: HTMLElement | null = null;
  const hide = (): void => {
    if (root.hidden) return;
    root.hidden = true;
    const target = opener;
    opener = null;
    if (target && target.isConnected && typeof target.focus === 'function') target.focus();
  };
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      hide();
    }
  });
  confirm.addEventListener('click', () => {
    confirm.disabled = true;
    void startDesktopBackendProbe(bridge).then((started) => {
      confirm.disabled = false;
      // A started restart quits this process; a refused one leaves the
      // card up so the player can retry or decline.
      if (started) hide();
    });
  });
  cancel.addEventListener('click', hide);

  const unsubscribe = bridge.onProbeRequested(() => {
    if (root.hidden) opener = document.activeElement as HTMLElement | null;
    root.hidden = false;
    confirm.focus();
  });
  return () => {
    unsubscribe();
    root.remove();
  };
}
