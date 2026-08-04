// The prop library: what the props tool can put down, and which of them is armed.
//
// The palette is folded by the THEME, not by a favourites list: a theme carries
// the catalog keys that belong on a circuit in that zone, and those are what is
// offered before the whole catalog is unfolded. It FILTERS nothing, because a
// record may place any key and the readout judges the PLACEMENT rather than the
// vocabulary.
//
// The POINTER is a mode, not a piece, so it gets its own row above the tiles: as
// the first tile in the list it read as "the first asset is armed", which is the
// opposite of what it means.

import { realmRacersTheme } from '../../render/realm_racers_themes';
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import { heading, hintLine, type PanelHost } from './panels';
import { POND_CHOICE, propPalette } from './props_core';

export interface LibraryHost extends PanelHost {
  /** What a click on empty plan will now do: the page owns the cursor, the
   *  status line and the ghost that say so. */
  onArmed(asset: string | null): void;
}

export class LibraryPanel {
  readonly el = document.createElement('div');
  private readonly listEl = document.createElement('div');
  private readonly pointerEl = document.createElement('button');
  private readonly showAllLabel = document.createElement('label');
  private readonly showAllEl = document.createElement('input');
  /**
   * What a click on empty plan PLACES: a catalog asset, the pond, or nothing.
   *
   * Null is the pointer, and it is the default. With something permanently
   * armed, a click that missed the bench the operator meant to grab silently
   * authored a second bench, which is the worst kind of edit: one nobody asked
   * for, at a place nobody chose.
   */
  private choice: string | null = null;
  private showAll = false;
  /** Which theme the palette on screen was built for. */
  private builtFor = '';

  constructor(private readonly host: LibraryHost) {
    this.listEl.className = 'palette-list';
    this.pointerEl.type = 'button';
    this.pointerEl.className = 'pointer-mode';
    this.pointerEl.title =
      'Select and edit what is already there. A click on empty plan places nothing (esc)';
    this.pointerEl.onclick = () => this.arm(null);
    this.showAllLabel.id = 'paletteAllLabel';
    this.showAllEl.type = 'checkbox';
    this.showAllLabel.append(this.showAllEl, ' show the whole catalog');
    this.showAllEl.onchange = () => {
      this.showAll = this.showAllEl.checked;
      this.paint();
    };
    this.paint();
  }

  get armed(): string | null {
    return this.choice;
  }

  /** Arm a piece, or the pointer. The page is told, because the cursor, the
   *  status line and the ghost all say which state the tool is in. */
  arm(asset: string | null): void {
    this.choice = asset;
    this.paint();
    this.host.onArmed(asset);
  }

  /** The palette follows the theme, so retyping the theme field re-offers the
   *  zone's own vocabulary rather than the one the circuit opened on. */
  syncTheme(): void {
    const theme = this.host.record().theme;
    if (theme === this.builtFor) return;
    this.paint();
  }

  paint(): void {
    const record = this.host.record();
    this.builtFor = record.theme;
    this.el.replaceChildren();
    this.listEl.replaceChildren();
    const entries = propPalette(REALM_RACERS_PROPS, realmRacersTheme(record).props);
    const shown = this.showAll ? entries : entries.filter((entry) => entry.featured);
    const choose = (key: string, label: string, detail: string): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.title = detail;
      button.classList.toggle('on', this.choice === key);
      // Clicking the armed piece again disarms it, so the pointer is always one
      // click away from wherever the operator's hand already is.
      button.onclick = () => this.arm(this.choice === key ? null : key);
      this.listEl.append(button);
    };
    choose(POND_CHOICE, 'pond', 'Drag a box: decorative water, no slow and no mechanic');
    for (const entry of shown) choose(entry.asset, entry.asset, entry.group);
    this.pointerEl.classList.toggle('on', this.choice === null);
    this.pointerEl.textContent =
      this.choice === null ? 'pointer (armed)' : `pointer (esc) - placing ${this.choice}`;
    this.showAllEl.checked = this.showAll;
    this.el.append(
      heading('library'),
      this.pointerEl,
      this.listEl,
      this.showAllLabel,
      hintLine(this.hint()),
    );
  }

  private hint(): string {
    if (this.host.mode() !== 'props')
      return 'arm a piece here, then switch to the PROPS tool to place it';
    return this.choice === null
      ? 'arm a piece above, then click the plan to place one'
      : 'click the plan to place one; shift+drag a box to sow a whole patch of them at the spacing above';
  }
}
