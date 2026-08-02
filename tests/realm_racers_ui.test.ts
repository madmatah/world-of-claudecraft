// @vitest-environment jsdom
//
// The Realm Racers window/strip lifecycle. The queue window used to stay
// centered over the viewport through the whole countdown and race, and the only
// forfeit control lived inside it, so closing it left no way out of a race.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The standings portrait is the party frames' class crest, whose procedural path
// needs a real 2D canvas jsdom does not provide. The strip only ever needs a
// string, so the same hoisted spy the party-frames suite uses stands in, and it
// also lets a test assert that each pilot's OWN class reaches the crest call.
const iconDataUrlSpy = vi.hoisted(() => vi.fn((_kind: string, key: string) => `data:${key}`));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: iconDataUrlSpy,
}));

import { t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersUi } from '../src/ui/realm_racers';
import type { IWorld, RealmRacersInfo } from '../src/world_api';

type RallyMatch = NonNullable<RealmRacersInfo['match']>;
type RallyRacer = RallyMatch['standings'][number];

function racer(over: Partial<RallyRacer> = {}): RallyRacer {
  return {
    pid: 1,
    name: 'Aster',
    cls: 'warrior',
    lap: 1,
    finished: false,
    botTier: null,
    position: 1,
    finishSeconds: null,
    retired: false,
    ...over,
  };
}

