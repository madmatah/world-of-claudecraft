// @vitest-environment jsdom
//
// The RACE tool's two panels as ELEMENTS.
//
// What this file exists for is the state the palette introduced. The tool used
// to be permanently armed, so a click that missed the row an operator meant
// authored a second one beside it; the fix is a POINTER state that is the
// default and arming that is deliberate, and none of that can be read off a
// core. Neither can the two things a wrong arm looks like from outside: a tile
// that stays lit after `esc`, and a second click on the armed tile that fails to
// give the pointer back.
//
// The inspector half is pinned for what it SAYS rather than how it looks: it is
// the only numeric way to move a row, and it is the surface that has to keep
// naming a row that no longer fits the road.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RACE_FURNITURE,
  RaceInspectorPanel,
  RacePalettePanel,
  type RacePanelHost,
} from '../src/editor/circuit/panel_race';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { REALM_RACERS_MIN_HALF_WIDTH } from '../src/sim/realm_racers_layout';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

function mount(overrides: Partial<RacePanelHost> = {}): {
  palette: RacePalettePanel;
  inspector: RaceInspectorPanel;
  host: RacePanelHost;
} {
  document.body.innerHTML = '';
  const host: RacePanelHost = {
    record: () => GARDEN,
    metrics: () => realmRacersCircuitMetrics(GARDEN),
    track: () => realmRacersTrack(GARDEN),
    drawn: () => true,
    mode: () => 'race',
    selection: () => null,
    commit: vi.fn(),
    commitDressing: vi.fn(),
    setStatus: vi.fn(),
    pickupSelection: () => null,
    movePickupRowTo: vi.fn(),
    removePickupRow: vi.fn(),
    onArmed: vi.fn(),
    ...overrides,
  };
  const palette = new RacePalettePanel(host);
  const inspector = new RaceInspectorPanel(host);
  document.body.append(palette.el, inspector.el);
  return { palette, inspector, host };
}

const tile = (id: string): HTMLElement =>
  document.querySelector(`button.lib-tile[data-furniture="${id}"]`) as HTMLElement;

const pointerRow = (): HTMLElement => document.querySelector('button.pointer-mode') as HTMLElement;

const PICKUP_ROW = RACE_FURNITURE[0].id;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the race palette', () => {
  it('opens on the POINTER, which is the whole point of it', () => {
    // The defect this panel exists for: with a piece permanently armed, a click
    // that hit nothing authored a row nobody asked for at a place nobody chose.
    const { palette } = mount();
    expect(palette.armed).toBeNull();
    expect(pointerRow().classList.contains('on')).toBe(true);
    expect(tile(PICKUP_ROW).classList.contains('on')).toBe(false);
  });

  it('arms on a click and tells the page, so the cursor and the ghost can follow', () => {
    const { palette, host } = mount();
    tile(PICKUP_ROW).click();
    expect(palette.armed).toBe(PICKUP_ROW);
    expect(host.onArmed).toHaveBeenCalledWith(PICKUP_ROW);
    expect(tile(PICKUP_ROW).classList.contains('on')).toBe(true);
    expect(pointerRow().classList.contains('on')).toBe(false);
  });

  it('gives the pointer back when the armed tile is clicked again', () => {
    // The second of the two ways out, and the one that has no keyboard in it: an
    // operator who armed by mistake reaches for the tile they just hit.
    const { palette, host } = mount();
    tile(PICKUP_ROW).click();
    tile(PICKUP_ROW).click();
    expect(palette.armed).toBeNull();
    expect(host.onArmed).toHaveBeenLastCalledWith(null);
    expect(pointerRow().classList.contains('on')).toBe(true);
  });

  it('gives it back through the pointer row too', () => {
    const { palette } = mount();
    tile(PICKUP_ROW).click();
    pointerRow().click();
    expect(palette.armed).toBeNull();
    expect(tile(PICKUP_ROW).classList.contains('on')).toBe(false);
  });

  it('holds the state in words for as long as it is true', () => {
    // A transient status message cannot answer "am I still placing rows", which
    // is a question about state. Both halves are on screen, not toasted.
    const { palette } = mount();
    expect(pointerRow().textContent).toContain('pointer (armed)');
    palette.arm(PICKUP_ROW);
    expect(pointerRow().textContent).toContain(PICKUP_ROW);
    expect(palette.el.textContent).toContain(`placing ${PICKUP_ROW}`);
  });

  it('marks the armed tile IN PLACE rather than rebuilding the grid', () => {
    // The prop library lost its drag gesture to exactly this: a rebuild detaches
    // the very button the pointer is on. This palette has no tile drag, so the
    // cost is lower, but a rebuilt tile also drops the focus mid-keyboard.
    const { palette } = mount();
    const before = tile(PICKUP_ROW);
    palette.arm(PICKUP_ROW);
    expect(tile(PICKUP_ROW)).toBe(before);
  });

  it('offers every furniture kind the table declares, and nothing else', () => {
    mount();
    const tiles = [...document.querySelectorAll('button.lib-tile')];
    expect(tiles).toHaveLength(RACE_FURNITURE.length);
    for (const entry of RACE_FURNITURE) {
      expect(tile(entry.id), entry.id).toBeTruthy();
      expect(tile(entry.id).textContent).toContain(entry.label);
      // An icon rather than a photograph: a pickup row is not a catalog asset,
      // so there is nothing to photograph, and the letter chip a missing picture
      // falls back to would say nothing at all.
      expect(tile(entry.id).querySelector('svg'), entry.id).toBeTruthy();
    }
  });
});

