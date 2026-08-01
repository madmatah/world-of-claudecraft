// @vitest-environment jsdom
//
// The Realm Racers window/strip lifecycle. The queue window used to stay
// centered over the viewport through the whole countdown and race, and the only
// forfeit control lived inside it, so closing it left no way out of a race.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersUi } from '../src/ui/realm_racers';
import type { IWorld, RealmRacersInfo } from '../src/world_api';

type RallyMatch = NonNullable<RealmRacersInfo['match']>;

function match(over: Partial<RallyMatch> = {}): RallyMatch {
  return {
    id: 7,
    phase: 'countdown',
    countdown: 3,
    countdownTicks: 60,
    elapsed: 0,
    speed: 0,
    wrongWay: false,
    resetLocked: false,
    returnIn: 0,
    me: { pid: 1, name: 'Aster', lap: 1, finished: false, botTier: null },
    opponent: { pid: 2, name: 'Briar', lap: 1, finished: false, botTier: null },
    position: 1,
    practice: false,
    totalLaps: 3,
    result: null,
    ...over,
  };
}

function harness() {
  document.body.innerHTML =
    '<div id="ui"></div><div id="realm-racers-window" style="display: none"></div>';
  const layer = document.getElementById('ui') as HTMLElement;
  const root = document.getElementById('realm-racers-window') as HTMLElement;
  const opener = document.createElement('button');
  document.body.appendChild(opener);
  const info: RealmRacersInfo = {
    queued: false,
    queuePosition: 0,
    queueSize: 0,
    match: null,
    practiceAvailable: true,
  };
  const forfeitRealmRacers = vi.fn();
  const resetRealmRacersPosition = vi.fn();
  const startRealmRacersPractice = vi.fn();
  const countdownTick = vi.fn();
  const touch = { value: false };
  const restoreFocus = vi.fn();
  const world = {
    realmRacersInfo: info,
    joinRealmRacersQueue: vi.fn(),
    leaveRealmRacersQueue: vi.fn(),
    forfeitRealmRacers,
    resetRealmRacersPosition,
    startRealmRacersPractice,
  } as unknown as IWorld;
  const noop = (): void => {};
  const ui = new RealmRacersUi({
    root: () => root,
    layer: () => layer,
    world: () => world,
    closeOthers: noop,
    captureFocus: () => opener,
    restoreFocus,
    controlKeys: (action) => CONTROL_KEYS[action],
    isTouchHud: () => touch.value,
    countdownTick,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
  });
  const forfeitButton = (): HTMLButtonElement | null =>
    layer.querySelector('.rallyhud-forfeit') as HTMLButtonElement | null;
  return {
    ui,
    root,
    layer,
    info,
    opener,
    restoreFocus,
    forfeitRealmRacers,
    resetRealmRacersPosition,
    countdownTick,
    startRealmRacersPractice,
    forfeitButton,
    touch,
  };
}

/** The keys the harness pretends the player has bound. */
const CONTROL_KEYS: Record<string, string[]> = {
  throttle: ['W'],
  brake: ['S'],
  steer: ['A', 'D'],
  handbrake: ['Space'],
};

