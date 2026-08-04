// The RACE tool's two panels: what it can put on the circuit, and the numbers
// behind the piece it has selected.
//
// The palette exists for one reason, and it is the props tool's lesson applied
// one tool over. RACE used to be permanently armed: a click on the road authored
// a pickup row, and a click that MISSED the row an operator meant to grab
// authored a second one a few yards from it. Ordering the tests (select first,
// place second) only helps inside the click tolerance of a row that is already
// there; ten yards away there is nothing to hit and the click places. The fix is
// the same one `panel_library.ts` carries: a POINTER state that is the default,
// and arming that is deliberate.
//
// The table has one row today. It is a table anyway, because a palette has to
// list something to draw itself, but nothing here is generalised past that: when
// a second kind arrives it brings its own gesture, and THAT is what gets to
// decide what the two share.
//
// Structure and wiring only. Which fraction a gesture means, what a move does to
// the list and how far an arrow steps are `pickup_rows_core.ts`; where the boxes
// stand is the sim's own resolver. Dev tool, so English lives here (no `t()`).

import { realmRacersPickupRowFit } from '../../sim/realm_racers_circuit_metrics';
import {
  REALM_RACERS_PICKUP_REACH,
  realmRacersPickupBoxes,
  realmRacersPickupLaneGap,
} from '../../sim/realm_racers_pickups';
import { type EditorIconId, editorIcon } from './editor_icons';
import { raceArmStateText } from './panel_core';
import {
  detailLine,
  fieldRow,
  heading,
  hintLine,
  numberOr,
  type PanelHost,
  panelButton,
} from './panels';

/** One thing the RACE tool can put on a circuit. */
export interface RaceFurnitureEntry {
  /** What the tool is ARMED with, and what the status bar names. */
  id: string;
  label: string;
  icon: EditorIconId;
  detail: string;
}

/**
 * Everything the palette offers.
 *
 * One entry. A boost pad is the expected second, and when it lands it adds a row
 * here plus its own placement gesture; it does NOT get anticipated with a generic
 * dispatcher today, which would be an abstraction written for a consumer nobody
 * has seen.
 */
export const RACE_FURNITURE: readonly RaceFurnitureEntry[] = [
  {
    id: 'pickup row',
    label: 'pickup row',
    icon: 'pickupRow',
    detail: 'Four boxes spread across the road at one lap position',
  },
];

export interface RacePanelHost extends PanelHost {
  /** Which row is selected, by index into the record's list. */
  pickupSelection(): number | null;
  /** Move the selected row to a lap position, in YARDS along the lap. */
  movePickupRowTo(yards: number): void;
  removePickupRow(): void;
  /** What a click on the plan will now do: the page owns the cursor, the banner
   *  and the ghost that say so. */
  onArmed(armed: string | null): void;
}

/**
 * The palette: the pointer row, then one tile per kind.
 *
 * Deliberately NOT the prop library's tile-drag gesture. That one exists because
 * dressing a circuit is a hunt through 182 photographed assets and dragging is
 * how you place the one you found; a palette of one named kind is armed by
 * clicking it, which also means the keyboard works with no extra path. The four
 * press/click/keyboard/drag paths `tests/editor_circuit_library_panel.test.ts`
 * pins are exactly what is NOT reimplemented here.
 */
export class RacePalettePanel {
  readonly el = document.createElement('div');
  private readonly pointerEl = document.createElement('button');
  private readonly gridEl = document.createElement('div');
  private readonly hintEl = hintLine('');
  /**
   * What a click on the plan places, or null for the pointer, which is the
   * default and the whole point of this panel.
   */
  private choice: string | null = null;

  constructor(private readonly host: RacePanelHost) {
    this.pointerEl.type = 'button';
    this.pointerEl.className = 'pointer-mode';
    this.pointerEl.title =
      'Select and edit what is already on the circuit. A click on empty road places nothing (esc)';
    this.pointerEl.onclick = () => this.arm(null);
    this.gridEl.className = 'lib-grid';
    this.paint();
  }

  get armed(): string | null {
    return this.choice;
  }

  /** Arm a kind, or the pointer. Clicking the armed tile again is how the
   *  pointer comes back without reaching for `esc`. */
  arm(id: string | null): void {
    this.choice = id === this.choice ? null : id;
    this.markArmed();
    this.host.onArmed(this.choice);
  }

