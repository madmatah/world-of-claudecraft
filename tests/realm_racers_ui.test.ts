// @vitest-environment jsdom
//
// The Realm Racers window/strip lifecycle. The queue window used to stay
// centered over the viewport through the whole countdown and race, and the only
// forfeit control lived inside it, so closing it left no way out of a race.

import { readFileSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The PODIUM portrait is the party frames' class crest, whose procedural path
// needs a real 2D canvas jsdom does not provide. The strip only ever needs a
// string, so the same hoisted spy the party-frames suite uses stands in, and it
// also lets a test assert which surfaces do and do not reach the crest call:
// the podium does, the live standings panel deliberately no longer does.
const iconDataUrlSpy = vi.hoisted(() => vi.fn((_kind: string, key: string) => `data:${key}`));
vi.mock('../src/ui/icons', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/icons')>()),
  iconDataUrl: iconDataUrlSpy,
}));

import * as THREE from 'three';
import { audio } from '../src/game/audio';
import {
  arrivalCoverActive,
  arrivalCoverDepthForTest,
  resetArrivalCoverForTest,
  setArrivalCover,
} from '../src/render/arrival_cover';
import {
  RealmRacersPrepare,
  type RealmRacersPrepareClient,
} from '../src/render/realm_racers_prepare';
import { REALM_RACERS_PRACTICE_CIRCUIT_ID } from '../src/sim/content/realm_racers_circuits';
import type { SimEvent } from '../src/sim/types';
import { dispatchCollectionAction } from '../src/ui/collection_actions_core';
import { durationText } from '../src/ui/duration_text';
import {
  applyRealmRacersEventPresentation,
  predictRallySlickDrop,
  REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS,
  rallyAimCaster,
  refuseLockedAbility,
} from '../src/ui/hud/realm_racers';
import { ensureLocaleLoaded, setLanguage, type TranslationKey, t } from '../src/ui/i18n';
import {
  dispatchInterfaceVisibilityAction,
  InterfaceVisibility,
} from '../src/ui/interface_visibility_core';
import { makeWriterFacet } from '../src/ui/painter_host';
import { RealmRacersUi } from '../src/ui/realm_racers';
import { realmRacersCircuitName } from '../src/ui/realm_racers_circuit_i18n';
import { RALLY_RACE_ON_CLASS } from '../src/ui/root_state_classes';
import type { IWorld, RealmRacersInfo } from '../src/world_api';
import { stripComments } from './helpers/strip_comments';

type RallyMatch = NonNullable<RealmRacersInfo['match']>;
type RallyRacer = RallyMatch['standings'][number];

