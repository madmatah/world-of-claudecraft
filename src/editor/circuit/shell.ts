// The circuit editor's chrome: the menu bar, the tool rail, the plan's overlays,
// the contextual right panel, the metrics drawer and the status bar.
//
// Structure and wiring only. Every label, shortcut, tooltip, tint and cap comes
// from `layout_core.ts`, and every icon from `editor_icons.ts`, so the four
// surfaces that name an action (menu, rail, status hints, cheatsheet) cannot
// drift: they all render the same table. What is left here is elements and
// listeners, which is why this module has no test of its own.

import type { RealmRacersCircuitProblem } from '../../sim/realm_racers_circuit_metrics';
import { type EditorIconId, editorIcon } from './editor_icons';
import {
  type ActionId,
  actionTooltip,
  autoSideTab,
  cheatBlocks,
  chordHints,
  clampToolValue,
  editorAction,
  formatShortcut,
  GRID_YARDS,
  type HeadlineChip,
  MENUS,
  MODE_ACTIONS,
  menuActions,
  type PlacementMode,
  PREVIEW_READY_TITLES,
  type PreviewReadyState,
  problemDetail,
  problemHeadline,
  problemsChip,
  RAIL_ACTION_IDS,
  RAIL_MODES,
  type RailModeId,
  railActions,
  railBanner,
  type ShortcutPlatform,
  SIDE_TAB_LABELS,
  SIDE_TABS_MIN,
  type SideTabId,
  spreadCallouts,
  type ToolValueField,
  zoomPercent,
} from './layout_core';

export interface ShellHost {
  onAction(id: ActionId): void;
  onMode(id: RailModeId): void;
  onSideTab(id: SideTabId): void;
  /** A callout or the status chip was clicked: centre the plan on that spot. */
  onFocusProblem(problem: RealmRacersCircuitProblem): void;
  onToolValue(): void;
  /** The operator took the autosaved draft the status bar was offering. */
  onResume(): void;
}

/** Where a plan point sits in the overlay layer, or null when it is off-plan. */
export type PlanProjector = (s: number) => { x: number; y: number } | null;

export type MessageTone = '' | 'ok' | 'err';

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function withIcon(node: HTMLElement, id: EditorIconId): HTMLElement {
  const glyph = el('span', 'ico');
  glyph.innerHTML = editorIcon(id);
  node.prepend(glyph);
  return node;
}

/**
 * Which platform spelling the chords take.
 *
 * Detected ONCE by the page and injected into both consumers: it was a UA sniff
 * run twice, once here and once for the dock, which is two answers to a question
 * with one.
 */
export function detectPlatform(): ShortcutPlatform {
  return /mac/i.test(navigator.userAgent) ? 'mac' : 'other';
}

export class EditorShell {
  /** Every button bound to an action, so enabling and checking is by id. */
  private readonly actionButtons = new Map<ActionId, HTMLButtonElement[]>();
  private readonly modeButtons = new Map<RailModeId, HTMLButtonElement>();
  /** The plan-side repair buttons, one per action, shown per mode. */
  private readonly railActionButtons = new Map<ActionId, HTMLButtonElement>();
  private readonly sideTabButtons = new Map<SideTabId, HTMLButtonElement>();
  private openMenu: HTMLDetailsElement | null = null;

  readonly planEl = document.getElementById('plan') as HTMLDivElement;
  readonly sideBodyEl = document.getElementById('sideBody') as HTMLDivElement;
  readonly metricsBodyEl = document.getElementById('metricsBody') as HTMLDivElement;
  readonly toolValueInput = document.getElementById('toolValue') as HTMLInputElement;