  private markArmed(): void {
    for (const tile of this.gridEl.querySelectorAll<HTMLElement>('button.lib-tile')) {
      tile.classList.toggle('on', tile.dataset.furniture === this.choice);
    }
    this.pointerEl.classList.toggle('on', this.choice === null);
    this.pointerEl.textContent =
      this.choice === null ? 'pointer (armed)' : `pointer (esc) - placing ${this.choice}`;
    this.hintEl.textContent = raceArmStateText(this.choice);
  }

  private paint(): void {
    this.gridEl.replaceChildren();
    for (const entry of RACE_FURNITURE) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'lib-tile';
      tile.dataset.furniture = entry.id;
      tile.title = entry.detail;
      const shot = document.createElement('span');
      shot.className = 'lib-chip-shot';
      shot.innerHTML = editorIcon(entry.icon);
      const label = document.createElement('span');
      label.className = 'lib-label';
      label.textContent = entry.label;
      tile.append(shot, label);
      tile.onclick = () => this.arm(entry.id);
      this.gridEl.append(tile);
    }
    this.el.replaceChildren(heading('place'), this.pointerEl, this.gridEl, this.hintEl);
    this.markArmed();
  }
}

/**
 * The selected row's numbers, and the third of the three ways to move one.
 *
 * Repainted with the readout EXCEPT while one of its own inputs holds the caret,
 * the same rule the dressing inspector keeps: a drag repaints the panel, and
 * rebuilding under a half-typed number takes the focus out of it.
 *
 * The position is offered in YARDS rather than as the lap fraction the record
 * stores, because yards are the unit every other number on this page is in and
 * the one an operator can compare against the lap length. The fraction is shown
 * under it, so nothing about the record is hidden.
 */
export class RaceInspectorPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: RacePanelHost) {
    this.el.id = 'raceInspector';
  }

  paint(): void {
    if (this.el.hidden || this.el.contains(document.activeElement)) return;
    this.el.replaceChildren();
    const index = this.host.pickupSelection();
    const rows = this.host.record().pickupRows ?? [];
    const row = index === null ? undefined : rows[index];
    if (index === null || !row) {
      this.el.append(
        hintLine(
          rows.length === 0
            ? 'no pickup rows on this circuit: arm one in the library and click the road'
            : 'click a row on the plan to select it',
        ),
      );
      return;
    }
    const track = this.host.track();
    const yards = row.s * track.length;
    const halfWidth = track.halfWidthAt(yards);
    const gap = realmRacersPickupLaneGap(halfWidth);
    const fit = realmRacersPickupRowFit(
      this.host.record(),
      realmRacersPickupBoxes(this.host.record()).filter((box) => box.row === index),
    );

    this.el.append(heading(`pickup row ${index + 1} of ${rows.length}`));
    const { wrap, name } = fieldRow('position (yd)');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = '0';
    input.max = track.length.toFixed(1);
    input.value = yards.toFixed(1);
    input.onchange = () => this.host.movePickupRowTo(numberOr(input.value, yards));
    name.append(input);
    this.el.append(wrap);
    this.el.append(detailLine(`lap fraction ${row.s.toFixed(4)} of ${track.length.toFixed(0)} yd`));
    this.el.append(detailLine(`road half-width here ${halfWidth.toFixed(1)} yd`));
    // The number behind `pickup_row_lanes_overlap`, said here rather than only in
    // the drawer: it is a fact about THIS row, and the operator is looking at it.
    this.el.append(
      detailLine(
        gap / 2 < REALM_RACERS_PICKUP_REACH
          ? `boxes ${gap.toFixed(1)} yd apart: closer than two catch radii, so the middle is inside both`
          : `boxes ${gap.toFixed(1)} yd apart`,
      ),
    );
    this.el.append(
      detailLine(
        fit.fitsRoad
          ? `fits the road, ${(fit.road - fit.reach).toFixed(1)} yd to spare at its worst corner`
          : `OFF THE ROAD: its worst corner reaches ${fit.reach.toFixed(1)} yd where the road gives ${fit.road.toFixed(1)}`,
      ),
    );
    this.el.append(panelButton('delete row', () => this.host.removePickupRow()));
  }
}
