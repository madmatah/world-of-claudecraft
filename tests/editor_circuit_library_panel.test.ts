// @vitest-environment jsdom
//
// The prop library as ELEMENTS, driven against the real markup.
//
// Three of its behaviours are claims about the gesture rather than about the
// model, they all regress silently, and none of them can be read off a core:
// a click that ENDED A DRAG must not toggle the arm the drop just used; arming
// must mark the tiles IN PLACE rather than rebuild the grid (a rebuild detaches
// the button the drag captured the pointer on, which is how the gesture died the
// first time); and a picture arriving must replace one tile's face rather than
// the whole grid, for the same reason.
//
// The thumbnail RIG itself is out of reach here (it needs a GL context) and its
// two decisions are already extracted and covered in
// `tests/editor_circuit_thumbnail.test.ts`. What this file pins is the panel
// around it.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THUMBNAIL_STORAGE_KEY } from '../src/editor/circuit/draft_store_core';
import { LIBRARY_ALL_CATEGORY } from '../src/editor/circuit/library_core';
import { type LibraryHost, LibraryPanel } from '../src/editor/circuit/panel_library';
import { REALM_RACERS_PRACTICE_CIRCUIT as GARDEN } from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

const html = readFileSync(resolve(import.meta.dirname, '../circuit_editor.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

const PIXEL = 'data:image/webp;base64,AAAA';

function mount(): { panel: LibraryPanel; host: LibraryHost } {
  document.body.innerHTML = body;
  const host: LibraryHost = {
    record: () => GARDEN,
    metrics: () => realmRacersCircuitMetrics(GARDEN),
    track: () => realmRacersTrack(GARDEN),
    drawn: () => true,
    mode: () => 'props',
    selection: () => null,
    commit: vi.fn(),
    commitDressing: vi.fn(),
    setStatus: vi.fn(),
    onArmed: vi.fn(),
    onTileDrag: vi.fn(),
    onPlacement: vi.fn(),
  };
  const panel = new LibraryPanel(host);
  document.body.append(panel.el);
  return { panel, host };
}

const tile = (asset: string): HTMLElement =>
  document.querySelector(`button.lib-tile[data-asset="${asset}"]`) as HTMLElement;

const press = (node: HTMLElement, x: number, y: number): void => {
  node.dispatchEvent(
    new MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: x, clientY: y }),
  );
};
const click = (node: HTMLElement, x: number, y: number): void => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
};