describe('Realm Racers practice setup screen', () => {
  const practiceButton = (root: HTMLElement): HTMLButtonElement | null =>
    root.querySelector('[data-rally-practice-open]');
  const tierButtons = (root: HTMLElement): HTMLButtonElement[] =>
    [...root.querySelectorAll('[data-rally-tier]')] as HTMLButtonElement[];
  const playButton = (root: HTMLElement): HTMLButtonElement | null =>
    root.querySelector('[data-rally-practice-play]');

  it('keeps the front screen to a primer and two clearly separated ways in', () => {
    // The four rule cards that used to sit here were most of the panel's height
    // and pushed the queue and practice controls into each other; three of the
    // four were also either learned in the first corner or about to stop being
    // true (the weapon, the equal-machines promise the roster will break).
    const h = harness();
    h.ui.toggle();
    expect(h.root.querySelectorAll('.rally-rules')).toHaveLength(0);
    expect(h.root.querySelector('.rally-emblem')).toBeNull();
    expect(h.root.querySelector('.rally-crest')).not.toBeNull();
    expect(h.root.textContent).toContain(t('hudChrome.rally.pitch'));
    expect(h.root.textContent).toContain(t('hudChrome.rally.promiseCircuit'));
    expect(h.root.textContent).toContain(t('hudChrome.rally.howToPlay'));
    expect(h.root.querySelector('.rally-or')).not.toBeNull();
    expect(h.root.querySelector('[data-rally-join]')).not.toBeNull();
    expect(h.root.querySelector('[data-rally-practice-open]')).not.toBeNull();
  });

  it('offers ONE practice control on the front screen, which starts no race', () => {
    const h = harness();
    h.ui.toggle();
    expect(tierButtons(h.root)).toHaveLength(0);
    const open = practiceButton(h.root);
    expect(open).not.toBeNull();
    open?.click();
    // Stepping in is not entering: nothing has been sent to the world yet.
    expect(h.startRealmRacersPractice).not.toHaveBeenCalled();
    expect(tierButtons(h.root)).toHaveLength(3);
    expect(playButton(h.root)).not.toBeNull();
  });

  it('sends the tier the player picked, once, on Play', () => {
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    // The default rival is pre-selected, so Play alone is a complete answer.
    expect(
      tierButtons(h.root).filter((b) => b.getAttribute('aria-pressed') === 'true').length,
    ).toBe(1);
    tierButtons(h.root)
      .find((b) => b.dataset.rallyTier === 'ace')
      ?.click();
    expect(h.startRealmRacersPractice).not.toHaveBeenCalled();
    playButton(h.root)?.click();
    expect(h.startRealmRacersPractice).toHaveBeenCalledTimes(1);
    expect(h.startRealmRacersPractice).toHaveBeenCalledWith('ace');
  });

  it('marks the picked rival and only that one', () => {
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    tierButtons(h.root)
      .find((b) => b.dataset.rallyTier === 'rookie')
      ?.click();
    const pressed = tierButtons(h.root)
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.dataset.rallyTier);
    expect(pressed).toEqual(['rookie']);
  });

  it('teaches the controls with the keys the player actually has bound', () => {
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    const caps = [...h.root.querySelectorAll('.rally-key')].map((el) => el.textContent);
    expect(caps).toEqual(['W', 'S', 'A', 'D', 'Space']);
    expect(h.root.textContent).toContain(t('hudChrome.rally.controlHandbrake'));
    expect(h.root.textContent).toContain(t('hudChrome.rally.controlSteerHint'));
  });

  it('teaches DRIVING only, never a named weapon', () => {
    // The weapon is one button with an obvious effect, and the roster is heading
    // for one per machine and then for pickups, so naming a specific one here
    // would start going stale the day the second machine lands.
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    expect(h.root.textContent).not.toContain('Ground Blast');
  });

  it('drops the keycaps on a touch HUD and explains the on-screen controls instead', () => {
    const h = harness();
    h.touch.value = true;
    h.ui.toggle();
    practiceButton(h.root)?.click();
    expect(h.root.querySelectorAll('.rally-key')).toHaveLength(0);
    expect(h.root.textContent).toContain(t('hudChrome.rally.practiceTouchNote'));
    // The controls are still taught, just without keys to name.
    expect(h.root.textContent).toContain(t('hudChrome.rally.controlThrottle'));
  });

  it('goes back to the front screen without racing', () => {
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    (h.root.querySelector('[data-rally-practice-back]') as HTMLButtonElement | null)?.click();
    expect(tierButtons(h.root)).toHaveLength(0);
    expect(practiceButton(h.root)).not.toBeNull();
    expect(h.startRealmRacersPractice).not.toHaveBeenCalled();
  });

  it('offers no Play button, and says why, when the realm has no copy left', () => {
    const h = harness();
    h.info.practiceAvailable = false;
    h.ui.toggle();
    practiceButton(h.root)?.click();
    expect(playButton(h.root)).toBeNull();
    expect(h.root.textContent).toContain(t('hudChrome.rally.practiceUnavailable'));
  });

  it('keeps offering practice to a player already waiting in the queue', () => {
    // Pressing it is a clear "race now": the sim takes them out of the queue.
    const h = harness();
    h.info.queued = true;
    h.info.queuePosition = 1;
    h.info.queueSize = 1;
    h.ui.toggle();
    expect(practiceButton(h.root)).not.toBeNull();
  });

  it('leaves the setup screen behind once the race starts', () => {
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    h.info.match = match();
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
    // Reopening lands on the front screen, not back on a setup it is too late
    // to answer.
    h.info.match = null;
    h.ui.update();
    h.ui.toggle();
    expect(tierButtons(h.root)).toHaveLength(0);
    expect(practiceButton(h.root)).not.toBeNull();
  });

  it('names the opponent as a house pilot in the window and the race strip', () => {
    const h = harness();
    h.info.match = match({
      phase: 'racing',
      opponent: {
        pid: 2,
        name: 'Briar',
        lap: 1,
        finished: false,
        botTier: 'ace',
      },
    });
    h.ui.update();
    h.ui.toggle();
    const expected = t('hudChrome.rally.racingAgainstBot', {
      name: 'Briar',
      tier: t('hudChrome.rally.tierAce'),
    });
    expect(h.root.textContent).toContain(expected);
    expect(h.layer.textContent).toContain(
      t('hudChrome.rally.versusBot', { name: 'Briar', tier: t('hudChrome.rally.tierAce') }),
    );
  });

  it('leaves a human opponent unmarked', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    h.ui.toggle();
    expect(h.root.textContent).toContain(t('hudChrome.rally.racingAgainst', { name: 'Briar' }));
    expect(h.layer.textContent).toContain(t('hudChrome.rally.versus', { name: 'Briar' }));
  });
});