  private readonly menuBarEl = document.getElementById('menus') as HTMLDivElement;
  private readonly railEl = document.getElementById('railTop') as HTMLDivElement;
  private readonly railFootEl = document.getElementById('railFoot') as HTMLDivElement;
  private readonly quickEl = document.getElementById('quick') as HTMLDivElement;
  private readonly docIdEl = document.getElementById('docId') as HTMLSpanElement;
  private readonly docDirtyEl = document.getElementById('docDirty') as HTMLSpanElement;
  private readonly readyDotEl = document.getElementById('readyDot') as HTMLSpanElement;
  private readonly bannerEl = document.getElementById('banner') as HTMLDivElement;
  private readonly bannerModeEl = document.getElementById('bannerMode') as HTMLSpanElement;
  private readonly bannerTextEl = document.getElementById('bannerText') as HTMLSpanElement;
  private readonly viewChipsEl = document.getElementById('viewChips') as HTMLDivElement;
  private readonly modeActionsEl = document.getElementById('modeActions') as HTMLDivElement;
  private readonly headlineEl = document.getElementById('headline') as HTMLDivElement;
  private readonly calloutsEl = document.getElementById('callouts') as HTMLDivElement;
  private readonly metricsEl = document.getElementById('metricsDrawer') as HTMLDivElement;
  private readonly sideTabsEl = document.getElementById('sideTabs') as HTMLDivElement;
  private readonly toolOptionsEl = document.getElementById('toolOptions') as HTMLDivElement;
  private readonly toolValueLabel = document.getElementById('toolValueLabel') as HTMLLabelElement;
  private readonly problemChipEl = document.getElementById('problemChip') as HTMLButtonElement;
  private readonly cursorEl = document.getElementById('cursorReadout') as HTMLSpanElement;
  private readonly armEl = document.getElementById('armState') as HTMLSpanElement;
  private readonly messageEl = document.getElementById('message') as HTMLSpanElement;
  private readonly resumeEl = document.getElementById('resumeOffer') as HTMLButtonElement;
  private readonly hintsEl = document.getElementById('chordHints') as HTMLSpanElement;
  private readonly keysDialog = document.getElementById('keysDialog') as HTMLDialogElement;
  private readonly keysBodyEl = document.getElementById('keysBody') as HTMLDivElement;

  /** The problem the status chip points at, so clicking it focuses the worst. */
  private worst: RealmRacersCircuitProblem | null = null;
  private zoomChip!: HTMLButtonElement;
  private gridChip!: HTMLButtonElement;
  private snapChip!: HTMLButtonElement;

  constructor(
    private readonly host: ShellHost,
    private readonly platform: ShortcutPlatform,
  ) {
    this.buildMenus();
    this.buildQuickActions();
    this.buildRail();
    this.buildModeActions();
    this.buildViewChips();
    this.buildSideTabs();
    this.buildMetricsChrome();
    this.buildCheatsheet();

    this.problemChipEl.onclick = () => {
      if (this.worst) this.host.onFocusProblem(this.worst);
    };
    this.toolValueInput.onchange = () => this.host.onToolValue();
    this.resumeEl.onclick = () => this.host.onResume();
    this.hintsEl.textContent = chordHints(this.platform).join('  -  ');
  }

  // ---- the menu bar ----

  private buildMenus(): void {
    for (const menu of MENUS) {
      const details = el('details', 'menu');
      const summary = el('summary');
      summary.textContent = menu.label;
      details.append(summary);
      const list = el('div', 'menu-items');
      for (const action of menuActions(menu.id)) {
        const button = this.actionButton(action.id, 'menu-item');
        const label = el('span', 'menu-label');
        label.textContent = action.label;
        const chord = el('span', 'menu-chord');
        chord.textContent = action.gesture
          ? action.gesture
          : action.shortcut
            ? formatShortcut(action.shortcut, this.platform)
            : '';
        button.append(label, chord);
        withIcon(button, action.icon);
        list.append(button);
      }
      details.append(list);
      // One menu open at a time, and a click on an item closes it: a menu that
      // stayed open over the plan is a menu covering the thing it just changed.
      details.addEventListener('toggle', () => {
        if (!details.open) {
          if (this.openMenu === details) this.openMenu = null;
          return;
        }
        if (this.openMenu && this.openMenu !== details) this.openMenu.open = false;
        this.openMenu = details;
      });
      list.addEventListener('click', () => {
        details.open = false;
      });
      this.menuBarEl.append(details);
    }
    document.addEventListener('pointerdown', (ev) => {
      if (!this.openMenu) return;
      if (ev.target instanceof Node && this.openMenu.contains(ev.target)) return;
      this.closeMenu();
    });
    // `<details>` does not close on escape the way a dialog does, so the one key
    // everybody presses to back out of a menu did nothing at all here, and the
    // page's own escape (pointer, drop the selection) fired underneath it. Taken
    // on DOCUMENT so it runs before the page's window listener, and the focus
    // goes back to the summary the menu was opened from rather than being left
    // on a button that has just been hidden.
    document.addEventListener('keydown', (ev) => {
      const menu = this.openMenu;
      if (ev.key !== 'Escape' || !menu) return;
      this.closeMenu();
      menu.querySelector('summary')?.focus();
      ev.preventDefault();
      ev.stopPropagation();
    });
  }

  /**
   * Shut the open menu AND forget it, in one place.
   *
   * Clearing the field here rather than leaving it to the `toggle` listener: a
   * browser does fire `toggle` when `open` is assigned, but it fires it LATE, so
   * between the escape and the next frame this shell still believed a menu was
   * open and went on swallowing escapes the page needed.
   */
  private closeMenu(): void {
    const menu = this.openMenu;
    this.openMenu = null;
    if (menu) menu.open = false;
  }