describe('the prop library panel', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  it('builds a tile per offered piece, plus water, each carrying its own key', () => {
    // The floor: a panel that built nothing would pass every case below.
    const { panel } = mount();
    expect(panel.armed).toBeNull();
    const tiles = [...document.querySelectorAll('button.lib-tile')];
    expect(tiles.length).toBeGreaterThan(4);
    for (const node of tiles) expect((node as HTMLElement).dataset.asset).toBeTruthy();
    expect(tile('pond')).toBeTruthy();
    expect(document.querySelectorAll('.lib-chip').length).toBeGreaterThan(2);
  });

  it('arms on a plain click, and only a SECOND click puts the pointer back', () => {
    // The press arms, because a drag has to know what it is carrying from its
    // first move; a click that also toggled would therefore arm on the press and
    // disarm on the release, and a plain click would arm nothing at all.
    const { panel, host } = mount();
    const bench = tile('bench');
    press(bench, 10, 10);
    click(bench, 10, 10);
    expect(panel.armed).toBe('bench');
    expect(bench.classList.contains('on')).toBe(true);
    expect(host.onArmed).toHaveBeenLastCalledWith('bench');

    press(tile('bench'), 10, 10);
    click(tile('bench'), 10, 10);
    expect(panel.armed).toBeNull();
    expect(host.onArmed).toHaveBeenLastCalledWith(null);

    // ...and clicking a DIFFERENT tile arms that one rather than toggling.
    press(tile('postLantern'), 10, 10);
    click(tile('postLantern'), 10, 10);
    expect(panel.armed).toBe('postLantern');
    press(tile('bench'), 10, 10);
    click(tile('bench'), 10, 10);
    expect(panel.armed).toBe('bench');
  });

  it('takes a bare click as a toggle, so the tiles work from the keyboard', () => {
    // Enter and space on a focused button send a click with no pointerdown at
    // all. The press-then-click path is the mouse's; without this arm the tiles
    // are unreachable without one.
    const { panel } = mount();
    tile('bench').click();
    expect(panel.armed).toBe('bench');
    tile('bench').click();
    expect(panel.armed).toBeNull();
    tile('postLantern').click();
    expect(panel.armed).toBe('postLantern');
  });

  it('swallows the click that ENDS A DRAG, so the drop keeps its piece armed', () => {
    // The browser sends a click after every drop. Taking it would disarm the
    // piece the drop had just placed, so a second one could not be placed by
    // clicking at all.
    const { panel, host } = mount();
    const bench = tile('bench');
    press(bench, 10, 10);
    expect(panel.armed).toBe('bench');
    expect(host.onTileDrag).toHaveBeenCalledWith('bench', expect.anything());
    // ...released far away, which is a drag.
    click(bench, 400, 300);
    expect(panel.armed).toBe('bench');
  });

  it('marks the armed tile IN PLACE, keeping the element a drag captured', () => {
    // A rebuild here detaches the button the gesture captured the pointer on and
    // the drag ends before it has begun. Identity is the assertion, because
    // "looks the same" is exactly what a rebuild also achieves.
    const { panel } = mount();
    const before = tile('bench');
    panel.arm('bench');
    expect(tile('bench')).toBe(before);
    expect(before.classList.contains('on')).toBe(true);
    panel.arm('postLantern');
    expect(tile('bench')).toBe(before);
    expect(before.classList.contains('on')).toBe(false);
    expect(tile('postLantern').classList.contains('on')).toBe(true);
  });

  it('reads its pictures back out of the cache, and drops what is not one', () => {
    window.localStorage.setItem(
      THUMBNAIL_STORAGE_KEY,
      JSON.stringify({ bench: PIXEL, postLantern: 'javascript:alert(1)' }),
    );
    mount();
    const shot = tile('bench').querySelector('img');
    expect(shot).not.toBeNull();
    expect(shot?.getAttribute('src')).toBe(PIXEL);
    // An image is draggable by default, and THAT drag is the one that cancels
    // ours: Chrome answers a press-and-move on one with `pointercancel`.
    expect(shot?.draggable).toBe(false);
    // The refused entry keeps the honest text chip rather than being handed to
    // an `<img>`.
    expect(tile('postLantern').querySelector('img')).toBeNull();
    expect(tile('postLantern').querySelector('.lib-chip-shot')).not.toBeNull();
  });

  it('survives a storage that throws on every access', () => {
    // Private browsing and a blocked origin both throw rather than returning
    // null, and a library with no pictures still has to open.
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => mount()).not.toThrow();
    expect(document.querySelectorAll('button.lib-tile').length).toBeGreaterThan(4);
    getItem.mockRestore();
  });

  it('offers a floor the SCATTER can afford, and carries the value up to it', () => {
    // The resolver walks a grid of cells with a projection in each, so the
    // scatter's floor is higher than a row's and switching modes must not leave
    // the value under the new floor.
    const { panel } = mount();
    const slider = () =>
      document.querySelector('.lib-placement input[type="range"]') as HTMLInputElement;
    const mode = (label: string): HTMLElement =>
      [...document.querySelectorAll('.seg button')].find(
        (button) => button.textContent === label,
      ) as HTMLElement;

    mode('along road').click();
    expect(slider().min).toBe('1');
    slider().value = '1';
    slider().dispatchEvent(new Event('input'));
    expect(panel.settings.spacing).toBe(1);

    mode('scatter').click();
    expect(slider().min).toBe('2');
    expect(panel.settings.spacing).toBeGreaterThanOrEqual(2);
  });

  it('tells the page every placement change, so the banner and ghost follow', () => {
    const { panel, host } = mount();
    const mode = (label: string): HTMLElement =>
      [...document.querySelectorAll('.seg button')].find(
        (button) => button.textContent === label,
      ) as HTMLElement;
    mode('scatter').click();
    expect(host.onPlacement).toHaveBeenLastCalledWith(expect.objectContaining({ mode: 'scatter' }));
    expect(panel.settings.mode).toBe('scatter');
  });

  it('narrows the grid on a search, and lets the search reach past the chip', () => {
    mount();
    const search = document.querySelector('.lib-search') as HTMLInputElement;
    const shown = (): string[] =>
      [...document.querySelectorAll('button.lib-tile')].map(
        (node) => (node as HTMLElement).dataset.asset ?? '',
      );
    const themed = shown();
    search.value = 'lant';
    search.dispatchEvent(new Event('input'));
    expect(shown().length).toBeLessThan(themed.length);
    expect(shown()).toContain('postLantern');
    // No chip reads as active while a search is running: the grid is showing
    // matches, not a category.
    expect(document.querySelector('.lib-chip.on')).toBeNull();
  });

  it('shows the whole catalog when the all chip is picked', () => {
    mount();
    const count = document.querySelectorAll('button.lib-tile').length;
    const all = [...document.querySelectorAll('.lib-chip')].find((chip) =>
      chip.textContent?.startsWith(LIBRARY_ALL_CATEGORY),
    ) as HTMLElement;
    all.click();
    expect(document.querySelectorAll('button.lib-tile').length).toBeGreaterThan(count);
  });
});
