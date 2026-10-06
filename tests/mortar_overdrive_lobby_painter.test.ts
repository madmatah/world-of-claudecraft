// @vitest-environment jsdom
//
// The Mortar Overdrive lobby curtain painter: one skeleton per lobby, every live
// value through the elided writers, and exactly one arrival-cover depth held
// for as long as the curtain is up.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setArrivalCover } from '../src/render/arrival_cover';
import {
  buildMortarOverdriveLobbyView,
  MortarOverdriveLobby,
  type MortarOverdriveLobbyProgress,
  mortarOverdriveUiDeps,
} from '../src/ui/hud/mortar_overdrive';
import { t } from '../src/ui/i18n';
import { makeWriterFacet } from '../src/ui/painter_host';
import type { MortarOverdriveMatchInfo, MortarOverdriveRacerInfo } from '../src/world_api';

function racer(pid: number, name: string, botTier: MortarOverdriveRacerInfo['botTier'] = null) {
  return { pid, name, botTier } as MortarOverdriveRacerInfo;
}

function lobby(over: Partial<MortarOverdriveMatchInfo> = {}): MortarOverdriveMatchInfo {
  return {
    id: 7,
    circuitId: 'evergarden_express_tour',
    phase: 'loading',
    participantIds: [1, 2, 3],
    me: racer(1, 'Aster'),
    standings: [
      racer(1, 'Aster'),
      racer(2, '<img src=x onerror=alert(1)>'),
      racer(3, 'Ace', 'ace'),
    ],
    loading: { secondsLeft: 12, readyIds: [3] },
    ...over,
  } as MortarOverdriveMatchInfo;
}

function rig() {
  document.body.innerHTML = '<div id="ui"></div>';
  const layer = document.getElementById('ui') as HTMLElement;
  const counts = { writes: 0 };
  const writers = makeWriterFacet(
    new Map(),
    new WeakMap(),
    new WeakMap(),
    new WeakMap(),
    () => {
      counts.writes++;
    },
    () => {},
  );
  const setCover = vi.fn();
  const painter = new MortarOverdriveLobby({ layer: () => layer, writers, setCover });
  const innerHtml = vi.spyOn(Element.prototype, 'innerHTML', 'set');
  return { layer, counts, setCover, painter, innerHtml };
}

