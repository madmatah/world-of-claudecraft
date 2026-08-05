// The TERRAIN tool's two panels: which barrier kit the next run is drawn in, and
// the numbers behind what it has selected.
//
// The palette offers KITS and nothing else. The land's own shape is not in it,
// and that is a decision rather than an omission: a palette is for picking one
// of many, a circuit has ONE ground, and the gesture is not the same either (a
// barrier is dropped point by point, the ground is one closed stroke). It arms
// from the banner instead, beside the other actions about the terrain.
//
// There is no POINTER ROW either, in any of the three palettes any more. It was
// a third way to say what the lit tile and `esc` already say, in the panel's
// most prominent slot, and what it said while nothing was armed was that
// nothing was armed. The pointer STATE is untouched: it is what stops a click
// that missed from authoring a piece nobody asked for.
//
// The library is folded by the THEME, like the props library: a theme's
// `barriers` list is the two or three kits that look like its zone, and every
// other kit in the catalog is one click away. A theme's vocabulary is an
// authoring aid and never a filter, so the record may name any of them and the
// readout judges the placement rather than the choice.
//
// Structure and wiring only. What a click does to a run, what a drag does to a
// point and what centring moves are `fences_core.ts`; where the modules stand is
// the sim's own resolver. Dev tool, so English lives here (no `t()`).

import {
  REALM_RACERS_BARRIER_KEYS,
  REALM_RACERS_BARRIERS,
} from '../../sim/content/realm_racers_barriers';
import type { RealmRacersCircuit } from '../../sim/content/realm_racers_circuits';
import { realmRacersFencePlacements } from '../../sim/realm_racers_fences';
import { parseThumbnailCache, THUMBNAIL_STORAGE_KEY } from './draft_store_core';
import { editorIcon } from './editor_icons';
import { MIN_PERIMETER_HALF } from './enclosure_core';
import { MAX_PERIMETER_HALF_X, MAX_PERIMETER_HALF_Z } from './envelope_core';
import { FENCE_SCALE_MAX, FENCE_SCALE_MIN, fenceColliderCount } from './fences_core';
import {
  detailLine,
  fieldRow,
  heading,
  hintLine,
  numberOr,
  type PanelHost,
  panelButton,
} from './panels';
import { BARRIER_PREFIX, barrierThumbnailKey } from './thumbnail_core';

export interface TerrainPanelHost extends PanelHost {
  /** Which barrier is selected, by index into the record's list. */
  fenceSelection(): number | null;
  /** Which point of the GROUND outline is selected, if any. */
  groundSelection(): number | null;
  /** How many points the run being drawn holds, or null when none is. */
  draftPointCount(): number | null;
  /** Whether the LAND is armed, which is a state this palette does not own (the
   *  banner does) and still has to describe: the right column stays pinned here
   *  for the whole gesture, so a hint line reading "click a barrier" while the
   *  next drag shapes the ground is the panel contradicting the tool. */
  groundArmed(): boolean;
  setFenceScale(scale: number): void;
  removeFence(): void;
  /** Finish the run being drawn as an open one. */
  finishDraft(): void;
  /** What a click on the plan will now do: the page owns the cursor, the banner
   *  and the ghost that say so. */
  onArmed(kit: string | null): void;
  /** The theme id on the record, which decides the palette's default fold. */
  themeBarriers(): readonly string[];
}

/** What one kit is called on a tile: the catalog key split at its humps, which
 *  is what a key like `ornateRailing` is written to read as. */
export function barrierKitLabel(kit: string): string {
  return kit.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}

/**
 * The palette: this theme's kits, then everything else.
 *
 * Two groups rather than a chip strip, because thirteen kits is a list an eye
 * reads at once and the props library's chip machinery exists for a catalog of a
 * hundred and eighty. What both share is the rule: the theme's own vocabulary
 * leads, and nothing is hidden behind it.
 */
export class TerrainPalettePanel {
  readonly el = document.createElement('div');
  private readonly gridEl = document.createElement('div');
  private readonly hintEl = hintLine('');
  private choice: string | null = null;
  /**
   * The pictures, and the rig that takes them.
   *
   * The same shape the props library carries, and shared with it through
   * `localStorage` under the one version salt: the two panels photograph
   * different catalogs, so the keys are namespaced (`barrier:ironwork`) and a
   * kit and a prop that happen to share a word cannot show each other's tile.
   *
   * The rig is a GL context, imported on demand, and a page with no WebGL keeps
   * the text chips for ever, which is the state this panel shipped in.
   */
  private readonly shots = new Map<string, string>();
  private readonly pending = new Set<string>();
  private rigPromise: Promise<import('./prop_thumbnails').PropThumbnailRig | null> | null = null;
  private rig: import('./prop_thumbnails').PropThumbnailRig | null = null;
  /** The theme vocabulary the grid was last built for, so a repaint that changed
   *  nothing does not rebuild what the pointer is aiming at. */
  private builtFor: string | null = null;

