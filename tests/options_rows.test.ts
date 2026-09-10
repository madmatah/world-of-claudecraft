// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const click = vi.fn();
const startProbe = vi.fn<[unknown], Promise<boolean>>();
const musicState = { enabled: true, setEnabled: vi.fn() };

vi.mock('../src/game/audio', () => ({ audio: { click: () => click() } }));
vi.mock('../src/game/music', () => ({
  music: {
    get enabled() {
      return musicState.enabled;
    },
    setEnabled: (on: boolean) => musicState.setEnabled(on),
  },
}));
vi.mock('../src/game/desktop_gpu_backend_sync', () => ({
  startDesktopBackendProbe: (bridge: unknown) => startProbe(bridge),
}));
vi.mock('../src/runtime', () => ({ desktopBridge: () => ({ shell: 'stub' }) }));

const { paintActionRow, paintMusicToggle, paintNoteRow } = await import('../src/ui/options_rows');

beforeEach(() => {
  document.body.replaceChildren();
  click.mockClear();
  startProbe.mockReset();
  musicState.enabled = true;
  musicState.setEnabled.mockClear();
});

describe('paintNoteRow', () => {
  it('resolves a named placeholder through the catalog, leaving no raw brace', () => {
    paintNoteRow(document.body, 'hudChrome.options.gpuBackendVerdict', {
      backend: 'probe.backend.d3d11',
    });
    const note = document.body.querySelector('.set-note');
    expect(note?.textContent).toBe('Last backend test: Direct3D 11.');
    expect(note?.textContent).not.toContain('{backend}');
  });

  it('paints the sentence alone when the control names no values', () => {
    paintNoteRow(document.body, 'hudChrome.options.testBackendsNote');
    expect(document.body.querySelector('.set-note')?.textContent).not.toContain('{');
  });
});

describe('paintActionRow', () => {
  const control = {
    kind: 'button',
    key: 'backendProbe',
    labelKey: 'hudChrome.options.testBackends',
    action: 'backendProbe',
  } as const;

  it('labels the button from the catalog and carries the focus key', () => {
    paintActionRow(document.body, control);
    const button = document.body.querySelector('button');
    expect(button?.textContent).toBe('Test graphics backends');
    expect(button?.dataset.focusKey).toBe('backendProbe');
    expect(button?.disabled).toBe(false);
  });

  it('re-enables the button when the shell answers that the probe never started', async () => {
    startProbe.mockResolvedValue(false);
    paintActionRow(document.body, control);
    const button = document.body.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(click).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(button.disabled).toBe(false));
  });

  it('leaves the button disabled once the restart is under way', async () => {
    startProbe.mockResolvedValue(true);
    paintActionRow(document.body, control);
    const button = document.body.querySelector('button') as HTMLButtonElement;
    button.click();
    await startProbe.mock.results[0]?.value;
    expect(button.disabled).toBe(true);
  });
});

describe('paintMusicToggle', () => {
  it('reads the live director and repaints itself on a click', () => {
    musicState.setEnabled.mockImplementation((on: boolean) => {
      musicState.enabled = on;
    });
    paintMusicToggle(document.body, 'hud.options.music');
    const toggle = document.body.querySelector('.set-toggle') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.classList.contains('off')).toBe(false);
    toggle.click();
    expect(musicState.setEnabled).toHaveBeenCalledWith(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.classList.contains('off')).toBe(true);
  });
});