const PREPARING: MortarOverdriveLobbyProgress = { done: 1, total: 2, settled: false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MortarOverdriveLobby painter', () => {
  it('builds one skeleton and elides every write on an unchanged frame', () => {
    const r = rig();
    const view = buildMortarOverdriveLobbyView(lobby(), PREPARING);
    r.painter.update(view);
    expect(r.innerHtml).toHaveBeenCalledTimes(1);
    const established = r.counts.writes;
    expect(established).toBeGreaterThan(0);
    for (let frame = 0; frame < 5; frame++) {
      r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    }
    expect(r.counts.writes).toBe(established);
    expect(r.innerHtml).toHaveBeenCalledTimes(1);
    // A pilot readying and the clock moving repaint values, never the skeleton.
    r.painter.update(
      buildMortarOverdriveLobbyView(lobby({ loading: { secondsLeft: 11, readyIds: [1, 3] } }), {
        done: 2,
        total: 2,
        settled: true,
      }),
    );
    expect(r.innerHtml).toHaveBeenCalledTimes(1);
    expect(r.counts.writes).toBeGreaterThan(established);
    r.innerHtml.mockRestore();
  });

  it('writes names as text, marks the viewer and the house pilot, and paints statuses', () => {
    const r = rig();
    r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    r.innerHtml.mockRestore();
    const root = r.layer.querySelector('#mortar-overdrive-lobby') as HTMLElement;
    expect(root.querySelector('img')).toBeNull();
    const rows = [...root.querySelectorAll('.mortar-overdrive-lobby-pilot')];
    expect(
      rows.map((row) => row.querySelector('.mortar-overdrive-lobby-name')?.textContent),
    ).toEqual(['Aster', '<img src=x onerror=alert(1)>', 'Ace']);
    expect(rows[0]?.classList.contains('me')).toBe(true);
    expect(rows[0]?.textContent).toContain(t('hudChrome.mortarOverdrive.standingsYou'));
    expect(rows[2]?.textContent).toContain(t('hudChrome.mortarOverdrive.standingsBot'));
    const statuses = rows.map(
      (row) => row.querySelector('.mortar-overdrive-lobby-status') as HTMLElement,
    );
    expect(statuses.map((el) => el.textContent)).toEqual([
      t('hudChrome.mortarOverdrive.lobbyWaiting'),
      t('hudChrome.mortarOverdrive.lobbyWaiting'),
      t('hudChrome.mortarOverdrive.lobbyReady'),
    ]);
    expect(statuses.map((el) => el.classList.contains('is-on'))).toEqual([false, false, true]);
    expect(root.querySelector('.mortar-overdrive-lobby-count')?.textContent).toBe(
      t('hudChrome.mortarOverdrive.lobbyReadyCount', { ready: '1', total: '3' }),
    );
    expect(root.querySelector('.mortar-overdrive-lobby-circuit')?.textContent).toBe(
      'Evergarden Express Tour',
    );
    const bar = root.querySelector('.mortar-overdrive-lobby-bar');
    expect(bar?.getAttribute('aria-valuenow')).toBe('50');
    expect(bar?.getAttribute('aria-valuetext')).toBe('50%');
  });

  it('leaves the heading out for a circuit nothing names', () => {
    const r = rig();
    r.painter.update(
      buildMortarOverdriveLobbyView(lobby({ circuitId: 'draft_scratch_1' }), PREPARING),
    );
    r.innerHtml.mockRestore();
    expect(r.layer.querySelector('.mortar-overdrive-lobby-circuit')).toBeNull();
    expect(r.layer.textContent).not.toContain('draft_scratch_1');
  });

  it('holds exactly one cover depth while shown, and drops it on the lift', () => {
    const r = rig();
    r.innerHtml.mockRestore();
    r.painter.update(buildMortarOverdriveLobbyView(null, PREPARING));
    expect(r.setCover).not.toHaveBeenCalled();
    for (let frame = 0; frame < 3; frame++) {
      r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    }
    expect(r.setCover.mock.calls).toEqual([[true]]);
    expect(r.painter.covering).toBe(true);
    const root = r.layer.querySelector('#mortar-overdrive-lobby') as HTMLElement;
    expect(root.classList.contains('shown')).toBe(true);
    for (let frame = 0; frame < 3; frame++) {
      r.painter.update(buildMortarOverdriveLobbyView(lobby({ phase: 'countdown' }), PREPARING));
    }
    expect(r.setCover.mock.calls).toEqual([[true], [false]]);
    expect(r.painter.covering).toBe(false);
    expect(root.classList.contains('shown')).toBe(false);
    // The next race raises it again and rebuilds its own skeleton.
    r.painter.update(buildMortarOverdriveLobbyView(lobby({ id: 8 }), PREPARING));
    expect(r.setCover.mock.calls).toEqual([[true], [false], [true]]);
    expect(root.classList.contains('shown')).toBe(true);
  });

  it('drops the cover once this machine settles, and holds the keys for as long as it is shown', () => {
    const r = rig();
    r.innerHtml.mockRestore();
    const hold = { set: vi.fn() };
    const setHold = hold.set;
    const painter = new MortarOverdriveLobby({
      layer: () => r.layer,
      writers: makeWriterFacet(
        new Map(),
        new WeakMap(),
        new WeakMap(),
        new WeakMap(),
        () => {},
        () => {},
      ),
      setCover: r.setCover,
      hold,
    });
    painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    painter.update(buildMortarOverdriveLobbyView(lobby(), { done: 2, total: 2, settled: true }));
    expect(r.setCover.mock.calls).toEqual([[true], [false]]);
    expect(setHold.mock.calls).toEqual([[true]]);
    expect(painter.shown).toBe(true);
    painter.update(buildMortarOverdriveLobbyView(lobby({ phase: 'countdown' }), PREPARING));
    expect(setHold.mock.calls).toEqual([[true], [false]]);
    expect(r.setCover.mock.calls).toEqual([[true], [false]]);
    painter.update(buildMortarOverdriveLobbyView(lobby({ id: 9 }), PREPARING));
    painter.dispose();
    expect(setHold.mock.calls.at(-1)).toEqual([false]);
    expect(r.setCover.mock.calls.at(-1)).toEqual([false]);
    expect(r.layer.querySelector('#mortar-overdrive-lobby')).toBeNull();
  });

  it('raises no cover before it has a layer to mount in', () => {
    const r = rig();
    r.innerHtml.mockRestore();
    const orphan = new MortarOverdriveLobby({
      layer: () => null,
      writers: makeWriterFacet(
        new Map(),
        new WeakMap(),
        new WeakMap(),
        new WeakMap(),
        () => {},
        () => {},
      ),
      setCover: r.setCover,
    });
    orphan.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    expect(r.setCover).not.toHaveBeenCalled();
    expect(orphan.covering).toBe(false);
  });

  it('rebuilds the skeleton once after a language switch', () => {
    const r = rig();
    r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    r.painter.relocalize();
    r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    r.painter.update(buildMortarOverdriveLobbyView(lobby(), PREPARING));
    expect(r.innerHtml).toHaveBeenCalledTimes(2);
    r.innerHtml.mockRestore();
  });
});

describe('the arrival cover the curtain holds', () => {
  it('reaches it only through its injected seam, wired by the HUD parts', () => {
    // The painter is a UI module: the render-side cover is handed to it by the
    // composition glue rather than imported as a default it falls back to.
    const painter = readFileSync('src/ui/hud/mortar_overdrive/lobby_painter.ts', 'utf8');
    expect(painter).not.toMatch(/from '(\.\.\/)+render\//);
    const composer = readFileSync('src/ui/hud/mortar_overdrive/composer.ts', 'utf8');
    expect(composer).toContain('setCover: deps.setArrivalCover');
    const deps = mortarOverdriveUiDeps({
      windowFocus: () => ({ captureFocus: () => null, restoreFocus: () => {} }),
    });
    expect(deps.setArrivalCover).toBe(setArrivalCover);
  });
});
