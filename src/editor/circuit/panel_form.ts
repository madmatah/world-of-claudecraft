// The record form: everything a circuit holds that is NOT drawn and NOT shaped,
// which is the id, the race numbers and the presentation ids.
//
// The enclosure used to end it, and packet 28 moved the wall's two numbers into
// TERRAIN's inspector: a box with grips on the plan, a fit on its own mode's
// bar, and its numbers one rail entry away was the wall being authored from
// three places at once.
//
// Built ONCE and only synced, because rebuilding it on every drag would take the
// focus out of an input the operator is still typing in. `sync()` re-reads the
// record into every control the caret is not in, which is what makes an undo, a
// Load or a fresh draft show up here without the form ever fighting the keyboard.

import { AREA_TRACK_URLS } from '../../game/music_tracks';
import {
  REALM_RACERS_THEME_IDS,
  type RealmRacersCircuit,
  type RealmRacersCircuitRole,
} from '../../sim/content/realm_racers_circuits';
import { validateCircuitPayload } from './export_core';
import { fieldRow, heading, numberOr, type PanelHost } from './panels';

/**
 * The music a circuit may name.
 *
 * The area-track table is the set the game can actually stream for a lane, so it
 * is the honest vocabulary; a circuit naming anything else would play silence.
 * Read off that table rather than re-listed here, so a new track appears in the
 * picker the moment the game can play it.
 */
const MUSIC_TRACK_IDS: readonly string[] = Object.keys(AREA_TRACK_URLS);

/** The record needs at least one role, and this is the order they are kept in. */
const ROLE_ORDER: readonly RealmRacersCircuitRole[] = ['competition', 'practice'];

/** The option value that means "not one of the above". */
const CUSTOM_OPTION = '__custom__';

interface FormField {
  input: HTMLInputElement | HTMLSelectElement;
  read: () => string;
  /**
   * How this control re-reads the record, when assigning `value` is not enough.
   *
   * A `<select>` given a value no option carries goes BLANK, silently. Every
   * commit the control did not make itself lands here (an undo, a Load, a fresh
   * draft), so a select whose options were built for the previous record has to
   * rebuild them rather than take the assignment.
   */
  sync?: () => void;
}

export class RecordFormPanel {
  readonly el = document.createElement('div');
  private readonly fields: FormField[] = [];
  /** The rows only a PRACTICE circuit has, hidden when it is not one. */
  private readonly practiceRows: HTMLElement[] = [];
  /** The role checkboxes, synced from the record rather than trusted. */
  private readonly roleBoxes = new Map<RealmRacersCircuitRole, HTMLInputElement>();

  constructor(private readonly host: PanelHost) {
    this.build();
  }

  /**
   * One edit, validated the way the SAVE endpoint validates.
   *
   * Checked through `validateCircuitPayload` rather than against a second copy of
   * every field's range here: a value the form accepts that the endpoint would
   * refuse is a draft the operator cannot save, found out one step too late. A
   * value that is merely unwise (a region deeper than the lane budget) still
   * lands, because the readout is what says so.
   */
  private applyEdit(label: string, next: RealmRacersCircuit | null, refusal?: string): boolean {
    const valid = next && validateCircuitPayload(next);
    if (!valid) {
      this.host.setStatus(refusal ?? `${label}: not a value a circuit can carry`, 'err');
      return false;
    }
    this.host.commit(valid);
    return true;
  }

  private field(
    parent: HTMLElement,
    label: string,
    read: () => string,
    write: (raw: string) => RealmRacersCircuit | null,
    attrs: Partial<HTMLInputElement> = {},
  ): HTMLDivElement {
    const { wrap, name } = fieldRow(label);
    const input = document.createElement('input');
    input.type = attrs.type ?? 'number';
    Object.assign(input, attrs);
    input.value = read();
    input.onchange = () => {
      // Written back HERE on a refusal rather than through `sync`, which
      // deliberately skips the focused input: a refused edit is the one case
      // where the field still holds the caret and must be overwritten anyway, or
      // the panel shows a number the record does not carry.
      if (!this.applyEdit(`${label}: ${input.value}`, write(input.value))) input.value = read();
      this.sync();
    };
    name.append(input);
    parent.append(wrap);
    this.fields.push({ input, read });
    return wrap;
  }

  /**
   * A real `<select>` over a known set, with a way out.
   *
   * It replaced a datalist, which only ever worked as a SEARCH: there was no way
   * to see what the themes even were, which is the first thing anyone wants from
   * a fixed vocabulary. The way out matters too, and it is why this is not a
   * plain select: an id being written in the same change is legally typeable, and
   * the readout is what says whether a registry authors it (`unknown_theme`). A
   * value already on the record that is not in the list is added as an option, so
   * the control always shows the truth.
   */
  private selectField(
    parent: HTMLElement,
    label: string,
    read: () => string,
    write: (raw: string) => RealmRacersCircuit | null,
    choices: readonly string[],
  ): void {
    const { wrap, name } = fieldRow(label);
    const select = document.createElement('select');
    const custom = document.createElement('input');
    custom.type = 'text';
    custom.placeholder = 'id not in the list';
    custom.hidden = true;

    const fill = (): void => {
      const current = read();
      const known = [...choices, ...(choices.includes(current) || !current ? [] : [current])];
      select.replaceChildren();
      for (const choice of known) {
        const option = document.createElement('option');
        option.value = choice;
        option.textContent = choices.includes(choice) ? choice : `${choice} (not in the list)`;
        select.append(option);
      }
      const other = document.createElement('option');
      other.value = CUSTOM_OPTION;
      other.textContent = 'other, type it';
      select.append(other);
      select.value = current;
    };
    fill();

    select.onchange = () => {
      if (select.value === CUSTOM_OPTION) {
        custom.hidden = false;
        custom.value = read();
        custom.focus();
        select.value = read();
        return;
      }
      custom.hidden = true;
      if (!this.applyEdit(`${label}: ${select.value}`, write(select.value))) fill();
      this.sync();
    };
    custom.onchange = () => {
      if (this.applyEdit(`${label}: ${custom.value}`, write(custom.value))) {
        custom.hidden = true;
        fill();
      }
      this.sync();
    };

    name.append(select);
    wrap.append(custom);
    parent.append(wrap);
    this.fields.push({ input: select, read, sync: fill });
  }