/** A four-pilot grid with the viewer leading it. */
function match(over: Partial<RallyMatch> = {}): RallyMatch {
  const me = racer();
  return {
    id: 7,
    circuitId: 'evergarden_practice',
    participantIds: [1, 2, 3, 4],
    phase: 'countdown',
    countdown: 3,
    countdownTicks: 60,
    elapsed: 0,
    chaseIn: 0,
    speed: 0,
    wrongWay: false,
    resetLocked: false,
    returnIn: 0,
    me,
    standings: [
      me,
      racer({ pid: 2, name: 'Briar', cls: 'mage', position: 2, lap: 2 }),
      racer({ pid: 3, name: 'Cass', cls: 'rogue', position: 3, lap: 2 }),
      racer({ pid: 4, name: 'Dell', cls: 'priest', position: 4, lap: 1 }),
    ],
    gridSize: 4,
    decided: false,
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

  it('reports the field, not one rival, and marks a practice race as one', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing', me: racer({ position: 3 }) });
    h.ui.update();
    h.ui.toggle();
    expect(h.root.textContent).toContain(
      t('hudChrome.rally.racingAgainst', { position: '3', total: '4' }),
    );
    h.info.match = match({ phase: 'racing', practice: true, me: racer({ position: 3 }) });
    h.ui.update();
    expect(h.root.textContent).toContain(
      t('hudChrome.rally.racingAgainstBot', { position: '3', total: '4' }),
    );
  });

  it('paints a party-frame row per machine: placing, portrait, name, lap', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const panel = h.layer.querySelector('#realm-racers-standings') as HTMLElement;
    // Its OWN panel, not a block inside the centred strip: it lives in the
    // top-left corner where the party frames do.
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(h.layer);
    expect(h.layer.querySelector('#realm-racers-hud .rally-standing')).toBeNull();

    const rows = [...panel.querySelectorAll('.rally-standing')];
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.querySelector('.rally-standing-name')?.textContent)).toEqual([
      'Aster',
      'Briar',
      'Cass',
      'Dell',
    ]);
    expect(rows.map((row) => row.querySelector('.rally-standing-place')?.textContent)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    const crests = rows.map((row) => row.querySelector('.rally-standing-crest'));
    expect(crests.every((crest) => crest !== null)).toBe(true);
    // The right-hand column is the LAP, which is what says who is a lap down.
    const laps = rows.map((row) => row.querySelector('.rally-standing-lap')?.textContent);
    expect(laps[0]).toBe(t('hudChrome.rally.lap', { lap: '1', total: '3' }));
    expect(laps[1]).toBe(t('hudChrome.rally.lap', { lap: '2', total: '3' }));
    expect(rows[0].classList.contains('me')).toBe(true);
    expect(rows[1].classList.contains('me')).toBe(false);
    // No distance and no tier badge: both were noise a pilot had to decode.
    expect(panel.querySelector('.rally-standing-gap')).toBeNull();
    expect(panel.querySelector('.rally-standing-tier')).toBeNull();
  });

  it('keeps the viewer marker in its own cell, so a long name cannot eat it', () => {
    const h = harness();
    const me = racer({ pid: 1, name: 'A Very Long Pilot Name Indeed', position: 1 });
    h.info.match = match({ phase: 'racing', me, standings: [me] });
    h.ui.update();
    const row = h.layer.querySelector('.rally-standing') as HTMLElement;
    // The name and the marker are SEPARATE elements. Only the name truncates,
    // so the marker survives however long the name is; when they shared one
    // string the ellipsis ate the marker first.
    expect(row.querySelector('.rally-standing-name')?.textContent).toBe(
      'A Very Long Pilot Name Indeed',
    );
    expect(row.querySelector('.rally-standing-you')?.textContent).toBe(
      t('hudChrome.rally.standingsYou'),
    );
    // And a rival's row carries the empty cell, which the stylesheet collapses.
    const rival = racer({ pid: 2, name: 'Briar', position: 2 });
    h.info.match = match({ phase: 'racing', me, standings: [me, rival] });
    h.ui.update();
    const rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows[1].querySelector('.rally-standing-you')?.textContent).toBe('');
  });

  it('reuses one node per pilot and only re-parents the rows that moved', () => {
    const h = harness();
    const me = racer({ pid: 1, name: 'Aster', position: 1 });
    const rival = racer({ pid: 2, name: 'Briar', cls: 'mage', position: 2 });
    h.info.match = match({ phase: 'racing', me, standings: [me, rival] });
    h.ui.update();
    const before = [...h.layer.querySelectorAll('.rally-standing')];
    const crestBefore = before[0].querySelector('.rally-standing-crest');

    // Briar overtakes Aster. The nodes must be the SAME objects, swapped: a
    // rebuild would destroy them, and a destroyed node cannot animate from
    // where it used to be (nor keep its decoded portrait).
    h.info.match = match({
      phase: 'racing',
      me: { ...me, position: 2 },
      standings: [
        { ...rival, position: 1 },
        { ...me, position: 2 },
      ],
    });
    h.ui.update();
    const after = [...h.layer.querySelectorAll('.rally-standing')];
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(after[1].querySelector('.rally-standing-crest')).toBe(crestBefore);
    // The placing text followed the swap.
    expect(after.map((row) => row.querySelector('.rally-standing-place')?.textContent)).toEqual([
      '1',
      '2',
    ]);
  });

  it('marks the row that gained a place and the one that lost it', () => {
    const h = harness();
    const me = racer({ pid: 1, name: 'Aster', position: 1 });
    const rival = racer({ pid: 2, name: 'Briar', position: 2 });
    h.info.match = match({ phase: 'racing', me, standings: [me, rival] });
    h.ui.update();
    // First paint is not a movement: nobody has moved yet.
    let rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows.some((row) => row.classList.contains('gained'))).toBe(false);
    expect(rows.some((row) => row.classList.contains('lost'))).toBe(false);

    h.info.match = match({
      phase: 'racing',
      me: { ...me, position: 2 },
      standings: [
        { ...rival, position: 1 },
        { ...me, position: 2 },
      ],
    });
    h.ui.update();
    rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows[0].classList.contains('gained')).toBe(true);
    expect(rows[0].classList.contains('lost')).toBe(false);
    expect(rows[1].classList.contains('lost')).toBe(true);

    // A later paint that moves nobody clears both, which is what lets the same
    // keyframe run again on the next overtake.
    h.info.match = match({
      phase: 'racing',
      me: { ...me, position: 2, lap: 2 },
      standings: [
        { ...rival, position: 1 },
        { ...me, position: 2, lap: 2 },
      ],
    });
    h.ui.update();
    rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows.some((row) => row.classList.contains('gained'))).toBe(false);
    expect(rows.some((row) => row.classList.contains('lost'))).toBe(false);
  });

  it('draws each pilot their own class portrait, not one shared crest', () => {
    const h = harness();
    const me = racer({ pid: 1, cls: 'warrior', position: 1 });
    h.info.match = match({
      phase: 'racing',
      me,
      standings: [me, racer({ pid: 2, name: 'Briar', cls: 'mage', position: 2 })],
    });
    h.ui.update();
    const crests = [...h.layer.querySelectorAll('.rally-standing-crest')] as HTMLImageElement[];
    expect(crests).toHaveLength(2);
    expect(crests[0].src).not.toBe(crests[1].src);
    const keys = iconDataUrlSpy.mock.calls.map((call) => call[1]);
    expect(keys).toContain('class_warrior');
    expect(keys).toContain('class_mage');
  });

  it('redraws a portrait only when the pilot in the row changes class', () => {
    const h = harness();
    const me = racer({ pid: 1, cls: 'warrior', position: 1 });
    h.info.match = match({ phase: 'racing', me, standings: [me] });
    h.ui.update();
    iconDataUrlSpy.mockClear();
    // A lap ticks over: the row repaints, the portrait must not.
    h.info.match = match({
      phase: 'racing',
      me: { ...me, lap: 2 },
      standings: [{ ...me, lap: 2 }],
    });
    h.ui.update();
    expect(iconDataUrlSpy).not.toHaveBeenCalled();
  });

  it('says where a pilot stopped once they are no longer driving', () => {
    const h = harness();
    const me = racer({ position: 2 });
    h.info.match = match({
      phase: 'racing',
      me,
      standings: [
        racer({ pid: 2, name: 'Briar', botTier: 'ace', position: 1, finished: true }),
        me,
        racer({ pid: 4, name: 'Dell', position: 3, retired: true }),
      ],
    });
    h.ui.update();
    const rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows[0].querySelector('.rally-standing-lap')?.textContent).toBe(
      t('hudChrome.rally.standingsFinished'),
    );
    expect(rows[2].querySelector('.rally-standing-lap')?.textContent).toBe(
      t('hudChrome.rally.standingsRetired'),
    );
    expect(rows[2].classList.contains('out')).toBe(true);
  });

  it('takes the panel down with the race, through the class the sheet animates', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const panel = h.layer.querySelector('#realm-racers-standings') as HTMLElement;
    expect(panel.classList.contains('shown')).toBe(true);
    h.info.match = null;
    h.ui.update();
    // A class, not `display`: the stylesheet fades and slides it out, which a
    // display flip would cut off outright.
    expect(panel.classList.contains('shown')).toBe(false);
  });
});