describe('Realm Racers window lifecycle', () => {
  it('leaves the queue window open while no match exists', () => {
    const h = harness();
    h.ui.toggle();
    expect(h.ui.isOpen).toBe(true);
    h.ui.update();
    h.ui.update();
    expect(h.ui.isOpen).toBe(true);
    expect(h.restoreFocus).not.toHaveBeenCalled();
  });

  it('closes itself on the frame the match appears and restores the opener focus', () => {
    const h = harness();
    h.ui.toggle();
    h.info.match = match();
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
    expect(h.restoreFocus).toHaveBeenCalledTimes(1);
    expect(h.restoreFocus).toHaveBeenCalledWith(h.opener);
  });

  it('keeps the panel open when the player reopens it mid-race (edge, not level)', () => {
    const h = harness();
    h.ui.toggle();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
    h.ui.toggle();
    h.ui.update();
    h.ui.update();
    expect(h.ui.isOpen).toBe(true);
    expect(h.restoreFocus).toHaveBeenCalledTimes(1);
  });

  it('closes on every rising match edge across back-to-back races', () => {
    const h = harness();
    h.ui.toggle();
    h.info.match = match();
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
    h.info.match = null;
    h.ui.update();
    h.ui.toggle();
    expect(h.ui.isOpen).toBe(true);
    h.info.match = match({ id: 8 });
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
    expect(h.restoreFocus).toHaveBeenCalledTimes(2);
  });

  it('never opens the window by itself when a match starts', () => {
    const h = harness();
    h.info.match = match();
    h.ui.update();
    expect(h.ui.isOpen).toBe(false);
  });
});