  private buildQuickActions(): void {
    for (const id of ['undo', 'redo', 'saveDraft'] as const) {
      const button = this.actionButton(id, id === 'saveDraft' ? 'primary' : '');
      const label = el('span');
      label.textContent = editorAction(id).label;
      button.append(label);
      withIcon(button, editorAction(id).icon);
      this.quickEl.append(button);
    }
  }

  // ---- the tool rail ----

  private buildRail(): void {
    this.railEl.setAttribute('role', 'radiogroup');
    this.railEl.setAttribute('aria-label', 'Tool');
    for (const mode of RAIL_MODES) {
      const button = el('button', 'rail-btn');
      button.type = 'button';
      // A radio, not a pressed button: the four are exclusive, and colour alone
      // left the active tool with no programmatic state at all.
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.title = actionTooltip(editorAction(MODE_ACTIONS[mode.id]), this.platform);
      const label = el('span', 'rail-label');
      label.textContent = mode.label;
      button.append(label);
      withIcon(button, mode.icon);
      button.onclick = () => this.host.onMode(mode.id);
      this.modeButtons.set(mode.id, button);
      // The rail entry and the menu entry are the same action, so both light up
      // and both disable together.
      this.bind(MODE_ACTIONS[mode.id], button);
      this.railEl.append(button);
    }
    const keys = this.actionButton('keys', 'rail-btn');
    const label = el('span', 'rail-label');
    label.textContent = 'Keys';
    keys.append(label);
    withIcon(keys, 'keyboard');
    this.railFootEl.append(keys);
  }

  private buildModeActions(): void {
    for (const id of RAIL_ACTION_IDS) {
      const action = editorAction(id);
      const button = this.actionButton(id, 'chip');
      const label = el('span');
      label.textContent = action.label;
      button.append(label);
      withIcon(button, action.icon);
      button.hidden = true;
      this.railActionButtons.set(id, button);
      this.modeActionsEl.append(button);
    }
  }

  // ---- the plan's overlays ----

  private buildViewChips(): void {
    this.zoomChip = this.actionButton('fitView', 'chip');
    this.gridChip = this.actionButton('toggleGrid', 'chip');
    this.gridChip.textContent = `grid ${GRID_YARDS} yd`;
    this.snapChip = this.actionButton('toggleSnap', 'chip');
    this.snapChip.textContent = `snap ${GRID_YARDS} yd`;
    this.viewChipsEl.append(this.zoomChip, this.gridChip, this.snapChip);
  }

  setViewChips(scale: number, grid: boolean, snap: boolean): void {
    this.zoomChip.textContent = `${zoomPercent(scale)}%`;
    this.gridChip.classList.toggle('on', grid);
    this.snapChip.classList.toggle('on', snap);
  }

  setHeadline(chips: readonly HeadlineChip[] | null): void {
    this.headlineEl.replaceChildren();
    this.headlineEl.hidden = chips === null;
    if (!chips) return;
    for (const chip of chips) {
      const cell = el('div', `metric ${chip.tone}`);
      cell.title = chip.title;
      const label = el('div', 'metric-label');
      label.textContent = chip.label;
      const value = el('div', 'metric-value');
      value.textContent = chip.value;
      if (chip.unit) {
        const unit = el('span', 'metric-unit');
        unit.textContent = chip.unit;
        value.append(' ', unit);
      }
      cell.append(label, value);
      this.headlineEl.append(cell);
    }
  }

  setBanner(
    mode: RailModeId,
    drawn: boolean,
    redrawing = false,
    placement: PlacementMode = 'single',
    placing = false,
    groundArmed = false,
  ): void {
    const def = RAIL_MODES.find((entry) => entry.id === mode);
    this.bannerModeEl.textContent = (def?.label ?? mode).toUpperCase();
    this.bannerTextEl.textContent = railBanner(
      mode,
      drawn,
      redrawing,
      placement,
      placing,
      groundArmed,
    );
    this.bannerEl.hidden = false;
  }