  constructor(private readonly host: TerrainPanelHost) {
    this.gridEl.className = 'lib-grid';
    this.readCache();
    this.paint();
  }

  get armed(): string | null {
    return this.choice;
  }

  arm(kit: string | null): void {
    this.choice = kit === this.choice ? null : kit;
    this.markArmed();
    this.host.onArmed(this.choice);
  }

  /**
   * Repainted with the readout, because the theme's fold follows the record and
   * the hint counts the points in the run being drawn.
   *
   * The GRID is rebuilt only when the fold actually changed, which is the props
   * library's own hard-won rule at one remove: this runs on every repaint, and a
   * grid rebuilt under the pointer is a click that lands on an element that no
   * longer exists. Everything else here (the armed marks, the hint line) is a
   * write onto elements that stay put.
   */
  paint(): void {
    const own = this.host.themeBarriers().filter((kit) => REALM_RACERS_BARRIERS[kit]);
    const rest = REALM_RACERS_BARRIER_KEYS.filter((kit) => !own.includes(kit));
    const signature = own.join(',');
    if (this.builtFor === signature) {
      this.markArmed();
      return;
    }
    this.builtFor = signature;
    this.gridEl.replaceChildren();
    const addTile = (kit: string): void => {
      const def = REALM_RACERS_BARRIERS[kit];
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'lib-tile';
      tile.dataset.kit = kit;
      tile.title = `${def.height.toFixed(2)} yd tall, ${(def.halfThickness * 2).toFixed(2)} yd thick`;
      const shot = document.createElement('span');
      shot.className = 'lib-chip-shot';
      this.paintShot(shot, kit);
      const label = document.createElement('span');
      label.className = 'lib-label';
      label.textContent = barrierKitLabel(kit);
      tile.append(shot, label);
      tile.onclick = () => this.arm(kit);
      this.gridEl.append(tile);
    };
    if (own.length > 0) {
      this.gridEl.append(heading("this zone's"));
      for (const kit of own) addTile(kit);
    }
    this.gridEl.append(heading(own.length > 0 ? 'every kit' : 'kits'));
    for (const kit of rest) addTile(kit);
    this.el.replaceChildren(heading('barrier kits'), this.gridEl, this.hintEl);
    this.markArmed();
    void this.fillShots([...own, ...rest]);
  }

  /** A tile's face: its picture once there is one, and the tool's own glyph
   *  until then. Never blocking, and never empty. */
  private paintShot(into: HTMLElement, kit: string): void {
    const shot = this.shots.get(barrierThumbnailKey(kit));
    if (!shot) {
      into.innerHTML = editorIcon('terrain');
      return;
    }
    const img = document.createElement('img');
    img.src = shot;
    img.alt = '';
    img.draggable = false;
    into.replaceChildren(img);
  }

  /**
   * Take whatever pictures the tiles are still missing.
   *
   * A picture arriving REPLACES one tile's face in place rather than rebuilding
   * the grid, which is the props library's own hard-won rule: the grid is what a
   * click lands on, and rebuilding it under the pointer is how a gesture dies.
   */
  private async fillShots(kits: readonly string[]): Promise<void> {
    const wanted = kits.filter(
      (kit) => !this.shots.has(barrierThumbnailKey(kit)) && !this.pending.has(kit),
    );
    if (wanted.length === 0) return;
    for (const kit of wanted) this.pending.add(kit);
    try {
      const rig = await this.rigFor();
      if (!rig) return;
      let took = 0;
      for (const kit of wanted) {
        const key = barrierThumbnailKey(kit);
        const shot = await rig.thumbnail(key);
        if (!shot) continue;
        this.shots.set(key, shot);
        took++;
        const face = this.gridEl.querySelector<HTMLElement>(
          `button.lib-tile[data-kit="${kit}"] .lib-chip-shot`,
        );
        if (face) this.paintShot(face, kit);
      }
      // Written once at the end rather than per picture, the props library's own
      // rule: a synchronous storage write per tile is eleven of them inside the
      // second the palette opens.
      if (took > 0) this.writeCache();
    } finally {
      for (const kit of wanted) this.pending.delete(kit);
    }
  }

  /** The store is SHARED with the props library, one entry per namespaced key,
   *  so a kit photographed once stays photographed across reloads. */
  private readCache(): void {
    try {
      for (const [key, url] of Object.entries(
        parseThumbnailCache(window.localStorage.getItem(THUMBNAIL_STORAGE_KEY)),
      )) {
        if (key.startsWith(BARRIER_PREFIX)) this.shots.set(key, url);
      }
    } catch {
      // Private browsing throws on access. The tiles simply get taken again.
    }
  }