describe('Realm Racers strip forfeit control', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes two presses inside the arm window to forfeit', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const button = h.forfeitButton();
    expect(button).not.toBeNull();
    expect(button?.textContent).toBe(t('hudChrome.rally.forfeit'));

    button?.click();
    expect(h.forfeitRealmRacers).not.toHaveBeenCalled();
    h.ui.update();
    expect(button?.textContent).toBe(t('hudChrome.rally.forfeitConfirm'));
    expect(button?.classList.contains('armed')).toBe(true);

    vi.advanceTimersByTime(1000);
    button?.click();
    expect(h.forfeitRealmRacers).toHaveBeenCalledTimes(1);
  });

  it('re-arms instead of forfeiting once the arm window has lapsed', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const button = h.forfeitButton();

    button?.click();
    vi.advanceTimersByTime(3001);
    h.ui.update();
    expect(button?.textContent).toBe(t('hudChrome.rally.forfeit'));
    expect(button?.classList.contains('armed')).toBe(false);

    button?.click();
    expect(h.forfeitRealmRacers).not.toHaveBeenCalled();
    button?.click();
    expect(h.forfeitRealmRacers).toHaveBeenCalledTimes(1);
  });

  it('disarms a pending press when the strip rebuilds for a new race', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    h.forfeitButton()?.click();
    h.info.match = null;
    h.ui.update();
    h.info.match = match({ id: 9, phase: 'racing' });
    h.ui.update();
    h.forfeitButton()?.click();
    expect(h.forfeitRealmRacers).not.toHaveBeenCalled();
  });

  it('drops the control once the race is decided', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    expect(h.forfeitButton()).not.toBeNull();
    h.info.match = match({
      phase: 'finished',
      result: 'won',
      returnIn: 6,
      me: { pid: 1, name: 'Aster', lap: 3, finished: true, botTier: null },
    });
    h.ui.update();
    expect(h.forfeitButton()).toBeNull();
  });
});

describe('Realm Racers race-feel HUD', () => {
  it('shows speed and wrong-way state, and routes manual recovery', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing', speed: 47.4, wrongWay: true });
    h.ui.update();

    expect(h.layer.querySelector('.rallyhud-speed')?.textContent).toBe(
      t('hudChrome.rally.speed', { speed: '47' }),
    );
    const warning = h.layer.querySelector('.rallyhud-wrong-way') as HTMLElement;
    expect(warning.textContent).toBe(t('hudChrome.rally.wrongWay'));
    expect(warning.style.display).toBe('block');
    (h.layer.querySelector('.rallyhud-reset') as HTMLButtonElement).click();
    expect(h.resetRealmRacersPosition).toHaveBeenCalledTimes(1);
  });

  it('disables recovery during the authoritative post-reset lock', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing', resetLocked: false });
    h.ui.update();
    const button = h.layer.querySelector('.rallyhud-reset') as HTMLButtonElement;
    button.focus();
    h.info.match = match({ phase: 'racing', resetLocked: true });
    h.ui.update();
    expect(button.disabled).toBe(true);
    expect(h.layer.querySelector('.rallyhud-reset')).toBe(button);
    expect(document.activeElement).toBe(button);
    button.click();
    expect(h.resetRealmRacersPosition).not.toHaveBeenCalled();
  });

  it('plays one countdown cue per changed authoritative second', () => {
    const h = harness();
    h.info.match = match({ phase: 'countdown', countdown: 0, countdownTicks: 140 });
    h.ui.update();
    expect(h.countdownTick).not.toHaveBeenCalled();
    expect(h.layer.querySelector('.rallyhud-phase')?.textContent).toBe('');
    h.info.match = match({ phase: 'countdown', countdown: 3 });
    h.ui.update();
    h.ui.update();
    expect(h.countdownTick).toHaveBeenCalledTimes(1);
    h.info.match = match({ phase: 'countdown', countdown: 2, countdownTicks: 40 });
    h.ui.update();
    expect(h.countdownTick).toHaveBeenCalledTimes(2);
    h.info.match = match({ phase: 'racing', countdown: 0, countdownTicks: 0 });
    h.ui.update();
    expect(h.countdownTick).toHaveBeenCalledTimes(2);
  });
});
