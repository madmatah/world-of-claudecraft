// What the circuit editor's right column shows, and which actions a blank canvas
// may reach.
//
// Both were rules living in the page as composite boolean expressions, which is
// the shape the local CLAUDE.md forbids: `formEl.hidden = railMode !== 'race' ||
// !drawn` is a decision, not wiring, and it was untestable beside its own sibling
// `sideTabsFor`, which is in a core with two tests. The tell that they belonged
// together: "which tabs a mode has" and "what a mode with no tabs shows instead"
// answer one question, and they were on opposite sides of the seam.
//
// Pure and DOM-free. Dev tool, so English lives here.

import type { SideTabId } from './layout_core';
import { type ActionId, EDITOR_ACTIONS, type RailModeId, sideTabsFor } from './layout_core';

/** A section of the readout, as the drawer and the mode panel both name it. */
export type ReadoutSection =
  | 'shape'
  | 'corners'
  | 'stretches'
  | 'surface'
  | 'dressing'
  | 'envelope';

/** The drawer's order, which is the order the measurements are read in: the
 *  shape, then what it does to a racer, then what stands on it, then whether it
 *  fits the band. */
export const READOUT_SECTIONS: readonly ReadoutSection[] = [
  'shape',
  'corners',
  'stretches',
  'surface',
  'dressing',
  'envelope',
];

/**
 * What the right column shows in a mode that has no tabs.
 *
 * The two shaping tools had the DRESSING outliner sitting in them, which is
 * nothing to do with either: it listed props while the operator was painting a
 * road. What belongs there is the measurements the tool is changing, so shaping
 * shows the geometry and painting shows the road profile.
 */
export const MODE_READOUT: Record<RailModeId, readonly ReadoutSection[]> = {
  shape: ['shape', 'corners', 'envelope'],
  width: ['surface', 'corners'],
  props: [],
  race: [],
};

/** How many problems the drawer lists before it says how many it is holding
 *  back. Every one of them still draws its marker on the plan. */
export const MAX_LISTED_PROBLEMS = 10;

export interface PanelState {
  /** The tabs this mode offers, empty when it offers none. */
  tabs: readonly SideTabId[];
  /** The tab showing, or null when the mode has none. */
  active: SideTabId | null;
  showLibrary: boolean;
  showInspector: boolean;
  showOutliner: boolean;
  showForm: boolean;
  showModeReadout: boolean;
  /** Whether the tool's one number belongs to the panel currently showing. */
  showToolValue: boolean;
}

export interface PanelInputs {
  mode: RailModeId;
  drawn: boolean;
  /** A tab the operator picked, which only applies where the mode offers it. */
  chosen: SideTabId | null;
  hasSelection: boolean;
  /** Whether the active tool has a value field at all. */
  hasToolValue: boolean;
  /** Whether that field is the PROPS one, which belongs to the library alone. */
  toolValueIsProps: boolean;
}

/**
 * Everything the right column shows, from one call.
 *
 * One function rather than six expressions in the page, because the six are not
 * independent: the form and the mode readout are mutually exclusive, the tool
 * value follows the active tab, and a tab the operator chose in another mode must
 * not survive into this one.
 */
export function panelLayout(inputs: PanelInputs): PanelState {
  const { mode, drawn, chosen, hasSelection, hasToolValue, toolValueIsProps } = inputs;
  const tabs = sideTabsFor(mode);
  // A tab picked in another mode is not offered here: the library arms a piece
  // for the props tool and the inspector edits a selected one, and neither is
  // reachable while shaping a centerline.
  const kept = chosen && tabs.includes(chosen) ? chosen : null;
  const active = kept ?? autoTab(tabs, hasSelection);
  const showForm = mode === 'race' && drawn;
  return {
    tabs,
    active,
    showLibrary: active === 'library',
    showInspector: active === 'inspector',
    showOutliner: active === 'outliner',
    showForm,
    // Only where a mode has no tabs AND is not the form's own mode.
    showModeReadout: tabs.length === 0 && mode !== 'race' && drawn,
    // The scatter spacing is a setting FOR the library and had no reason to hang
    // over the inspector and the outliner, which is where it was showing.
    showToolValue: hasToolValue && (!toolValueIsProps || active === 'library'),
  };
}

function autoTab(tabs: readonly SideTabId[], hasSelection: boolean): SideTabId | null {
  if (tabs.length === 0) return null;
  if (hasSelection && tabs.includes('inspector')) return 'inspector';
  return tabs[0];
}

/**
 * What the status bar says the props tool will do with the next click.
 *
 * Held on screen for as long as it is true, which a transient message cannot do:
 * "am I still placing lanterns" is a question about state.
 */
export function armStateText(armed: string | null, pondKey: string): string {
  if (armed === null) return 'pointer: click a piece to select it';
  return armed === pondKey ? 'placing water: drag a box' : `placing ${armed}`;
}

/**
 * Every action that needs a circuit to act on.
 *
 * Derived from the table's own `needsCircuit` flag rather than hand-listed. It was
 * expressed in four places at once (a `drawnOnly` array, nine `if (drawn)` guards
 * inside the dispatcher, a rail-mode loop and the mode host guard), which is the
 * same drift the action table exists to end, one layer up from the shortcuts.
 */
export const CIRCUIT_ONLY_ACTIONS: readonly ActionId[] = EDITOR_ACTIONS.filter(
  (action) => action.needsCircuit,
).map((action) => action.id);

export function needsCircuit(id: ActionId): boolean {
  return CIRCUIT_ONLY_ACTIONS.includes(id);
}