describe('Realm Racers podium', () => {
  const finished = (over: Partial<RallyMatch> = {}): RallyMatch => {
    const field = [
      racer({
        pid: 2,
        name: 'Briar',
        cls: 'mage',
        position: 1,
        finished: true,
        finishSeconds: 64.28,
      }),
      racer({
        pid: 3,
        name: 'Cass',
        cls: 'rogue',
        position: 2,
        finished: true,
        finishSeconds: 67.8,
      }),
      racer({
        pid: 4,
        name: 'Dell',
        cls: 'priest',
        position: 3,
        finished: true,
        finishSeconds: 71.4,
      }),
      racer({ pid: 1, name: 'Aster', position: 4, lap: 2 }),
    ];
    return match({
      phase: 'finished',
      decided: true,
      result: 'lost',
      returnIn: 6,
      me: field[3],
      standings: field,
      ...over,
    });
  };

  it('stays down until the race is decided, then rises', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const podium = h.layer.querySelector('#realm-racers-podium') as HTMLElement;
    expect(podium).not.toBeNull();
    expect(podium.classList.contains('shown')).toBe(false);
    h.info.match = finished();
    h.ui.update();
    expect(podium.classList.contains('shown')).toBe(true);
  });

  it('stays down for a pilot who quit while the race runs on', () => {
    const h = harness();
    // Their own phase is finished and they are watching a return countdown, but
    // there is no classification: they get their forfeit tableau, not a podium.
    h.info.match = match({ phase: 'finished', decided: false, result: 'forfeit', returnIn: 4 });
    h.ui.update();
    const podium = h.layer.querySelector('#realm-racers-podium') as HTMLElement;
    expect(podium.classList.contains('shown')).toBe(false);
    // ...and the strip keeps saying it, because nothing else will.
    expect(h.layer.querySelector('.rallyhud-phase')?.textContent).toBe(
      t('hudChrome.rally.lostReturn', { seconds: '4' }),
    );
  });

  it('builds three steps with second to the left of first, and lists the rest', () => {
    const h = harness();
    h.info.match = finished();
    h.ui.update();
    const steps = [...h.layer.querySelectorAll('.rally-podium-step')];
    expect(steps.map((step) => step.querySelector('.rally-podium-name')?.textContent)).toEqual([
      'Cass',
      'Briar',
      'Dell',
    ]);
    expect(steps.map((step) => step.querySelector('.rally-podium-place')?.textContent)).toEqual([
      '2',
      '1',
      '3',
    ]);
    // The block heights are the podium, so the placing must reach the class.
    expect(steps[1].classList.contains('p1')).toBe(true);
    const rest = [...h.layer.querySelectorAll('.rally-podium-row')];
    expect(rest).toHaveLength(1);
    expect(rest[0].querySelector('.rally-podium-name')?.textContent).toBe('Aster');
    expect(rest[0].classList.contains('me')).toBe(true);
  });

  it('shows a race time for a finisher and a lap for the pilot the flag caught', () => {
    const h = harness();
    h.info.match = finished();
    h.ui.update();
    const steps = [...h.layer.querySelectorAll('.rally-podium-step')];
    // 64.28 s floors to 1:04.2, never rounds up: a time that rounds up can read
    // as slower than the machine that actually finished behind it.
    expect(steps[1].querySelector('.rally-podium-time')?.textContent).toBe(
      t('hudChrome.rally.podiumTime', { minutes: '1', seconds: '04', tenths: '2' }),
    );
    const rest = h.layer.querySelector('.rally-podium-row');
    expect(rest?.querySelector('.rally-podium-time')?.textContent).toBe(
      t('hudChrome.rally.lap', { lap: '2', total: '3' }),
    );
  });

  it('carries the headline and counts the return down without rebuilding', () => {
    const h = harness();
    h.info.match = finished();
    h.ui.update();
    const podium = h.layer.querySelector('#realm-racers-podium') as HTMLElement;
    const stepsBefore = [...podium.querySelectorAll('.rally-podium-step')];
    expect(podium.querySelector('.rally-podium-return')?.textContent).toBe(
      t('hudChrome.rally.lostReturn', { seconds: '6' }),
    );
    // The strip's own phase line stands down, so the sentence lives in one place.
    expect(h.layer.querySelector('.rallyhud-phase')?.textContent).toBe('');

    h.info.match = finished({ returnIn: 3 });
    h.ui.update();
    expect(podium.querySelector('.rally-podium-return')?.textContent).toBe(
      t('hudChrome.rally.lostReturn', { seconds: '3' }),
    );
    // The ceremony was NOT rebuilt: a countdown that restarts the entrance six
    // times is not a ceremony.
    expect([...podium.querySelectorAll('.rally-podium-step')]).toEqual(stepsBefore);
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
      me: racer({ lap: 3, finished: true }),
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
