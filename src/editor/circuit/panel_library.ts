// The prop library: what the props tool can put down, what it looks like, which
// of them is armed, and how the next gesture will lay it.
//
// It answers the question the old wall of text buttons could not: dressing a
// circuit is a HUNT, and a name is not a picture. Each catalog piece is rendered
// once through the game's own visual registry and cached, and the tiles fold into
// categories whose first and default entry is the CIRCUIT'S OWN THEME, because
// the pieces that belong on this zone are the ones an author reaches for first
// and they were previously buried in a catalog holding every zone's.
//
// The pictures never block. A tile shows its text chip until its photograph
// arrives, a page with no WebGL keeps the chips forever, and neither is an error.
//
// Structure and wiring: what a chip means, what a search matches and what a mode
// lays are `library_core.ts` and `placement_core.ts`.

import { realmRacersTheme } from '../../render/realm_racers_themes';
import { REALM_RACERS_PROPS } from '../../sim/content/realm_racers_props';
import { parseThumbnailCache, THUMBNAIL_STORAGE_KEY } from './draft_store_core';
import {
  filterLibrary,
  LIBRARY_ALL_CATEGORY,
  LIBRARY_DEFAULT_CATEGORY,
  LIBRARY_THEME_CATEGORY,
  libraryCategories,
  libraryCategoryExists,
  libraryEmptyText,
  librarySearchPlaceholder,
} from './library_core';
import { heading, hintLine, type PanelHost } from './panels';
import { type PlacementMode, pressWasDrag, spacingFloor } from './placement_core';
import { POND_CHOICE, type PropPaletteEntry, propPalette } from './props_core';

/** How the next gesture lays what is armed. */
export interface PlacementSettings {
  mode: PlacementMode;
  /** Yards between pieces, shared by scatter and along-road: the one number a
   *  box drag or a road drag cannot carry, since the gesture says where and the
   *  spacing says how dense. */
  spacing: number;
  /** Whether each piece re-reads the road's tangent where it stands. */
  alignToRoad: boolean;
  /** Whether the pieces stop a machine. */
  solid: boolean;
}

export const DEFAULT_PLACEMENT: PlacementSettings = {
  mode: 'single',
  spacing: 8,
  alignToRoad: true,
  solid: true,
};

const PLACEMENT_MODES: readonly { id: PlacementMode; label: string; detail: string }[] = [
  { id: 'single', label: 'single', detail: 'One piece where you drop it' },
  {
    id: 'scatter',
    label: 'scatter',
    detail: 'Drag a box: a seeded fill of one side of the road over that stretch of lap',
  },
  {
    id: 'alongRoad',
    label: 'along road',
    detail:
      'Drag ALONG the road: a row at the spacing, each piece at the offset you started from, all of it authored in track space so it follows a later centerline edit',
  },
];

/** Yards, the widest a row or a fill will space its pieces. */
const SPACING_MAX = 60;

export interface LibraryHost extends PanelHost {
  /** What a click on empty plan will now do: the page owns the cursor, the
   *  status line and the ghost that say so. */
  onArmed(asset: string | null): void;
  /** A tile was pressed: the page turns that into a drag onto the plan. */
  onTileDrag(asset: string, ev: PointerEvent): void;
  /** The placement block changed, so the banner and the ghost can follow. */
  onPlacement(settings: PlacementSettings): void;
}

export class LibraryPanel {
  readonly el = document.createElement('div');
  private readonly searchEl = document.createElement('input');
  private readonly chipsEl = document.createElement('div');
  private readonly gridEl = document.createElement('div');
  private readonly pointerEl = document.createElement('button');
  private readonly placementEl = document.createElement('div');
  private readonly hintEl = hintLine('');

  /**
   * What a click on empty plan PLACES: a catalog asset, the pond, or nothing.
   *
   * Null is the pointer, and it is the default. With something permanently
   * armed, a click that missed the bench the operator meant to grab silently
   * authored a second bench, which is the worst kind of edit: one nobody asked
   * for, at a place nobody chose.
   */
  private choice: string | null = null;
  private category: string = LIBRARY_DEFAULT_CATEGORY;
  private search = '';
  private placement: PlacementSettings = { ...DEFAULT_PLACEMENT };
  /** Which theme the tiles on screen were folded for. */
  private builtFor = '';