  /**
   * A role, on or off.
   *
   * The record needs at least one, so unchecking the last is REFUSED by name
   * rather than silently ignored: a checkbox that springs back with no
   * explanation reads as a broken control. Turning practice off also zeroes the
   * copy count, because a circuit nobody practises on has nothing to copy.
   */
  private roleBox(parent: HTMLElement, role: RealmRacersCircuitRole, detail: string): void {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const name = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = this.host.record().roles.includes(role);
    name.append(box, ` ${role}`);
    name.title = detail;
    box.onchange = () => {
      const record = this.host.record();
      const wanted = new Set(record.roles);
      if (box.checked) wanted.add(role);
      else wanted.delete(role);
      const roles = ROLE_ORDER.filter((entry) => wanted.has(entry));
      const next =
        roles.length === 0
          ? null
          : {
              ...record,
              roles,
              practiceCopies: roles.includes('practice') ? record.practiceCopies : 0,
            };
      this.applyEdit(
        role,
        next,
        'a circuit has to be at least one of competition or practice, so the last one cannot come off',
      );
      this.sync();
    };
    wrap.append(name);
    parent.append(wrap);
    this.roleBoxes.set(role, box);
  }

  private build(): void {
    const record = (): RealmRacersCircuit => this.host.record();
    this.el.replaceChildren();
    this.fields.length = 0;
    this.practiceRows.length = 0;
    this.roleBoxes.clear();

    this.el.append(heading('roles'));
    const roles = document.createElement('div');
    this.roleBox(
      roles,
      'competition',
      'Drawn from the competition pool when a four-pilot roster fills',
    );
    this.roleBox(
      roles,
      'practice',
      'Offered as practice, with one lane copy per practising player',
    );
    this.el.append(roles);

    this.el.append(heading('race'));
    const race = document.createElement('div');
    this.field(
      race,
      'id',
      () => record().id,
      (raw) => ({ ...record(), id: raw.trim() }),
      {
        type: 'text',
      },
    );
    this.field(
      race,
      'laps',
      () => String(record().laps),
      (raw) => ({ ...record(), laps: Math.round(numberOr(raw, record().laps)) }),
      { min: '1', max: '20', step: '1' },
    );
    this.field(
      race,
      'time limit (s)',
      () => String(record().timeLimitSeconds),
      (raw) => ({ ...record(), timeLimitSeconds: numberOr(raw, record().timeLimitSeconds) }),
      { min: '10', max: '3600', step: '10' },
    );
    this.field(
      race,
      'start back',
      () => String(record().startBack),
      (raw) => ({ ...record(), startBack: numberOr(raw, record().startBack) }),
      { step: '0.5' },
    );
    this.field(
      race,
      'start spacing',
      () => String(record().startSpacing),
      (raw) => ({ ...record(), startSpacing: numberOr(raw, record().startSpacing) }),
      { step: '0.5' },
    );
    this.practiceRows.push(
      this.field(
        race,
        'practice laps',
        () => String(record().practiceLaps),
        (raw) => ({ ...record(), practiceLaps: Math.round(numberOr(raw, record().practiceLaps)) }),
        { min: '1', max: '20', step: '1' },
      ),
      this.field(
        race,
        'practice copies',
        () => String(record().practiceCopies),
        (raw) => ({
          ...record(),
          practiceCopies: Math.round(numberOr(raw, record().practiceCopies)),
        }),
        { min: '0', max: '32', step: '1' },
      ),
    );
    this.el.append(race);

    this.el.append(heading('presentation'));
    const art = document.createElement('div');
    this.selectField(
      art,
      'music track',
      () => record().musicTrack,
      (raw) => ({ ...record(), musicTrack: raw.trim() }),
      MUSIC_TRACK_IDS,
    );
    this.selectField(
      art,
      'theme',
      () => record().theme,
      (raw) => ({ ...record(), theme: raw.trim() }),
      REALM_RACERS_THEME_IDS,
    );
    this.el.append(art);

    // The ENCLOSURE used to end this form, and it left the wall as the one
    // object on this canvas authored from a mode that cannot see it: its grips
    // and its fit are TERRAIN's, and its numbers were a rail entry away. They
    // are in TERRAIN's inspector now, beside the land and the barriers.
  }

  sync(): void {
    for (const { input, read, sync } of this.fields) {
      if (input === document.activeElement) continue;
      if (sync) sync();
      else input.value = read();
    }
    const record = this.host.record();
    for (const [role, box] of this.roleBoxes) box.checked = record.roles.includes(role);
    // A circuit nobody practises on has no practice numbers worth showing. The
    // lap count STAYS on the record while hidden, because the validator holds it
    // to 1 to 20 and a zero there is a draft that cannot be saved.
    const practises = record.roles.includes('practice');
    for (const wrap of this.practiceRows) wrap.hidden = !practises;
  }
}