beforeEach(() => {
  resetArrivalCoverForTest();
});

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
    elapsedTicks: 0,
    chaseIn: 0,
    speed: 0,
    wrongWay: false,
    offTrackIn: 0,
    cutReturned: false,
    pickupsTaken: [],
    slicks: [],
    warded: false,
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
    queueViable: true,
  };
  const forfeitRealmRacers = vi.fn();
  const resetRealmRacersPosition = vi.fn();
  const startRealmRacersPractice = vi.fn();
  const readyRealmRacers = vi.fn();
  const countdownTick = vi.fn();
  const showBanner = vi.fn();
  const clearPickupSplash = vi.fn();
  const touch = { value: false };
  const prepared = { done: 1, total: 1, settled: true };
  // Hud's production wiring reads `this.renderer.realmRacers.prepare.progress`;
  // a test swaps the source the way replaceRenderer swaps the renderer.
  const source = {
    progress: (
      out: { done: number; total: number; settled: boolean },
      _circuitId?: string,
      _matchId?: number,
    ) => Object.assign(out, prepared),
  };
  const clock = { now: 0 };
  const link = { dropped: false };
  const restoreFocus = vi.fn();
  const world = {
    realmRacersInfo: info,
    joinRealmRacersQueue: vi.fn(),
    leaveRealmRacersQueue: vi.fn(),
    forfeitRealmRacers,
    resetRealmRacersPosition,
    startRealmRacersPractice,
    readyRealmRacers,
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
    showBanner,
    clearPickupSplash,
    writers: makeWriterFacet(new Map(), new Map(), new Map(), new Map(), noop, noop),
    prepareProgress: (out, circuitId, matchId) => source.progress(out, circuitId, matchId),
    connectionDropped: () => link.dropped,
    now: () => clock.now,
    // The real cover, as the HUD parts wire it, so the depth tests read it.
    setArrivalCover,
  });
  /** One HUD frame: the ready send above the paint cut, then the paint. */
  const frame = (): void => {
    ui.sendReady();
    ui.update();
  };
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
    showBanner,
    clearPickupSplash,
    startRealmRacersPractice,
    readyRealmRacers,
    forfeitButton,
    touch,
    prepared,
    source,
    clock,
    link,
    frame,
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

  it('offers no Play button, and says why, when the realm runs out mid-setup', () => {
    // The front-screen button is disabled while nothing is available, so the
    // one way to see this screen without a copy left is to be ON it when the
    // last one goes out; availability rides the setup signature, so the flip
    // repaints on its own.
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    expect(playButton(h.root)).not.toBeNull();
    h.info.practiceAvailable = false;
    h.ui.update();
    expect(playButton(h.root)).toBeNull();
    expect(h.root.textContent).toContain(t('hudChrome.rally.practiceUnavailable'));
  });

  it('names the circuit practice runs, and says competition draws its own', () => {
    // The pool's trade, stated rather than discovered: a player learns the
    // machine on a circuit no queued race will ever put them on.
    const h = harness();
    h.ui.toggle();
    practiceButton(h.root)?.click();
    const line = h.root.querySelector('.rally-setup-circuit') as HTMLElement | null;
    expect(line).not.toBeNull();
    expect(line?.textContent).toBe(
      t('hudChrome.rally.practiceCircuit', {
        circuit: realmRacersCircuitName(REALM_RACERS_PRACTICE_CIRCUIT_ID) as string,
      }),
    );
    // Anchored to literals as well as to the round trip: the `toBe` above moves
    // with the catalog on any copy edit, so these are what prove the
    // placeholder really interpolated and that the sentence still makes the
    // pool's trade rather than merely naming a circuit.
    expect(line?.textContent).toContain('Evergarden Bootcamp');
    expect(line?.textContent).toContain('Competition draws its own');
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

  it('disables the front-screen practice button when the realm has no copy left', () => {
    // The setup screen's Play control already honors availability; the button
    // that LEADS there honors the same flag, or it is a two-click way to
    // learn "no".
    const h = harness();
    h.info.practiceAvailable = false;
    h.ui.toggle();
    const open = practiceButton(h.root);
    expect(open).not.toBeNull();
    expect(open?.disabled).toBe(true);
    open?.click();
    expect(tierButtons(h.root)).toHaveLength(0);
    // A copy comes back: availability rides the window signature, so the
    // button repaints enabled without anything else moving.
    h.info.practiceAvailable = true;
    h.ui.update();
    expect(practiceButton(h.root)?.disabled).toBe(false);
  });

  it('disables practice for a queued player on the same availability', () => {
    const h = harness();
    h.info.queued = true;
    h.info.queuePosition = 1;
    h.info.queueSize = 2;
    h.info.practiceAvailable = false;
    h.ui.toggle();
    expect(practiceButton(h.root)?.disabled).toBe(true);
  });

  it('disables the join button where the queue can never seat a race', () => {
    // The offline world: no bot backfill and one human, so the queue would
    // hold the player forever. The button stays visible but disabled, the
    // status line says why, and practice stays the live path onto the circuit.
    const h = harness();
    h.info.queueViable = false;
    h.ui.toggle();
    const join = h.root.querySelector<HTMLButtonElement>('[data-rally-join]');
    expect(join).not.toBeNull();
    expect(join?.disabled).toBe(true);
    expect(h.root.textContent).toContain(t('hudChrome.rally.queueNeedsRealm'));
    expect(practiceButton(h.root)?.disabled).toBe(false);
    // Viability rides the window signature, so an online mirror flipping it
    // back repaints the button enabled without anything else moving.
    h.info.queueViable = true;
    h.ui.update();
    expect(h.root.querySelector<HTMLButtonElement>('[data-rally-join]')?.disabled).toBe(false);
  });

  it('marks body while a race is on, from the grid to the result, and clears it after', () => {
    document.body.classList.remove(RALLY_RACE_ON_CLASS);
    const h = harness();
    const on = (): boolean => document.body.classList.contains(RALLY_RACE_ON_CLASS);
    h.ui.update();
    expect(on()).toBe(false);
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase });
      h.ui.update();
      expect(on(), phase).toBe(true);
    }
    h.info.match = null;
    h.ui.update();
    expect(on()).toBe(false);
    // A HUD torn down mid-race must not strand the class on the page.
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    h.ui.dispose();
    expect(on()).toBe(false);
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

  it('paints a party-frame row per machine: placing, name, lap', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const panel = h.layer.querySelector('#realm-racers-standings') as HTMLElement;
    // Its OWN panel, not a block inside the centred strip: it lives in the
    // top-left corner where the party frames do.
    expect(panel).not.toBeNull();
    expect(panel.parentElement).toBe(h.layer);
    // A plain ordered list: a live-region role on it would replace the list
    // role its rows need (the axe listitem rule).
    expect(panel.tagName).toBe('OL');
    expect(panel.getAttribute('role')).toBeNull();
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
    // The right-hand column is the LAP, which is what says who is a lap down.
    const laps = rows.map((row) => row.querySelector('.rally-standing-lap')?.textContent);
    expect(laps[0]).toBe(t('hudChrome.rally.lap', { lap: '1', total: '3' }));
    expect(laps[1]).toBe(t('hudChrome.rally.lap', { lap: '2', total: '3' }));
    expect(rows[0].classList.contains('me')).toBe(true);
    expect(rows[1].classList.contains('me')).toBe(false);
    // No distance and no tier badge: both were noise a pilot had to decode. Nor
    // a class portrait, which decorated the row at the NAME's expense on a panel
    // whose scarce resource is width; the podium keeps its crests.
    expect(panel.querySelector('.rally-standing-gap')).toBeNull();
    expect(panel.querySelector('.rally-standing-tier')).toBeNull();
    expect(panel.querySelector('.rally-standing-crest')).toBeNull();
    expect(panel.querySelector('img')).toBeNull();
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
    const nameBefore = before[0].querySelector('.rally-standing-name');

    // Briar overtakes Aster. The nodes must be the SAME objects, swapped: a
    // rebuild would destroy them, and a destroyed node cannot animate from
    // where it used to be.
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
    expect(after[1].querySelector('.rally-standing-name')).toBe(nameBefore);
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

  it('resolves no class portrait at all while a race is running', () => {
    const h = harness();
    const me = racer({ pid: 1, cls: 'warrior', position: 1 });
    iconDataUrlSpy.mockClear();
    h.info.match = match({
      phase: 'racing',
      me,
      standings: [me, racer({ pid: 2, name: 'Briar', cls: 'mage', position: 2 })],
    });
    h.ui.update();
    // The witness FIRST: every assertion below is a negative, and a negative is
    // vacuous if nothing painted. Prove the two rows really are there, then
    // prove what they do not contain.
    const rows = [...h.layer.querySelectorAll('.rally-standing')];
    expect(rows.map((row) => row.querySelector('.rally-standing-name')?.textContent)).toEqual([
      'Aster',
      'Briar',
    ]);
    // The class is what the pilot LOOKS like in the seat and has no effect on
    // the machine, so the panel spends none of its scarce width on a crest and
    // none of the frame's work resolving one. A grid of two different classes
    // must reach the icon path for neither: the podium is the only rally
    // surface that still draws class art, and no podium is up mid-race.
    expect(h.layer.querySelector('.rally-standing-crest')).toBeNull();
    const keys = iconDataUrlSpy.mock.calls.map((call) => call[1]);
    expect(keys).not.toContain('class_warrior');
    expect(keys).not.toContain('class_mage');

    // And a lap ticking over repaints the row without reaching it either. The
    // repaint has to be witnessed too: an unmoved signature would paint nothing
    // and pass the spy assertion while proving nothing at all.
    iconDataUrlSpy.mockClear();
    h.info.match = match({
      phase: 'racing',
      me: { ...me, lap: 2 },
      standings: [{ ...me, lap: 2 }, racer({ pid: 2, name: 'Briar', cls: 'mage', position: 2 })],
    });
    h.ui.update();
    expect(rows[0].querySelector('.rally-standing-lap')?.textContent).toBe(
      t('hudChrome.rally.lap', { lap: '2', total: '3' }),
    );
    expect(iconDataUrlSpy).not.toHaveBeenCalled();
  });

  it('tags a house pilot with the Bot badge, and no human row', () => {
    const h = harness();
    const me = racer({ position: 1 });
    h.info.match = match({
      phase: 'racing',
      me,
      standings: [me, racer({ pid: 2, name: 'Briar', botTier: 'rookie', position: 2 })],
    });
    h.ui.update();
    const badges = [...h.layer.querySelectorAll('.rally-standing-bot')] as HTMLElement[];
    // Every row carries the cell (the pooled skeleton is uniform); only the
    // house pilot's says anything, and the stylesheet collapses the empty one.
    expect(badges).toHaveLength(2);
    expect(badges[0].textContent).toBe('');
    // The game's ONE AI badge, mirrored onto the title so hover says it too.
    expect(badges[1].textContent).toBe(t('hudChrome.rally.standingsBot'));
    expect(badges[1].getAttribute('title')).toBe(t('hudChrome.rally.standingsBot'));
    // The badge says WHO IS NOT HUMAN, never the tier: that pin (above) holds
    // for a bot-backfilled grid too.
    expect(h.layer.querySelector('.rally-standing-tier')).toBeNull();

    // A human taking the seat back clears the tag on the SAME pooled node.
    h.info.match = match({
      phase: 'racing',
      me,
      standings: [me, racer({ pid: 2, name: 'Briar', position: 2 })],
    });
    h.ui.update();
    const after = [...h.layer.querySelectorAll('.rally-standing-bot')] as HTMLElement[];
    expect(after[1]).toBe(badges[1]);
    expect(after[1].textContent).toBe('');
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

  it('says a voided race is void to a quitter too, with no podium and no winner', () => {
    const quitter = harness();
    quitter.info.match = match({
      phase: 'finished',
      decided: true,
      voided: true,
      result: 'forfeit',
      returnIn: 5,
    });
    quitter.ui.update();
    const quitterPodium = quitter.layer.querySelector('#realm-racers-podium') as HTMLElement;
    expect(quitterPodium.classList.contains('shown')).toBe(false);
    expect(quitter.layer.querySelector('.rallyhud-phase')?.textContent).toBe(
      t('hudChrome.rally.voidReturn', { seconds: '5' }),
    );
    quitter.ui.toggle();
    expect(quitter.root.querySelector('.rally-status')?.textContent).toBe(
      t('hudChrome.rally.raceVoid'),
    );
  });

  it('says a voided race is void, with no podium and no winner', () => {
    const h = harness();
    h.info.match = match({
      phase: 'finished',
      decided: true,
      voided: true,
      result: 'void',
      returnIn: 5,
    });
    h.ui.update();
    const podium = h.layer.querySelector('#realm-racers-podium') as HTMLElement;
    expect(podium.classList.contains('shown')).toBe(false);
    expect(h.layer.querySelector('.rallyhud-phase')?.textContent).toBe(
      t('hudChrome.rally.voidReturn', { seconds: '5' }),
    );
    h.ui.toggle();
    expect(h.root.querySelector('.rally-status')?.textContent).toBe(t('hudChrome.rally.raceVoid'));
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

  it('draws every pilot their own class crest here, the one rally surface that does', () => {
    // The POSITIVE half of the standings' "resolves no class portrait" pin. The
    // live panel dropped its crests to buy back name width; the podium keeps
    // them, and that half has to be asserted rather than claimed in a comment,
    // or a later sweep that removes the crest "everywhere for consistency" goes
    // green. Pinned to literal keys (the mock renders `data:${key}`), so each
    // pilot's OWN class has to reach the icon call, not one shared crest.
    const h = harness();
    h.info.match = finished();
    h.ui.update();
    const steps = [...h.layer.querySelectorAll('.rally-podium-crest')] as HTMLImageElement[];
    expect(steps.map((img) => img.getAttribute('src'))).toEqual([
      'data:class_rogue',
      'data:class_mage',
      'data:class_priest',
    ]);
    // And the rows listed under the blocks carry theirs too, at the roster size.
    const rest = [...h.layer.querySelectorAll('.rally-podium-row-crest')] as HTMLImageElement[];
    expect(rest.map((img) => img.getAttribute('src'))).toEqual(['data:class_warrior']);
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

// DESIGN.md section 8.1: the window rides the shared window family (the frame,
// the 44px head, the gold title, the subtitle and the shared close control), so
// its own section keeps geometry and the body, never the frame's look.
describe('Realm Racers window on the window family', () => {
  it('ships the root on the family in both game entries', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(entry, 'utf8');
      expect(html, entry).toContain(
        '<div id="realm-racers-window" class="window panel ui-window"></div>',
      );
    }
  });

  it('builds the head from the family on both screens, named by the title alone', () => {
    const h = harness();
    h.ui.toggle();
    const head = (): HTMLElement => h.root.querySelector('.panel-title') as HTMLElement;
    for (const screen of ['front', 'setup'] as const) {
      if (screen === 'setup') {
        (h.root.querySelector('[data-rally-practice-open]') as HTMLButtonElement).click();
        expect(h.root.querySelector('[data-rally-practice-back]'), screen).not.toBeNull();
      }
      expect(head().classList.contains('ui-win-head'), screen).toBe(true);
      const title = head().querySelector('.ui-win-title') as HTMLElement;
      expect(title.querySelector('#realm-racers-title')?.textContent, screen).toBe(
        t('hudChrome.rally.title'),
      );
      // The society line is the subtitle, outside the element the dialog is
      // named by, so the window's accessible name stays the game's name.
      const sub = title.querySelector('.ui-win-sub') as HTMLElement;
      expect(sub.textContent, screen).toBe(t('hudChrome.rally.kicker'));
      expect(sub.closest('#realm-racers-title'), screen).toBeNull();
      expect(head().querySelector('[data-close]')?.className, screen).toBe('x-btn ui-x-btn');
    }
  });

  it('keeps the frame look off its own section and scrolls the body itself', () => {
    const css = readFileSync('src/styles/components.css', 'utf8');
    const at = css.indexOf('  #realm-racers-window {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).not.toMatch(/border-color|box-shadow|background|border-radius|outline/);
    // The family frame clips its overflow; a tall setup screen on a short
    // window must still scroll, as it did on the legacy frame.
    expect(rule).toMatch(/overflow-y:\s*auto;/);
    expect(css).not.toContain('#realm-racers-window > .panel-title {');
    expect(css).not.toMatch(/\.rally-kicker \{/);
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

  it('takes the pickup splash down on the frame the race view disappears', () => {
    // A splash lives about a second on its own timer, and a forfeit can end a
    // race under one: the falling match edge clears it so it cannot outlive
    // the race that produced it.
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    expect(h.clearPickupSplash).not.toHaveBeenCalled();
    h.info.match = null;
    h.ui.update();
    expect(h.clearPickupSplash).toHaveBeenCalledTimes(1);
    // An edge, not a level: an idle frame must not re-clear forever.
    h.ui.update();
    expect(h.clearPickupSplash).toHaveBeenCalledTimes(1);
    // And it re-arms for the next race.
    h.info.match = match({ id: 9, phase: 'racing' });
    h.ui.update();
    h.info.match = null;
    h.ui.update();
    expect(h.clearPickupSplash).toHaveBeenCalledTimes(2);
  });
});

describe('Realm Racers strip forfeit control', () => {
  // The arm window runs on the injected client clock (`deps.now`), the one the
  // lobby failsafe runs on, never the wall clock.
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

    h.clock.now += 1000;
    button?.click();
    expect(h.forfeitRealmRacers).toHaveBeenCalledTimes(1);
  });

  it('re-arms instead of forfeiting once the arm window has lapsed', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing' });
    h.ui.update();
    const button = h.forfeitButton();

    button?.click();
    h.clock.now += 3001;
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

  it('shows the ward with the seconds it has left, and hides it once it is gone', () => {
    const h = harness();
    h.info.match = match({ phase: 'racing', warded: true, wardIn: 7 });
    h.ui.update();
    const chip = h.layer.querySelector('.rallyhud-ward') as HTMLElement;
    expect(chip.textContent).toBe(t('hudChrome.rally.wardHeldFor', { seconds: '7' }));
    expect(chip.textContent).toBe('WARD 7');
    expect(chip.style.display).toBe('block');
    h.info.match = match({ phase: 'racing', warded: true, wardIn: 1 });
    h.ui.update();
    expect(h.layer.querySelector('.rallyhud-ward')).toBe(chip);
    expect(chip.textContent).toBe(t('hudChrome.rally.wardHeldFor', { seconds: '1' }));
    // A mirror that has not carried the count yet still shows the ward.
    h.info.match = match({ phase: 'racing', warded: true });
    h.ui.update();
    expect(chip.textContent).toBe(t('hudChrome.rally.wardHeld'));
    expect(chip.style.display).toBe('block');
    h.info.match = match({ phase: 'racing', warded: false });
    h.ui.update();
    expect(chip.style.display).toBe('none');
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

describe('Realm Racers loading lobby ready', () => {
  const lobby = (secondsLeft: number, readyIds: number[]) =>
    match({
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      loading: { secondsLeft, readyIds },
    });

  it('tells the lobby it is ready once per due key, and again after the server drops it', () => {
    const h = harness();
    h.info.match = lobby(15, [2, 3, 4]);
    h.frame();
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    h.info.match = lobby(15, [1, 2, 3, 4]);
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    // A linkdead resume: the server cleared the flag, so the same second sends again.
    h.info.match = lobby(15, [2, 3, 4]);
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(2);
    h.info.match = match({ phase: 'countdown' });
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(2);
  });

  it('sends ready from the non-paint half alone, so a hidden window still readies', () => {
    const h = harness();
    h.info.match = lobby(15, [2, 3, 4]);
    h.ui.sendReady();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    expect(h.layer.querySelector('#realm-racers-lobby')).toBeNull();
    h.ui.update();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
  });

  it('never reads the preparation outside the lobby', () => {
    const h = harness();
    const progress = vi.spyOn(h.source, 'progress');
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase });
      h.frame();
    }
    h.info.match = null;
    h.frame();
    expect(progress).not.toHaveBeenCalled();
    h.info.match = lobby(15, [2, 3, 4]);
    h.frame();
    expect(progress).toHaveBeenCalled();
    // ...for the lobby's own circuit and match, so a new lobby on a circuit
    // already prepared never reads the last lobby's verdict.
    const lobbyMatch = h.info.match as NonNullable<typeof h.info.match>;
    for (const call of progress.mock.calls) {
      expect(call.slice(1)).toEqual([lobbyMatch.circuitId, lobbyMatch.id]);
    }
  });
});

/** A race preparation client whose gate the test settles by hand. */
function gatedSeam() {
  const pending: (() => void)[] = [];
  const host = {
    worldCompileGate: () => () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
    webgl: { properties: { get: () => undefined } },
  };
  const client: RealmRacersPrepareClient = {
    prepareId: 'probe',
    built: false,
    prepare: () => new THREE.Group(),
  };
  const seam = new RealmRacersPrepare([client]);
  return {
    seam,
    start: () => seam.frame(host, { queued: false, match: { practice: false } }, 0, 0),
    settle: async () => {
      for (const resolve of pending.splice(0)) resolve();
      await new Promise((done) => setTimeout(done, 0));
    },
  };
}

describe('Realm Racers lobby ready through the renderer seam', () => {
  const lobby = (secondsLeft: number) =>
    match({
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      loading: { secondsLeft, readyIds: [2, 3, 4] },
    });

  it('says nothing while the seam prepares and exactly once after it settles', async () => {
    const h = harness();
    const a = gatedSeam();
    h.source.progress = (out) => a.seam.progress(out);
    h.info.match = lobby(15);
    h.frame();
    a.start();
    for (let i = 0; i < 10; i++) h.frame();
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    expect(arrivalCoverDepthForTest()).toBe(1);
    await a.settle();
    for (let i = 0; i < 10; i++) h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    expect(arrivalCoverDepthForTest()).toBe(0);
  });

  it('waits for a rebuilt renderer seam, and never stacks the cover', async () => {
    const h = harness();
    const a = gatedSeam();
    h.source.progress = (out) => a.seam.progress(out);
    h.info.match = lobby(15);
    a.start();
    h.frame();
    await a.settle();
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    // A graphics rebuild mid-lobby: Hud now reads the new renderer's seam.
    const b = gatedSeam();
    h.source.progress = (out) => b.seam.progress(out);
    // The server has not answered yet, so the viewer is still unlisted.
    h.info.match = lobby(14);
    const depths: number[] = [];
    for (let i = 0; i < 10; i++) {
      h.frame();
      depths.push(arrivalCoverDepthForTest());
      if (i === 2) b.start();
    }
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
    await b.settle();
    h.frame();
    depths.push(arrivalCoverDepthForTest());
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(2);
    expect(Math.max(...depths)).toBe(1);
    expect(depths.at(-1)).toBe(0);
  });

  it('keeps a pilot whose gate never settles unready: only the server cap moves them on', () => {
    const h = harness();
    const stuck = gatedSeam();
    h.source.progress = (out) => stuck.seam.progress(out);
    stuck.start();
    for (let seconds = 15; seconds >= 1; seconds--) {
      h.info.match = lobby(seconds);
      h.clock.now += 1_000;
      h.frame();
    }
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    const status = h.layer.querySelector('.rally-lobby-status');
    expect(status?.textContent).toBe(t('hudChrome.rally.lobbyWaiting'));
    h.info.match = match({ phase: 'countdown' });
    h.frame();
    expect(h.layer.querySelector('#realm-racers-lobby')?.classList.contains('shown')).toBe(false);
    expect(arrivalCoverActive()).toBe(false);
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
  });
});

describe('Realm Racers loading lobby curtain', () => {
  const lobby = (readyIds: number[], secondsLeft = 12) =>
    match({
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      circuitId: 'evergarden_express_tour',
      loading: { secondsLeft, readyIds },
    });
  const curtain = (h: ReturnType<typeof harness>): HTMLElement | null =>
    h.layer.querySelector('#realm-racers-lobby');
  const shown = (h: ReturnType<typeof harness>): boolean =>
    curtain(h)?.classList.contains('shown') ?? false;
  const statuses = (h: ReturnType<typeof harness>): string[] =>
    [...h.layer.querySelectorAll('.rally-lobby-status')].map((el) => el.textContent ?? '');
  const toggleDeeds = vi.fn();
  const collections = {
    toggleDeeds,
    toggleProfessions: vi.fn(),
    toggleReliquary: vi.fn(),
    toggleCosmetics: vi.fn(),
    toggleHarvestJournal: vi.fn(),
    togglePerfecting: vi.fn(),
    toggleLootExplorer: vi.fn(),
    toggleRealmRacers: vi.fn(),
  };

  afterEach(async () => {
    setLanguage('en');
  });

  it('covers the world through the lobby and lifts on the countdown, for every pilot', () => {
    const h = harness();
    h.prepared.done = 0;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    const el = curtain(h);
    expect(shown(h)).toBe(true);
    expect(el).toBe(h.layer.firstElementChild);
    expect(el?.getAttribute('role')).toBe('dialog');
    // Not modal: the chat frame sits outside it and must stay reachable.
    expect(el?.hasAttribute('aria-modal')).toBe(false);
    expect(el?.getAttribute('aria-labelledby')).toBe('rally-lobby-circuit');
    expect(el?.querySelector('.rally-lobby-circuit')?.textContent).toBe('Evergarden Express Tour');
    expect(statuses(h)).toEqual([
      t('hudChrome.rally.lobbyWaiting'),
      t('hudChrome.rally.lobbyReady'),
      t('hudChrome.rally.lobbyReady'),
      t('hudChrome.rally.lobbyReady'),
    ]);
    // This client's own readiness never lifts it: the server's phase does.
    h.prepared.done = 1;
    h.prepared.settled = true;
    h.info.match = lobby([1, 2, 3, 4]);
    h.frame();
    expect(shown(h)).toBe(true);
    expect(statuses(h)[0]).toBe(t('hudChrome.rally.lobbyReady'));
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.frame();
    expect(shown(h)).toBe(false);
  });

  it('holds the arrival cover only while this machine prepares', () => {
    const h = harness();
    h.prepared.done = 0;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    h.frame();
    expect(arrivalCoverDepthForTest()).toBe(1);
    // Settled: the depth goes while the curtain stays, so the background
    // lanes the cover refuses run behind it rather than in the countdown.
    h.prepared.done = 1;
    h.prepared.settled = true;
    h.frame();
    expect(shown(h)).toBe(true);
    expect(arrivalCoverDepthForTest()).toBe(0);
    h.info.match = match({ phase: 'countdown' });
    h.frame();
    expect(arrivalCoverDepthForTest()).toBe(0);
  });

  it('keeps one depth through a repeated lobby snapshot and drops it on the countdown', () => {
    const h = harness();
    h.prepared.done = 0;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    for (let i = 0; i < 20; i++) {
      h.frame();
      expect(arrivalCoverDepthForTest()).toBe(1);
    }
    h.info.match = match({ phase: 'countdown' });
    h.frame();
    expect(arrivalCoverDepthForTest()).toBe(0);
  });

  it("paints this machine's preparation as an accessible bar", () => {
    const h = harness();
    h.prepared.done = 1;
    h.prepared.total = 4;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    const bar = h.layer.querySelector('.rally-lobby-bar') as HTMLElement;
    const fill = h.layer.querySelector('.rally-lobby-fill') as HTMLElement;
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    const label = document.getElementById(bar.getAttribute('aria-labelledby') ?? '');
    expect(label?.textContent).toBe(t('hudChrome.rally.lobbyPreparing'));
    expect(fill.style.width).toBe('25%');
    h.prepared.done = 4;
    h.prepared.settled = true;
    h.frame();
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
    expect(label?.textContent).toBe(t('hudChrome.rally.lobbyPrepared'));
  });

  it('spells the lobby deadline and moves it with the server second', () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4], 12);
    h.frame();
    const deadline = h.layer.querySelector('.rally-lobby-deadline') as HTMLElement;
    const at12 = deadline.textContent;
    expect(at12).toBe(t('hudChrome.rally.lobbyStartsBy', { time: durationText(12) }));
    h.info.match = lobby([2, 3, 4], 11);
    h.frame();
    expect(deadline.textContent).toBe(
      t('hudChrome.rally.lobbyStartsBy', { time: durationText(11) }),
    );
    expect(deadline.textContent).not.toBe(at12);
  });

  it('repaints its statuses in the new language after a switch', async () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    const english = statuses(h)[0];
    await ensureLocaleLoaded('ja_JP');
    setLanguage('ja_JP');
    h.ui.relocalize();
    h.ui.update();
    expect(statuses(h)[0]).toBe(t('hudChrome.rally.lobbyWaiting'));
    expect(statuses(h)[0]).not.toBe(english);
  });

  it('never raises for a reconnect into a race already under way', () => {
    const h = harness();
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase });
      h.frame();
      expect(shown(h), phase).toBe(false);
      expect(arrivalCoverActive(), phase).toBe(false);
      expect(h.ui.lobbyHold.holds('bags'), phase).toBe(false);
    }
  });

  it('holds the window and menu keys while shown, except chat, and releases them on the lift', () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    const host = { ...collections, lobbyHold: h.ui.lobbyHold };
    for (const key of ['bags', 'char', 'spellbook', 'map', 'social', 'interact', 'deeds']) {
      expect(h.ui.lobbyHold.holds(key), key).toBe(true);
    }
    // Chat, Hide Interface and Escape stay live (Escape's game-menu arm reads
    // `shown` in main.ts), and so does everything that is not a window.
    for (const key of ['chat', 'hideInterface', 'escape', 'targetNpcNext', 'slot1', 'petAttack']) {
      expect(h.ui.lobbyHold.holds(key), key).toBe(false);
    }
    expect(h.ui.lobbyHold.shown).toBe(true);
    expect(dispatchCollectionAction('deeds', host)).toBe(true);
    expect(dispatchCollectionAction('bags', host)).toBe(true);
    expect(dispatchCollectionAction('chat', host)).toBe(false);
    expect(toggleDeeds).not.toHaveBeenCalled();
    h.info.match = match({ phase: 'countdown' });
    h.frame();
    expect(h.ui.lobbyHold.shown).toBe(false);
    expect(h.ui.lobbyHold.holds('bags')).toBe(false);
    expect(dispatchCollectionAction('bags', host)).toBe(false);
    expect(dispatchCollectionAction('deeds', host)).toBe(true);
    expect(toggleDeeds).toHaveBeenCalledTimes(1);
  });

  it('steps aside the moment the connection drops, keys and cover included', () => {
    const h = harness();
    h.prepared.done = 0;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    expect(h.ui.lobbyHold.holds('bags')).toBe(true);
    h.link.dropped = true;
    h.frame();
    expect(shown(h)).toBe(false);
    expect(h.ui.lobbyHold.holds('bags')).toBe(false);
    expect(arrivalCoverDepthForTest()).toBe(0);
    // A resume inside the lobby brings the curtain back for the time left.
    h.link.dropped = false;
    h.frame();
    expect(shown(h)).toBe(true);
  });

  it('drops a curtain whose server phase never changes once the announced deadline passes', () => {
    const h = harness();
    h.prepared.done = 0;
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4], 12);
    h.frame();
    expect(shown(h)).toBe(true);
    h.clock.now += 12_000 + REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS;
    h.frame();
    expect(shown(h)).toBe(true);
    h.clock.now += 1;
    h.frame();
    expect(shown(h)).toBe(false);
    expect(h.ui.lobbyHold.holds('bags')).toBe(false);
    expect(arrivalCoverDepthForTest()).toBe(0);
    for (let i = 0; i < 5; i++) h.frame();
    expect(shown(h)).toBe(false);
    // Presentation only: the failsafe never readies anyone.
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
  });

  it('raises the curtain again when a lobby that was frozen starts counting again', () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4], 12);
    h.frame();
    // A stalled client (a background tab): the readout froze past its deadline.
    h.clock.now += 20_000;
    h.frame();
    expect(shown(h)).toBe(false);
    // The lobby is alive: a new, changed second re-arms it.
    h.info.match = lobby([2, 3, 4], 4);
    h.frame();
    expect(shown(h)).toBe(true);
    // And a value that then freezes still expires it.
    h.clock.now += 4_000 + REALM_RACERS_LOBBY_FAILSAFE_GRACE_MS + 1;
    h.frame();
    expect(shown(h)).toBe(false);
  });

  it('leaves a hidden interface recoverable: Escape and Hide Interface stay live, chat too', () => {
    const h = harness();
    const visibility = new InterfaceVisibility(() => {});
    visibility.toggle();
    expect(visibility.hidden).toBe(true);
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    expect(h.ui.lobbyHold.shown).toBe(true);
    const host = { ...collections, lobbyHold: h.ui.lobbyHold };
    // The keyboard path: dispatchCollectionAction first, then the escape arm,
    // which restores the interface before anything else.
    expect(dispatchCollectionAction('escape', host)).toBe(false);
    expect(visibility.show()).toBe(true);
    expect(visibility.hidden).toBe(false);
    expect(dispatchInterfaceVisibilityAction('hideInterface', visibility)).toBe(true);
    expect(dispatchCollectionAction('hideInterface', host)).toBe(false);
    expect(dispatchCollectionAction('chat', host)).toBe(false);
  });

  it('drops its cover and hold when the match goes away under it', () => {
    const h = harness();
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    expect(arrivalCoverActive()).toBe(true);
    h.info.match = null;
    h.frame();
    expect(arrivalCoverActive()).toBe(false);
    expect(h.ui.lobbyHold.holds('bags')).toBe(false);
  });

  it('releases everything on dispose', () => {
    const h = harness();
    h.prepared.settled = false;
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    h.ui.dispose();
    expect(arrivalCoverDepthForTest()).toBe(0);
    expect(h.ui.lobbyHold.holds('bags')).toBe(false);
    expect(curtain(h)).toBeNull();
  });

  it('holds the circuit banner for the lift instead of firing it under the curtain', () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    h.frame();
    expect(h.showBanner).not.toHaveBeenCalled();
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.frame();
    h.frame();
    expect(h.showBanner.mock.calls).toEqual([['Evergarden Express Tour']]);
  });

  it('drops a held banner for a lobby that never reached its countdown', () => {
    const h = harness();
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    h.info.match = null;
    h.frame();
    h.info.match = lobby([2, 3, 4]);
    h.frame();
    h.info.match = match({ phase: 'racing', circuitId: 'evergarden_express_tour' });
    h.frame();
    expect(h.showBanner).not.toHaveBeenCalled();
    expect(arrivalCoverActive()).toBe(false);
  });
});