describe('the race inspector', () => {
  const withRow: RealmRacersCircuit = { ...GARDEN, pickupRows: [{ s: 0.25 }, { s: 0.75 }] };

  it('says what to do when nothing is selected, and which thing to do it with', () => {
    const { inspector } = mount({ record: () => withRow });
    inspector.paint();
    expect(inspector.el.textContent).toContain('click a row on the plan');
    // And on a circuit with no rows at all it points at the palette instead,
    // because "click a row" is advice nobody can follow there.
    const bare = mount({ record: () => ({ ...GARDEN, pickupRows: undefined }) });
    bare.inspector.paint();
    expect(bare.inspector.el.textContent).toContain('arm one in the library');
  });

  it('names the selected row and carries its numbers', () => {
    const { inspector } = mount({ record: () => withRow, pickupSelection: () => 1 });
    inspector.paint();
    const text = inspector.el.textContent ?? '';
    expect(text).toContain('pickup row 2 of 2');
    expect(text).toContain('0.7500');
    // The road's own width there, which is what decides whether the row fits and
    // how far apart its boxes are.
    const halfWidth = realmRacersTrack(withRow).halfWidthAt(
      0.75 * realmRacersTrack(withRow).length,
    );
    expect(text).toContain(halfWidth.toFixed(1));
  });

  it('offers the position in YARDS and hands the page exactly what was typed', () => {
    // The third of the three ways to move a row, and the only one that is a
    // number rather than a gesture. Yards because that is the unit every other
    // number on this page is in.
    const { inspector, host } = mount({ record: () => withRow, pickupSelection: () => 0 });
    inspector.paint();
    const input = inspector.el.querySelector('input') as HTMLInputElement;
    const lap = realmRacersTrack(withRow).length;
    expect(Number(input.value)).toBeCloseTo(0.25 * lap, 1);
    input.value = '300';
    input.dispatchEvent(new Event('change'));
    expect(host.movePickupRowTo).toHaveBeenCalledWith(300);
  });

  it('says so when the row does not fit the road, in the same words as the readout', () => {
    // A row whose boxes leave the tarmac is an ERROR the drawer raises, and the
    // operator looking at the row itself must not have to go and find it there.
    //
    // Narrowing the road alone does NOT do it: the row spreads to a fraction of
    // the road's own width, so it shrinks with it. What does is a road that
    // CHANGES width under the row, because a box has depth and its leading
    // corner projects to a different lap position from the row's centre. That is
    // the case the predicate measures four corners for, so it is the one worth
    // seating here.
    const stepped: RealmRacersCircuit = {
      ...withRow,
      widthBands: [
        { s: 0, halfWidth: 12 },
        { s: 0.2495, halfWidth: 12 },
        { s: 0.2505, halfWidth: REALM_RACERS_MIN_HALF_WIDTH },
        { s: 0.9, halfWidth: 12 },
      ],
      pickupRows: [{ s: 0.2495 }],
    };
    const offRoad = (circuit: RealmRacersCircuit): boolean =>
      realmRacersCircuitMetrics(circuit).problems.some(
        (problem) => problem.code === 'pickup_row_off_road',
      );
    // Both arms, and both are real: the readout genuinely refuses the stepped
    // circuit and genuinely allows the shipped one.
    expect(offRoad(stepped)).toBe(true);
    expect(offRoad(withRow)).toBe(false);

    const tight = mount({ record: () => stepped, pickupSelection: () => 0 });
    tight.inspector.paint();
    expect(tight.inspector.el.textContent).toContain('OFF THE ROAD');

    const wide = mount({ record: () => withRow, pickupSelection: () => 0 });
    wide.inspector.paint();
    expect(wide.inspector.el.textContent).toContain('fits the road');
  });

  it('offers the way to delete the row it is showing', () => {
    const { inspector, host } = mount({ record: () => withRow, pickupSelection: () => 0 });
    inspector.paint();
    const button = [...inspector.el.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('delete'),
    );
    button?.click();
    expect(host.removePickupRow).toHaveBeenCalled();
  });

  it('does not rebuild itself under a half-typed number', () => {
    // A drag repaints the panel, and rebuilding while one of its own inputs holds
    // the caret takes the focus out of it mid-edit.
    const { inspector } = mount({ record: () => withRow, pickupSelection: () => 0 });
    inspector.paint();
    const input = inspector.el.querySelector('input') as HTMLInputElement;
    input.focus();
    input.value = '12';
    inspector.paint();
    expect((inspector.el.querySelector('input') as HTMLInputElement).value).toBe('12');
  });

  it('paints nothing while it is hidden', () => {
    // Every repaint of the page calls it, and the panel behind a tab nobody is
    // looking at should not be resolving a circuit's boxes for the privilege.
    const { inspector } = mount({ record: () => withRow, pickupSelection: () => 0 });
    inspector.el.hidden = true;
    inspector.paint();
    expect(inspector.el.textContent).toBe('');
  });
});
