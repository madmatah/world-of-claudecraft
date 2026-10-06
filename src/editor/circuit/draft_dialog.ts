// The Load dialog's other half: the scratch drafts the save endpoint has
// written, listed so nobody has to remember an id.
//
// The dev server could list and parse them from the day those endpoints existed
// and nothing read the list, so the only way back into last week's circuit was to
// type its id at `/dev overdrivedraft`.
//
// A sibling module rather than a block in `main.ts`, on this directory's own
// test for which side of the seam something belongs on: none of this needs the
// page's private gesture state (the live pointer, the view transform, the undo
// stack). It builds elements, reads two endpoints and hands back a record.
//
// Structure and wiring only, like `shell.ts` and the `panel_*` family: what a
// row SAYS is `draft_store_core.ts`'s (`diskDraftRows`), and what an id may
// legally be was decided at the endpoint before it ever got here. Dev tool, so
// English lives here.

import {
  CIRCUIT_DRAFT_ENDPOINT,
  CIRCUIT_DRAFT_LIST_ENDPOINT,
} from '../../game/mortar_overdrive/draft_dev';
import type { MortarOverdriveCircuit } from '../../sim/content/mortar_overdrive';
import { type DiskDraftRow, diskDraftRows } from './draft_store_core';
import { editorIcon } from './editor_icons';
import { validateCircuitPayload } from './export_core';
import { hintLine } from './panels';
import type { MessageTone } from './shell';

export interface DraftDialogHost {
  /** Take a draft on disk as the working document, and close the dialog with
   *  it: the two are one act, and a dialog left open over a freshly loaded
   *  circuit is a dialog the operator has to dismiss to see what they asked for. */
  load(circuit: MortarOverdriveCircuit, label: string): void;
  setStatus(text: string, tone?: MessageTone): void;
  /** The wall clock, injected. The ages are the one thing on this list that is
   *  not a function of the payload, and a core that reads a clock cannot be
   *  driven by a test. */
  now(): number;
}

export class DraftDialog {
  constructor(
    private readonly listEl: HTMLElement,
    private readonly host: DraftDialogHost,
  ) {}

  /**
   * Re-read the directory.
   *
   * Called on every OPEN rather than once at boot: `tmp/circuit-drafts` is
   * scratch space, and another window, a shell, or this page's own Save draft
   * all change it under the dialog.
   */
  async refresh(): Promise<void> {
    this.listEl.replaceChildren(hintLine('reading tmp/circuit-drafts...'));
    let rows: DiskDraftRow[];
    try {
      const response = await fetch(CIRCUIT_DRAFT_LIST_ENDPOINT);
      if (!response.ok) throw new Error(await response.text());
      rows = diskDraftRows(await response.json(), this.host.now());
    } catch (err) {
      // The endpoints only exist under `npm run dev`, so a page opened off a
      // static server has no drafts rather than a broken dialog: everything else
      // in it still works.
      this.listEl.replaceChildren(hintLine(`no draft list: ${err}`));
      return;
    }
    this.listEl.replaceChildren(
      ...(rows.length === 0
        ? [hintLine('nothing saved yet: draw a circuit and press Save draft')]
        : rows.map((row) => this.row(row))),
    );
  }

  /** One draft: its name, how long ago it was written, and a way to be rid of
   *  it. The same row shape the outliner uses, because it is the same thing: a
   *  name, a detail and a delete. */
  private row(row: DiskDraftRow): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'outline-row';
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'n';
    name.textContent = row.id;
    name.title = `Load ${row.id} from tmp/circuit-drafts`;
    name.onclick = () => void this.open(row.id);
    const detail = document.createElement('span');
    detail.textContent = row.detail;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'x-btn outline-del';
    remove.innerHTML = editorIcon('trash');
    remove.title = `Delete tmp/circuit-drafts/${row.id}.ts`;
    remove.onclick = () => void this.discard(row.id);
    el.append(name, detail, remove);
    return el;
  }

  private async open(id: string): Promise<void> {
    try {
      const response = await fetch(`${CIRCUIT_DRAFT_ENDPOINT}/${id}`);
      if (!response.ok) throw new Error(await response.text());
      // Validated here as well as at the endpoint, on the same rule `/dev
      // mortarOverdriveDraft` follows: this record is about to become the document, and
      // the one validator both ends share is the one the editor exports through.
      const circuit = validateCircuitPayload(await response.json());
      if (!circuit) throw new Error('not a circuit record');
      // Under its OWN id, unlike a shipped circuit. That one is renamed so
      // editing it can never hand the memoized derivation of a live circuit a
      // shape the game did not author; a draft is already a draft, and renaming
      // it would leave Save draft writing a SECOND file while
      // `/dev overdrivedraft <id>` went on racing the one it was opened from.
      this.host.load(circuit, id);
    } catch (err) {
      this.host.setStatus(`could not load draft ${id}: ${err}`, 'err');
    }
  }

  private async discard(id: string): Promise<void> {
    try {
      const response = await fetch(`${CIRCUIT_DRAFT_ENDPOINT}/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      this.host.setStatus(`deleted tmp/circuit-drafts/${id}.ts`, 'ok');
    } catch (err) {
      this.host.setStatus(`could not delete draft ${id}: ${err}`, 'err');
    }
    // Either way: a failed delete leaves a row the list has to go on showing,
    // and a successful one leaves a row that must not be clickable a second
    // time.
    await this.refresh();
  }
}