  setMode(
    mode: RailModeId,
    drawn: boolean,
    redrawing = false,
    placement: PlacementMode = 'single',
    placing = false,
    groundArmed = false,
  ): void {
    for (const [id, button] of this.modeButtons) {
      button.classList.toggle('on', id === mode);
      button.setAttribute('aria-checked', id === mode ? 'true' : 'false');
    }
    this.setBanner(mode, drawn, redrawing, placement, placing, groundArmed);
    // The mode's own repairs, beside its banner. Built once and shown, hidden or
    // MOVED, never rebuilt: an action button is registered by id for its enabled
    // and checked states, and rebuilding would leave those maps holding buttons
    // nothing can reach. Re-appending an existing node moves it, so the order is
    // the MODE's own rather than the union of every mode's, which is what
    // `railActions` is written in and what the operator is told to expect
    // (TERRAIN reads land first, enclosure after; the union put `Fit enclosure`
    // in front of both because SHAPE happens to be declared first).
    const offered = railActions(mode);
    for (const [id, button] of this.railActionButtons) button.hidden = !offered.includes(id);
    const wanted = offered
      .map((id) => this.railActionButtons.get(id))
      .filter((button): button is HTMLButtonElement => Boolean(button));
    // Only when the order actually differs, and with the focus put back: moving
    // a node is a detach and an insert, so a chip that is offered by both the
    // mode being left and the one being entered (`Fit enclosure` is on three)
    // would lose the keyboard to `<body>` on every mode digit, which the
    // hide-only version it replaced never did.
    const shown = [...this.modeActionsEl.children].filter(
      (child) => !(child as HTMLElement).hidden,
    );
    if (shown.length !== wanted.length || wanted.some((button, i) => shown[i] !== button)) {
      const focused = document.activeElement;
      for (const button of wanted) this.modeActionsEl.append(button);
      if (focused instanceof HTMLElement && wanted.includes(focused as HTMLButtonElement)) {
        focused.focus();
      }
    }
    this.modeActionsEl.hidden = offered.length === 0;
  }

  /**
   * The problems, on the plan where they happen.
   *
   * The status chip carries the count and the worst one; the callouts carry the
   * located ones at their own lap position, which is the whole point: a corner
   * that folds its road is a place, and a list in a drawer made the operator hunt
   * for it.
   */
  setProblems(
    problems: readonly RealmRacersCircuitProblem[],
    callouts: readonly RealmRacersCircuitProblem[],
    project: PlanProjector,
    planWidth: number,
  ): void {
    const chip = problemsChip(problems);
    this.problemChipEl.className = `chip problems ${chip.tone}`;
    this.problemChipEl.replaceChildren();
    if (chip.tone !== 'clean') withIcon(this.problemChipEl, 'warning');
    const text = el('span');
    text.textContent = chip.text;
    this.problemChipEl.append(text);
    // Straight off the core, never re-derived here: the chip's text and the spot
    // its click focuses have to be the same problem.
    this.worst = chip.focus;
    this.problemChipEl.disabled = chip.focus === null;

    this.calloutsEl.replaceChildren();
    const anchors = spreadCallouts(
      callouts.map((problem) => project(problem.s)),
      { planWidth },
    );
    for (const [index, problem] of callouts.entries()) {
      const at = anchors[index];
      if (!at) continue;
      const node = el('button', `callout ${problem.severity}${at.flip ? ' flip' : ''}`);
      node.type = 'button';
      const title = el('div', 'callout-title');
      title.textContent = problemHeadline(problem);
      const detail = el('div', 'callout-detail');
      detail.textContent = problemDetail(problem);
      node.append(title, detail);
      node.style.left = `${at.x}px`;
      node.style.top = `${at.y}px`;
      node.onclick = () => this.host.onFocusProblem(problem);
      this.calloutsEl.append(node);
    }
  }

  // ---- the contextual right panel ----

  private buildSideTabs(): void {
    // Every tab any mode can offer, built once and shown per mode. Off the label
    // table rather than a list spelled here, so a fourth tab cannot arrive with
    // its button missing and no error anywhere.
    for (const tab of Object.keys(SIDE_TAB_LABELS) as SideTabId[]) {
      const button = el('button', 'side-tab');
      button.type = 'button';
      button.textContent = SIDE_TAB_LABELS[tab];
      button.onclick = () => this.host.onSideTab(tab);
      this.sideTabButtons.set(tab, button);
      this.sideTabsEl.append(button);
    }
  }

  /**
   * Which tabs this mode has, and which one is showing.
   *
   * The strip disappears below two tabs rather than showing one: a single tab is
   * a click that decides nothing, and the panel's own heading already says what
   * is in it.
   */
  setSideTab(tabs: readonly SideTabId[], active: SideTabId | null): void {
    this.sideTabsEl.hidden = tabs.length < SIDE_TABS_MIN;
    for (const [id, button] of this.sideTabButtons) {
      button.hidden = !tabs.includes(id);
      button.classList.toggle('on', id === active);
    }
  }

  /** What a click on the plan will DO, held on screen for as long as it is true:
   *  a transient message cannot answer "am I still placing lanterns". */
  setArmed(text: string): void {
    this.armEl.textContent = text;
  }