describe('Realm Racers lobby hold wiring', () => {
  it('gates only the game-menu arm of Escape on the lobby, on both input paths', () => {
    const main = stripComments(readFileSync('src/main.ts', 'utf8'));
    const count = (needle: string) => main.split(needle).length - 1;
    expect(count('if (!hud.closeAll() && !hud.lobbyHold.shown) hud.toggleOptionsMenu();')).toBe(2);
    expect(count('if (!hud.closeAll()) hud.toggleOptionsMenu();')).toBe(0);
    // Both escape arms still restore a hidden interface before anything else.
    expect(count('if (interfaceVisibility.show()) break;')).toBe(1);
    expect(count('if (interfaceVisibility.show()) return;')).toBe(1);
    const hud = stripComments(readFileSync('src/ui/hud.ts', 'utf8'));
    expect(hud.split('readonly lobbyHold = this.realmRacersUi.lobbyHold;').length - 1).toBe(1);
  });
});

describe('the Realm Racers HUD host seams', () => {
  it('stay welded to the Hud members the untyped rally helpers read', () => {
    const hud = stripComments(readFileSync('src/ui/hud.ts', 'utf8'));
    for (const anchor of [
      'private sim: IWorld,',
      'private renderer: Renderer,',
      'private keybinds: Keybinds,',
      'private readonly writerFacet = makeWriterFacet(',
      'private windowFocus(rootSel: string): {',
      'private closeOtherWindows(_keep?: string | string[]): void {',
      'private flashActionSlot(barSlot: number): void {',
      'private combatLog(text: string, color: string = HUD_LOG.PLAIN): void {',
      'showSelfNote(text: string): void {',
      'showError(text: string, logChannel = ERROR_LOG_CHAN, announceWhenFiltered = false): void {',
      'private readonly realmRacersSplash = realmRacersHud.createRealmRacersSplash(this);',
      'private readonly realmRacersUi = new RealmRacersUi(realmRacersHud.realmRacersUiDeps(this));',
      'player: () => realmRacersHud.rallyAimCaster(this),',
      'realmRacersHud.predictRallyGroundBlastFire(this, id, point);',
      'realmRacersHud.predictRallySlickDrop(this, action.id);',
      'if (realmRacersHud.refuseLockedAbility(this, abilityId, slotForAim)) return;',
      'if (realmRacersHud.applyRealmRacersEventPresentation(this, ev)) continue;',
    ]) {
      expect(hud, anchor).toContain(anchor);
    }
    expect(hud).toMatch(/\n {2}log\(\n/);
    expect(hud).toMatch(/\n {2}showBanner\(\n/);
    expect(hud.indexOf('private readonly writerFacet = makeWriterFacet(')).toBeLessThan(
      hud.indexOf('private readonly realmRacersSplash = realmRacersHud.createRealmRacersSplash('),
    );
    expect(hud).not.toContain("case 'realmRacersResult':");
    // The oil cue reads its gate AFTER the cast commits (see the helper's comment).
    const slick = hud.indexOf('realmRacersHud.predictRallySlickDrop(this, action.id);');
    const cast = hud.lastIndexOf('this.sim.castAbility(action.id);', slick);
    expect(cast).toBeGreaterThan(0);
    expect(hud.slice(cast, slick)).not.toContain('}');
  });
});

describe('Realm Racers circuit announcement', () => {
  /** The pill at the head of the race strip: the minigame's name outside a
   *  race, the drawn circuit's name during one. */
  const pill = (h: ReturnType<typeof harness>): HTMLElement =>
    h.layer.querySelector('.rallyhud-title') as HTMLElement;
  /** The off-screen live region that SPEAKS the circuit. */
  const announcer = (h: ReturnType<typeof harness>): HTMLElement =>
    h.layer.querySelector('[data-rally-circuit-announce]') as HTMLElement;

  it('banners the circuit once, on the frame the match appears', () => {
    // Driven from STATE, not from the `realmRacersFound` event: the name is what
    // the banner says, and the circuit rides the snapshot, which online lands
    // one frame after the event. It is the same rising edge that closes the
    // queue window, so it cannot fire twice for one race.
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(h.showBanner.mock.calls).toEqual([['Evergarden Express Tour']]);
    // Every later frame of the same race is silent, including the phase changes
    // that rebuild the strip.
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase, circuitId: 'evergarden_express_tour' });
      h.ui.update();
    }
    expect(h.showBanner).toHaveBeenCalledTimes(1);
  });

  it('banners the NEXT race too, even on the same circuit', () => {
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    h.info.match = null;
    h.ui.update();
    h.info.match = match({ id: 9, phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(h.showBanner.mock.calls).toEqual([
      ['Evergarden Express Tour'],
      ['Evergarden Express Tour'],
    ]);
  });

  it('does not banner a race the viewer joins already under way', () => {
    // A mid-race reconnect restores the HUD; announcing a circuit the pilot has
    // been driving for a minute would be noise, not news.
    const h = harness();
    h.info.match = match({ phase: 'racing', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(h.showBanner).not.toHaveBeenCalled();
  });

  it('banners the raw id for a circuit nothing names', () => {
    // Only reachable for a DRAFT a dev command registered, since every authored
    // circuit is pinned to have a name. A developer reading their own draft id
    // is the whole audience.
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'draft_scratch_1' });
    h.ui.update();
    expect(h.showBanner.mock.calls).toEqual([['draft_scratch_1']]);
  });

  it('carries the drawn circuit in the strip pill, for the WHOLE race', () => {
    // The player did not choose this circuit: the grid filling drew it. The
    // pill is the one piece of strip chrome big enough to say so, and the
    // minigame's own name is not news to somebody already on the grid.
    const h = harness();
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase, circuitId: 'evergarden_express_tour' });
      h.ui.update();
      expect(pill(h).textContent, phase).toBe('Evergarden Express Tour');
    }
  });

  it('keeps the pill on one line, so nothing under it moves', () => {
    // jsdom does no layout, so the box cannot be measured here. What CAN be
    // asserted is the two things that actually keep the readout row still: the
    // text does not change DURING a race (the swap happens once, at seat time,
    // before there is anything to disturb), and the pill is still the element
    // whose stylesheet rule pins nowrap + ellipsis + overflow hidden, so a long
    // circuit name widens and then truncates instead of wrapping to a second
    // line and pushing the row and both tap targets down.
    const h = harness();
    const texts: string[] = [];
    for (const phase of ['countdown', 'racing', 'finished'] as const) {
      h.info.match = match({ phase, circuitId: 'evergarden_express_tour' });
      h.ui.update();
      texts.push(pill(h).textContent ?? '');
      expect(pill(h).classList.contains('rallyhud-title'), phase).toBe(true);
    }
    expect(new Set(texts).size, 'the pill text changed mid-race').toBe(1);
    // And the old separate countdown line is gone, not merely hidden: a second
    // circuit label under the pill would be the layout jump this replaced.
    expect(h.layer.querySelector('.rallyhud-circuit')).toBeNull();
    // The gold "G" medallion is gone with it: it stood for nothing a player
    // could read, and the pill now holds the circuit name alone.
    expect(h.layer.querySelector('.rallyhud-mark')).toBeNull();
  });

  it('follows the draw rather than assuming one circuit', () => {
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(pill(h).textContent).toBe('Evergarden Express Tour');
    // A second race, a different circuit: the strip follows the id it is given.
    h.info.match = match({
      id: 8,
      phase: 'countdown',
      circuitId: REALM_RACERS_PRACTICE_CIRCUIT_ID,
    });
    h.ui.update();
    expect(pill(h).textContent).toBe('Evergarden Bootcamp');
  });

  it('falls back to the minigame title for a circuit nothing names', () => {
    // A draft circuit a dev command registered. A raw id is not copy, and the
    // pill can never be empty, so it keeps the name it had before 13a-2.
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'draft_scratch_1' });
    h.ui.update();
    expect(pill(h).textContent).toBe(t('hudChrome.rally.title'));
    // And nothing is announced, because there is nothing to announce.
    expect(announcer(h).textContent).toBe('');
  });

  it('ANNOUNCES the circuit once per race, and again for the next one', () => {
    // The accessibility half, and the reason this is a node of its own rather
    // than an aria-live on the pill: a screen-reader user would otherwise first
    // learn the circuit at the podium, after the race is over.
    const h = harness();
    h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    const live = announcer(h);
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.getAttribute('role')).toBe('status');
    expect(live.className).toBe('visually-hidden');
    expect(live.textContent).toBe('Evergarden Express Tour');

    // It lives OUTSIDE the strip, so the countdown-to-racing rebuild (which
    // adds the reset control) cannot re-announce by replacing the region.
    expect(live.parentElement).toBe(h.layer);
    h.info.match = match({ phase: 'racing', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(announcer(h), 'the live region was rebuilt: it would re-announce').toBe(live);
    expect(live.textContent).toBe('Evergarden Express Tour');

    // The race ends and the strip goes down: the region clears, so the NEXT
    // race announces even when the draw lands on the same circuit again.
    h.info.match = null;
    h.ui.update();
    expect(live.textContent).toBe('');
    h.info.match = match({ id: 9, phase: 'countdown', circuitId: 'evergarden_express_tour' });
    h.ui.update();
    expect(live.textContent).toBe('Evergarden Express Tour');
  });

  it('heads the podium with the circuit that was raced', () => {
    const h = harness();
    const field = [
      racer({ pid: 2, name: 'Briar', position: 1, finished: true, finishSeconds: 71.2 }),
      racer({ pid: 1, name: 'Aster', position: 2, finished: true, finishSeconds: 74.9 }),
    ];
    h.info.match = match({
      phase: 'finished',
      decided: true,
      result: 'lost',
      circuitId: 'evergarden_express_tour',
      me: field[1],
      standings: field,
    });
    h.ui.update();
    const heading = h.layer.querySelector('.rally-podium-heading') as HTMLElement | null;
    expect(heading?.textContent).toBe('Evergarden Express Tour');
    // It heads the ceremony: nothing else may come before it.
    expect(heading?.previousElementSibling).toBeNull();
  });

  // A runtime language change does not reload the page: it dispatches
  // `woc:languagechange` and the HUD forces one repaint of every open surface
  // (`tests/language_fanout_relocalize.test.ts` owns that contract). The circuit
  // NAME is the one piece of rally copy that reaches three surfaces through
  // three different repaint regimes, which is exactly where one of them can
  // quietly stay English. These live here rather than in the fan-out suite
  // because they need the class-crest icon mock at the top of this file.
  //
  // zh_CN rather than a Latin locale: the circuit names are NEW keys, filled in
  // the five non-Latin locales under exception M16 and still pending elsewhere,
  // and a pending locale falls back to English, which would make every
  // assertion below vacuous.
  describe('a language change reaches every surface that names the circuit', () => {
    const LANG = 'zh_CN';
    beforeAll(async () => {
      await ensureLocaleLoaded(LANG);
    });
    afterEach(() => setLanguage('en'));

    const bilingual = (key: string): { en: string; other: string } => {
      setLanguage('en');
      const en = t(key as TranslationKey);
      setLanguage(LANG);
      const other = t(key as TranslationKey);
      setLanguage('en');
      expect(other, `${key} is untranslated in ${LANG}, so it witnesses nothing`).not.toBe(en);
      return { en, other };
    };

    it('re-localizes the circuit name in the strip pill and the announcer', () => {
      const names = bilingual('hudChrome.rally.circuitName_evergarden_express_tour');
      const h = harness();
      h.info.match = match({ phase: 'countdown', circuitId: 'evergarden_express_tour' });
      h.ui.update();
      const pill = (): string => h.layer.querySelector('.rallyhud-title')?.textContent ?? '';
      const spoken = (): string =>
        h.layer.querySelector('[data-rally-circuit-announce]')?.textContent ?? '';
      expect(pill()).toBe(names.en);
      expect(spoken()).toBe(names.en);
      setLanguage(LANG);
      h.ui.relocalize();
      h.ui.update();
      expect(pill()).toBe(names.other);
      // The announcer follows the same cached resolve, so a language flip does
      // not leave a screen reader on the old locale.
      expect(spoken()).toBe(names.other);
    });

    it('re-localizes the podium heading, which repaints only on its signature', () => {
      const names = bilingual('hudChrome.rally.circuitName_evergarden_express_tour');
      const h = harness();
      const field = [racer({ pid: 1, position: 1, finished: true, finishSeconds: 71.2 })];
      h.info.match = match({
        phase: 'finished',
        decided: true,
        result: 'won',
        circuitId: 'evergarden_express_tour',
        me: field[0],
        standings: field,
      });
      h.ui.update();
      const heading = (): string =>
        h.layer.querySelector('.rally-podium-heading')?.textContent ?? '';
      expect(heading()).toBe(names.en);
      // The ceremony's signature is the classification, which a language flip
      // cannot move, so the ordinary repaint path leaves English on screen:
      // that is the bug this arm reproduces before the fan-out fixes it.
      setLanguage(LANG);
      h.ui.update();
      expect(heading(), 'the podium repainted itself: this arm proves nothing').toBe(names.en);
      h.ui.relocalize();
      h.ui.update();
      expect(heading()).toBe(names.other);
    });

    it('re-localizes the circuit name on the practice setup screen', () => {
      const names = bilingual('hudChrome.rally.circuitName_evergarden_practice');
      const h = harness();
      h.ui.toggle();
      (h.root.querySelector('[data-rally-practice-open]') as HTMLElement | null)?.click();
      const line = (): string => h.root.querySelector('.rally-setup-circuit')?.textContent ?? '';
      expect(line()).toContain(names.en);
      setLanguage(LANG);
      h.ui.relocalize();
      expect(line()).toContain(names.other);
    });
  });

  it('leaves the podium unheaded for a circuit nothing names', () => {
    const h = harness();
    const field = [racer({ pid: 1, position: 1, finished: true, finishSeconds: 70 })];
    h.info.match = match({
      phase: 'finished',
      decided: true,
      result: 'won',
      circuitId: 'draft_scratch_1',
      me: field[0],
      standings: field,
    });
    h.ui.update();
    expect(h.layer.querySelector('.rally-podium-heading')).toBeNull();
    // ...and the ceremony itself still runs.
    expect(
      (h.layer.querySelector('#realm-racers-podium') as HTMLElement).classList.contains('shown'),
    ).toBe(true);
  });
});

