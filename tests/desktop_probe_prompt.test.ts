// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { DesktopBridge } from '../src/runtime';
import { DESKTOP_PROBE_PROMPT_ID, initDesktopProbePrompt } from '../src/ui/desktop_probe_prompt';
import { t } from '../src/ui/i18n';

function shell(startAnswer: boolean | 'throw' = true) {
  let request: (() => void) | null = null;
  let starts = 0;
  const bridge = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    startBackendProbe: () => {
      starts += 1;
      if (startAnswer === 'throw') return Promise.reject(new Error('gone'));
      return Promise.resolve(startAnswer);
    },
    onProbeRequested: (callback: () => void) => {
      request = callback;
      return () => {
        request = null;
      };
    },
  } as unknown as DesktopBridge;
  return {
    bridge,
    request: () => request?.(),
    starts: () => starts,
    subscribed: () => request !== null,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const card = () => document.getElementById(DESKTOP_PROBE_PROMPT_ID) as HTMLElement | null;
const buttons = () => [...(card()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('initDesktopProbePrompt', () => {
  it('mounts hidden, shows on the shell request, and restarts into the probe on confirm', async () => {
    const s = shell(true);
    initDesktopProbePrompt(s.bridge);
    expect(card()?.hidden).toBe(true);
    expect(card()?.textContent).toContain(t('hudChrome.options.probeRequestedTitle'));
    s.request();
    expect(card()?.hidden).toBe(false);
    expect(document.activeElement).toBe(buttons()[0]);
    buttons()[0].click();
    await settle();
    expect(s.starts()).toBe(1);
    expect(card()?.hidden).toBe(true);
  });

  it('stays up when the shell refuses the restart, and hides on decline', async () => {
    const s = shell(false);
    initDesktopProbePrompt(s.bridge);
    s.request();
    buttons()[0].click();
    await settle();
    expect(card()?.hidden).toBe(false);
    expect(buttons()[0].disabled).toBe(false);
    buttons()[1].click();
    expect(card()?.hidden).toBe(true);
    expect(s.starts()).toBe(1);
  });

  it('survives a rejected restart and tears down on dispose', async () => {
    const s = shell('throw');
    const dispose = initDesktopProbePrompt(s.bridge);
    s.request();
    buttons()[0].click();
    await settle();
    expect(card()?.hidden).toBe(false);
    dispose();
    expect(card()).toBeNull();
    expect(s.subscribed()).toBe(false);
  });

  it('does nothing on a shell without the request or the restart channel', () => {
    const bridge = {
      openBrowserLogin: () => Promise.resolve(),
      takeLoginCode: () => Promise.resolve(null),
      onLoginCode: () => () => {},
    } as unknown as DesktopBridge;
    initDesktopProbePrompt(bridge);
    expect(card()).toBeNull();
  });
});
