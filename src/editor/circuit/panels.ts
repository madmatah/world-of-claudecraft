// What the circuit editor's right column and its readout drawer are made OF:
// the host every panel reads the document through, and the handful of element
// shapes all five of them repeat.
//
// The panels used to be built inline in `main.ts`, which is how the commit that
// extracted four modules still left the coordinator BIGGER than it found it:
// roughly 770 lines of pure element construction with no canvas coupling at all.
// None of it needs the page's private state, only the record, the readout and a
// way to commit an edit, so all of it is a sibling module behind this interface,
// exactly the way `shell.ts` sits behind `ShellHost`.
//
// Structure and wiring only, like `shell.ts` and `dock.ts`: every rule these
// panels apply comes from a core (`panel_core.ts`, `layout_core.ts`,
// `props_core.ts`) or from the sim's own readout. Dev tool, so English lives
// here (no `t()`).

import type { RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import type { RealmRacersCircuitMetrics } from '../../sim/realm_racers_circuit_metrics';
import type { RallyTrackModel } from '../../sim/realm_racers_spline';
import type { RailModeId } from './layout_core';
import type { DressingSelection } from './props_core';
import type { MessageTone } from './shell';

/**
 * The document, as a panel sees it.
 *
 * Accessors rather than values, because a panel outlives every record it paints:
 * `commit` replaces the record object on every edit, and a panel handed the old
 * one at construction would go on editing a circuit nobody is looking at.
 */
export interface PanelHost {
  record(): RealmRacersCircuit;
  metrics(): RealmRacersCircuitMetrics;
  track(): RallyTrackModel;
  /** Whether there is a circuit at all, or only the blank canvas placeholder. */
  drawn(): boolean;
  mode(): RailModeId;
  selection(): DressingSelection | null;
  /** A whole-record edit, already rounded and re-derived by the page. */
  commit(next: RealmRacersCircuit): void;
  /** One dressing list replaced, with the basin kept in step. */
  commitDressing(next: Partial<RealmRacersCircuit>): void;
  setStatus(text: string, tone?: MessageTone): void;
}

export function heading(text: string): HTMLHeadingElement {
  const node = document.createElement('h2');
  node.textContent = text;
  return node;
}

export function hintLine(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'hint-line';
  node.textContent = text;
  return node;
}

/** The muted line under a block: what the record says about the selection that
 *  is not itself editable. */
export function detailLine(text: string): HTMLDivElement {
  const node = document.createElement('div');
  node.className = 'd';
  node.textContent = text;
  return node;
}

/** A labelled row, the shape both the record form and the inspector are built
 *  from. The caller appends its own control to `name`. */
export function fieldRow(label: string): { wrap: HTMLDivElement; name: HTMLLabelElement } {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const name = document.createElement('label');
  name.textContent = label;
  wrap.append(name);
  return { wrap, name };
}

export function panelButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

/** A typed number, or what the record already carries. Every numeric input in
 *  these panels is a text box that can hold nonsense mid-typing. */
export function numberOr(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
