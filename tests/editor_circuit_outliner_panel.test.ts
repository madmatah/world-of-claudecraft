// @vitest-environment jsdom
//
// The outliner as ELEMENTS: the list is the way BACK to a piece, and every one
// of its behaviours is a claim about the gesture rather than about a model.
//
// One of them is the reason the listeners are delegated at all: `paint()`
// rebuilds every row on every repaint, so the row a double click began on is a
// different element from the one it ends on. A `dblclick` bound to a row would
// simply be lost, and lost silently. The rest are the ordinary ways a list of
// indices goes wrong: a row acting on the entry NEXT to the one clicked, a
// delete button that also selects, and a delete that leaves a selection pointing
// past the hole it just made.

import { describe, expect, it, vi } from 'vitest';
import { type OutlinerHost, OutlinerPanel } from '../src/editor/circuit/panel_outliner';
import type { DressingSelection } from '../src/editor/circuit/props_core';
import {
  REALM_RACERS_PRACTICE_CIRCUIT as GARDEN,
  type RallyProp,
  type RealmRacersCircuit,
} from '../src/sim/content/realm_racers_circuits';
import { realmRacersCircuitMetrics } from '../src/sim/realm_racers_circuit_metrics';
import { realmRacersTrack } from '../src/sim/realm_racers_spline';

const PROPS: RallyProp[] = [
  { asset: 'bench', at: { x: 12, z: 8 } },
  { asset: 'postLantern', at: { s: 0.3, offset: 11 } },
  // A key the catalog does not author: the resolver SKIPS it, so every row after
  // it would be off by one if the panel walked the resolver's list instead of
  // the record's.
  { asset: 'nothing_authors_this', at: { x: 40, z: 40 } },
  { asset: 'oak', at: { x: -30, z: 20 } },
];

let drafts = 0;

function mount(overrides: Partial<RealmRacersCircuit> = {}): {
  panel: OutlinerPanel;
  host: OutlinerHost;
  selected: { value: DressingSelection | null };
} {
  document.body.innerHTML = '';
  // A fresh id per mount: the resolver memoizes per circuit id, and a fixture
  // sharing the shipped one would evict the record everything else measures.
  const record: RealmRacersCircuit = {
    ...GARDEN,
    id: `draft_outliner_${drafts++}`,
    props: PROPS,
    ponds: [{ x: 5, z: 5, rx: 8, rz: 6, seed: 2 }],
    scatters: [{ asset: 'shrub', zone: 'infield', spacing: 6, seed: 1 }],
    ...overrides,
  };
  const selected: { value: DressingSelection | null } = { value: null };
  const host: OutlinerHost = {
    record: () => record,
    metrics: () => realmRacersCircuitMetrics(record),
    track: () => realmRacersTrack(record),
    drawn: () => true,
    mode: () => 'props',
    selection: () => selected.value,
    commit: vi.fn(),
    commitDressing: vi.fn(),
    setStatus: vi.fn(),
    select: vi.fn((next: DressingSelection) => {
      selected.value = next;
    }),
    focus: vi.fn(),
    remove: vi.fn(),
  };
  const panel = new OutlinerPanel(host);
  document.body.append(panel.el);
  panel.paint();
  return { panel, host, selected };
}

const rows = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('.outline-row')].filter(
    (row) => row.dataset.kind !== undefined,
  );

const rowFor = (kind: string, index: number): HTMLElement =>
  rows().find(
    (row) => row.dataset.kind === kind && row.dataset.index === String(index),
  ) as HTMLElement;

const click = (node: Element): void => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};

describe('the circuit editor outliner', () => {
  it('lists one row per RECORD entry, including one the resolver places nothing for', () => {
    mount();
    expect(rowFor('prop', 0).textContent).toContain('bench');
    expect(rowFor('prop', 2).textContent).toContain('nothing_authors_this');
    // The unplaceable one says so rather than borrowing another piece's spot.
    expect(rowFor('prop', 2).textContent).toContain('not drawn');
    expect(rowFor('prop', 3).textContent).toContain('oak');
    expect(rowFor('scatter', 0).textContent).toContain('shrub');
    expect(rowFor('pond', 0).textContent).toContain('pond 0');
  });

  it('selects the entry the row stands for, not the one beside it', () => {
    const { host } = mount();
    click(rowFor('prop', 3).querySelector('.n') as Element);
    expect(host.select).toHaveBeenCalledWith({ kind: 'prop', index: 3 });
    click(rowFor('pond', 0).querySelector('.n') as Element);
    expect(host.select).toHaveBeenLastCalledWith({ kind: 'pond', index: 0 });
    click(rowFor('scatter', 0).querySelector('.n') as Element);
    expect(host.select).toHaveBeenLastCalledWith({ kind: 'scatter', index: 0 });
  });

  it('deletes from the row button, and does not also select what it just removed', () => {
    const { host } = mount();
    click(rowFor('prop', 1).querySelector('.outline-del') as Element);
    expect(host.remove).toHaveBeenCalledWith({ kind: 'prop', index: 1 });
    expect(host.select).not.toHaveBeenCalled();
  });

  it('survives a repaint mid-gesture, which is why the listeners are on the panel', () => {
    const { panel, host } = mount();
    // The first half of the double click, then the repaint a commit triggers,
    // then the second half on the REBUILT row. Bound per row, this is lost.
    click(rowFor('prop', 0).querySelector('.n') as Element);
    panel.paint();
    const rebuilt = rowFor('prop', 0).querySelector('.n') as Element;
    rebuilt.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(host.focus).toHaveBeenCalledWith({ kind: 'prop', index: 0 });
  });

  it('marks the selected row, so the list says which piece the inspector is on', () => {
    const { panel, selected } = mount();
    expect(rowFor('prop', 1).classList.contains('on')).toBe(false);
    selected.value = { kind: 'prop', index: 1 };
    panel.paint();
    expect(rowFor('prop', 1).classList.contains('on')).toBe(true);
    expect(rowFor('prop', 0).classList.contains('on')).toBe(false);
    // The index alone is not the entry: a pond 1 must not light the prop 1 row.
    selected.value = { kind: 'pond', index: 1 };
    panel.paint();
    expect(rowFor('prop', 1).classList.contains('on')).toBe(false);
  });

  it('offers nothing to act on where there is nothing placed', () => {
    mount({ props: undefined, ponds: undefined, scatters: undefined });
    expect(rows()).toEqual([]);
    expect(document.body.textContent).toContain('nothing placed');
    // And an empty line is not a row: clicking it must reach no entry at all.
    const empty = document.querySelector('.outline-row .n') as Element;
    expect(empty.tagName).toBe('SPAN');
  });

  it('paints nothing at all while it is hidden, or before the first stroke', () => {
    const { panel } = mount();
    panel.el.hidden = true;
    panel.el.replaceChildren();
    panel.paint();
    expect(panel.el.childElementCount).toBe(0);
  });
});