describe('Realm Racers lobby ready waits for the drawn circuit', () => {
  it('stays unready until the circuit client settles, whichever of the HUD and the renderer reads first', async () => {
    const h = harness();
    const gates: (() => void)[] = [];
    const host = {
      worldCompileGate: () => () =>
        new Promise<void>((resolve) => {
          gates.push(resolve);
        }),
      webgl: { properties: { get: () => undefined } },
    };
    const common: RealmRacersPrepareClient = {
      prepareId: 'rallyCommon',
      built: false,
      prepare: () => new THREE.Group(),
    };
    let finishCircuit: () => void = () => undefined;
    const circuitDone = new Promise<void>((resolve) => {
      finishCircuit = resolve;
    });
    const circuit: RealmRacersPrepareClient = {
      prepareId: `rallyCircuit:${REALM_RACERS_PRACTICE_CIRCUIT_ID}`,
      built: false,
      prepare: () => new THREE.Group(),
      run: () => circuitDone.then(() => true),
    };
    const seam = new RealmRacersPrepare([common]);
    seam.useCircuits({
      circuitClient: (id) => (id === REALM_RACERS_PRACTICE_CIRCUIT_ID ? circuit : null),
    });
    h.source.progress = (out, circuitId) => seam.progress(out, circuitId);
    const flush = () => new Promise((done) => setTimeout(done, 0));
    // The queue join prepares the common programs, which settle in the queue.
    seam.frame(host, { queued: true, match: null }, 0, 0);
    for (const resolve of gates.splice(0)) resolve();
    await flush();
    h.info.queued = false;
    h.info.match = match({
      circuitId: REALM_RACERS_PRACTICE_CIRCUIT_ID,
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      loading: { secondsLeft: 15, readyIds: [2, 3, 4] },
    });
    // The HUD reads the lobby before the renderer has seen it.
    h.frame();
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    for (let i = 0; i < 10; i++) {
      seam.frame(host, h.info, 0, 0);
      h.frame();
    }
    expect(seam.stateOf(circuit.prepareId)).toBe('preparing');
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    finishCircuit();
    await flush();
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
  });

  it('stays unready through a graphics rebuild mid-lobby until the new seam settles its circuit', async () => {
    const h = harness();
    const flush = () => new Promise((done) => setTimeout(done, 0));
    const host = {
      worldCompileGate: () => () => Promise.resolve(),
      webgl: { properties: { get: () => undefined } },
    };
    /** A renderer's seam whose circuit client settles when the test says so. */
    const rendererSeam = () => {
      let finish: () => void = () => undefined;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const circuit: RealmRacersPrepareClient = {
        prepareId: `rallyCircuit:${REALM_RACERS_PRACTICE_CIRCUIT_ID}`,
        built: false,
        prepare: () => new THREE.Group(),
        run: () => done.then(() => true),
      };
      const seam = new RealmRacersPrepare();
      seam.useCircuits({
        circuitClient: (id) => (id === REALM_RACERS_PRACTICE_CIRCUIT_ID ? circuit : null),
      });
      return { seam, finish };
    };
    h.info.match = match({
      circuitId: REALM_RACERS_PRACTICE_CIRCUIT_ID,
      phase: 'loading',
      countdown: 0,
      countdownTicks: 0,
      loading: { secondsLeft: 15, readyIds: [2, 3, 4] },
    });
    const first = rendererSeam();
    h.source.progress = (out, circuitId) => first.seam.progress(out, circuitId);
    first.seam.frame(host, h.info, 0, 0);
    h.frame();
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    // The rebuild: the HUD now reads the new renderer's seam, which has not
    // run a frame yet, while the old one settles behind it.
    const rebuilt = rendererSeam();
    h.source.progress = (out, circuitId) => rebuilt.seam.progress(out, circuitId);
    first.finish();
    await flush();
    h.frame();
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    for (let i = 0; i < 5; i++) {
      rebuilt.seam.frame(host, h.info, 0, 0);
      h.frame();
    }
    await flush();
    expect(h.readyRealmRacers).not.toHaveBeenCalled();
    rebuilt.finish();
    await flush();
    h.frame();
    expect(h.readyRealmRacers).toHaveBeenCalledTimes(1);
  });
});