  /**
   * The tool's one number, and whether the panel showing right now is the one it
   * belongs to.
   *
   * Two arguments rather than one because the field is a TOOL's, not a panel's:
   * the scatter spacing is the library's business and had no reason to hang over
   * the inspector and the outliner, which is exactly where it was showing.
   */
  setToolValueField(field: ToolValueField | null, shown = true): void {
    const hidden = field === null || !shown;
    this.toolValueLabel.hidden = hidden;
    // The STRIP goes with it. Kept open it left an empty padded band above the
    // panel body in shape, handles and race, which reads as a control that failed
    // to render rather than as a tool with no options.
    this.toolOptionsEl.hidden = hidden;
    if (!field) return;
    this.toolValueLabel.firstChild?.replaceWith(`${field.label} `);
    this.toolValueInput.min = String(field.min);
    this.toolValueInput.max = String(field.max);
    this.toolValueInput.value = String(clampToolValue(field, Number(this.toolValueInput.value)));
  }

  // ---- the metrics drawer ----

  private buildMetricsChrome(): void {
    const close = el('button', 'x-btn');
    close.type = 'button';
    close.title = 'Close the readout';
    close.innerHTML = editorIcon('close');
    close.onclick = () => this.host.onAction('toggleMetrics');
    (document.getElementById('metricsHead') as HTMLDivElement).append(close);
  }

  showMetrics(open: boolean): void {
    this.metricsEl.hidden = !open;
    this.setChecked('toggleMetrics', open);
  }

  // ---- the cheatsheet ----

  private buildCheatsheet(): void {
    for (const block of cheatBlocks(this.platform)) {
      const section = el('div', 'keys-block');
      const title = el('h4');
      title.textContent = block.label;
      section.append(title);
      for (const entry of block.rows) {
        const row = el('div', 'keys-row');
        const chord = el('kbd');
        chord.textContent = entry.chord;
        const label = el('span');
        label.textContent = entry.label;
        row.append(chord, label);
        section.append(row);
      }
      this.keysBodyEl.append(section);
    }
    (document.getElementById('keysClose') as HTMLButtonElement).onclick = () =>
      this.keysDialog.close();
  }

  /** Whether the cheatsheet modal owns the keyboard. */
  get keysOpen(): boolean {
    return this.keysDialog.open;
  }

  toggleKeys(): void {
    if (this.keysDialog.open) this.keysDialog.close();
    else this.keysDialog.showModal();
  }

  // ---- the status bar and the document ----

  setDocument(id: string, dirty: boolean): void {
    this.docIdEl.textContent = id;
    this.docDirtyEl.hidden = !dirty;
  }

  setCursor(text: string): void {
    this.cursorEl.textContent = text;
  }

  /**
   * The resume offer, on the status bar rather than in a modal.
   *
   * A dev tool that opened a dialog over the canvas at boot would make the FIRST
   * thing an operator does every session be dismissing something. The offer sits
   * there until it is taken or the canvas is drawn on, and taking it is one
   * click; ignoring it costs nothing at all.
   */
  setResume(text: string | null): void {
    this.resumeEl.hidden = text === null;
    if (text) this.resumeEl.textContent = text;
  }

  setMessage(text: string, tone: MessageTone = ''): void {
    this.messageEl.textContent = text;
    this.messageEl.className = tone;
  }

  setPreviewReady(state: PreviewReadyState): void {
    this.readyDotEl.className = `dot ${state}`;
    this.readyDotEl.title = PREVIEW_READY_TITLES[state];
  }

  // ---- action plumbing ----

  private actionButton(id: ActionId, className = ''): HTMLButtonElement {
    const button = el('button', className);
    button.type = 'button';
    button.title = actionTooltip(editorAction(id), this.platform);
    button.onclick = () => this.host.onAction(id);
    this.bind(id, button);
    return button;
  }

  private bind(id: ActionId, button: HTMLButtonElement): void {
    const held = this.actionButtons.get(id);
    if (held) held.push(button);
    else this.actionButtons.set(id, [button]);
  }

  setEnabled(id: ActionId, enabled: boolean): void {
    for (const button of this.actionButtons.get(id) ?? []) button.disabled = !enabled;
  }

  setChecked(id: ActionId, on: boolean): void {
    for (const button of this.actionButtons.get(id) ?? []) {
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  /** Which tab the panel should be showing, given the mode and the selection. */
  autoTab(mode: RailModeId, hasSelection: boolean, isPlacing = false): SideTabId | null {
    return autoSideTab(mode, hasSelection, isPlacing);
  }
}