  /** Merged into whatever is already there rather than written over it: the
   *  props library owns the other half of this store, and a whole-map write
   *  from here would drop every prop tile it had taken. */
  private writeCache(): void {
    try {
      const held = parseThumbnailCache(window.localStorage.getItem(THUMBNAIL_STORAGE_KEY));
      for (const [key, url] of this.shots) held[key] = url;
      window.localStorage.setItem(THUMBNAIL_STORAGE_KEY, JSON.stringify(held));
    } catch {
      // A full quota is not worth a message: the pictures are a convenience and
      // the in-page map still holds them for this session.
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

  private markArmed(): void {
    for (const tile of this.gridEl.querySelectorAll<HTMLElement>('button.lib-tile')) {
      tile.classList.toggle('on', tile.dataset.kit === this.choice);
    }
    this.hintEl.textContent = terrainArmStateText(
      this.choice,
      this.host.draftPointCount(),
      this.host.groundArmed(),
    );
  }
}

/**
 * What the palette says under the tiles.
 *
 * It answers "am I still drawing, and how do I stop" for as long as that is
 * true, which a transient status message cannot. The point COUNT is in it
 * because the two ways out of a drawing gesture become available at different
 * counts: two points can be finished open, three can be closed into a ring.
 */
export function terrainArmStateText(
  kit: string | null,
  points: number | null,
  groundArmed = false,
): string {
  // The ground first: it is armed from the banner rather than from this palette,
  // so an armed kit and an armed ground cannot both be true, and the one the
  // operator is holding is the one the line has to describe.
  if (groundArmed) {
    return 'shaping the ground: drag one closed loop around the circuit, esc to stop';
  }
  // The point COUNT comes before the armed kit, because a run in progress is
  // described by how far along it is: the inspector asks about a draft with no
  // kit in hand, and the idle sentence is not an answer to that.
  if (points !== null && points > 0) return runInProgressText(points);
  if (!kit) {
    return 'click a barrier or a ground handle to select it, drag it to move it';
  }
  if (points === null || points === 0) {
    return `drawing ${barrierKitLabel(kit)}: click to drop the first point`;
  }
  return runInProgressText(points);
}

/** How a run in progress ENDS, which changes with its point count: two points
 *  can be finished open, three can be closed into a ring. */
function runInProgressText(points: number): string {
  if (points === 1) return '1 point: click again to make it a run, esc to cancel';
  if (points === 2) return '2 points: enter finishes the run, or keep clicking. Esc cancels';
  return `${points} points: click the first point to close the ring, enter to finish it open`;
}

/**
 * The selected barrier's numbers.
 *
 * Repainted with the readout EXCEPT while one of its own inputs holds the caret,
 * the rule every inspector on this page keeps: a drag repaints the panel, and
 * rebuilding under a half-typed number takes the focus out of it.
 *
 * The COLLIDER COUNT is here rather than only in the drawer because it is the
 * one cost a barrier has that its shape does not show: a run is one collider
 * however long it is, so a ten-cornered ring costs ten and a straight line
 * across the same ground costs one.
 */
export class TerrainInspectorPanel {
  readonly el = document.createElement('div');

  constructor(private readonly host: TerrainPanelHost) {
    this.el.id = 'terrainInspector';
  }

  paint(): void {
    if (this.el.hidden || this.el.contains(document.activeElement)) return;
    this.el.replaceChildren();
    // Two permanent groups, the LAND then the BARRIERS standing on it, each with
    // its own title whether or not it has a selection to report. They used to
    // run into each other as one column of lines, so nothing on screen said
    // which of the two a number belonged to; and a group that appears only when
    // it has something to say is a group an operator cannot learn the position
    // of.
    this.el.append(...this.landRows());
    this.el.append(...this.barrierRows());
    this.el.append(...this.wallRows());
  }

  /**
   * The wall's two numbers, editable.
   *
   * They lived in the RACE tool's record form until packet 28, which made the
   * wall the one object on this canvas authored from a mode that cannot see it:
   * the grips are here, `Fit wall` is here, and the numbers were one rail entry
   * away. Third rather than first because it is the outermost of the three: the
   * land, the barriers standing on it, then the box around both.
   *
   * HALF-extents, spelled as such, because that is what the record holds and
   * what the grips write. A field called "width" over a number that is half of
   * one is a field that will be typed into wrong.
   */
  private wallRows(): HTMLElement[] {
    const record = this.host.record();
    const out: HTMLElement[] = [heading('the wall')];
    out.push(
      this.wallField('half x', record.perimeter.halfX, MAX_PERIMETER_HALF_X, (halfX) => ({
        ...record,
        perimeter: { ...record.perimeter, halfX },
      })),
    );
    out.push(
      this.wallField('half z', record.perimeter.halfZ, MAX_PERIMETER_HALF_Z, (halfZ) => ({
        ...record,
        perimeter: { ...record.perimeter, halfZ },
      })),
    );
    out.push(
      detailLine(
        `${record.perimeter.halfX * 2} x ${record.perimeter.halfZ * 2} yd: drag a grip on the plan, or Fit wall`,
      ),
    );
    return out;
  }

  private wallField(
    label: string,
    value: number,
    max: number,
    write: (next: number) => RealmRacersCircuit,
  ): HTMLElement {
    const { wrap, name } = fieldRow(label);
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '1';
    input.min = String(MIN_PERIMETER_HALF);
    input.max = String(max);
    input.value = String(value);
    input.onchange = () => this.host.commit(write(numberOr(input.value, value)));
    name.append(input);
    return wrap;
  }

  /**
   * What the record says about the land.
   *
   * READ ONLY, deliberately: the two things one can do to a ground shape (draw
   * one, discard it) act on the whole terrain rather than on a selection, so
   * they live on the mode's action bar. An absent outline is a STATE worth
   * naming rather than an empty section: the rectangle a circuit falls back to
   * is what both shipped circuits wear, so "there is no shape here" is the
   * normal answer and it has to be legible as one.
   */
  private landRows(): HTMLElement[] {
    const outline = this.host.record().groundOutline;
    if (!outline || outline.length === 0) {
      return [
        heading('the land'),
        hintLine('no shape drawn: the land is the rectangle covering the whole region'),
        detailLine('Draw ground shape, or Fit ground, on the bar above the plan'),
      ];
    }
    const point = this.host.groundSelection();
    return [
      heading('the land'),
      detailLine(
        point === null
          ? `an island on ${outline.length} handles: click one to move it, click the curve to insert one`
          : `handle ${point + 1} of ${outline.length}: drag it, del removes it`,
      ),
      detailLine('outside it is the theme water, which stops nobody'),
    ];
  }

  /** What the record says about the barriers, and what the selected one can be
   *  edited to. */
  private barrierRows(): HTMLElement[] {
    const out: HTMLElement[] = [heading('barriers')];
    const index = this.host.fenceSelection();
    const record = this.host.record();
    const fences = record.fences ?? [];
    const fence = index === null ? undefined : fences[index];
    // The way OUT of a drawing gesture comes first, before the no-selection
    // return, because starting a run CLEARS the selection: a finish button
    // inside the selected branch is a button that never renders during the one
    // state it exists for.
    const drafting = this.host.draftPointCount();
    if (drafting !== null) {
      out.push(hintLine(terrainArmStateText(null, drafting)));
      out.push(panelButton('finish the run', () => this.host.finishDraft()));
    }
    if (index === null || !fence) {
      out.push(
        hintLine(
          fences.length === 0
            ? 'none on this circuit: arm a kit in the library and click to draw one'
            : 'click a barrier on the plan to select it',
        ),
      );
      out.push(detailLine(`${fenceColliderCount(record)} colliders from barriers`));
      return out;
    }
    const def = REALM_RACERS_BARRIERS[fence.kit];
    // Found by the record index it carries, not by its position: the resolver
    // skips an unknown kit, so the placement list is shorter than the record's
    // and a positional lookup would report another barrier's numbers.
    const placed = realmRacersFencePlacements(record).fences;
    const runs = placed.find((entry) => entry.index === index)?.runs ?? [];
    const length = runs.reduce((total, run) => total + run.length, 0);

    out.push(detailLine(`${barrierKitLabel(fence.kit)} ${index + 1} of ${fences.length}`));
    const { wrap, name } = fieldRow('scale');
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.05';
    input.min = String(FENCE_SCALE_MIN);
    input.max = String(FENCE_SCALE_MAX);
    input.value = (fence.scale ?? 1).toFixed(2);
    input.onchange = () => this.host.setFenceScale(numberOr(input.value, fence.scale ?? 1));
    name.append(input);
    out.push(wrap);
    out.push(
      detailLine(
        `${fence.points.length} points, ${runs.length} runs, ${length.toFixed(1)} yd total`,
      ),
    );
    out.push(detailLine(fence.closed ? 'a closed ring' : 'an open run'));
    if (def) {
      const scale = fence.scale ?? 1;
      out.push(
        detailLine(
          `stands ${(def.height * scale).toFixed(2)} yd, ${(def.halfThickness * 2 * scale).toFixed(2)} yd thick`,
        ),
      );
    }
    out.push(detailLine(`${fenceColliderCount(record)} colliders from barriers in all`));
    out.push(panelButton('delete barrier', () => this.host.removeFence()));
    return out;
  }
}
