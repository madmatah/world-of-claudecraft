// The Options rows that need nothing from the window's own state: the note
// line, the one-shot action button, and the bespoke music toggle. Each paints
// into a parent the window hands it, so OptionsWindow keeps the dispatch alone
// and these three stay drivable from a test without the whole window.

import { audio } from '../game/audio';
import { startDesktopBackendProbe } from '../game/desktop_gpu_backend_sync';
import { music } from '../game/music';
import { desktopBridge } from '../runtime';
import { t } from './i18n';
import type { TranslationKey } from './i18n.catalog';
import type { ButtonControl } from './options_view';

export function paintNoteRow(
  parent: HTMLElement,
  textKey: TranslationKey,
  valueKeys?: Record<string, TranslationKey>,
): void {
  const note = document.createElement('div');
  note.className = 'set-note';
  // The view names its placeholders as keys and this resolves them, so the
  // whole sentence including the value stays one translatable string.
  const values: Record<string, string> = {};
  for (const [name, key] of Object.entries(valueKeys ?? {})) values[name] = t(key);
  note.textContent = valueKeys ? t(textKey, values) : t(textKey);
  parent.appendChild(note);
}

// A one-shot action row: the GPU backend probe's restart (the shell answers
// false when it never started, and the row leaves the button enabled so the
// player can try again; a started restart quits this process).
export function paintActionRow(parent: HTMLElement, c: ButtonControl): void {
  const row = document.createElement('div');
  row.className = 'set-row';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.textContent = t(c.labelKey);
  button.dataset.focusKey = c.key;
  button.addEventListener('click', () => {
    audio.click();
    if (c.action === 'backendProbe') {
      button.disabled = true;
      void startDesktopBackendProbe(desktopBridge()).then((started) => {
        if (!started) button.disabled = false;
      });
    }
  });
  row.appendChild(button);
  parent.appendChild(row);
}

// The bespoke music on/off toggle (reads the live MusicDirector, not a setting).
export function paintMusicToggle(parent: HTMLElement, labelKey: TranslationKey): void {
  const label = t(labelKey);
  const row = document.createElement('div');
  row.className = 'set-row';
  const name = document.createElement('span');
  name.className = 'set-name';
  name.textContent = label;
  const toggle = document.createElement('button');
  toggle.className = 'btn set-toggle';
  const sync = () => {
    toggle.textContent = music.enabled ? t('hud.options.on') : t('hud.options.off');
    toggle.classList.toggle('off', !music.enabled);
    toggle.setAttribute('aria-pressed', String(music.enabled));
    toggle.setAttribute('aria-label', label);
  };
  sync();
  toggle.addEventListener('click', () => {
    audio.click();
    music.setEnabled(!music.enabled);
    sync();
  });
  row.append(name, toggle);
  parent.appendChild(row);
}