describe('the Realm Racers HUD event router and cast affordances', () => {
  const host = () => ({
    sim: { playerId: 7 },
    log: vi.fn(),
    showBanner: vi.fn(),
    showSelfNote: vi.fn(),
    combatLog: vi.fn(),
    realmRacersSplash: { show: vi.fn() },
  });

  it('claims every rally event and routes the viewer-owned ones', () => {
    const h = host();
    const go = vi.spyOn(audio, 'realmRacersGo').mockImplementation(() => {});
    expect(
      applyRealmRacersEventPresentation(h, { type: 'realmRacersGo', pid: 7 } as SimEvent),
    ).toBe(true);
    expect(h.showBanner).not.toHaveBeenCalled();
    expect(go).toHaveBeenCalledOnce();
    expect(
      applyRealmRacersEventPresentation(h, { type: 'realmRacersUnqueued', pid: 8 } as SimEvent),
    ).toBe(true);
    expect(h.log).not.toHaveBeenCalled();
    expect(
      applyRealmRacersEventPresentation(h, {
        type: 'realmRacersPickup',
        pid: 7,
        effect: 'slick',
      } as SimEvent),
    ).toBe(true);
    expect(h.showSelfNote).toHaveBeenCalledOnce();
    expect(h.realmRacersSplash.show).toHaveBeenCalledWith('slick');
    for (const type of ['realmRacersReset', 'realmRacersBump', 'realmRacersGroundBlastHit']) {
      expect(applyRealmRacersEventPresentation(h, { type } as SimEvent)).toBe(true);
    }
    expect(applyRealmRacersEventPresentation(h, { type: 'cardDuelMatchStart' } as SimEvent)).toBe(
      false,
    );
    go.mockRestore();
  });

  it('refuses a held kit ability out loud only when its budget is spent', () => {
    const player = {
      dead: false,
      cooldowns: new Map<string, number>(),
      drive: null,
      abilityCharges: undefined,
    };
    const h = {
      sim: { player, realmRacersInfo: { match: null } },
      renderer: {
        realmRacers: {
          selfAimPose: null,
          predictOwnGroundBlastFire: vi.fn(),
          predictOwnSlickDrop: vi.fn(),
        },
      },
      flashActionSlot: vi.fn(),
      showError: vi.fn(),
    };
    expect(refuseLockedAbility(h, 'fireball', 2)).toBe(false);
    expect(h.flashActionSlot).not.toHaveBeenCalled();
    expect(rallyAimCaster(h)).toBe(player);
    predictRallySlickDrop(h, 'rally_oil_slick');
    expect(h.renderer.realmRacers.predictOwnSlickDrop).not.toHaveBeenCalled();
  });
});
