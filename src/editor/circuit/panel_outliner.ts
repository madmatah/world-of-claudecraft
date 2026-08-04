// The outliner: what is STANDING on this circuit, entry by entry, and the way
// back to any of it.
//
// The drawer counts the dressing in aggregate, which answers "how much" and
// never "which one", and on a dressed circuit the fourth lantern is the thing
// an operator is looking for. So a row is not a readout: clicking it selects the
// piece, double-clicking takes the view to it, and its own button discards it.
// Finding a piece on the plan by eye was the only way in, which on a circuit
// wearing sixty of them is not a way in.
//
// Both listeners sit on the PANEL rather than on the rows, and that is
// load-bearing rather than tidy: `paint()` rebuilds the whole list on every
// repaint, so a row is a different element from one click to the next, and a
// `dblclick` bound to a row would be lost between the two halves of the gesture.
// The panel survives, and a double click on two different children still fires
// on their common ancestor.

import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import { realmRacersPlacements } from '../../sim/realm_racers_props_resolve';
import { editorIcon } from './editor_icons';
import { heading, hintLine, type PanelHost } from './panels';
import { type DressingSelection, placedPropIndices } from './props_core';

/**
 * What a row can ask the page for.
 *
 * Three verbs the panel cannot perform itself: the selection lives on the page
 * beside the canvas that draws it, the view transform is the plan's, and a
 * delete has to go through the same commit path a canvas gesture takes or the
 * basin and the undo stack fall out of step with the ponds.
 */
export interface OutlinerHost extends PanelHost {
  select(selection: DressingSelection): void;
  /** Centre the plan (and the 3D dock, when it is open) on an entry. */
  focus(selection: DressingSelection): void;
  remove(selection: DressingSelection): void;
}

/** The selection a row stands for, read back off the element a click landed on.
 *  Written into `dataset` rather than closed over, because the delegated
 *  listeners outlive every row they fire for. */
function selectionOf(target: EventTarget | null): DressingSelection | null {
  if (!(target instanceof HTMLElement)) return null;
  const row = target.closest('.outline-row');
  if (!(row instanceof HTMLElement)) return null;
  const kind = row.dataset.kind;
  const index = Number(row.dataset.index);
  if (kind !== 'prop' && kind !== 'scatter' && kind !== 'pond') return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { kind, index };
}

export class OutlinerPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: OutlinerHost) {
    this.el.addEventListener('click', (ev) => {
      const selection = selectionOf(ev.target);
      if (!selection) return;
      if (ev.target instanceof HTMLElement && ev.target.closest('.outline-del')) {
        this.host.remove(selection);
        return;
      }
      this.host.select(selection);
    });
    // The gesture that answers "where IS this one": a name in a list is not a
    // place, and the plan is where every other decision about a piece is made.
    this.el.addEventListener('dblclick', (ev) => {
      const selection = selectionOf(ev.target);
      if (selection) this.host.focus(selection);
    });
  }

  /** One entry. The name is a BUTTON so the list is walkable from the keyboard;
   *  the delete sits beside it rather than inside it, because a button inside a
   *  button is markup no browser agrees about. */
  private row(
    selection: DressingSelection,
    name: string,
    detail: string,
    solid = false,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'outline-row';
    row.dataset.kind = selection.kind;
    row.dataset.index = String(selection.index);
    if (this.isSelected(selection)) row.classList.add('on');

    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'n';
    label.textContent = name;
    label.title = `Select ${name} (double click to look at it)`;
    const note = document.createElement('span');
    note.textContent = detail;
    row.append(label, note);
    if (solid) {
      const mark = document.createElement('span');
      mark.className = 'solid';
      mark.textContent = 'solid';
      row.append(mark);
    }

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'x-btn outline-del';
    remove.innerHTML = editorIcon('trash');
    remove.title = `Delete ${name}`;
    row.append(remove);
    return row;
  }

  private isSelected(selection: DressingSelection): boolean {
    const held = this.host.selection();
    return held?.kind === selection.kind && held.index === selection.index;
  }

  /** A line with nothing to select behind it: an empty list, not an entry. */
  private empty(text: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'outline-row';
    const label = document.createElement('span');
    label.className = 'n';
    label.textContent = text;
    row.append(label);
    return row;
  }

  paint(): void {
    if (this.el.hidden) return;
    this.el.replaceChildren();
    if (!this.host.drawn()) return;
    const record = this.host.record();
    const placements = realmRacersPlacements(record);
    const props = record.props ?? [];
    // Hoisted: called per prop it walks the whole list per prop, which is
    // quadratic and allocates an array each time, on a path that runs per frame.
    const placed = placedPropIndices(props, REALM_RACERS_PROPS);

    this.el.append(heading(`props (${props.length})`));
    if (props.length === 0) this.el.append(this.empty('nothing placed'));
    props.forEach((prop, index) => {
      const at = placements.props[placed.indexOf(index)];
      const where = at ? `${at.x.toFixed(0)}, ${at.z.toFixed(0)}` : 'not drawn';
      this.el.append(this.row({ kind: 'prop', index }, prop.asset, where, Boolean(at?.solid)));
    });

    const scatters = record.scatters ?? [];
    this.el.append(
      heading(`scatters (${scatters.length}, ${this.host.metrics().scatterCount} pieces)`),
    );
    scatters.forEach((scatter, index) => {
      this.el.append(
        this.row(
          { kind: 'scatter', index },
          scatter.asset,
          `${scatter.zone}, ${scatter.spacing} yd`,
        ),
      );
    });

    const ponds = record.ponds ?? [];
    this.el.append(heading(`ponds (${ponds.length})`));
    ponds.forEach((pond, index) => {
      this.el.append(
        this.row(
          { kind: 'pond', index },
          `pond ${index}`,
          `${(pond.rx * 2).toFixed(0)} x ${(pond.rz * 2).toFixed(0)} yd`,
        ),
      );
    });

    this.el.append(hintLine('click a row to select it, double click to look at it'));
  }
}
