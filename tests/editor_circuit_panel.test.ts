// What the circuit editor's right column shows, and what a blank canvas refuses.
//
// Both were composite boolean expressions in the page, which is why they are
// pinned here: `modeReadoutEl.hidden = tabs.length > 0 || railMode === 'race' ||
// !drawn` is three rules in one line, and the interesting cases are the ones where
// two of them disagree.

import { describe, expect, it } from 'vitest';
import {
  EDITOR_ACTIONS,
  editorAction,
  MODE_ACTIONS,
  RAIL_MODES,
  sideTabsFor,
  TOOL_VALUE_FIELDS,
} from '../src/editor/circuit/layout_core';
import {
  armStateText,
  CIRCUIT_ONLY_ACTIONS,
  MAX_LISTED_PROBLEMS,
  MODE_READOUT,
  needsCircuit,
  panelLayout,
  READOUT_SECTIONS,
} from '../src/editor/circuit/panel_core';

const inputs = (over: Partial<Parameters<typeof panelLayout>[0]> = {}) =>
  panelLayout({
    mode: 'props',
    drawn: true,
    chosen: null,
    hasSelection: false,
    isPlacing: false,
    hasToolValue: true,
    ...over,
  });

describe('the contextual panel', () => {
  it('shows exactly one region at a time, in every mode', () => {
    for (const mode of RAIL_MODES) {
      for (const drawn of [false, true]) {
        for (const hasSelection of [false, true]) {
          const panel = inputs({ mode: mode.id, drawn, hasSelection });
          const showing = [
            panel.showLibrary,
            panel.showInspector,
            panel.showOutliner,
            panel.showForm,
            panel.showModeReadout,
          ].filter(Boolean);
          expect(
            showing.length,
            `${mode.id} drawn=${drawn} sel=${hasSelection}`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('opens props on the library, and on the inspector once something is selected', () => {
    expect(inputs().showLibrary).toBe(true);
    expect(inputs({ hasSelection: true }).showInspector).toBe(true);
    expect(inputs({ hasSelection: true }).active).toBe('inspector');
  });

  it('keeps a tab the operator picked, and drops one this mode does not offer', () => {
    expect(inputs({ chosen: 'outliner' }).active).toBe('outliner');
    // Chosen in props, then the operator switches to shape: shape offers no tabs,
    // so the choice cannot follow it in.
    expect(inputs({ mode: 'shape', chosen: 'outliner' }).active).toBeNull();
    expect(inputs({ mode: 'shape', chosen: 'outliner' }).showOutliner).toBe(false);
  });

  it('gives a tabless mode its own readout instead, but never the race form', () => {
    expect(inputs({ mode: 'shape' }).showModeReadout).toBe(true);
    expect(inputs({ mode: 'width' }).showModeReadout).toBe(true);
    // RACE has tabs of its own now, so it takes neither: the readout belongs to
    // the modes with no tab strip, and the form is one of RACE's tabs.
    expect(inputs({ mode: 'race' }).showModeReadout).toBe(false);
    expect(inputs({ mode: 'race' }).showForm).toBe(false);
  });

  it('shows the record form under its OWN tab and under no other', () => {
    // The rule the operator asked for: a tab owns the whole column. The form was
    // the one panel here that stayed visible whichever tab was active, which
    // made it read as belonging to none of them.
    expect(inputs({ mode: 'race', chosen: 'properties' }).showForm).toBe(true);
    for (const chosen of ['library', 'inspector'] as const) {
      const panel = inputs({ mode: 'race', chosen });
      expect(panel.showForm, chosen).toBe(false);
      // And exactly one panel is up at a time, which is what "a tab owns the
      // column" means when it is asserted rather than described.
      expect(
        [panel.showLibrary, panel.showInspector, panel.showOutliner, panel.showForm].filter(Boolean)
          .length,
        chosen,
      ).toBe(1);
    }
    // No other mode can reach it, even with the tab stored from a session in
    // RACE: the stored choice is dropped by a mode that does not offer it.
    for (const mode of ['shape', 'width', 'props'] as const) {
      expect(inputs({ mode, chosen: 'properties' }).showForm, mode).toBe(false);
    }
  });

  it('shows nothing at all on a blank canvas', () => {
    for (const mode of RAIL_MODES) {
      const panel = inputs({ mode: mode.id, drawn: false });
      expect(panel.showForm, mode.id).toBe(false);
      expect(panel.showModeReadout, mode.id).toBe(false);
    }
  });

  it('keeps the library up while a piece is armed, whatever got selected', () => {
    // The rule the placing loop depends on. Without it the panel jumped to the
    // inspector after every drop and the operator had to click back to place the
    // next piece.
    expect(inputs({ hasSelection: true }).active).toBe('inspector');
    expect(inputs({ hasSelection: true, isPlacing: true }).active).toBe('library');
    expect(inputs({ hasSelection: true, isPlacing: true }).showLibrary).toBe(true);
    expect(inputs({ hasSelection: true, isPlacing: true }).showInspector).toBe(false);
    // A tab the operator PICKED still wins over both: the rule is about the
    // automatic choice, not about overriding them.
    expect(inputs({ hasSelection: true, isPlacing: true, chosen: 'inspector' }).active).toBe(
      'inspector',
    );
  });

  it('shows the tool value wherever the active TOOL has one', () => {
    // It used to have to dodge the props tabs, because the props number was the
    // scatter spacing and belonged over the library alone. That number lives in
    // the library's own placement block now, beside the mode and the toggles it
    // only means anything with, so the strip follows the TOOL and nothing else.
    expect(inputs({ mode: 'width' }).showToolValue).toBe(true);
    expect(inputs({ mode: 'width', hasToolValue: false }).showToolValue).toBe(false);
    // No field, nothing to show, whichever panel is up.
    expect(inputs({ hasToolValue: false }).showToolValue).toBe(false);
    expect(inputs({ hasToolValue: false, chosen: 'outliner' }).showToolValue).toBe(false);
    // And the props tool really is one with no field any more, or the case above
    // would be pinning a shape nothing produces.
    expect(TOOL_VALUE_FIELDS.props).toBeNull();
    expect(TOOL_VALUE_FIELDS.width).not.toBeNull();
  });

  it('agrees with the tab table it is built on', () => {
    for (const mode of RAIL_MODES) {
      expect(inputs({ mode: mode.id }).tabs).toEqual(sideTabsFor(mode.id));
    }
  });
});

describe('the readout sections', () => {
  it('gives every tabless mode a non-empty readout, and every tabbed mode none', () => {
    // The two tables answer one question between them, which is why they moved
    // into the same core: a mode with neither tabs nor sections shows a blank
    // column, and one with both would show two things at once.
    for (const mode of RAIL_MODES) {
      const tabless = sideTabsFor(mode.id).length === 0 && mode.id !== 'race';
      expect(MODE_READOUT[mode.id].length > 0, mode.id).toBe(tabless);
    }
  });

  it('draws every mode section from the drawer own list, so nothing is orphaned', () => {
    for (const mode of RAIL_MODES) {
      for (const section of MODE_READOUT[mode.id]) {
        expect(READOUT_SECTIONS, `${mode.id}/${section}`).toContain(section);
      }
    }
  });

  it('lists every section once in the drawer', () => {
    expect(new Set(READOUT_SECTIONS).size).toBe(READOUT_SECTIONS.length);
    expect(MAX_LISTED_PROBLEMS).toBeGreaterThan(0);
  });
});

describe('what a blank canvas refuses', () => {
  it('derives the list from the table flag, not a second hand-kept copy', () => {
    expect(CIRCUIT_ONLY_ACTIONS.length).toBeGreaterThan(0);
    for (const action of EDITOR_ACTIONS) {
      expect(needsCircuit(action.id), action.id).toBe(Boolean(action.needsCircuit));
    }
  });

  it('refuses every action that edits or exports a circuit', () => {
    for (const id of [
      'saveDraft',
      'copyRecord',
      'fitEnclosure',
      'fixCorners',
      'redrawCenterline',
      'toggleDock',
    ] as const) {
      expect(needsCircuit(id), id).toBe(true);
    }
  });

  it('lets a blank canvas reach the one thing it can do, and the view controls', () => {
    // SHAPE is the only tool on a blank canvas, and it is where the first stroke
    // lands, so it must never be refused.
    expect(needsCircuit('modeShape')).toBe(false);
    expect(needsCircuit(MODE_ACTIONS.shape)).toBe(false);
    for (const id of ['newBlank', 'load', 'undo', 'toggleGrid', 'fitView', 'keys'] as const) {
      expect(needsCircuit(id), id).toBe(false);
    }
  });

  it('refuses the three rail modes that need a circuit, and only those', () => {
    for (const mode of RAIL_MODES) {
      const refused = needsCircuit(MODE_ACTIONS[mode.id]);
      expect(refused, mode.id).toBe(mode.id !== 'shape');
      // And each is a real row, so the flag cannot be set on a name nothing has.
      expect(editorAction(MODE_ACTIONS[mode.id]).id).toBe(MODE_ACTIONS[mode.id]);
    }
  });
});

describe('the props arm state', () => {
  it('says what the next click will do, for as long as it is true', () => {
    // The idle half says what a click WILL do rather than naming the row that
    // used to announce it, since that row is gone from all three palettes.
    expect(armStateText(null, 'pond')).toContain('click a piece to select it');
    expect(armStateText('postLantern', 'pond')).toBe('placing postLantern');
    // Water is dragged out over a box, not clicked, so it says so.
    expect(armStateText('pond', 'pond')).toContain('drag a box');
  });
});