  /** The pictures, and the ones still being taken. Both keyed by catalog key. */
  private readonly thumbs = new Map<string, string>();
  private readonly pending = new Set<string>();
  /**
   * The rig, as a PROMISE rather than a flag.
   *
   * It was `rig` plus a `rigTried` boolean set before the dynamic import, and
   * that window is wide: typing in the search box or clicking a chip both repaint
   * the grid, so a second call arrived while the first was still importing, saw
   * "already tried, no rig yet", and returned having already marked its assets
   * pending. Those assets were never unmarked and never photographed again for
   * the life of the page, so a subset of tiles kept its text chip forever with no
   * error and no retry. One promise every caller awaits has no such window.
   */
  private rigPromise: Promise<import('./prop_thumbnails').PropThumbnailRig | null> | null = null;
  private rig: import('./prop_thumbnails').PropThumbnailRig | null = null;
  /**
   * The pointer press still in flight, if there is one.
   *
   * It carries the tile it began on and whether that tile was ALREADY armed,
   * because the press itself arms (a drag has to know what it is carrying from
   * its first move) and the click that follows has to know which of the three
   * things just happened: a fresh arm, a second click asking for the pointer
   * back, or the tail of a drag. Its ABSENCE is the fourth: a click with no
   * press at all is a keyboard activation, and that is a plain toggle.
   */
  private press: { asset: string; x: number; y: number; wasArmed: boolean } | null = null;

  constructor(private readonly host: LibraryHost) {
    this.searchEl.type = 'search';
    this.searchEl.className = 'lib-search';
    this.searchEl.oninput = () => {
      this.search = this.searchEl.value;
      this.paintGrid();
      this.paintChips();
    };
    this.chipsEl.className = 'lib-chips';
    this.gridEl.className = 'lib-grid';
    this.pointerEl.type = 'button';
    this.pointerEl.className = 'pointer-mode';
    this.pointerEl.title =
      'Select and edit what is already there. A click on empty plan places nothing (esc)';
    this.pointerEl.onclick = () => this.arm(null);
    this.placementEl.className = 'lib-placement';
    this.readCache();
    this.paint();
  }

  // ---- the armed piece ----

  get armed(): string | null {
    return this.choice;
  }

  get settings(): PlacementSettings {
    return this.placement;
  }

  /**
   * Arm a piece, or the pointer.
   *
   * It marks the tiles IN PLACE rather than rebuilding the grid, and that is not
   * an optimisation: arming happens on `pointerdown` at the start of a tile
   * drag, and a rebuild there detaches the very button the gesture just captured
   * the pointer on, so the drag ends before it has begun. Rebuilding is for a
   * change of FILTER, which is the only thing that changes which tiles exist.
   */
  arm(asset: string | null): void {
    this.choice = asset;
    this.markArmed();
    this.host.onArmed(asset);
  }

  /** Which tile is lit, and what the pointer row and the hint say about it. */
  private markArmed(): void {
    for (const tile of this.gridEl.querySelectorAll<HTMLElement>('button.lib-tile')) {
      tile.classList.toggle('on', tile.dataset.asset === this.choice);
    }
    this.pointerEl.classList.toggle('on', this.choice === null);
    this.pointerEl.textContent =
      this.choice === null ? 'pointer (armed)' : `pointer (esc) - placing ${this.choice}`;
    this.hintEl.textContent = this.hint();
  }

  /** The palette follows the theme, so retyping the theme field re-offers the
   *  zone's own vocabulary rather than the one the circuit opened on. */
  syncTheme(): void {
    if (this.host.record().theme === this.builtFor) return;
    this.paint();
  }

  // ---- the tiles ----

  private entries(): PropPaletteEntry[] {
    return propPalette(REALM_RACERS_PROPS, realmRacersTheme(this.host.record()).props);
  }

  paint(): void {
    const record = this.host.record();
    this.builtFor = record.theme;
    this.searchEl.placeholder = librarySearchPlaceholder(this.entries().length);
    this.el.replaceChildren();
    this.el.append(heading('library'), this.searchEl, this.chipsEl, this.pointerEl, this.gridEl);
    this.el.append(this.placementEl, this.hintEl);
    this.paintChips();
    this.paintGrid();
    this.paintPlacement();
  }

  private paintChips(): void {
    const categories = libraryCategories(this.entries(), this.host.record().theme);
    // A stored or previously chosen category outlives the theme it was made
    // under; falling back to the theme's own chip beats an empty grid with no
    // visible way out.
    if (!libraryCategoryExists(categories, this.category)) this.category = LIBRARY_THEME_CATEGORY;
    this.chipsEl.replaceChildren();
    for (const category of categories) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip lib-chip';
      chip.textContent = `${category.label} ${category.count}`;
      chip.title =
        category.id === LIBRARY_THEME_CATEGORY
          ? `Only the pieces this circuit's theme names as its own, which is where dressing starts`
          : category.id === LIBRARY_ALL_CATEGORY
            ? 'Every key the catalog authors, whatever zone it belongs to'
            : `The ${category.label} pieces`;
      // A live search outranks the chips, so none of them reads as active while
      // one is running: the grid is showing matches, not a category.
      chip.classList.toggle('on', !this.search.trim() && category.id === this.category);
      chip.onclick = () => {
        this.category = category.id;
        this.search = '';
        this.searchEl.value = '';
        this.paintChips();
        this.paintGrid();
      };
      this.chipsEl.append(chip);
    }
  }

  private paintGrid(): void {
    this.gridEl.replaceChildren();
    // Water first and always: it is placed by the same gesture and belongs to no
    // zone's vocabulary, so no category may hide it.
    this.gridEl.append(
      this.tile(POND_CHOICE, 'water', 'Drag a box: decorative water, no slow and no mechanic'),
    );
    const shown = filterLibrary(this.entries(), { category: this.category, search: this.search });
    for (const entry of shown) this.gridEl.append(this.tile(entry.asset, entry.group, entry.group));
    if (shown.length === 0) {
      this.gridEl.append(
        hintLine(libraryEmptyText({ category: this.category, search: this.search })),
      );
    }
    this.markArmed();
    void this.fillThumbnails(shown.map((entry) => entry.asset));
  }

  private tile(asset: string, badge: string, detail: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lib-tile';
    button.title = detail;
    // The key on the element, so marking the armed tile never has to read its
    // own label back out of the DOM.
    button.dataset.asset = asset;
    button.classList.toggle('on', this.choice === asset);

    button.append(this.face(asset));
    const label = document.createElement('span');
    label.className = 'lib-label';
    label.textContent = asset;
    const kind = document.createElement('span');
    kind.className = 'lib-badge';
    kind.textContent = badge;
    button.append(label, kind);

    /**
     * What a click FINISHES, which is never simply a toggle.
     *
     * The press already armed the tile, because a drag has to know what it is
     * carrying from its first pointermove. So a click that toggled would arm on
     * the press and disarm on the release, and a plain click would arm nothing
     * at all. What is left for the click is the one case the press cannot
     * answer: a piece that was ALREADY armed is being clicked to put the pointer
     * back. And a click that ended a DRAG answers nothing, or the drop would
     * disarm the piece it had just placed.
     */
    button.onclick = (ev) => {
      const press = this.press;
      this.press = null;
      if (press?.asset !== asset) {
        // No pointer press on this tile: the keyboard activated it. Enter and
        // space send a bare click, so this arm has to be the plain toggle or the
        // tiles are unreachable without a mouse.
        this.arm(this.choice === asset ? null : asset);
        return;
      }
      if (pressWasDrag(press, { x: ev.clientX, y: ev.clientY })) return;
      if (press.wasArmed) this.arm(null);
    };
    // ...and pressing it and moving is the primary gesture: drag the tile onto
    // the plan. Arming happens on the way, so a drag that ends nowhere still
    // leaves the piece armed for a click.
    button.onpointerdown = (ev) => {
      if (ev.button !== 0) return;
      // The tile carries an `<img>`, and Chrome answers a press-and-move on one
      // by starting its OWN native image drag, which fires `pointercancel` and
      // takes the capture with it: the gesture died on the first pointermove and
      // nothing about the symptom said "image". Refusing the default is what
      // keeps the drag ours; the focus it also suppresses is put back by hand so
      // the tile stays reachable from the keyboard.
      ev.preventDefault();
      button.focus();
      this.press = {
        asset,
        x: ev.clientX,
        y: ev.clientY,
        wasArmed: this.choice === asset,
      };
      if (!this.press.wasArmed) this.arm(asset);
      this.host.onTileDrag(asset, ev);
    };
    return button;
  }

  /**
   * The tile's picture, or the text chip standing in for it.
   *
   * The chip is what the library used to be, kept as the honest placeholder: it
   * says what the piece is while its photograph is still being taken, and stays
   * forever on a page with no WebGL. Both wear `lib-face`, because a picture
   * arriving REPLACES one in place rather than rebuilding the grid.
   */
  private face(asset: string): HTMLElement {
    const shot = this.thumbs.get(asset);
    if (shot) {
      const img = document.createElement('img');
      img.className = 'lib-face';
      img.src = shot;
      img.alt = '';
      // Belt and braces with the `preventDefault` above: an image is draggable
      // by default and that drag is the one that cancels ours.
      img.draggable = false;
      return img;
    }
    const chip = document.createElement('span');
    chip.className = 'lib-chip-shot lib-face';
    chip.textContent = asset.slice(0, 2);
    return chip;
  }

  /**
   * One picture, onto the tile already on screen.
   *
   * In PLACE, and this is load-bearing rather than tidy: the pictures arrive
   * while the operator is already using the library, and rebuilding the grid to
   * show one detaches whatever tile a drag has captured the pointer on. That is
   * exactly how the drag-a-tile-onto-the-plan gesture died the first time, and
   * nothing about it looked like a repaint problem.
   */
  private applyThumbnail(asset: string): void {
    const tile = this.gridEl.querySelector<HTMLElement>(`button.lib-tile[data-asset="${asset}"]`);
    const face = tile?.querySelector('.lib-face');
    if (!face) return;
    face.replaceWith(this.face(asset));
  }

  // ---- the placement block ----

  private paintPlacement(): void {
    this.placementEl.replaceChildren();
    this.placementEl.append(heading('placement'));

    const modes = document.createElement('div');
    modes.className = 'seg';
    for (const mode of PLACEMENT_MODES) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = mode.label;
      button.title = mode.detail;
      button.classList.toggle('on', this.placement.mode === mode.id);
      button.onclick = () =>
        this.setPlacement({
          mode: mode.id,
          // Carried up to the new mode's floor rather than left below it, or
          // switching to scatter with a row's spacing still set would hand the
          // resolver the cell count the floor exists to prevent.
          spacing: Math.max(spacingFloor(mode.id), this.placement.spacing),
        });
      modes.append(button);
    }
    this.placementEl.append(modes);

    // The spacing is shared BY DESIGN: a scatter and a row are the same question
    // (how dense), and two boxes holding one number is how they disagree.
    const spacing = document.createElement('div');
    spacing.className = 'field';
    const spacingLabel = document.createElement('label');
    spacingLabel.textContent = 'spacing (yd)';
    const slider = document.createElement('input');
    slider.type = 'range';
    // The floor is the MODE's, not one shared number. A scatter's is higher and
    // for a reason that is not taste: the resolver walks a grid of
    // `(2*halfX/spacing) x (2*halfZ/spacing)` cells with a spline projection in
    // each, so halving the spacing quadruples the work, and on an 1100 yard
    // circuit a floor of one yard is a page that stops answering.
    slider.min = String(spacingFloor(this.placement.mode));
    slider.max = String(SPACING_MAX);
    slider.step = '0.5';
    slider.value = String(Math.max(spacingFloor(this.placement.mode), this.placement.spacing));
    const readout = document.createElement('span');
    readout.className = 'lib-spacing';
    readout.textContent = this.placement.spacing.toFixed(1);
    slider.oninput = () => {
      readout.textContent = Number(slider.value).toFixed(1);
      this.setPlacement({ spacing: Number(slider.value) }, false);
    };
    spacingLabel.append(slider);
    spacing.append(spacingLabel, readout);
    // The spacing means nothing to a single piece, so it is not offered there.
    spacing.hidden = this.placement.mode === 'single';
    this.placementEl.append(spacing);

    this.placementEl.append(
      this.toggle(
        'align to road',
        this.placement.alignToRoad,
        'Each piece faces the racing direction where it stands, and re-reads it if the centerline moves',
        (on) => this.setPlacement({ alignToRoad: on }),
      ),
      this.toggle(
        'solid',
        this.placement.solid,
        'Whether the pieces stop a machine. A row of decorative lanterns is scenery; a row of solid ones is a wall',
        (on) => this.setPlacement({ solid: on }),
      ),
    );
  }

  private toggle(
    label: string,
    on: boolean,
    detail: string,
    write: (next: boolean) => void,
  ): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const name = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = on;
    box.onchange = () => write(box.checked);
    name.append(box, ` ${label}`);
    name.title = detail;
    wrap.append(name);
    return wrap;
  }

  private setPlacement(next: Partial<PlacementSettings>, repaint = true): void {
    this.placement = { ...this.placement, ...next };
    if (repaint) this.paintPlacement();
    this.hintEl.textContent = this.hint();
    this.host.onPlacement(this.placement);
  }

  private hint(): string {
    if (this.host.mode() !== 'props') {
      return 'arm a piece here, then switch to the PROPS tool to place it';
    }
    if (this.choice === null) return 'drag a tile onto the plan, or arm one and click';
    switch (this.placement.mode) {
      case 'scatter':
        return 'drag a box on the plan to sow a seeded patch at the spacing';
      case 'alongRoad':
        return 'drag ALONG the road to lay a row at the spacing, offset from where you started';
      default:
        return 'drag a tile or click the plan; R rotates the ghost, shift+R faces the racing direction';
    }
  }

  // ---- the pictures ----

  private readCache(): void {
    try {
      for (const [asset, url] of Object.entries(
        parseThumbnailCache(window.localStorage.getItem(THUMBNAIL_STORAGE_KEY)),
      )) {
        this.thumbs.set(asset, url);
      }
    } catch {
      // Private browsing throws on access. The tiles simply get taken again.
    }
  }

  private writeCache(): void {
    try {
      window.localStorage.setItem(
        THUMBNAIL_STORAGE_KEY,
        JSON.stringify(Object.fromEntries(this.thumbs)),
      );
    } catch {
      // A full quota is not worth a message: the pictures are a convenience and
      // the in-page map still holds them for this session.
    }
  }

  /**
   * Take whatever pictures the visible tiles are still missing.
   *
   * One at a time and only for what is on screen: the rig is a GL context, and
   * the operator is looking at a dozen tiles rather than the whole catalog.
   */
  private async fillThumbnails(assets: readonly string[]): Promise<void> {
    const wanted = assets.filter((asset) => !this.thumbs.has(asset) && !this.pending.has(asset));
    if (wanted.length === 0) return;
    for (const asset of wanted) this.pending.add(asset);
    try {
      const rig = await this.rigFor();
      if (!rig) return;
      let took = 0;
      for (const asset of wanted) {
        const shot = await rig.thumbnail(asset);
        if (!shot) continue;
        this.thumbs.set(asset, shot);
        this.applyThumbnail(asset);
        took++;
      }
      // Written once at the end rather than per picture: a synchronous storage
      // write per tile is thirty of them inside the second the library opens.
      if (took > 0) this.writeCache();
    } finally {
      // Unmarked on EVERY path, including the one where there is no rig at all:
      // an asset left pending is an asset no later repaint will ever try again.
      for (const asset of wanted) this.pending.delete(asset);
    }
  }

  private rigFor(): Promise<import('./prop_thumbnails').PropThumbnailRig | null> {
    if (!this.rigPromise) {
      this.rigPromise = import('./prop_thumbnails')
        .then(({ PropThumbnailRig }) => {
          this.rig = new PropThumbnailRig();
          return this.rig;
        })
        .catch(() => null);
    }
    return this.rigPromise;
  }

  dispose(): void {
    this.rig?.dispose();
    this.rig = null;
  }
}
